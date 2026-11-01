// ── Touchpad → right stick: the movement rules ───────────────────────────────
// Pure maths, no DOM and no React, so it can be tested on its own and mirrored EXACTLY by
// android-client/.../TouchpadMath.kt (the native touch engine runs the same rules; if the two
// drift apart the pad feels different with native input on and off — the same trap as
// stickFeel.ts / NativeInputEngine.kt, so change BOTH files and BOTH test files together).
//
// A touchpad is a rectangle on the pad. A finger sliding on it pushes the RIGHT stick, in the
// same design units the sticks use (±STICK_R). Two feels, both chosen by the player:
//   "speed"    like a mouse-look: the stick follows how FAST the finger moves, and falls back to
//              centre when the finger pauses. Best for turning a camera.
//   "distance" like a floating stick: the stick follows how FAR the finger is from where it first
//              touched, and holds while the finger stays down.
// On lift: "instant" snaps the stick to centre; "glide" eases it back over a fraction of a second.
//
// Recommended defaults (what a new pad gets): speed + instant, sensitivity 1.
//
// Orientation matches the on-screen sticks: finger right = +x, finger down = +y.

export type TouchpadFeel = "speed" | "distance";
export type TouchpadRelease = "instant" | "glide";

export const STICK_R = 60;            // full deflection, design units (= STICK_MAX_R in the engine)

export const TP_DEFAULT_FEEL: TouchpadFeel = "speed";
export const TP_DEFAULT_RELEASE: TouchpadRelease = "instant";
export const TP_DEFAULT_SENS = 1;
export const TP_SENS_MIN = 0.3;
export const TP_SENS_MAX = 3;

const SPEED_FULL = 900;               // finger speed (design units / second) that gives full deflection at sens 1
const SPEED_SMOOTH_TAU = 0.03;        // seconds: how quickly the speed estimate follows the finger
const SPEED_STOP_AFTER = 0.045;       // seconds with no movement before the finger counts as stopped
const SPEED_STOP_TAU = 0.035;         // seconds: how quickly the stick falls back once it stopped
const DIST_FULL = 90;                 // drag distance (design units) that gives full deflection at sens 1
const GLIDE_TAU = 0.08;               // seconds: the "glide" return after lifting
const MIN_DT = 0.004;                 // seconds: floor on the time between two moves (stops speed spikes)
const ZERO_EPS = 0.5;                 // design units: below this a gliding stick counts as centred

/** The pad's footprint in design units. A touchpad is stored like a trigger: centre x/y, optional
 *  w/h, and a radius `r` that only sets the default shape (3.6 : 2.2, a laptop-trackpad-ish slab).
 *  ONE definition for the editor, the page and the native geometry export, so they never disagree. */
export function touchpadSize(b: { r: number; w?: number; h?: number }): { w: number; h: number } {
  return { w: b.w ?? b.r * 3.6, h: b.h ?? b.r * 2.2 };
}

/** Clamp whatever a saved pad says into the range the pad understands. */
export function cleanTouchpadOptions(o: { feel?: unknown; release?: unknown; sens?: unknown }) {
  const feel: TouchpadFeel = o.feel === "distance" ? "distance" : "speed";
  const release: TouchpadRelease = o.release === "glide" ? "glide" : "instant";
  const n = typeof o.sens === "number" && Number.isFinite(o.sens) ? o.sens : TP_DEFAULT_SENS;
  return { feel, release, sens: Math.min(TP_SENS_MAX, Math.max(TP_SENS_MIN, n)) };
}

export class TouchpadState {
  feel: TouchpadFeel;
  release: TouchpadRelease;
  sens: number;
  /** The stick the pad is pushing right now, design units (±STICK_R). */
  x = 0;
  y = 0;
  held = false;
  private ox = 0; private oy = 0;       // where the finger first touched
  private lx = 0; private ly = 0;       // where it was at the last move
  private lt = 0;                       // time of the last move, ms
  private vx = 0; private vy = 0;       // smoothed finger speed, design units / second
  private tickT = 0;                    // time of the last tick, ms

