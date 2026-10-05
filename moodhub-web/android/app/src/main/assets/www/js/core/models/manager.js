/* ------------------------------------------------------------------
   模型管理器：统一入口。

   职责：场景 → 模型解析、模型切换、场景推荐、统一调用、
        统一错误码、云端失败自动降级到本地、调用日志。

   两条硬约束（任何时候都不能被配置绕过）：
     1) 危机文本永远只走本地，绝不发往云端
     2) 未显式开启「允许数据离开本设备」时，云端模型不会被真正调用
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var R = MH.modelRegistry;

  function scenarios() {
    return Object.keys(R.SCENARIOS).map(function (k) { return R.SCENARIOS[k]; });
  }

  /** 本地模型 + 已启用且有密钥的云端连接。 */
  function listFor(scenario) {
    var scen = R.SCENARIOS[scenario];
    if (!scen) return [];
    var out = R.LOCAL_MODELS.filter(function (m) {
      return m.capabilities.indexOf(scen.capability) >= 0;
    }).map(function (m) {
      return { id: m.id, name: m.name, vendor: m.vendor, kind: 'local', privacy: 'on-device', ready: true, note: m.note, cost: m.cost };
    });

    MH.store.models.connections().forEach(function (c) {
      if (!c.enabled) return;
      out.push({
        id: 'cloud:' + c.id,
        name: c.name,
        vendor: c.model || c.provider,
        kind: c.kind,
        privacy: 'external',
        ready: !!c.apiKey && !!c.baseUrl && !!c.model,
        missing: !c.apiKey ? '缺少 API Key' : (!c.baseUrl || !c.model ? '缺少 baseUrl 或模型名' : ''),
        note: (R.getPreset(c.provider) || {}).note || '',
        cost: 'paid'
      });
    });
    return out;
  }

  /** 把 modelId 解析成可直接调用的条目（含密钥）。 */
  function resolve(modelId) {
    var id = String(modelId || '');
    if (id.indexOf('cloud:') === 0) {
      var c = MH.store.models.getConnection(id.slice(6));
      if (!c) return null;
      return {
        id: id,
        name: c.name,
        kind: c.kind,
        privacy: 'external',
        baseUrl: c.baseUrl,
        model: c.model,
        apiKey: c.apiKey || '',
        headers: c.headers || {},
        params: c.params || {},
        provider: c.provider
      };
    }
    var local = R.getLocal(id);
    if (!local) return null;
    return { id: local.id, name: local.name, kind: 'local', privacy: 'on-device', params: {} };
  }

  function describe(modelId) {
    var m = resolve(modelId);
    if (!m) return { id: modelId, name: '未配置', privacy: 'unknown', ready: false };
    return { id: m.id, name: m.name, kind: m.kind, privacy: m.privacy, ready: m.kind === 'local' || !!m.apiKey, vendor: m.model || m.provider || m.vendor };
  }

  function activeFor(scenario) { return MH.store.models.activeFor(scenario); }

  function setActive(scenario, modelId) {
    if (!R.SCENARIOS[scenario]) return false;
    MH.store.models.setActive(scenario, modelId);
    return true;
  }

  /* ============================ 场景推荐 ============================ */

  function recommend(scenario, ctx) {
    var scen = R.SCENARIOS[scenario];
    if (!scen) return null;
    var conns = MH.store.models.connections().filter(function (c) {
      return c.enabled && c.apiKey && c.baseUrl && c.model;
    });
    var allowExternal = MH.store.models.allowExternal();

    if (!conns.length) {
      return { modelId: scen.defaultModel, reason: '还没有配置可用的云端连接，本地引擎离线即可用，也不必担心数据外发。' };
    }
    if (!allowExternal) {
      return { modelId: scen.defaultModel, reason: '当前是「严格本地」模式。若确实需要云端模型，请先在下方开启外发授权。' };
    }

    if (scenario === 'qa') {
      var need = (ctx && ctx.chars) || 6000;
      var sized = conns.slice().sort(function (a, b) {
        return R.estimateWindow(a.model) - R.estimateWindow(b.model);
      });
      var fit = sized.filter(function (c) { return R.estimateWindow(c.model) >= need; })[0] || sized[sized.length - 1];
      return {
        modelId: 'cloud:' + fit.id,
        reason: '问答上下文约 ' + need + ' 字符，' + fit.model + ' 的窗口足够且相对经济。'
      };
    }

    var fast = conns.filter(function (c) { return /flash|turbo|lite|mini|haiku/i.test(c.model); })[0] || conns[0];
    return {
      modelId: 'cloud:' + fast.id,
      reason: '陪伴对话追求响应快、成本低，' + fast.model + ' 更合适；需要深度分析时再切到更强的模型。'
    };
  }

  /* ============================ 统一调用 ============================ */

  function userTextOf(payload) {
    return String((payload && (payload.message || payload.question)) || '');
  }

  function localFallback(scenario) {
    return R.SCENARIOS[scenario].defaultModel;
  }

  function runLocal(scenario, payload, modelId) {
    var model = resolve(modelId) || resolve(localFallback(scenario));
    return invoke(model, scenario, payload);
  }

  function invoke(model, scenario, payload) {
    var adapter = MH.modelAdapters[model.kind];
    if (!adapter) {
      var e = MH.modelAdapters.makeError('ADAPTER', '未支持的模型协议：' + model.kind, false);
      return Promise.reject(e);
    }
    var scen = R.SCENARIOS[scenario];
    return adapter(model, {
      scenario: scenario,
      task: scen.task,
      payload: payload,
      params: model.params || {}
    });
  }

  /** 云端调用 + 瞬时故障自动重试：超时/网络/限流/服务端故障等可重试错误间隔 800ms 重试一次；
   *  EMPTY 由适配器内部扩大 token 预算重试，这里不再重复请求。 */
  function invokeWithRetry(model, scenario, payload) {
    return invoke(model, scenario, payload).catch(function (err) {
      if (!err || !err.retryable || err.code === 'EMPTY') throw err;
      return new Promise(function (done) { setTimeout(done, 800); })
        .then(function () { return invoke(model, scenario, payload); });
    });
  }

  function fail(err) {
    return {
      code: err && err.code ? err.code : 'UNKNOWN',
      message: err && err.message ? err.message : String(err || '未知错误'),
      retryable: !!(err && err.retryable)
    };
  }

  /**
   * 统一调用入口。
   * @param {string} scenario companion | qa
   * @param {Object} payload   {message,summary} 或 {question,customPrompt,context,facts,intent}
   * @param {Object} [opts]    {modelId, chars}
   */
  function run(scenario, payload, opts) {
    var scen = R.SCENARIOS[scenario];
    if (!scen) return Promise.reject(MH.modelAdapters.makeError('SCENARIO', '未知场景：' + scenario, false));

    var o = opts || {};
    var requested = o.modelId || activeFor(scenario);
    var model = resolve(requested);
    var text = userTextOf(payload);
    var started = Date.now();
    var chars = o.chars || ((payload && payload.context && payload.context.charCount) || text.length);

    // 模型解析失败（如所选模型已被删除）→ 降级本地并给出明确原因
    if (!model) {
      return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
        return finish(scenario, resolve(localFallback(scenario)), r, true,
          { code: 'MODEL_NOT_FOUND', message: '所选模型不存在或已被移除，已改用本地引擎', retryable: false }, started, chars, payload);
      });
    }

    // 硬约束 1：危机文本只走本地
    if (model.privacy === 'external' && MH.localService.isCrisis(text)) {
      return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
        var out = finish(scenario, resolve(localFallback(scenario)), r, true,
          { code: 'CRISIS_GUARD', message: '检测到危机信号，本次强制使用本地模型，内容不会离开设备', retryable: false },
          started, chars, payload);
        return out;
      });
    }

    // 硬约束 2：未授权外发 → 直接本地
    if (model.privacy === 'external' && !MH.store.models.allowExternal()) {
      return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
        return finish(scenario, resolve(localFallback(scenario)), r, true,
          { code: 'BLOCKED_BY_PRIVACY', message: '严格本地模式下不会调用云端模型，已改用本地引擎', retryable: false },
          started, chars, payload);
      });
    }

    // 配置不完整 → 本地 + 明确原因
    if (model && model.privacy === 'external') {
      if (!model.apiKey) {
        return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
          return finish(scenario, resolve(localFallback(scenario)), r, true,
            { code: 'NO_KEY', message: '该连接没有 API Key，已改用本地引擎', retryable: false }, started, chars);
        });
      }
      if (!model.baseUrl || !model.model) {
        return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
          return finish(scenario, resolve(localFallback(scenario)), r, true,
            { code: 'MISSING_CONFIG', message: '缺少 baseUrl 或模型名，已改用本地引擎', retryable: false }, started, chars);
        });
      }
    }

    return invokeWithRetry(model, scenario, payload).then(function (r) {
      return finish(scenario, model, r, false, null, started, chars, payload);
    }).catch(function (err) {
      // 云端失败（含重试后仍失败）→ 自动降级本地，保证功能不中断
      if (model.privacy === 'external') {
        return runLocal(scenario, payload, localFallback(scenario)).then(function (r) {
          return finish(scenario, resolve(localFallback(scenario)), r, true, fail(err), started, chars, payload);
        }).catch(function (e2) {
          // 本地兜底也失败：把云端错误与本地错误一起暴露，绝不静默吞掉
          var f = fail(err);
          return Promise.reject(MH.modelAdapters.makeError(
            'FALLBACK_FAILED',
            '云端调用失败（' + f.code + '：' + f.message + '），且本地引擎兜底也失败：' + (e2 && e2.message ? e2.message : e2),
            false));
        });
      }
      return Promise.reject(err);
    });
  }

  function finish(scenario, model, r, degraded, error, started, chars, payload) {
    var preview = null;
    try {
      preview = MH.modelAdapters.previewRequest(model, {
        scenario: scenario, task: R.SCENARIOS[scenario].task, payload: payload || {}
      });
    } catch (e) { preview = null; }

    var out = {
      text: r.text,
      tags: r.tags || null,
      resources: r.resources || null,
      truncated: !!r.truncated,
      preview: preview,
      modelId: model.id,
      modelName: model.name,
      kind: model.kind,
      privacy: model.privacy,
      degraded: !!degraded,
      error: error || null,
      latencyMs: Date.now() - started,
      chars: chars
    };
    MH.store.models.log({
      scenario: scenario, modelId: out.modelId, modelName: out.modelName, privacy: out.privacy,
      ok: !degraded, degraded: !!degraded, code: error ? error.code : '',
      message: error ? error.message : '', latencyMs: out.latencyMs, chars: chars
    });
    return out;
  }

  /** 连通性测试：不做降级，直接暴露真实错误。 */
  function test(modelId) {
    var model = resolve(modelId);
    if (!model) return Promise.resolve({ ok: false, code: 'NOT_FOUND', message: '找不到该模型', latencyMs: 0 });
    if (model.kind === 'local') {
      return Promise.resolve({ ok: true, code: '', message: '本地引擎无需联网，随时可用', latencyMs: 0 });
    }
    if (!model.apiKey) return Promise.resolve({ ok: false, code: 'NO_KEY', message: '请先填写 API Key', latencyMs: 0 });
    if (!model.baseUrl || !model.model) return Promise.resolve({ ok: false, code: 'MISSING_CONFIG', message: '请填写 baseUrl 与模型名', latencyMs: 0 });

    var started = Date.now();
    return invoke(model, 'companion', { message: 'ping', summary: null })
      .then(function () { return { ok: true, code: '', message: '连接成功', latencyMs: Date.now() - started }; })
      .catch(function (e) {
        var f = fail(e);
        return { ok: false, code: f.code, message: f.message, latencyMs: Date.now() - started };
      });
  }

  MH.models = {
    scenarios: scenarios,
    listFor: listFor,
    resolve: resolve,
    describe: describe,
    activeFor: activeFor,
    setActive: setActive,
    recommend: recommend,
    run: run,
    test: test,
    privacy: {
      allowExternal: function () { return MH.store.models.allowExternal(); },
      setAllowExternal: function (on) { return MH.store.models.setAllowExternal(on); }
    },
    logs: function () { return MH.store.models.logs(); },
    clearLogs: function () { MH.store.models.clearLogs(); }
  };
})(window.MH = window.MH || {});
