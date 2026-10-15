import * as THREE from 'three';
import { WALLS, ROOMS, WALL_HEIGHT as H, HOUSE, EXT_T, INT_T, roomSide, wallsOnLine, roomAt } from './floorplan.js';
import { GeometryBucket } from './geometry.js';
import * as T from './textures.js';

export const CEILING_T = 0.25;
export const EAVE_Y = H + CEILING_T;
const ROOF_PITCH = THREE.MathUtils.degToRad(27);
const SKIRTING_H = 0.13;
const SKIRTING_D = 0.018;
const ARCHITRAVE_W = 0.075;
const ARCHITRAVE_D = 0.02;

/** Subtracts [lo, hi] from a list of [a, b] ranges. */
export function subtractRange(ranges, lo, hi) {
  const out = [];
  for (const [a, b] of ranges) {
    if (hi <= a || lo >= b) {
      out.push([a, b]);
      continue;
    }
    if (lo > a) out.push([a, lo]);
    if (hi < b) out.push([hi, b]);
  }
  return out;
}

class Buckets {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    let b = this.map.get(key);
    if (!b) {
      b = new GeometryBucket();
      this.map.set(key, b);
    }
    return b;
  }
}

// Box spanning [a, b] along a wall axis, [y0, y1] vertically and [d0, d1] across the wall.
function box(bucket, axis, a, b, y0, y1, d0, d1, faces) {
  if (axis === 'x') bucket.addBox([a, y0, d0], [b, y1, d1], faces);
  else bucket.addBox([d0, y0, a], [d1, y1, b], faces);
}

function aabb(axis, a, b, d0, d1) {
  return axis === 'x'
    ? { minX: a, maxX: b, minZ: d0, maxZ: d1 }
    : { minX: d0, maxX: d1, minZ: a, maxZ: b };
}

function sideThickness(room, side) {
  const s = roomSide(room, side);
  const walls = wallsOnLine(s.axis, s.coord, s.from, s.to);
  return walls.length ? walls[0].t : INT_T;
}

/** Rooms whose wall side lies on the given face of wall w (sign = which face). */
function roomsOnFace(w, sign) {
  const out = [];
  for (const room of ROOMS) {
    for (const side of ['z0', 'z1', 'x0', 'x1']) {
      const s = roomSide(room, side);
      if (s.axis !== w.axis || Math.abs(s.coord - w.at) > 1e-3) continue;
      if ((w.axis === 'x' ? s.nz : s.nx) !== sign) continue;
      out.push({ room, from: s.from, to: s.to });
    }
  }
  return out;
}

function isOutsideHouse(w, coord) {
  return w.axis === 'x'
    ? coord < HOUSE.x0 - 1e-6 || coord > HOUSE.x1 + 1e-6
    : coord < HOUSE.z0 - 1e-6 || coord > HOUSE.z1 + 1e-6;
}

function addBroadFace(B, w, sign, a, b, y0, y1) {
  const coord = w.at + (sign * w.t) / 2;
  if (w.exterior && sign === w.outside) {
    B.get('exterior').addWallQuad(w.axis, coord, a, b, y0, y1, sign);
    return;
  }
  // Interior faces are split per room so each room can have its own paint colour.
  for (const { room, from, to } of roomsOnFace(w, sign)) {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (hi - lo > 1e-4) B.get(`wall:${room.id}`).addWallQuad(w.axis, coord, lo, hi, y0, y1, sign);
  }
}

function insideRoomKey(w, along) {
  const inward = -(w.outside || 1) * (w.t / 2 + 0.25);
  const room = w.axis === 'x' ? roomAt(along, w.at + inward) : roomAt(w.at + inward, along);
  return room ? `wall:${room.id}` : 'trim';
}

