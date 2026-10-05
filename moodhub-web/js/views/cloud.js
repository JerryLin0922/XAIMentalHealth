/* 云同步设置面板：展示状态并提供注册/登录/同步/退出。
   依赖 MH.vault（见 js/core/vault.js）与 MH.cipher。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  function row(title, desc, controls) {
    return el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__text' }, [
        el('div', { class: 'setting-row__title', text: title }),
        el('div', { class: 'setting-row__desc', text: desc })
      ]),
      el('div', { class: 'setting-row__ctl' }, controls)
    ]);
  }

  function renderSection() {
    var v = MH.vault;
    var card = el('div', { class: 'card section' });
    card.appendChild(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__title', text: '云端同步' }),
      el('span', { class: 'badge ' + (v.isCloudLoggedIn() ? 'badge--ok' : 'badge--local'),
        text: v.isCloudLoggedIn() ? '已连接 · ' + (v.currentUser() || '') : '仅本机' })
    ]));

    if (!v.isCloudLoggedIn()) {
      var username = el('input', { class: 'input', type: 'text', id: 'cloudUser', placeholder: '云端用户名', value: MH.store.auth.username() || '' });
      var pwd = el('input', { class: 'input', type: 'password', id: 'cloudPwd', placeholder: '云端密码（用于加密与登录）', autocomplete: 'new-password' });
      var pwd2 = el('input', { class: 'input', type: 'password', id: 'cloudPwd2', placeholder: '再次输入密码', autocomplete: 'new-password' });
      var err = el('p', { class: 'error', id: 'cloudErr', hidden: true });

      var form = el('form', { class: 'form', id: 'cloudForm', novalidate: true }, [
        el('div', { class: 'field' }, [el('label', { class: 'label', text: '云端用户名' }), username]),
        el('div', { class: 'field' }, [el('label', { class: 'label', text: '云端密码' }), pwd]),
        el('div', { class: 'field' }, [el('label', { class: 'label', text: '确认密码' }), pwd2]),
        err,
        el('div', { class: 'row' }, [
          el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn--primary btn--sm', type: 'submit', id: 'cloudSubmit', text: '启用并上传' })
        ])
      ]);
      card.appendChild(form);
      card.appendChild(el('div', { class: 'notice', style: 'margin-top:14px', html:
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3l8 4v5c0 4.4-3.1 7.6-8 9-4.9-1.4-8-4.6-8-9V7l8-4Z" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>' +
        '<span>启用后，本机数据会以<b>密文</b>形式同步到云端：服务端只保存加密信封，<b>无法读取你的心情、资料或业务数据</b>。云端密码用于解密，不离开你的设备，服务端仅持有它的登录校验哈希。</span>' }));

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        err.hidden = true;
        var u = username.value.trim(), p = pwd.value, p2 = pwd2.value;
        if (!u || u.length < 2) { err.textContent = '用户名至少 2 字'; err.hidden = false; return; }
        if (p.length < 6) { err.textContent = '云端密码至少 6 位'; err.hidden = false; return; }
        if (p !== p2) { err.textContent = '两次密码不一致'; err.hidden = false; return; }
        var btn = U.$('#cloudSubmit', card); btn.disabled = true; btn.textContent = '加密上传中…';
        v.register(u, p).then(function () {
          U.toast('云端同步已启用，数据已加密上传', 'ok');
          MH.app.go('settings');
        }).catch(function (ex) {
          btn.disabled = false; btn.textContent = '启用并上传';
          err.textContent = ex && ex.message ? ex.message : '启用失败';
          err.hidden = false;
        });
      });
    } else {
      card.appendChild(el('div', { class: 'stat-pair', style: 'margin-bottom:16px' }, [
        el('div', { html: '当前用户<br><b>' + U.esc(v.currentUser() || '') + '</b>' }),
        el('div', { html: '模式<br><b>端到端加密同步</b>' })
      ]));
      card.appendChild(row('上传到云端', '把本机当前数据加密后推送到云端（全量快照）。',
        [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'cloudPush', text: '立即上传' })]));
      card.appendChild(row('从云端恢复', '拉取云端密文并解密、合并到本机。',
        [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'cloudPull', text: '从云端恢复' })]));
      card.appendChild(row('退出云登录', '清除本机会话里的密钥材料，停止同步。云端数据保留，可随时再登录。',
        [el('button', { class: 'btn btn--danger btn--sm', type: 'button', id: 'cloudLogout', text: '退出' })]));

      U.$('#cloudPush', card).addEventListener('click', function () {
        this.disabled = true; var self = this; self.textContent = '上传中…';
        v.push().then(function () { U.toast('已加密上传', 'ok'); self.disabled = false; self.textContent = '立即上传'; },
          function (ex) { self.disabled = false; self.textContent = '立即上传'; U.toast('上传失败：' + (ex.message || ''), 'error'); });
      });
      U.$('#cloudPull', card).addEventListener('click', function () {
        this.disabled = true; var self = this; self.textContent = '恢复中…';
        v.pull().then(function (n) { U.toast('已从云端恢复 ' + (n || 0) + ' 条记录', 'ok'); self.disabled = false; self.textContent = '从云端恢复'; MH.app.refreshCurrent(); },
          function (ex) { self.disabled = false; self.textContent = '从云端恢复'; U.toast('恢复失败：' + (ex.message || ''), 'error'); });
      });
      U.$('#cloudLogout', card).addEventListener('click', function () {
        v.logout().then(function () { U.toast('已退出云登录', 'ok'); MH.app.go('settings'); });
      });
    }
    return card;
  }

  MH.cloud = { renderSection: renderSection };
})(window.MH = window.MH || {});
