---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 01f8f8ba8e1924f80ffb2088ef932ff7_1e0cfbeec00511f197eb525400393706
    ReservedCode1: Zqpcu80njjxhgw1SEBes+K4/ubrU2nPq8IW6e0YY59zSctNIrygcm2ZQoBpUZSXc+mrbRPlrhxpDVmeyFVb6RjnBunTF6t70FU0GsuxqovE4CnzURj88MAeVgpim8QipmXaRSxAboU8iCatIccgMSOqWeGD7eAaie7TwNgpHFP4LHjw8xKSvXcPnC5g=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 01f8f8ba8e1924f80ffb2088ef932ff7_1e0cfbeec00511f197eb525400393706
    ReservedCode2: Zqpcu80njjxhgw1SEBes+K4/ubrU2nPq8IW6e0YY59zSctNIrygcm2ZQoBpUZSXc+mrbRPlrhxpDVmeyFVb6RjnBunTF6t70FU0GsuxqovE4CnzURj88MAeVgpim8QipmXaRSxAboU8iCatIccgMSOqWeGD7eAaie7TwNgpHFP4LHjw8xKSvXcPnC5g=
---

# MoodHub 模块实现方案（面向 XAIMentalHealth 仓库）

> 目标仓库：`https://github.com/JerryLin0922/XAIMentalHealth`
> 模块形态：Web 版患者端心情记录与管理应用，零依赖、零构建、断网可用，可通过静态网站直接运行与测试。

---

## 一、模块定位与架构归属

在 XAIMentalHealth 现有「模块化微服务架构」中，MoodHub 落在 **前端交互层 · 患者端（Web 版）**，承担患者日常数据采集、自我觉察与温和陪伴职责：

| XAIMentalHealth 架构层级 | MoodHub 承担的角色 |
|---|---|
| 前端交互层 | 患者端 Web（本模块），浏览器直接运行 |
| 后端服务层 | 预留 RESTful API 网关对接位（`MH.api` 适配层，默认本地模式） |
| 数据处理层 | 本地 ETL：第三方健康数据导入、清洗、去重、聚合 |
| 模型层 | 本地规则引擎 + 本地检索统计引擎为默认；可选接入云端 LLM（直连服务商） |
| 干预引擎 | 「陪伴」会话内置危机识别与求助资源引导 |
| 隐私保护层 | 全站本地优先：localStorage/sessionStorage，默认零网络请求 |

设计原则：**MoodHub 以「患者端 Web」为主入口，独立成目录、可单独部署，同时通过约定接口为后续医生端、后端服务层留出对接位。**

---

## 二、仓库目录规划

当前仓库根目录已有 1 字节占位文件 `MoodHub`（空文件），本方案将其替换为独立模块目录：

```
XAIMentalHealth/
├── README.md                  # 更新：增加 MoodHub 模块章节与快速开始
├── README.en.md               # 同步英文说明
├── docs/
│   └── moodhub-module-spec.md # 本方案文档（归档）
├── LICENSE
├── .gitignore                 # 追加 moodhub-web/node_modules、*.log 等
└── moodhub-web/               # ★ MoodHub 模块（完整 Web 应用）
```

- `moodhub-web/` 为**自包含模块**：不依赖仓库其它目录，可直接复制到任意静态托管运行。
- 仓库根目录 README 的「使用说明 · 患者端」章节可直接指向 MoodHub Web 作为患者端落地形态。

---

## 三、文件结构（完整清单）

模块采用「应用外壳 + 核心层 + 视图层 + 测试」四段结构，全部为纯 HTML/CSS/JS，无任何第三方依赖：

