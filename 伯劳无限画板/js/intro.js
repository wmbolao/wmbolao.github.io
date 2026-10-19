/* =========================================================
 *  intro.js — 开场动画：古典拼贴风格的伯劳从树枝上起飞，
 *  朝镜头飞来，翅膀掠过镜头后丝滑过渡到无限画板
 * ========================================================= */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const intro = document.getElementById('intro');
  const app = document.getElementById('app');
  const birdWrap = document.getElementById('birdWrap');
  const bird = document.getElementById('bird');
  const fall = document.getElementById('fallLeaves');
  const skipBtn = document.getElementById('skipIntro');

  /* ---------------- 伯劳（剪纸部件） ---------------- */
  bird.setAttribute('width', 640);
  bird.setAttribute('height', 560);
  bird.innerHTML = `
  <g filter="url(#cutout)">
    <g id="wingFar" class="flight-part">
      <path d="M128 70 C140 38 166 6 206 -18 L200 -4 L224 -10 L210 6 L232 4 L212 18 L228 22 L200 34 C180 50 156 64 140 82 Z" fill="#2b1f16"/>
      <path d="M140 60 C160 36 182 16 204 0" stroke="#6b4a33" stroke-width="1.2" fill="none"/>
    </g>
    <g id="tail">
      <path d="M186 100 L294 138 L289 152 L181 118 Z" fill="#8a4a26"/>
      <path d="M190 106 L291 142 M186 112 L290 147" stroke="#4a2814" stroke-width="1.2" fill="none"/>
      <path d="M186 100 L294 138 L289 152 L181 118 Z" fill="url(#hatchFine)"/>
    </g>
    <g id="legs" class="perch-part">
      <path d="M114 122 L118 149 M130 122 L133 149" stroke="#2b211b" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M108 150 L126 150 M124 150 L142 150" stroke="#2b211b" stroke-width="2.8" stroke-linecap="round"/>
    </g>
    <g id="bodyG">
      <path d="M50 66 C58 46 92 40 110 54 C134 62 168 80 196 100 L190 118 C160 130 120 132 94 120 C74 110 60 96 56 84 Z" fill="#9b6f4c"/>
      <path d="M52 64 C60 48 90 42 108 54 C92 54 70 58 54 68 Z" fill="#8e8072"/>
      <path d="M57 78 C70 80 82 86 96 96 C120 112 160 116 194 108 L190 118 C160 130 120 132 94 120 C74 110 60 96 56 84 Z" fill="#f1e4c9"/>
      <path d="M100 104 C130 116 165 116 192 110 L190 118 C160 128 125 128 104 118 Z" fill="#e2b585"/>
      <path d="M50 66 C58 46 92 40 110 54 C134 62 168 80 196 100 L190 118 C160 130 120 132 94 120 C74 110 60 96 56 84 Z" fill="url(#hatch)" opacity="0.6"/>
      <path d="M50 63 C62 57 80 57 99 66 C82 62 64 62 52 67 Z" fill="#f6efdf"/>
      <path d="M44 70 C52 64 64 62 74 64 C84 64 94 68 101 74 C92 80 80 78 72 78 C62 80 52 78 44 74 Z" fill="#15110e"/>
      <circle cx="68" cy="70" r="4" fill="#000"/>
      <circle cx="66.8" cy="68.8" r="1.3" fill="#fff"/>
      <path d="M48 66 L30 70 C26 71 25 75 27.5 78 L31 76 C34 75 40 75 48 76 Z" fill="#2a221c"/>
      <g class="perch-part">
        <path d="M104 70 C132 70 168 86 202 110 C176 112 140 106 116 98 C104 92 98 80 104 70 Z" fill="#6b4a33"/>
        <path d="M106 72 C122 72 140 78 152 86 C136 86 118 84 108 82 Z" fill="#a67d58"/>
        <path d="M120 84 C150 93 175 102 198 110 M124 92 C150 99 170 105 190 110" stroke="#d1aa80" stroke-width="1.2" fill="none"/>
        <path d="M104 70 C132 70 168 86 202 110 C176 112 140 106 116 98 C104 92 98 80 104 70 Z" fill="url(#hatchFine)"/>
      </g>
    </g>
    <g id="wingNear" class="flight-part">
      <path d="M112 76 C128 36 160 -10 215 -48 L208 -32 L236 -40 L220 -22 L246 -24 L224 -6 L244 -2 L214 12 L232 20 L196 28 C170 44 145 64 128 90 Z" fill="#4a3424"/>
      <path d="M118 74 C132 46 155 18 182 0 C172 22 150 50 130 86 Z" fill="#a67d58"/>
      <path d="M150 34 C175 14 200 -4 226 -16 M160 40 C186 24 208 10 232 4 M140 52 C170 36 196 24 222 20" stroke="#d1aa80" stroke-width="1.2" fill="none"/>
      <path d="M112 76 C128 36 160 -10 215 -48 L208 -32 L236 -40 L220 -22 L246 -24 L224 -6 L244 -2 L214 12 L232 20 L196 28 C170 44 145 64 128 90 Z" fill="url(#hatch)" opacity="0.7"/>
      <ellipse cx="176" cy="18" rx="9" ry="5" fill="#f1e4c9" transform="rotate(-35 176 18)"/>
    </g>
  </g>
  <ellipse id="birdHit" cx="160" cy="98" rx="145" ry="68" fill="transparent" pointer-events="all">
    <title>点一下伯劳，让它起飞</title>
  </ellipse>`;
  const wingNear = bird.querySelector('#wingNear');
  const wingFar = bird.querySelector('#wingFar');
  const tail = bird.querySelector('#tail');

  /* ---------------- 树叶拼贴 ---------------- */
  function rng(seed) {
    let a = seed;
    return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; };
  }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const leafD = (len, wid) =>
    `M0 0 C${len * 0.28} ${-wid} ${len * 0.72} ${-wid * 0.85} ${len} 0 C${len * 0.72} ${wid * 0.85} ${len * 0.28} ${wid} 0 0 Z`;

  function cluster(parent, cx, cy, r, n, lenRange, palette, seed) {
    const R = rng(seed);
    const g = el('g', { filter: 'url(#cutout)' }, parent);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R()) * r;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8;
      const len = lenRange[0] + R() * (lenRange[1] - lenRange[0]);
      const rot = (a * 180 / Math.PI) + (R() - 0.5) * 70;
      const lg = el('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})` }, g);
      const d0 = leafD(len, len * (0.2 + R() * 0.1));
      el('path', { d: d0, fill: palette[Math.floor(R() * palette.length)] }, lg);
      if (R() < 0.4) el('path', { d: d0, fill: 'url(#hatchFine)' }, lg);
      el('path', { d: `M${len * 0.05} 0 L${len * 0.9} 0`, stroke: '#241a10', 'stroke-opacity': 0.45, 'stroke-width': Math.max(1, len * 0.02), fill: 'none' }, lg);
    }
  }
  const PAL_BACK = ['#8d9a63', '#a5a46a', '#7c8a5a', '#b9a25a'];
  const PAL_MID = ['#5f6b3a', '#76803f', '#4b5a34', '#a38a3c', '#8f9a55'];
  const PAL_FRONT = ['#3c4a2a', '#4d5a2f', '#2f3b22', '#6c5a2a'];
  const back = document.getElementById('treeLeavesBack');
  const mid = document.getElementById('treeLeaves');
  const front = document.getElementById('frontLeaves');
  cluster(back, 1490, 110, 170, 34, [46, 80], PAL_BACK, 11);
  cluster(back, 1300, 250, 120, 22, [40, 70], PAL_BACK, 23);
  cluster(back, 1560, 430, 150, 26, [44, 76], PAL_BACK, 37);
  cluster(back, 1170, 190, 90, 14, [36, 60], PAL_BACK, 41);
  cluster(mid, 1150, 405, 70, 14, [34, 58], PAL_MID, 53);
  cluster(mid, 1260, 540, 80, 14, [36, 62], PAL_MID, 61);
  cluster(mid, 1420, 210, 90, 16, [40, 66], PAL_MID, 71);
  cluster(mid, 1520, 640, 110, 18, [44, 74], PAL_MID, 83);
  cluster(front, 1600, 900, 230, 18, [140, 230], PAL_FRONT, 97);
  cluster(front, 1620, -10, 190, 14, [120, 200], PAL_FRONT, 101);
  cluster(front, -20, 910, 170, 12, [110, 180], PAL_FRONT, 113);

  /* ---------------- 图层与时间轴 ---------------- */
  const LAYERS = [
    { node: document.getElementById('lPaper'), depth: 0.0, delay: 0, rot: 0, dy: 0 },
    { node: document.getElementById('lSky'), depth: 0.12, delay: 120, rot: -2.2, dy: -36 },
    { node: document.getElementById('lMount'), depth: 0.3, delay: 300, rot: 1.6, dy: 40 },
    { node: document.getElementById('lType'), depth: 0.45, delay: 480, rot: -1.4, dy: -30 },
    { node: document.getElementById('lTree'), depth: 0.75, delay: 660, rot: 0, dy: 0, dx: 70 },
    { node: document.getElementById('lFront'), depth: 1.5, delay: 860, rot: 0, dy: 0, dx: 120 }
  ];
  const TREE = LAYERS[4];
  const ASM = 720;            // 每层拼贴入场时长
  const READY_AT = 1500;      // 拼贴完成、伯劳可以被点击的时刻
  const CROUCH = 180;         // 起飞前下蹲时长
  const FLY_DUR = 1500;
  const EXIT_AFTER = 1150;    // 起飞后多久开始过渡到画板
  const EXIT_DUR = 950;

  const PERCH = { x: 1030, y: 439 };   // 树枝上的落脚点（viewBox 坐标）
  const FEET = { x: 125, y: 150 };     // 伯劳脚的位置（鸟坐标）
  const CENTER = { x: 120, y: 85 };    // 伯劳身体中心（鸟坐标）
  const BIRD_UNITS = 1.08;             // 1 鸟单位 = 多少 viewBox 单位
  const RES = 2;                       // SVG 像素 / 鸟单位

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const backOut = (x) => { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const lerp = (a, b, k) => a + (b - a) * k;

  // launch：点击伯劳的时刻（未点击前为 Infinity，伯劳一直停在树枝上）
  let start = 0, raf = 0, launch = Infinity, exitAt = Infinity, exitDur = EXIT_DUR, done = false, leaves = [];
  let hovering = false, hoverK = 0, lastT = 0;
  const birdHit = bird.querySelector('#birdHit');
  const birdHint = document.getElementById('birdHint');

  function layerState(L, t, push) {
    const p = clamp01((t - L.delay) / ASM);
    const e = backOut(p);
    return {
      opacity: Math.min(1, p * 1.6),
      z: 1 + L.depth * push + (1 - e) * 0.05,
      tx: (1 - e) * (L.dx || 0),
      ty: (1 - e) * L.dy,
      rot: (1 - e) * L.rot
    };
  }

  function frame(now) {
    if (done) return;
    raf = requestAnimationFrame(frame);
    const t = FREEZE != null ? FREEZE : now - start;
    lastT = t;
    const W = innerWidth, H = innerHeight;
    const s = Math.max(W / 1600, H / 900);
    const ox = (W - 1600 * s) / 2, oy = (H - 900 * s) / 2;
    const cx = W / 2, cy = H / 2;
    const T_FLY = launch + CROUCH;

    // 推镜：前 3 秒缓慢推近，起飞后加速
    const fu = clamp01((t - T_FLY) / FLY_DUR);
    const push = 0.035 * clamp01(t / 3000) + 0.95 * Math.pow(fu, 2.1);

    let treeS = null;
    for (const L of LAYERS) {
      const st = layerState(L, t, push);
      L.node.style.opacity = st.opacity;
      L.node.style.transform = `translate(${st.tx}px,${st.ty}px) scale(${st.z}) rotate(${st.rot}deg)`;
      if (L === TREE) treeS = st;
    }

    // 落脚点的屏幕坐标（跟随树图层）
    const bx = ox + PERCH.x * s, by = oy + PERCH.y * s;
    const feetX = cx + (bx - cx) * treeS.z + treeS.tx;
    const feetY = cy + (by - cy) * treeS.z + treeS.ty;
    const perchPx = BIRD_UNITS * s * treeS.z;

    let px, py, scale, rot = 0, sy = 1;
    const flying = t >= T_FLY;
    if (!flying) {
      // 栖息：轻微的呼吸，循环地翘尾、点头，等待被点击
      hoverK += ((hovering && t < launch ? 1 : 0) - hoverK) * 0.18;
      scale = perchPx * (1 + 0.05 * hoverK);
      const bob = Math.sin(t / 380) * 0.6;
      const cyc = t > 1700 ? (t - 1700) % 3800 : -1;
      const flick = cyc >= 0 && cyc < 350 ? Math.sin(cyc / 350 * Math.PI) * 14 : 0;
      const nod = cyc >= 400 && cyc < 800 ? Math.sin((cyc - 400) / 400 * Math.PI) * -7 : 0;
      rot = nod + bob - 5 * hoverK; // 鼠标悬停时抬头看向你
      tail.setAttribute('transform', `rotate(${(flick + 6 * hoverK).toFixed(2)} 186 108)`);
      if (t > launch) { // 起飞前下蹲
        const c = (t - launch) / CROUCH;
        sy = 1 - Math.sin(c * Math.PI) * 0.1;
        rot -= c * 8;
      }
      px = feetX + (CENTER.x - FEET.x) * scale;
      py = feetY + (CENTER.y - FEET.y) * scale;
    } else {
      // 飞行：先向上起跳，然后朝镜头扑来
      const k = easeInOut(Math.min(1, fu * 1.05));
      const sx0 = feetX + (CENTER.x - FEET.x) * perchPx;
      const sy0 = feetY + (CENTER.y - FEET.y) * perchPx;
      const tx = cx - W * 0.04, ty = cy + H * 0.02;
      px = lerp(sx0, tx, k);
      py = lerp(sy0, ty, k) - Math.sin(Math.min(1, fu * 1.2) * Math.PI) * H * 0.16;
      const over = Math.max(0, (t - T_FLY) / FLY_DUR - 1);
      scale = perchPx * (1 + 24 * Math.pow(fu, 3) + over * 40);
      rot = -10 * Math.sin(fu * Math.PI) + 4 * fu;
      const flapHz = 5.2 - 1.6 * fu;
      const ph = (t - T_FLY) / 1000 * Math.PI * 2 * flapHz;
      const f1 = 0.12 + 0.88 * Math.cos(ph);
      const f2 = 0.12 + 0.88 * Math.cos(ph - 0.45);
      wingNear.setAttribute('transform', `translate(120 78) scale(1 ${f1.toFixed(3)}) translate(-120 -78)`);
      wingFar.setAttribute('transform', `translate(128 74) rotate(${(-6 * f2).toFixed(2)}) scale(0.92 ${f2.toFixed(3)}) translate(-128 -74)`);
      tail.setAttribute('transform', `rotate(${(-8 + 6 * Math.sin(ph)).toFixed(2)} 186 108)`);
      py += Math.sin(ph) * -4 * (scale / perchPx) ** 0.5;
    }
    bird.classList.toggle('flying', flying);
    birdWrap.classList.toggle('flying', flying);
    const awaiting = t >= READY_AT && t < launch && t < exitAt;
    bird.classList.toggle('await', awaiting);
    bird.classList.toggle('hover', hovering && awaiting);
    birdWrap.style.opacity = treeS.opacity;
    birdWrap.style.transform =
      `translate(${px}px,${py}px) rotate(${rot}deg) scale(${scale / RES}) scale(1,${sy}) translate(${-CENTER.x * RES}px,${-(CENTER.y + 80) * RES}px)`;

    // 提示标签：跟随伯劳，停在它头顶上方
    birdHint.classList.toggle('show', awaiting);
    if (!flying) {
      birdHint.style.transform = `translate(${(px - 30 * scale).toFixed(1)}px,${(py - 62 * scale).toFixed(1)}px)`;
    }

    // 起飞时抖落的树叶
    if (flying && !leaves.length) spawnLeaves(feetX, feetY, perchPx);
    for (const lf of leaves) {
      const a = (t - T_FLY - lf.delay) / 1000;
      if (a < 0) continue;
      lf.n.style.opacity = Math.max(0, 1 - a / 2.4);
      lf.n.style.transform = `translate(${lf.x + Math.sin(a * lf.sw) * 40 + lf.vx * a}px,${lf.y + a * a * 120 + a * 60}px) rotate(${lf.r + a * lf.vr}deg) scale(${lf.s})`;
    }

    // 过渡：伯劳掠过镜头 → 画板浮现
    const x = clamp01((t - exitAt) / exitDur);
    if (x > 0) {
      const e = easeInOut(x);
      intro.style.opacity = 1 - e;
      intro.style.filter = `blur(${(e * 14).toFixed(2)}px)`;
      app.style.transform = `scale(${1.14 - 0.14 * easeOut(x)})`;
      app.style.filter = `blur(${((1 - easeOut(x)) * 10).toFixed(2)}px)`;
      app.style.opacity = Math.min(1, x * 2.2);
      if (x > 0.35) document.body.classList.add('ui-in');
    }
    if (x >= 1) finish();
  }

  function spawnLeaves(x, y, px) {
    const R = rng(7);
    const pal = PAL_MID.concat(PAL_BACK);
    for (let i = 0; i < 9; i++) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '-5 -20 90 40');
      svg.setAttribute('width', 90); svg.setAttribute('height', 40);
      el('path', { d: leafD(80, 18), fill: pal[Math.floor(R() * pal.length)], stroke: '#241a10', 'stroke-opacity': 0.4 }, svg);
      fall.appendChild(svg);
      leaves.push({
        n: svg, x: x - 60 + R() * 200 * px, y: y - 40 - R() * 120 * px,
        r: R() * 360, vr: (R() - 0.5) * 260, sw: 2 + R() * 3, vx: (R() - 0.5) * 90,
        s: (0.35 + R() * 0.45) * px, delay: R() * 260
      });
    }
  }

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    intro.style.display = 'none';
    app.style.transform = app.style.filter = app.style.opacity = '';
    document.body.classList.remove('intro-running');
    document.body.classList.add('ui-in');
  }

  function skip() {
    if (done) return;
    const t = performance.now() - start;
    if (t < exitAt) { exitAt = t; exitDur = 650; }
  }

  /** 点击伯劳：起飞 → 飞向镜头 → 过渡到画板 */
  function takeOff() {
    if (done || launch !== Infinity || !start) return;
    const t = performance.now() - start;
    launch = Math.max(t, READY_AT);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    exitAt = reduce ? launch + 300 : launch + EXIT_AFTER;
    exitDur = reduce ? 600 : EXIT_DUR;
    hovering = false;
    intro.style.cursor = '';
  }

  function play() {
    cancelAnimationFrame(raf);
    done = false;
    leaves = [];
    fall.textContent = '';
    launch = Infinity; exitAt = Infinity; exitDur = EXIT_DUR;
    hovering = false; hoverK = 0; start = 0;
    intro.style.display = '';
    intro.style.opacity = 1;
    intro.style.filter = '';
    app.style.opacity = 0;
    document.body.classList.add('intro-running');
    document.body.classList.remove('ui-in');
    tail.removeAttribute('transform');
    LAYERS.forEach((L) => { L.node.style.opacity = 0; });
    birdWrap.style.opacity = 0;
    // 等待字体（最多 1.2 秒）以免标题闪烁
    const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([ready, new Promise((r) => setTimeout(r, 1200))]).then(() => {
      start = performance.now();
      raf = requestAnimationFrame(frame);
    });
  }

  skipBtn.addEventListener('click', skip);
  birdHit.addEventListener('click', (e) => { e.stopPropagation(); takeOff(); });
  birdHit.addEventListener('pointerenter', () => { hovering = true; });
  birdHit.addEventListener('pointerleave', () => { hovering = false; });
  addEventListener('keydown', (e) => {
    if (done) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeOff(); }   // 键盘也能让伯劳起飞
    else if (e.key === 'Escape') { e.preventDefault(); skip(); }
  });

  window.Intro = { play, skip, takeOff };

  // 调试参数：?intro=0 跳过开场；?freeze=3500 定格在某一毫秒；&launch=2000 模拟在该时刻点击伯劳
  const qs = new URLSearchParams(location.search);
  const FREEZE = qs.has('freeze') ? +qs.get('freeze') : null;
  if (qs.get('intro') === '0') { play(); finish(); }
  else {
    play();
    if (qs.has('launch')) { launch = +qs.get('launch'); exitAt = launch + EXIT_AFTER; }
  }
})();
