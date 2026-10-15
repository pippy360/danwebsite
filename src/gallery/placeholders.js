/**
 * Placeholder paintings for the gallery.
 *
 * Until real artworks are added (drop images into public/art/ and run `npm run art`), the house
 * hangs this deterministic collection of procedurally painted canvases so the walls don't look
 * empty. Every work is marked as a placeholder via its caption and `placeholder: true`.
 *
 * Eight generative styles — layered landscape, mid-century composition, colour field, flow-field
 * drawing, botanical cut-outs, concentric arches, still life and hand-made tiles — are painted with
 * a dozen curated palettes, then finished with canvas weave / paper tooth, mottled paint density,
 * brush streaks and grain so they read as paintings rather than flat vector art. Everything is
 * driven by a seeded PRNG, so the collection is identical on every load.
 *
 *   import { createPlaceholderWorks } from './gallery/placeholders.js';
 *   const works = createPlaceholderWorks();            // 30 works
 *   const texture = new THREE.CanvasTexture(works[0].canvas);
 */

const LONG_SIDE = 768;
const TAU = Math.PI * 2;
const CAPTION = "Placeholder artwork — add Dan's images to public/art/ and run npm run art.";

/**
 * Creates `count` placeholder works. Deterministic for a given seed; the first N works are the same
 * whatever `count` is.
 *
 * @param {number} [count=30]
 * @param {number} [seed=7]
 * @returns {Array<{id: string, title: string, year: string, medium: string, caption: string,
 *   width: number, height: number, canvas: HTMLCanvasElement, placeholder: true}>}
 */
export function createPlaceholderWorks(count = 30, seed = 7) {
  const n = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 30;
  const baseSeed = (Number(seed) || 0) >>> 0;
  const styleOrder = cycleOrder(new Rng(hash2(baseSeed, 101)), Object.keys(STYLES), n);
  const paletteOrder = cycleOrder(new Rng(hash2(baseSeed, 202)), PALETTES.map((_, i) => i), n);
  const usedTitles = new Set();
  const works = [];

  for (let i = 0; i < n; i++) {
    const rng = new Rng(hash2(baseSeed, i + 1));
    const style = STYLES[styleOrder[i]];
    const palette = PALETTES[paletteOrder[i]];
    const [aw, ah] = ASPECTS[rng.weighted(Object.entries(style.aspects))];
    const width = aw >= ah ? LONG_SIDE : Math.round((LONG_SIDE * aw) / ah);
    const height = aw >= ah ? Math.round((LONG_SIDE * ah) / aw) : LONG_SIDE;
    const options = style.options ? style.options(rng) : {};
    const [medium, surface] = rng.pick(typeof style.media === 'function' ? style.media(options) : style.media);

    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const meta = style.paint(ctx, width, height, rng, palette, makeNoise(rng), options) || {};
    finish(ctx, width, height, rng, surface, style.brushed);

    works.push({
      id: `placeholder-${i + 1}`,
      title: uniqueTitle(rng, style.title, meta, usedTitles),
      year: String(rng.int(2016, 2025)),
      medium,
      caption: CAPTION,
      width,
      height,
      canvas,
      placeholder: true,
    });
  }
  return works;
}

// =============================================================================================
// Random numbers
// =============================================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  weighted(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = this.next() * total;
    for (const [value, w] of pairs) if ((r -= w) < 0) return value;
    return pairs[pairs.length - 1][0];
  }
  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

/** Repeated shuffles of `items` (no immediate repeats across rounds), `n` long. */
function cycleOrder(rng, items, n) {
  const out = [];
  while (out.length < n) {
    const round = rng.shuffle(items);
    if (out.length && round.length > 1 && round[0] === out[out.length - 1]) round.push(round.shift());
    out.push(...round);
  }
  return out.slice(0, n);
}

// 2D gradient noise (Perlin-style), seeded. Returns roughly -1..1.
function makeNoise(rng) {
  const perm = new Uint8Array(512);
  const p = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = [1, -1, 1, -1, 1.41, -1.41, 0, 0];
  const gy = [1, 1, -1, -1, 0, 0, 1.41, -1.41];
  return (x, y) => {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const fx = x - X;
    const fy = y - Y;
    const xi = X & 255;
    const yi = Y & 255;
    const h00 = perm[perm[xi] + yi] & 7;
    const h10 = perm[perm[xi + 1] + yi] & 7;
    const h01 = perm[perm[xi] + yi + 1] & 7;
    const h11 = perm[perm[xi + 1] + yi + 1] & 7;
    const n00 = gx[h00] * fx + gy[h00] * fy;
    const n10 = gx[h10] * (fx - 1) + gy[h10] * fy;
    const n01 = gx[h01] * fx + gy[h01] * (fy - 1);
    const n11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  };
}

function fbm(noise, x, y, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    norm += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / norm;
}

