// Run: node xbox2-layout.test.mjs
// Standard Layout 2 (the Xbox controller's own arrangement), in both variants, plus the rule that lets a
// touchpad push the LEFT stick. Pure maths on the real modules: no browser needed.
//   1. every control sits inside the 1280x570 canvas and no two controls touch (8-unit clear gap);
//   2. the controls are where an Xbox pad has them (checked as relationships, not copied numbers);
//   3. mergePadSticks sends each pad to the stick it belongs to, and keeps each stick inside its circle.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({
  stdin: {
    contents: `export { getXboxLayout2 } from "./src/app/xboxLayout"; export { mergePadSticks, padPushesLeft, STICK_R } from "./src/app/touchpad";`,
    resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "ts", sourcefile: "entry.ts",
  },
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
});
const mod = { exports: {} };
new Function("module", "exports", out.outputFiles[0].text)(mod, mod.exports);
const { getXboxLayout2, mergePadSticks, padPushesLeft, STICK_R } = mod.exports;

const W = 1280, H = 570, GAP = 8;

// A control's footprint: a list of circles / rectangles. The ABXY cluster is four separate buttons
// (spread 0.71 r from the centre, each 0.4 r), exactly as the pad draws them.
function shapesOf(b) {
  if (b.type === "abxy") {
    const s = b.r * 0.71, r = b.r * 0.4;
    return [[0, -s], [-s, 0], [s, 0], [0, s]].map(([dx, dy]) => ({ kind: "circle", x: b.x + dx, y: b.y + dy, r }));
  }
  if (b.type === "touchpad") return [{ kind: "circle", x: b.x, y: b.y, r: Math.min(b.w, b.h) / 2 }];
  if (b.w != null && b.h != null) return [{ kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h }];
  return [{ kind: "circle", x: b.x, y: b.y, r: b.r }];
}
const gap = (A, B) => Math.min(...A.flatMap((a) => B.map((b) => gap1(a, b))));   // clear distance between two controls
function gap1(a, b) {                     // clear distance between two shapes (negative = overlap)
  if (a.kind === "circle" && b.kind === "circle") return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  if (a.kind === "rect" && b.kind === "rect") {
    const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2, dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
    return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  }
  const [c, r] = a.kind === "circle" ? [a, b] : [b, a];
  const dx = Math.max(Math.abs(c.x - r.x) - r.w / 2, 0), dy = Math.max(Math.abs(c.y - r.y) - r.h / 2, 0);
  const inside = Math.abs(c.x - r.x) <= r.w / 2 && Math.abs(c.y - r.y) <= r.h / 2;
  return inside ? -c.r : Math.hypot(dx, dy) - c.r;
}
function bounds(s) {
  return s.kind === "circle" ? { l: s.x - s.r, r: s.x + s.r, t: s.y - s.r, b: s.y + s.r }
    : { l: s.x - s.w / 2, r: s.x + s.w / 2, t: s.y - s.h / 2, b: s.y + s.h / 2 };
}

