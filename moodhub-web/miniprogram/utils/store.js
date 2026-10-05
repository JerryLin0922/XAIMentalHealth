// 小程序本地存储：记录 / 偏好 保存在 wx.storage（本机）
const KEY = 'moodhub.data';

function load() {
  return wx.getStorageSync(KEY) || { records: [], prefs: { theme: 'light' } };
}
function save(d) { wx.setStorageSync(KEY, d); }

function uid() { return 'r_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

const store = {
  all() { return load().records; },
  add(rec) {
    const d = load();
    const item = Object.assign({ id: uid(), createdAt: Date.now(), updatedAt: Date.now() }, rec);
    d.records.push(item);
    save(d);
    return item;
  },
  update(id, patch) {
    const d = load();
    let hit = null;
    d.records = d.records.map((r) => { if (r.id === id) { hit = Object.assign({}, r, patch, { updatedAt: Date.now() }); return hit; } return r; });
    save(d);
    return hit;
  },
  remove(id) { const d = load(); d.records = d.records.filter((r) => r.id !== id); save(d); },
  count() { return load().records.length; },
  // 供加密同步使用的整体快照
  exportAll() { return load(); },
  importAll(payload) {
    const d = load();
    if (payload && Array.isArray(payload.records)) d.records = payload.records;
    save(d);
    return d.records.length;
  }
};

module.exports = store;
