/* ------------------------------------------------------------------
   以人为中心的解释层（Human-Centered XAI）

   一句话立场：AI 是一面允许被纠正的镜子，不是给人下定义的法官。

   从这里流出的每一段「关于这个人」的文本，都受四条约束：

     1 准确性 accuracy    —— 只描述记录支持的关联，不写成因、不做定性；
                             拿不准就把拿不准说出来。
     2 可读性 readability —— 同一份内容给 短 / 中 / 长 三个入口：
                             复杂照旧复杂，但不强迫人一次读完。
     3 个人性 personal    —— 抽象看法必须挂在一次具体经历上，
                             不许悬在半空中充当道理。
     4 主体性 agency      —— 解释永远是可修正的假设，
                             并且由 AI 主动请求当事人校正。

   DOM 无关，可被小程序内核与桌面端直接复用。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var LEVELS = ['short', 'medium', 'long'];

  var LEVEL_META = {
    short: { label: '短', hint: '一句话版本：只<｜hy_place▁holder▁no▁813｜>结论，先看它在不在点上' },
    medium: { label: '中', hint: '标准版本：结论 + 依据 + 一件可以做的事' },
    long: { label: '长', hint: '展开版本：把推论摊开，包括证据、推理缺口和可能跑偏的地方' }
  };

  /** 用户要求的标准姿态：先声明来源，再请求校正。 */
  var REFLECTION =
    '根据这些记录，我形成了这一解释。哪些部分符合你的经验，哪些部分不符合？你说一句，我就改写它。';
  var REFLECTION_SHORT = '这符合你的经验吗？';

  function trim(s) { return String(s == null ? '' : s).trim(); }

  /* ==================================================================
     一、准确性：把断言改写成有证据支持的关联性表述

     规则只做「降调」，不改事实本身：
       定性 → 暂时理解 /  trend evidence
       病理 → 需要专业判断
       因果 → 时间上的伴随
       全称 → 这批记录里的多数时候
     ================================================================== */

  var ACCURACY_RULES = [
    // 贴标签、下定义
    {
      re: /你就是这样的人|你就是这种人|你这个人就是这样|你本质上就是这样|你天生就是这样/g,
      to: '如果只看这批记录，我暂时把你理解为', note: 'identity'
    },
    // 全称量词
    {
      re: /你一定(是|会|有)?([^，。！？；\n]{1,16})/g,
      to: '这批记录更指向「$2」这种读法', note: 'absolute'
    },
    {
      re: /你肯定(是|会|有)?([^，。！？；\n]{1,16})/g,
      to: '这批记录里反复出现「$2」的迹象', note: 'absolute'
    },
    {
      re: /你必然(是|会|有)?([^，。！？；\n]{1,16})/g,
      to: '按这个走势，接下来更可能$2', note: 'absolute'
    },
    {
      re: /你(总是|从来都|从来不|每次都)/g,
      to: '你在这批记录里多数时候', note: 'absolute'
    },
    {
      re: /(百分之百|绝对是|毫无疑问|铁定是)/g,
      to: '在这批记录的范围内', note: 'absolute'
    },
    // 不能由趋势得出的病理判断
    {
      re: /你(得了|患了|有)(抑郁症|焦虑症|躁郁症|双相情感障碍|强迫症|多动症|ADHD|注意力缺陷)/g,
      to: '这些表现与$2有重叠，但$2只有专业人员能判断', note: 'diagnosis'
    },
    // 因果 → 伴随
    {
      re: /因为你是([^，。！？；\n]{2,12})，所以/g,
      to: '在与$1相关的那些天里，往往同时', note: 'cause'
    },
    {
      re: /([\u4e00-\u9fa5]{2,8})导致(了?你?[\u4e00-\u9fa5]{2,10})/g,
      to: '$1与$2在时间上常常一起出现', note: 'cause'
    },
    {
      re: /(这说明|这证明|证明了|恰恰说明)(你)/g,
      to: '一种可能的解释是$2', note: 'inference'
    },
    {
      re: /(.{0,6})(让你|使你)(变得)?([^，。！？；\n]{2,10})/g,
      to: '$1 $2同时出现了$4的状态', note: 'cause'
    }
  ];

  /**
   * 对一段已经写好的文本做降调处理。
   * 幂等：重复调用不会产生额外的改动。
   * @param {string} text
   * @param {{invite?:boolean, short?:boolean}} [opts]
   * @returns {string}
   */
  function humanize(text, opts) {
    var out = trim(text);
    if (!out) return '';
    ACCURACY_RULES.forEach(function (r) {
      out = out.replace(r.re, r.to);
    });
    if (opts && opts.invite) out = withInvitation(out, opts);
    return out;
  }

  /** 与 humanize 相同，但额外报告命中了哪几条约束，供测试与自查使用。 */
  function audit(text) {
    var out = trim(text);
    var hits = [];
    ACCURACY_RULES.forEach(function (r) {
      var before = out;
      out = out.replace(r.re, r.to);
      if (out !== before && hits.indexOf(r.note) < 0) hits.push(r.note);
    });
    return { text: out, hits: hits };
  }

  var INVITE_RE = /(符合你的经验|你怎么看|你说一句|准不准|像不像|你怎么理解|你说了算)/;

  /** 主体性：一段面向当事人的解释，结尾必须是请求校正，而不是结论。 */
  function withInvitation(text, opts) {
    var out = trim(text);
    if (!out) return '';
    if (INVITE_RE.test(out)) return out;
    // 危机 / 求助资源类文本不加请求，避免把注意力从安全上挪走
    if (/热线|120|报警|专业人员|危机/.test(out) && out.length < 60) return out;
    return out + '\n\n' + ((opts && opts.short) ? REFLECTION_SHORT : REFLECTION);
  }

  /* ==================================================================
     二、证据强度：样本撑得起什么级别的说法
     ================================================================== */

  /**
   * 根据「窗口天数 / 有记录天数」给出依据说明。
   * @returns {{days:number, windowDays:number, confidence:'none'|'thin'|'fair'|'solid', text:string}}
   */
  function basis(daysWithData, windowDays) {
    var w = Number(windowDays) || 14;
    var d = Number(daysWithData) || 0;
    if (d <= 0) {
      return {
        days: 0, windowDays: w, confidence: 'none',
        text: '依据：最近 ' + w + ' 天还没有任何记录，所以下面说的只来自你刚刚这句话，不当读数。'
      };
    }
    if (d < 5) {
      return {
        days: d, windowDays: w, confidence: 'thin',
        text: '依据：最近 ' + w + ' 天里只有 ' + d + ' 天有记录。样本很薄，只够当一个线索，够不上判断。'
      };
    }
    if (d < w * 0.7) {
      return {
        days: d, windowDays: w, confidence: 'fair',
        text: '依据：最近 ' + w + ' 天里 ' + d + ' 天有记录。方向可以看，个别天的起伏还担不起结论。'
      };
    }
    return {
      days: d, windowDays: w, confidence: 'solid',
      text: '依据：最近 ' + w + ' 天里 ' + d + ' 天有记录。这个密度能支撑方向性的说法，仍然支撑不了「你是什么样的人」。'
    };
  }

  /** 证据强度对应的措辞强度（越薄越保守）。 */
  function strength(confidence) {
    switch (confidence) {
      case 'none': return { verb: '先不读', hedge: '没有数据，我不猜' };
      case 'thin': return { verb: '只能说是线索', hedge: '目前更像一个迹象' };
      case 'fair': return { verb: '记录倾向于', hedge: '还不能当成定论' };
      default: return { verb: '记录比较一致地指向', hedge: '但仍不是结论' };
    }
  }

  /**
   * 关联性表述：把「A 引起 B」改成「A 与 B 在这些日子里常常同向」。
   * @param {string} a 前项描述，如「睡眠不足 6 小时」
   * @param {string} b 后项描述，如「压力偏高」
   * @param {{days?:number}} [opts]
   */
  function association(a, b, opts) {
    var n = (opts && opts.days) || 0;
    var tail = n > 0 ? '（在你已记录的日子里，两项同向出现 ' + n + ' 次）' : '';
    return trim(a) + '的那些天里，' + trim(b) + '也更常见' + tail + '——这里说的是伴随，不等于谁引起谁。';
  }

  /* ==================================================================
     三、可读性：短 / 中 / 长 三档
     ================================================================== */

  function firstSentence(text) {
    var t = trim(text);
    if (!t) return '';
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (c === '\n') return t.slice(0, i);
      if (c === '。' || c === '！' || c === '？' || c === '；') return t.slice(0, i + 1);
    }
    return t;
  }

  function firstParagraphs(text, n) {
    var ps = trim(text).split(/\n{2,}/).filter(Boolean);
    return ps.slice(0, n).join('\n\n');
  }

  /** 补全三档：缺哪一档就用相邻档推导，保证三者都非空。 */
  function normalizeLayers(spec) {
    var s = trim(spec && spec.short);
    var m = trim(spec && spec.medium);
    var l = trim(spec && spec.long);
    if (!l) l = m || s;
    if (!m) m = s || firstParagraphs(l, 2) || l;
    if (!s) s = firstSentence(m) || firstSentence(l);
    return { short: s, medium: m, long: l };
  }

  function levelOf(v) {
    return LEVELS.indexOf(v) >= 0 ? v : 'medium';
  }

  /** 默认阅读层次：跟随用户偏好，偏好缺失时落在「中」。 */
  function defaultLevel() {
    try {
      if (MH.store && MH.store.prefs) {
        return levelOf(MH.store.prefs.get().xaiLevel);
      }
    } catch (e) { /* 无存储环境（如小程序冷启动）→ 走默认值 */ }
    return 'medium';
  }

  function levelMeta(level) { return LEVEL_META[levelOf(level)]; }

  /* ==================================================================
     四、个人性：抽象观点必须挂在一次具体经历上
     ================================================================== */

  /**
   * 把一个抽象说法拆成「一次可能的具体样子」。
   * @param {string} point   抽象观点，如「低落不需要被马上赶走」
   * @param {string} detail  落到今天的具体场景
   */
  function personalize(point, detail) {
    var p = trim(point), d = trim(detail).replace(/[。.]+$/, '');
    if (!d) return p;
    if (!p) return d + '。';
    return '「' + p + '」这句话太空了，把它放回今天可能长这样：' + d + '。';
  }

  /* ==================================================================
     五、主体性：上一版被推翻的解释，不许悄悄复活
     ================================================================== */

  function feedbackStore() {
    try { return MH.store && MH.store.xai ? MH.store.xai : null; }
    catch (e) { return null; }
  }

  /**
   * 读取近期被用户判为「不符合」的解释，生成一句承认。
   * 返回 null 表示没有需要道歉的事。
   */
  function revisionNote() {
    var store = feedbackStore();
    if (!store || !store.rejections) return null;
    var list = store.rejections(3);
    if (!list.length) return null;
    var last = list[0];
    var head = '先交代一句：之前有 ' + list.length + ' 条解释被你标记为不符合，那些读法我已经放下，不会换个说法再搬回来。';
    return last && last.note
      ? head + '\n你当时的说明是「' + trim(last.note) + '」，这一版我会绕开它。'
      : head;
  }

  /* ==================================================================
     六、组装
     ================================================================== */

  /**
   * 把一段结构化规格组装成可交付的解释对象。
   *
   * @param {Object} spec
   *   short    {string} 一句话版本
   *   medium   {string} 标准版本
   *   long     {string} 展开版本（含推理与不确定）
   *   evidence {string[]} 依据条目：具体是哪几个数、哪一句话
   *   basis    {Object}  MH.xai.basis() 的返回值
   *   revision {string}  请求校正的话（缺省用标准姿态）
   *   tags     {string[]}
   * @param {{level?:string}} [opts]
   * @returns {{schema:string, short:string, medium:string, long:string,
   *            level:string, text:string, evidence:string[], basis:Object|null,
   *            revision:string, tags:string[]}}
   */
  function compose(spec, opts) {
    var s = spec || {};
    var L = normalizeLayers(s);
    var level = levelOf((opts && opts.level) || s.level || defaultLevel());

    var out = {
      schema: 'moodhub.xai/v1',
      short: humanize(L.short),
      medium: humanize(L.medium),
      long: humanize(L.long),
      level: level,
      evidence: (Array.isArray(s.evidence) ? s.evidence : []).filter(Boolean)
        .map(function (e) { return trim(e); }).slice(0, 8),
      basis: s.basis || null,
      revision: trim(s.revision) || REFLECTION,
      tags: Array.isArray(s.tags) ? s.tags.slice(0, 8) : []
    };
    out.text = flatten(out, level);
    return out;
  }

  /**
   * 把解释对象压平成一段纯文本（带依据与请求校正），
   * 给不支持分层的端（日志导出、分享、兜底渲染）使用。
   */
  function flatten(ex, level) {
    if (!ex) return '';
    var lv = levelOf(level || ex.level);
    var parts = [ex[lv] || ex.medium || ''];
    if (ex.basis && ex.basis.text) parts.push(ex.basis.text);
    if (ex.evidence && ex.evidence.length) {
      parts.push('我依据的是：\n' + ex.evidence.map(function (e) { return '· ' + e; }).join('\n'));
    }
    if (ex.revision) parts.push(ex.revision);
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * 给没有天然分层的自由文本（典型是云端模型的输出）补出三档。
   * 做减法而不是加法：短档取首句，中档取前两段，长档保留全文。
   */
  function fromProse(text, opts) {
    var t = trim(text);
    if (!t) return null;
    var paras = t.split(/\n{2,}/).filter(Boolean);
    var o = opts || {};
    var sec = o.sections || parseSections(t);
    return compose(sec || {
      short: firstSentence(t),
      medium: paras.length > 2 ? firstParagraphs(t, 2) : t,
      long: t
    }, o);
  }

  /* ---------- 识别云端模型输出的三档标记 ---------- */

  var KEY_OF = { '短': 'short', '中': 'medium', '长': 'long' };

  /** 标题独占一行：### **短版** / - 中档： */
  var SOLO_RE = /^(?:#{1,6}\s*)?(?:[-*+>]\s*)?(?:\*\*|__)?\s*(短|中|长)\s*(?:版本|档|版)?\s*(?:\*\*|__)?\s*[:：]?\s*$/;
  /** 标题与正文同一行：短：先别急着怪自己。 */
  var INLINE_RE = /^(?:#{1,6}\s*)?(?:[-*+>]\s*)?(?:\*\*|__)?\s*(短|中|长)\s*(?:版本|档|版)?\s*(?:\*\*|__)?\s*[:：]\s*(.+)$/;

  /**
   * 试着把带「短 / 中 / 长」标记的文本拆成三档。
   * 至少出现两个标记才算识别成功，避免把正文中偶然的「中：」误当结构。
   * @returns {{short:string, medium:string, long:string}|null}
   */
  function parseSections(text) {
    var lines = trim(text).split(/\n/);
    var buckets = { short: [], medium: [], long: [] };
    var cur = null;
    var matched = 0;

    lines.forEach(function (raw) {
      var line = raw.replace(/^[\s>]+/, '');
      var inline = line.match(INLINE_RE);
      if (inline) {
        var ik = KEY_OF[inline[1]];
        buckets[ik].push(inline[2]);
        matched++;
        cur = null;
        return;
      }
      var solo = line.match(SOLO_RE);
      if (solo) {
        cur = KEY_OF[solo[1]];
        matched++;
        return;
      }
      if (cur) buckets[cur].push(raw);
    });

    if (matched < 2) return null;
    return {
      short: buckets.short.join('\n').trim(),
      medium: buckets.medium.join('\n').trim(),
      long: buckets.long.join('\n').trim()
    };
  }

  /** 云端 / 自由文本 → 解释对象。优先认结构化分档，其次退回首句 / 前两段。 */
  function explainProse(text, opts) {
    var o = opts || {};
    var derived = fromProse(text, o);
    if (!derived) return null;
    derived.evidence = (o.evidence || []).slice(0, 8);
    derived.basis = o.basis || null;
    if (o.tags && o.tags.length) derived.tags = o.tags.slice(0, 8);
    derived.text = flatten(derived, derived.level);
    return derived;
  }

  MH.xai = {
    LEVELS: LEVELS,
    LEVEL_META: LEVEL_META,
    REFLECTION: REFLECTION,
    REFLECTION_SHORT: REFLECTION_SHORT,

    // 一、准确性
    humanize: humanize,
    audit: audit,
    association: association,
    basis: basis,
    strength: strength,

    // 二、可读性
    normalizeLayers: normalizeLayers,
    firstSentence: firstSentence,
    levelOf: levelOf,
    levelMeta: levelMeta,
    defaultLevel: defaultLevel,
    flatten: flatten,
    fromProse: fromProse,
    parseSections: parseSections,
    explainProse: explainProse,

    // 三、个人性
    personalize: personalize,

    // 四、主体性
    withInvitation: withInvitation,
    revisionNote: revisionNote,

    // 组装
    compose: compose
  };
})(window.MH = window.MH || {});
