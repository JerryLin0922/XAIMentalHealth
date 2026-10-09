/* 情绪引导（Guided Learning）DOM 级回归测试：node tests/dom-guided.cjs

   内核的纯函数（识别 / 评分 / 触发 / 内容）在 node 里可以直接断言，但
   「卡片到底有没有渲染出来」「按钮到底有没有接上」「点完会不会复活」这三件事
   只有加载真实的 views/companion.js 才能验证。

   本套件用极简 DOM 桩（与 tests/dom-xai.cjs 同源）加载真实的
   js/core/guided.js + js/views/companion.js，按设计文档 §9 的分组写断言：
     A 识别 / B 强度 / C 触发 reason / D 状态与冷静期 / E 内容
     F 渲染 / G 交互 / H 存储与异常 / I 设置页重开
   断言遵循「期望正确行为」，不迁就实现：失败即报，不改断言去迎合代码。 */
const path = require('path');
const fs = require('fs');

/* ---------------- 极简 DOM 桩 ---------------- */
const ALL = [];
const ROOTS = new Set();
const REG = {};

function attached(el) {
  if (ROOTS.has(el)) return true;
  return !!(el.parentNode && attached(el.parentNode));
}

let focusCount = 0;

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.disabled = false;
    this.hidden = false;
    this.classList = {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); }
    };
    ALL.push(this);
  }
  appendChild(c) {
    if (c == null) return c;
    this.children.push(c);
    c.parentNode = this;
    if (c.attrs && c.attrs.id) REG[c.attrs.id] = c;
    return c;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return i >= 0 ? (this.parentNode.children[i + 1] || null) : null;
  }
  insertBefore(nu, ref) {
    this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, nu);
    nu.parentNode = this;
    return nu;
  }
  replaceChild(nu, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) {
      old.parentNode = null;
      this.children[i] = nu;
      nu.parentNode = this;
    }
    return old;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') REG[v] = this;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatch(t, evt) { (this.listeners[t] || []).slice().forEach(f => f.call(this, evt || {})); }
  click() { this.dispatch('click'); }
  // 桩补充：真实的 focus() 在浏览器里存在，断言「卡片不抢焦点」必须能计数
  focus() { focusCount++; doc.activeElement = this; }
  matches(sel) {
    const s = String(sel).trim();
    const attrRe = /\[([\w-]+)(?:=([^\]]+))?\]/g;
    let am;
    while ((am = attrRe.exec(s)) !== null) {
      if (!(am[1] in this.attrs)) return false;
      const want = (am[2] || '').replace(/^["']|["']$/g, '');
      if (am[2] && String(this.attrs[am[1]]) !== want) return false;
    }
    let tag = '', id = '', classes = [];
    const re = /([.#]?)([\w-]+)/g;
    let m;
    while ((m = re.exec(s.replace(/\[[^\]]*\]/g, '').trim())) !== null) {
      if (m[1] === '#') id = m[2];
      else if (m[1] === '.') classes.push(m[2]);
      else tag = m[2].toUpperCase();
    }
    if (tag && this.tagName !== tag) return false;
    if (id && this.attrs.id !== id) return false;
    const own = String(this.attrs.class || '').split(/\s+/);
    return classes.every(c => own.includes(c));
  }
  querySelectorAll(sel, out = []) {
    if (this.matches(sel)) out.push(this);
    this.children.forEach(c => c.querySelectorAll(sel, out));
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    this._html = String(v);
    this.children.forEach(c => { c.parentNode = null; });
    this.children = [];
  }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map(c => (c && c.textContent) || '').join('');
  }
  set textContent(v) { this._text = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get value() {
    if (this._value !== undefined) return this._value;
    return this.attrs.value === undefined ? '' : this.attrs.value;
  }
  set value(v) { this._value = v; }
}

const doc = {
  createElement: t => new El(t),
  createTextNode: t => { const e = new El('#text'); e.textContent = t; return e; },
  getElementById: id => REG[id] || null,
  querySelector(sel) { return ALL.filter(attached).find(el => el.matches(sel)) || null; },
  querySelectorAll(sel) {
    const out = [];
    ALL.filter(attached).forEach(el => el.querySelectorAll(sel, out));
    return out;
  },
  addEventListener() {},
  readyState: 'complete',
  activeElement: null
};
doc.body = new El('body');
global.document = doc;
global.navigator = { userAgent: 'node-test' };
global.window = global;
// 保留真实的 URL 构造函数，只补缺失的静态方法（换成普通对象会让 instanceof URL 抛错）
const realURL = global.URL;
if (!realURL || typeof realURL.createObjectURL !== 'function') {
  global.URL.createObjectURL = () => 'blob:test';
}
if (!realURL || typeof realURL.revokeObjectURL !== 'function') {
  global.URL.revokeObjectURL = function () {};
}
global.Blob = function (parts) { this.parts = parts; };

const memLS = new Map();
global.localStorage = {
  getItem: k => (memLS.has(k) ? memLS.get(k) : null),
  setItem: (k, v) => memLS.set(k, String(v)),
  removeItem: k => memLS.delete(k)
};
global.sessionStorage = global.localStorage;

const base = path.join(__dirname, '..', 'js', 'core');
[
  'util.js', 'crypto.js', 'store.js', 'metrics.js', 'stats.js',
  // 顺序照抄 index.html：guided.js 在 local-service.js 之后（crisis 委托给它，被依赖者先加载）
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'guided.js', 'qa.js',
  'i18n.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js'
].forEach(f => { require(path.join(base, f)); });

const MH = global.MH;
MH.app = { confirm: () => Promise.resolve(true), showCrisis() {}, refreshCurrent() {} };
require(path.join(__dirname, '..', 'js', 'views', 'companion.js'));

let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}
const tick = () => new Promise(r => setTimeout(r, 600));

