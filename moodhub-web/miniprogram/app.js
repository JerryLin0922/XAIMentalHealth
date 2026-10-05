// 小程序入口：与 Web 端同一套内核（MH.*），云端同步沿用 utils/vault.js
const vault = require('./utils/vault.js');

App({
  globalData: {
    // 后端地址：Cloudflare Worker 或 Pages Functions 的 /api 基址
    apiBase: 'https://your-moodhub-api.workers.dev',
    cloudUser: null,
    cloudLoggedIn: false
  },
  onLaunch() {
    const saved = wx.getStorageSync('moodhub.apiBase');
    if (saved) this.globalData.apiBase = saved;

    const s = wx.getStorageSync('moodhub.cloud') || {};
    this.globalData.cloudUser = s.username || null;
    this.globalData.cloudLoggedIn = !!s.loggedIn;
  }
});
