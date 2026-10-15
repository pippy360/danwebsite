import './style.css';
import * as THREE from 'three';
import { START, roomAt } from './world/floorplan.js';
import { buildHouse } from './world/house.js';
import { buildOutdoors, HORIZON_COLOR } from './world/outdoors.js';
import { buildFurniture } from './world/furniture.js';
import { mergeStatic } from './world/merge.js';
import { setupLighting } from './world/lighting.js';
import { buildSigns, waitForFonts } from './world/signs.js';
import { setMaxAnisotropy, softShadowTexture } from './world/textures.js';
import { Gallery, loadManifest } from './gallery/gallery.js';
import { createPlaceholderWorks } from './gallery/placeholders.js';
import { PlayerController } from './player/controller.js';
import { TouchControls } from './player/touch.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const ui = new UI({
  onEnter: () => enter(),
  onResume: () => resume(),
  onPause: () => pause(),
  onOpenGrid: () => openGrid(),
  onCloseGrid: () => closeGrid(),
  onSelectFromGrid: (i) => openArt(i, { fromGrid: true }),
  onCloseLightbox: (viaKey) => closeArt(viaKey),
  onWalkTo: (item) => walkTo(item),
  onActivate: () => hoverItem && state === 'walking' && openArt(hoverItem.index),
});

// ── state ────────────────────────────────────────────────────────────────
// loading → ready → walking ⇄ paused; inspect (lightbox) and grid overlay either.
let state = 'loading';
let hoverItem = null;
let lightboxFromGrid = false;
let gridReturn = 'start';
let worldReady = false;

let renderer;
let scene;
let camera;
let player;
let touch;
let gallery;
let rayTargets = [];
let sky;
const raycaster = new THREE.Raycaster();
raycaster.far = 7.5;

function createRenderer(canvas, quality) {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1.5 : 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    return r;
  } catch (err) {
    console.error('WebGL unavailable', err);
    return null;
  }
}

/** Soft dark patches under furniture: cheap contact shadows that ground everything. */
function contactShadows(colliders) {
  const mat = new THREE.MeshBasicMaterial({
    map: softShadowTexture({ inset: 0.3 }),
    color: 0x000000,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, colliders.length);
  const m = new THREE.Matrix4();
  colliders.forEach((c, i) => {
    const w = c.maxX - c.minX + 0.35;
    const d = c.maxZ - c.minZ + 0.35;
    m.makeScale(w, 1, d).setPosition((c.minX + c.maxX) / 2, 0.015, (c.minZ + c.maxZ) / 2);
    mesh.setMatrixAt(i, m);
  });
  mesh.renderOrder = 1;
  mesh.name = 'contact-shadows';
  return mesh;
}

async function init() {
  const isTouch = ui.isTouch;
  const quality = params.get('quality') || (isTouch || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'high');
  const canvas = document.getElementById('scene');
  renderer = createRenderer(canvas, quality);

  ui.setProgress(0.05, 'Loading the collection…');
  const manifest = await loadManifest(BASE);
  let works = manifest.works;
  const placeholder = works.length === 0;
  if (placeholder) works = createPlaceholderWorks(30, 7);
  ui.setManifest(manifest, { count: works.length, placeholder });

  if (!renderer) return initFallback(works);

  ui.setProgress(0.15, 'Building the house…');
  await nextFrame();

  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_COLOR, 40, 280);
  scene.background = HORIZON_COLOR.clone();
  camera = new THREE.PerspectiveCamera(isTouch ? 72 : 68, window.innerWidth / window.innerHeight, 0.05, 900);

  const house = buildHouse();
  const outdoors = buildOutdoors({ quality });
  const furniture = buildFurniture();
  sky = outdoors.sky;
  // Hundreds of small primitives → a few dozen merged meshes (big win on phones).
  const houseStatic = mergeStatic(house.group, { keep: (o) => o.userData.batched });
  const furnitureStatic = mergeStatic(furniture.group);
  scene.add(houseStatic, outdoors.group, furnitureStatic, contactShadows(furniture.colliders));
  setupLighting(scene, renderer, { quality });

  const colliders = [...house.colliders, ...outdoors.colliders, ...furniture.colliders];
  player = new PlayerController(camera, canvas, { colliders });
  player.setPose(START.x, START.z, START.yaw, START.pitch);
  player.onLock = onLock;
  player.onUnlock = onUnlock;
  player.onLockError = onLockError;
  touch = new TouchControls(canvas, player, {
    joystick: document.getElementById('joystick'),
    knob: document.querySelector('#joystick .knob'),
    onTap: (x, y) => pickAt(x, y),
  });

  ui.setProgress(0.3, 'Hanging the art…');
  await nextFrame();
  await waitForFonts();
  scene.add(buildSigns(manifest.artist, manifest.tagline));
  gallery = new Gallery({
    scene,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
    maxTextureSize: quality === 'low' ? 768 : 1280,
  });
  const items = gallery.build(works);
  ui.setItems(items);
  rayTargets = [...house.occluders, ...gallery.hitTargets];

  window.addEventListener('resize', onResize);
  canvas.addEventListener('click', onCanvasClick);
  renderer.compile(scene, camera);
  renderer.setAnimationLoop(frame);
  worldReady = true;

  // Debug / screenshot hooks: ?view=x,z,yawDeg,pitchDeg jumps straight in (no overlays).
  window.__gallery = { THREE, scene, camera, renderer, player, gallery, setView, ready: false };
  if (params.has('view')) {
    const [x, z, yaw = 0, pitch = 0] = params.get('view').split(',').map(Number);
    setView(x, z, yaw, pitch);
  }

  state = 'ready';
  ui.setReady();
  ui.setProgress(0.4, `Framing ${items.length} works…`);
  await gallery.loadTextures(player.position, (done, total) => {
    ui.setProgress(0.4 + 0.6 * (done / total), done < total ? `Framing ${done} of ${total} works…` : `${total} works on the walls`);
  });
  window.__gallery.ready = true;
}