```
moodhub-web/
├── index.html                   应用外壳：顶栏 / 视图容器 / 弹窗 / 提示条 / 危机卡
├── serve.cjs                    本地预览静态服务（node serve.cjs → http://localhost:5173）
├── README.md                    模块 README（含隐私边界、运行方式、功能说明）
├── css/
│   └── styles.css               设计令牌、组件样式、响应式断点（1024/860/620px）
├── js/
│   ├── app.js                   路由、解锁/锁定、空闲锁定、重新验证、危机卡调度
│   ├── core/                    ★ 核心业务层（不依赖 DOM，可单测）
│   │   ├── util.js              DOM / 日期 / 数值 / toast 工具
│   │   ├── crypto.js            SHA-256、PBKDF2（Web Crypto + 纯 JS 回退）、随机令牌
│   │   ├── store.js             localStorage 仓库：记录 / 对话 / 账户 / 信任 / 偏好
│   │   ├── metrics.js           四项指标唯一事实来源（量程、配色、校验）
│   │   ├── stats.js             按天归集、均值、趋势拟合、14 天摘要
│   │   ├── charts.js            手写 SVG 折线图 / 迷你趋势线（无图表库）
│   │   ├── ingest.js            文件摄入与解析（CSV / TSV / JSON / 文本）
│   │   ├── retriever.js         分块 + BM25 检索 + 预算内上下文组装
│   │   ├── qa.js                SmartQA 编排：选源 → 检索 → 数值计算 → 生成
│   │   ├── local-service.js     本地服务：陪伴规则引擎 + 问答回答生成
│   │   ├── health-import/       第三方健康数据导入子模块
│   │   │   ├── zip.js           极简 ZIP 容器 + XLSX 读取（含纯 JS DEFLATE）
│   │   │   ├── formats.js       CSV / JSON / XLSX / Apple 健康 XML / ZIP → 统一表格
│   │   │   ├── vendors.js       厂商画像库（华为/Apple/Google Fit/Health Connect 等）
│   │   │   └── pipeline.js      清洗、单位归一、时间对齐、去重、落库、进度与取消
│   │   └── models/
│   │       ├── registry.js      模型注册表：本地引擎 + 云端预设 + 场景元数据
│   │       ├── adapters.js      协议适配器：local / openai-compatible / gemini / anthropic
│   │       └── manager.js       场景路由、切换、推荐、统一调用、降级与错误码
│   └── views/                   ★ 视图层（页面组件）
│       ├── auth.js              登录 / 创建账户 / 信任设备
│       ├── dashboard.js         指标卡 + 趋势图 + 最近记录
│       ├── records.js           筛选排序列表 + 编辑弹窗
│       ├── import.js            第三方数据导入向导（五步）
│       ├── qa.js                智能问答：上传 / 选源 / 提问 / 回答 / 引用
│       ├── companion.js         陪伴（树洞）：对话与传出内容自查
│       ├── models.js            模型管理（模型库 / 场景配置 / 连接管理 / 调用日志）
│       └── settings.js          账户、安全、数据、外观
├── docs/
│   ├── models-page-spec.md      「模型」页设计说明
│   └── health-import-spec.md    「第三方数据导入」设计说明
└── tests/                       ★ 回归测试（node 直跑，无需浏览器）
    ├── run-all.cjs              一键跑全部套件（CI 入口）
    ├── smoke.cjs                核心层 131 项：口令、校验、统计、检索、问答、模型路由
    ├── dom-models.cjs           视图层 54 项：模型页 DOM 桩测试
    ├── dom-import.cjs           视图层 31 项：导入页整链路测试
    └── import-analytics.cjs     导入 + 分析单测 75 项
```

---

## 四、页面组件设计（8 个视图 + 1 个外壳）

