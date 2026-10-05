/**
 * MoodHub 桌面端主进程。
 *
 * 思路：不改一行业务代码，把 moodhub-web 整个目录放进 www/，
 * 用自定义 app:// 协议把它当站点加载。相比 file:// 直开，
 * 自定义协议能拿到真正的「安全上下文」：
 *   - localStorage 持久化（MoodHub 的全部数据）
 *   - crypto.subtle 可用（口令 PBKDF2 走原生 150k 迭代）
 *   - 相对路径 fetch / iframe / history 行为与线上一致
 */
'use strict';

const { app, BrowserWindow, Menu, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const WWW_DIR = path.join(__dirname, 'www');
const HOST = 'moodhub';
const INDEX_URL = `app://${HOST}/index.html`;

/* MIME 表：只列 MoodHub 用到的类型 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/* app:// 需要声明为特权协议：standard（有 host）、secure（安全上下文）、可 fetch */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function serveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (!rel) return respondError(404, 'not found');

  const target = path.normalize(path.join(WWW_DIR, rel));
  if (!target.startsWith(WWW_DIR + path.sep) && target !== WWW_DIR) {
    return respondError(403, 'forbidden');
  }

  let body;
  try {
    body = fs.readFileSync(target);
  } catch (e) {
    // 目录式访问回退到 index.html（应用是单页壳）
    try {
      body = fs.readFileSync(path.join(WWW_DIR, 'index.html'));
    } catch (e2) {
      return respondError(404, 'not found');
    }
  }
  const ext = path.extname(target).toLowerCase();
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff'
    }
  });
}

function respondError(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function loadWindowState() {
  const file = path.join(app.getPath('userData'), 'window-state.json');
  const defaults = { width: 1200, height: 820, minWidth: 620, minHeight: 460, maximized: false };
  try {
    return Object.assign(defaults, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return defaults;
  }
}

function saveWindowState(win) {
  if (win.isMinimized()) return;
  const state = {
    width: win.getBounds().width,
    height: win.getBounds().height,
    x: win.getBounds().x,
    y: win.getBounds().y,
    maximized: win.isMaximized()
  };
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'window-state.json'), JSON.stringify(state));
  } catch (e) { /* 状态丢失无关紧要 */ }
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: state.minWidth,
    minHeight: state.minHeight,
    x: state.x,
    y: state.y,
    show: false,
    backgroundColor: '#f6f4f0',
    title: 'MoodHub',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // 任何离开应用内源的行为都拦下来，交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(INDEX_URL.replace('index.html', ''))) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(INDEX_URL);
  return win;
}

/* 单实例：双击图标时聚焦已有窗口，避免出现两个独立的 localStorage 会话 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => serveFile(new URL(request.url).pathname));

    // 不记录历史 / 不缓存到磁盘，保持与「本地优先、不外传」一致
    const ses = session.defaultSession;
    ses.clearCache();
    ses.setSpellCheckerEnabled(false);

    Menu.setApplicationMenu(null);

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
