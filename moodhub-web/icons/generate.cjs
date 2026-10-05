/*
 * MoodHub 图标方案生成器（零依赖，Node 运行）
 * 用法: node icons/generate.cjs
 *
 * 产出:
 *   icons/svg/<icon>-<style>.svg   14 个图标 × 5 种风格 = 70 个独立 SVG
 *   icons/index.html               交互式展示页（风格 / 配色切换、缩放演示、平台建议）
 *
 * 设计约束: 完全对齐 moodhub-web 现有品牌 —— 低饱和松绿主色 #2f6f62 + 暖纸感中性 +
 * 四项指标既有配色。无外部字体/图片，离线可用，SVG 矢量可无限缩放。
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SVG_DIR = path.join(ROOT, 'svg');
fs.mkdirSync(SVG_DIR, { recursive: true });

/* ---------- 配色（取自 css/styles.css 的现有设计令牌，保持品牌一致） ---------- */
const PAL = {
  logo:      '#2f6f62', // 品牌松绿
  mood:      '#c08540', // 心情 · 赭黄
  sleep:     '#57789c', // 睡眠 · 雾蓝
  heart:     '#b8607a', // 心率 · 玫瑰
  stress:    '#85789f', // 压力 · 灰紫
  dashboard: '#3d7a55', // 看板 · 苔绿
  records:   '#6f7d5a', // 记录 · 橄榄
  import:    '#4f8a7b', // 导入 · 青绿
  qa:        '#5a7d9a', // 问答 · 钢蓝
  companion: '#b86f8c', // 陪伴 · 藕粉
  models:    '#6b6256', // 模型 · 暖灰褐
  settings:  '#7a7066', // 设置 · 石灰
  lock:      '#5a6b62', // 安全 · 墨绿灰
  add:       '#2f6f62', // 新增 · 品牌松绿
};

/* ---------- 颜色工具 ---------- */
const hexToRgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgbToHex = (r) => '#' + r.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const mixWhite = (h, t) => rgbToHex(hexToRgb(h).map(x => x * (1 - t) + 255 * t));
const lift = (h, t) => mixWhite(h, t);           // 提亮（用于渐变第二色 / 暗色方案）
const DETAIL = '#ffffff';

