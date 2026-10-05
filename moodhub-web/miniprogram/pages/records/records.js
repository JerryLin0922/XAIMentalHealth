// 记录：新增 / 编辑 / 删除，校验复用 Web 端 metrics.js（同一套量程与步长约束）
const MH = require('../../utils/mh.js');

const EMPTY = { id: '', date: '', time: '', mood: 3, sleep: 7, heartRate: 65, stress: 3, note: '' };

Page({
  data: {
    list: [],
    filtered: [],
    keyword: '',
    showForm: false,
    form: EMPTY,
    metrics: MH.metrics.list,
    errors: {},
    today: MH.util.todayISO()
  },
  onLoad(opts) {
    if (opts && opts.edit) this.openEdit(opts.edit);
  },
  onShow() { this.refresh(); },

  refresh() {
    const list = MH.store.records.all().slice().reverse();
    this.setData({ list });
    this.applyFilter();
  },

  applyFilter() {
    const kw = this.data.keyword.trim();
    const filtered = kw
      ? this.data.list.filter((r) => (r.note || '').indexOf(kw) >= 0 || r.date.indexOf(kw) >= 0)
      : this.data.list;
    this.setData({ filtered });
  },

  onKeyword(e) { this.setData({ keyword: e.detail.value }); this.applyFilter(); },

  /* ---------------- 表单 ---------------- */

  openAdd() {
    this.setData({ showForm: true, errors: {}, form: Object.assign({}, EMPTY, { date: MH.util.todayISO() }) });
  },
  openEdit(id) {
    const r = MH.store.records.get(id);
    if (!r) return;
    this.setData({
      showForm: true,
      errors: {},
      form: {
        id: r.id, date: r.date, time: r.time || '',
        mood: r.mood, sleep: r.sleep, heartRate: r.heartRate, stress: r.stress,
        note: r.note || ''
      }
    });
  },
  closeForm() { this.setData({ showForm: false }); },

  onField(e) {
    const k = e.currentTarget.dataset.k;
    const patch = {};
    if (k === 'note') patch.note = e.detail.value;
    else patch[k] = e.detail.value;
    this.setData({ form: Object.assign({}, this.data.form, patch) });
  },
  onSlider(e) {
    const k = e.currentTarget.dataset.k;
    const v = Number(e.detail.value);
    const step = Number(e.currentTarget.dataset.step) || 1;
    this.setData({ form: Object.assign({}, this.data.form, { [k]: Math.round(v / step) * step }) });
  },
  onDate(e) { this.setData({ form: Object.assign({}, this.data.form, { date: e.detail.value }) }); },

  save() {
    const f = this.data.form;
    const v = MH.metrics.validate({
      date: f.date, time: f.time,
      mood: f.mood, sleep: f.sleep, heartRate: f.heartRate, stress: f.stress,
      note: f.note
    });
    if (!v.ok) { this.setData({ errors: v.errors }); return; }

    if (f.id) {
      MH.store.records.update(f.id, v.values);
      wx.showToast({ title: '已更新', icon: 'success' });
    } else {
      MH.store.records.add(v.values);
      wx.showToast({ title: '已保存', icon: 'success' });
    }
    this.setData({ showForm: false });
    this.refresh();
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '此操作无法撤销。',
      confirmColor: '#b3474a',
      success: (r) => {
        if (r.confirm) { MH.store.records.remove(id); this.refresh(); }
      }
    });
  },

  openEditItem(e) {
    this.openEdit(e.currentTarget.dataset.id);
  }
});
