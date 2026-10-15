import * as THREE from 'three';

const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyZ: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l', KeyQ: 'l',
  KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'run', ShiftRight: 'run',
};

const MAX_PITCH = THREE.MathUtils.degToRad(82);

/**
 * First-person walking: pointer-lock mouse look, WASD/arrow keys (+Shift to run),
 * an analogue input hook for touch joysticks, gentle head-bob, and circle-vs-box
 * collision (with sliding) against 2D axis-aligned colliders.
 */
export class PlayerController {
  constructor(camera, domElement, { colliders = [], eyeHeight = 1.62, radius = 0.3 } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.colliders = colliders;
    this.eyeHeight = eyeHeight;
    this.radius = radius;
    this.walkSpeed = 2.3;
    this.runSpeed = 4.4;
    this.sensitivity = 1;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector2();
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = false;
    this.locked = false;
    this.keys = new Set();
    this.analog = { x: 0, y: 0 }; // touch joystick: x = strafe, y = forward
    this.bobPhase = 0;
    this.onLock = null;
    this.onUnlock = null;
    this.onLockError = null;
    camera.rotation.order = 'YXZ';

    document.addEventListener('keydown', (e) => this.#onKey(e, true));
    document.addEventListener('keyup', (e) => this.#onKey(e, false));
    document.addEventListener('mousemove', (e) => this.#onMouseMove(e));
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (this.locked && !was) this.onLock?.();
      if (!this.locked && was) this.onUnlock?.();
    });
    document.addEventListener('pointerlockerror', () => this.onLockError?.());
    window.addEventListener('blur', () => this.keys.clear());
  }

  get supportsPointerLock() {
    return 'requestPointerLock' in Element.prototype;
  }

  lock() {
    if (!this.supportsPointerLock) return;
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => this.onLockError?.());
    } catch {
      this.onLockError?.();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setPose(x, z, yaw = this.yaw, pitch = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.#applyCamera(0);
  }

  /** Rotate the view by a delta (radians); used by touch look. */
  look(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dPitch, -MAX_PITCH, MAX_PITCH);
  }

  #onMouseMove(e) {
    if (!this.locked || !this.enabled) return;
    // ignore the occasional huge spike some browsers emit right after locking
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    const s = 0.0021 * this.sensitivity;
    this.look(e.movementX * s, e.movementY * s);
  }

  #onKey(e, down) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = KEYMAP[e.code];
    if (!k) return;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (this.enabled && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    let ix = 0;
    let iz = 0;
    let run = false;
    if (this.enabled) {
      let f = (this.keys.has('f') ? 1 : 0) - (this.keys.has('b') ? 1 : 0) + this.analog.y;
      let r = (this.keys.has('r') ? 1 : 0) - (this.keys.has('l') ? 1 : 0) + this.analog.x;
      const len = Math.hypot(f, r);
      if (len > 1) {
        f /= len;
        r /= len;
      }
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      ix = -sin * f + cos * r;
      iz = -cos * f - sin * r;
      run = this.keys.has('run') || Math.hypot(this.analog.x, this.analog.y) > 0.92;
    }
    const speed = run ? this.runSpeed : this.walkSpeed;
    const moving = ix !== 0 || iz !== 0;
    const k = 1 - Math.exp(-dt * (moving ? 9 : 11));
    this.velocity.x += (ix * speed - this.velocity.x) * k;
    this.velocity.y += (iz * speed - this.velocity.y) * k;
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.y * dt;
    this.#collide();
    this.#applyCamera(dt);
  }

  #applyCamera(dt) {
    const speed = this.velocity.length();
    this.bobPhase += dt * speed * 4.6;
    const amp = Math.min(speed / this.walkSpeed, 1.6) * 0.022;
    const bob = Math.sin(this.bobPhase) * amp;
    const sway = Math.cos(this.bobPhase * 0.5) * amp * 0.5;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.camera.position.set(this.position.x + rx * sway, this.eyeHeight + bob, this.position.z + rz * sway);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  #collide() {
    const r = this.radius;
    const p = this.position;
    for (let iter = 0; iter < 4; iter++) {
      let hit = false;
      for (const b of this.colliders) {
        if (p.x < b.minX - r || p.x > b.maxX + r || p.z < b.minZ - r || p.z > b.maxZ + r) continue;
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const nz = dz / d;
          p.x += nx * (r - d);
          p.z += nz * (r - d);
          const vn = this.velocity.x * nx + this.velocity.y * nz;
          if (vn < 0) {
            this.velocity.x -= vn * nx;
            this.velocity.y -= vn * nz;
          }
        } else {
          // centre inside the box: push out along the shallowest axis
          const left = p.x - b.minX;
          const right = b.maxX - p.x;
          const back = p.z - b.minZ;
          const front = b.maxZ - p.z;
          const m = Math.min(left, right, back, front);
          if (m === left) p.x = b.minX - r;
          else if (m === right) p.x = b.maxX + r;
          else if (m === back) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
      }
      if (!hit) break;
    }
  }
}