| 页面组件 | 职责 | 关键交互 |
|---|---|---|
| **登录页** (`auth`) | 首次创建本机账户（用户名 2–24 字、密码 ≥6 位），之后密码解锁 | 信任设备 1/7/30 天、定期重新验证、空闲锁定、忘记密码如实提示（无找回通道） |
| **数据看板** (`dashboard`) | 四项指标（心情 1–5 / 睡眠 0–16h / 心率 30–200bpm / 压力 0–10）各一张卡 + 折线图 | 均值 + 周变化 + 极值 + 迷你趋势线；区间切换 7/14/30 天；最近 5 条记录跳编辑 |
| **列表管理** (`records`) | 记录列表：筛选（日期/指标范围/备注关键词）+ 排序（点表头升降） | 空态区分「还没有记录」/「没有符合条件的记录」；新增/编辑共用弹窗 |
| **表单编辑**（records 内嵌） | 日期/时间/四项指标滑块 + 数字双向同步/备注 ≤500 字 | 字段级校验、错误落字段下方、保存 toast、修改态显示创建/修改时间、可直接删除 |
| **智能问答** (`qa`) | 拖入 CSV/TSV/JSON/文本或粘贴内容作来源，本地 BM25 检索增强回答 | 来源切块 → 检索 Top-K → 预算内组上下文（6k/12k/24k）→ 真实数值计算；表格可一键转记录 |
| **陪伴（树洞）** (`companion`) | 本地规则引擎会话，构造 `moodhub.summary/v1` 摘要外传 | 「查看本次发送给本地服务的内容」自查面板；危机词命中即转求助资源卡；历史可一键清空 |
| **第三方导入** (`import`) | 五步向导：选来源 → 字段映射 → 清洗去重 → 导入进度 → 结果反馈 | 厂商画像库自动识别列；四策略去重；实时进度 + 可取消 + 一键撤销；错误码带应对说明 |
| **模型管理** (`models`) | 模型库 / 场景配置 / 连接管理 / 调用日志四分区 | 场景独立选模型；测试连接；统一入口 `MH.models.run(scenario, payload)`；云端失败自动降级本地 |
| **设置** (`settings`) | 账户 / 安全 / 数据 / 外观四块 | 修改密码需验证旧密码；导出 JSON 备份；导入（合并/替换）；清空全部前重新验证密码 |

响应式：≥1024px 顶栏导航；≤860px 底部标签栏；≤620px 单列 + 弹窗适配。无外部字体、无 CDN，离线全功能可用。

---

## 五、交互逻辑（核心流程）

1. **解锁流程**：首次进入 → 创建账户（PBKDF2-SHA256 + 随机盐派生）→ 登录态写入 `sessionStorage`；勾选信任 → 写入随机令牌 + 到期时间到 `localStorage`，到期自动回登录页。
2. **数据录入流**：表单弹窗 → 滑块/数字双向同步 → 校验（日期 ≤ 今天、指标在量程、0.5 步长、备注长度）→ 保存 → 刷新当前页 + toast。
3. **看板聚合流**：`stats.js` 按天归集 → 均值/趋势拟合/极值 → `charts.js` 手写 SVG 绘制；空白天断开而非补零。
4. **问答流**：选源 → `ingest.js` 解析 → `retriever.js` 分块 + BM25（中文按字+二元组、英文按词）→ 数值计算 → `local-service.js` 生成，证据带来源名与相关度。
5. **陪伴流**：只传 14 天统计摘要（均值/极值/最近值/周趋势斜率），不传单条记录与备注原文；服务入口裁剪入参，额外字段一律丢弃。
6. **导入流**：厂商画像三层打分选列 → 清洗（未来日期/超量程/无指标行单独记录）→ 时区对齐（跨夜睡眠归起床日）→ 批内去重 + 本机四策略去重 → 可取消可撤销。
7. **模型流**：场景独立选模型 → `manager.js` 统一路由 → 云端直连失败自动降级本地并在界面说明；危机信号强制本地、绝不外发。
8. **路由与锁**：`app.js` 单页路由 + 空闲锁定（默认 15 分钟）+ 敏感操作（导出/清空/撤销信任）前重新验证密码。

---

## 六、数据管理方式

### 6.1 存储边界

| 存储介质 | 用途 |
|---|---|
| `localStorage` | 记录、对话历史、账户口令派生数据、信任令牌、偏好设置、勾选「保存到本机」的来源文件（600k 字符预算） |
| `sessionStorage` | 登录态、当前会话来源文件（刷新即消失） |
| 内存态 | 未勾选保存的上传/粘贴来源、导入中的临时表格 |

