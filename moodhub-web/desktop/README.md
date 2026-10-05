# MoodHub Desktop（Windows EXE）

把 `moodhub-web` 打包成**独立可执行文件**：双击即可运行，不依赖用户装浏览器、不需要服务器。

## 一、方案选型

| 方案 | 产物体积 | 是否需要 Rust/Python | 独立性 | 结论 |
| --- | --- | --- | --- | --- |
| **Electron（本方案）** | ~85 MB | 否，纯 Node | 自带 Chromium，完全独立 | ✅ 采用 |
| Tauri 2 | ~5 MB | 需 Rust 工具链 | 依赖系统 WebView2（Win10 需补装） | 体积更优，可作为二期 |
| Neutralinojs | ~2 MB | 否 | 依赖系统 WebView | 稳定性弱于前两者 |
| NW.js | ~110 MB | 否 | 自带 Chromium | 与 Electron 等价，生态弱一些 |

选择 Electron 的决定性理由：**本项目要求数据只存本机、断网可用、`crypto.subtle` 必须可用**。
Electron 自带完整 Chromium，不依赖目标机器上装了什么版本的 WebView。

## 二、文件清单

```
desktop/
├── package.json            依赖与构建命令
├── main.js                 主进程：注册 app:// 协议、建窗口、拦外链、记窗口状态
├── preload.js              只暴露只读的运行环境标识（nodeIntegration 关闭）
├── electron-builder.yml    EXE/安装包配置（NSIS + Portable）
├── build/icon.ico|png|svg  图标（tools/make-icons.cjs 生成）
├── www/                    ← 由 tools/sync-web-assets.cjs 从仓库根目录同步进来
└── README.md
```

## 三、构建命令

```powershell
cd desktop
npm install                 # 首次：装 electron + electron-builder（需联网）
npm run dist                # 出安装包 + 免安装单文件
```

产物在 `desktop/release/`：

| 文件 | 用途 |
| --- | --- |
| `MoodHub-1.0.0-x64-Setup.exe` | NSIS 安装包，支持自定义目录、桌面/开始菜单快捷方式 |
| `MoodHub-1.0.0-x64-Portable.exe` | 免安装单文件，解压到临时目录直接跑，适合 U 盘携带 |

日常调试：

```powershell
npm start        # 同步网页 -> 直接以开发模式打开
```

## 四、关键实现点

**1. 用 `app://` 自定义协议，而不是 `file://`**

```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
```

`file://` 在 Chromium 里会命中「不可信来源」，导致：
- `localStorage` 在部分配置下被禁用（数据全丢）
- `crypto.subtle` 不可用 → 口令派生被迫退到 10k 迭代的纯 JS 路径

`app://moodhub` 声明为 `secure: true` 后，页面获得与 `https://` 等价的安全上下文，
以上问题全部消失，且路径解析与线上完全一致。

**2. 渲染进程零 Node 权限**

```js
webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
```

`preload.js` 只通过 `contextBridge` 暴露一个只读对象（平台标识），
业务代码与浏览器版完全相同，攻击面最小。

**3. 不让用户「离开应用」**

- `setWindowOpenHandler` → 拦 `window.open`，外部 http(s) 交给系统浏览器
- `will-navigate` → 禁止整页跳转到应用外
- 单实例锁 → 双击图标聚焦已有窗口，避免两个进程读写同一份 localStorage

**4. 窗口状态持久化**

尺寸/位置/最大化状态写入 `userData/window-state.json`，下次启动还原。

## 五、隐私说明

- 数据依旧只写 Chromium 的 localStorage，存放在
  `%APPDATA%\MoodHub\Local Storage\leveldb\`
- 主进程不发起任何网络请求；页面只有在「模型」页显式开启云端模型或配置云同步时才会联网
- 卸载不删数据（`deleteAppDataOnUninstall: false`），避免误删心情记录
