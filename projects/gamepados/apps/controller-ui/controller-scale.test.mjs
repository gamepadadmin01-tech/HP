// Run (with `npx vite --port 5187 --host 127.0.0.1 --strictPort` running): node controller-scale.test.mjs
// The controller screen draws the pad at its normal size: 100% of the space it can fill (as it always did, until a
// 90% experiment was undone on request), centred. And the phone's native touch engine, which maps touches with the
// matrix the page sends it (svg.getScreenCTM), receives exactly that matrix: so what you see is where you touch.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];

async function play(w, h) {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187/") || r.url().startsWith("data:") ? r.continue() : r.abort()));
  await page.evaluateOnNewDocument(() => {
    window.__geo = [];
    window.AndroidBridge = {
      onUiReady() {}, exitApp() {}, getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }), getUsbBroadcastAddress: () => "",
      stopEngine() {}, startCameraScan() {}, stopCameraScan() {},
      setNativeInputGeometry(j) { window.__geo.push(JSON.parse(j)); }, setNativeInputActive() {},
    };
  });
  await page.setViewport({ width: 412, height: 915 });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(600);
  await page.$eval('button[aria-label^="Play "]', (e) => e.click());
  await page.setViewport({ width: w, height: h });
  await pause(1500);
  return page;
}

const measure = (page) => page.evaluate(() => {
  const svg = [...document.querySelectorAll('svg[viewBox="0 0 1280 570"]')].find((s) => s.getBoundingClientRect().width > 300 && !s.closest('[data-testid="layout-editor-screen"]'));
  const box = svg.parentElement.getBoundingClientRect();           // the space the pad could fill
  const r = svg.getBoundingClientRect(), m = svg.getScreenCTM();
  return { box: [box.width, box.height], svg: [r.width, r.height], scale: m.a, e: m.e, f: m.f, geo: window.__geo.slice(-1)[0] || null };
});

try {
  for (const [name, w, h] of [["landscape phone", 900, 405], ["wide landscape", 1280, 570], ["short landscape", 780, 360]]) {
    const page = await play(w, h);
    const s = await measure(page);
    const full = Math.min(s.box[0] / 1280, s.box[1] / 570);                      // the old edge-to-edge scale
    assert.ok(Math.abs(s.scale / full - 1) < 0.005, `${name}: the pad is drawn at its normal size, edge to edge (got ${(100 * s.scale / full).toFixed(1)}%)`);
    // centred: equal margin on both sides, and at the top and bottom
    const left = s.e, right = s.box[0] - (s.e + 1280 * s.scale), top = s.f, bottom = s.box[1] - (s.f + 570 * s.scale);
    assert.ok(Math.abs(left - right) < 1.5 && Math.abs(top - bottom) < 1.5, `${name}: centred (margins ${left.toFixed(1)} / ${right.toFixed(1)} and ${top.toFixed(1)} / ${bottom.toFixed(1)})`);
    assert.ok(Math.min(left, top) >= 0 && Math.min(right, bottom) >= 0, `${name}: nothing is pushed off the screen`);
    // the phone's native touch engine gets the SAME matrix
    assert.ok(s.geo, `${name}: the native touch engine was given the pad's geometry`);
    const [a, b, c, d, e, f] = s.geo.matrix;
    assert.ok(Math.abs(a - s.scale) < 1e-6 && Math.abs(d - s.scale) < 1e-6 && Math.abs(e - s.e) < 1e-6 && Math.abs(f - s.f) < 1e-6 && b === 0 && c === 0,
      `${name}: native matrix = what is on screen (scale ${a.toFixed(4)}, offset ${e.toFixed(1)},${f.toFixed(1)})`);
    await page.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("controller-scale.test.mjs — the pad is drawn at its normal size, centred, and the native touch matrix matches it exactly");
} finally {
  await browser.close();
}
