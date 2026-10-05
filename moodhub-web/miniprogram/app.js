const vault = require('./utils/vault.js');

App({
  globalData: {
    // 后端地址：Cloudflare Worker 或 Pages Functions 的 /api 基址
    apiBase: 'https://your-moodhub-api.workers.dev',
    cloudUser: null,
    cloudLoggedIn: false
  },
  onLaunch() {
    const s = wx.getStorageSync('moodhub.cloud') || {};
    this.globalData.cloudUser = s.username || null;
    this.globalData.cloudLoggedIn = !!s.loggedIn;
  }
});
