/* ------------------------------------------------------------------
   本地数据仓库。唯一的持久化介质是 localStorage / sessionStorage。
   本文件不含任何网络调用；所有读写失败都会降级为内存态并给出提示。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var NS = 'moodhub.v1.';
  var K = {
    auth: NS + 'auth',
    records: NS + 'records',
    chat: NS + 'chat',
    prefs: NS + 'prefs',
    trust: NS + 'trust',
    sources: NS + 'qa.sources',   // 勾选了「保存到本机」的问答数据源
    qa: NS + 'qa.turns',          // 问答历史（仅本机）
    models: NS + 'models',        // 模型连接 / 场景选择 / 外发授权 / 调用日志
    imports: NS + 'imports'       // 第三方健康数据导入历史（只存统计摘要，不存原始数据）
  };
  var SESSION_KEY = NS + 'session';
  var SESSION_MODEL_KEYS = NS + 'models.keys';   // 「仅本次会话」的 API Key

  /** localStorage 里保存的问答源文本总预算（字符）。UTF-16 存储，留足余量。 */
  var SOURCE_BUDGET_CHARS = 600000;

  var memory = {};           // localStorage 不可用时的降级容器
  var usable = (function () {
    try {
      var t = NS + '__t';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return true;
    } catch (e) { return false; }
  })();

  function lsGet(key) {
    try { return usable ? localStorage.getItem(key) : (key in memory ? memory[key] : null); }
    catch (e) { return null; }
  }
  function lsSet(key, val) {
    try {
      if (usable) localStorage.setItem(key, val);
      else memory[key] = val;
      return true;
    } catch (e) {
      MH.util.toast('本机存储写入失败，可能是浏览器隐私模式或空间已满', 'error', 4000);
      return false;
    }
  }
  function lsRemove(key) {
    try { if (usable) localStorage.removeItem(key); else delete memory[key]; } catch (e) {}
  }

  function readJSON(key, fallback) {
    var raw = lsGet(key);
    if (raw == null) return fallback;
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { return lsSet(key, JSON.stringify(value)); }

  function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, v) { try { sessionStorage.setItem(key, v); } catch (e) {} }
  function ssRemove(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  /* ============================ 偏好 ============================ */

  var DEFAULT_PREFS = {
    theme: 'auto',           // auto | light | dark
    trustDays: 7,            // 信任设备时长（天）
    idleLockMinutes: 15,     // 无操作自动锁定（分钟），0 = 不自动锁定
    rangeDays: 14,           // 看板默认区间
    qaTopK: 4,               // 问答检索返回的证据块数量
    qaContextChars: 12000    // 组装给本地服务的上下文字符预算
  };

  var prefs = {
    get: function () {
      var p = readJSON(K.prefs, {});
      var out = {};
      Object.keys(DEFAULT_PREFS).forEach(function (k) {
        out[k] = (k in p) ? p[k] : DEFAULT_PREFS[k];
      });
      return out;
    },
    set: function (patch) {
      var next = Object.assign(prefs.get(), patch || {});
      writeJSON(K.prefs, next);
      return next;
    }
  };

  /* ============================ 记录 ============================ */

  function normalize(rec) {
    return {
      id: rec.id || MH.util.uid(),
      date: String(rec.date || MH.util.todayISO()).slice(0, 10),
      time: rec.time || '',
      mood: rec.mood == null || rec.mood === '' ? null : Number(rec.mood),
      sleep: rec.sleep == null || rec.sleep === '' ? null : Number(rec.sleep),
      heartRate: rec.heartRate == null || rec.heartRate === '' ? null : Number(rec.heartRate),
      stress: rec.stress == null || rec.stress === '' ? null : Number(rec.stress),
      note: String(rec.note || '').slice(0, 500),
      createdAt: rec.createdAt || Date.now(),
      updatedAt: rec.updatedAt || Date.now()
    };
  }

  var records = {
    all: function () {
      var list = readJSON(K.records, []);
      if (!Array.isArray(list)) return [];
      return list.map(normalize).sort(function (a, b) {
        if (a.date === b.date) return (a.createdAt || 0) - (b.createdAt || 0);
        return a.date < b.date ? -1 : 1;
      });
    },
    save: function (list) { return writeJSON(K.records, list.map(normalize)); },
    add: function (rec) {
      var list = records.all();
      var item = normalize(rec);
      list.push(item);
      records.save(list);
      return item;
    },
    update: function (id, patch) {
      var list = records.all(), hit = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          list[i] = normalize(Object.assign({}, list[i], patch, { updatedAt: Date.now() }));
          hit = list[i];
          break;
        }
      }
      if (hit) records.save(list);
      return hit;
    },
    remove: function (id) {
      var list = records.all().filter(function (r) { return r.id !== id; });
      records.save(list);
      return list.length;
    },
    get: function (id) {
      var list = records.all();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },
    clear: function () { lsRemove(K.records); },
    count: function () { return records.all().length; }
  };

  /* ============================ 对话 ============================ */

  var chat = {
    all: function () {
      var list = readJSON(K.chat, []);
      return Array.isArray(list) ? list : [];
    },
    append: function (msg) {
      var list = chat.all();
      var item = {
        id: msg.id || MH.util.uid(),
        role: msg.role === 'me' ? 'me' : (msg.role === 'sys' ? 'sys' : 'ai'),
        text: String(msg.text || ''),
        at: msg.at || Date.now(),
        tags: msg.tags || null,
        payload: msg.payload || null      // 仅保存「本次发送给本地服务的摘要」，便于自查
      };
      list.push(item);
      if (list.length > 300) list = list.slice(-300);
      writeJSON(K.chat, list);
      return item;
    },
    clear: function () { lsRemove(K.chat); }
  };

  /* ============================ 问答数据源 ============================ */

  // 未勾选「保存到本机」的来源只活在内存里，刷新即消失
  var runtimeSources = [];

  function normalizeSource(s) {
    return {
      id: s.id || MH.util.uid(),
      name: String(s.name || '未命名来源').slice(0, 120),
      kind: s.kind || 'text',            // csv | json | text
      size: Number(s.size) || 0,
      addedAt: s.addedAt || Date.now(),
      persist: !!s.persist,
      // 结构化数据（csv / json 解析结果），供数值计算使用
      rows: Array.isArray(s.rows) ? s.rows : null,
      fields: Array.isArray(s.fields) ? s.fields : null,
      // 扁平化后的纯文本，供检索使用
      text: String(s.text || '').slice(0, 200000),
      note: String(s.note || '').slice(0, 200)
    };
  }

  var sources = {
    /** 持久化来源 + 本次会话的临时来源。 */
    all: function () {
      var persisted = readJSON(K.sources, []);
      if (!Array.isArray(persisted)) persisted = [];
      return persisted.map(normalizeSource).concat(runtimeSources.map(normalizeSource));
    },
    persistedChars: function () {
      var list = readJSON(K.sources, []);
      if (!Array.isArray(list)) return 0;
      return list.reduce(function (n, s) { return n + String(s.text || '').length; }, 0);
    },
    budget: SOURCE_BUDGET_CHARS,
    add: function (s) {
      var item = normalizeSource(s);
      if (item.persist) {
        var list = readJSON(K.sources, []);
        if (!Array.isArray(list)) list = [];
        var used = sources.persistedChars();
        if (used + item.text.length > SOURCE_BUDGET_CHARS) {
          var err = new Error('本机问答源已用 ' + Math.round(used / 1000) + 'k 字符，超出 ' +
            Math.round(SOURCE_BUDGET_CHARS / 1000) + 'k 预算。请移除一些来源，或改为「仅本次会话」。');
          err.code = 'QUOTA';
          throw err;
        }
        list.push(item);
        if (!writeJSON(K.sources, list)) {
          var e2 = new Error('本机存储写入失败，可能是空间已满');
          e2.code = 'QUOTA';
          throw e2;
        }
      } else {
        runtimeSources.push(item);
      }
      return item;
    },
    remove: function (id) {
      var list = readJSON(K.sources, []);
      if (Array.isArray(list)) writeJSON(K.sources, list.filter(function (s) { return s.id !== id; }));
      runtimeSources = runtimeSources.filter(function (s) { return s.id !== id; });
    },
    clear: function () {
      lsRemove(K.sources);
      runtimeSources = [];
    },
    get: function (id) {
      var list = sources.all();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }
  };

  /* ============================ 问答历史 ============================ */

  var qa = {
    all: function () {
      var list = readJSON(K.qa, []);
      return Array.isArray(list) ? list : [];
    },
    append: function (turn) {
      var list = qa.all();
      var item = {
        id: turn.id || MH.util.uid(),
        question: String(turn.question || '').slice(0, 1000),
        answer: String(turn.answer || '').slice(0, 8000),
        customPrompt: String(turn.customPrompt || '').slice(0, 2000),
        usedSources: Array.isArray(turn.usedSources) ? turn.usedSources.slice(0, 30) : [],
        citations: Array.isArray(turn.citations) ? turn.citations.slice(0, 12) : [],
        contextChars: Number(turn.contextChars) || 0,
        mode: turn.mode || 'local',
        at: turn.at || Date.now()
      };
      list.push(item);
      if (list.length > 60) list = list.slice(-60);
      writeJSON(K.qa, list);
      return item;
    },
    clear: function () { lsRemove(K.qa); }
  };

  /* ============================ 模型管理 ============================ */

  var DEFAULT_MODEL_STATE = {
    connections: [],                                     // 云端连接（持久部分）
    active: { companion: 'local-rules', qa: 'local-grounded' },
    privacy: { allowExternal: false, ackedAt: null },    // 是否允许数据离开本设备
    logs: []                                             // 最近调用日志（仅本机）
  };

  function readModelState() {
    var s = readJSON(K.models, {});
    if (!s || typeof s !== 'object') s = {};
    return {
      connections: Array.isArray(s.connections) ? s.connections : [],
      active: Object.assign({}, DEFAULT_MODEL_STATE.active, s.active || {}),
      privacy: Object.assign({}, DEFAULT_MODEL_STATE.privacy, s.privacy || {}),
      logs: Array.isArray(s.logs) ? s.logs : []
    };
  }

  function writeModelState(s) { return writeJSON(K.models, s); }

  function readSessionKeys() {
    var raw = ssGet(SESSION_MODEL_KEYS);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  function writeSessionKeys(obj) { ssSet(SESSION_MODEL_KEYS, JSON.stringify(obj)); }

  var models = {
    state: function () { return readModelState(); },

    activeFor: function (scenario) {
      var s = readModelState();
      return s.active[scenario] || (MH.modelRegistry.SCENARIOS[scenario] || {}).defaultModel || 'local-rules';
    },
    setActive: function (scenario, modelId) {
      var s = readModelState();
      s.active[scenario] = modelId;
      writeModelState(s);
      return s.active;
    },

    /** 连接列表（把 session 里的 key 合并进来）。 */
    connections: function () {
      var keys = readSessionKeys();
      return readModelState().connections.map(function (c) {
        return Object.assign({}, c, { apiKey: c.persistKey ? (c.apiKey || '') : (keys[c.id] || '') });
      });
    },
    getConnection: function (id) {
      var list = models.connections();
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    },

    /** 新增连接。persistKey=false 时密钥只进 sessionStorage，不落 localStorage。 */
    addConnection: function (cfg) {
      var s = readModelState();
      var conn = {
        id: cfg.id || ('conn_' + MH.util.uid()),
        name: String(cfg.name || '未命名连接').slice(0, 60),
        provider: cfg.provider || 'custom',
        kind: cfg.kind || 'openai-compatible',
        baseUrl: String(cfg.baseUrl || '').trim(),
        model: String(cfg.model || '').trim(),
        headers: cfg.headers || {},
        params: cfg.params || {},
        persistKey: !!cfg.persistKey,
        enabled: cfg.enabled !== false,
        createdAt: Date.now()
      };

      if (conn.persistKey) conn.apiKey = String(cfg.apiKey || '');
      else {
        var keys = readSessionKeys();
        keys[conn.id] = String(cfg.apiKey || '');
        writeSessionKeys(keys);
      }
      s.connections.push(conn);
      writeModelState(s);
      return conn;
    },

    updateConnection: function (id, patch) {
      var s = readModelState();
      var hit = null;
      s.connections.forEach(function (c) { if (c.id === id) hit = c; });
      if (!hit) return null;
      ['name', 'provider', 'kind', 'baseUrl', 'model', 'headers', 'params', 'enabled'].forEach(function (k) {
        if (patch[k] !== undefined) hit[k] = patch[k];
      });
      if (patch.persistKey !== undefined) hit.persistKey = !!patch.persistKey;
      if (patch.apiKey !== undefined) {
        if (hit.persistKey) hit.apiKey = String(patch.apiKey || '');
        else {
          var keys = readSessionKeys();
          keys[id] = String(patch.apiKey || '');
          writeSessionKeys(keys);
          delete hit.apiKey;
        }
      }
      // 从「保存到本机」改回「仅本次会话」时，必须把落盘的密钥删掉，避免残留
      if (!hit.persistKey && hit.apiKey !== undefined) delete hit.apiKey;
      writeModelState(s);
      return hit;
    },

    removeConnection: function (id) {
      var s = readModelState();
      s.connections = s.connections.filter(function (c) { return c.id !== id; });
      writeModelState(s);
      var keys = readSessionKeys();
      delete keys[id];
      writeSessionKeys(keys);
      // 若某场景正指向被删连接，回落到场景默认本地模型
      Object.keys(s.active).forEach(function (sc) {
        if (s.active[sc] === 'cloud:' + id) {
          s.active[sc] = (MH.modelRegistry.SCENARIOS[sc] || {}).defaultModel;
        }
      });
      writeModelState(s);
    },

    hasKey: function (id) {
      var c = models.getConnection(id);
      return !!(c && c.apiKey);
    },

    /** 外发授权：默认 false。开启表示用户明确知晓数据会离开本设备。 */
    allowExternal: function () { return !!readModelState().privacy.allowExternal; },
    setAllowExternal: function (on) {
      var s = readModelState();
      s.privacy.allowExternal = !!on;
      s.privacy.ackedAt = Date.now();
      writeModelState(s);
      return s.privacy;
    },

    log: function (entry) {
      var s = readModelState();
      s.logs.push({
        at: entry.at || Date.now(),
        scenario: entry.scenario || '',
        modelId: entry.modelId || '',
        modelName: entry.modelName || '',
        privacy: entry.privacy || 'on-device',
        ok: !!entry.ok,
        degraded: !!entry.degraded,
        code: entry.code || '',
        message: entry.message || '',
        latencyMs: Number(entry.latencyMs) || 0,
        chars: Number(entry.chars) || 0
      });
      if (s.logs.length > 50) s.logs = s.logs.slice(-50);
      writeModelState(s);
    },
    logs: function () { return readModelState().logs.slice().reverse(); },
    clearLogs: function () {
      var s = readModelState();
      s.logs = [];
      writeModelState(s);
    },

    clearAll: function () {
      lsRemove(K.models);
      ssRemove(SESSION_MODEL_KEYS);
    }
  };

  /* ============================ 账户（本机口令） ============================ */

  var auth = {
    get: function () { return readJSON(K.auth, null); },
    exists: function () { return !!auth.get(); },
    username: function () { var a = auth.get(); return a ? a.username : ''; },

    create: function (username, password) {
      var rec = MH.crypto.recommended();
      var salt = MH.crypto.randomHex(16);
      return MH.crypto.derive(password, salt, rec).then(function (hash) {
        var a = {
          username: username,
          salt: salt,
          algo: rec.algo,
          iters: rec.iters,
          hash: hash,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        writeJSON(K.auth, a);
        return a;
      });
    },

    verify: function (password) {
      var a = auth.get();
      if (!a) return Promise.resolve(false);
      return MH.crypto.derive(password, a.salt, { algo: a.algo, iters: a.iters })
        .then(function (hash) { return MH.crypto.safeEqual(hash, a.hash); });
    },

    changePassword: function (oldPwd, newPwd) {
      return auth.verify(oldPwd).then(function (ok) {
        if (!ok) return false;
        var rec = MH.crypto.recommended();
        var salt = MH.crypto.randomHex(16);
        return MH.crypto.derive(newPwd, salt, rec).then(function (hash) {
          var a = auth.get();
          writeJSON(K.auth, Object.assign({}, a, {
            salt: salt, algo: rec.algo, iters: rec.iters, hash: hash, updatedAt: Date.now()
          }));
          return true;
        });
      });
    },

    remove: function () {
      lsRemove(K.auth);
      trust.clear();
      session.clear();
    }
  };

  /* ============================ 信任设备 ============================ */

  var trust = {
    get: function () {
      var t = readJSON(K.trust, null);
      if (!t || !t.expiresAt) return null;
      return t;
    },
    /** 生成一枚随机令牌；只存令牌与到期时间，绝不保存口令本身。 */
    grant: function (days, label) {
      var d = Number(days) || 0;
      var t = {
        username: auth.username(),
        token: MH.crypto.randomToken(),
        label: label || deviceLabel(),
        issuedAt: Date.now(),
        expiresAt: Date.now() + d * 86400000
      };
      writeJSON(K.trust, t);
      return t;
    },
    clear: function () { lsRemove(K.trust); },
    remaining: function () {
      var t = trust.get();
      if (!t) return 0;
      return Math.max(0, t.expiresAt - Date.now());
    },
    /** 信任有效：令牌存在、用户一致、未到期。 */
    valid: function () {
      var t = trust.get();
      if (!t) return false;
      if (!auth.exists() || t.username !== auth.username()) return false;
      return t.expiresAt > Date.now();
    }
  };

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var os = '未知设备';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Harmony/i.test(ua)) os = 'HarmonyOS';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Macintosh/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    var br = '浏览器';
    if (/Edg\//i.test(ua)) br = 'Edge';
    else if (/Chrome\//i.test(ua)) br = 'Chrome';
    else if (/Firefox\//i.test(ua)) br = 'Firefox';
    else if (/Safari\//i.test(ua)) br = 'Safari';
    return os + ' · ' + br;
  }

  /* ============================ 会话（解锁状态） ============================ */

  var session = {
    get: function () {
      var raw = ssGet(SESSION_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    open: function (username, via) {
      var s = { username: username, at: Date.now(), lastActive: Date.now(), via: via || 'password' };
      ssSet(SESSION_KEY, JSON.stringify(s));
      return s;
    },
    touch: function () {
      var s = session.get();
      if (!s) return null;
      s.lastActive = Date.now();
      ssSet(SESSION_KEY, JSON.stringify(s));
      return s;
    },
    clear: function () { ssRemove(SESSION_KEY); },
    /** 空闲超时判定：返回 true 表示应当重新验证。 */
    idleExpired: function () {
      var s = session.get();
      if (!s) return true;
      var min = Number(prefs.get().idleLockMinutes) || 0;
      if (min <= 0) return false;
      return Date.now() - (s.lastActive || s.at) > min * 60000;
    }
  };

  /* ============================ 第三方导入历史 ============================ */

  var IMPORT_HISTORY_MAX = 12;

  /** 只保存统计摘要：文件名、时间、来源与条数，原始表格一行都不落地。 */
  var imports = {
    all: function () {
      var list = readJSON(K.imports, []);
      return Array.isArray(list) ? list : [];
    },
    add: function (entry) {
      var list = imports.all();
      list.unshift({
        id: entry.id || MH.util.uid(),
        at: entry.at || Date.now(),
        files: (entry.files || []).slice(0, 6),
        profile: String(entry.profile || '').slice(0, 40),
        conflict: String(entry.conflict || 'merge'),
        counts: entry.counts || {}
      });
      // 超出部分丢弃最旧的
      writeJSON(K.imports, list.slice(0, IMPORT_HISTORY_MAX));
      return list.length ? list[0] : null;
    },
    clear: function () { lsRemove(K.imports); }
  };

  /* ============================ 导入导出 ============================ */

  function exportAll() {
    return {
      app: 'MoodHub Web',
      schema: 1,
      exportedAt: new Date().toISOString(),
      records: records.all(),
      chat: chat.all(),
      prefs: prefs.get(),
      // 只导出勾选了「保存到本机」的问答源；临时来源本就不落盘
      qaSources: (readJSON(K.sources, []) || []).map(normalizeSource),
      qaTurns: qa.all(),
      // 导出模型连接配置，但绝不导出 API Key
      models: (function () {
        var s = readModelState();
        return {
          active: s.active,
          privacy: s.privacy,
          connections: s.connections.map(function (c) {
            var o = Object.assign({}, c);
            delete o.apiKey;
            o.persistKey = false;
            return o;
          })
        };
      })()
    };
  }

  function importAll(payload, mode) {
    if (!payload || !Array.isArray(payload.records)) throw new Error('文件格式不正确：缺少 records 数组');
    var incoming = payload.records.map(normalize);
    var list = mode === 'merge' ? records.all().concat(incoming) : incoming;
    var seen = {}, dedup = [];
    list.forEach(function (r) {
      var key = r.date + '|' + r.time + '|' + r.mood + '|' + r.sleep + '|' + r.heartRate + '|' + r.stress + '|' + r.note;
      if (!seen[key]) { seen[key] = 1; dedup.push(r); }
    });
    records.save(dedup);
    if (Array.isArray(payload.chat)) { writeJSON(K.chat, payload.chat.slice(-300)); }
    if (Array.isArray(payload.qaSources)) {
      writeJSON(K.sources, payload.qaSources.map(normalizeSource).map(function (s) {
        return Object.assign({}, s, { persist: true });
      }));
    }
    if (Array.isArray(payload.qaTurns)) { writeJSON(K.qa, payload.qaTurns.slice(-60)); }
    if (payload.models && typeof payload.models === 'object') {
      var ms = readModelState();
      ms.active = Object.assign({}, DEFAULT_MODEL_STATE.active, payload.models.active || {});
      ms.privacy = Object.assign({}, DEFAULT_MODEL_STATE.privacy, payload.models.privacy || {});
      if (Array.isArray(payload.models.connections)) {
        ms.connections = payload.models.connections.map(function (c) {
          var o = Object.assign({}, c);
          delete o.apiKey;         // 备份里不含密钥，导入后需重新填写
          o.persistKey = false;
          return o;
        });
      }
      writeModelState(ms);
    }
    return dedup.length;
  }

  function storageUsage() {
    var bytes = 0;
    [K.records, K.chat, K.prefs, K.auth, K.trust, K.sources, K.qa, K.imports].forEach(function (k) {
      var v = lsGet(k);
      if (v) bytes += v.length + k.length;
    });
    return bytes;
  }

  MH.store = {
    KEYS: K,
    storageAvailable: usable,
    prefs: prefs,
    records: records,
    chat: chat,
    sources: sources,
    qa: qa,
    imports: imports,
    models: models,
    auth: auth,
    trust: trust,
    session: session,
    deviceLabel: deviceLabel,
    exportAll: exportAll,
    importAll: importAll,
    storageUsage: storageUsage,
    wipeEverything: function () {
      Object.keys(K).forEach(function (n) { lsRemove(K[n]); });
      ssRemove(SESSION_MODEL_KEYS);
      runtimeSources = [];
      session.clear();
    }
  };
})(window.MH = window.MH || {});
