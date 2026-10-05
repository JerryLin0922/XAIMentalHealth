const fs = require('fs');
const d = 'svg';
let bad = 0;
for (const f of fs.readdirSync(d)) {
  const s = fs.readFileSync(d + '/' + f, 'utf8');
  if (!s.startsWith('<svg') || !s.trim().endsWith('</svg>')) { bad++; console.log('BAD', f); }
}
console.log('checked', fs.readdirSync(d).length, 'svg files, bad =', bad);
const h = fs.readFileSync('index.html', 'utf8');
console.log('index.html bytes =', h.length,
  '| hasGallery =', h.includes('id="gallery"'),
  '| hasSprite =', h.includes('id="g-main"'),
  '| tiles =', (h.match(/class="tile"/g) || []).length);
