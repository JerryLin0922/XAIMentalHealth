// 小程序 API 客户端：封装 wx.request，手动管理会话 Cookie（小程序不会自动带 Cookie）
const app = getApp();

function getBase() { return (app && app.globalData && app.globalData.apiBase) || 'https://your-moodhub-api.workers.dev'; }
function getCookie() { return wx.getStorageSync('moodhub.cookie') || ''; }
function setCookie(header) {
  if (header && header['Set-Cookie']) wx.setStorageSync('moodhub.cookie', header['Set-Cookie']);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: getBase() + path,
      method: method,
      data: body,
      header: Object.assign({ 'Content-Type': 'application/json' }, getCookie() ? { Cookie: getCookie() } : {}),
      success(res) {
        setCookie(res.header);
        resolve({ status: res.statusCode, body: res.data || {} });
      },
      fail(e) { reject(e); }
    });
  });
}

module.exports = { request, getBase, setBase: (u) => { if (app && app.globalData) app.globalData.apiBase = u; } };
