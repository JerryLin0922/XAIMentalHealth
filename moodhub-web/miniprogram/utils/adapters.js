/**
 * 平台适配层：把「浏览器才有」的全局 API 垫到小程序运行时上，
 * 让 Web 端的纯逻辑内核（utils/core/*，由 tools/sync-web-assets.cjs 零改动拷贝）
 * 可以直接在小程序里运行。
 *
 * 小程序与浏览器的四个硬差异，全部在这里抹平：
 *   1. localStorage / sessionStorage  -> wx.getStorageSync / 进程内 Map
 *   2. crypto.getRandomValues          -> wx.getRandomValues（回退 Math.random）
 *   3. fetch                           -> wx.request（手工携带 / 保存会话 Cookie）
 *   4. navigator.userAgent             -> 固定标识，供 store.deviceLabel() 显示
 *
 * 原则：**只垫 API，不改业务**。内核里的日期、统计、校验、检索、问答、
 * 本地陪伴引擎在浏览器和小程序里跑的是同一份字节码。
 */
'use strict';

/* eslint-disable no-restricted-globals */
const g = typeof globalThis === 'object' ? globalThis : Function('return this')();

/* ---------------------------------------------------------------- 1. 存储 */

const sessionMap = {};

function lsGet(k) {
  try {
    const v = wx.getStorageSync(k);
    return v === '' || v == null ? null : String(v);
  } catch (e) { return null; }
}
function lsSet(k, v) {
  try { wx.setStorageSync(k, String(v)); return true; } catch (e) { return false; }
}
function lsRemove(k) {
  try { wx.removeStorageSync(k); } catch (e) { /* 忽略 */ }
}

if (!g.localStorage) {
  g.localStorage = {
    getItem: lsGet,
    setItem: lsSet,
    removeItem: lsRemove,
    key(i) {
      try { return wx.getStorageInfoSync().keys[i] || null; } catch (e) { return null; }
    },
    get length() {
      try { return wx.getStorageInfoSync().keys.length; } catch (e) { return 0; }
    }
  };
}

if (!g.sessionStorage) {
  g.sessionStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(sessionMap, k) ? sessionMap[k] : null),
    setItem: (k, v) => { sessionMap[k] = String(v); },
    removeItem: (k) => { delete sessionMap[k]; },
    clear: () => { Object.keys(sessionMap).forEach((k) => { delete sessionMap[k]; }); }
  };
}

/* ------------------------------------------------------------ 2. 随机源 */

if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
  const base = g.crypto || {};
  g.crypto = Object.assign({}, base, {
    getRandomValues(arr) {
      // 与 shared/cipher.js 同一策略：wx.getRandomValues 同步形态优先
      if (typeof wx !== 'undefined' && wx.getRandomValues) {
        const res = wx.getRandomValues({ length: arr.length });
        if (res && res.randomValues) {
          for (let i = 0; i < arr.length; i++) arr[i] = res.randomValues[i];
          return arr;
        }
      }
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    }
  });
}

/* -------------------------------------------------------------- 3. fetch */

const COOKIE_KEY = 'moodhub.cookie';

function getCookie() { return lsGet(COOKIE_KEY) || ''; }

function miniFetch(url, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const cookie = getCookie();
  if (cookie) headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: opts.method || 'GET',
      data: opts.body,
      header: headers,
      responseType: 'text',
      dataType: 'text',                      // 关闭 wx.request 的自动 JSON.parse
      success(res) {
        const sc = res.header && (res.header['Set-Cookie'] || res.header['set-cookie']);
        if (sc) lsSet(COOKIE_KEY, sc);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(String(res.data == null ? '' : res.data)),
          json: () => Promise.resolve(
            typeof res.data === 'string' ? JSON.parse(res.data || '{}') : res.data
          )
        });
      },
      fail(e) { reject(new Error((e && e.errMsg) || 'request:fail')); }
    });
  });
}

if (typeof g.fetch !== 'function') g.fetch = miniFetch;

/* -------------------------------------------------------- 4. navigator */

if (!g.navigator) {
  g.navigator = {
    userAgent: 'MoodHub MiniProgram/1.0 (WeChat; local-first)',
    language: 'zh-CN',
    platform: 'weapp'
  };
}

module.exports = { miniFetch, getCookie };
