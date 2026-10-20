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
  const ids = new Map();           // el.id → el（手动「谁压谁」按 id 记）
  const portals = [];              // mportal el[]
  let lastEls = null, lastLen = -1;
  let graph = null, graphKey = '', rev = 0;     // 走法表（按视角 + 关卡版本缓存）
  let hintPortal = null;
  let hover = null;
  let sel = [];                    // 「选择」工具选中的方块 el（最多两块，A / B）
  let lastPick = null;             // 上一次选择点（同一点再点一下 = 往后翻一块）
  let tool = 'cube';               // cube | portal | erase | select
  let hud = null;
  const player = { i: 0, j: 0, k: 0, moved: null, spawnT: 1, home: [0, 0, 0] };
  const ghost = { i: 0, j: 0, k: 0, on: false };
  let hidePlayer = false;           // 调试：量「顶面本身露多少」时先把主角摘掉
  let markEl = null;                // 调试：给某块顶面刷成品红，量它露出来多少

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
  function depthAt(x, y, z) {      // 同上，但吃小数（主角走到一半时用）
    const [a, b] = ROTI[R](x, y);
    return a + b + z;
  }
  /* 手动改过的「谁压谁」：只记在方块自己身上，成对生效。
     x.cov[yId] = 1 表示「x 画在 y 前面」，只影响 x 和 y 这一对，
     跟别的方块的前后关系一概不动（位置也不动）。 */
  function frontOf(x, y) {         // x 是不是画在 y 前面（盖住 y）
    if (!x || !y || x === y) return false;
    if (x.cov && y.id != null && x.cov[y.id]) return true;
    if (y.cov && x.id != null && y.cov[x.id]) return false;
    return depth(x.x, x.y, x.z) > depth(y.x, y.y, y.z);
  }
  function covSet(x, y) {          // 让 x 压住 y（只动这一对）
    if (!x || !y || x === y) return;
    if (x.cov) delete x.cov[y.id];
    if (y.cov) delete y.cov[x.id];
    if (!x.cov) x.cov = {};
    x.cov[y.id] = 1;
  }

  /* ---------------- 场景数据 ---------------- */
  function rebuild(sc, force) {
    if (!force && sc.els === lastEls && sc.els.length === lastLen) return;
    lastEls = sc.els; lastLen = sc.els.length;
    rev++;                                            // 关卡变了 → 走法要重算
    cubes.clear(); ids.clear(); portals.length = 0;
    for (const el of sc.els) {
      if (!el) continue;
      if (el.type === 'cube') {
        cubes.set(ck(el.x, el.y, el.z), el);
        if (el.id != null) ids.set(el.id, el);
      } else if (el.type === 'mportal') portals.push(el);
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
  function coveredAt(u, v, selfEl, r) {
    for (const el of cubes.values()) {
      if (el === selfEl) continue;
      if (!frontOf(el, selfEl)) continue;             // 只有画在它前面的才挡得住
      const q = topCenter(el.x, el.y, el.z, r);
      if (Math.abs(q.u - u) > 2 * S || Math.abs(q.v - v) > 2 * S) continue;   // 太远，够不着
      const f = cubeFaces(el.x, el.y, el.z, r);
      if (inSilhouette({ u, v }, [f.top, f.lf, f.rf])) return true;
    }
    return false;
  }
  function visibleCell(c, r) {                          // 顶面中心连同一小圈都露在外面
    const self = cubes.get(ck(c[0], c[1], c[2]));
    if (!self) return false;
    const p = topCenter(c[0], c[1], c[2], r);
    const m = 2;
    return !coveredAt(p.u, p.v, self, r)
      && !coveredAt(p.u + m, p.v, self, r)
      && !coveredAt(p.u - m, p.v, self, r)
      && !coveredAt(p.u, p.v + m, self, r)
      && !coveredAt(p.u, p.v - m, self, r);
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
    const ea = cubes.get(ck(a[0], a[1], a[2])), eb = cubes.get(ck(b[0], b[1], b[2]));
    for (const t of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const u = m.u + h.u * t, v = m.v + h.v * t;
      if (coveredAt(u + va.u * NUDGE, v + va.v * NUDGE, ea, r)) continue;   // a 的亮面这里被挡
      if (coveredAt(u - va.u * NUDGE, v - va.v * NUDGE, eb, r)) continue;   // b 的亮面这里被挡
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
      // 这一对（或几块）里如果有人被手动改成「画在 r 前面」，那看得见的就是它
      for (let n = 0; n < 4; n++) {
        let nxt = r;
        for (const c of list) {
          if (c === r) continue;
          if (frontOf(cubes.get(key3(c)), cubes.get(key3(r)))) { nxt = c; break; }
        }
        if (nxt === r) break;
        r = nxt;
      }
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
          if (m === 'cube' || m === 'portal' || m === 'erase' || m === 'select') setTool(m);
          else if (m === 'up') layerShift(1);
          else if (m === 'down') layerShift(-1);
          else if (m === 'swap') swapLevels();
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
      R = 0; rotAnim = null; hintPortal = null; hover = null; sel = []; lastPick = null;
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
      rotAnim = null; hintPortal = null; hover = null; ghost.on = false; sel = []; lastPick = null;
      document.body.classList.remove('mode-monument');
    },

    update(dt) {
      if (!active || !H) return;
      const sc = H.getScene();
      if (!sc || sc.style !== 'monument') { this.leave(); return; }
      rebuild(sc);
      if (sel.length && sel.some((e) => !sc.els.includes(e))) sel = sel.filter((e) => sc.els.includes(e));   // 撤销 / 删除之后别留着幽灵选中
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
      for (const it of list) {
        if (!vis(it.el)) continue;
        if (it.kind === 'cube') drawCubeEl(ctx, it.el);
        else drawPortalEl(ctx, it.el, t);
      }
      // 手动改过的「谁压谁」：只把这一对重叠的那一小块补画一遍 ——
      // 别的地方（包括它俩跟第三块的前后）一个像素都不动。
      const bidx = baseIdx();
      const pairs = covPairs();
      for (const [A, B] of pairs) {
        const ia = bidx.get(A), ib = bidx.get(B);
        if (ia == null || ib == null || ib < ia) continue;      // 本来就画在前面，不用补
        if (!vis(A) || !vis(B)) continue;
        repaintFront(ctx, A, B, bidx, st);
      }
      /* 主角最后画，但只画「脚下方块顶面还露着」的那部分：
         补画完之后谁压在脚下这块的顶面上，就把它的轮廓按同一条边界往上
         延伸主角那么高，从主角身上挖掉 —— 顶面完整露着，主角就完整；
         顶面被啃掉一半，主角也被啃掉同样的那一半。 */
      if (!hidePlayer && player.spawnT > 0.02) drawPlayerMasked(ctx, st);
      if (sel.length && tool === 'select') sel.forEach((e, n) => drawSelBadge(ctx, e, n));
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
      if (e.key === 'PageUp') { e.preventDefault(); layerShift(1); return true; }
      if (e.key === 'PageDown') { e.preventDefault(); layerShift(-1); return true; }
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
      if (tool === 'select') {
        const list = pickAllCubes(e.clientX, e.clientY);
        if (!list.length) { sel = []; lastPick = null; return true; }
        const same = lastPick && Math.abs(lastPick.x - e.clientX) <= 6 && Math.abs(lastPick.y - e.clientY) <= 6;
        // 同一点再点一下：往后翻一块（顶面重合时，这样才够得着被挡住的那块）
        const at = same ? list.indexOf(lastPick.cur) : -1;
        const c = list[at >= 0 ? (at + 1) % list.length : 0];
        lastPick = { x: e.clientX, y: e.clientY, cur: c };
        if (sel.includes(c)) {
          if (!same) sel = sel.filter((x) => x !== c);      // 点已选中的（换个地方点的）→ 取消它
        } else if (sel.length >= 2) {
          sel = [c];                                       // 已经选了两块 → 重新开始选
        } else {
          sel = sel.concat([c]);                           // 最多两块：A、B
        }
        return true;
      }
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
      if (cvs) cvs.style.cursor = p ? (tool === 'erase' ? 'crosshair' : tool === 'select' ? 'pointer' : 'copy') : 'default';
      return true;
    },
    pointerUp() { return false; },
    contextMenu(e) { eraseAt(pickAt(e.clientX, e.clientY)); },

    _debug: {
      player, cubes, standable, ROTI, pickAt, pickAllCubes, step, rotate, rebuild, topCenter, ck,
      placeCube, placePortal, eraseAt, portalBase, cubeFaces,
      SLOT_D, buildGraph, dirOfCells, nodeAt, ptI, depth, frontOf, covSet, covPairs, baseIdx, effIdx,
      visibleCell, edgeVisible,
      layerShift, viewStep, swapLevels,
      playerOccl, topPts, playerBox, standEl, clipConvex, subConvex,
      silHullOf(el) { return silHull(el); },
      setHidePlayer(v) { hidePlayer = !!v; },
      setMark(el) { markEl = el || null; },
      get R() { return R; },
      get portals() { return portals; },
      get tool() { return tool; },
      get sel() { return sel; },
      set sel(v) { sel = Array.isArray(v) ? v : v ? [v] : []; },
      get lastEls() { return lastEls; },
      setTool,
      spawn(sc) { Monument.onScene(sc); }
    }
  };

  /* ---------------- 工具 ---------------- */
  function setTool(t) {
    tool = t;
    if (t !== 'cube') ghost.on = false;
    if (t !== 'select') { sel = []; lastPick = null; }
    if (hud) Array.from(hud.querySelectorAll('button[data-m]')).forEach((b) => {
      const m = b.dataset.m;
      if (m === 'cube' || m === 'portal' || m === 'erase' || m === 'select') b.classList.toggle('on', m === t);
    });
  }
  /* 当前视角下「一层」的世界方向：沿视线方向走一格，画面位置完全不变
     （a, b 是旋转后的坐标，要让 Δa = Δb = Δk 才不改变投影，
      所以 Δ(i, j) = ROTI_INV[Δk](Δk, Δk)） */
  function viewStep(d) {
    const [di, dj] = ROTI_INV[((R % 4) + 4) % 4](d, d);
    return [di, dj, d];
  }
  /* 把选中的方块沿视线方向换一层：画面上一动不动，只换它盖住别人 / 被别人盖住，以及站上去的层数 */
  function layerShift(d) {
    if (!H) return false;
    if (!active) return false;
    if (sel.length !== 1) {
      H.flash(sel.length ? '选了两块时用「交换上下」；换单块请只选一块' : '先用「选择」点一个方块');
      return false;
    }
    const sc = H.getScene();
    const one = sel[0];
    if (!sc || !sc.els.includes(one)) { sel = []; H.flash('先用「选择」点一个方块'); return false; }
    const i = one.x, j = one.y, k = one.z;
    const [di, dj, dk] = viewStep(d);
    const ni = i + di, nj = j + dj, nk = k + dk;
    if (nk < 0) { H.flash('下面已经没有层了'); return false; }
    if (cubes.has(ck(ni, nj, nk))) { H.flash('那一层已经有方块了'); return false; }
    const before = H.snapshot();
    one.x = ni; one.y = nj; one.z = nk;
    for (const p of portals) if (p.x === i && p.y === j && p.z === k) { p.x = ni; p.y = nj; p.z = nk; }
    if (player.i === i && player.j === j && player.k === k) {      // 主角正站在这块上，就跟着一起走（画面不变）
      player.i = ni; player.j = nj; player.k = nk;
    }
    if (player.moved) {                                            // 走到一半就换层：起点/终点一起挪，屏幕路径不变
      const m = player.moved;
      if (m.fi === i && m.fj === j && m.fk === k) { m.fi = ni; m.fj = nj; m.fk = nk; }
      if (m.ti === i && m.tj === j && m.tk === k) { m.ti = ni; m.tj = nj; m.tk = nk; }
    }
    rebuild(sc, true);
    H.finish(before);
    H.flash(d > 0 ? ('换到上层（第 ' + (nk + 1) + ' 层）') : ('换到下层（第 ' + (nk + 1) + ' 层）'));
    return true;
  }
  /* 选中两块，交换它们在画面上的前后 —— 位置一格不动，而且只动这一对：
     记在方块自己身上（a.cov[b] = 1 表示「a 画在 b 前面」），跟第三块的前后关系
     完全不碰。再按一次就换回去。 */
  function swapLevels() {
    if (!H || !active) return false;
    if (sel.length !== 2) { H.flash('先用「选择」点两块方块'); return false; }
    const sc = H.getScene();
    const a = sel[0], b = sel[1];
    if (!sc || !sc.els.includes(a) || !sc.els.includes(b)) {
      sel = sel.filter((e) => sc && sc.els.includes(e));
      H.flash('先用「选择」点两块方块');
      return false;
    }
    if (a.id == null || b.id == null) { H.flash('这两块没有编号，换不了'); return false; }
    const aFront = frontOf(a, b);
    const before = H.snapshot();
    covSet(aFront ? b : a, aFront ? a : b);         // 原来谁在前，现在就反过来
    rebuild(sc, true);
    H.finish(before);
    H.flash('画面上现在是 ' + (aFront ? 'B' : 'A') + ' 压在另一块前面 —— 位置一格没动，别的方块也没动');
    return true;
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
    arr.sort((a, b) => a.d - b.d);                         // 稳定：同一深度按建立先后
    return arr;
  }
  function drawList() {
    const arr = [];
    for (const el of cubes.values()) arr.push({ d: depth(el.x, el.y, el.z), kind: 'cube', el });
    for (const el of portals) arr.push({ d: depth(el.x, el.y, el.z) + 0.4, kind: 'portal', el });
    arr.sort((a, b) => a.d - b.d);
    return arr;
  }
  /* 成对手改过「谁压谁」的那些对：[前面的块, 被压住的块] */
  function covPairs() {
    const out = [];
    for (const el of cubes.values()) {
      if (!el.cov) continue;
      for (const k in el.cov) {
        const o = ids.get(k);
        if (o && o !== el) out.push([el, o]);
      }
    }
    return out;
  }
  /* 基础绘制次序（越大越靠前）；同一深度按建立先后 */
  function baseIdx() {
    const m = new Map();
    sortedCubes().forEach((it, n) => m.set(it.el, n));
    return m;
  }
  /* 按「画面上看得见谁」排序用的次序：手动指定的那一对，前面的块提到后面那块之上 */
  function effIdx() {
    const m = baseIdx();
    for (const [a, b] of covPairs()) {
      const ia = m.get(a), ib = m.get(b);
      if (ia == null || ib == null || ia > ib) continue;
      m.set(a, ib + 0.5);
    }
    return m;
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
    const arr = pickCubesSorted();
    for (let n = 0; n < arr.length; n++) {
      const el = arr[n];
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
  /* 这个屏幕点上「画着的」所有方块，从最靠前到最靠后。
     顶面重合的方块叠在同一处，只有最靠前那块看得见 —— 想选被挡住的那块，
     就在同一个点上再点一下，一次往后翻一块。 */
  function pickAllCubes(sx, sy) {
    if (!H) return [];
    const w = H.toWorld(sx, sy);
    const p = { u: w.x, v: w.y };
    const out = [];
    for (const el of pickCubesSorted()) {
      const f = cubeFaces(el.x, el.y, el.z, R);
      if (inPoly(p, f.top) || inPoly(p, f.lf) || inPoly(p, f.rf)) out.push(el);
    }
    return out;
  }
  /* 屏幕点上「画面上看得见的」方块，从最靠前到最靠后 */
  function pickCubesSorted() {
    const m = effIdx();
    return sortedCubes()
      .sort((a, b) => (m.get(b.el) || 0) - (m.get(a.el) || 0))
      .map((it) => it.el);
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
  /* 选中的方块：在它顶面上方浮一个小牌子，写明它是 A 还是 B、现在是第几层。
     被前面方块挡住的时候，这块牌子还露在最上面，一眼能看出选的是哪一层。
     两块都选中时按 A / B 上下错开，顶面完全重合也不会叠在一起。 */
  const SEL_COL = [
    { line: 'rgba(255,186,60,0.95)', text: '#ffd9a0' },
    { line: 'rgba(104,204,255,0.95)', text: '#bfe9ff' }
  ];
  function drawSelBadge(g, el, idx) {
    const tp = topCenter(el.x, el.y, el.z, R);
    const col = SEL_COL[idx % SEL_COL.length];
    const behind = !visibleCell([el.x, el.y, el.z], R);
    const tag = sel.length > 1 ? (idx === 0 ? 'A · ' : 'B · ') : '';
    const label = tag + '第 ' + (el.z + 1) + ' 层' + (behind ? '（被挡住）' : '');
    g.save();
    g.font = '600 12px "Segoe UI", "Microsoft YaHei", sans-serif';
    const w = Math.max(46, g.measureText(label).width + 14);
    const x = tp.u - w / 2, y = tp.v - 34 - idx * 23;
    g.globalAlpha = 0.92;
    g.fillStyle = 'rgba(30,24,16,0.88)';
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, 19, 9); else g.rect(x, y, w, 19);
    g.fill();
    g.strokeStyle = col.line; g.lineWidth = 1.4; g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = col.text; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, tp.u, y + 10);
    g.restore();
  }
  /* 手动改过的「谁压谁」：把 A 重画一遍，但只补在「A 和 B 重叠、而且 B 现在压在 A 上面」
     的那一小块 —— 其余像素（包括 A / B 跟第三块的前后）一个都不动。 */
  /* 方块轮廓（顶面 + 两个前侧面并成的六边形）。
     grow > 0 时把每条边整体朝外挪 grow —— 轮廓线是以边界为中心画的（线宽 1.3，
     斜角处还会更尖），贴着边界裁会把朝外那半条留下来，所以要把裁剪区稍微撑开。
     用「每条边平移、相邻边求交」而不是「顶点沿半径外推」：后者在斜边上会被压扁
     （放大到 7 倍时正好差一点，细线又会露出来）。
     撑开之后几条面会互相重叠，所以绕向统一过，nonzero 才不会互相抵消。 */
  function polyArea(q) {
    let a = 0;
    for (let n = 0; n < q.length; n++) {
      const p = q[n], r = q[(n + 1) % q.length];
      a += p.u * r.v - r.u * p.v;
    }
    return a / 2;
  }
  function polyPts(q, grow) {
    if (!grow) return q;
    const pts = polyArea(q) < 0 ? q.slice().reverse() : q;   // 让外侧法线恒为 (dy,-dx)
    const n = pts.length, L = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], r = pts[(i + 1) % n];
      const dx = r.u - p.u, dy = r.v - p.v, len = Math.hypot(dx, dy) || 1;
      L.push({ px: p.u + (dy / len) * grow, py: p.v - (dx / len) * grow, dx, dy });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = L[(i + n - 1) % n], b = L[i];
      const den = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(den) < 1e-9) { out.push({ u: b.px, v: b.py }); continue; }
      const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
      out.push({ u: a.px + a.dx * t, v: a.py + a.dy * t });
    }
    return out;
  }
  function addPoly(g, q, flip) {
    let pts = polyArea(q) < 0 ? q.slice().reverse() : q;  // 统一绕向（正）
    if (flip) pts = pts.slice().reverse();
    g.moveTo(pts[0].u, pts[0].v);
    for (let n = 1; n < pts.length; n++) g.lineTo(pts[n].u, pts[n].v);
    g.closePath();
  }
  /* 一个方块的轮廓 = 8 个角投影后的凸包（单个凸六边形）。
     以前用「三个面拼起来」，三块面一起外扩时会互相重叠：nonzero 下重叠处绕数是 2，
     拿去做「挖掉」时减 1 还剩 1，等于没挖掉 —— 主角在重画区里被盖住就是这么来的。
     凸包永远只有一个多边形，绕数恒为 1。 */
  function hullPts(ps) {
    const a = ps.slice().sort((p, q) => (p.u - q.u) || (p.v - q.v));
    if (a.length < 3) return a;
    const cr = (o, p, q) => (p.u - o.u) * (q.v - o.v) - (p.v - o.v) * (q.u - o.u);
    const lo = [], up = [];
    for (const p of a) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (let i = a.length - 1; i >= 0; i--) {
      const p = a[i];
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function boxHull(x0, y0, z0, sx, sy, sz) {
    const ps = [];
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) {
      ps.push(pt(x0 + a * sx, y0 + b * sy, z0 + c * sz, null));
    }
    return hullPts(ps);
  }
  const silHull = (el) => boxHull(el.x, el.y, el.z, 1, 1, 1);
  function bbOf(q) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of q) {
      if (p.u < x0) x0 = p.u; if (p.u > x1) x1 = p.u;
      if (p.v < y0) y0 = p.v; if (p.v > y1) y1 = p.v;
    }
    return { x0, y0, x1, y1 };
  }
  function bbHit(a, b) { return !(a.x0 > b.x1 || a.x1 < b.x0 || a.y0 > b.y1 || a.y1 < b.y0); }
  function playerHull() {                               // 主角小方块的轮廓（凸包，单个多边形）
    const b = playerBox();
    return boxHull(b.pos.x - b.sz / 2, b.pos.y - b.sz / 2, b.z, b.sz, b.sz, b.dz);
  }
  function subPortal(g, el) {                            // 传送门那一片，别被补画抹掉
    const pb = portalBase(el);
    const cy = pb.v - S * 1.15 * 0.62;
    g.moveTo(pb.u + S * 0.74, cy);
    g.ellipse(pb.u, cy, S * 0.74, S * 1.25, 0, 0, TAU);
  }
  function hasPortal(el) {
    return portals.some((p) => p.x === el.x && p.y === el.y && p.z === el.z);
  }

  /* ---------------- 主角的遮挡：只看脚下这块的顶面 ----------------
     规则（画面说了算）：
       顶面整个露着           → 主角完整，一个像素都不切；
       顶面被谁啃掉一部分     → 主角也被啃掉「正上方」对应的那一部分，
                                边界就是从顶面那条边界竖直往上拉出来的。
     做法：按基础绘制次序 + 每一对「手动换过上下」的补画区，算出脚底那一小块顶面
     实际被谁盖住（补画区内按补画后的次序）；再沿屏幕竖直方向往上扫出主角的高度，
     就是主角该被挖掉的区域。边界严格是顶面那条。 */
  function standEl() {
    const m = player.moved;
    if (m) {
      const a = cubes.get(ck(m.fi, m.fj, m.fk));
      const b = cubes.get(ck(m.ti, m.tj, m.tk));
      if (a && b) return depth(a.x, a.y, a.z) >= depth(b.x, b.y, b.z) ? a : b;
      return a || b || null;
    }
    return cubes.get(ck(player.i, player.j, player.k)) || null;
  }
  /* 主角现在脚底下踩着的顶面（走路跨格时是两块）。两块同高时要把两块都算上，
     否则换到另一半的那一瞬间，遮挡会从「有」跳到「没有」，看上去就是闪一下。 */
  function standFaces() {
    const m = player.moved;
    if (m) {
      const a = cubes.get(ck(m.fi, m.fj, m.fk));
      const b = cubes.get(ck(m.ti, m.tj, m.tk));
      if (a && b && a.z === b.z) return [a, b];
      if (a && b) return [depth(a.x, a.y, a.z) >= depth(b.x, b.y, b.z) ? a : b];
      const one = a || b;
      return one ? [one] : [];
    }
    const c = cubes.get(ck(player.i, player.j, player.k));
    return c ? [c] : [];
  }
  function topPts(el) {                                  // 顶面四角（跟着转视角动画）
    const z = el.z + 1;
    return [pt(el.x, el.y, z, null), pt(el.x + 1, el.y, z, null),
      pt(el.x + 1, el.y + 1, z, null), pt(el.x, el.y + 1, z, null)];
  }
  /* 去掉重合的顶点（Sutherland–Hodgman 在「顶点正好落在裁剪边上」时会吐重复点）。
     零长度的边会让后面的半平面判断退化，必须先清掉。 */
  function cleanPoly(q) {
    const out = [];
    for (const p of q) {
      const l = out[out.length - 1];
      if (!l || Math.abs(p.u - l.u) > 0.02 || Math.abs(p.v - l.v) > 0.02) out.push(p);
    }
    while (out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (Math.abs(a.u - b.u) <= 0.02 && Math.abs(a.v - b.v) <= 0.02) out.pop(); else break;
    }
    return out.length >= 3 ? out : [];
  }
  /* 凸多边形求交（Sutherland–Hodgman）。两块都是凸的，结果是凸的。 */
  function clipConvex(subj, clip) {
    if (subj.length < 3 || clip.length < 3) return [];
    const sgn = polyArea(clip) >= 0 ? 1 : -1;
    let out = cleanPoly(subj);
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length];
      const side = (p) => ((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) * sgn;
      const src = out, dst = [];
      for (let n = 0; n < src.length; n++) {
        const p = src[n], q = src[(n + 1) % src.length];
        const dp = side(p), dq = side(q);
        if (dp >= 0) dst.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
          const t = dp / (dp - dq);
          dst.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
        }
      }
      out = cleanPoly(dst);
    }
    return out;
  }
  /* 把一块凸区域沿屏幕上方向扫出 dy 像素（= 顶面被盖住的那块，正上方整个柱子） */
  function sweepUp(q, dy) {
    const ps = q.map((p) => ({ u: p.u, v: p.v }));
    for (const p of q) ps.push({ u: p.u, v: p.v - dy });
    return hullPts(ps);
  }
  /* 脚下这块的顶面「在主角脚底这一小块下面」被谁盖住了。
     只看脚底那一块（footPts），不看整张脸 —— 主角站在中间，脚底压着的那部分顶面
     才跟它有上下关系。走路跨在两块上时两块顶面一起算（不然换到另一半的那一瞬
     遮挡会跳变）。补画区（手动换过上下）的次序也在脸平面上算清楚：
     区内 A 被提到 B 之上，按 A 在最上面看；区外按基础次序看。
     返回的 holes 是「脸被盖住的那一小块」，主角用的时候沿屏幕竖直方向往上扫出
     主角的高度再挖掉，边界就和顶面那条完全一致。 */
  function footPts(S0) {
    const b = playerBox();
    const z = S0.z + 1, h = b.sz / 2;
    const x0 = b.pos.x - h, y0 = b.pos.y - h;
    return [pt(x0, y0, z, null), pt(x0 + b.sz, y0, z, null),
      pt(x0 + b.sz, y0 + b.sz, z, null), pt(x0, y0 + b.sz, z, null)];
  }
  /* 凸多边形 A 减去凸多边形 B：拆成「A 落在 B 每条边外侧」的几块并起来（允许重叠）。
     每块仍是凸的，可以直接拿去 clip。 */
  function subConvex(A, B) {
    if (A.length < 3) return [];
    if (B.length < 3 || Math.abs(polyArea(B)) < 0.25) return [A];   // 退化 → 不用减
    const sgn = polyArea(B) >= 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < B.length; i++) {
      const a = B[i], b = B[(i + 1) % B.length];
      if (Math.abs(b.u - a.u) < 0.02 && Math.abs(b.v - a.v) < 0.02) continue;  // 零长边
      const side = (p) => ((b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u)) * sgn;
      const dst = [];
      for (let n = 0; n < A.length; n++) {
        const p = A[n], q = A[(n + 1) % A.length];
        const dp = -side(p), dq = -side(q);
        if (dp >= 0) dst.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
          const t = dp / (dp - dq);
          dst.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
        }
      }
      if (dst.length >= 3 && Math.abs(polyArea(dst)) > 0.25) out.push(dst);
    }
    return out;
  }
  function playerOccl() {
    const Ss = standFaces();
    if (!Ss.length) return null;
    const S0 = Ss[0];
    const bi = baseIdx();
    if (bi.get(S0) == null) return null;
    const Ps = Ss.map((el) => topPts(el));
    const bbP = bbOf(Ps.reduce((a, b) => a.concat(b), []));
    const F = footPts(S0);
    const area = (q) => (q.length >= 3 ? Math.abs(polyArea(q)) : 0);
    const pairs = [];
    for (const [A, B] of covPairs()) {
      const ia = bi.get(A), ib = bi.get(B);
      if (ia == null || ib == null || ib < ia) continue;   // 本来就画在前面，没补画
      pairs.push([A, B, ia, ib]);
    }
    const Rs = [], pairHoles = [];
    for (const [A, B, ia, ib] of pairs) {
      const R = clipConvex(silHull(A), silHull(B));
      if (area(R) < 1) continue;
      let used = false;
      for (let k = 0; k < Ps.length; k++) {
        const Pf = Ps[k], el = Ss[k], nF = bi.get(el);
        const PR = clipConvex(Pf, R);
        if (area(PR) < 0.75) continue;                     // 没盖到这一块脸
        used = true;
        let hs;
        if (el !== A && nF <= ib) hs = [PR];               // 区内 A 在最上面：脸全没了
        else {
          hs = [];                                         // 区内脚下这块在最上面，只剩比 B 还靠前的
          for (const c of cubes.values()) {
            if (c === el) continue;
            const n = bi.get(c);
            if (n == null || n <= Math.max(ib, nF)) continue;
            const q = clipConvex(PR, silHull(c));
            if (area(q) > 0.75) hs.push(q);
          }
        }
        for (const q of hs) {
          const fq = clipConvex(q, F);
          if (area(fq) > 0.5) pairHoles.push(fq);
        }
      }
      if (used) Rs.push(R);
    }
    const holes = [];
    for (let k = 0; k < Ps.length; k++) {
      const Pf = Ps[k], el = Ss[k], nF = bi.get(el);
      for (const c of cubes.values()) {
        if (c === el) continue;
        const n = bi.get(c);
        if (n == null || n <= nF) continue;                // 基础次序：画在它后面
        const h = silHull(c);
        if (!bbHit(bbOf(h), bbP)) continue;
        const q = clipConvex(Pf, h);
        if (area(q) <= 0.75) continue;
        let ps = [clipConvex(q, F)];
        for (const R of Rs) {
          const next = [];
          for (const p of ps) for (const piece of subConvex(p, R)) next.push(piece);
          ps = next;
        }
        for (const p of ps) if (area(p) > 0.5) holes.push(p);
      }
    }
    for (const q of pairHoles) holes.push(q);
    return { S: S0, P: Ps[0], faces: Ss, F, Rs, holes };
  }
  /* 洞是不是把脚底那一整圈都盖住了。只看边界 + 中心：只要边上还露一丁点，
     就必须画（哪怕只剩 1px）；边上一整圈都盖住、只剩描边时，才整块不画，
     免得留下一圈空心的轮廓线。 */
  function allHidden(holes, F) {
    let cu = 0, cv = 0;
    for (const p of F) { cu += p.u; cv += p.v; }
    cu /= F.length; cv /= F.length;
    const G = F.map((p) => ({ u: cu + (p.u - cu) * 0.995, v: cv + (p.v - cv) * 0.995 }));
    const N = 32;
    const pts = [{ u: cu, v: cv }];
    for (let i = 0; i < G.length; i++) {
      const a = G[i], b = G[(i + 1) % G.length];
      for (let n = 0; n < N; n++) {
        const t = n / N;
        pts.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
      }
    }
    for (const p of pts) {
      let hit = false;
      for (const q of holes) if (inPoly(p, q)) { hit = true; break; }
      if (!hit) return false;
    }
    return true;
  }
  function drawPlayerMasked(g, st) {
    const o = playerOccl();
    if (!o || !o.holes.length) { drawPlayer(g, st); return; }   // 顶面整个露着 → 主角完整
    if (allHidden(o.holes, o.F)) return;                       // 顶面整块被盖 → 主角整块不见
    const b = playerBox();
    const lift = Math.max(0, b.z - (o.S.z + 1)) * S;           // 落下 / 上台阶时高出来的那段
    const dy = b.dz * S + lift + 2;
    const big = 1e5;
    g.save();
    for (const q of o.holes) {
      g.beginPath();
      g.moveTo(-big, -big); g.lineTo(-big, big); g.lineTo(big, big); g.lineTo(big, -big); g.closePath();
      // 往外撑 0.9：描边是以边界为中心画的，贴着洞裁会把朝外那半条线留下（空心轮廓）
      addPoly(g, polyPts(sweepUp(q, dy), 0.9));               // 正绕：跟大矩形抵消，挖掉
      g.clip();
    }
    drawPlayer(g, st);
    g.restore();
  }

  /* 手动改过的「谁压谁」：把 A 重画一遍，只补在 A、B 重叠的那一小块，
     其余像素（包括 A / B 跟第三块的前后、主角）一个都不动。
     分两遍：
       第一遍：B 的身子（正好 sil(A) ∩ sil(B)）—— 挖掉本来就画在 B 前面的东西；
       第二遍：B 轮廓线那一圈（外扩 1.6）—— 轮廓线是以边界为中心画的，朝外那半条
               落在 B 的身子外面，不补就会留一条黑边；这一圈只挖「画在 A 前面的」，
               所以绝不会盖到第三块。
     主角不在这里处理：主角最后单独画，按「脚下这块顶面还露着多少」裁。 */
  function repaintFront(g, A, B, bidx, st) {
    const nA = bidx.get(A), nB = bidx.get(B);
    const hA = silHull(A), hB = silHull(B), bbA = bbOf(hA);
    const big = 1e5;
    // 每个要挖掉的区域单独 clip 一次：几次 clip 之间是求交集，等于求并集，
    // 区域重叠时也不会像一个路径里那样绕数相加互相抵消。
    const cut = (fill) => {
      g.beginPath();
      g.moveTo(-big, -big); g.lineTo(-big, big); g.lineTo(big, big); g.lineTo(big, -big); g.closePath();
      fill();
      g.clip();
    };
    for (let pass = 0; pass < 2; pass++) {
      g.save();
      g.beginPath(); addPoly(g, hA); g.clip();              // 只在 A 的轮廓里
      g.beginPath();
      if (pass === 0) addPoly(g, hB);                       // ∩ B 的身子
      else {                                               // ∩ B 外面那一圈
        addPoly(g, polyPts(hB, 1.6));
        addPoly(g, hB, true);                              // 反着绕：挖空，只留环
      }
      g.clip();
      const lim = pass === 0 ? nB : nA;
      for (const el of cubes.values()) {
        if (el === A || el === B) continue;
        const n = bidx.get(el);
        if (n == null || n <= lim) continue;
        const h = silHull(el);
        if (!bbHit(bbOf(h), bbA)) continue;
        cut(() => addPoly(g, h));
      }
      if (hasPortal(A)) cut(() => subPortal(g, A));
      if (hasPortal(B)) cut(() => subPortal(g, B));
      drawCubeEl(g, A);
      g.restore();
    }
  }
  function drawCubeEl(g, el) {
    const cols = el === markEl ? ['#ff00ff', PAL[0][1], PAL[0][2]] : PAL[0];
    drawBox(g, el.x, el.y, el.z, 1, 1, 1, cols, null, null, EDGE);
    const si = tool === 'select' ? sel.indexOf(el) : -1;
    if (si >= 0) {
      const f = cubeFaces(el.x, el.y, el.z, R);
      g.save();
      g.lineJoin = 'round';
      g.strokeStyle = SEL_COL[si % SEL_COL.length].line;
      g.lineWidth = 2.6;
      for (const q of [f.rf, f.lf, f.top]) {
        g.beginPath();
        g.moveTo(q[0].u, q[0].v);
        for (let n = 1; n < q.length; n++) g.lineTo(q[n].u, q[n].v);
        g.closePath();
        g.stroke();
      }
      g.restore();
    }
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
  function playerBox() {
    const ease = easeOut(clamp(player.spawnT, 0, 1));
    const pos = playerPos();
    const sz = 0.62;
    let z = pos.z;
    if (player.spawnT < 1) z += (1 - ease) * 1.1;
    return { ease, pos, z, sz, dz: sz * (0.4 + 0.6 * ease) };
  }
  function drawPlayer(g, st) {
    const b = playerBox();
    g.save();
    g.globalAlpha = clamp(b.ease * 1.15, 0, 1);
    // 影子
    if (player.spawnT > 0.6) {
      const c = pt(b.pos.x, b.pos.y, b.z, null);
      g.globalAlpha = 0.15 * b.ease;
      g.fillStyle = '#20303d';
      g.beginPath(); g.ellipse(c.u, c.v, S * 0.34, S * 0.17, 0, 0, TAU); g.fill();
      g.globalAlpha = clamp(b.ease * 1.15, 0, 1);
    }
    drawBox(g, b.pos.x - b.sz / 2, b.pos.y - b.sz / 2, b.z, b.sz, b.sz, b.dz, RED, null, null, 'rgba(90,20,12,0.5)');
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
