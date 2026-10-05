/* ==================================================================
   MoodHub 后端（Cloudflare Worker，ES Module）
   ------------------------------------------------------------------
   职责：
   · /api/auth/*  —— 注册 / 登录 / 登出 / 取登录盐（服务端只校验 authHash，
                      永远拿不到口令，也拿不到数据密钥）
   · /api/vault   —— 加密信封的拉取(GET)与覆盖上传(PUT)，全部以密文存储
   · /account     —— 服务端动态渲染：依据会话态展示「已登录 / 未登录」与
                      最近同步时间（演示动态内容与登录状态管理）
   设计铁律：服务端只存密文信封（iv/ct/wkiv/wk/mac/salt），无法解密。
   ================================================================== */

const COOKIE = 'moodhub_sid';
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 天

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === '/api/auth/register' && request.method === 'POST') return await register(request, env);
      if (p === '/api/auth/salt' && request.method === 'GET') return await getSalt(url, env);
      if (p === '/api/auth/login' && request.method === 'POST') return await login(request, env);
      if (p === '/api/auth/logout' && request.method === 'POST') return await logout(env);
      if (p === '/api/vault' && request.method === 'GET') return await getVault(request, env);
      if (p === '/api/vault' && request.method === 'PUT') return await putVault(request, env);
      if (p === '/account') return await accountPage(request, env);
      if (p === '/api/health') return json({ ok: true, ts: Date.now() });
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return json({ error: e.message || 'server_error' }, 500);
    }
  }
};

/* ----------------------- 会话（HMAC 签名 Cookie） ----------------------- */
async function signSession(sub, secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = b64url(JSON.stringify({ sub, exp }));
  const sig = await hmac(payload, secret);
  return payload + '.' + sig;
}
async function verifySession(token, secret) {
  if (!token || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const expect = await hmac(payload, secret);
  if (!constantTimeEqual(expect, sig)) return null;
  let obj;
  try { obj = JSON.parse(b64urlDecode(payload)); } catch (e) { return null; }
  if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
  return obj.sub;
}
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, utf8(data));
  return b64url(new Uint8Array(buf));
}
function getCookie(req) {
  const out = {};
  const h = req.headers.get('Cookie') || '';
  h.split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim(); });
  return out;
}
function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
async function requireUser(req, env) {
  const cookies = getCookie(req);
  const sub = await verifySession(cookies[COOKIE], env.SESSION_SECRET);
  if (!sub) return null;
  const row = await env.DB.prepare('SELECT id, username FROM accounts WHERE id = ?').bind(sub).first();
  return row || null;
}

/* ------------------------------ 端点 ------------------------------ */
async function register(req, env) {
  const body = await req.json().catch(() => ({}));
  const { username, serverSalt, authHash, envelope } = body;
  if (!username || !serverSalt || !authHash || !envelope) return json({ error: '缺少必要字段' }, 400);
  if (typeof username !== 'string' || username.length < 2 || username.length > 32) return json({ error: '用户名长度 2-32' }, 400);
  const envObj = safeParse(envelope);
  if (!envObj || envObj.mode !== 'cloud' || !envObj.ct || !envObj.wk) return json({ error: '信封格式不合法' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM accounts WHERE username = ?').bind(username).first();
  if (existing) return json({ error: '该用户名已被占用' }, 409);

  const res = await env.DB.prepare(
    'INSERT INTO accounts (username, server_salt, auth_hash, created_at) VALUES (?, ?, ?, ?)'
  ).bind(username, serverSalt, authHash, Date.now()).run();

  const uid = res.meta?.last_row_id || (await env.DB.prepare('SELECT id FROM accounts WHERE username = ?').bind(username).first())?.id;
  await storeVault(env, uid, envObj);
  return json({ ok: true, userId: uid });
}

async function getSalt(url, env) {
  const username = url.searchParams.get('username') || '';
  const row = await env.DB.prepare('SELECT server_salt FROM accounts WHERE username = ?').bind(username).first();
  if (!row) return json({ error: '未找到该账户' }, 404);
  return json({ serverSalt: row.server_salt });
}

async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const { username, authHash } = body;
  if (!username || !authHash) return json({ error: '缺少必要字段' }, 400);
  const row = await env.DB.prepare(
    'SELECT a.id, a.auth_hash, v.salt, v.iter, v.kdf, v.iv, v.mac, v.ct, v.wkiv, v.wk ' +
    'FROM accounts a LEFT JOIN vaults v ON v.user_id = a.id WHERE a.username = ?'
  ).bind(username).first();
  if (!row) return json({ error: '用户名或口令不正确' }, 401);
  if (!constantTimeEqual(row.auth_hash, authHash)) return json({ error: '用户名或口令不正确' }, 401);
  const token = await signSession(row.id, env.SESSION_SECRET);
  const headers = { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token, SESSION_TTL) };
  const envelope = row.salt ? JSON.stringify({
    v: 1, mode: 'cloud', kdf: row.kdf || 'PBKDF2-JS', iter: row.iter || 200000,
    salt: row.salt, iv: row.iv, mac: row.mac, ct: row.ct, wkiv: row.wkiv, wk: row.wk
  }) : null;
  return new Response(JSON.stringify({ ok: true, envelope: envelope }), { status: 200, headers });
}