// Reveal (side face of an opening) or exposed corner end of a wall.
function addEndFace(B, w, coord, sign, y0, y1, kind) {
  const perp = w.axis === 'x' ? 'z' : 'x';
  const t0 = w.at - w.t / 2;
  const t1 = w.at + w.t / 2;
  if (kind === 'corner') {
    B.get('exterior').addWallQuad(perp, coord, t0, t1, y0, y1, sign);
    return;
  }
  if (!w.exterior) {
    B.get('trim').addWallQuad(perp, coord, t0, t1, y0, y1, sign);
    return;
  }
  const mid = w.at;
  const out = w.outside > 0 ? [mid, t1] : [t0, mid];
  const inn = w.outside > 0 ? [t0, mid] : [mid, t1];
  B.get('exterior').addWallQuad(perp, coord, out[0], out[1], y0, y1, sign);
  B.get(insideRoomKey(w, coord - sign * 0.01)).addWallQuad(perp, coord, inn[0], inn[1], y0, y1, sign);
}

// Horizontal face across the wall thickness (soffit above an opening).
function addHorizontalFace(B, w, l, r, y, up) {
  const t0 = w.at - w.t / 2;
  const t1 = w.at + w.t / 2;
  const emit = (key, s0, s1) => {
    if (w.axis === 'x') B.get(key).addFlatQuad(l, r, s0, s1, y, up);
    else B.get(key).addFlatQuad(s0, s1, l, r, y, up);
  };
  if (!w.exterior) {
    emit('trim', t0, t1);
    return;
  }
  if (w.outside > 0) {
    emit('exterior', w.at, t1);
    emit('trim', t0, w.at);
  } else {
    emit('exterior', t0, w.at);
    emit('trim', w.at, t1);
  }
}

function buildWall(w, B, colliders) {
  const half = w.t / 2;
  const ops = [...w.openings].sort((a, b) => a.c - b.c);
  const solids = [];
  let cursor = w.from;
  let prev = null;
  for (const o of ops) {
    solids.push({ a: cursor, b: o.c - o.w / 2, left: prev, right: o });
    prev = o;
    cursor = o.c + o.w / 2;
  }
  solids.push({ a: cursor, b: w.to, left: prev, right: null });

  for (const s of solids) {
    if (s.b - s.a < 1e-4) continue;
    for (const sign of [1, -1]) addBroadFace(B, w, sign, s.a, s.b, 0, H);
    if (s.left) addEndFace(B, w, s.a, -1, s.left.y0, s.left.y1, 'reveal');
    else if (isOutsideHouse(w, s.a)) addEndFace(B, w, s.a, -1, 0, H, 'corner');
    if (s.right) addEndFace(B, w, s.b, 1, s.right.y0, s.right.y1, 'reveal');
    else if (isOutsideHouse(w, s.b)) addEndFace(B, w, s.b, 1, 0, H, 'corner');
    colliders.push(aabb(w.axis, s.a, s.b, w.at - half, w.at + half));
  }

  for (const o of ops) {
    const l = o.c - o.w / 2;
    const r = o.c + o.w / 2;
    if (o.y0 > 0) {
      // wall below a window (its top is covered by the sills)
      for (const sign of [1, -1]) addBroadFace(B, w, sign, l, r, 0, o.y0);
      colliders.push(aabb(w.axis, l, r, w.at - half, w.at + half));
    }
    if (o.y1 < H) {
      for (const sign of [1, -1]) addBroadFace(B, w, sign, l, r, o.y1, H);
      addHorizontalFace(B, w, l, r, o.y1, -1);
    }
  }

  if (w.exterior) buildPlinth(w, B);
}

