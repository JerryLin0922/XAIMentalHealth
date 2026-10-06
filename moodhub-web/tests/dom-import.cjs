/* 导入页的 DOM 级回归测试：node tests/dom-import.cjs
   用极简 DOM 桩加载真实的 views/import.js，走完「选文件 → 解析 → 改映射 → 导入 → 撤销」。
   这些是纯逻辑测试覆盖不到的部分——按钮到底有没有绑上监听、向导会不会停在半路。 */
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
    this.classList = { add() {}, remove() {}, contains() { return false; } };
    ALL.push(this);
  }
  appendChild(c) {
    if (c == null) return c;
    this.children.push(c);
    c.parentNode = this;
    if (c.attrs && c.attrs.id) REG[c.attrs.id] = c;
    return c;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'id') REG[v] = this;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatch(t, ev) { (this.listeners[t] || []).slice().forEach(f => f.call(this, ev || {})); }
  matches(sel) {
    let tag = '', id = '', classes = [];
    const re = /([.#]?)([\w-]+)/g;
    let m;
    while ((m = re.exec(String(sel).trim())) !== null) {
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
  createElementNS: (ns, t) => new El(t),
  createTextNode: t => { const e = new El('#text'); e.textContent = t; return e; },
  getElementById: id => REG[id] || null,
  querySelector(sel) {
    return ALL.filter(attached).find(el => el.matches(sel)) || null;
  },
  querySelectorAll(sel) {
    const out = [];
    ALL.filter(attached).forEach(el => el.querySelectorAll(sel, out));
    return out;
  },
  addEventListener() {},
  readyState: 'complete'
};

const memLS = new Map();
global.localStorage = {
  getItem: k => (memLS.has(k) ? memLS.get(k) : null),
  setItem: (k, v) => memLS.set(k, String(v)),
  removeItem: k => memLS.delete(k)
};
global.sessionStorage = global.localStorage;
global.document = doc;
global.navigator = { userAgent: 'node' };
global.window = global;

// FileReader 桩：真实环境里它是浏览器本地读取，这里同样只从内存里的假文件取字节
global.FileReader = class {
  readAsArrayBuffer(file) {
    setTimeout(() => {
      this.result = Buffer.from(file._text || '', 'utf8');
      if (this.onload) this.onload();
    }, 0);
  }
};

const base = path.join(__dirname, '..', 'js', 'core');
[
  'util.js', 'crypto.js', 'store.js', 'metrics.js', 'stats.js',
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'qa.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js',
  'health-import/zip.js', 'health-import/formats.js',
  'health-import/vendors.js', 'health-import/pipeline.js'
].forEach(f => require(path.join(base, f)));
require(path.join(__dirname, '..', 'js', 'views', 'import.js'));

const MH = global.MH;
let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}

/* ---------------- 外壳替身 ---------------- */
const root = new El('section');
root.setAttribute('id', 'view-import');
const toasts = new El('div');
toasts.setAttribute('id', 'toasts');
[root, toasts].forEach(e => ROOTS.add(e));

let wentTo = null;
MH.app = {
  go: r => { wentTo = r; },
  refreshCurrent: () => {},
  requireReauth: () => Promise.resolve(true),
  confirm: () => Promise.resolve(true),
  showCrisis() {}
};

/** 只认当前挂在页面上的节点：每次重绘都会换一批 DOM，旧的必须失效。 */
const byId = id => {
  const n = REG[id];
  return n && attached(n) ? n : null;
};
const click = id => { const n = byId(id); if (n) n.dispatch('click'); };
const setSelect = (id, v) => {
  const n = byId(id);
  if (!n) throw new Error('找不到控件：' + id);
  n.value = v;
  n.dispatch('change');
};
const allText = () => root.textContent;
const hints = () => root.querySelectorAll('.map-row__hint').map(n => n.textContent).join(' | ');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, limit) {
  for (let i = 0; i < (limit || 80); i++) {
    if (fn()) return true;
    await sleep(8);
  }
  return false;
}

const CSV = '统计日期,睡眠时长(分钟),静息心率,压力值,步数\n2026-09-01,420,62,35,8000\n2026-09-02,380,60,42,6500\n';

(async () => {
  MH.store.records.clear();
  MH.store.imports.clear();

  // 1) 首页渲染
  MH.views.import.render(root);
  const vendorCards = root.querySelectorAll('.vendor-card');
  ok(vendorCards.length >= 7, '首页渲染出厂商卡片（' + vendorCards.length + ' 个）');
  const notices = root.querySelectorAll('.notice').map(n => n.innerHTML).join(' ');
  ok(/隐私边界/.test(notices), '首页写明隐私边界');
  ok(!!byId('impParse') && byId('impParse').getAttribute('disabled') !== null, '没有文件时「解析」按钮不可用');

  // 2) 选文件（模拟 input.change）
  const fileInput = byId('impFile');
  fileInput.files = [{ name: 'huawei_health_export.csv', size: CSV.length, _text: CSV }];
  fileInput.dispatch('change');
  ok(/huawei_health_export/.test(allText()), '文件名出现在待导入列表');
  ok(byId('impParse').disabled === false, '选择文件后可以点解析');

  // 3) 解析 → 第二步
  click('impParse');
  ok(await waitFor(() => !!byId('impNext3')), '解析完成后进入第二步（字段映射）');
  ok(byId('imp-date').value === '统计日期', '日期列自动选中');
  ok(byId('imp-metric-sleep').value === '睡眠时长(分钟)', '睡眠列自动选中');
  ok(/分钟 → 小时/.test(hints()), '界面提示了分钟 → 小时的换算');
  ok(/辅助/.test(allText()), '辅助指标区可见');
  ok(/华为运动健康/.test(allText()), '识别结果卡片写明来源厂商');

  // 4) 手动改单位
  setSelect('imp-unit-sleep', 'h');
  await sleep(12);
  ok(/已是小时/.test(hints()), '手动指定单位后立即更新换算提示');
  setSelect('imp-unit-sleep', 'auto');
  await sleep(12);
  ok(/分钟 → 小时/.test(hints()), '改回自动后提示恢复');

  // 5) 第三步：清洗与去重
  click('impNext3');
  ok(!!byId('impConflict') && !!byId('impStart'), '进入第三步（清洗与去重）');
  ok(byId('impConflict').value === 'merge', '默认冲突策略是「补齐」');
  ok(byId('impSnap').checked === true, '默认勾选步长对齐');
  setSelect('impConflict', 'append');
  setSelect('impRange', 'clamp');
  ok(byId('impRange').value === 'clamp', '可以切换超量程处理策略');
  ok(/去重与时间对齐/.test(allText()), '第三步写明去重与时间对齐口径');

  // 6) 导入 → 进度 → 结果
  click('impStart');
  ok(await waitFor(() => !!byId('impUndo'), 250), '导入完成后进入结果页');
  ok(MH.store.records.count() === 2, '两条新记录写入本机仓库（实际 ' + MH.store.records.count() + ' 条）');
  const rec = MH.store.records.all()[0];
  ok(Math.abs(rec.sleep - 7) < 1e-6, '睡眠在界面流程里同样被换算成 7 小时');
  ok(rec.note.indexOf('步数 8000') >= 0, '辅助指标按选项写进备注');
  ok(/导入结果/.test(allText()), '结果页给出统计反馈');
  ok(MH.store.imports.all().length === 1, '导入历史写入一条记录');
  ok(/导入历史/.test(allText()), '结果页展示导入历史');

  // 7) 撤销
  click('impUndo');
  await sleep(30);
  ok(MH.store.records.count() === 0, '撤销后记录回到导入前');
  ok(!!byId('impParse'), '撤销后回到第一步，可以继续导入');

  // 8) 追加策略：同一天允许多条
  MH.store.records.clear();
  fileInput.files = [{ name: 'huawei.csv', size: CSV.length, _text: CSV }];
  fileInput.dispatch('change');
  click('impParse');
  await waitFor(() => !!byId('impNext3'));
  click('impNext3');
  setSelect('impConflict', 'append');
  click('impStart');
  await waitFor(() => !!byId('impUndo'), 250);
  ok(MH.store.records.count() === 2, '追加策略导入两条');
  click('impUndo');
  await sleep(20);
  ok(MH.store.records.count() === 0, '第二次撤销同样生效');

  // 9) 「去看看记录」跳走
  const gotoRecords = async () => {
    MH.store.records.clear();
    fileInput.files = [{ name: 'huawei.csv', size: CSV.length, _text: CSV }];
    fileInput.dispatch('change');
    click('impParse');
    await waitFor(() => !!byId('impNext3'));
    click('impNext3');
    click('impStart');
    await waitFor(() => !!byId('impView'), 250);
    click('impView');
    return wentTo === 'records';
  };
  ok(await gotoRecords(), '结果页「去看看记录」跳到记录页');
  ok(MH.store.records.count() === 2, '跳转前的数据已经写完');

  MH.store.records.clear();
  MH.store.imports.clear();
  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
