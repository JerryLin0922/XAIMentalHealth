/* ------------------------------------------------------------------
   AI 引导式学习（Guided Learning）内核

   一句话立场：情绪是一个信号，不是一个故障。这里只做三件事——
   给它一个名字、读出它可能指向的需要、把一个问题和一件小事留给人自己。

   约束（与 xai.js 同等）：
     1. DOM 无关 —— 不引用 document / window / localStorage / MH.util.toast；
     2. 无网络出口 —— 全文不含 fetch / XMLHttpRequest / MH.models，
        正文一律由本地模板生成，可被 code review 直接验证；
     3. 可被小程序内核与桌面端直接复用 —— 因此所有判定都收在纯函数里，
        视图只调用 tryAuto / tryManual 两个编排入口。

   副作用只出现在 state / patch / record / decline / disableAuto / reset 六个函数里，
   且全部用 try/catch 包裹（store 可能未初始化）。其余函数同输入必同输出。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var SCHEMA = 'moodhub.guided/v1';

  /* ==================================================================
     一、常量：情绪族表 / 模板 / 阈值 / 全局文案
     ================================================================== */

  /**
   * 情绪族表。数组顺序即「同分裁决顺序」，不可随意调整（PRD §8.9）。
   *   words —— 用于「同一族命中词 ≥ 2 个」的加分与依据区展示；
   *            禁止出现裸单字（烦 / 累 / 慌 / 困），否则「有点烦」会被误判命中。
   *   re    —— 识别用正则，字面量、无 g 标志（避免 lastIndex 副作用）。
   *   auto  —— 是否允许自动触发，generic 为 false（只做手动兜底）。
   */
  var EMOTIONS = [
    {
      key: 'anger', name: '愤怒', alt: ['生气', '窝火', '火大'], need: '被提前告知', auto: true,
      words: ['气死', '气炸', '愤怒', '生气', '烦躁', '烦死', '很烦', '好烦', '窝火', '火大', '炸了', '怒了', '想骂人', '受不了', '气不过'],
      re: /气死|气炸|愤怒|生气|烦躁|烦死|很烦|好烦|窝火|火大|炸了|怒了|想骂人|受不了|气不过/
    },
    {
      key: 'grievance', name: '委屈', alt: ['被忽略', '不甘'], need: '被看见', auto: true,
      words: ['委屈', '凭什么', '背锅', '没人看见', '没人看到', '我说了不算', '我不重要', '不甘'],
      re: /委屈|凭什么|背锅|明明.{0,6}努力|没人看见|没人看到|我说了不算|我不重要|不甘/
    },
    {
      key: 'anxiety', name: '焦虑', alt: ['紧张', '心慌'], need: '确定性', auto: true,
      words: ['焦虑', '紧张', '心慌', '心里慌', '心里很慌', '发慌', '慌张', '很慌', '好慌', '害怕', '担心', '不安', '胡思乱想', '慌得', 'panic'],
      re: /焦虑|紧张|心慌|心里慌|心里很慌|发慌|慌张|很慌|好慌|害怕|担心|不安|胡思乱想|慌得|panic/
    },
    {
      key: 'excitement', name: '兴奋', alt: ['高兴', '激动'], need: '意义感', auto: true,
      words: ['兴奋', '激动', '太开心', '开心死', '开心到', '居然做到了', '居然成了', '一下子有好多想法', '想马上开始', '好到不敢相信'],
      re: /兴奋|激动|太开心|开心死|开心到|居然做到了|居然成了|一下子有好多想法|停不下来.{0,4}想|想马上开始|好到不敢相信/
    },
    {
      key: 'low', name: '低落', alt: ['难过', '沮丧'], need: '休息', auto: true,
      words: ['低落', '难过', '难受', '想哭', '沮丧', '开心不起来', '提不起劲', '提不起精神', '没劲', '空虚', '不开心', '心情差', 'emo'],
      re: /低落|难过|难受|想哭|沮丧|开心不起来|提不起劲|提不起精神|没劲|空虚|不开心|心情差|emo/
    },
    {
      key: 'tired', name: '疲惫', alt: ['累', '耗竭'], need: '补账', auto: true,
      words: ['疲惫', '好累', '太累', '很累', '累死', '累到', '撑不住', '撑不下', '没力气', '透支', '倦怠', 'burnout'],
      re: /疲惫|好累|太累|很累|累死|累到|撑不住|撑不下|没力气|透支|倦怠|burnout|睡多久都.{0,6}困/
    },
    {
      key: 'lonely', name: '孤独', alt: ['没人懂', '一个人'], need: '被接住', auto: true,
      words: ['孤独', '一个人', '没人懂', '没人陪', '没人说话', '没人理解', '寂寞', '就我一个', '想找人'],
      re: /孤独|一个人|没人懂|没人陪|没人说话|没人理解|寂寞|就我一个|想找人/
    },
    {
      key: 'shame', name: '羞愧', alt: ['自责', '内疚'], need: '把事与人分开', auto: true,
      words: ['都怪我', '怪我', '我的错', '我怎么又这样', '我是不是太差', '太差了', '羞愧', '自责', '内疚'],
      re: /都怪我|怪我|我的错|我怎么又这样|我是不是太差|太差了|羞愧|自责|内疚|对不起.{0,8}我/
    },
    {
      key: 'generic', name: '说不清', alt: ['说不上来'], need: '', auto: false,
      words: ['说不上来', '说不清', '堵得慌', '心里乱'],
      re: /说不上来|说不清|堵得慌|不知道.{0,6}(什么|哪种).{0,4}(情绪|感觉)|心里.{0,2}乱/
    }
  ];

  /**
   * 可配置模板。数组即「变体池」，由 pick(list, seed) 选取。
   * 占位符：{{name}} 族名 / {{alt}} 首个别名 / {{need}} 该族指向的需要 / {{action}} 小行动。
   * {{quote}} 为 P1 保留位：P0 一律替换为空串（不引用用户原话，见设计 §10-Q3）。
   */
  var TEMPLATES = {
    anger: {
      name: ['听起来，这更像是一股{{name}}。你觉得准吗？叫它别的也行。',
        '我读到的是{{name}}——如果我读错了，你改一个词就行。'],
      validate: ['不是你脾气差，是有什么东西顶到你了。',
        '它会升上来，说明这件事对你不是无所谓。'],
      signal: ['{{name}}常常是在说有一条边界被越过了。这一次，被越过的可能是「{{need}}」那条线。'],
      questions: ['如果把它翻译成一句「我需要……」，会是哪一个词？',
        '这件事里，真正被碰到的那条线是什么？'],
      actions: ['先给身体一个出口：把想说的话写下来，先不发。等心率降下来再决定要不要表达。']
    },
    grievance: {
      name: ['这听起来是{{name}}。你觉得准吗？叫它别的也行。'],
      validate: ['被忽略的付出也是付出，它不是矫情。',
        '你已经把该做的做了，没被看见不等于没发生。'],
      signal: ['{{name}}常常指向「{{need}}」这个需要，也常和愤怒叠在一起——愤怒对外，{{name}}对内。'],
      questions: ['在这件事里，你最希望被谁看见哪一部分？',
        '如果不用「没事」把那句话咽回去，你原本想说的是什么？'],
      actions: ['把「我其实希望……」写成一句完整的话。只写给自己看，不用发给任何人。']
    },
    anxiety: {
      name: ['我读到的是{{name}}——也可能是紧张。你觉得哪个更准？'],
      validate: ['慌的时候，人会被「还没发生的事」拽着走。这不是你胆小。'],
      signal: ['{{name}}擅长替人预测未来，把还没发生的事当成已经发生。它想做的常常是保护，只是容易做过头。'],
      questions: ['你在担心的那件事，最坏的结果具体长什么样？它真发生的可能性有多大？',
        '把「我在担心什么」写成一句完整的话之后，它还是一团雾吗？'],
      actions: ['说出 5 样看得见的、4 样摸得到的、3 样听得到的东西，把注意力从预测拉回此刻。']
    },
    excitement: {
      name: ['听起来是{{name}}。这种时刻值得被看清楚一点。'],
      validate: ['真好，这种时刻值得被记下来——不是因为要正能量，是因为它有用。'],
      signal: ['正向情绪也有信息：它在标记「这件事对我有意义」。值得看清是哪一部分让你{{name}}，而不是一笔带过。'],
      questions: ['这件事里，最让你{{name}}的是哪一小部分？',
        '如果把它再做一次，你最想保留的是哪个条件？'],
      actions: ['把它写进今天的记录里，哪怕只一句。以后低气压的时候，你会需要看到今天这一页。']
    },
    low: {
      name: ['听起来这几天是{{name}}压着你。你觉得准吗？'],
      validate: ['它不需要马上被赶走，先让它有个地方待着就好。'],
      signal: ['{{name}}有时是在把决策窗口关小、挡掉几个冲动的选择；也可能只是身体在要休息。'],
      questions: ['如果{{name}}能说话，它想替你推掉哪件事？',
        '今天有没有一小会儿，它是松一点的？'],
      actions: ['说一件今天让你稍微松一点的小事——哪怕只是水喝够了。']
    },
    tired: {
      name: ['我读到的是{{name}}，不是懒。'],
      validate: ['累到这个份上，不是靠意志力能顶过去的。这里缺的不是决心，是账。'],
      signal: ['{{name}}常常是账本上的欠额，不是毅力问题。先把最基础的三样补上，比对自己提要求更有用。'],
      questions: ['如果把「我应该……」换成一个更小的版本，它会是什么？',
        '最近哪一件事，其实是可以先不还的？'],
      actions: ['给自己排一段 15 分钟什么都不做的时间。不为恢复效率，只是允许停下。']
    },
    lonely: {
      name: ['这听起来是{{name}}。我在这儿。'],
      validate: ['你已经说出来了，这本身就是一步。我不会评判你。'],
      signal: ['{{name}}常常不是身边没有人，而是「说了也没用」这个预设挡在前面。'],
      questions: ['你最想被接住的，是这件事本身，还是「有人愿意听」这件事？',
        '如果现在能找一个人，你脑子里第一个出现的是谁？'],
      actions: ['如果想找真人，我可以给你几条 24 小时都有人接的电话；如果只想被听见，继续在这儿说就行。']
    },
    shame: {
      name: ['我读到的是{{name}}。我想先不下这个判断。'],
      validate: ['听起来你在拿这件事给自己定论。我先不下这个判断。'],
      signal: ['自责常常是「我很在意这件事」的另一面。它指向的是你心里的标准，不是你的能力——把这两件事分开看会清楚一些。'],
      questions: ['如果是朋友做了同一件事，你会怎么对他说？',
        '把「我不好」换成「这件事没成」，那句话还成立吗？'],
      actions: ['把这件事写成「事实」和「我对事实的评价」两栏，先只看事实那一栏。']
    },
    generic: {
      name: ['你说不上来具体是什么——要不要先给它一个临时的名字？'],
      validate: ['说不清也是一种清楚：它说明那里确实有东西。'],
      signal: [],
      questions: ['如果先给它一个临时的名字，你会叫它什么？'],
      actions: []
    }
  };

  /** 频率与强度阈值，全部集中在此，禁止散落到视图里。 */
  var THRESHOLDS = {
    AUTO: 0.55,                       // 自动触发最低强度
    WEAK: 0.35,                       // 低于此值视为弱信号（= 命中时的基础分，即不触发）
    RAISED: 0.7,                      // declineCount >= 2 后上调到的阈值
    TURNS_MIN: 2,                     // 本次会话内用户发言 >= 2 轮
    TURNS_GAP: 3,                     // 两次引导之间用户再发言 >= 3 轮
    GAP_MS: 30 * 60 * 1000,           // 两次引导之间 >= 30 分钟
    SAME_EMOTION_MS: 24 * 3600 * 1000,// 同族 24 小时内只引导 1 次
    COOLDOWN_MS: 7 * 24 * 3600 * 1000,// 被拒后的冷静期
    DAY_LIMIT: 2,                     // 每日自动引导上限
    DAY_LIMIT_NO_STORAGE: 1,          // 本地存储不可用时的保守上限
    HISTORY_MAX: 30,
    QUESTIONS_MAX: 2
  };

  /** 温和收尾：全局唯一，不按族分。声明这一版只是读法，并请求校正。 */
  var CLOSING = '这些只是基于你这句话的一版读法，不是给你的定性。哪一句不准，你说一句，我就改写它。';
  /** 手动开启但没读到情绪时的提示。 */
  var NO_SIGNAL = '还没读到明显的情绪信号。要不要先给它一个临时的名字？';
  /** 手动开启但轮次不足时的降级说明：只做命名，不做解读。 */
  var NAME_ONLY = '信息还不多，这一步我只做命名，不做解读。';
  /** 同族 24h 内重复时的轻提示（PRD §8.8）。 */
  var REPEAT_HINT = '昨天我们聊到过它。如果你想再往里走一层，可以点「引导我看看」。';

  /* 强度评分用的三组修饰词。
     硬规则（设计文档 Q11）：同一个词只在一档里计一次分。
     「忍不住」只归 EXTREME_RE（行为级），「一直」只归 CUMULATIVE_RE（累积语义），
     两者都不出现在 INTENSIFIER_RE，否则会被各加一次、把触发门槛变相抬高 0.10。 */
  var INTENSIFIER_RE = /非常|特别|太|简直|彻底|到极点|超级|超|巨|贼/;
  var EXTREME_RE = /受不了|崩溃|崩了|炸了|炸裂|撑不住|撑不下|忍不住|要疯|快疯|气死|气炸|烦死|累死|吓死/;
  var PUNCT_RE = /!!|！！|\?\?|？？|啊啊|呜呜|呀呀|啦啦/;
  var CUMULATIVE_RE = /凭什么|又|每次都|总是|从来|一直|又是/;

  /* ==================================================================
     二、小工具（全部纯函数）
     ================================================================== */

  function str(v) { return v == null ? '' : String(v); }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** 本地自然日键（YYYY-MM-DD）。不依赖 MH.util，保证内核自足。 */
  function dayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /** 32 位字符串散列：给 pick 提供可复现的「伪随机」，不用 Math.random。 */
  function hashStr(s) {
    var src = String(s == null ? '' : s);
    var h = 0;
    for (var i = 0; i < src.length; i++) {
      h = (h * 31 + src.charCodeAt(i)) | 0;
    }
    return h < 0 ? -h : h;
  }

  function byKey(key) {
    for (var i = 0; i < EMOTIONS.length; i++) {
      if (EMOTIONS[i].key === key) return EMOTIONS[i];
    }
    return null;
  }

  function genericEmo() { return EMOTIONS[EMOTIONS.length - 1]; }

  /**
   * 危机判定**委托** MH.localService.isCrisis，单一来源，不在内核里复制一份危机词表。
   * 危机正则属于安全关键配置，存两份必然漂移（改了一处忘了另一处＝漏判危机信号）。
   * 代价是加载方必须带上 local-service.js（index.html 里 guided.js 排在它之后）。
   * P2-3 跨端复用（小程序）时，应把危机词表抽成三端共享常量，而不是各存一份副本。
   */
  function crisis(text) {
    try {
      if (MH.localService && MH.localService.isCrisis) return !!MH.localService.isCrisis(text);
    } catch (e) { /* 服务未就绪时按非危机处理，由视图的求助资源兜底 */ }
    return false;
  }

  /* ==================================================================
     三、纯函数：识别 / 评分 / 选段 / 填槽
     ================================================================== */

  function normalize(text) {
    return String(text == null ? '' : text).trim().slice(0, 1000);
  }

  /** 命中的词列表：优先用词表（依据区要展示），词表没中时退回正则匹配到的那一段。 */
  function matchedWords(text, emo) {
    var out = [];
    emo.words.forEach(function (w) {
      if (text.indexOf(w) >= 0 && out.indexOf(w) < 0) out.push(w);
    });
    if (!out.length) {
      var m = emo.re.exec(text);
      if (m) out.push(String(m[0]).slice(0, 12));
    }
    return out;
  }

  /**
   * 强度评分：0 ~ 1。未命中返回 0。
   * 0.35 基础 + 0.20 同族多词 + 0.20 强度副词 + 0.10 极端表达
   *      + 0.15 句末叠标点 + 0.10 累积语义词，封顶 1。
   */
  function score(text, emotionKey) {
    var t = normalize(text);
    if (!t) return 0;
    var emo = byKey(emotionKey);
    if (!emo || !emo.re.test(t)) return 0;

    var s = 0.35;
    if (matchedWords(t, emo).length >= 2) s += 0.20;
    if (INTENSIFIER_RE.test(t)) s += 0.20;
    if (EXTREME_RE.test(t)) s += 0.10;
    if (PUNCT_RE.test(t)) s += 0.15;
    if (CUMULATIVE_RE.test(t)) s += 0.10;
    return Math.min(1, Math.round(s * 100) / 100);
  }

  function mkDetect(emo, sc, text) {
    return {
      key: emo.key,
      name: emo.name,
      alt: emo.alt.slice(),
      need: emo.need,
      score: sc,
      matched: matchedWords(text, emo).slice(0, 6),
      all: [],
      auto: emo.auto !== false
    };
  }

  /**
   * 情绪识别。命中多族时取 score 最高者，同分取 EMOTIONS 靠前者。
   * 危机判定不在这里做（由 shouldTrigger 前置拦截），因此危机句仍可能返回族。
   * @returns {Object|null}
   */
  function detect(text) {
    var t = normalize(text);
    if (!t) return null;
    var list = [];
    EMOTIONS.forEach(function (emo) {
      if (!emo.re.test(t)) return;
      list.push(mkDetect(emo, score(t, emo.key), t));
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return b.score - a.score; });   // 稳定排序：同分保持 EMOTIONS 顺序
    list[0].all = list;
    return list[0];
  }

  /** 用户原话的 ≤12 字片段。P0 不使用（不引用原话），保留给 P1。 */
  function quote(text) {
    var t = normalize(text).replace(/\s+/g, '');
    if (!t) return '';
    return t.length <= 12 ? t : t.slice(0, 12);
  }

  /** 从变体池里选一条。用字符串散列而非随机数，保证测试可复现。 */
  function pick(list, seed) {
    if (!Array.isArray(list) || !list.length) return '';
    return list[hashStr(seed) % list.length];
  }

  /** 模板填槽。{{quote}} 一律替换为空串（P0 不引用用户原话）。 */
  function fill(tpl, vars) {
    var v = vars || {};
    var s = str(tpl);
    s = s.replace(/\{\{name\}\}/g, str(v.name));
    s = s.replace(/\{\{alt\}\}/g, str(v.alt));
    s = s.replace(/\{\{need\}\}/g, str(v.need));
    s = s.replace(/\{\{quote\}\}/g, '');
    s = s.replace(/\{\{action\}\}/g, str(v.action));
    return String(s || '');
  }

  /* ==================================================================
     四、纯函数：内容生成
     ================================================================== */

  function turnsOf(c) {
    if (c.turns == null) return 0;
    return num(c.turns);
  }

  /** 次高族：只在与最高族分差 <= 0.1 时带上，把判断权交回用户（PRD §8.9）。 */
  function othersOf(c, topScore) {
    var list = (c && Array.isArray(c.others)) ? c.others : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 2; i++) {
      var o = list[i];
      if (!o || !o.key) continue;
      if (o.score != null && topScore != null && (topScore - num(o.score)) > 0.1) break;
      out.push({ key: str(o.key), name: str(o.name) });
    }
    return out;
  }

  function seedOf(c, emoKey) {
    return emoKey + ':' + str(c.quote || c.now || '');
  }

  /**
   * 生成一份完整的引导内容。未知 key 与缺模板一律回落 generic，绝不出现空段或 undefined。
   * @param {string} emotionKey
   * @param {Object} ctx 见设计 §3.1（text / turns / now / mode / level / basisDays / others / emotion）
   * @returns {Object} GuidedContent
   */
  function build(emotionKey, ctx) {
    var c = ctx || {};
    var emo = byKey(emotionKey) || genericEmo();
    var tpl = TEMPLATES[emo.key] || TEMPLATES.generic;
    var gen = TEMPLATES.generic;
    var seed = seedOf(c, emo.key);

    var manual = c.mode === 'manual';
    var onlyName = !!(manual && turnsOf(c) < THRESHOLDS.TURNS_MIN);

    var vars = {
      name: emo.name,
      alt: emo.alt.length ? emo.alt[0] : '',
      need: emo.need,
      action: ''
    };

    var action = onlyName ? '' : fill(pick(tpl.actions && tpl.actions.length ? tpl.actions : [], seed), vars);
    vars.action = action;

    var signal = onlyName ? '' : fill(pick(tpl.signal && tpl.signal.length ? tpl.signal : [], seed + ':s'), vars);
    var name = fill(pick(tpl.name && tpl.name.length ? tpl.name : gen.name, seed + ':n'), vars);
    var validate = fill(pick(tpl.validate && tpl.validate.length ? tpl.validate : gen.validate, seed + ':v'), vars);

    var questions = [];
    if (!onlyName) {
      var pool = (tpl.questions && tpl.questions.length) ? tpl.questions : gen.questions;
      pool.forEach(function (q) {
        var s = fill(q, vars);
        if (s && questions.length < THRESHOLDS.QUESTIONS_MAX) questions.push(s);
      });
    }

    var det = c.emotion;
    var topScore = det ? det.score : null;
    var matched = (det && Array.isArray(det.matched)) ? det.matched.slice(0, 6) : matchedWords(normalize(c.text), emo);

    var note = '';
    if (onlyName) note = NAME_ONLY;
    else if (emo.key === 'generic') note = NO_SIGNAL;

    return {
      schema: SCHEMA,
      emotion: { key: emo.key, name: emo.name, alt: emo.alt.slice(), need: emo.need },
      name: name,
      validate: validate,
      signal: signal,
      questions: questions,
      action: action,
      closing: CLOSING,
      note: note,
      onlyName: onlyName,
      mode: manual ? 'manual' : 'auto',
      at: num(c.now) || Date.now(),
      others: othersOf(c, topScore),
      matched: matched
    };
  }

  /** 推理边界：数据能到哪里就停在哪里。 */
  function boundaryText(confidence) {
    var hedge = '';
    try {
      if (MH.xai && MH.xai.strength) hedge = str(MH.xai.strength(confidence).hedge);
    } catch (e) { hedge = ''; }
    return '边界：我只读到你这一句话和最近 14 天的聚合值，看不到昨天那件具体的事。' + hedge + '。';
  }

  function joinParts(parts) {
    return parts.filter(function (p) { return !!p; }).join('\n\n');
  }

  /** 把引导内容折叠成一份 xai 规格（短 / 中 / 长 + 依据 + 请求校正）。 */
  function spec(content, ctx) {
    var c = ctx || {};
    var co = content || build('generic', c);

    var basis = { days: 0, windowDays: 14, confidence: 'none', text: '' };
    try {
      if (MH.xai && MH.xai.basis) basis = MH.xai.basis(c.basisDays, 14);
    } catch (e) { /* 解释层缺失时用上面的空依据兜底 */ }

    var head = joinParts([co.name, co.validate]);
    var mid = joinParts([head, co.signal, co.action]);
    var qs = (co.questions || []).map(function (q) { return '· ' + q; }).join('\n');
    var tail = joinParts([mid, qs, boundaryText(basis.confidence), co.closing]);

    var mode = co.mode === 'manual' ? 'manual' : 'auto';
    var evidence = [];
    if (co.matched && co.matched.length) {
      evidence.push('这一句话里读到的线索：' + co.matched.slice(0, 4).join('、'));
    }

    return {
      short: head,
      medium: mid,
      long: tail,
      level: c.level || 'medium',
      evidence: evidence,
      basis: basis,
      revision: CLOSING,
      // Q13：「自动」偏冷、偏系统腔，改为「自动出现」，与「手动开启」对称
      tags: ['引导式学习', co.emotion.name, mode === 'manual' ? '手动开启' : '自动出现']
    };
  }

  /** 交给 MH.xai.compose 产出三档对象；解释层缺失时有极简兜底，保证不抛错。 */
  function compose(emotionKey, ctx) {
    var c = ctx || {};
    var content = build(emotionKey, c);
    var sp = spec(content, c);
    try {
      if (MH.xai && MH.xai.compose) return MH.xai.compose(sp, { level: c.level });
    } catch (e) { /* 落到下面的极简兜底 */ }
    return {
      schema: 'moodhub.xai/v1',
      short: sp.short,
      medium: sp.medium,
      long: sp.long,
      level: sp.level,
      text: sp.medium,
      evidence: sp.evidence,
      basis: sp.basis,
      revision: sp.revision,
      tags: sp.tags
    };
  }

  function clipText(s, n) { return str(s).slice(0, n); }

  /**
   * 产出一条可直接交给 MH.store.chat.append() 的消息。
   * payload.guided 不含用户原话（quote 不落库）。
   */
  function buildMessage(emotionKey, ctx) {
    var c = ctx || {};
    var content = build(emotionKey, c);
    var layers = compose(emotionKey, c);
    var now = num(c.now) || Date.now();
    var mode = content.mode;

    var questions = (content.questions || []).slice(0, 4).map(function (q) { return clipText(q, 200); });
    var others = (content.others || []).slice(0, 2).map(function (o) {
      return { key: clipText(o.key, 40), name: clipText(o.name, 60) };
    });

    return {
      role: 'ai',
      text: layers.text,
      at: now,
      tags: layers.tags.slice(),
      layers: layers,
      payload: {
        guided: {
          schema: SCHEMA,
          emotion: {
            key: content.emotion.key,
            name: content.emotion.name,
            alt: content.emotion.alt.slice(),
            need: content.emotion.need
          },
          name: clipText(content.name, 400),
          validate: clipText(content.validate, 400),
          signal: clipText(content.signal, 400),
          questions: questions,
          action: clipText(content.action, 400),
          closing: clipText(content.closing, 400),
          note: clipText(content.note, 400),
          onlyName: !!content.onlyName,
          mode: mode,
          at: now,
          others: others
        },
        model: { id: 'local-guided', name: '本地模板', privacy: 'on-device', degraded: false }
      }
    };
  }

  /* ==================================================================
     五、状态读取（副作用函数的公共底座）
     ================================================================== */

  var memState = null;

  function defaultState() {
    return {
      schema: SCHEMA,
      day: '',
      dayAuto: 0,
      lastAutoAt: 0,
      lastEmotion: '',
      lastEmotionAt: 0,
      declineAt: 0,
      declineCount: 0,
      turnsSince: 99,      // 初始给一个足够大的值，避免首次触发被 INTERVAL 挡住
      alias: {},
      history: []
    };
  }

  /** 补齐缺失字段，任何异常都退回默认态，不抛错。 */
  function fillState(s) {
    var d = defaultState();
    var src = (s && typeof s === 'object') ? s : {};
    return {
      schema: SCHEMA,
      day: str(src.day),
      dayAuto: num(src.dayAuto),
      lastAutoAt: num(src.lastAutoAt),
      lastEmotion: str(src.lastEmotion),
      lastEmotionAt: num(src.lastEmotionAt),
      declineAt: num(src.declineAt),
      declineCount: num(src.declineCount),
      turnsSince: (src.turnsSince === undefined || src.turnsSince === null) ? d.turnsSince : num(src.turnsSince),
      alias: (src.alias && typeof src.alias === 'object') ? src.alias : {},
      history: Array.isArray(src.history) ? src.history.slice() : []
    };
  }

  /** 自动引导总开关（prefs.guidedAuto）。存储不可用时按「开」处理。 */
  function autoPrefOn() {
    try {
      if (MH.store && MH.store.prefs) return MH.store.prefs.get().guidedAuto !== false;
    } catch (e) { /* 无存储环境：不因此禁用功能 */ }
    return true;
  }

  /** 每日上限：存储不可用时降为 1（PRD §8.5）。 */
  function dayLimit() {
    try {
      if (MH.store && MH.store.storageAvailable === false) return THRESHOLDS.DAY_LIMIT_NO_STORAGE;
    } catch (e) { /* 忽略 */ }
    return THRESHOLDS.DAY_LIMIT;
  }

  /** ctx.state 优先（测试可完全脱库），否则读 store。 */
  function stateOf(c) {
    if (c && c.state && typeof c.state === 'object') return fillState(c.state);
    return state();
  }

  function result(ok, reason, emotion, sc) {
    return { ok: !!ok, reason: reason, emotion: emotion || null, score: sc || 0 };
  }

  /* ==================================================================
     六、触发判定（纯函数，reason 可断言）
     ================================================================== */

  /**
   * 判定此刻是否应当出一张引导卡。
   * reason 判定顺序固定：
   *   CRISIS → NO_EMOTION → DISABLED → COOLDOWN → TURNS → INTENSITY
   *   → DAILY_LIMIT → SAME_EMOTION → INTERVAL → OK
   * @param {Object} ctx {text, turns, now, mode, state, level, basisDays, emotion}
   * @returns {{ok:boolean, reason:string, emotion:Object|null, score:number}}
   */
  function shouldTrigger(ctx) {
    var c = ctx || {};
    var text = normalize(c.text);
    var now = num(c.now) || Date.now();
    var manual = c.mode === 'manual' || c.auto === false;

    // 危机永远排在最前：引导完全不触发，只出求助资源
    if (crisis(text)) return result(false, 'CRISIS', null, 0);

    var emo = c.emotion || detect(text);
    if (!emo) return result(false, 'NO_EMOTION', null, 0);
    // generic 只做手动兜底，不允许自动触发（会大量误触发）
    if (emo.auto === false) return result(false, 'NO_EMOTION', null, 0);
    // 手动入口绕过频率、冷静期与开关
    if (manual) return result(true, 'OK', emo, emo.score);

    var st = stateOf(c);

    if (!autoPrefOn()) return result(false, 'DISABLED', emo, emo.score);
    if (inCooldown(now, st)) return result(false, 'COOLDOWN', emo, emo.score);
    if (turnsOf(c) < THRESHOLDS.TURNS_MIN) return result(false, 'TURNS', emo, emo.score);

    var floor = st.declineCount >= 2 ? THRESHOLDS.RAISED : THRESHOLDS.AUTO;
    if (emo.score < floor) return result(false, 'INTENSITY', emo, emo.score);

    // 跨自然日后计数归零
    var dayAuto = (st.day && st.day !== dayKey(now)) ? 0 : num(st.dayAuto);
    if (dayAuto >= dayLimit()) return result(false, 'DAILY_LIMIT', emo, emo.score);

    if (st.lastEmotion === emo.key && st.lastEmotionAt > 0 &&
      (now - st.lastEmotionAt) < THRESHOLDS.SAME_EMOTION_MS) {
      return result(false, 'SAME_EMOTION', emo, emo.score);
    }
    if (num(st.turnsSince) < THRESHOLDS.TURNS_GAP) return result(false, 'INTERVAL', emo, emo.score);
    if (st.lastAutoAt > 0 && (now - st.lastAutoAt) < THRESHOLDS.GAP_MS) {
      return result(false, 'INTERVAL', emo, emo.score);
    }
    return result(true, 'OK', emo, emo.score);
  }

  /** 同族重复时的轻提示原文（PRD §8.8）。 */
  function repeatHint() { return REPEAT_HINT; }

  /**
   * 是否处于被拒后的冷静期。**纯函数**：不读 store，state 由调用方给。
   * 视图判断冷静期一律调它，禁止在视图里另写一套 `now - declineAt < 7 天`
   * （同一规则两份实现，必然改一处漏一处）。
   * @param {number} now 时间戳
   * @param {Object} st GuidedState
   * @returns {boolean}
   */
  function inCooldown(now, st) {
    var s = st || {};
    var at = num(s.declineAt);
    var t = num(now) || Date.now();
    return at > 0 && (t - at) > 0 && (t - at) < THRESHOLDS.COOLDOWN_MS;
  }

  /* ==================================================================
     七、副作用函数
     （除 state() 只读外，其余都会写 MH.store；另有两个私有只读访问器
      autoPrefOn() / dayLimit() 见设计文档 §10.1。全部 try/catch 包裹，永不抛错）
     ================================================================== */

  function state() {
    try {
      if (MH.store && MH.store.guided) return fillState(MH.store.guided.state());
    } catch (e) { /* store 未初始化 → 用内存态 */ }
    if (!memState) memState = defaultState();
    return fillState(memState);
  }

  function patch(p) {
    var next = Object.assign(state(), p || {});
    next.turnsSince = (p && p.turnsSince != null) ? num(p.turnsSince) : next.turnsSince;
    memState = next;
    try {
      if (MH.store && MH.store.guided) return fillState(MH.store.guided.patch(p || {}));
    } catch (e) { /* 写入失败不中断功能 */ }
    return fillState(next);
  }

  /**
   * 记一次引导结果。只有「自动 + 已展示」才占用每日额度。
   * 点「我记下了」（outcome:'acted'）时把 declineCount 复位，让阈值回落。
   */
  function record(entry) {
    var e = entry || {};
    var st = state();
    var now = num(e.at) || Date.now();
    var mode = e.mode === 'manual' ? 'manual' : 'auto';
    var outcome = ['shown', 'acted', 'rejected', 'declined'].indexOf(e.outcome) >= 0 ? e.outcome : 'shown';
    var key = str(e.emotion) || st.lastEmotion;

    var next = { lastEmotion: key, lastEmotionAt: now, turnsSince: 0 };
    if (mode === 'auto' && outcome === 'shown') {
      next.dayAuto = num(st.dayAuto) + 1;
      next.lastAutoAt = now;
    }
    if (outcome === 'acted') next.declineCount = 0;

    var history = st.history.slice();
    history.push({ at: now, emotion: key, mode: mode, outcome: outcome });
    if (history.length > THRESHOLDS.HISTORY_MAX) history = history.slice(-THRESHOLDS.HISTORY_MAX);
    next.history = history;

    try {
      if (MH.store && MH.store.guided) return fillState(MH.store.guided.record(e));
    } catch (err) { /* 落到内存态 */ }
    return patch(next);
  }

  /** 「这次先不了」：写 declineAt 与 declineCount，进入 7 天冷静期。 */
  function decline(emotionKey, mode) {
    try {
      if (MH.store && MH.store.guided) return fillState(MH.store.guided.decline(emotionKey, mode));
    } catch (e) { /* 落到内存态 */ }
    var st = state();
    return patch({ declineAt: Date.now(), declineCount: num(st.declineCount) + 1 });
  }

  /** 「不再自动引导」：只关自动，手动入口必须仍然可用（PRD §8.11）。 */
  function disableAuto() {
    try {
      if (MH.store && MH.store.prefs) MH.store.prefs.set({ guidedAuto: false });
    } catch (e) { /* 静默 */ }
  }

  /**
   * 重新开启自动引导（设置页开关 false → true）。
   * 这是**唯一**合法的「清冷静期」出口（设计文档 §4.8 / Q14）：用户显式改设置＝撤回当初
   * 那句「七天内不再主动提起」的承诺。tryManual / record / 视图任何路径都不得写 declineAt = 0。
   */
  function enableAuto() {
    try {
      if (MH.store && MH.store.prefs) MH.store.prefs.set({ guidedAuto: true });
    } catch (e) { /* 静默 */ }
    return patch({ declineAt: 0, declineCount: 0 });
  }

  function reset() {
    memState = null;
    try {
      if (MH.store && MH.store.guided) MH.store.guided.reset();
    } catch (e) { /* 静默 */ }
  }

  /* ==================================================================
     八、编排入口（视图只调这两个；都不碰 DOM、都不弹 toast）
     ================================================================== */

  function othersFrom(emo) {
    if (!emo || !Array.isArray(emo.all)) return [];
    return emo.all.slice(1).map(function (o) { return { key: o.key, name: o.name, score: o.score }; });
  }

  function tryAuto(ctx) {
    var c = ctx || {};
    var t = shouldTrigger(c);
    var out = { ok: t.ok, reason: t.reason, message: null, emotion: t.emotion, score: t.score };
    if (!t.ok) return out;

    var cc = Object.assign({}, c, {
      mode: 'auto',
      now: num(c.now) || Date.now(),
      emotion: t.emotion,
      others: othersFrom(t.emotion)
    });
    try {
      out.message = buildMessage(t.emotion.key, cc);
      record({ emotion: t.emotion.key, mode: 'auto', outcome: 'shown', at: cc.now });
    } catch (e) {
      out.ok = false;
      out.message = null;
    }
    return out;
  }

  function tryManual(ctx) {
    var c = ctx || {};
    var text = normalize(c.text);
    var now = num(c.now) || Date.now();
    if (crisis(text)) {
      return { ok: false, reason: 'CRISIS', message: null, emotion: null, score: 0 };
    }
    var emo = c.emotion || detect(text) || mkDetect(genericEmo(), 0, '');
    var cc = Object.assign({}, c, {
      mode: 'manual',
      now: now,
      text: text,
      emotion: emo,
      others: othersFrom(emo)
    });
    var out = { ok: true, reason: 'OK', message: null, emotion: emo, score: emo.score };
    try {
      out.message = buildMessage(emo.key, cc);
      record({ emotion: emo.key, mode: 'manual', outcome: 'shown', at: now });
    } catch (e) {
      out.ok = false;
      out.message = null;
    }
    return out;
  }

  /* ==================================================================
     九、导出
     ================================================================== */

  MH.guided = {
    SCHEMA: SCHEMA,
    EMOTIONS: EMOTIONS,
    TEMPLATES: TEMPLATES,
    THRESHOLDS: THRESHOLDS,
    CLOSING: CLOSING,
    NO_SIGNAL: NO_SIGNAL,
    NAME_ONLY: NAME_ONLY,

    // 纯函数
    normalize: normalize,
    score: score,
    detect: detect,
    quote: quote,
    pick: pick,
    fill: fill,
    build: build,
    spec: spec,
    compose: compose,
    buildMessage: buildMessage,
    shouldTrigger: shouldTrigger,
    repeatHint: repeatHint,
    boundary: boundaryText,
    inCooldown: inCooldown,

    // 副作用
    state: state,
    patch: patch,
    record: record,
    decline: decline,
    disableAuto: disableAuto,
    enableAuto: enableAuto,
    reset: reset,

    // 编排
    tryAuto: tryAuto,
    tryManual: tryManual
  };
})(window.MH = window.MH || {});
