import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { washTexture, softShadowTexture } from '../world/textures.js';

export const FRAME_STYLES = {
  black: { color: 0x1c1c1e, roughness: 0.42, metalness: 0.1 },
  oak: { color: 0xb68856, roughness: 0.58 },
  walnut: { color: 0x5a3c28, roughness: 0.5 },
  white: { color: 0xf1efe9, roughness: 0.5 },
  gold: { color: 0xc9a254, roughness: 0.3, metalness: 0.9 },
};
const STYLE_WEIGHTS = [
  ['black', 3],
  ['oak', 2.5],
  ['walnut', 1.5],
  ['white', 1.5],
  ['gold', 1.5],
];

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic frame style per work (overridable with `frame` in art.json). */
export function pickFrameStyle(work) {
  if (work.frame && FRAME_STYLES[work.frame]) return work.frame;
  const total = STYLE_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = ((hashString(String(work.id)) % 10007) / 10007) * total;
  for (const [k, w] of STYLE_WEIGHTS) {
    r -= w;
    if (r < 0) return k;
  }
  return 'black';
}

/**
 * Collects frames for many artworks and merges all their static parts (mouldings, mats,
 * shadows, picture lights) into a handful of meshes. Each artwork keeps its own image mesh
 * (unique texture) and an invisible hit plane for picking.
 */
