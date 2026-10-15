import { ROOMS, roomSide, wallsOnLine } from '../world/floorplan.js';
import { subtractRange } from '../world/house.js';

const CORNER = 0.42; // keep clear of room corners (includes half a wall thickness)
const OPEN_MARGIN = 0.3; // clearance either side of doors/windows (architraves etc.)
const MIN_SPAN = 0.9; // narrowest stretch of wall that can still take a small piece
const GAP = 0.5; // minimum gap between neighbouring frames

// Progressively denser hanging schemes, tried in order until every work fits.
// maxW/maxH are the outer frame limits in metres.
const SCHEMES = [
  { rows: 1, maxW: 1.3, maxH: 1.2 },
  { rows: 1, maxW: 1.0, maxH: 0.95 },
  { rows: 2, maxW: 0.85, maxH: 0.72 },
  { rows: 2, maxW: 0.66, maxH: 0.56 },
  { rows: 3, maxW: 0.52, maxH: 0.46 },
];
const ROW_Y = { 1: [1.58], 2: [2.08, 1.08], 3: [2.36, 1.6, 0.84] };
const HERO = { maxW: 2.0, maxH: 1.75 };

/**
 * Every stretch of wall that can hold art, in walking-tour order.
 * dir = +1/-1: which way along the wall axis reads "left to right" when facing the wall.
 */
export function computeSpans() {
  const spans = [];
  for (const room of ROOMS) {
    for (const side of room.artOrder) {
      if (room.noArt.includes(side)) continue;
      const s = roomSide(room, side);
      const walls = wallsOnLine(s.axis, s.coord, s.from, s.to);
      if (!walls.length) continue;
      const n = s.axis === 'x' ? s.nz : s.nx;
      const face = s.coord + (n * walls[0].t) / 2;
      let free = [[s.from + CORNER, s.to - CORNER]];
      for (const w of walls) {
        for (const o of w.openings) free = subtractRange(free, o.c - o.w / 2 - OPEN_MARGIN, o.c + o.w / 2 + OPEN_MARGIN);
      }
      // right-hand direction when facing the wall is (nz, -nx)
      const dir = s.axis === 'x' ? s.nz : -s.nx;
      if (dir < 0) free.reverse();
      for (const [a, b] of free) {
        if (b - a < MIN_SPAN) continue;
        spans.push({ room, side, axis: s.axis, face, a, b, dir, nx: s.nx, nz: s.nz, hero: room.hero.includes(side) });
      }
    }
  }
  return spans;
}

function capacity(span, scheme) {
  if (span.hero && scheme.rows === 1) return 1;
  const L = span.b - span.a;
  const perRow = Math.max(L >= MIN_SPAN ? 1 : 0, Math.floor((L + GAP) / (scheme.maxW + GAP)));
  return perRow * scheme.rows;
}

// Rooms nearer the start of the tour get slightly more art when there isn't enough to go round.
const ROOM_WEIGHT = { foyer: 1.35, gallery: 1.25, living: 1.1, studio: 1.05, garden: 1.0, library: 1.0 };
const PITCH = 2.4; // comfortable centre-to-centre spacing for single-row hanging

/**
 * Each stretch of wall has a natural number of works (≈ one per 2.4 m). With fewer works
 * than that, they're shared out proportionally (largest remainder) so every room gets some
 * and the narrowest stretches stay empty first; with more, the roomiest walls get denser.
 */
