import * as THREE from 'three';

// Procedural canvas textures, so the house needs no external image assets.
// Every texture is seamless; `repeat` is set so that UVs measured in metres map to the
// intended real-world size (see GeometryBucket, which emits UVs in metres).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let maxAnisotropy = 8;
export function setMaxAnisotropy(n) {
  maxAnisotropy = n;
}

function finish(canvas, { worldW = 1, worldH = worldW, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / worldW, 1 / worldH);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  return t;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c, a = 1) => `rgba(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])},${a})`;
function vary(c, rng, amount) {
  const k = 1 + (rng() * 2 - 1) * amount;
  const tint = (rng() * 2 - 1) * amount * 30;
  return [c[0] * k + tint, c[1] * k + tint * 0.6, c[2] * k];
}

/** Draws fn at (x, y) and at wrapped positions when within `r` px of an edge (for seamless tiles). */
function wrapDraw(w, h, x, y, r, fn) {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + w);
  if (x > w - r) xs.push(x - w);
  if (y < r) ys.push(y + h);
  if (y > h - r) ys.push(y - h);
  for (const xx of xs) for (const yy of ys) fn(xx, yy);
}

/** Fine speckle grain over the whole canvas. */
function grain(ctx, w, h, rng, count, alpha = 0.05) {
  for (let i = 0; i < count; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rng()})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// Wood grain inside a rectangle; `vertical` = grain runs along y.
function woodGrain(ctx, rng, x, y, w, h, vertical, intensity = 1) {
  const len = vertical ? h : w;
  const across = vertical ? w : h;
  const lines = Math.max(6, Math.round(across / 2.2));
  for (let i = 0; i < lines; i++) {
    const off = rng() * across;
    const amp = 0.6 + rng() * 2.5;
    const freq = 0.004 + rng() * 0.02;
    const ph = rng() * 6.28;
    const dark = rng() < 0.75;
    ctx.strokeStyle = dark
      ? `rgba(55,32,16,${(0.04 + rng() * 0.1) * intensity})`
      : `rgba(255,235,200,${(0.03 + rng() * 0.06) * intensity})`;
    ctx.lineWidth = 0.5 + rng() * 1.4;
    ctx.beginPath();
    for (let t = 0; t <= len + 8; t += 8) {
      const d = off + Math.sin(t * freq + ph) * amp + Math.sin(t * freq * 3.1 + ph * 2) * amp * 0.3;
      if (vertical) (t === 0 ? ctx.moveTo(x + d, y + t) : ctx.lineTo(x + d, y + t));
      else (t === 0 ? ctx.moveTo(x + t, y + d) : ctx.lineTo(x + t, y + d));
    }
    ctx.stroke();
  }
}

function drawKnot(ctx, rng, cx, cy, r) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(60,35,18,0.55)');
  g.addColorStop(0.5, 'rgba(80,50,25,0.25)');
  g.addColorStop(1, 'rgba(80,50,25,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.6, r * (1.3 + rng()), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Straight-laid floorboards with staggered joints. */
export function woodPlanksTexture({
  seed = 1,
  base = [176, 129, 84],
  plankW = 0.19,
  worldSize = 2.28,
  size = 1024,
  minLen = 0.9,
  maxLen = 2.0,
  variance = 0.1,
  grainIntensity = 1,
  gapAlpha = 0.5,
} = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const n = Math.max(1, Math.round(worldSize / plankW));
  const pw = size / n;
  const pxPerM = size / worldSize;
  for (let i = 0; i < n; i++) {
    const x = i * pw;
    // cyclic joints so the column tiles vertically
    const joints = [];
    let y = rng() * size;
    const start = y;
    while (joints.length === 0 || y - start < size - minLen * pxPerM) {
      joints.push(y % size);
      y += (minLen + rng() * (maxLen - minLen)) * pxPerM;
    }
    joints.sort((a, b) => a - b);
    for (let j = 0; j < joints.length; j++) {
      const y0 = joints[j];
      const y1 = j + 1 < joints.length ? joints[j + 1] : joints[0] + size;
      const segSeed = Math.floor(rng() * 1e9);
      for (const shift of [0, -size]) {
        if (y0 + shift > size || y1 + shift < 0) continue;
        const r2 = mulberry32(segSeed);
        const col = vary(base, r2, variance);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y0 + shift, pw, y1 - y0);
        ctx.clip();
        ctx.fillStyle = rgb(col);
        ctx.fillRect(x, y0 + shift, pw, y1 - y0);
        // broad soft streaks
        for (let s = 0; s < 3; s++) {
          ctx.fillStyle = r2() < 0.5 ? 'rgba(255,240,215,0.06)' : 'rgba(60,35,15,0.06)';
          ctx.fillRect(x + r2() * pw, y0 + shift, pw * (0.2 + r2() * 0.4), y1 - y0);
        }
        woodGrain(ctx, r2, x, y0 + shift, pw, y1 - y0, true, grainIntensity);
        if (r2() < 0.25) drawKnot(ctx, r2, x + pw * (0.25 + r2() * 0.5), y0 + shift + (y1 - y0) * r2(), 4 + r2() * 6);
        // end joint
        ctx.fillStyle = `rgba(35,20,10,${gapAlpha})`;
        ctx.fillRect(x, y0 + shift, pw, 1.5);
        ctx.restore();
      }
    }
    // long edge gap + subtle bevel highlight
    ctx.fillStyle = `rgba(35,20,10,${gapAlpha})`;
    ctx.fillRect(x, 0, 1.5, size);
    ctx.fillStyle = 'rgba(255,240,220,0.08)';
    ctx.fillRect(x + 1.5, 0, 1, size);
  }
  grain(ctx, size, size, rng, 6000, 0.05);
  return finish(c, { worldW: worldSize, worldH: worldSize });
}

