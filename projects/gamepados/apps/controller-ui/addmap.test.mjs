// Run: node addmap.test.mjs
// The editor's "+" projection: every addable button is there exactly once, inside the 1280x570 canvas,
// big enough to tap, and clear of every other one. Pure maths on the real module: no browser needed.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({
  stdin: { contents: `export { ADD_MAP } from "./src/app/addMap";`, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "ts", sourcefile: "entry.ts" },
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
});
const mod = { exports: {} };
new Function("module", "exports", out.outputFiles[0].text)(mod, mod.exports);
const { ADD_MAP } = mod.exports;

const W = 1280, H = 570, GAP = 8, MIN_TAP = 68;

// What the editor can add. If a button is added to the editor it must be added here too.
const EXPECTED = ["A", "ABXY", "B", "D-Pad", "Home", "Hybrid", "L Stick", "L-Mode", "L3", "LB", "LT", "Menu", "R Stick", "R-Mode", "R3", "RB", "RT", "Touchpad", "View", "X", "Y"];
assert.deepEqual(ADD_MAP.map((i) => i.tag).sort(), EXPECTED, "every addable button is projected exactly once");
assert.equal(new Set(ADD_MAP.map((i) => `${i.type}:${i.label}`)).size, ADD_MAP.length, "no two items add the same thing");

// A projected button's footprint: a list of circles / rectangles (ABXY is its four buttons, as drawn).
function shapes(i) {
  if (i.type === "abxy") { const s = i.gr * 0.71, r = i.gr * 0.4; return [[0, -s], [-s, 0], [s, 0], [0, s]].map(([dx, dy]) => ({ kind: "circle", x: i.x + dx, y: i.y + dy, r })); }
  if (i.gw != null) return [{ kind: "rect", x: i.x, y: i.y, w: i.gw, h: i.gh }];
  return [{ kind: "circle", x: i.x, y: i.y, r: i.gr }];
}
function gap1(a, b) {
  if (a.kind === "circle" && b.kind === "circle") return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  if (a.kind === "rect" && b.kind === "rect") {
    const dx = Math.abs(a.x - b.x) - (a.w + b.w) / 2, dy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
    return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  }
  const [c, r] = a.kind === "circle" ? [a, b] : [b, a];
  const dx = Math.max(Math.abs(c.x - r.x) - r.w / 2, 0), dy = Math.max(Math.abs(c.y - r.y) - r.h / 2, 0);
  return Math.abs(c.x - r.x) <= r.w / 2 && Math.abs(c.y - r.y) <= r.h / 2 ? -c.r : Math.hypot(dx, dy) - c.r;
}
const gap = (A, B) => Math.min(...A.flatMap((a) => B.map((b) => gap1(a, b))));
const box = (s) => (s.kind === "circle" ? { l: s.x - s.r, r: s.x + s.r, t: s.y - s.r, b: s.y + s.r } : { l: s.x - s.w / 2, r: s.x + s.w / 2, t: s.y - s.h / 2, b: s.y + s.h / 2 });

for (const i of ADD_MAP) {
  for (const s of shapes(i)) {
    const b = box(s);
    assert.ok(b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H, `${i.tag} stays inside the canvas`);
  }
  const ext = i.gw != null ? Math.min(i.gw, i.gh) : i.type === "abxy" ? i.gr * 0.8 : i.gr * 2;       // its smallest tap dimension
  assert.ok(ext >= MIN_TAP, `${i.tag} is big enough to tap (${ext.toFixed(0)} units)`);
  // nothing in the top strip where the app draws its Gyro / Calibrate pill (centre, above y = 56)
  if (Math.abs(i.x - W / 2) < 130) assert.ok(box(shapes(i)[0]).t >= 56, `${i.tag} stays clear of the Gyro / Calibrate pill`);
}
for (let a = 0; a < ADD_MAP.length; a++) for (let b = a + 1; b < ADD_MAP.length; b++) {
  const g = gap(shapes(ADD_MAP[a]), shapes(ADD_MAP[b]));
  assert.ok(g >= GAP, `${ADD_MAP[a].tag} and ${ADD_MAP[b].tag} keep a clear gap (got ${g.toFixed(1)})`);
}
// left hand left of centre, right hand right of it
const by = (t) => ADD_MAP.find((i) => i.tag === t);
for (const t of ["LT", "LB", "L Stick", "L3", "D-Pad"]) assert.ok(by(t).x < W / 2, `${t} is on the left`);
for (const t of ["RT", "RB", "R Stick", "R3", "ABXY", "X", "Y", "A", "B"]) assert.ok(by(t).x > W / 2, `${t} is on the right`);
assert.ok(by("View").x < by("Home").x && by("Home").x < by("Menu").x, "View, Home, Menu run left to right");

console.log(`addmap.test.mjs — all ${ADD_MAP.length} buttons are projected inside the canvas, tappable, and clear of each other`);
