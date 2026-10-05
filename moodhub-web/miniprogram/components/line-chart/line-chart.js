// 折线图组件：canvas 2d 手绘，替代 Web 端 charts.js 生成的 SVG（小程序不支持内联 SVG）
Component({
  properties: {
    points: { type: Array, value: [] },      // [{ date, value }]，value 为 null 表示空白天
    color: { type: String, value: '#2f6f62' },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 100 },
    unit: { type: String, value: '' },
    height: { type: Number, value: 150 }
  },
  data: { canvasId: 'lc' },
  lifetimes: {
    attached() { this.setData({ canvasId: 'lc' + Math.floor(Math.random() * 1e6) }); },
    ready() { this.draw(); }
  },
  observers: {
    'points, min, max, color'() { this.draw(); }
  },
  methods: {
    draw() {
      const pts = this.data.points || [];
      const h = this.data.height;
      const query = this.createSelectorQuery().in(this);
      query.select('.lc-canvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const dpr = (wx.getSystemInfoSync().pixelRatio) || 2;
        const w = res[0].width;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const padL = 26, padR = 8, padT = 10, padB = 18;
        const lo = this.data.min, hi = this.data.max;
        const span = (hi - lo) || 1;
        const step = pts.length > 1 ? (w - padL - padR) / (pts.length - 1) : 0;
        const yOf = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB);
        const xOf = (i) => padL + i * step;

        // 网格线
        ctx.strokeStyle = 'rgba(0,0,0,.06)';
        ctx.lineWidth = 1;
        for (let k = 0; k <= 3; k++) {
          const y = padT + (k / 3) * (h - padT - padB);
          ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
          const val = Math.round(hi - (k / 3) * span);
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(String(val), padL - 4, y + 3);
        }

        // 折线：空白天断开，不补零
        ctx.strokeStyle = this.data.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        let started = false;
        pts.forEach((p, i) => {
          if (p.value == null || !isFinite(p.value)) { started = false; return; }
          const x = xOf(i), y = yOf(p.value);
          if (!started) { ctx.beginPath(); ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        });
        if (started) ctx.stroke();

        // 数据点
        pts.forEach((p, i) => {
          if (p.value == null || !isFinite(p.value)) return;
          ctx.beginPath();
          ctx.fillStyle = this.data.color;
          ctx.arc(xOf(i), yOf(p.value), 2.4, 0, Math.PI * 2);
          ctx.fill();
        });

        // 首末日期
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        if (pts.length) {
          const tail = (s) => s.slice(5);
          ctx.fillText(tail(pts[0].date), padL, h - 4);
          ctx.textAlign = 'right';
          ctx.fillText(tail(pts[pts.length - 1].date), w - padR, h - 4);
        }
      });
    }
  }
});
