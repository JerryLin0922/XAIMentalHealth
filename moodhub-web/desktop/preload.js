/**
 * 预加载脚本：只暴露一个只读的运行环境标识，
 * 供页面在「设置 → 设备」里展示当前平台，不开放任何 Node 能力。
 */
'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('MOODHUB_DESKTOP', {
  platform: process.platform,
  electron: process.versions.electron,
  source: 'desktop'
});
