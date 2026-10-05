/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../_ns.js');
/* ------------------------------------------------------------------
   本地陪伴服务（Local Companion Service）

   这是一个跑在本页进程内的规则引擎，**不是网络服务、不调用任何外部接口**。
   调用方只能传入两类内容：
     1) message —— 用户这一句想说的话
     2) summary —— 最近 14 天的统计摘要（均值 / 极值 / 趋势斜率）
   服务入口会做严格裁剪：任何原始记录、日期明细、备注原文都会被丢弃，
   命中危机词时直接返回求助资源，不做任何"分析"。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var CRISIS_RESOURCES = [
    { name: '全国统一心理援助热线', contact: '12356（24 小时）' },
    { name: '北京心理危机研究与干预中心', contact: '010-8295-1332' },
    { name: '希望 24 热线', contact: '400-161-9995' },
    { name: '紧急危险情况', contact: '110 / 120' }
  ];

  var CRISIS_RE = /(自杀|不想活|活不下去|活着没意义|没有意义活|结束生命|轻生|自残|伤害自己|想死|死了算了|跳楼|割腕|吞药|遗书|告别这个世界|撑不下去了|消失算了)/;

  var INTENTS = [
    { key: 'sleep', re: /睡|失眠|睡不着|早醒|熬夜|多梦|醒得早|睡眠/ },
    { key: 'stress', re: /压力|喘不过气|扛不住|太累了心|焦头烂额|忙不过来|deadline|截止|ddl|绩效|考核/ },
    { key: 'moodLow', re: /低落|难过|难受|想哭|沮丧|抑郁|开心不起来|提不起劲|没劲|空虚|emo|丧|不开心|心情差/ },
    { key: 'anxiety', re: /焦虑|紧张|心慌|慌|害怕|担心|不安|panic|慌张|胡思乱想/ },
    { key: 'anger', re: /生气|愤怒|烦躁|烦死了|想骂人|受不了|气死|窝火/ },
    { key: 'lonely', re: /孤独|一个人|没人懂|没人陪|寂寞|想找人|陪我|没人说话/ },
    { key: 'tired', re: /累|疲惫|乏力|没力气|困|透支| burnout|倦怠/ },
    { key: 'good', re: /开心|不错|挺好|还好|顺利|高兴|感恩|谢谢|舒服|放松|状态好|进步/ },
    { key: 'greeting', re: /^(你好|hi|hello|嗨|哈喽|在吗|在么)/i }
  ];

  function metricLine(summary, key) {
    var s = summary && summary.metrics && summary.metrics[key];
    if (!s || s.mean == null) return null;
    var def = MH.metrics.get(key);
    var label = (s.trend && s.trend.label) || '持平';
    return def.label + '均值 ' + U.num(s.mean, def.dp) + ' ' + def.unit + '（近两周' + label + '）';
  }

  function trendPhrase(summary, key) {
    var s = summary && summary.metrics && summary.metrics[key];
    if (!s || !s.trend) return null;
    var def = MH.metrics.get(key);
    var dir = s.trend.direction;
    var amount = s.trend.changePerWeek;
    if (dir === 'flat' || amount == null) return def.label + '基本平稳';
    var v = Math.abs(amount);
    var text = def.label + (dir === 'up' ? '上升' : '下降') + '约 ' + U.num(v, def.dp) + ' ' + def.unit + '/周';
    return text;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ============================ 各意图的回应模板 ============================ */

  var REPLIES = {
    greeting: function (s) {
      var l = metricLine(s, 'mood');
      return {
        text: '我在。' + (l ? '你最近两周' + l + '。' : '') + '\n想先说说今天过得怎么样，还是想让我陪你看看这两周的变化？',
        tags: ['开场']
      };
    },
    moodLow: function (s) {
      var l = metricLine(s, 'mood');
      return {
        text: '听起来这几天压着不少东西。这种低气压不需要被马上赶走，先让它有个地方待着就好。\n' +
          (l ? '我这边看到你' + l + '。数字只是参考，你的感受才是准的。\n' : '') +
          pick([
            '如果愿意，试着说一件今天让你稍微松一点的小事——哪怕只是水喝够了。',
            '要不要把现在脑子里转的那句话直接写下来？不用组织语言，原样丢给我就行。'
          ]),
        tags: ['情绪低落', '陪伴']
      };
    },
    sleep: function (s) {
      var l = metricLine(s, 'sleep');
      var t = trendPhrase(s, 'sleep');
      return {
        text: '睡眠一乱，白天什么都跟着变沉。\n' +
          (l ? '你' + l + '，' + (t ? t + '。' : '') + '\n' : '') +
          pick([
            '今晚可以试一件小事：睡前 30 分钟把屏幕放远，只留一盏暖灯。不用追求立刻睡着。',
            '如果躺下 20 分钟还醒着，就起来坐一会儿再回床上，别和"必须睡着"较劲。'
          ]),
        tags: ['睡眠', '自我照顾']
      };
    },
    stress: function (s) {
      var st = metricLine(s, 'stress');
      var hr = metricLine(s, 'heartRate');
      return {
        text: '压力堆到这个程度，身体通常会先发出信号。\n' +
          (st ? '你' + st + '，' : '') + (hr ? hr + '。' : '') +
          '\n' + pick([
            '现在先做一轮慢呼吸：吸气 4 秒、停 2 秒、呼气 6 秒，重复 5 次。这不是鸡汤，是在给神经系统一个减速信号。',
            '把待办从脑子里搬到纸上，分成"今天必须"和"可以明天"两堆。搬完就等于卸载了一部分。'
          ]),
        tags: ['压力', '呼吸练习']
      };
    },
    anxiety: function (s) {
      return {
        text: '慌的时候，人会被"还没发生的事"拽着走。\n' +
          pick([
            '试着找一个能说出来的东西：5 样看得见的、4 样摸得到的、3 样听得到的。把注意力从预测拉回此刻。',
            '把"我在担心什么"写成一句完整的话。写出来之后，它通常会从一团雾变成一个可以对付的具体问题。'
          ]),
        tags: ['焦虑', '回到当下']
      };
    },
    anger: function (s) {
      return {
        text: '生气常常是在说：某个边界被踩了。它本身不是坏事。\n' +
          pick([
            '先给身体一个出口：快走十分钟，或者把想说的话先写下来不发。等心率降下来再决定要不要表达。',
            '试着把它翻译成一句"我需要……"。愤怒背后通常藏着一个没被满足的需要。'
          ]),
        tags: ['愤怒', '边界']
      };
    },
    lonely: function (s) {
      return {
        text: '我在这儿，不会评判你。\n' +
          pick([
            '孤独最难的地方是"说了也没用"这个预设。你已经说出来了，这本身就是一步。',
            '如果想找真人，我可以给你一些 24 小时都在的心理热线，随时可以说。'
          ]),
        tags: ['孤独', '陪伴']
      };
    },
    tired: function (s) {
      var sl = metricLine(s, 'sleep');
      return {
        text: '累到这个份上，不是靠意志力能顶过去的。\n' +
          (sl ? '你' + sl + '，身体的账迟早要还。\n' : '') +
          pick([
            '今天能不能给自己排一件"什么都不做"的 15 分钟？不是休息为了更高效率，就是单纯允许停下。',
            '先补最基础的三样：水、饭、睡。别在缺觉的时候做重大决定。'
          ]),
        tags: ['疲惫', '休息']
      };
    },
    good: function (s) {
      var l = metricLine(s, 'mood');
      return {
        text: '真好，这种时刻值得被记下来。\n' +
          (l ? '你' + l + '，趋势是往上的。\n' : '') +
          '把它写进今天的记录里吧——以后低气压的时候，你会需要看到今天这一页。',
        tags: ['正向时刻', '记录']
      };
    },
    fallback: function (s) {
      var lines = [];
      var m = metricLine(s, 'mood'), sl = metricLine(s, 'sleep');
      var st = metricLine(s, 'stress');
      if (m || sl || st) {
        lines.push('我把最近 14 天的统计看了一遍：' + [m, sl, st].filter(Boolean).join('，') + '。');
      } else {
        lines.push('你还没有足够的记录，所以我先不猜——你说的话就是最主要的信息。');
      }
      lines.push(pick([
        '想接着说说具体发生了什么吗？哪怕只是一句话。',
        '如果不知道从哪儿说起，就先说身体：现在最明显的感受在哪儿？'
      ]));
      return { text: lines.join('\n'), tags: ['倾听'] };
    }
  };

  /* ============================ 服务入口 ============================ */

  /**
   * 发起一次回应。
   * @param {{message: string, summary: Object}} request 只接受这两项
   * @returns {Promise<{text:string, tags:string[], crisis:boolean, resources:Array}>}
   */
  function generateReply(request) {
    var req = request || {};
    // 严格裁剪：只保留文本与统计摘要；任何其他字段（含原始记录）一律丢弃
    var payload = {
      message: String(req.message || '').slice(0, 1000),
      summary: sanitizeSummary(req.summary)
    };

    var text = payload.message.trim();

    if (CRISIS_RE.test(text)) {
      return Promise.resolve({
        text: '你刚才说的话让我很担心你的安全。我没有能力判断或处理这种情况，但我希望你现在不要一个人扛。\n' +
          '下面这些渠道 24 小时都有人接，打过去不需要准备任何说辞。',
        tags: ['安全优先'],
        crisis: true,
        resources: CRISIS_RESOURCES,
        payload: payload
      });
    }

    var intent = null;
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(text)) { intent = INTENTS[i].key; break; }
    }
    if (!intent && text.length === 0) intent = 'greeting';

    var maker = REPLIES[intent] || REPLIES.fallback;
    var out = maker(payload.summary);
    out.crisis = false;
    out.resources = null;
    out.intent = intent || 'fallback';
    out.payload = payload;

    // 模拟一次本地服务往返，界面上会显示"服务处理中"
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(out); }, 260);
    });
  }

  /* ============================ 智能问答 ============================ */

  /**
   * 基于多来源上下文生成回答。
   * 入参同样会被严格裁剪：只保留问题、补充说明、上下文文本与已算好的事实条目。
   * @param {{question:string, customPrompt?:string, intent?:string, context:Object, facts:Array}} request
   */
  function generateAnswer(request) {
    var req = request || {};
    var payload = {
      question: String(req.question || '').slice(0, 1000),
      customPrompt: String(req.customPrompt || '').slice(0, 2000),
      intent: req.intent || 'summary',
      context: sanitizeContext(req.context),
      facts: (Array.isArray(req.facts) ? req.facts : []).slice(0, 12).map(sanitizeFact)
    };

    if (CRISIS_RE.test(payload.question)) {
      return Promise.resolve({
        text: '你刚才说的话让我很担心你的安全。我没有能力判断或处理这种情况，但我希望你现在不要一个人扛。\n下面这些渠道 24 小时都有人接。',
        tags: ['安全优先'], crisis: true, resources: CRISIS_RESOURCES, payload: payload
      });
    }

    var stats = payload.facts.filter(function (f) { return f.type === 'stat'; });
    var quotes = payload.facts.filter(function (f) { return f.type === 'quote'; });
    var lines = [];

    lines.push('基于本机检索与统计生成，未联网、未调用任何外部模型。');

    if (stats.length) {
      lines.push('');
      stats.forEach(function (s) { lines.push('· ' + s.text); });
    } else {
      lines.push('');
      lines.push('· 选中的来源里没有能直接计算的数值列，下面给出检索到的原文片段。');
    }

    if (quotes.length) {
      lines.push('');
      lines.push('相关原文片段：');
      quotes.forEach(function (q, i) {
        lines.push((i + 1) + '. 「' + q.text + '」 —— ' + q.source);
      });
    }

    lines.push('');
    if (!stats.length && !quotes.length) {
      lines.push('没能在选中的来源里找到与这个问题相关的证据。可以试试：换成更具体的关键词、勾选更多数据源，或在「补充说明」里告诉我每一列分别代表什么。');
    } else {
      lines.push('说明：以上结论只来自你勾选的数据源；数据源没有覆盖到的部分我不会凭空补充。涉及健康的问题不能替代专业判断。');
    }

    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          text: lines.join('\n'),
          mode: 'local',
          tags: ['本地检索', '统计推断'].concat(payload.context.usedSources.slice(0, 3)),
          crisis: false,
          payload: payload
        });
      }, 220);
    });
  }

  function sanitizeContext(c) {
    if (!c || typeof c !== 'object') return { text: '', usedSources: [], charCount: 0 };
    return {
      text: String(c.text || '').slice(0, 24000),
      usedSources: (Array.isArray(c.usedSources) ? c.usedSources : []).map(function (s) { return String(s).slice(0, 120); }),
      charCount: Number(c.charCount) || 0
    };
  }

  function sanitizeFact(f) {
    if (!f || typeof f !== 'object') return { type: 'quote', text: '', source: '' };
    return {
      type: f.type === 'stat' ? 'stat' : 'quote',
      text: String(f.text || '').slice(0, 400),
      source: String(f.source || '').slice(0, 120)
    };
  }

  /** 只保留摘要中的聚合字段，确保不含任何原始明细。 */
  function sanitizeSummary(s) {
    if (!s || typeof s !== 'object') return null;
    if (s.schema !== 'moodhub.summary/v1') return null;
    var out = { schema: s.schema, windowDays: s.windowDays, from: s.from, to: s.to, daysWithData: s.daysWithData, metrics: {} };
    ['mood', 'sleep', 'heartRate', 'stress'].forEach(function (k) {
      var m = s.metrics && s.metrics[k];
      if (!m) return;
      out.metrics[k] = {
        mean: m.mean,
        min: m.min,
        max: m.max,
        latest: m.latest,
        trend: m.trend ? { direction: m.trend.direction, changePerWeek: m.trend.changePerWeek, label: m.trend.label } : null
      };
    });
    return out;
  }

  MH.localService = {
    id: 'local-companion',
    endpoint: 'local://moodhub/companion',
    transport: 'in-process',
    description: '本页进程内的规则引擎，无网络出口；入参只接受最近 14 天统计摘要与当前这句话。',
    generateReply: generateReply,
    generateAnswer: generateAnswer,
    isCrisis: function (text) { return CRISIS_RE.test(String(text || '')); },
    resources: CRISIS_RESOURCES
  };

  MH.CRISIS_RESOURCES = CRISIS_RESOURCES;
})(MH);