### 6.2 数据 schema（store.js 统一管理）

- `records[]`：`{ id, date, time?, mood, sleep, heartRate, stress, note, createdAt, updatedAt }`
- `conversations[]`：陪伴对话历史（仅本机）
- `account`：用户名 + 口令派生参数（盐、迭代次数），**不存口令明文**
- `trustedDevice`：`{ token, expiresAt }`，到期自动失效
- `preferences`：主题、空闲锁定时长、问答预算、模型选择等

### 6.3 隐私硬约束

- 默认零网络请求：无外部资源引用，断网可用。
- 仅在「模型」页**显式开启外发授权**后，浏览器才直连所选服务商，不经过中间服务器。
- 陪伴与问答只向服务提交聚合摘要，不含单条记录/日期明细/备注原文。
- 危机信号强制本地处理，云端调用被硬阻断。

### 6.4 备份与迁移

- 设置页「导出 JSON」一键备份全部数据；「导入（合并/替换）」可恢复。
- 已知边界如实声明：换设备/清理站点数据会丢失记录，需定期导出。

---

## 七、本地调试与测试（网站版直接运行）

```bash
# 进入模块目录
cd moodhub-web

# 方式一：本地静态服务（推荐，localStorage 行为与线上一致）
node serve.cjs                  # → http://localhost:5173
# 或：python -m http.server 5173

# 方式二：直接双击 index.html（部分浏览器 file:// 下 localStorage 受限）

# 回归测试（无需浏览器，CI 可用）
node tests/run-all.cjs
```

- **零安装**：无 package.json 依赖、无构建步骤，`node serve.cjs` 即为全部启动成本。
- **静态部署**：整个 `moodhub-web/` 目录丢到 GitHub Pages / Nginx / OSS 即可上线。
- **测试覆盖**：核心层 131 项 + 模型页 54 项 + 导入页 31 项 + 导入分析 75 项，覆盖口令派生、表单校验、统计聚合、检索问答、模型路由降级、第三方导入全链路。

---

## 八、与 XAIMentalHealth 后续对接位（预留接口）

| 对接方向 | 预留位置 | 说明 |
|---|---|---|
| 医生端/后端 API | `MH.api` 适配层（models/adapters.js 同签名扩展） | 未来可把本地记录同步到 XAIMentalHealth RESTful API 网关，需先经用户显式开启 |
| 可解释 AI 模型层 | 模型注册表 `registry.js` 的 `PRESETS` | 可注册仓库未来模型服务的推理端点，复用统一错误码与降级机制 |
| 多模态数据 ETL | `health-import/` 管线 | 已具备导入能力；未来可对接 Kafka/穿戴设备 API 的拉取源 |
| 干预引擎 | 陪伴规则引擎 `local-service.js` | 后续可扩展为拉取服务器端个性化策略（需授权与合规评估） |

所有云端/服务端对接默认关闭，以「显式授权 + 危机硬阻断 + 本地兜底」为不变前提。

---

## 九、落地步骤

1. 用本方案文档替换仓库根目录的 1 字节 `MoodHub` 占位文件为 `moodhub-web/` 模块目录。
2. 将本地已验证的 `moodhub-web` 源码整体纳入仓库（`git add moodhub-web/`），保留 `serve.cjs` 与 `tests/`。
3. 更新仓库根 `README.md` / `README.en.md`：在「使用说明 · 患者端」章节指向 MoodHub Web，并附运行命令。
4. 更新 `.gitignore`（追加 `node_modules/`、`*.log` 等）。
5. 提交方式建议：先在本机 `node tests/run-all.cjs` 全绿，再推送主分支；后续可开 GitHub Pages 直接提供网站版在线访问。
6. 归档本方案到 `docs/moodhub-module-spec.md` 作为模块设计文档。
*（内容由AI生成，仅供参考）*