function setView(x, z, yawDeg = 0, pitchDeg = 0) {
  ui.showStart(false);
  ui.showHUD(false);
  document.getElementById('vignette').classList.add('hidden');
  state = 'shot';
  player.enabled = false;
  player.setPose(x, z, THREE.MathUtils.degToRad(yawDeg), THREE.MathUtils.degToRad(pitchDeg));
}

function initFallback(works) {
  // No WebGL: the collection is still browsable as a grid + lightbox.
  ui.setItems(works.map((work, index) => ({ index, work, room: null })));
  ui.setProgress(1, 'Your browser can’t show the 3D house, but you can browse the collection.');
  const btn = document.getElementById('enter-btn');
  btn.textContent = 'Browse the collection';
  btn.disabled = false;
  btn.onclick = (e) => {
    e.stopImmediatePropagation();
    openGrid();
  };
  document.getElementById('grid-btn').classList.add('hidden');
  state = 'ready';
}

// ── transitions ──────────────────────────────────────────────────────────

function setWalking() {
  state = 'walking';
  player.enabled = true;
  touch.setEnabled(ui.isTouch);
  ui.showStart(false);
  ui.showPause(false);
  ui.showHUD(true);
}

function stopWalking() {
  player.enabled = false;
  touch?.setEnabled(false);
  player?.keys.clear();
  hoverItem = null;
  ui.setHover(null);
}

function enter() {
  if (!worldReady) return;
  if (ui.isTouch || !player.supportsPointerLock) setWalking();
  else player.lock(); // → onLock
}

function resume() {
  if (!worldReady) return;
  if (ui.isTouch || !player.supportsPointerLock) setWalking();
  else player.lock();
}

function pause() {
  if (state !== 'walking') return;
  stopWalking();
  state = 'paused';
  ui.showPause(true);
}

function onLock() {
  setWalking();
}

function onUnlock() {
  // Esc (or the browser) released the mouse while walking → pause.
  if (state === 'walking') pause();
}

function onLockError() {
  // e.g. Chrome refuses to re-lock for ~1s after Esc; keep the pause screen up.
  if (state !== 'walking') {
    state = 'paused';
    ui.showStart(false);
    ui.showPause(true);
    ui.toast('Click again to continue');
  }
}

