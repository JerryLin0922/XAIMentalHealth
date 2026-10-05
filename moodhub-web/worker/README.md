# MoodHub 后端（Cloudflare Worker + D1）

仅存储**加密信封**的后端：服务端拿不到口令、拿不到 dataKey，因此无法解密任何用户数据。

## 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册：上传 `serverSalt / authHash / 加密信封` |
| GET  | `/api/auth/salt?username=` | 取登录盐（用于客户端计算 `authHash`） |
| POST | `/api/auth/login` | 校验 `authHash`，签发会话 Cookie，返回加密信封 |
| POST | `/api/auth/logout` | 清除会话 Cookie |
| GET  | `/api/vault` | 取回自己的加密信封（需登录） |
| PUT  | `/api/vault` | 覆盖上传加密信封（需登录） |
| GET  | `/account` | 服务端动态渲染：依据会话态展示登录状态与最近同步时间 |
| GET  | `/api/health` | 健康检查 |

## 本地开发
```bash
npm install
wrangler d1 create moodhub          # 记下 database_id，填入 wrangler.toml
wrangler secret put SESSION_SECRET  # 设置一个强随机值
npm run db:init:local               # 初始化 local D1
npm run dev                         # http://localhost:8787
```

## 部署
```bash
wrangler secret put SESSION_SECRET
npm run db:init                     # 初始化生产 D1
npm run deploy
```
前端（Web 或小程序的 `apiBase`）指向 `https://<your-subdomain>.workers.dev` 即可。

## 安全
- 服务端只保存 `iv / ct / wkiv / wk / mac / salt` 等密文与 `authHash`（单向哈希）。
- 登录态为 HMAC 签名的 HttpOnly Cookie，7 天有效。
- `SESSION_SECRET` 必须为 secret，切勿提交进版本库。
