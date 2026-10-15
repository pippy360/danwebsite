// Furniture, rugs and plants for the gallery house (layout: see floorplan.js).
//
//   buildFurniture() → { group, colliders }
//
// • `group` holds every piece, already positioned in world coordinates
//   (metres, Y up, floor at y = 0).
// • `colliders` holds one XZ axis-aligned box per solid piece ({ minX, maxX, minZ, maxZ }),
//   computed from the placed piece's bounds and shrunk by 3 cm per side. Rugs, the drop
//   cloth and small items sitting on tables produce no colliders.
//
// Conventions: every builder creates its piece around a local origin at floor level with
// the piece's front facing local +Z. Pieces are then placed with a position and a rotation
// about Y; rotation.y = atan2(dirX, dirZ) makes the front face the direction (dirX, dirZ).
// All randomness is seeded (mulberry32), so the house looks identical on every load.
// No real lights are created: lamp shades and bulbs glow through emissive materials
// (those meshes carry userData.lampGlow = true so the integrator can find them).

import * as THREE from 'three';

/* ════════════════════════════════ palette ════════════════════════════════ */

const COLORS = {
  oak: '#b98a5a',
  walnut: '#6b4a32',
  linen: '#d9cbb5',
  sage: '#8a9a7b',
  terracotta: '#c4673f',
  mustard: '#d4a03a',
  teal: '#2f5d62',
  charcoal: '#3a3a3a',
  cream: '#efe6d6',
  brass: '#c9a45c',
  leafA: '#4f7d43',
  leafB: '#3d6b35',
  leafC: '#5e8f4e',
  potWhite: '#e8e4dc',
};
const FOLIAGE = [COLORS.leafA, COLORS.leafB, COLORS.leafC];
const PAINTS = ['#c4673f', '#d4a03a', '#2f5d62', '#3b4f9c', '#a3333d', '#f2eee6', '#5e7d3a', '#7a4e8a'];
const BOOK_COLORS = [
  '#8c3b2f', '#2f3e5c', '#3d5a40', '#c39a4a', '#e3d8c0', '#3a3a3a', '#2f5d62', '#b98a85',
  '#7a7a4a', '#6b4a32', '#5a6e80', '#d4a03a', '#c4673f', '#5e3b4f', '#8a8a85', '#8a9a7b',
];

/* ════════════════════════════ seeded randomness ════════════════════════════ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded generator for one named stream: rng() ∈ [0, 1) plus helpers. */
function rngFor(name) {
  const next = mulberry32(hashString(name));
  const rng = () => next();
  rng.range = (a, b) => a + (b - a) * next();
  rng.int = (a, b) => a + Math.floor((b - a + 1) * next());
  rng.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  rng.chance = (p) => next() < p;
  return rng;
}

/* ═══════════════════════════════ small maths ═══════════════════════════════ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const toV3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));
const Y_UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);
const dirFrom = (az, elev) => v3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));

function randomInSphere(rng) {
  for (;;) {
    const v = v3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (v.lengthSq() <= 1) return v;
  }
}

function hash3(x, y, z) {
  const q = (n) => Math.round(n * 1000) / 1000;
  const s = Math.sin(q(x) * 127.1 + q(y) * 311.7 + q(z) * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ═══════════════════════════ build-time state ═══════════════════════════ */

let GEO = null; // geometry cache (per build)
let TEX = null; // canvas textures
let M = null; // shared materials

/* ══════════════════════════════ canvas helpers ══════════════════════════════ */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas, { repeat = null, color = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => clamp(Math.round(v * f), 0, 255);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function catmullRom(ctrl, perSeg = 8) {
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}

function strokePath(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}

/** Loose, dry-brush paint stroke along a polyline. */
function brushStroke(g, rng, pts, width, color, alpha = 0.85) {
  const n = pts.length;
  const normals = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalAlpha = alpha * 0.5;
  g.strokeStyle = color;
  g.lineWidth = width * 0.75;
  strokePath(g, pts);
  const count = Math.max(5, Math.round(width / 3.5));
  for (let b = 0; b < count; b++) {
    const off = (b / (count - 1) - 0.5) * width;
    const start = Math.floor(rng() * n * 0.12), end = n - Math.floor(rng() * n * 0.3);
    if (end - start < 2) continue;
    g.globalAlpha = alpha * (0.25 + rng() * 0.6);
    g.lineWidth = 1 + rng() * (width / count) * 1.6;
    g.strokeStyle = rng() < 0.15 ? shadeHex(color, 1.15) : rng() < 0.3 ? shadeHex(color, 0.85) : color;
    g.beginPath();
    for (let i = start; i < end; i++) {
      const w = off * (0.85 + 0.3 * Math.sin(i * 0.7 + b));
      const x = pts[i][0] + normals[i][0] * w, y = pts[i][1] + normals[i][1] * w;
      if (i === start) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Paint splat: wobbly blob plus satellite droplets. */
function splat(g, rng, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, rr = r * (0.75 + rng() * 0.5);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
  g.fill();
  const sats = 3 + Math.floor(rng() * 10);
  for (let i = 0; i < sats; i++) {
    const a = rng() * TAU, d = r * (1.3 + rng() * 2.2), sr = Math.max(0.8, r * (0.06 + rng() * 0.22));
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, sr, 0, TAU);
    g.fill();
  }
}

function steppedDiamond(g, cx, cy, rx, ry, step, color) {
  g.fillStyle = color;
  const n = Math.max(1, Math.round(ry / step));
  for (let i = -n; i <= n; i++) {
    const half = rx * (1 - Math.abs(i) / (n + 0.5));
    if (half <= 0.5) continue;
    g.fillRect(Math.round(cx - half), Math.round(cy + i * step - step / 2), Math.round(half * 2), step);
  }
}

/** Runs `draw(len, bw)` along each side of a rectangle band with mitred corners. */
function drawBorderBand(g, W, H, inset, bw, draw) {
  const sides = [
    [inset, inset, 0, W - 2 * inset],
    [W - inset, inset, Math.PI / 2, H - 2 * inset],
    [W - inset, H - inset, Math.PI, W - 2 * inset],
    [inset, H - inset, -Math.PI / 2, H - 2 * inset],
  ];
  for (const [tx, ty, rot, len] of sides) {
    g.save();
    g.translate(tx, ty);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len, 0);
    g.lineTo(len - bw, bw);
    g.lineTo(bw, bw);
    g.closePath();
    g.clip();
    draw(len, bw);
    g.restore();
  }
}

function speckle(g, rng, W, H, count, alpha = 0.06) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${alpha * (0.5 + rng())})` : `rgba(0,0,0,${alpha * (0.5 + rng())})`;
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1);
  }
}

/* ═════════════════════════════════ textures ═════════════════════════════════ */

/** Neutral wood grain (multiplied by the wood colour). Grain runs along U. */
function woodTexture(rng) {
  const W = 512, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgb(244,244,244)';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 16; i++) {
    const y = rng() * H, h = 8 + rng() * 46;
    g.fillStyle = rng() < 0.6 ? `rgba(90,60,30,${0.025 + rng() * 0.05})` : `rgba(255,255,255,${0.05 + rng() * 0.06})`;
    for (const oy of [-H, 0, H]) g.fillRect(0, y + oy, W, h);
  }
  for (let i = 0; i < 120; i++) {
    const y0 = rng() * H, amp = 1.5 + rng() * 5, k = 1 + Math.floor(rng() * 3), ph = rng() * TAU;
    g.strokeStyle = `rgba(70,45,20,${0.05 + rng() * 0.11})`;
    g.lineWidth = 0.6 + rng() * 1.5;
    for (const oy of [-H, 0, H]) {
      g.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = y0 + oy + Math.sin((x / W) * TAU * k + ph) * amp + Math.sin((x / W) * TAU * (k + 3) + 2 * ph) * amp * 0.25;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(50,30,15,${0.05 + rng() * 0.1})`;
    g.fillRect(rng() * W, rng() * H, 2 + rng() * 7, 1);
  }
  return canvasTexture(c, { repeat: [1 / 1.2, 1 / 0.6] });
}

/** Neutral woven fabric (multiplied by the upholstery colour). */
function fabricTexture(rng) {
  const S = 256;
  const c = makeCanvas(S, S), g = c.getContext('2d');
  g.fillStyle = 'rgb(246,246,246)';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.06})`;
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    g.fillStyle = `rgba(0,0,0,${0.025 + rng() * 0.05})`;
    g.fillRect(x, 0, 1, S);
  }
  for (let i = 0; i < 220; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${0.08 + rng() * 0.1})` : `rgba(0,0,0,${0.05 + rng() * 0.07})`;
    const len = 5 + rng() * 26;
    if (rng() < 0.5) g.fillRect(rng() * S, Math.floor((rng() * S) / 2) * 2, len, 1);
    else g.fillRect(Math.floor((rng() * S) / 2) * 2, rng() * S, 1, len);
  }
  return canvasTexture(c, { repeat: [1 / 0.14, 1 / 0.14] });
}

/** Basket-weave rattan. */
function wickerTexture() {
  const S = 256, cells = 8, cs = S / cells, strands = 3, sw = cs / strands;
  const c = makeCanvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#5a4128';
  g.fillRect(0, 0, S, S);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = i * cs, y = j * cs, horiz = (i + j) % 2 === 0;
      for (let s = 0; s < strands; s++) {
        const a = (horiz ? y : x) + s * sw;
        const grad = horiz ? g.createLinearGradient(0, a, 0, a + sw) : g.createLinearGradient(a, 0, a + sw, 0);
        grad.addColorStop(0, '#8f6a3c');
        grad.addColorStop(0.45, '#e0bf86');
        grad.addColorStop(1, '#8a6436');
        g.fillStyle = grad;
        if (horiz) g.fillRect(x + 1.5, a + 0.7, cs - 3, sw - 1.4);
        else g.fillRect(a + 0.7, y + 1.5, sw - 1.4, cs - 3);
      }
    }
  }
  return canvasTexture(c, { repeat: [1 / 0.1, 1 / 0.1] });
}

/** Greyscale leaf veins: U across the leaf, V from base (0) to tip (1). */
function leafVeinTexture() {
  const W = 128, H = 256;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgb(200,200,200)');
  grad.addColorStop(0.5, 'rgb(240,240,240)');
  grad.addColorStop(1, 'rgb(200,200,200)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 3;
  strokePath(g, [[W / 2, H], [W / 2, 4]]);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) {
    const y = H - 18 - i * 26;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * W * 0.25, y - 14, W / 2 + s * W * 0.5, y - 40);
      g.stroke();
    }
  }
  return canvasTexture(c);
}

/** Banded sansevieria leaf with yellow margins. */
function snakeLeafTexture(rng) {
  const W = 64, H = 256;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#2e4d2c';
  g.fillRect(0, 0, W, H);
  for (let y = 4; y < H; y += 9 + rng() * 8) {
    g.strokeStyle = `rgba(150,175,130,${0.35 + rng() * 0.3})`;
    g.lineWidth = 1.5 + rng() * 2.5;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const yy = y + Math.sin(x * 0.25 + y) * 3;
      if (x) g.lineTo(x, yy);
      else g.moveTo(x, yy);
    }
    g.stroke();
  }
  g.fillStyle = '#c8c070';
  g.fillRect(0, 0, 5, H);
  g.fillRect(W - 5, 0, 5, H);
  g.fillStyle = '#8e9a52';
  g.fillRect(5, 0, 2, H);
  g.fillRect(W - 7, 0, 2, H);
  return canvasTexture(c);
}

/** Living-room kilim: stepped lozenges, sawtooth border (canvas X ↔ world X, canvas Y ↔ world Z). */
function kilimTexture(rng) {
  const W = 1024, H = 740;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const T = COLORS.terracotta, CR = COLORS.cream, TE = COLORS.teal, MU = COLORS.mustard, DK = '#4a3328';
  g.fillStyle = T;
  g.fillRect(0, 0, W, H);
  g.fillStyle = DK;
  g.fillRect(24, 24, W - 48, H - 48);
  g.fillStyle = CR;
  g.fillRect(30, 30, W - 60, H - 60);
  drawBorderBand(g, W, H, 30, 70, (len, bw) => {
    g.fillStyle = CR;
    g.fillRect(0, 0, len, bw);
    const tooth = 46;
    g.fillStyle = TE;
    g.beginPath();
    g.moveTo(0, bw);
    for (let x = 0; x < len + tooth; x += tooth) {
      g.lineTo(x + tooth / 2, bw * 0.3);
      g.lineTo(x + tooth, bw);
    }
    g.closePath();
    g.fill();
    for (let x = 0; x < len + tooth; x += tooth) steppedDiamond(g, x, bw * 0.3, 9, 14, 4, MU);
    g.fillStyle = T;
    for (let x = tooth / 2; x < len + tooth; x += tooth) g.fillRect(x - 3, bw * 0.64, 6, 6);
    g.fillStyle = DK;
    g.fillRect(0, bw - 5, len, 5);
  });
  const f0 = 100;
  g.fillStyle = DK;
  g.fillRect(f0, f0, W - 2 * f0, H - 2 * f0);
  g.fillStyle = T;
  g.fillRect(f0 + 6, f0 + 6, W - 2 * f0 - 12, H - 2 * f0 - 12);
  g.save();
  g.beginPath();
  g.rect(f0 + 6, f0 + 6, W - 2 * f0 - 12, H - 2 * f0 - 12);
  g.clip();
  const cy = H / 2;
  const layers = [[124, 206, CR], [112, 188, DK], [104, 174, TE], [80, 134, CR], [70, 118, MU], [48, 82, T], [28, 48, CR], [12, 20, TE]];
  for (const cx of [W / 2 - 500, W / 2 - 250, W / 2, W / 2 + 250, W / 2 + 500]) {
    for (const [rx, ry, col] of layers) steppedDiamond(g, cx, cy, rx, ry, 8, col);
  }
  for (const cx of [W / 2 - 375, W / 2 - 125, W / 2 + 125, W / 2 + 375]) {
    for (const yy of [cy - 168, cy + 168]) {
      steppedDiamond(g, cx, yy, 22, 30, 6, CR);
      steppedDiamond(g, cx, yy, 14, 19, 6, MU);
      steppedDiamond(g, cx, yy, 5, 7, 6, DK);
    }
  }
  g.restore();
  for (let x = 0; x < W; x += 3) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
    g.fillRect(x, 0, 1, H);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,250,240,${0.03 + rng() * 0.05})` : `rgba(40,20,10,${0.03 + rng() * 0.04})`;
    g.fillRect(rng() * W, 0, 3 + rng() * 22, H);
  }
  speckle(g, rng, W, H, 3000);
  return canvasTexture(c);
}

/** Library rug: soft sage field, cream border with a leafy scroll, faint medallion. */
function libraryRugTexture(rng) {
  const W = 1024, H = 768;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const FIELD = '#7d8f70', DEEP = '#55654a', CR = '#e8dec9';
  g.fillStyle = DEEP;
  g.fillRect(0, 0, W, H);
  g.fillStyle = CR;
  g.fillRect(22, 22, W - 44, H - 44);
  drawBorderBand(g, W, H, 22, 62, (len) => {
    g.strokeStyle = rgba(FIELD, 0.9);
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= len; x += 6) {
      const y = 31 + Math.sin(x / 40) * 10;
      if (x) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    g.fillStyle = rgba(FIELD, 0.85);
    for (let x = 20; x < len; x += 40) {
      const y = 31 + Math.sin(x / 40) * 10;
      g.beginPath();
      g.ellipse(x, y + (Math.floor(x / 40) % 2 ? -11 : 11), 9, 4.5, 0.6, 0, TAU);
      g.fill();
    }
  });
  g.fillStyle = FIELD;
  g.fillRect(84, 84, W - 168, H - 168);
  g.strokeStyle = DEEP;
  g.lineWidth = 3;
  g.strokeRect(32, 32, W - 64, H - 64);
  g.lineWidth = 2;
  g.strokeRect(76, 76, W - 152, H - 152);
  g.save();
  g.beginPath();
  g.rect(84, 84, W - 168, H - 168);
  g.clip();
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,255,235,${0.02 + rng() * 0.04})` : `rgba(30,40,20,${0.02 + rng() * 0.04})`;
    g.fillRect(0, rng() * H, W, 5 + rng() * 26);
  }
  g.strokeStyle = 'rgba(232,222,201,0.12)';
  g.lineWidth = 2;
  for (let x = -H; x < W + H; x += 64) {
    strokePath(g, [[x, 0], [x + H, H]]);
    strokePath(g, [[x, H], [x + H, 0]]);
  }
  g.strokeStyle = 'rgba(232,222,201,0.55)';
  g.lineWidth = 9;
  g.beginPath();
  g.ellipse(W / 2, H / 2, 210, 140, 0, 0, TAU);
  g.stroke();
  g.strokeStyle = 'rgba(85,101,74,0.6)';
  g.lineWidth = 4;
  g.beginPath();
  g.ellipse(W / 2, H / 2, 180, 115, 0, 0, TAU);
  g.stroke();
  g.fillStyle = 'rgba(232,222,201,0.35)';
  g.beginPath();
  g.ellipse(W / 2, H / 2, 70, 46, 0, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(232,222,201,0.45)';
  g.lineWidth = 6;
  for (const [x, y] of [[84, 84], [W - 84, 84], [84, H - 84], [W - 84, H - 84]]) {
    g.beginPath();
    g.arc(x, y, 90, 0, TAU);
    g.stroke();
  }
  g.restore();
  speckle(g, rng, W, H, 4000, 0.05);
  return canvasTexture(c);
}

