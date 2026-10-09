/* 拼接句的模式规则 + 冲突消解表。
 *
 * 为什么要 patterns：词典是「整串精确匹配」，而界面上大量文案是
 * `'前缀' + 变量 + '后缀'` 拼出来的（分页、计数、错误前缀）。
 * 这些串在词典里查不到，需要用正则整句命中后返回整句译文。
 *
 * 规则按顺序尝试，命中即止；正则一律加 ^ $ 锚定，避免误伤。
 * $1..$9 为捕获组。to 里不需要写正则字面量以外的转义。
 */
module.exports = {
  /* 同一串中文在不同模块语义不同（列/行/第/删除/文件/小时/天）。
   * 这里给出最终裁决，合并时覆盖各分组的本地译法。 */
  overrides: {
    // 表格头与量词：作为独立表头单元格出现时用单数名词
    '列': 'Column',
    '行': 'Row',
    // 独立出现时是动词；分页里的「第 N 页」由 patterns 处理
    '第': 'No.',
    '删除': 'Delete',
    '文件': 'File',
    // 单位选择器里的独立选项
    '小时': 'h',
    '天': 'd',
    // 跨分组术语统一（同一串中文在不同 part 里译法不一致时在此定标准）
    '登录': 'Sign in',
    '新增记录': 'New entry'
  },

  patterns: [
    // ---- 分页：第 1/3 页 · 共 12 项 ----
    { re: '^第 (\\d+)/(\\d+) 页 · 共 (\\d+) 项$', to: 'Page $1/$2 · $3 items' },

    // ---- 导入：N 行 · M 列 ----
    { re: '^(\\d+) 行 · (\\d+) 列$', to: '$1 rows · $2 columns' },
    { re: '^第(\\d+)行$', to: 'Row $1' },
    { re: "^表 (\\d+)（(\\d+) 行）$", to: 'Table $1 ($2 rows)' },

    // ---- 记录数 ----
    { re: '^共 (\\d+) 条记录$', to: '$1 entries' },
    { re: '^已导出 (\\d+) 条记录$', to: 'Exported $1 entries' },
    { re: '^已导入，当前共 (\\d+) 条记录$', to: 'Imported. $1 entries in total' },
    { re: '^覆盖 (\\d+)/(\\d+) 天$', to: 'covering $1 of $2 days' },
    { re: '^(本机健康记录（)?(\\d+) 天聚合）?$', to: 'On-device health records ($2-day aggregate)' },

    // ---- 趋势 / 统计 ----
    { re: '^趋势图，共 (\\d+) 个点$', to: 'Trend chart, $1 points' },
    { re: '^共 (\\d+) 个来源$', to: '$1 sources' },

    // ---- 信任与倒计时 ----
    { re: '^已通过信任令牌进入，(.*)到期需重新输入密码$', to: 'Entered with a trust token. $1 until your password is required again.' },
    { re: '^已信任此设备 (\\d+) 天，到期后需重新输入密码$', to: 'This device is trusted for $1 days. You will need to re-enter your password when it expires.' },
    { re: '^已信任：(.+?)，(.*)到期$', to: 'Trusted: $1, expires in $2' },

    // ---- 错误前缀 ----
    { re: '^页面渲染出错：(.*)$', to: 'This page failed to render: $1' },
    { re: '^导入失败：(.*)$', to: 'Import failed: $1' },
    { re: '^读取失败：(.*)$', to: 'Could not read: $1' },
    { re: '^写入本机记录失败：(.*)$', to: 'Could not write to on-device records: $1' },
    { re: '^文件是空的：(.*)$', to: 'The file is empty: $1' },
    { re: '^JSON 解析失败：(.*)$', to: 'JSON parsing failed: $1' },
    { re: '^暂不支持这个 XML 类型：(.*)$', to: 'This XML type is not supported yet: $1' },
    { re: '^Excel 文件读取失败：(.*)$', to: 'Could not read the Excel file: $1' },
    { re: '^压缩包里的文件都无法解析：(.*)$', to: 'No file in the archive could be parsed: $1' },
    { re: '^不支持的压缩方式（(.*)）$', to: 'Unsupported compression method ($1)' },

    // ---- 文件大小 / 体积上限 ----
    { re: '^(.*) MB，超过 (.*)$', to: '$1 MB, over the $2 limit' },
    { re: '^(.*)「超过 (.*)」$', to: '$1 exceeds $2' },
    { re: '^(.*)「列数超过 (.*)」$', to: '$1 has more than $2 columns' },

    // ---- 表头预览 ----
    { re: '^前 (\\d+) 行原样展示$', to: 'First $1 rows shown as-is' },

    // ---- 本地服务 / 陪伴（拼接出的整句） ----
    { re: '^边界：这几个数都是聚合出来的，(.*)。它看不到昨天那件具体的事，(.*)$', to: 'One limit: these numbers are aggregates. $1 It cannot see the specific thing that happened yesterday. $2' },
    // 引导卡的推理边界：整句命中，档位措辞（$1）不参与回填，避免英文里夹中文
    { re: '^边界：我只读到你这一句话和最近 14 天的聚合值，看不到昨天那件具体的事。(.+)。$', to: 'One limit: I only have this one line from you and the 14-day aggregates, not the specific thing that happened yesterday.' },
    { re: '^我读到的是：你(.*)$', to: 'What I read: your $1' },
    { re: '^读到的是：你(.*)$', to: 'What I read: your $1' },
    { re: '^我把最近 (\\d+) 天的统计看了一遍：(.*)$', to: 'I went through the last $1 days of figures: $2' },
    { re: '^· 只取自你勾选的数据源（(.*)）$', to: ' · Taken only from the sources you selected ($1)' },

    // ---- .me 人格 ----
    { re: '^(.*)次信号（置信度 (.*)）$', to: '$1 signals (confidence $2)' },
    { re: '^(.*)，置信度 (.*)$', to: '$1, confidence $2' },
    { re: '^这是从(.*)$', to: 'This is derived from $1' },

    // ---- 导入清洗进度 ----
    { re: '^(正在清洗)(.*)$', to: 'Cleaning $2' },
    { re: '^(自动导入：)(.*)$', to: 'Auto-imported: $2' }
  ]
};
