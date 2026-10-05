/* ------------------------------------------------------------------
   协议适配器：把统一请求翻译成各家厂商的 HTTP 调用。
   每家只关心自己的 URL / 鉴权 / 报文结构，对外统一返回 { text }。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var CHAT_SYSTEM =
    '你是一个温暖、克制的心理陪伴助手。规则：' +
    '1) 不诊断、不处方、不说教；2) 回复 2-4 句话，口语化；' +
    '3) 若用户出现自杀/自残等危机信号，必须优先建议联系专业心理援助热线（12356 等），不要试图替代专业帮助；' +
    '4) 用户数据仅在本机使用，不要索取更多隐私信息。';

  var QA_SYSTEM =
    '你是 MoodHub 的智能问答助手，会收到用户提供的参考资料（可能包括：健康数据摘要、心情日记摘要、' +
    '用户补充说明、上传的文件内容）。规则：' +
    '1) 优先且仅依据参考资料回答，引用数字时与资料保持一致，资料不足时明确说明缺口，不要编造；' +
    '2) 对健康指标给出温和、通俗的解读，但明确不构成医疗诊断，异常建议咨询医生；' +
    '3) 用简体中文回答，结构清晰、长度适中；' +
    '4) 若流露自杀/自残等危机信号，优先建议联系心理援助热线（12356 等）。';

  function makeError(code, message, retryable) {
    var e = new Error(message);
    e.code = code;
    e.retryable = !!retryable;
    return e;
  }

  /* ============================ 本地适配器 ============================ */

  function localAdapter(conn, req) {
    if (req.task === 'qa') {
      return MH.localService.generateAnswer({
        question: req.payload.question,
        customPrompt: req.payload.customPrompt,
        intent: req.payload.intent,
        context: req.payload.context,
        facts: req.payload.facts
      }).then(function (r) { return { text: r.text, tags: r.tags }; });
    }
    return MH.localService.generateReply({
      message: req.payload.message,
      summary: req.payload.summary
    }).then(function (r) { return { text: r.text, tags: r.tags, resources: r.resources }; });
  }

  /* ============================ 报文构造 ============================ */

  function buildUserContent(req) {
    if (req.task === 'qa') {
      var ctx = (req.payload.context && req.payload.context.text) || '';
      var q = req.payload.question || '';
      var extra = req.payload.customPrompt ? '\n【补充说明】\n' + req.payload.customPrompt + '\n' : '';
      return ctx ? '【参考资料】\n' + ctx + '\n\n' + extra + '【用户问题】\n' + q : q;
    }
    var parts = [];
    if (req.payload.summary) parts.push('【最近 ' + (req.payload.summary.windowDays || 14) + ' 天统计摘要】\n' + JSON.stringify(req.payload.summary.metrics));
    if (req.payload.message) parts.push('【用户的话】\n' + req.payload.message);
    return parts.join('\n\n');
  }

  function buildMessages(req) {
    var system = req.task === 'qa' ? QA_SYSTEM : CHAT_SYSTEM;
    var out = [{ role: 'system', content: system }];
    (req.payload.history || []).slice(-6).forEach(function (m) {
      if (m && m.content) out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) });
    });
    out.push({ role: 'user', content: buildUserContent(req) });
    return out;
  }

  function paramsFor(req) {
    var base = MH.modelRegistry.SCENARIO_PARAMS[req.task] || { temperature: 0.7, maxTokens: 1024 };
    var p = (req.params || {});
    return {
      temperature: p.temperature == null ? base.temperature : p.temperature,
      maxTokens: p.maxTokens == null ? base.maxTokens : p.maxTokens,
      timeoutMs: p.timeoutMs || 20000
    };
  }

  function fetchWithTimeout(url, init, timeoutMs) {
    if (typeof fetch !== 'function') throw makeError('NO_FETCH', '当前环境不支持 fetch，无法调用云端模型', false);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    var opt = Object.assign({}, init);
    if (ctrl) opt.signal = ctrl.signal;
    return fetch(url, opt).catch(function (e) {
      if (e && e.name === 'AbortError') throw makeError('TIMEOUT', '请求超时（' + Math.round(timeoutMs / 1000) + 's）', true);
      throw makeError('NETWORK', '网络不可达或被浏览器拦截（常见于服务商不支持跨域直连）：' + (e && e.message ? e.message : e), true);
    }).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  function readError(res) {
    return res.text().catch(function () { return ''; });
  }

  function httpError(res, body) {
    var tail = body ? '：' + String(body).slice(0, 200) : '';
    if (res.status === 401 || res.status === 403) return makeError('AUTH', '鉴权失败（HTTP ' + res.status + '），请检查 API Key 与权限' + tail, false);
    if (res.status === 429) return makeError('RATE_LIMIT', '被限流（HTTP 429），稍后再试' + tail, true);
    if (res.status >= 500) return makeError('SERVER', '服务商故障（HTTP ' + res.status + '）' + tail, true);
    if (res.status === 404) return makeError('NOT_FOUND', '接口或模型不存在（HTTP 404），请检查 baseUrl 与模型名' + tail, false);
    return makeError('HTTP', '调用失败（HTTP ' + res.status + '）' + tail, false);
  }

  function parseJSON(res) {
    return res.json().catch(function () {
      throw makeError('BAD_JSON', '返回的不是合法 JSON，可能命中了代理或登录页', false);
    });
  }

  /* ============================ 长度截断自动重试 ============================ */

  /**
   * 当模型因 token 预算不足被截断（finish_reason=length / MAX_TOKENS / max_tokens）时，
   * 自动按 4 倍扩大输出预算重试（最多 3 次，上限 MAX_TOKEN_BUDGET），
   * 保证回答内容完整，不丢失任何片段。
   * send(budget) 需返回 { text, usage, finishReason }；finishReason 统一用 'length' 表示截断。
   */
  var MAX_TOKEN_BUDGET = 8192;

  function withLengthRetry(send, baseBudget) {
    function attempt(budget, depth) {
      return send(budget).then(function (r) {
        if (r.finishReason === 'length' && budget < MAX_TOKEN_BUDGET && depth < 3) {
          return attempt(Math.min(budget * 4, MAX_TOKEN_BUDGET), depth + 1);
        }
        return r;
      });
    }
    return attempt(baseBudget, 0).then(function (r) {
      if (!r.text) {
        throw makeError('EMPTY',
          '模型在输出正文前耗尽了 token 预算（思考内容过长），已自动扩大预算重试仍为空；请更换模型或在连接参数中调大输出上限',
          true);
      }
      return { text: r.text, usage: r.usage || null, truncated: r.finishReason === 'length' };
    });
  }

  /* ============================ OpenAI 兼容 ============================ */

  /** content 可能是字符串，也可能是分段数组（部分服务商/思考型模型）；全部拼接，不丢片段。 */
  function openaiTextOf(choice) {
    var msg = (choice && choice.message) || {};
    var c = msg.content;
    if (typeof c === 'string') return c;
    if (c && typeof c.length === 'number') {
      return c.map(function (part) { return (part && typeof part.text === 'string') ? part.text : ''; }).join('');
    }
    return '';
  }

  function openaiAdapter(conn, req) {
    var p = paramsFor(req);
    var base = String(conn.baseUrl || '').replace(/\/+$/, '');
    var url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    var body = {
      model: conn.model,
      temperature: p.temperature,
      messages: buildMessages(req)
    };

    function send(budget) {
      body.max_tokens = budget;
      // 预算越大耗时越长，超时随预算等比放宽（上限 60s）
      var timeoutMs = Math.min(Math.round(p.timeoutMs * Math.max(1, budget / p.maxTokens)), 60000);
      return fetchWithTimeout(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + conn.apiKey }, conn.headers || {}),
        body: JSON.stringify(body)
      }, timeoutMs).then(function (res) {
        if (!res.ok) return readError(res).then(function (t) { throw httpError(res, t); });
        return parseJSON(res);
      }).then(function (data) {
        var choice = data && data.choices && data.choices[0];
        var text = String(openaiTextOf(choice) || '').trim();
        var finishReason = (choice && choice.finish_reason) || '';
        // 思考型模型可能把预算全部耗在思考上：正文为空且 finish_reason=length，交给重试机制扩大预算
        if (!text && finishReason !== 'length') throw makeError('EMPTY', '模型返回了空内容', true);
        return { text: text, usage: data.usage || null, finishReason: finishReason === 'length' ? 'length' : finishReason };
      });
    }

    return withLengthRetry(send, p.maxTokens);
  }

  /* ============================ Gemini ============================ */

  function geminiAdapter(conn, req) {
    var p = paramsFor(req);
    var base = String(conn.baseUrl || '').replace(/\/+$/, '');
    var url = base + '/models/' + encodeURIComponent(conn.model) + ':generateContent?key=' + encodeURIComponent(conn.apiKey);
    var msgs = buildMessages(req);
    var systemMsg = msgs.filter(function (m) { return m.role === 'system'; })[0];
    var contents = msgs.filter(function (m) { return m.role !== 'system'; }).map(function (m) {
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    });
    var body = { contents: contents };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

    function send(budget) {
      body.generationConfig = { temperature: p.temperature, maxOutputTokens: budget };
      var timeoutMs = Math.min(Math.round(p.timeoutMs * Math.max(1, budget / p.maxTokens)), 60000);
      return fetchWithTimeout(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, conn.headers || {}),
        body: JSON.stringify(body)
      }, timeoutMs).then(function (res) {
        if (!res.ok) return readError(res).then(function (t) { throw httpError(res, t); });
        return parseJSON(res);
      }).then(function (data) {
        var cand = data && data.candidates && data.candidates[0];
        // 全部 text 分段都要拼接，只取 parts[0] 会丢内容
        var parts = (cand && cand.content && cand.content.parts) || [];
        var text = parts.map(function (pt) { return (pt && typeof pt.text === 'string') ? pt.text : ''; }).join('').trim();
        var finishReason = (cand && cand.finishReason) || '';
        if (finishReason === 'MAX_TOKENS') finishReason = 'length';
        if (!text && finishReason !== 'length') throw makeError('EMPTY', '模型返回了空内容', true);
        return { text: text, finishReason: finishReason };
      });
    }

    return withLengthRetry(send, p.maxTokens);
  }

  /* ============================ Anthropic ============================ */

  /**
   * Anthropic 协议端点拼接。
   * 官方 SDK 的行为是 baseUrl + '/v1/messages'，因此：
   *   https://api.anthropic.com/v1            → …/v1/messages
   *   https://api.deepseek.com/anthropic      → …/anthropic/v1/messages
   * 已以 /messages 结尾的（自建代理）则原样使用。
   */
  function anthropicUrl(baseUrl) {
    var base = String(baseUrl || '').replace(/\/+$/, '');
    if (/\/messages$/.test(base)) return base;
    if (/\/v1$/.test(base)) return base + '/messages';
    return base + '/v1/messages';
  }

  function anthropicAdapter(conn, req) {
    var p = paramsFor(req);
    var base = String(conn.baseUrl || '').replace(/\/+$/, '');
    var msgs = buildMessages(req);
    var systemMsg = msgs.filter(function (m) { return m.role === 'system'; })[0];
    var body = {
      model: conn.model,
      temperature: p.temperature,
      messages: msgs.filter(function (m) { return m.role !== 'system'; })
        .map(function (m) { return { role: m.role, content: m.content }; })
    };
    if (systemMsg) body.system = systemMsg.content;

    function send(budget) {
      body.max_tokens = budget;
      var timeoutMs = Math.min(Math.round(p.timeoutMs * Math.max(1, budget / p.maxTokens)), 60000);
      return fetchWithTimeout(anthropicUrl(conn.baseUrl), {
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'x-api-key': conn.apiKey,
          'anthropic-version': '2023-06-01'
        }, conn.headers || {}),
        body: JSON.stringify(body)
      }, timeoutMs).then(function (res) {
        if (!res.ok) return readError(res).then(function (t) { throw httpError(res, t); });
        return parseJSON(res);
      }).then(function (data) {
        var blocks = (data && data.content) || [];
        var text = blocks.filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
        var stopReason = (data && data.stop_reason) || '';
        if (stopReason === 'max_tokens') stopReason = 'length';
        if (!text && stopReason !== 'length') throw makeError('EMPTY', '模型返回了空内容', true);
        return { text: text, finishReason: stopReason };
      });
    }

    return withLengthRetry(send, p.maxTokens);
  }

  /** 供 UI 展示"即将发出什么"：不含密钥，只含 URL 与报文骨架。 */
  function previewRequest(conn, req) {
    if (conn.kind === 'local') {
      return { kind: 'local', note: '本机进程内调用，不产生任何网络请求', payload: req.payload };
    }
    return {
      kind: conn.kind,
      url: conn.kind === 'gemini'
        ? String(conn.baseUrl).replace(/\/+$/, '') + '/models/' + conn.model + ':generateContent?key=***'
        : conn.kind === 'anthropic'
          ? anthropicUrl(conn.baseUrl)
          : (/\/chat\/completions$/.test(String(conn.baseUrl)) ? conn.baseUrl : String(conn.baseUrl).replace(/\/+$/, '') + '/chat/completions'),
      model: conn.model,
      messages: buildMessages(req)
    };
  }

  MH.modelAdapters = {
    local: localAdapter,
    'openai-compatible': openaiAdapter,
    gemini: geminiAdapter,
    anthropic: anthropicAdapter,
    anthropicUrl: anthropicUrl,
    buildMessages: buildMessages,
    previewRequest: previewRequest,
    CHAT_SYSTEM: CHAT_SYSTEM,
    QA_SYSTEM: QA_SYSTEM,
    makeError: makeError
  };
})(window.MH = window.MH || {});
