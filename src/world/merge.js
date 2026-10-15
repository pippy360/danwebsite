import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP_ATTRS = ['position', 'normal', 'uv'];

function flipWinding(geo) {
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const s = a.itemSize;
    const arr = a.array;
    for (let v = 0; v < a.count; v += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (v + 1) * s + k;
        const i2 = (v + 2) * s + k;
        const t = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = t;
      }
    }
    a.needsUpdate = true;
  }
}

/**
 * Bakes every static mesh under `root` into one merged mesh per (material, shadow flags),
 * cutting draw calls dramatically for scenes built from many small primitives.
 * Instanced meshes, multi-material meshes and anything `keep(obj)` returns true for are
 * re-parented unchanged (world transform preserved). Returns a new Group.
 */
export function mergeStatic(root, { keep = () => false } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const kept = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || keep(o) || !o.visible) {
      kept.push(o);
      return;
    }
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    const g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
    for (const name of Object.keys(g.morphAttributes)) delete g.morphAttributes[name];
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) flipWinding(g);
    let b = buckets.get(key);
    if (!b) {
      b = { material: o.material, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, geos: [] };
      buckets.set(key, b);
    }
    b.geos.push(g);
  });

  const out = new THREE.Group();
  out.name = `${root.name || 'static'}-merged`;
  for (const b of buckets.values()) {
    const allIndexed = b.geos.every((g) => g.index);
    const geos = allIndexed ? b.geos : b.geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.order;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  for (const o of kept) out.attach(o);
  return out;
}
