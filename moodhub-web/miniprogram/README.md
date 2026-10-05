# MoodHub 微信小程序

把 `moodhub-web` 迁移到微信小程序的完整实现：**核心逻辑零重写**，视图层按小程序习惯重做。

## 一、迁移思路：三层拆分

```
Web 端 js/core/*  ──(tools/sync-web-assets.cjs 自动拷贝 + CommonJS 改写)──▶  utils/core/*
浏览器全局 API    ──(utils/adapters.js 垫片)──────────────────────────▶  wx.getStorageSync / wx.request
Web 端视图层      ──(DOM 无法复用，按页面重写)─────────────────────────▶  pages/*/*.wxml + wxss
```

关键点：**Web 端 `js/core/` 是纯逻辑（无 DOM、无打包器）**，所以只要垫好四个浏览器全局，
就能原样运行——日期、统计、校验、BM25 检索、问答、本地陪伴引擎在小程序里跑的是同一份代码。

## 二、目录

```
miniprogram/
├── app.js / app.json / app.wxss
├── utils/
│   ├── adapters.js        平台垫片（storage / crypto.getRandomValues / fetch / navigator）
│   ├── _ns.js             MH 命名空间（避免 require 循环）
│   ├── mh.js              内核入口：按 index.html 的脚本顺序加载 core/*
│   ├── core/              ← 自动生成，与 Web 端 js/core/ 一一对应（请勿手改）
│   ├── cipher.js          三端共享加密内核（与 shared/cipher.js 逐字节一致）
│   ├── store.js           旧 store API 兼容层，转发到 MH.store.records
│   ├── vault.js           端到端加密云同步（与 Web 端协议一致）
│   └── api.js             wx.request 封装 + 手工会话 Cookie
├── components/line-chart/ canvas 2d 折线图（替代 Web 端 charts.js 的 SVG）
└── pages/{login,dashboard,records,companion,qa,settings}/
```

## 三、API 差异与应对

| 浏览器 | 小程序 | 处理位置 |
| --- | --- | --- |
| `localStorage` / `sessionStorage` | `wx.getStorageSync`（无原生会话存储） | `adapters.js`：localStorage 垫片 + 内存 sessionStorage |
| `crypto.subtle`（150k 迭代 PBKDF2） | 无 Web Crypto | 内核自带纯 JS 回退，自动落到 10k 迭代；随机数走 `wx.getRandomValues` |
| `fetch` | `wx.request` | `adapters.js`：返回 `{ok, status, json(), text()}`，手工带 Cookie |
| `FileReader` / `<input type="file">` | `wx.chooseMessageFile` + `FileSystemManager.readFile` | `pages/qa/qa.js` |
| `Blob` + `a.download` 导出 | 写入 `USER_DATA_PATH` 后 `wx.shareFileMessage` | `pages/settings/settings.js` |
| SVG 图表（`charts.js`） | 不支持内联 SVG | `components/line-chart`（canvas 2d） |
| `window.confirm` / 自绘弹窗 | `wx.showModal` | 视图层直接用 `wx.showModal` |
| 路由（顶栏 + 弹窗） | `tabBar` + `wx.navigateTo` | `app.json` |
| `document.documentElement.dataset.theme` 深色模式 | 需在 `app.json` 配 `darkmode` + 主题变量 | 见下方「平台限制」 |

## 四、平台限制与应对策略

| 限制 | 影响 | 应对 |
| --- | --- | --- |
| 请求必须走已配置的 request 合法域名 | 云同步 / 云端模型请求会被拦 | 在小程序后台把 Worker 域名加入 request 合法域名；开发期勾选「不校验合法域名」 |
| 主包 ≤ 2 MB（总包 ≤ 30 MB） | 不够放 5 步导入向导 + 模型管理 | `utils/core/` 内核约 210 KB；`health-import/` 已放进主包，后续超出再走分包 |
| 不能加载远程代码 / 无 `eval` | 不能像网页一样按需拉脚本 | 全部内核本地内置，无需动态加载 |
| 文件读取仅限「聊天文件」与用户目录 | 无法直接读手机相册/系统目录的导出文件 | 引导用户先把厂商导出的 CSV 发给「文件传输助手」，再从聊天记录选文件 |
| 无真实 CSPRNG 的环境（低版本基础库） | 加密随机性下降 | `wx.getRandomValues`（基础库 2.24+），失败回退 `Math.random` 并在上游文档注明 |
| `sessionStorage` 无原生对应 | 「仅本次会话」的问答来源重启后仍在内存 | 用进程内 Map 实现生命周期等价（小程序进程即会话） |
| 分包 / tab 页不能 `navigateTo` 自身 | 记录列表点条目跳详情受限 | 直接在当前页展开编辑表单 |

## 五、运行

1. 微信开发者工具 → 导入项目 → 选择本目录（`miniprogram/`），AppID 用「测试号」即可。
2. 若要启用云同步：在 `app.js` 或「设置」页把 `apiBase` 指向你的 Worker 地址，
   并在公众平台「开发管理 → 服务器域名」加入该域名。
3. 不登录也能完整使用看板 / 记录 / 陪伴 / 问答。

## 六、验证（不需要微信开发者工具）

```bash
node tools/check-miniprogram-kernel.cjs
```

用 wx 桩跑通 30 项断言：内核 13 个命名空间加载、记录落 `wx.storage`、
统计聚合与 Web 端同源、指标校验、危机词求助、CSV 解析、BM25/数值问答、加密往返。