/** Entrance runner: deep teal field, cream/terracotta border (portrait: X across, Z along). */
function runnerTexture(rng) {
  const W = 336, H = 1024;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#2b2b2b';
  g.fillRect(0, 0, W, H);
  g.fillStyle = COLORS.cream;
  g.fillRect(14, 14, W - 28, H - 28);
  g.fillStyle = COLORS.terracotta;
  g.fillRect(32, 32, W - 64, H - 64);
  g.fillStyle = COLORS.cream;
  g.fillRect(38, 38, W - 76, H - 76);
  g.fillStyle = COLORS.teal;
  g.fillRect(44, 44, W - 88, H - 88);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${0.02 + rng() * 0.04})` : `rgba(0,0,0,${0.03 + rng() * 0.05})`;
    g.fillRect(44, 44 + rng() * (H - 88), W - 88, 4 + rng() * 22);
  }
  g.fillStyle = rgba(COLORS.mustard, 0.85);
  for (let y = 48; y < H - 48; y += 24) {
    g.fillRect(20, y, 6, 6);
    g.fillRect(W - 26, y, 6, 6);
  }
  for (let x = 48; x < W - 48; x += 24) {
    g.fillRect(x, 20, 6, 6);
    g.fillRect(x, H - 26, 6, 6);
  }
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.05})`;
    g.fillRect(0, y, W, 1);
  }
  speckle(g, rng, W, H, 1500);
  return canvasTexture(c);
}

/** Studio drop cloth: beige canvas, creases, hem and lots of paint. */
function dropClothTexture(rng) {
  const W = 1024, H = 854;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#d6c9ae';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = `rgba(90,70,40,${0.03 + rng() * 0.04})`;
    g.fillRect(0, y, W, 1);
  }
  for (let x = 0; x < W; x += 2) {
    g.fillStyle = `rgba(90,70,40,${0.025 + rng() * 0.035})`;
    g.fillRect(x, 0, 1, H);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x0 = rng() * W, y0 = rng() * H, a = rng() * Math.PI, L = 200 + rng() * 500;
    const dx = (Math.cos(a) * L) / 2, dy = (Math.sin(a) * L) / 2;
    const bx = x0 + rng() * 60 - 30, by = y0 + rng() * 60 - 30;
    g.strokeStyle = 'rgba(80,60,35,0.07)';
    g.lineWidth = 14 + rng() * 14;
    g.beginPath();
    g.moveTo(x0 - dx, y0 - dy);
    g.quadraticCurveTo(bx, by, x0 + dx, y0 + dy);
    g.stroke();
    g.strokeStyle = 'rgba(255,250,235,0.1)';
    g.lineWidth = 5 + rng() * 6;
    g.beginPath();
    g.moveTo(x0 - dx + 7, y0 - dy - 7);
    g.quadraticCurveTo(bx + 7, by - 7, x0 + dx + 7, y0 + dy - 7);
    g.stroke();
  }
  g.strokeStyle = 'rgba(90,70,40,0.35)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  g.strokeStyle = 'rgba(70,55,35,0.5)';
  g.lineWidth = 2;
  g.setLineDash([9, 7]);
  g.strokeRect(18, 18, W - 36, H - 36);
  g.setLineDash([]);
  const paints = [...PAINTS, '#2a2a2a', '#d98c7a', '#c8963e'];
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = rgba(rng.pick(paints), 0.55);
    g.lineWidth = 3 + rng() * 3;
    const a0 = rng() * TAU;
    g.beginPath();
    g.arc(60 + rng() * (W - 120), 60 + rng() * (H - 120), 34 + rng() * 10, a0, a0 + 4.5);
    g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = rng() * W, y = rng() * H, a = rng() * TAU, L = 30 + rng() * 80;
    const pts = catmullRom([[x, y], [x + Math.cos(a) * L * 0.5 + rng() * 10, y + Math.sin(a) * L * 0.5 + rng() * 10], [x + Math.cos(a) * L, y + Math.sin(a) * L]], 6);
    brushStroke(g, rng, pts, 6 + rng() * 12, rng.pick(paints), 0.7);
  }
  for (let i = 0; i < 110; i++) {
    const r = rng() < 0.75 ? 2 + rng() * 7 : 8 + rng() * 14;
    splat(g, rng, rng() * W, rng() * H, r, rng.pick(paints));
  }
  for (let i = 0; i < 12; i++) {
    const col = rng.pick(paints), a = rng() * TAU;
    let x = rng() * W, y = rng() * H, r = 5 + rng() * 4;
    g.fillStyle = col;
    for (let k = 0; k < 10; k++) {
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      x += Math.cos(a) * (8 + rng() * 10);
      y += Math.sin(a) * (8 + rng() * 10);
      r *= 0.8;
    }
  }
  return canvasTexture(c);
}

/** Work in progress on the easel: pencil underdrawing, loose warm brushwork, bare canvas. */
function paintingTexture(rng) {
  const W = 640, H = 800;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f6f2ea';
  g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    g.fillStyle = `rgba(120,105,80,${0.02 + rng() * 0.03})`;
    g.fillRect(0, y, W, 1);
  }
  for (let x = 0; x < W; x += 2) {
    g.fillStyle = `rgba(120,105,80,${0.015 + rng() * 0.025})`;
    g.fillRect(x, 0, 1, H);
  }
  const J = (s) => (rng() - 0.5) * s;
  const pencil = (a, w) => {
    g.strokeStyle = `rgba(62,58,54,${a})`;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
  };
  pencil(0.12, 1);
  for (const x of [W / 3, (2 * W) / 3]) strokePath(g, [[x + J(6), 10], [x + J(6), H - 10]]);
  for (const y of [H / 3, (2 * H) / 3]) strokePath(g, [[10, y + J(6)], [W - 10, y + J(6)]]);
  pencil(0.45, 1.3);
  for (let k = 0; k < 3; k++) strokePath(g, catmullRom([[18, 528 + J(8)], [170, 470 + J(10)], [320, 512 + J(10)], [470, 452 + J(10)], [622, 486 + J(8)]], 10));
  for (let k = 0; k < 2; k++) strokePath(g, catmullRom([[30, 640 + J(8)], [210, 600 + J(10)], [400, 650 + J(8)], [610, 610 + J(8)]], 10));
  for (let k = 0; k < 3; k++) {
    const a0 = 0.3 + J(0.4);
    g.beginPath();
    g.ellipse(462 + J(8), 232 + J(8), 92 + J(8), 88 + J(8), rng(), a0, a0 + TAU * (0.8 + rng() * 0.25));
    g.stroke();
  }
  for (const [x, y, h] of [[150, 300, 230], [228, 330, 190]]) {
    for (let k = 0; k < 2; k++) strokePath(g, catmullRom([[x + J(6), y], [x + 10 + J(6), y + h * 0.45], [x - 6 + J(6), y + h]], 8));
    g.beginPath();
    g.arc(x + J(4), y - 18, 16 + J(3), 0, TAU);
    g.stroke();
  }
  pencil(0.3, 1);
  for (let i = 0; i < 22; i++) {
    const x = 360 + i * 9 + J(3);
    strokePath(g, [[x, 700 + J(6)], [x + 34, 662 + J(6)]]);
  }
  for (let i = 0; i < 14; i++) {
    const x = 60 + i * 8 + J(3);
    strokePath(g, [[x, 150 + J(5)], [x + 26, 124 + J(5)]]);
  }
  const S = (pts, w, col, a) => brushStroke(g, rng, catmullRom(pts, 10), w, col, a);
  S([[30, 590], [190, 560], [360, 600], [560, 575], [620, 590]], 74, '#c4673f', 0.85);
  S([[40, 660], [220, 640], [420, 690], [600, 660]], 56, '#9c3b2e', 0.75);
  S([[60, 520], [200, 488], [330, 520], [450, 476]], 34, '#d9793b', 0.8);
  S([[40, 120], [160, 90], [300, 140], [380, 110]], 64, '#d4a03a', 0.7);
  S([[50, 210], [180, 190], [290, 230]], 46, '#e6b85c', 0.55);
  S([[160, 360], [175, 470], [160, 560]], 28, '#d98c7a', 0.8);
  S([[232, 380], [244, 460], [226, 540]], 20, '#b5523a', 0.8);
  S([[400, 380], [470, 360], [560, 400]], 30, '#d98c7a', 0.5);
  S([[420, 250], [470, 210], [520, 250], [470, 290], [430, 260]], 26, '#e8a33d', 0.6);
  S([[90, 740], [260, 720], [380, 760]], 30, '#2f5d62', 0.8);
  S([[520, 720], [600, 700]], 18, '#2f5d62', 0.6);
  for (let i = 0; i < 7; i++) {
    const x = 60 + rng() * 520, y = 600 + rng() * 60;
    g.strokeStyle = rgba(rng.pick(['#c4673f', '#9c3b2e', '#d9793b']), 0.75);
    g.lineWidth = 2 + rng() * 2.5;
    g.lineCap = 'round';
    strokePath(g, [[x, y], [x + J(2), y + 30 + rng() * 70]]);
  }
  g.strokeStyle = 'rgba(74,51,40,0.7)';
  g.lineWidth = 3;
  strokePath(g, catmullRom([[20, 535], [170, 478], [320, 516], [470, 458], [620, 490]], 10));
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rgba(rng.pick(['#c4673f', '#d4a03a', '#d98c7a', '#2f5d62', '#9c3b2e', '#e8a33d']), 0.9);
    g.beginPath();
    g.ellipse(560 + (i % 3) * 22, 40 + Math.floor(i / 3) * 20, 9, 6, rng(), 0, TAU);
    g.fill();
  }
  return canvasTexture(c);
}

/** Pencil still-life on a sketchbook page (portrait). */
function sketchTexture(rng) {
  const W = 360, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f8f4ea';
  g.fillRect(0, 0, W, H);
  const J = (s) => (rng() - 0.5) * s;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(60,58,55,0.55)';
  g.lineWidth = 1.3;
  for (let k = 0; k < 2; k++) {
    for (const s of [-1, 1]) {
      strokePath(g, catmullRom([[180 + s * 22, 120 + J(4)], [180 + s * 26 + J(4), 170], [180 + s * 70 + J(5), 260], [180 + s * 52 + J(4), 340], [180 + s * 40, 362]], 8));
    }
    g.beginPath();
    g.ellipse(180 + J(3), 120 + J(3), 22, 6, 0, 0, TAU);
    g.stroke();
  }
  strokePath(g, [[30, 365 + J(4)], [330, 360 + J(4)]]);
  for (const [x, y, r] of [[85, 335, 30], [282, 340, 26]]) {
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      g.arc(x + J(4), y + J(4), r + J(3), 0, TAU);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(60,58,55,0.3)';
  g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x = 120 + i * 5;
    strokePath(g, [[x, 395 + J(4)], [x + 26, 370 + J(4)]]);
  }
  for (let i = 0; i < 12; i++) {
    const y = 210 + i * 9;
    strokePath(g, [[230 + J(4), y], [246 + J(4), y + 14]]);
  }
  g.strokeStyle = 'rgba(60,58,55,0.4)';
  strokePath(g, [[40, 470], [120, 466], [150, 474]]);
  return canvasTexture(c);
}

/** Rug fringe threads (alpha-tested). U across the strip, V along it. */
function fringeTexture(rng) {
  const W = 32, H = 64;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  for (let y = 1; y < H; y += 4) {
    g.fillStyle = rng() < 0.15 ? '#e2d6bf' : COLORS.cream;
    g.fillRect(0, y, W * (0.7 + rng() * 0.3), 2);
  }
  return canvasTexture(c, { repeat: [1, 40] });
}

function makeTextures() {
  return {
    wood: woodTexture(rngFor('tex-wood')),
    fabric: fabricTexture(rngFor('tex-fabric')),
    wicker: wickerTexture(),
    leafVeins: leafVeinTexture(),
    snake: snakeLeafTexture(rngFor('tex-snake')),
    kilim: kilimTexture(rngFor('tex-kilim')),
    libraryRug: libraryRugTexture(rngFor('tex-library-rug')),
    runner: runnerTexture(rngFor('tex-runner')),
    dropCloth: dropClothTexture(rngFor('tex-drop-cloth')),
    painting: paintingTexture(rngFor('tex-painting')),
    sketch: sketchTexture(rngFor('tex-sketch')),
    fringe: fringeTexture(rngFor('tex-fringe')),
  };
}

/* ════════════════════════════════ materials ════════════════════════════════ */

