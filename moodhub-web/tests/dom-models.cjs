/* 模型管理页的 DOM 级回归测试：node tests/dom-models.cjs
   用一个极简 DOM 桩加载真实的 views/models.js，模拟「新增 / 编辑 / 删除 / 启停」点击。
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
  dispatch(t) { (this.listeners[t] || []).slice().forEach(f => f.call(this, {})); }
  /** 支持 '#id' / '.cls' / 'tag' / 'tag.cls' / '.a.b' 这几类选择器。 */
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
    // 真实 DOM 里 textContent 会向下聚合子孙节点，桩也要如此，否则断言会失真
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
    const hit = ALL.filter(attached).find(el => el.matches(sel));
    return hit || null;
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
// 模拟「原生模态对话框被浏览器/WebView 屏蔽」的环境：
// 被调用就记一笔并返回 false —— 应用若还依赖它，按钮就会静默失效。
let windowConfirmCalls = 0;
global.confirm = () => { windowConfirmCalls++; return false; };
global.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });

const base = path.join(__dirname, '..', 'js', 'core');
[
  'util.js', 'crypto.js', 'store.js', 'metrics.js', 'stats.js',
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'qa.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js'
].forEach(f => require(path.join(base, f)));
require(path.join(__dirname, '..', 'js', 'views', 'models.js'));

const MH = global.MH;
let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}

/* ---------------- 搭页面 ---------------- */
const root = new El('section');
const connCard = new El('div'); connCard.setAttribute('id', 'modConnCard');
const logCard = new El('div'); logCard.setAttribute('id', 'modLogCard');
const clearBtn = new El('button'); clearBtn.setAttribute('id', 'modClearLogs');
const toastHost = new El('div'); toastHost.setAttribute('id', 'toasts');
const modalModel = new El('div'); modalModel.setAttribute('id', 'modalModel');
const mdTitle = new El('h2'); mdTitle.setAttribute('id', 'modelDetailTitle');
const mdBody = new El('div'); mdBody.setAttribute('id', 'modelDetailBody');
const mdClose = new El('button'); mdClose.setAttribute('data-model-close', '1');
[root, connCard, logCard, clearBtn, toastHost, modalModel, mdTitle, mdBody, mdClose].forEach(e => ROOTS.add(e));
[root, connCard, logCard, clearBtn, toastHost, modalModel, mdTitle, mdBody, mdClose].forEach(e => { if (e.attrs.id) REG[e.attrs.id] = e; });
modalModel.appendChild(mdTitle); modalModel.appendChild(mdBody); modalModel.appendChild(mdClose);

// 应用内确认弹窗的替身：confirmAnswer 控制用户点的是「确认」还是「取消」
let confirmAnswer = true;
const asked = [];
MH.app = {
  refreshCurrent: () => MH.views.models.render(root),
  requireReauth: () => Promise.resolve(true),
  confirm: opts => { asked.push(opts || {}); return Promise.resolve(confirmAnswer); },
  showCrisis() {}
};

function byId(id) { return doc.getElementById(id); }
function fill(id, v) { const n = byId(id); if (n) n.value = v; }
function click(id) { const n = byId(id); if (n) n.dispatch('click'); }
function rowButton(text) {
  const card = doc.getElementById('modConnCard');
  if (!card) return [];
  return card.querySelectorAll('button').filter(b => (b.textContent || '') === text);
}
/** 切到某个分区（点分段导航）。 */
function tab(name) {
  const btn = byId('modTab-' + name);
  if (btn) btn.dispatch('click');
  return !!btn;
}
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

