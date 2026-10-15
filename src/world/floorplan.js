// Floor plan for the gallery house.
// All measurements are in metres. Y is up, the floor is at y = 0.
// The front of the house faces +Z; the front door sits at (0, 0).
//
//  z = -16 ┌───────────────────┬──────────────────────────┐
//          │      Library      │       Garden Room        │
//  z = -10 ├────── door ───────┴────────── door ──────────┤
//          │ hero         The Long Gallery           hero │
//  z = -6  ├──── door ────┬──── arch ────┬───── door ─────┤
//          │ Living Room  │ Entrance Hall│     Studio     │
//  z =  0  └──────────────┴─ front door ─┴────────────────┘
//        x = -10        x = -3   x = 0  x = 3           x = 10

export const WALL_HEIGHT = 3.2;
export const EXT_T = 0.3; // exterior wall thickness
export const INT_T = 0.16; // interior wall thickness

export const HOUSE = { x0: -10, x1: 10, z0: -16, z1: 0 };

// Where the visitor starts: in the front garden, looking at the front door.
export const START = { x: 0, z: 10.5, yaw: 0, pitch: 0.05 };

// Walkable garden area (bounded by hedges).
export const GARDEN = { x0: -17, x1: 17, z0: -23, z1: 14 };

/**
 * Rooms are axis-aligned rectangles measured to wall centre-lines.
 * Sides are named by the coordinate they sit on:
 *   z0 = back side (min z), z1 = front side (max z), x0 = left side (min x), x1 = right side (max x)
 * `artOrder` controls the order in which wall sides receive artworks (a natural walking tour).
 * `noArt` lists sides reserved for furniture. `hero` sides get one large featured piece.
 * `wall` is the paint colour, `lights` are ceiling light positions [x, z], `pendant` the fitting style.
 */
export const ROOMS = [
  {
    id: 'foyer', name: 'Entrance Hall', floor: 'stone', wall: '#ebe4d8',
    x0: -3, x1: 3, z0: -6, z1: 0,
    artOrder: ['x0', 'z0', 'x1'], noArt: ['z1'], hero: [],
    lights: [[0, -3]], pendant: 'globe',
  },
  {
    id: 'living', name: 'Living Room', floor: 'oak', wall: '#efe6da',
    x0: -10, x1: -3, z0: -6, z1: 0,
    artOrder: ['x1', 'z1', 'x0', 'z0'], noArt: [], hero: [],
    lights: [[-6.5, -2.6]], pendant: 'drum',
  },
  {
    id: 'gallery', name: 'The Long Gallery', floor: 'herringbone', wall: '#f4f2ee',
    x0: -10, x1: 10, z0: -10, z1: -6,
    artOrder: ['x0', 'z0', 'x1', 'z1'], noArt: [], hero: ['x0', 'x1'],
    lights: [[-5, -8], [5, -8]], pendant: 'none',
  },
  {
    id: 'library', name: 'Library', floor: 'walnut', wall: '#2f4a3f',
    x0: -10, x1: -1, z0: -16, z1: -10,
    artOrder: ['z1', 'z0', 'x1'], noArt: ['x0'], hero: [],
    lights: [[-6, -13]], pendant: 'dome',
  },
  {
    id: 'garden', name: 'Garden Room', floor: 'terracotta', wall: '#e2e8da',
    x0: -1, x1: 10, z0: -16, z1: -10,
    artOrder: ['x0', 'z0', 'z1'], noArt: ['x1'], hero: [],
    lights: [[4.5, -13.2]], pendant: 'rattan',
  },
  {
    id: 'studio', name: 'Studio', floor: 'pale', wall: '#f5f3ef',
    x0: 3, x1: 10, z0: -6, z1: 0,
    artOrder: ['z0', 'x1', 'z1', 'x0'], noArt: [], hero: [],
    lights: [[6.0, -4.7]], pendant: 'industrial',
  },
];

/**
 * Walls are straight segments.
 *   axis 'x' → the wall runs along X at z = `at`, spanning x ∈ [from, to]
 *   axis 'z' → the wall runs along Z at x = `at`, spanning z ∈ [from, to]
 * `outside` (exterior walls only) is +1/-1: which side (along the perpendicular axis) faces outdoors.
 * Openings are positioned by their centre `c` along the wall's axis (world coordinate),
 * with width `w` and vertical extent y0..y1.
 */
