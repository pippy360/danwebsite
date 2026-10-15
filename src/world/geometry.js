import * as THREE from 'three';

const ALL_FACES = { px: true, nx: true, py: true, ny: true, pz: true, nz: true };

/**
 * Accumulates quads, triangles and axis-aligned boxes into one BufferGeometry so that
 * a whole category of architecture (e.g. every interior wall) renders in a single draw call.
 *
 * UVs are projected from world position ("box mapping"), so textures tile at a consistent
 * real-world scale regardless of how big each piece is: 1 UV unit = 1 / uvScale metres.
 */
export class GeometryBucket {
  constructor(uvScale = 1) {
    this.uvScale = uvScale;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
  }

  get isEmpty() {
    return this.indices.length === 0;
  }

  /** Quad with corners a,b,c,d in counter-clockwise order seen from the front; n = normal. */
  addQuad(a, b, c, d, n) {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) this.#pushVertex(p, n);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Triangle with counter-clockwise winding seen from the front. */
  addTri(a, b, c, n) {
    const base = this.positions.length / 3;
    for (const p of [a, b, c]) this.#pushVertex(p, n);
    this.indices.push(base, base + 1, base + 2);
  }

  /**
   * Axis-aligned box between min and max ([x, y, z] arrays).
   * `faces` toggles individual faces: px/nx (±X), py/ny (±Y), pz/nz (±Z).
   */
  addBox(min, max, faces = ALL_FACES) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const f = { ...ALL_FACES, ...faces };
    if (f.px) this.addQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    if (f.nx) this.addQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    if (f.py) this.addQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
    if (f.ny) this.addQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    if (f.pz) this.addQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    if (f.nz) this.addQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  }

  /** Vertical rectangle facing +/-X or +/-Z, spanning [a,b] along the other horizontal axis. */
  addWallQuad(axis, coord, a, b, y0, y1, normalSign) {
    if (b - a < 1e-5 || y1 - y0 < 1e-5) return;
    if (axis === 'z') {
      // plane x = coord, facing ±X, spanning z ∈ [a, b]
      if (normalSign > 0) this.addQuad([coord, y0, b], [coord, y0, a], [coord, y1, a], [coord, y1, b], [1, 0, 0]);
      else this.addQuad([coord, y0, a], [coord, y0, b], [coord, y1, b], [coord, y1, a], [-1, 0, 0]);
    } else {
      // plane z = coord, facing ±Z, spanning x ∈ [a, b]
      if (normalSign > 0) this.addQuad([a, y0, coord], [b, y0, coord], [b, y1, coord], [a, y1, coord], [0, 0, 1]);
      else this.addQuad([b, y0, coord], [a, y0, coord], [a, y1, coord], [b, y1, coord], [0, 0, -1]);
    }
  }

  /** Horizontal rectangle at height y, facing up (+1) or down (-1). */
  addFlatQuad(x0, x1, z0, z1, y, normalSign) {
    if (normalSign > 0) this.addQuad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0]);
    else this.addQuad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0]);
  }

  #pushVertex(p, n) {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    const [u, v] = projectUV(p, n);
    this.uvs.push(u * this.uvScale, v * this.uvScale);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /** Builds a mesh (or null if nothing was added). */
  toMesh(material, { castShadow = true, receiveShadow = true, name = '' } = {}) {
    if (this.isEmpty) return null;
    const mesh = new THREE.Mesh(this.build(), material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.name = name;
    mesh.userData.batched = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

/** Box-mapping projection: picks the plane most aligned with the normal. */
function projectUV(p, n) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0], -p[2]];
  if (ax >= az) return [n[0] > 0 ? -p[2] : p[2], p[1]];
  return [n[2] > 0 ? p[0] : -p[0], p[1]];
}
