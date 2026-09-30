const D = require("./oil-data.js");

const FUELS = [
  { key: "p92", label: "92号汽油", short: "92#" },
  { key: "p95", label: "95号汽油", short: "95#" },
  { key: "p98", label: "98号汽油", short: "98#" },
  { key: "d0", label: "0号柴油", short: "0#柴油" }
];
const AREAS = ["全部", "华北", "东北", "华东", "华中", "华南", "西南", "西北"];

const TZ_MS = 8 * 3600 * 1000;

function todayCN() {
  const d = new Date(Date.now() + TZ_MS);
  return d.getUTCFullYear() + "年" + (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日";
}
// 窗口日期均为当日24时，即次日 00:00（+08:00）生效
function winTs(s) {
  return new Date(s + "T00:00:00+08:00").getTime() + 86400000;
}
function mdLabel(s) {
  return parseInt(s.slice(5, 7), 10) + "月" + parseInt(s.slice(8, 10), 10) + "日24时";
}
function mdLabelTs(ts) {
  const w = new Date(ts - 1 + TZ_MS);
  return w.getUTCMonth() + 1 + "月" + w.getUTCDate() + "日24时";
}
function nextWindow() {
  const now = Date.now();
  const future = D.schedule
    .map(function (s) { return { s: s, ts: winTs(s) }; })
    .filter(function (x) { return x.ts > now; })
    .sort(function (a, b) { return a.ts - b.ts; });
  if (future.length) return { ts: future[0].ts, label: mdLabel(future[0].s), estimated: false };
  const past = D.schedule.map(winTs).filter(function (t) { return t <= now; }).sort(function (a, b) { return a - b; });
  let t = past[past.length - 1];
  while (t <= Date.now()) t += 14 * 86400000;
  return { ts: t, label: mdLabelTs(t), estimated: true };
}
function passedRounds() {
  return D.schedule.filter(function (s) {
    return s > D.effectiveFrom && winTs(s) <= Date.now();
  });
}

function money(v) {
  return v == null ? "—" : v.toFixed(2);
}
function signText(v, d) {
  const dp = d == null ? 2 : d;
  const body = Math.abs(v).toFixed(dp);
  if (v > 0) return "+" + body;
  if (v < 0) return "−" + body;
  return "±" + body;
}
function tonText(v) {
  return v === 0 ? "不调" : (v > 0 ? "+" : "−") + Math.abs(v) + " 元/吨";
}

const STATS = {};
const ASC = {};
FUELS.forEach(function (f) {
  const known = D.regions.filter(function (r) {
    return r[f.key] != null;
  });
  const list = known.slice().sort(function (a, b) {
    return a[f.key] - b[f.key];
  });
  const sum = list.reduce(function (acc, r) {
    return acc + r[f.key];
  }, 0);
  // 不供应该油品的地区排在末尾，比较页仍会列出但参与不了均价
  ASC[f.key] = list.concat(D.regions.filter(function (r) {
    return r[f.key] == null;
  }));
  STATS[f.key] = {
    avg: sum / list.length,
    min: list[0][f.key],
    minName: list[0].name,
    max: list[list.length - 1][f.key],
    maxName: list[list.length - 1].name
  };
});

function findRegion(name) {
  const hit = D.regions.filter(function (r) {
    return r.name === name;
  })[0];
  return hit || D.regions[0];
}

function filterRegions(area, q) {
  const kw = (q || "").trim();
  return D.regions.filter(function (r) {
    if (area && area !== "全部" && r.area !== area) return false;
    if (kw && r.name.indexOf(kw) === -1 && r.area.indexOf(kw) === -1) return false;
    return true;
  });
}

function sortRegions(list, key, dir) {
  const out = list.slice();
  out.sort(function (a, b) {
    if (key === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
    if (a[key] == null && b[key] == null) return 0;
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return (a[key] - b[key]) * (dir || 1);
  });
  return out;
}

function rankOf(name, key) {
  const order = ASC[key || "p92"];
  for (let i = 0; i < order.length; i++) {
    if (order[i].name === name) return i + 1;
  }
  return 1;
}

function countdown() {
  const nx = nextWindow();
  const ms = nx.ts - Date.now();
  const label = nx.label + (nx.estimated ? "（推算）" : "");
  if (ms <= 0) {
    return { done: true, days: 0, short: "已到窗口", full: "调价已生效，等待新周期", label: label };
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  return {
    done: false,
    days: d,
    short: d + " 天后",
    full: d + " 天 " + pad(h) + ":" + pad(m) + ":" + pad(sec),
    label: label
  };
}

function staleText() {
  const passed = passedRounds();
  return passed.length
    ? "注：已过去 " + passed.map(mdLabel).join("、") + " 调价窗口，本页尚未收录该轮幅度，价格与轨迹仍以 " +
      mdLabel(D.effectiveFrom) + " 那轮为基准。"
    : "";
}

function fuelCards(region) {
  return FUELS.map(function (f) {
    const v = region[f.key];
    const diff = v - STATS[f.key].avg;
    return {
      key: f.key,
      label: f.label,
      price: money(v),
      deltaText: v == null ? "当地不供应" : "比均价 " + signText(diff),
      deltaCls: v == null ? "" : diff > 0.004 ? "hi" : diff < -0.004 ? "lo" : "",
      focus: f.key === "p92"
    };
  });
}

function board(region) {
  const diff92 = region.p92 - STATS.p92.avg;
  const diff95 = region.p95 - STATS.p95.avg;
  const cheap = ASC.p92[0];
  const dear = ASC.p92[ASC.p92.length - 1];
  return {
    name: region.name,
    area: region.area,
    cards: fuelCards(region),
    delta92: signText(diff92),
    delta92Cls: diff92 > 0.004 ? "hi" : diff92 < -0.004 ? "lo" : "",
    delta95: signText(diff95),
    delta95Cls: diff95 > 0.004 ? "hi" : diff95 < -0.004 ? "lo" : "",
    rankText: "92号 全国第 " + rankOf(region.name, "p92") + " 便宜 / " + D.regions.length,
    avg92: money(STATS.p92.avg),
    dateLabel: todayCN(),
    effectiveLabel: mdLabel(D.effectiveFrom),
    spreadText: "最低 " + cheap.name + " " + money(cheap.p92) + " · 最高 " + dear.name + " " + money(dear.p92)
  };
}

function estimate(region, tank, monthKm, lPer100) {
  const liters = (monthKm / 100) * lPer100;
  const monthly = region.p92 * liters;
  const vsAvg = (STATS.p92.avg - region.p92) * liters;
  return {
    fills: FUELS.slice(0, 3).map(function (f) {
      return {
        key: f.key,
        label: "加满 " + f.short,
        value: "¥" + Math.round(region[f.key] * tank),
        sub: tank + "升 × " + money(region[f.key])
      };
    }),
    monthlyText: "¥" + Math.round(monthly),
    liters: Math.round(liters * 10) / 10,
    yearlyText: "¥" + Math.round(monthly * 12),
    saveText: vsAvg >= 0 ? "省 ¥" + Math.round(vsAvg) : "多花 ¥" + Math.round(Math.abs(vsAvg)),
    saveCls: vsAvg >= 0 ? "lo" : "hi"
  };
}

function adjustRows() {
  const lastDate = (function () {
    const la = D.lastAdjust.date;
    return parseInt(la.slice(5, 7), 10) + "月" + parseInt(la.slice(8, 10), 10) + "日";
  })();
  return D.adjustments
    .slice()
    .reverse()
    .map(function (it) {
      const pct = Math.min(Math.abs(it.gasoline) / 1200, 1) * 100;
      return {
        date: it.date,
        isLast: it.date === lastDate,
        tonText: tonText(it.gasoline),
        perLText: it.hold ? "—": signText(it.perL92),
        cls: it.gasoline > 0 ? "up" : it.gasoline < 0 ? "down" : "hold",
        wl: it.gasoline < 0 ? pct : 0,
        wr: it.gasoline > 0 ? pct : 0
      };
    });
}

function adjustTotals() {
  const g = D.adjustments.reduce(function (a, b) {
    return a + b.gasoline;
  }, 0);
  const perL = D.adjustments.reduce(function (a, b) {
    return a + b.perL92;
  }, 0);
  return {
    rounds: D.adjustments.length,
    tonText: (g >= 0 ? "+" : "−") + Math.abs(g),
    perLText: signText(perL)
  };
}

module.exports = {
  DATA: D,
  FUELS: FUELS,
  AREAS: AREAS,
  STATS: STATS,
  ASC: ASC,
  money: money,
  signText: signText,
  tonText: tonText,
  todayCN: todayCN,
  mdLabel: mdLabel,
  nextWindow: nextWindow,
  staleText: staleText,
  findRegion: findRegion,
  filterRegions: filterRegions,
  sortRegions: sortRegions,
  rankOf: rankOf,
  countdown: countdown,
  board: board,
  estimate: estimate,
  adjustRows: adjustRows,
  adjustTotals: adjustTotals
};
