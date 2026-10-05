/* 数据看板：四项指标各自的均值、趋势与图表。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var RANGES = [7, 14, 30];

  function render(root) {
    var prefs = MH.store.prefs.get();
    var days = prefs.rangeDays || 14;
    var records = MH.store.records.all();
    var ov = MH.stats.overview(records, days);

    root.innerHTML = '';

    /* 页头 */
    var rangeSel = el('select', { class: 'input', id: 'dashRange', style: 'width:auto' }, RANGES.map(function (d) {
      return el('option', { value: String(d), text: '近 ' + d + ' 天' });
    }));
    rangeSel.value = String(days);

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '看板' }),
        el('p', { class: 'page-desc', text: ov.daysWithData
          ? '区间 ' + U.fmtDateFull(ov.from) + ' – ' + U.fmtDateFull(ov.to) + '，共 ' + ov.entryCount + ' 条记录，覆盖 ' + ov.daysWithData + '/' + days + ' 天。全部数据只存在这台设备。'
          : '这段时间还没有记录。填上第一条，图表就会长出来。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        rangeSel,
        el('button', { class: 'btn btn--primary', type: 'button', id: 'dashNew', text: '记一笔' })
      ])
    ]));

    /* 指标卡 */
    var cards = el('div', { class: 'grid grid--4' });
    MH.metrics.list.forEach(function (m) {
      var s = ov.metrics[m.key];
      var dirMark = s.dir === 'up' ? '↑' : (s.dir === 'down' ? '↓' : '→');
      var colorDir = s.improve === true ? 'up' : (s.improve === false ? 'down' : 'flat');
      var trend = s.perWeek == null ? '数据不足'
        : (s.dir === 'flat' ? '基本持平' : dirMark + ' ' + U.num(Math.abs(s.perWeek), m.dp) + ' ' + m.unit + '/周');

      var card = el('div', { class: 'card metric-card', style: '--metric-color:' + m.color }, [
        el('div', { class: 'metric-card__top' }, [
          el('span', { class: 'dot' }),
          el('span', { class: 'metric-card__name', text: m.label }),
          el('span', { class: 'metric-card__unit', text: m.min + '–' + m.max + ' ' + m.unit })
        ]),
        el('div', { class: 'metric-card__value' }, [
          el('span', { class: 'metric-card__num', text: s.mean == null ? '—' : U.num(s.mean, m.dp) }),
          el('span', { class: 'metric-card__delta', dataset: { dir: colorDir }, text: trend })
        ]),
        el('div', { class: 'metric-card__meta' }, [
          el('span', { text: '最低 ' + (s.min == null ? '—' : U.num(s.min, m.dp)) }),
          el('span', { text: '最高 ' + (s.max == null ? '—' : U.num(s.max, m.dp)) }),
          el('span', { text: '最近 ' + (s.latest == null ? '—' : U.num(s.latest, m.dp)) })
        ]),
        el('div', { class: 'metric-card__spark', id: 'spark-' + m.key })
      ]);
      cards.appendChild(card);
    });
    root.appendChild(cards);

    /* 图表 */
    root.appendChild(el('h2', { class: 'section__title', style: 'margin-top:26px', text: '趋势' }));
    var chartGrid = el('div', { class: 'grid grid--2' });
    MH.metrics.list.forEach(function (m) {
      var s = ov.metrics[m.key];
      var host = el('div', { id: 'chart-' + m.key });
      var card = el('div', { class: 'card', style: '--metric-color:' + m.color }, [
        el('div', { class: 'card__head' }, [
          el('span', { class: 'dot' }),
          el('span', { class: 'card__title', text: m.label }),
          el('span', { class: 'badge', text: '均值 ' + (s.mean == null ? '—' : U.num(s.mean, m.dp) + ' ' + m.unit) })
        ]),
        host
      ]);
      chartGrid.appendChild(card);
    });
    root.appendChild(chartGrid);

    /* 最近记录 / 空态 */
    root.appendChild(el('h2', { class: 'section__title', style: 'margin-top:26px', text: '最近记录' }));
    if (!records.length) {
      root.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, [
          el('div', { html: '<svg viewBox="0 0 48 48" width="40" height="40" fill="none"><path d="M8 30c5 0 5-12 10-12s5 12 10 12 5-8 8-11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><rect x="6" y="6" width="36" height="36" rx="10" stroke="currentColor" stroke-width="2"/></svg>' }),
          el('p', { class: 'empty__title', text: '还没有任何记录' }),
          el('p', { class: 'small', text: '新增第一条后，四项指标的均值与趋势会立刻出现。' }),
          el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [
            el('button', { class: 'btn btn--primary', type: 'button', id: 'emptyNew', text: '新增第一条记录' }),
            el('button', { class: 'btn btn--ghost', type: 'button', id: 'emptyDemo', text: '生成示例数据' })
          ])
        ])
      ]));
    } else {
      root.appendChild(recentList(records.slice(-5).reverse()));
    }

    /* 边界提示 */
    root.appendChild(el('div', { class: 'notice', style: 'margin-top:20px', html:
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 11v6m0-9h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<span>存储边界：以上数据仅写入本设备浏览器的 localStorage，不上传、不同步、无账号。换设备、换浏览器或清理站点数据都会丢失记录，建议定期在「设置」里导出备份。MoodHub 不是诊断工具，仅供自我觉察与温和引导。</span>' }));

    bind(root, ov);
    paint(ov, days);
  }

  function recentList(list) {
    var wrap = el('div', { class: 'card' });
    if (!list.length) {
      wrap.appendChild(el('div', { class: 'empty', text: '这段时间没有记录' }));
      return wrap;
    }
    var table = el('table', { class: 'data' });
    var head = el('tr', {}, [el('th', { text: '日期' })]);
    MH.metrics.list.forEach(function (m) { head.appendChild(el('th', { class: 'num', text: m.label })); });
    head.appendChild(el('th', { text: '备注' }));
    head.appendChild(el('th', { class: 'num', text: '操作' }));
    table.appendChild(el('thead', {}, [head]));

    var body = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {}, [el('td', { class: 'cell-date', text: U.fmtDateFull(r.date) + (r.time ? ' ' + r.time : '') })]);
      MH.metrics.list.forEach(function (m) {
        tr.appendChild(el('td', { class: 'num' }, [
          el('span', { class: 'pill', style: 'background:color-mix(in srgb, ' + m.color + ' 16%, transparent);color:' + m.color, text: r[m.key] == null ? '—' : U.num(r[m.key], m.dp) })
        ]));
      });
      tr.appendChild(el('td', { class: 'cell-note', text: r.note || '—' }));
      var btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '编辑' });
      btn.addEventListener('click', function () { MH.views.records.openEditor(r.id); });
      tr.appendChild(el('td', { class: 'num' }, [btn]));
      body.appendChild(tr);
    });
    table.appendChild(body);
    var w = el('div', { class: 'table-wrap' }, [table]);
    wrap.appendChild(w);
    return wrap;
  }

  function paint(ov, days) {
    MH.metrics.list.forEach(function (m) {
      var s = ov.metrics[m.key];
      var spark = document.getElementById('spark-' + m.key);
      if (spark) MH.charts.sparkline(spark, ov.series.map(function (p) { return p[m.key]; }), m.color);

      var host = document.getElementById('chart-' + m.key);
      if (host) {
        MH.charts.lineChart(host, {
          points: ov.series.map(function (p) { return { x: p.date, y: p[m.key] }; }),
          color: m.color,
          unit: m.unit,
          label: m.label,
          dp: m.dp,
          min: m.min,
          max: m.max,
          height: 190,
          emptyText: '近 ' + days + ' 天没有' + m.label + '记录'
        });
      }
    });
  }

  function bind(root, ov) {
    var rangeSel = U.$('#dashRange', root);
    if (rangeSel) rangeSel.addEventListener('change', function () {
      MH.store.prefs.set({ rangeDays: Number(rangeSel.value) });
      MH.app.go('dashboard');
    });

    var nw = U.$('#dashNew', root);
    if (nw) nw.addEventListener('click', function () { MH.views.records.openEditor(null); });
    var en = U.$('#emptyNew', root);
    if (en) en.addEventListener('click', function () { MH.views.records.openEditor(null); });
    var demo = U.$('#emptyDemo', root);
    if (demo) demo.addEventListener('click', function () {
      MH.store.records.save(MH.demoData());
      U.toast('已生成 21 天示例数据（仅保存在本机）', 'ok');
      MH.app.go('dashboard');
    });
  }

  MH.views = MH.views || {};
  MH.views.dashboard = { render: render };
})(window.MH = window.MH || {});