/** Classic herringbone parquet (blocks L × W, L a multiple of W). */
export function herringboneTexture({ seed = 2, base = [170, 120, 75], L = 0.6, W = 0.12, size = 1024, variance = 0.12 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const world = 2 * L; // the pattern repeats every 2L in both x and y
  const s = size / world;
  const n = Math.round(L / W);
  const blocks = [];
  for (let k = 0; k < 2 * n; k++) {
    blocks.push({ x: k * W, y: k * W, w: L, h: W, vertical: false });
    blocks.push({ x: L + k * W, y: W - L + k * W, w: W, h: L, vertical: true });
  }
  for (const b of blocks) {
    const col = vary(base, rng, variance);
    const seedB = Math.floor(rng() * 1e9);
    const bx = (((b.x % world) + world) % world) * s;
    const by = (((b.y % world) + world) % world) * s;
    for (const ox of [0, -size]) {
      for (const oy of [0, -size]) {
        const x = bx + ox;
        const y = by + oy;
        const w = b.w * s;
        const h = b.h * s;
        if (x > size || y > size || x + w < 0 || y + h < 0) continue;
        const r2 = mulberry32(seedB);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = rgb(col);
        ctx.fillRect(x, y, w, h);
        woodGrain(ctx, r2, x, y, w, h, b.vertical, 0.9);
        ctx.strokeStyle = 'rgba(40,24,12,0.55)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.restore();
      }
    }
  }
  grain(ctx, size, size, rng, 5000, 0.05);
  return finish(c, { worldW: world, worldH: world });
}

/** Checkerboard of marble-ish tiles for the entrance hall. */
export function checkerTilesTexture({
  seed = 3,
  a = [234, 229, 219],
  b = [66, 76, 72],
  tile = 0.5,
  tiles = 4,
  size = 1024,
} = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const tp = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const dark = (i + j) % 2 === 1;
      const col = vary(dark ? b : a, rng, 0.05);
      const x = i * tp;
      const y = j * tp;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, tp, tp);
      ctx.clip();
      ctx.fillStyle = rgb(col);
      ctx.fillRect(x, y, tp, tp);
      // soft clouds
      for (let k = 0; k < 6; k++) {
        const cx = x + rng() * tp;
        const cy = y + rng() * tp;
        const r = tp * (0.2 + rng() * 0.5);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const tone = dark ? 'rgba(255,255,255,0.05)' : 'rgba(120,110,95,0.06)';
        g.addColorStop(0, tone);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, tp, tp);
      }
      // veins
      const veins = 2 + Math.floor(rng() * 3);
      for (let v = 0; v < veins; v++) {
        ctx.strokeStyle = dark ? `rgba(255,255,255,${0.06 + rng() * 0.08})` : `rgba(110,100,90,${0.08 + rng() * 0.12})`;
        ctx.lineWidth = 0.6 + rng() * 1.4;
        ctx.beginPath();
        let px = x + rng() * tp;
        let py = y;
        ctx.moveTo(px, py);
        const dir = rng() * 0.8 - 0.4;
        while (py < y + tp) {
          px += (rng() - 0.5 + dir) * 14;
          py += 6 + rng() * 10;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
      // grout + bevel
      ctx.fillStyle = 'rgba(150,140,128,0.9)';
      ctx.fillRect(x, y, tp, 2);
      ctx.fillRect(x, y, 2, tp);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 2, y + 2, tp - 2, 1);
    }
  }
  grain(ctx, size, size, rng, 4000, 0.04);
  return finish(c, { worldW: tile * tiles, worldH: tile * tiles });
}