function makeMaterials() {
  const mat = (name, color, roughness, metalness = 0, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    m.name = name;
    return m;
  };
  const fabric = (name, color, roughness = 0.88) => mat(name, color, roughness, 0, { map: TEX.fabric });
  const glow = (name, color, emissive, intensity, side = THREE.FrontSide) =>
    mat(name, color, 0.8, 0, { emissive, emissiveIntensity: intensity, side });
  return {
    oak: mat('oak', COLORS.oak, 0.6, 0, { map: TEX.wood }),
    oakPale: mat('oak-pale', '#cba57a', 0.64, 0, { map: TEX.wood }),
    walnut: mat('walnut', COLORS.walnut, 0.56, 0, { map: TEX.wood }),
    walnutDark: mat('walnut-dark', '#4b3425', 0.62, 0, { map: TEX.wood }),
    teal: fabric('fabric-teal', COLORS.teal),
    sage: fabric('fabric-sage', COLORS.sage),
    mustard: fabric('fabric-mustard', COLORS.mustard),
    terracotta: fabric('fabric-terracotta', COLORS.terracotta),
    linen: fabric('fabric-linen', COLORS.linen),
    cream: fabric('fabric-cream', COLORS.cream),
    charcoal: fabric('fabric-charcoal', COLORS.charcoal, 0.9),
    rag: fabric('rag', '#cfd3d4', 0.9),
    brass: mat('brass', COLORS.brass, 0.35, 0.8),
    steel: mat('blackened-steel', '#2c2c2c', 0.5, 0.6),
    steelDS: mat('blackened-steel-2s', '#2c2c2c', 0.5, 0.6, { side: THREE.DoubleSide }),
    tin: mat('tin', '#a9aeb1', 0.42, 0.75, { side: THREE.DoubleSide }),
    chrome: mat('ferrule', '#cfcfcf', 0.3, 0.85),
    marble: mat('marble', '#ece8e1', 0.32),
    potWhite: mat('pot-white', COLORS.potWhite, 0.5),
    potTerracotta: mat('pot-terracotta', '#b9663f', 0.85),
    potCharcoal: mat('pot-charcoal', COLORS.charcoal, 0.6),
    potSage: mat('pot-sage', COLORS.sage, 0.45),
    potTeal: mat('pot-teal', COLORS.teal, 0.3),
    potCream: mat('pot-cream', COLORS.cream, 0.45),
    potMustard: mat('pot-mustard', COLORS.mustard, 0.35),
    soil: mat('soil', '#3a2a1f', 1.0),
    moss: mat('moss', '#5a6a3a', 1.0),
    stem: mat('plant-stem', '#ffffff', 0.75),
    leaf: mat('leaf', '#ffffff', 0.55, 0, { map: TEX.leafVeins, side: THREE.DoubleSide }),
    leafSnake: mat('leaf-snake', '#ffffff', 0.5, 0, { map: TEX.snake, side: THREE.DoubleSide }),
    leafPlain: mat('leaf-plain', '#ffffff', 0.65, 0, { side: THREE.DoubleSide }),
    succulent: mat('succulent', '#ffffff', 0.5),
    cactus: mat('cactus', COLORS.leafA, 0.75, 0, { flatShading: true }),
    flower: mat('flower', '#d98c7a', 0.6),
    driedStem: mat('dried-stem', '#a8915f', 0.85),
    driedHead: mat('dried-head', '#e8dcc2', 0.95),
    bookCover: mat('book-cover', '#ffffff', 0.7),
    bookPages: mat('book-pages', '#ede3cc', 0.9),
    paper: mat('paper', '#f6f1e6', 0.9),
    sketch: mat('paper-sketch', '#ffffff', 0.9, 0, { map: TEX.sketch }),
    canvasRaw: mat('canvas-raw', '#ebe3d2', 0.9),
    painting: mat('painting-wip', '#ffffff', 0.82, 0, { map: TEX.painting }),
    paint: mat('paint', '#ffffff', 0.3),
    tube: mat('paint-tube', '#ffffff', 0.35, 0.3),
    plastic: mat('plastic', '#ffffff', 0.45),
    glass: mat('glass', '#dfe9e6', 0.08, 0, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
    water: mat('murky-water', '#8a9c94', 0.2, 0, { transparent: true, opacity: 0.55, depthWrite: false }),
    tea: mat('tea', '#5a3218', 0.15),
    wicker: mat('wicker', '#ffffff', 0.78, 0, { map: TEX.wicker, side: THREE.DoubleSide }),
    cane: mat('cane', '#ffffff', 0.75, 0, { map: TEX.wicker }),
    shade: glow('lamp-shade', '#efe2c8', '#ffcf8a', 0.55),
    shadeInner: glow('lamp-shade-inner', '#fff3dc', '#ffd9a0', 1.5, THREE.BackSide),
    bulb: glow('lamp-bulb', '#fff8e8', '#ffe7bf', 2.2),
    glasses: mat('glasses', '#3b2a20', 0.35),
    rugKilim: mat('rug-kilim', '#ffffff', 0.9, 0, { map: TEX.kilim }),
    rugLibrary: mat('rug-library', '#ffffff', 0.9, 0, { map: TEX.libraryRug }),
    rugRunner: mat('rug-runner', '#ffffff', 0.9, 0, { map: TEX.runner }),
    dropCloth: mat('drop-cloth', '#ffffff', 0.9, 0, { map: TEX.dropCloth }),
    fringe: mat('rug-fringe', '#ffffff', 0.9, 0, { map: TEX.fringe, alphaTest: 0.5 }),
  };
}

/* ════════════════════════════ geometry helpers ════════════════════════════ */

function cached(key, make) {
  let g = GEO.get(key);
  if (!g) {
    g = make();
    GEO.set(key, g);
  }
  return g;
}
const keyOf = (...a) => a.map((v) => (typeof v === 'number' ? +v.toFixed(4) : String(v))).join('|');

/**
 * Box-projected UVs in metres (textures set repeat = 1 / tile size). On every face the
 * U axis follows the longer side, so wood grain runs along boards and legs.
 */
function boxProjectUV(geo, w, h, d, seed) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const per = pos.count / 6;
  const ou = ((seed * 0.618) % 1) * 1.7, ov = ((seed * 0.382) % 1) * 1.3;
  for (let i = 0; i < pos.count; i++) {
    const f = Math.floor(i / per);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v, du, dv;
    if (f === 0) [u, v, du, dv] = [-z, y, d, h];
    else if (f === 1) [u, v, du, dv] = [z, y, d, h];
    else if (f === 2) [u, v, du, dv] = [x, -z, w, d];
    else if (f === 3) [u, v, du, dv] = [x, z, w, d];
    else if (f === 4) [u, v, du, dv] = [x, y, w, h];
    else [u, v, du, dv] = [-x, y, w, h];
    if (dv > du) [u, v] = [v, u];
    uv.setXY(i, u + ou, v + ov);
  }
}

function boxGeo(w, h, d) {
  const key = keyOf('box', w, h, d);
  return cached(key, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    boxProjectUV(g, w, h, d, hashString(key) / 4294967296);
    return g;
  });
}

/** Box with all edges rounded by radius r (s segments per rounded edge). */
function rboxGeo(w, h, d, r, s) {
  r = Math.max(0.002, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  s = s ?? (r > 0.035 ? 3 : 2);
  const key = keyOf('rbox', w, h, d, r, s);
  return cached(key, () => {
    const n = 2 * s + 1;
    const g = new THREE.BoxGeometry(w, h, d, n, n, n);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const half = [w / 2, h / 2, d / 2];
    const inner = half.map((v) => v - r);
    const p = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      for (let a = 0; a < 3; a++) {
        const hv = half[a];
        const k = Math.round(((pos.getComponent(i, a) + hv) / (2 * hv)) * n);
        p[a] = k <= s ? -hv + (r * k) / s : hv - r + (r * (k - s - 1)) / s;
        c[a] = clamp(p[a], -inner[a], inner[a]);
      }
      let ox = p[0] - c[0], oy = p[1] - c[1], oz = p[2] - c[2];
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
      pos.setXYZ(i, c[0] + ox * r, c[1] + oy * r, c[2] + oz * r);
      nor.setXYZ(i, ox, oy, oz);
    }
    boxProjectUV(g, w, h, d, hashString(key) / 4294967296);
    return g;
  });
}

/** Cylinder with metre UVs (U along the height, so grain runs along legs). */
function cylGeo(rt, rb, h, seg = 16, open = false) {
  return cached(keyOf('cyl', rt, rb, h, seg, open), () => {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    const uv = g.attributes.uv;
    const torso = (seg + 1) * 2, C = Math.PI * (rt + rb), rr = Math.max(rt, rb);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (i < torso) uv.setXY(i, v * h, u * C);
      else uv.setXY(i, (u - 0.5) * 2 * rr, (v - 0.5) * 2 * rr);
    }
    return g;
  });
}

function sphereGeo(r, ws = 16, hs = 12) {
  return cached(keyOf('sphere', r, ws, hs), () => new THREE.SphereGeometry(r, ws, hs));
}

function torusGeo(R, r, rs = 8, ts = 32, arc = TAU) {
  return cached(keyOf('torus', R, r, rs, ts, arc), () => new THREE.TorusGeometry(R, r, rs, ts, arc));
}

/** Lathe from [radius, y] pairs (repeat a point to get a crisp corner). UVs scaled to metres. */
function latheGeo(name, pts, seg = 24) {
  return cached(keyOf('lathe', name, seg), () => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    let len = 0, maxR = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    for (const [r] of pts) maxR = Math.max(maxR, r);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * maxR, uv.getY(i) * len);
    return g;
  });
}

/** Merge geometries (position/normal/uv; indexed or not) into one indexed geometry. */
function mergeGeos(list) {
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo;
      io += a.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const _eul = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** Translation + rotation (Euler order YXZ: roll, then pitch, then yaw) + scale. */
function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _eul.set(rx, ry, rz, 'YXZ');
  _quat.setFromEuler(_eul);
  return new THREE.Matrix4().compose(v3(x, y, z), _quat, v3(sx, sy, sz));
}

/** Matrix placing a Y-aligned geometry centred between a and b. */
function alignMatrix(a, b) {
  const A = toV3(a), B = toV3(b);
  const dir = B.clone().sub(A).normalize();
  return new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_UP, dir), v3(1, 1, 1));
}

/** Matrix placing a Y-aligned geometry at `pos`, its +Y along `dir`, with scale. */
function alignScaled(pos, dir, sx = 1, sy = 1, sz = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, toV3(dir).normalize());
  return new THREE.Matrix4().compose(toV3(pos), q, v3(sx, sy, sz));
}

/** Matrix for a leaf/blade: local +Z along `dir`, local +Y (face normal) towards `up`. */
function orientMatrix(pos, dir, up, roll, sx, sy, sz) {
  const bz = toV3(dir).normalize();
  const bx = new THREE.Vector3().crossVectors(up, bz);
  if (bx.lengthSq() < 1e-8) bx.crossVectors(Math.abs(bz.y) < 0.9 ? Y_UP : X_AXIS, bz);
  bx.normalize();
  let by = new THREE.Vector3().crossVectors(bz, bx);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const nx = bx.clone().multiplyScalar(c).addScaledVector(by, s);
    by = by.clone().multiplyScalar(c).addScaledVector(bx, -s);
    bx.copy(nx);
  }
  const m = new THREE.Matrix4().makeBasis(bx.multiplyScalar(sx), by.multiplyScalar(sy), bz.multiplyScalar(sz));
  m.setPosition(toV3(pos));
  return m;
}

function group(name) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/**
 * Collects transformed geometry per material and emits one merged mesh per material.
 * Keeps the mesh (draw call) count low while pieces are modelled from many primitives.
 */
class Parts {
  constructor() {
    this.map = new Map();
  }

  add(mat, geo, matrix) {
    const g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    let list = this.map.get(mat);
    if (!list) this.map.set(mat, (list = []));
    list.push(g);
    return this;
  }

  box(mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(mat, boxGeo(w, h, d), trs(x, y, z, rx, ry, rz));
  }

  rbox(mat, w, h, d, r, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(mat, rboxGeo(w, h, d, r), trs(x, y, z, rx, ry, rz));
  }

  cyl(mat, rt, rb, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 16) {
    return this.add(mat, cylGeo(rt, rb, h, seg), trs(x, y, z, rx, ry, rz));
  }

  /** Tapered cylinder from a (radius ra) to b (radius rb). */
  leg(mat, a, b, ra, rb, seg = 10) {
    const A = toV3(a), B = toV3(b);
    return this.add(mat, cylGeo(rb, ra, A.distanceTo(B), seg), alignMatrix(A, B));
  }

  /** Square-section beam from a to b. */
  beam(mat, a, b, w, d) {
    const A = toV3(a), B = toV3(b);
    return this.add(mat, boxGeo(w, A.distanceTo(B), d), alignMatrix(A, B));
  }

  build(parent, { cast = true, receive = true, glow = false } = {}) {
    for (const [mat, list] of this.map) {
      const mesh = new THREE.Mesh(list.length === 1 ? list[0] : mergeGeos(list), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      if (glow) mesh.userData.lampGlow = true;
      parent.add(mesh);
    }
    this.map.clear();
    return parent;
  }
}

/** Collects instance transforms + colours and emits one InstancedMesh. */
class Instances {
  constructor() {
    this.mats = [];
    this.cols = [];
  }

  get length() {
    return this.mats.length;
  }

  push(matrix, color = WHITE) {
    this.mats.push(matrix.clone());
    this.cols.push(color.clone());
  }

  mesh(geo, mat, { cast = true, receive = true } = {}) {
    const im = new THREE.InstancedMesh(geo, mat, this.mats.length);
    this.mats.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, this.cols[i]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast;
    im.receiveShadow = receive;
    return im;
  }
}

/** Tapered wooden leg with a brass sabot at the foot. */
function capLeg(p, foot, top, rFoot, rTop, capLen = 0.026, wood = M.walnut, cap = M.brass) {
  const F = toV3(foot), T = toV3(top);
  const dir = T.clone().sub(F);
  const L = dir.length();
  dir.normalize();
  const mid = F.clone().addScaledVector(dir, capLen);
  const rMid = rFoot + ((rTop - rFoot) * capLen) / L;
  p.leg(cap, F, mid, rFoot * 1.06, rMid * 1.06, 12);
  p.leg(wood, mid, T, rMid, rTop, 12);
}

/* ═══════════════════════════════════ books ═══════════════════════════════════ */
// Unit book: x ∈ [-.5, .5] (thickness), y ∈ [0, 1] (height), z ∈ [-.5, .5] (depth), spine at +Z.
// The coloured cover is a U of two boards plus the spine; a cream page block sits inside,
// recessed slightly, so the tops of books read as pages framed by the covers.

function bookCoverGeo() {
  return cached('book-cover', () => {
    const parts = [
      new THREE.BoxGeometry(0.12, 1, 1).translate(-0.44, 0.5, 0),
      new THREE.BoxGeometry(0.12, 1, 1).translate(0.44, 0.5, 0),
      new THREE.BoxGeometry(0.76, 1, 0.06).translate(0, 0.5, 0.47),
    ];
    return mergeGeos(parts);
  });
}

function bookPagesGeo() {
  return cached('book-pages', () => new THREE.BoxGeometry(0.76, 0.97, 0.935).translate(0, 0.5, -0.0275));
}

function bookColor(rng) {
  const c = new THREE.Color(rng.pick(BOOK_COLORS));
  c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.07);
  return c;
}

/** Upright book with its base centred at (xc, y0, zc). */
function bookMatrix(xc, y0, zc, t, h, d, rotY = 0) {
  return trs(xc, y0, zc, 0, rotY, 0, t, h, d);
}

/** Book leaning towards -X by angle a, pivoting on its bottom-left edge at (px, y0). */
function leaningBookMatrix(px, y0, zc, t, h, d, a) {
  return trs(px + (t / 2) * Math.cos(a), y0 + (t / 2) * Math.sin(a), zc, 0, 0, a, t, h, d);
}

/** Book lying flat, spine facing +Z, occupying x ∈ [xLeft, xLeft + h]. */
function shelfFlatBook(xLeft, y0, zc, t, h, d) {
  return trs(xLeft, y0 + t / 2, zc, 0, 0, -Math.PI / 2, t, h, d);
}

