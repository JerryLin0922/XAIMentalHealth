/* 通用工具：DOM、日期、数值、提示条。无外部依赖。 */
(function (MH) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ---------------- 日期 ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toISODate(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  function addDays(iso, n) {
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  function diffDays(aISO, bISO) {
    var a = aISO.split('-'), b = bISO.split('-');
    var ta = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var tb = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((tb - ta) / 86400000);
  }

  function parseISODate(iso) {
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function fmtDateShort(iso) {
    var p = String(iso).split('-');
    return +p[1] + '/' + +p[2];
  }

  function fmtDateFull(iso) {
    var d = parseISODate(iso);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtRelative(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return fmtDateTime(ts);
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return '已到期';
    var d = Math.floor(ms / 86400000);
    var h = Math.floor((ms % 86400000) / 3600000);
    if (d >= 1) return d + ' 天 ' + h + ' 小时后';
    var m = Math.floor((ms % 3600000) / 60000);
    if (h >= 1) return h + ' 小时 ' + m + ' 分钟后';
    return Math.max(1, m) + ' 分钟后';
  }

  /* ---------------- 数值 ---------------- */

  function num(v, dp) {
    if (v == null || !isFinite(v)) return '—';
    var f = Math.pow(10, dp == null ? 1 : dp);
    return String(Math.round(v * f) / f);
  }

  function mean(arr) {
    var a = arr.filter(function (v) { return v != null && isFinite(v); });
    if (!a.length) return null;
    return a.reduce(function (s, v) { return s + v; }, 0) / a.length;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }

  /* ---------------- 提示条 ---------------- */

  var TOAST_ICON = {
    ok: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 7v6m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 11v6m0-9h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  function toast(message, kind, ms) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var node = el('div', { class: 'toast', dataset: { kind: kind || 'info' }, html: TOAST_ICON[kind || 'info'] + '<span></span>' });
    var body = node.querySelector('span');
    if (body) body.textContent = message;
    else node.appendChild(document.createTextNode(message));
    host.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .2s, transform .2s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(function () { node.remove(); }, 220);
    }, ms || 2600);
  }

  MH.util = {
    $: $, $$: $$, el: el, esc: esc,
    pad2: pad2, toISODate: toISODate, todayISO: todayISO, addDays: addDays, diffDays: diffDays,
    parseISODate: parseISODate, fmtDateShort: fmtDateShort, fmtDateFull: fmtDateFull,
    fmtTime: fmtTime, fmtDateTime: fmtDateTime, fmtRelative: fmtRelative, fmtCountdown: fmtCountdown,
    num: num, mean: mean, clamp: clamp, uid: uid, debounce: debounce, toast: toast
  };
})(window.MH = window.MH || {});
