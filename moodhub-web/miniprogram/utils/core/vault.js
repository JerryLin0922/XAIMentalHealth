/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../_ns.js');
/* ------------------------------------------------------------------
   云端同步桥（vault）。
   ------------------------------------------------------------------
   职责：把「加密内核」(MH.cipher) 与「后端 API」(Cloudflare Worker) 连起来。
   设计要点：
   · 本地优先不变：默认 local 模式，数据仍只在本机；只有用户显式「启用云端同步」才联网。
   · 服务端永不可读：上传的是 MH.cipher 产生的 cloud 信封（密文 + 被口令密钥包裹的 dataKey），
     服务端只存密文，无法解密（见 tests/cipher.cjs 的「服务端不可读」用例）。
   · 登录态与数据加密解耦：服务端用独立的一枚 serverAuth 哈希校验登录，拿不到口令，
     也拿不到数据密钥。
   · 会话密钥：登录/注册后，口令派生的 64 字节密钥材料(km) 仅保存在内存，刷新即丢失，
     需要再次输入口令——与现有「本机访问锁」的隐私承诺一致。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var C = MH.cipher;
  var STORE_KEY = 'moodhub.v1.cloud';

  // 内存态：会话密钥 km(64B)、用户名、盐等。刷新即清空。
  var s = {
    baseUrl: '',
    username: null,
    serverSalt: null,   // 服务端登录校验用（非机密）
    salt: null,         // cloud 信封的 PBKDF2 盐
    km: null,           // 派生密钥材料（encKey||macKey），仅内存
    loggedIn: false
  };

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i;
    for (i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function concat() {
    var parts = [], total = 0, i;
    for (i = 0; i < arguments.length; i++) { parts.push(arguments[i]); total += arguments[i].length; }
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }
  function deriveKm(password, saltHex) {
    return C.pbkdf2(password, C.hexToBytes(saltHex), C.PBKDF2_ITERS, 64);
  }
  function serverAuth(password) {
    // 仅用于服务端登录校验，与数据加密无关
    return C.bytesToHex(C.sha256Bytes(concat(utf8(s.serverSalt || ''), utf8(password))));
  }
  function load() {
    try {
      var p = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (p) { s.username = p.username; s.serverSalt = p.serverSalt; s.loggedIn = !!p.loggedIn; }
    } catch (e) {}
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        username: s.username, serverSalt: s.serverSalt, loggedIn: s.loggedIn
      }));
    } catch (e) {}
  }

  function api(path, opts) {
    opts = opts || {};
    return fetch((s.baseUrl || '') + path, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }).catch(function () { return { ok: r.ok, status: r.status, body: {} }; }); });
  }

  /* ============ 信封的加密/解密（复用 MH.cipher 原语，km 已派生） ============ */
  function encryptCloud(data, km) {
    var encKey = km.subarray(0, 32), macKey = km.subarray(32, 64);
    var pt = utf8(JSON.stringify(data));
    var iv = C.randomBytes(12);
    var dataKey = C.randomBytes(32);
    var ct = C.aesCtr(dataKey, iv, pt);
    var wkiv = C.randomBytes(12);
    var wk = C.aesCtr(encKey, wkiv, dataKey);
    var mac = C.bytesToB64(C.hmacSha256(macKey, concat(iv, ct, wkiv, wk)));
    return JSON.stringify({
      v: C.VERSION, mode: 'cloud', kdf: 'PBKDF2-JS', iter: C.PBKDF2_ITERS, salt: s.salt,
      iv: C.bytesToB64(iv), ct: C.bytesToB64(ct), wkiv: C.bytesToB64(wkiv), wk: C.bytesToB64(wk), mac: mac
    });
  }
  function decryptCloud(envelopeStr, km) {
    var env = JSON.parse(envelopeStr);
    var encKey = km.subarray(0, 32), macKey = km.subarray(32, 64);
    var iv = C.b64ToBytes(env.iv), ct = C.b64ToBytes(env.ct), wkiv = C.b64ToBytes(env.wkiv), wk = C.b64ToBytes(env.wk);
    if (C.bytesToB64(C.hmacSha256(macKey, concat(iv, ct, wkiv, wk))) !== env.mac)
      throw new Error('云端数据 MAC 校验失败：口令错误或数据被篡改');
    var dk = C.aesCtr(encKey, wkiv, wk);
    return JSON.parse(utf8Decode(C.aesCtr(dk, iv, ct)));
  }
  function utf8Decode(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b);
    var s = '', i = 0;
    while (i < b.length) {
      var c = b[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
      else { var cc = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); s += String.fromCharCode(cc); }
    }
    return s;
  }

  function collect() { return MH.store.exportAll(); }
  function apply(data) {
    if (!data || typeof data !== 'object') return 0;
    return MH.store.importAll(data, 'merge');
  }

  /* ============================ 对外接口 ============================ */
  var vault = {
    configure: function (o) { if (o && o.baseUrl != null) s.baseUrl = String(o.baseUrl).replace(/\/$/, ''); },
    getMode: function () { return s.loggedIn ? 'cloud' : 'local'; },
    isCloudLoggedIn: function () { return !!s.loggedIn; },
    currentUser: function () { return s.username; },

    /** 注册并启用云端：在本地已有账户/数据的前提下，上传首份加密信封。 */
    register: function (username, password) {
      s.salt = C.makeSalt();
      s.serverSalt = C.makeSalt();
      s.km = deriveKm(password, s.salt);
      var envelope = encryptCloud(collect(), s.km);
      return api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: username, serverSalt: s.serverSalt, authHash: serverAuth(password), envelope: envelope })
      }).then(function (r) {
        if (!r.ok) throw new Error((r.body && r.body.error) || '注册失败');
        s.username = username; s.loggedIn = true; persist();
        return true;
      });
    },

    /** 登录云端：校验口令（服务端），取回加密信封用于后续解密。 */
    login: function (username, password) {
      return api('/api/auth/salt?username=' + encodeURIComponent(username)).then(function (r) {
        if (!r.ok || !r.body.serverSalt) throw new Error('找不到该云端账户');
        s.serverSalt = r.body.serverSalt;
        return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: username, authHash: serverAuth(password) }) });
      }).then(function (r) {
        if (!r.ok || !r.body.envelope) throw new Error((r.body && r.body.error) || '登录失败：口令不正确');
        var env = JSON.parse(r.body.envelope);
        s.salt = env.salt;
        s.km = deriveKm(password, s.salt);
        // 用会话密钥试解，提前暴露口令错误
        decryptCloud(r.body.envelope, s.km);
        s.username = username; s.loggedIn = true; persist();
        return true;
      });
    },

    /** 上传：把本机当前数据加密后推送到云端（全量快照）。 */
    push: function () {
      if (!s.loggedIn || !s.km) return Promise.reject(new Error('尚未登录云端'));
      var envelope = encryptCloud(collect(), s.km);
      return api('/api/vault', { method: 'PUT', body: JSON.stringify({ envelope: envelope }) }).then(function (r) {
        if (!r.ok) throw new Error((r.body && r.body.error) || '上传失败');
        return true;
      });
    },

    /** 下载：取回云端加密信封并解密、合并到本机。 */
    pull: function () {
      if (!s.loggedIn || !s.km) return Promise.reject(new Error('尚未登录云端'));
      return api('/api/vault').then(function (r) {
        if (!r.ok || !r.body.envelope) throw new Error((r.body && r.body.error) || '下载失败');
        var data = decryptCloud(r.body.envelope, s.km);
        var n = apply(data);
        return n;
      });
    },

    /** 双向同步：先拉后推（简单策略，适合个人单设备为主）。 */
    sync: function () {
      var self = this;
      return self.pull().then(function () { return self.push(); }, function (e) { return self.push(); });
    },

    logout: function () {
      return api('/api/auth/logout', { method: 'POST' }).then(function () {
        s.loggedIn = false; s.km = null; s.salt = null; persist();
        return true;
      }, function () { s.loggedIn = false; s.km = null; s.salt = null; persist(); return true; });
    }
  };

  load();
  MH.vault = vault;
})(MH);