/** Book lying flat, centred at (cx, cz) on a surface at y0, turned by yaw. */
function flatBookMatrix(cx, y0, cz, t, h, d, yaw) {
  const m = new THREE.Matrix4().makeTranslation(cx, y0 + t / 2, cz);
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.multiply(new THREE.Matrix4().makeTranslation(-h / 2, 0, 0));
  m.multiply(trs(0, 0, 0, 0, 0, -Math.PI / 2, t, h, d));
  return m;
}

/** Two instanced meshes (covers + pages) for a list of { m: Matrix4, c: Color }. */
function bookMeshes(list) {
  const covers = new Instances(), pages = new Instances();
  for (const b of list) {
    covers.push(b.m, b.c);
    pages.push(b.m);
  }
  const a = covers.mesh(bookCoverGeo(), M.bookCover);
  const b = pages.mesh(bookPagesGeo(), M.bookPages);
  a.name = 'books';
  b.name = 'book-pages';
  return [a, b];
}

/* ═══════════════════════════════════ plants ═══════════════════════════════════ */
// Leaves are parametric surfaces (unit length along +Z, face normal +Y, base at the origin)
// with a V-fold along the midrib and a downward curl; one InstancedMesh per plant holds all
// its leaves and another its stems, so even lush plants cost only a few draw calls.

const LEAF_SHAPES = {
  fiddle: { segL: 8, segW: 3, width: 0.74, fold: 0.18, curve: 0.5, profile: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 1.45)), 0.7) },
  monstera: { segL: 16, segW: 5, width: 0.95, fold: 0.12, curve: 0.55, slits: true, base: -0.12, notch: 0.12, profile: (u) => Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * u)), 0.62) },
  lance: { segL: 5, segW: 2, width: 0.24, fold: 0.25, curve: 0.3, profile: (u) => Math.pow(Math.sin(Math.PI * u), 0.75) },
  sword: { segL: 8, segW: 2, width: 1, fold: 0.35, curve: 0.04, profile: (u) => Math.min(1, (1 - u) * 3.2) * (0.75 + 0.25 * Math.min(1, u * 6)) },
  paddle: { segL: 9, segW: 3, width: 0.36, fold: 0.15, curve: 0.25, profile: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.9)), 0.55) },
  round: { segL: 6, segW: 3, width: 1, fold: -0.08, curve: 0, base: -0.5, profile: (u) => Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) },
  heart: { segL: 6, segW: 3, width: 0.8, fold: 0.1, curve: 0.3, base: -0.06, notch: 0.08, profile: (u) => Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * u)), 0.7) },
  palm: { segL: 5, segW: 1, width: 0.12, fold: 0.4, curve: 0.9, profile: (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.6) },
};

function leafGeo(kind) {
  if (kind === 'succulent') {
    // plump teardrop leaf, base at the origin
    return cached('leaf-succulent', () => new THREE.SphereGeometry(1, 8, 6).scale(0.42, 0.2, 0.5).translate(0, 0, 0.5));
  }
  return cached('leaf-' + kind, () => {
    const { segL, segW, width, fold, curve, profile, slits = false, base = 0, notch = 0 } = LEAF_SHAPES[kind];
    const cols = segW * 2 + 1;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= segL; j++) {
      const u = j / segL, a = curve * u;
      const cz = curve > 1e-4 ? Math.sin(a) / curve : u;
      const cy = curve > 1e-4 ? -(1 - Math.cos(a)) / curve : 0;
      const ny = Math.cos(a), nz = Math.sin(a);
      const w = profile(u) * width * 0.5;
      for (let i = 0; i < cols; i++) {
        const v = i / segW - 1;
        const lift = fold * Math.abs(v) * w;
        const nzAdd = notch * (1 - Math.abs(v)) * Math.max(0, 1 - u / 0.15);
        pos.push(v * w, cy + ny * lift, cz + nz * lift + base + nzAdd);
        uv.push((v + 1) / 2, u);
      }
    }
    for (let j = 0; j < segL; j++) {
      const slitRow = slits && j >= 3 && j <= segL - 3 && j % 3 === 0;
      for (let i = 0; i < cols - 1; i++) {
        if (slitRow) {
          const v0 = Math.abs(i / segW - 1), v1 = Math.abs((i + 1) / segW - 1);
          if (Math.min(v0, v1) >= 0.39) continue;
        }
        const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

function stemGeo() {
  return cached('stem-unit', () => new THREE.CylinderGeometry(0.8, 1, 1, 7, 1));
}

function leafColor(rng, list = FOLIAGE, light = 0.03) {
  const c = new THREE.Color(rng.pick(list));
  c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08 + light);
  return c;
}

/** Stem segment from a to b (radius r) for the unit stem cylinder. */
function segmentMatrix(a, b, r) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 1e-4;
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, d.divideScalar(len));
  return new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, v3(r, len + r, r));
}

function addStemPath(stems, path, r0, r1, color) {
  for (let i = 0; i < path.length - 1; i++) stems.push(segmentMatrix(path[i], path[i + 1], lerp(r0, r1, i / Math.max(1, path.length - 2))), color);
}

function bezierPoint(a, b, c, t) {
  const u = 1 - t;
  return v3(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z);
}

function bezierPath(a, b, c, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(bezierPoint(a, b, c, i / n));
  return pts;
}

function pathPoint(path, t) {
  const f = clamp(t, 0, 1) * (path.length - 1);
  const i = Math.min(Math.floor(f), path.length - 2);
  return path[i].clone().lerp(path[i + 1], f - i);
}

function pathLength(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += path[i].distanceTo(path[i - 1]);
  return l;
}

function wobblyPath(rng, a, b, n, wobble) {
  const pts = [a.clone()];
  for (let i = 1; i < n; i++) {
    const p = a.clone().lerp(b, i / n);
    p.x += (rng() - 0.5) * wobble;
    p.z += (rng() - 0.5) * wobble;
    pts.push(p);
  }
  pts.push(b.clone());
  return pts;
}

/** Shrinks a leaf so its tip stays within `maxR` of the plant axis. */
function fitLeaf(p, dir, L, maxR) {
  const tip = Math.hypot(p.x + dir.x * L, p.z + dir.z * L);
  if (tip <= maxR) return L;
  const horiz = Math.max(0.2, Math.hypot(dir.x, dir.z));
  return Math.max(L * 0.45, Math.max(0.03, maxR - Math.hypot(p.x, p.z)) / horiz);
}

function clampRadius(p, maxR) {
  const r = Math.hypot(p.x, p.z);
  if (r > maxR) {
    p.x *= maxR / r;
    p.z *= maxR / r;
  }
  return p;
}

const BARK = new THREE.Color('#6b5643');
const STEM_GREEN = new THREE.Color('#5d7a45');

const GROWERS = {
  fiddle(rng, o, stems, leaves) {
    const top = o.height;
    const trunkTop = v3(rng.range(-0.03, 0.03), top - 0.1, rng.range(-0.03, 0.03));
    const trunk = wobblyPath(rng, v3(0, o.y0 - 0.02, 0), trunkTop, 5, 0.04);
    addStemPath(stems, trunk, 0.02, 0.011, BARK);
    const paths = [{ path: trunk, t0: 0.42 }];
    const nb = o.branches ?? 2, az0 = rng() * TAU;
    for (let b = 0; b < nb; b++) {
      const start = pathPoint(trunk, rng.range(0.45, 0.62));
      const az = az0 + (b / nb) * TAU + rng.range(-0.4, 0.4);
      const reach = Math.min(o.spread * 0.45, rng.range(0.14, 0.22));
      const end = start.clone().add(v3(Math.cos(az) * reach, rng.range(0.22, 0.34) * (top - o.y0), Math.sin(az) * reach));
      end.y = Math.min(end.y, top - 0.15);
      const path = wobblyPath(rng, start, end, 3, 0.02);
      addStemPath(stems, path, 0.011, 0.007, BARK);
      paths.push({ path, t0: 0.2 });
    }
    for (const { path, t0 } of paths) {
      let az = rng() * TAU;
      const dt = 0.062 / pathLength(path);
      for (let t = t0; t <= 1.0001; t += dt) {
        az += 2.39996 + rng.range(-0.3, 0.3);
        const p = pathPoint(path, t);
        const k = clamp((t - t0) / (1 - t0), 0, 1);
        const elev = lerp(0.12, 0.95, k) + rng.range(-0.2, 0.2);
        const dir = dirFrom(az, elev);
        let L = o.leafSize * (0.72 + 0.4 * Math.sin(Math.PI * (0.25 + 0.6 * k))) * rng.range(0.85, 1.1);
        L = fitLeaf(p, dir, L, o.spread);
        leaves.push(orientMatrix(p, dir, Y_UP, rng.range(-0.35, 0.35), L * rng.range(0.9, 1.05), L, L), leafColor(rng));
      }
    }
  },

  olive(rng, o, stems, leaves) {
    const crownR = o.crown ?? 0.28;
    const crownC = v3(rng.range(-0.02, 0.02), o.height - crownR * 0.95, rng.range(-0.02, 0.02));
    const trunkTop = v3(crownC.x * 0.5, crownC.y - crownR * 0.55, crownC.z * 0.5);
    const bark = new THREE.Color('#6f6556');
    addStemPath(stems, wobblyPath(rng, v3(0, o.y0 - 0.02, 0), trunkTop, 4, 0.035), 0.026, 0.018, bark);
    const tips = [];
    const nb = 7;
    for (let b = 0; b < nb; b++) {
      const d = dirFrom((b / nb) * TAU + rng.range(-0.3, 0.3), rng.range(0.15, 1.1));
      const tip = crownC.clone().addScaledVector(d, crownR * rng.range(0.5, 0.7));
      const mid = trunkTop.clone().lerp(tip, 0.5).add(v3(0, 0.04, 0));
      addStemPath(stems, [trunkTop, mid, tip], 0.012, 0.005, bark);
      tips.push(tip);
    }
    tips.push(crownC.clone().add(v3(0, crownR * 0.6, 0)));
    const silver = ['#7d8c66', '#6c7d58', '#8d9a76', '#5f7150'];
    for (const tip of tips) {
      for (let i = 0; i < 46; i++) {
        const L = rng.range(0.065, 0.09);
        const p = clampRadius(tip.clone().add(randomInSphere(rng).multiplyScalar(0.15)), o.spread - L);
        const dir = p.clone().sub(crownC).normalize().add(randomInSphere(rng).multiplyScalar(0.9)).add(v3(0, 0.3, 0)).normalize();
        leaves.push(orientMatrix(p, dir, Y_UP, rng.range(-1, 1), L, L, L), leafColor(rng, silver, 0));
      }
    }
  },

  monstera(rng, o, stems, leaves) {
    const n = o.count ?? 9, s = o.scale ?? 1;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * TAU + rng.range(-0.3, 0.3);
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const len = rng.range(0.5, 0.85) * s;
      const rise = len * rng.range(0.7, 0.9), reach = len * rng.range(0.25, 0.42);
      const base = v3(out.x * 0.03, o.y0 - 0.01, out.z * 0.03);
      const ctrl = base.clone().addScaledVector(Y_UP, rise * 0.9).addScaledVector(out, reach * 0.15);
      const tip = base.clone().addScaledVector(Y_UP, rise).addScaledVector(out, reach);
      addStemPath(stems, bezierPath(base, ctrl, tip, 4), 0.009, 0.006, STEM_GREEN);
      const elev = rng.range(-0.1, 0.35);
      const dir = out.clone().multiplyScalar(Math.cos(elev)).add(v3(0, Math.sin(elev), 0));
      const L = Math.max(0.16, fitLeaf(tip, dir, rng.range(0.3, 0.42) * s, o.spread));
      leaves.push(orientMatrix(tip, dir, Y_UP, rng.range(-0.25, 0.25), L, L, L), leafColor(rng, [COLORS.leafB, COLORS.leafA]));
    }
  },

  palm(rng, o, stems, leaves) {
    const n = o.count ?? 7, s = o.scale ?? 1;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * TAU + rng.range(-0.25, 0.25);
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const side = new THREE.Vector3().crossVectors(Y_UP, out).normalize();
      const len = rng.range(0.8, 1.15) * s;
      const base = v3(out.x * 0.02, o.y0 - 0.01, out.z * 0.02);
      const p1 = base.clone().addScaledVector(Y_UP, len * 0.75).addScaledVector(out, len * 0.1);
      const reach = Math.min(len * rng.range(0.42, 0.55), o.spread - 0.22);
      const p2 = base.clone().addScaledVector(Y_UP, len * rng.range(0.55, 0.72)).addScaledVector(out, reach);
      addStemPath(stems, bezierPath(base, p1, p2, 6), 0.008, 0.004, STEM_GREEN);
      for (let k = 0; k < 16; k++) {
        const t = 0.25 + (k / 15) * 0.75;
        const P = bezierPoint(base, p1, p2, t);
        const T = bezierPoint(base, p1, p2, Math.min(1, t + 0.02)).sub(bezierPoint(base, p1, p2, Math.max(0, t - 0.02))).normalize();
        const Ll = (0.3 * Math.sin(Math.PI * (0.15 + (0.85 * (t - 0.25)) / 0.75)) + 0.06) * s;
        for (const sg of [-1, 1]) {
          const d = side.clone().multiplyScalar(sg).addScaledVector(T, 0.55).addScaledVector(Y_UP, -0.3).normalize();
          const L = fitLeaf(P, d, Ll, o.spread);
          leaves.push(orientMatrix(P, d, Y_UP, sg * 0.3, L, L, L), leafColor(rng, FOLIAGE, 0.05));
        }
      }
    }
  },

  snake(rng, o, stems, leaves) {
    const n = o.count ?? 13, s = o.scale ?? 1;
    for (let i = 0; i < n; i++) {
      const az = rng() * TAU, rr = rng() * o.innerR * 0.6;
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const base = v3(out.x * rr, o.y0 - 0.02, out.z * rr);
      const tilt = rng.range(0.03, 0.2);
      const dir = Y_UP.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(out, Math.sin(tilt));
      const L = rng.range(0.55, 1.0) * s, W = rng.range(0.05, 0.075);
      const c = new THREE.Color(1, 1, 1).offsetHSL(0, 0, rng.range(-0.12, 0));
      leaves.push(orientMatrix(base, dir, out, rng.range(-0.6, 0.6), W, W, L), c);
    }
  },

  bird(rng, o, stems, leaves) {
    const n = o.count ?? 7, s = o.scale ?? 1;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * TAU + rng.range(-0.4, 0.4);
      const out = v3(Math.cos(az), 0, Math.sin(az));
      const tilt = rng.range(0.08, 0.3), len = rng.range(0.45, 0.95) * s;
      const base = v3(out.x * 0.02, o.y0 - 0.01, out.z * 0.02);
      const dir0 = Y_UP.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(out, Math.sin(tilt));
      const tip = clampRadius(base.clone().addScaledVector(dir0, len), o.spread - 0.12);
      addStemPath(stems, [base, base.clone().lerp(tip, 0.5).addScaledVector(out, -0.015), tip], 0.008, 0.006, STEM_GREEN);
      const t2 = tilt + rng.range(0.15, 0.45);
      const dir = Y_UP.clone().multiplyScalar(Math.cos(t2)).addScaledVector(out, Math.sin(t2));
      const L = fitLeaf(tip, dir, rng.range(0.4, 0.5) * s, o.spread);
      leaves.push(orientMatrix(tip, dir, out, rng.range(-0.4, 0.4), L, L, L), leafColor(rng, [COLORS.leafB, COLORS.leafA]));
    }
  },

  pilea(rng, o, stems, leaves) {
    const s = o.scale ?? 1;
    const top = v3(0, o.y0 + 0.11 * s, 0);
    addStemPath(stems, [v3(0, o.y0 - 0.01, 0), top], 0.007, 0.005, STEM_GREEN);
    const n = o.count ?? 16;
    for (let i = 0; i < n; i++) {
      const t = i / n, az = i * 2.39996;
      const from = v3(0, lerp(o.y0 + 0.02, top.y, t), 0);
      const elev = lerp(0.35, 1.1, t) + rng.range(-0.15, 0.15);
      const tip = from.clone().addScaledVector(dirFrom(az, elev), rng.range(0.07, 0.14) * s);
      addStemPath(stems, [from, tip], 0.0025, 0.002, STEM_GREEN);
      const L = rng.range(0.05, 0.08) * s;
      const out = v3(Math.cos(az), 0, Math.sin(az));
      leaves.push(orientMatrix(tip, out, Y_UP.clone().addScaledVector(out, 0.35), rng.range(-0.3, 0.3), L, L, L), leafColor(rng, [COLORS.leafC, COLORS.leafA], 0.05));
    }
  },

  succulent(rng, o, stems, leaves) {
    const n = o.count ?? 22, s = o.scale ?? 1;
    const tones = ['#8fb39a', '#9dbfa2', '#a7c4a0', '#b7a39a'];
    for (let i = 0; i < n; i++) {
      const t = i / n, az = i * 2.39996;
      const elev = lerp(1.25, 0.18, Math.pow(t, 0.8));
      const L = (0.025 + 0.045 * t) * s;
      const base = v3(Math.cos(az) * 0.006, o.y0 + 0.012 * (1 - t), Math.sin(az) * 0.006);
      leaves.push(orientMatrix(base, dirFrom(az, elev), Y_UP, 0, L * 0.9, L * 0.75, L), leafColor(rng, tones, 0));
    }
  },

  trailing(rng, o, stems, leaves) {
    const vines = o.count ?? 6, s = o.scale ?? 1;
    for (let v = 0; v < vines; v++) {
      const az = lerp(-1.25, 1.25, v / (vines - 1)) + rng.range(-0.2, 0.2);
      const out = v3(Math.sin(az), 0, Math.cos(az));
      const side = new THREE.Vector3().crossVectors(Y_UP, out).normalize();
      const start = v3(out.x * o.innerR * 0.7, o.y0 + 0.01, out.z * o.innerR * 0.7);
      const over = start.clone().addScaledVector(out, rng.range(0.13, 0.22)).add(v3(0, 0.03, 0));
      const drop = over.clone().addScaledVector(out, 0.05).add(v3(0, -rng.range(0.25, 0.6) * s, 0));
      const path = bezierPath(start, over, drop, 8);
      addStemPath(stems, path, 0.003, 0.0025, STEM_GREEN);
      const n = Math.floor(pathLength(path) / 0.045);
      for (let k = 1; k <= n; k++) {
        const p = pathPoint(path, k / n);
        const sg = k % 2 ? 1 : -1;
        const dir = out.clone().multiplyScalar(0.55).addScaledVector(side, sg * 0.6).add(v3(0, -0.35, 0)).normalize();
        const L = rng.range(0.05, 0.075) * s;
        leaves.push(orientMatrix(p, dir, out, rng.range(-0.4, 0.4), L, L, L), leafColor(rng, [COLORS.leafC, COLORS.leafA], 0.06));
      }
    }
    for (let i = 0; i < 6; i++) {
      const az = rng() * TAU;
      const p = v3(Math.cos(az) * 0.02, o.y0, Math.sin(az) * 0.02);
      const L = rng.range(0.05, 0.07) * s;
      leaves.push(orientMatrix(p, dirFrom(az, rng.range(0.5, 1.0)), Y_UP, 0, L, L, L), leafColor(rng, [COLORS.leafC], 0.06));
    }
  },

  cactus(rng, o, stems, leaves, p) {
    const s = o.scale ?? 1;
    const cap = (r, h, x, y, z, rz = 0) => p.add(M.cactus, cached(keyOf('capsule', r, h), () => new THREE.CapsuleGeometry(r, h, 3, 8)), trs(x, y, z, 0, 0, rz));
    cap(0.045 * s, 0.3 * s, 0, o.y0 + 0.195 * s - 0.02, 0);
    cap(0.028 * s, 0.05 * s, 0.065 * s, o.y0 + 0.15 * s, 0, Math.PI / 2);
    cap(0.028 * s, 0.1 * s, 0.1 * s, o.y0 + 0.21 * s, 0);
    cap(0.024 * s, 0.03 * s, -0.06 * s, o.y0 + 0.24 * s, 0, Math.PI / 2);
    cap(0.024 * s, 0.07 * s, -0.088 * s, o.y0 + 0.28 * s, 0);
    p.add(M.flower, sphereGeo(0.018, 10, 8), trs(0, o.y0 + 0.37 * s, 0, 0, 0, 0, 1, 0.6, 1));
  },
};

