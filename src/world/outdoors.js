import * as THREE from 'three';
import { GARDEN, HOUSE, EXT_T } from './floorplan.js';
import { GeometryBucket } from './geometry.js';
import * as T from './textures.js';

// Late-afternoon sun from the front-right, so light falls through the front and side windows.
export const SUN_DIR = new THREE.Vector3(14, 18, 28).normalize();
export const HORIZON_COLOR = new THREE.Color('#dde6ea');

function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#4f86c6') },
      horizonColor: { value: HORIZON_COLOR.clone() },
      groundColor: { value: new THREE.Color('#b9c4ad') },
      sunColor: { value: new THREE.Color('#fff0d0') },
      sunDir: { value: SUN_DIR.clone() },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor, horizonColor, groundColor, sunColor, sunDir;
      uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizonColor, topColor, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.5));
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.15) * 1.4 + vec2(time * 0.004, time * 0.0015);
          float c = smoothstep(0.5, 0.82, fbm(uv));
          float shade = 0.82 + 0.18 * smoothstep(0.4, 0.9, fbm(uv * 1.7 + 3.0));
          col = mix(col, vec3(shade) * vec3(1.0, 0.985, 0.97), c * 0.8 * smoothstep(0.0, 0.3, h));
        }
        col = mix(col, groundColor, smoothstep(0.0, -0.06, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 1200.0) * 8.0 + pow(s, 60.0) * 0.3 + pow(s, 6.0) * 0.1);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };
  return sky;
}