  constructor(feel?: unknown, release?: unknown, sens?: unknown) {
    const c = cleanTouchpadOptions({ feel, release, sens });
    this.feel = c.feel; this.release = c.release; this.sens = c.sens;
  }

  /** True while the pad still has something to say (finger down, or a glide still running):
   *  the caller keeps ticking until this is false. */
  get active(): boolean {
    return this.held || Math.abs(this.x) > 0 || Math.abs(this.y) > 0;
  }

  /** Where the finger first touched / where it is now — for the pad's visuals only. */
  get originX(): number { return this.ox; }
  get originY(): number { return this.oy; }
  get fingerX(): number { return this.lx; }
  get fingerY(): number { return this.ly; }

  /** Forget everything (the pad was swapped, or the screen lost the touch). */
  reset(): void {
    this.held = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
  }

  down(x: number, y: number, t: number): void {
    this.held = true;
    this.ox = x; this.oy = y; this.lx = x; this.ly = y;
    this.lt = t; this.tickT = t;
    this.vx = 0; this.vy = 0;
    this.x = 0; this.y = 0;             // landing never deflects the stick by itself
  }

  /** The finger moved. Returns true when the stick value changed. */
  move(x: number, y: number, t: number): boolean {
    if (!this.held) return false;
    const px = this.x, py = this.y;
    if (this.feel === "speed") {
      const dt = Math.max((t - this.lt) / 1000, MIN_DT);
      const a = 1 - Math.exp(-dt / SPEED_SMOOTH_TAU);
      this.vx += ((x - this.lx) / dt - this.vx) * a;
      this.vy += ((y - this.ly) / dt - this.vy) * a;
      this.fromSpeed();
    } else {
      const k = (STICK_R / DIST_FULL) * this.sens;
      this.clampTo(((x - this.ox) * k), ((y - this.oy) * k));
    }
    this.lx = x; this.ly = y; this.lt = t;
    return this.x !== px || this.y !== py;
  }

  /** The finger lifted. */
  up(_t: number): void {
    this.held = false;
    this.vx = 0; this.vy = 0;
    if (this.release === "instant") { this.x = 0; this.y = 0; }
    // "glide": keep the current value; tick() eases it to centre.
  }

  /** Call about every frame while `active`. Returns true when the stick value changed. */
  tick(t: number): boolean {
    const dt = Math.max((t - this.tickT) / 1000, 0);
    this.tickT = t;
    const px = this.x, py = this.y;
    if (this.held) {
      // A finger that stopped sends no more move events, so the speed feel has to notice by itself.
      if (this.feel === "speed" && (t - this.lt) / 1000 > SPEED_STOP_AFTER) {
        const f = Math.exp(-dt / SPEED_STOP_TAU);
        this.vx *= f; this.vy *= f;
        this.fromSpeed();
      }
    } else if (this.x !== 0 || this.y !== 0) {
      const f = Math.exp(-dt / GLIDE_TAU);
      this.x *= f; this.y *= f;
      if (Math.hypot(this.x, this.y) < ZERO_EPS) { this.x = 0; this.y = 0; }
    }
    return this.x !== px || this.y !== py;
  }

  private fromSpeed(): void {
    const mag = Math.hypot(this.vx, this.vy);
    if (mag < 1e-6) { this.x = 0; this.y = 0; return; }
    const f = Math.min(1, mag / (SPEED_FULL / this.sens));
    this.x = (this.vx / mag) * STICK_R * f;
    this.y = (this.vy / mag) * STICK_R * f;
  }

  private clampTo(dx: number, dy: number): void {
    const mag = Math.hypot(dx, dy);
    if (mag > STICK_R) { dx = (dx / mag) * STICK_R; dy = (dy / mag) * STICK_R; }
    this.x = dx; this.y = dy;
  }
}
