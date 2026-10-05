/* 应用外壳：路由、解锁 / 锁定、空闲自动锁定、重新验证、危机求助。 */
(function (MH) {
  'use strict';

  var U = MH.util;

  var ROUTES = ['dashboard', 'records', 'import', 'qa', 'companion', 'models', 'settings'];
  var state = { route: 'dashboard', unlocked: false, idleTimer: null, reauthResolve: null };

  /* ============================ 主题 ============================ */

  function applyTheme() {
    var mode = MH.store.prefs.get().theme || 'auto';
    var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#16181a' : '#f6f4f0');
  }

  /* ============================ 路由 ============================ */

  function showView(name) {
    ['auth', 'dashboard', 'records', 'import', 'qa', 'companion', 'models', 'settings'].forEach(function (v) {
      var node = document.getElementById('view-' + v);
      if (node) node.hidden = v !== name;
    });
  }

  function renderRoute(name) {
    var node = document.getElementById('view-' + name);
    if (!node) return;
    node.hidden = false;
    try {
      if (MH.views[name] && MH.views[name].render) MH.views[name].render(node);
    } catch (e) {
      // 渲染异常时不能留下一个"点了没反应"的死页面，至少给出可读的错误与重试入口
      node.innerHTML = '';
      var card = U.el('div', { class: 'card' }, [
        U.el('h2', { class: 'card__title', text: '这个页面加载失败了' }),
        U.el('p', { class: 'muted small', style: 'margin-top:8px', text: String(e && e.message ? e.message : e) })
      ]);
      var retry = U.el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: '重试' });
      retry.addEventListener('click', function () { go(name); });
      card.appendChild(U.el('div', { class: 'row', style: 'margin-top:14px' }, [retry]));
      node.appendChild(card);
      U.toast('页面渲染出错：' + (e && e.message ? e.message : e), 'error', 5000);
    }
  }

  function go(name) {
    if (ROUTES.indexOf(name) < 0) name = 'dashboard';
    state.route = name;
    showView(name);
    renderRoute(name);
    U.$$('[data-route]').forEach(function (b) {
      if (b.dataset.route === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function refreshCurrent() {
    if (!state.unlocked) return;
    if (state.route === 'records' && MH.views.records.refresh) MH.views.records.refresh();
    else renderRoute(state.route);
  }

  /* ============================ 解锁 / 锁定 ============================ */

  function unlock() {
    state.unlocked = true;
    document.getElementById('app').dataset.state = 'unlocked';
    document.getElementById('topbar').hidden = false;
    document.getElementById('tabbar').hidden = false;
    var chip = document.getElementById('userChip');
    if (chip) chip.textContent = MH.store.auth.username() || '本机账户';
    resetIdleTimer();
    go(state.route);
  }

  function lock(reason) {
    state.unlocked = false;
    MH.store.session.clear();
    document.getElementById('app').dataset.state = 'locked';
    document.getElementById('topbar').hidden = true;
    document.getElementById('tabbar').hidden = true;
    MH.views.records.closeEditor();
    showView('auth');
    MH.views.auth.render(document.getElementById('view-auth'));
    if (reason === 'idle') U.toast('长时间没有操作，已自动锁定', 'info', 3200);
    else if (reason === 'manual') U.toast('已锁定', 'ok');
  }

  /** 启动时判断是否可以直接进入。 */
  function bootstrap() {
    if (!MH.store.auth.exists()) { lock(); return; }
    if (MH.store.trust.valid()) {
      MH.store.session.open(MH.store.auth.username(), 'trust');
      unlock();
      var left = MH.store.trust.remaining();
      U.toast('已通过信任令牌进入，' + U.fmtCountdown(left) + '到期需重新输入密码', 'info', 3600);
      return;
    }
    var sess = MH.store.session.get();
    if (sess && sess.username === MH.store.auth.username() && !MH.store.session.idleExpired()) {
      unlock();
      return;
    }
    lock();
  }

  /* ============================ 空闲锁定 ============================ */

  function resetIdleTimer() {
    MH.store.session.touch();
    if (state.idleTimer) clearInterval(state.idleTimer);
    state.idleTimer = setInterval(function () {
      if (!state.unlocked) return;
      if (MH.store.session.idleExpired()) lock('idle');
    }, 20000);
  }

  /* ============================ 重新验证 ============================ */

  function requireReauth(reason) {
    var modal = document.getElementById('modalReauth');
    var input = document.getElementById('reauthPwd');
    var err = document.getElementById('reauthErr');
    var reasonEl = document.getElementById('reauthReason');
    if (reasonEl) reasonEl.textContent = reason || '这项操作涉及你的本地数据，需要先确认是你本人。';
    input.value = '';
    err.hidden = true;
    modal.hidden = false;
    setTimeout(function () { input.focus(); }, 40);

    return new Promise(function (resolve) {
      state.reauthResolve = resolve;
    });
  }

  function closeReauth(result) {
    var modal = document.getElementById('modalReauth');
    modal.hidden = true;
    MH.store.session.touch();
    if (state.reauthResolve) { state.reauthResolve(result); state.reauthResolve = null; }
  }

  /* ============================ 通用确认弹窗 ============================ */

  var confirmResolve = null;

  /**
   * 应用内确认弹窗，替代 window.confirm。
   * 原因：部分内嵌 WebView / 无痕环境会屏蔽原生模态对话框，
   * 被屏蔽时 confirm() 直接返回 false，导致按钮点了"毫无反应"。
   * 弹窗不可用时才回退到 window.confirm，且失败一律按"取消"处理。
   * @returns {Promise<boolean>}
   */
  function confirmDialog(opts) {
    var o = opts || {};
    var modal = document.getElementById('modalConfirm');
    var titleEl = document.getElementById('confirmTitle');
    var bodyEl = document.getElementById('confirmBody');
    var okEl = document.getElementById('confirmOk');

    if (!modal || !titleEl || !okEl) {
      if (typeof window.confirm === 'function') {
        try { return Promise.resolve(!!window.confirm(o.body || o.title || '确认执行该操作？')); }
        catch (e) { /* 被环境禁用，按取消处理 */ }
      }
      return Promise.resolve(false);
    }

    titleEl.textContent = o.title || '确认操作';
    if (bodyEl) bodyEl.textContent = o.body || '';
    okEl.textContent = o.confirmText || '确认';
    okEl.className = 'btn ' + (o.danger ? 'btn--danger' : 'btn--primary');
    modal.hidden = false;

    setTimeout(function () { if (okEl && typeof okEl.focus === 'function') okEl.focus(); }, 40);

    return new Promise(function (resolve) { confirmResolve = resolve; });
  }

  function closeConfirm(result) {
    var modal = document.getElementById('modalConfirm');
    if (modal) modal.hidden = true;
    if (confirmResolve) { confirmResolve(!!result); confirmResolve = null; }
  }

  /* ============================ 危机求助 ============================ */

  var crisisReturnFocus = null;

  function showCrisis() {
    var list = document.getElementById('crisisList');
    if (list) {
      list.innerHTML = '';
      (MH.localService.resources || []).forEach(function (r) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.textContent = r.name;
        var b = document.createElement('b');
        b.textContent = r.contact;
        li.appendChild(name);
        li.appendChild(b);
        list.appendChild(li);
      });
    }
    var modal = document.getElementById('modalCrisis');
    if (!modal) return;
    crisisReturnFocus = document.activeElement;
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
    var btn = modal.querySelector('[data-crisis-close]');
    if (btn) setTimeout(function () { btn.focus(); }, 40);
  }

  /** 关闭危机卡：隐藏弹窗 + 交还焦点，让用户可以继续操作。 */
  function closeCrisis() {
    var modal = document.getElementById('modalCrisis');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    if (crisisReturnFocus && document.contains(crisisReturnFocus)) {
      try { crisisReturnFocus.focus(); } catch (e) {}
    }
    crisisReturnFocus = null;
  }

  /* ============================ 示例数据 ============================ */

  var NOTES = ['', '', '加班到十点', '晚上散了会儿步', '喝了咖啡，心跳有点快', '和朋友聊了很久', '什么都没做', '开会有点窒息', '睡得很沉', '早上没赶上闹钟'];

  function demoData() {
    var out = [];
    var today = U.todayISO();
    for (var i = 20; i >= 0; i--) {
      var d = U.addDays(today, -i);
      var wd = U.parseISODate(d).getDay();
      var weekend = wd === 0 || wd === 6;
      var trend = (20 - i) * 0.02;                       // 略微向好
      var sleep = U.clamp(6.9 + Math.sin(i / 2.6) * 0.85 + (weekend ? 0.8 : -0.25) + (Math.random() - 0.5) * 0.7, 3.5, 10);
      sleep = Math.round(sleep * 2) / 2;
      var stress = Math.round(U.clamp(6.2 - (sleep - 6.5) * 0.75 + (Math.random() - 0.5) * 2.4 - trend * 6, 0, 10));
      var mood = Math.round(U.clamp(2.4 + (sleep - 6.5) * 0.5 - (stress - 5) * 0.3 + trend + (Math.random() - 0.5) * 0.9, 1, 5));
      var hr = Math.round(U.clamp(65 + (stress - 5) * 1.5 + (7 - sleep) * 1.2 + (Math.random() - 0.5) * 4, 48, 96));
      out.push({
        date: d,
        time: '',
        mood: mood,
        sleep: sleep,
        heartRate: hr,
        stress: stress,
        note: NOTES[Math.floor(Math.random() * NOTES.length)],
        createdAt: Date.now() - i * 86400000,
        updatedAt: Date.now() - i * 86400000
      });
    }
    return out;
  }

  /* ============================ 初始化 ============================ */

  function bindShell() {
    U.$$('[data-route]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.route); });
    });
    document.getElementById('btnLock').addEventListener('click', function () { lock('manual'); });

    var reauthForm = document.getElementById('reauthForm');
    reauthForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pwd = document.getElementById('reauthPwd').value;
      var err = document.getElementById('reauthErr');
      var btn = reauthForm.querySelector('button[type=submit]');
      btn.disabled = true;
      MH.store.auth.verify(pwd).then(function (ok) {
        btn.disabled = false;
        if (!ok) { err.textContent = '密码不正确'; err.hidden = false; return; }
        closeReauth(true);
      });
    });
    var rt = document.getElementById('reauthToggle');
    rt.addEventListener('click', function () {
      var i = document.getElementById('reauthPwd');
      i.type = i.type === 'password' ? 'text' : 'password';
    });
    U.$$('[data-reauth-close]').forEach(function (n) {
      n.addEventListener('click', function () { closeReauth(false); });
    });
    U.$$('[data-crisis-close]').forEach(function (n) {
      n.addEventListener('click', closeCrisis);
    });

    var confirmOk = document.getElementById('confirmOk');
    if (confirmOk) confirmOk.addEventListener('click', function () { closeConfirm(true); });
    U.$$('[data-confirm-close]').forEach(function (n) {
      n.addEventListener('click', function () { closeConfirm(false); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = document.getElementById('modalReauth');
      if (m && !m.hidden) closeReauth(false);
      var c = document.getElementById('modalCrisis');
      if (c && !c.hidden) closeCrisis();
      var cf = document.getElementById('modalConfirm');
      if (cf && !cf.hidden) closeConfirm(false);
      var md = document.getElementById('modalModel');
      if (md && !md.hidden && MH.views.models && MH.views.models.closeDetail) MH.views.models.closeDetail();
    });

    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach(function (evt) {
      document.addEventListener(evt, function () {
        if (state.unlocked) MH.store.session.touch();
      }, { passive: true });
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', applyTheme);
    }
  }

  function init() {
    applyTheme();
    MH.views.records.initEditor();
    bindShell();
    bootstrap();
  }

  MH.app = {
    init: init,
    go: go,
    refreshCurrent: refreshCurrent,
    unlock: unlock,
    lock: lock,
    applyTheme: applyTheme,
    resetIdleTimer: resetIdleTimer,
    requireReauth: requireReauth,
    confirm: confirmDialog,
    closeConfirm: closeConfirm,
    showCrisis: showCrisis,
    closeCrisis: closeCrisis,
    route: function () { return state.route; }
  };
  MH.demoData = demoData;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.MH = window.MH || {});
