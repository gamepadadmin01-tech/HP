// Run: node purchase-play.test.mjs
// The page side of buying Lifetime through Google Play: the REAL src/app/store/purchase.ts with the
// phone's billing bridge and the server stubbed. Checks that the page only forwards a token to the
// server (it never grants anything), what the player is told for each outcome, that an older Play
// build sells nothing, and that a purchase nobody is waiting for still reaches the server.
import assert from "node:assert/strict";
import { build } from "esbuild";

const stubs = {
  "../api/billing": `
    export const verifyGoogle = async (token, purchaseToken) => {
      globalThis.__t.verified.push([token, purchaseToken]);
      if (globalThis.__verifyThrows) throw new (globalThis.ApiError)("Google could not confirm it.", "provider_error");
      return globalThis.__verifyAnswer;
    };
    export const reportPlayAttempt = async (token, attempt) => {
      globalThis.__t.reported.push([token, attempt]);
      if (globalThis.__reportThrows) throw new Error("server down");
      return { success: true };
    };
    export const createRazorpayOrder = async () => { throw new Error("razorpay must not be used on Play"); };
    export const verifyRazorpay = async () => { throw new Error("razorpay must not be used on Play"); };`,
  "../api/account": `export const ApiError = globalThis.ApiError;`,
  "./account": `export const getSession = () => globalThis.__session;`,
  "./billing": `export const refresh = async () => { globalThis.__t.refreshed++; };`,
  "./playtime": `export const clearBlock = () => { globalThis.__t.cleared++; };`,
  "../platform/native": `
    export const getAppInfo = () => ({ channel: globalThis.__channel, build: 68, version: "1.4.13" });
    export const startRazorpayCheckout = () => false;
    export const canBuyWithPlay = () => globalThis.__canPlay;
    export const startPlayPurchase = (productId, userId) => { globalThis.__t.started.push([productId, userId]); return globalThis.__sheetOpens; };
    export const restorePlayPurchases = () => { globalThis.__t.restored++; };
    export const acknowledgePlayPurchase = (t) => { globalThis.__t.acked.push(t); };`,
};

const out = await build({
  entryPoints: ["src/app/store/purchase.ts"], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  define: { __PLAY__: "true" },   // this file tests the Google Play bundle
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
    },
  }],
});

class ApiError extends Error { constructor(m, code) { super(m); this.code = code; } }
globalThis.ApiError = ApiError;
globalThis.window = globalThis;
const reset = () => {
  globalThis.__t = { verified: [], refreshed: 0, cleared: 0, started: [], restored: 0, acked: [], reported: [] };
  globalThis.__reportThrows = false;
  globalThis.__session = { token: "tok", user: { id: "u1", email: "a@x.invalid", displayName: "A" } };
  globalThis.__channel = "playstore"; globalThis.__canPlay = true; globalThis.__sheetOpens = true;
  globalThis.__verifyThrows = false;
  globalThis.__verifyAnswer = { success: true, plan: "LIFETIME", acknowledged: true };
};
reset();
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const LIFETIME = { code: "LIFETIME", currency: "INR", displayName: "Lifetime", purchasable: true, playProductId: "gpos_lifetime", priceFromStore: true };
const answer = (json) => { setTimeout(() => globalThis.onPurchaseResult(JSON.stringify(json)), 5); };

// ── A normal purchase ──────────────────────────────────────────────────────────────────
reset();
answer({ status: "ok", provider: "play", purchaseToken: "PT-1", productId: "gpos_lifetime" });
let r = await mod.purchase(LIFETIME);
assert.deepEqual(globalThis.__t.started, [["gpos_lifetime", "u1"]], "the sheet opens for Play's product id, with the raw user id (hashed on the phone)");
assert.deepEqual(globalThis.__t.verified, [["tok", "PT-1"]], "the page only forwards the token to the server");
assert.equal(r.ok, true);
assert.equal(r.plan, "LIFETIME", "the plan shown comes from the server's answer");
assert.equal(globalThis.__t.refreshed, 1, "the plan is re-read afterwards");
assert.equal(globalThis.__t.cleared, 1, "a lockout is cleared");
assert.equal(globalThis.__t.acked.length, 0, "no phone-side acknowledge when the server did it");

