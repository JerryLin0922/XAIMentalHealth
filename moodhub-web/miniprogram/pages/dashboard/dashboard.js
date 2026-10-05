// 看板：直接复用 Web 端 stats.js（均值 / 极值 / 每周趋势），与网站数字完全一致
const MH = require('../../utils/mh.js');

Page({
  data: {
    days: 7,
    ranges: [7, 14, 30],
    cards: [],
    chart: { title: '心情', unit: '分', color: '#2f6f62', min: 1, max: 5, points: [] },
    metrics: MH.metrics.list,
    recent: [],
    count: 0,
    coverage: ''
  },
  onShow() { this.refresh(); },

  switchRange(e) {
    this.setData({ days: Number(e.currentTarget.dataset.d) });
    this.refresh();
  },

  refresh() {
    const recs = MH.store.records.all();
    const ov = MH.stats.overview(recs, this.data.days);

    const cards = MH.metrics.list.map((m) => {
      const s = ov.metrics[m.key];
      return {
        key: m.key,
        label: m.label,
        unit: m.unit,
        color: this.colorOf(m.key),
        mean: s.mean == null ? '—' : MH.util.num(s.mean, m.dp),
        perWeek: s.perWeek == null ? '' : MH.stats.trendLabel(s.dir) + (s.perWeek == null ? '' : ' ' + MH.util.num(Math.abs(s.perWeek), m.dp) + ' ' + m.unit + '/周'),
        range: s.min == null ? '—' : MH.util.num(s.min, m.dp) + ' ~ ' + MH.util.num(s.max, m.dp),
        latest: s.latest == null ? '—' : MH.util.num(s.latest, m.dp),
        improve: s.improve == null ? '' : (s.improve ? 'up' : 'down')
      };
    });

    const key = this.data.chart.key || 'mood';
    this.setData({
      cards,
      chart: this.buildChart(ov, recs, key),
      recent: recs.slice(-5).reverse().map((r) => ({
        id: r.id,
        date: MH.util.fmtDateFull(r.date),
        text: MH.metrics.list.map((m) => m.label + ' ' + MH.metrics.fmt(m.key, r[m.key])).join(' · ')
      })),
      count: ov.entryCount,
      coverage: MH.util.num(ov.coverage * 100, 0) + '%'
    });
  },

  buildChart(ov, recs, key) {
    const m = MH.metrics.get(key) || MH.metrics.get('mood');
    return {
      key: m.key,
      title: m.label,
      unit: m.unit,
      color: this.colorOf(m.key),
      min: m.min,
      max: m.max,
      points: ov.series.map((p) => ({ date: p.date, value: p[m.key] == null ? null : p[m.key] }))
    };
  },

  colorOf(key) {
    // 与 css/styles.css 的设计令牌保持一致
    return { mood: '#2f6f62', sleep: '#3d6f9e', heartRate: '#b3474a', stress: '#b3823d' }[key] || '#2f6f62';
  },

  switchMetric(e) {
    this.setData({ chart: this.buildChart(MH.stats.overview(MH.store.records.all(), this.data.days), MH.store.records.all(), e.currentTarget.dataset.k) });
  },

  goRecords() { wx.switchTab({ url: '/pages/records/records' }); },
  openRecent(e) {
    wx.navigateTo({ url: '/pages/records/records?edit=' + e.currentTarget.dataset.id });
  }
});
