/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../_ns.js');
/* ------------------------------------------------------------------
   数据摄入：把用户上传的文件读取为统一的「数据源」。
   支持 CSV / TSV（逗号、制表符、分号）、JSON、以及任意纯文本（md / log / txt）。
   全程 FileReader 本地读取，不做任何网络传输。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var MAX_FILE_BYTES = 2 * 1024 * 1024;   // 单个文件 2 MB
  var MAX_TEXT_CHARS = 200000;            // 单来源文本上限
  var MAX_TEXT_ROWS = 3000;               // 参与检索的表格行数上限

  /** 指标识别规则：顺序即优先级（HRV 必须排在心率之前）。 */
  var METRIC_RULES = [
    { key: 'heartRate', re: /静息心率|resting[\s_-]*heart|rhr/i, unit: 'bpm' },
    { key: 'hrv', re: /hrv|心率变异性|heart[\s_-]*rate[\s_-]*var(?:iability)?/i, unit: 'ms' },
    { key: 'heartRate', re: /心率(?!变异性)|heart[\s_-]*rate(?![\s_-]*var)|bpm/i, unit: 'bpm' },
    { key: 'sleep', re: /睡眠|sleep|asleep/i, unit: 'h' },
    { key: 'stress', re: /压力|stress/i, unit: 'score' },
    { key: 'mood', re: /心情|情绪|mood/i, unit: 'score' },
    { key: 'steps', re: /步数|steps/i, unit: '步' },
    { key: 'spo2', re: /血氧|spo2|oxygen/i, unit: '%' },
    { key: 'exercise', re: /运动|锻炼|exercise|active[\s_-]*min/i, unit: 'min' }
  ];

  var DATE_RE = /时间|日期|timestamp|time|date|datetime|^day$/i;

  function stripBOM(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }

  function detectDelimiter(headerLine) {
    if (headerLine.indexOf('\t') >= 0) return '\t';
    if (headerLine.indexOf(';') >= 0) return ';';
    return ',';
  }

  /** 支持引号包裹与转义双引号的通用分隔符解析。 */
  function parseDelimited(text, delim) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
        row = [];
      } else if (c !== '\r') {
        field += c;
      }
    }
    row.push(field);
    if (row.some(function (v) { return String(v).trim() !== ''; })) rows.push(row);
    return rows;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toNumber(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var v = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return isFinite(v) ? v : null;
  }

  /** 纯数字文本（含可选百分号），用于区分数值列与日期列。 */
  function isNumericText(raw) {
    return /^[-+]?\d+(?:\.\d+)?%?$/.test(String(raw == null ? '' : raw).trim());
  }

  /**
   * 日期判定必须严格：不能直接 `new Date(s)`，否则 '7.5' / '4' 这类数值
   * 会被兜底解析成合法日期，导致数值列被误判成日期列。
   */
  function isDateText(raw) {
    var t = String(raw == null ? '' : raw).trim();
    if (!t) return false;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(t)) return true;
    if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(t)) return true;
    if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(t)) return true;
    if (/^\d{1,2}月\d{1,2}日/.test(t)) return true;
    // 只有带分隔符且长度足够的字符串才交给 Date 兜底
    if (t.length >= 8 && /[-/.]/.test(t) && !isNaN(new Date(t).getTime())) return true;
    return false;
  }

  function normalizeDate(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!isDateText(s)) return null;
    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return m[3] + '-' + pad(+m[1]) + '-' + pad(+m[2]);
    m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : U.toISODate(d);
  }

  function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function detectKind(name, text) {
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'tsv') return ext;
    if (ext === 'json' || ext === 'jsonl') return 'json';
    var head = text.trim().slice(0, 200);
    if ((head.charAt(0) === '{' || head.charAt(0) === '[') && /"\w+"\s*:/.test(head)) return 'json';
    if (/^[^\n]*[,;\t][^\n]*\n/.test(head) && /["\w][,;\t]/.test(head)) return 'csv';
    return 'text';
  }

  function buildFields(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) {
        if (!seen[k]) { seen[k] = true; out.push(k); }
      });
    });
    return out.slice(0, 40).map(function (k) {
      var numeric = 0, dates = 0, n = 0;
      for (var i = 0; i < rows.length && n < 200; i++) {
        var v = rows[i][k];
        if (v == null || String(v).trim() === '') continue;
        n++;
        if (isDateText(v)) dates++;
        else if (isNumericText(v)) numeric++;
      }
      var type = n === 0 ? 'empty' : (dates / n > 0.6 ? 'date' : (numeric / n > 0.6 ? 'number' : 'text'));
      var metric = null;
      for (var j = 0; j < METRIC_RULES.length; j++) {
        if (METRIC_RULES[j].re.test(k)) { metric = METRIC_RULES[j].key; break; }
      }
      return { name: k, type: type, metric: metric, filled: n };
    });
  }

  /** 表格 → 可检索文本：每行压成一行 "字段=值"。 */
  function rowsToText(name, fields, rows) {
    var lines = ['来源：' + name, '字段：' + fields.map(function (f) { return f.name; }).join(' / ')];
    var limit = Math.min(rows.length, MAX_TEXT_ROWS);
    for (var i = 0; i < limit; i++) {
      var parts = [];
      for (var j = 0; j < fields.length; j++) {
        var v = rows[i][fields[j].name];
        if (v == null || String(v).trim() === '') continue;
        parts.push(fields[j].name + '=' + String(v).replace(/\s+/g, ' ').slice(0, 60));
      }
      if (parts.length) lines.push(parts.join(' | '));
    }
    if (rows.length > limit) lines.push('（其余 ' + (rows.length - limit) + ' 行已省略，统计仍基于全部 ' + rows.length + ' 行）');
    return lines.join('\n').slice(0, MAX_TEXT_CHARS);
  }

  function parseCSV(name, text) {
    var clean = stripBOM(text.trim());
    var delim = detectDelimiter(clean.split('\n')[0] || '');
    var table = parseDelimited(clean, delim);
    if (table.length < 1) throw new Error('文件为空');

    var headers = table[0].map(function (h, i) { return (String(h).trim() || ('列' + (i + 1))); });
    var rows = [];
    for (var r = 1; r < table.length; r++) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) obj[headers[c]] = table[r][c];
      rows.push(obj);
    }
    if (!rows.length) throw new Error('只有表头，没有数据行');

    var fields = buildFields(rows);
    return {
      rows: rows,
      fields: fields,
      text: rowsToText(name, fields, rows),
      stats: { rowCount: rows.length, kind: 'table' }
    };
  }

  function parseJSON(name, text) {
    var data;
    try { data = JSON.parse(stripBOM(text)); }
    catch (e) { throw new Error('JSON 解析失败：' + e.message); }

    var rows = null;
    if (Array.isArray(data)) rows = data.filter(isPlainObject);
    else if (isPlainObject(data)) {
      // MoodHub 备份格式：{ records: [...] }
      if (Array.isArray(data.records)) rows = data.records.filter(isPlainObject);
      else {
        Object.keys(data).some(function (k) {
          if (Array.isArray(data[k]) && data[k].some(isPlainObject)) { rows = data[k].filter(isPlainObject); return true; }
          return false;
        });
      }
    }
    if (!rows || !rows.length) {
      // 非表格 JSON：退化成纯文本，但保留缩进结构
      return { rows: null, fields: null, text: JSON.stringify(data, null, 1).slice(0, MAX_TEXT_CHARS), stats: { rowCount: 0, kind: 'json' } };
    }

    var fields = buildFields(rows);
    return {
      rows: rows,
      fields: fields,
      text: rowsToText(name, fields, rows),
      stats: { rowCount: rows.length, kind: 'table' }
    };
  }

  function parsePlain(name, text) {
    return { rows: null, fields: null, text: stripBOM(text).slice(0, MAX_TEXT_CHARS), stats: { rowCount: 0, kind: 'text' } };
  }

  /**
   * 解析文本为数据源草稿。
   * @returns {{name, kind, size, text, rows, fields, stats}}
   */
  function parse(name, text) {
    var kind = detectKind(name, text);
    if (kind === 'csv' || kind === 'tsv') {
      try { return Object.assign({ kind: 'csv' }, parseCSV(name, text)); }
      catch (e) { return Object.assign({ kind: 'text' }, parsePlain(name, text)); }
    }
    if (kind === 'json') {
      try { return Object.assign({ kind: 'json' }, parseJSON(name, text)); }
      catch (e) { throw e; }
    }
    return Object.assign({ kind: 'text' }, parsePlain(name, text));
  }

  /** 浏览器 File → 数据源草稿（Promise）。 */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('没有选择文件')); return; }
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error('文件 ' + file.name + ' 超过 ' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB，请先精简后再上传'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      reader.onload = function () {
        try {
          var draft = parse(file.name, String(reader.result || ''));
          draft.name = file.name;
          draft.size = file.size;
          resolve(draft);
        } catch (e) { reject(e); }
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 直接粘贴的文本 → 数据源草稿。 */
  function fromText(text, label) {
    var name = label || ('粘贴文本 ' + U.fmtTime(Date.now()));
    var draft = parse(name + '.txt', text);
    draft.name = name;
    draft.size = text.length;
    return draft;
  }

  /**
   * 尝试把表格型来源转成应用记录（需要能认出日期列与四项指标列）。
   * @returns {{records: Array, matched: Object, skipped: number}}
   */
  function toRecords(source) {
    if (!source || !source.rows || !source.rows.length) return { records: [], matched: {}, skipped: 0 };
    var fields = source.fields || buildFields(source.rows);

    var dateField = null;
    fields.forEach(function (f) { if (!dateField && (f.type === 'date' || DATE_RE.test(f.name))) dateField = f.name; });

    var mapping = {};
    fields.forEach(function (f) {
      if (!f.metric || mapping[f.metric]) return;
      if (f.metric === 'mood' || f.metric === 'sleep' || f.metric === 'heartRate' || f.metric === 'stress') {
        mapping[f.metric] = f.name;
      }
    });

    var out = [], skipped = 0;
    source.rows.forEach(function (r) {
      var date = dateField ? normalizeDate(r[dateField]) : null;
      var rec = { date: date || U.todayISO(), time: '', note: '' };
      var hit = 0;
      Object.keys(mapping).forEach(function (k) {
        var v = toNumber(r[mapping[k]]);
        if (v == null) return;
        if (k === 'sleep' && v > 24) v = v / 60;      // 分钟 → 小时
        rec[k] = v;
        hit++;
      });
      if (!hit) { skipped++; return; }
      out.push(rec);
    });

    return { records: out, matched: mapping, skipped: skipped, dateField: dateField };
  }

  MH.ingest = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_TEXT_CHARS: MAX_TEXT_CHARS,
    parse: parse,
    readFile: readFile,
    fromText: fromText,
    toRecords: toRecords,
    detectKind: detectKind,
    normalizeDate: normalizeDate,
    toNumber: toNumber,
    // 下面几个原子能力被「第三方健康数据导入」复用，避免分隔符解析出现两套实现
    parseDelimited: parseDelimited,
    detectDelimiter: detectDelimiter,
    stripBOM: stripBOM,
    isDateText: isDateText,
    buildFields: buildFields
  };
})(MH);