/** Hand-made terracotta tiles for the garden room. */
export function terracottaTexture({ seed = 4, tile = 0.33, tiles = 6, size = 1024 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const tp = size / tiles;
  ctx.fillStyle = 'rgb(196,184,166)';
  ctx.fillRect(0, 0, size, size);
  const grout = 4;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const x = i * tp + grout / 2;
      const y = j * tp + grout / 2;
      const w = tp - grout;
      const col = vary([188, 102, 66], rng, 0.12);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, w, 3);
      ctx.clip();
      ctx.fillStyle = rgb(col);
      ctx.fillRect(x, y, w, w);
      for (let k = 0; k < 8; k++) {
        const cx = x + rng() * w;
        const cy = y + rng() * w;
        const r = w * (0.15 + rng() * 0.45);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rng() < 0.5 ? 'rgba(90,40,20,0.12)' : 'rgba(255,200,150,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, w);
      }
      // worn edges
      const eg = ctx.createLinearGradient(x, y, x + w, y + w);
      eg.addColorStop(0, 'rgba(255,220,180,0.08)');
      eg.addColorStop(1, 'rgba(60,25,10,0.12)');
      ctx.fillStyle = eg;
      ctx.fillRect(x, y, w, w);
      ctx.restore();
    }
  }
  grain(ctx, size, size, rng, 9000, 0.07);
  return finish(c, { worldW: tile * tiles, worldH: tile * tiles });
}

