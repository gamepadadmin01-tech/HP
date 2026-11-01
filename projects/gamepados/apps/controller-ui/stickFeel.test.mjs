// Run: node stickFeel.test.mjs
// Right-stick sensitivity (owner, 2026-11-02). The same cases live in
// android-client/.../StickMathTest.kt: change both together.
import assert from "node:assert/strict";

// A tiny localStorage, set up BEFORE the module loads (it reads the saved value at import).
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
const { applyStickGain, clampRightGain, stickFeel, setRightGain, installStickFeelToggle, RIGHT_GAIN_MIN, RIGHT_GAIN_MAX } = await import("./src/app/stickFeel.ts");

// ── the rule
assert.equal(applyStickGain(0.5, 1), 0.5, "gain 1 returns the input untouched (the default changes nothing)");
assert.equal(applyStickGain(1, 1), 1);
assert.equal(applyStickGain(0, 1), 0);
assert.equal(applyStickGain(0.8, 0.5), 0.4, "half sensitivity: 80% push gives 40%");
assert.equal(applyStickGain(1, 0.5), 0.5, "half sensitivity: a full push gives half the camera speed");
assert.equal(applyStickGain(0.8, 2), 1, "double sensitivity: reaches full early, never above full");
assert.equal(applyStickGain(0.25, 2), 0.5);
assert.equal(applyStickGain(0, 2), 0, "a stick at rest stays at rest, whatever the gain");

// ── limits
assert.equal(RIGHT_GAIN_MIN, 0.2);
assert.equal(RIGHT_GAIN_MAX, 2);
assert.equal(clampRightGain(0.05), 0.2);
assert.equal(clampRightGain(5), 2);
assert.equal(clampRightGain(0.75), 0.75);
assert.equal(clampRightGain(NaN), 1, "garbage becomes the default");
assert.equal(clampRightGain(Infinity), 1, "not a real number: the default");

// ── the live setting
assert.equal(stickFeel.rightGain, 1, "a fresh install is at 100%: nothing changes for anyone who never opens the setting");
let changes = 0;
const off = installStickFeelToggle(() => { changes++; });
assert.equal(setRightGain(0.5), 0.5);
assert.equal(stickFeel.rightGain, 0.5, "the packet builder reads this field");
assert.equal(store.get("gp_right_gain"), "0.5", "it is remembered");
assert.equal(changes, 1, "the native engine is told (geometry is republished)");
assert.equal(setRightGain(9), 2, "the slider cannot go past the limits");
assert.equal(window.__setStickFeel(undefined, undefined, 0.01).rightGain, 0.2, "the runtime hatch clamps too");
assert.equal(store.get("gp_right_gain"), "0.2");
off();
assert.equal(setRightGain(1), 1);
assert.equal(changes, 3, "after the app screen is gone nobody is told, and nothing breaks");
console.log("stickFeel.test.mjs — all assertions passed");