// ── Server could not acknowledge: the phone does it as a safety net ──────────────────────
reset(); globalThis.__verifyAnswer = { success: true, plan: "LIFETIME", acknowledged: false };
answer({ status: "ok", provider: "play", purchaseToken: "PT-2" });
r = await mod.purchase(LIFETIME);
assert.equal(r.ok, true);
assert.deepEqual(globalThis.__t.acked, ["PT-2"]);

// ── Backing out, errors ─────────────────────────────────────────────────────────────────
reset(); answer({ status: "cancelled" });
r = await mod.purchase(LIFETIME);
assert.deepEqual([r.ok, r.cancelled], [false, true], "backing out is not an error");
assert.equal(globalThis.__t.verified.length, 0, "nothing is sent to the server");

reset(); answer({ status: "error", message: "Google Play billing is unavailable on this device." });
r = await mod.purchase(LIFETIME);
assert.deepEqual([r.ok, r.message], [false, "Google Play billing is unavailable on this device."]);

// ── Pending payment: nothing granted, the player is told ─────────────────────────────────
reset(); globalThis.__verifyAnswer = { success: true, pending: true, message: "Your payment is still being processed. It will appear once it completes." };
answer({ status: "ok", provider: "play", purchaseToken: "PT-3" });
r = await mod.purchase(LIFETIME);
assert.equal(r.ok, false);
assert.match(r.message, /still being processed/);
assert.equal(globalThis.__t.refreshed, 0, "no 'you are Premium' refresh for a pending payment");

// ── Server refuses ──────────────────────────────────────────────────────────────────────
reset(); globalThis.__verifyThrows = true;
answer({ status: "ok", provider: "play", purchaseToken: "PT-4" });
r = await mod.purchase(LIFETIME);
assert.equal(r.ok, false);
assert.match(r.message, /Google could not confirm it\..*If you were charged/s, "the player is told it will show up if they were charged");

// ── Older Play build / sheet cannot open / no product id / signed out ───────────────────
reset(); globalThis.__canPlay = false;
r = await mod.purchase(LIFETIME);
assert.deepEqual([r.ok, r.message], [false, "Nothing is sold in this version of the app."], "an older Play build sells nothing");
assert.equal(globalThis.__t.started.length, 0);

reset(); globalThis.__sheetOpens = false;
r = await mod.purchase(LIFETIME);
assert.equal(r.ok, false);
assert.match(r.message, /Update from Google Play/);

reset(); r = await mod.purchase({ ...LIFETIME, playProductId: undefined });
assert.match(r.message, /not available on Google Play/);

reset(); globalThis.__session = null;
r = await mod.purchase(LIFETIME);
assert.match(r.message, /Sign in/);

reset(); r = await mod.purchase({ ...LIFETIME, purchasable: false });
assert.equal(r.ok, false, "a plan the server did not mark purchasable is refused");

// ── A purchase nobody is waiting for still reaches the server ───────────────────────────
reset();
globalThis.onPurchaseResult(JSON.stringify({ status: "ok", provider: "play", purchaseToken: "PT-5" }));
await new Promise((x) => setTimeout(x, 20));
assert.deepEqual(globalThis.__t.verified, [["tok", "PT-5"]], "a restored purchase is forwarded to the server");

// ── Restore on opening the plan screen ──────────────────────────────────────────────────
reset(); mod.syncPlayPurchases();
assert.equal(globalThis.__t.restored, 1, "asks Play for purchases made while the app was closed");
reset(); globalThis.__canPlay = false; mod.syncPlayPurchases();
assert.equal(globalThis.__t.restored, 0, "not in a build without Play Billing");
reset(); globalThis.__session = null; mod.syncPlayPurchases();
assert.equal(globalThis.__t.restored, 0, "not when signed out");
reset(); globalThis.__channel = "direct"; mod.syncPlayPurchases();
assert.equal(globalThis.__t.restored, 0, "not in the website build");

