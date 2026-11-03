// Run: node additems.test.mjs
// The editor's "+" popup list: every addable button is there exactly once, its tile is the right shape,
// and the button is drawn big inside it (so players can SEE what they are adding). Pure maths: no browser.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({
  stdin: { contents: `export { ADD_ITEMS, ADD_CELL } from "./src/app/addItems";`, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "ts", sourcefile: "entry.ts" },
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
});
const mod = { exports: {} };
new Function("module", "exports", out.outputFiles[0].text)(mod, mod.exports);
const { ADD_ITEMS, ADD_CELL } = mod.exports;

// What the editor can add. If a button is added to the editor it must be added here too.
const EXPECTED = ["A", "ABXY", "B", "D-Pad", "Home", "Hybrid", "L Stick", "L-Mode", "L3", "LB", "LT", "Menu", "R Stick", "R-Mode", "R3", "RB", "RT", "Touchpad", "View", "X", "Y"];
assert.deepEqual(ADD_ITEMS.map((i) => i.tag).sort(), EXPECTED, "every addable button is in the list exactly once");
assert.equal(new Set(ADD_ITEMS.map((i) => `${i.type}:${i.label}`)).size, ADD_ITEMS.length, "no two tiles add the same thing");

const CELL_PX = ADD_CELL;     // one grid cell on screen, in CSS px: the same number the editor lays its grid out with
const MIN_TAP_PX = 44;        // the smallest comfortable touch target

for (const i of ADD_ITEMS) {
  // the tile is cols x rows square cells, and its drawing space has the same shape
  assert.ok(Math.abs(i.vw / i.vh - i.cols / i.rows) < 1e-9, `${i.tag}: drawing space ${i.vw}x${i.vh} matches a ${i.cols}x${i.rows} tile`);
  // the drawn button lies fully inside its drawing space
  const w = i.pw ?? (i.type === "abxy" ? i.pr * 2 * 1.11 : i.pr * 2);
  const h = i.ph ?? (i.type === "abxy" ? i.pr * 2 * 1.11 : i.pr * 2);
  assert.ok(w <= i.vw && h <= i.vh, `${i.tag}: the drawing fits its tile (${w.toFixed(0)}x${h.toFixed(0)} in ${i.vw}x${i.vh})`);
  // ... and fills most of it, so it is easy to see (not a speck in a big box)
  assert.ok(Math.max(w / i.vw, h / i.vh) >= 0.7, `${i.tag}: the button is drawn big (fills ${(100 * Math.max(w / i.vw, h / i.vh)).toFixed(0)}% of its tile)`);
  // on screen, the smallest side of the tile is a comfortable tap
  const px = Math.min(i.cols, i.rows) * CELL_PX;
  assert.ok(px >= MIN_TAP_PX, `${i.tag}: tile is at least ${MIN_TAP_PX}px (${px}px)`);
  // the drawn button itself, on screen
  const drawnPx = (Math.min(w, h) / Math.min(i.vw, i.vh)) * (Math.min(i.cols, i.rows) * CELL_PX);
  assert.ok(drawnPx >= 56 || i.type === "trigger", `${i.tag}: the drawn button is ${drawnPx.toFixed(0)}px, big enough to read`);
}
// the double-size tiles are the ones that deserve it
for (const t of ["D-Pad", "ABXY", "L Stick", "R Stick", "Hybrid"]) assert.equal(ADD_ITEMS.find((i) => i.tag === t).cols, 2, `${t} has a double-size tile`);
for (const t of ["LT", "RT"]) assert.equal(ADD_ITEMS.find((i) => i.tag === t).rows, 2, `${t} has a tall tile`);

console.log(`additems.test.mjs — all ${ADD_ITEMS.length} buttons are listed once, in tiles shaped to fit them, drawn big`);
