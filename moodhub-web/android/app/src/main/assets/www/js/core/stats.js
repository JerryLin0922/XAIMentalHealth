/* 统计聚合：按天归集、均值、趋势，以及对外只暴露聚合值的 14 天摘要。 */
(function (MH) {
  'use strict';

  var U = MH.util;

  /** 把记录按天归集（同一天多条取均值），补齐区间内没有记录的空白天。 */
  function dailySeries(records, days, endISO) {
    var end = endISO || U.todayISO();
    var start = U.addDays(end, -(days - 1));
    var buckets = {};
    (records || []).forEach(function (r) {
      if (!r || r.date < start || r.date > end) return;
      (buckets[r.date] = buckets[r.date] || []).push(r);
    });

    var out = [];
    for (var i = 0; i < days; i++) {
      var d = U.addDays(start, i);
      var list = buckets[d] || [];
      var point = { date: d, n: list.length };
      MH.metrics.list.forEach(function (m) {
        point[m.key] = U.mean(list.map(function (r) { return r[m.key]; }));
      });
      out.push(point);
    }
    return out;
  }

  /** 最小二乘拟合，返回每周变化量（slope × 7）。 */
  function slopePerWeek(xs, ys) {
    var n = xs.length;
    if (n < 2) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var num = 0, den = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx;
      num += dx * (ys[i] - my);
      den += dx * dx;
    }
    if (den === 0) return null;
    return (num / den) * 7;
  }

  function metricStats(series, key) {
    var m = MH.metrics.get(key);
    var xs = [], ys = [];
    series.forEach(function (p, i) {
      if (p[key] != null && isFinite(p[key])) { xs.push(i); ys.push(p[key]); }
    });

    var values = ys.slice();
    var perWeek = slopePerWeek(xs, ys);
    var dir = 'flat';
    if (perWeek != null) {
      if (perWeek > m.eps) dir = 'up';
      else if (perWeek < -m.eps) dir = 'down';
    }
    if (dir === 'flat' && values.length >= 2) {
      // 变化很小但方向明确时，给一个温和的提示，避免永远显示「持平」
      var d = values[values.length - 1] - values[0];
      if (Math.abs(d) > (m.max - m.min) * 0.12) dir = d > 0 ? 'up' : 'down';
    }

    var distinct = series.filter(function (p) { return p[key] != null; }).length;
    return {
      key: key,
      label: m.label,
      unit: m.unit,
      count: values.length,
      coverage: series.length ? distinct / series.length : 0,
      mean: values.length ? U.mean(values) : null,
      min: values.length ? Math.min.apply(null, values) : null,
      max: values.length ? Math.max.apply(null, values) : null,
      latest: values.length ? values[values.length - 1] : null,
      first: values.length ? values[0] : null,
      deltaFromFirst: values.length ? values[values.length - 1] - values[0] : null,
      perWeek: perWeek,
      dir: dir,
      improve: dir === 'flat' ? null : (dir === 'up') === !!m.higherBetter
    };
  }

  /** 看板用：区间内的完整聚合结果。 */
  function overview(records, days, endISO) {
    var series = dailySeries(records, days, endISO);
    var metrics = {};
    MH.metrics.list.forEach(function (m) { metrics[m.key] = metricStats(series, m.key); });
    var withData = series.filter(function (p) { return p.n > 0; }).length;
    return {
      days: days,
      from: series.length ? series[0].date : U.todayISO(),
      to: series.length ? series[series.length - 1].date : U.todayISO(),
      series: series,
      metrics: metrics,
      daysWithData: withData,
      coverage: days ? withData / days : 0,
      entryCount: (records || []).filter(function (r) {
        return r.date >= (series.length ? series[0].date : '') && r.date <= (series.length ? series[series.length - 1].date : '');
      }).length
    };
  }

  function trendLabel(dir) {
    return dir === 'up' ? '上升' : (dir === 'down' ? '下降' : '持平');
  }

  /**
   * 最近 14 天统计摘要 —— 这是唯一会交给「本地陪伴服务」的数据。
   * 只含每项指标的均值、极值与趋势斜率，不含任何单条记录、日期明细或备注原文。
   */
  function summary14(records, endISO) {
    var days = 14;
    var ov = overview(records, days, endISO);
    var metrics = {};
    MH.metrics.list.forEach(function (m) {
      var s = ov.metrics[m.key];
      metrics[m.key] = {
        mean: s.mean == null ? null : Math.round(s.mean * 100) / 100,
        min: s.min,
        max: s.max,
        latest: s.latest,
        trend: {
          direction: s.dir,
          changePerWeek: s.perWeek == null ? null : Math.round(s.perWeek * 100) / 100,
          label: trendLabel(s.dir)
        }
      };
    });
    return {
      schema: 'moodhub.summary/v1',
      windowDays: days,
      from: ov.from,
      to: ov.to,
      daysWithData: ov.daysWithData,
      entryCount: ov.entryCount,
      metrics: metrics,
      privacy: {
        rawRecords: false,
        noteText: false,
        contains: ['每项指标的均值', '最小值/最大值', '最近一次取值', '每周趋势斜率']
      }
    };
  }

  MH.stats = {
    dailySeries: dailySeries,
    metricStats: metricStats,
    overview: overview,
    summary14: summary14,
    trendLabel: trendLabel
  };
})(window.MH = window.MH || {});