/* ---------- 图标几何（24×24 视图，kind: f=可填充主体 / l=线性细节） ---------- */
const ICONS = {
  logo: { label: '品牌标识', use: '顶栏 Logo、Favicon、启动页', shapes: [
    { t: 'rect',  a: { x: 2, y: 2, width: 20, height: 20, rx: 6 }, k: 'f' },
    // 与现有 favicon 一致的「心跳线」隐喻
    { t: 'path',  a: { d: 'M5.3 14.3c2.4 0 2.4-4.5 4.8-4.5s2.4 4.5 4.8 4.5 2.7-2.6 3.6-3.5' }, k: 'l' },
  ]},
  mood: { label: '心情', use: '指标卡 / 筛选 / 备注情绪', shapes: [
    { t: 'circle', a: { cx: 12, cy: 12, r: 9 }, k: 'f' },
    { t: 'circle', a: { cx: 9, cy: 10, r: 1 }, k: 'l' },
    { t: 'circle', a: { cx: 15, cy: 10, r: 1 }, k: 'l' },
    { t: 'path',  a: { d: 'M8.5 14.5 Q12 18 15.5 14.5' }, k: 'l' },
  ]},
  sleep: { label: '睡眠', use: '指标卡 / 睡眠时长', shapes: [
    { t: 'path',  a: { d: 'M20 14.5 A8 8 0 1 1 10.6 4 A6 6 0 1 0 20 14.5 Z' }, k: 'f' },
    { t: 'path',  a: { d: 'M13.5 3 H16.5 L13.5 6 H16.5' }, k: 'l' },
    { t: 'path',  a: { d: 'M16 6 H19 L16 9 H19' }, k: 'l' },
  ]},
  heart: { label: '心率', use: '指标卡 / 心率 bpm', shapes: [
    { t: 'path',  a: { d: 'M12 20.5 C12 20.5 4 14.4 4 8.6 A4.2 4.2 0 0 1 12 5.8 A4.2 4.2 0 0 1 20 8.6 C20 14.4 12 20.5 12 20.5 Z' }, k: 'f' },
    { t: 'path',  a: { d: 'M3 12 H7.3 L9.3 7.8 L11.8 16 L14 12 H21' }, k: 'l' },
  ]},
  stress: { label: '压力', use: '指标卡 / 压力值', shapes: [
    { t: 'path',  a: { d: 'M4.5 18 A7.5 7.5 0 0 1 19.5 18 Z' }, k: 'f' },
    { t: 'path',  a: { d: 'M12 18 L16.5 9' }, k: 'l' },
    { t: 'circle', a: { cx: 12, cy: 18, r: 1.1 }, k: 'l' },
  ]},
  dashboard: { label: '看板', use: '主导航 · 仪表盘', shapes: [
    { t: 'rect', a: { x: 3, y: 3.5, width: 7.5, height: 7.5, rx: 1.8 }, k: 'f' },
    { t: 'rect', a: { x: 13.5, y: 3.5, width: 7.5, height: 7.5, rx: 1.8 }, k: 'f' },
    { t: 'rect', a: { x: 3, y: 13, width: 7.5, height: 7.5, rx: 1.8 }, k: 'f' },
    { t: 'rect', a: { x: 13.5, y: 13, width: 7.5, height: 7.5, rx: 1.8 }, k: 'f' },
  ]},
  records: { label: '记录', use: '主导航 · 列表管理', shapes: [
    { t: 'rect', a: { x: 3, y: 3, width: 18, height: 18, rx: 3 }, k: 'f' },
    { t: 'path', a: { d: 'M7 9 H17' }, k: 'l' },
    { t: 'path', a: { d: 'M7 12.5 H17' }, k: 'l' },
    { t: 'path', a: { d: 'M7 16 H14' }, k: 'l' },
  ]},
  import: { label: '导入', use: '主导航 · 第三方数据', shapes: [
    { t: 'path', a: { d: 'M3 13 H21 L19 18.5 A2 2 0 0 1 17 20 H7 A2 2 0 0 1 5 18.5 Z' }, k: 'f' },
    { t: 'path', a: { d: 'M12 3 V12.5' }, k: 'l' },
    { t: 'path', a: { d: 'M8.5 9 L12 12.5 L15.5 9' }, k: 'l' },
  ]},
  qa: { label: '问答', use: '主导航 · 智能问答', shapes: [
    { t: 'path', a: { d: 'M4 5 H20 V15 H12.5 L8 19 V15 H4 Z' }, k: 'f' },
    { t: 'path', a: { d: 'M9.8 9.4 a1.5 1.5 0 1 1 2.4 1.2 c-.6 .5 -1.2 .6 -1.2 1.4' }, k: 'l' },
    { t: 'circle', a: { cx: 11.4, cy: 13.6, r: 0.5 }, k: 'l' },
  ]},
  companion: { label: '陪伴', use: '主导航 · 树洞陪伴', shapes: [
    { t: 'path', a: { d: 'M4 5 H20 V15 H12.5 L8 19 V15 H4 Z' }, k: 'f' },
    { t: 'path', a: { d: 'M12 13.2 C12 13.2 9.2 11.3 9.2 9.7 A1.5 1.5 0 0 1 12 9.7 A1.5 1.5 0 0 1 14.8 9.7 C14.8 11.3 12 13.2 12 13.2 Z' }, k: 'l' },
  ]},
  models: { label: '模型', use: '主导航 · 模型管理', shapes: [
    { t: 'rect', a: { x: 7, y: 7, width: 10, height: 10, rx: 2 }, k: 'f' },
    { t: 'path', a: { d: 'M12 4 V7 M12 17 V20 M4 12 H7 M17 12 H20' }, k: 'l' },
    { t: 'circle', a: { cx: 12, cy: 12, r: 2.2 }, k: 'l' },
  ]},
  settings: { label: '设置', use: '主导航 · 偏好 / 外观', shapes: [
    { t: 'path', a: { d: 'M5 7 H19 M5 12 H19 M5 17 H19' }, k: 'l' },
    { t: 'circle', a: { cx: 9, cy: 7, r: 2 }, k: 'f' },
    { t: 'circle', a: { cx: 15, cy: 12, r: 2 }, k: 'f' },
    { t: 'circle', a: { cx: 8, cy: 17, r: 2 }, k: 'f' },
  ]},
  lock: { label: '安全锁', use: '登录 / 锁定 / 信任设备', shapes: [
    { t: 'path', a: { d: 'M5.5 10.5 H18.5 V18.5 A2 2 0 0 1 16.5 20.5 H7.5 A2 2 0 0 1 5.5 18.5 Z' }, k: 'f' },
    { t: 'path', a: { d: 'M8.5 10.5 V8 A3.5 3.5 0 0 1 15.5 8 V10.5' }, k: 'l' },
    { t: 'circle', a: { cx: 12, cy: 14, r: 1.4 }, k: 'l' },
    { t: 'path', a: { d: 'M12 15.2 V17.5' }, k: 'l' },
  ]},
  add: { label: '新增', use: '悬浮按钮 / 新增记录', shapes: [
    { t: 'circle', a: { cx: 12, cy: 12, r: 10 }, k: 'f' },
    { t: 'path', a: { d: 'M12 7 V17' }, k: 'l' },
    { t: 'path', a: { d: 'M7 12 H17' }, k: 'l' },
  ]},
};