export class FrameBatch {
  constructor() {
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.materials = {
      frames: Object.fromEntries(Object.entries(FRAME_STYLES).map(([k, v]) => [k, std(v)])),
      mat: std({ color: 0xf3f0e8, roughness: 0.95 }),
      bevel: std({ color: 0xfffdf8, roughness: 0.85 }),
      brass: std({ color: 0xc9a45c, metalness: 0.85, roughness: 0.3 }),
      strip: std({ color: 0xffffff, emissive: 0xffe2b8, emissiveIntensity: 2.4 }),
      shadow: new THREE.MeshBasicMaterial({
        map: softShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
      wash: new THREE.MeshBasicMaterial({
        map: washTexture(),
        color: 0xffd6a6,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
    };
    this.parts = new Map();
  }

  #push(key, geo, matrix) {
    geo.applyMatrix4(matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
  }

  /**
   * placement: { x, y, z, rotY, maxW, maxH, hero, rows }; work: { id, width, height, frame?, mat? }
   * Returns { group, image, hit, area: { w, h }, outer: { w, h } } — add `group` to the scene.
   */
  add(placement, work) {
    const { x, y, z, rotY, maxW, maxH, hero, rows } = placement;
    const aspect = work.width > 0 && work.height > 0 ? work.width / work.height : 1;
    const style = pickFrameStyle(work);
    const hasMat = work.mat !== false;
    const k = THREE.MathUtils.clamp(Math.max(maxW, maxH) / 1.2, 0.55, 1.45);
    const f = 0.045 * k; // moulding width
    const m = hasMat ? 0.085 * k : 0; // mat border
    const fd = hero ? 0.056 : 0.042; // moulding depth
    const iwMax = maxW - 2 * (f + m);
    const ihMax = maxH - 2 * (f + m);
    let iw;
    let ih;
    if (aspect > iwMax / ihMax) {
      iw = iwMax;
      ih = iw / aspect;
    } else {
      ih = ihMax;
      iw = ih * aspect;
    }
    const OW = iw + 2 * (f + m);
    const OH = ih + 2 * (f + m);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    const at = (geo, px, py, pz) => geo.translate(px, py, pz);

    // Moulding: outer bars plus a stepped inner lip.
    const fk = `frame:${style}`;
    this.#push(fk, at(new THREE.BoxGeometry(OW, f, fd), 0, OH / 2 - f / 2, fd / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(OW, f, fd), 0, -OH / 2 + f / 2, fd / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(f, OH - 2 * f, fd), -OW / 2 + f / 2, 0, fd / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(f, OH - 2 * f, fd), OW / 2 - f / 2, 0, fd / 2), matrix);
    const lw = f * 0.32;
    const ld = fd * 0.72;
    const inW = OW - 2 * f;
    const inH = OH - 2 * f;
    this.#push(fk, at(new THREE.BoxGeometry(inW, lw, ld), 0, inH / 2 - lw / 2, ld / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(inW, lw, ld), 0, -inH / 2 + lw / 2, ld / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(lw, inH - 2 * lw, ld), -inW / 2 + lw / 2, 0, ld / 2), matrix);
    this.#push(fk, at(new THREE.BoxGeometry(lw, inH - 2 * lw, ld), inW / 2 - lw / 2, 0, ld / 2), matrix);

    const zInner = fd * 0.5;
    if (hasMat) {
      this.#push('mat', at(new THREE.PlaneGeometry(inW, inH), 0, 0, zInner), matrix);
      this.#push('bevel', at(new THREE.PlaneGeometry(iw + 0.016, ih + 0.016), 0, 0, zInner + 0.0015), matrix);
    } else {
      this.#push('mat', at(new THREE.PlaneGeometry(inW, inH), 0, 0, zInner - 0.002), matrix);
    }

    // Soft drop shadow on the wall, slightly below the frame (light comes from above).
    this.#push('shadow', at(new THREE.PlaneGeometry(OW + 0.34, OH + 0.34), 0, -0.05, 0.0015), matrix);

    // Picture light: brass arm + bar with a glowing strip, and the wash of light it throws.
    if (rows === 1) {
      this.#push('wash', at(new THREE.PlaneGeometry(OW + 1.2, OH + 1.5), 0, 0.32, 0.003), matrix);
      const barLen = THREE.MathUtils.clamp(OW * 0.5, 0.28, 0.85);
      const by = OH / 2 + 0.12;
      const bz = 0.16;
      const mountY = OH / 2 + 0.05;
      const bar = new THREE.CylinderGeometry(0.019, 0.019, barLen, 16);
      bar.rotateZ(Math.PI / 2);
      this.#push('brass', at(bar, 0, by, bz), matrix);
      const dy = by - mountY;
      const dz = bz - 0.012;
      const arm = new THREE.CylinderGeometry(0.007, 0.007, Math.hypot(dy, dz), 8);
      arm.rotateX(Math.atan2(dz, dy));
      this.#push('brass', at(arm, 0, (mountY + by) / 2, (0.012 + bz) / 2), matrix);
      this.#push('brass', at(new THREE.BoxGeometry(0.07, 0.035, 0.024), 0, mountY, 0.012), matrix);
      this.#push('strip', at(new THREE.BoxGeometry(barLen * 0.92, 0.005, 0.018), 0, by - 0.019, bz), matrix);
    } else {
      this.#push('wash', at(new THREE.PlaneGeometry(OW + 0.7, OH + 0.8), 0, 0.15, 0.003), matrix);
    }

    // Per-artwork image + invisible hit plane.
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotY;
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xd8d3c9, toneMapped: false }),
    );
    image.scale.set(iw, ih, 1);
    image.position.z = zInner + 0.003;
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(OW, OH), this.materials.hit);
    hit.position.z = fd + 0.002;
    group.add(image, hit);
    return { group, image, hit, area: { w: iw, h: ih }, outer: { w: OW, h: OH }, style };
  }

  /** Merges all collected static parts. Call once after every artwork has been added. */
  finalize() {
    const group = new THREE.Group();
    group.name = 'frames';
    for (const [key, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const material = key.startsWith('frame:') ? this.materials.frames[key.slice(6)] : this.materials[key];
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = key;
      mesh.castShadow = key.startsWith('frame:') || key === 'brass';
      mesh.receiveShadow = !['shadow', 'wash', 'strip'].includes(key);
      if (key === 'shadow' || key === 'wash') mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** Fits the image plane inside the frame's image area, preserving the texture's aspect ratio. */
export function fitImage(item, width, height) {
  const a = width / height;
  const { w, h } = item.area;
  if (a > w / h) item.image.scale.set(w, w / a, 1);
  else item.image.scale.set(h * a, h, 1);
}
