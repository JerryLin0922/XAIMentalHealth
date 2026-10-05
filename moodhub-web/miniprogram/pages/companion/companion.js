// 陪伴（树洞）：完全复用 Web 端 local-service.js 规则引擎，页内运行、无网络出口
const MH = require('../../utils/mh.js');

Page({
  data: {
    list: [],
    input: '',
    sending: false,
    showPayload: false,
    lastPayload: null
  },
  onShow() { this.refresh(); },

  refresh() {
    this.setData({ list: MH.store.chat.all() });
    const last = this.data.list.filter((m) => m.role === 'me' && m.payload).pop();
    this.setData({ lastPayload: last ? last.payload : null });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  togglePayload() { this.setData({ showPayload: !this.data.showPayload }); },

  send() {
    const text = this.data.input.trim();
    if (!text || this.data.sending) return;
    this.setData({ sending: true, input: '' });

    const summary = MH.stats.summary14(MH.store.records.all());
    const payload = { message: text, summary };

    // 把「本次发送给本地服务的内容」随消息一起存下，供自查
    MH.store.chat.append({ role: 'me', text, payload });
    this.setData({ list: MH.store.chat.all() });

    MH.localService.generateReply(payload).then((res) => {
      MH.store.chat.append({ role: 'ai', text: res.text, tags: res.tags, payload: null });
      this.setData({ sending: false, list: MH.store.chat.all() });
      this.refresh();
      if (res.crisis) wx.showToast({ title: '已显示求助资源', icon: 'none', duration: 3000 });
    }).catch(() => {
      this.setData({ sending: false });
      MH.util.toast('本地服务暂时不可用');
    });
  },

  clear() {
    wx.showModal({
      title: '清空对话',
      content: '清空本机保存的全部对话记录？此操作无法撤销。',
      confirmColor: '#b3474a',
      success: (r) => {
        if (r.confirm) { MH.store.chat.clear(); this.refresh(); }
      }
    });
  },

  copyPayload() {
    if (!this.data.lastPayload) return;
    wx.setClipboardData({ data: JSON.stringify(this.data.lastPayload, null, 2) });
  }
});
