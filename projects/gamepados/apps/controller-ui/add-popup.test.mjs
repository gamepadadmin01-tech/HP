// Run (with `npx vite --port 5187 --host 127.0.0.1 --strictPort` running): node add-popup.test.mjs
// The editor's "+" popup, in the REAL editor in headless Chrome, with real mouse events:
//   • it opens, the + turns into an x (and says so to a screen reader), tiles are big enough to tap;
//   • it closes three ways: tap +, tap outside, the phone's Back button (and Back leaves the editor open);
//   • tapping a tile adds exactly one button, and a quick second tap while it is fading out adds nothing;
//   • it grows out of the + without bouncing, closes quicker than it opened, and with reduced motion it only fades.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];

async function editor(reduced = false) {
  const page = await (await browser.createBrowserContext()).newPage();   // its own storage: no layout left over from another session
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187/") || r.url().startsWith("data:") ? r.continue() : r.abort()));
  await page.evaluateOnNewDocument(() => {
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }), getUsbBroadcastAddress: () => "", stopEngine() {}, startCameraScan() {}, stopCameraScan() {} };
  });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setViewport({ width: 412, height: 915 });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(600);
  await page.click('[data-testid="create-layout-button"]');
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((e) => e.textContent.includes("Create custom pad")), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Create custom pad")).click());
  await page.waitForSelector('[data-testid="editor-back-button"]');
  await page.setViewport({ width: 900, height: 405 }); await pause(800);
  return page;
}
const popup = (p) => p.$('[aria-label="Add a button"]');
const count = (p) => p.evaluate(() => document.querySelectorAll('svg g[style*="cursor: grab"]').length);
const plusDeg = (p) => p.evaluate(() => { const m = getComputedStyle(document.querySelector('[data-testid="add-widget-button"] span')).transform; if (m === "none") return 0; const [a, b] = m.match(/matrix\(([^)]+)\)/)[1].split(",").map(Number); return Math.round(Math.atan2(b, a) * 180 / Math.PI); });
const tap = async (p, id) => { const h = await p.$(`[data-testid="${id}"]`); await h.evaluate((e) => e.scrollIntoView({ block: "center" })); await pause(200); const b = await h.boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
const openIt = async (p) => { await p.click('[data-testid="add-widget-button"]'); await pause(750); };

try {
  // ── behaviour
  {
    const p = await editor();
    assert.equal(await popup(p), null, "closed to start with");
    await openIt(p);
    assert.ok(await popup(p), "the popup opens on tap");
    assert.equal(await plusDeg(p), 45, "the + has turned into an x");
    assert.equal(await p.$eval('[data-testid="add-widget-button"]', (e) => e.getAttribute("aria-expanded")), "true", "and says it is open");
    assert.equal(await p.$eval('[data-testid="add-widget-button"]', (e) => e.getAttribute("aria-label")), "Close", "and offers to close");
    const sizes = await p.evaluate(() => [...document.querySelector('[aria-label="Add a button"]').querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.equal(sizes.length, 21, "21 tiles");
    assert.ok(Math.min(...sizes) >= 44, `every tile is at least 44 px (smallest ${Math.min(...sizes)})`);

    await p.click('[data-testid="add-widget-button"]'); await pause(500);
    assert.equal(await popup(p), null, "tap + again closes it");
    assert.equal(await plusDeg(p), 0, "the x turns back into +");
    await openIt(p); await p.mouse.click(30, 220); await pause(500);
    assert.equal(await popup(p), null, "tap outside closes it");
    await openIt(p); await p.evaluate(() => window.handleAndroidBack && window.handleAndroidBack()); await pause(500);
    assert.equal(await popup(p), null, "Back closes it");
    assert.ok(await p.$('[data-testid="editor-back-button"]'), "and leaves the editor open");

    // adding
    const b0 = await count(p);
    await openIt(p); await tap(p, "add-a-widget-button"); await pause(600);
    assert.equal(await popup(p), null, "tapping a tile closes the popup");
    assert.equal(await count(p), b0 + 1, "and adds exactly one button");
    await openIt(p); await tap(p, "add-d-pad-widget-button"); await pause(600);
    assert.equal(await count(p), b0 + 2, "a big tile (D-Pad) adds one");
    await openIt(p); await tap(p, "add-touchpad-widget-button"); await pause(600);
    assert.equal(await count(p), b0 + 3, "so does the Touchpad tile");

    // a quick second tap while it is fading out must not add a second button
    for (const gap of [30, 80]) {
      const c0 = await count(p);
      await openIt(p);
      await p.evaluate(() => document.querySelector('[data-testid="add-x-widget-button"]').scrollIntoView({ block: "center" })); await pause(250);
      const x = await (await p.$('[data-testid="add-x-widget-button"]')).boundingBox(), y = await (await p.$('[data-testid="add-y-widget-button"]')).boundingBox();
      await p.mouse.click(x.x + x.width / 2, x.y + x.height / 2); await pause(gap);
      await p.mouse.click(y.x + y.width / 2, y.y + y.height / 2); await pause(700);
      assert.equal(await count(p), c0 + 1, `two taps ${gap} ms apart add ONE button (the second hits a popup that is already leaving)`);
    }
    // it scrolls to the last tile
    await openIt(p);
    assert.ok(await p.evaluate(async () => { const g = document.querySelector('[aria-label="Add a button"] .grid'); g.scrollTop = g.scrollHeight; await new Promise((r) => setTimeout(r, 200)); const b = g.lastElementChild.getBoundingClientRect(), c = g.getBoundingClientRect(); return b.bottom <= c.bottom + 1 && b.top >= c.top; }), "scrolling reaches the last tile");
    await p.close();
  }

  // ── motion: grows out of the +, never bounces, leaves quicker than it arrived
  {
    const p = await editor();
    await p.evaluate(() => {
      window.__rows = []; window.__rec = false;
      const sc = (el) => { const m = getComputedStyle(el).transform; return !m || m === "none" ? 1 : +m.match(/matrix\(([-\d.e]+)/)[1]; };
      const tick = (t) => { if (window.__rec) { const q = document.querySelector('[aria-label="Add a button"]'); window.__rows.push({ t, on: !!q, o: q ? +getComputedStyle(q).opacity : 0, s: q ? sc(q) : 1 }); } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const run = async (action, ms) => { await p.evaluate(() => { window.__rows = []; window.__rec = true; }); await action(); await pause(ms); return p.evaluate(() => { window.__rec = false; return window.__rows; }); };
    const opening = await run(() => p.click('[data-testid="add-widget-button"]'), 800); await pause(300);
    const closing = await run(() => p.click('[data-testid="add-widget-button"]'), 700);
    const on = opening.filter((r) => r.on);
    assert.ok(on[0].s < 0.95 && on[0].o < 0.3, `it starts small and faint, growing out of the + (scale ${on[0].s}, opacity ${on[0].o})`);
    assert.ok(Math.max(...on.map((r) => r.s)) <= 1.02, "and settles without a bounce");
    const inAt = on.find((r) => r.o >= 0.99 && r.s >= 0.995).t - opening[0].t;
    assert.ok(inAt < 450, `it is in within 450 ms (took ${inAt.toFixed(0)})`);
    const lastOn = [...closing].reverse().find((r) => r.on).t - closing[0].t;
    assert.ok(lastOn < inAt, `leaving is quicker than arriving (${lastOn.toFixed(0)} ms vs ${inAt.toFixed(0)} ms)`);
    await p.close();
  }

  // ── reduced motion: it only fades
  {
    const p = await editor(true);
    await p.evaluate(() => { window.__min = 1; const t = () => { const q = document.querySelector('[aria-label="Add a button"]'); if (q) { const m = getComputedStyle(q).transform; const s = !m || m === "none" ? 1 : +m.match(/matrix\(([-\d.e]+)/)[1]; window.__min = Math.min(window.__min, s); } requestAnimationFrame(t); }; requestAnimationFrame(t); });
    await p.click('[data-testid="add-widget-button"]'); await pause(700);
    await p.click('[data-testid="add-widget-button"]'); await pause(600);
    assert.ok(await p.evaluate(() => window.__min) >= 0.999, "with reduced motion the popup never changes size, in or out");
    await p.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("add-popup.test.mjs — opens, closes three ways, adds exactly one button (even on a double tap), grows without bouncing, fades only for reduced motion");
} finally {
  await browser.close();
}
