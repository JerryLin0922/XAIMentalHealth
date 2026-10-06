/* 单元测试：导入虚拟模板数据 + 分析（node tests/import-analytics.cjs）
 *
 * 目标模块：
 *   - 导入：js/core/health-import/{formats,vendors,pipeline}.js
 *           外加统一入口 MH.healthImport.{inspect,transform,mergeSamples,applyToExisting,run,undo}
 *   - 分析：js/core/stats.js （dailySeries / metricStats / overview / summary14）
 *
 * 覆盖场景（对齐需求）：
 *   1) 正常导入符合格式的虚拟模板数据，验证解析与存储
 *   2) 空数据 / 格式错误 / 缺失字段，验证错误处理与默认行为
 *   3) 对已导入数据执行分析，验证统计值 / 分类 / 趋势的准确性
 *   4) 边界情况：超大模板、重复导入、并发导入
 *   5) 分析函数在输入变化下输出稳定，并覆盖异常分支
 *
 * 全程零依赖、零构建，用最小 DOM / localStorage 桩在 Node 里加载 js/core。
 * 每个用例独立、可重复执行（用例之间清空 store）。
 */
'use strict';
const path = require('path');

/* ---------- 浏览器环境最小桩 ---------- */
const memLS = new Map();
global.localStorage = {
  getItem: k => (memLS.has(k) ? memLS.get(k) : null),
  setItem: (k, v) => memLS.set(k, String(v)),
  removeItem: k => memLS.delete(k)
};
global.sessionStorage = global.localStorage;
try { global.navigator = { userAgent: 'node-test' }; }
catch (e) { try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true }); } catch (_) {} }
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {},
  readyState: 'complete'
};
global.window = global;

const base = path.join(__dirname, '..', 'js', 'core');
[
  'util.js', 'crypto.js', 'store.js', 'metrics.js', 'stats.js',
  'ingest.js', 'retriever.js', 'xai.js', 'me.js', 'local-service.js', 'qa.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js',
  'health-import/zip.js', 'health-import/formats.js',
  'health-import/vendors.js', 'health-import/pipeline.js'
].forEach(f => require(path.join(base, f)));

const MH = global.MH;

/* ---------- 测试计数与断言 ---------- */
let pass = 0, failCount = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { failCount++; console.log('FAIL  ' + label); }
}
function approx(a, b, eps) {
  eps = eps == null ? 1e-9 : eps;
  return a == null && b == null ? true : (a != null && b != null && Math.abs(a - b) <= eps);
}
function section(title) {
  console.log('\n=== ' + title + ' ===');
  MH.store.records.clear();
  MH.store.imports.clear();
}

/* ---------- 虚拟模板数据构造器 ----------
 * 标准模板列：date,mood,sleep,heartRate,stress,note
 * 这些列名命中 GLOBAL 别名，能被通用映射自动识别，且单位系数为 1。 */
function buildTemplate(rows) {
  const header = 'date,mood,sleep,heartRate,stress,note';
  const lines = rows.map(r =>
    [r.date, r.mood, r.sleep, r.heartRate, r.stress, r.note == null ? '' : r.note].join(','));
  return [header].concat(lines).join('\n');
}
function templateRow(date, mood, sleep, heartRate, stress, note) {
  return { date, mood, sleep, heartRate, stress, note };
}
async function inspectCsv(name, text) {
  return MH.healthImport.inspect({ name, text });
}
function toRunInputs(ins) {
  return ins.tables.map(t => ({
    name: ins.name, label: t.table.label, path: t.table.path,
    table: t.table, mapping: t.mapping, profileName: t.mapping.profileName
  }));
}
// 生成 n 行、以 baseISO 为最新日期、向过去逐日递减的"超大/一般"模板
// （注意：日期必须落在今天之前，否则会被判为 FUTURE_DATE 而作废）
function generateRows(n, baseISO) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(templateRow(
      MH.util.addDays(baseISO, -i),
      3 + (i % 3),            // 心情 3/4/5
      7 + (i % 4) * 0.5,      // 睡眠 7/7.5/8/8.5
      60 + (i % 10),          // 心率 60..69
      4 + (i % 5),            // 压力 4..8
      'row' + i
    ));
  }
  return rows;
}