const LEAF_STYLE = {
  fiddle: ['fiddle', 'leaf'], olive: ['lance', 'leafPlain'], monstera: ['monstera', 'leaf'], palm: ['palm', 'leaf'],
  snake: ['sword', 'leafSnake'], bird: ['paddle', 'leaf'], pilea: ['round', 'leaf'], succulent: ['succulent', 'succulent'],
  trailing: ['heart', 'leaf'],
};

/** Adds a pot (lathe) at height y. Returns its soil level and inner radius. */
function addPot(p, style, r, h, mat, y) {
  let pts, innerR, soil;
  if (style === 'cylinder') {
    innerR = r - 0.012;
    soil = h - 0.035;
    pts = [[0, 0], [r * 0.95, 0], [r * 0.95, 0], [r, 0.015], [r, h], [r, h], [innerR, h], [innerR, h], [innerR, soil]];
  } else if (style === 'belly') {
    innerR = r * 0.7;
    soil = h - 0.03;
    pts = [[0, 0], [r * 0.6, 0], [r * 0.6, 0], [r * 0.85, h * 0.12], [r, h * 0.45], [r * 0.92, h * 0.8], [r * 0.78, h * 0.95], [r * 0.79, h], [r * 0.79, h], [innerR, h], [innerR, h], [innerR, soil]];
  } else if (style === 'bowl') {
    innerR = r * 0.88;
    soil = h - 0.02;
    pts = [[0, 0], [r * 0.6, 0], [r * 0.6, 0], [r * 0.9, h * 0.35], [r, h * 0.8], [r, h], [r, h], [innerR, h], [innerR, h], [innerR, soil]];
  } else {
    innerR = r * 0.88;
    soil = h - 0.04;
    pts = [[0, 0], [r * 0.7, 0], [r * 0.7, 0], [r * 0.72, 0.012], [r * 0.9, h * 0.84], [r * 0.9, h * 0.84], [r, h * 0.85], [r, h], [r, h], [innerR + 0.012 * r, h], [innerR + 0.012 * r, h], [innerR, soil]];
    if (mat === M.potTerracotta) p.cyl(mat, r * 0.88, r * 0.8, 0.026, 0, y + 0.013, 0, 0, 0, 0, 28); // saucer
  }
  p.add(mat, latheGeo(keyOf('pot', style, r, h), pts, r > 0.14 ? 32 : 22), trs(0, y, 0));
  return { innerR, soilY: y + soil };
}

/** Mid-century tripod plant stand; returns the height the pot base sits at. */
function addPlantStand(p, h, potR) {
  const ringR = potR * 0.76;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    p.leg(M.walnut, [Math.cos(a) * (ringR + 0.07), 0, Math.sin(a) * (ringR + 0.07)], [Math.cos(a) * ringR, h, Math.sin(a) * ringR], 0.011, 0.016);
  }
  p.add(M.walnut, torusGeo(ringR, 0.012, 8, 32), trs(0, h - 0.012, 0, Math.PI / 2));
  return h - 0.03;
}

/**
 * Reusable plant builder. Options: kind (fiddle | olive | monstera | palm | snake | bird |
 * pilea | succulent | trailing | cactus), pot style/size/material, height (absolute top for
 * tree-like kinds), spread (max foliage radius), scale, count, stand height.
 */
function buildPlant(rng, o) {
  const g = group(o.name || `plant-${o.kind}`);
  const p = new Parts();
  const base = o.stand ? addPlantStand(p, o.stand, o.potR) : 0;
  const pot = addPot(p, o.pot || 'taper', o.potR, o.potH, o.potMat || M.potTerracotta, base);
  p.cyl(o.soilMat || M.soil, pot.innerR, pot.innerR * 0.97, 0.012, 0, pot.soilY - 0.006, 0, 0, 0, 0, 24);
  const stems = new Instances(), leaves = new Instances();
  const ctx = { spread: 0.4, leafSize: 0.25, ...o, y0: pot.soilY, innerR: pot.innerR };
  GROWERS[o.kind](rng, ctx, stems, leaves, p);
  p.build(g);
  if (stems.length) g.add(stems.mesh(stemGeo(), M.stem));
  if (leaves.length) {
    const [shape, matName] = LEAF_STYLE[o.kind];
    g.add(leaves.mesh(leafGeo(shape), M[matName]));
  }
  return g;
}

/* ═════════════════════════════ rugs & cloths ═════════════════════════════ */

/** Very thin textured box with its top at y ≈ 0.012 (never z-fights with the floor). */
function buildRug(name, w, d, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), mat);
  mesh.name = name;
  mesh.position.y = 0.007;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function buildKilim() {
  const g = group('rug-kilim');
  const W = 3.6, D = 2.6;
  g.add(buildRug('kilim', W, D, M.rugKilim));
  for (const sx of [-1, 1]) {
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, D - 0.04), M.fringe);
    fringe.position.set(sx * (W / 2 + 0.035), 0.006, 0);
    fringe.rotation.y = sx < 0 ? Math.PI : 0; // threads attach on the rug side
    fringe.receiveShadow = true;
    g.add(fringe);
  }
  return g;
}

/* ═══════════════════════════════ seating ═══════════════════════════════ */

function buildSofa() {
  const g = group('sofa');
  const p = new Parts();
  const W = 2.2, D = 0.9, fab = M.teal;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      capLeg(p, [sx * (W / 2 - 0.09), 0, sz * (D / 2 - 0.07)], [sx * (W / 2 - 0.13), 0.17, sz * (D / 2 - 0.11)], 0.014, 0.024);
    }
  }
  p.rbox(fab, W - 0.04, 0.19, D - 0.03, 0.03, 0, 0.245, 0); // plinth 0.15–0.34
  for (const sx of [-1, 1]) p.rbox(fab, 0.17, 0.46, D, 0.06, sx * (W / 2 - 0.085), 0.38, 0); // arms, top 0.61
  p.rbox(fab, W - 0.3, 0.52, 0.2, 0.05, 0, 0.42, -D / 2 + 0.1); // back frame, top 0.68
  const inner = W - 0.34, cw = inner / 3;
  for (let i = 0; i < 3; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    p.rbox(fab, cw - 0.012, 0.13, 0.69, 0.045, x, 0.395, 0.1); // seat cushion, top 0.46
    p.rbox(fab, cw - 0.02, 0.33, 0.16, 0.06, x, 0.615, -0.2, -0.17); // back cushion, top ≈ 0.79
  }
  p.rbox(M.mustard, 0.4, 0.38, 0.13, 0.06, -0.66, 0.6, -0.05, -0.3, 0.22, 0.1);
  p.rbox(M.terracotta, 0.38, 0.36, 0.12, 0.055, 0.7, 0.595, -0.06, -0.28, -0.26, -0.12);
  // folded throw resting on one arm
  p.rbox(M.cream, 0.2, 0.05, 0.34, 0.018, -(W / 2 - 0.09), 0.632, 0.08, 0, 0.06, 0);
  p.rbox(M.cream, 0.19, 0.012, 0.3, 0.005, -(W / 2 - 0.095), 0.662, 0.09, 0, 0.1, 0);
  return p.build(g);
}

/** Upholstered mid-century armchair; `wings` turns it into a wingback reading chair. */
function buildArmchair(fabric, { wings = false, backH = 0.56 } = {}) {
  const g = group(wings ? 'wingback-chair' : 'armchair');
  const p = new Parts();
  const W = 0.78, D = 0.8, lean = 0.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) capLeg(p, [sx * 0.335, 0, sz * 0.325], [sx * 0.3, 0.2, sz * 0.29], 0.013, 0.022, 0.025);
  }
  p.rbox(fabric, W, 0.14, D - 0.02, 0.035, 0, 0.25, 0); // seat base 0.18–0.32
  p.rbox(fabric, 0.56, 0.13, 0.62, 0.045, 0, 0.38, 0.07); // seat cushion, top 0.445
  for (const sx of [-1, 1]) p.rbox(fabric, 0.11, 0.3, 0.74, 0.045, sx * 0.335, 0.47, 0.01); // arms, top 0.62
  const backCy = 0.32 + (backH / 2) * Math.cos(lean);
  p.rbox(fabric, W, backH, 0.12, 0.05, 0, backCy, -0.33, -lean);
  p.rbox(fabric, 0.54, backH - 0.16, 0.11, 0.05, 0, backCy + 0.02, -0.235, -lean);
  if (wings) {
    for (const sx of [-1, 1]) p.rbox(fabric, 0.1, backH * 0.5, 0.3, 0.045, sx * 0.355, backCy + backH * 0.17, -0.25, -lean, -sx * 0.3, 0);
  }
  return p.build(g);
}

function buildGalleryBench() {
  const g = group('gallery-bench');
  const p = new Parts();
  const L = 1.8, D = 0.5, H = 0.45;
  p.rbox(M.charcoal, L, 0.1, D, 0.035, 0, H - 0.05, 0); // cushion 0.35–0.45
  p.box(M.walnut, L - 0.1, 0.05, D - 0.08, 0, 0.325, 0); // frame 0.30–0.35
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) capLeg(p, [sx * 0.8, 0, sz * 0.19], [sx * 0.76, 0.305, sz * 0.15], 0.015, 0.024, 0.024);
    p.leg(M.walnut, [sx * 0.785, 0.12, -0.175], [sx * 0.785, 0.12, 0.175], 0.01, 0.01, 8);
  }
  p.leg(M.walnut, [-0.785, 0.12, 0], [0.785, 0.12, 0], 0.011, 0.011, 8);
  return p.build(g);
}

/** Drafting stool for the studio work table (seat 0.66 m). */
function buildStool() {
  const g = group('stool');
  const p = new Parts();
  const sy = 0.66;
  p.add(M.oak, latheGeo('stool-seat', [[0, sy - 0.04], [0.172, sy - 0.04], [0.172, sy - 0.04], [0.18, sy - 0.03], [0.18, sy - 0.01], [0.17, sy], [0.17, sy], [0, sy]], 36));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    p.leg(M.oak, [Math.cos(a) * 0.235, 0, Math.sin(a) * 0.235], [Math.cos(a) * 0.115, sy - 0.04, Math.sin(a) * 0.115], 0.0135, 0.018);
  }
  const ringY = 0.24, ringR = lerp(0.235, 0.115, ringY / (sy - 0.04));
  p.add(M.brass, torusGeo(ringR, 0.008, 8, 40), trs(0, ringY, 0, Math.PI / 2));
  return p.build(g);
}

