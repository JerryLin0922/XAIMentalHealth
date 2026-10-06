/* 一键跑完 MoodHub Web 的全部回归测试：node tests/run-all.cjs
   每个套件独立进程运行（避免互相污染全局桩），任意一项失败 → 退出码非 0，CI 可直接用。 */
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'smoke.cjs',            desc: '核心层：口令 / 校验 / 统计 / 检索 / 问答 / 模型路由 / 导入解析' },
  { file: 'xai.cjs',              desc: '以人为中心的解释层：断言降调 / 三档阅读 / 落到具体经历 / 可纠正假设' },
  { file: 'dom-xai.cjs',          desc: 'XAI 交互：三档切换 / 依据披露 / 符合与否的反馈与下一次改写' },
  { file: 'dom-models.cjs',       desc: '模型页：分区切换 / 筛选排序 / 详情 / 增删改 / 启停 / 密钥残留' },
  { file: 'dom-import.cjs',       desc: '导入页：选文件 → 解析 → 改映射 → 导入 → 撤销 → 跳转' },
  { file: 'import-analytics.cjs', desc: '导入 + 分析：模板数据 / 聚合 / 超大与并发边界 / 异常分支' },
  { file: 'me.cjs',               desc: '.me：五大人格推断 / 问答记忆写入召回上限 / 与问答闭环 / 导入导出' },
  { file: 'dom-qa.cjs',           desc: '问答页：.me 面板渲染 / 开关联动 / 提问后回写与刷新 / 导出与清空' }
];

let failedSuites = 0;
const started = Date.now();

SUITES.forEach(function (s) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s.file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^PASS\s/gm) || []).length;
  const fail = (out.match(/^FAIL\s/gm) || []).length;
  const ok = r.status === 0;
  if (!ok) failedSuites++;

  console.log('');
  console.log((ok ? '[ok] ' : '[NG] ') + s.file + '  —  ' + s.desc);
  console.log('      ' + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') +
    (pass ? '' : '  (无统计输出，见下方原始日志)'));
  if (!ok) console.log(out.trim().split('\n').filter(function (l) { return /FAIL|Error|error:/.test(l); }).slice(0, 20).join('\n      '));
});

console.log('');
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failedSuites === 0) console.log('ALL SUITES PASS  (' + SUITES.length + ' 个套件，' + seconds + 's)');
else console.log(failedSuites + ' / ' + SUITES.length + ' 个套件失败');
process.exit(failedSuites ? 1 : 0);
