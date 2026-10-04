/* 四项指标的单一事实来源：定义、取值范围、校验、格式化、配色。 */
(function (MH) {
  'use strict';

  var METRICS = [
    {
      key: 'mood', label: '心情', unit: '分', min: 1, max: 5, step: 1, dp: 1,
      color: 'var(--mood)', eps: 0.15, higherBetter: true,
      hint: '1 很低落 · 3 平静 · 5 很好'
    },
    {
      key: 'sleep', label: '睡眠', unit: '小时', min: 0, max: 16, step: 0.5, dp: 1,
      color: 'var(--sleep)', eps: 0.3, higherBetter: true,
      hint: '昨晚实际睡着的时长'
    },
    {
      key: 'heartRate', label: '心率', unit: 'bpm', min: 30, max: 200, step: 1, dp: 0,
      color: 'var(--hr)', eps: 1.5, higherBetter: false,
      hint: '静息心率，晨起平躺测量最稳定'
    },
    {
      key: 'stress', label: '压力', unit: '分', min: 0, max: 10, step: 1, dp: 1,
      color: 'var(--stress)', eps: 0.3, higherBetter: false,
      hint: '0 完全放松 · 10 快撑不住了'
    }
  ];

  var BY_KEY = {};
  METRICS.forEach(function (m) { BY_KEY[m.key] = m; });

  function get(key) { return BY_KEY[key] || null; }

  /** 把数值格式化为带单位的展示文本。 */
  function fmt(key, value, withUnit) {
    var m = BY_KEY[key];
    if (!m) return String(value);
    if (value == null || !isFinite(value)) return '—';
    var v = MH.util.num(value, m.dp);
    return withUnit === false ? v : v + ' ' + m.unit;
  }

  /**
   * 校验一条记录。date 必填且不得晚于今天；四项指标均为必填且须落在量程内。
   * @returns {{ok: boolean, errors: Object<string,string>, values: Object}}
   */
  function validate(input) {
    var errors = {};
    var values = {};
    var today = MH.util.todayISO();

    var date = String(input.date || '').trim();
    if (!date) errors.date = '请选择日期';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = '日期格式应为 YYYY-MM-DD';
    else if (date > today) errors.date = '不能记录未来的日期';
    values.date = date;

    var time = String(input.time || '').trim();
    if (time && !/^\d{2}:\d{2}$/.test(time)) errors.time = '时间格式应为 HH:MM';
    values.time = time;

    METRICS.forEach(function (m) {
      var raw = input[m.key];
      if (raw === '' || raw == null) {
        errors[m.key] = '请填写' + m.label;
        return;
      }
      var n = Number(raw);
      if (!isFinite(n)) { errors[m.key] = m.label + '需要是数字'; return; }
      if (n < m.min || n > m.max) {
        errors[m.key] = m.label + '应在 ' + m.min + '–' + m.max + ' ' + m.unit + ' 之间';
        return;
      }
      if (m.step === 1 && Math.round(n) !== n) {
        errors[m.key] = m.label + '请填整数';
        return;
      }
      if (m.step === 0.5 && Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) {
        errors[m.key] = m.label + '请按 0.5 小时递增';
        return;
      }
      values[m.key] = n;
    });

    var note = String(input.note || '');
    if (note.length > 500) errors.note = '备注不能超过 500 字';
    values.note = note.slice(0, 500);

    return { ok: Object.keys(errors).length === 0, errors: errors, values: values };
  }

  MH.metrics = { list: METRICS, get: get, fmt: fmt, validate: validate };
})(window.MH = window.MH || {});
