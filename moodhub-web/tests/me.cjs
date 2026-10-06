/* .me 回归测试：node tests/me.cjs
   验证五大人格（OCEAN）推断、问答记忆的写入 / 召回 / 上限，
   以及它们与智能问答的闭环集成。不涉及浏览器 UI，也不需要任何依赖。 */
const fs = require('fs');
const path = require('path');

const memLS = new Map();
global.localStorage = {
  getItem: k => (memLS.has(k) ? memLS.get(k) : null),
  setItem: (k, v) => memLS.set(k, String(v)),
  removeItem: k => memLS.delete(k)
};
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node-test' };
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
  'models/registry.js', 'models/adapters.js', 'models/manager.js'
].forEach(f => { require(path.join(base, f)); });

const MH = global.MH;
let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}

const ROOT = path.join(__dirname, '..');

(async () => {
  /* ---------- 1) 初始人格：中性、无置信度 ---------- */
  let p = MH.me.personality.get();
  const keys = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  ok(keys.every(k => p.traits[k]), '五大人格五个维度齐备');
  ok(keys.every(k => p.traits[k].score === 50), '初始人格全部为 50 分中性');
  ok(keys.every(k => p.traits[k].confidence === 0), '初始置信度为 0');

  /* ---------- 2) 关键词信号抽取 ---------- */
  const sigC = MH.me.personality.signals('帮我复盘一下这周的睡眠规律，最好给个计划');
  ok((sigC.conscientiousness || 0) > 0, '「复盘 / 规律 / 计划」命中尽责性');
  const sigN = MH.me.personality.signals('最近很焦虑，压力大到睡不着');
  ok((sigN.neuroticism || 0) > 0, '「焦虑 / 压力 / 睡不着」命中神经质');
  const sigE = MH.me.personality.signals('周末和朋友聚会聊天很开心');
  ok((sigE.extraversion || 0) > 0, '「朋友 / 聚会 / 聊天」命中外倾性');
  const sigA = MH.me.personality.signals('麻烦你帮我看看，谢谢');
  ok((sigA.agreeableness || 0) > 0, '「麻烦 / 谢谢」命中宜人性');
  const sigO = MH.me.personality.signals('为什么会这样？我想了解一下背后的原理');
  ok((sigO.openness || 0) > 0, '「为什么 / 背后 / 原理」命中开放性');
  ok(!MH.me.personality.signals('')['openness'], '空文本不产生任何信号');

  /* ---------- 3) 观测收敛与边界 ---------- */
  const before = MH.me.personality.get().traits.neuroticism.score;
  for (let i = 0; i < 5; i++) {
    MH.me.personality.observe('今天又焦虑得睡不着，压力好大，心里很不安');
  }
  const afterN = MH.me.personality.get().traits.neuroticism;
  ok(afterN.score > before, '反复表达压力后神经质分数上升（' + before + ' → ' + afterN.score + '）');
  ok(afterN.score <= 100 && afterN.score >= 0, '分数始终落在 0–100');
  ok(afterN.samples === 5, '样本数累计正确（5 次）');
  ok(afterN.confidence > 0 && afterN.confidence <= 1, '置信度随样本增长且不超过 1');
  const untouched = MH.me.personality.get().traits.openness;
  ok(untouched.samples === 0 && untouched.score === 50, '没有信号的维度不会被噪声拉动');

  /* ---------- 4) 记录形态也能提供信号 ---------- */
  const today = MH.util.todayISO();
  for (let i = 0; i < 12; i++) {
    MH.store.records.add({
      date: MH.util.addDays(today, -i),
      mood: 2, sleep: 5.5, heartRate: 78, stress: 8, note: 'n' + i
    });
  }
  const recSig = MH.me.personality.signalsFromRecords(MH.store.records.all());
  ok((recSig.neuroticism || 0) > 0, '高压低心情的记录形态指向神经质');
  ok((recSig.conscientiousness || 0) > 0, '连续 12 天有记录指向尽责性');

  /* ---------- 5) 记忆写入与上限 ---------- */
  for (let i = 0; i < 205; i++) {
    MH.me.memory.append({ question: '第 ' + i + ' 问', answer: '第 ' + i + ' 答', at: Date.now() - (205 - i) * 1000 });
  }
  ok(MH.me.memory.count() === MH.me.MAX_TURNS, '记忆条数被限制在上限 ' + MH.me.MAX_TURNS);
  ok(MH.me.memory.all()[0].question === '第 5 问', '超出上限时丢弃最旧的轮次');
  MH.me.memory.clear();
  ok(MH.me.memory.count() === 0, '清空记忆生效');

  /* ---------- 6) 记忆召回：相关 vs 无关 ---------- */
  MH.me.memory.append({ question: '这两周睡眠是不是变差了', answer: '睡眠均值 6.1 小时，比前两周低 0.8。', at: Date.now() - 86400000 });
  MH.me.memory.append({ question: '周末和朋友去爬山', answer: '那天心情 5 分，是两周里最高的一天。', at: Date.now() - 3600000 });
  const hits = MH.me.memory.search('睡眠最近的变化', 3);
  ok(hits.length >= 1 && hits[0].turn.question.indexOf('睡眠') >= 0, '相似问题召回了相关的历史轮次');
  ok(hits.every(h => h.sim > 0), '召回结果都有字面交集');
  const noneHits = MH.me.memory.search('公司报销流程怎么走', 3);
  ok(noneHits.length === 0, '完全不相关的问题不会召回历史');

  /* ---------- 7) 记忆上下文组装 ---------- */
  const mem = MH.me.memory.context('睡眠最近的变化', 3, 1200);
  ok(mem.text.indexOf('【历史对话记忆】') === 0, '记忆上下文以声明性标题开头');
  ok(mem.text.indexOf('睡眠均值') >= 0, '记忆上下文里带上当时的结论');
  ok(mem.charCount <= 1200, '记忆上下文不超过字符预算');
  const small = MH.me.memory.context('睡眠最近的变化', 3, 120);
  ok(small.charCount <= 120, '预算极小时按预算截断（' + small.charCount + '）');

  /* ---------- 8) 人格画像文本 ---------- */
  const persona = MH.me.personality.describeText();
  ok(keys.every(k => persona.indexOf(MH.me.TRAIT_MAP[k].label) >= 0), '人格画像文本包含五个维度名');
  ok(persona.indexOf('OCEAN') >= 0, '人格画像标注模型为 OCEAN');
  ok(persona.length <= MH.me.PERSONA_MAX_CHARS + 1, '人格画像不超过字符上限');
  ok(MH.me.personality.bars().length === 5, '人格条渲染数据为 5 条');

  /* ---------- 9) 与智能问答的闭环 ---------- */
  MH.me.memory.clear();
  MH.me.personality.reset();
  const records = MH.store.records.all();
  const r1 = await MH.qa.ask({
    question: '最近睡眠趋势怎么样',
    selection: { health: true, files: [] },
    records: records,
    sources: []
  });
  ok(!r1.crisis && r1.answer.length > 0, '第一次问答生成了回答');
  ok(MH.me.memory.count() === 1, '问答结束后自动写入 1 轮记忆');
  ok(r1.me && r1.me.recorded === true, '回写结果标记为已记录');
  ok(r1.me.usedPersona === true, '本次带上了人格画像');

  const r2 = await MH.qa.ask({
    question: '睡眠这两周是不是一直在下降',
    selection: { health: true, files: [] },
    records: records,
    sources: []
  });
  ok(r2.me.usedMemory >= 1, '第二次问答召回并使用了历史记忆');
  ok(r2.context.text.indexOf('历史对话记忆') >= 0, '上下文中出现「历史对话记忆」段');
  ok(r2.context.text.indexOf('用户人格画像') >= 0, '上下文中出现「用户人格画像」段');
  ok(r2.answer.indexOf('你之前问过相关的') >= 0, '本地引擎在回答里显式引用了历史问答');
  ok(MH.me.memory.count() === 2, '记忆累计到 2 轮');
  const afterAsk = MH.me.personality.get().traits.conscientiousness;
  ok(afterAsk.samples > 0, '问答持续更新人格样本数');

  /* ---------- 10) 开关：关掉后不再参与 ---------- */
  MH.me.setSettings({ useMemory: false, usePersona: false, memoryTurns: 3 });
  ok(MH.me.settings().useMemory === false, '记忆开关可以关闭');
  const r3 = await MH.qa.ask({
    question: '睡眠这两周是不是一直在下降',
    selection: { health: true, files: [] },
    records: records,
    sources: []
  });
  ok(r3.me.usedMemory === 0, '关闭后不再召回历史记忆');
  ok(r3.context.text.indexOf('历史对话记忆') < 0, '关闭后上下文里没有记忆段');
  ok(r3.context.text.indexOf('用户人格画像') < 0, '关闭后上下文里没有人格段');
  MH.me.setSettings({ useMemory: true, usePersona: true, memoryTurns: 3 });
  ok(MH.me.settings().useMemory === true, '记忆开关可以重新打开');

  /* ---------- 11) 危机轮次不写入记忆 ---------- */
  const beforeCrisis = MH.me.memory.count();
  const rec = MH.me.record({ question: '我不想活了', answer: '（应被拦截）' });
  ok(rec.recorded === false && rec.reason === 'CRISIS', '危机文本不写入记忆');
  ok(MH.me.memory.count() === beforeCrisis, '危机轮次前后记忆条数不变');
  const crisisAsk = await MH.qa.ask({
    question: '我不想活了',
    selection: { health: true, files: [] },
    records: records,
    sources: []
  });
  ok(crisisAsk.crisis === true, '问答入口对危机词直接走求助通道');
  ok(MH.me.memory.count() === beforeCrisis, '危机问答不产生记忆');

  /* ---------- 12) 导出 / 导入往返 ---------- */
  const dump = MH.me.exportMe();
  ok(dump.schema === 'moodhub.me/v1' && dump.model === 'OCEAN-5', '导出结构带 schema 与模型名');
  ok(dump.memory.turns.length === MH.me.memory.count(), '导出包含全部记忆轮次');
  const personaBefore = JSON.stringify(dump.personality.traits);
  MH.me.clearAll();
  ok(MH.me.memory.count() === 0 && MH.me.personality.get().traits.neuroticism.score === 50, '清空后回到初始状态');
  const back = MH.me.importMe(dump, 'replace');
  ok(back.memoryCount === dump.memory.turns.length, '导入后记忆条数还原');
  ok(JSON.stringify(MH.me.personality.get().traits) === personaBefore, '导入后人格分数还原');
  const again = MH.me.importMe(dump, 'merge');
  ok(again.memoryCount === dump.memory.turns.length, '重复导入按 id 去重，不会翻倍');
  let threw = false;
  try { MH.me.importMe({ foo: 1 }, 'merge'); } catch (e) { threw = true; }
  ok(threw, '非法 .me 文件被拒绝');

  /* ---------- 13) 备份导出包含 .me ---------- */
  const backup = MH.store.exportAll();
  ok(backup.me && backup.me.memory.length > 0, '整机备份带上 .me 记忆');
  ok(backup.me.personality && backup.me.personality.traits, '整机备份带上人格画像');
  memLS.clear();
  MH.store.importAll(backup, 'replace');
  ok(MH.store.me.memory.all().length === backup.me.memory.length, '备份恢复后记忆还原');

  /* ---------- 14) .me 目录与模板文件 ---------- */
  ok(fs.existsSync(path.join(ROOT, '.me')), '.me 私密目录存在');
  ok(fs.existsSync(path.join(ROOT, '.me', '.gitignore')), '.me 有 gitignore 保护隐私');
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, '.me', 'personality.template.json'), 'utf8'));
  ok(tpl.schema === 'moodhub.me.personality/v1', '人格模板 schema 正确');
  ok(Object.keys(tpl.traits).length === 5, '人格模板含五大人格');
  const profTpl = JSON.parse(fs.readFileSync(path.join(ROOT, '.me', 'profile.template.json'), 'utf8'));
  ok(profTpl.schema === 'moodhub.me.profile/v1', '画像模板 schema 正确');
  ok(fs.existsSync(path.join(ROOT, '.me', 'memory', 'index.template.json')), '记忆索引模板存在');
  ok(fs.existsSync(path.join(ROOT, 'tools', 'me-sync.cjs')), '.me 同步脚本存在');
  ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').indexOf('js/core/me.js') > 0, 'index.html 已加载 me.js');

  console.log('');
  if (fails) { console.log(fails + ' 项失败'); process.exit(1); }
  console.log('ALL PASS');
})();
