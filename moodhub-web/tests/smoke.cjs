/* 核心层冒烟测试：node tests/smoke.cjs
   用最小 DOM 桩在 Node 里加载 js/core/，验证口令派生、校验、统计聚合与本地服务。
   不涉及浏览器 UI，也不需要任何依赖。 */
const path = require('path');
const nodeCrypto = require('crypto');

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
  'ingest.js', 'retriever.js', 'local-service.js', 'qa.js',
  'models/registry.js', 'models/adapters.js', 'models/manager.js',
  'health-import/zip.js', 'health-import/formats.js',
  'health-import/vendors.js', 'health-import/pipeline.js'
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
  // 1) 纯 JS PBKDF2 与 Node 内置实现比对
  const salt = MH.crypto.randomHex(16);
  const jsHex = await MH.crypto.derive('moodhub-测试-pwd', salt, { algo: 'PBKDF2-JS', iters: 1000 });
  const refHex = nodeCrypto.pbkdf2Sync('moodhub-测试-pwd', Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex');
  ok(jsHex === refHex, 'PBKDF2(JS) 与 Node 内置实现一致');

  const sha = MH.crypto.sha256Hex('abc');
  ok(sha === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") 正确');

  // 2) 表单校验
  const good = MH.metrics.validate({ date: '2026-10-01', mood: 4, sleep: 7.5, heartRate: 68, stress: 3, note: 'ok' });
  ok(good.ok, '合法记录通过校验');
  const bad = MH.metrics.validate({ date: '2099-01-01', mood: 9, sleep: -1, heartRate: 10, stress: 3.5 });
  ok(!bad.ok && bad.errors.date && bad.errors.mood && bad.errors.sleep && bad.errors.heartRate && bad.errors.stress,
    '越界 / 未来日期 / 非整数全部被拦截');
  const miss = MH.metrics.validate({ date: '2026-10-01' });
  ok(Object.keys(miss.errors).length === 4, '四项指标缺失时给出 4 条错误');

  // 3) 账户
  await MH.store.auth.create('测试用户', 'secret123');
  ok(await MH.store.auth.verify('secret123'), '正确密码通过');
  ok(!(await MH.store.auth.verify('wrong')), '错误密码被拒绝');
  ok((await MH.store.auth.changePassword('wrong', 'x')) === false, '旧密码错误时改密码被拒绝');
  ok(await MH.store.auth.changePassword('secret123', 'newpass456'), '改密码成功');
  ok(await MH.store.auth.verify('newpass456'), '新密码生效');

  // 4) 记录与统计
  const today = MH.util.todayISO();
  for (let i = 0; i < 14; i++) {
    MH.store.records.add({
      date: MH.util.addDays(today, -i),
      mood: 3 + (i % 2), sleep: 6 + (i % 3) * 0.5,
      heartRate: 62 + (i % 5), stress: 4 + (i % 4), note: 'SENTINEL-' + i
    });
  }
  ok(MH.store.records.count() === 14, '写入 14 条记录');
  const ov = MH.stats.overview(MH.store.records.all(), 14);
  ok(ov.daysWithData === 14, '覆盖天数 = 14');
  ok(ov.metrics.mood.mean > 0 && ov.metrics.heartRate.mean >= 62, '均值计算正常');

  const s14 = MH.stats.summary14(MH.store.records.all());
  ok(s14.schema === 'moodhub.summary/v1' && s14.windowDays === 14, '14 天摘要结构正确');
  ok(JSON.stringify(s14).indexOf('SENTINEL') < 0, '摘要不含备注原文');
  ok(JSON.stringify(s14.metrics) === JSON.stringify(s14.metrics).replace(/\[|\]/g, ''), '摘要指标层不含数组型明细');
  ok(Object.keys(s14.metrics.mood).join(',') === 'mean,min,max,latest,trend', '摘要只含聚合字段');

  // 5) 本地服务
  const normal = await MH.localService.generateReply({ message: '最近压力好大', summary: s14 });
  ok(normal.crisis === false && normal.text.length > 10, '普通回应生成成功');
  ok(normal.intent === 'stress', '压力意图命中');
  const crisis = await MH.localService.generateReply({ message: '我不想活了', summary: s14 });
  ok(crisis.crisis === true && crisis.resources.length >= 3, '危机词触发求助资源');
  const leak = await MH.localService.generateReply({ message: '你好', summary: s14, records: [{ date: '2026-01-01', note: 'secret' }] });
  ok(JSON.stringify(leak.payload).indexOf('secret') < 0, '额外字段（原始记录）被裁剪');
  ok(leak.payload && leak.payload.summary && !('records' in leak.payload), '服务入参只剩 message + summary');

  // 6) 数据摄入：CSV / JSON / 文本
  const csv = '日期,睡眠,心情,压力,心率,备注\n2026-09-25,7.5,4,3,62,散步\n2026-09-26,6,3,5,68,加班\n';
  const dCsv = MH.ingest.parse('test.csv', csv);
  ok(dCsv.rows.length === 2, 'CSV 解析出 2 行');
  ok(dCsv.fields.some(f => f.metric === 'sleep'), 'CSV 识别出睡眠列');
  ok(dCsv.fields.some(f => f.type === 'date'), 'CSV 识别出日期列');

  const semi = MH.ingest.parse('t.csv', '日期;睡眠\n2026-09-25;7');
  ok(semi.rows.length === 1 && semi.rows[0]['睡眠'] === '7', '分号分隔的 CSV 也能解析');

  const dJson = MH.ingest.parse('b.json', JSON.stringify({ records: [{ date: '2026-09-25', mood: 4 }] }));
  ok(dJson.rows && dJson.rows.length === 1, 'JSON（含 records 数组）解析成功');

  const conv = MH.ingest.toRecords({ rows: dCsv.rows, fields: dCsv.fields, name: 'test.csv' });
  ok(conv.records.length === 2 && conv.records[0].sleep === 7.5, 'CSV 可转换为应用记录');
  ok(conv.matched.mood === '心情', '转换时正确映射心情列');

  // 7) 检索
  const index = MH.retriever.buildIndex([{ id: 'a', name: 'a.csv', text: '今天加班到十点，睡得很差\n周末去爬山，心情不错' }]);
  const hits = MH.retriever.search(index, '加班', 3);
  ok(hits.length > 0 && hits[0].chunk.text.indexOf('加班') >= 0, '检索命中与问题最相关的块');
  ok(MH.retriever.pickQuote('前缀。今天加班到十点，很累。后面还有别的', '加班', 60).indexOf('加班') >= 0, '引用片段挑到了关键句');

  // 8) 智能问答：内置健康来源只出聚合
  const healthOnly = await MH.qa.ask({
    question: '最近睡眠平均是多少？',
    selection: { health: true, files: [] },
    records: MH.store.records.all(),
    sources: MH.store.sources.all()
  });
  ok(/平均/.test(healthOnly.answer), '问答给出统计结果');
  ok(healthOnly.context.charCount > 0, '上下文非空');
  ok(JSON.stringify(healthOnly.context).indexOf('SENTINEL') < 0, '健康来源上下文不含备注原文');

  const crisisQA = await MH.qa.ask({
    question: '我不想活了',
    selection: { health: true, files: [] },
    records: MH.store.records.all(),
    sources: MH.store.sources.all()
  });
  ok(crisisQA.mode === 'crisis' && crisisQA.resources.length >= 3, '问答命中危机词时转求助通道');

  // 9) 智能问答：文件来源参与计算并给出引用
  const src = MH.store.sources.add({
    name: 'test.csv', kind: 'csv', rows: dCsv.rows, fields: dCsv.fields,
    text: dCsv.text, persist: false
  });
  const withFile = await MH.qa.ask({
    question: '睡眠最低是多少？',
    selection: { health: false, files: [src.id] },
    records: MH.store.records.all(),
    sources: MH.store.sources.all()
  });
  ok(/最低/.test(withFile.answer) && /6/.test(withFile.answer), '文件来源参与数值计算');
  ok(withFile.citations.length > 0 && withFile.citations[0].sourceName === 'test.csv', '答案带证据引用与来源名');
  ok(withFile.usedSources.indexOf('test.csv') >= 0, '记录了使用到的来源');

  const noSource = await MH.qa.ask({ question: '你好', selection: { health: false, files: [] }, records: [], sources: [] });
  ok(noSource.mode === 'empty', '未选来源时给出明确提示而不是编造');

  const ans = await MH.localService.generateAnswer({
    question: '总结', context: { text: 'x', usedSources: ['a'] },
    facts: [{ type: 'stat', text: 's1' }], rows: [{ a: 1 }]
  });
  ok(!('rows' in ans.payload), '问答服务入参裁剪掉额外字段');

  // 10) 模型管理
  ok(MH.modelRegistry.PRESETS.length >= 6, '内置多家云端预设');
  const dsPreset = MH.modelRegistry.getPreset('deepseek');
  ok(dsPreset.baseUrl === 'https://api.deepseek.com' && dsPreset.defaultModel === 'deepseek-flash',
    'DeepSeek 预设与官方文档一致（base_url / 默认模型）');
  ok(dsPreset.models.join(',') === 'deepseek-flash,deepseek-v4-pro', 'DeepSeek 可选模型列表为当前在售模型');
  ok(dsPreset.models.indexOf('deepseek-chat') < 0 && dsPreset.models.indexOf('deepseek-reasoner') < 0,
    '模型列表不再包含已下线的旧名');
  const dsAnthropic = MH.modelRegistry.getPreset('deepseek-anthropic');
  ok(!!dsAnthropic && MH.modelAdapters.anthropicUrl(dsAnthropic.baseUrl) === 'https://api.deepseek.com/anthropic/v1/messages',
    'DeepSeek Anthropic 兼容端点拼接正确');
  ok(MH.modelAdapters.anthropicUrl('https://api.anthropic.com/v1') === 'https://api.anthropic.com/v1/messages',
    '官方 Anthropic 端点拼接不受影响');
  ok(MH.modelRegistry.LOCAL_MODELS.length === 2, '内置两个本地引擎');
  ok(MH.modelRegistry.estimateWindow('gemini-1.5-pro') > MH.modelRegistry.estimateWindow('gpt-4o-mini'), '上下文窗口估算能区分强弱模型');

  ok(MH.models.activeFor('companion') === 'local-rules', '陪伴场景默认本地规则引擎');
  ok(MH.models.activeFor('qa') === 'local-grounded', '问答场景默认本地检索引擎');
  ok(MH.models.listFor('qa').every(m => m.kind === 'local' || m.privacy === 'external'), '场景模型列表结构正确');

  const rec0 = MH.models.recommend('companion');
  ok(rec0.modelId === 'local-rules' && /本地引擎|还没有配置/.test(rec0.reason), '未配置云端时推荐本地引擎');

  const conn = MH.store.models.addConnection({
    name: '测试 DeepSeek', provider: 'deepseek', kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    apiKey: 'sk-test', persistKey: false
  });
  ok(MH.store.models.hasKey(conn.id), '会话级密钥可读回');
  ok(MH.store.models.connections()[0].apiKey === 'sk-test', '连接列表解析出密钥');

  MH.models.setActive('qa', 'cloud:' + conn.id);

  // 严格本地模式：即使选中云端也不外发
  const blocked = await MH.models.run('qa', { question: '总结', context: { text: 'x', usedSources: [] }, facts: [] });
  ok(blocked.privacy === 'on-device' && blocked.degraded && blocked.error.code === 'BLOCKED_BY_PRIVACY',
    '未授权外发时强制本地并标记降级原因');

  // 危机文本：即使开启外发、且场景指向云端，也强制本地
  MH.models.privacy.setAllowExternal(true);
  MH.models.setActive('companion', 'cloud:' + conn.id);
  const guarded = await MH.models.run('companion', { message: '我不想活了', summary: null });
  ok(guarded.privacy === 'on-device' && guarded.error && guarded.error.code === 'CRISIS_GUARD',
    '危机文本强制本地，绝不发往云端');

  // 缺密钥 → 明确错误码 + 降级
  const noKeyConn = MH.store.models.addConnection({
    name: '无密钥', provider: 'openai', kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', persistKey: false
  });
  MH.models.setActive('companion', 'cloud:' + noKeyConn.id);
  const noKey = await MH.models.run('companion', { message: '你好', summary: null });
  ok(noKey.degraded && noKey.error.code === 'NO_KEY', '缺少密钥时降级并给出 NO_KEY');

  // 云端成功路径（stub fetch）
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '云端回答' } }] }) });
  MH.models.setActive('companion', 'cloud:' + conn.id);
  const cloudOk = await MH.models.run('companion', { message: '你好', summary: null });
  ok(cloudOk.text === '云端回答' && cloudOk.privacy === 'external' && !cloudOk.degraded, '云端调用成功时返回外部模型结果');
  ok(cloudOk.preview && cloudOk.preview.kind === 'openai-compatible', '外发预览标明协议类型');
  ok(JSON.stringify(cloudOk.preview).indexOf('sk-test') < 0, '外发预览不含密钥');
  const gPreview = MH.modelAdapters.previewRequest(
    { kind: 'gemini', baseUrl: 'https://x/v1beta', model: 'gemini-1.5-flash', apiKey: 'AIzaSECRET' },
    { task: 'chat', payload: { message: 'hi' } }
  );
  ok(gPreview.url.indexOf('AIzaSECRET') < 0 && /key=\*\*\*/.test(gPreview.url), 'Gemini 预览 URL 中密钥被掩码');

  // 云端 500 → 自动降级本地
  global.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error', json: async () => ({}) });
  const cloudFail = await MH.models.run('companion', { message: '你好', summary: null });
  ok(cloudFail.degraded && cloudFail.error.code === 'SERVER' && cloudFail.privacy === 'on-device',
    '云端 500 自动降级本地并给出 SERVER 错误码');

  // 超时映射
  global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const timeout = await MH.models.run('companion', { message: '你好', summary: null });
  ok(timeout.error && timeout.error.code === 'TIMEOUT', 'AbortError 映射为 TIMEOUT');
  delete global.fetch;

  const t = await MH.models.test('local-rules');
  ok(t.ok === true, '本地引擎连通性测试通过');
  ok(MH.models.logs().length > 0, '调用日志已记录');
  const anyLog = MH.models.logs().some(l => l.code === 'BLOCKED_BY_PRIVACY');
  ok(anyLog, '日志保留了降级原因');

  // 导出的备份里不能出现密钥
  const dumpWithModels = MH.store.exportAll();
  ok(JSON.stringify(dumpWithModels.models).indexOf('sk-test') < 0, '备份不含 API Key');

  MH.store.models.removeConnection(conn.id);
  MH.store.models.removeConnection(noKeyConn.id);
  ok(MH.models.activeFor('companion') === 'local-rules', '删除连接后场景回落到本地默认');
  MH.models.privacy.setAllowExternal(false);

  // 11) 导入导出
  const dump = MH.store.exportAll();
  MH.store.records.clear();
  ok(MH.store.records.count() === 0, '清空记录');
  MH.store.importAll(dump, 'replace');
  ok(MH.store.records.count() === 14, '导入恢复 14 条');

  // 12) 第三方健康数据导入
  const zlib = require('zlib');

  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** 造一个最小的 ZIP，用来喂给自研的容器解析器。 */
  function buildZip(files, deflate) {
    const locals = [], centrals = [];
    let offset = 0;
    files.forEach(f => {
      const nameBuf = Buffer.from(f.name, 'utf8');
      const raw = Buffer.from(f.text, 'utf8');
      const body = deflate ? zlib.deflateRawSync(raw) : raw;
      const method = deflate ? 8 : 0;
      const crc = crc32(raw);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
      lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      const local = Buffer.concat([lh, nameBuf, body]);
      locals.push(local);

      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
      ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt32LE(offset, 42);
      centrals.push(Buffer.concat([ch, nameBuf]));
      offset += local.length;
    });
    const central = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, central, eocd]);
  }

  // 12.1 容器层：ZIP / DEFLATE / XLSX
  const payload = 'MoodHub 健康数据导入 '.repeat(60);
  const zipStored = new Uint8Array(buildZip([{ name: 'a.txt', text: payload }], false));
  const zipDefl = new Uint8Array(buildZip([{ name: 'a.txt', text: payload }], true));
  ok(MH.zip.listEntries(zipStored).length === 1 && MH.zip.listEntries(zipStored)[0].name === 'a.txt', 'ZIP 中央目录解析出条目');

  const random = Buffer.from(payload + payload, 'utf8');
  const inflated = MH.zip.inflateRaw(new Uint8Array(zlib.deflateRawSync(random)), random.length);
  ok(MH.zip.decodeUTF8(inflated) === random.toString('utf8'), '纯 JS inflate 与 Node deflateRaw 结果一致');
  const repeated = MH.zip.inflateRaw(new Uint8Array(zlib.deflateRawSync(Buffer.alloc(9000, 'x'))), 9000);
  ok(repeated.length === 9000 && String.fromCharCode(repeated[8999]) === 'x', '长距离回溯也能正确解压');

  const entryBytes = await MH.zip.readEntryBytes(zipDefl, MH.zip.listEntries(zipDefl)[0]);
  ok(MH.zip.decodeUTF8(entryBytes) === payload, 'ZIP 条目读取（含解压）结果正确');

  const xlsxBytes = new Uint8Array(buildZip([
    { name: 'xl/workbook.xml', text: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="日志" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', text: '<?xml version="1.0"?><sst><si><t>日期</t></si><si><t>睡眠时长(小时)</t></si><si><t>压力值</t></si></sst>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" s="1"><v>45931</v></c><c r="B2"><v>7.5</v></c><c r="C2"><v>4</v></c></row>' +
      '<row r="3"><c r="A3" s="1"><v>45932</v></c><c r="B3"><v>6</v></c></row>' +
      '</sheetData></worksheet>' }
  ], true));
  const wb = await MH.zip.readWorkbook(xlsxBytes);
  ok(wb.sheets.length === 1 && wb.sheets[0].name === '日志', 'XLSX 工作表清单读取正确');
  ok(wb.sheets[0].rows[0][0] === '日期' && wb.sheets[0].rows[0][1] === '睡眠时长(小时)', 'XLSX 表头来自 sharedStrings');
  ok(wb.sheets[0].rows[1][0] === '2025-10-01', 'Excel 日期序列号按 1900 序列还原');

  const xlsxTables = await MH.importFormats.tables({ name: '健康.xlsx', bytes: xlsxBytes });
  ok(xlsxTables.tables.length === 1 && xlsxTables.tables[0].headers[0] === '日期', 'XLSX 经统一格式层读出表格');
  ok(xlsxTables.tables[0].rows.length === 2 && xlsxTables.tables[0].rows[0]['睡眠时长(小时)'] === '7.5', 'XLSX 行数据正确');

  // 12.2 识别与字段映射
  const huaweiCsv = '统计日期,睡眠时长(分钟),静息心率,压力值,步数\n2026-09-01,420,62,35,8000\n2026-09-02,380,60,42,6500\n';
  const csvTables = await MH.importFormats.tables({ name: 'huawei_health_export.csv', text: huaweiCsv });
  const detected = MH.importVendors.detect({ name: 'huawei_health_export.csv', tables: csvTables.tables, textSample: huaweiCsv });
  ok(detected[0].id === 'huawei', '文件名 + 专属列名命中华为画像');

  const mapping = MH.importVendors.map(csvTables.tables[0], 'huawei');
  ok(mapping.date && mapping.date.column === '统计日期', '日期列识别正确');
  ok(mapping.metrics.sleep && mapping.metrics.sleep.column === '睡眠时长(分钟)', '睡眠列识别正确');
  ok(mapping.metrics.sleep.unit.factor === 1 / 60, '睡眠单位被判定为分钟，计划 ÷60');
  ok(mapping.metrics.heartRate && mapping.metrics.heartRate.column === '静息心率', '心率列识别正确');
  ok(mapping.metrics.stress && mapping.metrics.stress.unit.factor === 0.1, '压力百分制自动折算成 10 分制');
  ok(mapping.aux.steps && mapping.aux.steps.column === '步数', '辅助指标步数被识别');
  ok(mapping.metrics.mood === null, '没有对应列的心情不硬凑');

  // 12.3 清洗：单位换算、备注、脏数据
  const out = MH.healthImport.transform(csvTables.tables[0], mapping, { snapStep: false });
  ok(out.samples.length === 2, '两行都转成样本');
  ok(Math.abs(out.samples[0].values.sleep - 7) < 1e-6, '睡眠 420 分钟 → 7 小时');
  ok(Math.abs(out.samples[0].values.stress - 3.5) < 1e-6, '压力 35（百分制）→ 3.5 分');
  ok(out.samples[0].note.indexOf('步数 8000') >= 0, '辅助指标写进备注');

  const messyCsv = '日期,睡眠,心率\n2026-09-01,7.5,62\n不是日期,7,60\n2026-13-40,8,60\n2099-01-01,7,60\n2026-09-02,30,250\n';
  const messyTables = await MH.importFormats.tables({ name: 'messy.csv', text: messyCsv });
  const messyMapping = MH.importVendors.map(messyTables.tables[0], 'generic');
  const messyOut = MH.healthImport.transform(messyTables.tables[0], messyMapping, { outOfRange: 'drop', snapStep: false });
  const codes = messyOut.issues.map(i => i.code);
  ok(messyOut.samples.length === 1, '只有第一行可用');
  ok(codes.indexOf('INVALID_DATE') >= 0 && codes.indexOf('FUTURE_DATE') >= 0, '非法日期与未来日期都被记录');
  ok(codes.indexOf('OUT_OF_RANGE') >= 0 && codes.indexOf('NO_VALUE') >= 0, '超量程与空指标都有对应问题记录');

  const clampedOut = MH.healthImport.transform(messyTables.tables[0], messyMapping, { outOfRange: 'clamp', snapStep: false });
  ok(clampedOut.samples.length === 2 && clampedOut.samples[1].values.sleep === 16, '「截断」策略把超量程值压回边界');

  ok(MH.healthImport.parseDateTime('2026-09-01 13:45:00').time === '13:45', '日期时间串保留具体时刻');
  ok(MH.healthImport.parseDateTime('9/1/2026').date === '2026-09-01', '美式 MM/DD/YYYY 解析正确');
  ok(MH.healthImport.parseDateTime('31/12/2026').date === '2026-12-31', '首位大于 12 时按 DD/MM/YYYY 解析');
  ok(MH.healthImport.parseDateTime('1756728000').date === '2025-09-01', '秒级时间戳解析正确');
  ok(MH.healthImport.parseDateTime('2026-13-40') === null, '非法日期（13 月 40 日）被拒绝');

  // 12.4 Apple 健康 XML 与 JSON 导出
  const appleXml = '<?xml version="1.0" encoding="UTF-8"?><HealthData locale="zh_CN">' +
    '<Record type="HKQuantityTypeIdentifierRestingHeartRate" value="61" unit="count/min" startDate="2026-09-01 07:00:00 +0800" endDate="2026-09-01 07:05:00 +0800"/>' +
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-01 23:00:00 +0800" endDate="2026-09-02 07:00:00 +0800"/>' +
    '<Record type="HKQuantityTypeIdentifierStepCount" value="5000" unit="count" startDate="2026-09-02 09:00:00 +0800" endDate="2026-09-02 09:30:00 +0800"/>' +
    '</HealthData>';
  const appleTables = await MH.importFormats.tables({ name: 'export.xml', text: appleXml });
  ok(appleTables.tables[0].rows.length === 2, 'Apple 健康 XML 按天汇总');
  const appleRow = appleTables.tables[0].rows.filter(r => r['日期'] === '2026-09-02')[0];
  ok(appleRow && Math.abs(Number(appleRow['睡眠时长(小时)']) - 8) < 1e-6, '跨夜睡眠归到起床日并合计 8 小时');
  ok(appleRow && appleRow['步数(步)'] === '5000', '步数按天求和');
  ok(appleTables.tables[0].rows[0]['静息心率(bpm)'] === '61', '静息心率按天取值');
  ok(MH.importVendors.detect({ name: '导出.xml', tables: appleTables.tables, textSample: appleXml })[0].id === 'apple', 'Apple 来源识别正确');

  const haeJson = JSON.stringify({
    data: {
      metrics: [
        { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-09-01 00:00:00 +0800', Avg: 7.2 }] },
        { name: 'resting_heart_rate', units: 'bpm', data: [{ date: '2026-09-01 00:00:00 +0800', Avg: 58 }] }
      ]
    }
  });
  const haeTables = await MH.importFormats.tables({ name: 'export.json', text: haeJson });
  ok(haeTables.tables[0].rows.length === 1 && haeTables.tables[0].rows[0]['sleep_analysis(hr)'] === '7.2',
    'Health Auto Export JSON 展开为按日期的宽表');

  // 12.5 端到端：检查 → 导入 → 冲突策略 → 撤销
  MH.store.records.clear();
  MH.store.records.add({ date: '2026-09-01', time: '', mood: 2, note: '手动记的' });
  const ins = await MH.healthImport.inspect({ name: 'huawei_export.csv', text: huaweiCsv });
  ok(ins.detection.id === 'huawei', 'inspect 自动识别来源');
  ok(ins.tables[0].mapping.matchedCount >= 3, 'inspect 给出可用的自动映射');

  const inputs = ins.tables.map(t => ({
    name: ins.name, label: t.table.label, path: t.table.path,
    table: t.table, mapping: t.mapping, profileName: t.mapping.profileName
  }));

  const rep1 = await MH.healthImport.run({ inputs, options: { conflict: 'merge', snapStep: false } });
  ok(rep1.counts.added === 1 && rep1.counts.updated === 1, '补齐策略：空白日期新增、半空记录补齐');
  const filled = MH.store.records.all().filter(r => r.date === '2026-09-01')[0];
  ok(filled.mood === 2, '补齐策略没有覆盖本机已有的心情值');
  ok(Math.abs(filled.sleep - 7) < 1e-6 && filled.heartRate === 62, '缺失的睡眠与心率被补齐');

  const rep2 = await MH.healthImport.run({ inputs, options: { conflict: 'merge', snapStep: false } });
  ok(rep2.counts.added === 0 && rep2.counts.updated === 0, '重复导入同一份文件不会复制记录');

  const rep3 = await MH.healthImport.run({ inputs, options: { conflict: 'append', snapStep: false } });
  ok(rep3.counts.added === 2 && MH.store.records.count() === 4, '追加策略下同一天可以有多条记录');

  const beforeUndo = MH.store.records.count();
  const undone = MH.healthImport.undo(rep3.id);
  ok(undone.restored === beforeUndo - 2, '撤销回退到导入前');
  ok(MH.healthImport.canUndo(rep3.id) === false, '撤销只能用一次');

  const repSkip = await MH.healthImport.run({ inputs, options: { conflict: 'skip', snapStep: false } });
  ok(repSkip.counts.skipped >= 1 && repSkip.counts.added === 0, '跳过策略不动本机已有数据');

  try {
    await MH.healthImport.run({ inputs, options: {}, cancelToken: { cancelled: true } });
    ok(false, '取消标记应当中止导入');
  } catch (e) {
    ok(e && e.code === 'CANCELLED', '取消标记立即中止导入');
  }

  ok(MH.store.imports.all().length >= 4, '导入历史已记录');
  ok(MH.store.imports.all()[0].counts.added >= 0, '导入历史只存统计摘要');
  ok(JSON.stringify(MH.store.imports.all()).indexOf('班班长') < 0, '导入历史不含原始行内容');

  // 12.6 ZIP 多表：睡眠表 + 心率表按日期合成一条记录
  const zipCsv = new Uint8Array(buildZip([
    { name: 'health_export/sleep.csv', text: 'date,sleep_minutes\n2026-09-01,420\n2026-09-02,380\n' },
    { name: 'health_export/heart.csv', text: 'date,resting_heart_rate\n2026-09-01,62\n2026-09-02,60\n' }
  ], true));
  const zipTables = await MH.importFormats.tables({ name: 'health_export.zip', bytes: zipCsv });
  ok(zipTables.tables.length === 2, 'ZIP 里的两张 CSV 各自成表');

  MH.store.records.clear();
  const insZip = await MH.healthImport.inspect({ name: 'health_export.zip', bytes: zipCsv });
  const repZip = await MH.healthImport.run({
    inputs: insZip.tables.map(t => ({
      name: insZip.name, label: t.table.label, path: t.table.path,
      table: t.table, mapping: t.mapping, profileName: t.mapping.profileName
    })),
    options: { conflict: 'merge', snapStep: false }
  });
  ok(repZip.counts.added === 2, '同一个压缩包里的两天数据都导入了');
  const day1 = MH.store.records.all().filter(r => r.date === '2026-09-01')[0];
  ok(day1 && Math.abs(day1.sleep - 7) < 1e-6 && day1.heartRate === 62, '跨表按日期合成一条记录（睡眠 + 心率）');

  // 12.7 单位命名的护栏：不能被英文列名的拼写误导
  function sleepPlan(name) {
    const probe = MH.importFormats.gridToTable([['date', name], ['2026-09-01', '420']], 'probe.csv', '', 'csv');
    return MH.importVendors.map(probe, 'generic').metrics.sleep;
  }
  ok(sleepPlan('sleep_minutes').unit.factor === 1 / 60, 'sleep_minutes 判定为分钟');
  ok(sleepPlan('sleep_seconds').unit.factor === 1 / 3600, 'sleep_seconds 判定为秒');
  ok(sleepPlan('sleep_hours').unit.factor === 1, 'sleep_hours 判定为小时');
  ok(sleepPlan('睡眠时长(分钟)').unit.factor === 1 / 60, '中文列名带单位标注也能判定');

  MH.store.records.clear();

  // 7) 回归护栏：作者样式必须给 [hidden] 兜底
  //    否则 .modal / .view--auth / .topbar / .btn 自带的 display 会盖掉 UA 的 [hidden]{display:none}，
  //    表现为"点关闭弹窗不消失、页面点不动"。
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(css), 'CSS 存在 [hidden]{display:none} 兜底规则');
  ok(/\.modal\s*\{[^}]*display:\s*grid/.test(css), '.modal 依赖该兜底（自身设了 display:grid）');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  ok(/function closeCrisis/.test(appJs) && /closeCrisis: closeCrisis/.test(appJs), '危机卡关闭逻辑已导出');
  ok(/n\.addEventListener\('click', closeCrisis\)/.test(appJs), '「我知道了」等关闭按钮绑定了 closeCrisis');

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})();
