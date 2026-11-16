// input.js — keyboard + mouse + pointer lock, one frame of control state.
// Produces the input object sim.stepPlayer consumes each tick.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.firing = false;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null; // (code, down) for menu keys the game handles
    this.onMouseDown = null;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.firing = true; if (this.onMouseDown) this.onMouseDown(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, true);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey) this.onKey(e.code, false);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* pointer lock unavailable; the game still runs */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Consume this frame's look deltas and build the sim input. */
  frameInput(extra) {
    const k = this.keys;
    const input = {
      lookX: this.lookX, lookY: this.lookY,
      moveX: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      moveZ: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      firing: this.firing,
      reload: k.has('KeyR'),
      jump: k.has('Space'),
      crouch: k.has('ControlLeft') || k.has('KeyC'),
      walk: k.has('ShiftLeft') || k.has('ShiftRight'),
      use: k.has('KeyE'),
      switchTo: null,
      throwGrenade: null,
      ...extra,
    };
    this.lookX = 0;
    this.lookY = 0;
    return input;
  }
}
