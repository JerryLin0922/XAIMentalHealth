# MoodHub Android（APK）

把 `moodhub-web` 的整套网页**原封不动**装进一个 Android WebView 壳，得到可安装、可离线使用的 APK。

## 一、方案选型

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **原生 WebView 壳（本方案）** | Kotlin + `androidx.webkit`，零第三方业务依赖，APK 仅 ~2 MB | ✅ 采用 |
| Capacitor | 需要 Node 工程 + Android SDK，产物类似，多一层插件运行时 | 可用，但对本项目是多余的 |
| React Native / Flutter | 需要把页面重写为声明式 UI，与「保留原有 HTML」的目标相悖 | 不采用 |
| PWA / TWA | 需要先部署 HTTPS 站点并配置 assetlinks | 可作为后续补充 |

**为什么用 `WebViewAssetLoader` 而不是 `file:///android_asset/`？**

`file://` 在部分 WebView 上没有安全上下文，`localStorage` 会被静默丢弃、`crypto.subtle` 不可用——
MoodHub 的口令派生与数据保存都会失效。把 assets 映射为
`https://appassets.androidplatform.net` 后，页面拥有真正的 HTTPS 源：

- `localStorage` / `sessionStorage` 持久可用（App 卸载前一直保留）
- `crypto.subtle` 可用 → 口令派生走 150k 迭代的原生路径
- 页面内 `fetch('js/xxx.js')` 等相对路径请求照常工作
- 与 Web 端行为完全一致，无需改一行业务代码

## 二、所需工具链

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | 18+ | 仅用于把 Web 资源同步进 assets |
| JDK | 17 | Gradle 编译用 |
| Android SDK | Platform 35 + Build-Tools 35.0.0 | |
| Gradle | 8.9（AGP 8.7.2） | |

**全部可以自动准备**：`android/scripts/build-apk.ps1` 会检测 JAVA_HOME / Android Studio 自带的 JBR，
缺失时自动下载 Temurin 17、Android cmdline-tools 与 Gradle，全部缓存在仓库内的 `.toolchain/`，
不影响系统环境。

## 三、打包流程

```powershell
# 一条命令出 Release APK（首次运行会自动装工具链，需联网，约 500 MB）
powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1

# 只改了网页想快速验证
powershell -ExecutionPolicy Bypass -File android\scripts\build-apk.ps1 -Variant Debug
```

等价的手工步骤：

```powershell
node tools\sync-web-assets.cjs android      # ① Web 资源 -> android\app\src\main\assets\www
cd android
gradle assembleRelease                       # ② 编译（脚本会自动下载 Gradle）
# 产物：android\dist\MoodHub-*.apk
```

安装到设备：

```powershell
adb install -r android\dist\MoodHub-1.0.0.apk
```

> 上架应用市场前，请把 `app/build.gradle.kts` 里 release 的
> `signingConfig = signingConfigs.getByName("debug")` 换成自己的 keystore。

## 四、工程结构

```
android/
├── app/
│   ├── build.gradle.kts                     模块配置（minSdk 26 / targetSdk 35）
│   └── src/main/
│       ├── AndroidManifest.xml              仅申请 INTERNET 一个权限
│       ├── java/com/moodhub/app/MainActivity.kt   WebView 壳（文件选择 / 下载 / 返回键）
│       ├── assets/www/                      ← 由 tools/sync-web-assets.cjs 生成
│       └── res/                             图标（自适应矢量）、主题、文案
├── scripts/build-apk.ps1                    一键构建 + 工具链自举
├── build.gradle.kts / settings.gradle.kts / gradle.properties
└── gradle/wrapper/gradle-wrapper.properties
```

## 五、网页能力 ↔ 原生能力 对照

| Web 端用法 | Android 侧实现 |
| --- | --- |
| `<input type="file">` 导入第三方健康数据 | `WebChromeClient.onShowFileChooser` → 系统文件选择器 |
| Blob + `a.download` 导出 JSON 备份 | `setDownloadListener` → 页面内 JS 把 Blob 转 base64 → `MediaStore.Downloads` |
| `window.confirm` / `alert` | `onJsConfirm` / `onJsAlert` → 原生对话框（页面自身优先用应用内弹窗，很少走到这里） |
| 物理返回键 | `OnBackPressedDispatcher` → `webView.goBack()` |
| 外部链接 | 非 `appassets.androidplatform.net` 的 URL 一律交给系统浏览器 |
| 定位权限 | `onGeolocationPermissionsShowPrompt` 直接拒绝，不采集任何位置 |
| 深色模式 | 页面自己按 `prefers-color-scheme` 切换，壳不干预 |

## 六、隐私与安全

- `android:allowBackup="false"`：记录不入云备份
- `android:usesCleartextTraffic="false"`：禁明文 HTTP
- 未申请存储、定位、相机等任何权限；导出文件走 `MediaStore.Downloads`（API 29+ 免权限）
- 数据仍只写本机 WebView 存储，行为与浏览器版一致
