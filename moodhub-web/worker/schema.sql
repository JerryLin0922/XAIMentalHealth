-- MoodHub 后端 D1 表结构
-- 部署：wrangler d1 execute --local --file=./schema.sql  （本地）
--        wrangler d1 execute --remote --file=./schema.sql （生产）

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,
  server_salt TEXT NOT NULL,          -- 仅用于服务端登录校验，非机密
  auth_hash   TEXT NOT NULL,          -- sha256(server_salt + password)，服务端不可反推口令
  created_at  INTEGER NOT NULL
);

-- 加密信封（服务端只存密文，永远无法解密）
CREATE TABLE IF NOT EXISTS vaults (
  user_id    INTEGER PRIMARY KEY,
  salt       TEXT NOT NULL,           -- 信封 PBKDF2 盐（随信封上送）
  iter       INTEGER NOT NULL,
  kdf        TEXT NOT NULL,
  iv         TEXT NOT NULL,           -- AES-CTR nonce (base64)
  mac        TEXT NOT NULL,           -- HMAC-SHA256 (base64)
  ct         TEXT NOT NULL,           -- 密文 (base64)
  wkiv       TEXT NOT NULL,           -- 包裹 dataKey 的 nonce (base64)
  wk         TEXT NOT NULL,           -- 被口令密钥包裹的 dataKey (base64)
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