export const WALLS = [
  // ── Exterior ──────────────────────────────────────────────────────────────
  {
    id: 'front', axis: 'x', at: 0, from: -10.15, to: 10.15, t: EXT_T, exterior: true, outside: 1,
    openings: [
      { type: 'frontdoor', c: 0, w: 1.6, y0: 0, y1: 2.5 },
      { type: 'window', c: -6.5, w: 2.2, y0: 0.85, y1: 2.45 },
      { type: 'window', c: 6.5, w: 2.2, y0: 0.85, y1: 2.45 },
    ],
  },
  {
    id: 'back', axis: 'x', at: -16, from: -10.15, to: 10.15, t: EXT_T, exterior: true, outside: -1,
    openings: [
      { type: 'window', c: -5.5, w: 2.0, y0: 0.85, y1: 2.45 },
      { type: 'window', c: 4.5, w: 4.0, y0: 0.5, y1: 2.6 },
    ],
  },
  {
    id: 'left', axis: 'z', at: -10, from: -15.85, to: -0.15, t: EXT_T, exterior: true, outside: -1,
    openings: [
      { type: 'window', c: -3, w: 1.8, y0: 0.85, y1: 2.45 },
      { type: 'window', c: -13, w: 1.8, y0: 0.85, y1: 2.45 },
    ],
  },
  {
    id: 'right', axis: 'z', at: 10, from: -15.85, to: -0.15, t: EXT_T, exterior: true, outside: 1,
    openings: [
      { type: 'window', c: -3, w: 1.8, y0: 0.85, y1: 2.45 },
      { type: 'window', c: -13, w: 2.4, y0: 0.85, y1: 2.45 },
    ],
  },

  // ── Interior ──────────────────────────────────────────────────────────────
  {
    id: 'living-foyer', axis: 'z', at: -3, from: -6, to: 0, t: INT_T,
    openings: [{ type: 'door', c: -4.4, w: 1.3, y0: 0, y1: 2.4 }],
  },
  {
    id: 'foyer-studio', axis: 'z', at: 3, from: -6, to: 0, t: INT_T,
    openings: [{ type: 'door', c: -4.4, w: 1.3, y0: 0, y1: 2.4 }],
  },
  {
    id: 'front-gallery', axis: 'x', at: -6, from: -10, to: 10, t: INT_T,
    openings: [
      { type: 'door', c: -6.5, w: 1.4, y0: 0, y1: 2.4 },
      { type: 'arch', c: 0, w: 2.0, y0: 0, y1: 2.7 },
      { type: 'door', c: 6.5, w: 1.4, y0: 0, y1: 2.4 },
    ],
  },
  {
    id: 'gallery-back', axis: 'x', at: -10, from: -10, to: 10, t: INT_T,
    openings: [
      { type: 'door', c: -5.5, w: 1.4, y0: 0, y1: 2.4 },
      { type: 'door', c: 4.5, w: 1.8, y0: 0, y1: 2.4 },
    ],
  },
  {
    id: 'library-garden', axis: 'z', at: -1, from: -16, to: -10, t: INT_T,
    openings: [],
  },
];

/** Returns the room containing the point, or null when outdoors. */
export function roomAt(x, z) {
  for (const r of ROOMS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
  }
  return null;
}

/**
 * Geometric description of one side of a room.
 * Returns the wall line, the range along it, and the inward-facing normal.
 */
export function roomSide(room, side) {
  switch (side) {
    case 'z0': return { axis: 'x', coord: room.z0, from: room.x0, to: room.x1, nx: 0, nz: 1 };
    case 'z1': return { axis: 'x', coord: room.z1, from: room.x0, to: room.x1, nx: 0, nz: -1 };
    case 'x0': return { axis: 'z', coord: room.x0, from: room.z0, to: room.z1, nx: 1, nz: 0 };
    case 'x1': return { axis: 'z', coord: room.x1, from: room.z0, to: room.z1, nx: -1, nz: 0 };
    default: throw new Error(`Unknown side ${side}`);
  }
}

/** All walls lying on the given line (same axis and coordinate) that overlap [from, to]. */
export function wallsOnLine(axis, coord, from, to) {
  return WALLS.filter(
    (w) => w.axis === axis && Math.abs(w.at - coord) < 1e-3 && w.to > from && w.from < to,
  );
}
