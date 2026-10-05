# 第三方健康与运动数据接入 — 设计说明

> 目标：把华为、Apple 健康、Google Fit / Health Connect、OPPO、vivo、小米、Garmin 等终端厂商，
> 以及任意 CSV / Excel / JSON 的健康数据，接成 MoodHub 的四项记录（心情 / 睡眠 / 心率 / 压力）。
> 全程在本机完成，零依赖、零构建。

---

## 1. 边界与原则

| 约束 | 做法 |
| --- | --- |
| 隐私 | 文件只经 `FileReader` 读进内存；原始表格**不写入 localStorage**，也不产生任何网络请求 |
| 依赖 | 不使用 SheetJS / JSZip，也不引入 Eleventy 之外的任何库；ZIP 容器与 DEFLATE 均为本地实现 |
| 风格 | 与项目保持一致：ES5 语法、`MH.*` 命名空间、IIFE 单文件模块、Promise 异步 |
| 可测 | 每一步都是可单独调用的纯函数，`run()` 只是把它们串起来并加进度 / 取消 |
| 可扩展 | 「加一个数据源」 = 在 `vendors.js` 的 `PROFILES` 里加一条画像，其它层不需要动 |

---

## 2. 目录

| 文件 | 职责 |
| --- | --- |
| `js/core/health-import/zip.js` | ZIP 容器 + XLSX 读取。含纯 JS 的 raw DEFLATE 解压（有 `DecompressionStream` 时优先用原生） |
| `js/core/health-import/formats.js` | 统一格式层：把 CSV / TSV / JSON / XLSX / Apple export.xml / ZIP 读成同一种「表格」 |
| `js/core/health-import/vendors.js` | 厂商画像 + 来源识别 + 字段映射打分 + 单位换算计划 |
| `js/core/health-import/pipeline.js` | 清洗、时间对齐、去重、冲突策略、落库、进度与取消、撤销 |
| `js/views/import.js` | 五步向导界面 |

表格（table）是唯一的中间结构：

```js
{ label, path, origin, headers: [列名], rows: [{列名: 原始字符串}], totalRows, truncated }
```

刻意保留**原始字符串**：单位换算与精度取舍集中交给后面的阶段，避免两次强转丢信息。

---

## 3. 流水线

```
File ──readAsBytes──► formats.tables() ──► [table…]
                                              │
                        vendors.detect() ◄────┤ 文件名 + 内容指纹 + 列名
                        vendors.map()    ◄────┤ 逐列打分 → {date, time, metrics, aux}
                                              │
                       pipeline.transform() ◄─┤ 逐行清洗 + 单位归一 + 时间对齐
                       pipeline.mergeSamples()│ 批内按 日期|时刻 合并
                       pipeline.applyToExisting() ──► MH.store.records.save()
```

`MH.healthImport.run()` 把上面串成异步流程：每 300 行让出一帧，回调 `onProgress({percent, phase, label, processed, total})`，
并检查 `cancelToken.cancelled`（取消时本机数据不做任何改动）。

阶段权重：解析 8% → 清洗 74% → 去重 8% → 落库 10%。

---

## 4. 字段映射规则

三层打分，取最高分的列：

1. **厂商专属列名**（+12 加成）—— 例如华为的「静息心率」「睡眠时长(分钟)」，Garmin 的 `Resting Heart Rate`
2. **通用别名** —— 中英文常见叫法，写词者优先（列表靠前的别名得分更高）
3. **取值形态** —— 该列约有多少比例是数值 / 能否解析为日期；几乎没有数值的列会被判负排除

匹配度归一化后比较（去掉空格、下划线、连接符并转小写），取值为：完全相等 100 → 前缀 92 → 包含 84 → 反包含 70。
低于 40 分不自动映射，交回界面让用户手选；界面上每个目标都能在下拉里重选，也可以整张表换厂商画像重算。

防护规则：心率不匹配含「变异性 / variab / hrv」的列；睡眠不匹配含「目标 / 评分 / score」的列。

### 单位换算计划

| 目标 | 规则 |
| --- | --- |
| 睡眠 | 列名或单位标注分钟 → ÷60；秒 → ÷3600；没标注但中位数 > 30 → 按分钟处理 |
| 压力 | 最大值落在 (10, 100] → ÷10（百分制折成 10 分制） |
| 心情 | 最大值落在 (5, 100] → ÷20（百分制折成 5 分制） |
| 血氧 | 最大值 ≤ 1.02 → ×100 |
| 其它 | 保持原值 |

每一步换算都会在界面的 hint 里写出来（例如「分钟 → 小时（÷60）」），用户可以改成「小时 / 分钟 / 秒」。

---

## 5. 清洗规则

| 情况 | 处理 | 计入 |
| --- | --- | --- |
| 整行为空 | 跳过 | — |
| 日期无法解析（`2026-13-40` 这类也会被拒绝） | 丢弃该行 | `INVALID_DATE` |
| 日期晚于今天 | 丢弃该行 | `FUTURE_DATE` |
| 数值超出四项指标量程 | 丢弃该字段（默认）或截断到边界 | `OUT_OF_RANGE` |
| 一行里四项指标全为空 / 全超限 | 丢弃该行 | `NO_VALUE` |
| 不在 `from ~ to` 区间内 | 静默跳过 | `filtered` |
| 勾选「对齐到表单步长」 | 睡眠取 0.5 小时，心情 / 心率 / 压力取整 | — |

