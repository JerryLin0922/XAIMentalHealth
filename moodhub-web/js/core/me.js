/* ------------------------------------------------------------------
   Me 层（.me）：让问答"认识你"的私人上下文。

   两部分：
     1) 人格画像 —— 五大人格模型（OCEAN）：开放性 / 尽责性 / 外倾性 /
        宜人性 / 神经质。只从你自己的提问与本机记录里推断，随样本累积
        以指数滑动平均收敛，样本越少置信度越低。
     2) 问答记忆 —— 保存用户与 AI 的每一轮问答，新问题进来时按相关度
        + 新鲜度召回若干轮，作为"历史对话"参与上下文组装。

   隐私约定：
     · 人格与记忆都只写本机 localStorage，不上传、不同步
     · 命中危机词的那一轮不写入记忆，也不参与人格推断
     · 「历史记忆」与「人格画像」是两个独立开关，可随时关掉；关掉后
       它们不再进入上下文，也不再被更新
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var MAX_TURNS = 200;            // 记忆最多保留的轮数（超出丢弃最旧）
  var MAX_ANSWER_CHARS = 4000;    // 单轮记忆里答案的最大长度
  var MEMORY_MAX_CHARS = 1500;    // 进入上下文的历史记忆字符上限
  var PERSONA_MAX_CHARS = 420;    // 进入上下文的人格画像字符上限
  var RECALL_HALF_LIFE_DAYS = 10; // 记忆新鲜度半衰期（天）

  /* ============================ 五大人格定义 ============================ */

  var TRAITS = [
    {
      key: 'openness', short: 'O', label: '开放性',
      desc: '对新解释、新方法的接受程度',
      high: '愿意看到多种解释与可能性，喜欢追问"为什么"',
      low: '更想要一个确定的结论，不喜欢绕'
    },
    {
      key: 'conscientiousness', short: 'C', label: '尽责性',
      desc: '计划性、规律性与对数据的重视',
      high: '看重计划、复盘与长期趋势，习惯用数据说话',
      low: '更随性，优先处理当下这一件事'
    },
    {
      key: 'extraversion', short: 'E', label: '外倾性',
      desc: '从外部互动中获得能量的倾向',
      high: '表达得多，常提到他人与社交场景',
      low: '偏内敛，文字短而克制，更多独处时刻'
    },
    {
      key: 'agreeableness', short: 'A', label: '宜人性',
      desc: '语气中的温和、体谅与合作倾向',
      high: '用词客气、顾及关系，倾向一起想办法',
      low: '直接、就事论事，不太绕弯子'
    },
    {
      key: 'neuroticism', short: 'N', label: '神经质',
      desc: '情绪波动与压力敏感度',
      high: '对压力、睡眠紊乱与情绪起伏更敏感',
      low: '情绪基线比较稳，波动小'
    }
  ];

  var TRAIT_MAP = {};
  TRAITS.forEach(function (t) { TRAIT_MAP[t.key] = t; });

  /* 词条 → 该维度的一次观测强度（-3 ~ +3）。
     只做倾向性描述，不做任何人格诊断，也不参与任何外发。 */
  var LEXICON = {
    openness: [
      [/为什么|原因|怎么会|怎么回事|原理|机制/, 2],
      [/好奇|探索|研究|学习|了解一下|深入/, 2],
      [/试试|尝试|换个|新方法|有没有别的/, 1.5],
      [/有意思|有趣|可能性|也许|或许|另一面/, 1.5],
      [/解读|解释|角度|背后|本质/, 1.5],
      [/比较|对比|差异|不同之处/, 1],
      [/只要结果|别解释|直接说结论|不用分析/, -2]
    ],
    conscientiousness: [
      [/计划|规律|打卡|坚持|习惯|作息/, 2],
      [/复盘|总结|回顾|统计|平均|趋势/, 2],
      [/目标|指标|进度|执行|步骤|清单/, 1.5],
      [/每周|每天|连续|长期|稳定地/, 1.5],
      [/整理|归档|记录|表格|数据/, 1],
      [/随便|无所谓|懒得|不想管/, -2]
    ],
    extraversion: [
      [/朋友|聚会|社交|聊天|聚一聚|约了/, 2],
      [/大家|同事|团队|一起|有人陪/, 1.5],
      [/出门|外面|热闹|分享|说说话/, 1.5],
      [/开心地|聊了很久|被夸|夸我/, 1],
      [/一个人|独处|不想说话|安静|躲起来/, -2],
      [/没人|孤独|寂寞|没人懂/, -1.5]
    ],
    agreeableness: [
      [/谢谢|感谢|麻烦你|辛苦了|拜托/, 2],
      [/请|可以吗|好不好|行吗|方便吗/, 1.5],
      [/一起|咱们|帮我|陪我|相互/, 1.5],
      [/理解|体谅|抱歉|不好意思|对不起/, 1.5],
      [/温和|慢慢|不着急|没关系/, 1],
      [/闭嘴|烦不烦|别废话|少管/, -2]
    ],
    neuroticism: [
      [/焦虑|担心|紧张|心慌|害怕|不安|慌/, 2.5],
      [/压力|崩溃|扛不住|受不了|失控|内耗/, 2.5],
      [/睡不好|失眠|早醒|多梦|睡不着/, 2],
      [/低落|难过|想哭|沮丧|情绪化|烦躁/, 2],
      [/反复|波动|忽高忽低|不稳定/, 1.5],
      [/平静|踏实|安心|放松|挺好|还行|稳定/, -2]
    ]
  };

  var METRIC_HINTS = {
    mood: ['心情', '情绪', '低落', '开心'],
    sleep: ['睡眠', '睡了', '失眠', '睡不好'],
    heartRate: ['心率', '心跳', 'bpm'],
    stress: ['压力', '紧张', '焦虑']
  };

  var STYLE_SHORT_RE = /简短|简洁|一句话|三句话|不要太长|简明|别啰嗦/;

  /** 当事人对一条假设给出评价后，这条假设在文案里该怎么自我介绍。 */
  var VERDICT_TEXT = {
    fits: '这一段你之前确认过：符合你的经验。',
    partial: '这一段你之前标记为「部分符合」，我已把它降权。',
    reject: '这一段你之前否掉过，我已经拉回中性并降了权重，不会再拿它当依据。'
  };
  var STYLE_STRUCT_RE = /分点|列点|要点|条理|结构化|清单|一二三|首先.*其次/;
  var NUMBER_RE = /\d/;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* ============================ 人格：读取与初始化 ============================ */

  function blankTrait(t) {
    return {
      key: t.key, label: t.label, short: t.short,
      score: 50,            // 0–100，50 = 中性基线
      confidence: 0,        // 0–1，随样本数增长
      samples: 0,
      evidence: []          // 最近几条支撑该判断的原话（最多 3 条，已截断）
    };
  }

  function blankPersonality() {
    var traits = {};
    TRAITS.forEach(function (t) { traits[t.key] = blankTrait(t); });
    return {
      schema: 'moodhub.me.personality/v1',
      model: 'OCEAN-5',
      updatedAt: 0,
      traits: traits,
      style: {
        prefersShort: false,
        prefersStructure: false,
        dataAffinity: 0,        // 0–1，提问里出现数字/统计词的频率
        avgQuestionChars: 0
      }
    };
  }

  function blankProfile() {
    return {
      schema: 'moodhub.me.profile/v1',
      nickname: '',
      focusMetrics: [],          // 常问的指标：mood / sleep / heartRate / stress
      topics: [],                // 最近关心的话题词（最多 8 个）
      updatedAt: 0
    };
  }

  /** 读取时补齐字段，兼容旧版本或半份数据。 */
  function normalizePersonality(p) {
    var base = blankPersonality();
    if (!p || typeof p !== 'object') return base;
    var out = {
      schema: base.schema,
      model: 'OCEAN-5',
      updatedAt: Number(p.updatedAt) || 0,
      traits: {},
      style: Object.assign({}, base.style, p.style || {})
    };
    TRAITS.forEach(function (t) {
      var src = (p.traits && p.traits[t.key]) || {};
      var n = Number(src.score);
      var cor = (src.correction && typeof src.correction === 'object') ? src.correction : null;
      out.traits[t.key] = {
        key: t.key, label: t.label, short: t.short,
        score: clamp(isFinite(n) ? n : 50, 0, 100),
        confidence: clamp(Number(src.confidence) || 0, 0, 1),
        samples: Math.max(0, Math.floor(Number(src.samples) || 0)),
        evidence: Array.isArray(src.evidence) ? src.evidence.slice(0, 3).map(function (s) { return String(s).slice(0, 60); }) : [],
        // 当事人对这条假设的评价（ null = 还没被评价过）
        correction: cor ? {
          verdict: cor.verdict === 'fits' || cor.verdict === 'partial' ? cor.verdict : 'reject',
          note: String(cor.note || '').slice(0, 200),
          at: Number(cor.at) || 0
        } : null
      };
    });
    out.style.prefersShort = !!out.style.prefersShort;
    out.style.prefersStructure = !!out.style.prefersStructure;
    out.style.dataAffinity = clamp(Number(out.style.dataAffinity) || 0, 0, 1);
    out.style.avgQuestionChars = Math.max(0, Number(out.style.avgQuestionChars) || 0);
    return out;
  }

  function normalizeProfile(p) {
    var base = blankProfile();
    if (!p || typeof p !== 'object') return base;
    return {
      schema: base.schema,
      nickname: String(p.nickname || '').slice(0, 24),
      focusMetrics: Array.isArray(p.focusMetrics) ? p.focusMetrics.slice(0, 4).map(String) : [],
      topics: Array.isArray(p.topics) ? p.topics.slice(0, 8).map(function (s) { return String(s).slice(0, 20); }) : [],
      updatedAt: Number(p.updatedAt) || 0
    };
  }

  var personality = {
    get: function () { return normalizePersonality(MH.store.me.personality.get()); },
    save: function (p) {
      var next = normalizePersonality(p);
      next.updatedAt = Date.now();
      MH.store.me.personality.set(next);
      return next;
    },
    reset: function () {
      var p = blankPersonality();
      p.updatedAt = Date.now();
      MH.store.me.personality.set(p);
      return p;
    },

    /** 从一段文字里抽取各维度的原始信号强度。 */
    signals: function (text) {
      var s = String(text || '');
      var out = {};
      if (!s) return out;
      Object.keys(LEXICON).forEach(function (trait) {
        var raw = 0;
        LEXICON[trait].forEach(function (pair) {
          if (pair[0].test(s)) raw += pair[1];
        });
        if (raw) out[trait] = raw;
      });
      return out;
    },

    /** 从本机记录的统计形态里抽取信号（不含任何单条明细）。 */
    signalsFromRecords: function (records) {
      if (!records || !records.length || !MH.stats) return {};
      var out = {};
      var days = {};
      var stressVals = [], moodVals = [];
      records.forEach(function (r) {
        days[r.date] = 1;
        if (r.stress != null && isFinite(r.stress)) stressVals.push(Number(r.stress));
        if (r.mood != null && isFinite(r.mood)) moodVals.push(Number(r.mood));
      });
      var dayCount = Object.keys(days).length;
      if (dayCount >= 10) out.conscientiousness = (out.conscientiousness || 0) + 1.5;   // 坚持记录本身
      var stress = U.mean(stressVals);
      if (stress != null) {
        if (stress >= 6.5) out.neuroticism = (out.neuroticism || 0) + 2;
        else if (stress <= 3.5) out.neuroticism = (out.neuroticism || 0) - 1.5;
      }
      var mood = U.mean(moodVals);
      if (mood != null) {
        if (mood <= 2.4) { out.neuroticism = (out.neuroticism || 0) + 1.5; out.extraversion = (out.extraversion || 0) - 1; }
        else if (mood >= 4) out.neuroticism = (out.neuroticism || 0) - 1;
      }
      return out;
    },

    /**
     * 用一次交互更新人格。
     * @param {string} text    用户这一次的输入（问题 + 补充说明）
     * @param {Array}  records 本机记录（可选，用于记录形态信号）
     */
    observe: function (text, records) {
      var p = personality.get();
      var sig = personality.signals(text);
      var rec = personality.signalsFromRecords(records);
      var s = String(text || '').trim();

      TRAITS.forEach(function (t) {
        var raw = (sig[t.key] || 0) + (rec[t.key] || 0);
        if (!raw) return;                                  // 没有信号就不动，避免被噪声拉回中性
        var target = clamp(50 + raw * 4.5, 2, 98);
        var tr = p.traits[t.key];
        tr.samples += 1;
        tr.confidence = Math.min(1, tr.samples / 20);
        // 置信度低时收敛快（早点有个大致判断），证据多了之后越来越稳
        var alpha = 0.34 - 0.2 * tr.confidence;
        tr.score = round1(clamp(tr.score + (target - tr.score) * alpha, 0, 100));
        if (s) {
          tr.evidence.unshift(s.slice(0, 40));
          if (tr.evidence.length > 3) tr.evidence.length = 3;
        }
      });

      // 沟通风格：只增不减，避免一次误判把偏好翻掉
      if (STYLE_SHORT_RE.test(s)) p.style.prefersShort = true;
      if (STYLE_STRUCT_RE.test(s)) p.style.prefersStructure = true;
      if (s.length) {
        p.style.avgQuestionChars = round1(p.style.avgQuestionChars
          ? p.style.avgQuestionChars * 0.8 + s.length * 0.2
          : s.length);
      }
      var digitHit = NUMBER_RE.test(s) ? 1 : 0;
      p.style.dataAffinity = round1(clamp(p.style.dataAffinity * 0.85 + digitHit * 0.15, 0, 1));

      return personality.save(p);
    },

    /** 分数 → 可读性档位。用「读数」而不是「你很……」。 */
    level: function (score) {
      if (score >= 66) return '偏高';
      if (score <= 34) return '偏低';
      return '中等';
    },

    /** 供界面渲染的五条维度。 */
    bars: function () {
      var p = personality.get();
      return TRAITS.map(function (t) {
        var tr = p.traits[t.key];
        return {
          key: t.key, label: t.label, short: t.short, desc: t.desc,
          score: tr.score, confidence: tr.confidence, samples: tr.samples,
          level: personality.level(tr.score),
          hint: tr.score >= 66 ? t.high : (tr.score <= 34 ? t.low : '两方面都有体现')
        };
      });
    },

    /** 依据的厚薄：攒到多少次信号，才配用多强的措辞。 */
    sampleBasis: function (n, confidence) {
      var pct = Math.round((confidence || 0) * 100);
      if (!n) {
        return { samples: 0, confidence: 'none', text: '依据：这一项还没有攒到任何信号，先留空。' };
      }
      if (n < 5) {
        return { samples: n, confidence: 'thin', text: '依据：只有 ' + n + ' 次信号（置信度 ' + pct + '%），够不上一句判断。' };
      }
      if ((confidence || 0) < 0.6) {
        return { samples: n, confidence: 'fair', text: '依据：' + n + ' 次信号（置信度 ' + pct + '%），方向可以提，不要写成结论。' };
      }
      return {
        samples: n, confidence: 'solid',
        text: '依据：' + n + ' 次信号（置信度 ' + pct + '%）。样本够了，但它仍然只来自你的提问文字与本机读数。'
      };
    },

    /**
     * 把一条人格读数写成「可修正的假设」，三档 + 证据 + 推理边界。
     * @param {Object} t  维度定义
     * @param {Object} tr 该维度的当前状态
     */
    hypothesis: function (t, tr) {
      var pct = Math.round((tr.confidence || 0) * 100);
      var lean = tr.score >= 66 ? t.high : (tr.score <= 34 ? t.low : '两方面都有体现');
      var basis = personality.sampleBasis(tr.samples, tr.confidence);

      var short = t.label + '读数' + personality.level(tr.score) + '（' + pct + '% 置信度）';
      if (tr.samples < 3) short = t.label + '：样本太少，暂时不读';

      var medium = '如果你的提问与本机记录能代表你，那么你的「' + t.label + '」读数' +
        personality.level(tr.score) + '：' + lean + '。' +
        '这是从 ' + tr.samples + ' 次信号里长出来的假设，不是对你的定性。';

      var longParts = [medium, basis.text];
      if (tr.evidence && tr.evidence.length) {
        longParts.push('我读到的是这些话：' + tr.evidence.map(function (s) { return '「' + s + '」'; }).join('，'));
      }
      longParts.push('可能跑偏的地方：这个读数只反映你「问了什么、怎么问」，反映不了你为什么那样问；' +
        '换一个生活阶段、换一种心情，同一个人的这条线会漂。');
      if (tr.correction) {
        longParts.push(VERDICT_TEXT[tr.correction.verdict] + (tr.correction.note ? '你当时的说明是「' + tr.correction.note + '」。' : ''));
      }

      return {
        key: t.key, label: t.label, short: t.short, desc: t.desc,
        score: tr.score, confidence: tr.confidence, samples: tr.samples,
        level: personality.level(tr.score), hint: lean, basis: basis,
        correction: tr.correction || null,
        xai: MH.xai.compose({
          short: short,
          medium: medium,
          long: longParts.join('\n\n'),
          evidence: tr.evidence || [],
          basis: basis,
          tags: [t.label, '假设']
        }, { level: MH.xai.defaultLevel() })
      };
    },

    /** 五个维度各自的 XAI 解释，供界面逐条展示与逐条校正。 */
    hypotheses: function () {
      var p = personality.get();
      return TRAITS.map(function (t) { return personality.hypothesis(t, p.traits[t.key]); });
    },

    /**
     * 当事人对某一条读数的评价。这决定了这条假设以后怎么被对待：
     *   fits      —— 保留，置信度略微上调
     *   partial   —— 保留但降权
     *   reject    —— 往中性拉回、砍半置信度，并在文案里承认它被推翻
     */
    correct: function (key, verdict, note) {
      var p = personality.get();
      var tr = p.traits[key];
      if (!tr) return null;
      var v = verdict === 'fits' || verdict === 'partial' ? verdict : 'reject';

      if (v === 'reject') {
        tr.score = round1(clamp(tr.score + (50 - tr.score) * 0.5, 0, 100));
        tr.confidence = clamp(tr.confidence * 0.5, 0, 1);
      } else if (v === 'partial') {
        tr.confidence = clamp(tr.confidence * 0.8, 0, 1);
      } else {
        tr.confidence = clamp(tr.confidence * 1.1, 0, 1);
      }
      tr.correction = { verdict: v, note: String(note || '').slice(0, 200), at: Date.now() };
      personality.save(p);

      if (MH.store && MH.store.xai) {
        MH.store.xai.append({
          target: 'personality:' + key,
          verdict: v,
          level: 'medium',
          excerpt: tr.label + '读数' + personality.level(tr.score),
          note: note
        });
      }
      return tr;
    },

    /** 组装成给模型看的人格画像文本（不含任何原始记录）。 */
    describeText: function () {
      var p = personality.get();
      var st = p.style;
      var lines = [
        '【用户画像 · 本机推断的五大人格（OCEAN）】',
        '用法限制（必须遵守）：这只是从他/她的提问与本机读数里长出来的暂定假设，' +
        '用来调整语气与侧重；不要把它们写成对当事人的定性，不要说「你就是这样的人」「你性格 XX」，' +
        '也不要据此外推到健康或能力。若当事人的自述与这里相反，以当事人的自述为准。'
      ];
      TRAITS.forEach(function (t) {
        var tr = p.traits[t.key];
        var pct = Math.round((tr.confidence || 0) * 100);
        var lean = tr.score >= 66 ? t.high : (tr.score <= 34 ? t.low : '两方面都有体现');
        if (!tr.samples) {
          lines.push('- ' + t.label + '（' + t.short + '）：暂无信号，不要推测这一项。');
          return;
        }
        lines.push('- ' + t.label + '（' + t.short + '）读数' + Math.round(tr.score) + '/100，' +
          personality.level(tr.score) + '，置信度 ' + pct + '%：倾向于' + lean +
          '（记为假设，非定性）');
        if (tr.correction) lines.push('  　当事人曾评价这条：' + VERDICT_TEXT[tr.correction.verdict]);
      });
      var prefs = [];
      if (st.prefersShort) prefs.push('偏好简短回答');
      if (st.prefersStructure) prefs.push('偏好分点 / 结构化');
      if (st.dataAffinity >= 0.5) prefs.push('经常提到具体数字，回答时给出数值更有帮助');
      var prof = profile.get();
      if (prof.focusMetrics && prof.focusMetrics.length) {
        var labels = prof.focusMetrics.map(function (k) {
          var m = MH.metrics ? MH.metrics.get(k) : null;
          return m ? m.label : k;
        });
        prefs.push('常问的指标：' + labels.join('、'));
      }
      if (prefs.length) lines.push('- 沟通偏好：' + prefs.join('；'));
      var text = lines.join('\n');
      return text.length > PERSONA_MAX_CHARS ? text.slice(0, PERSONA_MAX_CHARS) + '…' : text;
    }
  };

  /* ============================ 用户画像 ============================ */

  var profile = {
    get: function () { return normalizeProfile(MH.store.me.profile.get()); },
    save: function (p) {
      var next = normalizeProfile(p);
      next.updatedAt = Date.now();
      MH.store.me.profile.set(next);
      return next;
    },
    /** 从一次提问里累计"常问指标"。 */
    observe: function (text) {
      var p = profile.get();
      var s = String(text || '');
      if (!s) return p;
      Object.keys(METRIC_HINTS).forEach(function (key) {
        var hit = METRIC_HINTS[key].some(function (w) { return s.indexOf(w) >= 0; });
        if (hit && p.focusMetrics.indexOf(key) < 0) p.focusMetrics.push(key);
      });
      return profile.save(p);
    },
    setNickname: function (name) {
      var p = profile.get();
      p.nickname = String(name || '').slice(0, 24);
      return profile.save(p);
    },
    reset: function () { MH.store.me.profile.set(blankProfile()); return profile.get(); }
  };

  /* ============================ 问答记忆 ============================ */

  var memory = {
    all: function () { return MH.store.me.memory.all(); },

    count: function () { return memory.all().length; },

    /**
     * 写入一轮问答。
     * @param {Object} turn {question, answer, customPrompt, usedSources, intent, model, contextChars}
     */
    append: function (turn) {
      var t = turn || {};
      var list = memory.all();
      var model = t.model || {};
      var item = {
        id: t.id || U.uid(),
        at: t.at || Date.now(),
        question: String(t.question || '').slice(0, 500),
        answer: String(t.answer || '').slice(0, MAX_ANSWER_CHARS),
        customPrompt: String(t.customPrompt || '').slice(0, 300),
        sources: Array.isArray(t.usedSources) ? t.usedSources.slice(0, 6).map(String) : [],
        intent: String(t.intent || ''),
        modelId: String(model.id || ''),
        privacy: String(model.privacy || 'on-device'),
        contextChars: Number(t.contextChars) || 0
      };
      if (!item.question && !item.answer) return null;
      list.push(item);
      if (list.length > MAX_TURNS) list = list.slice(-MAX_TURNS);
      MH.store.me.memory.save(list);
      return item;
    },

    recent: function (n) {
      var list = memory.all().slice().reverse();
      return n ? list.slice(0, n) : list;
    },

    /** 相关度（词面重合）+ 新鲜度（指数衰减）召回历史轮次。 */
    search: function (question, k) {
      var q = String(question || '').trim();
      if (!q || !MH.retriever) return [];
      var qSet = {};
      MH.retriever.tokenize(q).forEach(function (t) { qSet[t] = 1; });
      var qKeys = Object.keys(qSet);
      if (!qKeys.length) return [];

      var scored = memory.all().map(function (t) {
        var toks = MH.retriever.tokenize(t.question + ' ' + String(t.answer || '').slice(0, 600));
        var hit = 0;
        toks.forEach(function (x) { if (qSet[x]) hit++; });
        var sim = hit / Math.sqrt(toks.length || 1);
        var ageDays = (Date.now() - (t.at || 0)) / 86400000;
        var fresh = Math.exp(-Math.max(0, ageDays) / RECALL_HALF_LIFE_DAYS);
        return { turn: t, score: sim * 3 + fresh * 0.6, sim: sim, fresh: fresh };
      });

      // 只有字面上真的有交集的轮次才召回；新鲜度只用来在同等相关度之间排序
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.filter(function (s) { return s.sim > 0; }).slice(0, k || 3);
    },

    /**
     * 把召回的历史轮次拼成一段可放进上下文的文本。
     * @returns {{text:string, turns:Array, charCount:number}}
     */
    context: function (question, maxTurns, maxChars) {
      var limit = maxChars || MEMORY_MAX_CHARS;
      var hits = memory.search(question, maxTurns || 3);
      if (!hits.length) return { text: '', turns: [], charCount: 0 };

      var head = '【历史对话记忆】这些是你之前问过、与本次相关的问答。只用于保持前后一致，不要当作新的数据来源：\n';
      var parts = [];
      var total = head.length;
      var used = [];

      hits.forEach(function (h, i) {
        var t = h.turn;
        var date = t.at ? U.toISODate(new Date(t.at)) : '';
        var q = String(t.question || '').slice(0, 120);
        var a = String(t.answer || '').replace(/\s+/g, ' ').slice(0, 220);
        var line = (i + 1) + ') ' + (date ? date + ' ' : '') + '问：' + q + '\n   答：' + a;
        if (total + line.length > limit) return;
        parts.push(line);
        total += line.length + 1;
        used.push({
          id: t.id, at: t.at, question: t.question, answer: a,
          score: Math.round(h.score * 100) / 100
        });
      });

      if (!parts.length) return { text: '', turns: [], charCount: 0 };
      return { text: head + parts.join('\n'), turns: used, charCount: total };
    },

    stats: function () {
      var list = memory.all();
      if (!list.length) return { count: 0, firstAt: null, lastAt: null, chars: 0 };
      var chars = list.reduce(function (n, t) { return n + String(t.question || '').length + String(t.answer || '').length; }, 0);
      return { count: list.length, firstAt: list[0].at, lastAt: list[list.length - 1].at, chars: chars };
    },

    clear: function () { MH.store.me.memory.clear(); }
  };

  /* ============================ 开关 ============================ */

  function settings() {
    var p = MH.store.prefs.get();
    return {
      useMemory: p.meUseMemory !== false,
      usePersona: p.meUsePersona !== false,
      memoryTurns: Math.max(1, Math.min(8, Number(p.meMemoryTurns) || 3))
    };
  }

  function setSettings(patch) {
    return MH.store.prefs.set({
      meUseMemory: !!patch.useMemory,
      meUsePersona: !!patch.usePersona,
      meMemoryTurns: Math.max(1, Math.min(8, Number(patch.memoryTurns) || 3))
    });
  }

  /* ============================ 一次问答的完整回写 ============================ */

  /**
   * 问答结束后调用：写记忆 + 更新人格与画像。
   * 危机轮次会直接跳过（不落记忆、不参与人格推断）。
   */
  function record(o) {
    var req = o || {};
    var question = String(req.question || '');
    var answer = String(req.answer || '');
    if (!question || !answer) return { recorded: false, reason: 'EMPTY' };
    if (MH.localService && MH.localService.isCrisis && MH.localService.isCrisis(question)) {
      return { recorded: false, reason: 'CRISIS' };
    }

    var s = settings();
    var item = memory.append({
      question: question,
      answer: answer,
      customPrompt: req.customPrompt,
      usedSources: req.usedSources,
      intent: req.intent,
      model: req.model,
      contextChars: req.contextChars
    });

    var persona = null, prof = null;
    if (s.usePersona) {
      persona = personality.observe(question + (req.customPrompt ? ' ' + req.customPrompt : ''), req.records);
      prof = profile.observe(question);
    }

    return {
      recorded: !!item,
      reason: 'OK',
      turnId: item ? item.id : null,
      memoryCount: memory.count(),
      personaUpdated: !!persona,
      profile: prof
    };
  }

  /* ============================ 导出 / 导入（对齐 .me 目录） ============================ */

  function exportMe() {
    var list = memory.all();
    return {
      schema: 'moodhub.me/v1',
      exportedAt: new Date().toISOString(),
      model: 'OCEAN-5',
      personality: personality.get(),
      profile: profile.get(),
      memory: {
        index: {
          schema: 'moodhub.me.memory/v1',
          turnCount: list.length,
          firstAt: list.length ? list[0].at : null,
          lastAt: list.length ? list[list.length - 1].at : null,
          chars: memory.stats().chars
        },
        turns: list
      }
    };
  }

  /**
   * 导入 .me 数据。
   * @param {Object} payload 导出结构
   * @param {string} mode    merge（默认，按时间合并去重）| replace
   */
  function importMe(payload, mode) {
    var p = payload || {};
    if (!p || typeof p !== 'object' || (!p.personality && !p.memory)) {
      throw new Error('文件格式不正确：缺少 personality 或 memory 字段');
    }

    if (p.personality) {
      if (mode === 'replace') personality.save(p.personality);
      else {
        var cur = personality.get();
        var inc = normalizePersonality(p.personality);
        // 合并策略：样本多的那一侧胜出，避免小样本覆盖长期积累
        TRAITS.forEach(function (t) {
          var a = cur.traits[t.key], b = inc.traits[t.key];
          if (b.samples > a.samples) cur.traits[t.key] = b;
        });
        cur.style = Object.assign({}, inc.style, {
          prefersShort: !!(cur.style.prefersShort || inc.style.prefersShort),
          prefersStructure: !!(cur.style.prefersStructure || inc.style.prefersStructure)
        });
        personality.save(cur);
      }
    }

    if (p.profile && (mode === 'replace' || !profile.get().focusMetrics.length)) {
      profile.save(p.profile);
    }

    var turns = (p.memory && Array.isArray(p.memory.turns)) ? p.memory.turns : [];
    if (turns.length) {
      var list = mode === 'replace' ? [] : memory.all();
      var seen = {};
      list.forEach(function (t) { seen[t.id] = 1; });
      turns.forEach(function (t) {
        if (!t || seen[t.id]) return;
        seen[t.id] = 1;
        list.push({
          id: t.id || U.uid(),
          at: Number(t.at) || Date.now(),
          question: String(t.question || '').slice(0, 500),
          answer: String(t.answer || '').slice(0, MAX_ANSWER_CHARS),
          customPrompt: String(t.customPrompt || '').slice(0, 300),
          sources: Array.isArray(t.sources) ? t.sources.slice(0, 6).map(String) : [],
          intent: String(t.intent || ''),
          modelId: String(t.modelId || ''),
          privacy: String(t.privacy || 'on-device'),
          contextChars: Number(t.contextChars) || 0
        });
      });
      list.sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
      if (list.length > MAX_TURNS) list = list.slice(-MAX_TURNS);
      MH.store.me.memory.save(list);
    }

    return { memoryCount: memory.count(), personality: personality.get() };
  }

  function clearAll() {
    personality.reset();
    profile.reset();
    memory.clear();
  }

  MH.me = {
    MODEL: 'OCEAN-5',
    TRAITS: TRAITS,
    TRAIT_MAP: TRAIT_MAP,
    MAX_TURNS: MAX_TURNS,
    MEMORY_MAX_CHARS: MEMORY_MAX_CHARS,
    PERSONA_MAX_CHARS: PERSONA_MAX_CHARS,
    personality: personality,
    profile: profile,
    memory: memory,
    settings: settings,
    setSettings: setSettings,
    record: record,
    exportMe: exportMe,
    importMe: importMe,
    clearAll: clearAll,
    blankPersonality: blankPersonality,
    blankProfile: blankProfile
  };
})(window.MH = window.MH || {});
