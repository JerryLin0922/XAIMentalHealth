const vault = require('../../utils/vault.js');
const store = require('../../utils/store.js');
const api = require('../../utils/api.js');

Page({
  data: { loggedIn: false, user: '', base: '', note: '' },
  onShow() {
    const app = getApp();
    this.setData({ loggedIn: vault.isCloudLoggedIn(), user: vault.currentUser() || '', base: api.getBase() });
  },
  onBase(e) { this.setData({ base: e.detail.value }); },
  saveBase() { api.setBase(this.data.base); wx.showToast({ title: '已保存后端地址' }); },
  push() {
    this.setData({ note: '上传中…' });
    vault.push().then(() => this.setData({ note: '已加密上传' })).catch((e) => this.setData({ note: '失败：' + (e.message || '') }));
  },
  pull() {
    this.setData({ note: '恢复中…' });
    vault.pull().then((n) => { this.setData({ note: '已恢复 ' + n + ' 条' }); wx.switchTab({ url: '/pages/dashboard/dashboard' }); })
      .catch((e) => this.setData({ note: '失败：' + (e.message || '') }));
  },
  logout() {
    vault.logout().then(() => { this.setData({ loggedIn: false, user: '' }); wx.showToast({ title: '已退出' }); });
  },
  goLogin() { wx.reLaunch({ url: '/pages/login/login' }); }
});