// Dark band along the base of the exterior walls.
function buildPlinth(w, B) {
  const p = 0.035;
  const ext = w.axis === 'x' ? p : w.t; // walls along X own the corners
  let ranges = [[w.from - ext, w.to + ext]];
  for (const o of w.openings) if (o.y0 <= 0.001) ranges = subtractRange(ranges, o.c - o.w / 2, o.c + o.w / 2);
  const face = w.at + (w.outside * w.t) / 2;
  const [d0, d1] = w.outside > 0 ? [face, face + p] : [face - p, face];
  const hidden = w.axis === 'x' ? (w.outside > 0 ? 'nz' : 'pz') : w.outside > 0 ? 'nx' : 'px';
  for (const [a, b] of ranges) box(B.get('plinth'), w.axis, a, b, -0.03, 0.32, d0, d1, { ny: false, [hidden]: false });
}

function buildWindow(w, o, B) {
  const l = o.c - o.w / 2;
  const r = o.c + o.w / 2;
  const fw = 0.065; // frame width
  const fd = 0.08; // frame depth
  const mw = 0.04; // mullion width
  const trim = B.get('trim');
  const d0 = w.at - fd / 2;
  const d1 = w.at + fd / 2;
  box(trim, w.axis, l, r, o.y1 - fw, o.y1, d0, d1);
  box(trim, w.axis, l, r, o.y0, o.y0 + fw, d0, d1);
  box(trim, w.axis, l, l + fw, o.y0 + fw, o.y1 - fw, d0, d1);
  box(trim, w.axis, r - fw, r, o.y0 + fw, o.y1 - fw, d0, d1);
  const m0 = w.at - fd * 0.4;
  const m1 = w.at + fd * 0.4;
  const panes = Math.max(1, Math.round(o.w / 0.75));
  for (let i = 1; i < panes; i++) {
    const x = l + ((r - l) * i) / panes;
    box(trim, w.axis, x - mw / 2, x + mw / 2, o.y0 + fw, o.y1 - fw, m0, m1);
  }
  if (o.y1 - o.y0 > 1.3) {
    const ty = o.y1 - 0.48;
    box(trim, w.axis, l + fw, r - fw, ty - mw / 2, ty + mw / 2, m0, m1);
  }
  B.get('glass').addWallQuad(w.axis, w.at, l + fw, r - fw, o.y0 + fw, o.y1 - fw, 1);

  // interior sill board and exterior stone sill
  const inSign = -w.outside;
  const inFace = w.at + (inSign * w.t) / 2;
  const [i0, i1] = inSign > 0 ? [w.at, inFace + 0.05] : [inFace - 0.05, w.at];
  box(trim, w.axis, l - 0.05, r + 0.05, o.y0, o.y0 + 0.03, i0, i1);
  const outFace = w.at + (w.outside * w.t) / 2;
  const [e0, e1] = w.outside > 0 ? [w.at, outFace + 0.06] : [outFace - 0.06, w.at];
  box(B.get('stone'), w.axis, l - 0.07, r + 0.07, o.y0 - 0.06, o.y0, e0, e1);
}

// Architraves around doorways, on both faces of the wall.
function buildDoorTrim(w, o, B) {
  const l = o.c - o.w / 2;
  const r = o.c + o.w / 2;
  const aw = ARCHITRAVE_W;
  const trim = B.get('trim');
  for (const sign of [1, -1]) {
    const face = w.at + (sign * w.t) / 2;
    const [d0, d1] = sign > 0 ? [face, face + ARCHITRAVE_D] : [face - ARCHITRAVE_D, face];
    box(trim, w.axis, l - aw, l, 0, o.y1 + aw, d0, d1, { ny: false });
    box(trim, w.axis, r, r + aw, 0, o.y1 + aw, d0, d1, { ny: false });
    box(trim, w.axis, l, r, o.y1, o.y1 + aw, d0, d1);
  }
}

