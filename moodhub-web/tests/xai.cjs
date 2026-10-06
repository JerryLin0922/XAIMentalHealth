/* 以人为中心的 XAI 层测试：node tests/xai.cjs
   验证四条约束是否真的落在实现上：
     1 准确性 —— 断言被降调、因果改写成伴随、病理判断不再被 AI 直接下
     2 可读性 —— 每条解释都有短 / 中 / 长三档，长度单调递增
     3 个人性 —— 抽象观点被挂到具体经历上
     4 主体性 —— 解释以「征求校正」收尾，用户否掉的解释不再复活

   只依赖 js/core/，无浏览器 API、无网络。 */
const path = require('path');
const fs = require('fs');

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
].forEach(f => {
  require(path.join(base, f));
});

const MH = global.MH;
let fails = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) fails++;
}

(async () => {
  /* ================= 1. 准确性 ================= */

  const a1 = MH.xai.audit('你就是这样的人，你一定很差劲。');
  ok(a1.hits.indexOf('identity') >= 0, '定性断言「你就是这样的人」被识别并改写');
  ok(a1.text.indexOf('你就是这样的人') < 0, '改写后的文本不再出现「你就是这样的人」');
  ok(a1.hits.indexOf('absolute') >= 0 && a1.text.indexOf('一定') < 0, '全称判断「你一定」被降调');

  const a2 = MH.xai.audit('睡眠不足导致你情绪低落，这说明你状态不好。');
  ok(a2.hits.indexOf('cause') >= 0, '因果表述被识别');
  ok(/一起出现|也出现了/.test(a2.text) && a2.text.indexOf('导致') < 0, '「导致」改写成伴随关系');

  const a3 = MH.xai.audit('你得了抑郁症。');
  ok(a3.hits.indexOf('diagnosis') >= 0 && /专业人员能判断/.test(a3.text), '病理断言改为「需专业人员判断」');

  ok(MH.xai.humanize(MH.xai.humanize('压力导致你失眠')) === MH.xai.humanize('压力导致你失眠'),
    '降调处理幂等：重复调用不再变化');

  ok(/仅仅是一份可能/.test(MH.xai.association('睡眠偏低', '压力偏高', { days: 6 })) === false,
    '关联性表述不带多余修饰');
  ok(MH.xai.association('睡眠偏低', '压力偏高', { days: 6 }).indexOf('伴随') >= 0,
    '关联性表述显式声明「不等于因果」');

  const thin = MH.xai.basis(2, 14);
  const solid = MH.xai.basis(13, 14);
  ok(thin.confidence === 'thin' && /线索/.test(thin.text), '样本稀薄时措辞退到「线索」');
  ok(solid.confidence === 'solid' && solid.text.indexOf('13 天有记录') >= 0, '样本充足时明确写出依据密度');
  ok(MH.xai.basis(0, 14).confidence === 'none', '零样本时明确没有任何读数依据');

  /* ================= 2. 可读性：三档 ================= */

  const spec = {
    short: '一句话结论。',
    medium: '结论，加上依据。',
    long: '结论，加上依据，加上推理边界与可能跑偏的地方。'
  };
  const ex = MH.xai.compose(spec, { level: 'medium' });
  ok(ex.schema === 'moodhub.xai/v1', '解释对象带 schema');
  ok(ex.short.length > 0 && ex.medium.length > 0 && ex.long.length > 0, '三档都不为空');
  ok(ex.short.length <= ex.medium.length && ex.medium.length <= ex.long.length, '三档长度单调递增（短 ≤ 中 ≤ 长）');
  ok(ex.text.indexOf(ex.medium) === 0, '默认档位跟随偏好（medium）');

  const partial = MH.xai.compose({ medium: '只有一档。' });
  ok(partial.short.length > 0 && partial.long.length > 0, '只给中档时自动补出短档与长档');

  const sections = MH.xai.parseSections('短：结论。\n\n中：结论与依据。\n\n长：结论、依据与边界。');
  ok(sections && sections.short.indexOf('结论') >= 0 && sections.long.indexOf('边界') >= 0,
    '云端输出的「短/中/长」标记能被拆成三档');
  ok(MH.xai.parseSections('今天中午我们去吃了面。') === null, '普通文本不会被误判成三档结构');

  const prose = MH.xai.explainProse('先别急着怪自己。\n\n睡眠曲线在这两周向下走了半格。\n\n再往后是依据与边界。');
  ok(prose && prose.short.length < prose.long.length, '无标记的自由文本也能补出三档');

  /* ================= 3. 个人性 ================= */

  const personal = MH.xai.personalize('低落不需要被赶走', '早上刷牙时对着镜子站了两分钟才想起来在做什么');
  ok(personal.indexOf('具体到') >= 0 || personal.indexOf('长这样') >= 0, '抽象观点被挂到一次具体经历上');
  ok(personal.indexOf('低落不需要被赶走') >= 0, '原观点仍保留，未被替换掉');

  /* ================= 4. 主体性 ================= */

  const invite = MH.xai.withInvitation('这批记录倾向于睡眠偏少。');
  ok(invite.indexOf('哪些部分符合你的经验') >= 0, '解释结尾请求当事人校正');
  ok(MH.xai.withInvitation(invite) === invite, '已有请求校正的句子不再重复追加');
  const shortInvite = MH.xai.withInvitation('睡得少。', { short: true });
  ok(shortInvite.indexOf('这符合你的经验吗') >= 0, '短档用轻量版确认句');

  MH.store.prefs.set({ xaiLevel: 'long' });
  ok(MH.xai.defaultLevel() === 'long', '默认阅读层次跟随偏好');
  MH.store.prefs.set({ xaiLevel: 'medium' });

  /* ================= 本地陪伴服务的三档输出 ================= */

  const today = MH.util.todayISO();
  for (let i = 0; i < 12; i++) {
    MH.store.records.add({
      date: MH.util.addDays(today, -i),
      mood: 3, sleep: 6.5, heartRate: 68, stress: 6, note: 'XAI-' + i
    });
  }
  const s14 = MH.stats.summary14(MH.store.records.all());
  ok(JSON.stringify(s14).indexOf('XAI-') < 0, '给 XAI 的摘要依然不含备注原文');

  const reply = await MH.localService.generateReply({ message: '最近压力好大', summary: s14 });
  ok(reply.intent === 'stress', '压力意图仍然命中');
  ok(reply.layers && reply.layers.short && reply.layers.medium && reply.layers.long, '本地回复给出三档');
  ok(reply.layers.long.length > reply.layers.medium.length, '长档比中档更展开');
  ok(reply.layers.evidence.length > 0, '长档附了依据条目');
  ok(reply.layers.basis && reply.layers.basis.days === s14.daysWithData, '依据里写明样本天数');
  ok(reply.layers.long.indexOf('边界') >= 0, '长档声明了推理边界');
  ok(reply.text.indexOf('依据') >= 0, '压平后的默认文本带依据');

  for (const intent of ['你好', '最近很想哭', '睡不着', '好焦虑', '很生气', '好孤独', '累死了', '今天不错', '随便说说']) {
    const r = await MH.localService.generateReply({ message: intent, summary: s14 });
    if (!r.layers) { ok(false, '意图「' + intent + '」缺少分层'); continue; }
    const good = r.layers.short.length > 0 && r.layers.medium.length > 0 && r.layers.long.length > 0;
    ok(good, '意图「' + intent + '」三档齐全');
  }

  const crisis = await MH.localService.generateReply({ message: '我不想活了', summary: s14 });
  ok(crisis.crisis === true && crisis.resources.length >= 3, '危机输入仍然只走求助资源');
  ok(!crisis.layers, '危机输入不做任何解释与分层');

  /* ================= 用户否掉的解释不许复活 ================= */

  await MH.localService.generateReply({ message: '最近压力大', summary: s14 });
  MH.store.xai.append({ target: 'chat:probe', verdict: 'reject', note: '不是压力，是项目要上线' });
  const note = MH.xai.revisionNote();
  ok(note && note.indexOf('项目要上线') >= 0, '上一版被推翻的说明会被读回来');
  const after = await MH.localService.generateReply({ message: '最近压力大', summary: s14 });
  ok(after.layers.long.indexOf('项目要上线') >= 0, '新一版主动承认并绕开被否的读法');
  ok(MH.store.xai.rejections(5).length === 1, '校正记录落在本机反馈里');
  ok(MH.store.xai.summary('chat:').reject === 1, '反馈分布可按类别统计');
  MH.store.xai.clear();
  ok(MH.xai.revisionNote() === null, '清空反馈后不再有需要道歉的事');

  /* ================= 模型管理层：云端输出同样被约束 ================= */

  global.fetch = async () => ({
    ok: true, status: 200, text: async () => '',
    json: async () => ({
      choices: [{ message: { content: '你就是这样的人，肯定改不了。\n\n中：这也许可调。\n\n长：这里是展开。' } }]
    })
  });
  const mc = MH.models;
  const conn = MH.store.models.addConnection({
    name: 'XAI 测试', provider: 'openai', kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-xai', persistKey: false
  });
  MH.store.models.setAllowExternal(true);
  MH.models.setActive('companion', 'cloud:' + conn.id);

  const cloud = await mc.run('companion', { message: '你好', summary: null });
  ok(cloud.text.indexOf('你就是这样的人') < 0, '云端输出的定性断言也被降调');
  ok(cloud.layers && cloud.layers.long.length > 0, '云端输出同样被拆出三档');
  ok(cloud.layers.revision.indexOf('哪些部分符合你的经验') >= 0, '云端输出也附请求校正');

  delete global.fetch;
  MH.store.models.removeConnection(conn.id);
  MH.store.models.setAllowExternal(false);
  MH.models.setActive('companion', 'local-rules');

  /* ================= 提示词层面的约束 ================= */

  const chatSystem = MH.modelAdapters.buildMessages({ task: 'chat', payload: { message: 'hi' } })[0].content;
  ok(chatSystem.indexOf('镜子，不是法官') >= 0, '陪伴提示词写明了「镜子，不是法官」');
  ok(chatSystem.indexOf('哪些符合') >= 0, '提示词要求解释结尾征求校正');
  ok(chatSystem.indexOf('短') >= 0 && chatSystem.indexOf('长') >= 0, '提示词要求三档阅读层次');
  ok(chatSystem.indexOf('相关不等于因果') >= 0 || chatSystem.indexOf('不等于因果') >= 0, '提示词区分了相关与因果');
  const qaSystem = MH.modelAdapters.buildMessages({ task: 'qa', payload: { question: 'q' } })[0].content;
  ok(qaSystem.indexOf('不要编造') >= 0 || qaSystem.indexOf('缺口') >= 0, '问答提示词要求说明证据缺口');

  /* ================= .me 人格：从定义改成假设 ================= */

  MH.me.personality.observe('这个数字背后的机制是什么？为什么睡眠和心情会一起动', MH.store.records.all());
  const described = MH.me.personality.describeText();
  ok(described.indexOf('暂定假设') >= 0, '人格画像自述为暂定假设');
  const traitLines = described.split('\n').filter(l => l.indexOf('- ') === 0);
  ok(traitLines.length === 5 && traitLines.every(l => /读数|暂无信号/.test(l)),
    '人格画像里的每一条都写成「读数」或「暂无信号」，不写成定性');
  ok(traitLines.every(l => l.indexOf('你是') < 0), '人格画像不对当事人下判断句');
  ok(described.indexOf('不要说') >= 0, '人格画像对下游模型写明了使用限制');

  const hyps = MH.me.personality.hypotheses();
  ok(hyps.length === 5, '五个维度各自有一条 XAI 解释');
  ok(hyps.every(h => h.xai && h.xai.short && h.xai.long.indexOf('可能跑偏') >= 0), '每条人格假设都声明了可能跑偏的地方');
  ok(hyps.every(h => !h.samples || h.xai.basis.text.indexOf('依据') >= 0), '有人格信号时给出依据密度');

  const target = hyps.filter(h => h.samples > 0).sort((a, b) => b.score - a.score)[0];
  const beforeScore = target.score;
  MH.me.personality.correct(target.key, 'reject', '这条不对，我那天只是随口一问');
  const afterCorrect = MH.me.personality.hypotheses().filter(h => h.key === target.key)[0];
  ok(Math.abs(afterCorrect.score - beforeScore) > 0.5, '被否掉的人格读数向中性拉回');
  ok(afterCorrect.confidence <= target.confidence, '被否掉的人格读数置信度下降');
  ok(afterCorrect.xai.long.indexOf('只是随口一问') >= 0, '人格假设里保留了用户当时的说明');
  ok(afterCorrect.correction && afterCorrect.correction.verdict === 'reject', '校正结论随画像一起持久化');
  ok(MH.me.personality.describeText().indexOf('曾评价') >= 0, '喂给模型的画像也带上「已被评价」标记');
  ok(MH.store.xai.summary('personality:').reject >= 1, '人格校正同样进入本机反馈');

  /* ================= 存储与打包一致性 ================= */

  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  ok(/\.xai__switch\s*\{/.test(css) && /\.xai__btn\.is-on\s*\{/.test(css), '样式里存在三档开关的规则');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok(html.indexOf('js/core/xai.js') >= 0, 'index.html 引入了 xai.js');
  ok(html.indexOf('js/core/xai.js') < html.indexOf('js/core/local-service.js'), 'xai.js 在依赖它的模块之前加载');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync-web-assets.cjs'), 'utf8');
  ok(/js\/core\/xai\.js/.test(sync), '小程序内核同步清单包含 xai.js');

  MH.store.xai.clear();
  MH.store.records.clear();
  MH.me.personality.reset();

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