function openArt(index, { fromGrid = false } = {}) {
  if (!gallery && !ui.items.length) return;
  lightboxFromGrid = fromGrid;
  if (state === 'walking') stopWalking();
  state = 'inspect';
  if (player?.locked) player.unlock();
  ui.openLightbox(index);
}

function closeArt(viaKey) {
  ui.closeLightbox();
  if (lightboxFromGrid) {
    state = 'grid';
    return;
  }
  if (ui.isTouch || !player.supportsPointerLock) {
    setWalking();
  } else if (viaKey) {
    // Escape doesn't count as a user gesture for pointer lock, so ask for a click.
    state = 'paused';
    ui.showPause(true);
  } else {
    state = 'paused';
    player.lock(); // → onLock, or onLockError shows the pause screen
  }
}

function openGrid() {
  if (state === 'grid') return;
  gridReturn = state === 'loading' || state === 'ready' ? 'start' : 'pause';
  if (state === 'walking') stopWalking();
  if (player?.locked) player.unlock();
  state = 'grid';
  ui.showStart(false);
  ui.showPause(false);
  ui.openGrid();
}

function closeGrid() {
  ui.closeGrid();
  if (gridReturn === 'start' || !worldReady) {
    state = worldReady ? 'ready' : 'loading';
    ui.showStart(true);
  } else if (ui.isTouch) {
    setWalking();
  } else {
    state = 'paused';
    ui.showPause(true);
  }
}

/** Teleport to stand in front of an artwork, facing it. */
function walkTo(item) {
  if (!worldReady || !item.center) return;
  ui.closeLightbox();
  ui.closeGrid();
  const dist = item.outer && item.outer.w > 1.5 ? 3.0 : 2.3;
  const x = item.center.x + item.normal.x * dist;
  const z = item.center.z + item.normal.z * dist;
  const yaw = Math.atan2(item.normal.x, item.normal.z);
  const pitch = Math.atan2(item.center.y - player.eyeHeight, dist) * 0.8;
  player.setPose(x, z, yaw, pitch);
  player.update(0); // resolve collisions with furniture
  lightboxFromGrid = false;
  if (ui.isTouch || !player.supportsPointerLock) setWalking();
  else {
    state = 'paused';
    player.lock();
  }
}

// ── picking ──────────────────────────────────────────────────────────────

const _ndc = new THREE.Vector2();
function pick(ndcX, ndcY) {
  if (!gallery) return null;
  _ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(_ndc, camera);
  const hit = raycaster.intersectObjects(rayTargets, false)[0];
  return hit ? gallery.itemFor(hit.object) : null;
}

function pickAt(clientX, clientY) {
  if (state !== 'walking') return;
  const item = pick((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  if (item) openArt(item.index);
}

function onCanvasClick() {
  if (ui.isTouch) return;
  if (state === 'walking' && player.locked) {
    if (hoverItem) openArt(hoverItem.index);
  } else if (state === 'paused') {
    resume();
  }
}

// ── loop ────────────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let frameCount = 0;
let idleTime = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  frameCount++;
  if (state === 'ready' || state === 'loading') {
    // gentle look-around behind the start screen
    idleTime += dt;
    player.yaw = START.yaw + Math.sin(idleTime * 0.12) * 0.07;
    player.pitch = START.pitch + Math.sin(idleTime * 0.09) * 0.015;
  }
  player.update(dt);
  sky.material.uniforms.time.value += dt;

  if (state === 'walking') {
    if (frameCount % 2 === 0) {
      const item = pick(0, 0);
      if (item !== hoverItem) {
        hoverItem = item;
        ui.setHover(item);
      }
    }
    if (frameCount % 10 === 0) {
      const room = roomAt(player.position.x, player.position.z);
      ui.setRoom(room ? room.name : 'The Front Garden');
    }
  }
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

init().catch((err) => {
  console.error(err);
  ui.setProgress(1, 'Something went wrong while building the house — see the console for details.');
});
