// 小程序云同步桥：与 Web 端 vault.js 同源逻辑，复用同一套加密信封格式
const C = require('./cipher.js');
const api = require('./api.js');
const store = require('./store.js');
const app = getApp();

const STORE_KEY = 'moodhub.cloud';

let s = { username: null, serverSalt: null, salt: null, km: null, loggedIn: false };

function utf8(str) {
  // 小程序无 TextEncoder 历史兼容：使用基础实现
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = []; let i, c;
  for (i = 0; i < str.length; i++) { c = str.charCodeAt(i); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  return new Uint8Array(out);
}
function concat() {
  const parts = []; let total = 0, i;
  for (i = 0; i < arguments.length; i++) { parts.push(arguments[i]); total += arguments[i].length; }
  const out = new Uint8Array(total); let off = 0;
  for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
  return out;
}
function deriveKm(password, saltHex) { return C.pbkdf2(password, C.hexToBytes(saltHex), C.PBKDF2_ITERS, 64); }
function serverAuth(password) { return C.bytesToHex(C.sha256Bytes(concat(utf8(s.serverSalt || ''), utf8(password)))); }

function load() { const p = wx.getStorageSync(STORE_KEY) || {}; s.username = p.username; s.serverSalt = p.serverSalt; s.loggedIn = !!p.loggedIn; }
function persist() { wx.setStorageSync(STORE_KEY, { username: s.username, serverSalt: s.serverSalt, loggedIn: s.loggedIn }); }

function encryptCloud(data, km) {
  const encKey = km.subarray(0, 32), macKey = km.subarray(32, 64);
  const pt = utf8(JSON.stringify(data));
  const iv = C.randomBytes(12); const dataKey = C.randomBytes(32);
  const ct = C.aesCtr(dataKey, iv, pt);
  const wkiv = C.randomBytes(12); const wk = C.aesCtr(encKey, wkiv, dataKey);
  const mac = C.bytesToB64(C.hmacSha256(macKey, concat(iv, ct, wkiv, wk)));
  return JSON.stringify({ v: C.VERSION, mode: 'cloud', kdf: 'PBKDF2-JS', iter: C.PBKDF2_ITERS, salt: s.salt, iv: C.bytesToB64(iv), ct: C.bytesToB64(ct), wkiv: C.bytesToB64(wkiv), wk: C.bytesToB64(wk), mac });
}
function decryptCloud(envelopeStr, km) {
  const env = JSON.parse(envelopeStr);
  const encKey = km.subarray(0, 32), macKey = km.subarray(32, 64);
  const iv = C.b64ToBytes(env.iv), ct = C.b64ToBytes(env.ct), wkiv = C.b64ToBytes(env.wkiv), wk = C.b64ToBytes(env.wk);
  if (C.bytesToB64(C.hmacSha256(macKey, concat(iv, ct, wkiv, wk))) !== env.mac) throw new Error('MAC 校验失败');
  const dk = C.aesCtr(encKey, wkiv, wk);
  const buf = C.aesCtr(dk, iv, ct);
  return JSON.parse(decodeUtf8(buf));
}
function decodeUtf8(b) { if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b); let s = '', i = 0; while (i < b.length) { const c = b[i++]; if (c < 0x80) s += String.fromCharCode(c); else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63)); else { const cc = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); s += String.fromCharCode(cc); } } return s; }

const vault = {
  configure: (o) => { if (o && o.baseUrl != null) api.setBase(String(o.baseUrl).replace(/\/$/, '')); },
  getMode: () => (s.loggedIn ? 'cloud' : 'local'),
  isCloudLoggedIn: () => !!s.loggedIn,
  currentUser: () => s.username,

  register(username, password) {
    s.salt = C.makeSalt(); s.serverSalt = C.makeSalt(); s.km = deriveKm(password, s.salt);
    return api.request('POST', '/api/auth/register', { username, serverSalt: s.serverSalt, authHash: serverAuth(password), envelope: encryptCloud(store.exportAll(), s.km) })
      .then((r) => { if (!r.body.ok) throw new Error(r.body.error || '注册失败'); s.username = username; s.loggedIn = true; persist(); return true; });
  },
  login(username, password) {
    return api.request('GET', '/api/auth/salt?username=' + encodeURIComponent(username))
      .then((r) => { if (!r.body.serverSalt) throw new Error('找不到该云端账户'); s.serverSalt = r.body.serverSalt; return api.request('POST', '/api/auth/login', { username, authHash: serverAuth(password) }); })
      .then((r) => {
        if (!r.body.ok || !r.body.envelope) throw new Error((r.body && r.body.error) || '登录失败');
        const env = JSON.parse(r.body.envelope); s.salt = env.salt; s.km = deriveKm(password, s.salt);
        decryptCloud(r.body.envelope, s.km); // 试解，提前暴露口令错误
        s.username = username; s.loggedIn = true; persist(); return true;
      });
  },
  push() { if (!s.loggedIn || !s.km) return Promise.reject(new Error('未登录')); return api.request('PUT', '/api/vault', { envelope: encryptCloud(store.exportAll(), s.km) }).then((r) => { if (!r.body.ok) throw new Error(r.body.error || '上传失败'); return true; }); },
  pull() { if (!s.loggedIn || !s.km) return Promise.reject(new Error('未登录')); return api.request('GET', '/api/vault').then((r) => { if (!r.body.envelope) throw new Error('下载失败'); const data = decryptCloud(r.body.envelope, s.km); return store.importAll(data); }); },
  logout() { return api.request('POST', '/api/auth/logout').then(() => { s.loggedIn = false; s.km = null; s.salt = null; persist(); return true; }, () => { s.loggedIn = false; s.km = null; persist(); return true; }); }
};

load();
module.exports = vault;
