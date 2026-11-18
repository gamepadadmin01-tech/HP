// Run: node player-name.test.mjs   (vite on 127.0.0.1:5187)
// "Connected players" (owner, 2026-11-13): while the controller is open the app tells the PC server who is playing,
// with the 48-byte NAME frame of pc-server-rs/src/player.rs ("GPN", version 1, length, UTF-8 name, zero padding,
// and since 2.1 the app language in the last 8 bytes),
// sent through the same raw bridge send as the playtime ticket. Checks: signed in -> the display name, signed out ->
// "Guest"; sent at once when the controller opens and repeated about every 5 s; nothing once it is closed; the
// frame is byte-exact.
import puppeteer from "puppeteer";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

let lastLang = "";
function parse(b64) {
  const f = Buffer.from(b64, "base64");
  if (f.length !== 48 || f.subarray(0, 3).toString("latin1") !== "GPN") return null;
  assert.equal(f[3], 1, "version 1");
  const n = f[4];
  assert.ok(n >= 1 && n <= 35, "length in range (the name stops before byte 40)");
  assert.ok(f.subarray(5 + n, 40).every((b) => b === 0), "zero padding after the name");
  // 2.1: the app language in the last 8 bytes: "L", length, ASCII code, zeros
  assert.equal(f[40], 0x4c, "language marker");
  const l = f[41]; assert.ok(l >= 2 && l <= 6, "language code length");
  assert.ok(f.subarray(42 + l).every((b) => b === 0), "zero padding after the language");
  lastLang = f.subarray(42, 42 + l).toString("latin1");
  return f.subarray(5, 5 + n).toString("utf8");
}

async function run(signedInName) {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 412, height: 915 });
  await page.setRequestInterception(true);
  // The server is unreachable: a network failure keeps a stored session (it is only dropped on a 401).
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187") || r.url().startsWith("data:") ? r.continue() : r.abort("failed")));
  await page.evaluateOnNewDocument((name) => {
    try { localStorage.clear(); } catch {}
    if (name) localStorage.setItem("gp_account", JSON.stringify({ token: "t".repeat(64), user: { id: "u1", email: "player@example.com", displayName: name } }));
    window.__sent = [];
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.16", getAppVersionCode: () => 70,
      getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: true, linkAlive: true, connectionType: "wireless" }), getUsbBroadcastAddress: () => "", stopEngine() {},
      setScreenOrientation() {}, setNativeInputGeometry() {}, setNativeInputActive() {}, setNativeGyroConfig() {},
      sendPlaytimeTicket(b64) { window.__sent.push([performance.now(), b64]); } };
  }, signedInName);
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(800);
  const names = async () => (await page.evaluate(() => window.__sent.slice())).map(([t, b]) => [t, parse(b)]).filter(([, n]) => n !== null);

  assert.equal((await names()).length, 0, "nothing is sent while the controller is closed");
  await page.evaluate(() => document.querySelector('button[aria-label="Play Standard Controller"]').click());
  await page.waitForSelector('[data-screen="pad"]'); await pause(1200);
  const first = await names();
  const want = signedInName || "Guest";
  assert.ok(first.length >= 1, "a NAME frame is sent as soon as the controller opens");
  assert.equal(first[0][1], want, `it carries ${want}`);
  assert.equal(lastLang, "en", "and the app language (English on this English browser)");
  await pause(5600);
  const later = await names();
  assert.ok(later.length >= 2, `it is repeated about every 5 s (${later.length} sent)`);
  const gap = later[1][0] - later[0][0];
  assert.ok(gap > 4000 && gap < 7000, `about 5 s apart (${Math.round(gap)} ms)`);
  await page.evaluate(() => window.handleAndroidBack()); await page.waitForSelector('[data-testid="home-heading"]');
  await pause(800);
  const atClose = (await names()).length;
  await pause(5600);
  assert.equal((await names()).length, atClose, "nothing more once the controller is closed");
  assert.deepEqual(errors, []);
  await page.close();
  return `${want}: sent at open, repeated every ${Math.round(gap)} ms, stops on close`;
}

try {
  console.log(await run("Akhil"));
  console.log(await run(null));
  console.log(await run("Thiago Dí Pietrantonio"));
  console.log("PASS player name: signed-in name / Guest, byte-exact NAME frame, sent while the controller is open, every ~5 s");
} finally { await browser.close(); }
