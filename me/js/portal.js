/* =========================================================
 *  portal.js — 瑞克与莫蒂风格传送门的绘制 & 全屏穿越特效
 *  暴露：window.Portal = { draw, Warp }
 * ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  /** 传送门边缘的有机抖动（随时间缓慢流动） */
  function wobble(a, t, seed) {
    return 1
      + 0.055 * Math.sin(3 * a + t * 2.1 + seed)
      + 0.035 * Math.sin(5 * a - t * 3.3 + seed * 2.3)
      + 0.022 * Math.sin(11 * a + t * 5.2 + seed * 0.7)
      + 0.012 * Math.sin(17 * a - t * 7.1);
  }

  function blobPath(ctx, cx, cy, rx, ry, t, seed, k) {
    const N = 72;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const r = 1 + (wobble(a, t, seed) - 1) * k;
      const x = cx + Math.cos(a) * rx * r;
      const y = cy + Math.sin(a) * ry * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * 绘制一个传送门
   * @param ctx    CanvasRenderingContext2D（当前变换下的坐标）
   * @param cx,cy  中心
   * @param rx,ry  半径
   * @param t      时间（秒）
   * @param hue    主色相（经典绿 ≈ 105）
   * @param o      { glow:1, speed:1, seed:0, hole:0(0..1 中心镂空比例), wob:1 }
   */
  function draw(ctx, cx, cy, rx, ry, t, hue, o) {
    o = o || {};
    const glow = o.glow == null ? 1 : o.glow;
    const speed = o.speed == null ? 1 : o.speed;
    const seed = o.seed || 0;
    const wob = o.wob == null ? 1 : o.wob;
    const hole = o.hole || 0;
    const ts = t * speed;
    const R = Math.max(rx, ry);
    if (rx < 0.5 || ry < 0.5) return;

    ctx.save();

    // --- 外层光晕 + 主体 ---
    blobPath(ctx, cx, cy, rx, ry, ts, seed, wob);
    if (hole > 0) {
      // 中心镂空（从传送门里"钻出来"的效果）
      ctx.moveTo(cx + rx * hole, cy);
      ctx.ellipse(cx, cy, rx * hole, ry * hole, 0, 0, TAU, true);
    }
    ctx.shadowColor = `hsla(${hue + 8},100%,62%,${0.85 * glow})`;
    ctx.shadowBlur = Math.min(60, R * 0.35) * glow;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
    g.addColorStop(0, `hsl(${hue - 25},100%,88%)`);
    g.addColorStop(0.22, `hsl(${hue - 10},98%,70%)`);
    g.addColorStop(0.62, `hsl(${hue},88%,48%)`);
    g.addColorStop(1, `hsl(${hue + 5},92%,34%)`);
    ctx.fillStyle = g;
    ctx.fill('evenodd');
    ctx.shadowBlur = 0;

    // --- 内部旋涡（裁剪在传送门内） ---
    ctx.save();
    blobPath(ctx, cx, cy, rx * 0.96, ry * 0.96, ts, seed, wob);
    if (hole > 0) {
      ctx.moveTo(cx + rx * hole, cy);
      ctx.ellipse(cx, cy, rx * hole, ry * hole, 0, 0, TAU, true);
    }
    ctx.clip('evenodd');

    const arms = 5;
    ctx.lineCap = 'round';
    for (let layer = 0; layer < 2; layer++) {
      for (let k = 0; k < arms; k++) {
        const base = (k / arms) * TAU + (layer ? 0.55 : 0);
        ctx.beginPath();
        const steps = 26;
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const ang = base + u * (layer ? 3.6 : 4.4) - ts * (layer ? 1.15 : 1.7);
          const rr = u * 1.02;
          const x = cx + Math.cos(ang) * rx * rr;
          const y = cy + Math.sin(ang) * ry * rr;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        if (layer === 0) {
          ctx.strokeStyle = `hsla(${hue + 15},95%,24%,0.42)`;
          ctx.lineWidth = R * 0.13;
        } else {
          ctx.strokeStyle = `hsla(${hue - 30},100%,88%,0.35)`;
          ctx.lineWidth = R * 0.045;
        }
        ctx.stroke();
      }
    }

    // 中心亮核
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.42);
    core.addColorStop(0, `hsla(${hue - 35},100%,96%,0.95)`);
    core.addColorStop(0.5, `hsla(${hue - 20},100%,80%,0.45)`);
    core.addColorStop(1, `hsla(${hue},100%,60%,0)`);
    ctx.fillStyle = core;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.restore();

    // --- 亮边（黄绿色的外圈） ---
    blobPath(ctx, cx, cy, rx * 0.985, ry * 0.985, ts * 1.1, seed + 1.7, wob);
    ctx.strokeStyle = `hsl(${hue - 32},100%,72%)`;
    ctx.lineWidth = Math.max(1.5, R * 0.075);
    ctx.stroke();
    blobPath(ctx, cx, cy, rx * 0.93, ry * 0.93, ts * 0.9, seed + 3.1, wob);
    ctx.strokeStyle = `hsla(${hue - 40},100%,90%,0.55)`;
    ctx.lineWidth = Math.max(1, R * 0.025);
    ctx.stroke();

    // --- 边缘溅出的"液滴" ---
    const drops = 14;
    for (let i = 0; i < drops; i++) {
      const life = (ts * 0.55 + i * 0.6180339) % 1;
      const a = i * 2.39996 + seed + Math.sin(i * 7.1) * 0.4;
      const r = 1.0 + life * 0.22;
      const w = wobble(a, ts, seed);
      const x = cx + Math.cos(a) * rx * r * w;
      const y = cy + Math.sin(a) * ry * r * w;
      const size = R * 0.04 * (1 - life) * (0.6 + 0.6 * ((i * 37) % 10) / 10);
      if (size < 0.4) continue;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fillStyle = `hsla(${hue - 25},100%,${70 + life * 15}%,${(1 - life) * 0.9})`;
      ctx.fill();
    }
    ctx.restore();
  }

  /* =========================================================
   *  Warp：全屏穿越动画
   *  play({x,y,rx,ry,hue}, onMid) —— 传送门扩张吞没屏幕 → 调用 onMid
   *  → 中心开出新维度的洞，向外扩散
   * ========================================================= */
  const Warp = {
    canvas: null, ctx: null, running: false,

    init() {
      this.canvas = document.getElementById('warp');
      this.ctx = this.canvas.getContext('2d');
      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.dpr = dpr;
        this.canvas.width = Math.round(innerWidth * dpr);
        this.canvas.height = Math.round(innerHeight * dpr);
      };
      resize();
      addEventListener('resize', resize);
    },

    play(from, onMid) {
      if (this.running) return Promise.resolve();
      this.running = true;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const cv = this.canvas, ctx = this.ctx;
      cv.classList.add('on');
      const W = innerWidth, H = innerHeight;
      const cover = Math.hypot(W, H) * 0.62;
      const hue = from.hue == null ? 105 : from.hue;
      const IN = reduce ? 250 : 720, HOLD = reduce ? 80 : 260, OUT = reduce ? 300 : 820;
      const start = performance.now();
      let midCalled = false;

      const easeIn = (x) => x * x * x;
      const easeOut = (x) => 1 - Math.pow(1 - x, 3);
      const lerp = (a, b, k) => a + (b - a) * k;

      return new Promise((resolve) => {
        const frame = () => {
          const now = performance.now();
          const el = Math.max(0, now - start);
          this.frames = (this.frames || 0) + 1;
          const t = now / 1000;
          ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);

          if (el < IN) {
            // 阶段一：传送门扩张，覆盖屏幕
            const k = easeIn(el / IN);
            const cx = lerp(from.x, W / 2, k), cy = lerp(from.y, H / 2, k);
            const rx = lerp(from.rx, cover * 1.15, k), ry = lerp(from.ry, cover * 1.15, k);
            draw(ctx, cx, cy, rx, ry, t, hue, { speed: 1 + k * 3, glow: 1, wob: 1 - k * 0.5 });
            this.streaks(ctx, W / 2, H / 2, cover, t, k, hue);
          } else if (el < IN + HOLD) {
            // 阶段二：隧道
            if (!midCalled) { midCalled = true; try { onMid && onMid(); } catch (e) { console.error(e); } }
            draw(ctx, W / 2, H / 2, cover * 1.15, cover * 1.15, t, hue, { speed: 4, wob: 0.5 });
            this.tunnel(ctx, W / 2, H / 2, cover, t, hue);
            this.streaks(ctx, W / 2, H / 2, cover, t, 1, hue);
          } else if (el < IN + HOLD + OUT) {
            // 阶段三：中心开洞，新维度显现
            if (!midCalled) { midCalled = true; try { onMid && onMid(); } catch (e) { console.error(e); } }
            const k = easeOut((el - IN - HOLD) / OUT);
            const r = cover * (1.15 + k * 0.6);
            ctx.globalAlpha = 1 - Math.pow(k, 2.2);
            draw(ctx, W / 2, H / 2, r, r, t, hue, { speed: 4 - k * 3, hole: Math.min(0.97, k * 1.05), wob: 0.5 + k });
            ctx.globalAlpha = 1;
          } else {
            ctx.clearRect(0, 0, W, H);
            cv.classList.remove('on');
            this.running = false;
            resolve();
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },

    tunnel(ctx, cx, cy, R, t, hue) {
      ctx.save();
      for (let i = 0; i < 9; i++) {
        const p = (i / 9 + t * 0.9) % 1;
        const r = p * p * R * 1.3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.92, t * 0.6 + i, 0, TAU);
        ctx.strokeStyle = `hsla(${hue - 30},100%,85%,${0.5 * p})`;
        ctx.lineWidth = 2 + p * 16;
        ctx.stroke();
      }
      ctx.restore();
    },

    streaks(ctx, cx, cy, R, t, k, hue) {
      ctx.save();
      ctx.lineCap = 'round';
      const n = 46;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + t * 0.8;
        const p = (t * 1.6 + i * 0.137) % 1;
        const r0 = R * 1.4 * (1 - p);
        const r1 = r0 * (0.82 - 0.2 * k);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a + 0.12) * r1, cy + Math.sin(a + 0.12) * r1);
        ctx.strokeStyle = `hsla(${hue - 35},100%,92%,${0.55 * k * p})`;
        ctx.lineWidth = 1 + 3 * p;
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  window.Portal = { draw, Warp, blobPath };
})();
