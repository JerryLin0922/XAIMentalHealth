/* 登录页：本机口令校验 / 创建账户 / 保存密码并信任设备。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  var ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7v6m0 3h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  var state = { mode: null, busy: false };

  function points() {
    return [
      ['四指标同屏', '心情、睡眠、心率、压力，各自量程与配色互不混淆。'],
      ['数据不出设备', '写入浏览器 localStorage，没有账号、没有服务器、没有同步。'],
      ['对话只发摘要', '陪伴服务只拿到近 14 天均值与趋势，看不到你的原始记录。']
    ];
  }

  function render(root) {
    var exists = MH.store.auth.exists();
    state.mode = exists ? 'login' : 'register';
    draw(root);
  }

  function draw(root) {
    var exists = MH.store.auth.exists();
    var username = MH.store.auth.username();
    var prefs = MH.store.prefs.get();

    root.innerHTML = '';
    root.className = 'view view--auth';

    var aside = el('div', { class: 'auth__aside' }, [
      el('div', { class: 'auth__brand' }, [
        el('span', { html: '<svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="9" fill="rgba(255,255,255,.18)"/><path d="M7 19c3.2 0 3.2-6 6.4-6s3.2 6 6.4 6 3.6-3.4 4.8-4.6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>' }),
        el('span', { text: 'MoodHub Web' })
      ]),
      el('h1', { text: exists ? '欢迎回来' : '给自己留一个安静的角落' }),
      el('p', { text: '记录心情、睡眠、心率与压力，然后看着它们慢慢变化。这里没有评分，也没有排行榜。' }),
      el('div', { class: 'auth__points' }, points().map(function (p) {
        return el('div', { class: 'auth__point' }, [
          el('span', { html: ICON_CHECK }),
          el('span', { html: '<b>' + U.esc(p[0]) + '</b><br>' + U.esc(p[1]) })
        ]);
      })),
      el('div', { class: 'auth__foot', text: '这不是诊断工具，也不能替代专业诊疗。若你正处于危机中，请优先联系专业资源（全国心理援助热线 12356，紧急电话 110 / 120）。' })
    ]);

    var main = el('div', { class: 'auth__main' });
    var form = el('form', { class: 'form', novalidate: true });

    main.appendChild(el('h2', { class: 'auth__title', text: exists ? '输入密码解锁' : '设置你的本机密码' }));
    main.appendChild(el('p', { class: 'muted small', text: exists
      ? '这台设备上已保存本地账户：' + username
      : '密码只用于锁住这台设备上的数据，不会被发送到任何地方，也没有"找回"通道。' }));

    if (!MH.store.storageAvailable) {
      main.appendChild(el('div', { class: 'notice notice--danger', html: ICON_WARN + '<span>当前浏览器禁用了本地存储（可能处于隐私模式），本次记录将无法保存。</span>' }));
    }

    // 用户名
    var userField = el('div', { class: 'field' }, [
      el('label', { class: 'label', for: 'authUser', text: '用户名' }),
      el('input', { class: 'input', id: 'authUser', name: 'username', autocomplete: 'username', value: username, disabled: !!exists, placeholder: '中英文均可，2–24 字' }),
      el('p', { class: 'error', id: 'err-username', hidden: true })
    ]);
    form.appendChild(userField);

    // 密码
    var pwdWrap = el('div', { class: 'input-wrap' }, [
      el('input', { class: 'input', id: 'authPwd', type: 'password', autocomplete: exists ? 'current-password' : 'new-password', placeholder: exists ? '输入密码' : '至少 6 位' }),
      el('button', { class: 'iconbtn iconbtn--in', type: 'button', id: 'authToggle', 'aria-label': '显示密码', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>' })
    ]);
    form.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'label', for: 'authPwd', text: '密码' }),
      pwdWrap,
      el('p', { class: 'error', id: 'err-password', hidden: true })
    ]));

    if (!exists) {
      form.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'authPwd2', text: '确认密码' }),
        el('input', { class: 'input', id: 'authPwd2', type: 'password', autocomplete: 'new-password' }),
        el('p', { class: 'error', id: 'err-password2', hidden: true })
      ]));
    }

    // 信任设备
    var trustSelect = el('select', { class: 'input', id: 'authTrustDays', style: 'width:auto;min-width:120px;padding:6px 30px 6px 10px;' }, [
      el('option', { value: '1', text: '1 天' }),
      el('option', { value: '7', text: '7 天' }),
      el('option', { value: '30', text: '30 天' })
    ]);
    trustSelect.value = String(prefs.trustDays || 7);

    form.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', id: 'authRemember' }),
        el('span', { text: '保存密码并信任此设备' })
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'hint', text: '信任有效期' }),
        trustSelect
      ]),
      el('p', { class: 'hint', text: '勾选后，本机只保存一枚随机令牌与到期时间，到期会自动要求重新输入密码。口令本身不会被写进任何存储。' })
    ]));

    var submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: exists ? '解锁' : '创建并进入' });
    form.appendChild(submit);

    if (exists) {
      form.appendChild(el('div', { class: 'row', style: 'justify-content:space-between' }, [
        el('span', { class: 'hint', text: '忘记密码无法找回，只能清空本机数据重来。' }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'authReset', text: '清空并重设' })
      ]));
    }

    main.appendChild(form);
    main.appendChild(el('p', { class: 'auth__switch muted', text: '数据保存在这台设备的浏览器里。清除浏览器数据、更换设备或换浏览器，记录都不会跟着走。' }));

    var wrap = el('div', { class: 'auth' }, [aside, main]);
    root.appendChild(wrap);

    bind(root, exists, submit);
    var first = exists ? U.$('#authPwd', root) : U.$('#authUser', root);
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function setErr(root, id, msg) {
    var node = U.$('#' + id, root);
    var input = U.$('#' + id.replace('err-', 'auth').replace('username', 'User').replace('password2', 'Pwd2').replace('password', 'Pwd'), root);
    if (node) { node.textContent = msg || ''; node.hidden = !msg; }
    if (input && input.classList) {
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
  }

  function clearErrs(root) {
    ['err-username', 'err-password', 'err-password2'].forEach(function (id) { setErr(root, id, ''); });
  }

  function bind(root, exists, submit) {
    var toggle = U.$('#authToggle', root);
    if (toggle) toggle.addEventListener('click', function () {
      var i = U.$('#authPwd', root);
      i.type = i.type === 'password' ? 'text' : 'password';
    });

    var resetBtn = U.$('#authReset', root);
    if (resetBtn) resetBtn.addEventListener('click', function () {
      MH.app.confirm({
        title: '清空并重设',
        body: '这会删除本机全部记录、对话与账户，且无法恢复。确定继续吗？',
        confirmText: '清空并重设', danger: true
      }).then(function (yes) {
        if (!yes) return;
        MH.store.wipeEverything();
        U.toast('本机数据已清空，可以重新设置密码', 'ok');
        draw(root);
      });
    });

    root.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.busy) return;
      clearErrs(root);

      var username = (U.$('#authUser', root).value || '').trim();
      var pwd = U.$('#authPwd', root).value || '';
      var pwd2 = exists ? pwd : (U.$('#authPwd2', root).value || '');
      var remember = U.$('#authRemember', root).checked;
      var days = Number(U.$('#authTrustDays', root).value) || 7;

      var bad = false;
      if (!exists) {
        if (username.length < 2 || username.length > 24) { setErr(root, 'err-username', '用户名长度需在 2–24 字之间'); bad = true; }
        if (pwd.length < 6) { setErr(root, 'err-password', '密码至少 6 位'); bad = true; }
        if (pwd !== pwd2) { setErr(root, 'err-password2', '两次输入的密码不一致'); bad = true; }
      } else if (!pwd) {
        setErr(root, 'err-password', '请输入密码'); bad = true;
      }
      if (bad) return;

      state.busy = true;
      submit.disabled = true;
      var label = submit.textContent;
      submit.textContent = exists ? '校验中…' : '创建中…';

      var work = exists
        ? MH.store.auth.verify(pwd).then(function (ok) {
            if (!ok) { setErr(root, 'err-password', '密码不正确'); return false; }
            return true;
          })
        : MH.store.auth.create(username, pwd).then(function () { return true; });

      work.then(function (ok) {
        if (!ok) return false;
        MH.store.prefs.set({ trustDays: days });
        if (remember) MH.store.trust.grant(days);
        else MH.store.trust.clear();
        MH.store.session.open(exists ? MH.store.auth.username() : username, 'password');
        U.toast(remember ? ('已信任此设备，' + days + ' 天内无需重复输入密码') : '已解锁（关闭标签页后需要重新输入密码）', 'ok', 3200);
        MH.app.unlock();
        return true;
      }).catch(function (err) {
        U.toast('出错了：' + (err && err.message ? err.message : err), 'error', 4000);
      }).then(function () {
        state.busy = false;
        submit.disabled = false;
        submit.textContent = label;
      });
    });
  }

  MH.views = MH.views || {};
  MH.views.auth = { render: render };
})(window.MH = window.MH || {});