function buildSkirting(room, B) {
  for (const side of ['z0', 'z1', 'x0', 'x1']) {
    const s = roomSide(room, side);
    const walls = wallsOnLine(s.axis, s.coord, s.from, s.to);
    if (!walls.length) continue;
    const n = s.axis === 'x' ? s.nz : s.nx;
    const face = s.coord + (n * walls[0].t) / 2;
    const [startSide, endSide] = s.axis === 'x' ? ['x0', 'x1'] : ['z0', 'z1'];
    let ranges = [[s.from + sideThickness(room, startSide) / 2, s.to - sideThickness(room, endSide) / 2]];
    for (const w of walls) {
      for (const o of w.openings) {
        if (o.y0 > 0.01) continue; // skirting runs under windows
        ranges = subtractRange(ranges, o.c - o.w / 2 - ARCHITRAVE_W, o.c + o.w / 2 + ARCHITRAVE_W);
      }
    }
    const [d0, d1] = n > 0 ? [face, face + SKIRTING_D] : [face - SKIRTING_D, face];
    for (const [a, b] of ranges) {
      if (b - a > 0.02) box(B.get('trim'), s.axis, a, b, 0, SKIRTING_H, d0, d1, { ny: false });
    }
  }
}

function roofInfo() {
  const halfDepth = (HOUSE.z1 - HOUSE.z0) / 2 + EXT_T / 2;
  const ridgeZ = (HOUSE.z0 + HOUSE.z1) / 2;
  const ridgeY = EAVE_Y + halfDepth * Math.tan(ROOF_PITCH);
  return { halfDepth, ridgeZ, ridgeY };
}

function buildEnvelope(B, roof) {
  const xo = HOUSE.x1 + EXT_T / 2;
  const zf = HOUSE.z1 + EXT_T / 2;
  const zb = HOUSE.z0 - EXT_T / 2;
  const trim = B.get('trim');
  // frieze band: the edge of the ceiling slab between wall top and eaves
  trim.addWallQuad('x', zf, -xo, xo, H, EAVE_Y, 1);
  trim.addWallQuad('x', zb, -xo, xo, H, EAVE_Y, -1);
  trim.addWallQuad('z', xo, zb, zf, H, EAVE_Y, 1);
  trim.addWallQuad('z', -xo, zb, zf, H, EAVE_Y, -1);
  // gable triangles
  const ext = B.get('exterior');
  ext.addTri([xo, EAVE_Y, zf], [xo, EAVE_Y, zb], [xo, roof.ridgeY, roof.ridgeZ], [1, 0, 0]);
  ext.addTri([-xo, EAVE_Y, zb], [-xo, EAVE_Y, zf], [-xo, roof.ridgeY, roof.ridgeZ], [-1, 0, 0]);
  // chimney stack poking through the front slope
  ext.addBox([-7.9, 5.0, -4.7], [-7.0, 8.4, -4.1], { ny: false, py: false });
  B.get('plinth').addBox([-7.97, 8.4, -4.77], [-6.93, 8.52, -4.03]);
  // threshold under the front door and a stone landing outside it
  const stone = B.get('stone');
  stone.addBox([-0.8, -0.03, -EXT_T / 2], [0.8, 0.012, EXT_T / 2], { ny: false });
  stone.addBox([-1.7, -0.03, EXT_T / 2], [1.7, 0.03, 1.5], { ny: false });
}

function createMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const floorDefs = {
    stone: { map: T.checkerTilesTexture(), roughness: 0.3 },
    oak: { map: T.woodPlanksTexture({ seed: 11, base: [182, 136, 92] }), roughness: 0.5 },
    herringbone: { map: T.herringboneTexture({ seed: 12, base: [170, 120, 76] }), roughness: 0.42 },
    walnut: {
      map: T.woodPlanksTexture({ seed: 13, base: [116, 80, 54], plankW: 0.14, worldSize: 2.24, variance: 0.12 }),
      roughness: 0.45,
    },
    terracotta: { map: T.terracottaTexture(), roughness: 0.78 },
    pale: {
      map: T.woodPlanksTexture({
        seed: 14, base: [216, 203, 186], plankW: 0.24, worldSize: 2.4, variance: 0.05, grainIntensity: 0.6, gapAlpha: 0.3,
      }),
      roughness: 0.62,
    },
  };
  const floors = {};
  for (const [k, def] of Object.entries(floorDefs)) floors[k] = std(def);

  const walls = {};
  for (const r of ROOMS) walls[r.id] = std({ color: r.wall, roughness: 0.92 });

  const slate = T.slateTexture();
  return {
    floors,
    walls,
    exterior: std({ map: T.brickTexture(), roughness: 0.95 }),
    trim: std({ color: 0xf6f4ef, roughness: 0.5 }),
    plinth: std({ color: 0x3a3d41, roughness: 0.85 }),
    stone: std({ color: 0x9a948a, roughness: 0.8 }),
    ceiling: std({ color: 0xfbfaf7, roughness: 0.95 }),
    glass: std({
      color: 0xd8e8ef, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    slateTexture: slate,
    slate: std({ map: slate, roughness: 0.7 }),
    fascia: std({ color: 0xf2f0ea, roughness: 0.6 }),
    soffit: std({ color: 0xe9e6df, roughness: 0.9, side: THREE.DoubleSide }),
    door: std({ color: 0x2f5d62, roughness: 0.45 }),
    brass: std({ color: 0xc9a45c, metalness: 0.85, roughness: 0.32 }),
    blackMetal: std({ color: 0x1f2022, metalness: 0.6, roughness: 0.45 }),
    terracotta: std({ color: 0xb8643f, roughness: 0.8 }),
    bulb: std({ color: 0xffffff, emissive: 0xffd8a8, emissiveIntensity: 3 }),
    lampGlow: std({ color: 0xfff4e2, emissive: 0xffe2b8, emissiveIntensity: 1.6, roughness: 0.6 }),
    linenShade: std({ color: 0xefe6d6, emissive: 0xffd9a8, emissiveIntensity: 0.35, roughness: 0.9, side: THREE.DoubleSide }),
    rattan: std({ color: 0xc49a62, emissive: 0x5a3a14, emissiveIntensity: 0.25, roughness: 0.85, side: THREE.DoubleSide }),
  };
}

function materialFor(key, mats) {
  if (key.startsWith('wall:')) return mats.walls[key.slice(5)];
  if (key.startsWith('floor:')) return mats.floors[key.slice(6)];
  return mats[key];
}

function buildRoof(mats, roof) {
  const g = new THREE.Group();
  g.name = 'roof';
  const ov = 0.45;
  const run = roof.halfDepth + ov;
  const slope = run / Math.cos(ROOF_PITCH);
  const width = HOUSE.x1 - HOUSE.x0 + EXT_T + 2 * ov;
  const thick = 0.16;
  const tex = mats.slateTexture;
  tex.repeat.set(width / 1.8, slope / 1.8);
  const faceMats = [mats.fascia, mats.fascia, mats.slate, mats.soffit, mats.fascia, mats.fascia];
  for (const side of [1, -1]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thick, slope), faceMats);
    mesh.rotation.set(ROOF_PITCH, side > 0 ? 0 : Math.PI, 0, 'YXZ');
    const d = new THREE.Vector3(0, -Math.sin(ROOF_PITCH), Math.cos(ROOF_PITCH) * side);
    const n = new THREE.Vector3(0, Math.cos(ROOF_PITCH), Math.sin(ROOF_PITCH) * side);
    mesh.position
      .set(0, roof.ridgeY, roof.ridgeZ)
      .addScaledVector(d, slope / 2)
      .addScaledVector(n, -thick / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, width, 12), mats.plinth);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, roof.ridgeY + 0.01, roof.ridgeZ);
  ridge.castShadow = true;
  g.add(ridge);
  // chimney pots
  for (const x of [-7.65, -7.25]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.42, 14), mats.terracotta);
    pot.position.set(x, 8.73, -4.4);
    pot.castShadow = true;
    g.add(pot);
  }
  return g;
}