/** Bentwood café chair with a cane seat. */
function buildBistroChair() {
  const g = group('bistro-chair');
  const p = new Parts();
  const wood = M.walnutDark, seatY = 0.45;
  p.cyl(M.cane, 0.19, 0.19, 0.014, 0, seatY - 0.004, 0, 0, 0, 0, 32);
  p.add(wood, torusGeo(0.2, 0.016, 10, 40), trs(0, seatY - 0.004, 0, Math.PI / 2));
  for (const sx of [-1, 1]) {
    p.leg(wood, [sx * 0.159, 0, 0.169], [sx * 0.13, seatY - 0.02, 0.13], 0.012, 0.016);
    p.leg(wood, [sx * 0.153, 0, -0.192], [sx * 0.13, seatY - 0.02, -0.12], 0.012, 0.016);
    p.leg(wood, [sx * 0.13, seatY - 0.02, -0.12], [sx * 0.13, 0.8, -0.21], 0.015, 0.013);
    p.leg(wood, [sx * 0.085, seatY + 0.005, -0.15], [sx * 0.085, 0.66, -0.19], 0.008, 0.008, 8);
  }
  p.add(wood, torusGeo(0.211, 0.008, 8, 40), trs(0, 0.2, -0.004, Math.PI / 2));
  p.add(wood, torusGeo(0.13, 0.013, 10, 32, Math.PI), trs(0, 0.8, -0.21, -0.18));
  p.add(wood, torusGeo(0.085, 0.009, 8, 28, Math.PI), trs(0, 0.66, -0.19, -0.18));
  return p.build(g);
}

/** Wicker bowl lounge chair (papasan style) with a cream cushion and a teal pillow. */
function buildLoungeChair() {
  const g = group('lounge-chair');
  const p = new Parts();
  p.add(M.wicker, latheGeo('papasan-base', [[0.26, 0], [0.3, 0], [0.3, 0], [0.345, 0.07], [0.36, 0.15], [0.34, 0.23], [0.3, 0.29], [0.3, 0.29], [0.26, 0.29]], 40));
  p.add(M.wicker, torusGeo(0.29, 0.022, 10, 48), trs(0, 0.29, 0, Math.PI / 2));
  p.add(M.wicker, torusGeo(0.31, 0.02, 10, 48), trs(0, 0.015, 0, Math.PI / 2));
  p.build(g);
  const bowl = new THREE.Group();
  bowl.position.set(0, 0.27, -0.02);
  bowl.rotation.x = 0.3; // front rim lower, back rim higher
  const bp = new Parts();
  const R = 0.62, phiMax = 1.12;
  const shell = [];
  for (let i = 0; i <= 12; i++) {
    const ph = (i / 12) * phiMax;
    shell.push([R * Math.sin(ph), R * (1 - Math.cos(ph))]);
  }
  bp.add(M.wicker, latheGeo('papasan-bowl', shell, 48));
  bp.add(M.wicker, torusGeo(R * Math.sin(phiMax), 0.032, 12, 64), trs(0, R * (1 - Math.cos(phiMax)), 0, Math.PI / 2));
  const R1 = R - 0.012, R2 = R - 0.13, phE = phiMax - 0.07, cush = [];
  for (let i = 0; i <= 10; i++) {
    const ph = (i / 10) * phE;
    cush.push([R1 * Math.sin(ph), R - R1 * Math.cos(ph)]);
  }
  const Rm = (R1 + R2) / 2 + 0.01;
  cush.push([Rm * Math.sin(phE + 0.04), R - Rm * Math.cos(phE + 0.04)]);
  for (let i = 10; i >= 0; i--) {
    const ph = (i / 10) * phE;
    cush.push([R2 * Math.sin(ph), R - R2 * Math.cos(ph)]);
  }
  bp.add(M.cream, latheGeo('papasan-cushion', cush, 48));
  bp.rbox(M.teal, 0.42, 0.36, 0.13, 0.065, 0.05, 0.36, -0.3, -0.35, 0.1, 0.06);
  bp.build(bowl);
  g.add(bowl);
  return g;
}

/* ═══════════════════════════════ tables ═══════════════════════════════ */

const VASES = {
  bud: [[0, 0], [0.034, 0], [0.034, 0], [0.04, 0.006], [0.05, 0.04], [0.052, 0.07], [0.042, 0.105], [0.024, 0.135], [0.017, 0.158], [0.02, 0.168], [0.02, 0.168], [0.014, 0.168], [0.012, 0.15]],
  bottle: [[0, 0], [0.04, 0], [0.04, 0], [0.045, 0.01], [0.048, 0.09], [0.04, 0.13], [0.018, 0.16], [0.015, 0.2], [0.019, 0.205], [0.019, 0.205], [0.013, 0.205], [0.012, 0.19]],
  bulb: [[0, 0], [0.03, 0], [0.03, 0], [0.05, 0.02], [0.065, 0.06], [0.06, 0.1], [0.04, 0.125], [0.036, 0.14], [0.036, 0.14], [0.03, 0.14], [0.028, 0.125]],
  bowl: [[0, 0], [0.04, 0], [0.04, 0], [0.07, 0.025], [0.09, 0.055], [0.092, 0.06], [0.092, 0.06], [0.085, 0.06], [0.06, 0.03], [0, 0.022]],
};

function buildCoffeeTable(rng) {
  const g = group('coffee-table');
  const p = new Parts();
  const H = 0.42, T = 0.035;
  p.rbox(M.oak, 1.2, T, 0.6, 0.014, 0, H - T / 2, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      p.box(M.oak, 0.085, 0.014, 0.085, sx * 0.47, H - T - 0.007, sz * 0.19);
      capLeg(p, [sx * 0.53, 0, sz * 0.25], [sx * 0.47, H - T - 0.012, sz * 0.19], 0.012, 0.021, 0.022);
    }
  }
  const books = [];
  let y = H;
  for (const [t, h, d, col, rot] of [[0.034, 0.3, 0.235, COLORS.teal, 0.12], [0.026, 0.27, 0.205, COLORS.cream, -0.08], [0.02, 0.235, 0.17, COLORS.terracotta, 0.3]]) {
    books.push({ m: flatBookMatrix(-0.3, y, 0.03, t, h, d, rot + rng.range(-0.05, 0.05)), c: new THREE.Color(col) });
    y += t;
  }
  g.add(...bookMeshes(books));
  const vx = 0.3, vz = -0.06;
  p.add(M.potSage, latheGeo('vase-bud', VASES.bud, 24), trs(vx, H, vz));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.3, 0.3), r = rng.range(0.05, 0.12);
    const base = v3(vx + Math.cos(a) * 0.006, H + 0.12, vz + Math.sin(a) * 0.006);
    const tip = v3(vx + Math.cos(a) * r, H + rng.range(0.34, 0.46), vz + Math.sin(a) * r);
    p.leg(M.driedStem, base, tip, 0.0022, 0.0015, 5);
    const dir = tip.clone().sub(base).normalize();
    p.add(M.driedHead, sphereGeo(1, 10, 8), alignScaled(tip.clone().addScaledVector(dir, 0.02), dir, 0.011, 0.028, 0.011));
  }
  return p.build(g);
}

/** Drum shade with glowing interior, bulb, brass rims and spider. */
function addShade(g, p, { x = 0, z = 0, y0, h, rTop, rBot, bulbY, bulbR = 0.04 }) {
  const glowP = new Parts();
  const outer = new THREE.Mesh(cylGeo(rTop, rBot, h, 40, true), M.shade);
  outer.position.set(x, y0 + h / 2, z);
  outer.castShadow = true;
  outer.userData.lampGlow = true;
  g.add(outer);
  glowP.add(M.shadeInner, cylGeo(rTop * 0.985, rBot * 0.985, h * 0.995, 40, true), trs(x, y0 + h / 2, z));
  glowP.add(M.bulb, sphereGeo(bulbR, 16, 12), trs(x, bulbY, z));
  glowP.build(g, { cast: false, glow: true });
  p.add(M.brass, torusGeo(rTop, 0.004, 6, 40), trs(x, y0 + h, z, Math.PI / 2));
  p.add(M.brass, torusGeo(rBot, 0.004, 6, 40), trs(x, y0, z, Math.PI / 2));
  const sy = bulbY - bulbR - 0.012, rr = lerp(rBot, rTop, (sy - y0) / h) * 0.98;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    p.leg(M.brass, [x, sy, z], [x + Math.cos(a) * rr, sy, z + Math.sin(a) * rr], 0.0025, 0.0025, 5);
  }
}

function buildFloorLamp({ tripod = true } = {}) {
  const g = group('floor-lamp');
  const p = new Parts();
  const stemTop = 1.47;
  if (tripod) {
    const jy = 0.6;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + Math.PI / 6;
      capLeg(p, [Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27], [Math.cos(a) * 0.035, jy, Math.sin(a) * 0.035], 0.012, 0.019, 0.03);
    }
    p.cyl(M.brass, 0.03, 0.034, 0.08, 0, jy + 0.01, 0, 0, 0, 0, 20);
    p.cyl(M.brass, 0.011, 0.011, stemTop - jy, 0, (stemTop + jy) / 2, 0, 0, 0, 0, 12);
  } else {
    p.cyl(M.steel, 0.15, 0.16, 0.024, 0, 0.012, 0, 0, 0, 0, 36);
    p.cyl(M.brass, 0.045, 0.055, 0.016, 0, 0.032, 0, 0, 0, 0, 24);
    p.cyl(M.brass, 0.011, 0.011, stemTop - 0.04, 0, (stemTop + 0.04) / 2, 0, 0, 0, 0, 12);
  }
  p.cyl(M.brass, 0.018, 0.018, 0.06, 0, stemTop + 0.01, 0, 0, 0, 0, 16);
  addShade(g, p, { y0: 1.33, h: 0.3, rTop: 0.2, rBot: 0.22, bulbY: 1.53 });
  return p.build(g);
}

/** Round walnut side table with a table lamp, a book and reading glasses (library). */
function buildSideTable() {
  const g = group('side-table');
  const p = new Parts();
  const H = 0.55, R = 0.225;
  p.add(M.walnut, latheGeo('side-top', [[0, H - 0.028], [R - 0.008, H - 0.028], [R - 0.008, H - 0.028], [R, H - 0.02], [R, H - 0.008], [R - 0.008, H], [R - 0.008, H], [0, H]], 40));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2;
    capLeg(p, [Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 0.11, H - 0.028, Math.sin(a) * 0.11], 0.011, 0.018, 0.022);
  }
  p.add(M.brass, torusGeo(lerp(0.2, 0.11, 0.2 / (H - 0.028)), 0.006, 8, 40), trs(0, 0.2, 0, Math.PI / 2));
  const lx = -0.06, lz = -0.06;
  p.add(M.potTeal, latheGeo('lamp-base', [[0, 0], [0.05, 0], [0.05, 0], [0.065, 0.03], [0.08, 0.09], [0.07, 0.16], [0.04, 0.2], [0.022, 0.215], [0.022, 0.215], [0, 0.215]], 28), trs(lx, H, lz));
  p.cyl(M.brass, 0.008, 0.008, 0.12, lx, H + 0.275, lz);
  p.cyl(M.brass, 0.015, 0.015, 0.04, lx, H + 0.345, lz);
  addShade(g, p, { x: lx, z: lz, y0: H + 0.27, h: 0.18, rTop: 0.12, rBot: 0.15, bulbY: H + 0.4, bulbR: 0.03 });
  g.add(...bookMeshes([{ m: flatBookMatrix(0.075, H, 0.065, 0.03, 0.2, 0.14, 0.5), c: new THREE.Color('#8c3b2f') }]));
  const gy = H + 0.032;
  for (const sx of [-1, 1]) p.add(M.glasses, torusGeo(0.022, 0.0022, 6, 24), trs(0.07 + sx * 0.026 * Math.cos(0.5), gy, 0.07 - sx * 0.026 * Math.sin(0.5), Math.PI / 2, 0.5, 0));
  p.leg(M.glasses, [0.07 - 0.004 * 0.88, gy, 0.07 + 0.004 * 0.48], [0.07 + 0.004 * 0.88, gy, 0.07 - 0.004 * 0.48], 0.002, 0.002, 5);
  for (const sx of [-1, 1]) {
    const hx = 0.07 + sx * 0.047 * Math.cos(0.5), hz = 0.07 - sx * 0.047 * Math.sin(0.5);
    p.leg(M.glasses, [hx, gy, hz], [hx - 0.06 * Math.sin(0.5) - sx * 0.02, gy + 0.002, hz - 0.06 * Math.cos(0.5)], 0.0018, 0.0018, 5);
  }
  return p.build(g);
}

function buildTeapotSet() {
  const g = group('tea-set');
  const p = new Parts();
  const glaze = M.potCream;
  p.add(glaze, latheGeo('teapot-body', [[0, 0], [0.045, 0], [0.045, 0], [0.065, 0.02], [0.077, 0.05], [0.074, 0.08], [0.06, 0.105], [0.042, 0.118], [0.042, 0.118], [0, 0.118]], 28));
  p.add(glaze, latheGeo('teapot-lid', [[0, 0.116], [0.044, 0.116], [0.044, 0.116], [0.034, 0.13], [0.012, 0.136], [0.012, 0.136], [0, 0.136]], 24));
  p.add(glaze, sphereGeo(0.012, 12, 8), trs(0, 0.146, 0));
  p.leg(glaze, [0.06, 0.04, 0], [0.12, 0.105, 0], 0.016, 0.0075, 12);
  p.add(glaze, torusGeo(0.04, 0.0075, 8, 20, Math.PI * 1.15), trs(-0.075, 0.065, 0, 0, 0, Math.PI * 0.425));
  const cx = 0.25, cz = 0.13;
  p.add(M.potMustard, latheGeo('saucer', [[0, 0], [0.04, 0], [0.04, 0], [0.065, 0.012], [0.068, 0.016], [0.068, 0.016], [0.062, 0.016], [0.04, 0.008], [0, 0.007]], 28), trs(cx, 0, cz));
  p.add(M.potMustard, latheGeo('cup', [[0, 0.007], [0.025, 0.007], [0.025, 0.007], [0.035, 0.02], [0.042, 0.06], [0.042, 0.06], [0.038, 0.06], [0.031, 0.022], [0, 0.018]], 24), trs(cx, 0, cz));
  p.cyl(M.tea, 0.037, 0.037, 0.004, cx, 0.05, cz, 0, 0, 0, 20);
  p.add(M.potMustard, torusGeo(0.015, 0.004, 6, 14, Math.PI), trs(cx + 0.044, 0.038, cz, 0, 0, -Math.PI / 2));
  return p.build(g);
}

function buildBistroTable(rng) {
  const g = group('bistro-table');
  const p = new Parts();
  const H = 0.75, R = 0.5;
  p.add(M.marble, latheGeo('bistro-top', [[0, H - 0.03], [R - 0.01, H - 0.03], [R - 0.01, H - 0.03], [R, H - 0.022], [R, H - 0.008], [R - 0.01, H], [R - 0.01, H], [0, H]], 56));
  p.cyl(M.steel, 0.15, 0.15, 0.02, 0, H - 0.04, 0, 0, 0, 0, 28);
  p.cyl(M.steel, 0.028, 0.032, H - 0.12, 0, 0.07 + (H - 0.12) / 2, 0, 0, 0, 0, 16);
  p.add(M.steel, latheGeo('bistro-base', [[0, 0], [0.27, 0], [0.27, 0], [0.27, 0.014], [0.27, 0.014], [0.2, 0.035], [0.08, 0.065], [0.04, 0.085], [0.04, 0.085], [0, 0.085]], 40));
  p.cyl(M.brass, 0.034, 0.034, 0.02, 0, 0.09, 0, 0, 0, 0, 20);
  p.build(g);
  const tea = buildTeapotSet();
  tea.position.set(-0.14, H, -0.02);
  tea.rotation.y = 0.4;
  const succ = buildPlant(rng, { kind: 'succulent', pot: 'bowl', potR: 0.06, potH: 0.055, potMat: M.potTerracotta, scale: 0.8, count: 20 });
  succ.position.set(0.12, H, -0.24);
  g.add(tea, succ);
  return g;
}

