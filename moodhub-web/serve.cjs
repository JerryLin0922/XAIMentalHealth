/* 本地预览用静态服务：node serve.cjs  →  http://localhost:5173
   仅为方便本地打开（localStorage 在 http:// 下的行为与线上一致），不属于应用运行时。

   - 端口占用时自动往后顺延（最多试 12 个），避免和正在跑的 vite dev server 撞车
   - 开发期统一 no-cache，改完刷新即生效
   - 同时打印局域网地址，方便手机 / 平板用同一个 WiFi 真机调试 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const START_PORT = Number(process.env.PORT) || 5173;
const MAX_TRY = 12;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

function lanUrls(port) {
  const out = [];
  const nets = os.networkInterfaces() || {};
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (n && n.family === 'IPv4' && !n.internal) out.push('http://' + n.address + ':' + port);
    });
  });
  return out;
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '' || rel.endsWith('/')) rel += 'index.html';
  const fp = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
});

let tries = 0;
function listen(port) {
  server.once('error', function (e) {
    if (e.code === 'EADDRINUSE' && tries < MAX_TRY) {
      tries++;
      listen(port + 1);
    } else {
      console.error('启动失败：' + e.message);
      process.exit(1);
    }
  });
  server.listen(port, function () {
    console.log('');
    console.log('  MoodHub Web → http://localhost:' + port);
    lanUrls(port).forEach(function (u) { console.log('  局域网      → ' + u); });
    console.log('');
    console.log('  Ctrl+C 停止');
    console.log('');
  });
}
listen(START_PORT);
