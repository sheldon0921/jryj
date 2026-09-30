#!/usr/bin/env node
/**
 * 今日油价数据同步脚本
 *
 * 抓取油价通（youjiatong.com）的省级挂牌价、发改委调价日历与国际原油页面，
 * 重新生成 web/data.js 与 miniprogram/utils/oil-data.js。
 *
 *   node scripts/sync-oil.mjs              试运行：写到 scripts/.sync/，打印变更，不动源文件
 *   node scripts/sync-oil.mjs --apply      正式写入两处数据文件
 *   node scripts/sync-oil.mjs --json       额外输出机器可读报告到 scripts/.sync/report.json
 *   node scripts/sync-oil.mjs --force      忽略“源站日期不是今天”这一项告警
 *
 * 任何校验不通过都不会写文件（退出码 1），避免把残缺或异常数据刷进站点。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile Safari";
const BASE = "http://m.youjiatong.com";

// slug -> { name, area }：油价通页面无行政区划，需要固定映射；注意 shanxi=山西、shannxi=陕西
const PROVINCES = [
  ["beijing", "北京", "华北"], ["tianjin", "天津", "华北"], ["hebei", "河北", "华北"],
  ["shanxi", "山西", "华北"], ["neimenggu", "内蒙古", "华北"], ["liaoning", "辽宁", "东北"],
  ["jilin", "吉林", "东北"], ["heilongjiang", "黑龙江", "东北"], ["shanghai", "上海", "华东"],
  ["jiangsu", "江苏", "华东"], ["zhejiang", "浙江", "华东"], ["anhui", "安徽", "华东"],
  ["fujian", "福建", "华东"], ["jiangxi", "江西", "华东"], ["shandong", "山东", "华东"],
  ["henan", "河南", "华中"], ["hubei", "湖北", "华中"], ["hunan", "湖南", "华中"],
  ["guangdong", "广东", "华南"], ["guangxi", "广西", "华南"], ["hainan", "海南", "华南"],
  ["chongqing", "重庆", "西南"], ["sichuan", "四川", "西南"], ["guizhou", "贵州", "西南"],
  ["yunnan", "云南", "西南"], ["xizang", "西藏", "西南"], ["shannxi", "陕西", "西北"],
  ["gansu", "甘肃", "西北"], ["qinghai", "青海", "西北"], ["ningxia", "宁夏", "西北"],
  ["xinjiang", "新疆", "西北"]
];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const OPT = {
  apply: has("--apply"),
  json: has("--json"),
  force: has("--force"),
  year: Number((argv[argv.indexOf("--year") + 1] || "").match(/^\d{4}$/) || 0) ||
    new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear(),
  timeout: Number(process.env.SYNC_TIMEOUT || 25000),
  concurrency: Number(process.env.SYNC_CONCURRENCY || 4),
  dir: join(ROOT, "scripts", ".sync")
};

const log = (...a) => console.log(...a);

async function fetchText(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: BASE + "/" },
        signal: AbortSignal.timeout(OPT.timeout),
        redirect: "follow"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.text();
      if (body.length < 500) throw new Error("响应过短 " + body.length + " 字节");
      return body;
    } catch (e) {
      err = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(url + " 抓取失败：" + (err && err.message));
}

// 顺序受限并发，避免给源站压力
async function mapLimit(items, fn) {
  const out = new Array(items.length);
  let cur = 0;
  const workers = new Array(Math.min(OPT.concurrency, items.length)).fill(0).map(async () => {
    while (cur < items.length) {
      const i = cur++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const num = (s) => Math.round(parseFloat(s) * 100) / 100;

function parseProvince(html, name) {
  const t = text(html);
  const d = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!d) throw new Error(name + "：未找到数据日期");
  const row = t.match(/(20\d\d-\d\d-\d\d)((?:\s+\d+\.\d+){6})/);
  const hist = row ? row[2].trim().split(/\s+/).map(Number) : null;
  // 源站对不供应的油品标 0.00，一律记为 null（页面显示“当地不供应”）
  const pick = (re, label, required) => {
    const m = t.match(re);
    if (!m) throw new Error(name + "：未解析出" + label);
    const v = num(m[1]);
    if (v <= 0) {
      if (required) throw new Error(name + "：" + label + " 标为 0.00，页面结构可能已变");
      return null;
    }
    return v;
  };
  const p92 = pick(/92\s*号\s*汽油\s*为\s*(\d+(?:\.\d+)?)\s*元/, "92号", true);
  const p95 = pick(/95\s*号\s*汽油\s*为\s*(\d+(?:\.\d+)?)\s*元/, "95号", true);
  const p98 = pick(/98\s*号\s*汽油\s*为\s*(\d+(?:\.\d+)?)\s*元/, "98号", false);
  const d0 = pick(/0\s*号\s*柴油\s*为\s*(\d+(?:\.\d+)?)\s*元/, "0号柴油", true);
  // 历史表首行是最新一次调整：列为 90/92/93/95/97/0号，92号对得上才采信 90 号
  const p90 = hist && Math.abs(hist[1] - p92) < 0.005 && hist[0] > 0 ? hist[0] : null;
  return {
    name,
    asOf: d[1] + "-" + String(d[2]).padStart(2, "0") + "-" + String(d[3]).padStart(2, "0"),
    p90, p92, p95, p98, d0
  };
}

function parseCalendar(html, year) {
  const t = text(html);
  const head = t.indexOf(year + "年油价调整日历表");
  const next = t.indexOf((year - 1) + "年油价调整日历表", head + 1);
  const tail = t.indexOf((year + 1) + "年油价调整日历表", head + 1);
  const cut = [head, next, tail].filter((i) => i > -1).sort((a, b) => a - b);
  if (cut[0] !== head) throw new Error("页面里没有 " + year + " 年调价日历表");
  const seg = t.slice(head, cut.length > 1 ? cut[1] : t.length);

  const marks = [];
  const re = /(\d{1,2})月(\d{1,2})日24时/g;
  let m;
  while ((m = re.exec(seg))) {
    if (/20\d\d年$/.test(seg.slice(Math.max(0, m.index - 6), m.index))) continue; // “下一轮…2026年10月15日24时”
    marks.push({ month: +m[1], day: +m[2], from: re.lastIndex, to: 0 });
  }
  marks.forEach((x, i) => { x.to = i + 1 < marks.length ? marks[i + 1].from - 12 : seg.length; });

  const rows = marks.map((x) => {
    const body = seg.slice(x.from, x.to);
    const hold = /不作调整/.test(body);
    const ton = body.match(/(上调|下调)\s*(\d+)\s*(?:[、,，]\s*(\d+)\s*)?元\s*\/\s*吨/);
    const perL = body.match(/约(?:为)?\s*(\d+(?:\.\d+)?)\s*元/);
    const sign = ton && ton[1] === "下调" ? -1 : 1;
    const gasoline = hold || !ton ? 0 : sign * +ton[2];
    const diesel = hold || !ton ? 0 : sign * +(ton[3] || ton[2]);
    const perL92 = hold || !perL ? 0 : sign * +perL[1];
    return {
      month: x.month,
      day: x.day,
      date: year + "-" + String(x.month).padStart(2, "0") + "-" + String(x.day).padStart(2, "0"),
      label: x.month + "月" + x.day + "日24时",
      hold,
      gasoline,
      diesel,
      perL92
    };
  });
  if (!rows.length) throw new Error("日历表里没解析出任何窗口");
  return rows;
}

function parseCrude(html) {
  const t = text(html);
  const d = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const pick = (re, label) => {
    const m = t.match(re);
    if (!m) throw new Error("未解析出" + label);
    return num(m[1]);
  };
  const asOf = d ? +d[2] + "月" + +d[3] + "日收盘" : "最近交易日收盘";
  return [
    { name: "WTI 原油", price: pick(/WTI\s*美国原油价格昨收[:：]?\s*(\d+(?:\.\d+)?)/, "WTI"), unit: "美元/桶", asOf },
    { name: "布伦特原油", price: pick(/布伦特原油价格昨收[:：]?\s*(\d+(?:\.\d+)?)/, "布伦特"), unit: "美元/桶", asOf }
  ];
}

// 最新一轮的每升降幅（源站仅在“本轮油价调整为”这句话里给出 92/95/0 号，98 号沿用 95 号口径）
function parseLatest(html, year) {
  const t = text(html);
  const m = t.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日24时油价调整，本轮油价调整为：([\s\S]{0,220}?)下一轮油价调整窗口时间：(\d{4})年(\d{1,2})月(\d{1,2})日24时/
  );
  if (!m) throw new Error("未解析出“本轮油价调整为”段落");
  const body = m[4];
  const hold = /不作调整/.test(body);
  const ton = {};
  const tre = /(汽油|柴油)(上调|下调)(\d+)元\/吨/g;
  let x;
  while ((x = tre.exec(body))) ton[x[1]] = (x[2] === "下调" ? -1 : 1) * +x[3];
  const perL = {};
  const prel = /(92|95|98|0)号(?:汽油|柴油)?(上调|下调)([\d.]+)元\/升/g;
  while ((x = prel.exec(body))) perL[x[1]] = (x[2] === "下调" ? -1 : 1) * +x[3];
  if (hold) { ton["汽油"] = 0; ton["柴油"] = 0; Object.keys(perL).forEach((k) => (perL[k] = 0)); }
  if (!hold && (ton["汽油"] === undefined || !perL["92"] || !perL["0"])) {
    throw new Error("本轮幅度不完整（汽油/92号/0号柴油每升数额缺失）");
  }
  return {
    date: m[1] + "-" + String(+m[2]).padStart(2, "0") + "-" + String(+m[3]).padStart(2, "0"),
    label: +m[2] + "月" + +m[3] + "日24时",
    gasoline: ton["汽油"] || 0,
    diesel: ton["柴油"] || 0,
    perL: {
      "92": perL["92"] || 0,
      "95": perL["95"] || perL["92"] || 0,
      "98": perL["98"] || perL["95"] || perL["92"] || 0,
      "0": perL["0"] || 0
    },
    nextWindow: m[5] + "-" + String(+m[6]).padStart(2, "0") + "-" + String(+m[7]).padStart(2, "0")
  };
}

function buildData({ provinces, calendar, crude, latest, prevRegions }) {
  const executed = calendar.filter((r) => Date.parse(r.date + "T23:59:59+08:00") <= Date.now());
  if (!executed.length) throw new Error("日历里还没有任何已执行的窗口");
  const last = executed[executed.length - 1];
  if (latest.date !== last.date) {
    throw new Error("“本轮”标的是 " + latest.date + "，但日历里最后已执行窗口是 " + last.date + "，页面可能只更新了一半");
  }
  const tally = {};
  provinces.forEach((p) => { tally[p.asOf] = (tally[p.asOf] || 0) + 1; });
  const asOf = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || (a < b ? 1 : -1))[0];
  // 源站标 0.00 只代表它没收录该油品，不等于当地不卖；手册里已有数值时保留旧值并单独提示
  const kept = [];
  const regions = PROVINCES.map(([slug, name, area], i) => {
    const p = provinces[i];
    const old = prevRegions ? prevRegions.find((r) => r.name === name) : null;
    ["p90", "p98"].forEach((k) => {
      if (p[k] === null && old && typeof old[k] === "number") {
        p[k] = old[k];
        kept.push(name + " " + k + "（源站未收录，沿用手册值 " + old[k] + "）");
      }
    });
    return { name, area, p90: p.p90, p92: p.p92, p95: p.p95, p98: p.p98, d0: p.d0 };
  });
  return {
    source: {
      site: BASE,
      asOf,
      nextWindow: latest.nextWindow,
      keptMissing: kept,
      scrapedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " 北京时间",
      note: "由 scripts/sync-oil.mjs 自动抓取，人工核对后再发布。"
    },
    lastAdjust: {
      date: latest.date,
      label: latest.label,
      gasolinePerTon: latest.gasoline,
      dieselPerTon: latest.diesel,
      perL: { "92": latest.perL["92"], "95": latest.perL["95"], "98": latest.perL["98"], "0": latest.perL["0"] }
    },
    effectiveFrom: latest.date,
    schedule: calendar.map((r) => r.date),
    scheduleNote:
      "窗口一般为每 10 个工作日（约两周）24 时，遇节假日顺延；超出已公布日程的日期为按 14 天节奏的推算值，以国家发改委公告为准。",
    crude,
    adjustments: executed.map((r) => {
      const row = { date: r.month + "月" + r.day + "日", gasoline: r.gasoline, diesel: r.diesel, perL92: r.perL92 };
      if (r.hold) row.hold = true;
      return row;
    }),
    regions
  };
}

function validate(data, knownNames) {
  const e = [];
  const warn = [];
  const blocking = [];
  if (data.regions.length !== 31) e.push("地区数 " + data.regions.length + "，应为 31");
  data.regions.forEach((r) => {
    ["p92", "p95", "d0"].forEach((k) => {
      if (!(typeof r[k] === "number" && r[k] > 4 && r[k] < 15)) e.push(r.name + "." + k + "=" + r[k] + " 不在 4~15 元/升");
    });
    if (r.p98 !== null && !(r.p98 > 4 && r.p98 < 15)) e.push(r.name + ".p98=" + r.p98 + " 不在 4~15 元/升");
    if (r.p92 >= r.p95) e.push(r.name + " 92/95 号价格未按序递增");
    if (r.p98 !== null && r.p95 >= r.p98) e.push(r.name + " 95/98 号价格未按序递增");
    if (r.d0 >= r.p92) e.push(r.name + " 0号柴油不低于 92号汽油");
    if (r.p90 !== null && !(r.p90 > 4 && r.p90 < r.p92)) e.push(r.name + " 90号价 " + r.p90 + " 异常");
  });
  if (!data.adjustments.length) e.push("调价日历为空");
  if (data.adjustments.filter((a) => !a.hold).length < 3) e.push("已收录的调整次数过少，疑似解析不完整");
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  if (data.source.asOf !== today) {
    blocking.push("源站挂牌日期为 " + data.source.asOf + "，不是今天（" + today + "），上游可能尚未更新");
  }
  if (data.regions.some((r) => !knownNames.has(r.name))) e.push("地区映射与抓取结果不一致");
  if (!data.schedule.includes(data.effectiveFrom)) e.push("执行基准 " + data.effectiveFrom + " 不在日程表内");
  const upcoming = data.schedule.filter((s) => Date.parse(s + "T23:59:59+08:00") > Date.now());
  if (upcoming.length && data.source.nextWindow && upcoming[0] !== data.source.nextWindow) {
    e.push("源站标注下一轮 " + data.source.nextWindow + "，与日程推算 " + upcoming[0] + " 不一致");
  }
  data.crude.forEach((c) => {
    if (!(c.price > 20 && c.price < 200)) e.push(c.name + " " + c.price + " 不在 20~200 美元/桶");
  });
  return { errors: e, warnings: warn, blocking };
}

// 两种产物格式：站点用 window.OIL_DATA，小程序用 module.exports
function serialize(data, kind) {
  const n2 = (v) => (v === null ? "null" : String(Math.round(v * 100) / 100));
  const indent = "  ";
  const regions = data.regions
    .map((r) => {
      const cols = kind === "web"
        ? ["p90: " + n2(r.p90), "p92: " + r.p92, "p95: " + r.p95, "p98: " + r.p98, "d0: " + r.d0]
        : ["p92: " + r.p92, "p95: " + r.p95, "p98: " + r.p98, "d0: " + r.d0];
      return indent + indent + "{ name: \"" + r.name + "\", area: \"" + r.area + "\", " + cols.join(", ") + " },";
    })
    .join("\n");
  const adjust = data.adjustments
    .map((a) => indent + indent + "{ date: \"" + a.date + "\", gasoline: " + a.gasoline + ", diesel: " + a.diesel +
      ", perL92: " + a.perL92 + (a.hold ? ", hold: true" : "") + " },")
    .join("\n");
  const crude = data.crude
    .map((c) => indent + indent + "{ name: \"" + c.name + "\", price: " + c.price + ", unit: \"" + c.unit +
      "\", asOf: \"" + c.asOf + "\" },")
    .join("\n");
  const la = data.lastAdjust;
  const sched = data.schedule.map((s) => "\"" + s + "\"");
  const schedLines = [];
  for (let i = 0; i < sched.length; i += 5) schedLines.push(indent + indent + sched.slice(i, i + 5).join(", ") + ",");
  const body = [
    "  lastAdjust: {",
    indent + indent + "date: \"" + la.date + "\",",
    indent + indent + "label: \"" + la.label + "\",",
    indent + indent + "gasolinePerTon: " + la.gasolinePerTon + ",",
    indent + indent + "dieselPerTon: " + la.dieselPerTon + ",",
    indent + indent + "perL: { \"92\": " + la.perL["92"] + ", \"95\": " + la.perL["95"] + ", \"98\": " + la.perL["98"] +
      ", \"0\": " + la.perL["0"] + " }",
    "  },",
    "  effectiveFrom: \"" + data.effectiveFrom + "\",",
    "  schedule: [",
    schedLines.join("\n").replace(/,$/, ""),
    "  ],",
    "  scheduleNote: \"" + data.scheduleNote + "\",",
    "  crude: [",
    crude.replace(/,$/, ""),
    "  ],",
    "  adjustments: [",
    adjust.replace(/,$/, ""),
    "  ],",
    "  regions: [",
    regions.replace(/,$/, ""),
    "  ]"
  ].join("\n");
  return (
    "// 由 scripts/sync-oil.mjs 自动生成，请勿手工编辑；数据来源 " + data.source.site + "，抓取时间 " +
    data.source.scrapedAt + "。\n" +
    "// 挂牌价为各省现行执行价（基准轮次 " + la.label + "），查看日期由页面按当天动态计算。\n" +
    (kind === "web" ? "window.OIL_DATA = {\n" : "module.exports = {\n") + body + "\n};\n"
  );
}

function readCurrent(file, kind) {
  const src = readFileSync(join(ROOT, file), "utf8");
  if (kind === "web") {
    const w = {};
    new Function("window", src)(w);
    return w.OIL_DATA;
  }
  return createRequire(import.meta.url)(join(ROOT, file));
}

function summarize(next, prev) {
  const lines = [];
  if (!prev) return ["（首次生成，无对照）"];
  if (prev.effectiveFrom !== next.effectiveFrom) lines.push("执行基准: " + prev.effectiveFrom + " → " + next.effectiveFrom);
  if (JSON.stringify(prev.schedule) !== JSON.stringify(next.schedule))
    lines.push("调价日程: " + prev.schedule.length + " → " + next.schedule.length + " 个窗口");
  (next.crude || []).forEach((c) => {
    const p = (prev.crude || []).find((x) => x.name.indexOf(c.name.slice(0, 3)) === 0);
    if (p && p.price !== c.price) lines.push(c.name + ": " + p.price + " → " + c.price + " " + c.unit);
  });
  const pa = prev.adjustments || [], na = next.adjustments || [];
  if (JSON.stringify(pa) !== JSON.stringify(na)) {
    const known = new Set(pa.map((a) => a.date));
    const added = na.filter((a) => !known.has(a.date));
    const dropped = pa.filter((a) => !new Set(na.map((y) => y.date)).has(a.date));
    const amended = na.filter((a) => {
      const o = pa.find((y) => y.date === a.date);
      return o && (o.gasoline !== a.gasoline || o.diesel !== a.diesel || o.perL92 !== a.perL92);
    });
    lines.push("调整记录: " + pa.length + " → " + na.length + " 轮" +
      (added.length ? "，新增 " + added.map((a) => a.date + "(" + (a.hold ? "搁置" : a.gasoline + "元/吨)") + "") : "") +
      (dropped.length ? "，去掉未执行轮次 " + dropped.map((a) => a.date).join("、") : "") +
      (amended.length ? "，幅度修正 " + amended.map((a) => a.date + " " + a.gasoline + "元/吨").join("、") : ""));
  }
  let changed = 0;
  (next.regions || []).forEach((r) => {
    const p = (prev.regions || []).find((x) => x.name === r.name);
    if (!p) return void lines.push("新增地区 " + r.name);
    ["p92", "p95", "p98", "d0"].forEach((k) => {
      if (p[k] === r[k]) return;
      changed++;
      lines.push(r.name + " " + k + ": " + (p[k] == null ? "—" : p[k]) + " → " + (r[k] == null ? "—" : r[k]));
    });
  });
  lines.unshift("挂牌价变动 " + changed + " 项（92/95/98/0号，90号仅存档不计入）");
  return lines;
}

async function main() {
  mkdirSync(OPT.dir, { recursive: true });
  log("同步目标：" + OPT.year + " 年日程 + 31 省挂牌价（" + BASE + "）");

  const [provinceHtml, calendarHtml, crudeHtml] = await Promise.all([
    mapLimit(PROVINCES, (p) => fetchText(BASE + "/" + p[0] + ".html").then((h) => [p, h])),
    fetchText(BASE + "/tiaozheng.html"),
    fetchText(BASE + "/guoji.html")
  ]);

  const prevWeb = existsSync(join(ROOT, "web", "data.js")) ? readCurrent("web/data.js", "web") : null;
  const provinces = provinceHtml.map(([p, h]) => {
    const r = parseProvince(h, p[1]);
    return Object.assign(r, { area: p[2] });
  });
  const calendar = parseCalendar(calendarHtml, OPT.year);
  const latest = parseLatest(calendarHtml, OPT.year);
  const data = buildData({
    provinces,
    calendar,
    crude: parseCrude(crudeHtml),
    latest,
    prevRegions: prevWeb && prevWeb.regions
  });

  const { errors, warnings, blocking } = validate(data, new Set(PROVINCES.map((p) => p[1])));
  (data.source.keptMissing || []).forEach((w) => warnings.push(w));
  warnings.forEach((w) => log("· " + w));
  blocking.forEach((b) => log("⚠ " + b));
  if (errors.length) {
    errors.forEach((e) => log("✗ " + e));
    throw new Error("校验未通过（" + errors.length + " 项），本次不写入任何文件");
  }
  if (blocking.length && !OPT.force) {
    throw new Error("存在数据时效风险，未写入；确认上游确实还没更新可加 --force 覆盖");
  }

  const webOut = serialize(data, "web");
  const mpOut = serialize(data, "mp");
  const prevMp = existsSync(join(ROOT, "miniprogram", "utils", "oil-data.js"))
    ? readCurrent("miniprogram/utils/oil-data.js", "mp") : null;
  const lines = summarize(data, prevWeb);

  log("");
  log("基准轮次 " + data.lastAdjust.label + "（汽油 " + data.lastAdjust.gasolinePerTon +
    " 元/吨、柴油 " + data.lastAdjust.dieselPerTon + " 元/吨）");
  lines.slice(0, 20).forEach((l) => log("  " + l));
  if (lines.length > 20) log("  … 其余 " + (lines.length - 20) + " 条");

  const fingerprint = (d) => JSON.stringify([
    d.effectiveFrom, d.schedule, d.adjustments,
    d.crude.map((c) => c.price),
    d.regions.map((r) => [r.name, r.p92, r.p95, r.p98, r.d0])
  ]);
  const unchanged = !!prevWeb && !!prevMp &&
    fingerprint(prevWeb) === fingerprint(data) && fingerprint(prevMp) === fingerprint(data);

  const stagedWeb = join(OPT.dir, "data.js");
  const stagedMp = join(OPT.dir, "oil-data.js");
  writeFileSync(stagedWeb, webOut);
  writeFileSync(stagedMp, mpOut);
  if (OPT.json) {
    writeFileSync(join(OPT.dir, "report.json"), JSON.stringify({
      ok: true, apply: OPT.apply, changed: !unchanged, effectiveFrom: data.effectiveFrom,
      regions: data.regions, adjustments: data.adjustments, crude: data.crude, changes: lines
    }, null, 2));
  }

  if (unchanged) {
    log("\n价格、基准与原油数据均与现有一致，不改动文件。");
    return;
  }
  if (!OPT.apply) {
    log("\n试运行：结果已写到 " + stagedWeb.replace(ROOT + "/", "") + " 与 " + stagedMp.replace(ROOT + "/", "") +
      "，确认后加 --apply 覆盖源文件。");
    return;
  }
  [["web/data.js", webOut], ["miniprogram/utils/oil-data.js", mpOut]].forEach(([rel, out]) => {
    const file = join(ROOT, rel);
    const tmp = file + ".tmp";
    writeFileSync(tmp, out);
    renameSync(tmp, file);
    log("已更新 " + rel);
  });
  log("\n下一步：node --check web/app.js 与小程序冒烟通过后，重新发布站点。");
}

main().catch((e) => {
  console.error("同步失败：" + e.message);
  process.exit(1);
});
