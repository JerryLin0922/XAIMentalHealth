// 问答：BM25 检索 + 数值分析全部来自 Web 端 qa.js / retriever.js / ingest.js
// 文件选择用 wx.chooseMessageFile，读取用 FileSystemManager（浏览器里对应 FileReader）
const MH = require('../../utils/mh.js');

Page({
  data: {
    sources: [],
    selection: { health: true, files: [] },
    question: '',
    answer: null,
    busy: false,
    showContext: false
  },
  onShow() { this.refresh(); },

  refresh() {
    const saved = MH.store.sources.all().filter((s) => s.persist);
    this.setData({ sources: saved.map((s) => ({ id: s.id, name: s.name, kind: s.kind, size: s.size })) });
  },

  /* ---------------- 文件来源 ---------------- */

  pickFile() {
    wx.chooseMessageFile({
      count: 3,
      type: 'file',
      extension: ['csv', 'tsv', 'json', 'txt', 'md', 'log'],
      success: (res) => this.readFiles(res.tempFiles),
      fail: () => MH.util.toast('未选择文件')
    });
  },

  readFiles(files) {
    const fsm = wx.getFileSystemManager();
    (files || []).forEach((f) => {
      if (f.size > MH.ingest.MAX_FILE_BYTES) {
        MH.util.toast(f.name + ' 超过 24 MB，请先精简');
        return;
      }
      fsm.readFile({
        filePath: f.path,
        encoding: 'utf8',
        success: (r) => this.addSource(f.name, String(r.data)),
        fail: () => MH.util.toast('读取失败：' + f.name)
      });
    });
  },

  addSource(name, text) {
    const parsed = MH.ingest.parse(name, text);
    try {
      // persist: true 走内核的 600k 字符预算校验
      MH.store.sources.add({
        name,
        kind: parsed.kind,
        size: text.length,
        persist: true,
        text: parsed.text,
        rows: parsed.rows,
        fields: parsed.fields,
        stats: parsed.stats
      });
      this.refresh();
      MH.util.toast('已添加来源：' + name);
    } catch (e) {
      MH.util.toast(e.message || '保存来源失败');
    }
  },

  removeSource(e) {
    MH.store.sources.remove(e.currentTarget.dataset.id);
    this.refresh();
  },

  toggleHealth() { this.setData({ 'selection.health': !this.data.selection.health }); },
  toggleSource(e) {
    const id = e.currentTarget.dataset.id;
    const files = this.data.selection.files.slice();
    const i = files.indexOf(id);
    if (i >= 0) files.splice(i, 1); else files.push(id);
    this.setData({ 'selection.files': files });
  },

  /* ---------------- 提问 ---------------- */

  onQuestion(e) { this.setData({ question: e.detail.value }); },
  toggleContext() { this.setData({ showContext: !this.data.showContext }); },

  ask() {
    if (this.data.busy) return;
    const q = this.data.question.trim();
    if (!q) { MH.util.toast('请先写下你的问题'); return; }

    this.setData({ busy: true, answer: null });
    MH.qa.ask({
      question: q,
      sources: MH.store.sources.all(),
      records: MH.store.records.all(),
      selection: this.data.selection
    }).then((res) => {
      this.setData({ busy: false, answer: res });
      MH.store.qa.append({
        question: q,
        answer: res.answer,
        mode: res.mode,
        usedSources: res.usedSources || [],
        citations: res.citations || []
      });
      if (res.crisis) wx.vibrateShort({ type: 'medium' });
      return summary;
    }).catch((e) => {
      this.setData({ busy: false });
      MH.util.toast((e && e.message) || '回答失败');
    });
  },

  copyAnswer() {
    if (!this.data.answer) return;
    wx.setClipboardData({ data: this.data.answer.answer || '' });
  }
});
