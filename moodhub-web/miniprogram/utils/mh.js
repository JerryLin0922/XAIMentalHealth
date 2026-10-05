/**
 * Web 端内核入口。
 *
 * 先装好平台垫片，再按依赖顺序加载由 tools/sync-web-assets.cjs 生成的
 * utils/core/*.js（内容与 Web 端 js/core/ 完全一致，仅把 IIFE 挂载点改成了 CommonJS）。
 *
 * 页面里这样用：
 *   const MH = require('../../utils/mh.js');
 *   const ov = MH.stats.overview(MH.store.records.all(), 30);
 */
'use strict';

require('./adapters.js');          // 必须最先执行：内核在 require 阶段就会探测 localStorage

const MH = require('./_ns.js');
const cipherApi = require('./cipher.js');   // 三端共享加密内核（与 shared/cipher.js 逐字节一致）

/* 依赖顺序 = Web 端 index.html 里的 <script> 顺序（去掉视图层与 charts.js） */
require('./core/util.js');
require('./core/crypto.js');
require('./core/metrics.js');
require('./core/stats.js');
require('./core/ingest.js');
require('./core/retriever.js');
require('./core/local-service.js');
require('./core/qa.js');
require('./core/store.js');
require('./core/vault.js');
require('./core/models/registry.js');
require('./core/models/adapters.js');
require('./core/models/manager.js');
require('./core/health-import/zip.js');
require('./core/health-import/formats.js');
require('./core/health-import/vendors.js');
require('./core/health-import/pipeline.js');

MH.cipher = cipherApi;

/* ---------------- 平台差异覆写 ---------------- */

// util.toast 在浏览器里操作 DOM；小程序直接用 wx.showToast
MH.util.toast = function (message, kind, ms) {
  wx.showToast({ title: String(message || '').slice(0, 30), icon: 'none', duration: ms || 2600 });
};

// deviceLabel 的 UA 探测在小程序里没有意义，给一个稳定的展示名
MH.store.deviceLabel = function () { return '微信小程序'; };

module.exports = MH;
