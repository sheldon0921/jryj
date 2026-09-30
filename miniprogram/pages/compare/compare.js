const O = require("../../utils/oil.js");

const COLS = [
  { key: "p92", label: "92号" },
  { key: "p95", label: "95号" },
  { key: "p98", label: "98号" },
  { key: "d0", label: "0#柴油" }
];

Page({
  data: {
    cols: COLS,
    sortKey: "p92",
    dir: 1,
    rows: [],
    area: "全部",
    areas: O.AREAS,
    q: "",
    emptyHint: "",
    dateLabel: O.todayCN(),
    effectiveLabel: O.mdLabel(O.DATA.effectiveFrom),
    count: 0
  },

  onShow() {
    this.refresh();
  },

  onArea(e) {
    this.setData({ area: e.currentTarget.dataset.a }, () => this.refresh());
  },

  onSearch(e) {
    this.setData({ q: e.detail.value }, () => this.refresh());
  },

  onSort(e) {
    const key = e.currentTarget.dataset.k;
    if (key === this.data.sortKey) {
      this.setData({ dir: -this.data.dir }, () => this.refresh());
    } else {
      this.setData({ sortKey: key, dir: 1 }, () => this.refresh());
    }
  },

  onPick(e) {
    const name = e.currentTarget.dataset.name;
    getApp().setRegion(name);
    wx.switchTab({ url: "/pages/index/index" });
  },

  refresh() {
    const d = this.data;
    const sel = getApp().globalData.region;
    const list = O.sortRegions(O.filterRegions(d.area, d.q), d.sortKey, d.dir);

    const rows = list.map((r) => {
      const out = {
        name: r.name,
        area: r.area,
        on: r.name === sel,
        rank: O.rankOf(r.name, "p92")
      };
      COLS.forEach((c) => {
        const v = r[c.key];
        const st = O.STATS[c.key];
        let cls = "";
        if (v === st.min) cls = "lo";
        else if (v === st.max) cls = "hi";
        out[c.key + "V"] = O.money(v);
        out[c.key + "C"] = cls;
      });
      const diff = r.p92 - O.STATS.p92.avg;
      out.diffV = O.signText(diff);
      out.diffC = diff > 0.004 ? "hi" : diff < -0.004 ? "lo" : "";
      return out;
    });

    this.setData({
      rows,
      count: rows.length,
      emptyHint: rows.length ? "" : "没有匹配的地区，换个关键词试试。"
    });
  }
});
