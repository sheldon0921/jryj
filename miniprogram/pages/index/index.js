const O = require("../../utils/oil.js");

Page({
  data: {
    board: {},
    areas: O.AREAS,
    area: "全部",
    q: "",
    cells: [],
    emptyHint: "",
    countdown: { short: "--", full: "--" },
    tank: 50,
    monthKm: 1500,
    l100: 8,
    est: {},
    stale: O.staleText()
  },

  onLoad() {
    this.timer = setInterval(() => {
      this.setData({ countdown: O.countdown() });
    }, 1000);
    this.setData({ countdown: O.countdown() });
  },

  onUnload() {
    clearInterval(this.timer);
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const region = O.findRegion(getApp().globalData.region);
    const d = this.data;
    this.setData({
      board: O.board(region),
      cells: this.buildCells(d.area, d.q),
      emptyHint: "",
      est: O.estimate(region, d.tank, d.monthKm, d.l100)
    });
  },

  buildCells(area, q) {
    const sel = getApp().globalData.region;
    return O.sortRegions(O.filterRegions(area, q), "p92", 1).map((r) => ({
      name: r.name,
      price: O.money(r.p92),
      on: r.name === sel
    }));
  },

  rebuildCells() {
    const cells = this.buildCells(this.data.area, this.data.q);
    this.setData({
      cells,
      emptyHint: cells.length ? "" : "没有匹配的地区，试试“广东”或“华东”。"
    });
  },

  onArea(e) {
    this.setData({ area: e.currentTarget.dataset.a }, () => this.rebuildCells());
  },

  onSearch(e) {
    this.setData({ q: e.detail.value }, () => this.rebuildCells());
  },

  onPick(e) {
    getApp().setRegion(e.currentTarget.dataset.name);
    this.refresh();
  },

  onNum(e) {
    const k = e.currentTarget.dataset.k;
    const raw = parseFloat(e.detail.value);
    const conf = { tank: [5, 200, 50], monthKm: [0, 20000, 1500], l100: [1, 30, 8] }[k];
    let v = isNaN(raw) ? conf[2] : Math.min(Math.max(raw, conf[0]), conf[1]);
    this.setData({ [k]: v }, () => {
      const region = O.findRegion(getApp().globalData.region);
      this.setData({ est: O.estimate(region, this.data.tank, this.data.monthKm, this.data.l100) });
    });
  },

  onShareAppMessage() {
    const b = this.data.board;
    return {
      title: (b.name || "全国") + "今日" + b.cards[0].price + " 元/升 · 92号汽油",
      path: "/pages/index/index"
    };
  }
});
