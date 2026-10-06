/* 智能问答页的 DOM 级回归测试：node tests/dom-qa.cjs
   用极简 DOM 桩加载真实的 views/qa.js，验证新增的「我的 · .me」面板
   确实渲染出来、开关确实生效、提问之后确实刷新。
   这些是纯逻辑测试覆盖不到的部分——按钮到底有没有绑上监听。 */
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
    // 属性选择器：input[type=checkbox]
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
  get checked() {
    if (this._checked !== undefined) return this._checked;
    return this.attrs.checked !== undefined;
  }
  set checked(v) { this._checked = !!v; }
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
global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
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
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'qa.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js'
].forEach(f => { require(path.join(base, f)); });

const MH = global.MH;
// 视图依赖的少量外壳能力（app.js 不加载，用最小替身）
MH.app = {
  confirm: () => Promise.resolve(true),
  showCrisis() {},
  refreshCurrent() {}
};
require(path.join(__dirname, '..', 'js', 'views', 'qa.js'));

let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}
// 本地引擎内部有 ~220ms 的模拟往返，等待要留够
const tick = () => new Promise(r => setTimeout(r, 400));

(async () => {
  // 造一份记录，让内置健康来源有内容
  const today = MH.util.todayISO();
  for (let i = 0; i < 10; i++) {
    MH.store.records.add({
      date: MH.util.addDays(today, -i),
      mood: 3 + (i % 2), sleep: 6 + (i % 3) * 0.5, heartRate: 62 + (i % 5), stress: 4 + (i % 4)
    });
  }

  const root = new El('div');
  root.setAttribute('id', 'view-qa');
  ROOTS.add(root);
  MH.views.qa.render(root);

  /* ---------- 1) .me 面板确实渲染出来 ---------- */
  const meHost = doc.getElementById('qaMeHost');
  ok(!!meHost && meHost.children.length > 0, '问答页渲染出「我的 · .me」面板');
  const traits = meHost ? meHost.querySelectorAll('.me-trait') : [];
  ok(traits.length === 5, '人格条渲染出 5 个维度');
  ok(traits.length === 5 && traits.every(t => t.querySelectorAll('.me-bar__fill').length === 1),
    '每个维度都有一条分数条');
  ok(doc.getElementById('qaUseMemory') && doc.getElementById('qaUsePersona'),
    '提问区出现「参考历史对话」与「带上我的人格画像」开关');
  ok(doc.getElementById('qaMeExport') && doc.getElementById('qaMeImport'), '导出 / 导入按钮存在');
  ok(doc.getElementById('qaMeResetPersona') && doc.getElementById('qaMeClearMem'), '重置人格 / 清空记忆按钮存在');

  /* ---------- 2) 开关写入偏好 ---------- */
  const cbMem = doc.getElementById('qaUseMemory');
  cbMem.checked = false;
  cbMem.dispatch('change');
  ok(MH.me.settings().useMemory === false, '取消勾选后记忆开关关闭');
  cbMem.checked = true;
  cbMem.dispatch('change');
  ok(MH.me.settings().useMemory === true, '重新勾选后记忆开关打开');
  const selTurns = doc.getElementById('qaMemTurns');
  selTurns.value = '5';
  selTurns.dispatch('change');
  ok(MH.me.settings().memoryTurns === 5, '召回轮数下拉联动到设置');

  /* ---------- 3) 提问 → 记忆写入 → 面板刷新 ---------- */
  ok(MH.me.memory.count() === 0, '初始没有任何记忆');
  doc.getElementById('qaQuestion').value = '最近睡眠趋势怎么样';
  doc.getElementById('qaAsk').dispatch('click');
  await tick(); await tick(); await tick();

  ok(MH.me.memory.count() === 1, '提问后写入 1 轮记忆');
  const meHost2 = doc.getElementById('qaMeHost');
  ok(meHost2.querySelectorAll('.me-trait').length === 5, '回答后面板重绘，人格条仍在');
  ok(meHost2.textContent.indexOf('已记住 1 轮问答') >= 0, '面板显示记忆条数已更新');

  /* ---------- 4) 第二次提问会带上历史记忆 ---------- */
  doc.getElementById('qaQuestion').value = '睡眠这两周是不是一直在下降';
  doc.getElementById('qaAsk').dispatch('click');
  await tick(); await tick(); await tick();
  ok(MH.me.memory.count() === 2, '第二轮问答继续累计记忆');
  const resultText = doc.getElementById('qaResultHost').textContent;

  ok(resultText.indexOf('参考了 1 轮历史对话') >= 0, '回答卡片标注参考了历史对话');
  ok(resultText.indexOf('带上了人格画像') >= 0, '回答卡片标注带上了人格画像');

  /* ---------- 5) 导出 / 清空 ---------- */
  let exported = 0;
  const realCreate = global.URL.createObjectURL;
  global.URL.createObjectURL = () => { exported++; return 'blob:test'; };
  doc.getElementById('qaMeExport').dispatch('click');
  ok(exported === 1, '点击导出会生成一次下载');
  global.URL.createObjectURL = realCreate;

  doc.getElementById('qaMeClearMem').dispatch('click');
  await tick();
  ok(MH.me.memory.count() === 0, '清空记忆后记忆归零');
  ok(doc.getElementById('qaMeHost').textContent.indexOf('还没有记忆') >= 0, '清空后面板回到空态文案');

  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('ALL PASS');
})();