function allocate(spans, caps, n, scheme) {
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const heroFirst = n >= 6;
  const desired = spans.map((s, i) => {
    if (!caps[i]) return 0;
    if (scheme.rows > 1) return caps[i];
    if (s.hero) return 1;
    return Math.min(caps[i], Math.max(1, Math.round((s.b - s.a) / PITCH)));
  });
  const priority = spans.map((s) => (s.b - s.a) * (ROOM_WEIGHT[s.room.id] ?? 1) + (s.hero && heroFirst ? 1000 : 0));
  const total = sum(desired);
  if (n <= total) {
    const ideal = desired.map((d) => (n * d) / total);
    const counts = ideal.map((v) => Math.floor(v + 1e-9));
    let rem = n - sum(counts);
    const frac = (i) => ideal[i] - counts[i] + (spans[i].hero && heroFirst ? 1 : 0);
    const order = spans
      .map((_, i) => i)
      .sort((a, b) => {
        const d = frac(b) - frac(a);
        return Math.abs(d) > 1e-9 ? d : priority[b] - priority[a];
      });
    for (const i of order) {
      if (rem <= 0) break;
      if (counts[i] < desired[i]) {
        counts[i]++;
        rem--;
      }
    }
    return counts;
  }
  const counts = desired.slice();
  let rem = n - total;
  while (rem > 0) {
    let best = -1;
    let bestScore = -Infinity;
    spans.forEach((s, i) => {
      if (counts[i] >= caps[i]) return;
      const score = ((s.b - s.a) / (counts[i] + 1)) * (ROOM_WEIGHT[s.room.id] ?? 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) break;
    counts[best]++;
    rem--;
  }
  return counts;
}

function rotationFor(span) {
  if (span.nz === 1) return 0;
  if (span.nz === -1) return Math.PI;
  return span.nx === 1 ? Math.PI / 2 : -Math.PI / 2;
}

/**
 * Assigns works to wall positions.
 * Returns { placements: [{ work, x, y, z, rotY, maxW, maxH, hero, rows, room }], dropped }.
 */
export function layoutArt(spans, works) {
  const n = works.length;
  let scheme = SCHEMES[SCHEMES.length - 1];
  let caps = spans.map((s) => capacity(s, scheme));
  for (const sc of SCHEMES) {
    const c = spans.map((s) => capacity(s, sc));
    if (c.reduce((a, b) => a + b, 0) >= n) {
      scheme = sc;
      caps = c;
      break;
    }
  }
  const counts = allocate(spans, caps, n, scheme);

  // Featured works go to hero walls; everything else follows the walking tour in order.
  const queue = works.slice();
  const heroIdx = spans.map((s, i) => (s.hero && scheme.rows === 1 && counts[i] > 0 ? i : -1)).filter((i) => i >= 0);
  const heroWorks = new Map();
  for (const i of heroIdx) {
    const f = queue.findIndex((w) => w.featured);
    if (f >= 0) heroWorks.set(i, queue.splice(f, 1)[0]);
  }

  const placements = [];
  spans.forEach((span, i) => {
    const count = counts[i];
    if (!count) return;
    const isHero = span.hero && scheme.rows === 1;
    const rowsWanted = isHero ? 1 : scheme.rows;
    const cols = Math.ceil(count / rowsWanted);
    const rows = Math.ceil(count / cols);
    const L = span.b - span.a;
    const slotW = L / cols;
    let maxW;
    let maxH;
    if (isHero) {
      maxW = Math.min(HERO.maxW, L - 0.3);
      maxH = HERO.maxH;
    } else {
      maxW = Math.min(scheme.maxW, slotW - (cols > 1 ? GAP : 0.1));
      maxH = scheme.maxH;
    }
    const ys = ROW_Y[rows] || ROW_Y[1];
    let k = 0;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (k >= count) break;
        const work = isHero && heroWorks.has(i) ? heroWorks.get(i) : queue.shift();
        k++;
        if (!work) continue;
        const t = (c + 0.5) / cols;
        const along = span.dir > 0 ? span.a + L * t : span.b - L * t;
        const x = span.axis === 'x' ? along : span.face;
        const z = span.axis === 'x' ? span.face : along;
        placements.push({ work, x, y: ys[r], z, rotY: rotationFor(span), maxW, maxH, hero: isHero, rows, room: span.room });
      }
    }
  });
  return { placements, dropped: queue.length };
}
