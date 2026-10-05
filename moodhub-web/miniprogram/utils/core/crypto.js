/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../_ns.js');
/* ------------------------------------------------------------------
   本地口令派生（KDF）。
   说明：MoodHub Web 不联网、不加密上传，密码用于「本机访问锁」。
   这里仍用 PBKDF2-SHA256 + 随机盐做口令派生，避免明文口令落盘：
     · 优先使用 Web Crypto（150k 迭代）
     · 安全上下文不可用时回退到内置纯 JS 实现（10k 迭代）
   两条路径参数一致，且迭代次数写入档案，验证时按档案参数执行。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : {
    encode: function (s) {
      var out = [], i, c;
      for (i = 0; i < s.length; i++) {
        c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    }
  };

  /* ============ 纯 JS SHA-256 ============ */

  var K = [
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
    var bits = len * 8;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 4294967296));
    dv.setUint32(total - 4, bits >>> 0);

    var w = new Array(64), i;
    for (var b = 0; b < blocks; b++) {
      var off = b * 64;
      for (i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x15 = w[i - 15], x2 = w[i - 2];
        w[i] = (w[i - 16] + (rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3)) + w[i - 7] +
                (rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10))) >>> 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = bb; bb = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) {
      out[i * 4] = (H[i] >>> 24) & 255;
      out[i * 4 + 1] = (H[i] >>> 16) & 255;
      out[i * 4 + 2] = (H[i] >>> 8) & 255;
      out[i * 4 + 3] = H[i] & 255;
    }
    return out;
  }

  function hmacSha256(key, msg) {
    var BS = 64, i;
    if (key.length > BS) key = sha256Bytes(key);
    var k = new Uint8Array(BS);
    k.set(key, 0);
    var ipad = new Uint8Array(BS + msg.length);
    var opad = new Uint8Array(BS + 32);
    for (i = 0; i < BS; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, BS);
    var inner = sha256Bytes(ipad);
    opad.set(inner, BS);
    return sha256Bytes(opad);
  }

  function pbkdf2Js(password, salt, iters, dkLen) {
    dkLen = dkLen || 32;
    var pw = typeof password === 'string' ? enc.encode(password) : password;
    var out = new Uint8Array(dkLen);
    var blocks = Math.ceil(dkLen / 32);
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
      var n = Math.min(32, dkLen - (b - 1) * 32);
      for (var k = 0; k < n; k++) out[(b - 1) * 32 + k] = t[k];
    }
    return out;
  }

  /* ============ Web Crypto 路径 ============ */

  function hasSubtle() {
    return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.deriveBits === 'function';
  }

  function pbkdf2Subtle(password, salt, iters, dkLen) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: salt, iterations: iters, hash: 'SHA-256' },
          key,
          (dkLen || 32) * 8
        );
      })
      .then(function (bits) { return new Uint8Array(bits); });
  }

  /* ============ 编码 / 随机 ============ */

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
    return s;
  }

  function fromHex(hex) {
    var n = hex.length / 2, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }

  function randomHex(n) { return toHex(randomBytes(n || 16)); }

  function randomToken() {
    // 42 字节 → 84 位十六进制，作为「信任此设备」的随机令牌
    return toHex(randomBytes(42));
  }

  /* ============ 对外接口 ============ */

  var ITER_WEB = 150000;
  var ITER_JS = 10000;

  function recommended() {
    return hasSubtle() ? { algo: 'PBKDF2-WC', iters: ITER_WEB } : { algo: 'PBKDF2-JS', iters: ITER_JS };
  }

  /** 派生口令摘要，返回 hex。kdf 形如 { algo, iters }。 */
  function derive(password, saltHex, kdf) {
    var salt = fromHex(saltHex);
    var iters = (kdf && kdf.iters) || ITER_WEB;
    var algo = (kdf && kdf.algo) || 'PBKDF2-WC';
    var dk = algo === 'PBKDF2-JS' || !hasSubtle()
      ? Promise.resolve(pbkdf2Js(password, salt, iters, 32))
      : pbkdf2Subtle(password, salt, iters, 32);
    return dk.then(toHex);
  }

  /** 恒定时间比较，避免时序侧信道。 */
  function safeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  MH.crypto = {
    derive: derive,
    recommended: recommended,
    safeEqual: safeEqual,
    randomHex: randomHex,
    randomToken: randomToken,
    sha256Hex: function (s) { return toHex(sha256Bytes(typeof s === 'string' ? enc.encode(s) : s)); },
    hasSubtle: hasSubtle
  };
})(MH);

