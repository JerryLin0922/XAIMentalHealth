# 跨平台移植总览：一份 HTML → APK / EXE / 微信小程序

`moodhub-web` 是**零构建、零依赖的纯静态站点**：`index.html` + `css/` + `js/` + `i18n/` + `icons/` + `shared/`。
这决定了三个平台的移植策略各不相同，但可以共用同一条原则：

> **能复用逻辑就绝不重写，只重写「渲染层 + 运行时 API」。**

| 平台 | 复用方式 | 需要重写的东西 |
| --- | --- | --- |
| Android APK | **整站复用**：网页原封不动打进 `assets/www/` | 只有一层 WebView 壳（约 300 行 Kotlin） |
| Windows EXE | **整站复用**：网页原封不动打进 `www/` | 只有一层 Electron 壳（约 200 行） |
| 微信小程序 | **逻辑复用**：`js/core/*` 自动转成 CommonJS | 视图层按 WXML/WXSS 重做（约 6 个页面） |

---

## 一、先做一次「可移植性体检」

动手前先统计站点到底用了哪些浏览器 API，这决定了后面每个平台要垫多少东西：

```powershell
$p = @('localStorage','sessionStorage','crypto.subtle','fetch(','FileReader','new Blob',
       'createObjectURL','confirm(','matchMedia','pushState','navigator.','indexedDB',
       'new Worker','eval(','new Function','document.cookie','IntersectionObserver')
foreach ($x in $p) {
  $c = (Select-String -Path (Get-ChildItem -Recurse -Include *.js,*.html -Path js,index.html,shared).FullName `
        -Pattern $x -AllMatches | Measure-Object).Count
  "{0,-24} {1}" -f $x, $c
}
```

结论（本项目实测）：

- 重度依赖 `localStorage` / `sessionStorage` → **三个平台都必须提供真正的安全上下文**
- 用 `crypto.subtle`（PBKDF2 150k）→ 必须有 **Secure Context**，否则静默降级到 10k 迭代的纯 JS 路径
- 用 `FileReader` / `Blob` / `a.download` → 三端的「导入/导出」都要换原生通道
- **没有** `eval` / `new Function` / `new Worker` / `document.cookie` → 小程序的代码扫描与 CSP 都能过
- **没有** CDN、外部字体、外部图片 → 离线可用，APK/EXE 无需联网

---

## 二、Android APK：WebView 壳

### 方案选型

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **原生 WebView 壳** | Kotlin + `androidx.webkit`，无第三方运行时，APK ~2 MB | ✅ 采用 |
| Capacitor | 需 Node 工程 + 插件体系，产物等价但多一层运行时 | 备选（仓库外层 scaffold 已含 `@capacitor/android`） |
| React Native / Flutter | 需把页面重写为声明式 UI，违背「保留原 HTML」 | 不采用 |
| TWA / PWA | 需先部署 HTTPS 站点 + `assetlinks.json` | 可作为后续补充 |

### 关键技术决策：用 `WebViewAssetLoader`，不用 `file:///android_asset/`

这是**最容易踩的坑**。`file://` 来源在 WebView 里缺少安全上下文，会导致：

- `localStorage` 被静默丢弃 —— 用户记录全丢
- `crypto.subtle` 不可用 —— 口令派生被迫降到 10k 迭代

改用 `androidx.webkit.WebViewAssetLoader` 把 assets 映射成
`https://appassets.androidplatform.net/` 后，页面拿到真正的 HTTPS 安全上下文，
相对路径请求、存储、Web Crypto 全部与浏览器一致，**一行业务代码都不用改**。

```kotlin
val assetLoader = WebViewAssetLoader.Builder()
    .setDomain(ASSET_DOMAIN)          // appassets.androidplatform.net
    .addPathHandler("/assets/", AssetsPathHandler(this))
    .build()

webView.webViewClient = object : WebViewClientCompat() {
    override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? =
        assetLoader.shouldInterceptRequest(r.url)
}
```

### 网页能力 ↔ 原生能力对照

| 网页用法 | Android 实现 |
| --- | --- |
| `<input type="file">` 导入健康数据 | `onShowFileChooser` → 系统文件选择器 |
| `Blob` + `a.download` 导出 JSON | `setDownloadListener` → 页面内转 base64 → `MediaStore.Downloads` |
| `confirm()` / `alert()` | `onJsConfirm` / `onJsAlert` → 原生对话框 |
| 物理返回键 | `OnBackPressedDispatcher` → `webView.goBack()` |
| 外链 | 非 asset 域一律交系统浏览器 |
| 定位权限 | 直接拒绝，不采集位置 |

### 构建

```powershell
powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1          # Release
powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1 -Variant Debug
```

脚本会**自举整条工具链**并缓存在仓库内 `.toolchain/`，不污染系统：
JDK 17（Temurin）→ Android cmdline-tools + Platform 35 + Build-Tools 35 → Gradle 8.9，
然后同步资源并 `gradle assembleRelease`，产物落到 `android/dist/`。

---

## 三、Windows EXE：Electron 壳

### 方案选型

| 方案 | 体积 | 额外工具链 | 独立性 |
| --- | --- | --- | --- |
| **Electron** | ~85 MB | 无（纯 Node） | 自带 Chromium，完全独立 ✅ |
| Tauri 2 | ~5 MB | 需 Rust | 依赖系统 WebView2（Win10 需补装） |
| Neutralinojs | ~2 MB | 无 | 依赖系统 WebView，稳定性弱 |
| NW.js | ~110 MB | 无 | 等价，生态弱 |

选 Electron 的决定性理由：**要求断网可用、`crypto.subtle` 必须可用**。
自带 Chromium 意味着不依赖目标机器装了什么。

