/* 导入页：选择来源 → 预览与字段映射 → 清洗设置 → 进度 → 结果反馈。
   所有文件只经 FileReader 读进内存，不做任何上传。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var STEPS = [
    { id: 1, label: '选择来源' },
    { id: 2, label: '字段映射' },
    { id: 3, label: '清洗与去重' },
    { id: 4, label: '导入进度' },
    { id: 5, label: '结果' }
  ];

  var ui = {
    step: 1,
    profileId: 'auto',
    files: [],          // {id, name, size, file}
    inspected: [],      // 解析结果
    activeFile: 0,
    options: null,
    busyParsing: false,
    running: false,
    progress: { percent: 0, phase: '', label: '', processed: 0, total: 0 },
    cancelToken: null,
    report: null,
    error: null
  };

  function resetOptions() { ui.options = MH.healthImport.defaultOptions(); }
  if (!ui.options) resetOptions();

  /* ============================ 小工具 ============================ */

  function currentSlot() {
    var entry = ui.inspected[ui.activeFile];
    if (!entry || entry.error) return null;
    var slot = entry.tables[entry.tableIndex];
    return slot ? { entry: entry, slot: slot } : null;
  }

  function columnOptions(slot) {
    return [{ value: '', text: '（不使用）' }].concat(slot.mapping.columns.map(function (c) {
      return { value: c.name, text: c.name + (c.count ? '（' + c.count + ' 个值）' : '') };
    }));
  }

  function makeSelect(id, value, options, onChange, extra) {
    var sel = el('select', { class: 'input ' + (extra || ''), id: id, style: 'width:auto;min-width:160px' });
    options.forEach(function (o) {
      sel.appendChild(el('option', { value: o.value, text: o.text }));
    });
    sel.value = value == null ? '' : value;
    sel.addEventListener('change', onChange);
    return sel;
  }

  function conflictLabel(id) {
    var hit = null;
    MH.healthImport.conflicts.forEach(function (c) { if (c.id === id) hit = c; });
    return hit ? hit.label : id;
  }

  /* ============================ 第一步：选择来源 ============================ */

  function renderStep1(host) {
    // 厂商卡片
    var grid = el('div', { class: 'vendor-grid' });
    MH.importVendors.profiles().forEach(function (p) {
      if (p.id === 'generic') return;
      var active = ui.profileId === p.id;
      var card = el('button', {
        class: 'vendor-card' + (active ? ' is-active' : ''),
        type: 'button',
        'aria-pressed': active ? 'true' : 'false'
      }, [
        el('div', { class: 'vendor-card__head' }, [
          el('b', { text: p.name }),
          el('span', { class: 'badge', text: p.platform })
        ]),
        el('p', { class: 'vendor-card__desc', text: p.formats.join(' / ').toUpperCase() }),
        el('p', { class: 'vendor-card__guide', text: p.guide })
      ]);
      card.addEventListener('click', function () {
        ui.profileId = active ? 'auto' : p.id;
        render(document.getElementById('view-import'));
      });
      grid.appendChild(card);
    });

    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '数据来自哪里？' }),
        el('span', { class: 'badge', text: ui.profileId === 'auto' ? '自动识别' : MH.importVendors.profile(ui.profileId).name })
      ]),
      el('p', { class: 'hint', text: '选一下来源能让字段识别更准；不选也没关系，会按通用表格处理。下面的说明告诉你去哪儿导出。' }),
      grid
    ]));

    // 文件选择
    var fileInput = el('input', {
      type: 'file', id: 'impFile', multiple: true,
      accept: MH.importFormats.ACCEPT, style: 'display:none'
    });
    var drop = el('div', { class: 'dropzone', id: 'impDrop', tabindex: '0', role: 'button', 'aria-label': '选择或拖入健康数据文件' }, [
      el('div', { html: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
      el('p', { text: '把导出的 CSV / Excel / JSON / XML / ZIP 拖到这里，或点击选择' }),
      el('p', { class: 'hint', text: '单个文件 ≤ ' + Math.round(MH.importFormats.MAX_BYTES / 1048576) + ' MB · 全程本地读取，不上传' })
    ]);

    var listBox = el('div', { class: 'imp-files' });
    if (!ui.files.length) {
      listBox.appendChild(el('p', { class: 'hint', text: '还没有选择文件。' }));
    } else {
      ui.files.forEach(function (f, index) {
        var row = el('div', { class: 'imp-file' }, [
          el('span', { class: 'dot', style: 'background:var(--accent);width:8px;height:8px;border-radius:50%' }),
          el('b', { text: f.name }),
          el('span', { class: 'src-item__meta', text: ' · ' + Math.max(1, Math.round(f.size / 1024)) + ' KB' }),
          el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '移除' })
        ]);
        U.$$('button', row)[0].addEventListener('click', function () {
          ui.files.splice(index, 1);
          render(document.getElementById('view-import'));
        });
        listBox.appendChild(row);
      });
    }

    var nextBtn = el('button', {
      class: 'btn btn--primary', type: 'button', id: 'impParse',
      text: ui.busyParsing ? '解析中…' : ('解析文件（' + ui.files.length + '）'),
      disabled: !ui.files.length || ui.busyParsing
    });
    nextBtn.addEventListener('click', parseFiles);

    host.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '选择文件' }),
        el('span', { class: 'badge', text: MH.importFormats.ACCEPT.replace(/\./g, '').replace(/,/g, ' / ').toUpperCase() })
      ]),
      drop,
      fileInput,
      listBox,
      el('div', { class: 'row', style: 'margin-top:14px' }, [el('span', { class: 'spacer' }), nextBtn])
    ]));

    bindDrop(drop, fileInput);
    host.appendChild(privacyNotice());
  }

  function privacyNotice() {
    return el('div', { class: 'notice', style: 'margin-top:16px', html:
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>' +
      '<span>隐私边界：文件经 FileReader 直接读进这台设备的内存，解析、清洗、去重全部在本地完成，原始表格不会写进 localStorage，也不会走任何网络请求。只有转换后的四项指标与可选备注会存进你的记录。</span>' });
  }

  function bindDrop(drop, fileInput) {
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) acceptFiles(files);
    });
    fileInput.addEventListener('change', function () {
      if (this.files && this.files.length) acceptFiles(this.files);
      this.value = '';
    });
  }

  function acceptFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList);
    var rejected = [];
    arr.forEach(function (f) {
      if (!MH.importFormats.isAcceptable(f.name)) { rejected.push(f.name); return; }
      if (f.size > MH.importFormats.MAX_BYTES) { U.toast('「' + f.name + '」超过大小上限', 'warn', 4000); return; }
      ui.files.push({ id: U.uid(), name: f.name, size: f.size, file: f });
    });
    if (rejected.length) {
      U.toast('不支持的文件类型：' + rejected.join('、'), 'warn', 4000);
    }
    ui.inspected = [];
    ui.report = null;
    ui.activeFile = 0;
    render(document.getElementById('view-import'));
  }

  function parseFiles() {
    if (ui.busyParsing || !ui.files.length) return;
    ui.busyParsing = true;
    ui.report = null;
    renderStepIndicator();

    var chain = Promise.resolve();
    var results = [];
    ui.files.forEach(function (f) {
      chain = chain.then(function () {
        return MH.importFormats.readAsBytes(f.file)
          .then(function (loaded) {
            return MH.healthImport.inspect({
              name: loaded.name,
              size: loaded.size,
              bytes: loaded.bytes,
              profileId: ui.profileId,
              options: ui.options
            }).then(function (res) {
              results.push({
                id: f.id,
                name: res.name,
                size: res.size,
                kind: res.kind,
                detection: res.detection,
                rawDetection: res.rawDetection,
                skipped: res.skipped,
                warnings: res.warnings,
                tableIndex: 0,
                tables: res.tables.map(function (t) {
                  return {
                    table: t.table,
                    profileId: res.detection.id,
                    overrides: { date: '', time: '', metrics: {}, aux: {} },
                    mapping: t.mapping
                  };
                })
              });
            }, function (e) {
              results.push({ id: f.id, name: f.name, size: f.size, error: { message: e && e.message ? e.message : String(e), hint: e && e.hint ? e.hint : '' } });
            });
          }, function (e) {
            results.push({ id: f.id, name: f.name, size: f.size, error: { message: e && e.message ? e.message : String(e), hint: e && e.hint ? e.hint : '' } });
          });
      });
    });

    chain.then(function () {
      ui.inspected = results;
      ui.activeFile = 0;
      ui.busyParsing = false;
      var failed = results.filter(function (r) { return r.error; }).length;
      if (failed) U.toast(failed + ' 个文件解析失败，已在页面上标出', 'warn', 4200);
      ui.step = 2;
      render(document.getElementById('view-import'));
    });
  }

  /* ============================ 第二步：预览与映射 ============================ */

  function renderStep2(host) {
    if (!ui.inspected.length) { host.appendChild(emptyCard('先回到第一步选择文件')); return; }

    // 文件切换
    if (ui.inspected.length > 1) {
      var tabs = el('div', { class: 'row', style: 'margin-bottom:12px' });
      ui.inspected.forEach(function (entry, index) {
        var btn = el('button', {
          class: 'btn btn--sm ' + (index === ui.activeFile ? 'btn--primary' : 'btn--ghost'),
          type: 'button',
          text: (entry.error ? '⚠ ' : '') + entry.name
        });
        btn.addEventListener('click', function () { ui.activeFile = index; render(document.getElementById('view-import')); });
        tabs.appendChild(btn);
      });
      host.appendChild(tabs);
    }

    var current = ui.inspected[ui.activeFile];
    if (!current) { host.appendChild(emptyCard('这个文件已经被移除了')); return; }
    if (current.error) {
      host.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'notice notice--danger', style: 'margin-bottom:12px', html:
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M12 7v6m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<span>' + U.esc(current.error.message) + (current.error.hint ? '　' + U.esc(current.error.hint) : '') + '</span>' }),
        el('div', { class: 'row' }, [
          el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn--ghost', type: 'button', text: '返回重选' })
        ])
      ]));
      U.$$('button', host)[0].addEventListener('click', function () { ui.step = 1; render(document.getElementById('view-import')); });
      return;
    }

    var slot = current.tables[current.tableIndex];
    var mapping = slot.mapping;

    // 来源识别
    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '识别结果' }),
        el('span', { class: 'badge', text: current.kind.toUpperCase() })
      ]),
      el('div', { class: 'kv' }, [
        el('div', { class: 'kv__k', text: '来源' }),
        el('div', { class: 'kv__v', text: (current.detection && current.detection.id !== 'generic')
          ? current.detection.name + '（依据：' + (current.detection.reasons || []).join('；') + '）'
          : '未匹配到具体厂商，按通用表格处理' }),
        el('div', { class: 'kv__k', text: '数据表' }),
        el('div', { class: 'kv__v' }, [tableSelect(current, slot)]),
        el('div', { class: 'kv__k', text: '规模' }),
        el('div', { class: 'kv__v', text: slot.table.rows.length + ' 行 · ' + slot.table.headers.length + ' 列' })
      ]),
      profileSelect(current, slot),
      current.tables.length > 1 ? allTablesCheck(current) : null
    ]));

    host.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '字段映射' }),
        el('span', { class: 'badge', text: '识别到 ' + mapping.matchedCount + ' 项指标' })
      ]),
      el('div', { id: 'impMapBody' })
    ]));
    renderMapBody();

    var preview = el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '原始预览' }),
        el('span', { class: 'badge', text: '前 6 行原样展示' })
      ]),
      prePreview(current, slot)
    ]);
    host.appendChild(preview);

    host.appendChild(el('div', { class: 'card section' }, [warningList(ui.inspected[ui.activeFile])]));

    var back = el('button', { class: 'btn btn--ghost', type: 'button', id: 'impBack1', text: '上一步' });
    back.addEventListener('click', function () { ui.step = 1; render(document.getElementById('view-import')); });
    var next = el('button', { class: 'btn btn--primary', type: 'button', id: 'impNext3', text: '下一步：清洗与去重' });
    next.addEventListener('click', function () {
      if (!readyToImport()) return;
      ui.step = 3;
      render(document.getElementById('view-import'));
    });
    host.appendChild(el('div', { class: 'row', style: 'margin-top:16px' }, [back, el('span', { class: 'spacer' }), next]));
  }

  function tableSelect(entry, slot) {
    if (entry.tables.length < 2) return slot.table.label || entry.name;
    var sel = makeSelect('impTableSel', String(entry.tableIndex), entry.tables.map(function (t, i) {
      return { value: String(i), text: (t.table.label || ('表 ' + (i + 1))) + '（' + t.table.rows.length + ' 行）' };
    }), function () {
      entry.tableIndex = Number(this.value);
      render(document.getElementById('view-import'));
    });
    return sel;
  }

  /** ZIP / 多工作表文件：可以选择把里面的表都导进来，各表独立识别字段后按日期合并。 */
  function allTablesCheck(entry) {
    if (entry.useAllTables == null) entry.useAllTables = true;
    var check = el('label', { class: 'check', style: 'margin-top:12px' }, [
      el('input', { type: 'checkbox', id: 'impAllTables', checked: entry.useAllTables }),
      el('span', { text: '同时导入这个文件里的全部 ' + entry.tables.length + ' 张表（各自识别字段，再按日期合成一条记录）' })
    ]);
    U.$('#impAllTables', check).addEventListener('change', function () { entry.useAllTables = this.checked; });
    return check;
  }

  function profileSelect(entry, slot) {
    var options = [{ value: 'auto', text: '自动识别' }].concat((entry.rawDetection || MH.importVendors.profiles()).map(function (d) {
      return { value: d.id, text: d.name + '（匹配度 ' + d.score + '）' };
    }));
    var sel = makeSelect('impProfileSel', slot.profileId || 'generic', options, function () {
      slot.profileId = this.value === 'auto' ? (entry.detection ? entry.detection.id : 'generic') : this.value;
      remap();
    });
    return el('div', { class: 'field', style: 'margin-top:14px' }, [
      el('label', { class: 'label', for: 'impProfileSel', html: '按哪个厂商的列名规则解析 <span class="label__opt">识别错了可以在这里改</span>' }),
      sel
    ]);
  }

  function buildOverrides(slot) {
    return {
      date: slot.overrides.date,
      time: slot.overrides.time,
      metrics: slot.overrides.metrics,
      aux: slot.overrides.aux
    };
  }

  function remap() {
    var cur = currentSlot();
    if (!cur) return;
    cur.slot.mapping = MH.importVendors.map(cur.slot.table, cur.slot.profileId, buildOverrides(cur.slot));
    renderMapBody();
  }

  function renderMapBody() {
    var host = document.getElementById('impMapBody');
    if (!host) return;
    var cur = currentSlot();
    if (!cur) return;
    var slot = cur.slot;
    var mapping = slot.mapping;
    host.innerHTML = '';

    ['date', 'time'].forEach(function (key) {
      var chosen = mapping[key];
      var opts = [];
      var candidates = mapping.candidates[key] || [];
      candidates.forEach(function (c) {
        opts.push({ value: c.column, text: c.column + '（' + c.score + '）' });
      });
      mapping.columns.forEach(function (c) {
        if (opts.some(function (o) { return o.value === c.name; })) return;
        opts.push({ value: c.name, text: c.name });
      });
      opts.unshift({ value: '', text: '（不使用）' });

      slot.overrides[key] = chosen ? chosen.column : '';
      host.appendChild(el('div', { class: 'map-row' }, [
        el('span', { class: 'map-row__label', text: key === 'date' ? '日期列' : '时间列' }),
        makeSelect('imp-' + key, slot.overrides[key], opts, function () {
          slot.overrides[key] = this.value;
          remap();
        }),
        el('span', { class: 'map-row__hint', text: chosen ? chosen.reason : (key === 'date' ? '必填' : '没有单独的时间列时可留空') })
      ]));
    });

    MH.importVendors.targets.forEach(function (t) {
      if (t.key === 'date' || t.key === 'time') return;
      var bucket = t.role === 'core' ? mapping.metrics : mapping.aux;
      var overridesBucket = t.role === 'core' ? (slot.overrides.metrics = slot.overrides.metrics || {}) : (slot.overrides.aux = slot.overrides.aux || {});
      var keyed = bucket[t.key];

      var opts = [{ value: '', text: '（不使用）' }];
      (mapping.candidates[t.key] || []).forEach(function (c) {
        opts.push({ value: c.column, text: c.column + '（' + c.score + '）' });
      });
      mapping.columns.forEach(function (c) {
        if (opts.some(function (o) { return o.value === c.name; })) return;
        opts.push({ value: c.name, text: c.name });
      });

      var control = makeSelect('imp-metric-' + t.key, keyed ? keyed.column : '', opts, function () {
        if (!this.value) { overridesBucket[t.key] = { column: '' }; }
        else {
          var prev = overridesBucket[t.key] || {};
          overridesBucket[t.key] = { column: this.value, unitOverride: prev.unitOverride || 'auto' };
        }
        remap();
      });

      var extra = null;
      if (t.key === 'sleep' && keyed) {
        extra = makeSelect('imp-unit-sleep', (overridesBucket[t.key] && overridesBucket[t.key].unitOverride) || 'auto', [
          { value: 'auto', text: '自动判断单位' },
          { value: 'min', text: '分钟' },
          { value: 's', text: '秒' },
          { value: 'h', text: '小时' }
        ], function () {
          overridesBucket.sleep = { column: keyed.column, unitOverride: this.value };
          remap();
        });
      }

      var hintText = '';
      if (keyed) {
        hintText = keyed.reason;
        if (keyed.unit && keyed.unit.label) hintText += ' · ' + keyed.unit.label;
      } else if (t.role === 'core') {
        hintText = '未识别到，需要的话手动选一列';
      }

      host.appendChild(el('div', { class: 'map-row' }, [
        el('span', { class: 'map-row__label' }, [
          t.role === 'core' ? el('i', { class: 'dot', style: 'background:var(--' + (t.key === 'heartRate' ? 'hr' : t.key) + ')' }) : null,
          el('span', { text: t.label }),
          t.role === 'aux' ? el('span', { class: 'badge badge--sm', text: '辅助' }) : null
        ]),
        control,
        extra,
        el('span', { class: 'map-row__hint', text: hintText })
      ]));
    });

    if (mapping.warnings.length) {
      host.appendChild(el('div', { class: 'field', style: 'margin-top:10px' }, mapping.warnings.map(function (w) {
        return el('p', { class: 'error', text: w });
      })));
    }
  }

  function prePreview(entry, slot) {
    var mapping = slot.mapping;
    var interesting = {};
    if (mapping.date) interesting[mapping.date.column] = 1;
    if (mapping.time) interesting[mapping.time.column] = 1;
    ['mood', 'sleep', 'heartRate', 'stress'].forEach(function (k) {
      if (mapping.metrics[k]) interesting[mapping.metrics[k].column] = 1;
    });
    var cols = slot.table.headers.filter(function (h) { return interesting[h]; });
    if (!cols.length) cols = slot.table.headers.slice(0, 6);

    if (!slot.table.rows.length) {
      return el('p', { class: 'hint', text: '这张表里没有数据行。' });
    }

    var head = el('tr', {}, cols.map(function (c) { return el('th', { text: c }); }));
    var body = slot.table.rows.slice(0, 6).map(function (r) {
      return el('tr', {}, cols.map(function (c) {
        return el('td', { class: 'imp-preview-cell', text: String(r[c] == null ? '' : r[c]).slice(0, 24) });
      }));
    });

    return el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data', style: 'min-width:0' }, [
        el('thead', {}, [head]),
        el('tbody', {}, body)
      ])
    ]);
  }

  function warningList(entry) {
    var items = (entry.warnings || []).map(function (w) { return { text: w, kind: 'warn' }; })
      .concat((entry.skipped || []).map(function (s) { return { text: '跳过「' + s.name + '」：' + s.reason, kind: 'warn' }; }));
    var wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__title', text: '解析说明' }),
      el('span', { class: 'badge', text: items.length ? items.length + ' 条' : '无' })
    ]));
    if (!items.length) wrap.appendChild(el('p', { class: 'hint', text: '这一份数据没有需要额外说明的地方。' }));
    items.forEach(function (i) {
      wrap.appendChild(el('p', { class: 'hint', style: 'margin-top:6px', text: '· ' + i.text }));
    });
    return wrap;
  }

  function readyToImport() {
    var ok = false;
    ui.inspected.forEach(function (entry) {
      if (entry.error) return;
      entry.tables.forEach(function (slot) {
        if (slot.mapping.date && slot.mapping.matchedCount) ok = true;
      });
    });
    if (!ok) U.toast('至少要有一张表识别出日期列与指标列', 'warn', 4000);
    return ok;
  }

  /* ============================ 第三步：清洗与去重 ============================ */

  function renderStep3(host) {
    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '清洗规则' }),
        el('span', { class: 'badge', text: '决定“脏数据”怎么处理' })
      ])
    ]);

    var conflictSel = makeSelect('impConflict', ui.options.conflict, MH.healthImport.conflicts.map(function (c) {
      return { value: c.id, text: c.label + ' — ' + c.desc };
    }), function () { ui.options.conflict = this.value; renderConflictHint(); });

    var rangeSel = makeSelect('impRange', ui.options.outOfRange, [
      { value: 'drop', text: '丢弃该数值（推荐）' },
      { value: 'clamp', text: '截断到量程边界' }
    ], function () { ui.options.outOfRange = this.value; });

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', for: 'impConflict', text: '本机已有同一日期的记录时' }),
      conflictSel,
      el('p', { class: 'hint', id: 'impConflictHint' })
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', for: 'impRange', text: '数值超出四项指标量程时' }),
      rangeSel,
      el('p', { class: 'hint', text: '心情 1–5 · 睡眠 0–16 小时 · 心率 30–200 bpm · 压力 0–10 分' })
    ]));

    card.appendChild(el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'impSnap', checked: ui.options.snapStep }),
      el('span', { text: '对齐到表单步长（睡眠 0.5 小时，其它取整），避免同一份数据在两处显示精度不一致' })
    ]));
    card.appendChild(el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'impAux', checked: ui.options.auxToNote }),
      el('span', { text: '把步数 / HRV / 血氧 / 运动时长写进备注（例如「自动导入：步数 8213 步 · HRV 42 ms」）' })
    ]));

    card.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'impFrom', text: '只导入起始日期' }),
        el('input', { class: 'input', type: 'date', id: 'impFrom', value: ui.options.from || '' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'impTo', text: '截止日期' }),
        el('input', { class: 'input', type: 'date', id: 'impTo', value: ui.options.to || '' })
      ])
    ]));

    // 处理口径一览
    card.appendChild(el('div', { class: 'disclosure', style: 'margin-top:14px' }, [
      el('summary', { text: '去重与时间对齐的完整口径' }),
      el('div', { class: 'disclosure__body' }, [
        el('ol', { class: 'imp-rules' }, [
          el('li', { text: '批内去重：同一「日期 + 时刻」的行合并成一条，先到先得，后来的只补空缺字段。' }),
          el('li', { text: '跨文件合并：先按上面的规则合并，再与本机记录比对，所以睡眠表 + 心率表可以分两个文件导。' }),
          el('li', { text: '时间对齐：所有时间戳都按本机时区落到日历日；睡眠默认归属到“起床日”，Apple 健康与含起止区间的表按同一口径处理。' }),
          el('li', { text: '单位归一：睡眠的分钟 / 秒值自动换算成小时；压力若为百分制自动折成 10 分制；血氧 0–1 自动放大为百分比。' }),
          el('li', { text: '落在未来、日期无法解析、或一行里没有任何可用指标的行会被跳过，并在结果页逐条列出。' })
        ])
      ])
    ]));

    host.appendChild(card);
    renderConflictHint();

    U.$('#impSnap', host).addEventListener('change', function () { ui.options.snapStep = this.checked; });
    U.$('#impAux', host).addEventListener('change', function () { ui.options.auxToNote = this.checked; });
    U.$('#impFrom', host).addEventListener('change', function () { ui.options.from = this.value; });
    U.$('#impTo', host).addEventListener('change', function () { ui.options.to = this.value; });

    var back = el('button', { class: 'btn btn--ghost', type: 'button', id: 'impBack2', text: '上一步' });
    back.addEventListener('click', function () { ui.step = 2; render(document.getElementById('view-import')); });
    var start = el('button', { class: 'btn btn--primary', type: 'button', id: 'impStart', text: '开始导入' });
    start.addEventListener('click', startImport);
    host.appendChild(el('div', { class: 'row', style: 'margin-top:16px' }, [back, el('span', { class: 'spacer' }), start]));
  }

  function renderConflictHint() {
    var node = document.getElementById('impConflictHint');
    if (!node) return;
    var hit = null;
    MH.healthImport.conflicts.forEach(function (c) { if (c.id === ui.options.conflict) hit = c; });
    node.textContent = hit ? hit.desc : '';
  }

  /* ============================ 第四步：进度 ============================ */

  function renderStep4(host) {
    var p = ui.progress;
    var bar = el('div', { class: 'imp-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p.percent) }, [
      el('div', { class: 'imp-bar__fill', style: 'width:' + p.percent + '%' })
    ]);

    var cancelBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'impCancel', text: '取消导入' });
    cancelBtn.addEventListener('click', function () {
      if (ui.cancelToken) ui.cancelToken.cancelled = true;
      U.toast('正在停止…', 'info');
    });

    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '正在导入' }),
        el('span', { class: 'badge', text: p.percent + '%' })
      ]),
      bar,
      el('p', { class: 'hint', style: 'margin-top:10px', text: p.label || '准备中…' }),
      el('div', { class: 'stat-row', style: 'margin-top:14px' }, [
        el('div', { class: 'stat' }, [
          el('span', { class: 'stat__k', text: '已处理行' }),
          el('span', { class: 'stat__v', text: String(p.processed || 0) })
        ]),
        el('div', { class: 'stat' }, [
          el('span', { class: 'stat__k', text: '总行数' }),
          el('span', { class: 'stat__v', text: String(p.total || 0) })
        ])
      ]),
      el('div', { class: 'row', style: 'margin-top:14px' }, [el('span', { class: 'spacer' }), cancelBtn])
    ]));
  }

  /* ============================ 第五步：结果 ============================ */

  function renderStep5(host) {
    var rep = ui.report;
    if (!rep) { host.appendChild(emptyCard('还没有导入结果')); return; }
    var c = rep.counts;

    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '导入结果' }),
        el('span', { class: 'badge', text: U.fmtRelative(rep.at) })
      ]),
      el('div', { class: 'stat-row' }, [
        stat('新增', c.added),
        stat('更新', c.updated),
        stat('跳过', c.skipped),
        stat('无效行', c.invalid),
        stat('区间外', c.filtered)
      ]),
      el('p', { class: 'hint', text: '共读取 ' + c.rows + ' 行，其中 ' + c.valid + ' 行转成样本；冲突策略：' + conflictLabel(rep.options.conflict) + '。' })
    ]));

    if (rep.mapping && rep.mapping.transforms.length) {
      host.appendChild(el('div', { class: 'card section' }, [
        el('div', { class: 'card__head' }, [el('span', { class: 'card__title', text: '字段映射与单位换算' })]),
        el('div', { class: 'kv' }, [
          el('div', { class: 'kv__k', text: '日期列' }), el('div', { class: 'kv__v', text: rep.mapping.date || '—' }),
          el('div', { class: 'kv__k', text: '指标列' }),
          el('div', { class: 'kv__v', text: Object.keys(rep.mapping.metrics).filter(function (k) {
            return rep.mapping.metrics[k];
          }).map(function (k) {
            var m = MH.metrics.get(k);
            return (m ? m.label : k) + '←' + rep.mapping.metrics[k].column;
          }).join('，') || '—' })
        ]),
        el('div', { class: 'row', style: 'margin-top:10px' }, rep.mapping.transforms.map(function (t) {
          return el('span', { class: 'tag', text: t });
        }))
      ]));
    }

    if (rep.issues.length) {
      var rows = rep.issues.slice(0, 20).map(function (i) {
        return el('tr', {}, [
          el('td', { text: i.file || '' }),
          el('td', { class: 'num', text: String(i.row) }),
          el('td', { class: 'cell-date', text: i.date || '—' }),
          el('td', { text: i.metric || '—' }),
          el('td', { text: i.raw == null ? '—' : String(i.raw) }),
          el('td', { text: i.reason + (i.note ? '（' + i.note + '）' : '') })
        ]);
      });
      var table = el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data', style: 'min-width:640px' }, [
          el('thead', {}, [el('tr', {}, ['文件', '行', '日期', '字段', '原始值', '处理方式'].map(function (t) {
            return el('th', { text: t });
          }))]),
          el('tbody', {}, rows)
        ])
      ]);

      var details = el('details', { class: 'disclosure', style: 'margin-top:12px' }, [
        el('summary', { text: '查看全部问题明细（' + rep.issues.length + ' 条' + (rep.issueOverflow ? '，另有 ' + rep.issueOverflow + ' 条被折叠' : '') + '）' }),
        el('div', { class: 'disclosure__body' }, [
          el('pre', { class: 'code', text: rep.issues.map(function (i) {
            return [i.file, '第' + i.row + '行', i.date || '', i.metric || '', i.reason, i.raw || ''].join(' | ');
          }).join('\n') })
        ])
      ]);

      host.appendChild(el('div', { class: 'card section' }, [
        el('div', { class: 'card__head' }, [
          el('span', { class: 'card__title', text: '被跳过或修正的内容' }),
          el('span', { class: 'badge', text: rep.issues.length + ' 条' })
        ]),
        el('p', { class: 'hint', text: '下面列出的是没有被直接写入的地方。原始数据一条都没走网络，也没有被保存。' }),
        table,
        details
      ]));
    }

    var canUndo = MH.healthImport.canUndo(rep.id);
    var undoBtn = el('button', { class: 'btn btn--ghost', type: 'button', id: 'impUndo', text: '撤销本次导入', disabled: !canUndo });
    undoBtn.addEventListener('click', function () {
      var out = MH.healthImport.undo(rep.id);
      U.toast('已撤销，记录回到 ' + out.restored + ' 条', 'ok');
      ui.report = null;
      ui.step = 1;
      ui.inspected = [];
      ui.files = [];
      render(document.getElementById('view-import'));
    });
    var viewBtn = el('button', { class: 'btn btn--primary', type: 'button', id: 'impView', text: '去看看记录' });
    viewBtn.addEventListener('click', function () { MH.app.go('records'); });
    var againBtn = el('button', { class: 'btn btn--ghost', type: 'button', id: 'impAgain', text: '再导一份' });
    againBtn.addEventListener('click', function () {
      ui.step = 1;
      ui.report = null;
      ui.inspected = [];
      ui.files = [];
      render(document.getElementById('view-import'));
    });

    host.appendChild(el('div', { class: 'row', style: 'margin-top:16px' }, [undoBtn, againBtn, el('span', { class: 'spacer' }), viewBtn]));
    if (!canUndo) host.appendChild(el('p', { class: 'hint', style: 'margin-top:8px', text: '撤销只在同一个会话、下一次导入之前有效。' }));
  }

  function stat(k, v) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__k', text: k }),
      el('span', { class: 'stat__v', text: String(v || 0) })
    ]);
  }

  function emptyCard(text) {
    return el('div', { class: 'card' }, [
      el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title', text: text })
      ])
    ]);
  }

  /* ============================ 导入历史 ============================ */

  function renderHistory(host) {
    var list = MH.healthImport.history();
    var items = list.slice(0, 6).map(function (h) {
      return el('div', { class: 'setting-row' }, [
        el('div', { class: 'setting-row__text' }, [
          el('div', { class: 'setting-row__title', text: (h.files || []).join('、') || '未命名文件' }),
          el('div', { class: 'setting-row__desc', text: U.fmtDateTime(h.at) + ' · ' + (h.profile || '通用') +
            ' · 新增 ' + ((h.counts && h.counts.added) || 0) + ' / 更新 ' + ((h.counts && h.counts.updated) || 0) +
            ' / 跳过 ' + ((h.counts && h.counts.skipped) || 0) })
        ]),
        el('div', { class: 'setting-row__ctl' }, [
          el('span', { class: 'badge', text: conflictLabel(h.conflict) })
        ])
      ]);
    });

    var body = el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '导入历史' }),
        el('span', { class: 'badge', text: list.length ? '最近 ' + list.length + ' 次 · 仅本机' : '暂无' })
      ])
    ]);
    if (!items.length) body.appendChild(el('p', { class: 'hint', text: '导入过的文件会留一条摘要在这里，只记录文件名与条数，不保存原始数据。' }));
    items.forEach(function (i) { body.appendChild(i); });
    if (items.length) {
      var clear = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '清空历史' });
      clear.addEventListener('click', function () {
        MH.healthImport.clearHistory();
        render(document.getElementById('view-import'));
      });
      body.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [el('span', { class: 'spacer' }), clear]));
    }
    host.appendChild(body);
  }

  /* ============================ 执行导入 ============================ */

  function startImport() {
    if (ui.running) return;

    var inputs = [];
    ui.inspected.forEach(function (entry) {
      if (entry.error) return;
      var useAll = entry.useAllTables !== false && entry.tables.length > 1;
      var slots = useAll ? entry.tables : [entry.tables[entry.tableIndex]];
      slots.forEach(function (slot) {
        if (!slot || !slot.mapping.date || !slot.mapping.matchedCount) return;
        inputs.push({
          name: entry.name,
          label: slot.table.label || entry.name,
          path: slot.table.path || '',
          profileName: slot.mapping.profileName || '',
          table: slot.table,
          mapping: slot.mapping
        });
      });
    });

    if (!inputs.length) { U.toast('没有可用于导入的表', 'warn'); return; }

    function go() {
      ui.running = true;
      ui.step = 4;
      ui.progress = { percent: 0, phase: '', label: '准备导入', processed: 0, total: 0 };
      ui.cancelToken = { cancelled: false };
      render(document.getElementById('view-import'));

      MH.healthImport.run({
        inputs: inputs,
        options: ui.options,
        cancelToken: ui.cancelToken,
        onProgress: function (p) {
          ui.progress = p;
          ui.step = 4;
          render(document.getElementById('view-import'));
        }
      }).then(function (report) {
        ui.running = false;
        ui.report = report;
        ui.step = 5;
        U.toast('导入完成：新增 ' + report.counts.added + ' 条，更新 ' + report.counts.updated + ' 条', 'ok', 4000);
        render(document.getElementById('view-import'));
      }).catch(function (e) {
        ui.running = false;
        if (e && e.code === 'CANCELLED') {
          U.toast('导入已取消，本机记录没有改动', 'info', 4000);
          ui.step = 1;
          ui.inspected = [];
          render(document.getElementById('view-import'));
          return;
        }
        ui.step = 3;
        render(document.getElementById('view-import'));
        U.toast((e && e.message ? e.message : '导入失败') + (e && e.hint ? '　' + e.hint : ''), 'error', 6000);
      });
    }

    if (ui.options.conflict === 'overwrite') {
      MH.app.requireReauth('以「覆盖」方式导入会改动本机已有的记录数值，请确认是你本人操作。').then(function (okRes) {
        if (okRes) go();
      });
    } else {
      go();
    }
  }

  /* ============================ 骨架 ============================ */

  function renderStepIndicator() {
    var host = document.getElementById('impSteps');
    if (!host) return;
    host.innerHTML = '';
    STEPS.forEach(function (s) {
      var state = s.id < ui.step ? 'done' : (s.id === ui.step ? 'current' : 'todo');
      host.appendChild(el('div', { class: 'stepper__item', dataset: { state: state } }, [
        el('span', { class: 'stepper__dot', text: state === 'done' ? '✓' : String(s.id) }),
        el('span', { class: 'stepper__label', text: s.label })
      ]));
    });
  }

  function render(root) {
    root.innerHTML = '';
    var nf = ui.files.length;

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '第三方健康数据导入' }),
        el('p', { class: 'page-desc', text: '把华为、Apple 健康、Google Fit / Health Connect、OPPO、vivo、小米、Garmin 以及任意 CSV / Excel 的健康数据接进来，经识别、清洗、去重后写成本机的心情 / 睡眠 / 心率 / 压力记录。全程在这台设备上完成。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('span', { class: 'badge', text: nf ? nf + ' 个文件' : '未选择文件' }),
        ui.step > 1 ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'impRestart', text: '重新开始' }) : null
      ])
    ]));

    root.appendChild(el('div', { class: 'stepper', id: 'impSteps' }));
    renderStepIndicator();
    var restart = U.$('#impRestart', root);
    if (restart) restart.addEventListener('click', function () {
      ui.step = 1; ui.report = null; ui.inspected = []; ui.files = []; ui.error = null;
      render(document.getElementById('view-import'));
    });

    var body = el('div', { id: 'impBody' });
    root.appendChild(body);

    if (ui.step === 1) renderStep1(body);
    else if (ui.step === 2) renderStep2(body);
    else if (ui.step === 3) renderStep3(body);
    else if (ui.step === 4) renderStep4(body);
    else renderStep5(body);

    if (ui.step !== 4) renderHistory(body);
  }

  MH.views = MH.views || {};
  MH.views.import = { render: render };
})(window.MH = window.MH || {});
