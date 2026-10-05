# MoodHub 新功能架构设计：加密存储 · 动态网站 · 微信小程序

> 本文件说明三项新功能（用户数据加密存储、网站动态化改造、微信小程序端）与现有
> `moodhub-web` 项目的集成方式、目录结构、数据流与依赖变更。
> 现有项目是「零依赖、零构建、纯前端、本地优先」的心情记录应用；本次升级在**不破坏
> 本地优先隐私承诺**的前提下，新增可选的端到端加密云端同步与小程序端。

---

## 1. 设计原则（不可妥协）

1. **服务端永不可读**：云端只保存「加密信封」（密文 + 被口令密钥包裹的 dataKey）。
   服务端没有口令、没有 dataKey，无法解密任何一条记录。验证见 `tests/cipher.cjs`
   的「仅持信封无法解密」用例。
2. **同一套加密内核，三端字节级一致**：浏览器、Cloudflare Worker、微信小程序复用
   `shared/cipher.js`（纯 JS、零依赖、无 Web Crypto 依赖），保证任一端上传的密文
   都可在另一端点解密。
3. **本地优先不变**：默认仍是 `localStorage` 本地存储；云端同步是**显式启用**的开关，
   且每次上传都是「全量加密快照」，不引入额外的遥测或自动外发。
4. **口令不离开设备**：用于服务端登录校验的是一枚独立的 `authHash`（
   `sha256(serverSalt + password)`），与数据加密密钥完全解耦。服务端即便被攻破，
   拿到的也只是哈希与密文。

---

## 2. 加密方案（同时适用于浏览器端与小程序端）

### 2.1 算法
- **AES-256-CTR**（仅正向变换，加解密共用 keystream）+ **HMAC-SHA256**（Encrypt-then-MAC）。
- 派生：`PBKDF2-HMAC-SHA256(password, salt, 200000) → 64B`，前 32B 为 `encKey`，
  后 32B 为 `macKey`（参数写进信封，验证时使用同一参数，保证跨端一致）。
- 全部为**纯 JS 实现**，因此浏览器（Web Crypto 不可用时）、Worker、微信小程序
  （`wx.getRandomValues` / `wx.base64*` 走小程序适配分支）行为完全一致。

### 2.2 两种模式
| 模式 | 用途 | 信封字段 |
|------|------|----------|
| `local` | 本机直接加密（离线、无账号） | `salt, iv, ct, mac` |
| `cloud` | 信封加密，便于同步 | `salt, iv, ct, wkiv, wk, mac` + 本地 `dataKeyHint` |

`cloud` 模式（信封加密 / envelope encryption）：
1. 生成随机 **dataKey(32B)** 用 AES-CTR 加密业务数据；
2. dataKey 用「口令派生密钥 encKey」再包裹一次（`wk`），与密文一起上传；
3. 服务端只有 `wk` 与 `ct`，没有口令就无法解开 `wk`，也就拿不到 dataKey。

### 2.3 密钥管理
- **口令**：用户持有，不落盘、不上传。仅在本机内存中派生出会话密钥 `km`
  （64B），刷新即丢失，需再次输入口令——与现有「本机访问锁」一致。
- **dataKey**：由客户端随机生成、自管理；云端只存其被包裹后的密文 `wk`。
- **服务端 authHash**：仅用于登录校验，独立于数据密钥；服务端可验证「是你」，
  但无法用它解密数据。
- **会话态**：Worker 用 HMAC 签名的 HttpOnly Cookie（`moodhub_sid`，7 天）维持登录态，
  小程序端手动管理该 Cookie（`utils/api.js`）。

### 2.4 加密数据范围
| 类别 | 是否加密 | 说明 |
|------|----------|------|
| 账号（用户名） | 明文存服务端用于定位账户 | 不含口令/密码哈希以外的敏感字段 |
| 个人资料 / 偏好 | ✅ 密文 | 在 `exportAll()` 快照内 |
| 业务数据（心情/睡眠/心率/压力记录、对话、问答源、导入历史） | ✅ 密文 | 核心加密对象 |
| 服务端 authHash | 单向哈希 | 不可反推口令 |

---

## 3. 网站动态化改造

### 3.1 集成方式
- **前端**：现有 SPA（`index.html` + `js/`）不变，新增两个脚本：
  - `shared/cipher.js`（加密内核，先于 vault 加载）
  - `js/core/vault.js`（云同步桥）+ `js/views/cloud.js`（设置页「云端同步」面板）
- **后端**：新增 `worker/` —— Cloudflare Worker（ES Module）+ D1 数据库，处理
  `/api/*`。静态 SPA 仍可由 Cloudflare Pages / 任意静态托管提供，Worker 作为 `/api` 后端
  （也可合并部署为同一 Worker）。

### 3.2 服务端负责什么（动态 / 有状态）
- **用户登录状态管理**：`/api/auth/*` 校验 `authHash`、签发/校验会话 Cookie、
  提供 `/account` 服务端动态渲染页（依据会话态展示「已登录/未登录 + 最近同步时间」）。
- **动态内容渲染**：`/account` 由 Worker 用服务端数据拼装 HTML（演示服务端渲染与登录态）。
- **加密数据托管**：`/api/vault` 的 GET/PUT 仅持久化密文信封，所有加解密在客户端。
- **与加密存储联动**：用户态只是「能不能读写自己的密文」的门禁；数据内容始终由客户端
  用 `MH.cipher` 加解密，Worker 不接触明文。

