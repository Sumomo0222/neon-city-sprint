/* ============================================================
   霓虹城市冲刺 NEON CITY SPRINT
   伪3D 跑酷：手动透视投影 + DOM/SVG 实体池
   无框架 · 无外部素材 · 可直接静态部署
   ============================================================ */
'use strict';

/* ---------------- 小工具 ---------------- */
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mod = (a, b) => ((a % b) + b) % b;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------- 世界常量（单位：米） ---------------- */
const LANES_X = [-2.4, 0, 2.4];   // 三条车道横向坐标
const ROAD_HALF = 4.3;            // 路面半宽
const CAM_H = 3.1;                // 虚拟相机高度
const PLAYER_Z = 1.7;             // 玩家所在纵深
const SPAWN_Z = 92;               // 实体生成纵深
const FAR_Z = 70;                 // 远景消隐纵深
const KILL_Z = 0.55;              // 回收纵深
const START_SPEED = 9;            // 初速 m/s
const MAX_SPEED = 20;             // 速度上限
const ACCEL = 0.14;               // 每秒加速度（轻微提升）
const ATTRACT_SPEED = 6;          // 标题画面巡航速度
const JUMP_V = 7.4;               // 起跳速度
const GRAVITY = 21;               // 重力
const BARRIER_CLEAR_Y = 0.62;     // 跳过路障所需高度

/* ---------------- DOM ---------------- */
const sceneEl = $('#scene');
const worldEnt = $('#entities');
const worldScn = $('#scenery');
const roadEl = $('#road');
const playerWrap = $('#player-wrap');
const playerEl = $('#player');
const pShadow = $('#p-shadow');
const runnerEl = $('#runner');
const hudEl = $('#hud');
const hudDist = $('#hud-dist');
const hudCoin = $('#hud-coin');
const hudCoinBox = $('#hud-coin').parentElement;
const hudSpeed = $('#hud-speed');
const hudLane = $('#hud-lane');
const hintEl = $('#hint');
const controlsEl = $('#controls');
const overlayStart = $('#overlay-start');
const overlayOver = $('#overlay-over');
const skyFarWrap = $('.sky-far');
const skyNearWrap = $('.sky-near');
const skyFarSvg = $('#sky-far-svg');
const skyNearSvg = $('#sky-near-svg');

/* ---------------- 音效（WebAudio 合成，无素材文件） ---------------- */
const AudioSys = {
  ctx: null,
  muted: false,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 无音频环境 */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.1, slide = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  },
  coin()  { this.tone(880, .09, 'sine', .10); setTimeout(() => this.tone(1318, .12, 'sine', .10), 55); },
  jump()  { this.tone(170, .18, 'square', .05, 260); },
  lane()  { this.tone(300, .05, 'square', .035); },
  crash() { this.tone(150, .42, 'sawtooth', .15, -110); this.tone(58, .5, 'triangle', .13, -20); },
  start() { this.tone(523, .12, 'sine', .07); setTimeout(() => this.tone(784, .2, 'sine', .07), 110); }
};

/* ---------------- 视口与投影 ---------------- */
let W = 0, H = 0, cx = 0, horizonY = 0, FOCAL = 0, G = 0, zBot = 1, skyFarW = 1, skyNearW = 1;
let roadSvg, edgeL, edgeR;

function layout() {
  const r = sceneEl.getBoundingClientRect();
  W = r.width; H = r.height; cx = W / 2;
  horizonY = H * 0.40;
  FOCAL = Math.min(H * 0.155, W * 0.42);
  G = FOCAL * CAM_H;                       // 地面投影系数：y = horizonY + G/z
  zBot = G / (H - horizonY);               // 屏幕底边对应的纵深
  skyFarW = skyFarWrap.clientWidth || 1;
  skyNearW = skyNearWrap.clientWidth || 1;

  // 路面梯形裁剪
  const xl = cx - ROAD_HALF * FOCAL / zBot, xr = cx + ROAD_HALF * FOCAL / zBot;
  const fl = cx - ROAD_HALF * FOCAL / FAR_Z, fr = cx + ROAD_HALF * FOCAL / FAR_Z;
  const yf = horizonY + G / FAR_Z;
  roadEl.style.clipPath = `polygon(${xl}px ${H}px, ${xr}px ${H}px, ${fr}px ${yf}px, ${fl}px ${yf}px)`;

  // 两侧霓虹路缘线
  if (!roadSvg) {
    roadSvg = document.createElementNS(SVG_NS, 'svg');
    roadSvg.id = 'road-svg';
    roadSvg.style.filter = 'drop-shadow(0 0 5px rgba(34,230,255,.45))';
    edgeL = document.createElementNS(SVG_NS, 'polygon');
    edgeR = document.createElementNS(SVG_NS, 'polygon');
    edgeL.setAttribute('fill', 'rgba(34,230,255,.85)');
    edgeR.setAttribute('fill', 'rgba(255,62,205,.8)');
    roadSvg.append(edgeL, edgeR);
    roadEl.appendChild(roadSvg);
  }
  roadSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const eL = 0.26 * FOCAL, eOut = 0.62 * FOCAL;
  const px = (m, z) => cx + m * FOCAL / z;
  const py = (z) => horizonY + G / z;
  edgeL.setAttribute('points',
    `${px(-ROAD_HALF, zBot)},${H} ${px(-ROAD_HALF + 0.2, zBot)},${H} ${px(-ROAD_HALF + 0.2, FAR_Z)},${py(FAR_Z)} ${px(-ROAD_HALF, FAR_Z)},${py(FAR_Z)}`);
  edgeR.setAttribute('points',
    `${px(ROAD_HALF - 0.2, zBot)},${H} ${px(ROAD_HALF, zBot)},${H} ${px(ROAD_HALF, FAR_Z)},${py(FAR_Z)} ${px(ROAD_HALF - 0.2, FAR_Z)},${py(FAR_Z)}`);

  buildStars();
}