// =============================================================================================
// Colour
// =============================================================================================

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const css = (c, a = 1) =>
  `rgba(${Math.round(clamp255(c[0]))},${Math.round(clamp255(c[1]))},${Math.round(clamp255(c[2]))},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lighten = (c, t) => mix(c, WHITE, t);
const darken = (c, t) => mix(c, BLACK, t);
const shade = (c, t) => (t >= 0 ? lighten(c, t) : darken(c, -t));
const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const warmth = (c) => (c[0] - c[2]) / 255;

function colourDist(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Slight random variation of a colour, like paint mixed by hand. */
function vary(rng, c, amt = 0.04) {
  const k = rng.float(-amt, amt) * 255;
  return [
    clamp255(c[0] + k + rng.float(-amt, amt) * 60),
    clamp255(c[1] + k + rng.float(-amt, amt) * 60),
    clamp255(c[2] + k + rng.float(-amt, amt) * 60),
  ];
}

/** A colour from `list` far enough from everything in `avoid` (or the most distinct one). */
function pickColour(rng, list, avoid = [], minDist = 100) {
  const ok = list.filter((c) => avoid.every((a) => colourDist(a, c) > minDist));
  if (ok.length) return rng.pick(ok);
  let best = list[0];
  let bestD = -1;
  for (const c of list) {
    const d = Math.min(...avoid.map((a) => colourDist(a, c)));
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

// Curated palettes: a light ground, a dark "ink", and five harmonious colours.
const PALETTES = [
  { bg: '#f2e8d8', ink: '#2a2b38', colors: ['#c65a3e', '#e9a03b', '#f3c9a5', '#5f8a84', '#2f3e57'] }, // terracotta sun
  { bg: '#efeadf', ink: '#26301f', colors: ['#a7b48f', '#5d8159', '#344e3a', '#d9a35f', '#b4643a'] }, // sage garden
  { bg: '#f2efe7', ink: '#0f1a2c', colors: ['#1f3150', '#3f6383', '#7fb3c4', '#f0b24a', '#e2673a'] }, // harbour
  { bg: '#efe4d4', ink: '#24100f', colors: ['#6e1f1c', '#a8442d', '#d99a52', '#ead6b3', '#45324a'] }, // oxblood
  { bg: '#f1eadb', ink: '#1d1c1f', colors: ['#cf3b2e', '#f0b43a', '#2a5ea8', '#1d1c1f', '#d9cbb0'] }, // bauhaus
  { bg: '#f4ede9', ink: '#2a1d30', colors: ['#344f72', '#6b5b7d', '#b26a7c', '#e3826d', '#f0b996'] }, // plum dusk
  { bg: '#eef0ec', ink: '#1c2c33', colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'] }, // nordic coast
  { bg: '#f6f1e3', ink: '#142040', colors: ['#23409a', '#e2413f', '#f5c84c', '#2e9b6e', '#f0a7b6'] }, // matisse
  { bg: '#ece3d1', ink: '#2b2520', colors: ['#6c4429', '#a5552f', '#d8a444', '#8b9a5e', '#3e3f3c'] }, // ochre earth
  { bg: '#f6eee7', ink: '#20302a', colors: ['#2f4d3c', '#d78d9b', '#f1d3ad', '#9cc3b9', '#8a7bb8'] }, // blush forest
  { bg: '#ebe5d9', ink: '#0e1a2a', colors: ['#1b2a40', '#44607e', '#8aa0b8', '#e4d8c2', '#e2a23b'] }, // midnight gold
  { bg: '#f3e9e2', ink: '#3a2a2a', colors: ['#c97b63', '#e7b894', '#8c5a4f', '#a3b5a0', '#d9a7a0'] }, // desert rose
].map((p) => ({ bg: rgb(p.bg), ink: rgb(p.ink), colors: p.colors.map(rgb) }));

// Evocative names for the colours actually used, for titles like "Untitled (Rust over Plum)".
const COLOUR_NAMES = [
  ['Ochre', '#cc8e35'], ['Umber', '#635147'], ['Sienna', '#a0522d'], ['Rust', '#b7410e'],
  ['Terracotta', '#c8553d'], ['Vermilion', '#e34234'], ['Crimson', '#9b1b30'], ['Oxblood', '#6d1a1f'],
  ['Rose', '#c97585'], ['Coral', '#f08070'], ['Apricot', '#f4b183'], ['Saffron', '#f4c430'],
  ['Lemon', '#f2dc5d'], ['Mustard', '#d9a441'], ['Olive', '#7d7c3c'], ['Sage', '#9caf88'],
  ['Moss', '#5c6b3c'], ['Forest', '#2f4b3a'], ['Viridian', '#40826d'], ['Teal', '#2a7f7f'],
  ['Turquoise', '#48c9b0'], ['Duck Egg', '#a8d0cc'], ['Cerulean', '#2a7fb8'], ['Cobalt', '#1f4fa0'],
  ['Ultramarine', '#2a3a8c'], ['Indigo', '#2e2b5f'], ['Navy', '#1b2a41'], ['Slate', '#5b6770'],
  ['Plum', '#6d3b5e'], ['Violet', '#7b5ea7'], ['Lilac', '#b9a3d0'], ['Blush', '#e8b4b0'],
  ['Bone', '#e9dfcc'], ['Sand', '#dcc7a1'], ['Grey', '#8c8c8c'], ['Charcoal', '#33363b'],
  ['Black', '#141414'], ['Gold', '#d4a017'], ['Orange', '#ee7f2d'], ['Red', '#c62d2d'], ['Blue', '#2f5d9b'],
  ['Green', '#4a7c48'], ['Yellow', '#f0c419'], ['Pink', '#e79ab3'], ['Mist', '#9fb0c4'], ['Cocoa', '#7a4e45'],
].map(([name, hex]) => [name, rgb(hex)]);

function colourName(c) {
  let best = COLOUR_NAMES[0][0];
  let bestD = Infinity;
  for (const [name, v] of COLOUR_NAMES) {
    const d = colourDist(c, v);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

// =============================================================================================
// Canvas helpers
// =============================================================================================

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

const FAR = 20000;

/**
 * Fills the path built by `buildPath` with feathered edges, using an off-canvas shadow (works in
 * every browser, unlike ctx.filter). Assumes no scaling in the current transform.
 */
function softFill(ctx, colour, blur, buildPath) {
  ctx.save();
  ctx.translate(-FAR, 0);
  ctx.shadowOffsetX = FAR;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = blur;
  ctx.shadowColor = colour;
  ctx.fillStyle = '#000';
  buildPath();
  ctx.fill();
  ctx.restore();
}

/** Bristle brush stroke from (x0,y0) to (x1,y1): streaky, ragged-ended, slightly curved. */
function brush(ctx, rng, x0, y0, x1, y1, width, colour, alpha) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = rng.float(-0.12, 0.12) * len;
  const mx = (x0 + x1) / 2 + nx * bend;
  const my = (y0 + y1) / 2 + ny * bend;
  const bristles = Math.max(5, Math.min(24, Math.round(width / 2)));
  ctx.lineCap = 'round';
  for (let g = 0; g < 3; g++) {
    ctx.beginPath();
    for (let b = g; b < bristles; b += 3) {
      const o = (b / (bristles - 1) - 0.5) * width * rng.float(0.9, 1.1);
      const s0 = rng.float(0, 0.14);
      const s1 = rng.float(0.8, 1);
      ctx.moveTo(x0 + dx * s0 + nx * o, y0 + dy * s0 + ny * o);
      ctx.quadraticCurveTo(mx + nx * o, my + ny * o, x0 + dx * s1 + nx * o, y0 + dy * s1 + ny * o);
    }
    ctx.lineWidth = (width / bristles) * rng.float(1.1, 2.2);
    ctx.strokeStyle = css(vary(rng, colour, 0.035), alpha * rng.float(0.55, 1));
    ctx.stroke();
  }
}

/** Adds a slightly irregular circle to the current path. */
function wobblyCircle(ctx, rng, cx, cy, r, amt = 0.012) {
  const steps = Math.max(28, Math.min(140, Math.round(r * 0.7)));
  const p1 = rng.float(0, TAU);
  const p2 = rng.float(0, TAU);
  const k1 = rng.int(2, 4);
  const k2 = rng.int(5, 8);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const rr = r * (1 + amt * (Math.sin(a * k1 + p1) + 0.5 * Math.sin(a * k2 + p2)));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Adds an arc with a slightly hand-drawn radius to the current path (lineTo from current point). */
function wobblyArc(ctx, rng, cx, cy, r, a0, a1, amt = 0.01, move = false) {
  const steps = Math.max(8, Math.round((Math.abs(a1 - a0) * r) / 6));
  const ph = rng.float(0, TAU);
  const k = rng.int(2, 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    const rr = r * (1 + amt * Math.sin(t * Math.PI) * Math.sin(t * k * Math.PI + ph));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0 && move) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Adds a straight-ish line with a little hand wobble (lineTo from the current point). */
function wobblyLine(ctx, rng, x0, y0, x1, y1, amt) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const n = Math.max(2, Math.round(len / 14));
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const ph = rng.float(0, TAU);
  const k = rng.float(1, 3);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const o = amt * Math.sin(Math.PI * t) * (0.8 * Math.sin(t * Math.PI * k + ph) + rng.float(-0.25, 0.25));
    ctx.lineTo(x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o);
  }
}

function wobblyRect(ctx, rng, x, y, w, h, amt) {
  ctx.moveTo(x, y);
  wobblyLine(ctx, rng, x, y, x + w, y, amt);
  wobblyLine(ctx, rng, x + w, y, x + w, y + h, amt);
  wobblyLine(ctx, rng, x + w, y + h, x, y + h, amt);
  wobblyLine(ctx, rng, x, y + h, x, y, amt);
  ctx.closePath();
}

/** Closed smooth curve through the midpoints of a polygon. */
function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (i) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
  let m = mid(n - 1);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

/** Open smooth curve through points (lineTo from the current point to the first). */
function smoothOpen(ctx, pts) {
  ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/** Smooth hull of two circles (pears, figs, gourds): big circle (x1,y1,r1), small (x2,y2,r2). */
function twoCircleHull(ctx, x1, y1, r1, x2, y2, r2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const base = Math.atan2(y2 - y1, x2 - x1);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  ctx.arc(x1, y1, r1, base + phi, base - phi + TAU);
  ctx.arc(x2, y2, r2, base - phi, base + phi);
  ctx.closePath();
}

// Pre-generated textures, made once (deterministically) and tiled with createPattern.
let TEXTURES = null;

function textures() {
  if (TEXTURES) return TEXTURES;
  const rng = new Rng(0x7e47);
  TEXTURES = {
    grain: noiseTexture(rng, 256, 256, 1, 70),
    mottle: noiseTexture(rng, 128, 4, 5, 160),
    paper: paperTexture(rng),
    weave: weaveTexture(rng),
    streaks: streakTexture(rng),
  };
  return TEXTURES;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/** Tileable grey value noise centred on 50% grey (neutral for overlay / soft-light blending). */
function noiseTexture(rng, size, cells, octaves, contrast) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const acc = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++, cells *= 2, amp *= 0.5) {
    const n = Math.min(cells, size);
    const lattice = new Float32Array(n * n);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    const scale = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const y0 = Math.floor(fy);
      const ty = smoothstep(fy - y0);
      const y1 = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const x0 = Math.floor(fx);
        const tx = smoothstep(fx - x0);
        const x1 = (x0 + 1) % n;
        const a = lattice[y0 * n + x0];
        const b = lattice[y0 * n + x1];
        const c = lattice[y1 * n + x0];
        const d = lattice[y1 * n + x1];
        acc[y * size + x] += amp * (a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty);
      }
    }
    total += amp;
  }
  const data = img.data;
  for (let i = 0; i < acc.length; i++) {
    const v = 128 + (acc[i] / total - 0.5) * 2 * contrast;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function paperTexture(rng) {
  const S = 256;
  const canvas = noiseTexture(rng, S, 32, 3, 48);
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = rng.float(0, S);
    const y = rng.float(0, S);
    const a = rng.float(0, TAU);
    const len = rng.float(4, 18);
    const bend = rng.float(-4, 4);
    ctx.strokeStyle = rng.chance(0.5) ? `rgba(255,255,255,${rng.float(0.1, 0.25)})` : `rgba(0,0,0,${rng.float(0.06, 0.16)})`;
    ctx.lineWidth = rng.float(0.4, 1.1);
    const ex = Math.cos(a) * len;
    const ey = Math.sin(a) * len;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + ex / 2 - Math.sin(a) * bend, y + oy + ey / 2 + Math.cos(a) * bend, x + ox + ex, y + oy + ey);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

function weaveTexture(rng) {
  const S = 128;
  const P = 4; // thread spacing in px
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const rowJ = Float32Array.from({ length: S / P }, () => rng.float(-1, 1));
  const colJ = Float32Array.from({ length: S / P }, () => rng.float(-1, 1));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = (x / P) | 0;
      const cy = (y / P) | 0;
      const warp = Math.sin((Math.PI * ((x % P) + 0.5)) / P);
      const weft = Math.sin((Math.PI * ((y % P) + 0.5)) / P);
      const h = ((cx + cy) & 1) === 0 ? weft * (0.85 + 0.15 * rowJ[cy]) : warp * (0.85 + 0.15 * colJ[cx]);
      const v = 128 + (h - 0.62) * 110 + rng.float(-10, 10);
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function streakTexture(rng) {
  const S = 256;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const x = rng.float(0, S);
    const y = rng.float(0, S);
    const len = rng.float(30, 220);
    const dy = rng.float(-3, 3);
    ctx.strokeStyle = rng.chance(0.5) ? `rgba(255,255,255,${rng.float(0.05, 0.18)})` : `rgba(0,0,0,${rng.float(0.05, 0.16)})`;
    ctx.lineWidth = rng.float(0.6, 3.2);
    for (const ox of [-S, 0]) {
      for (const oy of [-S, 0, S]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + len / 2, y + oy + dy, x + ox + len, y + oy + dy * 0.3);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

function overlayPattern(ctx, tex, W, H, rng, angle) {
  const pattern = ctx.createPattern(tex, 'repeat');
  ctx.save();
  ctx.translate(W / 2, H / 2);
  if (angle) ctx.rotate(angle);
  ctx.translate(rng.float(-128, 128), rng.float(-128, 128));
  ctx.fillStyle = pattern;
  const R = Math.hypot(W, H) / 2 + 300;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.restore();
}

/** Painterly finish: brush streaks, uneven paint density, canvas weave / paper tooth, grain. */
function finish(ctx, W, H, rng, surface, brushed = 0) {
  const T = textures();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'rgba(0,0,0,0)';
  if (brushed > 0) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = brushed;
    overlayPattern(ctx, T.streaks, W, H, rng, rng.pick([0, Math.PI / 2, rng.float(-0.4, 0.4)]));
  }
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.45;
  const cw = rng.float(30, 60);
  const ch = (cw * H) / W;
  ctx.drawImage(T.mottle, rng.float(0, 128 - cw), rng.float(0, 128 - ch), cw, ch, 0, 0, W, H);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = surface === 'canvas' ? 0.4 : surface === 'paper' ? 0.32 : 0.14;
  overlayPattern(ctx, surface === 'canvas' ? T.weave : T.paper, W, H, rng, 0);
  ctx.globalAlpha = 0.1;
  overlayPattern(ctx, T.grain, W, H, rng, 0);
  ctx.restore();
}

// =============================================================================================
// Style 1 — layered landscape: gradient sky, sun or moon, misty hills, optional water
// =============================================================================================

function paintLandscape(ctx, W, H, rng, pal, noise) {
  const { colors } = pal;
  const byLum = [...colors].sort((a, b) => luma(a) - luma(b));
  const warm = [...colors].sort((a, b) => warmth(b) - warmth(a))[0];
  const cool = [...colors].sort((a, b) => warmth(a) - warmth(b))[0];
  const mood = rng.weighted([['dusk', 4], ['day', 2], ['dawn', 2], ['night', 1.5]]);
  let top;
  let mid;
  let hor;
  let orb;
  if (mood === 'dusk') {
    top = mix(darken(cool, 0.2), byLum[0], 0.35);
    mid = mix(cool, warm, 0.55);
    hor = lighten(warm, 0.35);
    orb = lighten(warm, 0.72);
  } else if (mood === 'day') {
    top = lighten(cool, 0.15);
    mid = lighten(cool, 0.45);
    hor = lighten(pal.bg, 0.25);
    orb = [255, 249, 236];
  } else if (mood === 'dawn') {
    top = lighten(mix(cool, byLum[1], 0.5), 0.2);
    mid = lighten(mix(cool, warm, 0.5), 0.45);
    hor = lighten(warm, 0.62);
    orb = lighten(warm, 0.85);
  } else {
    top = darken(byLum[0], 0.45);
    mid = mix(darken(byLum[0], 0.15), cool, 0.4);
    hor = mix(cool, pal.bg, 0.3);
    orb = lighten(pal.bg, 0.55);
  }

  const horizon = H * rng.float(0.42, 0.6);
  const skyAt = (y) => {
    const t = Math.max(0, Math.min(1, y / horizon));
    return t < 0.6 ? mix(top, mid, t / 0.6) : mix(mid, hor, (t - 0.6) / 0.4);
  };
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, css(top));
  sky.addColorStop(0.6, css(mid));
  sky.addColorStop(1, css(hor));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Long soft strokes across the sky.
  for (let i = rng.int(7, 13); i > 0; i--) {
    const y = rng.float(0.03, 1) * horizon;
    const x = rng.float(-0.3, 0.8) * W;
    const c = lighten(skyAt(y), rng.float(0.03, 0.2));
    brush(ctx, rng, x, y, x + rng.float(0.25, 0.6) * W, y + rng.float(-6, 6), rng.float(8, 30), c, rng.float(0.12, 0.3));
  }

  // Sun or moon with a glow.
  const orbR = Math.min(W, H) * (mood === 'night' ? rng.float(0.035, 0.06) : rng.float(0.05, 0.1));
  const ox = W * rng.float(0.18, 0.82);
  const oy = horizon * rng.float(0.35, 0.85);
  const glow = ctx.createRadialGradient(ox, oy, orbR * 0.5, ox, oy, orbR * (mood === 'night' ? 4 : 6));
  glow.addColorStop(0, css(orb, mood === 'day' ? 0.35 : 0.5));
  glow.addColorStop(1, css(orb, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  softFill(ctx, css(orb), 3, () => {
    ctx.beginPath();
    ctx.arc(ox, oy, orbR, 0, TAU);
  });

  // Hills / mountains, far to near, with haze between them.
  const water = rng.chance(0.45);
  const waterY = water ? horizon + (H - horizon) * rng.float(0.12, 0.28) : H;
  const n = water ? rng.int(2, 3) : rng.int(3, 5);
  const mountains = rng.chance(0.55);
  const landFar = mix(byLum[2], cool, 0.3);
  const landNear = darken(byLum[0], 0.1);
  const layers = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 1 : k / (n - 1);
    const baseY = water
      ? horizon + (waterY - horizon) * (0.2 + 0.75 * t)
      : horizon + (H - horizon) * (0.1 + 0.6 * Math.pow(t, 1.2));
    const amp = H * (mountains ? 0.2 - 0.12 * t : 0.12 - 0.05 * t) * rng.float(0.6, 1.1);
    const freq = (1.4 + (1 - t) * (mountains ? 2.6 : 1.2)) / W;
    const off = rng.float(0, 500);
    const ridged = mountains && t < 0.5;
    const pts = [];
    for (let x = -12; x <= W + 12; x += 6) {
      const smooth = 0.5 + 0.9 * fbm(noise, x * freq * 0.8 + off, k * 3.7 + 11, 2);
      let f = smooth;
      if (ridged) {
        const peak = Math.max(0, 1 - Math.abs(fbm(noise, x * freq + off, k * 3.7, 3)) * 1.5);
        f = 0.7 * Math.pow(peak, 1.6) + 0.3 * smooth;
      }
      pts.push([x, baseY - amp * f]);
    }
    const layer = { pts, col: mix(mix(landFar, landNear, t), hor, (1 - t) * 0.55), bottom: water ? waterY + 1 : H + 2, t };
    layers.push(layer);
    drawHill(ctx, rng, layer, W);
    if (k < n - 1) {
      const y0 = baseY - amp * 0.5;
      const haze = ctx.createLinearGradient(0, y0, 0, layer.bottom);
      haze.addColorStop(0, css(hor, 0));
      haze.addColorStop(1, css(hor, 0.45));
      ctx.fillStyle = haze;
      ctx.fillRect(0, y0, W, layer.bottom - y0);
    }
  }

  if (water) {
    const wg = ctx.createLinearGradient(0, waterY, 0, H);
    wg.addColorStop(0, css(mix(hor, mid, 0.3)));
    wg.addColorStop(1, css(mix(top, landNear, 0.3)));
    ctx.fillStyle = wg;
    ctx.fillRect(0, waterY, W, H - waterY);
    // Faded mirror image of the hills.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, waterY, W, H - waterY);
    ctx.clip();
    ctx.translate(0, 2 * waterY);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.2;
    for (const layer of layers) {
      hillPath(ctx, layer);
      ctx.fillStyle = css(layer.col);
      ctx.fill();
    }
    ctx.restore();
    // Glitter path under the sun, then ripples.
    ctx.lineCap = 'round';
    for (let i = 0; i < 28; i++) {
      const d = i / 28;
      const y = waterY + 4 + (H - waterY) * d * 0.9;
      const w = orbR * rng.float(0.4, 1.7) * (1 - 0.4 * d) * (0.6 + d);
      const x = ox + rng.float(-0.25, 0.25) * orbR;
      ctx.strokeStyle = css(orb, 0.6 * (1 - d * 0.8));
      ctx.lineWidth = rng.float(1.2, 3.2);
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
    }
    for (let i = 0; i < 110; i++) {
      const d = Math.pow(rng.next(), 0.7);
      const y = waterY + 4 + (H - waterY - 4) * d;
      const len = rng.float(10, 70) * (0.5 + d * 1.5);
      const x = rng.float(-20, W);
      ctx.strokeStyle = rng.chance(0.55) ? css(lighten(hor, 0.35), rng.float(0.1, 0.3)) : css(darken(top, 0.2), rng.float(0.08, 0.22));
      ctx.lineWidth = rng.float(0.8, 2.2) * (0.6 + d);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    ctx.fillStyle = css(lighten(hor, 0.4), 0.55);
    ctx.fillRect(0, waterY - 0.5, W, 1.5);
    // Dark foreground shore with reeds.
    if (rng.chance(0.6)) {
      const fromLeft = rng.chance(0.5);
      const reach = W * rng.float(0.35, 0.7);
      const shoreH = H * rng.float(0.06, 0.14);
      const col = darken(landNear, 0.15);
      ctx.beginPath();
      ctx.moveTo(fromLeft ? -10 : W + 10, H + 2);
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const x = fromLeft ? -10 + t * (reach + 10) : W + 10 - t * (reach + 10);
        const y = H - shoreH * (1 - Math.pow(t, 2.2)) * (0.8 + 0.4 * (fbm(noise, t * 3, 9.1, 2) + 0.5));
        pts.push([x, y]);
      }
      smoothOpen(ctx, pts);
      ctx.lineTo(fromLeft ? reach : W - reach, H + 2);
      ctx.closePath();
      ctx.fillStyle = css(col);
      ctx.fill();
      ctx.strokeStyle = css(col, 0.9);
      ctx.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const t = rng.float(0, 0.75);
        const x = fromLeft ? t * reach : W - t * reach;
        const y = H - shoreH * (1 - Math.pow(t, 2.2)) * 0.8;
        const h = rng.float(0.04, 0.12) * H;
        ctx.lineWidth = rng.float(1, 2.2);
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.quadraticCurveTo(x + rng.float(-6, 6), y - h / 2, x + rng.float(-12, 12), y - h);
        ctx.stroke();
      }
    }
  } else if (rng.chance(0.45)) {
    // A line of trees along one of the nearer ridges.
    const layer = layers[n - 1 - rng.int(0, 1)];
    const col = darken(layer.col, 0.18);
    const round = rng.chance(0.4);
    ctx.fillStyle = css(col);
    ctx.beginPath();
    let x = rng.float(0, 40);
    while (x < W) {
      const y = ridgeY(layer.pts, x);
      const h = rng.float(10, 26) * (0.6 + layer.t * 0.6);
      if (round) {
        ctx.moveTo(x + h * 0.32, y - h * 0.55);
        ctx.ellipse(x, y - h * 0.55, h * 0.32, h * 0.45, 0, 0, TAU);
        ctx.rect(x - 1, y - h * 0.2, 2, h * 0.3);
      } else {
        ctx.moveTo(x - h * 0.2, y + 2);
        ctx.lineTo(x, y - h);
        ctx.lineTo(x + h * 0.2, y + 2);
        ctx.closePath();
      }
      x += rng.chance(0.12) ? rng.float(40, 140) : rng.float(5, 16);
    }
    ctx.fill();
  }
  return { kind: water ? 'water' : 'land', mood, colours: [hor, landNear, top] };
}

function hillPath(ctx, layer) {
  const { pts, bottom } = layer;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], bottom);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], bottom);
  ctx.closePath();
}

function drawHill(ctx, rng, layer, W) {
  let minY = Infinity;
  for (const [, y] of layer.pts) minY = Math.min(minY, y);
  hillPath(ctx, layer);
  const g = ctx.createLinearGradient(0, minY, 0, layer.bottom);
  g.addColorStop(0, css(lighten(layer.col, 0.07)));
  g.addColorStop(1, css(darken(layer.col, 0.12)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 12; i++) {
    const x = rng.float(-0.2, 1) * W;
    const y = rng.float(minY, layer.bottom);
    brush(ctx, rng, x, y, x + rng.float(60, 220), y + rng.float(-18, 18), rng.float(6, 20), shade(layer.col, rng.float(-0.12, 0.1)), 0.2);
  }
  ctx.restore();
}

function ridgeY(pts, x) {
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor((x - pts[0][0]) / (pts[1][0] - pts[0][0]))));
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

// =============================================================================================
// Style 2 — mid-century / Bauhaus composition: circles, half-moons, arches, bars on a grid
// =============================================================================================

function paintComposition(ctx, W, H, rng, pal) {
  const cols = pal.colors;
  const S = Math.min(W, H);
  const u = S / rng.pick([4, 5, 6]);
  const snap = (v) => Math.round(v / u) * u;
  const wob = 0.006;
  const ground = rng.chance(0.8) ? pal.bg : lighten(rng.pick(cols), 0.55);
  ctx.fillStyle = css(ground);
  ctx.fillRect(0, 0, W, H);

  // Prefer the least-used palette colour that contrasts with what's underneath and the last pick.
  const recent = [];
  const usage = new Map(cols.map((c) => [c, 0]));
  const take = (under) => {
    const last = recent[recent.length - 1];
    let pool = cols.filter((c) => colourDist(c, under) > 110 && (!last || colourDist(c, last) > 70));
    if (!pool.length) pool = cols.filter((c) => colourDist(c, under) > 70);
    if (!pool.length) pool = cols;
    const least = Math.min(...pool.map((c) => usage.get(c)));
    const c = rng.pick(pool.filter((p) => usage.get(p) === least));
    usage.set(c, usage.get(c) + 1);
    recent.push(c);
    return vary(rng, c, 0.025);
  };

  // A structural division: horizon, vertical split, or an inset block.
  const division = rng.weighted([['horizon', 3], ['vertical', 2], ['block', 2], ['none', 1]]);
  let lineY = null;
  let lineX = null;
  let blockCol = null;
  let blockRect = null;
  if (division === 'horizon') {
    lineY = snap(H * rng.float(0.55, 0.75));
    blockCol = take(ground);
    blockRect = [-4, lineY, W + 8, H - lineY + 4];
  } else if (division === 'vertical') {
    lineX = snap(W * rng.float(0.35, 0.65));
    blockCol = take(ground);
    blockRect = rng.chance(0.5) ? [-4, -4, lineX + 4, H + 8] : [lineX, -4, W - lineX + 4, H + 8];
  } else if (division === 'block') {
    const m = u * rng.float(0.35, 0.55);
    blockCol = take(ground);
    blockRect = [m, m, W - 2 * m, H - 2 * m];
  }
  if (blockRect) {
    ctx.beginPath();
    wobblyRect(ctx, rng, ...blockRect, S * 0.003);
    ctx.fillStyle = css(blockCol);
    ctx.fill();
  }
  const inBlock = (x, y) =>
    blockRect && x >= blockRect[0] && x <= blockRect[0] + blockRect[2] && y >= blockRect[1] && y <= blockRect[1] + blockRect[3];
  const under = (x, y) => (inBlock(x, y) ? blockCol : ground);
  if (division === 'block') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(...blockRect);
    ctx.clip();
  }

  const names = [];
  const fillShape = (c, multiply) => {
    ctx.save();
    if (multiply) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.85;
    }
    ctx.fillStyle = css(c);
    ctx.fill();
    ctx.restore();
  };
  const draw = (type, x, y, r, rot, multiply = false) => {
    const c = take(under(x, y));
    ctx.beginPath();
    switch (type) {
      case 'circle':
        wobblyCircle(ctx, rng, x, y, r, wob);
        names.push('Circle');
        break;
      case 'half':
        ctx.moveTo(x + Math.cos(rot) * r, y + Math.sin(rot) * r);
        wobblyArc(ctx, rng, x, y, r, rot, rot + Math.PI, wob);
        ctx.closePath();
        names.push('Half Moon');
        break;
      case 'quarter':
        ctx.moveTo(x, y);
        wobblyArc(ctx, rng, x, y, r * 1.4, rot, rot + Math.PI / 2, wob);
        ctx.closePath();
        names.push('Quarter Circle');
        break;
      case 'arch': {
        const h = r * rng.float(1.8, 2.8);
        ctx.moveTo(x - r, y);
        ctx.lineTo(x - r, y - h + r);
        wobblyArc(ctx, rng, x, y - h + r, r, Math.PI, TAU, wob);
        ctx.lineTo(x + r, y);
        ctx.closePath();
        names.push('Arch');
        break;
      }
      case 'column': {
        const w = r * rng.float(0.6, 1);
        const h = r * rng.float(2, 3.2);
        wobblyRect(ctx, rng, x - w / 2, y - h, w, h, S * 0.002);
        names.push('Column');
        break;
      }
      case 'rings': {
        ctx.save();
        const k = rng.int(3, 5);
        const lw = (r / k) * 0.5;
        ctx.lineWidth = lw;
        ctx.strokeStyle = css(c);
        const full = rng.chance(0.4);
        for (let i = 0; i < k; i++) {
          ctx.beginPath();
          wobblyArc(ctx, rng, x, y, r - i * lw * 2, full ? 0 : rot, full ? TAU : rot + Math.PI, wob, true);
          ctx.stroke();
        }
        ctx.restore();
        names.push('Rings');
        return;
      }
      case 'stripes': {
        const k = rng.int(3, 5);
        const vertical = rng.chance(0.5);
        const bw = (2 * r) / (2 * k - 1);
        for (let i = 0; i < k; i++) {
          const o = -r + i * 2 * bw;
          if (vertical) wobblyRect(ctx, rng, x + o, y - r, bw, 2 * r, S * 0.002);
          else wobblyRect(ctx, rng, x - r, y + o, 2 * r, bw, S * 0.002);
        }
        names.push('Stripes');
        break;
      }
      case 'dots': {
        const nx = rng.int(3, 4);
        const ny = rng.int(2, 4);
        const gap = r * 0.42;
        const dr = r * 0.1;
        const dc = colourDist(pal.ink, under(x, y)) > 150 ? pal.ink : lighten(pal.bg, 0.3);
        ctx.fillStyle = css(dc);
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < ny; j++) {
            ctx.beginPath();
            ctx.arc(x + (i - (nx - 1) / 2) * gap, y + (j - (ny - 1) / 2) * gap, dr, 0, TAU);
            ctx.fill();
          }
        }
        return;
      }
      case 'line': {
        ctx.save();
        ctx.strokeStyle = css(colourDist(pal.ink, under(x, y)) > 150 ? pal.ink : lighten(pal.bg, 0.3));
        ctx.lineWidth = S * rng.float(0.004, 0.008);
        ctx.lineCap = 'round';
        const vertical = rng.chance(0.4);
        const len = u * rng.int(2, 4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        wobblyLine(ctx, rng, x, y, vertical ? x : x + len, vertical ? y - len : y, S * 0.002);
        ctx.stroke();
        ctx.restore();
        return;
      }
      default:
        break;
    }
    fillShape(c, multiply);
  };

  // Hero shape, related to the division when there is one.
  const heroR = u * rng.float(1.1, 1.7);
  const hx = snap(W * rng.pick([0.33, 0.5, 0.67]));
  if (lineY != null) {
    if (rng.chance(0.6)) draw('half', hx, lineY, heroR, Math.PI);
    else draw('circle', hx, snap(lineY - heroR * rng.float(0.3, 1.2)), heroR, 0, rng.chance(0.5));
  } else if (lineX != null) {
    const hy = snap(H * rng.float(0.3, 0.7));
    if (rng.chance(0.5)) draw('circle', lineX, hy, heroR, 0, true);
    else draw('half', lineX, hy, heroR, rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
  } else {
    draw(rng.pick(['circle', 'circle', 'arch', 'half']), hx, snap(H * rng.float(0.35, 0.65)), heroR, rng.int(0, 3) * (Math.PI / 2));
  }

  // Supporting shapes, one per region of a 3×3 grid (skipping the hero's region) for balance.
  const heroCell = Math.min(2, Math.floor((hx / W) * 3));
  const regions = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => c % 3 !== heroCell || rng.chance(0.25)));
  const count = rng.int(3, 5);
  for (let i = 0; i < count && i < regions.length; i++) {
    const type = rng.weighted([
      ['circle', 2], ['half', 3], ['quarter', 2], ['arch', 2], ['column', 1.5], ['rings', 1.5],
      ['stripes', 1.2], ['dots', 1.2], ['line', 1],
    ]);
    const cx = regions[i] % 3;
    const cy = Math.floor(regions[i] / 3);
    let x = snap(((cx + rng.float(0.2, 0.8)) / 3) * W);
    let y = snap(((cy + rng.float(0.25, 0.85)) / 3) * H);
    if (lineY != null && rng.chance(0.4)) y = lineY;
    if (lineX != null && rng.chance(0.3)) x = lineX;
    const r = u * rng.pick([0.5, 0.6, 0.75, 1, 1]);
    const rot = rng.int(0, 3) * (Math.PI / 2);
    draw(type, x, y, r, rot, rng.chance(0.2));
  }
  if (division === 'block') ctx.restore();
  return { shapes: names, colours: [...recent] };
}

// =============================================================================================
// Style 3 — colour field: soft-edged stacked rectangles on a deep ground (after Rothko)
// =============================================================================================

function paintColourField(ctx, W, H, rng, pal) {
  const cols = [...pal.colors, pal.ink];
  const deep = cols.filter((c) => luma(c) < 0.45);
  const ground = deep.length && rng.chance(0.8) ? rng.pick(deep) : rng.pick(cols);
  const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, css(lighten(ground, 0.07)));
  g.addColorStop(1, css(darken(ground, 0.2)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 36; i++) {
    const y = rng.float(-0.1, 1.1) * H;
    const x = rng.float(-0.3, 0.9) * W;
    brush(ctx, rng, x, y, x + rng.float(0.3, 0.7) * W, y + rng.float(-30, 30), rng.float(30, 80), vary(rng, ground, 0.05), 0.07);
  }

  const nb = rng.weighted([[2, 5], [3, 4], [1, 1]]);
  const mx = W * rng.float(0.07, 0.12);
  const mt = H * rng.float(0.05, 0.08);
  const mb = H * rng.float(0.06, 0.1);
  const gap = H * rng.float(0.025, 0.05);
  const avail = H - mt - mb - gap * (nb - 1);
  const weights = Array.from({ length: nb }, () => rng.float(0.5, 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  const used = [];
  let y = mt;
  for (let b = 0; b < nb; b++) {
    const h = (avail * weights[b]) / sum;
    const c = pickColour(rng, cols, [ground, ...used.slice(-1)], 85);
    used.push(c);
    const inset = W * rng.float(-0.01, 0.015);
    fieldBlock(ctx, rng, mx + inset, y, W - 2 * (mx + inset), h, c, ground);
    y += h + gap;
  }
  return { colours: [...used, ground], blocks: nb };
}

function fieldBlock(ctx, rng, x, y, w, h, c, ground) {
  const blur = Math.max(6, Math.min(w, h) * 0.06);
  softFill(ctx, css(mix(c, ground, 0.45), 0.9), blur * 2.2, () => {
    ctx.beginPath();
    ctx.rect(x - blur * 0.6, y - blur * 0.6, w + blur * 1.2, h + blur * 1.2);
  });
  softFill(ctx, css(c, 0.95), blur, () => {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  });
  softFill(ctx, css(shade(c, rng.float(-0.1, 0.12)), 0.45), blur * 4, () => {
    ctx.beginPath();
    ctx.rect(x + w * 0.12, y + h * 0.15, w * 0.76, h * 0.7);
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - blur * 0.5, y - blur * 0.5, w + blur, h + blur);
  ctx.clip();
  const n = Math.round((w * h) / 4500) + 10;
  for (let i = 0; i < n; i++) {
    const sy = y + rng.float(-0.02, 1.02) * h;
    const len = w * rng.float(0.25, 0.7);
    const sx = x + rng.float(-0.05, 1.05) * w - len / 2;
    brush(ctx, rng, sx, sy, sx + len, sy + rng.float(-8, 8), rng.float(10, 34), vary(rng, c, 0.07), rng.float(0.05, 0.16));
  }
  ctx.restore();
}

// =============================================================================================
// Style 4 — flow-field drawing: hundreds of ink lines following a smooth noise field
// =============================================================================================

function paintFlowField(ctx, W, H, rng, pal, noise, { dark }) {
  const bg = dark ? darken(pal.ink, 0.25) : lighten(pal.bg, 0.15);
  ctx.fillStyle = css(bg);
  ctx.fillRect(0, 0, W, H);
  const main = dark ? lighten(pal.bg, 0.3) : pal.ink;
  const accent = pickColour(rng, pal.colors, [bg, main], 130);
  const accent2 = pickColour(rng, pal.colors, [bg, main, accent], 90);
  const S = Math.min(W, H);
  const scale = rng.float(1.2, 3) / S;
  const turns = rng.float(0.5, 1.4);
  const base = rng.float(0, TAU);
  const margin = rng.chance(0.55) ? S * rng.float(0.06, 0.1) : -10;
  const focal = rng.weighted([['circle', 3], ['band', 2], ['none', 2]]);
  const fx = W * rng.float(0.32, 0.68);
  const fy = H * rng.float(0.3, 0.62);
  const fr = S * rng.float(0.18, 0.3);
  const inFocal = (x, y) =>
    focal === 'circle' ? (x - fx) ** 2 + (y - fy) ** 2 < fr * fr : focal === 'band' ? Math.abs(y - fy) < fr * 0.4 : false;
  const lines = Math.round(rng.float(550, 850) * ((W * H) / (LONG_SIDE * LONG_SIDE)));
  const steps = rng.int(35, 90);
  const step = 2.4;
  const paths = Array.from({ length: 6 }, () => new Path2D());
  for (let i = 0; i < lines; i++) {
    let x = rng.float(margin, W - margin);
    let y = rng.float(margin, H - margin);
    const hit = inFocal(x, y);
    const b = hit ? 3 + (rng.chance(0.5) ? 1 : 0) : rng.chance(0.07) ? 5 : rng.int(0, 2);
    const p = paths[b];
    p.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      const a = base + noise(x * scale, y * scale) * TAU * turns;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      if (x < margin || x > W - margin || y < margin || y > H - margin) break;
      if (focal !== 'none' && inFocal(x, y) !== hit) break; // crisp edge where the field changes colour
      p.lineTo(x, y);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const styles = [
    [main, 0.85, 1.1],
    [main, 0.5, 0.8],
    [main, 0.3, 1.8],
    [accent, 0.9, 1.3],
    [accent, 0.55, 0.9],
    [accent2, 0.85, 1.1],
  ];
  styles.forEach(([c, a, w], i) => {
    ctx.strokeStyle = css(c, a);
    ctx.lineWidth = w;
    ctx.stroke(paths[i]);
  });
  return { colours: [accent, main], focal };
}

// =============================================================================================
// Style 5 — botanical cut-outs: Matisse-like fronds, leaves, stars and flowers in cut paper
// =============================================================================================

function paintCutouts(ctx, W, H, rng, pal) {
  const cols = pal.colors;
  const all = [...cols, pal.bg];
  const S = Math.min(W, H);
  const layout = rng.weighted([['solid', 3], ['split', 3], ['panels', 2], ['frame', 2]]);
  const blocks = [];
  const first = rng.chance(0.35) ? pal.bg : rng.pick(cols);
  if (layout === 'solid') {
    blocks.push([0, 0, W, H, first]);
  } else if (layout === 'split') {
    const second = pickColour(rng, all, [first], 120);
    if (rng.chance(0.5)) {
      const sx = Math.round(W * rng.float(0.38, 0.62));
      blocks.push([0, 0, sx, H, first], [sx, 0, W - sx, H, second]);
    } else {
      const sy = Math.round(H * rng.float(0.38, 0.62));
      blocks.push([0, 0, W, sy, first], [0, sy, W, H - sy, second]);
    }
  } else if (layout === 'panels') {
    const second = pickColour(rng, all, [first], 120);
    const sx = Math.round(W / 2);
    const sy = Math.round(H / 2);
    blocks.push([0, 0, sx, sy, first], [sx, 0, W - sx, sy, second], [0, sy, sx, H - sy, second], [sx, sy, W - sx, H - sy, first]);
  } else {
    const inner = pickColour(rng, cols, [pal.bg], 120);
    const m = Math.round(S * rng.float(0.06, 0.1));
    blocks.push([0, 0, W, H, pal.bg], [m, m, W - 2 * m, H - 2 * m, inner]);
  }
  for (const [x, y, w, h, c] of blocks) {
    ctx.fillStyle = css(vary(rng, c, 0.02));
    ctx.fillRect(x, y, w, h);
  }
  const colourAt = (x, y) => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const [bx, by, bw, bh, c] = blocks[i];
      if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) return c;
    }
    return blocks[0][4];
  };

  // Spread shapes over a jittered grid so they don't clump.
  const n = rng.int(6, 10);
  const gc = Math.max(2, Math.round(Math.sqrt((n * W) / H)));
  const gr = Math.ceil(n / gc);
  const cells = rng.shuffle(Array.from({ length: gc * gr }, (_, i) => i)).slice(0, n);
  const kinds = [];
  ctx.save();
  ctx.shadowColor = 'rgba(25,18,10,0.25)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  for (const cell of cells) {
    const x = ((cell % gc) + 0.5 + rng.float(-0.35, 0.35)) * (W / gc);
    const y = (Math.floor(cell / gc) + 0.5 + rng.float(-0.35, 0.35)) * (H / gr);
    const behind = colourAt(x, y);
    const c = vary(rng, pickColour(rng, all, [behind], 120), 0.03);
    const kind = rng.weighted([['frond', 4], ['leaf', 3], ['star', 1.5], ['flower', 1.2], ['dots', 0.8], ['stem', 1]]);
    kinds.push(kind);
    const angle = rng.float(0, TAU);
    ctx.fillStyle = css(c);
    if (kind === 'frond' || kind === 'leaf') {
      const len = S * (kind === 'frond' ? rng.float(0.3, 0.5) : rng.float(0.18, 0.3));
      const width = len * (kind === 'frond' ? rng.float(0.18, 0.28) : rng.float(0.2, 0.32));
      const bx = x - (Math.cos(angle) * len) / 2;
      const by = y - (Math.sin(angle) * len) / 2;
      const spine = leafShape(ctx, rng, bx, by, len, width, angle, kind === 'frond');
      ctx.fill();
      if (kind === 'leaf' && rng.chance(0.7)) {
        // Cut midrib, showing the paper behind.
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.strokeStyle = css(behind);
        ctx.lineWidth = Math.max(1.5, width * 0.08);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(spine[0][0], spine[0][1]);
        smoothOpen(ctx, spine.slice(0, Math.round(spine.length * 0.85)));
        ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'star') {
      const R = S * rng.float(0.08, 0.14);
      const k = rng.int(5, 9);
      const ph = rng.float(0, TAU);
      const pts = [];
      for (let i = 0; i < k * 12; i++) {
        const a = (i / (k * 12)) * TAU;
        const r = R * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos((a * k) / 2 + ph)), 1.6)) * rng.float(0.97, 1.03);
        pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      ctx.beginPath();
      smoothClosed(ctx, pts);
      ctx.fill();
    } else if (kind === 'flower') {
      const R = S * rng.float(0.06, 0.1);
      const petals = rng.int(5, 8);
      for (let i = 0; i < petals; i++) {
        const a = angle + (i / petals) * TAU;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * R * 0.55, y + Math.sin(a) * R * 0.55, R * 0.55, R * 0.27, a, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = css(pickColour(rng, all, [c, behind], 100));
      ctx.beginPath();
      wobblyCircle(ctx, rng, x, y, R * 0.28, 0.04);
      ctx.fill();
    } else if (kind === 'dots') {
      const R = S * rng.float(0.05, 0.09);
      for (let i = rng.int(5, 9); i > 0; i--) {
        ctx.beginPath();
        wobblyCircle(ctx, rng, x + rng.float(-R, R), y + rng.float(-R, R), S * rng.float(0.01, 0.022), 0.05);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = css(c);
      ctx.lineWidth = S * rng.float(0.012, 0.022);
      ctx.lineCap = 'round';
      const len = S * rng.float(0.25, 0.45);
      const ex = x + Math.cos(angle) * len;
      const ey = y + Math.sin(angle) * len;
      const bend = rng.float(-0.3, 0.3) * len;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo((x + ex) / 2 - Math.sin(angle) * bend, (y + ey) / 2 + Math.cos(angle) * bend, ex, ey);
      ctx.stroke();
      for (let i = rng.int(2, 4); i > 0; i--) {
        const t = rng.float(0.25, 0.9);
        const lx = x + (ex - x) * t;
        const ly = y + (ey - y) * t;
        leafShape(ctx, rng, lx, ly, len * 0.28, len * 0.08, angle + rng.sign() * rng.float(0.5, 1.1), false);
        ctx.fill();
      }
    }
  }
  ctx.restore();
  return { kinds, colours: [first] };
}

/**
 * Builds a leaf (pointed both ends) or a lobed Matisse frond along a curved spine starting at
 * (x, y). Leaves the path ready to fill; returns the spine points.
 */
function leafShape(ctx, rng, x, y, len, width, angle, lobed) {
  const ex = x + Math.cos(angle) * len;
  const ey = y + Math.sin(angle) * len;
  const bend = rng.float(-0.3, 0.3) * len;
  const cx = (x + ex) / 2 - Math.sin(angle) * bend;
  const cy = (y + ey) / 2 + Math.cos(angle) * bend;
  const lobes = rng.int(3, 6);
  const phL = rng.float(0, TAU);
  const phR = phL + Math.PI * rng.float(0.3, 0.7);
  const asym = rng.float(0.85, 1.15);
  const N = lobed ? 72 : 36;
  const left = [];
  const right = [];
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const px = mt * mt * x + 2 * mt * t * cx + t * t * ex;
    const py = mt * mt * y + 2 * mt * t * cy + t * t * ey;
    let tx = 2 * mt * (cx - x) + 2 * t * (ex - cx);
    let ty = 2 * mt * (cy - y) + 2 * t * (ey - cy);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let wl;
    let wr;
    if (lobed) {
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.7) * (1 - 0.3 * t);
      wl = width * env * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(t * lobes * Math.PI + phL)), 0.55));
      wr = width * env * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(t * lobes * Math.PI + phR)), 0.55));
    } else {
      const env = Math.pow(Math.sin(Math.PI * t), 0.85) * (1 - 0.15 * t);
      wl = width * 0.5 * env * asym;
      wr = (width * 0.5 * env) / asym;
    }
    spine.push([px, py]);
    left.push([px - ty * wl, py + tx * wl]);
    right.push([px + ty * wr, py - tx * wr]);
  }
  ctx.beginPath();
  smoothClosed(ctx, [...left, ...right.reverse()]);
  return spine;
}

// =============================================================================================
// Style 6 — concentric arches / rainbows / striped sunsets
// =============================================================================================

function archPath(ctx, rng, cx, baseY, r, legs, amt) {
  ctx.moveTo(cx - r, baseY);
  ctx.lineTo(cx - r, baseY - legs);
  wobblyArc(ctx, rng, cx, baseY - legs, r, Math.PI, TAU, amt);
  ctx.lineTo(cx + r, baseY);
  ctx.closePath();
}

function paintArches(ctx, W, H, rng, pal) {
  const cols = pal.colors;
  const S = Math.min(W, H);
  const ground = rng.chance(0.75) ? pal.bg : lighten(rng.pick(cols), 0.6);
  ctx.fillStyle = css(ground);
  ctx.fillRect(0, 0, W, H);
  const seq = rng.shuffle(cols.filter((c) => colourDist(c, ground) > 60)).slice(0, rng.int(3, 5));
  const variant = rng.weighted([['rainbow', 3], ['row', 2], ['sunset', 2]]);
  const amt = 0.006;
  let bandsTotal = 0;

  if (variant === 'rainbow') {
    const groundBand = rng.chance(0.55);
    const baseY = groundBand ? H * rng.float(0.74, 0.86) : H + 2;
    if (groundBand) {
      ctx.fillStyle = css(vary(rng, pickColour(rng, cols, [ground, seq[0]], 80), 0.02));
      ctx.beginPath();
      wobblyRect(ctx, rng, -4, baseY - 1, W + 8, H - baseY + 6, S * 0.002);
      ctx.fill();
    }
    if (rng.chance(0.5)) {
      const sr = S * rng.float(0.05, 0.09);
      ctx.fillStyle = css(pickColour(rng, cols, [ground], 110));
      ctx.beginPath();
      wobblyCircle(ctx, rng, W * rng.float(0.15, 0.85), H * rng.float(0.1, 0.22), sr, 0.01);
      ctx.fill();
    }
    const cx = W * rng.float(0.4, 0.6);
    const R = Math.min(W * 0.44, baseY * 0.72);
    const legs = rng.chance(0.5) ? rng.float(0.05, 0.18) * H : 0;
    const bands = rng.int(4, 7);
    const bw = R / (bands + rng.float(0.6, 1.6));
    for (let i = 0; i <= bands; i++) {
      ctx.beginPath();
      archPath(ctx, rng, cx, baseY, R - i * bw, legs, amt);
      ctx.fillStyle = css(i === bands ? ground : vary(rng, seq[i % seq.length], 0.03));
      ctx.fill();
    }
    bandsTotal = bands;
  } else if (variant === 'row') {
    const m = rng.int(2, 3);
    const cellW = W / m;
    const R = cellW * rng.float(0.36, 0.44);
    const topY = H * rng.float(0.28, 0.45);
    const baseY = H + 2;
    const legs = baseY - topY - R;
    for (let j = 0; j < m; j++) {
      const bands = rng.int(3, 5);
      const bw = R / (bands + 1);
      const cx = cellW * (j + 0.5);
      for (let i = 0; i <= bands; i++) {
        ctx.beginPath();
        archPath(ctx, rng, cx, baseY, R - i * bw, legs, amt);
        ctx.fillStyle = css(i === bands ? ground : vary(rng, seq[(i + j) % seq.length], 0.03));
        ctx.fill();
      }
      bandsTotal = Math.max(bandsTotal, bands);
    }
    if (rng.chance(0.6)) {
      ctx.fillStyle = css(pickColour(rng, cols, [ground], 110));
      ctx.beginPath();
      wobblyCircle(ctx, rng, W * rng.float(0.2, 0.8), topY * rng.float(0.35, 0.6), S * rng.float(0.05, 0.08), 0.01);
      ctx.fill();
    }
  } else {
    // Striped sunset: half sun on a horizon over banded water.
    const horizon = H * rng.float(0.55, 0.66);
    const skyCol = pickColour(rng, cols, [], 0);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, css(ground));
    sky.addColorStop(1, css(mix(ground, skyCol, 0.35)));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);
    const R = S * rng.float(0.26, 0.36);
    const cx = W * rng.float(0.35, 0.65);
    const rings = rng.int(3, 5);
    const sunSeq = [...seq].sort((a, b) => luma(a) - luma(b));
    for (let i = 0; i < rings; i++) {
      ctx.beginPath();
      archPath(ctx, rng, cx, horizon + 1, R * (1 - i / rings), 0, amt);
      ctx.fillStyle = css(vary(rng, sunSeq[i % sunSeq.length], 0.03));
      ctx.fill();
    }
    const seaA = pickColour(rng, cols, [sunSeq[0]], 60);
    const seaB = pickColour(rng, cols, [seaA], 90);
    let y = horizon;
    let k = 0;
    while (y < H) {
      const h = (H - horizon) * (0.05 + 0.1 * ((y - horizon) / (H - horizon))) * rng.float(0.8, 1.2);
      ctx.beginPath();
      wobblyRect(ctx, rng, -4, y, W + 8, h + 1, S * 0.003);
      ctx.fillStyle = css(vary(rng, k % 2 ? seaB : seaA, 0.03));
      ctx.fill();
      y += h;
      k++;
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const yy = horizon + 6 + i * ((H - horizon) / 10);
      const w = R * (1.4 - i * 0.1) * rng.float(0.6, 1);
      ctx.strokeStyle = css(sunSeq[sunSeq.length - 1], 0.7);
      ctx.lineWidth = S * 0.008;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, yy);
      ctx.lineTo(cx + w / 2, yy);
      ctx.stroke();
    }
    bandsTotal = rings;
  }
  return { variant, bands: bandsTotal, colours: seq };
}

// =============================================================================================
// Style 7 — still life: vessel and fruit on a table, side-lit, with cast shadows
// =============================================================================================

const FRUITS = [
  { name: 'Lemons', colour: [236, 196, 64], shape: 'lemon', size: 1 },
  { name: 'Oranges', colour: [234, 128, 40], shape: 'round', size: 1 },
  { name: 'Apples', colour: [190, 52, 46], shape: 'round', size: 1 },
  { name: 'Pears', colour: [178, 186, 84], shape: 'pear', size: 1.15 },
  { name: 'Plums', colour: [100, 46, 90], shape: 'round', size: 0.75 },
  { name: 'Figs', colour: [92, 58, 86], shape: 'fig', size: 0.9 },
  { name: 'Clementines', colour: [240, 142, 52], shape: 'round', size: 0.8 },
  { name: 'Quinces', colour: [224, 192, 84], shape: 'pear', size: 1.1 },
];

// Right-hand profiles: [half-width, height] as fractions of the vessel height, base to rim.
const VESSELS = {
  Vase: [[0.17, 0], [0.24, 0.12], [0.27, 0.38], [0.21, 0.62], [0.11, 0.78], [0.09, 0.92], [0.13, 1]],
  Jug: [[0.21, 0], [0.27, 0.22], [0.28, 0.5], [0.22, 0.75], [0.17, 0.9], [0.2, 1]],
  Bottle: [[0.13, 0], [0.14, 0.5], [0.12, 0.6], [0.05, 0.72], [0.045, 0.95], [0.055, 1]],
  Pot: [[0.26, 0], [0.34, 0.25], [0.37, 0.55], [0.31, 0.85], [0.28, 1]],
};

function paintStillLife(ctx, W, H, rng, pal) {
  const cols = pal.colors;
  const ink = pal.ink;
  const light = rng.chance(0.7) ? -1 : 1; // -1: light from the left
  const wallBase = rng.pick(cols.filter((c) => luma(c) > 0.3).concat([pal.bg]));
  const wall = mix(wallBase, pal.bg, rng.float(0.15, 0.5));
  const tableY = H * rng.float(0.6, 0.7);
  const edgeY = tableY + (H - tableY) * rng.float(0.5, 0.68);

  // Wall, with broad brushwork.
  const wg = ctx.createLinearGradient(light < 0 ? 0 : W, 0, light < 0 ? W : 0, tableY);
  wg.addColorStop(0, css(lighten(wall, 0.06)));
  wg.addColorStop(1, css(darken(wall, 0.12)));
  ctx.fillStyle = wg;
  ctx.fillRect(0, 0, W, tableY + 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, tableY);
  ctx.clip();
  for (let i = 0; i < 34; i++) {
    const x = rng.float(-0.1, 1) * W;
    const y = rng.float(-0.1, 1) * tableY;
    const a = rng.float(-1.2, 1.2) + Math.PI / 2;
    const len = rng.float(60, 200);
    brush(ctx, rng, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.float(20, 50), vary(rng, wall, 0.05), 0.12);
  }
  ctx.restore();

  // Table top and front edge.
  const table = pickColour(rng, cols, [wall], 90);
  const tg = ctx.createLinearGradient(0, tableY, 0, edgeY);
  tg.addColorStop(0, css(mix(table, wall, 0.25)));
  tg.addColorStop(1, css(lighten(table, 0.06)));
  ctx.fillStyle = tg;
  ctx.fillRect(0, tableY, W, edgeY - tableY);
  ctx.fillStyle = css(mix(table, ink, 0.38));
  ctx.fillRect(0, edgeY, W, H - edgeY);
  ctx.fillStyle = css(lighten(table, 0.25), 0.6);
  ctx.fillRect(0, edgeY - 1, W, 2);

  // A cloth draped over the edge.
  let cloth = null;
  if (rng.chance(0.5)) {
    cloth = pickColour(rng, cols.concat([pal.bg]), [table, wall], 90);
    const x0 = W * rng.float(-0.1, 0.4);
    const x1 = x0 + W * rng.float(0.35, 0.6);
    const drop = H + 4;
    ctx.beginPath();
    ctx.moveTo(x0 + W * 0.04, tableY + (edgeY - tableY) * 0.25);
    ctx.lineTo(x1 - W * 0.02, tableY + (edgeY - tableY) * 0.2);
    ctx.lineTo(x1 + W * 0.02, edgeY);
    wobblyLine(ctx, rng, x1 + W * 0.02, edgeY, x1 + W * 0.01, drop, 6);
    wobblyLine(ctx, rng, x1 + W * 0.01, drop, x0 - W * 0.01, drop, 6);
    wobblyLine(ctx, rng, x0 - W * 0.01, drop, x0, edgeY, 6);
    ctx.closePath();
    ctx.fillStyle = css(cloth);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = css(mix(cloth, ink, 0.25), 0.5);
    ctx.fillRect(x0 - W * 0.05, edgeY, x1 - x0 + W * 0.1, H - edgeY);
    for (let i = 0; i < 7; i++) {
      const fx = x0 + (x1 - x0) * rng.float(0.05, 0.95);
      const dark = rng.chance(0.5);
      brush(ctx, rng, fx, edgeY - (edgeY - tableY) * 0.3, fx + rng.float(-10, 10), H, rng.float(6, 16), dark ? mix(cloth, ink, 0.35) : lighten(cloth, 0.25), 0.28);
    }
    ctx.restore();
  }

  // Objects: a vessel and some fruit (sometimes in a bowl).
  const backY = tableY + (edgeY - tableY) * rng.float(0.32, 0.45);
  const frontY = tableY + (edgeY - tableY) * rng.float(0.72, 0.85);
  const fruit = rng.pick(FRUITS);
  const vesselType = rng.weighted([['Vase', 3], ['Jug', 3], ['Bottle', 2], ['Pot', 1.5], ['Bowl', 2.5]]);
  const vesselCol = pickColour(rng, cols.concat([pal.bg]), [wall, table], 80);
  const fruitCol = mix(fruit.colour, nearestColour(cols, fruit.colour), 0.35); // natural, nudged towards the palette
  const shadowCol = mix(table, ink, 0.6);
  const vx = W * rng.float(0.32, 0.6);
  const fr = Math.min(W, H) * 0.055 * fruit.size * rng.float(0.9, 1.15);
  let flowers = null;

  if (vesselType === 'Bowl') {
    const rx = Math.min(W, H) * rng.float(0.2, 0.26);
    const depth = rx * rng.float(0.45, 0.6);
    const rimY = backY + (frontY - backY) * 0.5 - depth;
    castShadow(ctx, vx, rimY + depth, rx * 1.1, light, shadowCol);
    drawBowl(ctx, rng, vx, rimY, rx, depth, vesselCol, light, ink, () => {
      const k = rng.int(3, 4);
      for (let i = 0; i < k; i++) {
        const t = k === 1 ? 0.5 : i / (k - 1);
        const x = vx - rx * 0.55 + t * rx * 1.1 + rng.float(-4, 4);
        const y = rimY - fr * rng.float(0.1, 0.6) + Math.abs(t - 0.5) * fr * 0.4;
        drawFruit(ctx, rng, fruit, x, y, fr, vary(rng, fruitCol, 0.04), light, ink);
      }
    });
  } else {
    const h = H * (vesselType === 'Bottle' ? rng.float(0.42, 0.5) : vesselType === 'Pot' ? rng.float(0.22, 0.28) : rng.float(0.3, 0.4));
    castShadow(ctx, vx, backY, h * 0.32, light, shadowCol);
    if (vesselType !== 'Pot' && rng.chance(0.45)) flowers = drawFlowers(ctx, rng, vx, backY - h * 0.95, h, cols, pal, vesselCol);
    drawVessel(ctx, rng, vesselType, vx, backY, h, vesselCol, light, ink);
  }

  // Loose fruit at the front.
  const loose = vesselType === 'Bowl' ? rng.int(1, 2) : rng.int(2, 4);
  const side = rng.chance(0.5) ? 1 : -1;
  const placed = [];
  for (let i = 0; i < loose; i++) {
    const x = vx + side * (Math.min(W, H) * 0.12 + i * fr * rng.float(1.5, 2.1)) + rng.float(-6, 6);
    const y = frontY - fr + rng.float(-0.3, 0.2) * fr;
    placed.push([x, y]);
  }
  placed.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of placed) {
    castShadow(ctx, x, y + fr, fr * 1.1, light, shadowCol);
    drawFruit(ctx, rng, fruit, x, y, fr, vary(rng, fruitCol, 0.04), light, ink);
  }
  return { fruit: fruit.name, vessel: vesselType, flowers, cloth: cloth && colourName(cloth), colours: [wall, vesselCol] };
}

function nearestColour(list, c) {
  let best = list[0];
  let bestD = Infinity;
  for (const x of list) {
    const d = colourDist(x, c);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}

function castShadow(ctx, x, y, w, light, colour) {
  softFill(ctx, css(colour, 0.35), Math.max(6, w * 0.25), () => {
    ctx.beginPath();
    ctx.ellipse(x - light * w * 0.45, y - w * 0.04, w * 1.05, w * 0.16, 0, 0, TAU);
  });
}

/** Horizontal shading across a rounded object: highlight on the lit side, core shadow opposite. */
function bodyGradient(ctx, x0, x1, c, light, ink) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const lit = lighten(c, 0.22);
  const dark = mix(c, ink, 0.42);
  const stops = [
    [0, mix(c, ink, 0.2)],
    [0.28, lit],
    [0.55, c],
    [0.86, dark],
    [1, mix(c, ink, 0.3)],
  ];
  for (const [t, col] of stops) g.addColorStop(light < 0 ? t : 1 - t, css(col));
  return g;
}

function drawVessel(ctx, rng, type, cx, baseY, h, c, light, ink) {
  const prof = VESSELS[type].map(([x, y]) => [x * h * rng.float(0.92, 1.08), y * h]);
  const maxW = Math.max(...prof.map((p) => p[0]));
  const rim = prof[prof.length - 1];
  const right = prof.map(([x, y]) => [cx + x, baseY - y]);
  const left = prof.map(([x, y]) => [cx - x, baseY - y]).reverse();
  if (type === 'Jug') {
    // Handle on the shadow side, drawn first so the body overlaps it.
    const s = light < 0 ? 1 : -1;
    ctx.save();
    ctx.strokeStyle = css(mix(c, ink, 0.3));
    ctx.lineWidth = h * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + s * prof[4][0] * 0.9, baseY - h * 0.86);
    ctx.bezierCurveTo(cx + s * maxW * 1.75, baseY - h * 0.85, cx + s * maxW * 1.6, baseY - h * 0.35, cx + s * maxW * 0.9, baseY - h * 0.3);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(right[0][0], right[0][1]);
  smoothOpen(ctx, right);
  smoothOpen(ctx, left);
  ctx.closePath();
  ctx.fillStyle = bodyGradient(ctx, cx - maxW, cx + maxW, c, light, ink);
  ctx.fill();
  // Specular highlight and opening.
  ctx.save();
  ctx.clip();
  softFill(ctx, 'rgba(255,255,255,0.35)', 8, () => {
    ctx.beginPath();
    ctx.ellipse(cx + light * maxW * 0.45, baseY - h * 0.45, maxW * 0.08, h * 0.18, 0, 0, TAU);
  });
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(cx, baseY - h, rim[0], rim[0] * 0.28, 0, 0, TAU);
  ctx.fillStyle = css(mix(c, ink, 0.6));
  ctx.fill();
  ctx.strokeStyle = css(lighten(c, 0.25), 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawBowl(ctx, rng, cx, rimY, rx, depth, c, light, ink, drawContents) {
  const ry = rx * 0.2;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rx, ry, 0, 0, TAU);
  ctx.fillStyle = css(mix(c, ink, 0.45));
  ctx.fill();
  drawContents();
  ctx.beginPath();
  ctx.moveTo(cx - rx, rimY);
  ctx.bezierCurveTo(cx - rx, rimY + depth * 0.85, cx - rx * 0.5, rimY + depth, cx - rx * 0.32, rimY + depth);
  ctx.lineTo(cx + rx * 0.32, rimY + depth);
  ctx.bezierCurveTo(cx + rx * 0.5, rimY + depth, cx + rx, rimY + depth * 0.85, cx + rx, rimY);
  ctx.ellipse(cx, rimY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = bodyGradient(ctx, cx - rx, cx + rx, c, light, ink);
  ctx.fill();
  ctx.strokeStyle = css(lighten(c, 0.3), 0.85);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, rx, ry, 0, 0, Math.PI, false);
  ctx.stroke();
  if (rng.chance(0.6)) {
    ctx.strokeStyle = css(mix(c, ink, 0.25), 0.7);
    ctx.lineWidth = rx * 0.05;
    ctx.beginPath();
    ctx.ellipse(cx, rimY + depth * 0.32, rx * 0.93, ry * 0.95, 0, 0.15, Math.PI - 0.15, false);
    ctx.stroke();
  }
}

function drawFruit(ctx, rng, fruit, x, y, r, c, light, ink) {
  ctx.beginPath();
  if (fruit.shape === 'lemon') {
    const rot = rng.float(-0.35, 0.35);
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const tip = 1 + 0.18 * Math.pow(Math.abs(Math.cos(a)), 16);
      const px = Math.cos(a) * r * 1.22 * tip;
      const py = Math.sin(a) * r * 0.9;
      pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
    smoothClosed(ctx, pts);
  } else if (fruit.shape === 'pear') {
    const lean = rng.float(-0.35, 0.35) * r;
    twoCircleHull(ctx, x, y + r * 0.3, r, x + lean, y - r * 0.75, r * 0.55);
  } else if (fruit.shape === 'fig') {
    twoCircleHull(ctx, x, y + r * 0.1, r * 0.95, x + rng.float(-0.2, 0.2) * r, y - r * 0.85, r * 0.22);
  } else {
    wobblyCircle(ctx, rng, x, y, r, 0.025);
  }
  const g = ctx.createRadialGradient(x + light * r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.25);
  g.addColorStop(0, css(lighten(c, 0.42)));
  g.addColorStop(0.3, css(lighten(c, 0.08)));
  g.addColorStop(0.72, css(c));
  g.addColorStop(1, css(mix(c, ink, 0.5)));
  ctx.fillStyle = g;
  ctx.fill();
  // Stalk.
  if (fruit.shape !== 'lemon') {
    const top = fruit.shape === 'pear' ? y - r * 1.25 : fruit.shape === 'fig' ? y - r * 1.05 : y - r * 0.9;
    ctx.strokeStyle = css(mix([90, 60, 30], ink, 0.3));
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, top + r * 0.1);
    ctx.quadraticCurveTo(x + r * 0.05, top - r * 0.15, x + r * 0.2, top - r * 0.25);
    ctx.stroke();
  }
}

function drawFlowers(ctx, rng, cx, topY, h, cols, pal, vesselCol) {
  const kind = rng.pick(['Anemones', 'Tulips', 'Daisies', 'Poppies']);
  const stemCol = mix(rng.pick(cols.filter((c) => c[1] >= c[0] && c[1] >= c[2]).concat([[70, 100, 60]])), pal.ink, 0.35);
  const headCol = pickColour(rng, cols.concat([pal.bg]), [vesselCol], 80);
  const k = rng.int(3, 6);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < k; i++) {
    const a = -Math.PI / 2 + (i / Math.max(1, k - 1) - 0.5) * rng.float(1.2, 1.8);
    const len = h * rng.float(0.35, 0.7);
    const hx = cx + Math.cos(a) * len;
    const hy = topY + Math.sin(a) * len * 0.9;
    ctx.strokeStyle = css(stemCol);
    ctx.lineWidth = Math.max(1.5, h * 0.012);
    ctx.beginPath();
    ctx.moveTo(cx + rng.float(-3, 3), topY + h * 0.1);
    ctx.quadraticCurveTo(cx + (hx - cx) * 0.2, (topY + hy) / 2, hx, hy);
    ctx.stroke();
    const r = h * rng.float(0.06, 0.085);
    const c = vary(rng, headCol, 0.05);
    if (kind === 'Tulips') {
      ctx.fillStyle = css(c);
      ctx.beginPath();
      ctx.moveTo(hx - r, hy - r * 0.9);
      ctx.lineTo(hx - r * 0.35, hy - r * 0.4);
      ctx.lineTo(hx, hy - r * 1.1);
      ctx.lineTo(hx + r * 0.35, hy - r * 0.4);
      ctx.lineTo(hx + r, hy - r * 0.9);
      ctx.quadraticCurveTo(hx + r * 1.05, hy + r * 0.6, hx, hy + r * 0.7);
      ctx.quadraticCurveTo(hx - r * 1.05, hy + r * 0.6, hx - r, hy - r * 0.9);
      ctx.fill();
    } else if (kind === 'Daisies') {
      ctx.fillStyle = css(lighten(pal.bg, 0.4));
      for (let p = 0; p < 10; p++) {
        const pa = (p / 10) * TAU;
        ctx.beginPath();
        ctx.ellipse(hx + Math.cos(pa) * r * 0.7, hy + Math.sin(pa) * r * 0.7, r * 0.6, r * 0.2, pa, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = css([232, 180, 50]);
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.35, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = css(kind === 'Poppies' ? mix(c, [205, 50, 40], 0.5) : c);
      ctx.beginPath();
      wobblyCircle(ctx, rng, hx, hy, r * 1.15, 0.12);
      ctx.fill();
      ctx.fillStyle = css(pal.ink);
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.35, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  return kind;
}

// =============================================================================================
// Style 8 — hand-made geometric tiles: Truchet curves, mid-century motifs, quilt triangles
// =============================================================================================

function paintTiles(ctx, W, H, rng, pal) {
  const cols = pal.colors;
  const S = Math.min(W, H);
  const variant = rng.weighted([['truchet', 3], ['motifs', 3], ['quilt', 2]]);
  const n = variant === 'truchet' ? rng.int(4, 7) : variant === 'quilt' ? rng.int(4, 6) : rng.int(3, 5);
  const ts = S / n;
  const nx = Math.ceil(W / ts);
  const ny = Math.ceil(H / ts);
  const ox = (W - nx * ts) / 2;
  const oy = (H - ny * ts) / 2;
  const groutW = rng.chance(0.75) ? ts * rng.float(0.025, 0.05) : 0;
  const grout = rng.chance(0.6) ? lighten(pal.bg, 0.2) : mix(pal.ink, pal.bg, 0.2);
  ctx.fillStyle = css(grout);
  ctx.fillRect(0, 0, W, H);
  const set = rng.shuffle([...cols, pal.bg]).slice(0, rng.int(3, 4));
  const mirror = rng.chance(0.5);
  const pattern = rng.pick(['random', 'pinwheel', 'diamond']);
  // Truchet arcs must line up across tiles, so their layout is chosen once per painting.
  const truchet = { double: n <= 6 && rng.chance(0.5), width: rng.float(0.24, 0.3) };

  // Decide every tile first (so mirrored halves can copy each other), then paint.
  const specs = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const mi = mirror ? Math.min(i, nx - 1 - i) : i;
      const key = j * nx + mi;
      let spec = specs.find((s) => s.key === key);
      if (!spec || !mirror || mi === i) {
        const bgc = variant === 'truchet' ? set[0] : rng.pick(set);
        let k = rng.int(0, 3);
        if (variant === 'quilt' && pattern === 'pinwheel') k = [0, 1, 3, 2][(i % 2) + 2 * (j % 2)];
        if (variant === 'quilt' && pattern === 'diamond') k = (i < nx / 2 ? 0 : 1) + (j < ny / 2 ? 0 : 2);
        spec = {
          key,
          bgc,
          fg: pickColour(rng, set, [bgc], 70),
          fg2: pickColour(rng, set, [bgc], 40),
          k,
          motif: rng.pick(['quarter', 'half', 'circle', 'diagonal', 'rings', 'stripes', 'leaf', 'dot']),
        };
        specs.push(spec);
      }
      paintTile(ctx, rng, variant, spec, ox + i * ts, oy + j * ts, ts, groutW, mirror && mi !== i, truchet);
    }
  }
  return { variant, colours: set };
}

function paintTile(ctx, rng, variant, spec, x, y, ts, groutW, flip, truchet) {
  const half = (ts - groutW) / 2;
  ctx.save();
  ctx.translate(x + ts / 2 + rng.float(-1, 1) * ts * 0.008, y + ts / 2 + rng.float(-1, 1) * ts * 0.008);
  ctx.rotate(rng.float(-0.012, 0.012));
  if (flip) ctx.scale(-1, 1);
  ctx.beginPath();
  wobblyRect(ctx, rng, -half, -half, 2 * half, 2 * half, ts * 0.006);
  ctx.fillStyle = css(vary(rng, spec.bgc, 0.025));
  ctx.fill();
  ctx.clip();
  ctx.rotate((spec.k * Math.PI) / 2);
  const fg = vary(rng, spec.fg, 0.03);
  ctx.fillStyle = css(fg);
  ctx.strokeStyle = css(fg);
  const h = ts / 2;
  const amt = 0.008;
  if (variant === 'truchet') {
    ctx.lineCap = 'butt';
    const radii = truchet.double ? [ts / 3, (2 * ts) / 3] : [h];
    ctx.lineWidth = truchet.double ? ts * 0.13 : ts * truchet.width;
    for (const [cx, cy, a0] of [[-h, -h, 0], [h, h, Math.PI]]) {
      for (const r of radii) {
        ctx.beginPath();
        wobblyArc(ctx, rng, cx, cy, r, a0, a0 + Math.PI / 2, amt, true);
        ctx.stroke();
      }
    }
  } else if (variant === 'quilt') {
    ctx.beginPath();
    ctx.moveTo(-h - 2, -h - 2);
    ctx.lineTo(h + 2, -h - 2);
    ctx.lineTo(-h - 2, h + 2);
    ctx.closePath();
    ctx.fill();
    if (spec.key % 4 === 1) {
      ctx.fillStyle = css(vary(rng, spec.fg2, 0.03));
      ctx.beginPath();
      ctx.moveTo(-h - 2, -h - 2);
      ctx.lineTo(0, -h - 2);
      ctx.lineTo(-h - 2, 0);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    switch (spec.motif) {
      case 'quarter':
        ctx.moveTo(-h, -h);
        wobblyArc(ctx, rng, -h, -h, ts * 0.92, 0, Math.PI / 2, amt);
        ctx.closePath();
        break;
      case 'half':
        ctx.moveTo(-h, -h);
        wobblyArc(ctx, rng, 0, -h, h, Math.PI, 0, amt);
        ctx.closePath();
        break;
      case 'circle':
        wobblyCircle(ctx, rng, 0, 0, h * 0.62, 0.02);
        break;
      case 'diagonal':
        ctx.moveTo(-h - 2, -h - 2);
        ctx.lineTo(h + 2, -h - 2);
        ctx.lineTo(-h - 2, h + 2);
        ctx.closePath();
        break;
      case 'rings':
        ctx.lineWidth = ts * 0.1;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          wobblyArc(ctx, rng, -h, -h, (ts * i) / 3.4, 0, Math.PI / 2, amt, true);
          ctx.stroke();
        }
        ctx.beginPath();
        break;
      case 'stripes':
        for (let i = 0; i < 3; i++) wobblyRect(ctx, rng, -h - 2, -h + (i * 2 + 0.5) * (ts / 6), ts + 4, ts / 6, ts * 0.004);
        break;
      case 'leaf':
        ctx.moveTo(-h, h);
        ctx.quadraticCurveTo(-h, -h, h, -h);
        ctx.quadraticCurveTo(h, h, -h, h);
        ctx.closePath();
        break;
      default:
        ctx.moveTo(-h, -h);
        wobblyArc(ctx, rng, -h, -h, h * 0.9, 0, Math.PI / 2, amt);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = css(vary(rng, spec.fg2, 0.03));
        ctx.beginPath();
        wobblyCircle(ctx, rng, h * 0.3, h * 0.3, h * 0.28, 0.03);
        break;
    }
    ctx.fill();
  }
  ctx.restore();
}

// =============================================================================================
// Titles
// =============================================================================================

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const NUMBER_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const WATER_PLACES = ['Harbour', 'Bay', 'Lough', 'Estuary', 'Lake', 'Inlet', 'Sound', 'Cove', 'Shore', 'Tidal Flats', 'Mill Pond', 'Low Tide'];
const LAND_PLACES = ['Hills', 'Valley', 'Ridge', 'Fells', 'Moor', 'Uplands', 'Headland', 'Foothills', 'Glen', 'High Pass', 'Downs', 'Far Field'];
const TIMES = {
  dusk: ['Dusk', 'Sundown', 'Evening', 'Gloaming', 'Last Light'],
  day: ['Noon', 'Midday', 'Afternoon', 'High Summer', 'Midsummer'],
  dawn: ['Dawn', 'First Light', 'Morning', 'Daybreak'],
  night: ['Night', 'Moonrise', 'Nightfall', 'Midnight'],
};
const LAND_ADJ = ['Quiet', 'Distant', 'Long', 'Still', 'Far', 'Late', 'Low', 'Pale', 'Silver', 'Blue'];

const titleNumber = (rng) => rng.int(2, 24);

const TITLES = {
  landscape(rng, m) {
    const place = rng.pick(m.kind === 'water' ? WATER_PLACES : LAND_PLACES);
    const time = rng.pick(TIMES[m.mood]);
    const the = /s$/.test(place) ? 'the ' : rng.pick(['the ', '']);
    return rng.pick([
      () => `${place} at ${time}`,
      () => `${time} over the ${place}`,
      () => `${place}, ${rng.pick(MONTHS)}`,
      () => `${rng.pick(LAND_ADJ)} ${place}`,
      () => `${place} after Rain`,
      () => `Looking ${rng.pick(['North', 'South', 'East', 'West'])} from ${the}${place}`,
      () => `${rng.pick(MONTHS)} ${time}`,
      () => `${place} in ${colourName(m.colours[0])}`,
    ])();
  },
  composition(rng, m) {
    const [a, b] = m.colours.map(colourName);
    const shapes = [...new Set(m.shapes)];
    return rng.pick([
      () => `Composition No. ${titleNumber(rng)}`,
      () => `Composition in ${a} and ${b}`,
      () => `Arrangement with ${rng.pick(shapes) || 'Circle'}`,
      () => `Construction ${rng.pick(ROMAN)}`,
      () => `Counterpoint No. ${titleNumber(rng)}`,
      () => (shapes.length > 1 ? `${shapes[0]} and ${shapes[1]}` : 'Equilibrium'),
      () => `Study in ${a} No. ${titleNumber(rng)}`,
      () => rng.pick(['Interval', 'Rhythm in Three Parts', 'Mid-century Morning', 'Study for a Mural', 'Overlap', 'Balance']),
    ])();
  },
  field(rng, m) {
    const [a, b] = m.colours.map(colourName);
    const ground = colourName(m.colours[m.colours.length - 1]);
    return rng.pick([
      () => `Untitled (${a} over ${b})`,
      () => `No. ${titleNumber(rng)} (${a}, ${b})`,
      () => `${a} on ${ground}`,
      () => `Field in ${a} and ${b}`,
      () => `${a} Field`,
      () => `${rng.pick(['Quiet', 'Slow', 'Deep', 'Late'])} ${a}`,
    ])();
  },
  flow(rng, m) {
    const noun = rng.pick([
      'Current', 'Drift Lines', 'Undertow', 'Wind Map', 'Murmuration', 'Field Lines', 'Tidal Study', 'Slipstream',
      'Weather System', 'Eddies', 'Long Exposure', 'Contours', 'Updraught', 'Swell', 'Crosscurrents', 'Riverbed',
      'Combed Water', 'Breathing Room',
    ]);
    return rng.pick([
      () => noun,
      () => `${noun} No. ${titleNumber(rng)}`,
      () => `${noun} in ${colourName(m.colours[0])}`,
      () => `Study for ${noun}`,
    ])();
  },
  cutouts(rng, m) {
    const c = colourName(m.colours[0]);
    return rng.pick([
      () => `Leaves for ${rng.pick(MONTHS)}`,
      () => `The ${rng.pick(['Blue', 'Night', 'Winter', 'Secret', 'Lemon', 'Walled', 'Sunken', 'Hanging'])} Garden`,
      () => `Cut Leaves on ${c}`,
      () => `Botanical No. ${titleNumber(rng)}`,
      () => rng.pick(['Fronds', 'Seaweed Dance', 'Lagoon', 'Algae', 'Palm House', 'Conservatory', 'Green Room',
        'Jungle Interior', 'Sea Garden', 'Coral and Fern', 'Kelp Forest', 'Leaves, Late Summer']),
      () => `Greenhouse in ${rng.pick(MONTHS)}`,
    ])();
  },
  arches(rng, m) {
    const [a, b] = m.colours.map(colourName);
    if (m.variant === 'sunset') {
      return rng.pick([
        () => `Sunset No. ${titleNumber(rng)}`,
        () => `${rng.pick(['Striped', 'Setting', 'Half', 'Low'])} Sun`,
        () => `Sun over ${rng.pick(['Water', 'the Bay', 'the Sea'])}`,
        () => `${a} Sun, ${rng.pick(MONTHS)}`,
      ])();
    }
    return rng.pick([
      () => `Arches No. ${titleNumber(rng)}`,
      () => `${NUMBER_WORDS[Math.min(m.bands, 9) - 1]} Bands`,
      () => `Arch in ${a} and ${b}`,
      () => `${a} Arch`,
      () => rng.pick(['Rainbow Weather', 'Gateway', 'Threshold', 'Sunrise Arches', 'Little Rainbow', 'Doorways',
        'Arcade', 'Bridges', 'After the Storm', 'Portal']),
    ])();
  },
  stillLife(rng, m) {
    const fruit = m.fruit;
    const vessel = m.vessel;
    return rng.pick([
      () => `Still Life with ${fruit}`,
      () => `${fruit} and ${vessel}`,
      () => (vessel === 'Bowl' ? `Bowl of ${fruit}` : `${vessel} with ${fruit}`),
      () => (m.cloth ? `${fruit} on a ${m.cloth} Cloth` : `${fruit} on a Table`),
      () => (m.flowers ? `${vessel} of ${m.flowers}` : `Kitchen Table, ${rng.pick(MONTHS)}`),
      () => (m.flowers ? `${m.flowers} and ${fruit}` : `${fruit} in ${rng.pick(MONTHS)}`),
      () => `The ${colourName(m.colours[1])} ${vessel}`,
    ])();
  },
  tiles(rng, m) {
    const c = colourName(m.colours[1] || m.colours[0]);
    const city = rng.pick(['Lisbon', 'Porto', 'Seville', 'Fez', 'Naples', 'Granada', 'Delft', 'Valencia', 'Palermo']);
    if (m.variant === 'truchet') {
      return rng.pick([() => 'Truchet Variations', () => `Maze in ${c}`, () => 'Garden Path', () => `Meander No. ${titleNumber(rng)}`, () => 'Woven'])();
    }
    if (m.variant === 'quilt') {
      return rng.pick([() => 'Quilt Study', () => `Patchwork No. ${titleNumber(rng)}`, () => 'Pinwheels', () => 'Log Cabin', () => `Quilt in ${c}`])();
    }
    return rng.pick([
      () => `Tiles from ${city}`,
      () => 'Azulejo',
      () => 'Kitchen Floor',
      () => `Mosaic in ${c}`,
      () => `Repeat Pattern ${rng.pick(ROMAN)}`,
      () => `Study in ${c} No. ${titleNumber(rng)}`,
    ])();
  },
};

function uniqueTitle(rng, make, meta, used) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const title = make(rng, meta);
    if (!used.has(title)) {
      used.add(title);
      return title;
    }
  }
  const base = make(rng, meta);
  for (let i = 0; ; i++) {
    const title = `${base} ${ROMAN[i % ROMAN.length]}${i >= ROMAN.length ? ` (${i})` : ''}`;
    if (!used.has(title)) {
      used.add(title);
      return title;
    }
  }
}

// =============================================================================================
// Style registry
// =============================================================================================

const ASPECTS = { square: [1, 1], p45: [4, 5], p34: [3, 4], l54: [5, 4], l32: [3, 2] };

const STYLES = {
  landscape: {
    paint: paintLandscape,
    title: TITLES.landscape,
    aspects: { square: 0.25, p45: 0.15, p34: 0.05, l54: 0.3, l32: 0.25 },
    media: [['Oil on canvas', 'canvas'], ['Acrylic on canvas', 'canvas'], ['Oil on board', 'board'], ['Gouache on paper', 'paper']],
    brushed: 0,
  },
  composition: {
    paint: paintComposition,
    title: TITLES.composition,
    aspects: { square: 0.35, p45: 0.35, p34: 0.15, l54: 0.1, l32: 0.05 },
    media: [['Acrylic on panel', 'board'], ['Screenprint on paper', 'paper'], ['Gouache on paper', 'paper'], ['Acrylic on canvas', 'canvas']],
    brushed: 0.35,
  },
  field: {
    paint: paintColourField,
    title: TITLES.field,
    aspects: { square: 0.1, p45: 0.45, p34: 0.45 },
    media: [['Oil on canvas', 'canvas'], ['Acrylic on linen', 'canvas'], ['Oil and acrylic on canvas', 'canvas']],
    brushed: 0,
  },
  flow: {
    paint: paintFlowField,
    title: TITLES.flow,
    aspects: { square: 0.35, p45: 0.3, p34: 0.1, l54: 0.15, l32: 0.1 },
    options: (rng) => ({ dark: rng.chance(0.3) }),
    media: ({ dark }) =>
      dark
        ? [['White ink on black paper', 'paper'], ['Gel pen on black paper', 'paper']]
        : [['Ink on paper', 'paper'], ['Pen and ink on paper', 'paper'], ['Fineliner on paper', 'paper']],
    brushed: 0,
  },
  cutouts: {
    paint: paintCutouts,
    title: TITLES.cutouts,
    aspects: { square: 0.3, p45: 0.35, p34: 0.15, l54: 0.1, l32: 0.1 },
    media: [['Cut paper and gouache', 'paper'], ['Collage on paper', 'paper'], ['Gouache on paper', 'paper'], ['Painted paper collage', 'paper']],
    brushed: 0.3,
  },
  arches: {
    paint: paintArches,
    title: TITLES.arches,
    aspects: { square: 0.35, p45: 0.4, p34: 0.15, l54: 0.1 },
    media: [['Acrylic on canvas', 'canvas'], ['Gouache on paper', 'paper'], ['Acrylic on board', 'board']],
    brushed: 0.35,
  },
  stillLife: {
    paint: paintStillLife,
    title: TITLES.stillLife,
    aspects: { square: 0.3, p45: 0.4, p34: 0.1, l54: 0.15, l32: 0.05 },
    media: [['Oil on canvas', 'canvas'], ['Oil on board', 'board'], ['Oil on linen', 'canvas'], ['Soft pastel on paper', 'paper']],
    brushed: 0.2,
  },
  tiles: {
    paint: paintTiles,
    title: TITLES.tiles,
    aspects: { square: 0.45, p45: 0.3, p34: 0.1, l54: 0.1, l32: 0.05 },
    media: [['Gouache on paper', 'paper'], ['Acrylic on panel', 'board'], ['Watercolour and gouache on paper', 'paper']],
    brushed: 0.3,
  },
};