### 关键技术决策：自定义 `app://` 协议，不用 `file://`

和 Android 同理 —— `file://` 会让 `localStorage` 与 `crypto.subtle` 失效。

```js
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

protocol.handle('app', (req) => serveFile(new URL(req.url).pathname));
win.loadURL('app://moodhub/index.html');
```

渲染进程保持最小权限：

```js
webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
```

`preload.js` 只通过 `contextBridge` 暴露一个只读的 `MOODHUB_DESKTOP`（平台标识），
业务代码与浏览器版完全相同。

### 构建

```powershell
cd desktop
npm install
npm run dist        # NSIS 安装包 + Portable 单文件，产物在 desktop/release/
npm start           # 开发模式直接打开
```

---

## 四、微信小程序：逻辑复用 + 视图重写

### 为什么不能整站复用

小程序没有 DOM，WXML 与 HTML 不是一回事，`js/views/*`（DOM 拼装层）无法运行。
但 `js/core/*` 是**纯逻辑**：日期、统计、校验、BM25 检索、问答、本地陪伴引擎，
不碰 DOM、不碰 `window`。所以策略是：

```
Web js/core/*  ──(tools/sync-web-assets.cjs 自动拷贝 + CommonJS 改写)──▶  miniprogram/utils/core/*
浏览器全局 API ──(utils/adapters.js 垫片)────────────────────────────▶  wx.getStorageSync / wx.request
Web js/views/* ──(DOM 无法复用) ─────────────────────────────────────▶  pages/*/*.wxml + wxss 重写
```

### 自动生成内核

```bash
node tools/sync-web-assets.cjs miniprogram
```

脚本把 IIFE 的 `})(window.MH = window.MH || {});` 改写成 `})(MH);`，
并在文件头插入 `var MH = require('./../../_ns.js');`（路径按目录深度自动计算），
生成 `miniprogram/utils/core/` —— **内容与 Web 端逐字对应，禁止手工编辑**。

### 四个必须垫的浏览器 API（`utils/adapters.js`）

| 浏览器 | 小程序 | 垫片实现 |
| --- | --- | --- |
| `localStorage` | `wx.getStorageSync` | 同步读写、字符串语义一致 |
| `sessionStorage` | 无原生对应 | 进程内 `Map`（小程序进程即会话，生命周期等价） |
| `crypto.getRandomValues` | `wx.getRandomValues` | 同步形态优先，失败回退 `Math.random` |
| `fetch` | `wx.request` | 返回 `{ok, status, json(), text()}`，手工携带/保存会话 Cookie |

另外补一个 `navigator.userAgent`，供 `store.deviceLabel()` 显示设备名。

### 平台限制与应对

| 限制 | 影响 | 应对 |
| --- | --- | --- |
| request 合法域名白名单 | 云同步 / 云端模型被拦 | 后台配置域名；开发期勾「不校验合法域名」 |
| 主包 ≤ 2 MB | 塞不下完整内核 | 内核约 210 KB，余量充足；超出再走分包 |
| 禁止远程代码 / `eval` | 无法动态拉脚本 | 内核全部本地内置（本项目本就不用 eval） |
| 文件读取受限 | 读不到系统目录的健康导出 | 引导用户先把 CSV 发给「文件传输助手」，用 `wx.chooseMessageFile` 选取 |
| 无原生 `sessionStorage` | 会话级来源持久化 | 进程内 Map，语义等价 |
| 不支持内联 SVG | `js/core/charts.js` 不可用 | `components/line-chart`（canvas 2d 手绘） |
| 无 Web Crypto | PBKDF2 降级 | 内核自带纯 JS 回退，自动降到 10k 迭代 |
| tab 页不能 `navigateTo` 自身 | 列表跳详情受限 | 记录页就地展开编辑表单 |

### 验证（不需要微信开发者工具）

```bash
node tools/check-miniprogram-kernel.cjs
```

用 wx 桩跑 30 项断言：13 个命名空间加载、记录落 `wx.storage`、
统计与 Web 端同源、指标校验、危机词求助、CSV 解析、BM25/数值问答、加密往返。

---

## 五、`tools/` 自动化脚本

| 脚本 | 作用 |
| --- | --- |
| `tools/sync-web-assets.cjs` | 把 Web 资源同步到 `android/assets/www`、`desktop/www`、`miniprogram/utils/core`（含 IIFE→CommonJS 改写） |
| `tools/make-icons.cjs` | 纯 Node 生成 `desktop/build/icon.{png,ico,svg}`（手写 PNG 编码器，无第三方依赖） |
| `tools/check-miniprogram-kernel.cjs` | 小程序内核冒烟测试 |

```bash
node tools/sync-web-assets.cjs android      # 同步到 Android
node tools/sync-web-assets.cjs desktop      # 同步到桌面端
node tools/sync-web-assets.cjs miniprogram  # 同步内核到小程序
node tools/sync-web-assets.cjs list         # 查看资源清单
```

---

## 六、三端一致性保证

| 维度 | 保证方式 |
| --- | --- |
| 业务逻辑 | APK / EXE 直接跑原网页；小程序跑同一份 `js/core/*` |
| 数据结构 | 统一 `moodhub.v1.*`，备份文件三端互通 |
| 加密协议 | `shared/cipher.js` 三端共享，密文可跨端解密 |
| 云同步 | 同一套 E2EE 协议，同一账户跨端恢复 |
| 隐私边界 | 三端均只写本机存储；联网只在用户显式开启时发生 |

改一处逻辑，跑一次 sync，三端同时生效 —— 这是把核心逻辑与渲染层分离的直接收益。
