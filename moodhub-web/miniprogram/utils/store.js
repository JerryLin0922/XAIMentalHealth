/**
 * 兼容层：保留旧的 store API（all / add / update / remove / exportAll / importAll），
 * 底层全部转发到 Web 端内核 `MH.store.records`。
 *
 * 这样做的收益：
 *   · 数据结构与 Web / APK / EXE 完全一致（moodhub.v1.*）
 *   · 备份、云同步、导入导出三端互通
 *   · 旧的 utils/vault.js 不需要任何改动
 */
'use strict';

const MH = require('./mh.js');

module.exports = {
  all() { return MH.store.records.all(); },
  add(rec) { return MH.store.records.add(rec); },
  update(id, patch) { return MH.store.records.update(id, patch); },
  remove(id) { return MH.store.records.remove(id); },
  get(id) { return MH.store.records.get(id); },
  count() { return MH.store.records.count(); },
  clear() { return MH.store.records.clear(); },
  exportAll() { return MH.store.exportAll(); },
  importAll(payload, mode) { return MH.store.importAll(payload, mode); }
};
