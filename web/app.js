(function () {
  var D = window.OIL_DATA;
  var R = D.regions;
  var TZ_OFFSET_MS = 8 * 3600 * 1000;

  function todayCN() {
    var now = new Date(Date.now() + TZ_OFFSET_MS);
    return now.getUTCFullYear() + "年" + (now.getUTCMonth() + 1) + "月" + now.getUTCDate() + "日";
  }

  // 窗口日期均为当日24时，即次日 00:00（+08:00）生效
  function winTs(s) {
    return new Date(s + "T00:00:00+08:00").getTime() + 86400000;
  }
  function mdLabel(s) {
    return parseInt(s.slice(5, 7), 10) + "月" + parseInt(s.slice(8, 10), 10) + "日24时";
  }
  function mdLabelTs(ts) {
    var w = new Date(ts - 1 + TZ_OFFSET_MS);
    return (w.getUTCMonth() + 1) + "月" + w.getUTCDate() + "日24时";
  }
  function nextWindow() {
    var now = Date.now();
    var future = D.schedule
      .map(function (s) { return { s: s, ts: winTs(s) }; })
      .filter(function (x) { return x.ts > now; })
      .sort(function (a, b) { return a.ts - b.ts; });
    if (future.length) return { ts: future[0].ts, label: mdLabel(future[0].s), estimated: false };
    var past = D.schedule.map(winTs).filter(function (t) { return t <= now; }).sort(function (a, b) { return a - b; });
    var t = past[past.length - 1];
    while (t <= Date.now()) t += 14 * 86400000;
    return { ts: t, label: mdLabelTs(t), estimated: true };
  }
  function passedRounds() {
    return D.schedule.filter(function (s) { return s > D.effectiveFrom && winTs(s) <= Date.now(); });
  }
  var NEXT = nextWindow();
  var PASSED = passedRounds();

  var FUELS = [
    { key: "p92", label: "92号汽油" },
    { key: "p95", label: "95号汽油" },
    { key: "p98", label: "98号汽油" },
    { key: "d0", label: "0号柴油" }
  ];
  var AREAS = ["全部", "华北", "东北", "华东", "华中", "华南", "西南", "西北"];

  function stat(key) {
    var vals = R.filter(function (r) { return r[key] != null; });
    var sum = vals.reduce(function (a, r) { return a + r[key]; }, 0);
    var asc = vals.slice().sort(function (a, b) { return a[key] - b[key]; });
    var last = asc[asc.length - 1];
    return {
      avg: sum / vals.length,
      min: asc[0][key], minName: asc[0].name,
      max: last[key], maxName: last.name
    };
  }
  var STATS = {};
  FUELS.forEach(function (f) { STATS[f.key] = stat(f.key); });

  var byFuelAsc = {};
  FUELS.forEach(function (f) {
    byFuelAsc[f.key] = R.slice().sort(function (a, b) {
      if (a[f.key] == null) return 1;
      if (b[f.key] == null) return -1;
      return a[f.key] - b[f.key];
    });
  });

  var state = {
    region: "北京",
    area: "全部",
    q: "",
    sort: { key: "p92", dir: 1 }
  };

  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return v.toFixed(2); };
  var sign = function (v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 2 : d); };

  function visible() {
    var q = state.q.trim();
    return R.filter(function (r) {
      if (state.area !== "全部" && r.area !== state.area) return false;
      if (q && r.name.indexOf(q) === -1 && r.area.indexOf(q) === -1) return false;
      return true;
    });
  }
  function current() {
    var hit = R.filter(function (r) { return r.name === state.region; })[0];
    return hit || R[0];
  }

  /* ---------- region picker ---------- */
  function renderChips() {
    var box = $("area-chips");
    box.innerHTML = "";
    AREAS.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = a;
      b.setAttribute("aria-pressed", String(a === state.area));
      b.addEventListener("click", function () {
        state.area = a;
        renderChips();
        renderList();
        renderTable();
      });
      box.appendChild(b);
    });
  }

  function renderList() {
    var list = $("region-list");
    list.innerHTML = "";
    var items = visible().slice().sort(function (a, b) { return a.p92 - b.p92; });
    if (!items.length) {
      var li0 = document.createElement("li");
      li0.className = "empty-hint";
      li0.textContent = "没有匹配的地区，试试“广东”或“华东”。";
      list.appendChild(li0);
      return;
    }
    items.forEach(function (r) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rbtn";
      b.setAttribute("aria-current", String(r.name === state.region));
      b.innerHTML = "<span>" + r.name + "</span><small>" + money(r.p92) + "</small>";
      b.addEventListener("click", function () {
        state.region = r.name;
        renderList();
        renderPanel();
        renderCalc();
        renderTable();
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  /* ---------- price board ---------- */
  function renderPanel() {
    var r = current();
    $("region-name").textContent = r.name;
    $("region-area").textContent = r.area;
    $("panel-updated").textContent = "现行价 · 自 " + mdLabel(D.effectiveFrom) + " 执行";

    var grid = $("price-grid");
    grid.innerHTML = "";
    FUELS.forEach(function (f) {
      var s = document.createElement("div");
      s.className = "pcard" + (f.key === "p92" ? " is-focus" : "");
      var v = r[f.key];
      if (v == null) s.classList.add("na");
      s.innerHTML =
        '<p class="label">' + f.label + '</p>' +
        '<p class="val">' + (v == null ? "当地不供应" : money(v)) + '</p>' +
        '<p class="unit">' + (v == null ? "" : "元/升") + '</p>';
      grid.appendChild(s);
    });

    var d92 = r.p92 - STATS.p92.avg;
    var d95 = r.p95 - STATS.p95.avg;
    var cls = function (v) { return v > 0.004 ? "delta-up" : v < -0.004 ? "delta-down" : "delta-eq"; };
    $("delta-line").innerHTML =
      "92号比全国均价 <b class='" + cls(d92) + "'>" + sign(d92) + "</b> 元/升 · 95号 <b class='" + cls(d95) + "'>" + sign(d95) + "</b>";

    var order = byFuelAsc.p92;
    var rank = order.indexOf(r) + 1;
    var cheapest = order[0], dearest = order[order.length - 1];
    $("rank-line").innerHTML =
      "<span class='badge'>92号 全国第 " + rank + " 便宜 / " + order.length + "</span> " +
      "最低 " + cheapest.name + " " + money(cheapest.p92) + " · 最高 " + dearest.name + " " + money(dearest.p92) +
      " · 相差 " + money(dearest.p92 - cheapest.p92) + " 元";
  }

  /* ---------- calculator ---------- */
  function renderCalc() {
    var r = current();
    $("calc-region").innerHTML = "按 <b>" + r.name + "</b> " + todayCN() + " 油价计算";
    var tank = clampNum($("tank-size"), 50);
    var km = clampNum($("month-km"), 1500);
    var lc = clampNum($("consume"), 8);
    var box = $("calc-out");
    box.innerHTML = "";

    FUELS.slice(0, 3).forEach(function (f) {
      var d = document.createElement("div");
      d.className = "crow";
      d.innerHTML =
        '<p class="k">加满一箱 ' + f.label + '</p>' +
        '<p class="v num">' + (r[f.key] == null ? "—" : "¥" + (r[f.key] * tank).toFixed(0)) + '</p>' +
        '<p class="s">' + tank + " 升 × " + (r[f.key] == null ? "—" : money(r[f.key])) + " 元/升</p>";
      box.appendChild(d);
    });

    var liters = km / 100 * lc;
    var m92 = r.p92 * liters;
    var d = document.createElement("div");
    d.className = "crow month";
    d.innerHTML =
      '<p class="k">每月油费（92号）</p>' +
      '<p class="v num">¥' + m92.toFixed(0) + '</p>' +
      '<p class="s">' + km + " km × " + lc + " L/100km ≈ " + liters.toFixed(1) + " 升 · 全年约 ¥" + (m92 * 12).toFixed(0) + "</p>";
    box.appendChild(d);

    var gapMonth = (STATS.p92.avg - r.p92) * liters;
    var s = document.createElement("div");
    s.className = "crow";
    s.innerHTML =
      '<p class="k">与全国均价相比（每月）</p>' +
      '<p class="v num ' + (gapMonth >= 0 ? "lo" : "hi") + '">' + (gapMonth >= 0 ? "省 ¥" + gapMonth.toFixed(0) : "多花 ¥" + Math.abs(gapMonth).toFixed(0)) + '</p>' +
      '<p class="s">全国92号均价 ' + money(STATS.p92.avg) + " 元/升 · 当地 " + money(r.p92) + "</p>";
    box.appendChild(s);
  }

  function clampNum(input, fallback) {
    var v = parseFloat(input.value);
    if (isNaN(v)) return fallback;
    var lo = parseFloat(input.min), hi = parseFloat(input.max);
    if (!isNaN(lo) && v < lo) return lo;
    if (!isNaN(hi) && v > hi) return hi;
    return v;
  }

  /* ---------- comparison table ---------- */
  function renderTable() {
    var rows = visible().slice();
    var k = state.sort.key;
    rows.sort(function (a, b) {
      if (k === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      if (a[k] == null) return 1;
      if (b[k] == null) return -1;
      return (a[k] - b[k]) * state.sort.dir;
    });

    var body = $("cmp-body");
    body.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.name === state.region) tr.className = "sel";
      var diff = r.p92 - STATS.p92.avg;
      var cells = FUELS.map(function (f) {
        var v = r[f.key];
        var c = "";
        if (v != null) {
          if (v === STATS[f.key].min) c = " lo";
          else if (v === STATS[f.key].max) c = " hi";
        }
        return "<td class='num" + c + "'>" + (v == null ? "—" : money(v)) + "</td>";
      }).join("");
      tr.innerHTML =
        "<td>" + r.name + "</td>" + cells +
        "<td class='num delta-" + (diff > 0 ? "up" : diff < 0 ? "down" : "eq") + "'>" + sign(diff) + "</td>";
      tr.tabIndex = 0;
      tr.addEventListener("click", function () { select(r.name); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(r.name); }
      });
      body.appendChild(tr);
    });

    var NAME = { name: "地区", p92: "92号汽油", p95: "95号汽油", p98: "98号汽油", d0: "0号柴油" };
    document.querySelectorAll(".sortbtn").forEach(function (b) {
      var key = b.getAttribute("data-key");
      var on = key === k;
      var asc = on && state.sort.dir > 0;
      b.querySelector(".sort-ind").textContent = on ? (asc ? "▲" : "▼") : "";
      b.setAttribute("aria-label", "按" + NAME[key] + (asc ? "降序" : "升序") + "排序");
    });
  }

  function select(name) {
    state.region = name;
    renderList();
    renderPanel();
    renderCalc();
    renderTable();
    $("region-list").scrollTop = 0;
  }

  /* ---------- 2026 adjustment chart ---------- */
  function renderChart() {
    var a = D.adjustments;
    var lastDate = lastAdjustDateLabel();
    var padL = 30, slot = 26, plotTop = 14, plotH = 132, padR = 6;
    var W = padL + a.length * slot + padR;
    var H = plotTop + plotH + 34;
    var zeroY = plotTop + plotH / 2;
    var perPx = 1200 / (plotH / 2); // 元/吨 per pixel

    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="2026年成品油调价幅度柱状图，汽油每吨涨跌">'];
    [1200, 600, 0, -600, -1200].forEach(function (t) {
      var y = zeroY - t / perPx;
      svg.push("<line class='" + (t === 0 ? "axis" : "grid-line") + "' x1='" + padL + "' y1='" + y + "' x2='" + (W - padR) + "' y2='" + y + "'/>");
      svg.push("<text class='tick-txt' x='" + (padL - 4) + "' y='" + (y + 3) + "' text-anchor='end'>" + t + "</text>");
    });

    var cum = 0, cumPts = [];
    a.forEach(function (it, i) {
      cum += it.perL92;
      cumPts.push({ x: padL + i * slot + slot / 2, y: zeroY - cum * (plotH / 2) / 2.0, v: cum, item: it });
    });
    svg.push("<path fill='none' stroke='#c98a00' stroke-width='1.6' stroke-dasharray='4 3' d='M" +
      cumPts.map(function (p) { return p.x + "," + p.y; }).join(" L") + "'/>");

    a.forEach(function (it, i) {
      var x = padL + i * slot + slot / 2;
      var h = Math.max(Math.abs(it.gasoline) / perPx, it.gasoline === 0 ? 2 : 2);
      var y = it.gasoline >= 0 ? zeroY - h : zeroY;
      var cls = it.gasoline > 0 ? "bar-up" : it.gasoline < 0 ? "bar-down" : "bar-hold";
      svg.push("<g class='bar' data-i='" + i + "'><rect class='" + cls + "' x='" + (x - 7) + "' y='" + y + "' width='14' height='" + h + "' rx='1.5'/>" +
        "<rect class='bar-hit' x='" + (x - slot / 2) + "' y='" + plotTop + "' width='" + slot + "' height='" + plotH + "'/>" +
        "<title>" + it.date + " 汽油 " + (it.hold ? "不作调整" : sign(it.gasoline, 0) + " 元/吨") + "</title></g>");
      var hot = it.date === lastDate;
      svg.push("<text class='x-txt" + (hot ? " hot" : "") + "' x='" + x + "' y='" + (plotTop + plotH + (i % 2 ? 24 : 13)) + "' text-anchor='middle'>" +
        it.date.replace("日", "") + "</text>");
    });
    svg.push("<text class='tick-txt' x='" + (W - padR) + "' y='" + (cumPts[cumPts.length - 1].y - 6) + "' text-anchor='end'>累计 +1.82 元/升</text>");
    svg.push("</svg>");

    var host = $("chart");
    host.innerHTML = svg.join("");
    var read = $("chart-read");
    var base = "柱形为每次窗口的汽油调整幅度（元/吨），虚线为92号汽油每升累计涨幅。悬停或点击查看单轮明细。";
    read.textContent = base;
    host.querySelectorAll(".bar").forEach(function (g) {
      function show() {
        var it = a[+g.getAttribute("data-i")];
        read.textContent = it.date + "：" + (it.hold ? "按机制不作调整" :
          "汽油 " + sign(it.gasoline, 0) + " 元/吨、柴油 " + sign(it.diesel, 0) + " 元/吨，92号每升 " + sign(it.perL92) + " 元");
      }
      g.addEventListener("mouseenter", show);
      g.addEventListener("click", show);
      g.addEventListener("focus", show);
    });
  }

  function renderCal() {
    var ul = $("adjust-cal");
    ul.innerHTML = "";
    var lastDate = lastAdjustDateLabel();
    D.adjustments.slice().reverse().forEach(function (it) {
      var li = document.createElement("li");
      var isLast = it.date === lastDate;
      if (isLast) li.className = "hot";
      li.innerHTML = "<span class='d'>" + it.date + (isLast ? "（最近一次）" : "") + "</span>" +
        "<span class='a " + (it.gasoline > 0 ? "hi" : it.gasoline < 0 ? "lo" : "") + "'>" +
        (it.hold ? "不调" : sign(it.gasoline, 0) + " 元/吨") + "</span>";
      ul.appendChild(li);
    });
  }

  /* ---------- adjustment window countdown ---------- */
  function renderWindow() {
    var la = D.lastAdjust;
    $("last-adjust").textContent = la.label + " 上调";
    $("last-adjust-detail").textContent =
      "汽油 +" + la.gasolinePerTon + " 元/吨、柴油 +" + la.dieselPerTon + " 元/吨；92号 +" + money(la.perL["92"]) +
      "、95号 +" + money(la.perL["95"]) + "、0号柴油 +" + money(la.perL["0"]) + " 元/升";
    $("next-window").textContent = NEXT.label + (NEXT.estimated ? "（按 14 天节奏推算）" : "");
    $("window-note").textContent = D.scheduleNote;
    var passed = passedRounds();
    $("stale-note").textContent = passed.length
      ? "注：发改委已公布 " + passed.map(mdLabel).join("、") + " 的调价窗口，本站尚未收录该轮幅度，页面价格与走势仍以 " +
        mdLabel(D.effectiveFrom) + " 那轮为基准。"
      : "";

    var list = $("crude-list");
    list.innerHTML = "";
    D.crude.forEach(function (c) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + c.name + "<br><span class='as'>" + c.asOf + "</span></span>" +
        "<span class='n'>" + money(c.price) + "<span class='as'> " + c.unit + "</span></span>";
      list.appendChild(li);
    });
  }

  function tick() {
    var ms = NEXT.ts - Date.now();
    if (ms <= 0) {
      NEXT = nextWindow();
      $("next-window").textContent = NEXT.label + (NEXT.estimated ? "（按 10 个工作日推算）" : "");
      return;
    }
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    $("top-countdown").textContent = d + " 天后";
    $("next-clock").textContent = d + " 天 " + pad(h) + ":" + pad(m) + ":" + pad(sec);
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function lastAdjustDateLabel() {
    var la = D.lastAdjust.date;
    return parseInt(la.slice(5, 7), 10) + "月" + parseInt(la.slice(8, 10), 10) + "日";
  }

  /* ---------- wiring ---------- */
  $("stamp-date").textContent = todayCN();
  $("foot-date").textContent = todayCN();
  $("foot-effective").textContent = mdLabel(D.effectiveFrom);
  $("region-search").addEventListener("input", function (e) {
    state.q = e.target.value;
    renderList();
    renderTable();
  });
  document.querySelectorAll(".sortbtn").forEach(function (b) {
    b.addEventListener("click", function () {
      var k = b.getAttribute("data-key");
      if (state.sort.key === k) state.sort.dir *= -1;
      else state.sort = { key: k, dir: k === "name" ? 1 : 1 };
      renderTable();
    });
  });
  ["tank-size", "month-km", "consume"].forEach(function (id) {
    $(id).addEventListener("input", renderCalc);
  });

  if (!current()) state.region = R[0].name;
  renderChips();
  renderList();
  renderPanel();
  renderCalc();
  renderTable();
  renderChart();
  renderCal();
  renderWindow();
  tick();
  setInterval(tick, 1000);
})();
