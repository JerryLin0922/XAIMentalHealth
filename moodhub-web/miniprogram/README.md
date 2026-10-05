# MoodHub 微信小程序

与 `moodhub-web` 网站核心业务一致的小程序端：用户认证、数据加密存储与读取、看板展示、
记录增删、以及端到端加密的云端同步。

## 运行
1. 微信开发者工具 → 导入项目 → 选择本目录（`miniprogram/`），AppID 可用「测试号」。
2. 在 `app.js` 或「设置」页把 `apiBase` 指向你的 Worker 地址
   （如 `https://your-moodhub-api.workers.dev`）。
3. 登录 / 注册后即可使用；未启用云端时数据仅保存在本机 `wx.storage`。

## 与网站的关系
- **同一套加密内核**：`utils/cipher.js` 与 Web 端 `shared/cipher.js` 同构，密文三端互解。
- **同源同步逻辑**：`utils/vault.js` 与 Web 端 `js/core/vault.js` 算法一致，可用同一云端账户登录。
- 功能对齐：认证、加密存储/读取、记录列表与新增、看板指标、设置里的加密同步。

## 目录
```
app.js / app.json / app.wxss      入口与全局
utils/cipher.js  api.js  store.js  vault.js
pages/{login,dashboard,records,settings}/
```