for (const touchpads of [false, true]) {
  const name = touchpads ? "Standard Layout 2 Touchpads" : "Standard Layout 2";
  const pad = getXboxLayout2(touchpads);
  const by = (label) => { const b = pad.filter((p) => p.label === label); assert.equal(b.length, 1, `${name}: exactly one ${label}`); return b[0]; };

  // ── 1. nothing falls off the canvas, nothing touches
  assert.equal(new Set(pad.map((p) => p.uid)).size, pad.length, `${name}: every control has its own id`);
  for (const p of pad) {
    for (const s of shapesOf(p)) {
      const bb = bounds(s);
      assert.ok(bb.l >= 0 && bb.r <= W && bb.t >= 0 && bb.b <= H, `${name}: ${p.label} stays inside the canvas (${JSON.stringify(bb)})`);
    }
  }
  for (let i = 0; i < pad.length; i++) for (let j = i + 1; j < pad.length; j++) {
    const g = gap(shapesOf(pad[i]), shapesOf(pad[j]));
    assert.ok(g >= GAP, `${name}: ${pad[i].label} and ${pad[j].label} keep a clear gap (got ${g.toFixed(1)})`);
  }

  // ── 2. it is an Xbox pad
  assert.equal(pad.length, 11, `${name}: 11 controls (4 top, 3 centre, 4 clusters)`);
  const ls = touchpads ? by("LEFT STICK") : by("LS"), rs = touchpads ? by("RIGHT STICK") : by("RS");
  const dpad = by("DPAD"), abxy = by("ABXY"), home = by("home"), view = by("view"), menu = by("menu");
  const lb = by("LB"), rb = by("RB"), lt = by("LT"), rt = by("RT");
  assert.ok(ls.x < dpad.x && ls.y < dpad.y, `${name}: the left stick is above and to the left of the D-pad`);
  assert.ok(abxy.x > rs.x && abxy.y < rs.y, `${name}: the ABXY buttons are above and to the right of the right stick`);
  assert.ok(dpad.x < rs.x && Math.abs(dpad.y - rs.y) < 1, `${name}: D-pad and right stick share a row, D-pad on the left`);
  assert.ok(Math.abs(ls.y - abxy.y) < 30,`${name}: left stick and ABXY share the upper row`);
  assert.ok(ls.y < dpad.y - 100, `${name}: the lower row is clearly lower (the Xbox's offset sticks)`);
  assert.ok(view.x < home.x && home.x < menu.x && home.y < view.y && view.y === menu.y, `${name}: Home on top, View left and Menu right of it, lower`);
  assert.ok(home.x === W / 2 && view.x + menu.x === W, `${name}: the centre controls sit on the middle line`);
  assert.ok(lb.x < W / 2 && rb.x > W / 2 && lt.x < lb.x && rt.x > rb.x, `${name}: bumpers over each side, triggers on the outer corners`);
  assert.ok(lb.y < ls.y && rb.y < abxy.y && lt.y < ls.y && rt.y < abxy.y, `${name}: bumpers and triggers run along the top`);
  assert.ok(dpad.x + rs.x === W && ls.x + abxy.x === W, `${name}: the clusters mirror each other about the middle`);

  if (touchpads) {
    assert.equal(ls.type, "touchpad"); assert.equal(rs.type, "touchpad");
    assert.equal(ls.tpStick, "L", "the left pad pushes the left stick"); assert.equal(rs.tpStick, "R", "the right pad pushes the right stick");
    assert.equal(ls.tpFeel, "distance", "movement uses the floating-stick feel"); assert.equal(rs.tpFeel, "speed", "the camera uses the mouse-look feel");
    assert.ok(padPushesLeft(ls) && !padPushesLeft(rs));
  } else {
    assert.equal(ls.type, "thumbstick"); assert.equal(rs.type, "thumbstick");
  }
}

// ── 3. which stick a pad pushes, and the circle each stick is held in
const none = { x: 0, y: 0 };
const pads = new Map([["pL", { x: 50, y: 0 }], ["pR", { x: 0, y: -30 }]]);
const left = new Set(["pL"]);
let m = mergePadSticks(pads, left, none, none);
assert.deepEqual(m, { l: { x: 50, y: 0 }, r: { x: 0, y: -30 } }, "each pad lands on its own stick");
m = mergePadSticks(new Map([["pR", { x: 0, y: -30 }]]), left, { x: 20, y: 0 }, none);
assert.deepEqual(m, { l: { x: 20, y: 0 }, r: { x: 0, y: -30 } }, "a right pad leaves the left stick alone");
m = mergePadSticks(new Map([["pL", { x: 50, y: 0 }]]), left, { x: 40, y: 0 }, none);
assert.ok(Math.abs(Math.hypot(m.l.x, m.l.y) - STICK_R) < 1e-9 && m.l.x > 0 && m.r.x === 0, "pad + real stick are held inside the left stick's circle");
m = mergePadSticks(new Map([["pR", { x: 60, y: 60 }]]), left, none, none);
assert.ok(Math.abs(Math.hypot(m.r.x, m.r.y) - STICK_R) < 1e-9, "the right stick is held inside its circle too");
m = mergePadSticks(new Map(), left, { x: 70, y: 0 }, { x: 10, y: 10 });
assert.deepEqual(m, { l: { x: 70, y: 0 }, r: { x: 10, y: 10 } }, "with no pads active the real sticks pass through untouched");
assert.equal(padPushesLeft({}), false, "a pad saved before the option existed keeps pushing the right stick");
assert.equal(padPushesLeft({ tpStick: "R" }), false);
assert.equal(padPushesLeft({ tpStick: "L" }), true);

console.log("xbox2-layout.test.mjs — both layouts are inside the canvas, clear of each other, and laid out like an Xbox pad; the stick merge rules hold");
