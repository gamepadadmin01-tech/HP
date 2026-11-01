// Run: node touchpad-fuzz.test.mjs
// Glitch hunt for the touchpad and the sticks. Random touches thrown at the real maths, checking things that
// must ALWAYS be true (the stick stays inside its circle, never NaN, lands at zero, comes home on release),
// the "finger resting with a shaky hand" case, the sensitivity maths, and that the file the phone's test
// compares against is up to date with the page's code.
import assert from "node:assert/strict";
import fs from "node:fs";
import { TouchpadState, STICK_R } from "./src/app/touchpad.ts";
import { stickResponse, applyStickGain } from "./src/app/stickFeel.ts";
import { buildGolden } from "./golden.mjs";

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const finite = (v) => Number.isFinite(v);

// ── 1. the stick never leaves its circle, never goes NaN, whatever the finger does
let steps = 0;
for (const feel of ["speed", "distance"]) for (const release of ["instant", "glide"]) for (const sens of [0.3, 1, 3]) for (let seed = 1; seed <= 40; seed++) {
  const r = rng(seed * 131 + sens * 10), s = new TouchpadState(feel, release, sens);
  let t = 5000, down = false, x = 200, y = 120;
  for (let i = 0; i < 400; i++) {
    t += r() < 0.15 ? 0 : 1 + Math.floor(r() * 40);
    const roll = r();
    if (!down) {
      if (roll < 0.6) { x = r() * 400; y = r() * 240; s.down(x, y, t); down = true; assert.equal(s.x, 0, "landing never deflects the stick"); assert.equal(s.y, 0); }
      else s.tick(t);
    } else if (roll < 0.6) { const big = r() < 0.08; x += (r() - 0.5) * (big ? 2000 : 60); y += (r() - 0.5) * (big ? 1500 : 40); s.move(x, y, t); }
    else if (roll < 0.8) s.tick(t);
    else if (roll < 0.95) { s.up(t); down = false; if (release === "instant") { assert.equal(s.x, 0, "instant release: centred at once"); assert.equal(s.y, 0); } }
    else { s.reset(); down = false; assert.deepEqual([s.x, s.y, s.active], [0, 0, false], "a taken-away touch leaves nothing behind"); }
    assert.ok(finite(s.x) && finite(s.y), `finite (${feel}/${release}/${sens}/${seed}/${i})`);
    assert.ok(Math.hypot(s.x, s.y) <= STICK_R + 1e-6, `inside the stick circle: ${Math.hypot(s.x, s.y)} (${feel}/${release}/${sens}/${seed}/${i})`);
    steps++;
  }
  // after a lift, everything must come home by itself (a glide eases; nothing may stay stuck)
  if (down) s.up(t);
  for (let k = 0; k < 120; k++) { t += 16; s.tick(t); }
  assert.deepEqual([s.x, s.y], [0, 0], `comes home after the finger lifts (${feel}/${release}/${sens}/${seed})`);
  assert.equal(s.active, false, "and goes idle, so the frame ticker can stop");
}
console.log(`  invariants held over ${steps} random steps`);

// ── 2. a finger that is only RESTING (a shaky hand, sensor noise) must not drift the camera
function jitterPeak(feel, sens, amp, hz) {
  const r = rng(99), s = new TouchpadState(feel, "instant", sens);
  let t = 0; s.down(200, 120, t);
  let peak = 0;
  for (let i = 0; i < hz * 3; i++) { t += 1000 / hz; s.move(200 + (r() - 0.5) * 2 * amp, 120 + (r() - 0.5) * 2 * amp, t); s.tick(t); peak = Math.max(peak, Math.hypot(s.x, s.y)); }
  return peak;
}
const DEADZONE = 0.08 * STICK_R;   // 4.8: below this the game sees nothing
const jit = [];
for (const [feel, sens, amp] of [["speed", 1, 0.25], ["speed", 1, 0.5], ["speed", 3, 0.25], ["distance", 1, 0.25], ["distance", 3, 0.25]]) {
  const p = jitterPeak(feel, sens, amp, 120);
  jit.push(`${feel} sens ${sens} jitter +-${amp}: peak ${p.toFixed(2)}`);
  if (amp <= 0.25) assert.ok(p < DEADZONE, `resting-finger noise of +-${amp} must stay under the 8% dead zone (${feel}, sens ${sens}: peak ${p.toFixed(2)} vs ${DEADZONE})`);
}
console.log("  resting finger, stick peaks (dead zone = " + DEADZONE.toFixed(1) + "):\n    " + jit.join("\n    "));

// ── 3. sensitivity: what the customer asked for, as numbers
assert.equal(stickResponse(60, 0, 1, 1).x, 1, "at 100% a full push is a full push, exactly as before this setting existed");
assert.equal(stickResponse(60, 0, 0.5, 1).x, 0.5, "at 50% a full push gives HALF the camera speed");
assert.equal(stickResponse(60, 0, 0.2, 1).x, 0.2, "at the lowest, 20%");
assert.equal(stickResponse(60, 0, 2, 1).x, 1, "at 200% full is still only full, never more");
assert.equal(stickResponse(4.7, 0, 0.5, 1).x, 0, "the dead zone still ignores tiny movements at any sensitivity");
assert.equal(stickResponse(4.7, 0, 2, 1).x, 0);
assert.ok(Math.abs(stickResponse(32.4, 0, 1, 1).x - 0.5) < 1e-9, "at 100% a half-way push is 0.5");
assert.ok(Math.abs(stickResponse(32.4, 0, 0.5, 1).x - 0.25) < 1e-9, "at 50% the same push is 0.25: smoother, slower");
assert.ok(Math.abs(stickResponse(32.4, 0, 2, 1).x - 1) < 1e-9, "at 200% the same push already reaches full");
for (const g of [0.2, 0.5, 1, 2]) {   // direction is never bent by the setting (only the strength)
  const a = stickResponse(30, 30, g, 1);
  assert.ok(Math.abs(a.x - a.y) < 1e-12, `a diagonal stays a true diagonal at ${g * 100}%`);
}
for (let d = 0; d <= 60; d += 0.5) for (const [lo, hi] of [[0.2, 0.5], [0.5, 1], [1, 1.5], [1.5, 2]]) {   // more sensitivity never means less output
  assert.ok(stickResponse(d, 0, hi, 1).x >= stickResponse(d, 0, lo, 1).x - 1e-12, `more sensitivity never gives less (${d}, ${lo}->${hi})`);
}
for (const g of [0.2, 0.5, 1, 2]) {   // the response grows smoothly with the thumb: no sudden jumps once past the dead zone
  let prev = stickResponse(5, 0, g, 1).x;
  for (let d = 5; d <= 60; d += 0.1) { const v = stickResponse(d, 0, g, 1).x; assert.ok(v >= prev - 1e-12, `never falls as the thumb moves out (${g * 100}%, ${d})`); assert.ok(v - prev < 0.01, `no jump at ${g * 100}% (${d})`); prev = v; }
}
assert.equal(applyStickGain(0.37, 1), 0.37);
console.log("  sensitivity maths holds");

// ── 4. the file the phone's test reads is up to date with this code
const file = new URL("../android-client/app/src/test/resources/golden_parity.txt", import.meta.url);
assert.equal(fs.readFileSync(file, "utf8"), buildGolden(), "golden_parity.txt is out of date: run `node gen-golden.mjs`, then the Android tests tell you whether the phone's code still agrees");
console.log("touchpad-fuzz.test.mjs — all assertions passed");