/* ═══════════════════════════════ library ═══════════════════════════════ */

/** A small decorative object on a shelf, centred at x on the board at y0. */
function shelfDecor(rng, p, x, y0, w, clearH, zFront) {
  const z = zFront - 0.12;
  const type = rng.pick(['vase', 'vase', 'bowl', 'boxes', 'candle', 'frame']);
  if (type === 'vase') {
    const name = rng.pick(['bud', 'bottle', 'bulb']);
    const s = Math.min(1.25, (clearH - 0.03) / 0.21);
    p.add(rng.pick([M.potCream, M.potSage, M.potTeal, M.potMustard, M.potCharcoal]), latheGeo('vase-' + name, VASES[name], 22), trs(x, y0, z, 0, 0, 0, s, s, s));
  } else if (type === 'bowl') {
    p.add(M.brass, latheGeo('vase-bowl', VASES.bowl, 28), trs(x, y0, z, 0, 0, 0, 0.8, 0.8, 0.8));
    p.add(M.potCream, sphereGeo(0.03, 14, 10), trs(x + 0.015, y0 + 0.045, z - 0.01));
  } else if (type === 'boxes') {
    p.rbox(M.linen, Math.min(w, 0.17), 0.08, 0.2, 0.008, x, y0 + 0.04, zFront - 0.11);
    p.rbox(M.terracotta, Math.min(w, 0.17) - 0.03, 0.06, 0.17, 0.008, x, y0 + 0.11, zFront - 0.11, 0, 0.12, 0);
  } else if (type === 'candle') {
    p.add(M.brass, latheGeo('candlestick', [[0, 0], [0.035, 0], [0.035, 0], [0.035, 0.008], [0.012, 0.02], [0.009, 0.1], [0.016, 0.11], [0.016, 0.11], [0, 0.11]], 20), trs(x, y0, z));
    const ch = Math.min(0.12, clearH - 0.14);
    if (ch > 0.03) p.cyl(M.potCream, 0.01, 0.01, ch, x, y0 + 0.11 + ch / 2, z, 0, 0, 0, 12);
  } else {
    const fh = Math.min(0.22, clearH - 0.04), fw = fh * 0.78, lean = -0.12;
    const fz = zFront - 0.09;
    p.box(M.walnutDark, fw, fh, 0.018, x, y0 + (fh / 2) * Math.cos(lean), fz, lean);
    p.add(M.sketch, new THREE.PlaneGeometry(fw - 0.03, fh - 0.03), trs(x + 0.0, y0 + (fh / 2) * Math.cos(lean) - 0.0, fz + 0.0095, lean));
  }
}

/** Fills one shelf compartment with runs of books, stacks, leaning books, gaps and objects. */
function fillShelf(rng, books, deco, x0, x1, y0, clearH, zFront) {
  const maxH = Math.min(0.3, clearH - 0.018);
  let x = x0 + rng.range(0.004, 0.03);
  let lastH = 0;
  let decoLeft = rng() < 0.7 ? 1 : 0;
  while (x < x1 - 0.03) {
    const room = x1 - x, r = rng();
    if (r < 0.08 && room > 0.15) {
      x += rng.range(0.04, 0.12);
      lastH = 0;
    } else if (r < 0.2 && decoLeft > 0 && room > 0.22) {
      const w = rng.range(0.14, 0.19);
      shelfDecor(rng, deco, x + w / 2, y0, w, clearH, zFront);
      x += w + 0.02;
      decoLeft--;
      lastH = 0;
    } else if (r < 0.3 && room > 0.3) {
      const n = rng.int(2, 4), len = rng.range(0.2, 0.27);
      let yy = y0;
      for (let i = 0; i < n && yy < y0 + clearH - 0.07; i++) {
        const t = rng.range(0.022, 0.05), d = rng.range(0.15, 0.22);
        books.push({ m: shelfFlatBook(x + 0.004, yy, zFront - d / 2, t, len - rng.range(0, 0.035), d), c: bookColor(rng) });
        yy += t;
      }
      x += len + 0.02;
      lastH = 0;
    } else {
      const n = rng.int(3, 11), baseH = rng.range(0.18, maxH);
      for (let i = 0; i < n; i++) {
        const t = rng.range(0.025, 0.06);
        if (x + t > x1 - 0.003) break;
        const h = clamp(baseH + rng.range(-0.025, 0.025), 0.17, maxH), d = rng.range(0.16, 0.24);
        books.push({ m: bookMatrix(x + t / 2, y0, zFront - d / 2 - rng.range(0, 0.008), t, h, d), c: bookColor(rng) });
        x += t + rng.range(0, 0.002);
        lastH = h;
      }
      if (lastH > 0 && rng() < 0.35) {
        const a = rng.range(0.12, 0.32), t = rng.range(0.025, 0.045), d = rng.range(0.16, 0.22);
        const h = Math.min(maxH, rng.range(0.2, 0.28));
        const px = x + Math.min(h, lastH / Math.cos(a)) * 0.92 * Math.sin(a);
        if (h * Math.cos(a) + t * Math.sin(a) < clearH - 0.01 && px + t * Math.cos(a) < x1 - 0.005) {
          books.push({ m: leaningBookMatrix(px, y0, zFront - d / 2, t, h, d, a), c: bookColor(rng) });
          x = px + t * Math.cos(a) + rng.range(0.03, 0.09);
          lastH = 0;
        }
      }
    }
  }
}

/** Walnut bookcase 1.6 × 0.35 × 2.3 m, back at local z = -0.175, filled with books. */
function buildBookshelf(rng, { pothos = false } = {}) {
  const g = group('bookshelf');
  const p = new Parts(), deco = new Parts();
  const W = 1.6, D = 0.35, H = 2.3, sideT = 0.022, boardT = 0.022, backT = 0.012;
  const innerW = W - 2 * sideT, zBack = -D / 2 + backT, zFront = D / 2;
  for (const sx of [-1, 1]) p.box(M.walnut, sideT, H, D, sx * (W / 2 - sideT / 2), H / 2, 0);
  p.box(M.walnut, W + 0.024, 0.03, D + 0.012, 0, H - 0.015, 0.006);
  p.box(M.walnut, innerW, 0.075, D - 0.04, 0, 0.0375, -0.012);
  const levels = [0.075, 0.455, 0.835, 1.215, 1.595, 1.975];
  for (const y of levels) p.box(M.walnut, innerW, boardT, zFront - zBack, 0, y + boardT / 2, (zFront + zBack) / 2);
  p.box(M.walnutDark, innerW, H - 0.105, backT, 0, (H - 0.03 + 0.075) / 2, -D / 2 + backT / 2);
  const books = [];
  const tops = [...levels.slice(1), H - 0.03];
  levels.forEach((y, i) => fillShelf(rng, books, deco, -innerW / 2, innerW / 2, y + boardT, tops[i] - y - boardT, zFront - 0.012));
  // on top of the case
  let y = H;
  for (let i = 0; i < 3; i++) {
    const t = rng.range(0.03, 0.05), d = rng.range(0.22, 0.26);
    books.push({ m: flatBookMatrix(pothos ? -0.42 : 0.35, y, 0.0, t, rng.range(0.28, 0.32), d, rng.range(-0.08, 0.08)), c: bookColor(rng) });
    y += t;
  }
  if (pothos) {
    const plant = buildPlant(rng, { kind: 'trailing', pot: 'cylinder', potR: 0.075, potH: 0.11, potMat: M.potWhite, count: 6, scale: 1 });
    plant.position.set(0.4, H, 0.02);
    g.add(plant);
  } else {
    deco.add(M.potTeal, latheGeo('vase-bottle', VASES.bottle, 22), trs(-0.4, H, 0, 0, 0, 0, 1.2, 1.2, 1.2));
    deco.add(M.potCream, latheGeo('vase-bulb', VASES.bulb, 22), trs(-0.22, H, 0.02));
  }
  p.build(g);
  deco.build(g);
  g.add(...bookMeshes(books));
  return g;
}

/* ═══════════════════════════════ studio ═══════════════════════════════ */

/** A-frame easel (~1.9 m) holding a work-in-progress canvas facing local +Z. */
function buildEasel() {
  const g = group('easel');
  const frame = new THREE.Group();
  frame.rotation.x = -0.2; // leans back
  const fp = new Parts();
  const wood = M.oakPale;
  for (const sx of [-1, 1]) fp.beam(wood, [sx * 0.31, 0, 0], [sx * 0.045, 1.86, 0], 0.042, 0.026);
  fp.beam(wood, [0, 0.3, -0.03], [0, 1.95, -0.03], 0.045, 0.028);
  fp.box(wood, 0.56, 0.04, 0.022, 0, 0.36, 0);
  fp.box(wood, 0.86, 0.024, 0.1, 0, 0.8, 0.055);
  fp.box(wood, 0.86, 0.03, 0.012, 0, 0.827, 0.1);
  fp.box(wood, 0.08, 0.06, 0.05, 0, 1.62, -0.06);
  fp.box(wood, 0.14, 0.045, 0.1, 0, 1.835, 0.035);
  fp.cyl(M.brass, 0.012, 0.012, 0.02, 0, 1.835, 0.093, Math.PI / 2, 0, 0, 12);
  const cw = 0.8, ch = 1.0, cy = 0.812 + ch / 2, cz = 0.06;
  // stretcher bars (canvas-wrapped) behind the painted face
  fp.box(M.canvasRaw, cw, 0.04, 0.02, 0, cy + ch / 2 - 0.02, cz - 0.013);
  fp.box(M.canvasRaw, cw, 0.04, 0.02, 0, cy - ch / 2 + 0.02, cz - 0.013);
  for (const sx of [-1, 1]) fp.box(M.canvasRaw, 0.04, ch - 0.08, 0.02, sx * (cw / 2 - 0.02), cy, cz - 0.013);
  fp.box(wood, 0.035, ch - 0.08, 0.018, 0, cy, cz - 0.013);
  fp.build(frame);
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.006), [M.canvasRaw, M.canvasRaw, M.canvasRaw, M.canvasRaw, M.painting, M.canvasRaw]);
  canvas.name = 'easel-canvas';
  canvas.position.set(0, cy, cz);
  canvas.castShadow = canvas.receiveShadow = true;
  frame.add(canvas);
  g.add(frame);
  frame.updateMatrix();
  const hinge = v3(0, 1.62, -0.085).applyMatrix4(frame.matrix);
  const p = new Parts();
  p.beam(wood, [0, 0, -0.86], hinge, 0.04, 0.026);
  return p.build(g);
}