async function logout(env) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie('', 0) }
  });
}

async function getVault(req, env) {
  const user = await requireUser(req, env);
  if (!user) return json({ error: '未登录' }, 401);
  const row = await env.DB.prepare('SELECT vault_envelope FROM vaults WHERE user_id = ?').bind(user.id).first();
  return json({ envelope: row ? row.vault_envelope : null });
}

async function putVault(req, env) {
  const user = await requireUser(req, env);
  if (!user) return json({ error: '未登录' }, 401);
  const body = await req.json().catch(() => ({}));
  const envObj = safeParse(body.envelope);
  if (!envObj || envObj.mode !== 'cloud' || !envObj.ct || !envObj.wk) return json({ error: '信封格式不合法' }, 400);
  await storeVault(env, user.id, envObj);
  return json({ ok: true, updatedAt: Date.now() });
}

async function storeVault(env, uid, envObj) {
  await env.DB.prepare(
    `INSERT INTO vaults (user_id, salt, iter, kdf, iv, mac, ct, wkiv, wk, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt, iter=excluded.iter, kdf=excluded.kdf,
       iv=excluded.iv, mac=excluded.mac, ct=excluded.ct, wkiv=excluded.wkiv, wk=excluded.wk, updated_at=excluded.updated_at`
  ).bind(
    uid, envObj.salt, envObj.iter || 200000, envObj.kdf || 'PBKDF2-JS',
    envObj.iv, envObj.mac, envObj.ct, envObj.wkiv, envObj.wk, Date.now()
  ).run();
}

/* --------------------- 服务端动态渲染（登录态） --------------------- */
async function accountPage(req, env) {
  const user = await requireUser(req, env);
  let body;
  if (!user) {
    body = `<p class="muted">你尚未登录。请在 App 的「设置 → 云端同步」中使用云端密码登录。</p>`;
  } else {
    const v = await env.DB.prepare('SELECT updated_at FROM vaults WHERE user_id = ?').bind(user.id).first();
    const lastSync = v && v.updated_at ? new Date(v.updated_at).toLocaleString('zh-CN') : '尚未同步';
    body = `
      <h2>你好，${escapeHtml(user.username)}</h2>
      <p>这是服务端依据会话态动态生成的内容。服务端只保存你上传的<strong>加密信封</strong>，无法读取其中的心情或业务数据。</p>
      <ul class="kv">
        <li><span>登录状态</span><b>已登录</b></li>
        <li><span>最近同步</span><b>${lastSync}</b></li>
        <li><span>数据可读性</span><b>服务端不可读（端到端加密）</b></li>
      </ul>
      <p class="muted">会话有效期 7 天，由 HttpOnly + HMAC 签名 Cookie 维持。</p>`;
  }
  return new Response(page(user ? 'MoodHub · 账户（已登录）' : 'MoodHub · 账户（未登录）', body), {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* ------------------------------ 工具 ------------------------------ */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
function utf8(s) { return new TextEncoder().encode(s); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
  <style>body{font:15px/1.6 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#222}
  h1,h2{color:#2f6f62}.muted{color:#777}.kv{list-style:none;padding:0}.kv li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee}
  .kv span{color:#777}</style></head><body><h1>MoodHub</h1>${body}
  <p style="margin-top:32px"><a href="/">返回应用</a></p></body></html>`;
}