/** Lime-washed brick in running bond for the exterior walls. */
export function brickTexture({ seed = 5, size = 1024 } = {}) {
  const rng = mulberry32(seed);
  const unitW = 0.225; // brick + mortar
  const course = 0.075;
  const cols = 6;
  const rows = 12;
  const worldW = unitW * cols;
  const worldH = course * rows;
  const pxPerM = size / worldW;
  const h = Math.round(worldH * pxPerM);
  const c = makeCanvas(size, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(176,170,160)';
  ctx.fillRect(0, 0, size, h);
  const bw = unitW * pxPerM;
  const ch = course * pxPerM;
  const mortar = 0.012 * pxPerM;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? bw / 2 : 0;
    for (let k = -1; k < cols + 1; k++) {
      const x = k * bw + offset;
      const y = r * ch;
      const col = vary([226, 223, 216], rng, 0.05);
      const worn = rng() < 0.12;
      const seedB = Math.floor(rng() * 1e9);
      for (const ox of [0, -size, size]) {
        const xx = x + ox + mortar / 2;
        if (xx > size || xx + bw < 0) continue;
        const r2 = mulberry32(seedB);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(xx, y + mortar / 2, bw - mortar, ch - mortar, 2);
        ctx.clip();
        ctx.fillStyle = rgb(col);
        ctx.fillRect(xx, y, bw, ch);
        if (worn) {
          // patches where the limewash has worn away to the brick beneath
          for (let p = 0; p < 3; p++) {
            ctx.fillStyle = `rgba(170,95,70,${0.12 + r2() * 0.18})`;
            ctx.beginPath();
            ctx.ellipse(xx + r2() * bw, y + r2() * ch, 4 + r2() * 14, 2 + r2() * 6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const g = ctx.createLinearGradient(0, y, 0, y + ch);
        g.addColorStop(0, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(80,70,60,0.1)');
        ctx.fillStyle = g;
        ctx.fillRect(xx, y, bw, ch);
        ctx.restore();
      }
    }
  }
  grain(ctx, size, h, rng, 9000, 0.06);
  return finish(c, { worldW, worldH });
}

/** Slate roof tiles. Rows run along u; the downhill overlap edge is at the bottom of each slate. */
export function slateTexture({ seed = 6, size = 1024 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const cols = 6;
  const rows = 8;
  const sw = size / cols;
  const sh = size / rows;
  ctx.fillStyle = 'rgb(38,41,45)';
  ctx.fillRect(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? sw / 2 : 0;
    for (let k = -1; k <= cols; k++) {
      const col = vary([78, 84, 92], rng, 0.12);
      const x = k * sw + offset;
      const y = r * sh;
      ctx.fillStyle = rgb(col);
      ctx.fillRect(x + 1.5, y, sw - 3, sh - 2);
      const g = ctx.createLinearGradient(0, y, 0, y + sh);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.25, 'rgba(0,0,0,0)');
      g.addColorStop(0.85, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1.5, y, sw - 3, sh - 2);
      for (let s = 0; s < 4; s++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.02 + rng() * 0.04})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const yy = y + rng() * sh;
        ctx.moveTo(x + 4, yy);
        ctx.lineTo(x + sw - 4, yy + (rng() - 0.5) * 6);
        ctx.stroke();
      }
    }
  }
  grain(ctx, size, size, rng, 8000, 0.08);
  return finish(c, { worldW: 1.8, worldH: 1.8 });
}

/** Lawn seen from above: dense speckles of blades in varied greens. */
export function grassTexture({ seed = 7, size = 512 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(84,118,58)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 20 + rng() * 70;
    wrapDraw(size, size, x, y, r, (xx, yy) => {
      const g = ctx.createRadialGradient(xx, yy, 0, xx, yy, r);
      g.addColorStop(0, rng() < 0.5 ? 'rgba(130,160,70,0.18)' : 'rgba(40,70,30,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(xx - r, yy - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 14000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const hue = 75 + rng() * 40;
    const light = 22 + rng() * 26;
    ctx.strokeStyle = `hsla(${hue},${35 + rng() * 25}%,${light}%,${0.5 + rng() * 0.5})`;
    ctx.lineWidth = 1 + rng();
    const len = 2 + rng() * 5;
    const ang = -Math.PI / 2 + (rng() - 0.5) * 1.2;
    wrapDraw(size, size, x, y, 8, (xx, yy) => {
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + Math.cos(ang) * len, yy + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  return finish(c, { worldW: 2.5, worldH: 2.5 });
}

/** Pale gravel for the garden path. */
export function gravelTexture({ seed = 8, size = 512 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(176,166,148)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 1 + rng() * 3.2;
    const l = 45 + rng() * 40;
    const col = `hsl(${30 + rng() * 20},${8 + rng() * 14}%,${l}%)`;
    wrapDraw(size, size, x, y, r + 1, (xx, yy) => {
      ctx.fillStyle = 'rgba(40,30,20,0.25)';
      ctx.beginPath();
      ctx.ellipse(xx + 0.8, yy + 0.8, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(xx, yy, r, r * 0.8, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return finish(c, { worldW: 1.5, worldH: 1.5 });
}

/** Clipped hedge foliage. */
export function hedgeTexture({ seed = 9, size = 512 } = {}) {
  const rng = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(34,58,30)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 7000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 5;
    const col = `hsl(${85 + rng() * 35},${30 + rng() * 25}%,${18 + rng() * 26}%)`;
    const ang = rng() * Math.PI;
    wrapDraw(size, size, x, y, r + 1, (xx, yy) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(xx, yy, r, r * 0.55, ang, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return finish(c, { worldW: 1.6, worldH: 1.6 });
}

/** Radial glow used for the wash of light that picture lights throw onto the wall. */
export function washTexture() {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size * 0.3, 0, size / 2, size * 0.42, size * 0.55);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Soft rounded rectangle (black → transparent) for contact / drop shadows.
 * Built from stacked translucent layers rather than ctx.filter, which Safari lacks.
 * `inset` is the fraction of the texture (per side) over which the edge fades out.
 */
export function softShadowTexture({ inset = 0.24 } = {}) {
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const steps = 40;
  const outer = size * 0.01;
  const inner = size * inset;
  ctx.fillStyle = `rgba(0,0,0,${2.4 / steps})`;
  for (let s = 0; s < steps; s++) {
    const i = outer + (inner - outer) * (s / (steps - 1));
    ctx.beginPath();
    ctx.roundRect(i, i, size - i * 2, size - i * 2, Math.max(2, (size / 2 - i) * 0.25));
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

/**
 * Renders lines of text to a transparent canvas texture.
 * lines: [{ text, size (px), weight, family, color, letterSpacing (px), y (0..1) }]
 */
export function textTexture(lines, { width = 2048, height = 512, background = null } = {}) {
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.font = `${l.weight || 400} ${l.size}px ${l.family || 'Georgia, serif'}`;
    ctx.fillStyle = l.color || '#222';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${l.letterSpacing || 0}px`;
    ctx.fillText(l.text, width / 2, height * (l.y ?? 0.5));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  return t;
}
