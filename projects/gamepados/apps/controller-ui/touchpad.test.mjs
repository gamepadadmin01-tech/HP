// Run: node touchpad.test.mjs   (Node 24 runs the .ts file directly)
// The same cases live in android-client/.../TouchpadMathTest.kt — keep them in step.
import assert from "node:assert/strict";
import { TouchpadState, cleanTouchpadOptions, STICK_R } from "./src/app/touchpad.ts";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not within ${tol} of ${b}`);
const mag = (p) => Math.hypot(p.x, p.y);

// Options are cleaned: nonsense becomes the recommended defaults, sensitivity is clamped.
assert.deepEqual(cleanTouchpadOptions({}), { feel: "speed", release: "instant", sens: 1 });
assert.deepEqual(cleanTouchpadOptions({ feel: "x", release: "y", sens: "z" }), { feel: "speed", release: "instant", sens: 1 });
assert.equal(cleanTouchpadOptions({ sens: 99 }).sens, 3);
assert.equal(cleanTouchpadOptions({ sens: 0 }).sens, 0.3);
assert.equal(cleanTouchpadOptions({ sens: NaN }).sens, 1);
assert.equal(cleanTouchpadOptions({ feel: "distance", release: "glide" }).feel, "distance");

// Landing never moves the stick.
{
  const p = new TouchpadState();
  p.down(500, 300, 0);
  assert.equal(p.x, 0); assert.equal(p.y, 0);
  assert.ok(p.active, "a held finger keeps the pad active");
}

// SPEED feel: a fast swipe right pushes the stick right, a slow one pushes it a little.
{
  const fast = new TouchpadState("speed");
  fast.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) fast.move(i * 20, 0, i * 16);          // 20 units per 16 ms = 1250 u/s
  assert.ok(fast.x > 0.9 * STICK_R, `a fast swipe nearly fills the stick (${fast.x})`);
  near(fast.y, 0, 1e-6, "a straight swipe has no sideways push");

  const slow = new TouchpadState("speed");
  slow.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) slow.move(i * 3, 0, i * 16);           // 3 units per 16 ms = ~190 u/s
  assert.ok(slow.x > 0 && slow.x < 0.4 * STICK_R, `a slow swipe pushes only a little (${slow.x})`);

  const down = new TouchpadState("speed");
  down.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) down.move(0, i * 20, i * 16);
  assert.ok(down.y > 0.9 * STICK_R && Math.abs(down.x) < 1e-6, "finger down pushes the stick down (+y)");
  const left = new TouchpadState("speed");
  left.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) left.move(-i * 20, 0, i * 16);
  assert.ok(left.x < -0.9 * STICK_R, "finger left pushes the stick left (-x)");
}

// SPEED feel: when the finger stops, the stick falls back to centre by itself (no move events needed).
{
  const p = new TouchpadState("speed");
  p.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) p.move(i * 20, 0, i * 16);
  let t = 160, before = p.x;
  assert.equal(p.tick(t + 16), false, "just after a move the stick is left alone");
  for (let i = 0; i < 30; i++) { t += 16; p.tick(t); }                  // ~480 ms of a resting finger
  assert.ok(p.x < before * 0.05, `a resting finger lets the stick go home (${p.x})`);
  assert.ok(p.held, "the finger is still down");
}

// Sensitivity: higher reaches full sooner, lower needs more speed.
{
  const run = (s) => { const p = new TouchpadState("speed", "instant", s); p.down(0, 0, 0);
    for (let i = 1; i <= 10; i++) p.move(i * 8, 0, i * 16); return p.x; };       // ~500 u/s
  assert.ok(run(2) > run(1) && run(1) > run(0.5), "sensitivity scales the push");
  assert.ok(run(3) <= STICK_R + 1e-9, "never above full deflection");
}

// DISTANCE feel: pushed by how far from the first touch, held while down, clamped to full.
{
  const p = new TouchpadState("distance");
  p.down(100, 100, 0);
  p.move(145, 100, 16);                                                // 45 units = half of the 90 needed
  near(p.x, STICK_R * 0.5, 1e-6, "half the drag is half the push");
  p.move(100, 190, 32);
  near(p.y, STICK_R, 1e-6, "the full drag gives the full push");
  p.move(100, 400, 48);
  near(mag(p), STICK_R, 1e-6, "dragging further never goes past full");
  assert.equal(p.tick(1000), false, "distance holds while the finger rests");
  const sens2 = new TouchpadState("distance", "instant", 2);
  sens2.down(0, 0, 0); sens2.move(22.5, 0, 16);
  near(sens2.x, STICK_R * 0.5, 1e-6, "double sensitivity needs half the drag");
  const diag = new TouchpadState("distance");
  diag.down(0, 0, 0); diag.move(200, 200, 16);
  near(mag(diag), STICK_R, 1e-6, "a diagonal is clamped round, not square");
}

// RELEASE: instant snaps to centre, glide eases back, both end at exactly 0.
{
  const a = new TouchpadState("distance", "instant");
  a.down(0, 0, 0); a.move(90, 0, 16); a.up(32);
  assert.equal(a.x, 0); assert.equal(a.active, false, "instant release: nothing left to do");

  const g = new TouchpadState("distance", "glide");
  g.down(0, 0, 0); g.move(90, 0, 16); g.up(32);
  assert.ok(g.x === STICK_R && g.active, "glide: still pushed at the moment of lifting");
  g.tick(32 + 80);
  assert.ok(g.x > 0 && g.x < 0.5 * STICK_R, `glide: about one time-constant later it is well down (${g.x})`);
  let t = 112;
  for (let i = 0; i < 60 && g.active; i++) { t += 16; g.tick(t); }
  assert.equal(g.x, 0); assert.equal(g.active, false, "glide ends at exactly centre and stops ticking");

  const gs = new TouchpadState("speed", "glide");
  gs.down(0, 0, 0);
  for (let i = 1; i <= 10; i++) gs.move(i * 20, 0, i * 16);
  const top = gs.x; gs.up(170);
  assert.equal(gs.x, top, "speed + glide keeps the value for the glide");
  gs.tick(170 + 80);
  assert.ok(gs.x < top && gs.x > 0, "speed + glide eases down");
}

// Moves with no finger down are ignored; a second touch starts clean.
{
  const p = new TouchpadState("distance");
  assert.equal(p.move(10, 10, 0), false);
  p.down(0, 0, 0); p.move(90, 0, 16); p.up(32);
  p.down(300, 300, 100);
  assert.equal(p.x, 0, "a new touch starts at centre again");
  p.move(345, 300, 116);
  near(p.x, STICK_R * 0.5, 1e-6, "and measures from its own first touch");
}

console.log("touchpad.test.mjs — all assertions passed");
