/**
 * MoodHub 跨平台资源同步器（零依赖，Node 18+）
 *
 *   node tools/sync-web-assets.mjs android       # Web 资源 -> android/app/src/main/assets/www
 *   node tools/sync-web-assets.mjs desktop       # Web 资源 -> desktop/www
 *   node tools/sync-web-assets.mjs miniprogram   # Web 纯逻辑内核 -> miniprogram/utils/core/*.js（改写为 CommonJS）
 *   node tools/sync-web-assets.mjs list          # 打印将要同步的文件清单
 *
 * 说明：MoodHub Web 是「零构建」的纯静态站点，运行时只需要下面三组文件：
 *   index.html / css/ / js/ / shared/
 * icons/（图标展示页）、tests/、docs/、worker/ 属于开发期资产，不参与打包。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** 参与打包的目录 / 文件（相对 ROOT）。 */
const WEB_ENTRIES = ['index.html', 'css', 'js', 'shared'];

/** 不参与打包的相对路径前缀。 */
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.vscode', 'tests', 'docs',
  'icons', 'worker', 'miniprogram', 'miniapp', 'android', 'desktop', 'tools', 'dist'
]);

/** 需要复用到小程序的「DOM 无关内核」，顺序即依赖顺序。 */
const KERNEL_MODULES = [
  { src: 'js/core/util.js', ns: 'util' },
  { src: 'js/core/crypto.js', ns: 'crypto' },
  { src: 'js/core/metrics.js', ns: 'metrics' },
  { src: 'js/core/stats.js', ns: 'stats' },
  { src: 'js/core/ingest.js', ns: 'ingest' },
  { src: 'js/core/retriever.js', ns: 'retriever' },
  { src: 'js/core/xai.js', ns: 'xai' },
  { src: 'js/core/local-service.js', ns: 'localService' },
  { src: 'js/core/qa.js', ns: 'qa' },
  { src: 'js/core/store.js', ns: 'store' },
  { src: 'js/core/vault.js', ns: 'vault' },
  { src: 'js/core/models/registry.js', ns: 'modelsRegistry' },
  { src: 'js/core/models/adapters.js', ns: 'modelsAdapters' },
  { src: 'js/core/models/manager.js', ns: 'modelsManager' },
  { src: 'js/core/health-import/zip.js', ns: 'importZip' },
  { src: 'js/core/health-import/formats.js', ns: 'importFormats' },
  { src: 'js/core/health-import/vendors.js', ns: 'importVendors' },
  { src: 'js/core/health-import/pipeline.js', ns: 'importPipeline' }
];

/** 遍历出所有需要同步的相对路径。 */
function collect() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    const st = fs.statSync(abs);
    if (st.isFile()) { out.push(rel); return; }
    for (const name of fs.readdirSync(abs)) {
      if (EXCLUDE_DIRS.has(name) || name.startsWith('.')) continue;
      walk(path.posix.join(rel, name));
    }
  };
  for (const e of WEB_ENTRIES) {
    const abs = path.join(ROOT, e);
    if (fs.existsSync(abs)) walk(e);
  }
  return out;
}

function copyTree(files, destDir, label) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  let bytes = 0;
  for (const rel of files) {
    const src = path.join(ROOT, rel);
    const dst = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    bytes += fs.statSync(dst).size;
  }
  console.log(`[sync] ${label}: ${files.length} 个文件，${(bytes / 1024).toFixed(1)} KB -> ${path.relative(ROOT, destDir)}`);
}

/**
 * 把 Web 端的 IIFE 模块改写成小程序的 CommonJS 模块。
 * 原文件结尾固定为：  })(window.MH = window.MH || {});
 * 改写为：            })(MH);
 */
function toCommonJS(src, targetDir) {
  const text = fs.readFileSync(src, 'utf8');
  const marker = '})(window.MH = window.MH || {});';
  if (!text.includes(marker)) throw new Error(`未识别的模块包装：${src}`);
  const body = text.replace(marker, '})(MH);\n');
  const nsPath = path.relative(targetDir, path.join(ROOT, 'miniprogram', 'utils', '_ns.js'))
    .split(path.sep).join('/');
  return [
    '/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */',
    `var MH = require('./${nsPath}');`,
    body
  ].join('\n');
}

function syncAndroid(files) {
  copyTree(files, path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www'), 'android assets');
}

function syncDesktop(files) {
  copyTree(files, path.join(ROOT, 'desktop', 'www'), 'desktop www');
}

function syncMiniProgram() {
  const coreDir = path.join(ROOT, 'miniprogram', 'utils', 'core');
  fs.rmSync(coreDir, { recursive: true, force: true });
  fs.mkdirSync(coreDir, { recursive: true });
  for (const m of KERNEL_MODULES) {
    const src = path.join(ROOT, m.src);
    const name = path.basename(m.src);
    const dir = path.dirname(path.relative(path.join(ROOT, 'js', 'core'), m.src));
    const targetDir = dir === '.' ? coreDir : path.join(coreDir, dir);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, name), toCommonJS(src, targetDir), 'utf8');
  }
  console.log(`[sync] miniprogram kernel: ${KERNEL_MODULES.length} 个模块 -> miniprogram/utils/core`);
}

const target = process.argv[2];
const files = collect();

switch (target) {
  case 'android': syncAndroid(files); break;
  case 'desktop': syncDesktop(files); break;
  case 'miniprogram': syncMiniProgram(); break;
  case 'list': files.forEach((f) => console.log(f)); break;
  default:
    console.log('用法: node tools/sync-web-assets.mjs <android|desktop|miniprogram|list>');
    process.exit(1);
}
