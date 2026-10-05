/**
 * 小程序内核冒烟测试（不需要微信开发者工具）：
 *   node tools/check-miniprogram-kernel.cjs
 *
 * 用一个极简 wx 桩替代微信运行时，验证「Web 端内核 → 小程序」这条复用链路：
 *   1. utils/core/*.js 能在 CommonJS + wx 垫片下全部加载
 *   2. 记录读写落在 wx.storage（即真实小程序里的 wx.getStorageSync）
 *   3. 统计聚合 / 指标校验与 Web 端同源
 *   4. 本地陪伴引擎、BM25 检索、表格解析可用
 *   5. 加密内核与云同步快照能往返
 */
'use strict';

/* ---------------- wx 桩 ---------------- */
const storage = {};
global.wx = {
  getStorageSync(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : ''; },
  setStorageSync(k, v) { storage[k] = v; },
  removeStorageSync(k) { delete storage[k]; },
  getStorageInfoSync() { return { keys: Object.keys(storage) }; },
  showToast() {},
  getRandomValues(opt) {
    const out = new Uint8Array(opt.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
    return { randomValues: out };
  }
};

const MH = require('../miniprogram/utils/mh.js');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✔ ' + label); }
  else { fail++; console.error('  ✘ ' + label); }
}

console.log('[1] 内核模块全部加载');
['util', 'crypto', 'metrics', 'stats', 'ingest', 'retriever', 'localService',
  'qa', 'store', 'cipher', 'models', 'modelRegistry', 'importFormats'].forEach((k) => {
  ok(!!MH[k], 'MH.' + k);
});

console.log('[2] 记录读写 -> wx.storage');
MH.store.records.add({ date: '2026-10-01', mood: 4, sleep: 7.5, heartRate: 62, stress: 3, note: '测试' });
MH.store.records.add({ date: '2026-10-02', mood: 3, sleep: 6.5, heartRate: 68, stress: 5, note: '' });
MH.store.records.add({ date: '2026-10-03', mood: 5, sleep: 8, heartRate: 58, stress: 2, note: '' });
ok(MH.store.records.count() === 3, '写入 3 条记录');
ok(Object.keys(storage).some((k) => k.indexOf('moodhub.v1.records') === 0), '落在 moodhub.v1.records 键');

console.log('[3] 统计聚合与 Web 端同源');
const ov = MH.stats.overview(MH.store.records.all(), 7);
ok(ov.metrics.mood.count === 3, '心情有值天数 3');
ok(Math.abs(ov.metrics.mood.mean - 4) < 0.01, '心情均值 = 4');
ok(ov.metrics.heartRate.mean != null, '心率均值可用');
const s14 = MH.stats.summary14(MH.store.records.all());
ok(s14.schema === 'moodhub.summary/v1', '14 天摘要 schema 正确');
ok(s14.privacy.rawRecords === false, '摘要不含原始记录');

console.log('[4] 指标校验');
const bad = MH.metrics.validate({ date: '2099-01-01', mood: 9 });
ok(bad.ok === false && bad.errors.date === '不能记录未来的日期', '未来日期被拦下');
ok(!!bad.errors.mood, '超量程心情被拦下');
const good = MH.metrics.validate({ date: '2026-10-04', mood: 4, sleep: 7, heartRate: 66, stress: 4, note: '' });
ok(good.ok, '合法记录通过校验');

console.log('[5] 本地陪伴引擎（无网络出口）');
ok(MH.localService.isCrisis('我快撑不住了，不想活了') === true, '危机词命中');
MH.localService.generateReply({ message: '最近我睡得不太好', summary: s14 }).then((reply) => {
  ok(typeof reply.text === 'string' && reply.text.length > 0, '生成陪伴回复');
  return MH.localService.generateReply({ message: '我不想活了', summary: s14 });
}).then((crisis) => {
  ok(crisis.crisis === true && Array.isArray(crisis.resources) && crisis.resources.length > 0, '危机词走求助资源卡');

  console.log('[6] 表格解析 + 数值分析');
  const parsed = MH.ingest.parse('a.csv', 'date,mood\n2026-10-01,4\n2026-10-02,3\n');
  ok(Array.isArray(parsed.rows) && parsed.rows.length === 2, 'CSV 解析 2 行');
  const a = MH.qa.analyze(parsed, '平均心情是多少');
  ok(a && typeof a.mean === 'number' && a.n === 2, '数值分析（均值 / 样本数）');

  console.log('[7] 云同步快照往返（加密内核）');
  const snapshot = MH.store.exportAll();
  const env = MH.cipher.encrypt(snapshot, 'test-password-123', { mode: 'local' });
  const back = MH.cipher.decrypt(env, 'test-password-123');
  ok(back.records.length === snapshot.records.length, '加密/解密往返一致');
  let rejected = false;
  try { MH.cipher.decrypt(env, 'wrong-password'); } catch (e) { rejected = true; }
  ok(rejected, '错误口令无法解密');

  console.log('');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