/* ---------- 风格元信息 ---------- */
const STYLES = [
  { id: 'line',     name: '极简线条', desc: '纯描边、无填充，最轻量，适合顶栏与高密度列表。' },
  { id: 'flat',     name: '扁平化',   desc: '主体填色 + 白色细节线，双色扁平，最通用。' },
  { id: 'gradient', name: '渐变',     desc: '主体渐变填充，现代有层次，适合营销与启动页。' },
  { id: 'skeuo',    name: '拟物',     desc: '渐变 + 投影 + 高光，立体质感，适合卡片主视觉。' },
  { id: 'hand',     name: '手绘',     desc: '抖动手绘描边（SVG 噪声滤镜），温暖亲和，适合陪伴场景。' },
];

/* ---------- 工具：序列化属性 ---------- */
const attrStr = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
const childOf = (s) => {
  const cls = s.k === 'f' ? 's-f' : 's-l';
  if (s.t === 'path') return `<path class="${cls}" ${attrStr(s.a)}/>`;
  if (s.t === 'rect') return `<rect class="${cls}" ${attrStr(s.a)}/>`;
  if (s.t === 'circle') return `<circle class="${cls}" ${attrStr(s.a)}/>`;
  return '';
};

/* ---------- 1) 独立 SVG 文件 ---------- */
function standalone(icon, style) {
  const base = PAL[icon];
  const a2 = lift(base, 0.28);
  let defs = '';
  const needGrad = (style === 'gradient' || style === 'skeuo');
  if (needGrad) defs += `<linearGradient id="g-${icon}-${style}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${a2}"/></linearGradient>`;
  if (style === 'skeuo') defs += `<filter id="f-${icon}-sk" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.25"/></filter>`;
  if (style === 'hand') defs += `<filter id="f-${icon}-hd" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.5"/></filter>`;

  const shaped = ICONS[icon].shapes.map((s) => {
    let paint;
    if (style === 'line')      paint = `fill="none" stroke="${base}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
    else if (style === 'flat') paint = s.k === 'f'
        ? `fill="${base}"`
        : `fill="none" stroke="${DETAIL}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
    else if (style === 'gradient') paint = s.k === 'f'
        ? `fill="url(#g-${icon}-${style})"`
        : `fill="none" stroke="${DETAIL}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
    else if (style === 'skeuo') paint = s.k === 'f'
        ? `fill="url(#g-${icon}-${style})" filter="url(#f-${icon}-sk)"`
        : `fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"`;
    else /* hand */            paint = `fill="none" stroke="#4a3b32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter="url(#f-${icon}-hd)"`;
    return `  <${s.t} ${attrStr(s.a)} ${paint}/>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64" fill="none" role="img" aria-label="${ICONS[icon].label}">
${defs ? '  <defs>' + defs + '</defs>\n' : ''}${shaped}
</svg>
`;
}

/* ---------- 2) 展示页用的内联 SVG（靠 CSS 控制风格，便于切换） ---------- */
function inlineSvg(icon, styleClass, sizePx) {
  const body = ICONS[icon].shapes.map(childOf).join('');
  const size = sizePx ? ` style="width:${sizePx}px;height:${sizePx}px"` : '';
  return `<svg class="ic ${styleClass}" viewBox="0 0 24 24"${size} role="img" aria-label="${ICONS[icon].label}">${body}</svg>`;
}

/* ---------- 3) 写文件 ---------- */
let count = 0;
for (const name of Object.keys(ICONS)) {
  for (const st of STYLES) {
    fs.writeFileSync(path.join(SVG_DIR, `${name}-${st.id}.svg`), standalone(name, st.id));
    count++;
  }
}
console.log(`已生成 ${count} 个独立 SVG -> ${path.relative(ROOT, SVG_DIR)}/`);

/* ---------- 4) 交互式展示页 ---------- */
const spriteDefs = `<defs>
  <linearGradient id="g-main" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient>
  <filter id="f-shadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.25"/></filter>
  <filter id="f-hd" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.5"/></filter>
</defs>`;
const spriteSymbols = Object.entries(ICONS).map(([n, d]) =>
  `<symbol id="ic-${n}" viewBox="0 0 24 24">${d.shapes.map(childOf).join('')}</symbol>`).join('');

// 每种风格一个分区，内部 14 个图标平铺
const gallerySections = STYLES.map((st) => {
  const tiles = Object.entries(ICONS).map(([n, d]) => {
    const m = PAL[n], m2 = lift(m, 0.28), md = lift(m, 0.14);
    return `<figure class="tile" data-style="${st.id}" style="--metric:${m};--metric2:${m2};--metric-dark:${md}">
      ${inlineSvg(n, 'style-' + st.id)}
      <figcaption><b>${d.label}</b><span>${n}</span></figcaption>
    </figure>`;
  }).join('');
  return `<section class="block" data-style="${st.id}">
    <header class="block__h"><h2>${st.name}</h2><p>${st.desc}</p></header>
    <div class="grid">${tiles}</div>
  </section>`;
}).join('');

// 配色方案演示（用 flat 风格的 8 个代表图标）
const schemeIcons = ['logo', 'mood', 'sleep', 'heart', 'stress', 'dashboard', 'companion', 'lock'];
const schemeDemo = ['bright', 'dark', 'contrast', 'brand'].map((sc) => {
  const tiles = schemeIcons.map((n) => {
    const m = PAL[n], m2 = lift(m, 0.28), md = lift(m, 0.14);
    return `<figure class="tile tile--sm" style="--metric:${m};--metric2:${m2};--metric-dark:${md}">${inlineSvg(n, 'style-flat')}<figcaption>${ICONS[n].label}</figcaption></figure>`;
  }).join('');
  const names = { bright: '明亮', dark: '暗色', contrast: '高对比', brand: '品牌色系' };
  return `<div class="scheme-card scheme-${sc}"><h3>${names[sc]}</h3><div class="grid grid--sm">${tiles}</div></div>`;
}).join('');

// 缩放演示
const scaleDemo = [16, 24, 40, 64, 96].map((px) => {
  const m = PAL.logo, m2 = lift(m, 0.28);
  return `<div class="scale-cell" style="--metric:${m};--metric2:${m2}">${inlineSvg('logo', 'style-flat', px)}<span>${px}px</span></div>`;
}).join('');

const html = `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MoodHub 图标方案</title>
<style>
  :root{
    --bg:#f6f4f0; --surface:#fff; --surface-2:#fbfaf7; --line:#e6e1d8;
    --text:#1e2422; --muted:#78817c; --accent:#2f6f62; --accent-soft:#e6efec;
    --radius:16px; --radius-sm:10px;
    --font:"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:var(--font);color:var(--text);background:var(--bg);
    background-image:radial-gradient(1200px 600px at 110% -10%,#eaf0ec 0%,rgba(234,240,236,0) 60%),
      radial-gradient(900px 500px at -10% 110%,#f2ece4 0%,rgba(242,236,228,0) 55%);
    line-height:1.6;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
  /* 顶栏 */
  .top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px}
  .brand .mk{width:34px;height:34px}
  .top .sub{color:var(--muted);font-weight:500;font-size:13px}
  /* 控件 */
  .controls{position:sticky;top:0;z-index:5;display:flex;gap:10px;flex-wrap:wrap;
    padding:12px;margin:14px 0 26px;background:color-mix(in srgb,var(--surface) 88%,transparent);
    border:1px solid var(--line);border-radius:var(--radius);backdrop-filter:blur(8px);
    box-shadow:0 6px 24px -18px rgba(0,0,0,.4)}
  .controls .grp{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .controls .lbl{font-size:12px;color:var(--muted);margin-right:2px}
  .btn{border:1px solid var(--line);background:var(--surface);color:var(--text);
    padding:7px 13px;border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;transition:.15s}
  .btn:hover{border-color:var(--accent)}
  .btn.is-on{background:var(--accent);border-color:var(--accent);color:#fff}
  /* 区块 */
  .block{margin:30px 0}
  .block__h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .block__h h2{margin:0;font-size:18px}
  .block__h p{margin:0;color:var(--muted);font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:14px}
  .grid--sm{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}
  .tile{margin:0;display:flex;flex-direction:column;align-items:center;gap:8px;
    padding:16px 10px;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius-sm);transition:.15s}
  .tile:hover{transform:translateY(-2px);box-shadow:0 10px 28px -18px rgba(0,0,0,.5);border-color:var(--accent)}
  .tile--sm{padding:12px 6px}
  .tile figcaption{text-align:center;font-size:12px;color:var(--muted)}
  .tile figcaption b{display:block;color:var(--text);font-size:13px;font-weight:600}
  .tile figcaption span{font-family:ui-monospace,monospace;font-size:11px;opacity:.7}
  .ic{width:48px;height:48px;display:block}
  .tile--sm .ic{width:38px;height:38px}
  /* 风格渲染（核心 CSS：同一几何，五种表达） */
  .style-line .s-f,.style-line .s-l{fill:none;stroke:var(--accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .style-flat .s-f{fill:var(--accent)}
  .style-flat .s-l{fill:none;stroke:var(--detail,#fff);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .style-gradient .s-f{fill:url(#g-main)}
  .style-gradient .s-l{fill:none;stroke:var(--detail,#fff);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
  .style-skeuo .s-f{fill:url(#g-main);filter:url(#f-shadow)}
  .style-skeuo .s-l{fill:none;stroke:rgba(255,255,255,.85);stroke-width:1.3;stroke-linecap:round;stroke-linejoin:round}
  .style-hand .s-f,.style-hand .s-l{fill:none;stroke:var(--ink,#4a3b32);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:url(#f-hd)}
  /* 配色方案：定义 --accent / --accent2 / --detail */
  .scheme-bright .tile{--accent:var(--metric);--accent2:var(--metric2);--detail:#fff}
  .scheme-dark .tile{--accent:var(--metric-dark);--accent2:var(--metric2);--detail:#10130f}
  .scheme-contrast .tile{--accent:#14130f;--accent2:#14130f;--detail:#fff}
  .scheme-brand .tile{--accent:#2f6f62;--accent2:#3d7a55;--detail:#fff}
  /* 配色演示卡片 */
  .schemes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
  .scheme-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px}
  .scheme-card h3{margin:0 0 10px;font-size:14px}
  .scheme-bright{background:#f6f4f0}
  .scheme-dark{background:#16181a}.scheme-dark h3{color:#e8eae8}
  .scheme-contrast{background:#fff}
  .scheme-brand{background:#f3efea}
  .scheme-card .tile{border-color:transparent}
  /* 缩放演示 */
  .scale{display:flex;gap:22px;align-items:flex-end;flex-wrap:wrap;padding:20px;
    background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
  .scale-cell{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--muted);font-size:12px}
  .scale-cell .ic{--accent:var(--metric);--accent2:var(--metric2);width:var(--px);height:var(--px)}
  /* 表格 / 说明 */
  table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius);overflow:hidden;font-size:14px}
  th,td{padding:11px 14px;text-align:left;border-bottom:1px solid var(--line)}
  th{background:var(--surface-2);font-size:13px;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  code{background:var(--surface-2);padding:1px 6px;border-radius:6px;font-size:12px}
  .muted{color:var(--muted)}
  h1{font-size:26px;margin:6px 0 2px}
  h2.sec{font-size:18px;margin:34px 0 12px}
  .note{background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);
    color:var(--text);padding:12px 14px;border-radius:var(--radius-sm);font-size:13px}
  a{color:var(--accent)}
</style>
</head>
<body>
<!-- 隐藏的 SVG 精灵：渐变与滤镜定义 + 全部图标符号 -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${spriteDefs}${spriteSymbols}</svg>

<div class="wrap">
  <div class="top">
    <span class="brand">
      <svg class="mk ic style-flat" viewBox="0 0 24 24" style="--metric:#2f6f62;--metric2:#3d7a55" aria-hidden="true">
        <rect class="s-f" x="2" y="2" width="20" height="20" rx="6"/>
        <path class="s-l" d="M5.3 14.3c2.4 0 2.4-4.5 4.8-4.5s2.4 4.5 4.8 4.5 2.7-2.6 3.6-3.5"/>
      </svg>
      MoodHub 图标方案
    </span>
    <span class="sub">14 图标 × 5 风格 × 4 配色 · 矢量可缩放 · 完全离线自持</span>
  </div>

  <div class="controls">
    <div class="grp"><span class="lbl">风格</span>
      <button class="btn is-on" data-f="all">全部</button>
      <button class="btn" data-f="line">极简线条</button>
      <button class="btn" data-f="flat">扁平化</button>
      <button class="btn" data-f="gradient">渐变</button>
      <button class="btn" data-f="skeuo">拟物</button>
      <button class="btn" data-f="hand">手绘</button>
    </div>
    <div class="grp"><span class="lbl">配色</span>
      <button class="btn is-on" data-s="bright">明亮</button>
      <button class="btn" data-s="dark">暗色</button>
      <button class="btn" data-s="contrast">高对比</button>
      <button class="btn" data-s="brand">品牌色系</button>
    </div>
  </div>

  <div class="note">所有图标沿用 <code>moodhub-web</code> 现有品牌：低饱和松绿主色 <code>#2f6f62</code> + 暖纸感中性背景 + 四项指标既有配色。
  同一套几何通过 CSS 渲染为 5 种风格，可随应用浅色 / 深色主题无缝切换。</div>

  <h2 class="sec">风格画廊</h2>
  <div id="gallery">${gallerySections}</div>

  <h2 class="sec">配色方案（同一扁平图标，四种语境）</h2>
  <div class="schemes">${schemeDemo}</div>

  <h2 class="sec">缩放与可辨识度（16 → 96px）</h2>
  <div class="scale" id="scale">${scaleDemo}</div>

  <h2 class="sec">图标清单与建议用法</h2>
  <table>
    <thead><tr><th>图标</th><th>名称</th><th>推荐场景</th><th>文件示例</th></tr></thead>
    <tbody>
      ${Object.entries(ICONS).map(([n, d]) =>
        `<tr><td><span style="--metric:${PAL[n]};--metric2:${lift(PAL[n],0.28)};display:inline-flex;vertical-align:middle">${inlineSvg(n, 'style-flat')}</span></td>
        <td><b>${d.label}</b></td><td class="muted">${d.use}</td>
        <td><code>svg/${n}-flat.svg</code></td></tr>`).join('')}
    </tbody>
  </table>

  <h2 class="sec">平台使用建议</h2>
  <table>
    <thead><tr><th>环境</th><th>建议</th></tr></thead>
    <tbody>
      <tr><td><b>网站</b></td><td class="muted">直接 <code>&lt;img src="svg/..."&gt;</code> 或内联；顶栏用 line / flat，卡片主视觉用 gradient / skeuo。Favicon 用 <code>logo-flat.svg</code>（已对齐现有 favicon）。</td></tr>
      <tr><td><b>移动 App / 小程序</b></td><td class="muted">SVG 矢量按需缩放；底部标签栏用 line（24px），悬浮「新增」用 <code>add-flat.svg</code>。iOS 可导出 @2x/@3x PNG，Android 用 adaptive-icon 前景。</td></tr>
      <tr><td><b>桌面端</b></td><td class="muted">菜单 / 工具栏统一 line 风格；窗口图标与关于页用 skeuo / gradient 增强质感。</td></tr>
      <tr><td><b>社交媒体</b></td><td class="muted">头像 / 封面用 <code>logo-gradient.svg</code> 或 <code>logo-skeuo.svg</code>；圆形头像建议 <code>add</code> / <code>logo</code> 置于圆底。</td></tr>
      <tr><td><b>深色模式</b></td><td class="muted">切换 <code>data-theme="dark"</code> 即可；几何不变，仅填充色随 --accent 自动反相提亮。</td></tr>
    </tbody>
  </table>

  <h2 class="sec">二次定制</h2>
  <p class="muted">每个独立 SVG 已内联颜色，可直接编辑；展示页中的图标通过 CSS 变量 <code>--accent / --accent2 / --detail</code> 着色，
  改一处即可全局换色。手绘风格由 SVG <code>feTurbulence</code> 滤镜实现，调 <code>baseFrequency</code>（抖动频率）与 <code>scale</code>（抖动幅度）即可改变手绘感。</p>
</div>

<script>
  var fBtns = document.querySelectorAll('[data-f]');
  var sBtns = document.querySelectorAll('[data-s]');
  fBtns.forEach(function(b){ b.addEventListener('click', function(){
    fBtns.forEach(function(x){x.classList.remove('is-on')}); b.classList.add('is-on');
    var f = b.getAttribute('data-f');
    document.querySelectorAll('#gallery .block').forEach(function(sec){
      sec.style.display = (f === 'all' || sec.getAttribute('data-style') === f) ? '' : 'none';
    });
  });});
  sBtns.forEach(function(b){ b.addEventListener('click', function(){
    sBtns.forEach(function(x){x.classList.remove('is-on')}); b.classList.add('is-on');
    var s = b.getAttribute('data-s');
    document.querySelectorAll('#gallery .tile').forEach(function(t){
      t.className = t.className.replace(/scheme-\\w+/g,'').trim();
      t.classList.add('scheme-' + s);
    });
    document.querySelectorAll('.scheme-card').forEach(function(c){
      c.className = c.className.replace(/scheme-\\w+/g,'').trim();
      c.classList.add('scheme-' + s);
    });
  });});
  // 默认应用明亮方案
  document.querySelectorAll('#gallery .tile').forEach(function(t){ t.classList.add('scheme-bright'); });
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('已生成 icons/index.html（交互式展示页）');