// ── FRESH APP START: opening the plan screen must hand an already-owned purchase to the server ──
// The page used to install its "purchase finished" listener only when a purchase STARTED. After a restart the listener did
// not exist, so the restore's answer (a purchase the phone already owned) was silently dropped and never reached the server.
reset(); delete globalThis.onPurchaseResult;
mod.syncPlayPurchases();
assert.equal(typeof globalThis.onPurchaseResult, "function", "opening the plan screen installs the listener itself");
globalThis.onPurchaseResult(JSON.stringify({ status: "ok", provider: "play", purchaseToken: "PT-6" }));
await new Promise((x) => setTimeout(x, 20));
assert.deepEqual(globalThis.__t.verified, [["tok", "PT-6"]], "a purchase restored on a fresh start reaches the server");

// ── "You already own this": the page asks Play to hand the purchase back, instead of leaving the player stuck ──
reset(); answer({ status: "error", message: "You already own this. Open your plan to bring it back." });
r = await mod.purchase(LIFETIME);
assert.equal(globalThis.__t.restored, 1, "buying something already owned asks Play to hand it back");
assert.equal(r.ok, false);
assert.match(r.message, /already own/i, "and the player is told why the sheet did not open");
reset(); answer({ status: "error", message: "Google Play billing is unavailable on this device." });
r = await mod.purchase(LIFETIME);
assert.equal(globalThis.__t.restored, 0, "any other error does not trigger a restore");
// ── Why a purchase did not finish: reported to the server (2026-11-14) ──────────────────────
// Thiago's case: his cards were refused inside Google's sheet and he closed it after 9 s, from Play country AR.
reset(); answer({ status: "cancelled", diag: { stage: "sheet", code: "USER_CANCELED", country: "AR", ms: 9000, productId: "gpos_lifetime" } });
r = await mod.purchase(LIFETIME);
assert.deepEqual([r.ok, r.cancelled], [false, true]);
await new Promise((x) => setTimeout(x, 10));
assert.equal(globalThis.__t.reported.length, 1, "a closed Play sheet is reported");
assert.deepEqual(globalThis.__t.reported[0], ["tok", { outcome: "cancelled", stage: "sheet", code: "USER_CANCELED", subCode: undefined, debug: undefined,
  message: undefined, country: "AR", ms: 9000, productId: "gpos_lifetime", appVersion: "1.4.13" }], "with what Google told the app");

reset(); answer({ status: "error", message: "Payment declined", diag: { stage: "sheet", code: "ERROR", subCode: "PAYMENT_DECLINED_DUE_TO_INSUFFICIENT_FUNDS", debug: "x".repeat(400), country: "IN", ms: 4200.6 } });
r = await mod.purchase(LIFETIME);
await new Promise((x) => setTimeout(x, 10));
const rep1 = globalThis.__t.reported[0][1];
assert.equal(rep1.subCode, "PAYMENT_DECLINED_DUE_TO_INSUFFICIENT_FUNDS", "Google's sub-reason is passed on");
assert.equal(rep1.debug.length, 300, "long texts are cut to what the server accepts");
assert.equal(rep1.ms, 4201, "time rounded to whole milliseconds");
assert.equal(rep1.productId, "gpos_lifetime", "the product comes from the plan when the phone did not say");

reset(); answer({ status: "error", message: "The payment screen didn't come back." });
r = await mod.purchase(LIFETIME);
await new Promise((x) => setTimeout(x, 10));
assert.equal(globalThis.__t.reported[0][1].stage, "timeout", "a sheet that never answered is reported as a timeout");

reset(); globalThis.__reportThrows = true; answer({ status: "cancelled", diag: { stage: "sheet", code: "USER_CANCELED" } });
r = await mod.purchase(LIFETIME);
await new Promise((x) => setTimeout(x, 10));
assert.deepEqual([r.ok, r.cancelled], [false, true], "a report that fails changes nothing for the buyer");

reset(); answer({ status: "ok", provider: "play", purchaseToken: "PT-7" });
r = await mod.purchase(LIFETIME);
await new Promise((x) => setTimeout(x, 10));
assert.equal(globalThis.__t.reported.length, 0, "a successful purchase is not reported");
console.log("purchase-play.test.mjs — all assertions passed");
process.exit(0);
