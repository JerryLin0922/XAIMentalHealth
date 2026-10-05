/* ==================================================================
   MoodHub 共享加密内核（isomorphic cipher core）
   ------------------------------------------------------------------
   设计目标：
   · 纯 JS、零依赖、无 Web Crypto 依赖 —— 保证浏览器 / Cloudflare
     Worker / 微信小程序 / Node 产出字节级一致的密文，云端密文可跨端互解。
   · 算法：AES-256-CTR（仅用 AES 正向变换）+ HMAC-SHA256（Encrypt-then-MAC）。
   · 两种模式：
       local  —— 口令直接派生密钥加密数据（本地优先 / 离线）。
       cloud  —— 信封加密：随机 dataKey 加密数据，dataKey 用口令密钥
                 包裹(wrap)后上传；服务端只存密文+包裹密钥，永不可读明文。
   对外只暴露：MH.cipher.encrypt / decrypt / wrapDataKey / unwrapDataKey /
               randomBytes / makeSalt / VERSION。
   本文件是「单一事实来源」，web / worker / miniprogram 三端均引用同一份。
   ================================================================== */
(function (root, factory) {
  var api = factory();
  // 真实环境（浏览器/Worker/小程序）走 module.exports；同时始终挂到全局 MH，
  // 以便无 module 系统或模块系统异常的环境（如某些沙箱）也能取用。
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MH = root.MH || {};
  root.MH.cipher = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this)), function () {
  'use strict';

  var VERSION = 1;

  /* -------------------- 随机源 -------------------- */
  function getRandomValues(arr) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
      return arr;
    }
    // 微信小程序：wx.getRandomValues（基础库 2.x 后可用）
    if (typeof wx !== 'undefined' && wx.getRandomValues) {
      // 微信接口要求长度 1..N 且返回 res.randomValues
      var res = wx.getRandomValues({ length: arr.length });
      if (res && res.randomValues) {
        for (var i = 0; i < arr.length; i++) arr[i] = res.randomValues[i];
        return arr;
      }
    }
    // 最后回退（不推荐用于生产，仅保证可用性）
    for (var j = 0; j < arr.length; j++) arr[j] = Math.floor(Math.random() * 256);
    return arr;
  }
  function randomBytes(n) { return getRandomValues(new Uint8Array(n)); }

  /* -------------------- 字节 / 编码工具 -------------------- */
  function bytesToHex(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + (b[i] & 255).toString(16)).slice(-2);
    return s;
  }
  function hexToBytes(h) {
    var n = h.length / 2, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  // 浏览器/Worker/Node 用 btoa/atob；小程序用 wx.base64 或自实现
  function bytesToB64(b) {
    var bin = '';
    for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    if (typeof btoa === 'function') return btoa(bin);
    if (typeof wx !== 'undefined' && wx.arrayBufferToBase64) {
      return wx.arrayBufferToBase64(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
    }
    return _b64Encode(bin);
  }
  function b64ToBytes(s) {
    var bin;
    if (typeof atob === 'function') bin = atob(s);
    else if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
      var ab = wx.base64ToArrayBuffer(s);
      return new Uint8Array(ab);
    } else bin = _b64Decode(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function _b64Encode(bin) {
    var out = '', i;
    for (i = 0; i < bin.length; i += 3) {
      var n = (bin.charCodeAt(i) << 16) | (bin.charCodeAt(i + 1) << 8) | bin.charCodeAt(i + 2);
      out += _B64[n >> 18 & 63] + _B64[n >> 12 & 63] + (i + 1 < bin.length ? _B64[n >> 6 & 63] : '=') + (i + 2 < bin.length ? _B64[n & 63] : '=');
    }
    return out;
  }
  function _b64Decode(s) {
    var clean = s.replace(/=+$/, ''), out = '', i;
    for (i = 0; i < clean.length; i += 4) {
      var n = (_B64.indexOf(clean[i]) << 18) | (_B64.indexOf(clean[i + 1]) << 12) | (_B64.indexOf(clean[i + 2]) << 6) | _B64.indexOf(clean[i + 3]);
      out += String.fromCharCode(n >> 16 & 255, n >> 8 & 255, n & 255);
    }
    return out;
  }
  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new Uint8Array(new TextEncoder().encode(str));
    var out = [], i;
    for (i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
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

  /* -------------------- SHA-256 -------------------- */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function sha256Bytes(msg) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = msg.length;
    var blocks = Math.ceil((len + 9) / 64);
    var total = blocks * 64;
    var buf = new Uint8Array(total);
    buf.set(msg, 0);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    dv.setUint32(total - 4, (len * 8) >>> 0);
    var w = new Array(64);
    for (var b = 0; b < blocks; b++) {
      var off = b * 64;
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x15 = w[i - 15], x2 = w[i - 2];
        w[i] = (w[i - 16] + (rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3)) + w[i - 7] +
          (rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10))) >>> 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[i * 4] = (H[i] >>> 24) & 255; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255; }
    return out;
  }
  function hmacSha256(key, msg) {
    var BS = 64;
    if (key.length > BS) key = sha256Bytes(key);
    var k = new Uint8Array(BS);
    k.set(key, 0);
    var ipad = new Uint8Array(BS + msg.length);
    var opad = new Uint8Array(BS + 32);
    for (var i = 0; i < BS; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, BS);
    var inner = sha256Bytes(ipad);
    opad.set(inner, BS);
    return sha256Bytes(opad);
  }

  /* -------------------- PBKDF2-HMAC-SHA256 -------------------- */
  function pbkdf2(password, salt, iters, dkLen) {
    dkLen = dkLen || 32;
    var pw = typeof password === 'string' ? utf8Encode(password) : password;
    var blocks = Math.ceil(dkLen / 32);
    var out = new Uint8Array(blocks * 32);
    for (var b = 1; b <= blocks; b++) {
      var counter = new Uint8Array(salt.length + 4);
      counter.set(salt, 0);
      counter[salt.length] = (b >>> 24) & 255;
      counter[salt.length + 1] = (b >>> 16) & 255;
      counter[salt.length + 2] = (b >>> 8) & 255;
      counter[salt.length + 3] = b & 255;
      var u = hmacSha256(pw, counter);
      var t = u.slice(0);
      for (var i = 1; i < iters; i++) {
        u = hmacSha256(pw, u);
        for (var j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out.set(t.subarray(0, Math.min(32, dkLen - (b - 1) * 32)), (b - 1) * 32);
    }
    return out.subarray(0, dkLen);
  }

  /* -------------------- AES（正向变换，列主序 state） -------------------- */
  // 运行时生成 SBOX（避免硬编码错误）
  // GF(2^8) 乘法（模多项式 0x11b = x^8+x^4+x^3+x+1）
  function gfMul(a, b) {
    var r = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) r ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b; // 0x11b 去掉最高位后为 0x1b
      b >>= 1;
    }
    return r;
  }
  function gfPow(a, e) {
    var res = 1;
    while (e > 0) {
      if (e & 1) res = gfMul(res, a);
      a = gfMul(a, a);
      e >>= 1;
    }
    return res;
  }
  var SBOX = (function () {
    var sbox = new Uint8Array(256);
    function rotl8(x, n) { return ((x << n) | (x >> (8 - n))) & 0xff; }
    for (var x = 0; x < 256; x++) {
      // 乘法逆元：x^{-1} = x^{254}（群阶 255）；x=0 时逆元定义为 0
      var inv = x ? gfPow(x, 254) : 0;
      // 公认正确的 AES S-box 仿射变换（循环左移异或 + 常量 0x63）
      var out = inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63;
      sbox[x] = out & 0xff;
    }
    return sbox;
  })();
  function xtime(a) { var r = a << 1; if (r & 0x100) r ^= 0x11b; return r & 0xff; }
  function gmul2(a) { return xtime(a); }
  function gmul3(a) { return xtime(a) ^ a; }

  function keyExpansion(key) {
    var Nk = key.length / 4, Nr = Nk + 6;
    var w = new Uint8Array((Nr + 1) * 16);
    var i, j;
    for (i = 0; i < key.length; i++) w[i] = key[i];
    var rc = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var temp = new Uint8Array(4);
    for (i = Nk; i < (Nr + 1) * 4; i++) {
      temp[0] = w[(i - 1) * 4]; temp[1] = w[(i - 1) * 4 + 1]; temp[2] = w[(i - 1) * 4 + 2]; temp[3] = w[(i - 1) * 4 + 3];
      if (i % Nk === 0) {
        // RotWord
        var t = temp[0]; temp[0] = temp[1]; temp[1] = temp[2]; temp[2] = temp[3]; temp[3] = t;
        // SubWord
        temp[0] = SBOX[temp[0]]; temp[1] = SBOX[temp[1]]; temp[2] = SBOX[temp[2]]; temp[3] = SBOX[temp[3]];
        temp[0] ^= rc[(i / Nk) - 1];
      } else if (Nk > 6 && i % Nk === 4) {
        temp[0] = SBOX[temp[0]]; temp[1] = SBOX[temp[1]]; temp[2] = SBOX[temp[2]]; temp[3] = SBOX[temp[3]];
      }
      w[i * 4] = w[(i - Nk) * 4] ^ temp[0];
      w[i * 4 + 1] = w[(i - Nk) * 4 + 1] ^ temp[1];
      w[i * 4 + 2] = w[(i - Nk) * 4 + 2] ^ temp[2];
      w[i * 4 + 3] = w[(i - Nk) * 4 + 3] ^ temp[3];
    }
    return w;
  }

  function aesEncryptBlock(key, input) {
    var Nk = key.length / 4, Nr = Nk + 6;
    var w = keyExpansion(key);
    var s = new Uint8Array(16);
    for (var i = 0; i < 16; i++) s[i] = input[i] ^ w[i];
    for (var r = 1; r < Nr; r++) {
      // SubBytes
      for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      // ShiftRows（列主序：idx = row + 4*col）
      var ns = new Uint8Array(16);
      for (var row = 0; row < 4; row++) {
        for (var col = 0; col < 4; col++) {
          ns[row + 4 * col] = s[row + 4 * ((col + row) % 4)];
        }
      }
      s = ns;
      // MixColumns
      for (var c = 0; c < 4; c++) {
        var a0 = s[0 + 4 * c], a1 = s[1 + 4 * c], a2 = s[2 + 4 * c], a3 = s[3 + 4 * c];
        s[0 + 4 * c] = gmul2(a0) ^ gmul3(a1) ^ a2 ^ a3;
        s[1 + 4 * c] = a0 ^ gmul2(a1) ^ gmul3(a2) ^ a3;
        s[2 + 4 * c] = a0 ^ a1 ^ gmul2(a2) ^ gmul3(a3);
        s[3 + 4 * c] = gmul3(a0) ^ a1 ^ a2 ^ gmul2(a3);
      }
      // AddRoundKey
      for (i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    }
    // 末轮（无 MixColumns）
    for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    var fs = new Uint8Array(16);
    for (row = 0; row < 4; row++) for (col = 0; col < 4; col++) fs[row + 4 * col] = s[row + 4 * ((col + row) % 4)];
    s = fs;
    for (i = 0; i < 16; i++) s[i] ^= w[Nr * 16 + i];
    return s;
  }

  /* -------------------- AES-CTR（加解密同一函数） -------------------- */
  function aesCtr(key, nonce, data) {
    if (nonce.length !== 12) throw new Error('nonce 必须是 12 字节');
    var out = new Uint8Array(data.length);
    var counter = new Uint8Array(16);
    counter.set(nonce, 0);
    var pos = 0;
    while (pos < data.length) {
      var ks = aesEncryptBlock(key, counter);
      var take = Math.min(16, data.length - pos);
      for (var i = 0; i < take; i++) out[pos + i] = data[pos + i] ^ ks[i];
      pos += take;
      for (var j = 15; j >= 12; j--) { counter[j]++; if (counter[j] !== 0) break; }
    }
    return out;
  }

  /* -------------------- 口令派生（统一参数，三端一致） -------------------- */
  var PBKDF2_ITERS = 200000; // 可调，写进信封以便验证时一致
  function deriveKeyMaterial(password, saltHex) {
    var salt = hexToBytes(saltHex);
    // 64 字节：前 32 = encKey，后 32 = macKey
    return pbkdf2(password, salt, PBKDF2_ITERS, 64);
  }

  /* -------------------- 信封（envelope）编解码 -------------------- */
  // 信封结构（JSON 字符串后整体再作密文内容，见 encrypt/decrypt）
  // 这里 encrypt 直接产出 base64 字符串；结构由调用方约定。

  /**
   * 加密任意 JSON 可序列化对象。
   * @param {object|array} data   明文数据
   * @param {string} password     用户口令（不落盘、不上传）
   * @param {object} [opts]       { mode:'local'|'cloud', dataKeyHex?: 云模式复用的随机 dataKey }
   * @returns {string} 信封（base64 JSON）
   */
  function encrypt(data, password, opts) {
    opts = opts || {};
    var mode = opts.mode === 'cloud' ? 'cloud' : 'local';
    var salt = opts.salt || bytesToHex(randomBytes(16));
    var km = deriveKeyMaterial(password, salt);
    var encKey = km.subarray(0, 32);
    var macKey = km.subarray(32, 64);

    var plaintext = utf8Encode(JSON.stringify(data));
    var iv = opts.iv ? (typeof opts.iv === 'string' ? hexToBytes(opts.iv) : opts.iv) : randomBytes(12);
    var ct;

    var envelope = { v: VERSION, mode: mode, kdf: 'PBKDF2-JS', iter: PBKDF2_ITERS, salt: salt };

    if (mode === 'cloud') {
      // 信封加密：随机 dataKey 加密数据；dataKey 用口令密钥包裹后上传
      var dataKey = opts.dataKeyHex ? hexToBytes(opts.dataKeyHex) : randomBytes(32);
      var wkiv = randomBytes(12);
      ct = aesCtr(dataKey, iv, plaintext);
      var wrapped = aesCtr(encKey, wkiv, dataKey);
      envelope.iv = bytesToB64(iv);
      envelope.ct = bytesToB64(ct);
      envelope.wkiv = bytesToB64(wkiv);
      envelope.wk = bytesToB64(wrapped);
      envelope.mac = bytesToB64(hmacSha256(macKey, _concat(iv, ct, wkiv, wrapped)));
      envelope.dataKeyHint = bytesToB64(dataKey); // 仅在本地返回，不入库
    } else {
      ct = aesCtr(encKey, iv, plaintext);
      envelope.iv = bytesToB64(iv);
      envelope.ct = bytesToB64(ct);
      envelope.mac = bytesToB64(hmacSha256(macKey, _concat(iv, ct)));
    }
    return { envelope: JSON.stringify(envelope), dataKeyHex: mode === 'cloud' ? bytesToHex(dataKey) : null };
  }

  function _concat() {
    var parts = [], total = 0, i;
    for (i = 0; i < arguments.length; i++) { parts.push(arguments[i]); total += arguments[i].length; }
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  /**
   * 解密信封。
   * @param {string} envelopeStr  base64 JSON 信封
   * @param {string} password
   * @returns {object} 明文对象
   * @throws 口令错误或数据被篡改时抛错
   */
  function decrypt(envelopeStr, password) {
    var env = JSON.parse(typeof envelopeStr === 'string' ? envelopeStr : envelopeStr.envelope || envelopeStr);
    var km = deriveKeyMaterial(password, env.salt);
    var encKey = km.subarray(0, 32);
    var macKey = km.subarray(32, 64);
    var iv = b64ToBytes(env.iv);
    var ct = b64ToBytes(env.ct);

    if (env.mode === 'cloud') {
      var wkiv = b64ToBytes(env.wkiv);
      var wrapped = b64ToBytes(env.wk);
      var expectMac = bytesToB64(hmacSha256(macKey, _concat(iv, ct, wkiv, wrapped)));
      if (expectMac !== env.mac) throw new Error('MAC 校验失败：口令错误或数据被篡改');
      var dataKey = aesCtr(encKey, wkiv, wrapped);
      return JSON.parse(utf8Decode(aesCtr(dataKey, iv, ct)));
    } else {
      var expectMac2 = bytesToB64(hmacSha256(macKey, _concat(iv, ct)));
      if (expectMac2 !== env.mac) throw new Error('MAC 校验失败：口令错误或数据被篡改');
      return JSON.parse(utf8Decode(aesCtr(encKey, iv, ct)));
    }
  }

  /** 仅校验口令是否正确（不返回明文）。 */
  function verify(envelopeStr, password) {
    try { decrypt(envelopeStr, password); return true; } catch (e) { return false; }
  }

  /**
   * 从云信封中解开 dataKey（不返回明文数据），供后续加密复用。
   * 同时校验 MAC（口令错误 / 数据被篡改会抛错）。
   * @returns {string} dataKey 的 hex
   */
  function unwrapDataKey(envelopeStr, password) {
    var env = JSON.parse(typeof envelopeStr === 'string' ? envelopeStr : envelopeStr.envelope || envelopeStr);
    if (env.mode !== 'cloud') throw new Error('该信封不是云模式');
    var km = deriveKeyMaterial(password, env.salt);
    var encKey = km.subarray(0, 32);
    var macKey = km.subarray(32, 64);
    var iv = b64ToBytes(env.iv);
    var ct = b64ToBytes(env.ct);
    var wkiv = b64ToBytes(env.wkiv);
    var wrapped = b64ToBytes(env.wk);
    var expectMac = bytesToB64(hmacSha256(macKey, _concat(iv, ct, wkiv, wrapped)));
    if (expectMac !== env.mac) throw new Error('MAC 校验失败：口令错误或数据被篡改');
    return bytesToHex(aesCtr(encKey, wkiv, wrapped));
  }

  return {
    VERSION: VERSION,
    randomBytes: randomBytes,
    makeSalt: function () { return bytesToHex(randomBytes(16)); },
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes,
    bytesToB64: bytesToB64,
    b64ToBytes: b64ToBytes,
    sha256Bytes: sha256Bytes,
    hmacSha256: hmacSha256,
    pbkdf2: pbkdf2,
    aesCtr: aesCtr,
    encrypt: encrypt,
    decrypt: decrypt,
    verify: verify,
    unwrapDataKey: unwrapDataKey,
    PBKDF2_ITERS: PBKDF2_ITERS
  };
});
