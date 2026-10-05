/* 陪伴对话：把最近 14 天统计摘要交给本地服务，取回一段回应。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var lastPayload = null;

  function render(root) {
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '陪伴' }),
        el('p', { class: 'page-desc', text: '这里没有真人，也没有云端模型。回应来自本页内置的本地规则服务，它只能看到最近 14 天的均值与趋势。' })
      ]),
      el('div', { class: 'page-head__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', id: 'cmpClear', text: '清空对话' }),
        el('button', { class: 'btn btn--ghost', type: 'button', id: 'cmpCrisis', text: '求助资源' })
      ])
    ]));

    var log = el('div', { class: 'chat__log', id: 'cmpLog' });
    var input = el('textarea', { class: 'input', id: 'cmpInput', rows: '2', placeholder: '想说点什么？写完按 Ctrl / ⌘ + Enter 发送' });
    var send = el('button', { class: 'btn btn--primary', type: 'button', id: 'cmpSend', text: '发送' });

    var card = el('div', { class: 'card' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '树洞' }),
        el('span', { class: 'badge', text: '本地服务 · 无网络出口' })
      ]),
      el('div', { class: 'chat' }, [
        log,
        el('div', { class: 'chat__composer' }, [input, send])
      ])
    ]);
    root.appendChild(card);

    var disclosure = el('details', { class: 'disclosure', style: 'margin-top:16px' }, [
      el('summary', { text: '查看本次发送给本地服务的内容' }),
      el('div', { class: 'disclosure__body' }, [
        el('p', { class: 'small muted', style: 'margin-bottom:8px', text: '每次发起对话时传输的就是下面这个结构：四项指标的均值、极值、最近值与趋势斜率，不含任何单条记录、日期明细或备注原文。' }),
        el('pre', { class: 'code', id: 'cmpPayload', text: '还没有发起对话。' })
      ])
    ]);
    root.appendChild(disclosure);

    root.appendChild(el('div', { class: 'notice', style: 'margin-top:16px', html:
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10v4m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<span>这不是诊断工具，也不构成医疗建议。若你正处于危机中，请优先联系专业资源（全国心理援助热线 12356，紧急电话 110 / 120）。对话记录同样只保存在本机 localStorage。</span>' }));

    bind(root);
    paintLog();
    if (lastPayload) {
      document.getElementById('cmpPayload').textContent = JSON.stringify(lastPayload, null, 2);
    }
  }

  function bubble(msg) {
    var cls = msg.role === 'me' ? 'bubble--me' : (msg.role === 'sys' ? 'bubble--sys' : 'bubble--ai');
    var node = el('div', { class: 'bubble ' + cls }, [
      el('span', { text: msg.text })
    ]);
    if (msg.tags && msg.tags.length) {
      node.appendChild(el('div', { class: 'bubble__tags' }, msg.tags.map(function (t) {
        return el('span', { class: 'tag', text: t });
      })));
    }
    if (msg.role !== 'sys') node.appendChild(el('span', { class: 'bubble__time', text: U.fmtDateTime(msg.at) }));
    return node;
  }

  function paintLog() {
    var log = document.getElementById('cmpLog');
    if (!log) return;
    log.innerHTML = '';
    var list = MH.store.chat.all();
    if (!list.length) {
      log.appendChild(el('div', { class: 'bubble bubble--sys', text: '这是你的私密空间。说的话只写进本机存储，不会离开这台设备。' }));
      return;
    }
    list.forEach(function (m) { log.appendChild(bubble(m)); });
    log.scrollTop = log.scrollHeight;
  }

  function bind(root) {
    var input = U.$('#cmpInput', root);
    var send = U.$('#cmpSend', root);

    function submit() {
      var text = (input.value || '').trim();
      if (!text) return;
      input.value = '';

      MH.store.chat.append({ role: 'me', text: text });
      paintLog();

      var thinking = el('div', { class: 'bubble bubble--ai', text: '本地服务处理中…' });
      var log = document.getElementById('cmpLog');
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      send.disabled = true;

      // 只取最近 14 天的统计摘要，原始记录不会离开本页存储层
      var summary = MH.stats.summary14(MH.store.records.all());

      MH.models.run('companion', { message: text, summary: summary })
        .then(function (res) {
          thinking.remove();
          var tags = (res.tags || []).slice();
          if (res.degraded && res.error) tags.push('云端失败（' + res.error.code + '），已用本地回复');
          else tags.push(res.privacy === 'on-device' ? '本地引擎' : '云端 · ' + res.modelName);

          var sent = (res.preview && res.preview.kind === 'local')
            ? { message: text, summary: summary }
            : res.preview;

          MH.store.chat.append({
            role: 'ai',
            text: res.text,
            tags: tags,
            payload: { sent: sent, model: { id: res.modelId, name: res.modelName, privacy: res.privacy, degraded: res.degraded } }
          });
          lastPayload = sent;
          var box = document.getElementById('cmpPayload');
          if (box) box.textContent = JSON.stringify(lastPayload, null, 2);
          if (res.resources && res.resources.length) {
            MH.store.chat.append({ role: 'sys', text: '已弹出求助资源卡。随时可以再点右上角「求助资源」查看。' });
          }
          paintLog();
          send.disabled = false;
          input.focus();
          if (res.resources && res.resources.length) MH.app.showCrisis();
          else if (res.truncated) U.toast('模型输出达到长度上限，这条回答可能不完整，已自动扩大输出预算重试', 'warn', 4200);
          else if (res.degraded && res.error) U.toast('云端调用未成功，已改用本地引擎：' + res.error.message, 'warn', 4200);
        })
        .catch(function (err) {
          thinking.remove();
          send.disabled = false;
          U.toast('本地服务出错：' + (err && err.message ? err.message : err), 'error');
        });
    }

    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    U.$('#cmpClear', root).addEventListener('click', function () {
      if (!MH.store.chat.all().length) { U.toast('对话已经是空的', 'info'); return; }
      MH.app.confirm({
        title: '清空对话',
        body: '清空本机保存的全部对话记录？此操作无法撤销。',
        confirmText: '清空', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.chat.clear();
        lastPayload = null;
        var box = document.getElementById('cmpPayload');
        if (box) box.textContent = '还没有发起对话。';
        paintLog();
        U.toast('对话记录已清空', 'ok');
      });
    });

    U.$('#cmpCrisis', root).addEventListener('click', function () { MH.app.showCrisis(); });
  }

  MH.views = MH.views || {};
  MH.views.companion = { render: render };
})(window.MH = window.MH || {});
