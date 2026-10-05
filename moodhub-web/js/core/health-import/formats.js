/* ------------------------------------------------------------------
   统一格式层：把各种来源读成「一张（或几张）扁平表格」。

   对外只暴露一种中间结构 —— table：{ label, path, headers, rows }
   rows 里每项是 {表头: 原始字符串}，刻意保留原始字符串：
   单位换算、精度取舍交给后面的「映射 + 清洗」阶段，避免两次强转丢失信息。

   支持：CSV / TSV（自动分隔符）、JSON（含 Health Auto Export 结构）、
   XLSX（含日期序列号）、Apple 健康 export.xml、ZIP 容器（内含上述任一）。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var MAX_BYTES = 24 * 1024 * 1024;   // 单文件上限，够装下一份完整的一年健康数据
  var MAX_ROWS = 60000;
  var MAX_COLS = 60;
  var MAX_INNER_FILES = 24;           // ZIP 里最多解析的条目数

  var ACCEPT = '.csv,.tsv,.txt,.json,.jsonl,.xml,.xlsx,.xlsm,.zip';
  var INNER_EXTS = ['csv', 'tsv', 'txt', 'json', 'jsonl', 'xml', 'xlsx', 'xlsm'];

  function extOf(name) {
    var parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function fail(code, message, hint) {
    var e = new Error(message);
    e.code = code;
    e.hint = hint || '';
    return e;
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function cells(row) {
    var n = 0;
    for (var i = 0; i < row.length; i++) if (String(row[i] || '').trim() !== '') n++;
    return n;
  }

  function looksLikeNumber(s) {
    return /^[-+]?\d+(?:\.\d+)?%?$/.test(String(s == null ? '' : s).trim());
  }

  /** 表头不一定在第一行（厂商常在顶部塞标题），最多向下看 5 行。 */
  function pickHeaderIndex(grid) {
    var end = Math.min(grid.length, 5);
    for (var i = 0; i < end; i++) {
      if (!grid[i]) continue;
      var cols = grid[i];
      if (cells(cols) < 2) continue;
      var numeric = 0, nonEmpty = 0;
      for (var j = 0; j < cols.length; j++) {
        var v = String(cols[j] || '').trim();
        if (!v) continue;
        nonEmpty++;
        if (looksLikeNumber(v)) numeric++;
      }
      // 表头应当几乎不含纯数字单元格
      if (nonEmpty && numeric / nonEmpty < 0.3) return i;
    }
    return 0;
  }

  function gridToTable(grid, label, path, origin, totalRows) {
    var headerIdx = pickHeaderIndex(grid);
    var rawHeaders = grid[headerIdx] || [];
    var seen = {};
    var headers = [];
    for (var i = 0; i < rawHeaders.length && headers.length < MAX_COLS; i++) {
      var name = String(rawHeaders[i] == null ? '' : rawHeaders[i]).trim().replace(/\s+/g, ' ');
      if (!name) name = '列' + (i + 1);
      if (seen[name]) { seen[name]++; name = name + '(' + seen[name] + ')'; }
      else seen[name] = 1;
      headers.push(name);
    }

    var rows = [];
    var limit = Math.min(grid.length, MAX_ROWS + headerIdx + 1);
    for (var r = headerIdx + 1; r < limit; r++) {
      var line = grid[r];
      if (!line || !cells(line)) continue;
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        obj[headers[c]] = line[c] == null ? '' : String(line[c]).trim();
      }
      rows.push(obj);
    }

    return {
      label: label,
      path: path || label,
      origin: origin,
      headers: headers,
      rows: rows,
      totalRows: totalRows == null ? grid.length - headerIdx - 1 : totalRows,
      truncated: grid.length - headerIdx - 1 > MAX_ROWS
    };
  }

  /* ============================ CSV / TSV ============================ */

  function delimitedToTable(name, text, delimiter) {
    var clean = MH.ingest.stripBOM(String(text || '').replace(/\r\n?/g, '\n'));
    if (!clean.trim()) throw fail('EMPTY_DATA', '文件是空的：' + name, '导出时请勾选任意一个健康指标。');
    var firstLine = clean.split('\n')[0] || '';
    var delim = delimiter || MH.ingest.detectDelimiter(firstLine);
    var grid = MH.ingest.parseDelimited(clean, delim);
    if (grid.length < 2) throw fail('EMPTY_DATA', '「' + name + '」里没有识别出数据行', '文件至少需要表头 + 一行数据。');
    return gridToTable(grid, name, '', 'csv', grid.length - 1);
  }

  /* ============================ JSON ============================ */

  var HEALTH_AUTO_EXPORT_KEYS = ['Avg', 'Average', 'average', 'qty', 'Max', 'Min', 'value'];

  function healthAutoExport(metrics) {
    var dates = {}, order = [];
    metrics.forEach(function (metric) {
      var list = metric && metric.data;
      if (!Array.isArray(list)) return;
      var unit = metric.units || metric.unit || '';
      var col = String(metric.name || '未命名指标').trim() + (unit ? '(' + unit + ')' : '');
      list.forEach(function (point) {
        var day = String(point.date || point.startDate || point.endDate || '').slice(0, 10);
        if (!day) return;
        if (!dates[day]) { dates[day] = {}; order.push(day); }
        var value = null;
        for (var i = 0; i < HEALTH_AUTO_EXPORT_KEYS.length; i++) {
          if (point[HEALTH_AUTO_EXPORT_KEYS[i]] != null) { value = point[HEALTH_AUTO_EXPORT_KEYS[i]]; break; }
        }
        if (value == null) value = point.value;
        if (value == null) return;
        dates[day][col] = String(value);
      });
    });
    if (!order.length) return null;
    order.sort();
    var headers = ['日期'];
    order.forEach(function (d) {
      Object.keys(dates[d]).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); });
    });
    var rows = order.map(function (d) {
      var row = { 日期: d };
      headers.forEach(function (h) { if (h !== '日期') row[h] = dates[d][h] == null ? '' : String(dates[d][h]); });
      return row;
    });
    return { label: 'Health Auto Export', headers: headers, rows: rows, totalRows: rows.length, truncated: false, path: 'metrics', origin: 'json' };
  }

  function flattenRow(row) {
    var out = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (isObj(v)) {
        var keys = Object.keys(v);
        if (keys.length && keys.length <= 6) {
          keys.forEach(function (sk) {
            var sv = v[sk];
            if (sv == null || Array.isArray(sv) || isObj(sv)) return;
            out[k + '.' + sk] = String(sv);
          });
          return;
        }
        out[k] = '';
        return;
      }
      out[k] = v == null ? '' : String(v);
    });
    return out;
  }

  function rowsToFlatTable(rows, label, path) {
    var headers = [], seen = {};
    var flat = [];
    rows.filter(isObj).forEach(function (r) {
      var obj = flattenRow(r);
      flat.push(obj);
      Object.keys(obj).forEach(function (k) {
        if (!seen[k]) { seen[k] = true; headers.push(k); }
      });
    });
    if (!flat.length) return null;
    headers = headers.slice(0, MAX_COLS);
    return {
      label: label,
      path: path || label,
      origin: 'json',
      headers: headers,
      rows: flat.slice(0, MAX_ROWS),
      totalRows: flat.length,
      truncated: flat.length > MAX_ROWS
    };
  }

  function jsonToTables(name, text) {
    var data;
    try { data = JSON.parse(MH.ingest.stripBOM(String(text || ''))); }
    catch (e) {
      throw fail('PARSE_FAILED', 'JSON 解析失败：' + e.message, '确认文件没有被截断，也不是 HTML 报错页。');
    }

    if (data && data.data && Array.isArray(data.data.metrics)) {
      var hae = healthAutoExport(data.data.metrics.filter(isObj));
      if (hae) return [hae];
    }

    if (Array.isArray(data)) {
      var t = rowsToFlatTable(data, name, '');
      if (!t) throw fail('EMPTY_DATA', '「' + name + '」的 JSON 里没有可用的对象数组');
      return [t];
    }

    if (isObj(data)) {
      var keys = Object.keys(data);
      var tables = [];
      // MoodHub 自身的备份与「记录型」结构优先
      var preferred = ['records', 'data', 'items', 'values', 'points', 'samples'];
      var ordered = preferred.filter(function (k) { return Array.isArray(data[k]); });
      keys.forEach(function (k) { if (Array.isArray(data[k]) && ordered.indexOf(k) < 0) ordered.push(k); });

      ordered.forEach(function (k) {
        var sub = rowsToFlatTable(data[k].filter(isObj), name + ' · ' + k, k);
        if (sub) tables.push(sub);
      });
      if (tables.length) return tables.slice(0, MAX_INNER_FILES);

      var single = rowsToFlatTable([data], name, '');
      if (single) return [single];
    }

    throw fail('EMPTY_DATA', '「' + name + '」的 JSON 结构里找不到可导入的记录数组');
  }

  /* ============================ Apple 健康 XML ============================ */

  var HK_QUANTITY = {
    HKQuantityTypeIdentifierRestingHeartRate: 'resting',
    HKQuantityTypeIdentifierHeartRate: 'heart',
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'hrv',
    HKQuantityTypeIdentifierStepCount: 'steps',
    HKQuantityTypeIdentifierAppleExerciseTime: 'exercise',
    HKQuantityTypeIdentifierOxygenSaturation: 'spo2'
  };

  function attrList(tagAttr) {
    var out = {}, re = /([\w:.-]+)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(tagAttr))) {
      out[m[1]] = String(m[2])
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&amp;/g, '&');
    }
    return out;
  }

  function dayOf(ts, fallback) {
    var iso = MH.ingest.normalizeDate(ts);
    return iso || fallback || null;
  }

  /**
   * 把 Apple 健康的 export.xml 压平成按天汇总的一张表。
   * 睡眠按区间时长求和（默认归属到「起床日」），心率 / HRV / 血氧按天取均值，
   * 步数 / 运动时长按天求和 —— 这些都是「时间对齐」的一部分，先在这里定好口径。
   */
  function appleHealthXmlToTable(text, opts) {
    var options = opts || {};
    var sleepDayRule = options.sleepDayRule || 'wake';
    var days = {}, order = [];

    function bucket(iso) {
      if (!days[iso]) { days[iso] = { heart: [], resting: [], hrv: [], steps: 0, exercise: 0, spo2: [], sleep: 0, mindful: 0 }; order.push(iso); }
      return days[iso];
    }

    var recordRe = /<Record\b([^>]*)\/?>/g, m;
    while ((m = recordRe.exec(text))) {
      var a = attrList(m[1]);
      var type = a.type || '';
      var start = a.startDate || a.start || '';
      var end = a.endDate || a.end || '';
      var day = dayOf(sleepDayRule === 'start' ? (start || end) : (end || start));
      if (!day) continue;

      if (type.indexOf('SleepAnalysis') >= 0 || type.indexOf('Sleep') >= 0) {
        var value = a.value || '';
        if (value === 'HKCategoryValueSleepAnalysisInBed' || value === 'InBed') continue;   // 卧床 ≠ 睡着
        var t1 = Date.parse(start), t2 = Date.parse(end);
        if (isFinite(t1) && isFinite(t2) && t2 > t1) {
          bucket(day).sleep += (t2 - t1) / 3600000;
        }
        continue;
      }
      if (type.indexOf('MindfulSession') >= 0) {
        var mt1 = Date.parse(start), mt2 = Date.parse(end);
        if (isFinite(mt1) && isFinite(mt2) && mt2 > mt1) bucket(day).mindful += (mt2 - mt1) / 60000;
        continue;
      }

      var slot = HK_QUANTITY[type];
      if (!slot) continue;
      var num = Number(String(a.value == null ? '' : a.value).replace(/[^\d.\-]/g, ''));
      if (!isFinite(num)) continue;
      var b = bucket(day);
      if (slot === 'steps') b.steps += num;
      else if (slot === 'exercise') b.exercise += num;
      else b[slot].push(num);
    }

    if (!order.length) throw fail('EMPTY_DATA', '这份 export.xml 里没有可识别的健康记录', '导出时请至少勾选心率、睡眠或步数中的一项。');

    order.sort();
    function avg(arr) {
      if (!arr.length) return '';
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += arr[i];
      return String(Math.round((s / arr.length) * 100) / 100);
    }

    var headers = ['日期', '静息心率(bpm)', '平均心率(bpm)', '睡眠时长(小时)', 'HRV(ms)', '步数(步)', '运动时长(min)', '血氧(%)', '正念时长(min)'];
    var rows = order.map(function (d) {
      var b = days[d];
      return {
        '日期': d,
        '静息心率(bpm)': avg(b.resting),
        '平均心率(bpm)': avg(b.heart),
        '睡眠时长(小时)': b.sleep ? String(Math.round(b.sleep * 100) / 100) : '',
        'HRV(ms)': avg(b.hrv),
        '步数(步)': b.steps ? String(Math.round(b.steps)) : '',
        '运动时长(min)': b.exercise ? String(Math.round(b.exercise)) : '',
        '血氧(%)': avg(b.spo2),
        '正念时长(min)': b.mindful ? String(Math.round(b.mindful)) : ''
      };
    });

    return {
      label: 'Apple 健康 export.xml',
      path: 'HealthData/Record',
      origin: 'apple-xml',
      headers: headers,
      rows: rows,
      totalRows: rows.length,
      truncated: false
    };
  }

  function xmlToTables(name, text, opts) {
    var head = String(text || '').slice(0, 4000);
    if (/<HealthData|<Record\s+type=|<HealthData\b/i.test(head)) {
      return [appleHealthXmlToTable(text, opts)];
    }
    throw fail('UNSUPPORTED_XML', '暂不支持这个 XML 类型：' + name, '请改用 CSV / JSON 导出；Apple 健康请导出 export.xml。');
  }

  /* ============================ 入口 ============================ */

  function textToTables(name, text, opts) {
    var ext = extOf(name);
    var head = String(text || '').trim().slice(0, 400);
    if (ext === 'xml' || (head.charAt(0) === '<' && /<(HealthData|Record|ActivitySummary)\b/i.test(head))) {
      return xmlToTables(name, text, opts);
    }
    if (ext === 'json' || ext === 'jsonl' || head.charAt(0) === '{' || head.charAt(0) === '[') {
      return jsonToTables(name, text);
    }
    return [delimitedToTable(name, text)];
  }

  function bytesToTables(input, opts) {
    var name = input.name || '';
    var bytes = input.bytes;
    var ext = extOf(name);

    if (ext === 'xlsx' || ext === 'xlsm') {
      return MH.zip.readWorkbook(bytes).then(function (wb) {
        if (!wb.sheets.length) throw fail('EMPTY_DATA', '「' + name + '」的工作簿里没有可用的工作表');
        return {
          tables: wb.sheets.slice(0, MAX_INNER_FILES).map(function (s) {
            return gridToTable(s.rows, name + ' · ' + s.name, s.name, 'xlsx', s.rows.length);
          }),
          skipped: []
        };
      }).catch(function (e) {
        if (e && e.code) return Promise.reject(e);
        return Promise.reject(fail('XLSX_PARSE_FAILED', 'Excel 文件读取失败：' + (e && e.message ? e.message : e),
          '试试另存为「CSV UTF-8（逗号分隔）」再导入。'));
      });
    }

    if (ext === 'zip') {
      var entries = MH.zip.listEntries(bytes);
      var picked = entries.filter(function (e) {
        if (e.name.charAt(e.name.length - 1) === '/') return false;
        return INNER_EXTS.indexOf(extOf(e.name)) >= 0;
      }).slice(0, MAX_INNER_FILES);

      if (!picked.length) {
        throw fail('UNSUPPORTED_FORMAT', '压缩包里没有找到 CSV / JSON / XLSX / XML 数据文件',
          'Health Connect 与 Garmin Connect 的导出 ZIP 里通常有一份 CSV；请先解压看看里面有什么。');
      }

      // 按名字过滤：readEntriesMap 会重新扫一遍目录，不能拿对象引用做比较
      var wanted = picked.map(function (e) { return e.name; });
      return MH.zip.readEntriesMap(bytes, function (e) {
        return wanted.indexOf(e.name) >= 0;
      }).then(function (items) {
        var tables = [], skipped = [];
        items.forEach(function (item) {
          if (item.error) { skipped.push({ name: item.name, reason: item.error }); return; }
          var innerText = MH.zip.decodeUTF8(item.bytes);
          try {
            textToTables(item.name, innerText, opts).forEach(function (t) {
              t.label = name + ' / ' + t.label;
              tables.push(t);
            });
          } catch (e) {
            skipped.push({ name: item.name, reason: e && e.message ? e.message : String(e) });
          }
        });
        if (!tables.length) {
          throw fail('EMPTY_DATA', '压缩包里的文件都无法解析：' + name,
            skipped.length ? '第一个失败原因：' + skipped[0].reason : '');
        }
        return { tables: tables, skipped: skipped };
      });
    }

    var text = MH.zip.decodeUTF8(bytes);
    return Promise.resolve({ tables: textToTables(name, text, opts), skipped: [] });
  }

  /** 浏览器 File → 字节。全部走 FileReader，不产生任何网络请求。 */
  function readAsBytes(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(fail('NO_FILE', '没有选择文件')); return; }
      if (file.size > MAX_BYTES) {
        reject(fail('FILE_TOO_LARGE', '「' + file.name + '」有 ' + Math.round(file.size / 1048576) + ' MB，超过 ' + Math.round(MAX_BYTES / 1048576) + ' MB 上限',
          '可以在导出时缩短时间范围，或只勾选需要的指标。'));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(fail('READ_FAILED', '读取失败：' + file.name, '文件可能被其它程序占用。')); };
      reader.onload = function () {
        resolve({ name: file.name, size: file.size, bytes: new Uint8Array(reader.result || new ArrayBuffer(0)) });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * @param {{name:string, bytes?:Uint8Array, text?:string}} input
   * @returns {Promise<{kind:string, tables:Array, skipped:Array, warnings:Array}>}
   */
  function tables(input, opts) {
    var name = input.name || '';
    var ext = extOf(name);
    var kind = ext === 'zip' ? 'zip' : (ext === 'xlsx' || ext === 'xlsm' ? 'xlsx' : (ext === 'xml' ? 'xml' : (ext === 'json' || ext === 'jsonl' ? 'json' : 'csv')));

    return Promise.resolve().then(function () {
      if (input.bytes) return bytesToTables(input, opts);
      return Promise.resolve({ tables: textToTables(name, input.text || '', opts), skipped: [] });
    }).then(function (res) {
      var warnings = [];
      res.tables.forEach(function (t) {
        if (t.truncated) warnings.push('「' + t.label + '」超过 ' + MAX_ROWS + ' 行，只取前 ' + MAX_ROWS + ' 行');
        if (t.headers.length >= MAX_COLS) warnings.push('「' + t.label + '」列数超过 ' + MAX_COLS + '，多余列被忽略');
      });
      return { kind: kind, tables: res.tables, skipped: res.skipped || [], warnings: warnings };
    });
  }

  MH.importFormats = {
    MAX_BYTES: MAX_BYTES,
    MAX_ROWS: MAX_ROWS,
    MAX_COLS: MAX_COLS,
    ACCEPT: ACCEPT,
    isAcceptable: function (name) {
      var ext = extOf(name);
      return INNER_EXTS.indexOf(ext) >= 0 || ext === 'zip' || ext === 'xlsx' || ext === 'xlsm';
    },
    extOf: extOf,
    gridToTable: gridToTable,
    appleHealthXmlToTable: appleHealthXmlToTable,
    readAsBytes: readAsBytes,
    tables: tables
  };
})(window.MH = window.MH || {});
