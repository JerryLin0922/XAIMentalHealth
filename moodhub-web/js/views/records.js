/* 记录列表：筛选、排序、分页式展示；以及新增 / 修改记录的表单弹窗。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var SORTS = [
    { value: 'date|desc', text: '日期：新 → 旧' },
    { value: 'date|asc', text: '日期：旧 → 新' },
    { value: 'mood|desc', text: '心情：高 → 低' },
    { value: 'mood|asc', text: '心情：低 → 高' },
    { value: 'sleep|desc', text: '睡眠：长 → 短' },
    { value: 'sleep|asc', text: '睡眠：短 → 长' },
    { value: 'heartRate|desc', text: '心率：高 → 低' },
    { value: 'heartRate|asc', text: '心率：低 → 高' },
    { value: 'stress|desc', text: '压力：高 → 低' },
    { value: 'stress|asc', text: '压力：低 → 高' }
  ];

  var state = {
    from: '', to: '',
    moodOp: '', moodVal: '',
    stressOp: '', stressVal: '',
    sleepMin: '', hrMax: '',
    keyword: '',
    sort: 'date|desc',
    editingId: null
  };

  function render(root) {
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '记录' }),
        el('p', { class: 'page-desc', text: '按时间或指标维度翻检历史。所有筛选都在这台设备上完成，不会发出任何请求。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('button', { class: 'btn btn--primary', type: 'button', id: 'recNew', text: '新增记录' })
      ])
    ]));

    root.appendChild(filterCard());
    root.appendChild(el('div', { id: 'recResults' }));

    U.$('#recNew', root).addEventListener('click', function () { openEditor(null); });
    bindFilters(root);
    refresh();
  }

  function filterCard() {
    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '筛选与排序' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'recReset', text: '重置' })
      ])
    ]);

    var grid = el('div', { class: 'filters' });
    grid.appendChild(field('起始日期', el('input', { class: 'input', type: 'date', id: 'fFrom', value: state.from })));
    grid.appendChild(field('结束日期', el('input', { class: 'input', type: 'date', id: 'fTo', value: state.to })));

    grid.appendChild(field('心情', el('div', { class: 'row', style: 'gap:6px' }, [
      opSelect('fMoodOp', state.moodOp),
      numSelect('fMoodVal', 1, 5, state.moodVal)
    ])));
    grid.appendChild(field('压力', el('div', { class: 'row', style: 'gap:6px' }, [
      opSelect('fStressOp', state.stressOp),
      numSelect('fStressVal', 0, 10, state.stressVal)
    ])));

    grid.appendChild(field('睡眠 ≥（小时）', el('input', { class: 'input', type: 'number', id: 'fSleepMin', step: '0.5', min: '0', max: '16', value: state.sleepMin, placeholder: '不限' })));
    grid.appendChild(field('心率 ≤（bpm）', el('input', { class: 'input', type: 'number', id: 'fHrMax', step: '1', min: '30', max: '200', value: state.hrMax, placeholder: '不限' })));

    grid.appendChild(field('备注关键词', el('input', { class: 'input', type: 'search', id: 'fKeyword', value: state.keyword, placeholder: '如：加班、跑步' })));

    var sortSel = el('select', { class: 'input', id: 'fSort' }, SORTS.map(function (s) {
      return el('option', { value: s.value, text: s.text });
    }));
    sortSel.value = state.sort;
    grid.appendChild(field('排序', sortSel));

    card.appendChild(grid);
    return card;
  }

  function field(labelText, control) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'label', text: labelText }),
      control
    ]);
  }

  function opSelect(id, value) {
    var s = el('select', { class: 'input', style: 'width:64px;padding-left:8px;padding-right:8px' }, [
      el('option', { value: '', text: '不限' }),
      el('option', { value: 'gte', text: '≥' }),
      el('option', { value: 'lte', text: '≤' })
    ]);
    s.value = value || '';
    s.id = id;
    return s;
  }

  function numSelect(id, lo, hi, value) {
    var opts = [el('option', { value: '', text: '—' })];
    for (var i = lo; i <= hi; i++) opts.push(el('option', { value: String(i), text: String(i) }));
    var s = el('select', { class: 'input', style: 'width:72px;flex:1' }, opts);
    s.value = value || '';
    s.id = id;
    return s;
  }

  function bindFilters(root) {
    var map = {
      fFrom: 'from', fTo: 'to', fMoodOp: 'moodOp', fMoodVal: 'moodVal',
      fStressOp: 'stressOp', fStressVal: 'stressVal',
      fSleepMin: 'sleepMin', fHrMax: 'hrMax', fKeyword: 'keyword', fSort: 'sort'
    };
    Object.keys(map).forEach(function (id) {
      var node = U.$('#' + id, root);
      if (!node) return;
      var evt = node.tagName === 'SELECT' ? 'change' : 'input';
      node.addEventListener(evt, U.debounce(function () { state[map[id]] = node.value; refresh(); }, 180));
    });

    U.$('#recReset', root).addEventListener('click', function () {
      state.from = state.to = state.moodOp = state.moodVal = '';
      state.stressOp = state.stressVal = state.sleepMin = state.hrMax = state.keyword = '';
      state.sort = 'date|desc';
      MH.app.go('records');
    });
  }

  function applyFilters(list) {
    return list.filter(function (r) {
      if (state.from && r.date < state.from) return false;
      if (state.to && r.date > state.to) return false;
      if (state.moodOp && state.moodVal !== '' && r.mood != null) {
        if (state.moodOp === 'gte' && !(r.mood >= Number(state.moodVal))) return false;
        if (state.moodOp === 'lte' && !(r.mood <= Number(state.moodVal))) return false;
      } else if (state.moodOp && state.moodVal !== '' && r.mood == null) return false;
      if (state.stressOp && state.stressVal !== '' && r.stress != null) {
        if (state.stressOp === 'gte' && !(r.stress >= Number(state.stressVal))) return false;
        if (state.stressOp === 'lte' && !(r.stress <= Number(state.stressVal))) return false;
      } else if (state.stressOp && state.stressVal !== '' && r.stress == null) return false;
      if (state.sleepMin !== '' && (r.sleep == null || !(r.sleep >= Number(state.sleepMin)))) return false;
      if (state.hrMax !== '' && (r.heartRate == null || !(r.heartRate <= Number(state.hrMax)))) return false;
      if (state.keyword && (r.note || '').toLowerCase().indexOf(state.keyword.toLowerCase()) < 0) return false;
      return true;
    });
  }

  function applySort(list) {
    var parts = state.sort.split('|');
    var key = parts[0], dir = parts[1] === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      if (key === 'date') {
        if (a.date === b.date) return ((a.createdAt || 0) - (b.createdAt || 0)) * (dir === 1 ? 1 : -1) * -1;
        return a.date < b.date ? -dir : (a.date > b.date ? dir : 0);
      }
      var av = a[key], bv = b[key];
      if (av == null && bv == null) return a.date < b.date ? dir : -dir;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return a.date < b.date ? dir : -dir;
      return av < bv ? -dir : dir;
    });
  }

  function refresh() {
    var host = document.getElementById('recResults');
    if (!host) return;
    host.innerHTML = '';

    var all = MH.store.records.all();
    var list = applySort(applyFilters(all));

    host.appendChild(el('div', { class: 'results-bar' }, [
      el('span', { text: '共 ' + list.length + ' 条' + (list.length !== all.length ? '（全部 ' + all.length + ' 条）' : '') }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted small', text: '点击表头可切换排序' })
    ]));

    if (!list.length) {
      var empty = el('div', { class: 'card' }, [
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty__title', text: all.length ? '没有符合条件的记录' : '还没有记录' }),
          el('p', { class: 'small', text: all.length ? '试着放宽筛选条件，或点「重置」。' : '点右上角「新增记录」开始。' }),
          all.length ? null : el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [
            el('button', { class: 'btn btn--primary', type: 'button', text: '新增记录', onclick: function () { openEditor(null); } }),
            el('button', { class: 'btn btn--ghost', type: 'button', text: '生成示例数据', onclick: function () {
              MH.store.records.save(MH.demoData());
              U.toast('已生成 21 天示例数据（仅保存在本机）', 'ok');
              refresh();
            } })
          ])
        ])
      ]);
      host.appendChild(empty);
      return;
    }

    var card = el('div', { class: 'card' });
    var head = el('tr', {}, [
      sortableTh('日期', 'date'),
      sortableTh('心情', 'mood'),
      sortableTh('睡眠', 'sleep'),
      sortableTh('心率', 'heartRate'),
      sortableTh('压力', 'stress'),
      el('th', { text: '备注' }),
      el('th', { class: 'num', text: '操作' })
    ]);
    var table = el('table', { class: 'data' }, [el('thead', {}, [head])]);
    var body = el('tbody');

    list.forEach(function (r) {
      var tr = el('tr', {}, [el('td', { class: 'cell-date', text: U.fmtDateFull(r.date) + (r.time ? ' ' + r.time : '') })]);
      MH.metrics.list.forEach(function (m) {
        tr.appendChild(el('td', { class: 'num' }, [
          el('span', { class: 'pill', style: 'background:color-mix(in srgb, ' + m.color + ' 16%, transparent);color:' + m.color, text: r[m.key] == null ? '—' : U.num(r[m.key], m.dp) })
        ]));
      });
      tr.appendChild(el('td', { class: 'cell-note', title: r.note || '', text: r.note || '—' }));

      var edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '编辑' });
      edit.addEventListener('click', function () { openEditor(r.id); });
      var del = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: '删除' });
      del.addEventListener('click', function () {
        MH.app.confirm({
          title: '删除记录',
          body: '删除 ' + U.fmtDateFull(r.date) + ' 的这条记录？此操作无法撤销。',
          confirmText: '删除', danger: true
        }).then(function (yes) {
          if (!yes) return;
          MH.store.records.remove(r.id);
          U.toast('已删除该记录', 'ok');
          refresh();
        });
      });
      tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [edit, del])]));
      body.appendChild(tr);
    });

    table.appendChild(body);
    card.appendChild(el('div', { class: 'table-wrap' }, [table]));
    host.appendChild(card);
  }

  function sortableTh(text, key) {
    var parts = state.sort.split('|');
    var active = parts[0] === key;
    var arrow = active ? (parts[1] === 'asc' ? '↑' : '↓') : '↕';
    var th = el('th', { class: 'sortable num', dataset: { active: active ? '1' : '0' }, title: '按' + text + '排序' }, [
      document.createTextNode(text),
      el('span', { class: 'arrow', text: arrow })
    ]);
    th.addEventListener('click', function () {
      var cur = state.sort.split('|');
      var dir = cur[0] === key ? (cur[1] === 'desc' ? 'asc' : 'desc') : 'desc';
      state.sort = key + '|' + dir;
      var sel = document.getElementById('fSort');
      if (sel) sel.value = ['date', 'mood', 'sleep', 'heartRate', 'stress'].indexOf(key) >= 0 ? (key + '|' + dir) : 'date|desc';
      refresh();
    });
    return th;
  }

  /* ============================ 编辑弹窗 ============================ */

  var modalEl, formEl, titleEl, deleteBtn, summaryEl, fieldsHost;

  function ensureRefs() {
    modalEl = document.getElementById('modalEditor');
    formEl = document.getElementById('editorForm');
    titleEl = document.getElementById('editorTitle');
    deleteBtn = document.getElementById('btnDeleteRecord');
    summaryEl = document.getElementById('editorSummary');
    fieldsHost = document.getElementById('metricFields');
    buildMetricFields();
  }

  function buildMetricFields() {
    if (!fieldsHost || fieldsHost.dataset.built === '1') return;
    fieldsHost.innerHTML = '';
    MH.metrics.list.forEach(function (m) {
      var range = el('input', { class: 'range', type: 'range', id: 'r-' + m.key, min: String(m.min), max: String(m.max), step: String(m.step) });
      var numIn = el('input', { class: 'input num-input', type: 'number', id: 'f-' + m.key, min: String(m.min), max: String(m.max), step: String(m.step) });

      function sync(src) {
        var v = src === 'range' ? range.value : numIn.value;
        if (v === '') return;
        v = U.clamp(Number(v), m.min, m.max);
        if (src === 'range') numIn.value = String(v); else range.value = String(v);
        clearFieldError(m.key);
      }
      range.addEventListener('input', function () { sync('range'); });
      numIn.addEventListener('input', function () { sync('number'); });

      var wrap = el('div', { class: 'field', style: '--metric-color:' + m.color }, [
        el('label', { class: 'label', for: 'f-' + m.key, html: U.esc(m.label) + ' <span class="label__opt">' + m.min + '–' + m.max + ' ' + U.esc(m.unit) + '</span>' }),
        el('div', { class: 'range-row' }, [range, numIn]),
        el('p', { class: 'hint', text: m.hint }),
        el('p', { class: 'error', id: 'err-' + m.key, hidden: true })
      ]);
      fieldsHost.appendChild(wrap);
    });
    fieldsHost.dataset.built = '1';
  }

  function clearFieldError(key) {
    var e = document.getElementById('err-' + key);
    if (e) { e.hidden = true; e.textContent = ''; }
    var i = document.getElementById('f-' + key);
    if (i) i.removeAttribute('aria-invalid');
  }

  function setFieldError(key, msg) {
    var e = document.getElementById('err-' + key);
    var i = document.getElementById('f-' + key);
    if (e) { e.textContent = msg; e.hidden = false; }
    if (i) i.setAttribute('aria-invalid', 'true');
  }

  function clearAllErrors() {
    ['date', 'time', 'note'].concat(MH.metrics.list.map(function (m) { return m.key; })).forEach(function (k) {
      var e = document.getElementById('err-' + k);
      if (e) { e.hidden = true; e.textContent = ''; }
      var i = document.getElementById('f-' + k);
      if (i && i.tagName === 'INPUT') i.removeAttribute('aria-invalid');
    });
  }

  function openEditor(id) {
    if (!modalEl) ensureRefs();
    clearAllErrors();
    state.editingId = id || null;

    var rec = id ? MH.store.records.get(id) : null;
    titleEl.textContent = rec ? '修改记录' : '新增记录';
    deleteBtn.hidden = !rec;
    summaryEl.hidden = !rec;

    document.getElementById('fDate').value = rec ? rec.date : U.todayISO();
    document.getElementById('fTime').value = rec ? (rec.time || '') : '';
    document.getElementById('fNote').value = rec ? (rec.note || '') : '';
    updateNoteCount();

    MH.metrics.list.forEach(function (m) {
      var v = rec ? rec[m.key] : Math.round((m.min + m.max) / 2 / m.step) * m.step;
      if (v == null) v = '';
      document.getElementById('f-' + m.key).value = v === '' ? '' : String(v);
      document.getElementById('r-' + m.key).value = v === '' ? String(m.min) : String(v);
    });

    if (rec) {
      summaryEl.textContent = '创建于 ' + U.fmtDateTime(rec.createdAt) + '，最后修改 ' + U.fmtDateTime(rec.updatedAt) + '。修改只影响本机这份副本。';
    }

    modalEl.hidden = false;
    setTimeout(function () { document.getElementById('fDate').focus(); }, 40);
  }

  function closeEditor() {
    if (modalEl) modalEl.hidden = true;
    state.editingId = null;
  }

  function updateNoteCount() {
    var n = document.getElementById('fNote');
    var c = document.getElementById('noteCount');
    if (n && c) c.textContent = String(n.value.length);
  }

  function collectForm() {
    var input = {
      date: document.getElementById('fDate').value,
      time: document.getElementById('fTime').value,
      note: document.getElementById('fNote').value
    };
    MH.metrics.list.forEach(function (m) {
      input[m.key] = document.getElementById('f-' + m.key).value;
    });
    return input;
  }

  function submitEditor(e) {
    e.preventDefault();
    clearAllErrors();
    var result = MH.metrics.validate(collectForm());
    if (!result.ok) {
      Object.keys(result.errors).forEach(function (k) { setFieldError(k, result.errors[k]); });
      var firstKey = Object.keys(result.errors)[0];
      var node = document.getElementById('f-' + firstKey);
      if (node) node.focus();
      U.toast('还有 ' + Object.keys(result.errors).length + ' 处需要修改', 'error');
      return;
    }

    var btn = document.getElementById('btnSaveRecord');
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '保存中…';

    setTimeout(function () {
      var ok;
      if (state.editingId) {
        ok = MH.store.records.update(state.editingId, result.values);
        if (ok) U.toast('已保存修改（' + U.fmtDateFull(result.values.date) + '）', 'ok');
      } else {
        ok = MH.store.records.add(result.values);
        if (ok) U.toast('已新增 ' + U.fmtDateFull(result.values.date) + ' 的记录', 'ok');
      }
      btn.disabled = false;
      btn.textContent = label;
      if (!ok) { U.toast('保存失败，本机存储可能不可用', 'error'); return; }
      closeEditor();
      MH.app.refreshCurrent();
    }, 120);
  }

  function initEditor() {
    ensureRefs();
    formEl.addEventListener('submit', submitEditor);
    document.getElementById('fNote').addEventListener('input', updateNoteCount);
    deleteBtn.addEventListener('click', function () {
      if (!state.editingId) return;
      var rec = MH.store.records.get(state.editingId);
      if (!rec) return;
      MH.app.confirm({
        title: '删除记录',
        body: '删除 ' + U.fmtDateFull(rec.date) + ' 的这条记录？此操作无法撤销。',
        confirmText: '删除', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.records.remove(state.editingId);
        U.toast('已删除该记录', 'ok');
        closeEditor();
        MH.app.refreshCurrent();
      });
    });
    U.$$('#modalEditor [data-close]').forEach(function (n) {
      n.addEventListener('click', closeEditor);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeEditor();
    });
  }

  MH.views = MH.views || {};
  MH.views.records = {
    render: render,
    refresh: refresh,
    openEditor: openEditor,
    closeEditor: closeEditor,
    initEditor: initEditor
  };
})(window.MH = window.MH || {});
