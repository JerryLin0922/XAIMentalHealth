const store = require('../../utils/store.js');

function avg(arr) {
  const v = arr.filter((x) => typeof x === 'number' && !isNaN(x));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

Page({
  data: { mood: '-', sleep: '-', hr: '-', stress: '-', recent: [], count: 0 },
  onShow() { this.refresh(); },
  refresh() {
    const recs = store.all();
    this.setData({
      mood: avg(recs.map((r) => r.mood)) != null ? avg(recs.map((r) => r.mood)) : '-',
      sleep: avg(recs.map((r) => r.sleep)) != null ? avg(recs.map((r) => r.sleep)) : '-',
      hr: avg(recs.map((r) => r.heartRate)) != null ? avg(recs.map((r) => r.heartRate)) : '-',
      stress: avg(recs.map((r) => r.stress)) != null ? avg(recs.map((r) => r.stress)) : '-',
      recent: recs.slice(-6).reverse(),
      count: recs.length
    });
  },
  goRecords() { wx.switchTab({ url: '/pages/records/records' }); }
});