function buildFrontDoor(mats) {
  const group = new THREE.Group();
  group.name = 'front-door';
  const colliders = [];
  const leafW = 0.79;
  const leafH = 2.47;
  const leafT = 0.05;
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 0.8, 0.012, -0.1);
    const cx = (-side * leafW) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, leafT), mats.door);
    slab.position.set(cx, leafH / 2, 0);
    hinge.add(slab);
    // raised panels on both faces
    for (const f of [1, -1]) {
      for (const [py, ph] of [[1.72, 0.95], [0.62, 0.8]]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.22, ph, 0.014), mats.door);
        p.position.set(cx, py, (f * (leafT + 0.014)) / 2);
        hinge.add(p);
      }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mats.brass);
      knob.position.set(cx - side * (leafW / 2 - 0.08), 1.02, f * (leafT / 2 + 0.035));
      hinge.add(knob);
    }
    hinge.rotation.y = THREE.MathUtils.degToRad(side < 0 ? 96 : -96);
    hinge.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(hinge);
  }
  group.updateMatrixWorld(true);
  for (const hinge of group.children) {
    const b = new THREE.Box3().setFromObject(hinge);
    colliders.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
  }
  return { group, colliders };
}

function buildLanterns(mats) {
  const g = new THREE.Group();
  const face = HOUSE.z1 + EXT_T / 2;
  for (const x of [-1.3, 1.3]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), mats.blackMetal);
    bracket.position.set(x, 2.2, face + 0.07);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.17), mats.lampGlow);
    body.position.set(x, 2.12, face + 0.19);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 4), mats.blackMetal);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(x, 2.33, face + 0.19);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.03, 0.19), mats.blackMetal);
    base.position.set(x, 1.96, face + 0.19);
    g.add(bracket, body, cap, base);
  }
  return g;
}

function pendant(style, x, z, mats) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const drop = { globe: 0.95, drum: 1.0, dome: 0.95, rattan: 1.05, industrial: 1.05 }[style] ?? 1;
  const y = H - drop;
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), mats.trim);
  rose.position.y = H - 0.015;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop, 6), mats.blackMetal);
  cord.position.y = H - drop / 2;
  g.add(rose, cord);
  if (style === 'globe') {
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 20), mats.lampGlow);
    globe.position.y = y - 0.2;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16), mats.brass);
    cup.position.y = y + 0.01;
    g.add(globe, cup);
  } else if (style === 'drum') {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 40, 1, true), mats.linenShade);
    shade.position.y = y - 0.13;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mats.bulb);
    bulb.position.y = y - 0.12;
    g.add(shade, bulb);
  } else if (style === 'dome') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.brass);
    dome.material = mats.brass.clone();
    dome.material.side = THREE.DoubleSide;
    dome.position.y = y - 0.24;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mats.bulb);
    bulb.position.y = y - 0.25;
    g.add(dome, bulb);
  } else if (style === 'rattan') {
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.rattan);
    shade.position.y = y - 0.28;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mats.bulb);
    bulb.position.y = y - 0.25;
    g.add(shade, bulb);
  } else if (style === 'industrial') {
    g.remove(cord, rose);
    for (const dx of [-0.6, 0.6]) {
      const r2 = rose.clone();
      r2.position.x = dx;
      const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop, 6), mats.blackMetal);
      c2.position.set(dx, H - drop / 2, 0);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.2, 28, 1, true), mats.blackMetal.clone());
      shade.material.side = THREE.DoubleSide;
      shade.position.set(dx, y - 0.1, 0);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), mats.bulb);
      bulb.position.set(dx, y - 0.17, 0);
      g.add(r2, c2, shade, bulb);
    }
  }
  return g;
}

