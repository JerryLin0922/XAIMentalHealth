/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../../_ns.js');
/* ------------------------------------------------------------------
   厂商画像库：谁的数据长什么样，以及怎么认出来。

   加一个数据源只需要两步：
   1. 在 PROFILES 里加一条画像（文件名特征 + 内容指纹 + 自家列名）；
   2. 完事。识别、匹配、自动映射都由这里的通用打分器完成，
      不需要改动流水线与界面。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  /** 目标字段：四项主指标会写进记录，辅助项默认写进备注。 */
  var TARGETS = [
    { key: 'date', label: '日期', kind: 'date', role: 'core' },
    { key: 'time', label: '时间', kind: 'time', role: 'core' },
    { key: 'mood', label: '心情', kind: 'metric', role: 'core', unit: '分', min: 1, max: 5, step: 1 },
    { key: 'sleep', label: '睡眠', kind: 'metric', role: 'core', unit: '小时', min: 0, max: 16, step: 0.5 },
    { key: 'heartRate', label: '心率', kind: 'metric', role: 'core', unit: 'bpm', min: 30, max: 200, step: 1 },
    { key: 'stress', label: '压力', kind: 'metric', role: 'core', unit: '分', min: 0, max: 10, step: 1 },
    { key: 'steps', label: '步数', kind: 'aux', role: 'aux', unit: '步' },
    { key: 'hrv', label: 'HRV', kind: 'aux', role: 'aux', unit: 'ms' },
    { key: 'spo2', label: '血氧', kind: 'aux', role: 'aux', unit: '%' },
    { key: 'exercise', label: '运动时长', kind: 'aux', role: 'aux', unit: '分钟' },
    { key: 'mindful', label: '正念时长', kind: 'aux', role: 'aux', unit: '分钟' }
  ];

  var TARGET_BY_KEY = {};
  TARGETS.forEach(function (t) { TARGET_BY_KEY[t.key] = t; });

  /** 兜底词表：不认识来源时的通用称呼（顺序即优先级）。 */
  var GLOBAL = {
    date: ['日期', '统计日期', 'date', 'datetime', 'start_time', 'day', '时间'],
    time: ['时间', '时刻', 'time'],
    mood: ['心情', '情绪', 'mood'],
    sleep: ['睡眠时长', '总睡眠时长', '睡眠时间', '睡眠', 'sleep', 'sleep_duration', 'asleep'],
    heartRate: ['静息心率', '安静心率', '心率', 'resting heart rate', 'resting_heart_rate', 'heart rate', 'heart_rate', 'bpm'],
    stress: ['压力值', '压力指数', '平均压力', '压力', 'stress', 'stress_score'],
    steps: ['步数', 'steps', 'step count'],
    hrv: ['心率变异性', 'hrv'],
    spo2: ['血氧饱和度', '血氧', 'spo2', 'oxygen saturation'],
    exercise: ['运动时长', '锻炼时长', '活动时长', 'exercise', 'move minutes', 'active minutes'],
    mindful: ['正念时长', '冥想时长', 'mindful', 'mindfulness']
  };

  /** 误伤防护：这些关键词出现时，不允许落到对应目标上。 */
  var EXCLUDE = {
    heartRate: /变异性|variab/i,
    stress: /无明显|等级名称/i,
    sleep: /目标|评分|score/i
  };

  /* ============================ 厂商画像 ============================ */

  var PROFILES = [
    {
      id: 'generic',
      name: '通用表格',
      vendor: '通用',
      platform: 'CSV / Excel',
      formats: ['csv', 'tsv', 'xlsx', 'json'],
      guide: '任意自制的健康表格：第一行写列名，后面每行一天。',
      aliases: {}
    },
    {
      id: 'huawei',
      name: '华为运动健康',
      vendor: '华为',
      platform: 'HarmonyOS / Android',
      formats: ['csv', 'tsv', 'xlsx', 'zip'],
      file: /huawei|hihealth|运动健康|health_export/i,
      fingerprint: function (ctx) { return /静息心率|hihealth|huawei health/i.test(ctx.textSample) || ctx.headers.some(function (h) { return /hihealth|huawei/i.test(h); }); },
      guide: '运动健康 App → 我的 → 设置 → 数据导出（勾选睡眠 / 心率 / 压力），导出 ZIP 或 CSV 后直接拖进来。',
      aliases: {
        date: ['统计日期', '日期', 'date_time', 'date'],
        sleep: ['睡眠时长', '总睡眠时长', '深睡时长', '睡眠总时长', 'total_sleep_time', 'sleep_duration'],
        heartRate: ['静息心率', '安静心率', 'resting_heart_rate', 'restingHeartRate', 'rhr'],
        stress: ['平均压力值', '压力值', '压力指数', 'stress_score', 'average_stress'],
        steps: ['步数', '总步数', 'step_count', 'steps'],
        hrv: ['心率变异性', 'hrv', 'hrv_avg'],
        spo2: ['血氧饱和度', '血氧', 'spo2']
      }
    },
    {
      id: 'apple',
      name: 'Apple 健康',
      vendor: 'Apple',
      platform: 'iOS / watchOS',
      formats: ['xml', 'csv', 'json', 'zip'],
      file: /apple_health|export\.xml|health_export|healthautoxport/i,
      fingerprint: function (ctx) { return /<HealthData|HKQuantityTypeIdentifier|Health Auto Export/i.test(ctx.textSample); },
      guide: 'iPhone「健康」App → 右上角头像 → 导出所有健康数据，得到 export.zip / export.xml；用 Health Auto Export 导出的 CSV / JSON 同样支持。',
      aliases: {
        date: ['日期', 'date', 'startDate', 'start', 'Start'],
        sleep: ['睡眠时长', 'sleep', 'sleep_analysis', 'Sleep Analysis'],
        heartRate: ['静息心率', 'Resting Heart Rate', 'resting_heart_rate', '平均心率', 'Heart Rate'],
        stress: ['压力值', 'stress'],
        steps: ['步数', 'Steps', 'step_count'],
        hrv: ['心率变异性', 'HRV', 'heart_rate_variability'],
        spo2: ['血氧', 'Blood Oxygen', 'oxygen_saturation'],
        exercise: ['运动时长', 'Exercise Time', 'apple_exercise_time']
      }
    },
    {
      id: 'google_fit',
      name: 'Google Fit',
      vendor: 'Google',
      platform: 'Android',
      formats: ['csv', 'json', 'xlsx'],
      file: /google|takeout|fit_|fit\.csv/i,
      fingerprint: function (ctx) { return /average heart rate|step count|move minutes|fit\.googleapis/i.test(ctx.textSample); },
      guide: 'Google Takeout → 仅勾选 Fit → 导出后在文件夹里找到 Daily activity / Sleep 等 CSV；或由 Health Auto Export 转成 CSV / JSON。',
      aliases: {
        date: ['date', 'start_time', 'Date'],
        sleep: ['sleep duration', 'minutes asleep', 'sleep_time', 'sleep_seconds', 'Duration (seconds)'],
        heartRate: ['average heart rate', 'resting heart rate', 'Average heart rate (bpm)'],
        steps: ['step count', 'steps', 'Step count'],
        exercise: ['move minutes count', 'active minutes', 'Move minutes count']
      }
    },
    {
      id: 'health_connect',
      name: 'Health Connect',
      vendor: 'Android',
      platform: 'Android 14+',
      formats: ['csv', 'json', 'zip'],
      file: /health.?connect|healthconnect|\.hc_/i,
      fingerprint: function (ctx) { return /zone_offset|data_source|health.?connect/i.test(ctx.textSample); },
      guide: 'Android 设置 → 健康数据（Health Connect）→ 导出数据，得到 ZIP；里面有按指标拆分的 CSV，整包拖进来即可。',
      aliases: {
        date: ['date', 'start_time', 'time', 'record_time'],
        sleep: ['sleep_duration', 'total_sleep_time', 'sleep_session_duration', 'duration'],
        heartRate: ['resting_heart_rate', 'heart_rate', 'beats_per_minute'],
        stress: ['stress_score', 'stress'],
        steps: ['steps', 'step_count', 'count'],
        hrv: ['heart_rate_variability', 'rmssd', 'sdnn'],
        spo2: ['oxygen_saturation', 'spo2'],
        exercise: ['active_minutes', 'exercise_time', 'duration']
      }
    },
    {
      id: 'oppo',
      name: 'OPPO / 欢律健康',
      vendor: 'OPPO',
      platform: 'ColorOS',
      formats: ['csv', 'xlsx', 'zip'],
      file: /oppo|ohealth|heytap|欢律|heyhealth/i,
      fingerprint: function (ctx) { return /heytap|ohealth|欢律/i.test(ctx.textSample); },
      guide: '欢律健康 / OHealth App → 我的 → 数据与隐私 → 导出数据，勾选睡眠、心率、压力、血氧。',
      aliases: {
        date: ['日期', 'date', '统计时间'],
        sleep: ['睡眠时长', '睡眠总时长', '深睡+浅睡', 'sleep_time'],
        heartRate: ['静息心率', '心率', 'resting_heart_rate'],
        stress: ['压力值', '压力指数', 'stress'],
        spo2: ['血氧饱和度', '血氧', 'spo2']
      }
    },
    {
      id: 'vivo',
      name: 'vivo 健康',
      vendor: 'vivo',
      platform: 'OriginOS',
      formats: ['csv', 'xlsx', 'zip'],
      file: /vivo|vivohealth/i,
      fingerprint: function (ctx) { return /vivo.?health|vhealth/i.test(ctx.textSample); },
      guide: 'vivo 健康 App → 我的 → 数据导出，勾选睡眠 / 心率 / 压力后导出 CSV 或 ZIP。',
      aliases: {
        date: ['日期', 'date', '统计日期'],
        sleep: ['睡眠时长', '实际睡眠时长', 'sleep_duration'],
        heartRate: ['静息心率', '平均静息心率', 'resting_heart_rate'],
        stress: ['压力值', '压力均值', 'stress'],
        steps: ['步数', 'steps'],
        spo2: ['血氧饱和度', '血氧']
      }
    },
    {
      id: 'xiaomi',
      name: '小米穿戴 / Zepp Life',
      vendor: '小米',
      platform: 'MIUI / HyperOS',
      formats: ['csv', 'xlsx', 'zip'],
      file: /xiaomi|mi_band|mi_fit|zepp|huami|小米/i,
      fingerprint: function (ctx) { return /com\.xiaomi|huami|zepp/i.test(ctx.textSample); },
      guide: '小米穿戴 / Zepp Life → 我的 → 数据导出；导出结果多为 ZIP，解压后或直接拖入其中的 CSV 都行。',
      aliases: {
        date: ['日期', 'date', 'time'],
        sleep: ['睡眠时长', 'sleep_duration', 'deep_sleep + light_sleep'],
        heartRate: ['静息心率', 'resting_heart_rate', 'avg_heart_rate'],
        stress: ['压力', '压力值', 'stress'],
        steps: ['步数', 'steps'],
        spo2: ['血氧饱和度', '血氧', 'spo2']
      }
    },
    {
      id: 'garmin',
      name: 'Garmin / 运动手表',
      vendor: 'Garmin',
      platform: 'Garmin Connect',
      formats: ['csv', 'xlsx', 'zip'],
      file: /garmin|connect|activities\.csv|sleep_data|monitoring/i,
      fingerprint: function (ctx) { return /activity type|average stress|resting heart rate|sleep start/i.test(ctx.textSample); },
      guide: 'Garmin Connect 网页 → 活动 / 睡眠 → 导出 CSV（整包 ZIP 也可）。Suunto、Polar、COROS 的 CSV 导出列名相近，同样会用这套规则识别。',
      aliases: {
        date: ['date', 'start', 'start_time', 'activity date', 'sleep start time'],
        sleep: ['sleep time', 'total sleep time', 'sleep_duration', 'totalSleepMinutes', 'hours asleep'],
        heartRate: ['resting heart rate', 'average heart rate', 'resting_heart_rate', 'avg_heart_rate'],
        stress: ['average stress', 'stress', 'stress_average'],
        steps: ['steps', 'total steps'],
        hrv: ['hrv', 'last night avg hrv', 'hrv_status'],
        spo2: ['blood oxygen', 'spo2', 'blood_oxygen'],
        exercise: ['moving time', 'moving_time', 'active minutes']
      }
    }
  ];

  var PROFILE_BY_ID = {};
  PROFILES.forEach(function (p) { PROFILE_BY_ID[p.id] = p; });

  /* ============================ 列分析 ============================ */

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-./\\()（）\[\]：:]+/g, '');
  }

  var UNIT_RE = /[\(（]([^\(（\)）]{1,12})[\)）]\s*$/;

  function cleanHeader(raw, index) {
    var text = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    var unit = '';
    var m = UNIT_RE.exec(text);
    if (m) { unit = m[1]; text = text.slice(0, m.index).trim(); }
    return {
      index: index,
      name: String(raw == null ? '' : raw).trim() || ('列' + (index + 1)),
      base: text,
      unit: unit,
      key: norm(text) || ('列' + (index + 1))
    };
  }

  function isDateLike(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return false;
    if (MH.ingest.isDateText(s)) return true;
    if (/^\d{13}$/.test(s)) return true;                       // 毫秒时间戳
    if (/^\d{10}$/.test(s)) return true;                       // 秒级时间戳
    return false;
  }

  function isTimeOnly(v) {
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(v == null ? '' : v).trim());
  }

  function hasTimePart(v) {
    return /\d{1,2}:\d{2}/.test(String(v == null ? '' : v));
  }

  function analyzeColumn(table, name, index) {
    var cleaned = cleanHeader(name, index);
    var rows = table.rows || [];
    var limit = Math.min(rows.length, 200);
    var n = 0, numeric = 0, dates = 0, times = 0, withTime = 0, epoch = 0;
    var numbers = [];
    for (var i = 0; i < limit; i++) {
      var v = rows[i] ? rows[i][name] : null;
      var s = String(v == null ? '' : v).trim();
      if (!s) continue;
      n++;
      if (/^\d{10}$|^\d{13}$/.test(s)) epoch++;
      if (MH.ingest.isDateText(s)) {
        dates++;
        if (hasTimePart(s)) withTime++;
      } else if (isTimeOnly(s)) times++;
      var num = Number(String(s).replace(/[^\d.\-]/g, ''));
      if (isFinite(num)) { numeric++; if (numbers.length < 400) numbers.push(num); }
    }
    cleaned.count = n;
    cleaned.numericRatio = n ? numeric / n : 0;
    cleaned.dateRatio = n ? dates / n : 0;
    cleaned.timeRatio = n ? times / n : 0;
    cleaned.epochRatio = n ? epoch / n : 0;
    cleaned.dateHasTime = dates ? withTime / dates > 0.5 : false;
    cleaned.numbers = numbers;
    cleaned.sample = [];
    var slimit = Math.min(rows.length, 5);
    for (var j = 0; j < slimit; j++) cleaned.sample.push(String(rows[j] ? rows[j][name] : ''));
    return cleaned;
  }

  function median(arr) {
    if (!arr.length) return null;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* ============================ 匹配打分 ============================ */

  function matchStrength(alias, col) {
    var a = norm(alias);
    var k = col.key;
    if (!a || !k) return 0;
    if (k === a) return 100;
    if (k.indexOf(a) === 0) return 92;
    if (k.indexOf(a) >= 0) return 84;
    if (a.indexOf(k) >= 0) return 70;
    return 0;
  }

  function unitBonus(targetKey, col) {
    var unit = String(col.unit || '') + ' ' + String(col.name || '');
    if (targetKey === 'sleep') {
      if (/分钟|min(ute)?s?\b/i.test(unit)) return 12;
      if (/秒|sec|s\b/i.test(unit)) return 12;
      if (/小时|hour|hrs?\b/i.test(unit)) return 10;
    }
    if (targetKey === 'heartRate' && /bpm|次\/分|次每分/i.test(unit)) return 12;
    if (targetKey === 'steps' && /步|steps/i.test(unit)) return 12;
    if (targetKey === 'spo2' && /%|百分比/i.test(unit)) return 12;
    if (targetKey === 'hrv' && /ms|毫秒/i.test(unit)) return 10;
    return 0;
  }

  function aliasList(profile, key) {
    var own = (profile.aliases && profile.aliases[key]) || [];
    var shared = GLOBAL[key] || [];
    return own.concat(shared.filter(function (a) {
      return own.indexOf(a) < 0;
    }));
  }

  function scoreTarget(table, columns, profile, targetKey) {
    var exclude = EXCLUDE[targetKey];
    var aliases = aliasList(profile, targetKey);
    var out = [];
    columns.forEach(function (col) {
      var best = 0, bestAlias = null, vendor = false;
      var own = (profile.aliases && profile.aliases[targetKey]) || [];
      for (var i = 0; i < aliases.length; i++) {
        var s = matchStrength(aliases[i], col) - i * 1.5;
        if (s > best) { best = s; bestAlias = aliases[i]; vendor = own.indexOf(aliases[i]) >= 0; }
      }
      if (best <= 0) return;
      if (exclude && exclude.test(col.name)) return;

      var target = TARGET_BY_KEY[targetKey];
      if (target.kind === 'metric' || target.kind === 'aux') {
        if (col.numericRatio < 0.35) return;                      // 几乎不是数值 → 不可能是这一列的测量结果
        best += (col.numericRatio - 0.5) * 30;
      }
      best += unitBonus(targetKey, col);
      if (vendor) best += 12;
      out.push({
        column: col.name,
        score: Math.max(0, Math.round(best)),
        matchedAlias: bestAlias,
        reason: '列名匹配「' + bestAlias + '」' + (vendor ? '（' + profile.name + '专属列名）' : '') +
          (col.unit ? '，单位标注 ' + col.unit : '') +
          (col.numericRatio ? '，约 ' + Math.round(col.numericRatio * 100) + '% 是数值' : '')
      });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function scoreDateColumn(table, columns, profile) {
    var own = (profile.aliases && profile.aliases.date) || [];
    var aliases = aliasList(profile, 'date');
    var out = [];
    columns.forEach(function (col) {
      var valueScore = 0;
      if (col.epochRatio > 0.7) valueScore = 95;
      else if (col.dateRatio > 0.7) valueScore = 70 + Math.round(col.dateRatio * 25);
      else if (col.dateRatio > 0.4) valueScore = 45;
      if (!valueScore) return;

      var nameScore = 0, bestAlias = null;
      for (var i = 0; i < aliases.length; i++) {
        var s = matchStrength(aliases[i], col) - i * 1.5;
        if (s > nameScore) { nameScore = s; bestAlias = aliases[i]; }
      }
      var vendorBonus = own.indexOf(bestAlias) >= 0 ? 12 : 0;
      if (nameScore > 0) {
        out.push({
          column: col.name,
          score: Math.min(100, Math.round(valueScore + nameScore * 0.3 + vendorBonus)),
          hasTime: col.dateHasTime,
          reason: '约 ' + Math.round((col.dateRatio + col.epochRatio) * 100) + '% 的值能识别为日期' +
            (bestAlias ? '，列名接近「' + bestAlias + '」' : '') +
            (col.dateHasTime ? '，且带具体时刻' : '')
        });
      } else {
        out.push({
          column: col.name,
          score: Math.round(valueScore),
          hasTime: col.dateHasTime,
          reason: '约 ' + Math.round((col.dateRatio + col.epochRatio) * 100) + '% 的值能识别为日期'
        });
      }
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function scoreTimeColumn(table, columns) {
    var out = [];
    columns.forEach(function (col) {
      if (col.timeRatio > 0.7) {
        out.push({ column: col.name, score: Math.round(70 + col.timeRatio * 30), reason: '约 ' + Math.round(col.timeRatio * 100) + '% 的值形如 HH:MM' });
      }
    });
    return out;
  }

  /* ============================ 单位换算计划 ============================ */

  function planUnit(targetKey, col, override) {
    var target = TARGET_BY_KEY[targetKey];
    var label = target ? target.unit : '';
    // 下划线不算单词边界，先换成空格，否则 sleep_seconds 里的 \bsec 匹配不到
    var hint = (String((col && col.unit) || '') + ' ' + String((col && (col.base || col.name)) || ''))
      .replace(/[_\-]+/g, ' ');
    var numbers = (col && col.numbers) || [];
    var med = median(numbers);
    var max = numbers.length ? Math.max.apply(null, numbers) : null;

    if (override && override !== 'auto') {
      if (targetKey === 'sleep') {
        if (override === 'min') return { factor: 1 / 60, sourceUnit: '分钟', label: '分钟 → 小时（÷60）' };
        if (override === 's') return { factor: 1 / 3600, sourceUnit: '秒', label: '秒 → 小时（÷3600）' };
        return { factor: 1, sourceUnit: '小时', label: '已是小时' };
      }
      if (override === 'scale100') {
        if (targetKey === 'stress') return { factor: 1 / 10, sourceUnit: '百分制', label: '百分制 → 10 分制（÷10）' };
        if (targetKey === 'mood') return { factor: 1 / 20, sourceUnit: '百分制', label: '百分制 → 5 分制（÷20）' };
      }
      if (override === 'scale01') {
        if (targetKey === 'spo2') return { factor: 100, sourceUnit: '小数', label: '0–1 → 百分比（×100）' };
      }
      return { factor: 1, sourceUnit: '', label: '' };
    }

    if (targetKey === 'sleep') {
      // 单位单词要整词匹配：否则 sleep_minutes 尾部的 s 会被当成「秒」
      if (/秒|\bsec(onds?)?\b/i.test(hint)) return { factor: 1 / 3600, sourceUnit: '秒', label: '秒 → 小时（÷3600）' };
      if (/分钟|\bmin(utes?)?\b/i.test(hint)) return { factor: 1 / 60, sourceUnit: '分钟', label: '分钟 → 小时（÷60）' };
      if (/小时|\bhour|\bhrs?\b/i.test(hint)) return { factor: 1, sourceUnit: '小时', label: '' };
      if (med != null && med > 30) return { factor: 1 / 60, sourceUnit: '分钟（推测）', label: '数值偏大，按分钟处理（÷60）' };
      if (med != null && med > 0 && med <= 0.5) return { factor: 1, sourceUnit: '小时', label: '数值很小，按小时处理' };
      return { factor: 1, sourceUnit: '小时', label: '' };
    }

    if (targetKey === 'stress' && max != null && max <= 100 && max > 10) {
      return { factor: 1 / 10, sourceUnit: '百分制（推测）', label: '百分制 → 10 分制（÷10）' };
    }
    if (targetKey === 'mood' && max != null && max <= 100 && max > 5) {
      return { factor: 1 / 20, sourceUnit: '百分制（推测）', label: '百分制 → 5 分制（÷20）' };
    }
    if (targetKey === 'spo2' && max != null && max <= 1.02) {
      return { factor: 100, sourceUnit: '小数', label: '0–1 → 百分比（×100）' };
    }
    return { factor: 1, sourceUnit: '', label: '' };
  }

  /* ============================ 来源识别 ============================ */

  /**
   * @param {{name:string, tables:Array, textSample:string}} ctx
   * @returns {Array<{id:string, name:string, score:number, reasons:Array<string>}>}
   */
  function detect(ctx) {
    var scores = [];
    PROFILES.forEach(function (p) {
      if (p.id === 'generic') return;
      var score = 0, reasons = [];
      if (p.file && p.file.test(ctx.name || '')) { score += 45; reasons.push('文件名像「' + p.name + '」的导出'); }
      try {
        if (p.fingerprint && p.fingerprint(ctx)) { score += 55; reasons.push('内容指纹命中「' + p.name + '」'); }
      } catch (e) { /* 指纹失败不影响识别 */ }

      if (ctx.tables && ctx.tables.length) {
        var table = ctx.tables[0];
        var columns = table.headers.map(function (h, i) { return analyzeColumn(table, h, i); });
        var hit = [];
        ['sleep', 'heartRate', 'stress', 'mood', 'steps', 'hrv', 'spo2', 'exercise'].forEach(function (key) {
          var own = (p.aliases && p.aliases[key]) || [];
          for (var i = 0; i < own.length; i++) {
            if (columns.some(function (col) { return matchStrength(own[i], col) >= 84; })) { hit.push(key); break; }
          }
        });
        if (hit.length) {
          score += Math.min(40, hit.length * 15);
          reasons.push('识别到 ' + hit.length + ' 个专属指标列');
        }
      }
      scores.push({ id: p.id, name: p.name, score: score, reasons: reasons });
    });

    scores.push({ id: 'generic', name: '通用表格', score: 0, reasons: ['没有匹配到具体厂商，按通用表格处理'] });
    scores.sort(function (a, b) { return b.score - a.score; });
    return scores;
  }

  /* ============================ 列映射 ============================ */

  function pickDateFromOverride(columns, name) {
    for (var i = 0; i < columns.length; i++) if (columns[i].name === name) return { column: name, score: 100, reason: '手动指定', hasTime: columns[i].dateHasTime };
    return null;
  }

  function pickFromOverride(columns, targetKey, choice) {
    if (!choice) return null;
    var col = null;
    for (var i = 0; i < columns.length; i++) if (columns[i].name === choice.column) col = columns[i];
    if (!col) return null;
    return {
      column: col.name,
      score: 100,
      reason: '手动指定',
      unit: planUnit(targetKey, col, choice.unitOverride)
    };
  }

  /**
   * 生成字段映射。overrides 用于把界面上的手动选择覆盖回来。
   * @param {Object} table {headers, rows}
   * @param {string} profileId
   * @param {Object} [overrides] {date, time, metrics:{key:{column,unitOverride}}, aux:{...}}
   */
  function map(table, profileId, overrides) {
    var profile = PROFILE_BY_ID[profileId] || PROFILE_BY_ID.generic;
    var override = overrides || {};
    var columns = (table.headers || []).map(function (h, i) { return analyzeColumn(table, h, i); });
    var colByName = {};
    columns.forEach(function (c) { colByName[c.name] = c; });

    var dateCandidates = scoreDateColumn(table, columns, profile);
    var date = pickDateFromOverride(columns, override.date) || dateCandidates[0] || null;

    var timeCandidates = scoreTimeColumn(table, columns);
    var time = null;
    if (override.time) {
      time = { column: override.time, score: 100, reason: '手动指定' };
    } else if (timeCandidates.length && !(date && date.hasTime)) {
      time = timeCandidates[0];
    }

    var metrics = {}, aux = {}, candidates = { date: dateCandidates, time: timeCandidates };
    TARGETS.forEach(function (t) {
      if (t.key === 'date' || t.key === 'time') return;
      var list = scoreTarget(table, columns, profile, t.key);
      candidates[t.key] = list;
      var chosen = null;
      var choiceOverride = (t.role === 'core' ? (override.metrics || {}) : (override.aux || {}))[t.key];
      if (choiceOverride && choiceOverride.column) chosen = pickFromOverride(columns, t.key, choiceOverride);
      else if (list.length && list[0].score >= 40) {
        var best = list[0];
        chosen = {
          column: best.column,
          score: best.score,
          reason: best.reason,
          unit: planUnit(t.key, colByName[best.column])
        };
      }
      if (chosen) chosen.key = t.key;
      if (t.role === 'core') metrics[t.key] = chosen;
      else aux[t.key] = chosen;
    });

    var warnings = [];
    if (!date) warnings.push('没有识别出日期列，请在下方手动指定一列日期，否则无法导入');
    var matchedKeys = Object.keys(metrics).filter(function (k) { return metrics[k]; });
    if (!matchedKeys.length) warnings.push('没有识别出任何指标列，请在下方手动指定心情 / 睡眠 / 心率 / 压力对应的列');

    return {
      profileId: profile.id,
      profileName: profile.name,
      date: date,
      time: time,
      metrics: metrics,
      aux: aux,
      candidates: candidates,
      columns: columns,
      matchedCount: matchedKeys.length,
      warnings: warnings
    };
  }

  MH.importVendors = {
    targets: TARGETS,
    target: function (key) { return TARGET_BY_KEY[key] || null; },
    profiles: function () { return PROFILES.slice(); },
    profile: function (id) { return PROFILE_BY_ID[id] || PROFILE_BY_ID.generic; },
    detect: detect,
    map: map,
    analyzeColumn: analyzeColumn,
    planUnit: planUnit,
    // 供界面与测试使用的小工具
    norm: norm,
    cleanHeader: cleanHeader
  };
})(MH);

