/**
 * Touch controls: a floating joystick on the left of the screen to walk, drag anywhere
 * else to look around, and quick taps to select artworks.
 */
export class TouchControls {
  constructor(surface, controller, { joystick, knob, onTap } = {}) {
    this.surface = surface;
    this.controller = controller;
    this.joystick = joystick;
    this.knob = knob;
    this.onTap = onTap;
    this.enabled = false;
    this.joy = null; // { id, x, y, start, moved }
    this.lookTouch = null; // { id, x, y, start, moved }
    this.radius = 56;
    const opts = { passive: false };
    surface.addEventListener('touchstart', (e) => this.#start(e), opts);
    surface.addEventListener('touchmove', (e) => this.#move(e), opts);
    surface.addEventListener('touchend', (e) => this.#end(e), opts);
    surface.addEventListener('touchcancel', (e) => this.#end(e), opts);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.#resetJoystick();
  }

  #start(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const now = performance.now();
      if (!this.joy && t.clientX < window.innerWidth * 0.42) {
        this.joy = { id: t.identifier, x: t.clientX, y: t.clientY, start: now, moved: 0 };
        if (this.joystick) {
          this.joystick.style.left = `${t.clientX}px`;
          this.joystick.style.top = `${t.clientY}px`;
          this.joystick.classList.add('active');
        }
      } else if (!this.lookTouch) {
        this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY, start: now, moved: 0 };
      }
    }
  }

  #move(e) {
    if (!this.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        const dx = t.clientX - this.joy.x;
        const dy = t.clientY - this.joy.y;
        const len = Math.hypot(dx, dy);
        this.joy.moved = Math.max(this.joy.moved, len);
        const k = len > this.radius ? this.radius / len : 1;
        if (this.knob) this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        // small dead zone so resting a thumb doesn't drift
        const nx = (dx * k) / this.radius;
        const ny = (dy * k) / this.radius;
        const mag = Math.hypot(nx, ny);
        const scale = mag < 0.12 ? 0 : (mag - 0.12) / (0.88 * mag);
        this.controller.analog.x = nx * scale;
        this.controller.analog.y = -ny * scale;
      } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
        const dx = t.clientX - this.lookTouch.x;
        const dy = t.clientY - this.lookTouch.y;
        this.lookTouch.x = t.clientX;
        this.lookTouch.y = t.clientY;
        this.lookTouch.moved += Math.abs(dx) + Math.abs(dy);
        this.controller.look(dx * 0.0045, dy * 0.0045);
      }
    }
  }

  #end(e) {
    for (const t of e.changedTouches) {
      const now = performance.now();
      if (this.joy && t.identifier === this.joy.id) {
        const tap = this.joy.moved < 10 && now - this.joy.start < 300;
        this.#resetJoystick();
        if (tap && this.enabled) this.onTap?.(t.clientX, t.clientY);
      } else if (this.lookTouch && t.identifier === this.lookTouch.id) {
        const tap = this.lookTouch.moved < 12 && now - this.lookTouch.start < 320;
        this.lookTouch = null;
        if (tap && this.enabled) this.onTap?.(t.clientX, t.clientY);
      }
    }
  }

  #resetJoystick() {
    this.joy = null;
    this.controller.analog.x = 0;
    this.controller.analog.y = 0;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    this.joystick?.classList.remove('active');
  }
}