// 投影：世界坐标(x米, 纵深z, 离地y米) → 屏幕位置 + 缩放
function place(el, xM, z, yM = 0, extraRot = 0) {
  const s = FOCAL / z;
  const x = cx + xM * s;
  const y = horizonY + G / z - yM * s;
  const k = s / 100; // 实体设计尺寸：100px = 1米
  el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${k.toFixed(4)})` +
    (extraRot ? ` rotate(${extraRot.toFixed(1)}deg)` : '');
}
function makeEnt(cls, wM, hM, innerHTML = '') {
  const el = document.createElement('div');
  el.className = 'ent ' + cls;
  const w = wM * 100, h = hM * 100;
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.marginLeft = (-w / 2) + 'px';
  el.style.marginTop = (-h) + 'px';
  if (innerHTML) el.innerHTML = innerHTML;
  return el;
}

/* ---------------- 背景生成：星空 / 车流 / 城市剪影 ---------------- */
function buildStars() {
  const sky = $('.sky');
  sky.querySelectorAll('.star').forEach(n => n.remove());
  const n = Math.round(clamp(W * H / 14000, 26, 70));
  for (let i = 0; i < n; i++) {
    const st = document.createElement('i');
    st.className = 'star';
    const sz = Math.random() < 0.24 ? 2 : 1;
    st.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;` +
      `left:${rand(0, 100).toFixed(1)}%;top:${rand(0, 78).toFixed(1)}%;` +
      `background:#dfe9ff;opacity:${rand(0.25, 0.9).toFixed(2)};` +
      `box-shadow:0 0 ${sz * 2}px rgba(200,225,255,.8);`;
    sky.appendChild(st);
  }
}

function buildTraffic() {
  const box = $('.t-lights');
  const n = 12;
  for (let i = 0; i < n; i++) {
    const it = document.createElement('i');
    const toRight = i % 2 === 0;
    it.className = toRight ? 'head' : 'tail';
    const w = rand(26, 84);
    it.style.cssText = `top:${rand(8, 86).toFixed(0)}%;left:${toRight ? '-12%' : '104%'};width:${w.toFixed(0)}px;` +
      `--tx:${toRight ? '124vw' : '-124vw'};` +
      `animation-duration:${rand(4, 9).toFixed(1)}s;animation-delay:-${rand(0, 8).toFixed(1)}s;`;
    box.appendChild(it);
  }
}

const SIGNS = ['夜行电台', 'NEON', '24H', '拉面', 'CLUB', '咖啡', 'HOTEL', '电子城', 'BAR', '便利商店'];

