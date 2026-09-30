const KEY = "oil-region";

App({
  globalData: {
    region: "北京"
  },
  onLaunch() {
    const saved = wx.getStorageSync(KEY);
    if (saved) this.globalData.region = saved;
  },
  setRegion(name) {
    this.globalData.region = name;
    wx.setStorageSync(KEY, name);
  }
});