四类量程：心情 1–5 · 睡眠 0–16 小时 · 心率 30–200 bpm · 压力 0–10 分（来源：`js/core/metrics.js`，单一事实来源）。

### 时间对齐

- 所有时间戳按**本机时区落到日历日**并保留时刻（记录的存储单位就是日期，不存在跨时区换算）。
- 支持 `YYYY-MM-DD HH:mm`、`ISO8601`（含 `+0800`）、`YYYY年M月D日`、`MM/DD/YYYY` 与 `DD/MM/YYYY`（首位 > 12 时按后者）、`Sep 1, 2026`、10 / 13 位时间戳。
- 跨夜睡眠：Apple export.xml 与含起止区间的来源，按 `sleepDayRule` 归属 —— 默认 `wake`（起床日），可选 `start`（入睡日）。

### 去重

1. **批内**：同一「日期 + 时刻」先到先得合并，后来的只补空缺字段。所以睡眠表 + 心率表分两个文件导也能合成一条记录。
2. **批外的本机记录**：按所选冲突策略处理

| 策略 | 行为 |
| --- | --- |
| `merge`（默认） | 只补本机缺失的字段，已有数值一律不动 |
| `overwrite` | 同一天同一时刻以导入值为准（需重新验证密码） |
| `skip` | 本机已有数据的日期直接跳过 |
| `append` | 总是新增一条；同一天多条时统计会自动取平均 |

---

## 6. 进度、结果与错误处理

进度界面显示：百分比进度条、当前阶段文案、已处理行 / 总行数，以及「取消导入」按钮。

结果界面显示：新增 / 更新 / 跳过 / 无效行 / 区间外的统计，字段映射与单位换算清单（tag 形式），
逐条列出被跳过或修正的行（最多展示 20 条，其余折叠成可展开明细），并提供**一键撤销本次导入**
（同一会话内、下一次导入前有效）。下方是导入历史：只存文件名、来源、时间与条数摘要。

错误码（都带一句「该怎么办」的 hint）：

| 代码 | 含义 |
| --- | --- |
| `UNSUPPORTED_FORMAT` / `UNSUPPORTED_XML` | 扩展名或容器不在支持列表里 |
| `FILE_TOO_LARGE` | 超过 24 MB 单文件上限 |
| `PARSE_FAILED` / `XLSX_PARSE_FAILED` | 文件损坏或加密 |
| `EMPTY_DATA` / `NO_TABLE` | 读不到任何数据行 |
| `NO_DATE_COLUMN` / `NO_METRIC_COLUMN` | 用户没有指定日期列或指标列 |
| `NO_VALID_ROWS` | 全部行都被清洗规则拦下（会带上第一条原因与样例） |
| `CANCELLED` | 用户取消，本机数据不变 |
| `COMMIT_FAILED` | localStorage 写入失败（通常是空间不足） |

单个文件失败会被隔离：其它文件照常解析，失败原因显示在该文件的卡片上。

---

## 7. 加一个新数据源

只需要两步，流程和本项目「加服务商 = 在 registry 加一条」的约定一致：

1. 在 `js/core/health-import/vendors.js` 的 `PROFILES` 里加一条：

```js
{
  id: 'whoople', name: 'Whoop', vendor: 'Whoop', platform: 'iOS / Android',
  formats: ['csv', 'json'],
  file: /whoop/i,                                  // 文件名特征
  fingerprint: function (ctx) { return /recovery score|strain/i.test(ctx.textSample); },
  guide: '在 App → Profile → Export data 里导出 CSV。',
  aliases: {                                       // 自家列名（写词者在前）
    date: ['date', 'Cycle start time'],
    sleep: ['Sleep Hours', 'sleep hours'],
    heartRate: ['Resting Heart Rate (bpm)'],
    stress: ['Recovery Score']
  }
}
```

2. 完事。识别、映射、清洗、去重、界面卡片与「如何导出」说明都会自动带上它；
   如果新来源需要新的容器（比如某种二进制格式），才需要在 `formats.js` 里加一个 reader。

---

## 8. 验收清单

- `node tests/smoke.cjs` —— 容器层（ZIP / inflate / XLSX 日期序列号）、来源识别、单位换算、脏数据、端到端导入与四种冲突策略、取消、撤销
- `node tests/dom-import.cjs` —— 真实导入页走完五步：选文件 → 解析 → 改单位 → 清洗设置 → 导入 → 撤销 → 跳记录
- `node tests/dom-models.cjs` —— 模型页回归（确认改动没有波及既有页面）
- 手工验证：浏览器打开 `index.html`（或 `node serve.cjs`），从「设置 → 数据 → 导入第三方健康数据」进入，
  拖入一份厂商导出的 CSV / ZIP / XLSX，确认进度条、统计与问题明细符合预期
