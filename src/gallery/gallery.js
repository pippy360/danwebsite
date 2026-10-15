import * as THREE from 'three';
import { computeSpans, layoutArt } from './layout.js';
import { FrameBatch, fitImage } from './frames.js';

const DEFAULT_MANIFEST = {
  artist: 'Dan Peacock',
  tagline: 'Paintings, drawings & other things',
  instagram: '',
  works: [],
};

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

/** Loads and normalises public/art/art.json. Never throws: falls back to an empty collection. */
export async function loadManifest(baseUrl) {
  let raw = DEFAULT_MANIFEST;
  try {
    const res = await fetch(`${baseUrl}art/art.json`, { cache: 'no-cache' });
    if (res.ok) raw = await res.json();
    else console.warn(`[gallery] art.json not found (${res.status}); showing placeholder art.`);
  } catch (err) {
    console.warn('[gallery] Could not load art.json; showing placeholder art.', err);
  }
  const works = [];
  for (const w of Array.isArray(raw.works) ? raw.works : []) {
    if (!w || typeof w.file !== 'string' || !w.file) continue;
    works.push({
      id: w.file,
      title: w.title || 'Untitled',
      year: w.year ? String(w.year) : '',
      medium: w.medium || '',
      caption: w.caption || '',
      instagram: w.instagram || '',
      featured: Boolean(w.featured),
      frame: w.frame,
      mat: w.mat,
      width: Number(w.width) || 0,
      height: Number(w.height) || 0,
      src: `${baseUrl}art/${encodePath(w.file)}`,
    });
  }
  return {
    artist: raw.artist || DEFAULT_MANIFEST.artist,
    tagline: raw.tagline ?? DEFAULT_MANIFEST.tagline,
    instagram: raw.instagram || '',
    works,
  };
}

async function decodeImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** Downscale (if needed) so GPU memory stays reasonable even with dozens of large images. */
function textureFromSource(source, w, h, maxSize, anisotropy) {
  const s = Math.min(1, maxSize / Math.max(w, h));
  let tex;
  if (s < 1 || source instanceof HTMLCanvasElement) {
    let canvas = source;
    if (s < 1) {
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * s));
      canvas.height = Math.max(1, Math.round(h * s));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    tex = new THREE.CanvasTexture(canvas);
  } else {
    tex = new THREE.Texture(source);
    tex.needsUpdate = true;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class Gallery {
  constructor({ scene, anisotropy = 8, maxTextureSize = 1024 }) {
    this.scene = scene;
    this.anisotropy = anisotropy;
    this.maxTextureSize = maxTextureSize;
    this.items = [];
    this.hitTargets = [];
    this.root = new THREE.Group();
    this.root.name = 'gallery';
    scene.add(this.root);
  }

  /** Lays out and frames all works. */
  build(works) {
    const spans = computeSpans();
    const { placements, dropped } = layoutArt(spans, works);
    if (dropped > 0) console.warn(`[gallery] ${dropped} works did not fit on the walls and were skipped.`);
    const batch = new FrameBatch();
    for (const p of placements) {
      const built = batch.add(p, p.work);
      const item = {
        index: this.items.length,
        work: p.work,
        room: p.room,
        group: built.group,
        image: built.image,
        hit: built.hit,
        area: built.area,
        outer: built.outer,
        center: new THREE.Vector3(p.x, p.y, p.z),
        normal: new THREE.Vector3(Math.sin(p.rotY), 0, Math.cos(p.rotY)),
        loaded: false,
      };
      built.hit.userData.artIndex = item.index;
      built.image.userData.artIndex = item.index;
      this.items.push(item);
      this.hitTargets.push(built.hit);
      this.root.add(built.group);
    }
    this.root.add(batch.finalize());
    // Static from here on: skip per-frame matrix updates.
    this.root.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.root.updateMatrixWorld(true);
    return this.items;
  }

  /**
   * Loads textures nearest-first from `origin`, a few at a time.
   * onProgress(loaded, total) is called after each one.
   */
  async loadTextures(origin, onProgress) {
    const queue = this.items
      .slice()
      .sort((a, b) => a.center.distanceToSquared(origin) - b.center.distanceToSquared(origin));
    const total = queue.length;
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          await this.#loadItem(item);
        } catch (err) {
          console.warn(`[gallery] Failed to load ${item.work.src || item.work.id}`, err);
          item.image.material.color.set(0x8a8580);
        }
        done++;
        onProgress?.(done, total);
        // yield so texture uploads don't all land in one frame
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
  }

  async #loadItem(item) {
    const w = item.work;
    let tex;
    let width;
    let height;
    if (w.canvas) {
      width = w.canvas.width;
      height = w.canvas.height;
      tex = textureFromSource(w.canvas, width, height, this.maxTextureSize, this.anisotropy);
    } else {
      const img = await decodeImage(w.src);
      width = img.naturalWidth;
      height = img.naturalHeight;
      tex = textureFromSource(img, width, height, this.maxTextureSize, this.anisotropy);
    }
    const mat = item.image.material;
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    fitImage(item, width, height);
    item.image.updateMatrix();
    item.image.updateMatrixWorld(true);
    w.naturalWidth = width;
    w.naturalHeight = height;
    item.loaded = true;
  }

  itemFor(object) {
    const i = object?.userData?.artIndex;
    return i === undefined ? null : this.items[i];
  }
}
