/* =========================================================
 *  board.js — 无限画板（手绘风格）+ 传送门维度系统
 * ========================================================= */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const TAU = Math.PI * 2;
  const STORE_KEY = 'lanius-board-v1';
  const SAVE_V = 7;   // 存档版本（v2 去作品集门；v3 主画板加「纪念碑谷维度」；v4 纪念碑谷换同层关卡；v5 「平走 + 台阶」；v6 屏幕投影连线 + 错觉平台；v7 走法改成「只看当前画面里亮顶面相不相接」，默认关卡换成整片平地）
  const HAND_FONT = '"Caveat","Long Cang","KaiTi","STKaiti","Segoe Print","Comic Sans MS",cursive';
  // 文字可选字体：优先用网络字体（Google Fonts），网络不通时回退到系统自带字体
  const FONTS = {
    hand:  { name: '手写',   stack: HAND_FONT },
    brush: { name: '毛笔',   stack: '"Ma Shan Zheng","Zhi Mang Xing","STXingkai","XingKai SC","KaiTi","STKaiti",cursive' },
    kai:   { name: '楷体',   stack: '"KaiTi","STKaiti","Kaiti SC","AR PL UKai CN","Noto Serif SC",serif' },
    song:  { name: '宋体',   stack: '"Noto Serif SC","Songti SC","SimSun","STSong",serif' },
    hei:   { name: '黑体',   stack: '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB","Helvetica Neue",Arial,sans-serif' },
    type:  { name: '打字机', stack: '"Special Elite","Courier New","FangSong","STFangsong",monospace' },
    round: { name: '趣圆',   stack: '"ZCOOL KuaiLe","YouYuan","Yuanti SC","Microsoft YaHei",sans-serif' }
  };
  const fontStack = (key) => (FONTS[key] || FONTS.hand).stack;
  const fontCss = (el) => `${el.fontSize}px ${fontStack(el.font)}`;
  const SERIF = '"Cormorant Garamond","Noto Serif SC",Georgia,serif';
  const SEL_COLOR = '#d2542f';

  const STYLES = {
    paper:     { name: '纸张画板', bg: '#f3ead6', grid: 'rgba(120,88,48,0.08)', major: 'rgba(120,88,48,0.16)', ink: '#1f1a14', kind: 'grid', noise: 0.5 },
    dots:      { name: '点阵画板', bg: '#fbfbf8', grid: 'rgba(30,30,30,0.22)', ink: '#1e1e1e', kind: 'dots', noise: 0 },
    dark:      { name: '暗夜画板', bg: '#15161c', grid: 'rgba(255,255,255,0.13)', ink: '#ece8de', kind: 'dots', noise: 0.35 },
    blueprint: { name: '蓝图画板', bg: '#1b4a80', grid: 'rgba(255,255,255,0.09)', major: 'rgba(255,255,255,0.22)', ink: '#eef5ff', kind: 'grid', noise: 0.25 },
    parkour:   { name: '跑酷维度', bg: '#e9f1f9', grid: 'rgba(46,80,110,0.10)', major: 'rgba(46,80,110,0.22)', ink: '#1e2a36', kind: 'grid', noise: 0.3 },
    monument:  { name: '纪念碑谷维度', bg: '#dfe9f2', bg2: '#a9c6dd', grid: 'rgba(40,70,100,0.12)', major: 'rgba(40,70,100,0.2)', ink: '#25313c', kind: 'none', noise: 0, sky: true }
  };

  /* ---------------- 画布 ---------------- */
  const canvas = $('#board');
  const ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const mctx = document.createElement('canvas').getContext('2d'); // 文字测量
  let W = 0, H = 0, DPR = 1;

  function resize() {
    W = innerWidth; H = innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  resize();
  addEventListener('resize', resize);

  // 纸张噪点纹理
  const noisePattern = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 220;
    const g = c.getContext('2d');
    const img = g.createImageData(220, 220);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v * 0.55; img.data[i + 1] = v * 0.42; img.data[i + 2] = v * 0.28;
      img.data[i + 3] = Math.random() < 0.5 ? Math.random() * 26 : 0;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  })();

  /* ---------------- 工具函数 ---------------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  const newSeed = () => Math.floor(Math.random() * 2147483647) + 1;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  const replacer = (k, v) => (k && k[0] === '_' ? undefined : v);
  const isSafeUrl = (u) => !/^\s*(javascript|data|vbscript):/i.test(u);

  /* ---------------- 元素构造 ---------------- */
  // 网络字体按需加载：用到某个字体和文字时才去请求，加载完成后重新测量排版
  const fontReq = new Set();
  function ensureFont(el) {
    if (!document.fonts || !document.fonts.load || !el.text) return;
    const key = (el.font || 'hand') + '|' + el.text;
    if (fontReq.has(key)) return;
    if (fontReq.size > 2000) fontReq.clear();
    fontReq.add(key);
    document.fonts.load(fontCss(el), el.text).then((r) => { if (r && r.length) remeasureAll(); }).catch(() => {});
  }
  function measureText(el) {
    ensureFont(el);
    mctx.font = fontCss(el);
    const lines = String(el.text).split('\n');
    let w = 0;
    for (const l of lines) w = Math.max(w, mctx.measureText(l || ' ').width);
    el.w = Math.ceil(w) + 2;
    el.h = Math.ceil(lines.length * el.fontSize * 1.25);
  }
  function textEl(x, y, text, fontSize, color) {
    const el = { type: 'text', id: uid(), x, y, text, fontSize, color: color || 'ink', seed: newSeed() };
    measureText(el);
    return el;
  }
  function portalEl(x, y, w, h, name, o) {
    return Object.assign({ type: 'portal', id: uid(), x, y, w, h, name, hue: 105, dest: 'scene', style: 'paper', seed: newSeed() }, o);
  }
  function shapeEl(type, x, y, w, h, o) {
    return Object.assign({ type, id: uid(), x, y, w, h, color: 'ink', width: 3, rough: 1, fill: 'none', seed: newSeed() }, o);
  }
  function lineEl(type, x, y, dx, dy, o) {
    return Object.assign({ type, id: uid(), x, y, points: [[0, 0], [dx, dy]], color: 'ink', width: 3, rough: 1, seed: newSeed() }, o);
  }
  /* 纪念碑谷维度：格子方块 / 格子传送门 */
  function cubeEl(i, j, k) {
    return { type: 'cube', id: uid(), x: Math.round(i), y: Math.round(j), z: Math.round(k), seed: newSeed() };
  }
  function mportalEl(i, j, k, name, o) {
    return Object.assign({ type: 'mportal', id: uid(), x: Math.round(i), y: Math.round(j), z: Math.round(k), name: name || '', hue: 105, dest: 'scene', style: 'paper', seed: newSeed() }, o);
  }
  /** 纪念碑谷维度的默认关卡：一整片平地（全部在 k=0）+ 远处的立体装饰。
      走法只看当前画面：两块方块的亮顶面在屏幕上相接就能走，接不上就走不了，
      不会出现抬脚爬高台 / 掉下台阶的动作。装饰用的孤岛 / 塔和主平地虽然
      画面上各自相接，但主平地这一整片是自成一个整体的，塔顶够不着。
      入口门在广场一角，出口传送门在走廊尽头的尾端平台上。 */
  function monumentLevel(s) {
    const add = (i, j, k) => { if (!s.els.some((e) => e && e.type === 'cube' && e.x === i && e.y === j && e.z === k)) s.els.push(cubeEl(i, j, k)); };
    // 能走的一整片平地（全在 k=0，之间只差同层的一格）
    add(0, 0, 0); add(1, 0, 0); add(2, 0, 0);
    add(0, 1, 0); add(1, 1, 0); add(2, 1, 0);
    add(0, 2, 0); add(1, 2, 0); add(2, 2, 0);
    add(3, 1, 0); add(4, 1, 0); add(5, 1, 0); add(6, 1, 0);
    add(6, 0, 0); add(6, -1, 0);
    add(5, -1, 0); add(4, -1, 0); add(3, -1, 0);
    add(3, -2, 0); add(3, -3, 0);
    add(4, -3, 0); add(5, -3, 0); add(6, -3, 0); add(6, -2, 0);
    // 背景装饰：远处的孤岛 + 几座塔（和主平地不相邻，够不着，只是让画面有高低）
    add(-3, 3, 0); add(-2, 3, 0); add(-3, 4, 0); add(-2, 4, 0);
    add(-4, 2, 0); add(-4, 3, 0);
    add(9, -2, 0); add(10, -2, 0); add(9, -3, 0); add(10, -3, 0);
    add(6, -6, 0); add(7, -6, 0); add(6, -7, 0); add(7, -7, 0);
    add(8, 1, 0); add(9, 1, 0); add(8, 2, 0); add(9, 2, 0);
    add(-4, 4, 0); add(-4, 4, 1); add(-4, 4, 2);
    add(-6, 1, 0); add(-6, 1, 1); add(-6, 1, 2); add(-6, 1, 3);
    add(1, 5, 0); add(1, 5, 1); add(1, 5, 2);
    s.els.push(mportalEl(0, 0, 0, '穿回上一个维度', { dest: 'back', hue: 105 }));
    s.els.push(mportalEl(6, -3, 0, '点阵维度', { dest: 'scene', style: 'dots', target: 'dim-dots', hue: 170 }));
  }

  function makeScene(id, title, style, withBack) {
    const s = { id, title, style, els: [], cam: { x: 60, y: -40, z: fitZoom(1000, 600) } };
    if (withBack) {
      if (style === 'monument' && window.Monument) {   // 纪念碑谷维度：自带一小段关卡
        monumentLevel(s);
        s.cam = Monument.defaultCam(s);
        return s;
      }
      s.els.push(portalEl(-280, -80, 180, 240, '穿回上一个维度', { dest: 'back', hue: 105 }));
      if (style === 'parkour') {
        // 入口传送门下方的初始平台由 parkour.js 在渲染时生成（始终跟着入口门）
        s.els.push(textEl(-470, 382, title, 54));
        s.els.push(textEl(-466, 450, 'A / D 走路 · 空格跳跃 · 靠近传送门按 E 穿越', 26, '#c8442b'));
        s.els.push(textEl(-466, 488, '用上方的画笔工具画出的线条，就是火柴人的地面', 24));
        // 一条通往高处的小跑道
        s.els.push(lineEl('line', 120, 130, 190, 5, { color: '#2b3a46', width: 14, rough: 0.4 }));
        s.els.push(lineEl('line', 420, 40, 200, -8, { color: '#2b3a46', width: 14, rough: 0.4 }));
        s.els.push(lineEl('line', 740, -60, 190, 6, { color: '#2b3a46', width: 14, rough: 0.4 }));
        s.els.push(lineEl('line', 1060, -170, 180, -5, { color: '#2b3a46', width: 14, rough: 0.4 }));
        s.els.push(portalEl(1330, -450, 170, 230, '点阵维度', { dest: 'scene', style: 'dots', target: 'dim-dots', hue: 170 }));
        s.cam = { x: -150, y: 90, z: fitZoom(1400, 900) };
      } else {
        s.els.push(textEl(-300, -260, title, 60));
        s.els.push(textEl(-296, -180, '欢迎来到新维度。拿起画笔随便画点什么吧。', 26, '#c8442b'));
        s.els.push(lineEl('arrow', 140, 150, -150, -40, { color: '#c8442b', width: 2.5 }));
        s.els.push(textEl(150, 130, '想回去？点这个传送门', 28));
      }
    }
    return s;
  }

  function fitZoom(cw, ch) {
    return clamp(Math.min((W - 80) / cw, (H - 160) / ch, 1), 0.35, 1);
  }

  function defaultState() {
    const main = makeScene('main', '主画板', 'paper', false);
    main.cam = { x: 60, y: -80, z: fitZoom(2350, 1000) };
    const E = main.els;
    E.push(textEl(-600, -420, '伯劳的无限画板', 76));
    E.push(textEl(-596, -326, '点击传送门即可穿越 · 用顶部的「传送门」工具创造你自己的维度', 27, '#7a2a18'));
    E.push(shapeEl('ellipse', 120, -440, 92, 92, { color: '#c8442b', fill: 'hachure', width: 2.5 }));
    E.push(portalEl(-250, -160, 200, 270, '纸张维度', { dest: 'scene', style: 'paper', target: 'dim-paper', hue: 135 }));
    E.push(portalEl(70, -180, 210, 290, '暗夜维度', { dest: 'scene', style: 'dark', target: 'dim-dark', hue: 285 }));
    E.push(portalEl(400, -160, 200, 270, '蓝图维度', { dest: 'scene', style: 'blueprint', target: 'dim-blue', hue: 175 }));
    E.push(portalEl(720, -190, 210, 290, '跑酷维度', { dest: 'scene', style: 'parkour', target: 'dim-parkour', hue: 170 }));
    E.push(portalEl(1040, -190, 210, 290, '纪念碑谷维度', { dest: 'scene', style: 'monument', target: 'dim-monument', hue: 35 }));
    E.push(textEl(-676, 250, '从这里开始！', 34, '#c8442b'));
    E.push(lineEl('arrow', -460, 240, 150, -180, { color: '#c8442b', width: 3 }));
    const tip = textEl(270, 300, '空格 + 拖动：平移\nCtrl + 滚轮：缩放\n右键传送门：修改目的地', 24);
    E.push(shapeEl('rect', 250, 285, tip.w + 40, tip.h + 30, { fill: 'none', width: 2 }));
    E.push(tip);
    return { current: 'main', scenes: { main } };
  }

  /* ---------------- 状态 / 存档 ---------------- */
  let state = null;   // 在下方数据校验函数定义之后再初始化
  const hist = {};
  let saveTimer = 0;
  let migrated = false;   // 载入旧存档时做过一次升级

  /** 旧版默认画板里的「作品集（网页）」传送门，升级时清掉 */
  const isOldPortfolio = (e) => !!e && e.type === 'portal' && e.dest === 'web'
    && typeof e.src === 'string' && e.src.indexOf('portfolio/') === 0;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d && !(d.v >= 2)) {               // v1 → v2：去掉作品集传送门
        let cleaned = false;
        for (const s of Object.values(d.scenes || {})) {
          if (!s || !Array.isArray(s.els)) continue;
          const before = s.els.length;
          s.els = s.els.filter((e) => !isOldPortfolio(e));
          if (s.els.length !== before) cleaned = true;
        }
        // 画板少了一扇门，取景跟着重算（只在这还是原版布局时才动镜头）
        const main = d.scenes && d.scenes.main;
        if (cleaned && main && Array.isArray(main.els) && main.els.some((e) => e && e.target === 'dim-parkour')) {
          main.cam = { x: 60, y: -80, z: fitZoom(2350, 1000) };
        }
        migrated = true;
      }
      if (d && !(d.v >= 3)) {               // v2 → v3：主画板补上「纪念碑谷维度」传送门
        const main = d.scenes && d.scenes.main;
        if (main && Array.isArray(main.els)
          && ['dim-paper', 'dim-dark', 'dim-blue', 'dim-parkour'].every((t) => main.els.some((e) => e && e.type === 'portal' && e.target === t))
          && !main.els.some((e) => e && e.type === 'portal' && e.target === 'dim-monument')) {
          main.els.push({
            type: 'portal', id: 'p-monument', x: 1040, y: -190, w: 210, h: 290,
            name: '纪念碑谷维度', hue: 35, dest: 'scene', style: 'monument',
            target: 'dim-monument', seed: 991237
          });
          main.cam = { x: 60, y: -80, z: fitZoom(2350, 1000) };
          migrated = true;
        }
      }
      if (d && !(d.v >= 7)) {               // v6 → v7：走法改成「只看当前画面里亮顶面相不相接」，
        const mo = d.scenes && d.scenes['dim-monument'];   // 老默认关卡是一道台阶 → 换成整片平地的关卡
        const isOldDefault = mo && Array.isArray(mo.els) && mo.els.some((e) => e && e.type === 'cube'
          && ((e.x === 0 && e.y === -3 && e.z === -3) || (e.x === 1 && e.y === -5 && e.z === -1)
            || (e.x === 2 && e.y === -5 && e.z === -1) || (e.x === 4 && e.y === -3 && e.z === 0)
            || (e.x === 5 && e.y === -3 && e.z === 0)));
        if (isOldDefault) {
          mo.els = [];
          monumentLevel(mo);
          if (window.Monument) mo.cam = window.Monument.defaultCam(mo);
          migrated = true;
        }
      }
      if (d && !(d.v >= 6)) {               // v5 → v6：纪念碑谷顶上那块平台改成「屏幕重合」的错觉平台，
        const mo = d.scenes && d.scenes['dim-monument'];   // 老默认关卡顶上那两格 (4,-3,0)/(5,-3,0) 就是旧版
        const isOldDefault = mo && Array.isArray(mo.els) && mo.els.some((e) => e && e.type === 'cube'
          && ((e.x === 4 && e.y === -3 && e.z === 0) || (e.x === 5 && e.y === -3 && e.z === 0)));
        if (isOldDefault) {
          mo.els = [];
          monumentLevel(mo);
          if (window.Monument) mo.cam = window.Monument.defaultCam(mo);
          migrated = true;
        }
      }
      if (d && !(d.v >= 5)) {               // v4 → v5：纪念碑谷的走法改成「平走 + 差一层的台阶」，
        const mo = d.scenes && d.scenes['dim-monument'];   // 老默认关卡的斜角路走不了了 → 换成新关卡
        const isOldDefault = mo && Array.isArray(mo.els) && mo.els.some((e) => e && e.type === 'cube'
          && (e.z < 0 || (e.x === 12 && e.y === 6) || (e.x === 10 && e.y === 5)
            || (e.x === 8 && e.y === 6) || (e.x === 5 && e.y === 5)));
        if (isOldDefault) {
          mo.els = [];
          monumentLevel(mo);
          if (window.Monument) mo.cam = window.Monument.defaultCam(mo);
          migrated = true;
        }
      }
      if (d && !(d.v >= 4)) {               // v3 → v4：纪念碑谷的走法改成「同层才能走」，
        const mo = d.scenes && d.scenes['dim-monument'];   // 老关卡的高台爬不上去了 → 换成新关卡
        if (mo && Array.isArray(mo.els)
          && mo.els.some((e) => e && e.type === 'cube' && e.z < 0)) {   // 老关卡掉到 z=-1 的那段天桥
          mo.els = [];
          monumentLevel(mo);
          if (window.Monument) mo.cam = window.Monument.defaultCam(mo);
          migrated = true;
        }
      }
      return sanitizeState(d);
    } catch (e) { return null; }
  }

  /* ---------- 数据校验（本地存档与导入文件共用） ---------- */
  const EL_TYPES = new Set(['rect', 'ellipse', 'line', 'arrow', 'pen', 'text', 'portal', 'cube', 'mportal']);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const str = (v, d, max) => (typeof v === 'string' ? v.slice(0, max || 2000) : d);
  const COLOR_RE = /^(ink|#[0-9a-f]{3,8})$/i;
  function sanitizeEl(e) {
    if (!e || typeof e !== 'object' || !EL_TYPES.has(e.type)) return null;
    const o = {
      type: e.type, id: str(e.id, '', 40) || uid(),
      x: num(e.x, 0), y: num(e.y, 0),
      seed: Math.floor(num(e.seed, 0)) || newSeed()
    };
    if (e.type === 'cube') {
      o.x = Math.round(num(e.x, 0)); o.y = Math.round(num(e.y, 0)); o.z = Math.round(num(e.z, 0));
      return o;
    }
    if (e.type === 'portal' || e.type === 'mportal') {
      if (e.type === 'mportal') {
        o.x = Math.round(num(e.x, 0)); o.y = Math.round(num(e.y, 0)); o.z = Math.round(num(e.z, 0));
      } else {
        o.w = Math.max(10, num(e.w, 190)); o.h = Math.max(10, num(e.h, 250));
      }
      o.name = str(e.name, '', 80);
      o.hue = clamp(num(e.hue, 105), 0, 360);
      o.dest = ['scene', 'web', 'back'].includes(e.dest) ? e.dest : 'scene';
      o.style = STYLES[e.style] ? e.style : 'paper';
      if (o.dest === 'web') {
        const src = str(e.src, '', 2000);
        if (!src || !isSafeUrl(src)) { o.dest = 'scene'; } else o.src = src;
      }
      if (typeof e.target === 'string') o.target = e.target.slice(0, 60);
      return o;
    }
    o.color = typeof e.color === 'string' && COLOR_RE.test(e.color) ? e.color : 'ink';
    if (e.type === 'text') {
      o.text = str(e.text, '', 20000);
      o.fontSize = clamp(num(e.fontSize, 30), 4, 800);
      o.font = typeof e.font === 'string' && Object.prototype.hasOwnProperty.call(FONTS, e.font) ? e.font : 'hand';
      measureText(o);
      return o.text ? o : null;
    }
    o.width = clamp(num(e.width, 3), 0.5, 60);
    if (e.type === 'pen' || e.type === 'line' || e.type === 'arrow') {
      if (!Array.isArray(e.points)) return null;
      o.points = e.points.slice(0, 50000)
        .filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))
        .map((p) => [+p[0], +p[1]]);
      if (!o.points.length) return null;
      if (e.type !== 'pen') {
        while (o.points.length < 2) o.points.push(o.points[0].slice());
        o.points.length = 2;
        o.rough = clamp(num(e.rough, 1), 0, 5);
      }
      return o;
    }
    o.w = Math.max(0, num(e.w, 0)); o.h = Math.max(0, num(e.h, 0));
    o.rough = clamp(num(e.rough, 1), 0, 5);
    o.fill = ['none', 'hachure', 'solid'].includes(e.fill) ? e.fill : 'none';
    return o;
  }
  function sanitizeState(d) {
    if (!d || typeof d !== 'object' || !d.scenes || typeof d.scenes !== 'object') return null;
    if (!d.scenes.main || !Array.isArray(d.scenes.main.els)) return null;
    const scenes = {};
    for (const id of Object.keys(d.scenes).slice(0, 500)) {
      const s = d.scenes[id];
      if (!s || typeof s !== 'object' || !Array.isArray(s.els)) continue;
      const cam = s.cam && typeof s.cam === 'object' ? s.cam : {};
      scenes[id] = {
        id, title: str(s.title, id === 'main' ? '主画板' : '新维度', 80),
        style: STYLES[s.style] ? s.style : 'paper',
        cam: { x: num(cam.x, 0), y: num(cam.y, 0), z: clamp(num(cam.z, 1), 0.1, 8) },
        els: s.els.map(sanitizeEl).filter(Boolean)
      };
    }
    return { current: 'main', scenes };
  }

  const stored = load();
  state = stored || defaultState();
  state.current = 'main';
  // 是否有尚未保存到本地文件的改动（浏览器里有旧存档时，保守地视为有改动）
  let dirty = !!stored;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: SAVE_V, scenes: state.scenes }, replacer)); } catch (e) { /* 存储已满或被禁用 */ }
    }, 300);
  }
  if (migrated) save();   // 升级过就立刻写回，免得每次打开都重复清理
  const scene = () => state.scenes[state.current];
  const serialize = () => JSON.stringify(scene().els, replacer);
  function H_() { return hist[state.current] || (hist[state.current] = { undo: [], redo: [] }); }
  function finishChange(before) {
    if (before == null) return;
    if (serialize() !== before) {
      dirty = true;
      const h = H_();
      h.undo.push(before);
      if (h.undo.length > 120) h.undo.shift();
      h.redo.length = 0;
      save();
    }
  }
  function mutate(fn) { const b = serialize(); fn(); finishChange(b); }
  function undo() {
    const h = H_(); if (!h.undo.length) return;
    h.redo.push(serialize()); scene().els = JSON.parse(h.undo.pop());
    dirty = true; remeasureAll(); selection.clear(); save();
  }
  function redo() {
    const h = H_(); if (!h.redo.length) return;
    h.undo.push(serialize()); scene().els = JSON.parse(h.redo.pop());
    dirty = true; remeasureAll(); selection.clear(); save();
  }
  function remeasureAll() {
    for (const id in state.scenes) for (const el of state.scenes[id].els) if (el.type === 'text') measureText(el);
  }

  /* ---------------- 相机 ---------------- */
  const toWorld = (sx, sy) => { const c = scene().cam; return { x: (sx - W / 2) / c.z + c.x, y: (sy - H / 2) / c.z + c.y }; };
  const toScreen = (wx, wy) => { const c = scene().cam; return { x: (wx - c.x) * c.z + W / 2, y: (wy - c.y) * c.z + H / 2 }; };
  function zoomAt(sx, sy, f) {
    const c = scene().cam;
    const before = toWorld(sx, sy);
    c.z = clamp(c.z * f, 0.1, 8);
    c.x = before.x - (sx - W / 2) / c.z;
    c.y = before.y - (sy - H / 2) / c.z;
    updateZoomLabel(); save();
  }
  function updateZoomLabel() { $('#zoomLabel').textContent = Math.round(scene().cam.z * 100) + '%'; }

  /* ---------------- 几何 ---------------- */
  function bounds(el) {
    if ((el.type === 'cube' || el.type === 'mportal') && window.Monument) return Monument.boundsOf(el);
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'pen') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of el.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      return { x: el.x + x0, y: el.y + y0, w: x1 - x0, h: y1 - y0 };
    }
    if (el.type === 'portal') {
      const lb = el._label;
      if (lb) {
        const x = Math.min(el.x, lb.x), y = el.y, r = Math.max(el.x + el.w, lb.x + lb.w), b = Math.max(el.y + el.h, lb.y + lb.h);
        return { x, y, w: r - x, h: b - y };
      }
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
  function unionBounds(els) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) { const b = bounds(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  function hitEl(el, x, y, tol) {
    switch (el.type) {
      case 'line': case 'arrow': case 'pen': {
        const p = el.points, t = tol + el.width / 2;
        if (p.length === 1) return Math.hypot(x - el.x - p[0][0], y - el.y - p[0][1]) <= t;
        for (let i = 1; i < p.length; i++) {
          if (distToSeg(x, y, el.x + p[i - 1][0], el.y + p[i - 1][1], el.x + p[i][0], el.y + p[i][1]) <= t) return true;
        }
        return false;
      }
      case 'ellipse': {
        const rx = el.w / 2 + tol, ry = el.h / 2 + tol;
        const dx = x - (el.x + el.w / 2), dy = y - (el.y + el.h / 2);
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
      }
      case 'portal': {
        const rx = el.w / 2 * 1.05 + tol, ry = el.h / 2 * 1.05 + tol;
        const dx = x - (el.x + el.w / 2), dy = y - (el.y + el.h / 2);
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return true;
        const lb = el._label;
        return !!lb && x >= lb.x && x <= lb.x + lb.w && y >= lb.y && y <= lb.y + lb.h;
      }
      case 'cube': case 'mportal':
        return window.Monument ? Monument.hitOf(el, x, y, tol) : false;
      default:
        return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
    }
  }
  function hitTest(x, y, onlyPortal) {
    const els = scene().els, tol = 6 / scene().cam.z;
    for (let i = els.length - 1; i >= 0; i--) {
      const e = els[i];
      if (onlyPortal && e.type !== 'portal') continue;
      if (hitEl(e, x, y, tol)) return e;
    }
    return null;
  }

  /* ---------------- 手绘渲染 ---------------- */
  function roughLine(c, x1, y1, x2, y2, r, rnd, single) {
    if (r <= 0) { c.moveTo(x1, y1); c.lineTo(x2, y2); return; }
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const m = r * Math.min(3, 0.5 + len * 0.008);
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const passes = single ? 1 : 2;
    for (let p = 0; p < passes; p++) {
      const k = p ? 1.1 : 0.6;
      const j = () => (rnd() - 0.5) * 2 * m * k;
      const mt = 0.45 + rnd() * 0.1, bow = (rnd() - 0.5) * m * 1.8;
      c.moveTo(x1 + j(), y1 + j());
      c.quadraticCurveTo(x1 + (x2 - x1) * mt + nx * bow, y1 + (y2 - y1) * mt + ny * bow, x2 + j(), y2 + j());
    }
  }
  function roughRect(c, x, y, w, h, r, rnd) {
    c.beginPath();
    roughLine(c, x, y, x + w, y, r, rnd);
    roughLine(c, x + w, y, x + w, y + h, r, rnd);
    roughLine(c, x + w, y + h, x, y + h, r, rnd);
    roughLine(c, x, y + h, x, y, r, rnd);
    c.stroke();
  }
  function roughEllipse(c, cx, cy, rx, ry, r, rnd) {
    c.beginPath();
    if (r <= 0) { c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.stroke(); return; }
    for (let p = 0; p < 2; p++) {
      const n = clamp(Math.round((rx + ry) / 10), 12, 32);
      const start = rnd() * TAU;
      const total = TAU + (0.15 + rnd() * 0.35) * (p ? 1 : 0.6);
      const steps = Math.ceil(n * total / TAU);
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = start + total * i / steps;
        const k = 1 + (rnd() - 0.5) * 0.05 * r;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      const l = pts[pts.length - 1]; c.lineTo(l[0], l[1]);
    }
    c.stroke();
  }
  function hachure(c, b, col, width, r, rnd) {
    const gap = Math.max(7, width * 3.2);
    const ang = -0.72, cos = Math.cos(ang), sin = Math.sin(ang);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = Math.hypot(b.w, b.h) / 2 + gap;
    c.strokeStyle = col; c.lineWidth = Math.max(1, width * 0.55);
    c.beginPath();
    for (let d = -R; d <= R; d += gap) {
      const nx = -sin * d, ny = cos * d;
      roughLine(c, cx + nx - cos * R, cy + ny - sin * R, cx + nx + cos * R, cy + ny + sin * R, r * 0.5, rnd, true);
    }
    c.stroke();
  }
  function fillShape(c, el, col, rnd, pathFn) {
    if (!el.fill || el.fill === 'none') return;
    c.save();
    pathFn();
    if (el.fill === 'solid') {
      c.globalAlpha *= 0.3; c.fillStyle = col; c.fill();
    } else {
      c.clip();
      hachure(c, el, col, el.width, el.rough, rnd);
    }
    c.restore();
  }

  function destLabel(el) {
    if (el.dest === 'back') return '← RETURN';
    if (el.dest === 'web') return '→ WEB PAGE';
    return '→ ' + (STYLES[el.style] ? STYLES[el.style].name : '画板');
  }

  function drawPortal(c, el, t) {
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const hov = hoverId === el.id;
    Portal.draw(c, cx, cy, el.w / 2, el.h / 2, t, el.hue, { seed: (el.seed % 1000) / 100, glow: hov ? 1.6 : 1, speed: hov ? 1.9 : 1 });

    // 拼贴标签
    const fs = clamp(el.w * 0.12, 16, 40);
    c.font = `700 ${fs}px ${HAND_FONT}`;
    const name = el.name || '未命名维度';
    const tw = c.measureText(name).width;
    const sub = destLabel(el);
    const sfs = fs * 0.46;
    c.font = `600 ${sfs}px ${SERIF}`;
    const sw = c.measureText(sub).width + sub.length * sfs * 0.12;
    const pad = fs * 0.55;
    const lw = Math.max(tw, sw) + pad * 2, lh = fs * 1.15 + sfs * 1.5 + pad * 0.6;
    const lx = cx - lw / 2, ly = el.y + el.h + fs * 0.55;
    el._label = { x: lx, y: ly, w: lw, h: lh };
    const rot = (((el.seed % 9) - 4) * 0.008);
    c.save();
    c.translate(cx, ly + lh / 2); c.rotate(rot); c.translate(-cx, -(ly + lh / 2));
    c.fillStyle = 'rgba(30,18,8,0.28)';
    c.fillRect(lx + 4, ly + 5, lw, lh);
    c.fillStyle = '#f7efdc';
    c.fillRect(lx, ly, lw, lh);
    c.strokeStyle = 'rgba(42,29,18,0.55)'; c.lineWidth = 1;
    c.strokeRect(lx + 0.5, ly + 0.5, lw - 1, lh - 1);
    // 胶带
    c.fillStyle = `hsla(${el.hue - 20},70%,70%,0.55)`;
    c.save(); c.translate(cx, ly); c.rotate(-0.06); c.fillRect(-fs * 1.1, -fs * 0.28, fs * 2.2, fs * 0.56); c.restore();
    c.fillStyle = '#1f1a14';
    c.textBaseline = 'top'; c.textAlign = 'center';
    c.font = `700 ${fs}px ${HAND_FONT}`;
    c.fillText(name, cx, ly + pad * 0.45);
    c.font = `600 ${sfs}px ${SERIF}`;
    c.fillStyle = `hsl(${el.hue + 10},55%,30%)`;
    if ('letterSpacing' in c) c.letterSpacing = (sfs * 0.12) + 'px';
    c.fillText(sub, cx, ly + pad * 0.45 + fs * 1.12);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.textAlign = 'left';
    c.restore();
  }

  function drawEl(c, el, st, t) {
    if (el._editing) return;
    const col = el.color === 'ink' || !el.color ? st.ink : el.color;
    c.save();
    if (erasing.has(el.id)) c.globalAlpha = 0.22;
    c.lineCap = 'round'; c.lineJoin = 'round';
    const rnd = rng(el.seed);
    switch (el.type) {
      case 'rect': {
        fillShape(c, el, col, rnd, () => { c.beginPath(); c.rect(el.x, el.y, el.w, el.h); });
        c.strokeStyle = col; c.lineWidth = el.width;
        roughRect(c, el.x, el.y, el.w, el.h, el.rough, rng(el.seed + 7));
        break;
      }
      case 'ellipse': {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        fillShape(c, el, col, rnd, () => { c.beginPath(); c.ellipse(cx, cy, el.w / 2, el.h / 2, 0, 0, TAU); });
        c.strokeStyle = col; c.lineWidth = el.width;
        roughEllipse(c, cx, cy, el.w / 2, el.h / 2, el.rough, rng(el.seed + 7));
        break;
      }
      case 'line': case 'arrow': {
        const [p0, p1] = el.points;
        const x1 = el.x + p0[0], y1 = el.y + p0[1], x2 = el.x + p1[0], y2 = el.y + p1[1];
        c.strokeStyle = col; c.lineWidth = el.width;
        c.beginPath();
        roughLine(c, x1, y1, x2, y2, el.rough, rnd);
        if (el.type === 'arrow') {
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len > 2) {
            const a = Math.atan2(y2 - y1, x2 - x1);
            const L = Math.min(18 + el.width * 2.5, len * 0.45);
            for (const s of [-1, 1]) {
              roughLine(c, x2, y2, x2 - Math.cos(a + s * 0.45) * L, y2 - Math.sin(a + s * 0.45) * L, el.rough * 0.6, rnd, true);
            }
          }
        }
        c.stroke();
        break;
      }
      case 'pen': {
        const p = el.points;
        c.strokeStyle = col; c.fillStyle = col; c.lineWidth = el.width;
        if (p.length === 1) {
          c.beginPath(); c.arc(el.x + p[0][0], el.y + p[0][1], el.width / 2, 0, TAU); c.fill();
          break;
        }
        c.beginPath();
        c.moveTo(el.x + p[0][0], el.y + p[0][1]);
        for (let i = 1; i < p.length - 1; i++) {
          c.quadraticCurveTo(el.x + p[i][0], el.y + p[i][1], el.x + (p[i][0] + p[i + 1][0]) / 2, el.y + (p[i][1] + p[i + 1][1]) / 2);
        }
        const l = p[p.length - 1]; c.lineTo(el.x + l[0], el.y + l[1]);
        c.stroke();
        break;
      }
      case 'text': {
        c.font = fontCss(el);
        c.fillStyle = col; c.textBaseline = 'top';
        String(el.text).split('\n').forEach((line, i) => c.fillText(line, el.x, el.y + i * el.fontSize * 1.25 + el.fontSize * 0.08));
        break;
      }
      case 'portal':
        drawPortal(c, el, t);
        break;
    }
    c.restore();
  }

  function drawBackground(c, st, cam, w, h) {
    c.fillStyle = st.bg;
    c.fillRect(0, 0, w, h);
    if (st.kind === 'none') {
      if (st.sky) {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, st.bg2 || st.bg); g.addColorStop(1, st.bg);
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      }
      return;
    }
    const z = cam.z;
    let step = 24;
    while (step * z < 12) step *= 5;
    const left = cam.x - w / 2 / z, top = cam.y - h / 2 / z;
    const right = left + w / z, bottom = top + h / z;
    if (st.kind === 'grid') {
      const lines = (s, color) => {
        c.beginPath();
        for (let x = Math.floor(left / s) * s; x <= right; x += s) { const X = Math.round((x - left) * z) + 0.5; c.moveTo(X, 0); c.lineTo(X, h); }
        for (let y = Math.floor(top / s) * s; y <= bottom; y += s) { const Y = Math.round((y - top) * z) + 0.5; c.moveTo(0, Y); c.lineTo(w, Y); }
        c.strokeStyle = color; c.lineWidth = 1; c.stroke();
      };
      lines(step, st.grid);
      lines(step * 5, st.major);
    } else {
      const s = step * (step * z < 18 ? 2 : 1);
      const r = clamp(1.3 * Math.sqrt(z), 0.8, 2);
      c.fillStyle = st.grid;
      for (let x = Math.floor(left / s) * s; x <= right; x += s) {
        const X = (x - left) * z;
        for (let y = Math.floor(top / s) * s; y <= bottom; y += s) c.fillRect(X - r / 2, (y - top) * z - r / 2, r, r);
      }
    }
    if (st.noise) {
      c.globalAlpha = st.noise; c.fillStyle = noisePattern; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
    }
  }

  function render(t) {
    const sc = scene(), st = STYLES[sc.style], cam = sc.cam;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground(ctx, st, cam, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(cam.z, cam.z); ctx.translate(-cam.x, -cam.y);
    const vx0 = cam.x - W / 2 / cam.z - 200, vy0 = cam.y - H / 2 / cam.z - 200;
    const vx1 = cam.x + W / 2 / cam.z + 200, vy1 = cam.y + H / 2 / cam.z + 200;
    const is3d = sc.style === 'monument' && window.Monument;
    if (!is3d) for (const el of sc.els) {
      const b = bounds(el);
      if (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0) continue;
      drawEl(ctx, el, st, t);
    }
    // 选择框
    if (!is3d && selection.size) {
      const sel = sc.els.filter((e) => selection.has(e.id));
      const pad = 6 / cam.z;
      ctx.strokeStyle = SEL_COLOR; ctx.lineWidth = 1.2 / cam.z;
      ctx.setLineDash([5 / cam.z, 4 / cam.z]);
      for (const e of sel) { const b = bounds(e); ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2); }
      ctx.setLineDash([]);
      const ub = unionBounds(sel);
      if (ub) {
        if (sel.length > 1) { ctx.lineWidth = 1 / cam.z; ctx.strokeRect(ub.x - pad * 2, ub.y - pad * 2, ub.w + pad * 4, ub.h + pad * 4); }
        const hs = 10 / cam.z, hp = handlePos(ub);
        ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5 / cam.z;
        ctx.fillRect(hp.x - hs / 2, hp.y - hs / 2, hs, hs);
        ctx.strokeRect(hp.x - hs / 2, hp.y - hs / 2, hs, hs);
      }
    }
    if (action && action.type === 'marquee') {
      const x = Math.min(action.x0, action.x1), y = Math.min(action.y0, action.y1);
      ctx.fillStyle = 'rgba(210,84,47,0.07)';
      ctx.strokeStyle = SEL_COLOR; ctx.lineWidth = 1 / cam.z;
      ctx.fillRect(x, y, Math.abs(action.x1 - action.x0), Math.abs(action.y1 - action.y0));
      ctx.strokeRect(x, y, Math.abs(action.x1 - action.x0), Math.abs(action.y1 - action.y0));
    }
    // 跑酷维度：火柴人 + 初始平台（画在所有元素之上）
    if (window.Parkour) Parkour.draw(ctx, st, t);
    // 纪念碑谷维度：等距方块 + 红色小方块（自己画全部）
    if (is3d) Monument.draw(ctx, st, t);
    ctx.restore();
  }
  function handlePos(ub) { const pad = 12 / scene().cam.z; return { x: ub.x + ub.w + pad, y: ub.y + ub.h + pad }; }

  /* ---------------- 交互状态 ---------------- */
  let tool = 'select';
  let action = null;
  let hoverId = null;
  let spaceDown = false;
  let view = 'board';
  let clipboard = null;
  let lastPointer = { x: W / 2, y: H / 2 };
  const selection = new Set();
  const erasing = new Set();
  const pointers = new Map();
  let pinch = null;
  const props = { color: 'ink', fill: 'none', width: 3, rough: 1, font: 30, ff: 'hand' };

  function setTool(t) {
    tool = t;
    $$('.toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    if (t !== 'select') selection.clear();
    updateCursor(null, false);
  }
  function updateCursor(hit, onHandle) {
    let c = 'default';
    if (spaceDown) c = 'grab';
    else if (tool === 'hand') c = hit && hit.type === 'portal' ? 'pointer' : 'grab';
    else if (tool === 'select') c = onHandle ? 'nwse-resize' : hit ? (hit.type === 'portal' ? 'pointer' : 'move') : 'default';
    else if (tool === 'text') c = 'text';
    else if (tool === 'eraser') c = 'cell';
    else c = 'crosshair';
    if (action && action.type === 'pan') c = 'grabbing';
    canvas.style.cursor = c;
  }
  function onHandle(w) {
    if (!selection.size) return false;
    const ub = unionBounds(scene().els.filter((e) => selection.has(e.id)));
    if (!ub) return false;
    const hp = handlePos(ub), r = 10 / scene().cam.z;
    return Math.abs(w.x - hp.x) <= r && Math.abs(w.y - hp.y) <= r;
  }
  const selectedEls = () => scene().els.filter((e) => selection.has(e.id));
  const cloneEl = (e) => JSON.parse(JSON.stringify(e, replacer));

  function startMove(w0, before) {
    return { type: 'move', w0, before, orig: selectedEls().map((e) => ({ el: e, x: e.x, y: e.y })) };
  }

  /* ---------------- 指针事件 ---------------- */
  canvas.addEventListener('pointerdown', (e) => {
    if (view !== 'board' || Portal.Warp.running) return;
    closeMenus();
    if (editing) { commitText(); if (tool === 'text') return; }
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (window.Monument && Monument.active && Monument.pointerDown(e)) return;
    if (pointers.size > 2 || e.button === 2) return;
    const w = toWorld(e.clientX, e.clientY);
    const before = serialize();

    if (e.button === 1 || spaceDown || tool === 'hand') {
      const portal = tool === 'hand' && e.button === 0 && !spaceDown ? hitTest(w.x, w.y, true) : null;
      action = { type: 'pan', sx: e.clientX, sy: e.clientY, cam0: Object.assign({}, scene().cam), portal, moved: false };
      updateCursor(null, false);
      return;
    }

    switch (tool) {
      case 'select': {
        if (onHandle(w)) {
          const sel = selectedEls();
          action = { type: 'resize', before, ub: unionBounds(sel), orig: sel.map(cloneEl), els: sel };
          return;
        }
        const hit = hitTest(w.x, w.y);
        if (hit) {
          if (hit.type === 'portal' && !e.altKey && !e.shiftKey && !selection.has(hit.id)) {
            action = { type: 'portalPress', el: hit, sx: e.clientX, sy: e.clientY, w0: w, before };
            return;
          }
          if (e.shiftKey) { selection.has(hit.id) ? selection.delete(hit.id) : selection.add(hit.id); }
          else if (!selection.has(hit.id)) { selection.clear(); selection.add(hit.id); }
          syncPropsFromSelection();
          action = startMove(w, before);
        } else {
          if (!e.shiftKey) selection.clear();
          action = { type: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: new Set(selection) };
        }
        break;
      }
      case 'pen': {
        const el = { type: 'pen', id: uid(), x: w.x, y: w.y, points: [[0, 0]], color: props.color, width: props.width, seed: newSeed() };
        scene().els.push(el);
        action = { type: 'draw', el, before };
        break;
      }
      case 'rect': case 'ellipse': case 'portal': {
        const el = tool === 'portal'
          ? portalEl(w.x, w.y, 0, 0, '', { hue: 105, target: null })
          : shapeEl(tool, w.x, w.y, 0, 0, { color: props.color, width: props.width, rough: props.rough, fill: props.fill });
        scene().els.push(el);
        action = { type: 'shape', el, x0: w.x, y0: w.y, before };
        break;
      }
      case 'line': case 'arrow': {
        const el = lineEl(tool, w.x, w.y, 0, 0, { color: props.color, width: props.width, rough: props.rough });
        scene().els.push(el);
        action = { type: 'linear', el, before };
        break;
      }
      case 'text': {
        const hit = hitTest(w.x, w.y);
        if (hit && hit.type === 'text') editText(hit); else editText(null, w);
        break;
      }
      case 'eraser':
        action = { type: 'erase', before, last: w };
        eraseAt(w);
        break;
    }
  });

  addEventListener('pointermove', (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (view !== 'board') return;
    if (pinch) { updatePinch(); return; }
    if (window.Monument && Monument.active) { Monument.pointerMove(e); return; }
    if (!action) {
      if (e.target !== canvas) return;
      const w = toWorld(e.clientX, e.clientY);
      const hit = hitTest(w.x, w.y);
      hoverId = hit && hit.type === 'portal' ? hit.id : null;
      updateCursor(hit, tool === 'select' && onHandle(w));
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const cam = scene().cam;
    switch (action.type) {
      case 'pan': {
        const dx = e.clientX - action.sx, dy = e.clientY - action.sy;
        if (Math.hypot(dx, dy) > 4) action.moved = true;
        cam.x = action.cam0.x - dx / cam.z; cam.y = action.cam0.y - dy / cam.z;
        break;
      }
      case 'portalPress': {
        if (Math.hypot(e.clientX - action.sx, e.clientY - action.sy) > 5) {
          selection.clear(); selection.add(action.el.id);
          action = startMove(action.w0, action.before);
        } else break;
      }
      // fall through
      case 'move': {
        let dx = w.x - action.w0.x, dy = w.y - action.w0.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const o of action.orig) { o.el.x = o.x + dx; o.el.y = o.y + dy; }
        break;
      }
      case 'resize': {
        const ub = action.ub;
        let sx = Math.max(0.05, (w.x - ub.x) / Math.max(ub.w, 1));
        let sy = Math.max(0.05, (w.y - ub.y) / Math.max(ub.h, 1));
        if (e.shiftKey || action.orig.some((o) => o.type === 'text' || o.type === 'portal')) sx = sy = Math.max(sx, sy);
        action.orig.forEach((o, i) => {
          const el = action.els[i];
          el.x = ub.x + (o.x - ub.x) * sx;
          el.y = ub.y + (o.y - ub.y) * sy;
          if (o.points) el.points = o.points.map((p) => [p[0] * sx, p[1] * sy]);
          else if (o.type === 'text') { el.fontSize = Math.max(6, o.fontSize * sx); measureText(el); }
          else { el.w = Math.max(4, o.w * sx); el.h = Math.max(4, o.h * sy); }
        });
        break;
      }
      case 'marquee': {
        action.x1 = w.x; action.y1 = w.y;
        const x0 = Math.min(action.x0, w.x), y0 = Math.min(action.y0, w.y), x1 = Math.max(action.x0, w.x), y1 = Math.max(action.y0, w.y);
        selection.clear();
        action.base.forEach((id) => selection.add(id));
        for (const el of scene().els) {
          const b = bounds(el);
          if (b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1) selection.add(el.id);
        }
        break;
      }
      case 'draw': {
        const el = action.el, pts = el.points, last = pts[pts.length - 1];
        const px = w.x - el.x, py = w.y - el.y;
        if (Math.hypot(px - last[0], py - last[1]) * cam.z >= 1.5) pts.push([px, py]);
        break;
      }
      case 'shape': {
        const el = action.el;
        let dx = w.x - action.x0, dy = w.y - action.y0;
        if (e.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
        el.x = Math.min(action.x0, action.x0 + dx); el.y = Math.min(action.y0, action.y0 + dy);
        el.w = Math.abs(dx); el.h = Math.abs(dy);
        break;
      }
      case 'linear': {
        const el = action.el;
        let dx = w.x - el.x, dy = w.y - el.y;
        if (e.shiftKey) {
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(dx, dy);
          dx = Math.cos(a) * l; dy = Math.sin(a) * l;
        }
        el.points[1] = [dx, dy];
        break;
      }
      case 'erase': {
        const l = action.last, steps = Math.ceil(Math.hypot(w.x - l.x, w.y - l.y) * cam.z / 6);
        for (let i = 1; i <= steps; i++) eraseAt({ x: l.x + (w.x - l.x) * i / steps, y: l.y + (w.y - l.y) * i / steps });
        eraseAt(w);
        action.last = w;
        break;
      }
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (window.Monument && Monument.active) Monument.pointerUp(e);
    if (pinch) { if (pointers.size < 2) { pinch = null; save(); } return; }
    if (!action) return;
    const a = action;
    action = null;
    switch (a.type) {
      case 'pan':
        save();
        if (!a.moved && a.portal) enterPortal(a.portal);
        updateCursor(null, false);
        return;
      case 'portalPress':
        enterPortal(a.el);
        return;
      case 'shape': {
        const el = a.el;
        if (el.type === 'portal') {
          if (el.w < 30 || el.h < 30) { el.w = 190; el.h = 250; el.x = a.x0 - 95; el.y = a.y0 - 125; }
          setTool('select');
          selection.add(el.id);
          openPortalDialog(el, true, a.before);
          return;
        }
        if (el.w < 3 && el.h < 3) removeEl(el.id);
        else { setTool('select'); selection.add(el.id); }
        break;
      }
      case 'linear': {
        const p = a.el.points[1];
        if (Math.hypot(p[0], p[1]) < 3) removeEl(a.el.id);
        else { setTool('select'); selection.add(a.el.id); }
        break;
      }
      case 'erase': {
        scene().els = scene().els.filter((x) => !erasing.has(x.id));
        erasing.clear();
        break;
      }
    }
    finishChange(a.before);
  }
  addEventListener('pointerup', endPointer);
  addEventListener('pointercancel', endPointer);

  function eraseAt(w) {
    const tol = 8 / scene().cam.z;
    for (const el of scene().els) if (!erasing.has(el.id) && hitEl(el, w.x, w.y, tol)) erasing.add(el.id);
  }
  function removeEl(id) { scene().els = scene().els.filter((e) => e.id !== id); selection.delete(id); }

  function startPinch() {
    // 两指操作时，取消正在进行的绘制
    if (action && (action.type === 'draw' || action.type === 'shape' || action.type === 'linear')) removeEl(action.el.id);
    action = null;
    const [a, b] = Array.from(pointers.values());
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: scene().cam.z, world: toWorld(mid.x, mid.y) };
  }
  function updatePinch() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const c = scene().cam;
    c.z = clamp(pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, 0.1, 8);
    c.x = pinch.world.x - (mid.x - W / 2) / c.z;
    c.y = pinch.world.y - (mid.y - H / 2) / c.z;
    updateZoomLabel();
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (view !== 'board') return;
    const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const dx = e.deltaX * m, dy = e.deltaY * m;
    if (e.ctrlKey || e.metaKey) { zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0025)); return; }
    const c = scene().cam;
    if (e.shiftKey && !dx) c.x += dy / c.z; else { c.x += dx / c.z; c.y += dy / c.z; }
    save();
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    if (tool !== 'select' || view !== 'board') return;
    if (window.Monument && Monument.active) return;
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitTest(w.x, w.y);
    if (hit && hit.type === 'text') editText(hit);
    else if (!hit) editText(null, w);
  });

  /* ---------------- 文字编辑 ---------------- */
  const ta = $('#textEditor');
  let editing = null;
  function editText(el, at) {
    const before = serialize();
    let isNew = false;
    if (!el) {
      isNew = true;
      el = { type: 'text', id: uid(), x: at.x, y: at.y - props.font * 0.62, text: '', fontSize: props.font, font: props.ff, color: props.color, seed: newSeed(), w: 0, h: 0 };
    }
    editing = { el, isNew, before };
    el._editing = true;
    const st = STYLES[scene().style];
    const s = toScreen(el.x, el.y), z = scene().cam.z;
    Object.assign(ta.style, {
      display: 'block', left: s.x + 'px', top: s.y + 'px',
      fontSize: el.fontSize * z + 'px', fontFamily: fontStack(el.font),
      color: el.color === 'ink' ? st.ink : el.color
    });
    ta.value = el.text;
    autosize();
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
  }
  function autosize() {
    ta.style.width = '4px'; ta.style.height = '4px';
    ta.style.width = (ta.scrollWidth + parseFloat(ta.style.fontSize)) + 'px';
    ta.style.height = ta.scrollHeight + 'px';
  }
  function commitText() {
    if (!editing) return;
    const { el, isNew, before } = editing;
    editing = null;
    delete el._editing;
    ta.style.display = 'none';
    el.text = ta.value.replace(/\s+$/, '');
    if (!el.text.trim()) { if (!isNew) removeEl(el.id); }
    else { measureText(el); if (isNew) scene().els.push(el); }
    finishChange(before);
  }
  ta.addEventListener('input', autosize);
  ta.addEventListener('blur', commitText);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
  });

  /* ---------------- 键盘 ---------------- */
  const TOOL_KEYS = { v: 'select', 1: 'select', h: 'hand', 2: 'hand', p: 'pen', 3: 'pen', r: 'rect', 4: 'rect', o: 'ellipse', 5: 'ellipse', a: 'arrow', 6: 'arrow', l: 'line', 7: 'line', t: 'text', 8: 'text', e: 'eraser', 9: 'eraser', g: 'portal', 0: 'portal' };
  addEventListener('keydown', (e) => {
    if (document.body.classList.contains('intro-running')) return;
    if (!$('#portalDialog').classList.contains('hidden') || !$('#helpDialog').classList.contains('hidden')) {
      if (e.key === 'Escape') { closePortalDialog(true); closeHelp(); }
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    // 跑酷维度：A/D 走路、空格跳跃、E 穿越传送门（Ctrl 组合键仍然可用）
    if (!mod && view === 'board' && window.Parkour && Parkour.active && Parkour.handleKey(e)) return;
    // 纪念碑谷维度：WASD 走路、Q/E 转视角、F 穿越（Ctrl+A/C/D/V/X 在这种维度里没意义，吞掉）
    if (!mod && view === 'board' && window.Monument && Monument.active && Monument.handleKey(e)) return;
    if (mod && window.Monument && Monument.active && /^[acdxv]$/i.test(e.key) && !e.shiftKey) return;
    if (mod && view === 'web' && /^[so]$/i.test(e.key)) {
      e.preventDefault();
      if (e.key.toLowerCase() === 's') saveToFile(e.shiftKey); else openFromFile();
      return;
    }
    if (view === 'web') {
      if (e.key === 'Backspace' || e.key === 'Escape') { e.preventDefault(); goBack(); }
      return;
    }
    if (e.code === 'Space' && !spaceDown) { spaceDown = true; updateCursor(null, false); e.preventDefault(); return; }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'd') { e.preventDefault(); duplicate(); }
      else if (k === 'c') { copySel(); }
      else if (k === 'x') { copySel(); deleteSel(); }
      else if (k === 'v') { e.preventDefault(); paste(); }
      else if (k === 'a') { e.preventDefault(); setTool('select'); scene().els.forEach((x) => selection.add(x.id)); }
      else if (k === 's') { e.preventDefault(); saveToFile(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openFromFile(); }
      else if (k === '0') { e.preventDefault(); resetZoom(); }
      else if (k === '=' || k === '+') { e.preventDefault(); zoomAt(W / 2, H / 2, 1.2); }
      else if (k === '-') { e.preventDefault(); zoomAt(W / 2, H / 2, 1 / 1.2); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.size) { e.preventDefault(); deleteSel(); }
      else if (e.key === 'Backspace' && navStack.length) { e.preventDefault(); goBack(); }
      return;
    }
    if (e.key === 'Escape') { selection.clear(); closeMenus(); setTool('select'); return; }
    if (e.key === '+' || e.key === '=') { zoomAt(W / 2, H / 2, 1.2); return; }
    if (e.key === '-') { zoomAt(W / 2, H / 2, 1 / 1.2); return; }
    if (e.key.startsWith('Arrow') && selection.size) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      mutate(() => selectedEls().forEach((el) => {
        if (e.key === 'ArrowLeft') el.x -= d; if (e.key === 'ArrowRight') el.x += d;
        if (e.key === 'ArrowUp') el.y -= d; if (e.key === 'ArrowDown') el.y += d;
      }));
      return;
    }
    const t = TOOL_KEYS[e.key.toLowerCase()];
    if (t && !e.altKey) setTool(t);
  });
  addEventListener('keyup', (e) => {
    if (window.Parkour) Parkour.handleKeyUp(e);
    if (window.Monument) Monument.handleKeyUp(e);
    if (e.code === 'Space') { spaceDown = false; updateCursor(null, false); }
  });
  addEventListener('blur', () => { spaceDown = false; if (window.Parkour) Parkour.blur(); if (window.Monument) Monument.blur(); });

  function deleteSel() { if (!selection.size) return; mutate(() => { scene().els = scene().els.filter((e) => !selection.has(e.id)); selection.clear(); }); }
  function copySel() { if (selection.size) clipboard = selectedEls().map(cloneEl); }
  function pasteEls(list, dx, dy) {
    mutate(() => {
      selection.clear();
      for (const src of list) {
        const el = cloneEl(src);
        el.id = uid(); el.x += dx; el.y += dy;
        if (el.type === 'text') measureText(el);
        scene().els.push(el);
        selection.add(el.id);
      }
    });
    setTool('select');
  }
  function duplicate() { if (selection.size) pasteEls(selectedEls(), 24, 24); }
  function paste(at) {
    if (!clipboard || !clipboard.length) return;
    const ub = unionBounds(clipboard);
    const p = at || toWorld(lastPointer.x, lastPointer.y);
    pasteEls(clipboard, p.x - (ub.x + ub.w / 2), p.y - (ub.y + ub.h / 2));
  }
  function resetZoom() { const c = scene().cam; zoomAt(W / 2, H / 2, 1 / c.z); }

  /* ---------------- 工具栏 / 属性面板 ---------------- */
  $$('.toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  function segBind(sel, key, attr, parse) {
    $$(sel + ' button').forEach((b) => b.addEventListener('click', () => {
      props[key] = parse(b.dataset[attr]);
      $$(sel + ' button').forEach((x) => x.classList.toggle('active', x === b));
      applyPropToSelection(key);
    }));
  }
  segBind('#colorSwatches', 'color', 'color', String);
  segBind('#fillSeg', 'fill', 'fill', String);
  segBind('#widthSeg', 'width', 'width', Number);
  segBind('#roughSeg', 'rough', 'rough', Number);
  segBind('#fontSeg', 'font', 'font', Number);

  // 字体选择：每个按钮用它自己的字体显示名字，所见即所得
  const ffBox = $('#fontFamily');
  for (const key of Object.keys(FONTS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.ff = key; b.textContent = FONTS[key].name;
    b.style.fontFamily = FONTS[key].stack;
    b.title = FONTS[key].name;
    if (key === 'hand') b.classList.add('active');
    b.addEventListener('click', () => {
      props.ff = key;
      markFont(key);
      applyPropToSelection('ff');
    });
    ffBox.appendChild(b);
  }
  function markFont(key) { $$('#fontFamily button').forEach((x) => x.classList.toggle('active', x.dataset.ff === key)); }
  function applyPropToSelection(key) {
    if (!selection.size) return;
    mutate(() => selectedEls().forEach((el) => {
      if (el.type === 'portal') return;
      if (key === 'color') el.color = props.color;
      if (key === 'fill' && (el.type === 'rect' || el.type === 'ellipse')) el.fill = props.fill;
      if (key === 'width' && el.type !== 'text') el.width = props.width;
      if (key === 'rough' && el.rough != null) el.rough = props.rough;
      if (key === 'font' && el.type === 'text') { el.fontSize = props.font; measureText(el); }
      if (key === 'ff' && el.type === 'text') { el.font = props.ff; measureText(el); }
    }));
  }
  function syncPropsFromSelection() {
    const el = selectedEls()[0];
    if (!el || el.type === 'portal') return;
    const mark = (sel, attr, val) => $$(sel + ' button').forEach((b) => b.classList.toggle('active', String(b.dataset[attr]) === String(val)));
    if (el.color) { props.color = el.color; mark('#colorSwatches', 'color', el.color); }
    if (el.fill) { props.fill = el.fill; mark('#fillSeg', 'fill', el.fill); }
    if (el.width) { props.width = el.width; mark('#widthSeg', 'width', el.width); }
    if (el.rough != null) { props.rough = el.rough; mark('#roughSeg', 'rough', el.rough); }
    if (el.type === 'text') { props.ff = el.font || 'hand'; markFont(props.ff); }
  }

  $('#zoomIn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.2));
  $('#zoomOut').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.2));
  $('#zoomLabel').addEventListener('click', resetZoom);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);

  /* ---------------- 菜单 ---------------- */
  const menu = $('#menu'), ctxMenu = $('#ctxMenu');
  function closeMenus() { menu.classList.add('hidden'); ctxMenu.classList.add('hidden'); }
  $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); ctxMenu.classList.add('hidden'); menu.classList.toggle('hidden'); });
  addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu') && !e.target.closest('#menuBtn')) closeMenus(); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeMenus();
    switch (b.dataset.menu) {
      case 'open': openFromFile(); break;
      case 'save': saveToFile(false); break;
      case 'saveas': saveToFile(true); break;
      case 'export': exportPNG(); break;
      case 'clear':
        if (confirm('确定清空当前画板吗？（可以用 Ctrl+Z 撤销）')) mutate(() => { scene().els = []; selection.clear(); });
        break;
      case 'reset':
        if (confirm('将清除所有维度和画作，恢复为默认画板。确定吗？')) {
          try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ }
          clearTimeout(saveTimer);
          state = defaultState(); navStack.length = 0; dirty = false; fileHandle = null; fileName = '';
          for (const k in hist) delete hist[k];
          hideWeb(); switchScene('main');
        }
        break;
      case 'intro': if (window.Intro) window.Intro.play(); break;
      case 'help': openHelp(); break;
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (view !== 'board') return;
    if (window.Monument && Monument.active) { Monument.contextMenu(e); return; }
    const w = toWorld(e.clientX, e.clientY);
    const hit = hitTest(w.x, w.y);
    const items = [];
    if (hit) {
      if (!selection.has(hit.id)) { selection.clear(); selection.add(hit.id); }
      if (hit.type === 'portal') {
        items.push(['穿越这个传送门', () => enterPortal(hit)]);
        items.push(['编辑传送门…', () => openPortalDialog(hit, false)]);
      }
      if (hit.type === 'text') items.push(['编辑文字', () => editText(hit)]);
      items.push(['复制一份', duplicate]);
      items.push(['置于顶层', () => mutate(() => { const s = scene(); s.els = s.els.filter((x) => !selection.has(x.id)).concat(selectedEls()); })]);
      items.push(['置于底层', () => mutate(() => { const s = scene(); s.els = selectedEls().concat(s.els.filter((x) => !selection.has(x.id))); })]);
      items.push(['删除', deleteSel, 'danger']);
    } else {
      items.push(['在这里创造传送门', () => {
        const before = serialize();
        const el = portalEl(w.x - 95, w.y - 125, 190, 250, '', { hue: 105, target: null });
        scene().els.push(el); selection.clear(); selection.add(el.id);
        openPortalDialog(el, true, before);
      }]);
      if (clipboard) items.push(['粘贴', () => paste(w)]);
      items.push(['全选', () => scene().els.forEach((x) => selection.add(x.id))]);
      items.push(['回到原点', () => { const c = scene().cam; c.x = 0; c.y = 0; save(); }]);
    }
    ctxMenu.textContent = '';
    for (const [label, fn, cls] of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { closeMenus(); fn(); });
      ctxMenu.appendChild(b);
    }
    menu.classList.add('hidden');
    ctxMenu.classList.remove('hidden');
    const r = ctxMenu.getBoundingClientRect();
    ctxMenu.style.left = Math.min(e.clientX, W - r.width - 8) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, H - r.height - 8) + 'px';
  });

  /* ---------------- 帮助 ---------------- */
  const help = $('#helpDialog');
  function openHelp() { help.classList.remove('hidden'); help.querySelector('[data-close]').focus(); }
  function closeHelp() { help.classList.add('hidden'); }
  help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('[data-close]')) closeHelp(); });

  /* ---------------- 传送门弹窗 ---------------- */
  const dlg = $('#portalDialog'), form = $('#portalForm');
  let dlgCtx = null;
  const randomDim = () => ['C', 'J', 'D', 'K', 'Z'][Math.floor(Math.random() * 5)] + '-' + (100 + Math.floor(Math.random() * 900));
  function openPortalDialog(el, isNew, before) {
    dlgCtx = { el, isNew, before: before == null ? serialize() : before };
    const f = form.elements;
    f.namedItem('name').value = el.name || '';
    f.namedItem('name').placeholder = '例如：维度 ' + randomDim();
    const dest = el.dest === 'web' ? 'web' : (el.style || 'paper');
    form.querySelectorAll('input[name=dest]').forEach((r) => { r.checked = r.value === dest; });
    f.namedItem('src').value = el.src || '';
    const hues = Array.from(form.querySelectorAll('input[name=hue]'));
    let best = hues[0];
    for (const h of hues) if (Math.abs(+h.value - el.hue) < Math.abs(+best.value - el.hue)) best = h;
    best.checked = true;
    form.classList.toggle('is-back', el.dest === 'back');
    form.classList.toggle('dest-web', dest === 'web');
    $('#pdTitle').firstChild.textContent = isNew ? '创造传送门 ' : '编辑传送门 ';
    dlg.classList.remove('hidden');
    setTimeout(() => f.namedItem('name').focus(), 30);
  }
  function closePortalDialog(cancel) {
    if (!dlgCtx) return;
    const { el, isNew } = dlgCtx;
    if (cancel && isNew) removeEl(el.id);
    dlgCtx = null;
    dlg.classList.add('hidden');
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'dest') form.classList.toggle('dest-web', e.target.value === 'web');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dlgCtx) return;
    const f = form.elements;
    const dest = (form.querySelector('input[name=dest]:checked') || {}).value || 'paper';
    const srcInput = f.namedItem('src');
    const src = srcInput.value.trim();
    if (dlgCtx.el.dest !== 'back' && dest === 'web' && (!src || !isSafeUrl(src))) {
      srcInput.classList.add('err'); srcInput.focus();
      setTimeout(() => srcInput.classList.remove('err'), 900);
      return;
    }
    const { el, before } = dlgCtx;
    el.name = f.namedItem('name').value.trim() || f.namedItem('name').placeholder.replace('例如：', '');
    el.hue = +((form.querySelector('input[name=hue]:checked') || {}).value || 105);
    if (el.dest !== 'back') {
      if (dest === 'web') { el.dest = 'web'; el.src = src; }
      else {
        el.dest = 'scene'; el.style = dest;
        const t = el.target && state.scenes[el.target];
        if (t) { t.style = dest; t.title = el.name; }
      }
    }
    dlgCtx = null;
    dlg.classList.add('hidden');
    finishChange(before);
  });
  form.querySelector('[data-act=cancel]').addEventListener('click', () => closePortalDialog(true));
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closePortalDialog(true); });

  /* ---------------- 维度穿越 ---------------- */
  const navStack = [];
  const webview = $('#webview'), webFrame = $('#webFrame');
  let webTitle = '';
  let diveAnim = null;

  function updateChrome() {
    document.body.classList.toggle('mode-web', view === 'web');
    document.body.classList.toggle('mode-parkour', view === 'board' && scene().style === 'parkour');
    document.body.classList.toggle('mode-monument', view === 'board' && scene().style === 'monument');
    document.body.dataset.style = view === 'web' ? 'web' : scene().style;
    $('#sceneTitle').textContent = view === 'web' ? webTitle : scene().title;
    $('#backBtn').classList.toggle('show', navStack.length > 0);
    updateZoomLabel();
  }
  function switchScene(id) {
    state.current = id;
    selection.clear(); hoverId = null; action = null;
    view = 'board';
    updateChrome();
    if (window.Parkour) Parkour.onScene(scene());
    if (window.Monument) Monument.onScene(scene());
    save();
  }
  function ensureSceneFor(p) {
    if (p.target && state.scenes[p.target]) return p.target;
    const id = p.target || 's-' + uid();
    state.scenes[id] = makeScene(id, p.name || '新维度', p.style || 'paper', true);
    p.target = id;
    save();
    return id;
  }
  function showWeb(src, title) {
    view = 'web'; webTitle = title || '网页';
    if (window.Parkour) Parkour.leave();
    if (window.Monument) Monument.leave();
    webFrame.src = src;
    webview.classList.add('on');
    webview.setAttribute('aria-hidden', 'false');
    updateChrome();
  }
  function hideWeb() {
    webview.classList.remove('on');
    webview.setAttribute('aria-hidden', 'true');
    webFrame.src = 'about:blank';
  }
  function diveOut(sx, sy) {
    if (diveAnim) diveAnim.cancel();
    stage.style.transformOrigin = `${sx}px ${sy}px`;
    diveAnim = stage.animate(
      [{ transform: 'scale(1)', filter: 'blur(0px)' }, { transform: 'scale(2.4)', filter: 'blur(5px)' }],
      { duration: 720, easing: 'cubic-bezier(.55,0,.85,.35)', fill: 'forwards' });
  }
  function diveIn() {
    if (diveAnim) diveAnim.cancel();
    stage.style.transformOrigin = '50% 50%';
    diveAnim = stage.animate(
      [{ transform: 'scale(0.7) rotate(-3deg)', filter: 'blur(10px)' }, { transform: 'scale(1) rotate(0deg)', filter: 'blur(0px)' }],
      { duration: 1150, easing: 'cubic-bezier(.16,.84,.24,1)' });
    diveAnim.onfinish = () => { diveAnim = null; };
  }

  /** 传送门在屏幕上的位置与尺寸（纪念碑谷维度里的门是 3D 的，要单独算） */
  function portalWarp(p) {
    if (p.type === 'mportal' && window.Monument && Monument.active) {
      const s = Monument.portalScreen(p), b = Monument.portalBox(p);
      return { x: s.x, y: s.y, rx: b.rx, ry: b.ry };
    }
    const c = scene().cam, s = toScreen(p.x + p.w / 2, p.y + p.h / 2);
    return { x: s.x, y: s.y, rx: p.w / 2 * c.z, ry: p.h / 2 * c.z };
  }

  function enterPortal(p) {
    if (Portal.Warp.running || view !== 'board') return;
    if (p.dest === 'back') { if (navStack.length) goBack(p); else flash('这里已经是主画板啦'); return; }
    if (p.dest === 'web' && (!p.src || !isSafeUrl(p.src))) { openPortalDialog(p, false); return; }
    const s = portalWarp(p);
    hoverId = null;
    diveOut(s.x, s.y);
    Portal.Warp.play({ x: s.x, y: s.y, rx: s.rx, ry: s.ry, hue: p.hue }, () => {
      navStack.push({ scene: state.current, hue: p.hue });
      if (p.dest === 'web') { showWeb(p.src, p.name); }
      else { switchScene(ensureSceneFor(p)); }
      diveIn();
    });
  }
  function goBack(p) {
    if (Portal.Warp.running || !navStack.length) return;
    commitText();
    const top = navStack[navStack.length - 1];
    const hue = p ? p.hue : top.hue;
    let from = { x: W / 2, y: H / 2, rx: 70, ry: 90, hue };
    if (p) { const s = portalWarp(p); from = { x: s.x, y: s.y, rx: s.rx, ry: s.ry, hue }; }
    else {
      const bb = $('#backBtn .mini-portal').getBoundingClientRect();
      from = { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2, rx: 14, ry: 14, hue };
    }
    diveOut(from.x, from.y);
    Portal.Warp.play(from, () => {
      const e = navStack.pop();
      hideWeb();
      switchScene(e.scene);
      diveIn();
    });
  }
  $('#backBtn').addEventListener('click', () => goBack());

  /* ---------------- 本地文件：保存 / 打开 ---------------- */
  const FILE_EXT = '.lanius';
  const FILE_TYPES = [{ description: '伯劳画板文件', accept: { 'application/json': [FILE_EXT, '.json'] } }];
  const canPick = typeof window.showSaveFilePicker === 'function' && window.isSecureContext !== false;
  let fileHandle = null;   // 支持 File System Access API 时，记住当前文件以便 Ctrl+S 直接覆盖
  let fileName = '';
  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function buildFile() {
    commitText();
    return JSON.stringify({
      type: 'lanius-board', version: 1, savedAt: new Date().toISOString(),
      scenes: state.scenes
    }, replacer, 1);
  }
  async function saveToFile(saveAs) {
    if (Portal.Warp.running) return;
    const data = buildFile();
    const suggested = fileName || `伯劳画板-${stamp()}${FILE_EXT}`;
    if (canPick) {
      try {
        if (!fileHandle || saveAs) {
          fileHandle = await window.showSaveFilePicker({ suggestedName: suggested, types: FILE_TYPES });
        }
        const w = await fileHandle.createWritable();
        await w.write(new Blob([data], { type: 'application/json' }));
        await w.close();
        fileName = fileHandle.name;
        dirty = false;
        toast('已保存到 ' + fileName);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;      // 用户取消
        fileHandle = null;                                   // 权限等问题 → 退回下载方式
      }
    }
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggested;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    dirty = false;
    toast('已下载 ' + suggested + '（在浏览器的下载文件夹中）');
  }

  async function openFromFile() {
    if (Portal.Warp.running) return;
    if (canPick && typeof window.showOpenFilePicker === 'function') {
      try {
        const [h] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
        await importFile(await h.getFile(), h);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    fileInput.value = '';
    fileInput.click();
  }
  const fileInput = $('#fileInput');
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) importFile(fileInput.files[0], null); });

  async function importFile(file, handle) {
    if (file.size > 50 * 1024 * 1024) { toast('文件太大（超过 50MB）', true); return; }
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { toast('无法读取：这不是有效的画板文件', true); return; }
    const next = data && data.type === 'lanius-board' ? sanitizeState(data) : null;
    if (!next) { toast('无法读取：这不是伯劳画板文件', true); return; }
    commitText();
    if (dirty && !confirm(`打开「${file.name}」会替换当前的全部画板内容，\n当前有尚未保存到文件的改动。确定继续吗？`)) return;
    commitText();
    state = next;
    for (const k in hist) delete hist[k];
    navStack.length = 0;
    fileHandle = handle; fileName = file.name;
    dirty = false;
    hideWeb();
    switchScene('main');
    save();
    const n = Object.keys(state.scenes).length;
    toast(`已打开 ${file.name}（${n} 个维度）`);
  }

  // 拖放文件到窗口即可打开
  const dropZone = $('#dropZone');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || document.body.classList.contains('intro-running')) return;
    e.preventDefault(); dragDepth++; dropZone.classList.add('on');
  });
  addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('on'); } });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; dropZone.classList.remove('on');
    const f = e.dataTransfer.files[0];
    if (f) importFile(f, null);
  });
  $('#saveBtn').addEventListener('click', () => saveToFile(false));
  $('#openBtn').addEventListener('click', () => openFromFile());

  function flash(msg) { toast(msg); }

  /* ---------------- 导出 ---------------- */
  function exportPNG() {
    const sc = scene(), st = STYLES[sc.style];
    if (!sc.els.length) { flash('画板是空的'); return; }
    if (sc.style === 'monument' && window.Monument && Monument.active) {
      canvas.toBlob((blob) => {                       // 3D 维度直接导出当前窗口画面
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `lanius-${sc.title || 'board'}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      return;
    }
    const b = unionBounds(sc.els);
    const pad = 80;
    let scale = 2;
    while ((b.w + pad * 2) * scale > 8000 || (b.h + pad * 2) * scale > 8000) scale /= 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.w + pad * 2) * scale); c.height = Math.ceil((b.h + pad * 2) * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = st.bg; g.fillRect(0, 0, b.w + pad * 2, b.h + pad * 2);
    g.translate(pad - b.x, pad - b.y);
    const t = performance.now() / 1000;
    const sel = new Set(selection); selection.clear();
    for (const el of sc.els) drawEl(g, el, st, t);
    sel.forEach((id) => selection.add(id));
    if (window.Parkour && Parkour.active) Parkour.drawFixture(g, st);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lanius-${sc.title || 'board'}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  /* ---------------- 字体加载后重新测量 ---------------- */
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('30px "Caveat"'),
      document.fonts.load('30px "Long Cang"', '伯劳的无限画板点击传送门'),
      document.fonts.load('600 14px "Cormorant Garamond"')
    ]).catch(() => {}).then(() => remeasureAll());
    document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', remeasureAll);
  }

  /* ---------------- 主循环 ---------------- */
  let lastFrame = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (window.Parkour && Parkour.active && view === 'board') Parkour.update(dt);
    if (window.Monument && Monument.active && view === 'board') Monument.update(dt);
    if (view === 'board') render(now / 1000);
  }
  Portal.Warp.init();
  if (window.Parkour) {
    Parkour.init({
      getScene: scene,
      getCam: () => scene().cam,
      isBusy: () => !!action || !!editing || Portal.Warp.running,
      enterPortal: (p) => enterPortal(p),
      flash: (msg) => toast(msg),
      handFont: HAND_FONT
    });
  }
  updateChrome();
  if (window.Parkour) Parkour.onScene(scene());
  if (window.Monument) {
    Monument.init({
      getScene: scene,
      getCam: () => scene().cam,
      toWorld, toScreen,
      snapshot: serialize,
      finish: finishChange,
      cubeEl, mportalEl,
      seedLevel: (sc) => { monumentLevel(sc); sc.cam = Monument.defaultCam(sc); },
      openPortalDialog: (el, isNew, before) => openPortalDialog(el, isNew, before),
      enterPortal: (p) => enterPortal(p),
      flash: (msg) => toast(msg),
      wantPan: () => spaceDown || tool === 'hand',
      handFont: HAND_FONT
    });
    Monument.onScene(scene());
  }
  requestAnimationFrame(loop);

  window.Board = {
    get state() { return state; },
    enterPortal, goBack, buildFile, importFile,
    _debug: { scene, toScreen, toWorld, setTool, navStack }
  };
})();
