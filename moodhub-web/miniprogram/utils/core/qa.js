/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../_ns.js');
/* ------------------------------------------------------------------
   SmartQA：多来源智能问答的编排层。

   流程：选择数据源 → 解析/切块 → 检索证据 → 结构化数值计算
        → 预算内组装上下文 → 交给本地服务生成回答。

   隐私约定：
     · 内置「健康记录」来源只以 14 天聚合摘要参与，不导出任何单条记录或备注原文
     · 用户自己上传的文件按选中范围参与，且可选择「仅本次会话」不落盘
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var FILE_TEXT_LIMIT = 6000;        // 单个来源进入上下文的文本上限
  var CONTEXT_CHAR_LIMIT = 24000;    // 上下文总预算上限
  var DEFAULT_HEALTH_DAYS = 14;      // 内置健康来源的回看窗口

  var GENERIC_METRICS = {
    steps: { label: '步数', unit: '步' },
    hrv: { label: 'HRV', unit: 'ms' },
    spo2: { label: '血氧', unit: '%' },
    exercise: { label: '运动时长', unit: '分钟' }
  };

  function metricMeta(key) {
    var m = MH.metrics.get(key);
    if (m) return { label: m.label, unit: m.unit, dp: m.dp };
    return GENERIC_METRICS[key] || { label: key, unit: '', dp: 1 };
  }

  var METRIC_KEYWORDS = {
    mood: ['心情', '情绪', 'mood', '开心', '低落'],
    sleep: ['睡眠', '睡了', '睡得', '睡觉', 'sleep', '失眠'],
    heartRate: ['心率', '心跳', 'bpm', 'heart'],
    stress: ['压力', 'stress', '紧张'],
    steps: ['步数', 'steps', '走路'],
    spo2: ['血氧', 'spo2'],
    hrv: ['hrv', '心率变异'],
    exercise: ['运动', '锻炼', 'exercise']
  };

  /* ============ 1. 内置健康记录来源（只出聚合） ============ */

  function healthSource(records, days) {
    var d = days || DEFAULT_HEALTH_DAYS;
    var ov = MH.stats.overview(records, d);
    var lines = ['【本机健康记录摘要】区间 ' + ov.from + ' 至 ' + ov.to + '，共 ' + ov.entryCount + ' 条记录，覆盖 ' + ov.daysWithData + '/' + d + ' 天'];
    MH.metrics.list.forEach(function (m) {
      var s = ov.metrics[m.key];
      if (s.mean == null) { lines.push('- ' + m.label + '：暂无数据'); return; }
      var trend = s.dir === 'flat' ? '基本持平' : ((s.dir === 'up' ? '上升' : '下降') +
        (s.perWeek != null ? ' ' + U.num(Math.abs(s.perWeek), m.dp) + ' ' + m.unit + '/周' : ''));
      lines.push('- ' + m.label + '：均值 ' + U.num(s.mean, m.dp) + ' ' + m.unit +
        '，范围 ' + U.num(s.min, m.dp) + '–' + U.num(s.max, m.dp) +
        '，最近 ' + U.num(s.latest, m.dp) + '，趋势' + trend);
    });

    return {
      id: '__health__',
      name: '本机健康记录（' + d + ' 天聚合）',
      kind: 'health',
      aggregateOnly: true,
      text: lines.join('\n'),
      rows: (records || []).slice(-d * 4).map(function (r) {
        return { date: r.date, mood: r.mood, sleep: r.sleep, heartRate: r.heartRate, stress: r.stress };
      }),
      fields: [
        { name: 'date', type: 'date', metric: null },
        { name: 'mood', type: 'number', metric: 'mood' },
        { name: 'sleep', type: 'number', metric: 'sleep' },
        { name: 'heartRate', type: 'number', metric: 'heartRate' },
        { name: 'stress', type: 'number', metric: 'stress' }
      ],
      stats: { rowCount: (records || []).length, kind: 'table' }
    };
  }

  /* ============ 2. 意图与指标识别 ============ */

  var INTENTS = [
    { key: 'max', re: /最高|最大|最多|峰值|最好|最长|峰值|最高的/ },
    { key: 'min', re: /最低|最小|最少|谷值|最短|最差/ },
    { key: 'trend', re: /趋势|变化|上升|下降|改善|恶化|变好|变差/ },
    { key: 'count', re: /多少条|几条|多少天|多少次|几天|多少次|共几/ },
    { key: 'latest', re: /最近|最新|最后一次|当前|现在/ },
    { key: 'avg', re: /平均|均值|一般|通常|总体/ }
  ];

  function detectIntent(q) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].re.test(q)) return INTENTS[i].key;
    return 'summary';
  }

  function detectMetricKey(q) {
    var keys = Object.keys(METRIC_KEYWORDS);
    for (var i = 0; i < keys.length; i++) {
      var kws = METRIC_KEYWORDS[keys[i]];
      for (var j = 0; j < kws.length; j++) if (q.indexOf(kws[j]) >= 0) return keys[i];
    }
    return null;
  }

  /** 在来源里为指标挑一列：先看 metric 标记，再看列名是否被问题直接提到。 */
  function pickField(source, metricKey, question) {
    var fields = source.fields || [];
    var i;
    if (metricKey) {
      for (i = 0; i < fields.length; i++) {
        if (fields[i].metric === metricKey && fields[i].type === 'number') return fields[i];
      }
    }
    for (i = 0; i < fields.length; i++) {
      var n = String(fields[i].name);
      if (fields[i].type === 'number' && question.indexOf(n) >= 0) return fields[i];
    }
    for (i = 0; i < fields.length; i++) {
      if (fields[i].type === 'number' && fields[i].metric) return fields[i];
    }
    return null;
  }

  function pickDateField(source) {
    var fields = source.fields || [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].type === 'date' || /时间|日期|date|time|timestamp/i.test(String(fields[i].name))) return fields[i].name;
    }
    return null;
  }

  /* ============ 3. 结构化数值计算 ============ */

  function analyze(source, question) {
    if (!source || !source.rows || !source.rows.length) return null;
    var metricKey = detectMetricKey(question) || null;
    var field = pickField(source, metricKey, question);
    if (!field) return null;

    var dateField = pickDateField(source);
    var pts = [];
    source.rows.forEach(function (r, i) {
      var v = MH.ingest.toNumber(r[field.name]);
      if (v == null) return;
      pts.push({ v: v, at: dateField ? (MH.ingest.normalizeDate(r[dateField]) || '') : '', i: i });
    });
    if (!pts.length) return null;

    var meta = metricMeta(field.metric || field.name);
    var vals = pts.map(function (p) { return p.v; });
    var mean = U.mean(vals);
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var minPt = pts.filter(function (p) { return p.v === min; })[0];
    var maxPt = pts.filter(function (p) { return p.v === max; })[0];
    var half = Math.floor(pts.length / 2);

    // 睡眠列若以分钟为单位（均值 > 24）统一折算成小时
    var scale = 1, unit = meta.unit;
    if ((field.metric === 'sleep' || /睡眠|sleep/i.test(field.name)) && mean > 24) {
      scale = 1 / 60; unit = '小时';
    }

    return {
      sourceName: source.name,
      fieldName: field.name,
      metricKey: field.metric || null,
      label: meta.label,
      unit: unit,
      dp: meta.dp,
      n: pts.length,
      mean: mean * scale, min: min * scale, max: max * scale,
      latest: pts[pts.length - 1].v * scale, first: pts[0].v * scale,
      minAt: minPt ? minPt.at : '', maxAt: maxPt ? maxPt.at : '',
      halfDelta: half >= 1 ? (U.mean(vals.slice(half)) - U.mean(vals.slice(0, half))) * scale : null
    };
  }

  function describeStat(a, intent) {
    var n = function (v) { return U.num(v, a.dp) + ' ' + a.unit; };
    var head = '「' + a.label + '」（' + a.sourceName + ' 的 ' + a.fieldName + ' 列，' + a.n + ' 条）';
    switch (intent) {
      case 'max': return head + '：最高 ' + n(a.max) + (a.maxAt ? '（' + a.maxAt + '）' : '') + '，平均 ' + n(a.mean);
      case 'min': return head + '：最低 ' + n(a.min) + (a.minAt ? '（' + a.minAt + '）' : '') + '，平均 ' + n(a.mean);
      case 'latest': return head + '：最近一次 ' + n(a.latest) + '，平均 ' + n(a.mean) + '，区间 ' + n(a.min) + '–' + n(a.max);
      case 'trend':
        if (a.halfDelta == null) return head + '：' + n(a.first) + ' → ' + n(a.latest);
        return head + '：后半段均值比前半段' + (a.halfDelta >= 0 ? '高' : '低') + ' ' +
          n(Math.abs(a.halfDelta)) + '，整体 ' + n(a.first) + ' → ' + n(a.latest);
      case 'avg': return head + '：平均 ' + n(a.mean) + '，区间 ' + n(a.min) + '–' + n(a.max);
      default: return head + '：平均 ' + n(a.mean) + '，区间 ' + n(a.min) + '–' + n(a.max) +
        '，最近 ' + n(a.latest);
    }
  }

  /* ============ 4. 主入口 ============ */

  /**
   * @param {Object} req
   *   question      必填，用户的问题
   *   customPrompt  选填，补充说明 / 角色指令
   *   selection     { health:boolean, files:string[] }
   *   records       本机记录（用于内置健康来源）
   *   sources       全部可用数据源
   *   topK / budget 检索与上下文参数
   */
  function ask(req) {
    var request = req || {};
    var question = String(request.question || '').trim();
    var prompt = String(request.customPrompt || '').trim();
    var selection = request.selection || {};
    var prefs = MH.store.prefs.get();
    var topK = request.topK || prefs.qaTopK || 4;
    var budget = Math.min(CONTEXT_CHAR_LIMIT, request.budget || prefs.qaContextChars || 12000);

    if (!question) return Promise.reject(new Error('请先写下你的问题'));

    // 危机词优先走求助通道，不做任何"分析"
    if (MH.localService.isCrisis(question)) {
      return Promise.resolve({
        question: question,
        mode: 'crisis',
        crisis: true,
        answer: '你刚才说的话让我担心你的安全。下面是 24 小时都有人接的渠道，现在就可以打过去。',
        usedSources: [],
        citations: [],
        context: { text: '', charCount: 0, usedSources: [] },
        resources: MH.localService.resources,
        at: Date.now()
      });
    }

    // 1) 汇总参与本次问答的来源
    var allSources = request.sources || [];
    var docs = [];
    if (selection.health) docs.push(healthSource(request.records || MH.store.records.all(), DEFAULT_HEALTH_DAYS));
    (selection.files || []).forEach(function (id) {
      var s = null;
      for (var i = 0; i < allSources.length; i++) if (allSources[i].id === id) s = allSources[i];
      if (s && s.text) docs.push(s);
    });

    if (!docs.length) {
      return Promise.resolve({
        question: question,
        mode: 'empty',
        crisis: false,
        answer: '还没有选中任何数据源。请勾选「本机健康记录」，或先上传 CSV / JSON / 文本文件并勾选它，再提问。',
        usedSources: [], citations: [],
        context: { text: '', charCount: 0, usedSources: [] },
        at: Date.now()
      });
    }

    // 2) 检索证据
    var query = question + (prompt ? ' ' + prompt : '');
    var index = MH.retriever.buildIndex(docs.map(function (d) {
      return { id: d.id, name: d.name, text: String(d.text).slice(0, FILE_TEXT_LIMIT) };
    }));
    var hits = MH.retriever.search(index, query, topK);

    // 3) 结构化数值计算（对所有表格型来源）
    var intent = detectIntent(question);
    var facts = [];
    docs.forEach(function (d) {
      var a = analyze(d, question);
      if (a) facts.push({ type: 'stat', text: describeStat(a, intent), source: d.name });
    });

    // 4) 证据引用
    var citations = hits.map(function (h) {
      return {
        sourceName: h.chunk.sourceName,
        sourceId: h.chunk.sourceId,
        quote: MH.retriever.pickQuote(h.chunk.text, question, 180),
        score: Math.round(h.score * 100) / 100
      };
    });
    citations.forEach(function (c) {
      facts.push({ type: 'quote', text: c.quote, source: c.sourceName });
    });

    // 5) 组装上下文
    var ctx = MH.retriever.assemble({
      prompt: prompt,
      blocks: hits,
      budget: budget
    });

    // 6) 交给模型管理器（本地引擎或云端，按场景选择）
    return MH.models.run('qa', {
      question: question,
      customPrompt: prompt,
      intent: intent,
      context: { text: ctx.text, usedSources: ctx.usedSources, charCount: ctx.charCount },
      facts: facts
    }, { chars: ctx.charCount }).then(function (res) {
      return {
        question: question,
        answer: res.text,
        mode: res.privacy === 'on-device' ? 'local' : 'cloud',
        crisis: false,
        intent: intent,
        usedSources: ctx.usedSources,
        citations: citations,
        context: ctx,
        tags: res.tags || [],
        model: {
          id: res.modelId, name: res.modelName, privacy: res.privacy,
          degraded: res.degraded, error: res.error, latencyMs: res.latencyMs,
          truncated: !!res.truncated
        },
        preview: res.preview,
        resources: res.resources || null,
        at: Date.now()
      };
    });
  }

  MH.qa = {
    FILE_TEXT_LIMIT: FILE_TEXT_LIMIT,
    CONTEXT_CHAR_LIMIT: CONTEXT_CHAR_LIMIT,
    DEFAULT_HEALTH_DAYS: DEFAULT_HEALTH_DAYS,
    healthSource: healthSource,
    analyze: analyze,
    detectIntent: detectIntent,
    detectMetricKey: detectMetricKey,
    ask: ask
  };
})(MH);

