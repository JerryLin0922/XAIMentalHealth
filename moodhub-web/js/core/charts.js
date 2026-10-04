/* 手写 SVG 图表：折线 + 面积 + 悬停读数，无任何图表库依赖。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var NS = 'http://www.w3.org/2000/svg';

  function buildSegments(points) {
    var segs = [], cur = [];
    points.forEach(function (p) {
      if (p.y == null || !isFinite(p.y)) { if (cur.length) { segs.push(cur); cur = []; } }
      else cur.push(p);
    });
    if (cur.length) segs.push(cur);
    return segs.filter(function (s) { return s.length > 0; });
  }

  function niceRange(values, opts) {
    var vs = values.filter(function (v) { return v != null && isFinite(v); });
    if (!vs.length) return [opts.min || 0, opts.max || 1];
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 1e-6) { hi = lo + 1; lo = lo - 1; }
    var pad = (hi - lo) * 0.16;
    lo = lo - pad; hi = hi + pad;
    if (opts.min != null) lo = Math.max(opts.min, lo);
    if (opts.max != null) hi = Math.min(opts.max, hi);
    if (hi - lo < 1e-6) hi = lo + 1;
    return [lo, hi];
  }

  /**
   * 折线图。
   * @param {HTMLElement} container
   * @param {Object} o {points:[{x,y}], color, unit, label, height, min, max, dp, emptyText}
   */
  function lineChart(container, o) {
    if (!container) return;
    var points = (o.points || []).slice();
    var unit = o.unit || '';
    var dp = o.dp == null ? 1 : o.dp;
    var color = o.color || 'var(--accent)';
    var height = o.height || 190;

    var wrap = U.el('div', { class: 'chart' });
    container.innerHTML = '';
    container.appendChild(wrap);

    if (!points.length) {
      wrap.appendChild(U.el('div', { class: 'chart__empty', text: o.emptyText || '暂无数据' }));
      return;
    }

    var vals = points.map(function (p) { return p.y; });
    var hasValue = vals.some(function (v) { return v != null && isFinite(v); });
    if (!hasValue) {
      wrap.appendChild(U.el('div', { class: 'chart__empty', text: o.emptyText || '这段时间还没有记录' }));
      return;
    }

    var padL = 40, padR = 14, padT = 14, padB = 26;
    var range = niceRange(vals, o);
    var lo = range[0], hi = range[1];
    var uid = 'g' + Math.random().toString(36).slice(2, 8);

    function draw() {
      var w = Math.max(240, wrap.clientWidth || container.clientWidth || 640);
      var h = height;
      var n = points.length;
      var step = n > 1 ? (w - padL - padR) / (n - 1) : 0;
      var X = function (i) { return padL + i * step; };
      var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB); };

      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('height', h);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', (o.label || '指标') + ' 趋势图，共 ' + n + ' 天');

      var defs = document.createElementNS(NS, 'defs');
      defs.innerHTML = '<linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.9"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient>';
      svg.appendChild(defs);

      // 网格 + Y 轴
      var grid = document.createElementNS(NS, 'g');
      grid.setAttribute('class', 'chart__grid');
      var axis = document.createElementNS(NS, 'g');
      axis.setAttribute('class', 'chart__axis');
      var ticks = 4, i, t;
      for (i = 0; i <= ticks; i++) {
        t = i / ticks;
        var y = padT + t * (h - padT - padB);
        var ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', padL); ln.setAttribute('x2', w - padR);
        ln.setAttribute('y1', y); ln.setAttribute('y2', y);
        grid.appendChild(ln);
        var tx = document.createElementNS(NS, 'text');
        tx.setAttribute('x', padL - 8);
        tx.setAttribute('y', y + 3.5);
        tx.setAttribute('text-anchor', 'end');
        tx.textContent = U.num(hi - t * (hi - lo), dp);
        axis.appendChild(tx);
      }
      svg.appendChild(grid);
      svg.appendChild(axis);

      // X 轴日期
      var want = Math.min(6, n);
      for (i = 0; i < want; i++) {
        var idx = want === 1 ? 0 : Math.round(i * (n - 1) / (want - 1));
        var xt = document.createElementNS(NS, 'text');
        xt.setAttribute('x', X(idx));
        xt.setAttribute('y', h - 8);
        xt.setAttribute('text-anchor', i === 0 ? 'start' : (i === want - 1 ? 'end' : 'middle'));
        xt.textContent = U.fmtDateShort(points[idx].x);
        axis.appendChild(xt);
      }

      // 面积 + 折线（空值处断开）
      var segs = buildSegments(points.map(function (p, i2) { return { x: X(i2), y: p.y == null ? null : Y(p.y), v: p.y }; }));
      segs.forEach(function (seg) {
        var d = seg.map(function (p, k) { return (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
        var area = document.createElementNS(NS, 'path');
        area.setAttribute('class', 'chart__area');
        area.setAttribute('fill', 'url(#' + uid + ')');
        area.setAttribute('d', d + ' L' + seg[seg.length - 1].x.toFixed(1) + ' ' + (h - padB) + ' L' + seg[0].x.toFixed(1) + ' ' + (h - padB) + ' Z');
        svg.appendChild(area);

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'chart__line');
        path.setAttribute('stroke', color);
        path.setAttribute('d', d);
        svg.appendChild(path);
      });

      // 数据点
      if (n <= 62) {
        points.forEach(function (p, i2) {
          if (p.y == null || !isFinite(p.y)) return;
          var c = document.createElementNS(NS, 'circle');
          c.setAttribute('class', 'chart__dot');
          c.setAttribute('cx', X(i2)); c.setAttribute('cy', Y(p.y));
          c.setAttribute('r', 2.6); c.setAttribute('fill', color);
          svg.appendChild(c);
        });
      }

      // 悬停层
      var hover = document.createElementNS(NS, 'g');
      hover.setAttribute('class', 'chart__hover');
      hover.setAttribute('opacity', '0');
      var hline = document.createElementNS(NS, 'line');
      hline.setAttribute('y1', padT); hline.setAttribute('y2', h - padB);
      hline.setAttribute('stroke-dasharray', '3 3');
      hover.appendChild(hline);
      var hdot = document.createElementNS(NS, 'circle');
      hdot.setAttribute('r', 4.6); hdot.setAttribute('fill', color);
      hdot.setAttribute('stroke', 'var(--surface)'); hdot.setAttribute('stroke-width', '2');
      hover.appendChild(hdot);
      svg.appendChild(hover);

      var hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', padL); hit.setAttribute('y', 0);
      hit.setAttribute('width', Math.max(1, w - padL - padR)); hit.setAttribute('height', h);
      hit.setAttribute('fill', 'transparent');
      svg.appendChild(hit);

      wrap.innerHTML = '';
      wrap.appendChild(svg);
      var tip = U.el('div', { class: 'chart-tip' });
      wrap.appendChild(tip);

      function show(e) {
        var rect = svg.getBoundingClientRect();
        var px = (e.clientX - rect.left) * (w / (rect.width || w));
        var idx = step ? Math.round((px - padL) / step) : 0;
        idx = U.clamp(idx, 0, n - 1);
        var p = points[idx];
        if (p.y == null || !isFinite(p.y)) { hide(); return; }
        hline.setAttribute('x1', X(idx)); hline.setAttribute('x2', X(idx));
        hdot.setAttribute('cx', X(idx)); hdot.setAttribute('cy', Y(p.y));
        hover.setAttribute('opacity', '1');
        tip.dataset.show = '1';
        tip.innerHTML = '<span>' + U.esc(U.fmtDateFull(p.x)) + '</span> · <b>' + U.num(p.y, dp) + ' ' + U.esc(unit) + '</b>';
        tip.style.left = X(idx) + 'px';
        tip.style.top = Y(p.y) + 'px';
      }
      function hide() { hover.setAttribute('opacity', '0'); tip.dataset.show = '0'; }

      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', hide);
    }

    draw();

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(U.debounce(draw, 120));
      ro.observe(wrap);
    } else {
      window.addEventListener('resize', U.debounce(draw, 200));
    }
  }

  /** 卡片里的迷你趋势线，无坐标轴。 */
  function sparkline(container, values, color) {
    if (!container) return;
    container.innerHTML = '';
    var vs = (values || []).filter(function (v) { return v != null && isFinite(v); });
    if (vs.length < 2) {
      container.appendChild(U.el('div', { class: 'chart__empty', text: vs.length ? '仅 1 个数据点' : '暂无趋势' }));
      return;
    }
    var w = Math.max(120, container.clientWidth || 200), h = 40, pad = 3;
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 1e-6) { hi = lo + 1; lo -= 1; }
    var n = values.length;
    var X = function (i) { return pad + i * ((w - pad * 2) / Math.max(1, n - 1)); };
    var Y = function (v) { return pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2); };

    var parts = [];
    var cur = [];
    values.forEach(function (v, i) {
      if (v == null || !isFinite(v)) { if (cur.length) { parts.push(cur); cur = []; } return; }
      cur.push(X(i).toFixed(1) + ',' + Y(v).toFixed(1));
    });
    if (cur.length) parts.push(cur);

    var d = parts.map(function (p) { return 'M' + p.join(' L'); }).join(' ');
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>' +
      '</svg>';
    container.innerHTML = svg;
  }

  MH.charts = { lineChart: lineChart, sparkline: sparkline };
})(window.MH = window.MH || {});