function buildGround(rng) {
  const size = 600;
  const geo = new THREE.PlaneGeometry(size, size, 80, 80);
  geo.rotateX(-Math.PI / 2);
  // large-scale colour variation hides texture tiling
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.86 + rng() * 0.22;
    colors.push(k * (0.97 + rng() * 0.06), k, k * (0.92 + rng() * 0.08));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const tex = T.grassTexture();
  tex.repeat.set(size / 2.5, size / 2.5);
  const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

const std = (o) => new THREE.MeshStandardMaterial(o);

function buildTreeMeshes(trees, rng, { detailed }) {
  // trees: [{ x, z, s }] → instanced trunks + foliage blobs
  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkMat = std({ color: 0x5b4636, roughness: 0.95 });
  const leafMat = std({ color: 0xffffff, roughness: 0.92, flatShading: true });
  const blobsPerTree = detailed ? 5 : 2;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, trees.length * blobsPerTree);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let li = 0;
  trees.forEach((t, i) => {
    const trunkH = 2.2 * t.s;
    m.compose(new THREE.Vector3(t.x, 0, t.z), q.identity(), new THREE.Vector3(t.s, trunkH, t.s));
    trunks.setMatrixAt(i, m);
    const hue = 0.24 + rng() * 0.08;
    for (let b = 0; b < blobsPerTree; b++) {
      const r = (b === 0 ? 1.9 : 1.1 + rng() * 0.7) * t.s;
      const ang = rng() * Math.PI * 2;
      const off = b === 0 ? 0 : (0.9 + rng() * 0.6) * t.s;
      const p = new THREE.Vector3(
        t.x + Math.cos(ang) * off,
        trunkH + r * 0.7 + (b === 0 ? 0.3 : rng() * 1.4) * t.s,
        t.z + Math.sin(ang) * off,
      );
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      m.compose(p, q, new THREE.Vector3(r, r * (0.8 + rng() * 0.3), r));
      leaves.setMatrixAt(li, m);
      col.setHSL(hue + (rng() - 0.5) * 0.03, 0.3 + rng() * 0.14, 0.15 + rng() * 0.08);
      leaves.setColorAt(li, col);
      li++;
    }
  });
  for (const mesh of [trunks, leaves]) {
    mesh.castShadow = detailed;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  leaves.instanceColor.needsUpdate = true;
  g.add(trunks, leaves);
  return g;
}

function buildFlowerBeds(rng, colliders) {
  const g = new THREE.Group();
  const front = HOUSE.z1 + EXT_T / 2 + 0.04;
  const beds = [
    { x0: -9.7, x1: -1.95, z0: front, z1: front + 0.95 },
    { x0: 1.95, x1: 9.7, z0: front, z1: front + 0.95 },
  ];
  const soilBucket = new GeometryBucket();
  const edgeBucket = new GeometryBucket();
  const shrubs = [];
  const flowers = [];
  for (const b of beds) {
    soilBucket.addBox([b.x0, -0.02, b.z0], [b.x1, 0.1, b.z1], { ny: false });
    const e = 0.05;
    edgeBucket.addBox([b.x0 - e, -0.02, b.z1], [b.x1 + e, 0.16, b.z1 + e], { ny: false });
    edgeBucket.addBox([b.x0 - e, -0.02, b.z0], [b.x0, 0.16, b.z1], { ny: false });
    edgeBucket.addBox([b.x1, -0.02, b.z0], [b.x1 + e, 0.16, b.z1], { ny: false });
    colliders.push({ minX: b.x0 - e, maxX: b.x1 + e, minZ: b.z0 - 0.2, maxZ: b.z1 + e });
    for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.55 + rng() * 0.25) {
      const z = b.z0 + 0.3 + rng() * (b.z1 - b.z0 - 0.55);
      const r = 0.2 + rng() * 0.16;
      shrubs.push({ x, z, r });
      const kind = Math.floor(rng() * 4);
      const n = 6 + Math.floor(rng() * 6);
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2;
        const d = r * (0.3 + rng() * 0.7);
        flowers.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d * 0.7, y: 0.1 + r * (1.1 + rng() * 0.6), kind });
      }
    }
  }
  const soil = soilBucket.toMesh(std({ color: 0x4a3626, roughness: 1 }), { castShadow: false });
  const edge = edgeBucket.toMesh(std({ color: 0x8c7a66, roughness: 0.9 }));
  g.add(soil, edge);

  const shrubMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    std({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    shrubs.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  shrubs.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.x, 0.08 + s.r * 0.8, s.z), q.identity(), new THREE.Vector3(s.r, s.r * 1.1, s.r));
    shrubMesh.setMatrixAt(i, m);
    c.setHSL(0.27 + rng() * 0.06, 0.35 + rng() * 0.15, 0.22 + rng() * 0.08);
    shrubMesh.setColorAt(i, c);
  });
  const palette = ['#8e6bbf', '#f2efe6', '#e58fa8', '#f1c84b'];
  const flowerMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    std({ color: 0xffffff, roughness: 0.7, flatShading: true }),
    flowers.length,
  );
  flowers.forEach((f, i) => {
    const s = 0.035 + rng() * 0.03;
    m.compose(new THREE.Vector3(f.x, f.y, f.z), q.identity(), new THREE.Vector3(s, s, s));
    flowerMesh.setMatrixAt(i, m);
    c.set(palette[f.kind]).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
    flowerMesh.setColorAt(i, c);
  });
  for (const mesh of [shrubMesh, flowerMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  return g;
}

function buildGardenBench(colliders) {
  const g = new THREE.Group();
  const wood = std({ color: 0x9a7350, roughness: 0.8 });
  const iron = std({ color: 0x2b2d30, roughness: 0.6, metalness: 0.5 });
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(1.6, 0.03, 0.08), wood, 0, 0.45, -0.15 + i * 0.1);
  for (let i = 0; i < 3; i++) {
    const slat = add(new THREE.BoxGeometry(1.6, 0.08, 0.025), wood, 0, 0.62 + i * 0.12, -0.24);
    slat.rotation.x = -0.12;
  }
  for (const x of [-0.72, 0.72]) {
    add(new THREE.BoxGeometry(0.05, 0.45, 0.42), iron, x, 0.225, 0);
    add(new THREE.BoxGeometry(0.05, 0.5, 0.05), iron, x, 0.7, -0.24);
    add(new THREE.BoxGeometry(0.05, 0.04, 0.42), iron, x, 0.66, 0);
  }
  g.position.set(-7.5, 0, 7.2);
  g.rotation.y = Math.PI; // faces the house
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  colliders.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
  return g;
}

