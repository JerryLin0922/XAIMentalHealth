/* XAI 的 DOM 级回归测试：node tests/dom-xai.cjs
   内核测试覆盖不到「按钮到底有没有接上」这件事。这里用极简 DOM 桩加载真实的
   views/companion.js，验证三档阅读、依据披露与「是否符合你的经验」反馈真的可用。 */
const path = require('path');

/* ---------------- 极简 DOM 桩 ---------------- */
const ALL = [];
const ROOTS = new Set();
const REG = {};

function attached(el) {
  if (ROOTS.has(el)) return true;
  return !!(el.parentNode && attached(el.parentNode));
}

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
  matches(sel) {
    const s = String(sel).trim();
    let tag = '', id = '', classes = [];
    const re = /([.#]?)([\w-]+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
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
  readyState: 'complete'
};
doc.body = new El('body');
global.document = doc;
global.navigator = { userAgent: 'node-test' };
global.window = global;

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
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'qa.js',
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

(async () => {
  const today = MH.util.todayISO();
  for (let i = 0; i < 10; i++) {
    MH.store.records.add({
      date: MH.util.addDays(today, -i),
      mood: 3, sleep: 6.5, heartRate: 68, stress: 6, note: 'x' + i
    });
  }

  const root = new El('div');
  ROOTS.add(root);
  MH.views.companion.render(root);

  /* ---------- 1) 发一句话，AI 回复应当带三档 ---------- */
  const input = doc.getElementById('cmpInput');
  ok(!!input, '陪伴页渲染出输入框');
  input.value = '最近压力特别大';
  doc.getElementById('cmpSend').click();
  await tick();

  const log = doc.getElementById('cmpLog');
  const ai = log.querySelectorAll('.bubble--ai').filter(n => n.querySelectorAll('.xai').length > 0);
  ok(ai.length === 1, 'AI 回复渲染出一个 XAI 区块');

  const switches = log.querySelectorAll('.xai__switch');
  const buttons = log.querySelectorAll('.xai__btn');
  ok(switches.length === 1 && buttons.length === 3, '三档开关渲染出短 / 中 / 长三个按钮');

  const stored = MH.store.chat.all().slice(-1)[0];
  ok(stored && stored.role === 'ai' && !!stored.layers, 'AI 回复把三档一并存进本机记录');
  ok(stored.layers.short && stored.layers.medium && stored.layers.long, '存下来的三档都不为空');

  const body = log.querySelectorAll('.xai__body')[0];
  const mediumText = body.textContent;
  const longBtn = buttons.filter(b => b.dataset.level === 'long')[0];
  const shortBtn = buttons.filter(b => b.dataset.level === 'short')[0];
  ok(!!longBtn && !!shortBtn, '开关按钮带 level 标记');

  longBtn.click();
  ok(body.textContent !== mediumText, '切到长档后正文换成更展开的版本');
  ok(body.textContent.indexOf(stored.layers.long) >= 0, '长档显示的是解释对象里的长文本');
  ok(longBtn.classList.contains('is-on') && !shortBtn.classList.contains('is-on'), '当前档位有选中态');

  shortBtn.click();
  ok(body.textContent.indexOf(stored.layers.short) >= 0, '切到短档后只显示一句话结论');
  ok(MH.store.prefs.get().xaiLevel === 'short', '选择的深度被记成以后新回复的默认档');

  /* ---------- 2) 依据必须看得见 ---------- */
  const basis = log.querySelectorAll('.xai__basis');
  ok(basis.length === 1, '提供了一个可以展开的「依据」区');
  ok(log.querySelectorAll('.xai__ask')[0].textContent.indexOf('哪些部分符合你的经验') >= 0,
    '回复结尾向当事人征求校正');

  /* ---------- 3) 标记「不符合」要真的落库并改变界面 ---------- */
  const fbRow = log.querySelectorAll('.xai__fb')[0];
  const rejectBtn = fbRow.children.filter(c => c.textContent === '不符合')[0];
  ok(!!rejectBtn, '反馈区提供「不符合」按钮');
  rejectBtn.click();
  await tick(0);

  const rows = MH.store.xai.all();
  ok(rows.length === 1 && rows[0].verdict === 'reject', '一次「不符合」写入本机反馈');
  ok(rows[0].target.indexOf('chat:') === 0, '反馈绑定到具体的那一条回复');
  const freshRow = log.querySelectorAll('.xai__fb')[0];
  ok(freshRow.textContent.indexOf('下一版会避开') >= 0, '界面确认这条已被记下并可改回来');

  /* ---------- 4) 被否掉的解释，下一版要承认 ---------- */
  doc.getElementById('cmpInput').value = '还是很累';
  doc.getElementById('cmpSend').click();
  await tick();
  const last = MH.store.chat.all().slice(-1)[0];
  ok(!!last.layers && last.layers.long.indexOf('放下') >= 0,
    '新一版回复主动承认上一版被推翻，不再原地复述');

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
