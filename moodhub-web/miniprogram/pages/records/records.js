const store = require('../../utils/store.js');

Page({
  data: {
    list: [],
    showForm: false,
    form: { date: '', time: '', mood: '', sleep: '', heartRate: '', stress: '', note: '' }
  },
  onShow() { this.refresh(); },
  refresh() { this.setData({ list: store.all().slice().reverse() }); },
  toggleForm() { this.setData({ showForm: !this.data.showForm }); },
  onInput(e) { this.setData({ ['form.' + e.currentTarget.dataset.k]: e.detail.value }); },
  save() {
    const f = this.data.form;
    if (!f.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (f.mood === '' && f.sleep === '' && f.heartRate === '' && f.stress === '') return wx.showToast({ title: '至少填一项指标', icon: 'none' });
    store.add({
      date: f.date, time: f.time || '',
      mood: f.mood === '' ? null : Number(f.mood),
      sleep: f.sleep === '' ? null : Number(f.sleep),
      heartRate: f.heartRate === '' ? null : Number(f.heartRate),
      stress: f.stress === '' ? null : Number(f.stress),
      note: f.note || ''
    });
    wx.showToast({ title: '已保存' });
    this.setData({ showForm: false, form: { date: '', time: '', mood: '', sleep: '', heartRate: '', stress: '', note: '' } });
    this.refresh();
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除这条记录？', success: (r) => { if (r.confirm) { store.remove(id); this.refresh(); } } });
  }
});