function buildHedgesAndGate(colliders) {
  const g = new THREE.Group();
  const bucket = new GeometryBucket();
  const h = 1.45;
  const t = 0.9;
  const { x0, x1, z0, z1 } = GARDEN;
  const gate = 0.95;
  const segs = [
    [x0 - t, z1, -gate, z1 + t],
    [gate, z1, x1 + t, z1 + t],
    [x0 - t, z0 - t, x1 + t, z0],
    [x0 - t, z0, x0, z1],
    [x1, z0, x1 + t, z1],
  ];
  for (const [ax, az, bx, bz] of segs) {
    bucket.addBox([ax, -0.02, az], [bx, h, bz], { ny: false });
    colliders.push({ minX: ax, maxX: bx, minZ: az, maxZ: bz });
  }
  const hedge = bucket.toMesh(std({ map: T.hedgeTexture(), roughness: 0.95 }), { name: 'hedges' });
  g.add(hedge);

  const white = std({ color: 0xf1efe9, roughness: 0.6 });
  const posts = new GeometryBucket();
  for (const x of [-gate, gate]) {
    const s = x < 0 ? -1 : 1;
    posts.addBox([x - (s < 0 ? 0.16 : 0), -0.02, z1 + 0.3], [x + (s > 0 ? 0.16 : 0), 1.35, z1 + 0.46]);
  }
  // picket gate (closed)
  const zc = z1 + 0.38;
  for (let x = -gate + 0.06; x <= gate - 0.06; x += 0.13) {
    const top = 1.0 + 0.08 * Math.cos(((x / gate) * Math.PI) / 2);
    posts.addBox([x - 0.035, 0.08, zc - 0.015], [x + 0.035, top, zc + 0.015]);
  }
  posts.addBox([-gate, 0.25, zc + 0.015], [gate, 0.33, zc + 0.04]);
  posts.addBox([-gate, 0.75, zc + 0.015], [gate, 0.83, zc + 0.04]);
  g.add(posts.toMesh(white, { name: 'gate' }));
  colliders.push({ minX: -gate, maxX: gate, minZ: z1, maxZ: z1 + t });
  return g;
}

function buildPath() {
  const g = new THREE.Group();
  const gravel = new GeometryBucket();
  const zStart = 1.5;
  const zEnd = GARDEN.z1 + 0.3;
  gravel.addFlatQuad(-0.85, 0.85, zStart, zEnd, -0.006, 1);
  // round gravel apron in front of the house
  g.add(gravel.toMesh(std({ map: T.gravelTexture(), roughness: 1 }), { castShadow: false, name: 'path' }));
  const edge = new GeometryBucket();
  for (const x of [-0.9, 0.85]) edge.addBox([x, -0.02, zStart], [x + 0.05, 0.035, zEnd], { ny: false });
  g.add(edge.toMesh(std({ color: 0x8f877b, roughness: 0.9 }), { castShadow: false, name: 'path-edge' }));
  return g;
}

/** Garden, sky and surrounding countryside. Returns { group, colliders, sky }. */
export function buildOutdoors({ quality = 'high' } = {}) {
  const rng = T.mulberry32(42);
  const group = new THREE.Group();
  group.name = 'outdoors';
  const colliders = [];
  const sky = buildSky();
  group.add(sky, buildGround(rng), buildPath(), buildHedgesAndGate(colliders), buildFlowerBeds(rng, colliders));
  group.add(buildGardenBench(colliders));

  // trees inside the garden (with trunk colliders)
  const gardenTrees = [
    { x: -12.8, z: 8.8, s: 1.15 },
    { x: 13.2, z: 10.2, s: 1.0 },
    { x: -14.2, z: -4.5, s: 1.25 },
    { x: 14.6, z: -9.5, s: 1.1 },
    { x: -13.0, z: -19.8, s: 1.2 },
    { x: 12.2, z: -20.2, s: 1.3 },
    { x: 4.5, z: -21.0, s: 0.9 },
  ];
  for (const t of gardenTrees) {
    const r = 0.25 * t.s;
    colliders.push({ minX: t.x - r, maxX: t.x + r, minZ: t.z - r, maxZ: t.z + r });
  }
  group.add(buildTreeMeshes(gardenTrees, rng, { detailed: true }));

  // countryside trees beyond the hedges
  const far = [];
  const count = quality === 'low' ? 70 : 140;
  while (far.length < count) {
    const a = rng() * Math.PI * 2;
    const d = 26 + Math.pow(rng(), 0.7) * 150;
    const x = Math.cos(a) * d;
    const z = -6 + Math.sin(a) * d;
    if (x > GARDEN.x0 - 4 && x < GARDEN.x1 + 4 && z > GARDEN.z0 - 4 && z < GARDEN.z1 + 4) continue;
    if (Math.abs(x) < 6 && z > GARDEN.z1 && z < 60) continue; // keep the view from the gate open
    far.push({ x, z, s: 0.9 + rng() * 0.9 });
  }
  group.add(buildTreeMeshes(far, rng, { detailed: false }));

  return { group, colliders, sky };
}
