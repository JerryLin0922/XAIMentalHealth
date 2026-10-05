/* 模型管理页：发现（模型库）→ 比较 → 选择（场景配置）→ 配置/管理（连接）→ 观测（日志）。
   设计见 docs/models-page-spec.md。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;
  var R = MH.modelRegistry;

  var TABS = [
    { key: 'library', label: '模型库' },
    { key: 'scenarios', label: '场景配置' },
    { key: 'connections', label: '连接管理' },
    { key: 'logs', label: '调用日志' }
  ];

  /* UI 瞬时状态。模块只加载一次，refreshCurrent() 重绘视图不会丢失。 */
  var ui = {
    tab: 'library',
    view: 'card',          // card | table
    q: '',                 // 模型库搜索
    privacy: 'all',        // all | local | cloud
    cap: 'all',            // all | chat | qa
    ready: 'all',          // all | ready | not
    sort: 'recommend',     // recommend | name | window | cost
    page: 1,
    connQ: '',
    connSort: 'name',      // name | recent
    connPage: 1,
    logScenario: 'all',
    logResult: 'all'       // all | ok | degraded
  };

  var form = {
    editingId: null,
    provider: 'deepseek',
    name: '',
    baseUrl: '',
    model: '',
    apiKey: '',
    persistKey: false
  };

  var PAGE_CARD = 6;
  var PAGE_TABLE = 10;
  var PAGE_CONN = 10;

  /* ============================ 骨架 ============================ */

  function render(root) {
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '模型' }),
        el('p', { class: 'page-desc', text: '两个本地引擎开箱可用、永不联网；需要更强表达时，可以自己接一个云端服务商。切换只影响本设备，且随时可以退回本地。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'modClearLogs', text: '清空调用日志' })
      ])
    ]));

    root.appendChild(privacyBar());
    root.appendChild(segBar());

    var panel = el('div', { class: 'section', id: 'modPanel' });
    root.appendChild(panel);
    renderPanel(panel);

    bind(root);
  }

  function privacyBar() {
    var allowExternal = MH.models.privacy.allowExternal();
    return el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '隐私授权' }),
        el('span', { class: 'badge', text: allowExternal ? '已允许外发' : '严格本地' })
      ]),
      el('div', { class: 'setting-row', style: 'padding-top:0' }, [
        el('div', { class: 'setting-row__text' }, [
          el('div', { class: 'setting-row__title', text: '允许数据离开本设备' }),
          el('div', { class: 'setting-row__desc', text: '关闭时，任何场景都只会调用本地引擎；开启后，被选中的云端模型才会真正发起请求。' })
        ]),
        el('div', { class: 'setting-row__ctl' }, [
          el('button', {
            class: 'btn ' + (allowExternal ? 'btn--danger' : 'btn--primary') + ' btn--sm',
            type: 'button', id: 'modToggleExternal',
            text: allowExternal ? '改为严格本地' : '开启外发授权'
          })
        ])
      ]),
      el('div', { class: 'notice' + (allowExternal ? ' notice--warn' : ''), html:
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<span>外发范围：<b>陪伴对话</b>只发送最近 14 天统计摘要与当前这句话；<b>智能问答</b>发送你勾选的来源内容（上传的文件会原文发送）。' +
        '原始记录、单条明细与备注原文不参与。检测到危机信号时一律强制走本地，绝不外发。</span>' })
    ]);
  }

  function segBar() {
    var bar = el('div', { class: 'seg', role: 'tablist', 'aria-label': '模型页分区' });
    TABS.forEach(function (t) {
      bar.appendChild(el('button', {
        class: 'seg__btn', type: 'button', role: 'tab', id: 'modTab-' + t.key,
        text: t.label, 'aria-selected': ui.tab === t.key ? 'true' : 'false',
        'aria-controls': 'modPanel'
      }));
    });
    return bar;
  }

  function renderPanel(panel) {
    panel.innerHTML = '';
    if (ui.tab === 'library') renderLibrary(panel);
    else if (ui.tab === 'scenarios') renderScenarios(panel);
    else if (ui.tab === 'connections') renderConnections(panel);
    else renderLogsPanel(panel);
  }

  /* ============================ ① 模型库 ============================ */

  /** 本地引擎 + 全部连接，统一成可比较的条目。 */
  function catalog() {
    var out = [];

    R.LOCAL_MODELS.forEach(function (m) {
      out.push({
        id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, privacy: 'on-device',
        capabilities: m.capabilities || [], modelName: '', window: 0,
        cost: m.cost || 'free', ready: true, missing: '', enabled: true,
        note: m.note || '', builtin: true, docsUrl: '', keyPlaceholder: '',
        versions: [], baseUrl: ''
      });
    });

    MH.store.models.connections().forEach(function (c) {
      var preset = R.getPreset(c.provider) || {};
      out.push({
        id: 'cloud:' + c.id, name: c.name, vendor: preset.name || c.provider, kind: c.kind,
        privacy: 'external', capabilities: ['chat', 'qa'], modelName: c.model,
        window: R.estimateWindow(c.model), cost: 'paid',
        ready: !!c.apiKey && !!c.baseUrl && !!c.model,
        missing: !c.apiKey ? '缺少 API Key' : ((!c.baseUrl || !c.model) ? '缺少 baseUrl 或模型名' : ''),
        enabled: c.enabled !== false,
        note: preset.note || '', builtin: false,
        docsUrl: preset.docsUrl || '', keyPlaceholder: preset.keyPlaceholder || '',
        versions: preset.models || [], baseUrl: c.baseUrl || '', provider: c.provider
      });
    });

    return out;
  }

  /** 该模型被哪些场景选中。 */
  function usedBy(modelId) {
    return MH.models.scenarios().filter(function (s) {
      return MH.models.activeFor(s.key) === modelId;
    }).map(function (s) { return s.label; });
  }

  function matches(item) {
    if (ui.privacy === 'local' && item.privacy !== 'on-device') return false;
    if (ui.privacy === 'cloud' && item.privacy !== 'external') return false;
    if (ui.cap !== 'all' && item.capabilities.indexOf(ui.cap) < 0) return false;
    if (ui.ready === 'ready' && !item.ready) return false;
    if (ui.ready === 'not' && item.ready) return false;

    var q = ui.q.trim().toLowerCase();
    if (!q) return true;
    return [item.name, item.vendor, item.modelName, item.provider || '']
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }

  function sortItems(list) {
    var arr = list.slice();
    if (ui.sort === 'name') {
      arr.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    } else if (ui.sort === 'window') {
      arr.sort(function (a, b) { return b.window - a.window; });
    } else if (ui.sort === 'cost') {
      arr.sort(function (a, b) {
        var ca = a.cost === 'free' ? 0 : 1, cb = b.cost === 'free' ? 0 : 1;
        return ca - cb || a.name.localeCompare(b.name, 'zh');
      });
    } else {
      // 推荐：未就绪的排最后，其次"正在被某个场景使用"，其次本地优先，最后按窗口降序
      arr.sort(function (a, b) {
        var sa = (a.ready ? 0 : 100) + (usedBy(a.id).length ? 0 : 10) + (a.privacy === 'on-device' ? 0 : 5);
        var sb = (b.ready ? 0 : 100) + (usedBy(b.id).length ? 0 : 10) + (b.privacy === 'on-device' ? 0 : 5);
        return sa - sb || b.window - a.window || a.name.localeCompare(b.name, 'zh');
      });
    }
    return arr;
  }

  function renderLibrary(panel) {
    var all = sortItems(catalog().filter(matches));
    var size = ui.view === 'card' ? PAGE_CARD : PAGE_TABLE;
    var pages = Math.max(1, Math.ceil(all.length / size));
    if (ui.page > pages) ui.page = pages;
    var start = (ui.page - 1) * size;
    var pageItems = all.slice(start, start + size);

    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__title', text: '模型库' }),
      el('span', { class: 'badge', text: all.length + ' 个可用' })
    ]));

    /* ---- 工具栏 ---- */
    var search = el('input', {
      class: 'input', type: 'search', id: 'modSearch',
      value: ui.q, placeholder: '搜索名称、服务商或模型名'
    });
    card.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'field toolbar__search' }, [
        el('label', { class: 'label', for: 'modSearch', text: '搜索' }), search
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modFilterPrivacy', text: '类型' }),
        select('modFilterPrivacy', ui.privacy, [
          { v: 'all', t: '全部' }, { v: 'local', t: '本地' }, { v: 'cloud', t: '云端' }
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modFilterCap', text: '能力' }),
        select('modFilterCap', ui.cap, [{ v: 'all', t: '全部' }].concat(
          MH.models.scenarios().map(function (s) { return { v: s.capability, t: s.label }; })
        ))
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modFilterReady', text: '状态' }),
        select('modFilterReady', ui.ready, [
          { v: 'all', t: '全部' }, { v: 'ready', t: '可用' }, { v: 'not', t: '未就绪' }
        ])
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modSort', text: '排序' }),
        select('modSort', ui.sort, [
          { v: 'recommend', t: '推荐优先' }, { v: 'name', t: '名称' },
          { v: 'window', t: '窗口' }, { v: 'cost', t: '成本' }
        ])
      ]),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', id: 'modViewToggle',
        text: ui.view === 'card' ? '表格视图' : '卡片视图',
        'aria-pressed': ui.view === 'table' ? 'true' : 'false'
      })
    ]));

    if (!all.length) {
      card.appendChild(el('div', { class: 'empty' }, [
        el('p', { class: 'empty__title', text: '没有匹配的模型' }),
        el('p', { class: 'small', text: '换个关键词，或把筛选条件改回「全部」。' })
      ]));
    } else if (ui.view === 'card') {
      var grid = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(258px,1fr))' });
      pageItems.forEach(function (it) { grid.appendChild(modelCard(it)); });
      card.appendChild(grid);
    } else {
      card.appendChild(el('div', { class: 'table-wrap' }, [libraryTable(pageItems)]));
    }

    card.appendChild(pager(all.length, size, ui.page, function (p) { ui.page = p; MH.app.refreshCurrent(); }));
    panel.appendChild(card);

    bindLibrary();
  }

  function modelCard(item) {
    var used = usedBy(item.id);
    var status = statusTag(item);
    var card = el('button', {
      class: 'model-card', type: 'button',
      'aria-label': '查看模型详情：' + item.name
    }, [
      el('div', { class: 'model-card__head' }, [
        el('span', { class: 'model-card__name', text: item.name }),
        el('span', { class: 'badge' + (item.privacy === 'on-device' ? ' badge--local' : ''), text: item.privacy === 'on-device' ? '本地' : '云端' })
      ]),
      el('div', { class: 'model-card__meta' }, [
        el('span', { text: item.vendor + (item.modelName ? ' · ' + item.modelName : '') }),
        el('span', { text: item.privacy === 'on-device' ? '窗口不适用' : '窗口估算 ' + fmtWindow(item.window) }),
        el('span', { text: item.cost === 'free' ? '免费' : '按量计费' })
      ]),
      el('div', { class: 'model-card__meta' }, item.capabilities.map(function (c) {
        return el('span', { class: 'tag', text: (R.SCENARIOS[c === 'chat' ? 'companion' : 'qa'] || {}).label || c });
      })),
      el('div', { class: 'model-card__foot' }, [
        status,
        used.length ? el('span', { class: 'tag', text: used.join(' / ') + '在用' }) : null,
        el('span', { class: 'hint', style: 'margin-left:auto', text: '查看详情 →' })
      ])
    ]);
    card.addEventListener('click', function () { openDetail(item.id, card); });
    return card;
  }

  function libraryTable(items) {
    var table = el('table', { class: 'data' });
    table.appendChild(el('caption', { class: 'sr-only', text: '可用模型列表' }));
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: '名称' }), el('th', { scope: 'col', text: '类型' }),
      el('th', { scope: 'col', text: '服务商 / 模型' }), el('th', { scope: 'col', text: '能力' }),
      el('th', { scope: 'col', text: '窗口（估算）' }), el('th', { scope: 'col', text: '成本' }),
      el('th', { scope: 'col', text: '状态' }), el('th', { class: 'num', scope: 'col', text: '操作' })
    ])]));
    var body = el('tbody');
    items.forEach(function (item) {
      var btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '详情', 'aria-label': '查看模型详情：' + item.name });
      btn.addEventListener('click', function () { openDetail(item.id, btn); });
      body.appendChild(el('tr', {}, [
        el('td', {}, [el('b', { text: item.name })]),
        el('td', {}, [el('span', { class: 'badge' + (item.privacy === 'on-device' ? ' badge--local' : ''), text: item.privacy === 'on-device' ? '本地' : '云端' })]),
        el('td', { class: 'muted', text: item.vendor + (item.modelName ? ' / ' + item.modelName : '') }),
        el('td', { text: item.capabilities.map(capLabel).join('、') }),
        el('td', { text: item.privacy === 'on-device' ? '不适用' : fmtWindow(item.window) }),
        el('td', { text: item.cost === 'free' ? '免费' : '按量计费' }),
        el('td', {}, [statusTag(item)]),
        el('td', { class: 'num' }, [el('div', { class: 'row-actions' }, [btn])])
      ]));
    });
    table.appendChild(body);
    return table;
  }

  function capLabel(c) {
    return c === 'chat' ? '陪伴对话' : (c === 'qa' ? '智能问答' : c);
  }

  function statusTag(item) {
    if (item.privacy === 'external' && !MH.store.models.allowExternal()) {
      return el('span', { class: 'tag', text: '授权后才会调用' });
    }
    if (!item.enabled) return el('span', { class: 'tag', text: '已停用' });
    if (!item.ready) return el('span', { class: 'tag', text: item.missing || '未就绪' });
    return el('span', { class: 'tag', text: '可用' });
  }

  function fmtWindow(n) {
    if (!n) return '—';
    return n >= 1000 ? U.num(n / 1000, 0) + 'k' : String(n);
  }

  function pager(total, size, page, onGo) {
    var pages = Math.max(1, Math.ceil(total / size));
    var wrap = el('div', { class: 'pager' });
    if (total <= size) {
      wrap.appendChild(el('span', { class: 'pager__info', text: '共 ' + total + ' 项' }));
      return wrap;
    }
    var prev = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'modPagerPrev', text: '上一页' });
    var next = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'modPagerNext', text: '下一页' });
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    prev.addEventListener('click', function () { onGo(Math.max(1, page - 1)); });
    next.addEventListener('click', function () { onGo(Math.min(pages, page + 1)); });
    wrap.appendChild(el('span', { class: 'pager__info', text: '第 ' + page + '/' + pages + ' 页 · 共 ' + total + ' 项' }));
    wrap.appendChild(prev);
    wrap.appendChild(next);
    return wrap;
  }

  function select(id, value, options) {
    var node = el('select', { class: 'input', id: id }, options.map(function (o) {
      return el('option', { value: o.v, text: o.t });
    }));
    node.value = value;
    return node;
  }

  function bindLibrary() {
    var root = document;

    var search = U.$('#modSearch', root);
    if (search) {
      search.addEventListener('input', U.debounce(function () {
        ui.q = this.value; ui.page = 1;
        MH.app.refreshCurrent();
        var again = U.$('#modSearch', document);
        if (again && typeof again.focus === 'function') {
          again.focus();
          if (again.setSelectionRange) again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 200));
    }

    on(root, 'modFilterPrivacy', 'change', function () { ui.privacy = this.value; ui.page = 1; MH.app.refreshCurrent(); });
    on(root, 'modFilterCap', 'change', function () { ui.cap = this.value; ui.page = 1; MH.app.refreshCurrent(); });
    on(root, 'modFilterReady', 'change', function () { ui.ready = this.value; ui.page = 1; MH.app.refreshCurrent(); });
    on(root, 'modSort', 'change', function () { ui.sort = this.value; ui.page = 1; MH.app.refreshCurrent(); });
    on(root, 'modViewToggle', 'click', function () {
      ui.view = ui.view === 'card' ? 'table' : 'card';
      ui.page = 1;
      MH.app.refreshCurrent();
    });
  }

  /* ============================ ② 场景配置 ============================ */

  function renderScenarios(panel) {
    var grid = el('div', { class: 'grid grid--2' });
    MH.models.scenarios().forEach(function (scen) { grid.appendChild(scenarioCard(scen)); });
    panel.appendChild(grid);
  }

  function scenarioCard(scen) {
    var current = MH.models.activeFor(scen.key);
    var options = MH.models.listFor(scen.key);
    var rec = MH.models.recommend(scen.key, { chars: scen.key === 'qa' ? MH.store.prefs.get().qaContextChars : 800 });
    var desc = MH.models.describe(current);

    var sel = el('select', { class: 'input', id: 'modSel-' + scen.key }, options.map(function (m) {
      var label = m.name + ' · ' + (m.privacy === 'on-device' ? '本地' : '云端') + (m.ready ? '' : '（' + (m.missing || '未就绪') + '）');
      return el('option', { value: m.id, text: label });
    }));
    sel.value = current;

    var adopt = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '用推荐', title: rec.reason });
    var detail = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '查看模型详情' });

    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: scen.label }),
        el('span', { class: 'badge', text: desc.privacy === 'on-device' ? '本地' : '云端' })
      ]),
      el('p', { class: 'small muted', style: 'margin-bottom:12px', text: scen.desc }),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modSel-' + scen.key, text: '当前模型' }),
        sel
      ]),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        adopt, detail,
        el('span', { class: 'hint', style: 'flex:1;min-width:180px', text: '推荐：' + rec.reason })
      ])
    ]);

    sel.addEventListener('change', function () {
      MH.models.setActive(scen.key, sel.value);
      U.toast(scen.label + '已切换到 ' + MH.models.describe(sel.value).name, 'ok');
      MH.app.refreshCurrent();
    });
    adopt.addEventListener('click', function () {
      MH.models.setActive(scen.key, rec.modelId);
      U.toast('已采用推荐模型：' + MH.models.describe(rec.modelId).name, 'ok');
      MH.app.refreshCurrent();
    });
    detail.addEventListener('click', function () { openDetail(current, detail); });
    return card;
  }

  /* ============================ ③ 连接管理 ============================ */

  function renderConnections(panel) {
    panel.appendChild(el('div', { class: 'card', id: 'modConnCard' }));
    var card = document.getElementById('modConnCard');

    card.appendChild(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__title', text: '云端连接' }),
      el('span', { class: 'badge', text: MH.store.models.connections().length + ' 个' })
    ]));

    var presetSel = el('select', { class: 'input', id: 'modProvider' }, R.PRESETS.map(function (p) {
      return el('option', { value: p.id, text: p.name });
    }));
    presetSel.value = form.provider;

    var preset = R.getPreset(form.provider) || {};
    var modelHint = (preset.models && preset.models.length) ? '可选：' + preset.models.join(' / ') : '填写服务商的模型名';

    card.appendChild(el('div', { class: 'form' }, [
      el('div', { class: 'filters' }, [
        fieldCell('服务商', presetSel),
        fieldCell('显示名称', el('input', { class: 'input', id: 'modName', value: form.name, placeholder: preset.name || '我的模型' })),
        fieldCell('baseUrl', el('input', { class: 'input', id: 'modBaseUrl', value: form.baseUrl || preset.baseUrl || '', placeholder: 'https://…/v1' })),
        fieldCell('模型名', el('input', { class: 'input', id: 'modModel', value: form.model || preset.defaultModel || '', placeholder: 'gpt-4o-mini' }))
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modKey', html: 'API Key <span class="label__opt">' + (preset.keyPlaceholder || '') + '</span>' }),
        el('div', { class: 'input-wrap' }, [
          el('input', { class: 'input', type: 'password', id: 'modKey', value: form.apiKey, autocomplete: 'off', placeholder: '留空表示不改（编辑时）' }),
          el('button', { class: 'iconbtn iconbtn--in', type: 'button', id: 'modKeyToggle', 'aria-label': '显示密钥', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>' })
        ]),
        el('p', { class: 'hint', text: modelHint + (preset.note ? ' · ' + preset.note : '') })
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', id: 'modPersistKey', checked: form.persistKey }),
          el('span', { text: '把密钥保存到本机（需重新验证密码；不勾选则仅本次会话有效）' })
        ]),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'modTest', text: '测试连接' }),
        el('button', { class: 'btn btn--primary btn--sm', type: 'button', id: 'modSave', text: form.editingId ? '保存修改' : '新增连接' })
      ]),
      form.editingId ? el('div', { class: 'row' }, [
        el('span', { class: 'hint', text: '正在编辑已有连接' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'modCancelEdit', text: '取消编辑' })
      ]) : null
    ]));

    var all = filteredConnections();
    var pages = Math.max(1, Math.ceil(all.length / PAGE_CONN));
    if (ui.connPage > pages) ui.connPage = pages;
    var pageItems = all.slice((ui.connPage - 1) * PAGE_CONN, (ui.connPage - 1) * PAGE_CONN + PAGE_CONN);

    var toolbar = el('div', { class: 'toolbar', style: 'margin-top:16px' }, [
      el('div', { class: 'field toolbar__search' }, [
        el('label', { class: 'label', for: 'modConnSearch', text: '搜索连接' }),
        el('input', { class: 'input', type: 'search', id: 'modConnSearch', value: ui.connQ, placeholder: '名称 / 服务商 / 模型名' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modConnSort', text: '排序' }),
        select('modConnSort', ui.connSort, [
          { v: 'name', t: '名称' }, { v: 'recent', t: '最近添加' }
        ])
      ])
    ]);
    card.appendChild(toolbar);

    if (!all.length) {
      card.appendChild(el('p', { class: 'hint', style: 'margin-top:14px', text: '还没有云端连接。不配置也能正常使用——两个本地引擎永远可用。' }));
      // 注意：不能在这里提前 return，否则表单按钮不会绑上监听，
      // 表现为「第一次新增连接时点按钮没反应」。
      bindConnForm();
      return;
    }

    var table = el('table', { class: 'data' });
    table.appendChild(el('caption', { class: 'sr-only', text: '云端连接列表' }));
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: '名称' }), el('th', { scope: 'col', text: '服务商 / 模型' }),
      el('th', { scope: 'col', text: '密钥' }), el('th', { scope: 'col', text: '状态' }),
      el('th', { class: 'num', scope: 'col', text: '操作' })
    ])]));
    var body = el('tbody');
    pageItems.forEach(function (c) { body.appendChild(connectionRow(c)); });
    table.appendChild(body);
    card.appendChild(el('div', { class: 'table-wrap' }, [table]));
    card.appendChild(pager(all.length, PAGE_CONN, ui.connPage, function (p) { ui.connPage = p; MH.app.refreshCurrent(); }));

    // 表单是重绘出来的，每次都要重新挂监听，否则按钮会失效
    bindConnForm();
  }

  function filteredConnections() {
    var q = ui.connQ.trim().toLowerCase();
    var list = MH.store.models.connections().filter(function (c) {
      if (!q) return true;
      return [c.name, c.provider, c.model].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    if (ui.connSort === 'recent') {
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    } else {
      list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
    }
    return list;
  }

  function connectionRow(c) {
    var keyState = c.apiKey ? (c.persistKey ? '已存本机' : '仅本次会话') : '未填写';
    var toggle = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: c.enabled ? '停用' : '启用' });
    var edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '编辑' });
    var del = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: '删除' });
    var test = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '测试' });

    toggle.addEventListener('click', function () {
      MH.store.models.updateConnection(c.id, { enabled: !c.enabled });
      U.toast(c.enabled ? '已停用：' + c.name : '已启用：' + c.name, 'ok');
      MH.app.refreshCurrent();   // 场景卡与模型库里的下拉也要同步刷新
    });
    edit.addEventListener('click', function () {
      form.editingId = c.id;
      form.provider = c.provider;
      form.name = c.name;
      form.baseUrl = c.baseUrl;
      form.model = c.model;
      form.persistKey = c.persistKey;
      form.apiKey = '';
      // 必须走 renderPanel：它会先清空面板，否则会再叠一张卡
      renderPanel(document.getElementById('modPanel'));
    });
    del.addEventListener('click', function () {
      MH.app.confirm({
        title: '删除连接',
        body: '删除连接「' + c.name + '」？密钥会一起清除，且无法恢复。',
        confirmText: '删除', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.models.removeConnection(c.id);
        U.toast('已删除连接', 'ok');
        MH.app.refreshCurrent();
      });
    });
    test.addEventListener('click', function () {
      test.disabled = true; test.textContent = '测试中…';
      MH.models.test('cloud:' + c.id).then(function (r) {
        test.disabled = false; test.textContent = '测试';
        U.toast(r.ok ? ('连接成功（' + r.latencyMs + 'ms）') : ('失败：' + r.message), r.ok ? 'ok' : 'error', 4200);
      });
    });

    return el('tr', {}, [
      el('td', {}, [el('b', { text: c.name })]),
      el('td', { class: 'muted', text: c.provider + ' / ' + c.model }),
      el('td', { text: keyState }),
      el('td', {}, [el('span', { class: 'badge', text: c.enabled ? '已启用' : '已停用' })]),
      el('td', {}, [el('div', { class: 'row-actions' }, [test, toggle, edit, del])])
    ]);
  }

  function fieldCell(labelText, control) {
    var node = el('div', { class: 'field' }, [el('label', { class: 'label', text: labelText }), control]);
    if (control.id) node.querySelector('label').setAttribute('for', control.id);
    return node;
  }

  /** 连接表单的监听（随表单一起重绘，需要重新绑定）。 */
  function bindConnForm() {
    var root = document;

    var providerSel = U.$('#modProvider', root);
    if (providerSel) providerSel.addEventListener('change', function () {
      form.provider = this.value;
      var p = R.getPreset(this.value) || {};
      var base = U.$('#modBaseUrl', root), model = U.$('#modModel', root), name = U.$('#modName', root);
      if (base) base.value = p.baseUrl || '';
      if (model) model.value = p.defaultModel || '';
      if (name && !form.editingId) name.value = p.name || '';
    });

    var toggleKey = U.$('#modKeyToggle', root);
    if (toggleKey) toggleKey.addEventListener('click', function () {
      var i = U.$('#modKey', root);
      i.type = i.type === 'password' ? 'text' : 'password';
    });

    var testBtn = U.$('#modTest', root);
    if (testBtn) testBtn.addEventListener('click', function () {
      var built = collectForm(root);
      if (!built.apiKey) { U.toast('请先填写 API Key 再测试', 'warn'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = '测试中…';
      MH.modelAdapters[built.kind](built, {
        scenario: 'companion', task: 'chat', payload: { message: 'ping', summary: null }, params: {}
      }).then(function () {
        btn.disabled = false; btn.textContent = '测试连接';
        U.toast('连接成功', 'ok');
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '测试连接';
        U.toast('失败（' + (e.code || 'ERROR') + '）：' + e.message, 'error', 5000);
      });
    });

    var saveBtn = U.$('#modSave', root);
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var cfg = collectForm(root);
      if (!cfg.name) { U.toast('请填写显示名称', 'warn'); return; }
      if (!cfg.baseUrl || !cfg.model) { U.toast('请填写 baseUrl 与模型名', 'warn'); return; }
      if (!form.editingId && !cfg.apiKey) { U.toast('请填写 API Key', 'warn'); return; }

      function save() {
        if (form.editingId) {
          MH.store.models.updateConnection(form.editingId, {
            name: cfg.name, provider: cfg.provider, kind: cfg.kind,
            baseUrl: cfg.baseUrl, model: cfg.model, persistKey: cfg.persistKey,
            apiKey: cfg.apiKey || undefined
          });
          U.toast('已保存修改', 'ok');
        } else {
          var conn = MH.store.models.addConnection(cfg);
          U.toast('已新增连接：' + conn.name, 'ok');
        }
        resetForm();
        MH.app.refreshCurrent();
      }

      if (cfg.persistKey && cfg.apiKey) {
        MH.app.requireReauth('把 API Key 保存到本机属于敏感操作，需要重新验证密码。').then(function (ok) {
          if (ok) save();
        });
      } else {
        save();
      }
    });

    var cancel = U.$('#modCancelEdit', root);
    if (cancel) cancel.addEventListener('click', function () { resetForm(); MH.app.refreshCurrent(); });

    var connSearch = U.$('#modConnSearch', root);
    if (connSearch) {
      connSearch.addEventListener('input', U.debounce(function () {
        ui.connQ = this.value; ui.connPage = 1;
        renderPanel(document.getElementById('modPanel'));
        var again = U.$('#modConnSearch', document);
        if (again) again.focus();
      }, 200));
    }
    on(root, 'modConnSort', 'change', function () {
      ui.connSort = this.value; ui.connPage = 1;
      renderPanel(document.getElementById('modPanel'));
    });
  }

  /* ============================ ④ 调用日志 ============================ */

  function renderLogsPanel(panel) {
    panel.appendChild(el('div', { class: 'card', id: 'modLogCard' }));
    renderLogs();
  }

  function renderLogs() {
    var card = document.getElementById('modLogCard');
    if (!card) return;
    card.innerHTML = '';

    var all = MH.models.logs();
    var rows = all.filter(function (l) {
      if (ui.logScenario !== 'all' && l.scenario !== ui.logScenario) return false;
      if (ui.logResult === 'ok' && !(l.ok && !l.degraded)) return false;
      if (ui.logResult === 'degraded' && !l.degraded) return false;
      return true;
    });

    card.appendChild(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__title', text: '调用日志' }),
      el('span', { class: 'badge', text: all.length + ' 条 · 仅本机' })
    ]));

    card.appendChild(el('div', { class: 'toolbar' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modLogScenario', text: '场景' }),
        select('modLogScenario', ui.logScenario, [{ v: 'all', t: '全部' }].concat(
          MH.models.scenarios().map(function (s) { return { v: s.key, t: s.label }; })
        ))
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'modLogResult', text: '结果' }),
        select('modLogResult', ui.logResult, [
          { v: 'all', t: '全部' }, { v: 'ok', t: '成功' }, { v: 'degraded', t: '降级' }
        ])
      ])
    ]));

    var st = stats(all);
    card.appendChild(el('div', { class: 'stat-row' }, [
      stat('调用次数', st.total),
      stat('成功', st.ok),
      stat('降级', st.degraded),
      stat('P50 延迟', st.p50 ? st.p50 + 'ms' : '—'),
      stat('P95 延迟', st.p95 ? st.p95 + 'ms' : '—')
    ]));

    if (!rows.length) {
      card.appendChild(el('p', { class: 'hint', text: '还没有调用记录。每次调用会记录场景、模型、耗时与失败原因，只存在这台设备上。' }));
      bindLogs();
      return;
    }

    var table = el('table', { class: 'data' });
    table.appendChild(el('caption', { class: 'sr-only', text: '模型调用日志' }));
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { scope: 'col', text: '时间' }), el('th', { scope: 'col', text: '场景' }),
      el('th', { scope: 'col', text: '模型' }), el('th', { scope: 'col', text: '结果' }),
      el('th', { class: 'num', scope: 'col', text: '耗时' }), el('th', { class: 'num', scope: 'col', text: '字符' })
    ])]));
    var body = el('tbody');
    rows.slice(0, 20).forEach(function (l) {
      var scen = (R.SCENARIOS[l.scenario] || {}).label || l.scenario;
      body.appendChild(el('tr', {}, [
        el('td', { class: 'cell-date', text: U.fmtDateTime(l.at) }),
        el('td', { text: scen }),
        el('td', {}, [
          el('span', { text: l.modelName }),
          el('span', { class: 'tag', style: 'margin-left:6px', text: l.privacy === 'on-device' ? '本地' : '云端' })
        ]),
        el('td', {}, [
          el('span', { class: 'badge', text: l.ok ? '成功' : '降级：' + (l.code || '失败') }),
          l.message ? el('span', { class: 'hint', style: 'display:block', text: l.message }) : null
        ]),
        el('td', { class: 'num', text: l.latencyMs + 'ms' }),
        el('td', { class: 'num', text: l.chars })
      ]));
    });
    table.appendChild(body);
    card.appendChild(el('div', { class: 'table-wrap' }, [table]));

    bindLogs();
  }

  function stat(k, v) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__k', text: k }),
      el('span', { class: 'stat__v', text: String(v) })
    ]);
  }

  /** 实测统计：只基于本机调用日志，不引用任何厂商宣称值。 */
  function stats(logs) {
    var lat = logs.map(function (l) { return Number(l.latencyMs) || 0; }).sort(function (a, b) { return a - b; });
    function pct(p) {
      if (!lat.length) return 0;
      var i = Math.ceil(p / 100 * lat.length) - 1;
      return lat[Math.max(0, i)];
    }
    return {
      total: logs.length,
      ok: logs.filter(function (l) { return l.ok && !l.degraded; }).length,
      degraded: logs.filter(function (l) { return l.degraded; }).length,
      p50: pct(50),
      p95: pct(95)
    };
  }

  function bindLogs() {
    var root = document;
    on(root, 'modLogScenario', 'change', function () { ui.logScenario = this.value; renderLogs(); });
    on(root, 'modLogResult', 'change', function () { ui.logResult = this.value; renderLogs(); });
  }

  /* ============================ 模型详情 ============================ */

  var detailReturnFocus = null;

  function openDetail(modelId, trigger) {
    var modal = document.getElementById('modalModel');
    var titleEl = document.getElementById('modelDetailTitle');
    var bodyEl = document.getElementById('modelDetailBody');
    if (!modal || !bodyEl) {
      U.toast('详情面板不可用', 'error');
      return;
    }

    var item = null;
    catalog().forEach(function (c) { if (c.id === modelId) item = c; });
    if (!item) { U.toast('找不到该模型', 'warn'); return; }

    if (titleEl) titleEl.textContent = item.name;
    bodyEl.innerHTML = '';
    detailSections(item).forEach(function (sec) {
      bodyEl.appendChild(el('h3', { class: 'card__title', style: 'margin:14px 0 8px', text: sec.title }));
      bodyEl.appendChild(el('div', { class: 'kv' }, sec.rows.filter(Boolean).map(function (r) {
        return [el('div', { class: 'kv__k', text: r[0] }), el('div', { class: 'kv__v', html: r[1] })];
      }).reduce(function (a, b) { return a.concat(b); }, [])));
    });

    detailReturnFocus = trigger || document.activeElement;
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
    var closeBtn = modal.querySelector('[data-model-close]');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      setTimeout(function () { closeBtn.focus(); }, 40);
    }
  }

  function closeDetail() {
    var modal = document.getElementById('modalModel');
    if (modal) { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); }
    if (detailReturnFocus && typeof detailReturnFocus.focus === 'function') {
      try { detailReturnFocus.focus(); } catch (e) { /* 元素可能已被重绘移除 */ }
    }
    detailReturnFocus = null;
  }

  function detailSections(item) {
    var scenLabels = item.capabilities.map(function (c) {
      return c === 'chat' ? '陪伴对话' : (c === 'qa' ? '智能问答' : c);
    });
    var used = usedBy(item.id);
    var resolved = MH.models.resolve(item.id);

    var sections = [];

    sections.push({
      title: '基本信息',
      rows: [
        ['名称', U.esc(item.name)],
        ['厂商 / 服务商', U.esc(item.vendor)],
        ['模型 ID', '<code>' + U.esc(item.id) + '</code>'],
        ['协议', U.esc(item.kind)],
        ['隐私', item.privacy === 'on-device' ? '本地处理，数据不出设备' : '云端处理，需外发授权'],
        ['状态', statusLine(item)]
      ]
    });

    sections.push({
      title: '版本信息',
      rows: [
        item.builtin
          ? ['版本', '内置引擎（随应用版本发布）']
          : ['模型名（版本）', '<code>' + U.esc(item.modelName || '未填写') + '</code>'],
        item.versions && item.versions.length
          ? ['可选版本', U.esc(item.versions.join(' / '))]
          : (item.builtin ? null : ['可选版本', '自定义连接，模型名由你填写']),
        item.baseUrl ? ['baseUrl', '<code>' + U.esc(item.baseUrl) + '</code>'] : null,
        item.docsUrl
          ? ['文档', '<a href="' + U.esc(item.docsUrl) + '" target="_blank" rel="noopener noreferrer">' + U.esc(item.docsUrl) + '</a>']
          : (item.builtin ? null : ['文档', '自定义连接，请参考服务商文档'])
      ]
    });

    var params = R.SCENARIO_PARAMS || {};
    sections.push({
      title: '参数说明',
      rows: [
        ['陪伴对话', 'temperature ' + ((params.chat || {}).temperature) + ' · maxTokens ' + ((params.chat || {}).maxTokens)],
        ['智能问答', 'temperature ' + ((params.qa || {}).temperature) + ' · maxTokens ' + ((params.qa || {}).maxTokens)],
        ['可调性', '当前版本使用场景预设值，界面不开放调整']
      ]
    });

    sections.push({
      title: '能力',
      rows: [
        ['支持场景', U.esc(scenLabels.join('、') || '—')],
        ['需要密钥', item.privacy === 'on-device' ? '否' : '是'],
        ['说明', U.esc(item.note || '—')]
      ]
    });

    var st = stats(MH.models.logs().filter(function (l) { return l.modelId === item.id; }));
    sections.push({
      title: '性能',
      rows: [
        ['上下文窗口', (item.privacy === 'on-device' ? '不适用（本地不拼接上下文）' : fmtWindow(item.window)) + '（估算）'],
        ['速度档位', item.privacy === 'on-device' ? '即时（本机计算）' : (R.estimateWindow(item.modelName) <= 32000 ? '快速档（估算）' : '强能力档（估算）')],
        ['实测 · 调用次数', String(st.total)],
        ['实测 · 成功 / 降级', st.ok + ' / ' + st.degraded],
        ['实测 · P50 / P95', (st.p50 || '—') + 'ms / ' + (st.p95 || '—') + 'ms']
      ]
    });

    sections.push({
      title: '适用场景',
      rows: MH.models.scenarios().map(function (s) {
        if (item.capabilities.indexOf(s.capability) < 0) return [s.label, '不支持'];
        var rec = MH.models.recommend(s.key, { chars: s.key === 'qa' ? MH.store.prefs.get().qaContextChars : 800 });
        var isRec = rec && rec.modelId === item.id;
        return [s.label, (used.indexOf(s.label) >= 0 ? '当前在用 · ' : '') + (isRec ? '推荐模型' : '可用') +
          (isRec && rec.reason ? '（' + U.esc(rec.reason) + '）' : '')];
      })
    });

    sections.push({
      title: '使用说明',
      rows: [
        item.builtin
          ? ['如何开始', '无需任何配置，选择即可使用']
          : ['获取 Key', '到服务商控制台创建 API Key（格式如 ' + U.esc(item.keyPlaceholder || 'sk-…') + '）'],
        (!item.builtin && item.note) ? ['注意事项', U.esc(item.note)] : null,
        ['权限', item.privacy === 'on-device' ? '不会发起任何网络请求' : '需先在页面顶部开启「允许数据离开本设备」'],
        item.privacy === 'external' && !MH.store.models.allowExternal()
          ? ['当前状态', '严格本地模式下不会被调用']
          : null
      ]
    });

    if (item.privacy === 'external' && resolved) {
      var preview = null;
      try {
        preview = MH.modelAdapters.previewRequest(resolved, {
          scenario: 'companion', task: 'chat', payload: { message: '（示例）', summary: null }
        });
      } catch (e) { preview = null; }
      sections.push({
        title: '外发预览（密钥已掩码）',
        rows: preview ? [
          ['协议', U.esc(preview.kind || item.kind)],
          ['目标地址', '<code>' + U.esc(preview.url) + '</code>'],
          ['请求体', '<code>' + U.esc(JSON.stringify(preview.body)) + '</code>'],
          ['请求头', '<code>' + U.esc(JSON.stringify(preview.headers || {})) + '</code>']
        ]           : [['提示', '该协议暂不支持生成预览']]
      });
    }

    return sections;
  }

  function statusLine(item) {
    if (item.privacy === 'external' && !MH.store.models.allowExternal()) return '授权后才会调用';
    if (!item.enabled) return '已停用';
    if (!item.ready) return item.missing || '未就绪';
    return '可用';
  }

  /* ============================ 绑定 ============================ */

  /**
   * 安全绑定：元素缺失时只告警，绝不抛异常。
   * 一旦某个 id 找不到就抛错，bind() 会在中途中断，
   * 后面所有按钮都会静默失去监听 —— 表现就是"点了没反应"。
   */
  function on(root, id, evt, fn) {
    var node = (root && U.$('#' + id, root)) || document.getElementById(id);
    if (!node) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[models] 未找到 #' + id + '，跳过绑定');
      return null;
    }
    node.addEventListener(evt, fn);
    return node;
  }

  function bind(root) {
    TABS.forEach(function (t) {
      on(root, 'modTab-' + t.key, 'click', function () {
        ui.tab = t.key;
        MH.app.refreshCurrent();
      });
    });

    on(root, 'modClearLogs', 'click', function () {
      MH.models.clearLogs();
      renderLogs();
      U.toast('调用日志已清空', 'ok');
    });

    on(root, 'modToggleExternal', 'click', function () {
      var turnOn = !MH.models.privacy.allowExternal();

      // 关闭方向更安全，不需要二次确认；开启方向必须确认，被取消时也要给出反馈
      if (!turnOn) {
        MH.models.privacy.setAllowExternal(false);
        U.toast('已回到严格本地模式，所有场景只调用本地引擎', 'ok');
        MH.app.refreshCurrent();
        return;
      }

      MH.app.confirm({
        title: '开启外发授权',
        body: '开启后，被选中的云端模型会收到：陪伴场景的最近 14 天统计摘要与你这句话；问答场景你勾选的来源内容（含上传文件原文）。原始记录与备注原文不参与。密钥只保存在本机，请求由浏览器直连服务商，不经过任何中间服务器。',
        confirmText: '开启外发',
        danger: true
      }).then(function (yes) {
        if (!yes) { U.toast('已取消，仍保持严格本地模式', 'info'); return; }
        MH.models.privacy.setAllowExternal(true);
        U.toast('已开启外发授权。关闭即可随时回到严格本地模式', 'warn', 4000);
        MH.app.refreshCurrent();
      });
    });

    // 详情弹窗是 index.html 里的静态节点，重绘不会重建它，
    // 所以只能绑定一次，否则每次渲染都会累加一层监听。
    if (!detailBound) {
      var modal = document.getElementById('modalModel');
      if (modal) {
        U.$$('[data-model-close]').forEach(function (n) {
          n.addEventListener('click', closeDetail);
        });
        detailBound = true;
      }
    }
  }

  var detailBound = false;

  function resetForm() {
    form.editingId = null;
    form.provider = 'deepseek';
    form.name = '';
    form.baseUrl = '';
    form.model = '';
    form.apiKey = '';
    form.persistKey = false;
  }

  function collectForm(root) {
    var preset = R.getPreset(form.provider) || { kind: 'openai-compatible' };
    return {
      name: (U.$('#modName', root).value || '').trim(),
      provider: form.provider,
      kind: preset.kind,
      baseUrl: (U.$('#modBaseUrl', root).value || '').trim().replace(/\/+$/, ''),
      model: (U.$('#modModel', root).value || '').trim(),
      apiKey: (U.$('#modKey', root).value || '').trim(),
      persistKey: U.$('#modPersistKey', root).checked
    };
  }

  MH.views = MH.views || {};
  MH.views.models = { render: render, closeDetail: closeDetail };
})(window.MH = window.MH || {});
