// Run (with `npx vite --port 5187 --host 127.0.0.1 --strictPort` running): node settings-panel.test.mjs
// The editor's button-settings panel, in the REAL editor in headless Chrome, with real mouse events:
//   • it is drawn at 75% of its design size and starts below the toolbar with a visible gap (never touching it);
//   • its header drags it anywhere on the screen, follows the finger 1:1, and it can never be lost off an edge;
//   • the Delete button in the header is not a drag handle, and a slider inside still works;
//   • it remembers where you left it when you close and reopen it.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];

async function editor(w = 900, h = 405) {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187/") || r.url().startsWith("data:") ? r.continue() : r.abort()));
  await page.evaluateOnNewDocument(() => {
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }), getUsbBroadcastAddress: () => "", stopEngine() {}, startCameraScan() {}, stopCameraScan() {}, setScreenOrientation() {} };
  });
  await page.setViewport({ width: 412, height: 915 });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(600);
  await page.click('[data-testid="create-layout-button"]');
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((e) => e.textContent.includes("Blank canvas")), { timeout: 8000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Blank canvas")).click());
  await page.waitForSelector('input[placeholder="My Custom Layout"]', { timeout: 8000 });
  await page.type('input[placeholder="My Custom Layout"]', "T");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((e) => e.textContent.includes("Create and open editor")).click()); await pause(900);
  await page.waitForSelector('[data-testid="editor-back-button"]');
  await page.setViewport({ width: w, height: h }); await pause(800);
  // add one button (A) and open its settings
  await page.click('[data-testid="add-widget-button"]'); await pause(700);
  await page.evaluate(() => document.querySelector('[data-testid="add-a-widget-button"]').scrollIntoView({ block: "center" })); await pause(200);
  await page.click('[data-testid="add-a-widget-button"]'); await pause(700);
  return page;
}
const rect = (p, sel) => p.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);
const openPanel = async (p) => { await p.click('[data-testid="widget-settings-button"]'); await pause(800); };
const drag = async (p, from, to) => {
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { await p.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await pause(16); }
  await p.mouse.up(); await pause(120);
};
const grip = async (p) => { const h = await rect(p, '[data-testid="widget-settings-handle"]'); return { x: h.l + h.w / 2, y: h.t + h.h / 2 }; };

try {
  for (const [w, h] of [[900, 405], [780, 360]]) {
    const p = await editor(w, h);
    await openPanel(p);
    const tb = await rect(p, ".console-editor-toolbar"), pn = await rect(p, '[data-testid="widget-settings-panel"]');
    assert.ok(Math.abs(pn.w - 300 * 0.75) < 1, `${w}x${h}: the panel is drawn at 75% (width ${pn.w.toFixed(1)} px, design 300)`);
    assert.ok(pn.t - tb.b >= 6, `${w}x${h}: a gap of at least 6 px between the toolbar and the panel (${(pn.t - tb.b).toFixed(1)} px)`);
    assert.ok(Math.abs((pn.l + pn.r) / 2 - w / 2) < 2, `${w}x${h}: starts centred under the toolbar`);

    // drag by the header: follows the finger 1:1
    const g = await grip(p);
    await drag(p, g, { x: g.x - 250, y: g.y + 120 });
    const moved = await rect(p, '[data-testid="widget-settings-panel"]');
    assert.ok(Math.abs((moved.l - pn.l) + 250) < 2 && Math.abs((moved.t - pn.t) - 120) < 2, `${w}x${h}: panel follows the finger 1:1 (moved ${(moved.l - pn.l).toFixed(0)}, ${(moved.t - pn.t).toFixed(0)})`);

    // far past every edge: it stops at the edge, fully visible
    for (const [dx, dy, name] of [[-2000, -2000, "top-left"], [2000, 2000, "bottom-right"], [2000, -2000, "top-right"], [-2000, 2000, "bottom-left"]]) {
      const gg = await grip(p);
      await drag(p, gg, { x: Math.max(1, Math.min(w - 1, gg.x + dx)), y: Math.max(1, Math.min(h - 1, gg.y + dy)) });
      const r = await rect(p, '[data-testid="widget-settings-panel"]');
      assert.ok(r.l >= 3.5 && r.t >= 3.5 && r.r <= w - 3.5 && r.b <= h - 3.5, `${w}x${h}: ${name}: panel stays fully on screen (${r.l.toFixed(0)},${r.t.toFixed(0)} to ${r.r.toFixed(0)},${r.b.toFixed(0)})`);
    }

    // remembers its place across close/reopen
    const before = await rect(p, '[data-testid="widget-settings-panel"]');
    await p.click('[data-testid="widget-settings-button"]'); await pause(500);
    assert.equal(await p.$('[data-testid="widget-settings-panel"]'), null, "the gear closes it");
    await openPanel(p);
    const after = await rect(p, '[data-testid="widget-settings-panel"]');
    assert.ok(Math.abs(after.l - before.l) < 1 && Math.abs(after.t - before.t) < 1, `${w}x${h}: reopens where it was left`);

    // a slider inside still works (drag the track to the end)
    const track = await p.evaluate(() => { const t = [...document.querySelectorAll('[data-testid="widget-settings-panel"] .cursor-pointer')][0]; const b = t.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; });
    const rBefore = await p.evaluate(() => document.querySelector('[data-testid="widget-settings-panel"] .rounded-full.bg-white').getBoundingClientRect().left);
    await p.mouse.click(track.x + track.w * 0.95, track.y); await pause(200);
    const rAfter = await p.evaluate(() => document.querySelector('[data-testid="widget-settings-panel"] .rounded-full.bg-white').getBoundingClientRect().left);
    assert.ok(rAfter > rBefore + 40, `${w}x${h}: the size slider still responds (thumb moved ${(rAfter - rBefore).toFixed(0)} px)`);
    const stillThere = await rect(p, '[data-testid="widget-settings-panel"]');
    assert.ok(Math.abs(stillThere.l - after.l) < 1 && Math.abs(stillThere.t - after.t) < 1, `${w}x${h}: using a slider does not move the panel`);

    // the Delete button deletes (it is not a drag handle)
    const countBtns = () => p.evaluate(() => document.querySelectorAll('svg g[style*="cursor: grab"]').length);
    const n0 = await countBtns();
    await p.click('[data-testid="widget-settings-panel"] button[aria-label="Delete button"]'); await pause(500);
    assert.equal(await countBtns(), n0 - 1, `${w}x${h}: Delete removes the button`);
    assert.equal(await p.$('[data-testid="widget-settings-panel"]'), null, "and the panel closes");
    await p.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("settings-panel.test.mjs — 75% size, clear gap under the toolbar, header drags 1:1, stays on screen, remembers its place, slider + delete still work");
} finally {
  await browser.close();
}
