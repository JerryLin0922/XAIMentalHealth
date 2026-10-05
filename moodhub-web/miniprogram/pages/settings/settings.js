// 设置：云同步沿用 utils/vault.js；本地数据统计与备份复用 Web 端 store.js
const MH = require('../../utils/mh.js');
const vault = require('../../utils/vault.js');
const api = require('../../utils/api.js');

Page({
  data: {
    loggedIn: false, user: '', base: '', note: '',
    counts: { records: 0, chat: 0, qa: 0 },
    usage: '0 KB',
    storageInfo: '',
    sources: 0
  },
  onShow() { this.refresh(); },

  refresh() {
    const usage = MH.store.storageUsage();
    const recs = MH.store.records.all();
    this.setData({
      loggedIn: vault.isCloudLoggedIn(),
      user: vault.currentUser() || '',
      base: api.getBase(),
      counts: { records: recs.length, chat: MH.store.chat.all().length, qa: MH.store.qa.all().length },
      sources: MH.store.sources.persistedChars(),
      usage: usage > 1024 ? (usage / 1024).toFixed(1) + ' KB' : usage + ' B',
      storageInfo: wx.getStorageInfoSync().limitSize
        ? '微信存储上限 ' + (wx.getStorageInfoSync().limitSize / 1024).toFixed(0) + ' KB'
        : ''
    });
  },

  /* ---------------- 后端地址 ---------------- */
  onBase(e) { this.setData({ base: e.detail.value }); },
  saveBase() { api.setBase(this.data.base); MH.util.toast('已保存后端地址'); },

  /* ---------------- 云同步 ---------------- */
  goLogin() { wx.reLaunch({ url: '/pages/login/login' }); },
  push() {
    this.setData({ note: '上传中…' });
    vault.push().then(() => this.setData({ note: '已加密上传' }))
      .catch((e) => this.setData({ note: '失败：' + (e.message || '') }));
  },
  pull() {
    this.setData({ note: '恢复中…' });
    vault.pull().then((n) => { this.setData({ note: '已恢复 ' + n + ' 条' }); this.refresh(); })
      .catch((e) => this.setData({ note: '失败：' + (e.message || '') }));
  },
  logout() {
    vault.logout().then(() => { this.setData({ loggedIn: false, user: '' }); MH.util.toast('已退出'); });
  },

  /* ---------------- 本机数据 ---------------- */
  exportBackup() {
    const payload = MH.store.exportAll();
    const text = JSON.stringify(payload, null, 2);
    const path = `${wx.env.USER_DATA_PATH}/moodhub-backup-${MH.util.todayISO()}.json`;
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: text,
      encoding: 'utf8',
      success: () => wx.shareFileMessage({
        filePath: path,
        fileName: path.split('/').pop(),
        fail: () => MH.util.toast('已生成备份，可在弹窗中保存')
      }),
      fail: () => MH.util.toast('导出失败')
    });
  },
  clearSources() {
    wx.showModal({
      title: '清空问答来源',
      content: '只清除上传的问答来源，不影响心情记录。',
      success: (r) => { if (r.confirm) { MH.store.sources.clear(); this.refresh(); } }
    });
  },
  clearChat() {
    wx.showModal({
      title: '清空对话',
      content: '清空本机保存的全部对话记录？此操作无法撤销。',
      confirmColor: '#b3474a',
      success: (r) => { if (r.confirm) { MH.store.chat.clear(); MH.store.qa.clear(); this.refresh(); } }
    });
  },
  wipeAll() {
    wx.showModal({
      title: '清空全部数据',
      content: '本机的记录、对话、问答历史与账户都会被删除，且无法恢复。',
      confirmColor: '#b3474a',
      success: (r) => {
        if (!r.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '真的要清空吗？此操作不可撤销。',
          confirmColor: '#b3474a',
          success: (r2) => {
            if (r2.confirm) { MH.store.wipeEverything(); this.refresh(); MH.util.toast('已清空'); }
          }
        });
      }
    });
  }
});
