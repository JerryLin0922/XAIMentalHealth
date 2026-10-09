/* 陪伴对话：把最近 14 天统计摘要交给本地服务，取回一段回应。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var lastPayload = null;

  // 每条 AI 回复当前展开的那一档（short / medium / long），默认跟随全局偏好
  var levelOverride = {};

  // 引导卡里被用户手动展开 / 收起的区块：一旦手动操作过，就脱离档位联动
  var foldOverride = {};
  // 被「这次先不了」收起的引导卡 id：重绘时持久显示为一行轻提示
  var declinedCards = {};
  // 同族重复提示的节流锚点（30 分钟内最多提示一次，避免变成新的打扰源）
  var lastHintAt = 0;

  var HINT_GAP_MS = 30 * 60 * 1000;

  function levelFor(msg) {
    return (levelOverride[msg.id] || (msg.layers && msg.layers.level) || MH.xai.defaultLevel());
  }

  function bubble(msg) {
    var cls = msg.role === 'me' ? 'bubble--me' : (msg.role === 'sys' ? 'bubble--sys' : 'bubble--ai');

    // 被收起的引导卡不再重复渲染正文，只留一行系统提示
    if (declinedCards[msg.id]) {
      return el('div', { class: 'bubble bubble--sys', text: '已跳过这一次的引导。' });
    }

    var node = el('div', { class: 'bubble ' + cls });

    if (msg.role === 'ai' && msg.payload && msg.payload.guided) node.appendChild(guidedCard(msg));
    else if (msg.role === 'ai' && msg.layers) node.appendChild(xaiBody(msg));
    else node.appendChild(el('span', { text: msg.text }));

    if (msg.tags && msg.tags.length) {
      node.appendChild(el('div', { class: 'bubble__tags' }, msg.tags.map(function (t) {
        return el('span', { class: 'tag', text: t });
      })));
    }
    if (msg.role !== 'sys') node.appendChild(el('span', { class: 'bubble__time', text: U.fmtDateTime(msg.at) }));
    return node;
  }

  /**
   * AI 回复的正文区：短 / 中 / 长三档开关 + 依据 + 请求校正 + 校正按钮。
   * 结构由 MH.xai 统一产出这里只负责把它摆出来。
   *
   * 引导卡复用本函数（不新造一套解释 UI，保证「可纠正」这条承诺同样成立），
   * 通过 opts 微调，全部参数都有默认值，现有调用点零影响：
   *   opts.body    false 时不渲染 .xai__body 文本区（由结构化区块代替正文）
   *   opts.blocks  插入到三档开关之后、依据之前的节点数组
   *   opts.ask     覆盖结尾的请求校正文案
   *   opts.onLevel 档位切换后的回调 (lv)
   *   opts.cls     追加到 .xai 上的 class
   */
  function xaiBody(msg, opts) {
    var o = opts || {};
    var showBody = o.body !== false;
    var blocks = Array.isArray(o.blocks) ? o.blocks : [];
    var askText = (typeof o.ask === 'string' && o.ask) ? o.ask : null;
    var onLevel = typeof o.onLevel === 'function' ? o.onLevel : null;
    // 推理边界的渲染出口（设计文档 §4.6 / Q12）：引导卡不渲染 .xai__body，
    // long 档的边界句改挂到「依据」尾部，并自动展开那个 <details>。
    var basisTail = typeof o.basisTail === 'function' ? o.basisTail : null;
    var basisOpenOn = typeof o.basisOpenOn === 'function' ? o.basisOpenOn : null;
    var painting = false;      // 程序化改属性期间屏蔽 toggle，避免把自己标记成"被用户碰过"
    var basisTouched = false;  // 用户手动开合过依据后，从此脱离档位联动
    var basisBox = null;
    var basisBody = null;
    var basisBase = '';

    var ex = msg.layers;
    var host = el('div', { class: o.cls ? ('xai ' + o.cls) : 'xai' });

    // 三档开关
    var body = el('div', { class: 'xai__body', text: '' });
    var switchBox = el('div', { class: 'xai__switch', role: 'group', 'aria-label': '阅读层次' });

    function paint() {
      var lv = levelFor(msg);
      if (showBody) body.textContent = ex[lv] || ex.medium || msg.text;
      U.$$('.xai__btn', switchBox).forEach(function (b) {
        var on = b.dataset.level === lv;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // 依据区：边界句只在 long 档出现，短 / 中档整句消失
      if (basisBody) {
        var tail = basisTail ? String(basisTail(lv) || '') : '';
        basisBody.textContent = tail ? (basisBase + '\n\n' + tail) : basisBase;
      }
      if (basisBox && basisOpenOn && !basisTouched) {
        painting = true;
        try {
          if (basisOpenOn(lv)) {
            if (basisBox.setAttribute) basisBox.setAttribute('open', '');
            basisBox.open = true;
          } else {
            if (basisBox.removeAttribute) basisBox.removeAttribute('open');
            basisBox.open = false;
          }
        } catch (e) { /* 桩环境没有这些方法时静默 */ }
        painting = false;
      }
      if (onLevel) onLevel(lv);
    }

    MH.xai.LEVELS.forEach(function (lv) {
      var meta = MH.xai.LEVEL_META[lv];
      var btn = el('button', {
        class: 'xai__btn', type: 'button', dataset: { level: lv },
        title: meta.hint, text: meta.label
      });
      btn.addEventListener('click', function () {
        levelOverride[msg.id] = lv;
        // 顺手把这一档记成以后新回复的默认深度
        MH.store.prefs.set({ xaiLevel: lv });
        paint();
      });
      switchBox.appendChild(btn);
    });

    host.appendChild(switchBox);
    if (showBody) host.appendChild(body);
    blocks.forEach(function (node) { if (node) host.appendChild(node); });

    // 依据：这一版解释到底踩在哪些证据上
    if ((ex.basis && ex.basis.text) || (ex.evidence && ex.evidence.length)) {
      var lines = [];
      if (ex.basis && ex.basis.text) lines.push(ex.basis.text);
      (ex.evidence || []).forEach(function (e) { lines.push('· ' + e); });
      basisBase = lines.join('\n');
      basisBody = el('div', { class: 'xai__basis-body', text: basisBase });
      basisBox = el('details', { class: 'xai__basis' }, [
        el('summary', { text: '我依据的是这些' }),
        basisBody
      ]);
      if (basisOpenOn) {
        // 用户自己开合过之后就脱离档位联动；程序化设置属性时用 painting 屏蔽，避免自标记
        basisBox.addEventListener('toggle', function () {
          if (painting) return;
          basisTouched = true;
        });
      }
      host.appendChild(basisBox);
    }

    host.appendChild(el('p', { class: 'xai__ask', text: askText || shortAsk(levelFor(msg)) }));
    host.appendChild(feedbackRow(msg));
    // 首次着色放在最后：依据区与边界句都要等它建好才有得写
    paint();
    return host;
  }

  function shortAsk(level) {
    return level === 'short' ? MH.xai.REFLECTION_SHORT : MH.xai.REFLECTION;
  }

  /* ==================================================================
     情绪引导卡（Guided Learning Card）

     作为独立一条 AI 消息出现：可单独被标记「不符合」，也可单独退出。
     内部三档 / 依据 / 反馈全部复用 xaiBody，不新造一套解释 UI。
     ================================================================== */

  // 三档决定区块的展开范围；命名与共情常显，卡片本身不整体折叠
  var FOLD_BY_LEVEL = {
    short: {},
    medium: { signal: true, action: true },
    long: { signal: true, questions: true, action: true }
  };
  // 620px 以下默认收起「问题」与「行动」，信号仍然常显
  var FOLD_ON_NARROW = { questions: true, action: true };

  function isNarrow() {
    try {
      return !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
    } catch (e) { return false; }
  }

  /**
   * 引导卡里的一段可折叠区块。空内容一律不渲染节点，绝不出现空标题。
   * @returns {{node: Node, setOpen: function}}
   */
  function glBlock(msg, kind, title, bodyNodes) {
    // 类名同时带 .gl__block[data-block]（设计稿口径）与 .gl__signal / .gl__questions / .gl__action（PRD 口径）
    // data-block 既写成属性也写进 dataset：属性便于 CSS 与测试选择，dataset 便于脚本读写
    var block = el('div', {
      class: 'gl__block gl__' + kind,
      dataset: { block: kind },
      'data-block': kind
    });
    var mark = el('span', { class: 'gl__block-mark', 'aria-hidden': 'true', text: '▸' });
    var head = el('button', { class: 'gl__block-head', type: 'button', 'aria-expanded': 'false' }, [
      mark, el('span', { text: title })
    ]);
    var bodyEl = el('div', { class: 'gl__block-body' });
    (bodyNodes || []).forEach(function (n) { if (n) bodyEl.appendChild(n); });

    function setOpen(on) {
      block.classList.toggle('is-open', !!on);
      head.setAttribute('aria-expanded', on ? 'true' : 'false');
      mark.textContent = on ? '▾' : '▸';
    }

    head.addEventListener('click', function () {
      var on = !block.classList.contains('is-open');
      setOpen(on);
      foldOverride[msg.id + ':' + kind] = on;
    });

    block.appendChild(head);
    block.appendChild(bodyEl);
    return { node: block, setOpen: setOpen };
  }

  /** 档位联动：没被用户手动操作过的区块跟随档位；窄屏额外收起问题与行动。 */
  function syncBlocks(msg, blocks, lv) {
    var want = FOLD_BY_LEVEL[lv] || FOLD_BY_LEVEL.medium;
    var narrow = isNarrow();
    ['signal', 'questions', 'action'].forEach(function (kind) {
      var b = blocks[kind];
      if (!b) return;
      if (Object.prototype.hasOwnProperty.call(foldOverride, msg.id + ':' + kind)) return;
      b.setOpen(!!want[kind] && !(narrow && FOLD_ON_NARROW[kind]));
    });
  }

  function guidedCard(msg) {
    var c = (msg.payload && msg.payload.guided) || {};
    var emo = c.emotion || {};
    var name = String(emo.name || '');
    var blocks = {};
    var nodes = [];

    var card = el('div', {
      class: 'gl',
      role: 'group',
      'aria-live': 'polite',
      'aria-label': '情绪引导 · ' + name,
      dataset: { emotion: String(emo.key || '') },
      'data-emotion': String(emo.key || '')
    });

    /* 卡头：徽标 + 情绪名 + 「这次先不了」 */
    var close = el('button', {
      class: 'btn btn--ghost btn--sm gl__close', type: 'button',
      text: '这次先不了', 'aria-label': '跳过这一次引导'
    });
    close.addEventListener('click', function () { declineGuide(msg); });

    card.appendChild(el('div', { class: 'gl__head' }, [
      el('span', { class: 'gl__badge', text: '情绪引导' }),
      el('span', { class: 'chip gl__chip', text: name }),
      close
    ]));

    /* ① 命名：多族并列时把相邻族一并交给用户裁决 */
    var nameNode = el('p', { class: 'gl__name', text: String(c.name || '') });
    if (c.others && c.others.length) {
      // 拆成三个文本节点：语言切换时前缀、族名与括号各自独立翻译
      nameNode.appendChild(el('span', { class: 'gl__name-alt' },
        ['（可能夹着', String(c.others[0].name || ''), '）']));
    }
    card.appendChild(nameNode);

    /* ② 共情确认 */
    if (c.validate) card.appendChild(el('p', { class: 'gl__validate', text: String(c.validate) }));

    /* 降级说明：轮次不足只做命名 / 没读到明显情绪 */
    if (c.note) card.appendChild(el('p', { class: 'gl__note', text: String(c.note) }));

    /* ③ 信号解读 */
    if (c.signal) {
      blocks.signal = glBlock(msg, 'signal', '这份情绪可能在说什么',
        [el('p', { text: String(c.signal) })]);
      nodes.push(blocks.signal.node);
    }

    /* ④ 反思问题：留给本人，不代替本人回答 */
    if (c.questions && c.questions.length) {
      blocks.questions = glBlock(msg, 'questions', '可以问自己', [
        el('ul', { class: 'gl__list' }, c.questions.map(function (q) {
          return el('li', { text: String(q) });
        }))
      ]);
      nodes.push(blocks.questions.node);
    }

    /* ⑤ 小行动：小到今天就能做，不做也没关系 */
    if (c.action) {
      var acted = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: '我记下了' });
      acted.addEventListener('click', function () {
        try {
          MH.guided.record({ emotion: String(emo.key || ''), mode: c.mode || 'auto', outcome: 'acted' });
        } catch (e) { /* 记录失败不影响卡片本身 */ }
        acted.disabled = true;
        if (acted.parentNode) acted.parentNode.appendChild(el('span', { class: 'hint', text: '已记下' }));
      });
      blocks.action = glBlock(msg, 'action', '一件小事', [
        el('p', { text: String(c.action) }),
        el('div', { class: 'gl__actions' }, [acted])
      ]);
      nodes.push(blocks.action.node);
    }

    /* 三档 + 依据 + 反馈：整体复用 xaiBody，正文区由上面的结构化区块代替 */
    card.appendChild(xaiBody(msg, {
      body: false,
      blocks: nodes,
      ask: String(c.closing || ''),
      cls: 'gl__xai',
      // long 档把推理边界句挂到「依据」尾部，并自动展开依据（Q12：不新增 .gl__bound 节点）
      basisTail: function (lv) {
        if (lv !== 'long' || !MH.guided || !MH.guided.boundary) return '';
        try {
          var conf = (msg.layers && msg.layers.basis && msg.layers.basis.confidence) || 'none';
          return String(MH.guided.boundary(conf) || '');
        } catch (e) { return ''; }
      },
      basisOpenOn: function (lv) { return lv === 'long'; },
      onLevel: function (lv) { syncBlocks(msg, blocks, lv); }
    }));

    /* 页脚：只关「自动」，手动入口必须仍然可用 */
    var foot = el('button', { class: 'gl__foot-btn', type: 'button', text: '不再自动引导' });
    foot.addEventListener('click', function () { disableGuide(); });
    card.appendChild(el('div', { class: 'gl__foot' }, [foot]));

    return card;
  }

  /* ---------------- 引导的进入与退出 ---------------- */

  /** 本次会话内用户发言轮次（不落库，清空对话自然归零）。 */
  function userTurns() {
    try {
      return MH.store.chat.all().filter(function (m) { return m.role === 'me'; }).length;
    } catch (e) { return 0; }
  }

  /** 最近 14 天有记录的天数，只用于依据区的置信度描述。 */
  function basisDays() {
    try {
      var s = MH.stats.summary14(MH.store.records.all());
      return (s && Number(s.daysWithData)) || 0;
    } catch (e) { return 0; }
  }

  /** 手动开启时取最后一条「我」的话；没有则走通用兜底。 */
  function lastUserText() {
    var list = MH.store.chat.all();
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'me') return String(list[i].text || '');
    }
    return '';
  }

  /** 用户每发一句，距上次引导的轮次 +1（跨会话保留，防止靠清空对话绕过频率）。 */
  function bumpTurns() {
    if (!MH.store.guided) return;
    try {
      var s = MH.store.guided.state();
      MH.store.guided.patch({ turnsSince: (Number(s.turnsSince) || 0) + 1 });
    } catch (e) { /* 存储不可用时静默降级 */ }
  }

  /** 正常回复之后判定一次：该出卡就出卡，不该出就完全静默。 */
  function maybeGuide(text) {
    if (!MH.guided) return;               // 防御：内核脚本未加载时直接跳过
    var res = null;
    try {
      res = MH.guided.tryAuto({
        text: text, turns: userTurns(), now: Date.now(), mode: 'auto', basisDays: basisDays()
      });
    } catch (e) { return; }
    if (!res) return;

    if (res.ok && res.message) {
      MH.store.chat.append(res.message);
      paintLog();                          // 卡片插入后不移动焦点，不打断正在打字的人
      return;
    }
    // 同族 24h 内重复：只追加一句轻提示，30 分钟内最多一次。
    // 冷静期内完全静默（PRD §5.4-3）：那句提示在这个语境下等于「你上次没看」的暗示。
    if (res.reason === 'SAME_EMOTION' && !inCooldown() && (Date.now() - lastHintAt) > HINT_GAP_MS) {
      lastHintAt = Date.now();
      MH.store.chat.append({ role: 'sys', text: MH.guided.repeatHint() });
      paintLog();
    }
  }

  /** 冷静期一律问内核，禁止在视图里另写一套 `now - declineAt < 7 天`。 */
  function inCooldown() {
    try {
      return !!MH.guided.inCooldown(Date.now(), MH.guided.state());
    } catch (e) { return false; }
  }

  /** 主动开启：按钮与「/引导」指令共用，绕过频率、冷静期与开关。 */
  function manualGuide() {
    if (!MH.guided) return;
    var text = lastUserText();
    if (MH.localService && MH.localService.isCrisis && MH.localService.isCrisis(text)) {
      MH.store.chat.append({ role: 'sys', text: '已弹出求助资源卡。随时可以再点右上角「求助资源」查看。' });
      paintLog();
      if (MH.app && MH.app.showCrisis) MH.app.showCrisis();
      return;
    }
    var res = null;
    try {
      res = MH.guided.tryManual({
        text: text, turns: userTurns(), now: Date.now(), mode: 'manual', basisDays: basisDays()
      });
    } catch (e) { return; }
    if (!res || !res.ok || !res.message) return;
    MH.store.chat.append(res.message);
    paintLog();
  }

  /** 「这次先不了」：卡片收起为一行提示 + 7 天冷静期。 */
  function declineGuide(msg) {
    var key = '';
    try { key = ((msg.payload.guided.emotion) || {}).key || ''; } catch (e) { key = ''; }
    try { MH.guided.decline(key, 'auto'); } catch (e) { /* 静默 */ }
    declinedCards[msg.id] = 1;
    paintLog();
    U.toast('已跳过这一次的引导。七天内我不会再主动提起，你想聊的时候，「引导我看看」一直都在。', 'info', 4200);
  }

  /** 「不再自动引导」：只写 prefs.guidedAuto，手动入口保持可用。 */
  function disableGuide() {
    try { if (MH.guided && MH.guided.disableAuto) MH.guided.disableAuto(); } catch (e) { /* 静默 */ }
    U.toast('已关闭自动引导。你仍然可以随时点「引导我看看」主动开始。', 'info', 4200);
  }

  /** 符合 / 部分符合 / 不符合：这一票会写进本机，并影响下一版怎么说。 */
  function feedbackRow(msg) {
    var target = 'chat:' + msg.id;
    var done = MH.store.xai.forTarget(target);
    var row = el('div', { class: 'xai__fb' });

    var opts = [
      { v: 'fits', text: '符合' },
      { v: 'partial', text: '部分符合' },
      { v: 'reject', text: '不符合' }
    ];
    opts.forEach(function (o) {
      var btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: o.text });
      if (done && done.verdict === o.v) {
        btn.classList.add('is-on');
        btn.disabled = true;
      }
      btn.addEventListener('click', function () { submitFeedback(msg, o.v, row); });
      row.appendChild(btn);
    });

    if (done) {
      row.appendChild(el('span', { class: 'hint', text: '已记录 · ' + U.fmtRelative(done.at) + '，下一版会避开这一条' }));
    } else {
      var noteBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '说说哪不对' });
      noteBtn.addEventListener('click', function () { askNote(msg, row); });
      row.appendChild(noteBtn);
    }
    return row;
  }

  function submitFeedback(msg, verdict, row) {
    var ex = msg.layers || {};
    var text = ex[levelFor(msg)] || msg.text;
    MH.store.xai.append({
      target: 'chat:' + msg.id,
      verdict: verdict,
      level: levelFor(msg),
      excerpt: String(text).slice(0, 120)
    });
    U.toast(
      verdict === 'reject' ? '记下了：这一条不符合你的经验，我会把它放下。'
        : (verdict === 'partial' ? '记下了：这一条只对了一部分，下一版会更窄。'
          : '记下了：这条假设继续保留。'),
      'ok', 3200
    );
    var fresh = feedbackRow(msg);
    row.parentNode.replaceChild(fresh, row);
  }

  function askNote(msg, row) {
    var wrap = el('div', { class: 'xai__note' });
    var input = el('textarea', { class: 'input textarea', rows: '2', placeholder: '哪一句不准？（可留空，只标记不符合）' });
    var send = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: '提交' });
    send.addEventListener('click', function () {
      MH.store.xai.append({
        target: 'chat:' + msg.id,
        verdict: 'reject',
        level: levelFor(msg),
        excerpt: String((msg.layers && msg.layers[levelFor(msg)]) || msg.text).slice(0, 120),
        note: input.value.trim()
      });
      U.toast('记下了，下一版会绕开这个说法。', 'ok', 3200);
      wrap.parentNode.replaceChild(feedbackRow(msg), wrap);
    });
    wrap.appendChild(input);
    wrap.appendChild(send);
    row.parentNode.insertBefore(wrap, row.nextSibling);
  }

  function render(root) {
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '陪伴' }),
        el('p', { class: 'page-desc', text: '这里没有真人。回应来自本页内置的本地规则服务，它只能看到最近 14 天的均值与趋势。它给的是依据这批记录形成的一版解释，不是对你的定性——每一条都可以标记为不符合，下一版就不会再这么说。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', id: 'cmpClear', text: '清空对话' }),
        el('button', { class: 'btn btn--ghost', type: 'button', id: 'cmpCrisis', text: '求助资源' })
      ])
    ]));

    var log = el('div', { class: 'chat__log', id: 'cmpLog' });
    var input = el('textarea', { class: 'input', id: 'cmpInput', rows: '2', placeholder: '想说点什么？写完按 Ctrl / ⌘ + Enter 发送' });
    var send = el('button', { class: 'btn btn--primary', type: 'button', id: 'cmpSend', text: '发送' });
    // 主动开启引导：放在发送按钮左侧，关掉自动引导后依然可用
    var guide = el('button', {
      class: 'btn btn--ghost', type: 'button', id: 'cmpGuide',
      text: '引导我看看', title: '随时主动开始一次情绪觉察引导'
    });

    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '树洞' }),
        el('span', { class: 'badge', text: '本地服务 · 无网络出口' })
      ]),
      el('div', { class: 'chat' }, [
        log,
        el('div', { class: 'chat__composer' }, [input, guide, send])
      ])
    ]);
    root.appendChild(card);

    var disclosure = el('details', { class: 'disclosure', style: 'margin-top:16px' }, [
      el('summary', { text: '查看本次发送给本地服务的内容' }),
      el('div', { class: 'disclosure__body' }, [
        el('p', { class: 'small muted', style: 'margin-bottom:8px', text: '每次发起对话时传输的就是下面这个结构：四项指标的均值、极值、最近值与趋势斜率，不含任何单条记录、日期明细或备注原文。' }),
        el('pre', { class: 'code', id: 'cmpPayload', text: '还没有发起对话。' })
      ])
    ]);
    root.appendChild(disclosure);

    root.appendChild(el('div', { class: 'notice', style: 'margin-top:16px', html:
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<span>这不是诊断工具，也不构成医疗建议。若你正处于危机中，请优先联系专业资源（全国心理援助热线 12356，紧急电话 110 / 120）。对话记录同样只保存在本机 localStorage。</span>' }));

    bind(root);
    paintLog();
    if (lastPayload) {
      document.getElementById('cmpPayload').textContent = JSON.stringify(lastPayload, null, 2);
    }
  }

  function paintLog() {
    var log = document.getElementById('cmpLog');
    if (!log) return;
    log.innerHTML = '';
    var list = MH.store.chat.all();
    if (!list.length) {
      log.appendChild(el('div', { class: 'bubble bubble--sys', text: '这是你的私密空间。说的话只写进本机存储，不会离开这台设备。' }));
      return;
    }
    list.forEach(function (m) { log.appendChild(bubble(m)); });
    log.scrollTop = log.scrollHeight;
  }

  function bind(root) {
    var input = U.$('#cmpInput', root);
    var send = U.$('#cmpSend', root);

    function submit() {
      var text = (input.value || '').trim();
      if (!text) return;

      // 「/引导」指令等价于点按钮：不进正常回复流程，也不产生一条「我」的消息
      if (text === '/引导' || text === '/guided') {
        input.value = '';
        manualGuide();
        return;
      }
      input.value = '';

      MH.store.chat.append({ role: 'me', text: text });
      bumpTurns();
      paintLog();

      var thinking = el('div', { class: 'bubble bubble--ai', text: '本地服务处理中…' });
      var log = document.getElementById('cmpLog');
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      send.disabled = true;

      // 只取最近 14 天的统计摘要，原始记录不会离开本页存储层
      var summary = MH.stats.summary14(MH.store.records.all());

      MH.models.run('companion', { message: text, summary: summary })
        .then(function (res) {
          thinking.remove();
          var tags = (res.tags || []).slice();
          if (res.degraded && res.error) tags.push('云端失败（' + res.error.code + '），已用本地回复');
          else tags.push(res.privacy === 'on-device' ? '本地引擎' : '云端 · ' + res.modelName);

          var sent = (res.preview && res.preview.kind === 'local')
            ? { message: text, summary: summary }
            : res.preview;

          MH.store.chat.append({
            role: 'ai',
            text: res.text,
            tags: tags,
            layers: res.layers || null,      // 短 / 中 / 长 + 依据 + 请求校正
            payload: { sent: sent, model: { id: res.modelId, name: res.modelName, privacy: res.privacy, degraded: res.degraded } }
          });
          lastPayload = sent;
          var box = document.getElementById('cmpPayload');
          if (box) box.textContent = JSON.stringify(lastPayload, null, 2);
          if (res.resources && res.resources.length) {
            MH.store.chat.append({ role: 'sys', text: '已弹出求助资源卡。随时可以再点右上角「求助资源」查看。' });
          }
          paintLog();
          send.disabled = false;

          // 引导判定放在正常回复之后、焦点归位之前：
          // 卡片插入后焦点仍在输入框，不打断正在打字的人；命中危机时引导完全不触发。
          if (!(res.resources && res.resources.length)) maybeGuide(text);

          input.focus();
          if (res.resources && res.resources.length) MH.app.showCrisis();
          else if (res.truncated) U.toast('模型输出达到长度上限，这条回答可能不完整，已自动扩大输出预算重试', 'warn', 4200);
          else if (res.degraded && res.error) U.toast('云端调用未成功，已改用本地引擎：' + res.error.message, 'warn', 4200);
        })
        .catch(function (err) {
          thinking.remove();
          send.disabled = false;
          U.toast('本地服务出错：' + (err && err.message ? err.message : err), 'error');
        });
    }

    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    U.$('#cmpGuide', root).addEventListener('click', function () { manualGuide(); });

    U.$('#cmpClear', root).addEventListener('click', function () {
      if (!MH.store.chat.all().length) { U.toast('对话已经是空的', 'info'); return; }
      MH.app.confirm({
        title: '清空对话',
        body: '清空本机保存的全部对话记录？此操作无法撤销。',
        confirmText: '清空', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.chat.clear();
        // 清空对话只归零「距上次引导的轮次」；每日上限与冷静期保持不变，防止靠清空绕过
        try { if (MH.store.guided) MH.store.guided.patch({ turnsSince: 0 }); } catch (e) { /* 静默 */ }
        lastPayload = null;
        var box = document.getElementById('cmpPayload');
        if (box) box.textContent = '还没有发起对话。';
        paintLog();
        U.toast('对话记录已清空', 'ok');
      });
    });

    U.$('#cmpCrisis', root).addEventListener('click', function () { MH.app.showCrisis(); });
  }

  MH.views = MH.views || {};
  MH.views.companion = { render: render };
})(window.MH = window.MH || {});
