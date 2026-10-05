/* ------------------------------------------------------------------
   导入流水线：解析 → 映射 → 清洗 → 时间对齐 → 去重 → 落库。

   设计约束（与项目其它部分一致）：
   - 全程本机。文件只经 FileReader 读进内存，不产生任何网络请求。
   - 纯 ES5 + Promise，无构建、无依赖。
   - 每一步都能单独调用（便于回归测试），也能串起来跑（带进度与取消）。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var METRIC_KEYS = ['mood', 'sleep', 'heartRate', 'stress'];
  var MAX_ISSUES = 300;
  var CHUNK = 300;

  var CONFLICTS = [
    { id: 'merge', label: '补齐', desc: '本机已有这一天时只补空缺字段，原有数值一律不动' },
    { id: 'overwrite', label: '覆盖', desc: '同一天同一时刻以导入数据为准，未导入的字段仍保留' },
    { id: 'skip', label: '跳过', desc: '本机已有记录的日期直接跳过，只补空白日期' },
    { id: 'append', label: '追加', desc: '总是新增一条；同一天多条时统计会自动取平均' }
  ];

  var DEFAULT_OPTIONS = {
    conflict: 'merge',        // merge | overwrite | skip | append
    outOfRange: 'drop',       // drop | clamp
    snapStep: true,           // 对齐到表单步长（睡眠 0.5，其它为整数）
    auxToNote: true,          // 把步数 / HRV 等辅助指标写进备注
    from: '',                 // 日期区间下界
    to: '',                   // 日期区间上界
    sleepDayRule: 'wake'      // wake | start
  };

  var ISSUE_LABELS = {
    INVALID_DATE: '日期无法解析',
    FUTURE_DATE: '日期晚于今天',
    OUT_OF_RANGE: '数值超出量程',
    NO_VALUE: '这一行没有任何可用指标',
    UNMAPPED: '没有指定该指标对应的列'
  };

  function fail(code, message, hint) {
    var e = new Error(message);
    e.code = code;
    e.hint = hint || '';
    return e;
  }

  function frame() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  /* ============================ 时间对齐 ============================ */

  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };

  function iso(y, m, d) {
    if (!m || m < 1 || m > 12) return null;
    if (!d || d < 1 || d > 31) return null;
    return y + '-' + U.pad2(m) + '-' + U.pad2(d);
  }

  /**
   * 把任意来源的时间串解析为 {date, time}。
   * 一律按本机时区落到「日历日」——记录的存储单位是日期，不存在跨时区换算。
   */
  function parseDateTime(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    if (/^\d{10}$/.test(s)) return fromDate(new Date(Number(s) * 1000));
    if (/^\d{13}$/.test(s)) return fromDate(new Date(Number(s)));

    var time = '';
    var tm = /(\d{1,2}):(\d{2})/.exec(s);
    if (tm) time = U.pad2(Number(tm[1])) + ':' + tm[2];

    var m, date;
    if ((m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s))) date = iso(+m[1], +m[2], +m[3]);
    if (!date) {
      m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
      if (m) {
        // 第一位超过 12 时只能是 DD/MM/YYYY；否则按常见的 MM/DD/YYYY 处理
        var first = +m[1], second = +m[2];
        date = first > 12 ? iso(+m[3], second, first) : iso(+m[3], first, second);
      }
    }
    if (!date) {
      m = /^(\d{1,2})月(\d{1,2})日/.exec(s);
      if (m) date = iso(new Date().getFullYear(), +m[1], +m[2]);
    }
    if (!date) {
      m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
      if (m) {
        var month = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (month) date = iso(+m[3], month, +m[2]);
      }
    }
    if (date) return { date: date, time: time };

    // 兜底交给 ingest 的日期归一，但要拦住 2026-13-40 这类「看着像」的非法日期
    var fallback = MH.ingest.normalizeDate(s);
    if (fallback && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(fallback)) {
      return { date: fallback, time: time };
    }
    return null;
  }

  function fromDate(d) {
    if (!d || isNaN(d.getTime())) return null;
    return { date: U.toISODate(d), time: U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) };
  }

  function snapToStep(value, step) {
    if (step === 1) return Math.round(value);
    if (step === 0.5) return Math.round(value * 2) / 2;
    return Math.round(value * 100) / 100;
  }

  /* ============================ 行清洗 ============================ */

  function auxToNoteText(auxValues) {
    var parts = [];
    MH.importVendors.targets.forEach(function (t) {
      if (t.role !== 'aux') return;
      var v = auxValues[t.key];
      if (v == null) return;
      var text = String(Math.abs(v) >= 100 ? Math.round(v) : (Math.round(v * 100) / 100));
      parts.push(t.label + ' ' + text + ' ' + t.unit);
    });
    return parts.length ? '自动导入：' + parts.join(' · ') : '';
  }

  /**
   * 把一个区间内的原始行转成「样本」。可在多个 chunk 上重复调用。
   * @returns {{samples:Array, counts:Object, issues:Array}}
   */
  function transform(table, mapping, options, range) {
    var opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    var rows = table.rows || [];
    var start = range ? range.start : 0;
    var end = Math.min(rows.length, range ? range.end : rows.length);
    var today = U.todayISO();
    var source = { file: table.label || '', path: table.path || '' };

    var samples = [], issues = [];
    var counts = { rows: 0, valid: 0, invalid: 0, filtered: 0 };

    function issue(code, rowIndex, extra) {
      var item = {
        code: code,
        reason: ISSUE_LABELS[code] || code,
        row: rowIndex + 1,
        file: source.file,
        path: source.path
      };
      Object.keys(extra || {}).forEach(function (k) { item[k] = extra[k]; });
      issues.push(item);
    }

    if (!mapping || !mapping.date || !mapping.date.column) {
      throw fail('NO_DATE_COLUMN', '没有指定日期列，无法判断这些数值属于哪一天', '请在上一步手动选择日期列。');
    }
    var hasMetric = METRIC_KEYS.some(function (k) { return mapping.metrics && mapping.metrics[k]; });
    if (!hasMetric) {
      throw fail('NO_METRIC_COLUMN', '没有指定任何指标列', '请至少选择心情 / 睡眠 / 心率 / 压力中的一列。');
    }

    for (var i = start; i < end; i++) {
      var row = rows[i] || {};
      counts.rows++;

      var dt = parseDateTime(row[mapping.date.column]);
      if (!dt || !dt.date) { counts.invalid++; issue('INVALID_DATE', i, { raw: String(row[mapping.date.column] || '').slice(0, 40) }); continue; }
      if (dt.date > today) { counts.invalid++; issue('FUTURE_DATE', i, { date: dt.date }); continue; }
      if ((opts.from && dt.date < opts.from) || (opts.to && dt.date > opts.to)) { counts.filtered++; continue; }

      var time = dt.time;
      if (mapping.time && mapping.time.column) {
        var tv = String(row[mapping.time.column] || '').trim();
        var tm = /^(\d{1,2}):(\d{2})/.exec(tv);
        if (tm) time = U.pad2(Number(tm[1])) + ':' + tm[2];
      }

      var values = {}, metrics = 0;
      METRIC_KEYS.forEach(function (key) {
        var plan = mapping.metrics ? mapping.metrics[key] : null;
        if (!plan || !plan.column) return;
        var target = MH.importVendors.target(key);
        var raw = row[plan.column];
        var num = MH.ingest.toNumber(raw);
        if (num == null) return;
        var v = num * (plan.unit ? plan.unit.factor : 1);
        v = Math.round(v * 1000) / 1000;

        if (v < target.min || v > target.max) {
          if (opts.outOfRange === 'clamp') {
            v = U.clamp(v, target.min, target.max);
            issue('OUT_OF_RANGE', i, { date: dt.date, metric: target.label, raw: String(raw).slice(0, 24), note: '已截断到量程边界' });
          } else {
            issue('OUT_OF_RANGE', i, { date: dt.date, metric: target.label, raw: String(raw).slice(0, 24), note: '该字段被丢弃' });
            return;
          }
        }
        if (opts.snapStep) v = snapToStep(v, target.step);
        values[key] = v;
        metrics++;
      });

      var auxValues = {};
      Object.keys(mapping.aux || {}).forEach(function (key) {
        var plan = mapping.aux[key];
        if (!plan || !plan.column) return;
        var num = MH.ingest.toNumber(row[plan.column]);
        if (num == null) return;
        auxValues[key] = Math.round(num * 100) / 100;
      });

      if (!metrics) {
        counts.invalid++;
        issue('NO_VALUE', i, { date: dt.date });
        continue;
      }

      var note = opts.auxToNote ? auxToNoteText(auxValues) : '';
      samples.push({
        date: dt.date,
        time: time || '',
        values: values,
        aux: auxValues,
        note: note,
        source: source,
        row: i + 1
      });
      counts.valid++;
    }

    return { samples: samples, counts: counts, issues: issues };
  }

  /* ============================ 去重 / 落库 ============================ */

  /** 批内去重：同一「日期 + 时刻」合并为一条，先到先得，后来的只补空缺字段。 */
  function mergeSamples(samples) {
    var buckets = {};
    var order = [];
    var merged = 0;
    samples.forEach(function (s) {
      var key = s.date + '|' + s.time;
      var hit = buckets[key];
      if (!hit) {
        buckets[key] = {
          date: s.date, time: s.time,
          values: Object.assign({}, s.values),
          note: s.note || '',
          sources: [s.source]
        };
        order.push(key);
        return;
      }
      // 后来的占选项补充：只填空缺，不覆盖已有数值
      METRIC_KEYS.forEach(function (k) {
        if (hit.values[k] == null && s.values[k] != null) hit.values[k] = s.values[k];
      });
      if (!hit.note && s.note) hit.note = s.note;
      if (hit.sources.indexOf(s.source) < 0) hit.sources.push(s.source);
      merged++;
    });
    return { list: order.map(function (k) { return buckets[k]; }), merged: merged };
  }

  /**
   * 与本机已有记录合并。
   * @returns {{records:Array, counts:{added,updated,skipped}, addedIds:Array, before:Array}}
   */
  function applyToExisting(samples, options) {
    var opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    var before = MH.store.records.all();
    var list = before.slice();
    var index = {};
    list.forEach(function (r, i) {
      var key = r.date + '|' + (r.time || '');
      if (index[key] == null) index[key] = i;
    });

    var counts = { added: 0, updated: 0, skipped: 0 };
    var addedIds = [];

    samples.forEach(function (s) {
      var key = s.date + '|' + s.time;
      var idx = opts.conflict === 'append' ? -1 : index[key];

      if (idx == null || idx < 0) {
        var rec = {
          id: U.uid(),
          date: s.date,
          time: s.time || '',
          mood: s.values.mood == null ? null : s.values.mood,
          sleep: s.values.sleep == null ? null : s.values.sleep,
          heartRate: s.values.heartRate == null ? null : s.values.heartRate,
          stress: s.values.stress == null ? null : s.values.stress,
          note: s.note || '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        list.push(rec);
        index[key] = list.length - 1;
        addedIds.push(rec.id);
        counts.added++;
        return;
      }

      if (opts.conflict === 'skip') { counts.skipped++; return; }

      var existing = list[idx];
      var patch = {};
      var changed = false;
      METRIC_KEYS.forEach(function (k) {
        if (s.values[k] == null) return;
        if (opts.conflict === 'merge' && existing[k] != null) return;   // 补齐模式：已有的不动
        if (existing[k] === s.values[k]) return;
        patch[k] = s.values[k];
        changed = true;
      });
      if (s.note && (!existing.note || existing.note.indexOf('自动导入') === 0)) {
        if (existing.note !== s.note) { patch.note = s.note; changed = true; }
      }
      if (!changed) { counts.skipped++; return; }   // 该有的数据本机已经有了
      patch.updatedAt = Date.now();
      list[idx] = Object.assign({}, existing, patch);
      counts.updated++;
    });

    return { records: list, counts: counts, addedIds: addedIds, before: before };
  }

  /* ============================ 来源检查（读取 + 识别 + 初映射） ============================ */

  /**
   * @param {{name:string, bytes?:Uint8Array, text?:string, size?:number, profileId?:string}} input
   * @returns {Promise<{name, kind, size, tables:Array, detection:Object, skipped:Array, warnings:Array}>}
   */
  function inspect(input) {
    var name = input.name || '';
    return MH.importFormats.tables(input, { sleepDayRule: (input.options && input.options.sleepDayRule) || 'wake' })
      .then(function (res) {
        if (!res.tables.length) {
          throw fail('NO_TABLE', '没有从「' + name + '」里读出任何表格', '确认文件不是空的，也不是加密的压缩包。');
        }
        var first = res.tables[0];
        var textSample = (first.rows && first.rows.length ? JSON.stringify(first.rows[0]) : first.headers.join(',')).slice(0, 2000);
        var detection = MH.importVendors.detect({
          name: name,
          tables: res.tables,
          textSample: input.text ? String(input.text).slice(0, 2000) : textSample
        });
        var forced = input.profileId && input.profileId !== 'auto' ? MH.importVendors.profile(input.profileId) : null;
        var topId = forced ? forced.id : (detection[0] && detection[0].score >= 25 ? detection[0].id : 'generic');
        var detectionInfo = detection.filter(function (d) { return d.id === topId; })[0] || detection[detection.length - 1];

        var tables = res.tables.map(function (t) {
          return { table: t, mapping: MH.importVendors.map(t, topId, t.mappingOverrides) };
        });

        return {
          name: name,
          size: input.size || 0,
          kind: res.kind,
          tables: tables,
          rawDetection: detection,
          detection: detectionInfo,
          skipped: res.skipped || [],
          warnings: res.warnings || []
        };
      });
  }

  /* ============================ 一键跑完 ============================ */

  var UNDO = null;

  /**
   * @param {{inputs:Array, options:Object, onProgress:Function, cancelToken:Object}} job
   * inputs: [{name, label, path, table, mapping, profileId}]
   * @returns {Promise<Object>} 导入报告
   */
  function run(job) {
    var inputs = (job && job.inputs) || [];
    var options = Object.assign({}, DEFAULT_OPTIONS, (job && job.options) || {});
    var token = (job && job.cancelToken) || { cancelled: false };
    var onProgress = (job && job.onProgress) || function () {};

    if (!inputs.length) return Promise.reject(fail('NO_INPUT', '没有可导入的数据'));

    var totalRows = 0;
    inputs.forEach(function (input) {
      var rows = (input.table && input.table.rows) || [];
      totalRows += rows.length;
    });

    var bucketsState = { list: {}, order: [], merged: 0 };
    var issues = [];
    var counts = { rows: 0, valid: 0, invalid: 0, filtered: 0, added: 0, updated: 0, skipped: 0, merged: 0 };
    var processed = 0;
    var issueOverflow = 0;

    function pushIssues(list) {
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        if (issues.length >= MAX_ISSUES) { issueOverflow++; continue; }
        issues.push(list[i]);
      }
    }

    function pushSamples(samples) {
      // 与批内去重同一套规则，边处理边合并，避免大文件占两份内存
      for (var i = 0; i < samples.length; i++) {
        var s = samples[i];
        var key = s.date + '|' + s.time;
        var hit = bucketsState.list[key];
        if (!hit) {
          bucketsState.list[key] = {
            date: s.date, time: s.time,
            values: Object.assign({}, s.values),
            note: s.note || '',
            sources: [s.source]
          };
          bucketsState.order.push(key);
          continue;
        }
        METRIC_KEYS.forEach(function (k) {
          if (hit.values[k] == null && s.values[k] != null) hit.values[k] = s.values[k];
        });
        if (!hit.note && s.note) hit.note = s.note;
        counts.merged++;
      }
    }

    function report(pct, phase, label) {
      onProgress({ percent: Math.max(0, Math.min(100, Math.round(pct))), phase: phase, label: label, processed: processed, total: totalRows });
    }

    return new Promise(function (resolve, reject) {
      var inputIndex = 0;
      var rowCursor = 0;

      report(2, 'prepare', '准备导入');

      function nextInput() {
        if (token.cancelled) { reject(fail('CANCELLED', '导入已取消')); return; }
        if (inputIndex >= inputs.length) return finish();
        rowCursor = 0;
        nextChunk();
      }

      function nextChunk() {
        if (token.cancelled) { reject(fail('CANCELLED', '导入已取消')); return; }

        var input = inputs[inputIndex];
        var rows = (input.table && input.table.rows) || [];
        if (rowCursor >= rows.length) {
          inputIndex++;
          return frame().then(nextInput);
        }

        var end = Math.min(rows.length, rowCursor + CHUNK);
        var label = '正在清洗 ' + (input.label || input.name || '数据') + '（' + end + ' / ' + rows.length + ' 行）';
        report(8 + (processed / Math.max(1, totalRows)) * 74, 'transform', label);

        frame().then(function () {
          var out;
          try {
            out = transform(input.table, input.mapping, options, { start: rowCursor, end: end });
          } catch (e) {
            reject(e);
            return;
          }
          counts.rows += out.counts.rows;
          counts.valid += out.counts.valid;
          counts.invalid += out.counts.invalid;
          counts.filtered += out.counts.filtered;
          pushIssues(out.issues);
          pushSamples(out.samples);
          processed += (end - rowCursor);
          rowCursor = end;
          nextChunk();
        });
      }

      function finish() {
        if (token.cancelled) { reject(fail('CANCELLED', '导入已取消')); return; }
        if (!counts.valid && !counts.merged) {
          reject(fail('NO_VALID_ROWS', '没有读到任何可用的记录', issues.length ? '最常见的原因：' + (issues[0].reason + (issues[0].raw ? '（例如「' + issues[0].raw + '」）' : '')) : '检查一下日期列与指标列是否选对。'));
          return;
        }

        report(88, 'dedupe', '按日期去重');
        frame().then(function () {
          if (token.cancelled) { reject(fail('CANCELLED', '导入已取消')); return; }

          var merged = {
            list: bucketsState.order.map(function (k) { return bucketsState.list[k]; }),
            merged: counts.merged
          };
          var applied = applyToExisting(merged.list, options);
          if (token.cancelled) { reject(fail('CANCELLED', '导入已取消')); return; }

          report(96, 'commit', '写入本机记录');
          return frame().then(function () {
            MH.store.records.save(applied.records);
            counts.added = applied.counts.added;
            counts.updated = applied.counts.updated;
            counts.skipped = applied.counts.skipped + merged.merged;

            var id = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            var reportObj = {
              id: id,
              at: Date.now(),
              counts: counts,
              issues: issues,
              issueOverflow: issueOverflow,
              options: options,
              files: inputs.map(function (i) {
                return { name: i.name, label: i.label, path: i.path, profile: i.profileName || '', rows: (i.table && i.table.rows.length) || 0 };
              }),
              mapping: inputs[0] && inputs[0].mapping ? summarizeMapping(inputs[0].mapping) : null,
              addedIds: applied.addedIds
            };

            UNDO = { id: id, before: applied.before, report: reportObj };
            MH.store.imports.add({
              id: id,
              at: reportObj.at,
              files: reportObj.files.map(function (f) { return f.label || f.name; }),
              profile: reportObj.files.length ? reportObj.files[0].profile : '',
              conflict: options.conflict,
              counts: {
                rows: counts.rows,
                added: counts.added,
                updated: counts.updated,
                skipped: counts.skipped,
                invalid: counts.invalid,
                filtered: counts.filtered
              }
            });

            report(100, 'done', '导入完成');
            resolve(reportObj);
          });
        }).catch(function (e) {
          reject(e && e.code ? e : fail('COMMIT_FAILED', '写入本机记录失败：' + (e && e.message ? e.message : e), '可能是浏览器存储空间已满，可以到「设置 → 数据」里看看占用。'));
        });
      }

      frame().then(nextInput);
    });
  }

  function summarizeMapping(mapping) {
    var out = { date: mapping.date ? mapping.date.column : '', metrics: {}, aux: {}, transforms: [] };
    Object.keys(mapping.metrics || {}).forEach(function (k) {
      var m = mapping.metrics[k];
      out.metrics[k] = m ? { column: m.column, unit: m.unit ? m.unit.sourceUnit : '' } : null;
      if (m && m.unit && m.unit.label) out.transforms.push(k + '：' + m.unit.label);
    });
    Object.keys(mapping.aux || {}).forEach(function (k) {
      out.aux[k] = mapping.aux[k] ? mapping.aux[k].column : null;
    });
    return out;
  }

  /** 回滚一次刚刚完成的导入（同一会话内有效）。 */
  function undo(reportId) {
    if (!UNDO || (reportId && UNDO.id !== reportId)) return { restored: 0 };
    var before = UNDO.before;
    MH.store.records.save(before);
    var n = before.length;
    UNDO = null;
    return { restored: n };
  }

  function canUndo(reportId) {
    return !!UNDO && (!reportId || UNDO.id === reportId);
  }

  MH.healthImport = {
    METRIC_KEYS: METRIC_KEYS,
    MAX_ISSUES: MAX_ISSUES,
    conflicts: CONFLICTS,
    defaultOptions: function () { return Object.assign({}, DEFAULT_OPTIONS); },
    issueLabel: function (code) { return ISSUE_LABELS[code] || code; },
    parseDateTime: parseDateTime,
    inspect: inspect,
    transform: transform,
    mergeSamples: mergeSamples,
    applyToExisting: applyToExisting,
    run: run,
    undo: undo,
    canUndo: canUndo,
    history: function () { return MH.store.imports.all(); },
    clearHistory: function () { return MH.store.imports.clear(); }
  };
})(window.MH = window.MH || {});
