/* ------------------------------------------------------------------
   本地检索：把数据源切成块，用 BM25 打分挑出与问题最相关的证据，
   再在字符预算内组装上下文。全部在本机内存完成，不涉及任何外部服务。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var CHUNK_SIZE = 600;
  var CHUNK_OVERLAP = 80;
  var K1 = 1.5;
  var B = 0.75;

  var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  /** 中文按字 + 二元组切分，英文数字按词切分。 */
  function tokenize(text) {
    var s = String(text || '').toLowerCase();
    var out = [];
    var latin = s.match(/[a-z][a-z0-9_.-]*|\d+(?:\.\d+)?/g);
    if (latin) out = out.concat(latin);

    var runs = s.split(/[^一-鿿㐀-䶿0-9a-z]+/).filter(Boolean);
    runs.forEach(function (run) {
      if (!CJK_RE.test(run)) return;
      var cjk = run.replace(/[^\u3400-\u4dbf\u4e00-\u9fff]/g, '');
      for (var i = 0; i < cjk.length; i++) {
        out.push(cjk[i]);
        if (i + 1 < cjk.length) out.push(cjk.slice(i, i + 2));
      }
    });
    return out;
  }

  /** 按行累积成块，块之间保留少量重叠，避免切断语义。 */
  function chunkText(sourceId, sourceName, text) {
    var lines = String(text || '').split('\n');
    var chunks = [];
    var buf = '';
    var index = 0;
    var lineStart = 0;

    function flush() {
      var t = buf.trim();
      if (t) chunks.push({ id: sourceId + '#' + index, sourceId: sourceId, sourceName: sourceName, text: t, index: index++, from: lineStart });
      var keep = t.slice(-CHUNK_OVERLAP);
      buf = keep ? keep + '\n' : '';
    }

    for (var i = 0; i < lines.length; i++) {
      buf += lines[i] + '\n';
      if (buf.length >= CHUNK_SIZE) { flush(); lineStart = i + 1; }
    }
    flush();
    return chunks;
  }

  /** 建立索引：切块 + 统计 df / 块长。 */
  function buildIndex(docs) {
    var chunks = [];
    (docs || []).forEach(function (d) {
      if (!d || !d.text) return;
      chunks = chunks.concat(chunkText(d.id, d.name, d.text));
    });

    var df = {};
    var tokenized = chunks.map(function (c) {
      var toks = tokenize(c.text);
      var tf = {};
      toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      return { chunk: c, tf: tf, len: toks.length };
    });

    var totalLen = tokenized.reduce(function (s, t) { return s + (t.len || 1); }, 0);
    return {
      chunks: chunks,
      tokenized: tokenized,
      df: df,
      avgdl: tokenized.length ? totalLen / tokenized.length : 1
    };
  }

  /** BM25 打分，返回按分数降序的候选。 */
  function search(index, query, topK) {
    if (!index || !index.tokenized.length) return [];
    var qTokens = tokenize(query);
    if (!qTokens.length) return [];
    var qTf = {};
    qTokens.forEach(function (t) { qTf[t] = (qTf[t] || 0) + 1; });
    var N = index.tokenized.length;

    var scored = [];
    index.tokenized.forEach(function (entry) {
      var score = 0;
      var matched = [];
      Object.keys(qTf).forEach(function (t) {
        var tf = entry.tf[t];
        if (!tf) return;
        var df = index.df[t] || 1;
        var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        if (idf <= 0) return;
        var norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (entry.len / index.avgdl)));
        score += idf * norm;
        if (matched.length < 6) matched.push(t);
      });
      if (score > 0) scored.push({ chunk: entry.chunk, score: score, matched: matched });
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    // 同一来源最多 2 块，保证多来源时答案不会被单一文件占满
    var perSource = {};
    var out = [];
    for (var i = 0; i < scored.length && out.length < (topK || 4); i++) {
      var sid = scored[i].chunk.sourceId;
      perSource[sid] = (perSource[sid] || 0) + 1;
      if (perSource[sid] > 2) continue;
      out.push(scored[i]);
    }
    // 若因限额不足，则放宽补齐
    if (out.length < (topK || 4)) {
      for (var j = 0; j < scored.length && out.length < (topK || 4); j++) {
        if (out.indexOf(scored[j]) < 0) out.push(scored[j]);
      }
    }
    return out;
  }

  /** 从块中挑出与问题最贴近的一句作为引用摘要。 */
  function pickQuote(chunkText, query, maxLen) {
    var limit = maxLen || 180;
    // 句号只在后跟空白/结尾时才断句，避免把 "7.5" 的小数点当成句号切断
    var sentences = String(chunkText).split(/[\n。！？；;!?]+|\.(?=\s|$)/)
      .filter(function (s) { return s.trim().length > 4 && !/^\s*(来源|字段)\s*[：:]/.test(s); });
    if (!sentences.length) return String(chunkText).slice(0, limit);

    var q = tokenize(query);
    var qSet = {};
    q.forEach(function (t) { qSet[t] = 1; });

    var best = sentences[0], bestScore = -1;
    sentences.forEach(function (s) {
      var toks = tokenize(s);
      var hit = 0;
      toks.forEach(function (t) { if (qSet[t]) hit++; });
      var sc = hit / Math.sqrt(toks.length || 1);
      if (sc > bestScore) { bestScore = sc; best = s; }
    });

    var text = best.trim().replace(/\s+/g, ' ');
    return text.length <= limit ? text : text.slice(0, limit) + '…';
  }

  /**
   * 组装上下文。
   * @param {{prompt?:string, blocks?:Array, healthText?:string, personaText?:string,
   *          memoryText?:string, budget?:number}} o
   * @returns {{text:string, usedSources:string[], charCount:number, blocks:Array}}
   */
  function assemble(o) {
    var budget = o.budget || 12000;
    var blocks = [];
    var used = [];
    var parts = [];
    var total = 0;

    function push(label, body, sourceLabel) {
      if (!body) return false;
      var head = '【' + label + '】\n';
      var room = budget - total - head.length;
      if (room <= 40) return false;
      var text = body.length > room ? body.slice(0, room) + '…（已按预算截断）' : body;
      parts.push(head + text);
      total += head.length + text.length;
      if (sourceLabel && used.indexOf(sourceLabel) < 0) used.push(sourceLabel);
      return true;
    }

    if (o.prompt && o.prompt.trim()) push('用户补充说明', o.prompt.trim(), '补充说明');
    if (o.memoryText && o.memoryText.trim()) push('历史对话记忆', o.memoryText.trim(), '历史对话记忆');
    if (o.personaText && o.personaText.trim()) push('用户人格画像', o.personaText.trim(), '人格画像');
    if (o.healthText && o.healthText.trim()) push('本机健康记录摘要', o.healthText.trim(), '健康记录摘要');

    (o.blocks || []).forEach(function (b) {
      var ok = push('数据源：' + b.chunk.sourceName, b.chunk.text, b.chunk.sourceName);
      if (ok) blocks.push(b);
    });

    return { text: parts.join('\n\n'), usedSources: used, charCount: total, blocks: blocks };
  }

  MH.retriever = {
    CHUNK_SIZE: CHUNK_SIZE,
    tokenize: tokenize,
    chunkText: chunkText,
    buildIndex: buildIndex,
    search: search,
    pickQuote: pickQuote,
    assemble: assemble
  };
})(window.MH = window.MH || {});