// Track lighting along the Long Gallery ceiling.
function buildGalleryTracks(mats) {
  const g = new THREE.Group();
  const room = ROOMS.find((r) => r.id === 'gallery');
  const len = room.x1 - room.x0 - 2;
  const heads = [];
  for (const z of [room.z1 - 1.0, room.z0 + 1.0]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.04), mats.blackMetal);
    track.position.set((room.x0 + room.x1) / 2, H - 0.02, z);
    g.add(track);
    const towardWall = z > (room.z0 + room.z1) / 2 ? 1 : -1;
    for (let x = room.x0 + 1.6; x <= room.x1 - 1.6 + 1e-6; x += 2.1) heads.push({ x, z, dir: towardWall });
  }
  const bodyGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.16, 16);
  const lensGeo = new THREE.CircleGeometry(0.04, 16);
  const bodies = new THREE.InstancedMesh(bodyGeo, mats.blackMetal, heads.length);
  const lenses = new THREE.InstancedMesh(lensGeo, mats.bulb, heads.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  heads.forEach((h, i) => {
    // tilt the head ~40° towards the nearer wall
    e.set(-h.dir * THREE.MathUtils.degToRad(40), 0, 0);
    q.setFromEuler(e);
    const center = new THREE.Vector3(h.x, H - 0.13, h.z);
    m.compose(center, q, new THREE.Vector3(1, 1, 1));
    bodies.setMatrixAt(i, m);
    const down = new THREE.Vector3(0, -0.081, 0).applyQuaternion(q);
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    lq.premultiply(q);
    m.compose(center.clone().add(down), lq, new THREE.Vector3(1, 1, 1));
    lenses.setMatrixAt(i, m);
    // stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), mats.blackMetal);
    stem.position.set(h.x, H - 0.06, h.z);
    g.add(stem);
  });
  g.add(bodies, lenses);
  return g;
}

/**
 * Builds the whole house shell.
 * Returns { group, colliders, occluders, mats } where colliders are XZ boxes for the player
 * and occluders are meshes that should block picking rays (walls).
 */
export function buildHouse() {
  const mats = createMaterials();
  const B = new Buckets();
  const colliders = [];
  const roof = roofInfo();

  for (const w of WALLS) buildWall(w, B, colliders);
  for (const w of WALLS) {
    for (const o of w.openings) {
      if (o.type === 'window') buildWindow(w, o, B);
      else buildDoorTrim(w, o, B);
    }
  }
  for (const room of ROOMS) {
    B.get(`floor:${room.floor}`).addFlatQuad(room.x0, room.x1, room.z0, room.z1, 0, 1);
    B.get('ceiling').addFlatQuad(room.x0, room.x1, room.z0, room.z1, H, -1);
    buildSkirting(room, B);
  }
  buildEnvelope(B, roof);

  const group = new THREE.Group();
  group.name = 'house';
  const occluders = [];
  for (const [key, bucket] of B.map) {
    const material = materialFor(key, mats);
    if (!material) {
      console.warn('No material for bucket', key);
      continue;
    }
    const isGlass = key === 'glass';
    const isFloor = key.startsWith('floor:');
    const mesh = bucket.toMesh(material, { name: key, castShadow: !isGlass && !isFloor, receiveShadow: !isGlass });
    if (!mesh) continue;
    if (isGlass) mesh.renderOrder = 2;
    group.add(mesh);
    if (key.startsWith('wall:') || key === 'exterior') occluders.push(mesh);
  }

  group.add(buildRoof(mats, roof));
  const door = buildFrontDoor(mats);
  group.add(door.group);
  colliders.push(...door.colliders);
  group.add(buildLanterns(mats));

  const fittings = new THREE.Group();
  fittings.name = 'light-fittings';
  for (const room of ROOMS) {
    if (room.pendant === 'none') continue;
    for (const [x, z] of room.lights) fittings.add(pendant(room.pendant, x, z, mats));
  }
  fittings.add(buildGalleryTracks(mats));
  group.add(fittings);

  return { group, colliders, occluders, mats };
}