(async () => {
  MH.views.models.render(root);

  // A. 首次进入（无任何连接）就能新增 —— 这是本次修复的核心回归点
  ok(MH.store.models.connections().length === 0, '初始没有任何连接');
  ok(tab('connections'), '分区导航可切换到「连接管理」');
  ok(!!byId('modSave'), '新增连接按钮已渲染');
  fill('modName', '我的 DeepSeek');
  fill('modBaseUrl', 'https://api.deepseek.com');
  fill('modModel', 'deepseek-flash');
  fill('modKey', 'sk-unit-test');
  byId('modSave').dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.store.models.connections().length === 1, 'A. 无连接状态下点「新增连接」生效');
  const added = MH.store.models.connections()[0] || {};
  ok(added.name === '我的 DeepSeek', 'A. 新增的连接字段正确');
  ok(added.model === 'deepseek-flash' && MH.store.models.hasKey(added.id), 'A. 模型名与密钥写入正确');

  // B. 编辑
  MH.views.models.render(root);
  const editBtns = rowButton('编辑');
  ok(editBtns.length === 1, 'B. 列表里出现编辑按钮');
  editBtns[0].dispatch('click');
  MH.views.models.render(root);
  fill('modName', '改过的名字');
  fill('modModel', 'deepseek-v4-pro');
  byId('modSave').dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  const afterEdit = MH.store.models.connections()[0] || {};
  ok(afterEdit.name === '改过的名字', 'B. 编辑保存后名称更新');
  ok(afterEdit.model === 'deepseek-v4-pro', 'B. 编辑保存后模型名更新');
  ok(MH.store.models.hasKey(afterEdit.id), 'B. 编辑未清空原有密钥');

  // C. 启停
  MH.views.models.render(root);
  const offBtn = rowButton('停用')[0];
  ok(!!offBtn, 'C. 停用按钮存在');
  offBtn.dispatch('click');
  ok(MH.store.models.connections()[0].enabled === false, 'C. 停用生效');
  MH.views.models.render(root);
  rowButton('启用')[0].dispatch('click');
  ok(MH.store.models.connections()[0].enabled === true, 'C. 重新启用生效');

  // D. 测试连接
  MH.views.models.render(root);
  const testBtn = rowButton('测试')[0];
  ok(!!testBtn, 'D. 测试按钮存在');
  testBtn.dispatch('click');
  await new Promise(r => setTimeout(r, 60));
  ok(testBtn.textContent === '测试', 'D. 测试完成后按钮状态复位');

  // E. 删除
  MH.views.models.render(root);
  const delBtn = rowButton('删除')[0];
  ok(!!delBtn, 'E. 删除按钮存在');
  delBtn.dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.store.models.connections().length === 0, 'E. 删除生效');

  // F. 删除后仍能再次新增（重绘后监听依旧有效）
  MH.views.models.render(root);
  fill('modName', '再来一个');
  fill('modBaseUrl', 'https://api.openai.com/v1');
  fill('modModel', 'gpt-4o-mini');
  fill('modKey', 'sk-2');
  byId('modSave').dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.store.models.connections().length === 1, 'F. 删除后重绘仍能新增');

  // G. 密钥从「保存到本机」改回「仅本次会话」时，落盘的密钥必须被清除
  MH.store.models.clearAll();
  MH.views.models.render(root);
  fill('modName', '持久化连接');
  fill('modBaseUrl', 'https://x/v1');
  fill('modModel', 'm');
  fill('modKey', 'sk-persist-123');
  byId('modPersistKey').checked = true;
  byId('modSave').dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  const rawPersisted = global.localStorage.getItem('moodhub.v1.models') || '';
  ok(rawPersisted.indexOf('sk-persist-123') >= 0, 'G. 勾选保存后密钥落盘');

  MH.views.models.render(root);
  rowButton('编辑')[0].dispatch('click');
  MH.views.models.render(root);
  byId('modPersistKey').checked = false;
  byId('modSave').dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  const rawAfter = global.localStorage.getItem('moodhub.v1.models') || '';
  ok(rawAfter.indexOf('sk-persist-123') < 0, 'G. 改回「仅本次会话」后落盘密钥被清除');

  // H. 开启外发授权（模拟原生 confirm 被屏蔽的环境）
  MH.models.privacy.setAllowExternal(false);
  MH.views.models.render(root);
  const tgl = byId('modToggleExternal');
  ok(!!tgl, 'H. 外发授权按钮已渲染');
  confirmAnswer = true;
  asked.length = 0;
  if (tgl) tgl.dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.models.privacy.allowExternal() === true, 'H. 点击「开启外发授权」后状态变为已授权');
  ok(asked.length === 1, 'H. 走的是应用内确认弹窗');
  ok(windowConfirmCalls === 0, 'H. 全程未调用 window.confirm（原生弹窗被屏蔽也不影响）');

  // H2. 用户在确认框点「取消」：状态必须保持原状，不能静默失败后变成"什么都没发生"
  MH.models.privacy.setAllowExternal(false);
  MH.views.models.render(root);
  const tgl2 = byId('modToggleExternal');
  confirmAnswer = false;
  if (tgl2) tgl2.dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.models.privacy.allowExternal() === false, 'H2. 取消确认后仍保持严格本地');

  // H3. 关闭方向无需二次确认，直接生效
  MH.models.privacy.setAllowExternal(true);
  MH.views.models.render(root);
  const tgl3 = byId('modToggleExternal');
  if (tgl3) tgl3.dispatch('click');
  await new Promise(r => setTimeout(r, 30));
  ok(MH.models.privacy.allowExternal() === false, 'H3. 点「改为严格本地」立即生效');

  // I. 场景模型切换
  MH.views.models.render(root);
  ok(tab('scenarios'), '可切换到「场景配置」分区');
  const scenSel = byId('modSel-companion');
  ok(!!scenSel, 'I. 陪伴场景模型下拉已渲染');
  const cloudOpt = scenSel && scenSel.children.find(o => String(o.attrs.value || '').indexOf('cloud:') === 0);
  ok(!!cloudOpt, 'I. 下拉里能选到云端连接');
  if (cloudOpt) {
    scenSel.value = cloudOpt.attrs.value;
    scenSel.dispatch('change');
    await new Promise(r => setTimeout(r, 30));
    ok(MH.models.activeFor('companion') === cloudOpt.attrs.value, 'I. 切换后场景模型已更新');
  }

  // J. 采用推荐
  MH.views.models.render(root);
  const adoptBtn = root.querySelectorAll('button').filter(b => (b.textContent || '') === '用推荐')[0];
  ok(!!adoptBtn, 'J. 「用推荐」按钮存在');
  if (adoptBtn) {
    const beforeJ = MH.models.activeFor('qa');
    adoptBtn.dispatch('click');
    await new Promise(r => setTimeout(r, 30));
    ok(typeof MH.models.activeFor('qa') === 'string', 'J. 采用推荐后场景模型仍是合法值（' + beforeJ + ' → ' + MH.models.activeFor('qa') + '）');
  }

  // K. 清空日志
  MH.views.models.render(root);
  const clearBtn2 = byId('modClearLogs');
  ok(!!clearBtn2, 'K. 清空日志按钮已渲染');
  if (clearBtn2) {
    clearBtn2.dispatch('click');
    await new Promise(r => setTimeout(r, 30));
    ok(MH.models.logs().length === 0, 'K. 清空日志生效');
  }

  // L. 模型库：发现与筛选
  ok(tab('library'), 'L. 可切换到「模型库」');
  const panel = () => doc.getElementById('modPanel');
  const cardCount = () => panel().querySelectorAll('.model-card').length;
  const expect0 = 2 + MH.store.models.connections().length;
  ok(cardCount() === expect0, 'L. 模型库条目 = 本地引擎 + 全部连接（' + cardCount() + '/' + expect0 + '）');
  ok(panel().querySelectorAll('.model-card').some(c => (c.textContent || '').indexOf('本地规则引擎') >= 0),
    'L. 模型库含「本地规则引擎」');

  MH.store.models.addConnection({
    name: '云端 A', provider: 'openai', kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-a', persistKey: false
  });
  MH.views.models.render(root);
  ok(cardCount() === expect0 + 1, 'L. 新增连接后模型库出现云端模型');
  const total = expect0 + 1;

  // 筛选：只看本地
  const privSel = byId('modFilterPrivacy');
  privSel.value = 'local';
  privSel.dispatch('change');
  await tick();
  ok(doc.getElementById('modPanel').querySelectorAll('.model-card').length === 2, 'L. 类型筛选「本地」只留本地引擎');

  // 搜索
  privSel.value = 'all'; privSel.dispatch('change'); await tick();
  fill('modSearch', '云端 A');
  byId('modSearch').dispatch('input');
  await tick(280);
  ok(doc.getElementById('modPanel').querySelectorAll('.model-card').length === 1, 'L. 搜索按名称命中');

  fill('modSearch', 'gpt-4o');
  byId('modSearch').dispatch('input');
  await tick(280);
  ok(doc.getElementById('modPanel').querySelectorAll('.model-card').length === 1, 'L. 搜索也能命中模型名');

  fill('modSearch', 'zzz-not-exist');
  byId('modSearch').dispatch('input');
  await tick(280);
  ok(!!doc.getElementById('modPanel').querySelector('.empty'), 'L. 无结果时显示空态');

  // 视图切换
  fill('modSearch', ''); byId('modSearch').dispatch('input'); await tick(280);
  byId('modViewToggle').dispatch('click');
  await tick();
  ok(doc.getElementById('modPanel').querySelectorAll('table.data').length === 1, 'L. 可切换到表格视图');
  ok(doc.getElementById('modPanel').querySelectorAll('.model-card').length === 0, 'L. 表格视图下不再渲染卡片');
  byId('modViewToggle').dispatch('click');
  await tick();
  ok(cardCount() === total, 'L. 可切回卡片视图');

  // M. 模型详情
  const firstCard = doc.getElementById('modPanel').querySelectorAll('.model-card')[0];
  firstCard.dispatch('click');
  await tick();
  ok(byId('modalModel').hidden === false, 'M. 点卡片打开详情面板');
  const detailText = byId('modelDetailBody').textContent || '';
  ok(detailText.length > 0, 'M. 详情面板有内容');
  ok(byId('modelDetailTitle').textContent.length > 0, 'M. 详情面板有标题');
  MH.views.models.closeDetail();
  await tick();
  ok(byId('modalModel').hidden === true, 'M. 详情面板可关闭');

  // M2. 云端模型详情里的外发预览必须掩码密钥
  const cloudCard = doc.getElementById('modPanel').querySelectorAll('.model-card')
    .filter(c => (c.textContent || '').indexOf('云端 A') >= 0)[0];
  ok(!!cloudCard, 'M2. 模型库里能找到云端模型');
  if (cloudCard) {
    cloudCard.dispatch('click');
    await tick();
    const html = JSON.stringify(byId('modelDetailBody').children.map(c => c.textContent));
    ok(html.indexOf('sk-a') < 0, 'M2. 详情外发预览不含明文密钥');
    MH.views.models.closeDetail();
    await tick();
  }

  // N. 调用日志：筛选与实测统计
  ok(tab('logs'), 'N. 可切换到「调用日志」');
  ok(!!byId('modLogScenario') && !!byId('modLogResult'), 'N. 日志筛选控件已渲染');
  const statRow = doc.getElementById('modPanel').querySelectorAll('.stat');
  ok(statRow.length === 5, 'N. 日志页有 5 项实测统计');

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
