#!/usr/bin/env node
/* ------------------------------------------------------------------
   .me 同步工具：在「浏览器导出」与「磁盘上的 .me 目录」之间搬数据。

   浏览器拿不到文件系统权限（这是刻意的：页面永远无法自行写你的磁盘），
   所以落盘这一步必须由你显式执行。

     node tools/me-sync.cjs export ./me-export.json   导入浏览器导出 → 写入 .me/
     node tools/me-sync.cjs import ./me-import.json   读取 .me/ → 生成可导回浏览器的 JSON
     node tools/me-sync.cjs status                    只看概览，不写任何文件
   ------------------------------------------------------------------ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ME_DIR = path.join(ROOT, '.me');
const MEM_DIR = path.join(ME_DIR, 'memory');

const P_PERSONALITY = path.join(ME_DIR, 'personality.json');
const P_PROFILE = path.join(ME_DIR, 'profile.json');
const P_INDEX = path.join(MEM_DIR, 'index.json');
const P_TURNS = path.join(MEM_DIR, 'turns.jsonl');

function readJSON(file, fallback) {
  try {
    // 部分编辑器导出会带 BOM，先剥掉再解析
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** turns.jsonl：一行一条，便于 diff 与增量追加。 */
function readTurns() {
  try {
    return fs.readFileSync(P_TURNS, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function writeTurns(turns) {
  fs.mkdirSync(MEM_DIR, { recursive: true });
  fs.writeFileSync(P_TURNS, turns.map(t => JSON.stringify(t)).join('\n') + (turns.length ? '\n' : ''), 'utf8');
}

const TRAIT_KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

function traitLine(traits) {
  if (!traits) return '（无）';
  return TRAIT_KEYS.map(k => {
    const t = traits[k] || {};
    return `${t.label || k} ${Math.round(t.score == null ? 50 : t.score)}`;
  }).join(' · ');
}

/* ============================ 子命令 ============================ */

function cmdExport(srcFile) {
  if (!srcFile) die('用法：node tools/me-sync.cjs export <浏览器导出的 JSON>');
  const payload = readJSON(path.resolve(process.cwd(), srcFile), null);
  if (!payload || typeof payload !== 'object') die('读不出 JSON：' + srcFile);
  if (!payload.personality && !payload.memory) die('这不是 .me 导出文件（缺少 personality / memory）');

  if (payload.personality) writeJSON(P_PERSONALITY, payload.personality);
  if (payload.profile) writeJSON(P_PROFILE, payload.profile);

  const turns = (payload.memory && Array.isArray(payload.memory.turns)) ? payload.memory.turns : [];
  const merged = mergeTurns(readTurns(), turns);
  writeTurns(merged);
  writeJSON(P_INDEX, {
    schema: 'moodhub.me.memory/v1',
    turnCount: merged.length,
    firstAt: merged.length ? merged[0].at : null,
    lastAt: merged.length ? merged[merged.length - 1].at : null,
    chars: merged.reduce((n, t) => n + String(t.question || '').length + String(t.answer || '').length, 0),
    updatedAt: Date.now()
  });

  console.log('[ok] 已写入 .me/');
  console.log('     人格：' + traitLine(payload.personality && payload.personality.traits));
  console.log('     记忆：' + merged.length + ' 轮（新增 ' + (merged.length - 0 > 0 ? turns.length : 0) + ' 条输入，按 id 去重）');
}

function cmdImport(outFile) {
  const target = path.resolve(process.cwd(), outFile || 'me-import.json');
  const turns = readTurns();
  const payload = {
    schema: 'moodhub.me/v1',
    exportedAt: new Date().toISOString(),
    model: 'OCEAN-5',
    personality: readJSON(P_PERSONALITY, null),
    profile: readJSON(P_PROFILE, null),
    memory: {
      index: readJSON(P_INDEX, { schema: 'moodhub.me.memory/v1', turnCount: turns.length }),
      turns: turns
    }
  };
  if (!payload.personality && !turns.length) die('.me/ 里还没有任何数据，先在问答页导出一次。');
  fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('[ok] 已生成 ' + target);
  console.log('     记忆：' + turns.length + ' 轮；在问答页「导入 .me」选择它即可合并回本机。');
}

function cmdStatus() {
  const p = readJSON(P_PERSONALITY, null);
  const prof = readJSON(P_PROFILE, null);
  const idx = readJSON(P_INDEX, null);
  const turns = readTurns();

  console.log('.me 目录：' + ME_DIR);
  console.log('  人格：' + (p ? traitLine(p.traits) : '（还没有 personality.json）'));
  console.log('  画像：' + (prof ? (prof.nickname || '未设置称呼') +
    (prof.focusMetrics && prof.focusMetrics.length ? ' · 常问 ' + prof.focusMetrics.join('/') : '') : '（无）'));
  console.log('  记忆：' + turns.length + ' 轮' + (idx && idx.turnCount != null ? '（索引记录 ' + idx.turnCount + '）' : ''));
  if (turns.length) {
    const last = turns[turns.length - 1];
    console.log('  最近一轮：' + new Date(last.at || Date.now()).toLocaleString('zh-CN') + '  ' +
      String(last.question || '').slice(0, 40));
  }
}

function mergeTurns(existing, incoming) {
  const seen = new Set();
  const out = [];
  existing.concat(incoming).forEach(t => {
    if (!t) return;
    const key = t.id || (String(t.at) + '|' + String(t.question));
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  });
  out.sort((a, b) => (a.at || 0) - (b.at || 0));
  return out;
}

function die(msg) {
  console.error('[NG] ' + msg);
  process.exit(1);
}

/* ============================ 入口 ============================ */

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'export': cmdExport(arg); break;
  case 'import': cmdImport(arg); break;
  case 'status': cmdStatus(); break;
  default:
    console.log('用法：node tools/me-sync.cjs <export|import|status> [文件]');
    console.log('  export <浏览器导出的 JSON>   写入 .me/');
    console.log('  import [输出文件]            从 .me/ 生成可导回浏览器的 JSON');
    console.log('  status                       查看 .me/ 概览');
    process.exit(cmd ? 1 : 0);
}
