/* =========================================================
 *  parkour.js — 跑酷维度：火柴人
 *  规则：
 *   · 只有 style === 'parkour' 的维度里才会出现火柴人，其它维度（哪怕从
 *     跑酷维度穿过去）都没有火柴人。
 *   · 火柴人可以用 A / D 走动、空格跳跃，踩在"用画笔画出来的线条"上。
 *   · 靠近传送门按 E 穿越。
 *   · 每个跑酷维度在"入口传送门"（dest === 'back' 的那扇门）下方都有一块
 *     初始平台；从别处进入这个维度时，火柴人就从入口传送门里掉出来。
 *  暴露：window.Parkour
 * ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;

  /* ---------------- 物理参数（世界坐标 / 秒） ---------------- */
  const RAD = 13;          // 落地判定的横向容差
  const BODY = 101;        // 身高（头顶到脚底）
  const GRAV = 2300;
  const MAX_FALL = 2400;
  const RUN = 345;
  const ACCEL = 3200;
  const AIR_ACCEL = 1700;
  const FRICTION = 3600;
  const JUMP_V = 900;      // 跳跃初速（最高约 176 世界单位）
  const STEP_UP = 22;      // 自动迈上的高度（走斜坡 / 小台阶）
  const COYOTE = 0.10;     // 离地后仍可起跳的宽限时间
  const BUFFER = 0.14;     // 落地前提前按跳跃的缓冲
  const FALL_LIMIT = 1600; // 掉出多远后自动回到入口
  const PLAT_HALF = 240;   // 初始平台半长
  const PLAT_DROP = 150;   // 初始平台在入口传送门下方多远（避开门牌标签）
  const SPAWN_FADE = 0.55; // 从传送门里出现的时间

  let H = null;            // 由 board.js 注入的钩子
  let active = false;      // 是否处于跑酷维度
  const segs = [];         // 本帧所有可踩的表面线段
  const P = {
    x: 0, y: 0, vx: 0, vy: 0,
    onGround: false, coyote: 0, buffer: 0,
    face: 1, phase: 0, spawnT: 1,
    spawn: { x: 0, y: 0 }
  };
  const keys = { left: false, right: false, jump: false };
  let hintPortal = null;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* =========================================================
   *  对外接口
   * ========================================================= */
  const Parkour = {
    get active() { return active; },

    init(hooks) { H = hooks; },

    /** 切换到某个维度时调用 */
    onScene(sc) {
      if (!H || !sc || sc.style !== 'parkour') { this.leave(); return; }
      const p = entrancePortal(sc);
      const sx = p ? p.x + p.w / 2 : 0;
      const sy = p ? p.y + p.h / 2 : -80;
      P.x = sx; P.y = sy; P.vx = 0; P.vy = 0;
      P.onGround = false; P.coyote = 0; P.buffer = 0;
      P.face = 1; P.phase = 0; P.spawnT = 0;
      P.spawn = { x: sx, y: sy };
      hintPortal = null;
      active = true;
      buildSegs(sc);
    },

    /** 离开跑酷维度：火柴人彻底消失 */
    leave() {
      active = false;
      keys.left = keys.right = keys.jump = false;
      hintPortal = null;
    },

    /** 每帧更新（dt 单位：秒） */
    update(dt) {
      if (!active || !H) return;
      if (H.getScene().style !== 'parkour') { this.leave(); return; }
      dt = clamp(dt, 0, 0.04);
      if (P.spawnT < 1) P.spawnT = Math.min(1, P.spawnT + dt / SPAWN_FADE);
      if (P.buffer > 0) P.buffer = Math.max(0, P.buffer - dt);

      buildSegs(H.getScene());
      const steps = Math.max(1, Math.min(6, Math.ceil(dt / (1 / 120))));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) step(h);

      if (P.y > P.spawn.y + FALL_LIMIT) respawn(true);
      follow(dt);
      hintPortal = nearPortal();
    },

    /** 在相机变换里绘制（元素之后、选择框之后都会被调用） */
    draw(ctx, st, t) {
      if (!active || !H) return;
      drawFixture(ctx, st);
      if (P.spawnT < 0.02) return;
      drawPlayer(ctx, st, t);
      if (hintPortal) drawHint(ctx, hintPortal, t);
    },

    /** 导出 PNG 时也把初始平台画上 */
    drawFixture(ctx, st) {
      if (!active || !H) return;
      drawFixture(ctx, st);
    },

    /* ---- 键盘 ---- */
    handleKey(e) {
      if (!active) return false;
      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') { keys.left = true; return true; }
      if (k === 'd' || e.key === 'ArrowRight') { keys.right = true; return true; }
      if (e.code === 'Space' || k === 'w' || e.key === 'ArrowUp') {
        keys.jump = true; P.buffer = BUFFER; e.preventDefault(); return true;
      }
      if (k === 'e') {
        const p = nearPortal();
        if (p) H.enterPortal(p); else H.flash('靠近传送门再按 E 穿越');
        return true;
      }
      return false;
    },
    handleKeyUp(e) {
      const k = e.key.toLowerCase();
      if (k === 'a' || e.key === 'ArrowLeft') keys.left = false;
      else if (k === 'd' || e.key === 'ArrowRight') keys.right = false;
      else if (e.code === 'Space' || k === 'w' || e.key === 'ArrowUp') keys.jump = false;
    },
    blur() { keys.left = keys.right = keys.jump = false; },

    _debug: { P, segs, keys }
  };

  /* =========================================================
   *  传送门 / 初始平台
   * ========================================================= */
  function entrancePortal(sc) {
    let first = null;
    for (const el of sc.els) {
      if (el.type !== 'portal') continue;
      if (el.dest === 'back') return el;     // 入口传送门＝回去的那扇
      if (!first) first = el;
    }
    return first;
  }

  function fixture(sc) {
    if (!sc) return null;
    const p = entrancePortal(sc);
    // 万一入口传送门被删掉了，也给一块默认平台，免得火柴人一直掉
    if (!p) return { x0: -PLAT_HALF, x1: PLAT_HALF, y: 140 };
    const cx = p.x + p.w / 2;
    return { x0: cx - PLAT_HALF, x1: cx + PLAT_HALF, y: p.y + p.h + PLAT_DROP };
  }

  /* =========================================================
   *  可踩表面：把画出来的元素拆成线段
   * ========================================================= */
  function buildSegs(sc) {
    segs.length = 0;
    const fx = fixture(sc);
    if (fx) segs.push({ x0: fx.x0, y0: fx.y, x1: fx.x1, y1: fx.y });

    const px = P.x;
    for (const el of sc.els) {
      const r = elXRange(el);
      if (!r || r[1] < px - 320 || r[0] > px + 320) continue;   // 离火柴人太远，不参与碰撞
      const info = elSegments(el);
      if (!info) continue;
      const pts = info.pts, off = info.off;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (Math.abs(b[0] - a[0]) < 0.4 && Math.abs(b[1] - a[1]) < 0.4) continue;
        segs.push({ x0: a[0], y0: a[1] - off, x1: b[0], y1: b[1] - off });
      }
    }
  }

  /** 元素的横向范围（世界坐标），用来在拆线段之前快速剔除 */
  function elXRange(el) {
    switch (el.type) {
      case 'line': case 'arrow': case 'pen': {
        if (!el.points || el.points.length < 2) return null;
        let a = Infinity, b = -Infinity;
        for (let i = 0; i < el.points.length; i++) {
          const x = el.points[i][0];
          if (x < a) a = x;
          if (x > b) b = x;
        }
        return [el.x + a, el.x + b];
      }
      case 'rect': case 'ellipse':
        return [el.x, el.x + el.w];
    }
    return null;
  }

  function elSegments(el) {
    const off = Math.min((el.width || 3) / 2, 8);
    switch (el.type) {
      case 'line': case 'arrow': case 'pen': {
        if (!el.points || el.points.length < 2) return null;
        const pts = [];
        for (let i = 0; i < el.points.length; i++) pts.push([el.x + el.points[i][0], el.y + el.points[i][1]]);
        return { pts, off };
      }
      case 'rect':
        return { pts: [[el.x, el.y], [el.x + el.w, el.y], [el.x + el.w, el.y + el.h], [el.x, el.y + el.h], [el.x, el.y]], off };
      case 'ellipse': {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2, N = 26;
        const pts = [];
        for (let i = 0; i <= N; i++) { const a = (i / N) * TAU; pts.push([cx + Math.cos(a) * el.w / 2, cy + Math.sin(a) * el.h / 2]); }
        return { pts, off };
      }
    }
    return null;
  }

  /* =========================================================
   *  物理
   * ========================================================= */
  function segY(s, px) {
    const minx = s.x0 < s.x1 ? s.x0 : s.x1;
    const maxx = s.x0 < s.x1 ? s.x1 : s.x0;
    if (px < minx - RAD || px > maxx + RAD) return null;
    if (maxx - minx < 1) return s.y0 < s.y1 ? s.y0 : s.y1;
    return s.y0 + (s.y1 - s.y0) * clamp((px - s.x0) / (s.x1 - s.x0), 0, 1);
  }

  /** 脚下的地面（下落时用：只找"迈得上去"且"脚已经够到"的面） */
  function groundAt(px, py, prevY) {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const cy = segY(segs[i], px);
      if (cy === null) continue;
      if (cy < prevY - STEP_UP) continue;
      if (cy > py + 2) continue;
      if (best === null || cy < best) best = cy;
    }
    return best;
  }

  /** 脚下最近的一个面（画影子用） */
  function surfaceBelow(px, rootY, maxD) {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const cy = segY(segs[i], px);
      if (cy === null) continue;
      if (cy < rootY - 2 || cy > rootY + maxD) continue;
      if (best === null || cy < best) best = cy;
    }
    return best;
  }

  function step(h) {
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) P.face = dir;

    if (dir) P.vx = clamp(P.vx + dir * (P.onGround ? ACCEL : AIR_ACCEL) * h, -RUN, RUN);
    else if (P.onGround) {
      const f = FRICTION * h;
      P.vx = Math.abs(P.vx) <= f ? 0 : P.vx - Math.sign(P.vx) * f;
    } else {
      P.vx *= 1 - Math.min(0.6, h * 0.9);
    }

    if (P.buffer > 0 && (P.onGround || P.coyote > 0)) {
      P.vy = -JUMP_V;
      P.onGround = false;
      P.coyote = 0;
      P.buffer = 0;
    }

    P.vy = Math.min(P.vy + GRAV * h, MAX_FALL);
    const prevY = P.y;
    P.x += P.vx * h;
    P.y += P.vy * h;

    const g = P.vy >= 0 ? groundAt(P.x, P.y, prevY) : null;
    if (g !== null) {
      P.y = g; P.vy = 0; P.onGround = true; P.coyote = COYOTE;
    } else {
      P.onGround = false;
      P.coyote = Math.max(0, P.coyote - h);
    }

    const spd = Math.abs(P.vx);
    P.phase += P.onGround ? h * (1.5 + spd / 30) : h * 5;
    if (P.phase > 1e6) P.phase = 0;
  }

  function respawn(notice) {
    P.x = P.spawn.x; P.y = P.spawn.y;
    P.vx = 0; P.vy = 0;
    P.onGround = false; P.coyote = 0; P.buffer = 0;
    P.spawnT = 0; P.phase = 0; P.face = 1;
    if (notice && H) H.flash('掉下去啦 · 回到入口传送门');
  }

  function follow(dt) {
    if (H.isBusy()) return;            // 正在画线 / 平移 / 穿越时不抢镜头
    const cam = H.getCam();
    const dzx = 160, dzy = 140;
    let tx = cam.x, ty = cam.y;
    if (P.x > cam.x + dzx) tx = P.x - dzx;
    else if (P.x < cam.x - dzx) tx = P.x + dzx;
    if (P.y > cam.y + dzy) ty = P.y - dzy;
    else if (P.y < cam.y - dzy) ty = P.y + dzy;
    if (tx === cam.x && ty === cam.y) return;
    const k = Math.min(1, dt * 5.5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }

  function nearPortal() {
    if (!H) return null;
    const sc = H.getScene();
    const MX = 46, MY = 76;             // 触发容差：站在传送门下方那块平台上就能按 E
    const hl = P.x - 20, hr = P.x + 20;
    const vt = P.y - BODY, vb = P.y;    // 火柴人从头到脚
    let best = null, bd = Infinity;
    for (const el of sc.els) {
      if (el.type !== 'portal') continue;
      if (hr < el.x - MX || hl > el.x + el.w + MX) continue;
      if (vb < el.y - MY || vt > el.y + el.h + MY) continue;
      const d = Math.hypot(P.x - (el.x + el.w / 2), P.y - (el.y + el.h));
      if (d < bd) { bd = d; best = el; }
    }
    return best;
  }

  /* =========================================================
   *  绘制
   * ========================================================= */
  function drawFixture(ctx, st) {
    const fx = fixture(H.getScene());
    if (!fx) return;
    ctx.save();
    ctx.lineCap = 'round';

    // 影子
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = st.ink;
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(fx.x0 + 7, fx.y + 11);
    ctx.lineTo(fx.x1 + 7, fx.y + 13);
    ctx.stroke();

    // 主体
    ctx.globalAlpha = 1;
    ctx.strokeStyle = st.ink;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(fx.x0, fx.y);
    ctx.lineTo(fx.x1, fx.y);
    ctx.stroke();

    // 顶面高光
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx.x0 + 8, fx.y - 6);
    ctx.lineTo(fx.x1 - 8, fx.y - 6);
    ctx.stroke();

    // 斜纹
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = st.bg;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = fx.x0 + 20; x < fx.x1 - 14; x += 36) { ctx.moveTo(x, fx.y - 7); ctx.lineTo(x + 10, fx.y + 7); }
    ctx.stroke();

    // 两端铆钉
    ctx.globalAlpha = 1;
    ctx.fillStyle = st.ink;
    ctx.beginPath(); ctx.arc(fx.x0 + 7, fx.y, 5.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(fx.x1 - 7, fx.y, 5.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** 一条肢体：从 (ox,oy) 出发，ang 为相对"竖直向下"的角（正数向右） */
  function limb(c, ox, oy, ang, len, bend, frac) {
    const l1 = len * frac, l2 = len * (1 - frac);
    const kx = ox + Math.sin(ang) * l1;
    const ky = oy + Math.cos(ang) * l1;
    const ex = kx + Math.sin(ang + bend) * l2;
    const ey = ky + Math.cos(ang + bend) * l2;
    c.moveTo(ox, oy);
    c.lineTo(kx, ky);
    c.lineTo(ex, ey);
    return [ex, ey];
  }

  function drawPlayer(ctx, st, t) {
    const fade = P.spawnT < 1 ? P.spawnT : 1;
    const ease = 1 - Math.pow(1 - fade, 2);
    const air = !P.onGround;
    const amp = clamp(Math.abs(P.vx) / RUN, 0, 1);
    const ph = P.phase;
    const f = P.face;               // +1 朝右 / -1 朝左

    /* 角度约定：0 = 竖直向下，正 = 朝"前"（面朝的方向）。
       下面全部按"朝右"来算，画的时候统一乘 f 做镜像，所以左右都一样。 */
    let legF, legB, kneeF, kneeB, armF, armB, elbow;
    if (air) {
      legF = 0.85; kneeF = -0.25;      // 前腿向前伸，几乎伸直
      legB = -0.75; kneeB = -1.75;     // 后腿向后收起，小腿往上收
      armF = 2.45; armB = -2.15; elbow = -0.30;   // 一前一后把手臂甩开
    } else {
      const s = Math.sin(ph) * 0.68 * amp;
      legF = 0.06 + s;
      legB = -0.06 - s;
      kneeF = -(0.14 + 0.60 * Math.max(0, Math.cos(ph)) * amp);
      kneeB = -(0.14 + 0.60 * Math.max(0, Math.cos(ph + Math.PI)) * amp);
      armF = 0.26 - s * 0.9;
      armB = -0.26 + s * 0.9;
      elbow = -0.22;
    }

    const x = P.x, feet = P.y;
    const hipY = feet - 40;
    const shY = feet - 74;          // 肩点（手臂从这里长出来）
    const headR = 13;
    const headY = shY - headR - 1;  // 头部上移，圆圈下沿刚好贴住肩点，不再压进身体
    const neckY = headY + headR;    // 躯干画到头的下沿，脖子处不留缝

    // 影子：落在地面上
    const gy = surfaceBelow(P.x, P.y + 1, 900);
    if (gy !== null) {
      const d = clamp(1 - (gy - P.y) / 420, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.20 * d * ease;
      ctx.fillStyle = st.ink;
      ctx.beginPath();
      ctx.ellipse(P.x, gy - 3, 21 * (0.6 + 0.4 * d), 6 * (0.6 + 0.4 * d), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    const trace = (c, color, w) => {
      c.strokeStyle = color;
      c.lineWidth = w;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.beginPath();
      // 腿
      limb(c, x, hipY, f * legF, 42, f * kneeF, 0.5);
      limb(c, x, hipY, f * legB, 42, f * kneeB, 0.5);
      // 躯干
      c.moveTo(x, hipY);
      c.lineTo(x + f * 1.5, neckY);
      // 手臂
      limb(c, x + f * 1.5, shY, f * armF, 36, f * elbow, 0.5);
      limb(c, x + f * 1.5, shY, f * armB, 36, f * elbow, 0.5);
      // 头
      c.moveTo(x + f * 1.5 + headR, headY);
      c.arc(x + f * 1.5, headY, headR, 0, TAU);
      c.stroke();
    };

    ctx.save();
    ctx.translate(x, feet);
    ctx.scale(0.75 + 0.25 * ease, 0.75 + 0.25 * ease);
    ctx.translate(-x, -feet);
    ctx.globalAlpha = ease;

    // 外描边（让火柴人在任何底色上都清楚）
    trace(ctx, st.bg, 9);
    trace(ctx, st.ink, 4.5);

    // 眼睛：朝向的小点
    ctx.fillStyle = st.ink;
    ctx.beginPath();
    ctx.arc(x + f * 1.5 + f * 4.8, headY - 2.2, 1.9, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawHint(ctx, portal, t) {
    const cam = H.getCam();
    const z = cam.z || 1;
    const cx = portal.x + portal.w / 2;
    const cy = portal.y + portal.h / 2;
    const hue = portal.hue == null ? 105 : portal.hue;

    ctx.save();

    // 传送门外圈高亮
    ctx.save();
    ctx.strokeStyle = `hsla(${hue - 25},100%,72%,0.9)`;
    ctx.lineWidth = 4 / z;
    ctx.setLineDash([10 / z, 7 / z]);
    ctx.lineDashOffset = -t * 40 / z;
    ctx.beginPath();
    ctx.ellipse(cx, cy, portal.w / 2 + 16 / z, portal.h / 2 + 16 / z, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // 提示气泡
    const bob = Math.sin(t * 3.4) * 4 / z;
    const fs = 26 / z;
    const bx = cx;
    const by = portal.y - 22 / z + bob;
    ctx.font = `700 ${fs}px ${H.handFont}`;
    const label = `按 E 穿越 · ${portal.name || '传送门'}`;
    const pad = fs * 0.55;
    const w = ctx.measureText(label).width + pad * 2;
    const h = fs * 1.5;
    const lx = bx - w / 2, ly = by - h;

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(30,18,8,0.35)';
    ctx.fillRect(lx + 3 / z, ly + 4 / z, w, h);
    ctx.fillStyle = '#f7efdc';
    ctx.fillRect(lx, ly, w, h);
    ctx.strokeStyle = `hsl(${hue},60%,38%)`;
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(lx, ly, w, h);

    ctx.fillStyle = '#1f1a14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, ly + h / 2 + 1 / z);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  window.Parkour = Parkour;
})();