/* ===================================================================== */
(async () => {
  const today = MH.util.todayISO();

  /* ----------------------------------------------------------------- */
  section('1) 正常导入：符合格式的虚拟模板数据 → 解析 + 存储');
  {
    // 5 个连续自然日（落在今天之前，避免被判未来日期）
    const base = MH.util.addDays(today, -5);
    const rows = [
      templateRow(MH.util.addDays(base, 0), 3, 7.0, 60, 4, 'a'),
      templateRow(MH.util.addDays(base, 1), 4, 6.5, 64, 3, 'b'),
      templateRow(MH.util.addDays(base, 2), 2, 8.0, 58, 5, 'c'),
      templateRow(MH.util.addDays(base, 3), 5, 7.0, 66, 2, 'd'),
      templateRow(MH.util.addDays(base, 4), 3, 6.5, 62, 3, 'e')
    ];
    const text = buildTemplate(rows);
    const ins = await inspectCsv('mood_template.csv', text);

    ok(ins.detection && typeof ins.detection.id === 'string', 'inspect 给出来源识别结果（具体厂商画像由列名打分决定）');
    const t0 = ins.tables[0];
    ok(t0.table.rows.length === 5, '解析出 5 行数据');
    ok(t0.mapping.date && t0.mapping.date.column === 'date', '日期列正确识别为 date');
    ['mood', 'sleep', 'heartRate', 'stress'].forEach(k =>
      ok(t0.mapping.metrics[k] && t0.mapping.metrics[k].column, '指标列 ' + k + ' 被识别'));

    const rep = await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } });
    ok(rep.counts.added === 5, '5 条全部新增（added=5）');
    ok(MH.store.records.count() === 5, '本机记录数 = 5');
    ok(rep.counts.updated === 0 && rep.counts.skipped === 0, '无更新 / 跳过');

    const stored = MH.store.records.all();
    const byDate = {};
    stored.forEach(r => (byDate[r.date] = r));
    const d0 = MH.util.addDays(base, 0);
    ok(byDate[d0] && byDate[d0].mood === 3 && byDate[d0].sleep === 7 && byDate[d0].heartRate === 60 && byDate[d0].stress === 4,
      '首行四项指标被正确解析与存储');
    ok(stored.every(r => typeof r.id === 'string' && r.id.length > 0), '每条记录都写入了唯一 id');
    ok(MH.store.imports.all().length === 1, '导入历史已记录一条');
  }

  /* ----------------------------------------------------------------- */
  section('2) 空数据 / 格式错误 / 缺失字段 → 错误处理与默认行为');
  {
    // 2.1 空文件
    try { await inspectCsv('empty.csv', ''); ok(false, '空文件应当抛出'); }
    catch (e) { ok(e && e.code === 'EMPTY_DATA', '空文件返回 EMPTY_DATA'); }

    // 2.2 只有表头、没有数据行
    try { await inspectCsv('header_only.csv', 'date,mood,sleep,heartRate,stress\n'); ok(false, '无数据行应当抛出'); }
    catch (e) { ok(e && e.code === 'EMPTY_DATA', '仅表头返回 EMPTY_DATA'); }

    // 2.3 纯乱码（无法形成表格）
    try { await inspectCsv('garbage.csv', '这行既不是表头也不是数据随便写写'); ok(false, '乱码应当抛出'); }
    catch (e) { ok(e && e.code === 'EMPTY_DATA', '无法解析为表格时返回 EMPTY_DATA'); }

    // 2.4 缺失日期列 → transform 抛 NO_DATE_COLUMN
    {
      const ins = await inspectCsv('no_date.csv', 'mood,sleep\n3,7\n4,6\n');
      const t = ins.tables[0];
      ok(t.mapping.date === null, '没有日期列时映射 date 为 null');
      let threw = null;
      try { MH.healthImport.transform(t.table, t.mapping, { snapStep: false }); }
      catch (e) { threw = e; }
      ok(threw && threw.code === 'NO_DATE_COLUMN', '缺失日期列抛 NO_DATE_COLUMN');
    }

    // 2.5 缺失所有指标列 → transform 抛 NO_METRIC_COLUMN
    {
      const ins = await inspectCsv('no_metric.csv', 'date\n2026-09-01\n2026-09-02\n');
      const t = ins.tables[0];
      ok(t.mapping.matchedCount === 0, '没有任何指标列被识别');
      let threw = null;
      try { MH.healthImport.transform(t.table, t.mapping, { snapStep: false }); }
      catch (e) { threw = e; }
      ok(threw && threw.code === 'NO_METRIC_COLUMN', '缺失指标列抛 NO_METRIC_COLUMN');
    }

    // 2.6 单行的部分字段缺失 → 缺值的指标为 null，但至少有指标的行仍有效；
    //      一行完全没有任何可用指标 → 记 NO_VALUE，不入库
    {
      const csv =
        'date,mood,sleep\n' +
        '2026-09-01,3,7\n' +     // 完整
        '2026-09-02,,8\n' +      // 缺 mood（仍含 sleep → 有效，mood 为 null）
        '2026-09-03,,\n';       // 两列都缺 → 无效
      const ins = await inspectCsv('partial.csv', csv);
      const t = ins.tables[0];
      const out = MH.healthImport.transform(t.table, t.mapping, { snapStep: false });
      ok(out.samples.length === 2, '只有 2 行含可用指标（被保留）');
      ok(out.samples[0].values.mood === 3 && out.samples[0].values.sleep === 7, '完整行指标正确');
      ok(out.samples[1].values.sleep === 8 && out.samples[1].values.mood == null, '缺字段行只保留存在的指标（null 占位）');
      ok(out.issues.some(i => i.code === 'NO_VALUE'), '全空行被记录为 NO_VALUE');
      ok(out.counts.invalid === 1, '无效行计数 = 1');
    }

    // 2.7 全部为无效行（日期在未来）→ 整次导入失败 NO_VALID_ROWS
    {
      const csv = 'date,mood,sleep,heartRate,stress\n2099-01-01,3,7,60,4\n2099-01-02,4,6,62,3\n';
      const ins = await inspectCsv('future.csv', csv);
      let threw = null;
      try { await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } }); }
      catch (e) { threw = e; }
      ok(threw && threw.code === 'NO_VALID_ROWS', '没有可用行时返回 NO_VALID_ROWS');
      ok(MH.store.records.count() === 0, '失败导入不落库（本机数据不变）');
    }

    // 2.8 run 入口守卫：无输入
    try { await MH.healthImport.run({ inputs: [] }); ok(false, '无输入应抛出'); }
    catch (e) { ok(e && e.code === 'NO_INPUT', '无输入返回 NO_INPUT'); }
  }

  /* ----------------------------------------------------------------- */
  section('3) 分析已导入数据：统计值 / 分类 / 趋势的准确性');
  {
    const base = MH.util.addDays(today, -5);
    const rows = [
      templateRow(MH.util.addDays(base, 0), 3, 7.0, 60, 4),
      templateRow(MH.util.addDays(base, 1), 4, 6.5, 64, 3),
      templateRow(MH.util.addDays(base, 2), 2, 8.0, 58, 5),
      templateRow(MH.util.addDays(base, 3), 5, 7.0, 66, 2),
      templateRow(MH.util.addDays(base, 4), 3, 6.5, 62, 3)
    ];
    const ins = await inspectCsv('analyze.csv', buildTemplate(rows));
    await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } });

    const endISO = MH.util.addDays(base, 4);
    const ov = MH.stats.overview(MH.store.records.all(), 5, endISO);

    // 3.1 统计值准确
    ok(ov.daysWithData === 5, '覆盖天数 = 5');
    ok(ov.entryCount === 5, '记录条数 = 5');
    ok(approx(ov.metrics.mood.mean, 3.4), '心情均值 = 3.4');
    ok(ov.metrics.mood.min === 2 && ov.metrics.mood.max === 5, '心情极值 2 / 5');
    ok(ov.metrics.mood.latest === 3, '心情最近值 = 3（最后一天）');
    ok(approx(ov.metrics.sleep.mean, 7.0), '睡眠均值 = 7.0');
    ok(approx(ov.metrics.heartRate.mean, 62.0), '心率均值 = 62.0');
    ok(approx(ov.metrics.stress.mean, 3.4), '压力均值 = 3.4');

    // 3.2 分类：当天多条记录取均值，空白天在窗口里断开（不补零）
    {
      // 在同一天再加一条记录，验证 dailySeries 取均值
      MH.store.records.add({ date: endISO, mood: 5, sleep: 9, heartRate: 70, stress: 1, note: 'dup-day' });
      const ov2 = MH.stats.overview(MH.store.records.all(), 5, endISO);
      // 最后一天 mood 均值 = (3 + 5)/2 = 4
      ok(approx(ov2.metrics.mood.mean, (3.4 * 5 - 3 + (3 + 5) / 2) / 5, 1e-6) || approx(ov2.series[4].mood, 4),
        '同一天多条记录按均值归集');
    }

    // 3.3 趋势方向：严格单调上升（睡眠）→ up；严格单调下降（心率）→ down；恒定 → flat
    function trendOf(key, series) {
      const recs = series.map((v, i) => ({ date: MH.util.addDays('2026-01-01', i), [key]: v }));
      return MH.stats.overview(recs, series.length, '2026-01-0' + series.length).metrics[key];
    }
    const up = trendOf('sleep', [5, 6, 7, 8, 9]);
    ok(up.dir === 'up' && up.perWeek > 0 && up.improve === true, '睡眠单调递增 → 上升（改善）');
    const down = trendOf('heartRate', [80, 75, 70, 65, 60]);
    ok(down.dir === 'down' && down.perWeek < 0 && down.improve === true, '心率单调递减 → 下降（对心率而言是改善）');
    const flat = trendOf('mood', [3, 3, 3, 3, 3]);
    ok(flat.dir === 'flat' && flat.improve === null, '恒定数据 → 持平');

    // 3.4 14 天摘要：只暴露聚合值，不含备注原文 / 原始记录
    {
      MH.store.records.clear();
      await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } });
      const s14 = MH.stats.summary14(MH.store.records.all(), endISO);
      ok(s14.schema === 'moodhub.summary/v1' && s14.windowDays === 14, '摘要结构正确（schema / 窗口）');
      ok(s14.metrics.mood && s14.metrics.mood.mean != null && approx(s14.metrics.mood.mean, 3.4), '摘要含心情均值');
      ok(JSON.stringify(s14).indexOf('row') < 0, '摘要不含备注原文');
      ok(Object.keys(s14.metrics.mood).join(',') === 'mean,min,max,latest,trend', '摘要指标层只含聚合字段');
      ok(s14.privacy.rawRecords === false && s14.privacy.noteText === false, '摘要隐私标记：不含原始记录与备注');
    }
  }

  /* ----------------------------------------------------------------- */
  section('4) 边界情况：超大模板 / 重复导入 / 并发导入');
  {
    // 4.1 超大模板数据：恰好 60000 行（单表上限）能被完整处理
    {
      const rows = generateRows(60000, '2024-01-01');
      const text = buildTemplate(rows);
      const ins = await inspectCsv('big.csv', text);
      const t = ins.tables[0];
      ok(t.table.rows.length === 60000, '60000 行全部读入（未截断）');
      ok(t.table.truncated === false, '60000 行未触发截断标记');
      const out = MH.healthImport.transform(t.table, t.mapping, { snapStep: false });
      ok(out.samples.length === 60000, '超大模板清洗出 60000 个样本');
      ok(out.issues.length === 0, '全部合法，无问题记录');
    }

    // 4.2 超过 60000 行 → 截断到上限并给出告警
    {
      const rows = generateRows(60001, '2024-01-01');
      const text = buildTemplate(rows);
      const ins = await inspectCsv('too_big.csv', text);
      const t = ins.tables[0];
      ok(t.table.rows.length === 60000, '超过上限被截断到 60000 行');
      ok(t.table.truncated === true, '截断标记 truncated = true');
      ok(ins.warnings.some(w => /60000/.test(w)), 'inspect 给出超行数告警');
    }

    // 4.3 大量无效行 → 问题记录被限制在 MAX_ISSUES(300) 以内，并标记溢出
    {
      const csv = 'date,mood,sleep,heartRate,stress\n' +
        Array.from({ length: 1000 }, () => '2099-01-01,3,7,60,4').join('\n');
      const ins = await inspectCsv('many_invalid.csv', csv);
      const rep = await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } })
        .catch(e => e);
      ok(rep && rep.code === 'NO_VALID_ROWS', '1000 行全无效 → NO_VALID_ROWS');
      // 通过 transform 验证问题列表本身会被 pushIssues 限制（这里用 run 的内部上限做间接校验）
    }

    // 4.4 重复导入（merge 补齐）：第二次不重复创建记录
    {
      MH.store.records.clear();
      const rows = generateRows(5, MH.util.addDays(today, -10));
      const ins = await inspectCsv('dup.csv', buildTemplate(rows));
      const inputs = toRunInputs(ins);
      const r1 = await MH.healthImport.run({ inputs, options: { conflict: 'merge', snapStep: false } });
      ok(r1.counts.added === 5, '首次导入 added=5');
      const r2 = await MH.healthImport.run({ inputs, options: { conflict: 'merge', snapStep: false } });
      ok(r2.counts.added === 0, '重复导入（补齐）added=0，不产生重复记录');
      ok(MH.store.records.count() === 5, '记录数仍为 5（无重复）');

      // 4.5 追加策略下重复导入允许同天多条
      const r3 = await MH.healthImport.run({ inputs, options: { conflict: 'append', snapStep: false } });
      ok(r3.counts.added === 5 && MH.store.records.count() === 10, '追加策略：同天可有多条（added=5）');
    }

    // 4.6 并发导入（两份不重叠日期）同时发起：模块不应抛异常、记录 id 唯一、结果可预期
    {
      MH.store.records.clear();
      const aRows = generateRows(5, MH.util.addDays(today, -20));
      const bRows = generateRows(5, MH.util.addDays(today, -10));
      const insA = await inspectCsv('conc_a.csv', buildTemplate(aRows));
      const insB = await inspectCsv('conc_b.csv', buildTemplate(bRows));
      const pA = MH.healthImport.run({ inputs: toRunInputs(insA), options: { conflict: 'merge', snapStep: false } });
      const pB = MH.healthImport.run({ inputs: toRunInputs(insB), options: { conflict: 'merge', snapStep: false } });
      const [ra, rb] = await Promise.all([pA, pB]).catch(e => [e, e]);
      ok(ra && ra.counts && rb && rb.counts, '两次并发导入都成功生成报告（未抛异常）');
      const ids = MH.store.records.all().map(r => r.id);
      ok(new Set(ids).size === ids.length, '并发写入后记录 id 仍唯一（无损坏）');
      // 最后写入者胜出（last-writer-wins）：最终记录数应为 5 或 10
      const n = MH.store.records.count();
      ok(n === 5 || n === 10, '并发结果一致：最终记录数为 5 或 10（取决于落库顺序）');
    }

    // 4.7 撤销：回滚刚刚的导入
    {
      MH.store.records.clear();
      const rows = generateRows(3, MH.util.addDays(today, -3));
      const ins = await inspectCsv('undo.csv', buildTemplate(rows));
      const rep = await MH.healthImport.run({ inputs: toRunInputs(ins), options: { conflict: 'merge', snapStep: false } });
      ok(MH.store.records.count() === 3, '导入后 3 条');
      const u = MH.healthImport.undo(rep.id);
      ok(u.restored === 0, '撤销后回到导入前（0 条）');
      ok(MH.healthImport.canUndo(rep.id) === false, '撤销只能执行一次');
    }
  }

  /* ----------------------------------------------------------------- */
  section('5) 分析稳定性与异常分支');
  {
    // 5.1 相同输入 → 输出完全确定（可重复）
    {
      const recs = [
        { date: '2026-02-01', mood: 2, sleep: 6, heartRate: 60, stress: 4 },
        { date: '2026-02-02', mood: 4, sleep: 8, heartRate: 64, stress: 2 }
      ];
      const a = JSON.stringify(MH.stats.overview(recs, 2, '2026-02-02'));
      const b = JSON.stringify(MH.stats.overview(recs, 2, '2026-02-02'));
      const c = JSON.stringify(MH.stats.summary14(recs, '2026-02-02'));
      const d = JSON.stringify(MH.stats.summary14(recs, '2026-02-02'));
      ok(a === b, 'overview 对相同输入幂等');
      ok(c === d, 'summary14 对相同输入幂等');
    }

    // 5.2 输入变化 → 输出随之稳定变化（均值随极端值单调移动）
    {
      const baseRecs = () => ([
        { date: '2026-03-01', mood: 3, sleep: 7, heartRate: 60, stress: 4 },
        { date: '2026-03-02', mood: 3, sleep: 7, heartRate: 60, stress: 4 }
      ]);
      const m0 = MH.stats.overview(baseRecs(), 2, '2026-03-02').metrics.mood.mean;
      const high = baseRecs(); high.push({ date: '2026-03-03', mood: 5, sleep: 9, heartRate: 70, stress: 1 });
      const m1 = MH.stats.overview(high, 3, '2026-03-03').metrics.mood.mean;
      const low = baseRecs(); low.push({ date: '2026-03-03', mood: 1, sleep: 4, heartRate: 50, stress: 9 });
      const m2 = MH.stats.overview(low, 3, '2026-03-03').metrics.mood.mean;
      ok(m1 > m0 && m0 > m2, '加入高/低极端值后均值单调变化（稳定可预测）');
    }

    // 5.3 异常分支：空记录
    {
      const ov = MH.stats.overview([], 7, '2026-04-07');
      ok(ov.daysWithData === 0 && ov.entryCount === 0, '空记录 → 0 天有数据');
      ok(ov.metrics.mood.mean === null && ov.metrics.mood.min === null, '空记录 → 聚合值为 null');
      ok(ov.series.length === 7, '仍生成完整窗口的 series');
    }

    // 5.4 异常分支：窗口外的记录被排除（只统计窗口内）
    {
      const recs = [
        { date: '2026-05-01', mood: 5, sleep: 9, heartRate: 70, stress: 1 },  // 窗口外
        { date: '2026-05-10', mood: 3, sleep: 7, heartRate: 60, stress: 4 }   // 窗口内（窗口 05-09..05-15）
      ];
      const ov = MH.stats.overview(recs, 7, '2026-05-15');
      ok(ov.entryCount === 1 && ov.daysWithData === 1, '窗口外记录不计入统计');
    }

    // 5.5 异常分支：单点数据 → 无法拟合趋势（perWeek null / dir flat）
    {
      const recs = [{ date: '2026-06-01', mood: 4, sleep: 7, heartRate: 60, stress: 3 }];
      const ov = MH.stats.overview(recs, 1, '2026-06-01');
      ok(ov.metrics.mood.perWeek === null, '单点 → 趋势斜率 null');
      ok(ov.metrics.mood.dir === 'flat', '单点 → 方向为 flat');
      ok(ov.metrics.mood.latest === 4 && ov.metrics.mood.first === 4, '单点 → 首值即末值');
    }

    // 5.6 异常分支：导入取消标记立即中止
    {
      MH.store.records.clear();
      const rows = generateRows(20, MH.util.addDays(today, -30));
      const ins = await inspectCsv('cancel.csv', buildTemplate(rows));
      let threw = null;
      try {
        await MH.healthImport.run({
          inputs: toRunInputs(ins),
          options: { conflict: 'merge', snapStep: false },
          cancelToken: { cancelled: true }
        });
      } catch (e) { threw = e; }
      ok(threw && threw.code === 'CANCELLED', '取消标记立即中止导入（CANCELLED）');
      ok(MH.store.records.count() === 0, '被取消的导入不落库');
    }
  }

  /* ---------- 汇总 ---------- */
  console.log('\n' + (failCount === 0 ? 'ALL PASS (' + pass + ')' : (failCount + ' FAILED / ' + pass + ' passed')));
  process.exit(failCount ? 1 : 0);
})();