function buildSkyline(svgEl, opt) {
  const PW = 1600, PH = 300;
  svgEl.setAttribute('viewBox', `0 0 ${PW * 2} ${PH}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  let s = '';
  for (let copy = 0; copy < 2; copy++) {
    s += `<g transform="translate(${copy * PW},0)">`;
    let x = -20;
    while (x < PW) {
      const bw = rand(opt.minW, opt.maxW);
      const bh = rand(opt.minH, opt.maxH);
      const by = PH - bh;
      s += `<rect x="${x.toFixed(0)}" y="${by.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="${opt.body}"/>`;
      // 点亮窗格
      const cols = Math.max(2, Math.floor(bw / 26));
      const rows = Math.max(2, Math.floor(bh / 30));
      for (let c = 0; c < cols; c++) {
        for (let rr = 0; rr < rows; rr++) {
          if (Math.random() < opt.winChance) {
            const wx = x + 8 + c * (bw - 12) / cols;
            const wy = by + 10 + rr * (bh - 14) / rows;
            s += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="7" fill="${pick(opt.winColors)}" opacity="${rand(0.35, 0.95).toFixed(2)}"/>`;
          }
        }
      }
      // 霓虹招牌
      if (bh > opt.signMinH && Math.random() < opt.signChance) {
        const col = pick(opt.neon);
        const sw = rand(44, Math.min(bw - 20, 110));
        const sx = x + rand(8, Math.max(9, bw - sw - 8));
        const sy = by + rand(14, Math.min(bh - 46, 84));
        if (Math.random() < 0.62) {
          s += `<rect x="${sx.toFixed(0)}" y="${sy.toFixed(0)}" width="${sw.toFixed(0)}" height="18" rx="3" fill="none" stroke="${col}" stroke-width="2.5" opacity=".92"/>` +
            `<text x="${(sx + sw / 2).toFixed(0)}" y="${(sy + 14).toFixed(0)}" font-size="12" font-weight="700" letter-spacing="2" fill="${col}" text-anchor="middle" font-family="sans-serif">${pick(SIGNS)}</text>`;
        } else {
          // 竖版招牌
          const vh = rand(34, 64);
          s += `<rect x="${sx.toFixed(0)}" y="${sy.toFixed(0)}" width="13" height="${vh.toFixed(0)}" rx="3" fill="none" stroke="${col}" stroke-width="2.5" opacity=".92"/>`;
          for (let k = 0; k < 3; k++) s += `<rect x="${(sx + 4).toFixed(0)}" y="${(sy + 7 + k * (vh - 16) / 2.6).toFixed(0)}" width="5" height="7" fill="${col}" opacity=".9"/>`;
        }
      }
      // 天线与航空警示灯
      if (Math.random() < 0.3 && bh > opt.signMinH * 0.9) {
        const ax = x + bw / 2;
        s += `<line x1="${ax.toFixed(0)}" y1="${by.toFixed(0)}" x2="${ax.toFixed(0)}" y2="${(by - rand(16, 34)).toFixed(0)}" stroke="${opt.body}" stroke-width="2.5"/>` +
          `<circle class="b-flash" cx="${ax.toFixed(0)}" cy="${(by - 20).toFixed(0)}" r="3" fill="#ff5c6c"/>`;
      }
      x += bw + rand(2, 22);
    }
    s += '</g>';
  }
  svgEl.innerHTML = s;
}

/* ---------------- 场景素材（SVG 字符串，全部自绘） ---------------- */
const SVG_LAMP = (dir) => `<div class="mir" style="width:100%;height:100%;transform:${dir ? '' : 'scaleX(-1)'}">` +
  `<svg viewBox="0 0 70 520" xmlns="${SVG_NS}">` +
  `<g class="lamp-pole"><rect x="31" y="34" width="8" height="486" rx="4" fill="#10173a" stroke="#2a3a6a" stroke-width="2"/>` +
  `<path d="M35 44 C 35 18, 22 14, 10 17" stroke="#2a3a6a" stroke-width="7" fill="none"/>` +
  `<rect x="30" y="506" width="10" height="12" rx="3" fill="#0c1128"/></g>` +
  `<ellipse class="lamp-head" cx="10" cy="22" rx="10" ry="5.5" fill="#d9f6ff"/>` +
  `<polygon points="6,26 -22,210 34,210" fill="rgba(140,225,255,.10)"/></svg></div>`;

const SVG_POST = `<svg viewBox="0 0 35 95" xmlns="${SVG_NS}">` +
  `<rect x="12" y="26" width="10" height="60" rx="3" fill="#10173a" stroke="#2a3a6a" stroke-width="2"/>` +
  `<rect class="post-tip" x="10" y="16" width="14" height="11" rx="3" fill="#22e6ff"/>` +
  `<rect x="8" y="84" width="18" height="9" rx="2" fill="#0c1128"/></svg>`;

const BOARDS = [
  { color: '#22e6ff', t: '夜行电台', sub: 'FM 88.8 · CITY NIGHT' },
  { color: '#ff3ecd', t: 'NEON CITY', sub: '24H · 便利商店' },
  { color: '#ffd166', t: '拉面 一番', sub: '深夜营业中' }
];
const svgBoard = (b) => `<svg viewBox="0 0 520 380" xmlns="${SVG_NS}">` +
  `<rect x="70" y="248" width="14" height="132" fill="#10173a" stroke="#2a3a6a" stroke-width="2"/>` +
  `<rect x="436" y="248" width="14" height="132" fill="#10173a" stroke="#2a3a6a" stroke-width="2"/>` +
  `<rect x="10" y="10" width="500" height="250" rx="14" fill="#0b1030" stroke="${b.color}" stroke-width="5"/>` +
  `<circle cx="32" cy="32" r="4" fill="${b.color}"/><circle cx="488" cy="32" r="4" fill="${b.color}"/>` +
  `<text x="260" y="128" text-anchor="middle" font-size="54" font-weight="800" letter-spacing="10" fill="${b.color}" font-family="sans-serif">${b.t}</text>` +
  `<text x="260" y="184" text-anchor="middle" font-size="21" letter-spacing="12" fill="rgba(235,240,255,.6)" font-family="sans-serif">${b.sub}</text>` +
  `<rect x="150" y="212" width="220" height="6" rx="3" fill="${b.color}" opacity=".75"/></svg>`;

const SVG_BARRIER = `<svg viewBox="0 0 220 100" xmlns="${SVG_NS}">` +
  `<path d="M28 82 l-9 16 M28 82 l9 16 M192 82 l-9 16 M192 82 l9 16" stroke="#22e6ff" stroke-width="4" fill="none"/>` +
  `<rect x="16" y="64" width="188" height="20" rx="5" fill="#141a3c" stroke="#ff3ecd" stroke-width="2.5"/>` +
  [28, 62, 96, 130, 164].map(x0 =>
    `<path d="M${x0} 84 L${x0 + 14} 64 h13 L${x0 + 13} 84 Z" fill="#ffb84d"/>`).join('') +
  `<line x1="110" y1="64" x2="110" y2="52" stroke="#22e6ff" stroke-width="3"/>` +
  `<circle class="blinklight" cx="110" cy="47" r="6" fill="#ff4d6d"/></svg>`;

const SVG_TRUCK = `<svg viewBox="0 0 230 260" xmlns="${SVG_NS}">` +
  `<rect class="blinklight" x="103" y="6" width="24" height="14" rx="4" fill="#ff4d6d"/>` +
  `<rect x="12" y="24" width="206" height="198" rx="12" fill="#111739" stroke="#22e6ff" stroke-width="3"/>` +
  `<rect x="28" y="50" width="174" height="98" rx="8" fill="#0c1128" stroke="#ff3ecd" stroke-width="2.5"/>` +
  [56, 102, 148].map(x0 => `<path d="M${x0} 74 l30 25 l-30 25" stroke="#22e6ff" stroke-width="8" fill="none" opacity=".9"/>`).join('') +
  `<rect x="12" y="206" width="206" height="10" rx="5" fill="#ff3ecd" opacity=".85"/>` +
  `<rect x="34" y="222" width="46" height="32" rx="8" fill="#060a18" stroke="#22e6ff" stroke-width="2"/>` +
  `<rect x="150" y="222" width="46" height="32" rx="8" fill="#060a18" stroke="#22e6ff" stroke-width="2"/>` +
  `<rect x="20" y="252" width="190" height="8" rx="4" fill="rgba(34,230,255,.35)"/></svg>`;

const SVG_VAN = `<svg viewBox="0 0 230 210" xmlns="${SVG_NS}">` +
  `<rect x="96" y="6" width="38" height="14" rx="5" fill="#ff9f43" opacity=".95"/>` +
  `<rect x="16" y="20" width="198" height="154" rx="16" fill="#131a42" stroke="#7b5cff" stroke-width="3"/>` +
  `<rect x="40" y="34" width="150" height="22" rx="8" fill="rgba(123,92,255,.28)"/>` +
  `<line x1="115" y1="34" x2="115" y2="164" stroke="#7b5cff" stroke-width="3"/>` +
  `<rect x="62" y="96" width="30" height="7" rx="3.5" fill="#7b5cff" opacity=".8"/>` +
  `<rect x="138" y="96" width="30" height="7" rx="3.5" fill="#7b5cff" opacity=".8"/>` +
  `<rect x="26" y="140" width="24" height="13" rx="4" fill="#ff4d6d"/>` +
  `<rect x="180" y="140" width="24" height="13" rx="4" fill="#ff4d6d"/>` +
  `<rect x="16" y="166" width="198" height="10" rx="5" fill="#0c1128" stroke="#7b5cff" stroke-width="2"/>` +
  `<rect x="40" y="176" width="42" height="30" rx="8" fill="#060a18" stroke="#7b5cff" stroke-width="2"/>` +
  `<rect x="148" y="176" width="42" height="30" rx="8" fill="#060a18" stroke="#7b5cff" stroke-width="2"/></svg>`;

const OB_TYPES = {
  barrier: { w: 2.2, h: 1.0, jumpable: true,  cls: 'obs-barrier', svg: SVG_BARRIER },
  van:     { w: 2.3, h: 2.1, jumpable: false, cls: 'obs-van',     svg: SVG_VAN },
  truck:   { w: 2.4, h: 2.6, jumpable: false, cls: 'obs-truck',   svg: SVG_TRUCK }
};

/* ---------------- 场景实体池（虚线 / 灯柱 / 护栏桩 / 广告牌） ---------------- */
const dashes = [], lamps = [], posts = [], boards = [];
const DASH_N = 24, DASH_SP = 4;
const LAMP_N = 6, LAMP_SP = 18;
const POST_N = 14, POST_SP = 7;
const BOARD_N = 3, BOARD_SP = 47;

function initSceneryPools() {
  for (const lx of [-1.2, 1.2])
    for (let i = 0; i < DASH_N; i++) {
      const el = makeEnt('dash', 0.22, 1.7);
      worldScn.appendChild(el);
      dashes.push({ el, lx });
    }
  for (let i = 0; i < LAMP_N; i++) {
    const el = makeEnt('lamp', 0.7, 5.2, SVG_LAMP(true));
    worldScn.appendChild(el);
    lamps.push({ el, mir: el.querySelector('.mir'), side: 0 });
  }
  for (let i = 0; i < POST_N * 2; i++) {
    const el = makeEnt('post', 0.35, 0.95, SVG_POST);
    worldScn.appendChild(el);
    posts.push({ el, fixedSide: i % 2 === 0 ? -1 : 1, idx: i >> 1 });
  }
  for (let i = 0; i < BOARD_N; i++) {
    const el = makeEnt('board', 5.2, 3.8, svgBoard(BOARDS[i % BOARDS.length]));
    if (i % 3 === 1) el.classList.add('board-flicker');
    worldScn.appendChild(el);
    boards.push({ el, mir: null, side: 0, variant: i });
  }
  // 广告牌镜像容器
  for (const b of boards) {
    const inner = document.createElement('div');
    inner.className = 'mir';
    inner.style.cssText = 'width:100%;height:100%;';
    while (b.el.firstChild) inner.appendChild(b.el.firstChild);
    b.el.appendChild(inner);
    b.mir = inner;
  }
}

function updScenery(dist) {
  // 车道虚线：两条分道线
  const dLoop = DASH_N * DASH_SP;
  let di = 0;
  for (const lx of [-1.2, 1.2])
    for (let i = 0; i < DASH_N; i++) {
      const z = mod(i * DASH_SP - dist, dLoop) + 0.65;
      place(dashes[di++].el, lx, z);
    }
  // 路灯：左右交替
  const lLoop = LAMP_N * LAMP_SP;
  for (let i = 0; i < LAMP_N; i++) {
    const z = mod(i * LAMP_SP - dist, lLoop) + 0.8;
    const worldIdx = Math.round((dist + z - 0.8) / LAMP_SP);
    const side = worldIdx % 2 === 0 ? -1 : 1;
    const L = lamps[i];
    const wantMirror = side === -1 ? 'scaleX(-1)' : '';
    if (L.side !== side) {
      L.side = side;
      L.mir.style.transform = wantMirror;
    }
    place(L.el, side * (ROAD_HALF + 1.4), z);
  }
  // 护栏桩：两侧同步
  const pLoop = POST_N * POST_SP;
  for (const P of posts) {
    const z = mod(P.idx * POST_SP - dist, pLoop) + 0.6;
    place(P.el, P.fixedSide * (ROAD_HALF + 0.62), z);
  }
  // 广告牌：左右交替
  const bLoop = BOARD_N * BOARD_SP;
  for (let i = 0; i < BOARD_N; i++) {
    const z = mod(i * BOARD_SP - dist, bLoop) + 2;
    const worldIdx = Math.round((dist + z - 2) / BOARD_SP);
    const side = worldIdx % 2 === 0 ? -1 : 1;
    const B = boards[i];
    if (B.side !== side) {
      B.side = side;
      B.mir.style.transform = side === -1 ? 'scaleX(-1)' : '';
    }
    place(B.el, side * (ROAD_HALF + 2.8), z);
  }
}

/* ---------------- 游戏实体：障碍 / 能量币 ---------------- */
const obstacles = [];
const coins = [];

function addObstacle(type, lane, z) {
  const t = OB_TYPES[type];
  const el = makeEnt(t.cls, t.w, t.h, t.svg);
  worldEnt.appendChild(el);
  obstacles.push({ type, lane, z, w: t.w, h: t.h, jumpable: t.jumpable, el });
}
function addCoin(lane, z, y) {
  const el = makeEnt('coin', 0.82, 0.82, '<span class="coin-core"></span>');
  worldEnt.appendChild(el);
  coins.push({ lane, z, y, bob: Math.random() * Math.PI * 2, el });
}
function addCoinLine(lane, zStart, n, spacing) {
  for (let i = 0; i < n; i++) addCoin(lane, zStart - i * spacing, 0.78);
  return n * spacing;
}
function addCoinArc(lane, zc, peak, n, halfSpan) {
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    addCoin(lane, zc + t * halfSpan, 0.4 + (peak - 0.4) * (1 - t * t));
  }
  return halfSpan * 2;
}
function pickObType(diff) {
  const r = Math.random();
  if (diff === 0) return r < 0.5 ? 'barrier' : 'van';
  if (diff === 1) return r < 0.4 ? 'barrier' : r < 0.72 ? 'van' : 'truck';
  return r < 0.35 ? 'barrier' : r < 0.65 ? 'van' : 'truck';
}

function removeEnt(arr, i) {
  arr[i].el.remove();
  arr.splice(i, 1);
}
function clearEntities() {
  for (const o of obstacles) o.el.remove();
  for (const c of coins) c.el.remove();
  obstacles.length = 0;
  coins.length = 0;
}

/* ---------------- 关卡模式：保证永远有路可走 ---------------- */
function spawnPattern() {
  const d = dist;
  const allLanes = [0, 1, 2];
  const diff = d < 250 ? 0 : d < 600 ? 1 : 2;
  const z0 = SPAWN_Z;
  const roll = Math.random();
  let len = 4;

  if (roll < 0.32) {
    // 单障碍 + 相邻车道能量币
    const ol = randInt(0, 2);
    addObstacle(pickObType(diff), ol, z0);
    const cl = pick(allLanes.filter(l => l !== ol));
    len = Math.max(len, addCoinLine(cl, z0 - 3, 6, 3));
  } else if (roll < 0.56 && diff >= 1) {
    // 双车道封锁，空车道放币
    const free = randInt(0, 2);
    const others = allLanes.filter(l => l !== free);
    addObstacle(pickObType(diff), others[0], z0);
    addObstacle(pickObType(diff), others[1], z0 + rand(-1.5, 1.5));
    len = Math.max(len, addCoinLine(free, z0 - 5, 7, 3));
  } else if (roll < 0.7 && diff >= 1) {
    // 三连跳障（全部可跳跃）+ 中央币弧
    for (const l of allLanes) addObstacle('barrier', l, z0);
    len = Math.max(len, addCoinArc(1, z0, 1.65, 5, 2.2));
  } else if (roll < 0.86) {
    // 跳障 + 上方币弧（鼓励跳跃）
    const l = randInt(0, 2);
    addObstacle('barrier', l, z0);
    len = Math.max(len, addCoinArc(l, z0, 1.55, 5, 2.0));
    if (diff >= 1 && Math.random() < 0.5) {
      const l2 = pick(allLanes.filter(x => x !== l));
      addObstacle(pickObType(diff), l2, z0 + 10);
      len = Math.max(len, 12);
    }
  } else if (diff >= 2) {
    // 高难度：三段折返跑
    let l = randInt(0, 2);
    let zc = z0;
    for (let i = 0; i < 3; i++) {
      addObstacle(pickObType(2), l, zc);
      const free = pick(allLanes.filter(x => x !== l));
      addCoinLine(free, zc + 1.5, 3, 1.7);
      l = free;
      zc += 13;
    }
    len = zc + 2 - z0;
  } else {
    // 蜿蜒能量币走廊
    let l = randInt(0, 2);
    let zc = z0;
    for (let i = 0; i < 4; i++) {
      zc = Math.max(zc + addCoinLine(l, zc, 3, 1.8), zc + 5);
      l = clamp(l + pick([-1, 1]), 0, 2);
    }
    len = zc - z0;
  }

  const gap = clamp(30 - d / 140, 19, 30) + rand(-2, 3);
  nextPatternAt = d + gap + len;
}

/* ---------------- 玩家与状态 ---------------- */
let state = 'start';           // start | running | crash | over
let dist = 0, speed = ATTRACT_SPEED, coinCt = 0, maxSpeedSeen = 0;
let targetLane = 1, playerX = 0, tilt = 0;
let jumping = false, jumpT = 0, jumpY = 0, jumpQueued = false;
let nextPatternAt = Infinity;
let crashT = 0;
let best = 0;
try { best = parseInt(localStorage.getItem('ncs_best_dist') || '0', 10) || 0; } catch (e) { best = 0; }

const isTouch = matchMedia('(pointer: coarse)').matches ||
  (('ontouchstart' in window) && Math.min(screen.width, screen.height) < 820);

function resetRun() {
  clearEntities();
  dist = 0;
  speed = START_SPEED;
  coinCt = 0;
  maxSpeedSeen = speed;
  targetLane = 1;
  playerX = 0;
  tilt = 0;
  jumping = false;
  jumpT = 0;
  jumpY = 0;
  jumpQueued = false;
  crashT = 0;
  nextPatternAt = 52;
  sceneEl.classList.remove('crash');
  playerEl.classList.remove('crashed', 'jumping');
  hudCoinBox.classList.remove('pulse');
}

function startGame() {
  AudioSys.ensure();
  resetRun();
  // 预热：引导币线 + 第一个跳障
  addCoinLine(1, 32, 6, 3);
  addObstacle('barrier', 1, 60);
  state = 'running';
  overlayStart.classList.add('hidden');
  overlayOver.classList.add('hidden');
  hudEl.classList.remove('hidden');
  hintEl.classList.remove('hidden');
  hintEl.textContent = isTouch ? '◀ ▶ 移动 · ▲ 跳跃' : '← → 切换轨道 · 空格 跳跃';
  if (isTouch) controlsEl.classList.add('on');
  AudioSys.start();
  updateHUD(true);
}

function goHome() {
  resetRun();
  state = 'start';
  overlayOver.classList.add('hidden');
  overlayStart.classList.remove('hidden');
  hudEl.classList.add('hidden');
  hintEl.classList.add('hidden');
  controlsEl.classList.remove('on');
  refreshBestLine();
}

function crash() {
  state = 'crash';
  crashT = 0;
  AudioSys.crash();
  sceneEl.classList.add('crash');
  playerEl.classList.add('crashed');
  playerEl.classList.remove('jumping');
}

function showOver() {
  state = 'over';
  const kmh = Math.round(maxSpeedSeen * 3.6);
  const score = dist + coinCt * 8;
  const grade = score >= 2400 ? 'S' : score >= 1400 ? 'A' : score >= 700 ? 'B' : 'C';
  const isRecord = dist > best;
  if (isRecord) {
    best = Math.floor(dist);
    try { localStorage.setItem('ncs_best_dist', String(best)); } catch (e) { /* 隐私模式等 */ }
  }
  $('#grade').textContent = grade;
  $('#grade').dataset.grade = grade;
  $('#ov-dist').textContent = Math.floor(dist) + ' m';
  $('#ov-coin').textContent = coinCt;
  $('#ov-speed').textContent = kmh + ' km/h';
  $('#ov-best').textContent = best + ' m';
  $('#new-record').classList.toggle('hidden', !isRecord);
  overlayOver.classList.remove('hidden');
  hintEl.classList.add('hidden');
  controlsEl.classList.remove('on');
}

function refreshBestLine() {
  $('#best-line-start').textContent = best > 0 ? `最远纪录 · ${best} m` : '';
}

/* ---------------- 输入 ---------------- */
function move(dir) {
  if (state !== 'running') return;
  const next = clamp(targetLane + dir, 0, 2);
  if (next !== targetLane) {
    targetLane = next;
    AudioSys.lane();
  }
}
function doJump() {
  if (state !== 'running') return;
  if (!jumping) {
    jumping = true;
    jumpT = 0;
    playerEl.classList.add('jumping');
    AudioSys.jump();
  } else {
    jumpQueued = true; // 落地前预输入
  }
}

function bindEvents() {
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'd', 'w', 'A', 'D', 'W'].includes(k)) e.preventDefault();
    if (state === 'running') {
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') move(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') move(1);
      else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { if (!e.repeat) doJump(); }
    } else if (k === ' ' || k === 'Enter') {
      if (!e.repeat) startGame(); // 开始 / 结束界面均可快速重开
    }
  });

  $('#btn-start').addEventListener('click', startGame);
  $('#btn-restart').addEventListener('click', startGame);
  $('#btn-home').addEventListener('click', goHome);

  const bl = $('#btn-left'), br = $('#btn-right'), bj = $('#btn-jump');
  bl.addEventListener('pointerdown', (e) => { e.preventDefault(); move(-1); });
  br.addEventListener('pointerdown', (e) => { e.preventDefault(); move(1); });
  bj.addEventListener('pointerdown', (e) => { e.preventDefault(); doJump(); });
  for (const b of [bl, br, bj]) b.addEventListener('contextmenu', (e) => e.preventDefault());

  // 场景内滑动手势：左右滑换道，上滑/点按跳跃
  let tx = 0, ty = 0, tt = 0;
  sceneEl.addEventListener('touchstart', (e) => {
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = performance.now();
  }, { passive: true });
  sceneEl.addEventListener('touchend', (e) => {
    if (state !== 'running') return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    const dtms = performance.now() - tt;
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
    else if (dy < -42) doJump();
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dtms < 260) doJump();
  }, { passive: true });

  // 静音开关
  const muteBtn = $('#btn-mute');
  try { AudioSys.muted = localStorage.getItem('ncs_mute') === '1'; } catch (e) { /* ignore */ }
  const renderMute = () => { muteBtn.textContent = AudioSys.muted ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(!AudioSys.muted)); };
  renderMute();
  muteBtn.addEventListener('click', () => {
    AudioSys.muted = !AudioSys.muted;
    try { localStorage.setItem('ncs_mute', AudioSys.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!AudioSys.muted) AudioSys.ensure();
    renderMute();
  });

  // 触屏滚动/缩放抑制（成绩卡内部可滚动）
  document.addEventListener('touchmove', (e) => {
    if (!(e.target && e.target.closest && e.target.closest('.over-card'))) e.preventDefault();
  }, { passive: false });

  // 回到前台时重置时钟，避免大步长
  document.addEventListener('visibilitychange', () => { if (!document.hidden) last = performance.now(); });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 120));
}

/* ---------------- 收集特效 ---------------- */
function coinBurst(x, y) {
  const colors = ['#ffd166', '#fff3c4', '#ffb84d', '#22e6ff'];
  for (let i = 0; i < 7; i++) {
    const sp = document.createElement('i');
    sp.className = 'spark';
    const ang = rand(0, Math.PI * 2);
    const r = rand(18, 44);
    sp.style.cssText = `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;` +
      `--dx:${(Math.cos(ang) * r).toFixed(0)}px;--dy:${(Math.sin(ang) * r - 12).toFixed(0)}px;` +
      `--sp-c:${colors[i % colors.length]};`;
    worldEnt.appendChild(sp);
    setTimeout(() => sp.remove(), 480);
  }
}

/* ---------------- HUD ---------------- */
let hudAcc = 0;
function updateHUD(force) {
  hudDist.textContent = Math.floor(dist);
  hudSpeed.textContent = Math.round(speed * 3.6);
  hudCoin.textContent = coinCt;
  const lanes = hudLane.children;
  for (let i = 0; i < 3; i++) lanes[i].classList.toggle('active', i === targetLane);
}

/* ---------------- 主循环 ---------------- */
let last = performance.now();
let fxAcc = 0;

function update(dt) {
  if (state === 'start') {
    speed = ATTRACT_SPEED;
  } else if (state === 'running') {
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    maxSpeedSeen = Math.max(maxSpeedSeen, speed);
    if (dist >= nextPatternAt) spawnPattern();
  } else if (state === 'crash') {
    speed = Math.max(0, speed - 30 * dt); // 碰撞后世界滑行减速
    crashT += dt;
    if (crashT > 0.95) showOver();
  }

  dist += speed * dt;

  // 玩家横向移动（平滑变道）
  const targetX = LANES_X[targetLane];
  const prevX = playerX;
  playerX += (targetX - playerX) * Math.min(1, dt * 13);
  if (Math.abs(targetX - playerX) < 0.01) playerX = targetX;
  tilt = clamp((playerX - prevX) / Math.max(dt, 0.001) * 0.9, -14, 14) * (state === 'running' ? 1 : 0);

  // 跳跃物理
  if (jumping) {
    jumpT += dt;
    jumpY = JUMP_V * jumpT - 0.5 * GRAVITY * jumpT * jumpT;
    if (jumpY <= 0) {
      jumpY = 0;
      jumping = false;
      jumpT = 0;
      playerEl.classList.remove('jumping');
      if (jumpQueued) { jumpQueued = false; doJump(); }
    }
  }

  // 实体推进与回收
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.z -= speed * dt;
    if (o.z < KILL_Z) { removeEnt(obstacles, i); continue; }
    // 碰撞：同车道近似重叠 +（路障可跳过）
    if (state === 'running' &&
      Math.abs(o.z - PLAYER_Z) < 0.8 &&
      Math.abs(playerX - LANES_X[o.lane]) < 1.15) {
      if (!(o.jumpable && jumpY > BARRIER_CLEAR_Y)) { crash(); break; }
    }
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.z -= speed * dt;
    if (c.z < KILL_Z) { removeEnt(coins, i); continue; }
    if (state === 'running' &&
      Math.abs(c.z - PLAYER_Z) < 0.95 &&
      Math.abs(playerX - LANES_X[c.lane]) < 1.05 &&
      Math.abs(c.y - (jumpY + 0.85)) < 0.55) {
      // 收集
      const s = FOCAL / c.z;
      coinBurst(cx + LANES_X[c.lane] * s, horizonY + G / c.z - c.y * s);
      removeEnt(coins, i);
      coinCt++;
      AudioSys.coin();
      hudCoinBox.classList.remove('pulse');
      void hudCoinBox.offsetWidth; // 重启动画
      hudCoinBox.classList.add('pulse');
    }
  }
}

function render() {
  updScenery(dist);

  // 视差城市
  skyFarSvg.style.transform = `translate3d(${(-mod(dist * 0.10, skyFarW)).toFixed(1)}px,0,0)`;
  skyNearSvg.style.transform = `translate3d(${(-mod(dist * 0.26, skyNearW)).toFixed(1)}px,0,0)`;

  // 障碍
  for (const o of obstacles) {
    place(o.el, LANES_X[o.lane], o.z);
    o.el.style.zIndex = Math.max(1, Math.round(2000 - o.z * 10));
  }
  // 能量币（轻微上下浮动）
  const nowS = performance.now() / 1000;
  for (const c of coins) {
    place(c.el, LANES_X[c.lane], c.z, c.y + Math.sin(nowS * 3 + c.bob) * 0.07);
    c.el.style.zIndex = Math.max(1, Math.round(2000 - c.z * 10));
  }

  // 玩家
  const pScale = FOCAL / PLAYER_Z / 100;
  const px = cx + playerX * FOCAL / PLAYER_Z;
  const pyGround = horizonY + G / PLAYER_Z;
  const py = pyGround - jumpY * FOCAL / PLAYER_Z;
  playerEl.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) scale(${pScale.toFixed(4)}) rotate(${tilt.toFixed(1)}deg)`;
  playerEl.style.zIndex = Math.round(2000 - PLAYER_Z * 10);
  pShadow.style.transform = `translate3d(${px.toFixed(1)}px,${pyGround.toFixed(1)}px,0) scale(${(1 / (1 + jumpY * 0.9)).toFixed(3)})`;
  pShadow.style.opacity = String(clamp(0.75 - jumpY * 0.28, 0.25, 0.75));
  pShadow.style.zIndex = '1980';

  // HUD（10Hz 节流）
  hudAcc += 1;
  if (hudAcc % 6 === 0 || state !== 'running') updateHUD();

  // 速度感变量（节流）
  fxAcc += 1;
  if (fxAcc % 24 === 0) {
    const boost = clamp((speed - START_SPEED + 3) / (MAX_SPEED - START_SPEED), 0, 1);
    sceneEl.style.setProperty('--boost', boost.toFixed(2));
    sceneEl.style.setProperty('--cadence', clamp(0.5 - speed * 0.011, 0.26, 0.5).toFixed(2) + 's');
    document.documentElement.style.setProperty('--tf-dur', clamp(26 - speed * 1.1, 9, 26).toFixed(0) + 's');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // 后台切回/卡顿时限步
  if (state === 'start' || state === 'running' || state === 'crash') update(dt);
  render();
}

/* ---------------- 启动 ---------------- */
function init() {
  buildTraffic();
  buildSkyline(skyFarSvg, {
    body: '#0a0e26', minW: 70, maxW: 150, minH: 90, maxH: 210,
    winChance: 0.16, winColors: ['#8fb4ff', '#ffd9a0', '#bfe9ff', '#ff9fc7'],
    neon: ['#22e6ff', '#ff3ecd', '#ffd166', '#7b5cff'], signChance: 0.4, signMinH: 110
  });
  buildSkyline(skyNearSvg, {
    body: '#060918', minW: 90, maxW: 190, minH: 70, maxH: 170,
    winChance: 0.12, winColors: ['#ffd9a0', '#8fb4ff', '#bfe9ff'],
    neon: ['#ff3ecd', '#22e6ff', '#7b5cff', '#ff8a5c'], signChance: 0.55, signMinH: 80
  });
  initSceneryPools();
  layout();
  // 玩家移入实体层，与障碍/金币共用深度排序（zIndex）
  worldEnt.appendChild(playerWrap);
  playerWrap.style.zIndex = 'auto';
  bindEvents();
  if (isTouch) document.body.classList.add('touch');
  refreshBestLine();
  updateHUD(true);
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}

init();
