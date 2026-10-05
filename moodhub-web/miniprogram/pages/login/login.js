// 登录页：云端同步是可选项，本地优先 —— 不登录也能完整使用看板 / 记录 / 陪伴 / 问答
const vault = require('../../utils/vault.js');

Page({
  data: { username: '', password: '', err: '', busy: false, localOnly: false },

  onInput(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },

  goDashboard() { wx.switchTab({ url: '/pages/dashboard/dashboard' }); },

  localOnly() {
    this.setData({ localOnly: true });
    this.goDashboard();
  },

  doRegister() {
    const { username, password } = this.data;
    if (username.length < 2) return this.setData({ err: '用户名至少 2 字' });
    if (password.length < 6) return this.setData({ err: '云端密码至少 6 位' });
    this.setData({ busy: true, err: '' });
    vault.register(username, password)
      .then(() => { wx.showToast({ title: '已启用并上传' }); this.goDashboard(); })
      .catch((e) => this.setData({ busy: false, err: (e && e.message) || '注册失败' }));
  },

  doLogin() {
    const { username, password } = this.data;
    if (!username || !password) return this.setData({ err: '请输入用户名与密码' });
    this.setData({ busy: true, err: '' });
    vault.login(username, password)
      .then(() => { wx.showToast({ title: '登录成功' }); this.goDashboard(); })
      .catch((e) => this.setData({ busy: false, err: (e && e.message) || '登录失败' }));
  }
});
