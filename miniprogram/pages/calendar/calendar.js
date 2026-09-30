const O = require("../../utils/oil.js");

Page({
  data: {
    countdown: { short: "--", full: "--" },
    next: {},
    last: {},
    rows: [],
    totals: {},
    crude: [],
    dateLabel: O.todayCN(),
    effectiveLabel: O.mdLabel(O.DATA.effectiveFrom),
    stale: O.staleText()
  },

  onLoad() {
    const la = O.DATA.lastAdjust;
    this.setData({
      next: { label: O.countdown().label, note: O.DATA.scheduleNote },
      last: {
        label: la.label + " 执行至今",
        tonText: "汽油 +" + la.gasolinePerTon + "、柴油 +" + la.dieselPerTon + " 元/吨",
        perLText:
          "92号 +" + O.money(la.perL["92"]) + " · 95号 +" + O.money(la.perL["95"]) + " · 0号柴油 +" + O.money(la.perL["0"]) + " 元/升"
      },
      rows: O.adjustRows(),
      totals: O.adjustTotals(),
      crude: O.DATA.crude.map((c) => ({
        name: c.name,
        asOf: c.asOf,
        priceText: O.money(c.price),
        unit: c.unit
      })),
      countdown: O.countdown()
    });
    this.timer = setInterval(() => {
      this.setData({ countdown: O.countdown() });
    }, 1000);
  },

  onUnload() {
    clearInterval(this.timer);
  },

  onShareAppMessage() {
    return { title: "下一次油价调整窗口：" + this.data.next.label, path: "/pages/calendar/calendar" };
  }
});