---

## 4. 微信小程序端

### 4.1 与网站核心业务的一致性
小程序复用**同一份加密内核**（`miniprogram/utils/cipher.js` 是 `shared/cipher.js` 的副本），
并实现与 Web 端 `vault.js` **同源逻辑**的 `miniprogram/utils/vault.js`，因此两端可以：
- 用同一云端账户登录；
- 同一份密文在两端互解（数据可跨端迁移）；
- 功能对齐：用户认证、数据加密存储与读取、记录列表/新增、看板指标展示、设置里的
  加密同步与基础交互。

### 4.2 目录结构与页面
```
miniprogram/
├── app.js / app.json / app.wxss      App 入口、页面注册、全局样式
├── sitemap.json / project.config.json
├── utils/
│   ├── cipher.js     ← 与 shared/cipher.js 同构（UMD，三端一致）
│   ├── api.js        wx.request 封装 + 会话 Cookie 管理
│   ├── store.js      本地存储（wx.storage）记录 CRUD
│   └── vault.js      云端同步桥（与 Web vault 同源逻辑）
└── pages/
    ├── login/        登录 / 注册（启用加密同步）
    ├── dashboard/    四项指标均值 + 最近记录
    ├── records/      记录列表 + 新增 / 删除
    └── settings/     后端地址、上传、恢复、退出
```

---

## 5. 目录结构总览（新增 / 修改）

```
moodhub-web/
├── shared/cipher.js              【新增】三端共享加密内核（AES-256-CTR + HMAC）
├── tests/cipher.cjs              【新增】加密内核测试（FIPS 向量/往返/篡改/云信封）
├── js/core/vault.js              【新增】Web 云同步桥（fetch ↔ Worker）
├── js/views/cloud.js             【新增】设置页「云端同步」面板
├── index.html                    【修改】加载顺序加入 cipher.js / vault.js / cloud.js
├── js/views/settings.js          【修改】在设置页插入云同步卡片
│
├── worker/                       【新增】Cloudflare Worker 后端
│   ├── src/index.js              路由：/api/auth/*、/api/vault、/account
│   ├── schema.sql               D1：accounts + vaults(纯密文)
│   ├── wrangler.toml            D1 绑定 + SESSION_SECRET
│   ├── package.json             wrangler 脚本
│   └── README.md
│
└── miniprogram/                  【新增】微信小程序端（见 §4.2）
```

---

## 6. 数据流设计

### 6.1 上传（本机 → 云端）
```
本地数据 ──MH.store.exportAll()──▶ 明文对象
   │
   ▼  MH.cipher.encrypt(data, password, {mode:'cloud'})
   ├─ PBKDF2(password,salt) → encKey‖macKey
   ├─ 随机 dataKey 加密数据 → ct
   ├─ encKey 包裹 dataKey  → wk
   └─ HMAC(macKey, iv‖ct‖wkiv‖wk) → mac
   │
   ▼  信封 {salt,iv,ct,wkiv,wk,mac}（+ 独立 authHash 用于登录）
POST /api/auth/register 或 PUT /api/vault
   │
   ▼  Worker 写入 D1 vaults（仅密文；口令/密钥均不在服务端）
```

### 6.2 下载（云端 → 本机）
```
GET /api/vault（携带会话 Cookie）
   │
   ▼  Worker 返回密文信封
MH.cipher.decrypt(envelope, password) → 明文对象
   │
   ▼  MH.store.importAll(data, 'merge')
本机记录合并更新
```

### 6.3 本地 / 云端切换与同步策略
- **默认 local**：只写 `localStorage`，不联网（保持原有隐私边界）。
- **启用 cloud（用户显式操作）**：在设置页输入云端密码完成注册/登录，随后可
  - 上传：将本机全量数据加密后覆盖上传；
  - 恢复：拉取云端密文解密后合并回本机；
  - 同步：`pull → push` 的简单策略，适合「个人、以单设备为主」的场景。
- **冲突处理**：当前采用「全量快照 + 合并」；多设备并发的细粒度冲突解决可作为后续迭代
  （在 `vault.sync` 内增加向量时钟/最后写入胜利策略）。

---

## 7. 关键依赖变更

| 平台 | 原依赖 | 变更 |
|------|--------|------|
| Web | 零依赖、零构建 | 新增 `shared/cipher.js`、`js/core/vault.js`、`js/views/cloud.js`；无第三方包 |
| 后端 | 无 | 新增 Cloudflare **Workers + D1**（`wrangler` 仅开发依赖）；无运行时 npm 包 |
| 小程序 | 无 | 复用 `shared/cipher.js` 副本；仅用微信原生 API（`wx.request`/`wx.storage`），无 npm 依赖 |

> 全程**零运行时第三方加密库**，AES/HMAC/PBKDF2 为自包含纯 JS 实现，已在
> `tests/cipher.cjs` 中对照 Node 原生 `aes-256-ctr` 与 FIPS 向量验证。

---

## 8. 安全边界与已知限制
- 会话密钥 `km` 仅存于内存，刷新需重新输入云端密码（与本地锁一致）。
- 多设备并发写入的冲突解决为「最后写入覆盖 + 合并」，非 CRDT；多端频繁同改同一记录需后续增强。
- 忘记云端密码**无法找回**（服务端无口令），只能清空云端账户后重建——界面会如实提示。
- Worker 的 `SESSION_SECRET` 必须通过 `wrangler secret put` 注入，禁止提交到仓库。
