/* ------------------------------------------------------------------
   模型注册表：本地内置模型 + 云端服务商预设 + 场景元数据。
   纯数据 + 纯函数，不含任何网络调用，方便单测与扩展。
   新增一个服务商 = 在这里加一条 preset；新增一种协议 = 在 adapters 里加一种 kind。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  /** 调用场景。每个场景可独立选择模型，并有独立的推荐策略。 */
  var SCENARIOS = {
    companion: {
      key: 'companion',
      label: '陪伴对话',
      task: 'chat',
      desc: '树洞式倾听。默认只把最近 14 天统计摘要交给模型。',
      capability: 'chat',
      defaultModel: 'local-rules'
    },
    qa: {
      key: 'qa',
      label: '智能问答',
      task: 'qa',
      desc: '多来源检索增强问答。上传的文件内容会进入上下文。',
      capability: 'qa',
      defaultModel: 'local-grounded'
    }
  };

  /** 本地内置模型：永远可用，不需要任何配置，数据不出设备。 */
  var LOCAL_MODELS = [
    {
      id: 'local-rules',
      name: '本地规则引擎',
      vendor: 'MoodHub',
      kind: 'local',
      privacy: 'on-device',
      capabilities: ['chat'],
      contextWindow: 0,
      requiresKey: false,
      builtin: true,
      cost: 'free',
      note: '关键词意图识别 + 本机统计，离线可用，回应稳定但不具备生成能力。'
    },
    {
      id: 'local-grounded',
      name: '本地检索 · 统计引擎',
      vendor: 'MoodHub',
      kind: 'local',
      privacy: 'on-device',
      capabilities: ['qa'],
      contextWindow: 0,
      requiresKey: false,
      builtin: true,
      cost: 'free',
      note: 'BM25 检索 + 表格列真实计算，答案可溯源，但不会改写与润色。'
    }
  ];

  /** 云端服务商预设（baseUrl 指向 OpenAI 兼容端点或 Gemini v1beta）。 */
  var PRESETS = [
    {
      // 官方「首次调用 API」：base_url(OpenAI)=https://api.deepseek.com，
      // 模型名请使用 deepseek-flash（deepseek-v4-flash 等旧名已下线，仍可调用但由新模型服务）
      id: 'deepseek', name: 'DeepSeek', kind: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-flash',
      keyPlaceholder: 'sk-…', docsUrl: 'https://api-docs.deepseek.com/',
      note: '也提供 Anthropic 兼容端点：https://api.deepseek.com/anthropic'
    },
    {
      id: 'deepseek-anthropic', name: 'DeepSeek（Anthropic 兼容）', kind: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-flash',
      keyPlaceholder: 'sk-…', docsUrl: 'https://api-docs.deepseek.com/',
      note: '走 Anthropic 协议，适合已在用 Anthropic SDK / 客户端的场景。'
    },
    {
      id: 'qwen', name: '通义千问', kind: 'openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
      defaultModel: 'qwen-plus',
      keyPlaceholder: 'sk-…', docsUrl: 'https://help.aliyun.com/zh/dashscope/'
    },
    {
      id: 'hunyuan', name: '腾讯混元', kind: 'openai-compatible',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      models: ['hunyuan-turbo', 'hunyuan-standard', 'hunyuan-lite'],
      defaultModel: 'hunyuan-lite',
      keyPlaceholder: 'AKID…', docsUrl: 'https://cloud.tencent.com/document/product/1729',
      note: '浏览器直连混元受 CORS 限制，建议走自建代理或桌面端。'
    },
    {
      id: 'gemini', name: 'Gemini', kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-1.5-flash', 'gemini-1.5-pro'],
      defaultModel: 'gemini-1.5-flash',
      keyPlaceholder: 'AIza…', docsUrl: 'https://ai.google.dev/gemini-api/docs'
    },
    {
      id: 'openai', name: 'OpenAI', kind: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o'],
      defaultModel: 'gpt-4o-mini',
      keyPlaceholder: 'sk-…', docsUrl: 'https://platform.openai.com/docs'
    },
    {
      id: 'claude', name: 'Anthropic Claude', kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
      defaultModel: 'claude-3-5-haiku-latest',
      keyPlaceholder: 'sk-ant-…', docsUrl: 'https://docs.anthropic.com/',
      note: '浏览器直连需服务端带 anthropic-dangerous-direct-browser-access 头，通常走代理。'
    },
    {
      id: 'custom', name: '自定义（OpenAI 兼容）', kind: 'openai-compatible',
      baseUrl: '', models: [], defaultModel: '',
      keyPlaceholder: '你的 API Key', docsUrl: ''
    }
  ];

  /** 场景默认参数：不同场景对温度与长度的要求不同。
   *  maxTokens 须留足余量：思考型模型（如 deepseek-reasoner）会先消耗预算再输出正文，
   *  预算过小会导致正文被截断（finish_reason=length）甚至整条为空。 */
  var SCENARIO_PARAMS = {
    chat: { temperature: 0.7, maxTokens: 1024 },
    qa: { temperature: 0.3, maxTokens: 2048 }
  };

  function getPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  function getLocal(id) {
    for (var i = 0; i < LOCAL_MODELS.length; i++) if (LOCAL_MODELS[i].id === id) return LOCAL_MODELS[i];
    return null;
  }

  function getScenario(key) { return SCENARIOS[key] || null; }

  /** 粗估上下文窗口（字符），用于场景推荐时判断"够不够装"。 */
  function estimateWindow(modelId) {
    var s = String(modelId || '');
    var m = /(\d+(?:\.\d+)?)\s*k/i.exec(s);
    if (m) return Math.round(parseFloat(m[1]) * 1000);
    // 注意用词边界匹配：gemini 里含有 "mini" 子串，宽松匹配会把 pro 判成小模型
    if (/reasoner|thinking|\bo[13]\b/i.test(s)) return 128000;
    if (/\bpro\b|\bmax\b|opus|sonnet|\blarge\b|\bultra\b/i.test(s)) return 128000;
    if (/\bflash\b|\bturbo\b|\blite\b|\bmini\b|haiku|\bsmall\b/i.test(s)) return 32000;
    return 16000;
  }

  MH.modelRegistry = {
    SCENARIOS: SCENARIOS,
    LOCAL_MODELS: LOCAL_MODELS,
    PRESETS: PRESETS,
    SCENARIO_PARAMS: SCENARIO_PARAMS,
    getPreset: getPreset,
    getLocal: getLocal,
    getScenario: getScenario,
    estimateWindow: estimateWindow
  };
})(window.MH = window.MH || {});
