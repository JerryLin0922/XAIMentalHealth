/**
 * MoodHub 图标生成器（纯 Node，零第三方依赖）
 *
 *   node tools/make-icons.mjs
 *
 * 产出：
 *   desktop/build/icon.ico   Windows 可执行文件图标（16/32/48/64/128/256，PNG 内嵌）
 *   desktop/build/icon.png   512×512，供 Linux / macOS 与安装包使用
 *   desktop/build/icon.svg   矢量源（与 index.html 内联 favicon 同一图形）
 *
 * 图形取自 index.html 里的内联 favicon：圆角方块品牌底 + 一道白色波形。
 * 这里直接做贝塞尔采样 + 圆形笔触栅格化，避免引入任何图像库。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'desktop', 'build');

const BRAND = [0x2f, 0x6f, 0x62];
const STROKE = [0xff, 0xff, 0xff];

/* ---------- CRC32 / PNG ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素缓冲 -> PNG 字节流。 */
function encodePNG(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 图形栅格化 ---------- */

/** 三次贝塞尔采样。 */
function cubic(p0, c1, c2, p1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]
    ]);
  }
  return pts;
}

/** 与 index.html favicon 完全一致的路径（32×32 坐标系）。 */
function wavePoints() {
  const p0 = [7, 19], p1 = [13.4, 13], p2 = [19.8, 19], p3 = [24.6, 14.4];
  return [
    ...cubic(p0, [10.2, 19], [10.2, 13], p1, 240),
    ...cubic(p1, [16.6, 13], [16.6, 19], p2, 240),
    ...cubic(p2, [23.0, 19], [23.4, 15.6], p3, 240)
  ];
}

function roundedRectAlpha(x, y, size, radius) {
  // 圆角矩形内部判定（含抗锯齿边缘 1px 过渡）
  const cx = Math.max(radius, Math.min(size - radius, x));
  const cy = Math.max(radius, Math.min(size - radius, y));
  const dx = x - cx, dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, Math.min(1, radius - d + 0.5));
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 32;
  const radius = 8 * scale;
  const pts = wavePoints().map(([x, y]) => [x * scale, y * scale]);
  const penRadius = (2.2 / 2) * scale;
  const brush = Math.max(1, Math.round(penRadius));

  // 背景：品牌色圆角方块
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectAlpha(x + 0.5, y + 0.5, size, radius);
      const i = (y * size + x) * 4;
      rgba[i] = BRAND[0]; rgba[i + 1] = BRAND[1]; rgba[i + 2] = BRAND[2];
      rgba[i + 3] = Math.round(a * 255);
    }
  }

  // 前景：白色波形（沿路径盖圆章）
  for (const [px, py] of pts) {
    const x0 = Math.max(0, Math.floor(px - brush)), x1 = Math.min(size - 1, Math.ceil(px + brush));
    const y0 = Math.max(0, Math.floor(py - brush)), y1 = Math.min(size - 1, Math.ceil(py + brush));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d > penRadius) continue;
        const i = (y * size + x) * 4;
        const cov = Math.min(1, penRadius - d + 0.5);
        const a = rgba[i + 3] / 255;
        if (a < 0.5) continue;                     // 落在圆角外，不画
        const k = cov;
        rgba[i] = Math.round(STROKE[0] * k + rgba[i] * (1 - k));
        rgba[i + 1] = Math.round(STROKE[1] * k + rgba[i + 1] * (1 - k));
        rgba[i + 2] = Math.round(STROKE[2] * k + rgba[i + 2] * (1 - k));
        rgba[i + 3] = 255;
      }
    }
  }
  return rgba;
}

/** 多尺寸 PNG -> ICO。 */
function buildICO(sizes) {
  const images = sizes.map((s) => ({ size: s, data: encodePNG(render(s), s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="512" height="512">',
  '<rect width="32" height="32" rx="8" fill="#2f6f62"/>',
  '<path d="M7 19c3.2 0 3.2-6 6.4-6s3.2 6 6.4 6 3.6-3.4 4.8-4.6" stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  '</svg>', ''
].join('\n');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildICO([16, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePNG(render(512), 512));
fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), SVG);
console.log(`[icons] 已生成 desktop/build/icon.ico / icon.png / icon.svg`);
