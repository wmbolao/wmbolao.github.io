/* =========================================================
 *  monument.js — 纪念碑谷维度（3D 等距 + 按画面判断能不能走）
 *  ---------------------------------------------------------
 *  规则（只认「画面」）：
 *   · 只有 style === 'monument' 的维度里才会有红色小方块和这套 3D 逻辑；
 *     穿到别的维度（哪怕是从这里穿过去的）它就不存在了。
 *   · 主角是个红色方块，从「入口传送门」（dest === 'back' 的那扇）里出来。
 *   · 只能用「方块」和「传送门」搭建（左键放、右键删）。
 *   · 视角只能按 90° 转动（Q / E）。
 *   · 走路只有四个方向（画面上右上 / 右下 / 左下 / 左上），不能斜着走。
 *
 *  能不能走，只看**当前这一帧的画面**：
 *   1. 主角不会「爬」上一层或「掉」下一层 —— 走的时候始终贴着亮面走，
 *      不会出现抬脚跨上高台、或者从高台掉下去的动作；
 *   2. 判断标准只有一条：两块方块的**没有阴影的顶面**在屏幕上是不是**相接**。
 *      · 两块顶面共用一条完整的边、而且这条边没有被更靠前的方块挡住 → 能走；
 *      · 两块顶面只是顶点碰顶点、或者中间隔着一条有阴影的侧面（台阶、墙）→ 不能走；
 *      · 顶面被更靠前的方块盖住、画面里根本看不见 → 不能走；
 *      · 斜角（屏幕上对不上）→ 永远走不了。
 *  所以高度不参与判断：只要画面上两块亮面接得上，走过去就是连续的；
 *  画面上接不上，就算在三维里是同一层也不走。
 *  转视角（Q / E）时按新角度重算，角度变了连线也跟着变。
 *  暴露：window.Monument
 * ========================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const S = 46;                 // 格子半宽（顶面菱形 2S × S，立方体高 S）
  const MOVE_T = 0.18;          // 走一格的时间
  const ROT_T = 0.42;           // 转动视角的时间
  const SPAWN_T = 0.55;         // 从传送门里出来的时间
  const GRID_R = 8;             // 参考地面（z = 0）的格子半径

  /* 世界 → 旋转后的坐标（θ = 90° 时和下面的整数表严格一致） */
  const ROTI = [
    (x, y) => [x, y],
    (x, y) => [-y, x],
    (x, y) => [-x, -y],
    (x, y) => [y, -x]
  ];
  const ROTI_INV = [
    (a, b) => [a, b],
    (a, b) => [b, -a],
    (a, b) => [-a, -b],
    (a, b) => [-b, a]
  ];

  /* 方块只用一种颜色（顶面 / 左侧面 / 右侧面，靠明度分出立体感）
     想换颜色就改这一行 */
  const PAL = [
    ['#f2e6cf', '#dcc9a5', '#c2a983']
  ];
  const RED = ['#ee7059', '#cf4331', '#a82b1d'];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ck = (i, j, k) => i + ',' + j + ',' + k;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* ---------------- 走法：只看当前画面里「亮着的顶面」 ----------------
     判断两块方块之间有没有路，只看当前角度画出来的样子：
       · 两块顶面在屏幕上共用一条完整的边（顶面边缘相接）—— 有路；
       · 这条边还得看得见：不能被更靠前的方块（顶面 + 两个前侧面）盖住；
       · 顶点相碰、中间隔着有阴影的侧面（台阶 / 墙）、斜角 —— 都没路。

     两块顶面的中心在屏幕上只差 (±S, ±S/2)，才是「边缘相接」；差得更多就是
     顶点相接或够不着。方向按顶面中心的屏幕差分归到 右上 / 右下 / 左下 / 左上。
     高度（k）不参与判断：画面上接得上，走过去就是连续的；接不上就走不过去。
     每次转视角（Q / E）都会用新角度重算 —— 角度变了，连线也跟着变。 */
  const SLOT_D = [[1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]];   // 四个侧面中心（保留给调试）
  const EDGE_DIRS = [
    { d: 'U', du: 1, dv: -1 },     // 屏幕上：右上
    { d: 'R', du: 1, dv: 1 },      // 右下
    { d: 'D', du: -1, dv: 1 },     // 左下
    { d: 'L', du: -1, dv: -1 }     // 左上
  ];

  /* ---------------- 状态 ---------------- */
  let H = null;
  let active = false;
  let R = 0;                       // 逻辑旋转 0..3
  let rotAnim = null;              // { off, t, d0, wx, wy }
  const cubes = new Map();         // "i,j,k" → el
  const portals = [];              // mportal el[]
  let lastEls = null, lastLen = -1;
  let graph = null, graphKey = '', rev = 0;     // 走法表（按视角 + 关卡版本缓存）
  let hintPortal = null;
  let hover = null;
  let tool = 'cube';               // cube | portal | erase
  let hud = null;
  const player = { i: 0, j: 0, k: 0, moved: null, spawnT: 1, home: [0, 0, 0] };
  const ghost = { i: 0, j: 0, k: 0, on: false };

  /* ---------------- 投影 ---------------- */
  function visAngle() { return (R + (rotAnim ? rotAnim.off : 0)) * Math.PI / 2; }
  function pt(x, y, z, th) {       // 任意世界点 → 画布坐标（相机变换内）
    const t = th == null ? visAngle() : th;
    const c = Math.cos(t), s = Math.sin(t);
    const a = x * c - y * s, b = x * s + y * c;
    return { u: (a - b) * S, v: (a + b) * S * 0.5 - z * S };
  }
  function ptI(x, y, z, r) {       // 精确旋转（拾取 / 逻辑用）
    const [a, b] = ROTI[r == null ? R : r](x, y);
    return { u: (a - b) * S, v: (a + b) * S * 0.5 - z * S };
  }
  const topCenter = (i, j, k, r) => ptI(i + 0.5, j + 0.5, k + 1, r);
  function p0(x, y, th) {          // z = 0 平面上的点（转视角时给相机用）
    const c = Math.cos(th), s = Math.sin(th);
    const a = x * c - y * s, b = x * s + y * c;
    return { u: (a - b) * S, v: (a + b) * S * 0.5 };
  }
  function up0(u, v, r) {          // 画布坐标 → z = 0 平面上的世界点
    const A = (u + 2 * v) / (2 * S), B = (2 * v - u) / (2 * S);
    return ROTI_INV[r](A, B);
  }
  function depth(i, j, k, r) {     // 画家算法排序（越大越靠前）
    const [a, b] = ROTI[r == null ? R : r](i, j);
    return a + b + k;
  }

  /* ---------------- 场景数据 ---------------- */
  function rebuild(sc, force) {
    if (!force && sc.els === lastEls && sc.els.length === lastLen) return;
    lastEls = sc.els; lastLen = sc.els.length;
    rev++;                                            // 关卡变了 → 走法要重算
    cubes.clear(); portals.length = 0;
    for (const el of sc.els) {
      if (!el) continue;
      if (el.type === 'cube') cubes.set(ck(el.x, el.y, el.z), el);
      else if (el.type === 'mportal') portals.push(el);
    }
  }
  /** 能站的地方：站在这块方块的顶面上，而且上面没有别的方块 */
  function standable(i, j, k) {
    if (!cubes.has(ck(i, j, k))) return false;
    return !cubes.has(ck(i, j, k + 1));
  }

  /* ---------------- 走法表：用当前视角的屏幕投影现算 ----------------
     两块能站的方块，顶面中心在屏幕上正好差 (±S, ±S/2)（华夫格的一格）时，
     它们的顶面在画面上共用一条边；这条边两边都露着 → 连起来。
     dirOfCells 只保留给调试用（旧接口点写法已经不用了）。 */
  const OPP = { R: 'L', L: 'R', U: 'D', D: 'U' };
  function dirOfCells(a, b, r) {         // b 在 a 的屏幕哪个方向；重合 → ''，对不上 → null
    const p = topCenter(a[0], a[1], a[2], r), q = topCenter(b[0], b[1], b[2], r);
    const du = Math.round((q.u - p.u) / S);
    const dv = Math.round((q.v - p.v) / (S * 0.5));     // 半个格高算一个单位
    if (du === 0 && dv === 0) return '';
    if (Math.abs(du) !== 1 || Math.abs(dv) !== 1) return null;
    return du > 0 ? (dv < 0 ? 'U' : 'R') : (dv < 0 ? 'L' : 'D');
  }

  /* ---------------- 遮挡：看不见 / 被挡住的地方走不过去 ----------------
     渲染顺序按 depth（越大越靠前、越后画）。一块方块画出来的轮廓 =
     顶面 + 两个前侧面并成的六边形；更靠前的方块会把它盖住。 */
  function inSilhouette(p, faces) {                     // 顶面 + 两个前侧面并起来的六边形
    for (const poly of faces) if (inPoly(p, poly)) return true;
    return false;
  }
  function coversPoint(p, faces) {                      // 连同一小圈都盖住（给主角排序用）
    const m = 2;
    return inSilhouette(p, faces)
      && inSilhouette({ u: p.u + m, v: p.v }, faces)
      && inSilhouette({ u: p.u - m, v: p.v }, faces)
      && inSilhouette({ u: p.u, v: p.v + m }, faces)
      && inSilhouette({ u: p.u, v: p.v - m }, faces);
  }
  function coveredAt(u, v, d0, selfKey, r) {
    for (const el of cubes.values()) {
      if (ck(el.x, el.y, el.z) === selfKey) continue;
      if (depth(el.x, el.y, el.z, r) <= d0) continue;   // 只有更靠前的才挡得住
      const q = topCenter(el.x, el.y, el.z, r);
      if (Math.abs(q.u - u) > 2 * S || Math.abs(q.v - v) > 2 * S) continue;   // 太远，够不着
      const f = cubeFaces(el.x, el.y, el.z, r);
      if (inSilhouette({ u, v }, [f.top, f.lf, f.rf])) return true;
    }
    return false;
  }
  function visibleCell(c, r) {                          // 顶面中心连同一小圈都露在外面
    const p = topCenter(c[0], c[1], c[2], r);
    const d0 = depth(c[0], c[1], c[2], r), self = ck(c[0], c[1], c[2]);
    const m = 2;
    return !coveredAt(p.u, p.v, d0, self, r)
      && !coveredAt(p.u + m, p.v, d0, self, r)
      && !coveredAt(p.u - m, p.v, d0, self, r)
      && !coveredAt(p.u, p.v + m, d0, self, r)
      && !coveredAt(p.u, p.v - m, d0, self, r);
  }

  /* 两块顶面的中心在屏幕上正好差 (±S, ±S/2) 时，它们共用一条边。
     这条边上只要有任意一小段，两块「亮面」都露着（没被更靠前的方块盖住），
     就算「相接」，能走过去。 */
  const NUDGE = 1.5;
  function edgeVisible(a, b, du, dv, r) {
    const pa = topCenter(a[0], a[1], a[2], r), pb = topCenter(b[0], b[1], b[2], r);
    const m = { u: (pa.u + pb.u) / 2, v: (pa.v + pb.v) / 2 };          // 公共边的中点
    const h = { u: S * 0.5, v: du * dv > 0 ? -S * 0.25 : S * 0.25 };   // 公共边的半长
    const la = Math.hypot(pa.u - m.u, pa.v - m.v) || 1;
    const va = { u: (pa.u - m.u) / la, v: (pa.v - m.v) / la };         // 从公共边指向 a 顶面内部
    const ka = ck(a[0], a[1], a[2]), kb = ck(b[0], b[1], b[2]);
    const da = depth(a[0], a[1], a[2], r), db = depth(b[0], b[1], b[2], r);
    for (const t of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const u = m.u + h.u * t, v = m.v + h.v * t;
      if (coveredAt(u + va.u * NUDGE, v + va.v * NUDGE, da, ka, r)) continue;   // a 的亮面这里被挡
      if (coveredAt(u - va.u * NUDGE, v - va.v * NUDGE, db, kb, r)) continue;   // b 的亮面这里被挡
      return true;
    }
    return false;
  }

  function buildGraph() {
    const key = R + ':' + rev;
    if (graph && graphKey === key) return graph;
    graphKey = key;
    const cells = [];
    for (const el of cubes.values()) if (standable(el.x, el.y, el.z)) cells.push([el.x, el.y, el.z]);
    const key3 = (c) => ck(c[0], c[1], c[2]);
    const posKey = (p) => Math.round(p.u * 8) + '#' + Math.round(p.v * 8);   // 1/8 像素
    // 1) 每个能站的顶面中心落在屏幕哪个像素
    const byPos = new Map();
    for (const c of cells) {
      const k = posKey(topCenter(c[0], c[1], c[2], R));
      let a = byPos.get(k);
      if (!a) byPos.set(k, (a = []));
      a.push(c);
    }
    // 2) 同一处可能叠着好几块（顶面完全重合）。画面里看得见的是最靠前的那一块；
    //    站在被挡住的那一块上时，看到的也是同一张亮面，所以按「最靠前的那块」算出口。
    const repAt = new Map(), repOf = new Map();
    for (const [k, list] of byPos) {
      let r = list[0];
      for (const c of list) if (depth(c[0], c[1], c[2], R) > depth(r[0], r[1], r[2], R)) r = c;
      repAt.set(k, r);
      for (const c of list) repOf.set(key3(c), r);
    }
    // 3) 只连「顶面在屏幕上共用一条边、而且两边都露着」的格子 —— 四个方向
    const exits = new Map();
    for (const c of cells) exits.set(key3(c), { R: [], U: [], L: [], D: [] });
    for (const c of cells) {
      const rc = repOf.get(key3(c));
      const p = topCenter(rc[0], rc[1], rc[2], R);
      for (const dir of EDGE_DIRS) {
        const k = posKey({ u: p.u + dir.du * S, v: p.v + dir.dv * S * 0.5 });
        const t = repAt.get(k);
        if (!t || t === rc) continue;
        if (!edgeVisible(rc, t, dir.du, dir.dv, R)) continue;
        exits.get(key3(c))[dir.d].push(t);
      }
    }
    // 4) 每个能站的格子就是一个节点（不做任何跨格合并）
    const nodes = new Map(), nodeOf = new Map();
    for (const c of cells) {
      const n = { cells: [c], exits: { R: [], U: [], L: [], D: [] }, depth: depth(c[0], c[1], c[2], R), seen: false };
      nodes.set(key3(c), n);
      nodeOf.set(key3(c), n);
    }
    for (const c of cells) nodeOf.get(key3(c)).seen = visibleCell(c, R);
    // 5) 节点的出口；第 7~9 位记下这条连接是「从哪一块连出去的」—— 迈步时从它起走
    for (const c of cells) {
      const n = nodeOf.get(key3(c)), ex = exits.get(key3(c));
      for (const d in n.exits) for (const t of ex[d]) {
        const dist = Math.abs(t[0] - c[0]) + Math.abs(t[1] - c[1]) + Math.abs(t[2] - c[2]);
        n.exits[d].push([t[0], t[1], t[2], Math.abs(t[2] - c[2]), dist, -depth(t[0], t[1], t[2], R), c[0], c[1], c[2]]);
      }
      for (const d in n.exits) {
        const seen = new Set();
        n.exits[d] = n.exits[d]
          .filter((t) => { const k = ck(t[0], t[1], t[2]); if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((p, q) => p[3] - q[3] || p[4] - q[4] || p[5] - q[5]);
      }
    }
    graph = { nodeOf, nodes, repOf };
    return graph;
  }
  function nodeAt(i, j, k) {
    const g = buildGraph();
    return g.nodeOf.get(ck(i, j, k)) || null;
  }
  function entrancePortal(sc) {
    let first = null;
    for (const el of sc.els) {
      if (!el || el.type !== 'mportal') continue;
      if (el.dest === 'back') return el;
      if (!first) first = el;
    }
    return first;
  }
  function nearestStandable(i, j, k) {
    if (standable(i, j, k)) return [i, j, k];
    for (let d = 1; d <= 14; d++) {
      for (let di = -d; di <= d; di++) for (let dj = -d; dj <= d; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
        for (const dk of [0, -1, 1, -2, 2]) {
          if (standable(i + di, j + dj, k + dk)) return [i + di, j + dj, k + dk];
        }
      }
    }
    return null;
  }

  /* ---------------- 对外接口 ---------------- */
  const Monument = {
    get active() { return active; },

    init(hooks) {
      H = hooks;
      hud = document.getElementById('monumentHud');
      if (hud) {
        hud.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-m]');
          if (!b) return;
          const m = b.dataset.m;
          if (m === 'cube' || m === 'portal' || m === 'erase') setTool(m);
          else if (m === 'rot-') rotate(-1);
          else if (m === 'rot+') rotate(1);
          else if (m === 'home') goHome();
        });
      }
      setTool('cube');
    },

    onScene(sc) {
      if (!H || !sc || sc.style !== 'monument') { this.leave(); return; }
      active = true;
      R = 0; rotAnim = null; hintPortal = null; hover = null;
      // 万一是「风格是纪念碑谷但一个方块都没有」的场景（比如老存档串了 ID），补上默认关卡，免得站不住
      if (H.seedLevel && !sc.els.some((e) => e && e.type === 'cube')) H.seedLevel(sc);
      rebuild(sc, true);
      const p = entrancePortal(sc);
      let cell = p ? [p.x, p.y, p.z] : [0, 0, 0];
      cell = nearestStandable(cell[0], cell[1], cell[2]) || [0, 0, 0];
      player.i = cell[0]; player.j = cell[1]; player.k = cell[2];
      player.moved = null; player.spawnT = 0;
      player.home = [cell[0], cell[1], cell[2]];
      document.body.classList.toggle('mode-monument', true);
    },

    leave() {
      active = false;
      rotAnim = null; hintPortal = null; hover = null; ghost.on = false;
      document.body.classList.remove('mode-monument');
    },

    update(dt) {
      if (!active || !H) return;
      const sc = H.getScene();
      if (!sc || sc.style !== 'monument') { this.leave(); return; }
      rebuild(sc);
      dt = clamp(dt, 0, 0.05);

      if (player.spawnT < 1) player.spawnT = Math.min(1, player.spawnT + dt / SPAWN_T);
      if (player.moved) {
        const m = player.moved;
        m.t += dt / MOVE_T;
        if (m.t >= 1) {
          player.i = m.ti; player.j = m.tj; player.k = m.tk;
          player.moved = null;
        }
      }
      if (rotAnim) {
        rotAnim.t = Math.min(1, rotAnim.t + dt / ROT_T);
        rotAnim.off = rotAnim.d0 * (1 - easeIO(rotAnim.t));
        const cam = H.getCam();
        const q = p0(rotAnim.cx, rotAnim.cy, visAngle());
        cam.x = rotAnim.bx + q.u; cam.y = rotAnim.by + q.v;
        if (rotAnim.t >= 1) rotAnim = null;
      }
      hintPortal = nearPortal();
    },

    /* ---------------- 绘制 ---------------- */
    draw(ctx, st, t) {
      if (!active || !H) return;
      const cam = H.getCam(), zz = cam.z || 1;
      const vl = window.innerWidth || 1200, vt = window.innerHeight || 800;
      const x0 = cam.x - vl / 2 / zz - 3 * S, x1 = cam.x + vl / 2 / zz + 3 * S;
      const y0 = cam.y - vt / 2 / zz - 3 * S, y1 = cam.y + vt / 2 / zz + 3 * S;
      const vis = (el) => {
        const b = boundsOfR(el, R);
        return !(b.x > x1 || b.y > y1 || b.x + b.w < x0 || b.y + b.h < y0);
      };
      const list = drawList();
      // 主角也一起参与深度排序 —— 不然它永远盖在所有方块上面（该被挡的时候挡不住）
      if (player.spawnT > 0.02) {
        const pp = playerPos();
        const n = nodeAt(player.i, player.j, player.k);
        const d0 = depth(pp.x - 0.5, pp.y - 0.5, pp.z - 1) + 1;
        let pd = n ? Math.max(d0, n.depth + 1) : d0;
        // 自己搭的方块也可能盖住主角：盖住脚底那点就画到它前面，主角永远不会被藏起来
        const pc = pt(pp.x, pp.y, pp.z, null);
        for (const el of cubes.values()) {
          const de = depth(el.x, el.y, el.z) + 1;
          if (de <= pd) continue;
          if (el.x === player.i && el.y === player.j && el.z === player.k) continue;
          const q = topCenter(el.x, el.y, el.z, R);
          if (Math.abs(q.u - pc.u) > 2 * S || Math.abs(q.v - pc.v) > 2 * S) continue;
          const f = cubeFaces(el.x, el.y, el.z, R);
          if (coversPoint(pc, [f.top, f.lf, f.rf])) pd = de;
        }
        list.push({ d: pd, kind: 'player' });
        list.sort((a, b) => a.d - b.d);
      }
      for (const it of list) {
        if (it.kind === 'player') { drawPlayer(ctx, st); continue; }
        if (!vis(it.el)) continue;
        if (it.kind === 'cube') drawCubeEl(ctx, it.el);
        else drawPortalEl(ctx, it.el, t);
      }
      if (ghost.on) drawGhost(ctx, st);
      if (hintPortal) drawHintBubble(ctx, hintPortal, t);
    },

    /** 新建维度时的取景 */
    defaultCam(sc) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
      for (const el of sc.els) {
        if (el && (el.type === 'cube' || el.type === 'mportal')) {
          if (el.type === 'mportal') {
            const b = ptI(el.x + 0.5, el.y + 0.5, el.z + 1, 0);
            add({ x: b.u - S * 0.72, y: b.v - S * 2.4, w: S * 1.44, h: S * 3.2 });
          } else add(boundsOfR(el, 0));
        }
      }
      if (!isFinite(x0)) return { x: 0, y: 0, z: 1 };
      const W = window.innerWidth || 1200, Hh = window.innerHeight || 800;
      const z = clamp(Math.min((W - 120) / Math.max(240, x1 - x0), (Hh - 260) / Math.max(240, y1 - y0), 1.15), 0.28, 1.6);
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 40 / z, z };
    },

    /* 供画板用：元素的屏幕范围 / 命中 */
    boundsOf(el) { return boundsOfR(el, R); },
    hitOf(el, x, y, tol) {
      if (!el) return false;
      if (el.type === 'mportal') {
        const b = portalBase(el), rx = S * 0.72 + tol, ry = S * 1.15 + tol;
        const dx = x - b.u, dy = y - (b.v - ry * 0.6);
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.3;
      }
      const f = cubeFaces(el.x, el.y, el.z, R);
      const p = { u: x, v: y };
      return inPoly(p, f.top) || inPoly(p, f.lf) || inPoly(p, f.rf);
    },

    /* 传送门在屏幕上的位置 / 大小（穿越特效要用） */
    portalScreen(p) {
      const b = portalBase(p);
      return H ? H.toScreen(b.u, b.v - S * 0.55) : { x: 0, y: 0 };
    },
    portalBox(p) {
      const z = H && H.getCam ? H.getCam().z : 1;
      return { rx: S * 0.66 * z, ry: S * 1.05 * z };
    },

    /* ---------------- 键盘 ---------------- */
    handleKey(e) {
      if (!active || !H) return false;
      const k = e.key.toLowerCase();
      if (k === 'd' || e.key === 'ArrowRight') { step('R'); return true; }
      if (k === 'a' || e.key === 'ArrowLeft') { step('L'); return true; }
      if (k === 'w' || e.key === 'ArrowUp') { step('U'); return true; }
      if (k === 's' || e.key === 'ArrowDown') { step('D'); return true; }
      if (k === 'q') { rotate(-1); return true; }
      if (k === 'e') { rotate(1); return true; }
      if (k === 'f' || e.key === 'Enter') {
        if (hintPortal) H.enterPortal(hintPortal);
        else H.flash('走到传送门上再按 F 穿越');
        return true;
      }
      if (k === 'r') { goHome(); return true; }
      if (k === 'x') { setTool('erase'); return true; }
      if (k === 'z') { setTool('cube'); return true; }
      if (k === 'c') { setTool('portal'); return true; }
      return false;
    },
    handleKeyUp() {},
    blur() {},

    /* ---------------- 鼠标 ---------------- */
    pointerDown(e) {
      if (!active || !H) return false;
      if (e.button === 1 || H.wantPan()) return false;      // 平移还是交给画板
      if (e.button === 2) return true;                      // 右键：等 contextmenu 里再删（不然会删两次）
      const p = pickAt(e.clientX, e.clientY);
      if (tool === 'erase') { eraseAt(p); return true; }
      if (tool === 'portal') { placePortal(p); return true; }
      placeCube(p);
      return true;
    },
    pointerMove(e) {
      if (!active || !H) return true;
      const p = pickAt(e.clientX, e.clientY);
      hover = p;
      if (p && tool === 'cube' && p.kind !== 'portal') {
        ghost.i = p.cell[0]; ghost.j = p.cell[1]; ghost.k = p.cell[2];
        ghost.on = p.cell[2] >= 0 && !cubes.has(ck(p.cell[0], p.cell[1], p.cell[2]));
      } else ghost.on = false;
      const cvs = document.getElementById('board');
      if (cvs) cvs.style.cursor = p ? (tool === 'erase' ? 'crosshair' : 'copy') : 'default';
      return true;
    },
    pointerUp() { return false; },
    contextMenu(e) { eraseAt(pickAt(e.clientX, e.clientY)); },

    _debug: {
      player, cubes, standable, ROTI, pickAt, step, rotate, rebuild, topCenter, ck,
      placeCube, placePortal, eraseAt, portalBase, cubeFaces,
      SLOT_D, buildGraph, dirOfCells, nodeAt, ptI, depth, visibleCell, edgeVisible,
      get R() { return R; },
      get portals() { return portals; },
      get tool() { return tool; },
      get lastEls() { return lastEls; },
      setTool,
      spawn(sc) { Monument.onScene(sc); }
    }
  };

  /* ---------------- 工具 ---------------- */
  function setTool(t) {
    tool = t;
    if (t !== 'cube') ghost.on = false;
    if (hud) Array.from(hud.querySelectorAll('button[data-m]')).forEach((b) => {
      const m = b.dataset.m;
      if (m === 'cube' || m === 'portal' || m === 'erase') b.classList.toggle('on', m === t);
    });
  }
  function nearPortal() {
    const n = nodeAt(player.i, player.j, player.k);
    const cells = n ? n.cells : [[player.i, player.j, player.k]];
    for (const p of portals) for (const c of cells) if (p.x === c[0] && p.y === c[1] && p.z === c[2]) return p;
    return null;
  }
  function goHome() {
    if (!H) return;
    player.i = player.home[0]; player.j = player.home[1]; player.k = player.home[2];
    player.moved = null; player.spawnT = 0.999;
    hintPortal = nearPortal();
  }
  function step(dir) {
    if (!active || !H || player.moved || player.spawnT < 1) return;
    const n = nodeAt(player.i, player.j, player.k);
    if (!n || !n.exits[dir]) return;
    for (const t of n.exits[dir]) {
      if (!standable(t[0], t[1], t[2])) continue;
      // 能不能走只看画面：buildGraph 里已经把「顶面相接、又都露着」的边挑出来了；
      // 这里不再按层数拦截 —— 屏幕上接得上，走过去就是连续的。
      player.moved = { fi: player.i, fj: player.j, fk: player.k, ti: t[0], tj: t[1], tk: t[2], t: 0 };
      return;
    }
  }
  function rotate(dir) {
    if (!active || !H || rotAnim) return;
    const cam = H.getCam();
    const C = levelCenter();
    const th0 = R * Math.PI / 2;
    const base = p0(C[0], C[1], th0);
    // 让整座建筑在屏幕上「原地转」，而不是绕着视点转（视点常常不在建筑中间）
    rotAnim = { off: -dir, d0: -dir, t: 0, cx: C[0], cy: C[1], th0, bx: cam.x - base.u, by: cam.y - base.v };
    R = ((R + dir) % 4 + 4) % 4;
  }
  function levelCenter() {
    let sx = 0, sy = 0, n = 0;
    for (const el of cubes.values()) { sx += el.x + 0.5; sy += el.y + 0.5; n++; }
    return n ? [sx / n, sy / n] : [0, 0];
  }

  /* ---------------- 几何：方块的面 ---------------- */
  function cubeFaces(i, j, k, r) {
    const c4 = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const top = c4.map((c) => ptI(c[0], c[1], k + 1, r));
    const bot = c4.map((c) => ptI(c[0], c[1], k, r));
    let si = 0;
    for (let m = 1; m < 4; m++) if (top[m].v > top[si].v) si = m;
    const i1 = (si + 3) % 4, i2 = (si + 1) % 4;
    const neigh = (idx) => {
      const dx = (c4[si][0] + c4[idx][0]) / 2 - (i + 0.5);
      const dy = (c4[si][1] + c4[idx][1]) / 2 - (j + 0.5);
      return [i + Math.round(dx * 2), j + Math.round(dy * 2), k];
    };
    const q = (idx) => [top[si], top[idx], bot[idx], bot[si]];
    return { top: [top[0], top[1], top[2], top[3]], lf: q(i1), rf: q(i2), nl: neigh(i1), nr: neigh(i2) };
  }
  function inPoly(p, poly) {
    let inside = false;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a.v > p.v) !== (b.v > p.v)) && (p.u < (b.u - a.u) * (p.v - a.v) / (b.v - a.v) + a.u)) inside = !inside;
    }
    return inside;
  }
  function portalBase(el) { return topCenter(el.x, el.y, el.z, R); }
  function boundsOfR(el, r) {
    if (!el) return { x: 0, y: 0, w: 0, h: 0 };
    if (el.type === 'mportal') {
      const b = topCenter(el.x, el.y, el.z, r);
      const rx = S * 0.72, ry = S * 1.15;
      return { x: b.u - rx, y: b.v - ry * 1.55, w: rx * 2, h: ry * 2 + S * 0.1 };
    }
    const f = cubeFaces(el.x, el.y, el.z, r);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of [f.top, f.lf, f.rf]) for (const p of q) {
      x0 = Math.min(x0, p.u); y0 = Math.min(y0, p.v);
      x1 = Math.max(x1, p.u); y1 = Math.max(y1, p.v);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ---------------- 拾取 / 建造 ---------------- */
  function sortedCubes() {
    const arr = [];
    for (const el of cubes.values()) arr.push({ d: depth(el.x, el.y, el.z), el });
    arr.sort((a, b) => a.d - b.d);
    return arr;
  }
  function drawList() {
    const arr = [];
    for (const el of cubes.values()) arr.push({ d: depth(el.x, el.y, el.z), kind: 'cube', el });
    for (const el of portals) arr.push({ d: depth(el.x, el.y, el.z) + 0.4, kind: 'portal', el });
    arr.sort((a, b) => a.d - b.d);
    return arr;
  }
  function groundCell(u, v) {
    const g = up0(u, v, R);
    const i = Math.floor(g[0]), j = Math.floor(g[1]);
    if (Math.abs(i) > GRID_R + 1 || Math.abs(j) > GRID_R + 1) return null;
    return [i, j];
  }
  function pickAt(sx, sy) {
    if (!H) return null;
    const w = H.toWorld(sx, sy);
    for (let n = portals.length - 1; n >= 0; n--) {
      const el = portals[n];
      const b = portalBase(el), rx = S * 0.72, ry = S * 1.15;
      const dx = w.x - b.u, dy = w.y - (b.v - ry * 0.6);
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.3) {
        return { kind: 'portal', el, surface: [el.x, el.y, el.z], cell: [el.x, el.y, el.z], face: 'portal' };
      }
    }
    const arr = sortedCubes();
    for (let n = arr.length - 1; n >= 0; n--) {
      const el = arr[n].el;
      const f = cubeFaces(el.x, el.y, el.z, R);
      const p = { u: w.x, v: w.y };
      if (inPoly(p, f.top)) return { kind: 'cube', el, surface: [el.x, el.y, el.z], cell: [el.x, el.y, el.z + 1], face: 'top' };
      if (inPoly(p, f.lf)) return { kind: 'cube', el, surface: [el.x, el.y, el.z], cell: f.nl, face: 'side' };
      if (inPoly(p, f.rf)) return { kind: 'cube', el, surface: [el.x, el.y, el.z], cell: f.nr, face: 'side' };
    }
    const g = groundCell(w.x, w.y);
    if (g) return { kind: 'ground', el: null, surface: null, cell: [g[0], g[1], 0], face: 'ground' };
    return null;
  }
  function placeCube(p) {
    if (!H || !p) return;
    if (p.kind === 'portal') { H.flash('这里已经有一扇传送门了'); return; }
    const [i, j, k] = p.cell;
    if (k < 0) { H.flash('再往上一点吧'); return; }
    if (cubes.has(ck(i, j, k))) { H.flash('这里已经有方块了'); return; }
    const sc = H.getScene(), before = H.snapshot();
    sc.els.push(H.cubeEl(i, j, k));
    H.finish(before);
    rebuild(sc, true);
    ghost.on = true; ghost.i = i; ghost.j = j; ghost.k = k + 1;
  }
  function placePortal(p) {
    if (!H) return;
    if (!p || !p.surface) { H.flash('传送门要放在方块的顶面上'); return; }
    const [i, j, k] = p.surface;
    if (portals.some((e) => e.x === i && e.y === j && e.z === k)) { H.flash('这块方块上已经有传送门了'); return; }
    const sc = H.getScene(), before = H.snapshot();
    const el = H.mportalEl(i, j, k, '', { hue: 105, target: null });
    sc.els.push(el);
    rebuild(sc, true);
    H.openPortalDialog(el, true, before);
  }
  function eraseAt(p) {
    if (!H || !p) return;
    const sc = H.getScene(), before = H.snapshot();
    let changed = false;
    if (p.kind === 'portal') {
      sc.els = sc.els.filter((e) => e !== p.el); changed = true;
    } else if (p.kind === 'cube') {
      const [i, j, k] = p.surface;
      const keep = [];
      for (const el of sc.els) {
        if (el === p.el) { changed = true; continue; }
        if (el.type === 'mportal' && el.x === i && el.y === j && el.z === k) { changed = true; continue; }
        keep.push(el);
      }
      sc.els = keep;
    }
    if (changed) H.finish(before);
    if (changed) rebuild(sc, true);
  }

  /* ---------------- 绘制细节 ---------------- */
  function fillPoly(g, q, color, alpha) {
    g.beginPath();
    g.moveTo(q[0].u, q[0].v);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i].u, q[i].v);
    g.closePath();
    if (alpha != null) g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fill();
  }
  function drawBox(g, x0, y0, z0, sx, sy, sz, cols, th, alpha, edge) {
    const c4 = [[x0, y0], [x0 + sx, y0], [x0 + sx, y0 + sy], [x0, y0 + sy]];
    const top = c4.map((c) => pt(c[0], c[1], z0 + sz, th));
    const bot = c4.map((c) => pt(c[0], c[1], z0, th));
    let si = 0;
    for (let m = 1; m < 4; m++) if (top[m].v > top[si].v) si = m;
    const i1 = (si + 3) % 4, i2 = (si + 1) % 4;
    const q1 = [top[si], top[i1], bot[i1], bot[si]];
    const q2 = [top[si], top[i2], bot[i2], bot[si]];
    const left = q1[1].u <= q2[1].u ? q1 : q2;
    const right = left === q1 ? q2 : q1;
    const old = g.globalAlpha;
    if (alpha != null) g.globalAlpha = old * alpha;
    fillPoly(g, left, cols[1]);
    fillPoly(g, right, cols[2]);
    fillPoly(g, [top[0], top[1], top[2], top[3]], cols[0]);
    if (edge) {
      g.beginPath();
      g.moveTo(top[si].u, top[si].v);
      for (const p of [top[i1], bot[i1], bot[si], bot[i2], top[i2]]) g.lineTo(p.u, p.v);
      g.closePath();
      g.strokeStyle = edge; g.lineWidth = 1.3; g.stroke();
    }
    g.globalAlpha = old;
  }
  const EDGE = 'rgba(38,48,58,0.30)';
  function drawCubeEl(g, el) {
    drawBox(g, el.x, el.y, el.z, 1, 1, 1, PAL[0], null, null, EDGE);
  }
  function drawPortalEl(g, el, t) {
    const b = portalBase(el);
    const cy = b.v - S * 1.15 * 0.62;
    // 底座阴影
    g.save();
    g.globalAlpha = 0.16; g.fillStyle = '#1d2b38';
    g.beginPath(); g.ellipse(b.u, b.v, S * 0.40, S * 0.21, 0, 0, TAU); g.fill();
    g.restore();
    const col = `hsl(${el.hue || 105},70%,72%)`;
    g.save();
    g.globalAlpha = 0.30;
    g.fillStyle = col;
    g.beginPath(); g.ellipse(b.u, b.v - 2, S * 0.36, S * 0.19, 0, 0, TAU); g.fill();
    g.restore();
    if (window.Portal) {
      Portal.draw(g, b.u, cy, S * 0.6, S * 1.05, t, el.hue == null ? 105 : el.hue,
        { seed: (el.seed % 1000) / 100, glow: hintPortal === el ? 1.7 : 1, speed: hintPortal === el ? 1.8 : 1 });
    }
  }
  function drawGhost(g, st) {
    const ground = hover && hover.kind === 'ground';
    const cols = tool === 'erase' ? ['#f3d9d4', '#e0b2ab', '#c9928b'] : ['#dff0e0', '#bcdcc0', '#9dc4a4'];
    const old = g.globalAlpha;
    // 悬停在空地上时，先在地上画一格淡淡的绿框（说明这里可以放第一块）
    if (ground && tool === 'cube') {
      const c = pt(ghost.i + 0.5, ghost.j + 0.5, 0, null);
      g.save();
      g.globalAlpha = 0.5;
      g.strokeStyle = 'rgba(58,130,80,0.55)'; g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(c.u, c.v, S * 0.86, S * 0.43, 0, 0, TAU);
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 0.55;
    drawBox(g, ghost.i, ghost.j, ghost.k, 1, 1, 1, cols, null, null, 'rgba(46,110,60,0.5)');
    g.globalAlpha = old;
  }
  /* ---------------- 主角 ---------------- */
  function playerPos() {
    const m = player.moved;
    let x, y, z;
    if (m) {
      const t = easeIO(clamp(m.t, 0, 1));
      x = m.fi + 0.5 + (m.ti - m.fi) * t;
      y = m.fj + 0.5 + (m.tj - m.fj) * t;
      z = m.fk + 1 + (m.tk - m.fk) * t;
    } else {
      x = player.i + 0.5; y = player.j + 0.5; z = player.k + 1;
    }
    return { x, y, z };
  }
  function drawPlayer(g, st) {
    const ease = easeOut(clamp(player.spawnT, 0, 1));
    const pos = playerPos();
    const sz = 0.62;
    let z = pos.z;
    if (player.spawnT < 1) z += (1 - ease) * 1.1;
    g.save();
    g.globalAlpha = clamp(ease * 1.15, 0, 1);
    // 影子
    if (player.spawnT > 0.6) {
      const c = pt(pos.x, pos.y, z, null);
      g.globalAlpha = 0.15 * ease;
      g.fillStyle = '#20303d';
      g.beginPath(); g.ellipse(c.u, c.v, S * 0.34, S * 0.17, 0, 0, TAU); g.fill();
      g.globalAlpha = clamp(ease * 1.15, 0, 1);
    }
    const dz = sz * (0.4 + 0.6 * ease);
    drawBox(g, pos.x - sz / 2, pos.y - sz / 2, z, sz, sz, dz, RED, null, null, 'rgba(90,20,12,0.5)');
    g.restore();
  }
  function drawHintBubble(g, el, t) {
    const z = H.getCam().z || 1;
    const b = portalBase(el);
    const bob = Math.sin(t * 3.2) * 3 / z;
    const fs = 24 / z;
    const cx = b.u, cy = b.v - S * 2.5 + bob;
    g.save();
    g.font = `700 ${fs}px ${H.handFont}`;
    const label = `按 F 穿越 · ${el.name || '传送门'}`;
    const w = g.measureText(label).width + fs * 1.1;
    const h = fs * 1.7;
    g.fillStyle = 'rgba(28,40,52,0.82)';
    roundRect(g, cx - w / 2, cy - h, w, h, h / 2);
    g.fill();
    g.fillStyle = '#f2f7fb';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, cx, cy - h / 2 + 1 / z);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  window.Monument = Monument;
})();
