/* 该文件由 tools/sync-web-assets.cjs 从 Web 端自动生成，请勿手工编辑。 */
var MH = require('./../../_ns.js');
/* ------------------------------------------------------------------
   极简 ZIP 容器 + XLSX 表格读取。

   为什么自己写：项目保持「零依赖、零构建、断网可用」，但
   Health Connect / Garmin Connect 的导出是 ZIP，很多厂商的表格是 XLSX——
   两者都是 ZIP + XML，共用同一套容器解压代码最经济。

   DEFLATE 解压有两条路：优先用浏览器原生 DecompressionStream，
   不可用时回落到本文件内的纯 JS inflate（RFC 1951）。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var SIG_LOCAL = 0x04034b50;
  var SIG_CENTRAL = 0x02014b50;
  var SIG_EOCD = 0x06054b50;

  /* ============================ 字节读取 ============================ */

  function u16(b, p) { return b[p] | (b[p + 1] << 8); }

  function u32(b, p) {
    return ((b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0);
  }

  function decodeUTF8(bytes) {
    if (typeof TextDecoder === 'function') {
      try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); } catch (e) { /* 继续回落 */ }
    }
    var out = '', i = 0, c;
    while (i < bytes.length) {
      c = bytes[i++];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
      else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      else {
        var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  function entryName(b, p, n, flags) {
    if (flags & 0x800) {
      try { return decodeUTF8(b.subarray(p, p + n)); } catch (e) { /* 继续回落 */ }
    }
    var out = '';
    for (var i = 0; i < n; i++) out += String.fromCharCode(b[p + i]);
    return out;
  }

  /* ============================ 中央目录 ============================ */

  function findEOCD(b) {
    var limit = Math.max(0, b.length - 22 - 65535);
    for (var i = b.length - 22; i >= limit; i--) {
      if (u32(b, i) === SIG_EOCD) return i;
    }
    return -1;
  }

  /** 有条件的旧 / 流式 ZIP 没有完整中央目录，退化为顺序扫描本地头。 */
  function scanLocal(b) {
    var out = [], p = 0;
    while (p + 30 <= b.length && u32(b, p) === SIG_LOCAL) {
      var flags = u16(b, p + 6);
      var method = u16(b, p + 8);
      var csize = u32(b, p + 18);
      var usize = u32(b, p + 22);
      var nlen = u16(b, p + 26);
      var elen = u16(b, p + 28);
      var start = p + 30 + nlen + elen;
      if (!csize) break;      // 带数据描述符的分段压缩包，放弃扫描
      if (start + csize > b.length) break;
      out.push({
        name: entryName(b, p + 30, nlen, flags),
        method: method,
        csize: csize,
        usize: usize,
        encrypted: !!(flags & 0x1),
        dataOffset: start
      });
      p = start + csize;
    }
    return out;
  }

  /** @returns {Array<{name, method, csize, usize, encrypted, dataOffset}>} */
  function listEntries(b) {
    var view = b instanceof Uint8Array ? b : new Uint8Array(b);
    var eocd = findEOCD(view);
    if (eocd < 0) return scanLocal(view);

    var count = u16(view, eocd + 10);
    var p = u32(view, eocd + 16);
    var out = [];
    for (var i = 0; i < count; i++) {
      if (p + 46 > view.length || u32(view, p) !== SIG_CENTRAL) break;
      var flags = u16(view, p + 8);
      var method = u16(view, p + 10);
      var csize = u32(view, p + 20);
      var usize = u32(view, p + 24);
      var nlen = u16(view, p + 28);
      var elen = u16(view, p + 30);
      var clen = u16(view, p + 32);
      var lhOff = u32(view, p + 42);
      var name = entryName(view, p + 46, nlen, flags);
      p += 46 + nlen + elen + clen;

      // 本地头的 extra 长度可能与中央目录不同，实际数据起点必须到本地头里再读一次
      var dataOff = 0;
      if (lhOff + 30 <= view.length && u32(view, lhOff) === SIG_LOCAL) {
        dataOff = lhOff + 30 + u16(view, lhOff + 26) + u16(view, lhOff + 28);
      }
      out.push({
        name: name,
        method: method,
        csize: csize,
        usize: usize,
        encrypted: !!(flags & 0x1),
        dataOffset: dataOff
      });
    }
    return out.length ? out : scanLocal(view);
  }

  function sliceEntry(view, entry) {
    var start = entry.dataOffset;
    var end = start + (entry.csize || 0);
    if (end > view.length) end = view.length;
    return view.subarray(start, end);
  }

  /* ============================ DEFLATE ============================ */

  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  var fixedLit = null, fixedDist = null;

  function buildTree(lengths, n) {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var offs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var i;
    for (i = 0; i < n; i++) counts[lengths[i] || 0]++;
    counts[0] = 0;
    for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    var symbols = new Array(n);
    for (i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts: counts, symbols: symbols };
  }

  function fixedTrees() {
    if (fixedLit) return;
    var lengths = [], i;
    for (i = 0; i < 144; i++) lengths[i] = 8;
    for (; i < 256; i++) lengths[i] = 9;
    for (; i < 280; i++) lengths[i] = 7;
    for (; i < 288; i++) lengths[i] = 8;
    fixedLit = buildTree(lengths, 288);
    lengths = [];
    for (i = 0; i < 30; i++) lengths[i] = 5;
    fixedDist = buildTree(lengths, 30);
  }

  /**
   * 纯 JS 的 raw DEFLATE 解压（无 zlib 头）。
   * @param {Uint8Array} src 压缩数据
   * @param {number} [expected] 预期输出长度（用于预分配）
   * @returns {Uint8Array}
   */
  function inflateRaw(src, expected) {
    var cap = Math.max(64, Math.min(64 * 1024 * 1024, expected || src.length * 4));
    var out = new Uint8Array(cap);
    var op = 0, pos = 0, bitBuf = 0, bitCnt = 0;
    fixedTrees();

    function ensure(n) {
      if (op + n <= out.length) return;
      var size = out.length;
      while (size < op + n) size *= 2;
      var next = new Uint8Array(size);
      next.set(out.subarray(0, op));
      out = next;
    }

    function putByte(v) { ensure(1); out[op++] = v; }

    function bits(need) {
      while (bitCnt < need) {
        if (pos >= src.length) throw new Error('压缩数据意外结束，文件可能不完整');
        bitBuf |= src[pos++] << bitCnt;
        bitCnt += 8;
      }
      var v = bitBuf & ((1 << need) - 1);
      bitBuf >>>= need;
      bitCnt -= need;
      return v;
    }

    function decode(tree) {
      var code = 0, first = 0, index = 0, len, count;
      for (len = 1; len <= 15; len++) {
        code |= bits(1);
        count = tree.counts[len];
        if (code - first < count) return tree.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('压缩数据损坏（Huffman 解码失败）');
    }

    var last = 0;
    while (!last) {
      last = bits(1);
      var type = bits(2);

      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        if (pos + 4 > src.length) throw new Error('压缩数据意外结束（stored 块）');
        var len = src[pos] | (src[pos + 1] << 8);
        var nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('压缩数据损坏（未压缩块长度校验失败）');
        ensure(len);
        for (var i = 0; i < len; i++) {
          if (pos >= src.length) throw new Error('压缩数据意外结束（未压缩块）');
          out[op++] = src[pos++];
        }
        continue;
      }

      if (type !== 1 && type !== 2) throw new Error('压缩数据损坏（无效的块类型）');

      var litTree, distTree;
      if (type === 1) {
        litTree = fixedLit;
        distTree = fixedDist;
      } else {
        var hlit = bits(5) + 257;
        var hdist = bits(5) + 1;
        var hclen = bits(4) + 4;
        var cl = [];
        for (var k = 0; k < 19; k++) cl[k] = 0;
        for (k = 0; k < hclen; k++) cl[CLORDER[k]] = bits(3);
        var clTree = buildTree(cl, 19);

        var lens = [], j = 0;
        while (j < hlit + hdist) {
          var sym = decode(clTree);
          var rep;
          if (sym < 16) { lens[j++] = sym; }
          else if (sym === 16) {
            if (j === 0) throw new Error('压缩数据损坏（重复码缺少前置值）');
            rep = 3 + bits(2);
            var prev = lens[j - 1];
            while (rep--) lens[j++] = prev;
          } else if (sym === 17) {
            rep = 3 + bits(3);
            while (rep--) lens[j++] = 0;
          } else {
            rep = 11 + bits(7);
            while (rep--) lens[j++] = 0;
          }
        }
        litTree = buildTree(lens.slice(0, hlit), hlit);
        distTree = buildTree(lens.slice(hlit), hdist);
      }

      var done = false;
      while (!done) {
        var s = decode(litTree);
        if (s < 256) putByte(s);
        else if (s === 256) done = true;
        else {
          s -= 257;
          if (s >= LBASE.length) throw new Error('压缩数据损坏（长度码越界）');
          var length = LBASE[s] + bits(LEXT[s]);
          var ds = decode(distTree);
          if (ds >= DBASE.length) throw new Error('压缩数据损坏（距离码越界）');
          var dist = DBASE[ds] + bits(DEXT[ds]);
          if (dist > op) throw new Error('压缩数据损坏（距离超出已输出内容）');
          ensure(length);
          for (var q = 0; q < length; q++) { out[op] = out[op - dist]; op++; }
        }
      }
    }

    return out.subarray(0, op);
  }

  /** 优先走原生解压，失败再回落到内置实现。 */
  function inflateEntry(slice, expected) {
    if (typeof DecompressionStream === 'function') {
      try {
        var ds = new DecompressionStream('deflate-raw');
        if (typeof Blob === 'function' && typeof Response === 'function') {
          return new Response(new Blob([slice]).stream().pipeThrough(ds)).arrayBuffer()
            .then(function (buf) { return new Uint8Array(buf); })
            .catch(function () { return inflateRaw(slice, expected); });
        }
      } catch (e) { /* 继续回落 */ }
    }
    return Promise.resolve().then(function () { return inflateRaw(slice, expected); });
  }

  function readEntryBytes(view, entry) {
    var slice = sliceEntry(view, entry);
    if (entry.encrypted) {
      return Promise.reject(new Error('压缩包里的「' + entry.name + '」被加密了，请用没有密码的版本再试'));
    }
    if (entry.method === 0) return Promise.resolve(slice);
    if (entry.method !== 8) {
      return Promise.reject(new Error('不支持的压缩方式（' + entry.method + '）：' + entry.name));
    }
    return inflateEntry(slice, entry.usize || 0);
  }

  /* ============================ XML 小工具 ============================ */

  function decodeEntities(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&amp;/g, '&');
  }

  function attrList(tagAttr) {
    var out = {}, re = /([\w:.-]+)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(tagAttr))) out[m[1]] = decodeEntities(m[2]);
    return out;
  }

  function tagText(xml, tag) {
    var re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
    var m = xml.match(re);
    return m ? decodeEntities(m[1]) : '';
  }

  function allTagsText(body) {
    // <t>内容</t>，跳过拼音注音 <rPh>…</rPh>
    var clean = String(body || '').replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    var out = '', re = /<t\b[^>]*>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(clean))) out += decodeEntities(m[1]);
    return out;
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(String(ref || ''));
    if (!m) return -1;
    var letters = m[1], n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /* ============================ XLSX ============================ */

  var DATE_NUMFMT = {};
  [14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57].forEach(function (id) { DATE_NUMFMT[id] = true; });

  function readDateStyles(view) {
    // cellXfs 里按顺序排列的 <xf numFmtId="…">，下标即单元格的 s=
    var styles = [];
    return readByName(view, ['xl/styles.xml']).then(function (bytes) {
      if (!bytes) return styles;
      var xml = decodeUTF8(bytes);
      var xfs = /<cellXfs\b[\s\S]*?>([\s\S]*?)<\/cellXfs>/.exec(xml);
      var body = xfs ? xfs[1] : '';
      var re = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g, m;
      while ((m = re.exec(body))) {
        var attrs = attrList(m[1]);
        styles.push(!!DATE_NUMFMT[Number(attrs.numFmtId)]);
      }
      return styles;
    });
  }

  function readByName(view, names) {
    var entries = listEntries(view);
    var lower = names.map(function (n) { return n.toLowerCase(); });
    for (var i = 0; i < entries.length; i++) {
      var idx = lower.indexOf(entries[i].name.toLowerCase());
      if (idx >= 0) {
        return readEntryBytes(view, entries[i]).then(function (bytes) { return bytes; }, function () { return null; });
      }
    }
    return Promise.resolve(null);
  }

  function serialToDateTime(serial) {
    // Excel 的 1900 日期系统（含 1900-02-29 的历史遗留 bug）
    var days = Math.floor(serial);
    var ms = Math.round((serial - days) * 86400000);
    var base = Date.UTC(1899, 11, 30) + days * 86400000 + ms;
    var d = new Date(base);
    if (isNaN(d.getTime())) return null;
    var iso = d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate());
    var hh = d.getUTCHours(), mi = d.getUTCMinutes();
    // 恰好零点时不带尾巴上 '00:00'，避免纯日期列看起来像日期时间列
    var time = (hh || mi) ? U.pad2(hh) + ':' + U.pad2(mi) : '';
    return { date: iso, time: time };
  }

  /** 按 <row> 切分工作表内容：自闭合的 <row/> 视为空行。 */
  function iterRows(xml) {
    var rows = [];
    var re = /<row\b([^>]*)>/g;
    var m;
    while ((m = re.exec(xml))) {
      if (/\/\s*$/.test(m[1])) { rows.push(''); continue; }
      var bodyStart = m.index + m[0].length;
      var end = xml.indexOf('</row>', bodyStart);
      var nextRow = xml.indexOf('<row', bodyStart);
      if (end < 0 || (nextRow >= 0 && nextRow < end)) end = nextRow;
      if (end < 0) { rows.push(xml.slice(bodyStart)); re.lastIndex = xml.length; }
      else { rows.push(xml.slice(bodyStart, end)); re.lastIndex = end; }
    }
    return rows;
  }

  function parseSheetXML(xml, shared, styles) {
    var bodies = iterRows(xml);
    var rows = [];

    for (var b = 0; b < bodies.length; b++) {
      var body = bodies[b];
      var cells = [];
      var maxCol = -1;
      var cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      var cm;
      while ((cm = cellRe.exec(body))) {
        var attrs = attrList(cm[1]);
        var col = colIndex(attrs.r);
        if (col < 0) col = cells.length;
        var inner = cm[3] || '';
        var type = attrs.t || 'n';
        var value = '';
        if (type === 's') {
          value = shared[Number(tagText(inner, 'v'))] || '';
        } else if (type === 'inlineStr') {
          value = allTagsText(inner);
        } else if (type === 'str' || type === 'e') {
          value = tagText(inner, 'v');
        } else if (type === 'b') {
          value = tagText(inner, 'v') === '1' ? 'true' : 'false';
        } else {
          var v = tagText(inner, 'v').replace(/^\s+|\s+$/g, '');
          if (v !== '' && isFinite(Number(v)) && styles[Number(attrs.s) || 0]) {
            var dt = serialToDateTime(Number(v));
            value = dt ? (dt.date + (dt.time ? ' ' + dt.time : '')) : v;
          } else {
            value = v;
          }
        }
        cells[col] = value;
        if (col > maxCol) maxCol = col;
      }
      var row = [];
      for (var i = 0; i <= maxCol; i++) row.push(cells[i] == null ? '' : cells[i]);
      if (row.length) rows.push(row);
    }
    return rows;
  }

  function sheetOrder(view, workbookXML, relsXML) {
    var sheets = [];
    var rels = {};
    var rm, re = /<Relationship\b([^>]*?)\/>/g;
    while ((rm = re.exec(relsXML || ''))) {
      var ra = attrList(rm[1]);
      var target = String(ra.Target || '').replace(/^\/?xl\//, '').replace(/^\//, '');
      rels[ra.Id] = 'xl/' + target;
    }
    var sm, sre = /<sheet\b([^>]*?)\/>/g;
    while ((sm = sre.exec(workbookXML || ''))) {
      var sa = attrList(sm[1]);
      sheets.push({ name: sa.name || 'Sheet', path: rels[sa['r:id']] || '' });
    }
    if (!sheets.length) return [];
    // 没有 rels 时按 sheetId 顺序猜一张名为 worksheets/sheetN.xml 的表
    return sheets.map(function (s, i) {
      return { name: s.name, path: s.path || ('xl/worksheets/sheet' + (i + 1) + '.xml') };
    });
  }

  /**
   * @returns {Promise<{sheets: Array<{name: string, rows: Array<Array<string>>}>}>}
   */
  function readWorkbook(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var entries = listEntries(view);

    function find(name) {
      var low = name.toLowerCase();
      for (var i = 0; i < entries.length; i++) if (entries[i].name.toLowerCase() === low) return entries[i];
      return null;
    }

    var shared = [];
    var styles = [];

    function loadText(entry, fallback) {
      if (!entry) return Promise.resolve(fallback || '');
      return readEntryBytes(view, entry).then(function (b) { return decodeUTF8(b); }, function () { return fallback || ''; });
    }

    var stylesPromise = readDateStyles(view);
    var sharedPromise = loadText(find('xl/sharedStrings.xml')).then(function (xml) {
      var list = [];
      var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
      while ((m = re.exec(xml))) list.push(allTagsText(m[1]));
      return list;
    });

    return Promise.all([sharedPromise, stylesPromise, loadText(find('xl/workbook.xml')), loadText(find('xl/_rels/workbook.xml.rels'))])
      .then(function (res) {
        shared = res[0];
        styles = res[1];
        var order = sheetOrder(view, res[2], res[3]);
        if (!order.length) throw new Error('这个文件里没有找到任何工作表');

        var chain = Promise.resolve([]);
        order.forEach(function (sheet) {
          chain = chain.then(function (acc) {
            var entry = find(sheet.path);
            if (!entry) return acc.concat([{ name: sheet.name, rows: [] }]);
            return loadText(entry).then(function (xml) {
              return acc.concat([{ name: sheet.name, rows: parseSheetXML(xml, shared, styles) }]);
            });
          });
        });
        return chain.then(function (sheets) {
          return { sheets: sheets.filter(function (s) { return s.rows && s.rows.length; }) };
        });
      });
  }

  /** 把压缩包里若干条目一次性读出来（ schemas各异时由调用方挑选）。 */
  function readEntriesMap(bytes, filter) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var entries = listEntries(view);
    var out = [];
    var chain = Promise.resolve();
    entries.forEach(function (e) {
      if (filter && !filter(e)) return;
      chain = chain.then(function () {
        return readEntryBytes(view, e).then(function (b) {
          out.push({ name: e.name, bytes: b });
        }, function (err) {
          out.push({ name: e.name, error: err && err.message ? err.message : String(err) });
        });
      });
    });
    return chain.then(function () { return out; });
  }

  MH.zip = {
    listEntries: listEntries,
    readEntryBytes: readEntryBytes,
    readEntriesMap: readEntriesMap,
    readWorkbook: readWorkbook,
    inflateRaw: inflateRaw,
    decodeUTF8: decodeUTF8,
    serialToDateTime: serialToDateTime
  };
})(MH);

