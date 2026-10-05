/* 智能问答页：多来源上传 → 选择 → 提问 → 检索 → 回答（含证据引用）。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var KIND_LABEL = { csv: 'CSV', json: 'JSON', text: '文本', health: '内置' };

  // 界面状态（重绘时保留输入内容）
  var ui = {
    question: '',
    prompt: '',
    persist: false,
    pasteText: '',
    pasteName: '',
    selection: { health: true, files: [] },
    result: null,
    busy: false
  };

  function render(root) {
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '智能问答' }),
        el('p', { class: 'page-desc', text: '上传 CSV / JSON / 文本文件，或直接粘贴内容，连同本机的健康摘要一起提问。检索、计算与回答全部在这台设备上完成，文件不会离开浏览器。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'qaClearHistory', text: '清空问答历史' })
      ])
    ]));

    root.appendChild(sourceCard());
    root.appendChild(el('div', { id: 'qaAskHost' }));
    root.appendChild(el('div', { id: 'qaResultHost' }));
    root.appendChild(el('div', { id: 'qaHistoryHost' }));

    bind(root);
    renderAsk();
    renderResult();
    renderHistory();
  }

  /* ============================ 数据源卡片 ============================ */

  function sourceCard() {
    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '数据源' }),
        el('span', { class: 'badge', id: 'qaBudget', text: budgetText() })
      ])
    ]);

    // 上传区
    var fileInput = el('input', { type: 'file', id: 'qaFile', multiple: true, accept: '.csv,.tsv,.json,.jsonl,.txt,.md,.log,.csv', style: 'display:none' });
    var drop = el('div', { class: 'dropzone', id: 'qaDrop', tabindex: '0', role: 'button', 'aria-label': '选择或拖入文件' }, [
      el('div', { html: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L8 8m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
      el('p', { text: '把 CSV / JSON / 文本文件拖到这里，或点击选择' }),
      el('p', { class: 'hint', text: '单个文件 ≤ 2 MB · 支持逗号 / 制表符 / 分号分隔 · UTF-8' })
    ]);

    card.appendChild(drop);
    card.appendChild(fileInput);

    card.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', id: 'qaPersist', checked: ui.persist }),
        el('span', { text: '保存到本机（不勾选则仅本次会话有效，刷新即消失）' })
      ])
    ]));

    // 粘贴文本
    card.appendChild(el('div', { class: 'field', style: 'margin-top:14px' }, [
      el('label', { class: 'label', for: 'qaPaste', text: '或直接粘贴内容' }),
      el('textarea', { class: 'input textarea', id: 'qaPaste', rows: '3', placeholder: '把表格、日志、笔记直接粘进来' }),
      el('div', { class: 'row' }, [
        el('input', { class: 'input', id: 'qaPasteName', style: 'flex:1;min-width:160px', placeholder: '来源名称（选填）' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'qaAddText', text: '添加为来源' })
      ])
    ]));

    // 来源列表
    card.appendChild(el('h3', { class: 'section__title', style: 'margin-top:18px', text: '参与本次问答的来源' }));
    card.appendChild(el('div', { id: 'qaSourceList' }));

    return card;
  }

  function budgetText() {
    var used = MH.store.sources.persistedChars();
    var cap = MH.store.sources.budget;
    return '本机已存 ' + Math.round(used / 1000) + 'k / ' + Math.round(cap / 1000) + 'k 字符';
  }

  function renderSources() {
    var host = document.getElementById('qaSourceList');
    if (!host) return;
    host.innerHTML = '';

    var badge = document.getElementById('qaBudget');
    if (badge) badge.textContent = budgetText();

    // 内置健康记录
    host.appendChild(sourceRow({
      id: '__health__',
      name: '本机健康记录（14 天聚合）',
      kind: 'health',
      size: 0,
      persist: true,
      rows: MH.store.records.all().length,
      text: ''
    }, true));

    var list = MH.store.sources.all();
    if (!list.length) {
      host.appendChild(el('p', { class: 'hint', style: 'margin-top:8px', text: '还没有上传任何文件来源。' }));
      return;
    }
    list.forEach(function (s) { host.appendChild(sourceRow(s, false)); });
  }

  function sourceRow(s, isBuiltin) {
    var checked = isBuiltin ? ui.selection.health : ui.selection.files.indexOf(s.id) >= 0;

    var meta = [];
    if (s.rows && s.rows.length) meta.push(s.rows.length + ' 行');
    if (s.text) meta.push(Math.round(s.text.length / 1000) + 'k 字符');
    if (s.size) meta.push(Math.round(s.size / 1024) + ' KB');

    var row = el('div', { class: 'src-item' }, [
      el('label', { class: 'check', style: 'flex:1' }, [
        el('input', { type: 'checkbox', checked: checked }),
        el('span', {}, [
          el('b', { text: s.name }),
          el('span', { class: 'src-item__meta', text: meta.length ? ' · ' + meta.join(' · ') : '' })
        ])
      ]),
      el('div', { class: 'row', style: 'gap:6px' }, [
        el('span', { class: 'badge', text: KIND_LABEL[s.kind] || s.kind }),
        s.persist && !isBuiltin ? el('span', { class: 'badge', text: '已存本机' }) : null,
        !s.persist && !isBuiltin ? el('span', { class: 'badge', text: '仅本次会话' }) : null,
        !isBuiltin && s.rows && s.rows.length ? el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '转为记录' }) : null,
        !isBuiltin ? el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: '移除' }) : null
      ])
    ]);

    var cb = row.querySelector('input[type=checkbox]');
    cb.addEventListener('change', function () {
      if (isBuiltin) ui.selection.health = cb.checked;
      else {
        var i = ui.selection.files.indexOf(s.id);
        if (cb.checked && i < 0) ui.selection.files.push(s.id);
        if (!cb.checked && i >= 0) ui.selection.files.splice(i, 1);
      }
    });

    var buttons = U.$$('button', row);
    if (!isBuiltin) {
      if (buttons.length === 2) {
        buttons[0].addEventListener('click', function () { convertToRecords(s); });
        buttons[1].addEventListener('click', function () { removeSource(s); });
      } else {
        buttons[0].addEventListener('click', function () { removeSource(s); });
      }
    }
    return row;
  }

  /* ============================ 提问卡片 ============================ */

  function renderAsk() {
    var host = document.getElementById('qaAskHost');
    if (!host) return;
    host.innerHTML = '';

    var prefs = MH.store.prefs.get();
    var topK = el('select', { class: 'input', id: 'qaTopK', style: 'width:auto' }, [1, 2, 3, 4, 6, 8].map(function (n) {
      return el('option', { value: String(n), text: 'Top ' + n });
    }));
    topK.value = String(prefs.qaTopK || 4);

    var budgetSel = el('select', { class: 'input', id: 'qaBudgetSel', style: 'width:auto' }, [6000, 12000, 24000].map(function (n) {
      return el('option', { value: String(n), text: Math.round(n / 1000) + 'k 字符' });
    }));
    budgetSel.value = String(prefs.qaContextChars || 12000);

    var askBtn = el('button', { class: 'btn btn--primary', type: 'button', id: 'qaAsk', text: '提问' });

    var card = el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '提问' }),
        el('span', { class: 'badge', text: '本地检索 + 统计' })
      ]),
      el('div', { class: 'form' }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'label', for: 'qaQuestion', text: '你的问题' }),
          el('textarea', { class: 'input textarea', id: 'qaQuestion', rows: '2', placeholder: '例如：这两周睡眠和心情是不是一起变差了？' }),
          el('p', { class: 'error', id: 'qaErr', hidden: true })
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'label', for: 'qaPrompt', html: '补充说明 / 提示词 <span class="label__opt">选填：告诉它每列是什么意思、想要什么格式</span>' }),
          el('textarea', { class: 'input textarea', id: 'qaPrompt', rows: '2', placeholder: '例如：date 是日期，sleep_h 是睡眠小时数；请用三句话回答。' })
        ]),
        el('div', { class: 'row' }, [
          el('span', { class: 'hint', text: '证据条数' }), topK,
          el('span', { class: 'hint', text: '上下文预算' }), budgetSel,
          el('span', { class: 'spacer' }), askBtn
        ])
      ])
    ]);
    host.appendChild(card);

    U.$('#qaQuestion', host).value = ui.question;
    U.$('#qaPrompt', host).value = ui.prompt;

    topK.addEventListener('change', function () { MH.store.prefs.set({ qaTopK: Number(this.value) }); });
    budgetSel.addEventListener('change', function () { MH.store.prefs.set({ qaContextChars: Number(this.value) }); });
    askBtn.addEventListener('click', submit);
    U.$('#qaQuestion', host).addEventListener('input', function () { ui.question = this.value; });
    U.$('#qaPrompt', host).addEventListener('input', function () { ui.prompt = this.value; });
    U.$('#qaQuestion', host).addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  }

  function submit() {
    var errNode = document.getElementById('qaErr');
    var qInput = document.getElementById('qaQuestion');
    if (errNode) { errNode.hidden = true; }
    if (ui.busy) return;

    var question = (qInput && qInput.value || '').trim();
    if (!question) {
      if (errNode) { errNode.textContent = '请先写下你的问题'; errNode.hidden = false; }
      if (qInput) qInput.focus();
      return;
    }
    ui.question = question;

    var btn = document.getElementById('qaAsk');
    ui.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '检索中…'; }

    MH.qa.ask({
      question: question,
      customPrompt: ui.prompt,
      selection: ui.selection,
      records: MH.store.records.all(),
      sources: MH.store.sources.all()
    }).then(function (res) {
      ui.result = res;
      if (!res.crisis) MH.store.qa.append({
        question: res.question,
        answer: res.answer,
        customPrompt: ui.prompt,
        usedSources: res.usedSources,
        citations: res.citations,
        contextChars: res.context.charCount,
        mode: res.mode
      });
      renderResult();
      renderHistory();
      if (res.crisis) MH.app.showCrisis();
    }).catch(function (e) {
      if (errNode) { errNode.textContent = '出错了：' + (e && e.message ? e.message : e); errNode.hidden = false; }
    }).then(function () {
      ui.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '提问'; }
    });
  }

  /* ============================ 回答卡片 ============================ */

  function renderResult() {
    var host = document.getElementById('qaResultHost');
    if (!host) return;
    host.innerHTML = '';
    var res = ui.result;
    if (!res) return;

    var parts = [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '回答' }),
        el('span', { class: 'badge', text: res.context.charCount ? res.context.charCount + ' 字符上下文' : '无上下文' })
      ]),
      el('div', { class: 'qa-answer', text: res.answer })
    ];

    if (res.model) {
      parts.push(el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('span', { class: 'badge', text: res.model.privacy === 'on-device' ? '本地引擎 · ' + res.model.name : '云端 · ' + res.model.name }),
        el('span', { class: 'hint', text: res.model.latencyMs + ' ms' })
      ]));
      if (res.model.degraded && res.model.error) {
        parts.push(el('div', { class: 'notice notice--warn', style: 'margin-top:10px', html:
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<span>云端模型未调用成功（' + U.esc(res.model.error.code) + '），已自动降级为本地引擎：' + U.esc(res.model.error.message) + '</span>' }));
      }
      if (res.model.truncated) {
        parts.push(el('div', { class: 'notice notice--warn', style: 'margin-top:10px', html:
          '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<span>模型输出达到长度上限，已自动扩大输出预算重试，本条回答仍可能不完整。</span>' }));
      }
    }

    if (res.usedSources && res.usedSources.length) {
      parts.push(el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('span', { class: 'hint', text: '用到：' })
      ].concat(res.usedSources.map(function (s) { return el('span', { class: 'tag', text: s }); }))));
    }

    if (res.citations && res.citations.length) {
      var list = el('ul', { class: 'cite-list' });
      res.citations.forEach(function (c) {
        list.appendChild(el('li', { class: 'cite' }, [
          el('div', { class: 'cite__head' }, [
            el('b', { text: c.sourceName }),
            el('span', { class: 'cite__score', text: '相关度 ' + c.score })
          ]),
          el('p', { class: 'cite__quote', text: c.quote })
        ]));
      });
      parts.push(el('div', { class: 'section', style: 'margin-top:14px' }, [
        el('h3', { class: 'section__title', text: '证据' }), list
      ]));
    }

    if (res.context && res.context.text) {
      parts.push(el('details', { class: 'disclosure', style: 'margin-top:14px' }, [
        el('summary', { text: '查看本次组装的上下文' }),
        el('div', { class: 'disclosure__body' }, [
          el('pre', { class: 'code', text: res.context.text })
        ])
      ]));
    }

    host.appendChild(el('div', { class: 'card section' }, parts));
  }

  /* ============================ 历史 ============================ */

  function renderHistory() {
    var host = document.getElementById('qaHistoryHost');
    if (!host) return;
    host.innerHTML = '';
    var list = MH.store.qa.all().slice().reverse();
    if (!list.length) return;

    var items = list.slice(0, 8).map(function (t) {
      return el('details', { class: 'qa-hist' }, [
        el('summary', {}, [
          el('b', { text: t.question }),
          el('span', { class: 'qa-hist__meta', text: ' · ' + U.fmtRelative(t.at) })
        ]),
        el('div', { class: 'qa-hist__body' }, [
          el('div', { class: 'qa-answer', text: t.answer }),
          t.usedSources && t.usedSources.length
            ? el('div', { class: 'row', style: 'margin-top:8px' }, t.usedSources.map(function (s) { return el('span', { class: 'tag', text: s }); }))
            : null
        ])
      ]);
    });

    host.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '问答历史' }),
        el('span', { class: 'badge', text: MH.store.qa.all().length + ' 条 · 仅本机' })
      ])
    ].concat(items)));
  }

  /* ============================ 交互 ============================ */

  function addDraft(draft) {
    try {
      var item = MH.store.sources.add({
        name: draft.name,
        kind: draft.kind,
        size: draft.size || 0,
        rows: draft.rows || null,
        fields: draft.fields || null,
        text: draft.text,
        persist: ui.persist
      });
      ui.selection.files.push(item.id);
      U.toast('已添加来源：' + item.name + (draft.rows ? '（' + draft.rows.length + ' 行）' : ''), 'ok');
    } catch (e) {
      U.toast(e && e.code === 'QUOTA' ? e.message : ('添加失败：' + (e && e.message ? e.message : e)), 'error', 4500);
    }
  }

  function removeSource(s) {
    MH.store.sources.remove(s.id);
    var i = ui.selection.files.indexOf(s.id);
    if (i >= 0) ui.selection.files.splice(i, 1);
    U.toast('已移除来源：' + s.name, 'ok');
    renderSources();
  }

  function convertToRecords(s) {
    var out = MH.ingest.toRecords(s);
    if (!out.records.length) {
      U.toast('没能从这份数据里认出日期与四项指标列，无法转换', 'warn', 4000);
      return;
    }
    var names = Object.keys(out.matched).map(function (k) {
      var m = MH.metrics.get(k);
      return (m ? m.label : k) + '←' + out.matched[k];
    }).join('，');
    MH.app.confirm({
      title: '转换为记录',
      body: '将 ' + out.records.length + ' 行转换为记录？\n识别到的列：' + (names || '无') +
        (out.dateField ? '\n日期列：' + out.dateField : '\n警告：未识别到日期列，将全部记为今天'),
      confirmText: '转换'
    }).then(function (yes) {
      if (!yes) return;
      var list = MH.store.records.all().concat(out.records);
      MH.store.records.save(list);
      U.toast('已转换并写入 ' + out.records.length + ' 条记录', 'ok');
      MH.app.refreshCurrent();
    });
  }

  function bind(root) {
    var fileInput = U.$('#qaFile', root);
    var drop = U.$('#qaDrop', root);

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
      if (files && files.length) handleFiles(files);
    });

    fileInput.addEventListener('change', function () {
      if (this.files && this.files.length) handleFiles(this.files);
      this.value = '';
    });

    U.$('#qaPersist', root).addEventListener('change', function () { ui.persist = this.checked; });

    U.$('#qaAddText', root).addEventListener('click', function () {
      var text = U.$('#qaPaste', root).value || '';
      if (!text.trim()) { U.toast('请先粘贴内容', 'warn'); return; }
      var name = (U.$('#qaPasteName', root).value || '').trim();
      addDraft(MH.ingest.fromText(text, name));
      U.$('#qaPaste', root).value = '';
      U.$('#qaPasteName', root).value = '';
      renderSources();
    });

    U.$('#qaClearHistory', root).addEventListener('click', function () {
      if (!MH.store.qa.all().length) { U.toast('问答历史已经是空的', 'info'); return; }
      MH.app.confirm({
        title: '清空问答历史',
        body: '清空本机保存的全部问答历史？此操作无法撤销。',
        confirmText: '清空', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.qa.clear();
        renderHistory();
        U.toast('问答历史已清空', 'ok');
      });
    });

    renderSources();
  }

  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files);
    var chain = Promise.resolve();
    arr.forEach(function (file) {
      chain = chain.then(function () {
        return MH.ingest.readFile(file).then(addDraft).catch(function (e) {
          U.toast(String(e && e.message ? e.message : e), 'error', 4500);
        });
      });
    });
    chain.then(renderSources);
  }

  MH.views = MH.views || {};
  MH.views.qa = { render: render };
})(window.MH = window.MH || {});