/* ---------------- 公共夹具 ---------------- */
const DAY = 86400000;
const T0 = new Date(2025, 5, 1, 10, 0, 0).getTime();      // 2025-06-01 10:00 本地时间
const HOT = '气死了，凭什么最后是我背锅';                   // grievance 0.65，稳定命中

/** 一份干净的频率状态；turnsSince 给足，避免首次触发被 INTERVAL 挡住。 */
function freshState(over) {
  return Object.assign({
    schema: 'moodhub.guided/v1',
    day: '2025-06-01',
    dayAuto: 0,
    lastAutoAt: 0,
    lastEmotion: '',
    lastEmotionAt: 0,
    declineAt: 0,
    declineCount: 0,
    turnsSince: 99,
    alias: {},
    history: []
  }, over || {});
}

function trig(over) {
  return MH.guided.shouldTrigger(Object.assign({
    text: HOT, turns: 3, now: T0, mode: 'auto', state: freshState()
  }, over || {}));
}

(async () => {
  /* ==================================================================
     A 组：情绪识别（9 族 + 兜底 + 危机）
     ================================================================== */
  const A_CASES = [
    ['anger', '气死了'],
    ['grievance', '凭什么最后是我背锅'],
    ['anxiety', '心里慌'],
    ['excitement', '我居然做到了'],
    ['low', '提不起劲'],
    ['tired', '撑不住了'],
    ['lonely', '没人懂我'],
    ['shame', '都怪我']
  ];
  A_CASES.forEach(function (c) {
    const d = MH.guided.detect(c[1]);
    ok(d && d.key === c[0], 'A 识别：' + c[1] + ' → ' + c[0] + '（实际 ' + (d ? d.key : 'null') + '）');
  });
  ok(MH.guided.detect('你好') === null, 'A 识别：问候语「你好」不命中任何情绪族');
  ok(MH.guided.detect('有点烦') === null, 'A 识别：「有点烦」完全不命中（不是低分，是 null）');
  const g = MH.guided.detect('心里堵得慌');
  ok(g && g.key === 'generic' && g.auto === false, 'A 识别：「心里堵得慌」落到兜底族 generic 且不允许自动触发');
  ok(MH.guided.detect('') === null && MH.guided.detect(null) === null, 'A 识别：空文本不命中，不抛错');
  ok(MH.guided.score('气死了！！', 'anger') >= 0.55, 'A 识别：「气死了！！」强度达自动触发线');
  const cris = MH.guided.shouldTrigger({ text: '我不想活了', turns: 3, now: T0, mode: 'auto', state: freshState() });
  ok(cris.ok === false && cris.reason === 'CRISIS', 'A 识别：危机句 → CRISIS，引导完全不触发');

  /* ==================================================================
     B 组：强度评分
     ================================================================== */
  const sBase = MH.guided.score('我有点生气', 'anger');
  ok(sBase > 0 && sBase < 0.55, 'B 强度：基础句只拿命中分（' + sBase + ' < 0.55），不自动触发');
  ok(MH.guided.score('气死了！！', 'anger') === 0.6, 'B 强度：「气死了！！」= 0.35+0.10+0.15 = 0.60');
  ok(MH.guided.score('有点烦', 'anger') === 0, 'B 强度：「有点烦」score 为 0（裸字没进正则）');
  const sAdv = MH.guided.score('非常焦虑', 'anxiety') - MH.guided.score('焦虑', 'anxiety');
  ok(Math.abs(sAdv - 0.2) < 1e-9, 'B 强度：强度副词「非常」恰好加 0.20（实际 ' + sAdv + '）');
  const sAlways = MH.guided.score('我一直很累', 'tired');
  ok(sAlways === 0.45, 'B 强度：「一直」只计一次累积语义（0.35+0.10=0.45，实际 ' + sAlways + '）');
  const sHold = MH.guided.score('我忍不住想哭', 'low');
  ok(sHold === 0.45, 'B 强度：「忍不住」只计一次极端表达（0.35+0.10=0.45，实际 ' + sHold + '）');
  // Q11 的正主：同时含「一直」与「忍不住」的句子，相对基础句只能 +0.20（0.10+0.10），
  // 不能是 +0.40（两词各被两档重复计分）。只断言单个词测不到「不重复计分」这件事。
  const sBoth = MH.guided.score('一直忍不住很烦', 'anger') - MH.guided.score('很烦', 'anger');
  ok(Math.abs(sBoth - 0.2) < 1e-9,
    'B 强度：「一直」+「忍不住」合计只贡献 0.20，不重复计分（实际 ' + sBoth + '）');
  const sMax = MH.guided.score('太焦虑了，一直胡思乱想，又快疯了！！', 'anxiety');
  ok(sMax === 1 && sMax <= 1, 'B 强度：叠加再多也封顶为 1（实际 ' + sMax + '）');
  ok(MH.guided.score('你好', 'anger') === 0, 'B 强度：未命中该族 → score 为 0');

  /* ==================================================================
     C 组：触发 reason 判定顺序
     ================================================================== */
  ok(trig({}).ok === true && trig({}).reason === 'OK', 'C 触发：四条件全满足 → OK');
  ok(trig({ turns: 1 }).reason === 'TURNS', 'C 触发：会话内轮次 1 → TURNS（第一句话不引导）');
  MH.store.prefs.set({ guidedAuto: false });
  ok(trig({}).reason === 'DISABLED', 'C 触发：prefs.guidedAuto=false → DISABLED');
  MH.store.prefs.set({ guidedAuto: true });
  ok(trig({ state: freshState({ declineAt: T0 - DAY }) }).reason === 'COOLDOWN', 'C 触发：冷静期内 → COOLDOWN');
  ok(trig({ text: '我有点生气', state: freshState() }).reason === 'INTENSITY', 'C 触发：强度不足 → INTENSITY');
  ok(trig({ state: freshState({ dayAuto: 2 }) }).reason === 'DAILY_LIMIT', 'C 触发：当日第 3 次 → DAILY_LIMIT');
  ok(trig({ state: freshState({ lastEmotion: 'grievance', lastEmotionAt: T0 - 3600000 }) }).reason === 'SAME_EMOTION',
    'C 触发：同族 24h 内 → SAME_EMOTION');
  ok(trig({ state: freshState({ turnsSince: 2 }) }).reason === 'INTERVAL', 'C 触发：间隔轮次不足 → INTERVAL');
  ok(trig({ state: freshState({ lastAutoAt: T0 - 60000 }) }).reason === 'INTERVAL', 'C 触发：距上次不足 30 分钟 → INTERVAL');
  const cross = trig({ now: T0 + DAY, state: freshState({ day: '2025-06-01', dayAuto: 2 }) });
  ok(cross.ok === true && cross.reason === 'OK', 'C 触发：跨自然日后 dayAuto 归零，可再次触发');
  const gen = MH.guided.shouldTrigger({ text: '心里堵得慌', turns: 3, now: T0, mode: 'auto', state: freshState() });
  ok(gen.ok === false && gen.reason === 'NO_EMOTION', 'C 触发：兜底族在自动模式下静默（NO_EMOTION）');
  ok(MH.guided.shouldTrigger({ text: '你好', turns: 5, now: T0, mode: 'auto', state: freshState() }).reason === 'NO_EMOTION',
    'C 触发：没读到情绪 → NO_EMOTION，不追问');

  /* ==================================================================
     D 组：状态机与冷静期（「绕过」≠「清除」）
     ================================================================== */
  MH.guided.reset();
  MH.guided.patch({ declineAt: T0, declineCount: 1 });
  ok(MH.guided.state().declineAt === T0, 'D 状态：「这次先不了」把 declineAt 落库');
  const inCd = MH.guided.shouldTrigger({ text: HOT, turns: 3, now: T0 + 3 * DAY, mode: 'auto' });
  ok(inCd.ok === false && inCd.reason === 'COOLDOWN', 'D 状态：冷静期内 3 天，shouldTrigger 恒 false');

  const manual = MH.guided.tryManual({ text: HOT, turns: 3, now: T0 + 4 * DAY, mode: 'manual' });
  ok(manual.ok === true && !!manual.message, 'D 状态：冷静期内手动开启照常出卡（绕过）');
  ok(MH.guided.state().declineAt === T0, 'D 状态：手动出卡不清除 declineAt（第 4 天开过，第 5 天仍不出）');
  const day5 = MH.guided.shouldTrigger({ text: HOT, turns: 3, now: T0 + 5 * DAY, mode: 'auto' });
  ok(day5.ok === false && day5.reason === 'COOLDOWN', 'D 状态：第 5 天仍然不自动出卡');

  const day8 = MH.guided.shouldTrigger({
    text: HOT, turns: 3, now: T0 + 8 * DAY, mode: 'auto', state: freshState({ declineAt: T0 })
  });
  ok(day8.ok === true, 'D 状态：冷静期走满 7 天后恢复自动触发');

  ok(typeof MH.guided.inCooldown === 'function', 'D 状态：MH.guided.inCooldown(now, state) 存在（冷静期判定唯一入口）');
  if (typeof MH.guided.inCooldown === 'function') {
    ok(MH.guided.inCooldown(T0 + DAY, { declineAt: T0 }) === true &&
      MH.guided.inCooldown(T0 + 8 * DAY, { declineAt: T0 }) === false &&
      MH.guided.inCooldown(T0, { declineAt: 0 }) === false,
      'D 状态：inCooldown 纯函数判定正确（7 天内 true / 超时 false / 未被拒 false）');
  }

  MH.guided.reset();
  MH.guided.patch({ declineCount: 2 });
  MH.guided.record({ emotion: 'anger', mode: 'auto', outcome: 'acted', at: T0 });
  ok(MH.guided.state().declineCount === 0, 'D 状态：点「我记下了」（outcome:acted）复位 declineCount，阈值回落');
  MH.guided.patch({ declineCount: 2 });
  MH.store.xai.append({ target: 'chat:guided-d-test', verdict: 'fits', level: 'medium', excerpt: '' });
  ok(MH.guided.state().declineCount === 2, 'D 状态：点「符合」反馈不复位 declineCount（认可读法 ≠ 愿意继续）');
  const raised = MH.guided.shouldTrigger({
    text: '气死了！！', turns: 3, now: T0, mode: 'auto', state: freshState({ declineCount: 2 })
  });
  ok(raised.ok === false && raised.reason === 'INTENSITY', 'D 状态：连续被拒 2 次后阈值升到 0.7（0.60 不再够）');

  ok(typeof MH.guided.enableAuto === 'function',
    'D 状态：MH.guided.enableAuto() 存在（唯一合法的清冷静期出口）');
  if (typeof MH.guided.enableAuto === 'function') {
    MH.guided.reset();
    MH.guided.patch({ declineAt: T0, declineCount: 2 });
    MH.guided.enableAuto();
    const after = MH.guided.state();
    ok(after.declineAt === 0 && after.declineCount === 0,
      'D 状态：enableAuto() 同时清空 declineAt 与 declineCount');
  } else {
    ok(false, 'D 状态：enableAuto() 清冷静期（缺少 API，无法验证）');
  }

  /* ==================================================================
     E 组：内容生成（六段齐全 / 兜底 / 不说教 / 不复述原话）
     ================================================================== */
  const ctxHot = { text: HOT, turns: 3, now: T0, mode: 'auto', emotion: MH.guided.detect(HOT) };
  const content = MH.guided.build('grievance', ctxHot);
  const sixOK = ['name', 'validate', 'signal', 'action', 'closing'].every(k => typeof content[k] === 'string' && content[k].length > 0) &&
    Array.isArray(content.questions) && content.questions.length > 0;
  ok(sixOK, 'E 内容：六段齐全（命名 / 共情 / 信号 / 问题 / 行动 / 收尾）且无非空兜底漏洞');

  let unknownOK = true;
  let unknown = null;
  try { unknown = MH.guided.build('不存在的族', ctxHot); } catch (e) { unknownOK = false; }
  ok(unknownOK && unknown && unknown.emotion.key === 'generic', 'E 内容：未知 key 回落 generic 且不抛错');
  let undefOK = true;
  let undefRes = null;
  try { undefRes = MH.guided.build(undefined, undefined); } catch (e) { undefOK = false; }
  ok(undefOK && !!undefRes, 'E 内容：build(undefined, undefined) 不抛错');

  const sp = MH.guided.spec(content, ctxHot);
  ok(sp.evidence.length === 1 && /凭什么|背锅/.test(sp.evidence[0]),
    'E 内容：evidence 含命中的情绪词（用户核查「你凭什么说我是委屈」的依据）');

  const bodyAll = [content.name, content.validate, content.signal].concat(content.questions).join(content.action + content.closing);
  ok(bodyAll.indexOf('背锅') < 0 && bodyAll.indexOf('凭什么') < 0 && bodyAll.indexOf('气死') < 0,
    'E 内容：正文六段不含用户原话（{{quote}} 不落库也不引用）');

  const layers = MH.guided.compose('grievance', ctxHot);
  ok(layers.tags[0] === '引导式学习' && layers.tags[1] === '委屈' && layers.tags[2] === '自动出现',
    'E 内容：气泡 tag 为「引导式学习 / 情绪名 / 自动出现」（实际 ' + layers.tags.join(' / ') + '）');
  const layersM = MH.guided.compose('grievance', Object.assign({}, ctxHot, { mode: 'manual' }));
  ok(layersM.tags[2] === '手动开启', 'E 内容：手动开启的 tag 为「手动开启」（与「自动出现」对称）');
  const bnd = MH.guided.boundary('none');
  ok(typeof bnd === 'string' && bnd.indexOf('边界：我只读到你这一句话') === 0 &&
    layers.long.indexOf(bnd) >= 0,
    'E 内容：boundary() 返回推理边界整句，且与 layers.long 里那句同源');

  const audit = MH.xai.audit(layers.long);
  const badHits = audit.hits.filter(h => h === 'identity' || h === 'diagnosis' || h === 'absolute');
  ok(badHits.length === 0, 'E 内容：长档过 audit() 无 identity / diagnosis / absolute 命中（不说教、不替人定性）');

  const onlyName = MH.guided.build('anger', { text: '气死了', turns: 1, now: T0, mode: 'manual' });
  ok(onlyName.onlyName === true && onlyName.signal === '' && onlyName.questions.length === 0 && onlyName.action === '',
    'E 内容：手动 + 轮次不足 → onlyName，只做命名不做解读');
  ok(onlyName.note === MH.guided.NAME_ONLY, 'E 内容：轮次不足附降级说明「信息还不多，这一步我只做命名，不做解读。」');
  const genC = MH.guided.build('generic', { text: '', turns: 3, now: T0, mode: 'manual' });
  ok(genC.note === MH.guided.NO_SIGNAL && genC.signal === '' && genC.action === '',
    'E 内容：兜底族只做命名邀请，不做信号解读与小行动');

  /* ==================================================================
     F / G 组：真实渲染与交互（加载 companion.js）
     ================================================================== */
  MH.guided.reset();
  MH.store.chat.clear();
  MH.store.prefs.set({ guidedAuto: true, xaiLevel: 'medium' });

  const root = new El('div');
  ROOTS.add(root);
  MH.views.companion.render(root);

  const input = doc.getElementById('cmpInput');
  ok(!!input && !!doc.getElementById('cmpGuide'), 'G 交互：陪伴页渲染出输入框与「引导我看看」按钮');

  input.value = '你好';
  doc.getElementById('cmpSend').click();
  await tick();
  const beforeFocus = focusCount;
  input.value = HOT;
  doc.getElementById('cmpSend').click();
  await tick();

  const log = doc.getElementById('cmpLog');
  const cards = log.querySelectorAll('.gl');
  ok(cards.length === 1, 'F 渲染：强情绪发言后出现且仅出现一张引导卡（.gl × 1）');

  const card = cards[0];
  ['gl__head', 'gl__name', 'gl__validate', 'gl__signal', 'gl__questions', 'gl__action', 'gl__foot']
    .forEach(function (cls) {
      ok(card.querySelectorAll('.' + cls).length >= 1, 'F 渲染：卡片含 .' + cls);
    });

  ok(card.querySelectorAll('[data-block=signal]').length === 1 &&
    card.querySelectorAll('[data-block=questions]').length === 1 &&
    card.querySelectorAll('[data-block=action]').length === 1,
    'F 渲染：data-block 属性选择器可命中三个区块（属性与 dataset 都写了）');
  ok(card.querySelectorAll('.gl__block').filter(n => n.dataset.block === 'signal').length === 1,
    'F 渲染：dataset.block 读法同样命中（两种写法都可用）');

  ok(String(card.getAttribute('aria-label') || '').indexOf('情绪引导 · ') === 0, 'F 渲染：卡片 aria-label 以「情绪引导 · 」开头');
  ok(card.getAttribute('role') === 'group' && card.getAttribute('aria-live') === 'polite', 'F 渲染：卡片 role=group 且 aria-live=polite');

  const lvBtns = card.querySelectorAll('.xai__btn');
  ok(lvBtns.length === 3, 'F 渲染：三档开关渲染出短 / 中 / 长三个按钮');
  const btnOf = lv => lvBtns.filter(b => b.dataset.level === lv)[0];
  const blockOf = kind => card.querySelectorAll('.gl__block').filter(n => n.dataset.block === kind)[0];
  const opened = () => ['signal', 'questions', 'action']
    .map(k => blockOf(k) && blockOf(k).classList.contains('is-open'));

  btnOf('short').click();
  ok(opened().every(v => v === false), 'F 渲染：短档 → 信号 / 问题 / 行动三块全收起');
  ok(btnOf('short').getAttribute('aria-pressed') === 'true' && btnOf('long').getAttribute('aria-pressed') === 'false',
    'F 渲染：当前档位按钮 aria-pressed 正确');
  btnOf('medium').click();
  ok(opened()[0] === true && opened()[1] === false && opened()[2] === true,
    'F 渲染：中档 → 信号与行动展开、问题收起');
  btnOf('long').click();
  ok(opened().every(v => v === true), 'F 渲染：长档 → 三块全部展开');

  const basis = card.querySelectorAll('.xai__basis')[0];
  ok(!!basis, 'F 渲染：卡片复用 .xai__basis（不新造一套解释 UI）');
  ok(basis && basis.getAttribute('open') !== null, 'F 渲染：长档时 .xai__basis 自动展开（推理边界要有出口）');
  ok(basis && basis.textContent.indexOf('边界：我只读到你这一句话') >= 0,
    'F 渲染：长档 .xai__basis 正文含推理边界句（「长＝把推论摊开」不能落空）');
  btnOf('short').click();
  ok(basis.textContent.indexOf('边界：我只读到你这一句话') < 0, 'F 渲染：切回短档后推理边界句消失');

  btnOf('medium').click();
  const sigHead = blockOf('signal').querySelectorAll('.gl__block-head')[0];
  sigHead.click();                                   // 用户手动收起信号
  ok(blockOf('signal').classList.contains('is-open') === false, 'F 渲染：点区块标题可手动收起');
  btnOf('long').click();
  ok(blockOf('signal').classList.contains('is-open') === false,
    'F 渲染：手动开合过的区块脱离档位联动，不再被切档改写');

  ok(focusCount - beforeFocus === 1, 'G 交互：引导卡插入不抢焦点（只发生正常的输入框归位一次）');
  ok(doc.activeElement === input, 'G 交互：卡片插入后焦点仍在输入框，不打断打字的人');

  /* 「我记下了」→ 记一次 acted，按钮禁用并追加「已记下」 */
  const actedBtn = card.querySelectorAll('.gl__actions')[0].children
    .filter(c => c.textContent === '我记下了')[0];
  ok(!!actedBtn, 'G 交互：行动区提供「我记下了」按钮');
  actedBtn.click();
  ok(actedBtn.disabled === true && card.textContent.indexOf('已记下') >= 0,
    'G 交互：点「我记下了」后按钮禁用并追加「已记下」，卡片保持可读');
  ok(MH.guided.state().history.some(h => h.outcome === 'acted'), 'G 交互：「我记下了」写入 history');

  /* 「这次先不了」→ 收起为一行系统提示 + 7 天冷静期 */
  const closeBtn = card.querySelectorAll('.gl__close')[0];
  ok(!!closeBtn && closeBtn.textContent === '这次先不了', 'G 交互：卡头提供「这次先不了」');
  closeBtn.click();
  ok(MH.guided.state().declineAt > 0, 'G 交互：点「这次先不了」写入 declineAt（7 天冷静期）');
  ok(log.querySelectorAll('.gl').length === 0 &&
    log.querySelectorAll('.bubble--sys').filter(n => n.textContent === '已跳过这一次的引导。').length === 1,
    'G 交互：卡片收起为一行系统提示「已跳过这一次的引导。」');
  MH.views.companion.render(root);                   // 重绘后不能复活
  ok(doc.getElementById('cmpLog').querySelectorAll('.gl').length === 0,
    'G 交互：paintLog() 重绘后被收起的引导卡不复活');

  /* Q15：冷静期内完全静默——连那条同族轻提示也不能出（它会变成「你上次没看」的暗示）。
     用句必须强度达标（≥0.55），否则先被判 INTENSITY，测到的就不是「静默」了。 */
  const hintNow = () => doc.getElementById('cmpLog').querySelectorAll('.bubble--sys')
    .filter(n => n.textContent === MH.guided.repeatHint()).length;
  const inpCd = doc.getElementById('cmpInput');
  inpCd.value = '凭什么又是我在背锅，气死了！！';
  doc.getElementById('cmpSend').click();
  await tick();
  const cdDet = MH.guided.detect('凭什么又是我在背锅，气死了！！');
  ok(cdDet && cdDet.key === 'grievance' && cdDet.score >= 0.55,
    'Q15 前置：冷静期用例用句确实命中同族且强度达标（' + (cdDet ? cdDet.score : 'null') + '）');
  ok(hintNow() === 0, 'Q15：冷静期内同族重复完全静默，不追加任何轻提示');
  ok(doc.getElementById('cmpLog').querySelectorAll('.gl').length === 0, 'Q15：冷静期内也不出引导卡');

  /* 指令：/引导 与 /guided 都不产生「我」的消息 */
  const meBefore = MH.store.chat.all().filter(m => m.role === 'me').length;
  const inp2 = doc.getElementById('cmpInput');
  inp2.value = '/引导';
  doc.getElementById('cmpSend').click();
  await tick();
  ok(MH.store.chat.all().filter(m => m.role === 'me').length === meBefore, 'G 交互：/引导 指令不产生 role:me 消息');
  ok(doc.getElementById('cmpLog').querySelectorAll('.gl').length === 1, 'G 交互：/引导 直接出一张引导卡');
  inp2.value = '/guided';
  doc.getElementById('cmpSend').click();
  await tick();
  ok(MH.store.chat.all().filter(m => m.role === 'me').length === meBefore, 'G 交互：/guided 同样不产生 role:me 消息');
  ok(doc.getElementById('cmpLog').querySelectorAll('.gl').length === 2, 'G 交互：/guided 也出一张引导卡');

  /* 「不再自动引导」→ 只关自动，手动入口仍然可用 */
  MH.store.prefs.set({ guidedAuto: true });
  const card2 = doc.getElementById('cmpLog').querySelectorAll('.gl')[1];
  const footBtn = card2.querySelectorAll('.gl__foot-btn')[0];
  ok(!!footBtn && footBtn.textContent === '不再自动引导', 'G 交互：页脚提供「不再自动引导」文字链');
  footBtn.click();
  ok(MH.store.prefs.get().guidedAuto === false, 'G 交互：点「不再自动引导」→ prefs.guidedAuto=false');
  doc.getElementById('cmpGuide').click();
  await tick();
  ok(doc.getElementById('cmpLog').querySelectorAll('.gl').length === 3,
    'G 交互：关掉自动后「引导我看看」仍可用（关的是自动，不是功能）');
  ok(trig({}).reason === 'DISABLED', 'G 交互：关掉自动后冷静期之外的场景也不再自动出卡');

  /* 兜底族：手动开启且读不到情绪 → generic 卡，空区块不渲染 */
  MH.store.chat.clear();
  MH.store.prefs.set({ guidedAuto: true });
  const inp3 = doc.getElementById('cmpInput');
  inp3.value = '你好';
  doc.getElementById('cmpSend').click();
  await tick();
  inp3.value = '今天的天气不错';
  doc.getElementById('cmpSend').click();
  await tick();
  doc.getElementById('cmpGuide').click();
  await tick();
  const log3 = doc.getElementById('cmpLog');
  const genCard = log3.querySelectorAll('.gl').slice(-1)[0];
  ok(!!genCard && genCard.getAttribute('data-emotion') === 'generic', 'F 渲染：读不到情绪时手动开启走 generic 兜底卡');
  ok(genCard.querySelectorAll('.gl__signal').length === 0 && genCard.querySelectorAll('.gl__action').length === 0,
    'F 渲染：空区块（signal / action）不渲染节点，而不是渲染空标题');
  ok(genCard.querySelectorAll('.gl__questions').length === 1, 'F 渲染：generic 卡仍渲染「可以问自己」区块');
  ok(genCard.textContent.indexOf('undefined') < 0, 'F 渲染：卡片任何位置都不出现 undefined');

  /* ==================================================================
     边界：同族 24h 内重复（PRD §8.8）——只出一句最轻的系统提示，30 分钟节流
     ================================================================== */
  MH.guided.reset();
  MH.store.chat.clear();
  MH.store.prefs.set({ guidedAuto: true });
  MH.views.companion.render(root);
  const inp4 = doc.getElementById('cmpInput');
  inp4.value = '你好';
  doc.getElementById('cmpSend').click();
  await tick();
  inp4.value = HOT;
  doc.getElementById('cmpSend').click();
  await tick();
  const log4 = doc.getElementById('cmpLog');
  ok(log4.querySelectorAll('.gl').length === 1, '边界：同族场景已出过一张卡');
  ok(MH.guided.state().declineAt === 0, '边界：反向用例前置——此刻不在冷静期（静默没把功能关死）');

  inp4.value = '又有人让我背锅，凭什么';
  doc.getElementById('cmpSend').click();
  await tick();
  const hintBubbles = () => doc.getElementById('cmpLog').querySelectorAll('.bubble--sys')
    .filter(n => n.textContent === MH.guided.repeatHint());
  ok(hintBubbles().length === 1, '边界：同族 24h 内重复 → 只追加一句系统提示，不重复出卡');
  ok(log4.querySelectorAll('.gl').length === 1, '边界：同族重复不重复出同类卡');

  inp4.value = '凭什么又是我';
  doc.getElementById('cmpSend').click();
  await tick();
  ok(hintBubbles().length === 1, '边界：30 分钟内不重复提示（节流生效，避免变成新的打扰源）');

  /* 边界：清空对话只归零 turnsSince，频率限制与冷静期保持不变（PRD §8.12） */
  MH.guided.patch({ turnsSince: 7, dayAuto: 1, declineAt: Date.now(), declineCount: 1 });
  doc.getElementById('cmpClear').click();
  await tick();
  const afterClear = MH.guided.state();
  ok(afterClear.turnsSince === 0, '边界：清空对话 → turnsSince 归零，轮次门槛重新计数');
  ok(afterClear.dayAuto === 1 && afterClear.declineAt > 0,
    '边界：清空对话不动每日上限与冷静期（防止靠清空绕过频率限制）');

  /* ==================================================================
     H 组：存储往返与异常降级
     ================================================================== */
  MH.guided.reset();
  MH.guided.patch({ dayAuto: 1, lastEmotion: 'anger' });
  const dump = MH.store.exportAll();
  ok(dump && dump.guided && dump.guided.schema === 'moodhub.guided/v1', 'H 存储：exportAll() 含 guided 且 schema 正确');

  MH.guided.reset();
  ok(MH.guided.state().dayAuto === 0, 'H 存储：reset() 后频率计数归零');
  const restored = MH.store.importAll(Object.assign({}, dump, { records: [] }), 'replace');
  ok(MH.guided.state().lastEmotion === 'anger', 'H 存储：importAll() 能还原 guided 状态');

  const prevAvailable = MH.store.storageAvailable;
  MH.store.storageAvailable = false;
  let noThrow = true;
  let noStoreRes = null;
  try {
    noStoreRes = MH.guided.shouldTrigger({ text: HOT, turns: 3, now: T0, mode: 'auto', state: freshState({ dayAuto: 1 }) });
  } catch (e) { noThrow = false; }
  ok(noThrow && noStoreRes.reason === 'DAILY_LIMIT', 'H 异常：storageAvailable=false 时不抛错，每日上限降为 1');
  MH.store.storageAvailable = prevAvailable;

  /* ==================================================================
     I 组：设置页重开 = 唯一合法的清冷静期入口
     ================================================================== */
  let settingsLoaded = true;
  try {
    require(path.join(__dirname, '..', 'js', 'views', 'settings.js'));
  } catch (e) { settingsLoaded = false; }
  ok(settingsLoaded && MH.views && typeof MH.views.settings.render === 'function', 'I 设置：设置页可加载并渲染');
  if (settingsLoaded && MH.views && typeof MH.views.settings.render === 'function') {
    MH.guided.reset();
    MH.guided.patch({ declineAt: Date.now(), declineCount: 2 });
    MH.store.prefs.set({ guidedAuto: false });
    const sRoot = new El('div');
    ROOTS.add(sRoot);
    MH.views.settings.render(sRoot);
    const cb = doc.getElementById('setGuidedAuto');
    ok(!!cb, 'I 设置：设置页渲染出「情绪引导」开关（#setGuidedAuto）');
    if (cb) {
      cb.checked = true;
      cb.dispatch('change');
      ok(MH.store.prefs.get().guidedAuto === true, 'I 设置：开关打开后自动引导恢复');
      const st = MH.guided.state();
      ok(st.declineAt === 0 && st.declineCount === 0,
        'I 设置：设置页重开清空 declineAt 与 declineCount（唯一能清冷静期的入口）');
    }
  }

  /* 静态约束：清冷静期只允许出现在内核里，视图不许另写一份 */
  const companionSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'companion.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'settings.js'), 'utf8');
  ok(!/declineAt\s*=\s*0/.test(companionSrc) && !/declineAt\s*=\s*0/.test(settingsSrc),
    'I 设置：视图层不出现 declineAt = 0（同一规则两份实现必漏改）');

  /* 清空全部数据后 guided 一起消失 */
  MH.guided.patch({ dayAuto: 2 });
  MH.store.wipeEverything();
  ok(MH.guided.state().history.length === 0 && MH.guided.state().dayAuto === 0,
    'H 存储：wipeEverything() 清空 guided，不留看不见的暗数据');

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
