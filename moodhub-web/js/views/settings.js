/* 设置：账户口令、信任设备、空闲锁定、数据导入导出、隐私边界说明。 */
(function (MH) {
  'use strict';

  var U = MH.util;
  var el = U.el;

  function render(root) {
    var prefs = MH.store.prefs.get();
    root.innerHTML = '';

    root.appendChild(el('div', { class: 'page-head' }, [
      el('div', { class: 'page-head__text' }, [
        el('h1', { class: 'page-title', text: '设置' }),
        el('p', { class: 'page-desc', text: '这台设备上的一切都在你手里：口令、信任期限、数据去留。' })
      ])
    ]));

    /* ---------- 账户 ---------- */
    var pwdForm = el('form', { class: 'form', id: 'pwdForm', novalidate: true }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'pOld', text: '当前密码' }),
        el('input', { class: 'input', type: 'password', id: 'pOld', autocomplete: 'current-password' }),
        el('p', { class: 'error', id: 'err-pwd', hidden: true })
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'pNew', text: '新密码' }),
        el('input', { class: 'input', type: 'password', id: 'pNew', autocomplete: 'new-password' }),
        el('p', { class: 'hint', text: '至少 6 位。没有找回通道，请自己记牢——它只锁这台设备。' })
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', for: 'pNew2', text: '确认新密码' }),
        el('input', { class: 'input', type: 'password', id: 'pNew2', autocomplete: 'new-password' })
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: '修改密码' })
      ])
    ]);

    root.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '账户' }),
        el('span', { class: 'badge', text: MH.store.auth.username() || '未设置' })
      ]),
      el('div', { class: 'stat-pair', style: 'margin-bottom:16px' }, [
        el('div', { html: '创建于<br><b>' + U.esc(fmt(MH.store.auth.get() && MH.store.auth.get().createdAt)) + '</b>' }),
        el('div', { html: '上次修改<br><b>' + U.esc(fmt(MH.store.auth.get() && MH.store.auth.get().updatedAt)) + '</b>' }),
        el('div', { html: '口令派生<br><b>' + U.esc((MH.store.auth.get() || {}).algo || '—') + '</b>' })
      ]),
      pwdForm
    ]));

    /* ---------- 安全 ---------- */
    var trust = MH.store.trust.get();
    var trusted = MH.store.trust.valid();
    var sess = MH.store.session.get();

    var trustDays = el('select', { class: 'input', id: 'setTrustDays' }, [
      el('option', { value: '1', text: '1 天' }),
      el('option', { value: '7', text: '7 天' }),
      el('option', { value: '30', text: '30 天' })
    ]);
    trustDays.value = String(prefs.trustDays || 7);

    var idle = el('select', { class: 'input', id: 'setIdle' }, [
      el('option', { value: '5', text: '5 分钟' }),
      el('option', { value: '15', text: '15 分钟' }),
      el('option', { value: '30', text: '30 分钟' }),
      el('option', { value: '0', text: '不自动锁定' })
    ]);
    idle.value = String(prefs.idleLockMinutes);

    var themeSel = el('select', { class: 'input', id: 'setTheme' }, [
      el('option', { value: 'auto', text: '跟随系统' }),
      el('option', { value: 'light', text: '浅色' }),
      el('option', { value: 'dark', text: '深色' })
    ]);
    themeSel.value = prefs.theme || 'auto';

    var langSel = el('select', { class: 'input', id: 'setLang' }, [
      el('option', { value: 'zh-CN', text: '中文' }),
      el('option', { value: 'en', text: 'English' })
    ]);
    langSel.value = (MH.i18n && MH.i18n.current()) || 'zh-CN';

    root.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [el('span', { class: 'card__title', text: '安全与外观' })]),

      row('信任此设备',
        trusted
          ? '已信任：' + (trust.label || '本机') + '，' + U.fmtCountdown(MH.store.trust.remaining()) + '到期'
          : '未设置信任，关闭标签页或到期后需要重新输入密码',
        [trustDays, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'setTrustNow', text: trusted ? '续期' : '信任此设备' }),
         el('button', { class: 'btn btn--danger btn--sm', type: 'button', id: 'setTrustClear', text: '撤销信任', disabled: !trusted })]),

      row('空闲自动锁定',
        '无操作超过设定时间就回到登录页。当前解锁方式：' + (sess ? (sess.via === 'trust' ? '信任令牌' : '密码') : '—'),
        [idle]),

      row('外观主题', '深浅色只影响本机的显示。', [themeSel]),

      row('界面语言', '切换后立即生效，并记住你的选择。未收录的文案保留原文。', [langSel]),

      // 关掉的是「自动触发」，卡片里的「引导我看看」与 /引导 指令仍然随时可用
      row('情绪引导',
        '在你说到明显的情绪时，除了正常回应，再给一次结构化的情绪觉察引导：先命名，再读它可能指向的需要，最后留一个问题。它随时可以在卡片里关掉。',
        [el('label', { class: 'check' }, [
          el('input', { type: 'checkbox', id: 'setGuidedAuto', checked: prefs.guidedAuto !== false }),
          el('span', { text: '开启' })
        ])]),

      row('立即锁定', '手动结束本次会话，回到登录页。',
        [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'setLock', text: '锁定' })])
    ]));

    /* ---------- 数据 ---------- */
    var bytes = MH.store.storageUsage();
    var importSel = el('select', { class: 'input', id: 'importMode' }, [
      el('option', { value: 'merge', text: '合并' }),
      el('option', { value: 'replace', text: '替换' })
    ]);
    var fileInput = el('input', { type: 'file', id: 'importFile', accept: '.json,application/json', style: 'display:none' });

    root.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [
        el('span', { class: 'card__title', text: '数据' }),
        el('span', { class: 'badge', text: formatBytes(bytes) + ' · localStorage' })
      ]),
      el('div', { class: 'stat-pair', style: 'margin-bottom:16px' }, [
        el('div', { html: '记录条数<br><b>' + MH.store.records.count() + '</b>' }),
        el('div', { html: '对话条数<br><b>' + MH.store.chat.all().length + '</b>' }),
        el('div', { html: '存储可用<br><b>' + (MH.store.storageAvailable ? '是' : '否') + '</b>' })
      ]),
      row('导出备份', '把记录与对话导出为 JSON 文件，保存到你自己的磁盘。导出前需要重新验证密码。',
        [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'setExport', text: '导出 JSON' })]),
      row('导入备份', '从本应用导出的 JSON 恢复数据。',
        [importSel, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'setImport', text: '选择文件' }), fileInput]),
      row('导入第三方健康数据', '华为、Apple 健康、Google Fit / Health Connect、OPPO、vivo、小米、Garmin 与任意 CSV / Excel 数据，经识别、清洗、去重后写成记录。',
        [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', id: 'setImportHealth', text: '去导入' })]),
      row('清空全部数据', '删除记录、对话与账户，回到全新状态。不可恢复。',
        [el('button', { class: 'btn btn--danger btn--sm', type: 'button', id: 'setWipe', text: '清空' })]),
      el('div', { class: 'notice', style: 'margin-top:16px', html:
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>' +
        '<span>存储边界：数据只写入本设备浏览器的 localStorage，不上传、不同步、无账号、无遥测。清除浏览器数据、卸载浏览器、使用隐私模式或换一台设备，记录都不会跟随。涉及隐私的操作（导出、清空）会要求重新输入密码。</span>' })
    ]));

    /* ---------- 云同步 ---------- */
    if (MH.cloud && MH.cloud.renderSection) {
      try { root.appendChild(MH.cloud.renderSection()); } catch (e) { /* 云同步不可用时不阻塞设置页 */ }
    }

    /* ---------- 声明 ---------- */
    root.appendChild(el('div', { class: 'card section' }, [
      el('div', { class: 'card__head' }, [el('span', { class: 'card__title', text: '关于与声明' })]),
      el('div', { class: 'modal__body' }, [
        el('p', { text: 'MoodHub Web 是一个基于浏览器的本地心情与健康记录工具，定位为 powered by health data 的自我觉察空间：把心情、睡眠、心率、压力放在一起看，观察它们之间的关系。' }),
        el('p', { style: 'margin-top:10px', text: '它不是诊断工具，不构成医疗诊断、治疗或处方建议，也不能替代任何专业服务。所有内容仅供自我觉察与温和引导。' }),
        el('p', { style: 'margin-top:10px', text: '若你正处于心理危机中，请优先联系专业资源：全国统一心理援助热线 12356（24 小时），或紧急电话 110 / 120。' })
      ])
    ]));

    bind(root);
  }

  function fmt(ts) { return ts ? U.fmtDateTime(ts) : '—'; }

  function row(title, desc, controls) {
    return el('div', { class: 'setting-row' }, [
      el('div', { class: 'setting-row__text' }, [
        el('div', { class: 'setting-row__title', text: title }),
        el('div', { class: 'setting-row__desc', text: desc })
      ]),
      el('div', { class: 'setting-row__ctl' }, controls)
    ]);
  }

  function formatBytes(b) {
    if (!b) return '0 KB';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  function bind(root) {
    U.$('#setTrustDays', root).addEventListener('change', function () {
      MH.store.prefs.set({ trustDays: Number(this.value) });
      U.toast('已更新默认信任时长', 'ok');
    });

    U.$('#setTrustNow', root).addEventListener('click', function () {
      var days = Number(U.$('#setTrustDays', root).value) || 7;
      MH.store.prefs.set({ trustDays: days });
      MH.store.trust.grant(days);
      U.toast('已信任此设备 ' + days + ' 天，到期后需重新输入密码', 'ok');
      MH.app.go('settings');
    });

    U.$('#setTrustClear', root).addEventListener('click', function () {
      MH.app.requireReauth('撤销设备信任会让你下次打开时必须输入密码。').then(function (ok) {
        if (!ok) return;
        MH.store.trust.clear();
        U.toast('已撤销信任，下次进入需要密码', 'ok');
        MH.app.go('settings');
      });
    });

    U.$('#setIdle', root).addEventListener('change', function () {
      MH.store.prefs.set({ idleLockMinutes: Number(this.value) });
      MH.app.resetIdleTimer();
      U.toast('已更新空闲锁定设置', 'ok');
    });

    U.$('#setTheme', root).addEventListener('change', function () {
      MH.store.prefs.set({ theme: this.value });
      MH.app.applyTheme();
      U.toast('已切换主题', 'ok');
    });

    var setLang = U.$('#setLang', root);
    if (setLang) setLang.addEventListener('change', function () {
      if (MH.i18n) MH.i18n.setLang(this.value);
    });

    var setGuidedAuto = U.$('#setGuidedAuto', root);
    if (setGuidedAuto) setGuidedAuto.addEventListener('change', function () {
      // 走内核而不是直接写 prefs：重新打开＝清冷静期（唯一合法出口，设计文档 §4.8）
      try {
        if (this.checked) {
          if (MH.guided && MH.guided.enableAuto) MH.guided.enableAuto();
          else MH.store.prefs.set({ guidedAuto: true });
        } else {
          if (MH.guided && MH.guided.disableAuto) MH.guided.disableAuto();
          else MH.store.prefs.set({ guidedAuto: false });
        }
      } catch (e) { /* 设置失败不中断设置页 */ }
      U.toast('已更新情绪引导设置', 'ok');
    });

    U.$('#setLock', root).addEventListener('click', function () { MH.app.lock('manual'); });

    U.$('#pwdForm', root).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = U.$('#err-pwd', root);
      err.hidden = true;
      var old = U.$('#pOld', root).value;
      var nw = U.$('#pNew', root).value;
      var nw2 = U.$('#pNew2', root).value;
      if (nw.length < 6) { err.textContent = '新密码至少 6 位'; err.hidden = false; return; }
      if (nw !== nw2) { err.textContent = '两次输入的新密码不一致'; err.hidden = false; return; }
      var btn = this.querySelector('button[type=submit]');
      btn.disabled = true;
      MH.store.auth.changePassword(old, nw).then(function (ok) {
        btn.disabled = false;
        if (!ok) { err.textContent = '当前密码不正确'; err.hidden = false; return; }
        U.$('#pOld', root).value = U.$('#pNew', root).value = U.$('#pNew2', root).value = '';
        MH.store.session.touch();
        U.toast('密码已更新，下次登录请使用新密码', 'ok');
      });
    });

    U.$('#setExport', root).addEventListener('click', function () {
      MH.app.requireReauth('导出的文件包含你的全部原始记录，请确认是你本人操作。').then(function (ok) {
        if (!ok) return;
        var data = MH.store.exportAll();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'moodhub-backup-' + U.todayISO() + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        U.toast('已导出 ' + data.records.length + ' 条记录', 'ok');
      });
    });

    var toImport = U.$('#setImportHealth', root);
    if (toImport) toImport.addEventListener('click', function () { MH.app.go('import'); });

    U.$('#setImport', root).addEventListener('click', function () { U.$('#importFile', root).click(); });
    U.$('#importFile', root).addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var mode = U.$('#importMode', root).value;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var payload = JSON.parse(String(reader.result));
          var n = MH.store.importAll(payload, mode);
          U.toast('已导入，当前共 ' + n + ' 条记录', 'ok');
          MH.app.refreshCurrent();
        } catch (e2) {
          U.toast('导入失败：' + (e2 && e2.message ? e2.message : '文件无法解析'), 'error', 4000);
        }
      };
      reader.readAsText(file);
      this.value = '';
    });

    U.$('#setWipe', root).addEventListener('click', function () {
      MH.app.requireReauth('清空后本机的记录、对话与账户都会被删除，且无法恢复。').then(function (ok) {
        if (!ok) return;
        return MH.app.confirm({
          title: '清空全部数据',
          body: '本机的记录、对话、问答历史与账户都会被删除，且无法恢复。',
          confirmText: '全部清空', danger: true
        });
      }).then(function (yes) {
        if (!yes) return;
        MH.store.wipeEverything();
        U.toast('本机数据已清空', 'ok');
        MH.app.lock('wiped');
      });
    });
  }

  MH.views = MH.views || {};
  MH.views.settings = { render: render };
})(window.MH = window.MH || {});