function buildWorkTable(rng) {
  const g = group('work-table');
  const p = new Parts();
  const H = 0.9, T = 0.05;
  p.rbox(M.oak, 2.0, T, 0.9, 0.01, 0, H - T / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(M.oak, 0.07, H - T, 0.07, sx * 0.9, (H - T) / 2, sz * 0.37);
  for (const sz of [-1, 1]) p.box(M.oak, 1.73, 0.09, 0.025, 0, H - T - 0.045, sz * 0.37);
  for (const sx of [-1, 1]) p.box(M.oak, 0.025, 0.09, 0.67, sx * 0.9, H - T - 0.045, 0);
  p.box(M.oak, 1.79, 0.022, 0.7, 0, 0.2, 0);
  const Y = H, shelfY = 0.211;

  // papers and a sketch
  p.box(M.paper, 0.42, 0.0016, 0.297, -0.45, Y + 0.0008, 0.13, 0, 0.18, 0);
  p.box(M.paper, 0.42, 0.0016, 0.297, -0.33, Y + 0.0024, 0.17, 0, -0.12, 0);
  const sketch = new THREE.Mesh(new THREE.BoxGeometry(0.297, 0.0016, 0.42), M.sketch);
  sketch.position.set(-0.12, Y + 0.004, 0.1);
  sketch.rotation.y = -0.25;
  sketch.receiveShadow = true;
  g.add(sketch);

  // palette with paint dabs
  const palGeo = cached('palette', () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * TAU;
      const notch = 0.055 * Math.exp(-(((t - Math.PI) / 0.32) ** 2));
      const px = Math.cos(t) * 0.19 + notch, py = Math.sin(t) * 0.135 * (1 + 0.12 * Math.cos(t));
      if (i) s.lineTo(px, py);
      else s.moveTo(px, py);
    }
    const hole = new THREE.Path();
    hole.absarc(-0.105, 0.045, 0.019, 0, TAU, true);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2);
  });
  const palette = group('palette');
  const pal = new THREE.Mesh(palGeo, M.oakPale);
  pal.castShadow = pal.receiveShadow = true;
  palette.add(pal);
  const dabs = new Instances();
  for (let i = 0; i < 9; i++) {
    const t = -2.0 + (i / 8) * 4.0, r = rng.range(0.012, 0.02);
    dabs.push(trs(Math.cos(t) * 0.14, 0.006 + r * 0.25, -Math.sin(t) * 0.095, 0, rng() * TAU, 0, r, r * 0.4, r * 0.85), new THREE.Color(PAINTS[i % PAINTS.length]));
  }
  for (let i = 0; i < 3; i++) dabs.push(trs(rng.range(0, 0.06), 0.0065, rng.range(-0.04, 0.03), 0, rng() * TAU, 0, 0.035, 0.0015, 0.02), new THREE.Color(rng.pick(PAINTS)).lerp(new THREE.Color('#ffffff'), 0.3));
  palette.add(dabs.mesh(sphereGeo(1, 12, 8), M.paint));
  palette.position.set(0.32, Y, 0.08);
  palette.rotation.y = 0.5;
  g.add(palette);

  // paint tubes (+ caps)
  const tubeGeo = cached('paint-tube', () =>
    mergeGeos([
      new THREE.CylinderGeometry(0.0125, 0.0125, 0.085, 14).rotateZ(Math.PI / 2).translate(0, 0.0125, 0),
      new THREE.CylinderGeometry(0.007, 0.0125, 0.012, 14).rotateZ(Math.PI / 2).translate(-0.0485, 0.0125, 0),
      new THREE.BoxGeometry(0.014, 0.004, 0.026).translate(0.049, 0.0125, 0),
    ]));
  const capGeo = cached('paint-cap', () => new THREE.CylinderGeometry(0.0068, 0.0068, 0.016, 12).rotateZ(Math.PI / 2).translate(-0.0625, 0.0125, 0));
  const tubes = new Instances(), caps = new Instances();
  for (const [x, z] of [[0.04, 0.3], [0.2, 0.36], [0.62, 0.34], [0.72, 0.18], [0.14, -0.14], [0.36, -0.2], [0.6, -0.16]]) {
    const m = trs(x, Y, z, 0, rng() * TAU, 0);
    tubes.push(m, new THREE.Color(rng.pick(PAINTS)));
    caps.push(m, new THREE.Color(rng() < 0.5 ? '#1e1e1e' : '#f2f2f2'));
  }
  g.add(tubes.mesh(tubeGeo, M.tube), caps.mesh(capGeo, M.plastic));

  // jars of brushes
  const handles = new Instances(), ferrules = new Instances(), tips = new Instances();
  const handleCols = ['#c89b62', '#a8322d', '#222222', '#d4a03a', '#3d6b35', '#2f4f7a', '#e8e4dc'];
  const bristleCols = ['#c8a878', '#3a2f2a', '#c4673f', '#2f5d62', '#d4a03a', '#e8e4dc'];
  const addBrushes = (cx, cz, baseY, jarR, rimH, n) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, rr = rng() * jarR * 0.55;
      const base = v3(cx + Math.cos(a) * rr, baseY, cz + Math.sin(a) * rr);
      const tilt = Math.atan((rr + jarR * 0.8) / rimH) * rng.range(0.55, 0.95), az = a + Math.PI + rng.range(-0.35, 0.35);
      const dir = v3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
      const len = rng.range(0.17, 0.27);
      handles.push(alignScaled(base, dir, 1, len, 1), new THREE.Color(rng.pick(handleCols)));
      const f = base.clone().addScaledVector(dir, len);
      ferrules.push(alignScaled(f, dir));
      const s = rng.range(0.8, 1.3);
      tips.push(alignScaled(f.addScaledVector(dir, 0.024), dir, s, s, s), new THREE.Color(rng.pick(bristleCols)));
    }
  };
  // tin can with a label
  p.add(M.tin, cylGeo(0.045, 0.045, 0.12, 20, true), trs(-0.52, Y + 0.06, -0.27));
  p.cyl(M.tin, 0.045, 0.045, 0.004, -0.52, Y + 0.002, -0.27, 0, 0, 0, 20);
  p.add(M.paper, cylGeo(0.0458, 0.0458, 0.06, 20, true), trs(-0.52, Y + 0.055, -0.27));
  addBrushes(-0.52, -0.27, Y + 0.004, 0.045, 0.12, 7);
  // glass jar with murky water
  const glassP = new Parts();
  glassP.add(M.glass, cylGeo(0.042, 0.04, 0.13, 20, true), trs(-0.3, Y + 0.065, -0.3));
  glassP.add(M.glass, cylGeo(0.04, 0.04, 0.004, 20), trs(-0.3, Y + 0.002, -0.3));
  glassP.add(M.water, cylGeo(0.038, 0.037, 0.07, 20), trs(-0.3, Y + 0.039, -0.3));
  glassP.build(g, { cast: false });
  addBrushes(-0.3, -0.3, Y + 0.004, 0.04, 0.13, 5);
  // mustard mug
  p.add(M.potMustard, latheGeo('mug', [[0, 0], [0.038, 0], [0.038, 0], [0.04, 0.004], [0.04, 0.095], [0.04, 0.095], [0.035, 0.095], [0.035, 0.095], [0.034, 0.01]], 22), trs(-0.08, Y, -0.25));
  p.add(M.potMustard, torusGeo(0.025, 0.006, 8, 16, Math.PI), trs(-0.08 + 0.04, Y + 0.05, -0.25, 0, 0, -Math.PI / 2));
  addBrushes(-0.08, -0.25, Y + 0.01, 0.034, 0.085, 4);
  const handleGeo = cached('brush-handle', () => new THREE.CylinderGeometry(0.0032, 0.0052, 1, 8).translate(0, 0.5, 0));
  const ferruleGeo = cached('brush-ferrule', () => new THREE.CylinderGeometry(0.0048, 0.004, 0.026, 10).translate(0, 0.013, 0));
  const tipGeo = cached('brush-tip', () => new THREE.CylinderGeometry(0.0008, 0.0046, 0.022, 8).translate(0, 0.011, 0));
  g.add(handles.mesh(handleGeo, M.plastic), ferrules.mesh(ferruleGeo, M.chrome), tips.mesh(tipGeo, M.paint));

  // crumpled rag
  const ragGeo = cached('rag', () => {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 0.75 + 0.5 * hash3(x, y, z);
      pos.setXYZ(i, x * n * 0.085, (Math.max(y, -0.25) * n + 0.25) * 0.035, z * n * 0.065);
    }
    geo.computeVertexNormals();
    return geo;
  });
  p.add(M.rag, ragGeo, trs(0.8, Y, -0.08, 0, 0.6, 0));

  // architect's lamp clamped at the back-left corner
  const lx = -0.86, lz = -0.38;
  p.box(M.steel, 0.05, 0.05, 0.06, lx, Y + 0.025, lz);
  p.cyl(M.steel, 0.012, 0.012, 0.06, lx, Y + 0.08, lz, 0, 0, 0, 12);
  const j1 = v3(lx, Y + 0.1, lz), j2 = v3(lx + 0.1, Y + 0.47, lz + 0.06), j3 = v3(lx + 0.36, Y + 0.42, lz + 0.2);
  p.leg(M.brass, j1, j2, 0.006, 0.006, 8);
  p.leg(M.brass, j2, j3, 0.0055, 0.0055, 8);
  p.add(M.brass, sphereGeo(0.012, 12, 8), trs(j2.x, j2.y, j2.z));
  const hdir = v3(0.15, -1, 0.25).normalize();
  const mouth = j3.clone().addScaledVector(hdir, 0.11);
  p.add(M.steelDS, cylGeo(0.028, 0.07, 0.11, 20, true), alignMatrix(mouth, j3));
  const glowP = new Parts();
  glowP.add(M.shadeInner, cylGeo(0.026, 0.067, 0.105, 20, true), alignMatrix(mouth, j3));
  glowP.add(M.bulb, sphereGeo(0.026, 14, 10), trs(...j3.clone().addScaledVector(hdir, 0.05).toArray()));
  glowP.build(g, { cast: false, glow: true });

  // lower shelf: sketchbooks and a crate of rolled paper
  const sb = [];
  let sy = shelfY;
  for (const [t, h, d, col] of [[0.022, 0.42, 0.3, COLORS.charcoal], [0.018, 0.36, 0.26, '#7a4e3a'], [0.015, 0.3, 0.22, COLORS.sage]]) {
    sb.push({ m: flatBookMatrix(-0.5, sy, 0.0, t, h, d, rng.range(-0.1, 0.1)), c: new THREE.Color(col) });
    sy += t;
  }
  g.add(...bookMeshes(sb));
  const cx = 0.45;
  p.box(M.oakPale, 0.4, 0.012, 0.3, cx, shelfY + 0.006, 0);
  for (const sz of [-1, 1]) p.box(M.oakPale, 0.4, 0.18, 0.012, cx, shelfY + 0.09, sz * 0.144);
  for (const sx of [-1, 1]) p.box(M.oakPale, 0.012, 0.18, 0.276, cx + sx * 0.194, shelfY + 0.09, 0);
  for (const [dx, dz, r, len, tx, tz] of [[-0.08, -0.05, 0.03, 0.55, 0.25, 0.1], [0.05, 0.04, 0.025, 0.5, -0.2, 0.15], [0.1, -0.06, 0.035, 0.46, -0.1, -0.22]]) {
    const b = v3(cx + dx, shelfY + 0.015 + r, dz);
    p.leg(M.paper, b, b.clone().add(v3(Math.sin(tx) * len, Math.cos(tx) * Math.cos(tz) * len, Math.sin(tz) * len)), r, r, 16);
  }
  return p.build(g);
}

/* ═══════════════════════════════ garden ═══════════════════════════════ */

function buildPotCluster() {
  const rng = rngFor('garden-pot-cluster');
  const g = group('plant-cluster');
  const pilea = buildPlant(rng, { kind: 'pilea', pot: 'taper', potR: 0.13, potH: 0.2, potMat: M.potTerracotta, scale: 1.1 });
  pilea.position.set(0, 0, 0.33);
  const succ = buildPlant(rng, { kind: 'succulent', pot: 'bowl', potR: 0.1, potH: 0.08, potMat: M.potWhite, scale: 1.3, count: 26, stand: 0.26 });
  succ.position.set(0.05, 0, -0.02);
  const cactus = buildPlant(rng, { kind: 'cactus', pot: 'cylinder', potR: 0.085, potH: 0.15, potMat: M.potSage, scale: 1 });
  cactus.position.set(-0.02, 0, -0.36);
  g.add(pilea, succ, cactus);
  return g;
}

/* ═══════════════════════════════ assembly ═══════════════════════════════ */

/** Yaw that turns a piece's front (+Z) towards (tx, tz) from (x, z). */
const faceTowards = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

/**
 * World-space AABB of a placed piece. Regular meshes use Box3.setFromObject(mesh, true)
 * (vertex-precise); instanced meshes (leaves, books…) are expanded per instance, because
 * three's default instanced bounds are a conservative box-of-boxes that would inflate
 * colliders of rotated plants.
 */
function pieceBounds(piece) {
  piece.updateMatrixWorld(true);
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  const v = new THREE.Vector3(), im = new THREE.Matrix4(), m = new THREE.Matrix4();
  piece.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        m.multiplyMatrices(o.matrixWorld, im);
        for (let k = 0; k < pos.count; k++) box.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(m));
      }
    } else {
      box.union(tmp.makeEmpty().expandByObject(o, true));
    }
  });
  return box;
}

/**
 * Builds all furniture, rugs and plants.
 * @returns {{ group: THREE.Group, colliders: Array<{minX:number,maxX:number,minZ:number,maxZ:number}> }}
 */
export function buildFurniture() {
  GEO = new Map();
  TEX = makeTextures();
  M = makeMaterials();
  const root = group('furniture');
  const colliders = [];

  const place = (piece, x, z, rotY = 0, { collide = true, name } = {}) => {
    if (name) piece.name = name;
    piece.position.set(x, piece.position.y, z);
    piece.rotation.y = rotY;
    root.add(piece);
    piece.updateMatrixWorld(true);
    if (collide) {
      const b = pieceBounds(piece);
      const s = 0.03;
      colliders.push({ minX: b.min.x + s, maxX: b.max.x - s, minZ: b.min.z + s, maxZ: b.max.z - s });
    }
    return piece;
  };
  const plant = (name, x, z, opts) => place(buildPlant(rngFor(name), { name, ...opts }), x, z, rngFor(name + '-yaw')() * TAU);

  // ── Living Room ────────────────────────────────────────────────────────
  place(buildKilim(), -6.5, -2.6, 0, { collide: false, name: 'living-rug' });
  place(buildSofa(), -6.5, -0.75, Math.PI, { name: 'living-sofa' });
  place(buildCoffeeTable(rngFor('coffee-table')), -6.5, -2.4, 0, { name: 'living-coffee-table' });
  place(buildArmchair(M.mustard), -8.7, -3.0, Math.PI / 2, { name: 'living-armchair-west' });
  place(buildArmchair(M.mustard), -4.4, -3.0, -Math.PI / 2, { name: 'living-armchair-east' });
  place(buildFloorLamp({ tripod: true }), -9.4, -0.6, 0.3, { name: 'living-floor-lamp' });
  plant('living-fiddle-fig', -3.6, -0.6, { kind: 'fiddle', pot: 'cylinder', potR: 0.19, potH: 0.36, potMat: M.potWhite, height: 1.9, spread: 0.38, leafSize: 0.28 });

  // ── Entrance Hall ──────────────────────────────────────────────────────
  place(buildRug('hall-runner', 1.3, 4.0, M.rugRunner), 0, -2.9, 0, { collide: false });
  for (const sx of [-1, 1]) {
    plant(`hall-olive-${sx < 0 ? 'west' : 'east'}`, sx * 1.75, -0.55, { kind: 'olive', pot: 'cylinder', potR: 0.19, potH: 0.5, potMat: M.potCharcoal, soilMat: M.moss, height: 2.0, crown: 0.27, spread: 0.33 });
  }

  // ── Studio ─────────────────────────────────────────────────────────────
  place(buildRug('studio-drop-cloth', 2.4, 2.0, M.dropCloth), 7.6, -2.2, 0.05, { collide: false });
  place(buildEasel(), 7.6, -2.1, faceTowards(7.6, -2.1, 3, -4.4), { name: 'studio-easel' });
  place(buildWorkTable(rngFor('work-table')), 6.0, -4.7, 0, { name: 'studio-work-table' });
  place(buildStool(), 6.0, -3.85, 0.2, { name: 'studio-stool' });
  plant('studio-snake-plant', 9.4, -0.6, { kind: 'snake', pot: 'taper', potR: 0.16, potH: 0.28, potMat: M.potTerracotta, stand: 0.22, count: 14, spread: 0.36 });

  // ── The Long Gallery ───────────────────────────────────────────────────
  place(buildGalleryBench(), -2.8, -8.0, 0, { name: 'gallery-bench-west' });
  place(buildGalleryBench(), 2.8, -8.0, 0, { name: 'gallery-bench-east' });

  // ── Library ────────────────────────────────────────────────────────────
  place(buildBookshelf(rngFor('bookshelf-north'), { pothos: true }), -9.85 + 0.175, -11.1, Math.PI / 2, { name: 'library-bookshelf-north' });
  place(buildBookshelf(rngFor('bookshelf-south')), -9.85 + 0.175, -14.9, Math.PI / 2, { name: 'library-bookshelf-south' });
  place(buildRug('library-rug', 3.2, 2.4, M.rugLibrary), -6.0, -13.0, 0, { collide: false });
  const tilt = THREE.MathUtils.degToRad(25);
  place(buildArmchair(M.terracotta, { wings: true, backH: 0.7 }), -7.3, -13.2, tilt, { name: 'library-chair-west' });
  place(buildArmchair(M.terracotta, { wings: true, backH: 0.7 }), -4.7, -13.2, -tilt, { name: 'library-chair-east' });
  place(buildSideTable(), -6.0, -13.7, 0, { name: 'library-side-table' });
  place(buildFloorLamp({ tripod: false }), -8.9, -15.3, 0, { name: 'library-floor-lamp' });

  // ── Garden Room ────────────────────────────────────────────────────────
  place(buildBistroTable(rngFor('bistro-table')), 4.5, -13.2, 0.3, { name: 'garden-bistro-table' });
  place(buildBistroChair(), 3.75, -13.2, Math.PI / 2, { name: 'garden-chair-west' });
  place(buildBistroChair(), 5.25, -13.2, -Math.PI / 2, { name: 'garden-chair-east' });
  plant('garden-monstera', 3.0, -15.25, { kind: 'monstera', pot: 'taper', potR: 0.22, potH: 0.36, potMat: M.potTerracotta, scale: 1.1, count: 10, spread: 0.46 });
  plant('garden-palm', 6.0, -15.25, { kind: 'palm', pot: 'belly', potR: 0.23, potH: 0.4, potMat: M.potWhite, scale: 1.0, spread: 0.5 });
  plant('garden-fiddle-fig', 9.3, -10.9, { kind: 'fiddle', pot: 'cylinder', potR: 0.18, potH: 0.34, potMat: M.potSage, height: 1.75, spread: 0.44, leafSize: 0.26 });
  plant('garden-bird-of-paradise', 9.3, -15.2, { kind: 'bird', pot: 'cylinder', potR: 0.2, potH: 0.4, potMat: M.potCharcoal, scale: 1.0, spread: 0.4 });
  place(buildPotCluster(), 9.35, -13.0, 0, { name: 'garden-pot-cluster' });
  place(buildLoungeChair(), 0.2, -11.0, faceTowards(0.2, -11.0, 4.5, -16), { name: 'garden-lounge-chair' });

  // Static from here on: bake matrices once.
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o !== root) o.matrixAutoUpdate = false;
  });
  GEO = null;
  return { group: root, colliders };
}
