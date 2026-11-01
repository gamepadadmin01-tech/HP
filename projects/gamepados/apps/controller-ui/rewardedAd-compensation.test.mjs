// Run: node rewardedAd-compensation.test.mjs
// The app side of "no ad for you right now -> 20 free minutes" (owner, 2026-11-01): the REAL
// src/app/store/rewardedAd.ts, with the server, the phone and the account stubbed out. Checks who gets
// the time (a guest on the phone, a signed-in player from the server's bank), what is said when the
// daily limit is used up, and that a player's own connection problem earns nothing.
import assert from "node:assert/strict";
import { build } from "esbuild";

const stubs = {
  "./account": `export const getSession = () => globalThis.__session;`,
  "./billing": `
    export const getBillingState = () => ({ entitlement: null });
    export const refresh = async () => { globalThis.__calls.refresh++; };`,
  "../api/billing": `
    export const claimUnityAd = async () => ({ credited: true });
    export const reportAdOutcome = async (body, token) => {
      globalThis.__calls.reports.push({ ...body, token });
      if (globalThis.__serverDown) throw new Error("offline");
      return globalThis.__answer(body);
    };`,
  "./guestTrial": `export const guestTrial = () => { globalThis.__calls.guestTrial++; return { bankSeconds: 0, remainingSeconds: 0 }; };`,
  "../platform/native": `
    export const adsSupported = () => true;
    export const showRewardedAd = () => true;
    export const getAppInfo = () => ({ channel: "direct", build: 68, version: "1.4.14" });
    export const nativeCreditGuestFreeTime = (s, below) => { globalThis.__calls.credits.push([s, below]); return { credited: globalThis.__phoneTakes }; };`,
  "./appConfig": `
    export const getAppConfig = () => ({ guest: { adCapSeconds: 1800 } });
    export const minutesText = (s) => Math.round(s / 60) + " minutes";
    export const ruleWords = () => ({ reward: "30 minutes", rewardShort: "30 min", cap: "30 minutes", welcome: "30 minutes" });`,
  "../feedback": `export const getInstallId = () => "0123456789abcdef";`,
};

const out = await build({
  entryPoints: ["src/app/store/rewardedAd.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
    },
  }],
});

globalThis.window = globalThis;
globalThis.__calls = { refresh: 0, guestTrial: 0, credits: [], reports: [] };
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const reset = () => { globalThis.__calls = { refresh: 0, guestTrial: 0, credits: [], reports: [] }; globalThis.__serverDown = false; globalThis.__phoneTakes = true; };
const result = (extra) => JSON.stringify({ status: "failed", network: "unity", message: "No ad is available right now.", ...extra });
async function tap(json) {
  let creditedCalls = 0;
  const off = mod.onAdCredited(() => { creditedCalls++; });
  globalThis.onRewardedAdResult(json);
  for (let i = 0; i < 200; i++) {
    const s = mod.getAdState();
    if (s.phase === "done" || s.phase === "error") { off(); return { ...s, creditedCalls }; }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("the button never settled");
}

// ── A guest: no fill -> the server says yes -> the phone adds 20 minutes ────────────────
reset(); globalThis.__session = null;
globalThis.__answer = () => ({ success: true, compensated: true, seconds: 1200 });
let s = await tap(result({ kind: "nofill", code: "NO_FILL" }));
assert.equal(s.phase, "done", "the player is compensated, not shown an error");
assert.match(s.message, /20 minutes of free time/, "and told how much");
assert.deepEqual(globalThis.__calls.credits, [[1200, 1800]], "the phone adds 20 minutes, under the usual 30-minute rule");
assert.equal(s.creditedCalls, 1, "the out-of-time screen is told, so play restarts");
assert.deepEqual(
  [globalThis.__calls.reports[0].result, globalThis.__calls.reports[0].network, globalThis.__calls.reports[0].code, globalThis.__calls.reports[0].token],
  ["nofill", "unity", "NO_FILL", undefined], "the outcome is reported, with no token for a guest");
assert.equal(globalThis.__calls.reports[0].installId, "0123456789abcdef");

// ── An ad-network error is compensated the same way ────────────────────────────────────
reset(); globalThis.__session = null;
s = await tap(result({ kind: "error", code: "INTERNAL_ERROR" }));
assert.equal(s.phase, "done");
assert.equal(globalThis.__calls.reports[0].result, "error");

// ── A signed-in player: the server banks it, the app only re-reads the bank ─────────────
reset(); globalThis.__session = { token: "tok", user: { id: "u1" } };
s = await tap(result({ kind: "nofill", code: "NO_FILL" }));
assert.equal(s.phase, "done");
assert.equal(globalThis.__calls.credits.length, 0, "no phone-side credit for an account");
assert.equal(globalThis.__calls.refresh, 1, "the bank is re-read");
assert.equal(globalThis.__calls.reports[0].token, "tok", "the account's token rides along");

// ── Today's three are used up: say so, give nothing ────────────────────────────────────
reset(); globalThis.__session = null;
globalThis.__answer = () => ({ success: true, compensated: false, reason: "limit" });
s = await tap(result({ kind: "nofill", code: "NO_FILL" }));
assert.equal(s.phase, "error");
assert.match(s.message, /already used/, "the player is told why nothing was added");
assert.equal(globalThis.__calls.credits.length, 0);

// ── The phone refuses (already holds 30+ minutes): not announced as a gift ───────────────
reset(); globalThis.__session = null; globalThis.__phoneTakes = false;
globalThis.__answer = () => ({ success: true, compensated: true, seconds: 1200 });
s = await tap(result({ kind: "nofill", code: "NO_FILL" }));
assert.equal(s.phase, "error", "no 'free time' message when the phone did not add any");

// ── The player's OWN connection: counted, never compensated ─────────────────────────────
reset(); globalThis.__session = null;
globalThis.__answer = () => ({ success: true, compensated: false });
s = await tap(result({ kind: "network", code: "TIMEOUT" }));
assert.equal(s.phase, "error");
assert.equal(s.message, "No ad is available right now.", "their own message is shown");
assert.equal(globalThis.__calls.credits.length, 0);
assert.equal(globalThis.__calls.reports[0].result, "network", "still reported, for the portal's counts");

// ── The server cannot be reached: the ordinary error, nothing breaks ────────────────────
reset(); globalThis.__session = null; globalThis.__serverDown = true;
s = await tap(result({ kind: "nofill", code: "NO_FILL" }));
assert.equal(s.phase, "error");
assert.equal(s.message, "No ad is available right now.");
assert.equal(globalThis.__calls.credits.length, 0);

// ── A normal watched ad is counted as one ──────────────────────────────────────────────
reset(); globalThis.__session = null; globalThis.__answer = () => ({ success: true, compensated: false });
s = await tap(JSON.stringify({ status: "rewarded", guest: true, network: "admob" }));
assert.equal(s.phase, "done");
assert.equal(globalThis.__calls.reports[0].result, "rewarded");
assert.equal(globalThis.__calls.reports[0].network, "admob");

// ── An older app (no network field) reports nothing and behaves as before ──────────────
reset(); globalThis.__session = null;
s = await tap(JSON.stringify({ status: "failed", message: "No ad is available right now." }));
assert.equal(s.phase, "error");
assert.equal(globalThis.__calls.reports.length, 0);

console.log("rewardedAd-compensation.test.mjs — all assertions passed");
process.exit(0);
