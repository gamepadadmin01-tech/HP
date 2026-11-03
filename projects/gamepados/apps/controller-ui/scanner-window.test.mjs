// Run (with `npx vite --port 5187 --host 127.0.0.1 --strictPort` running): node scanner-window.test.mjs
// The QR scanner's middle frame is a WINDOW onto the phone's camera (the camera is a native view behind the web page).
// Nothing inside the frame may paint over it: no fill, no blur, no shadow. A bright red layer stands in for the camera,
// and the pixel at the centre of the frame must still be that red, undimmed, while the area outside the frame is dimmed.
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const page = await (await browser.createBrowserContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187/") || r.url().startsWith("data:") ? r.continue() : r.abort()));
  await page.evaluateOnNewDocument(() => {
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }), getUsbBroadcastAddress: () => "", stopEngine() {}, startCameraScan() {}, stopCameraScan() {} };
  });
  await page.setViewport({ width: 412, height: 915 });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(600);
  await page.click('[data-testid="connect-pc-button"]'); await pause(500);
  await page.click('[data-testid="scan-qr-button"]'); await pause(900);
  await page.waitForSelector('[data-testid="qr-scanner-screen"]');
  // stand-in for the native camera view: bright red, under the page
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "fake-camera"; d.style.cssText = "position:fixed;inset:0;background:#ff0000;z-index:-1"; document.body.appendChild(d); });
  await pause(300);
  const frame = await page.evaluate(() => { const f = document.querySelector('[data-testid="qr-scanner-screen"] .scan-window'); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; });
  assert.ok(frame, "the scanning frame is marked (.scan-window)");
  const px = async (x, y) => {
    const b64 = await page.screenshot({ encoding: "base64", clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
    return page.evaluate(async (b) => { const i = new Image(); i.src = "data:image/png;base64," + b; await i.decode(); const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }, b64);
  };
  const centre = await px(frame.x, frame.y), corner = await px(frame.x - frame.w / 2 + 16, frame.y), outside = await px(8, 450);
  assert.ok(centre[0] > 235 && centre[1] < 20 && centre[2] < 40, `the centre of the frame shows the camera undimmed (got rgb ${centre.slice(0, 3)})`);
  assert.ok(corner[0] > 235 && corner[1] < 20 && corner[2] < 40, `and so does the area next to the frame's edge (rgb ${corner.slice(0, 3)})`);
  assert.ok(outside[0] < 60, `while outside the frame the camera is dimmed (rgb ${outside.slice(0, 3)})`);
  const filters = await page.evaluate(() => [...document.querySelectorAll(".scan-window, .scan-window *")].map((e) => getComputedStyle(e).backdropFilter).filter((f) => f && f !== "none"));
  assert.deepEqual(filters, [], "no blur anywhere inside the frame");
  // the frame's own drawing is still there: the sweeping line and the four corners
  const art = await page.evaluate(() => { const l = getComputedStyle(document.querySelector(".scan-window .laser2")); return { line: l.backgroundColor !== "rgba(0, 0, 0, 0)" || l.backgroundImage !== "none", corners: [...document.querySelectorAll(".scan-window .corner2")].map((c) => getComputedStyle(c).borderTopColor + getComputedStyle(c).borderBottomColor) }; });
  assert.ok(art.line, "the laser line is still drawn");
  assert.equal(art.corners.length, 4, "four corners");
  assert.ok(art.corners.every((c) => /rgb\((?!0, 0, 0)/.test(c) || /rgba\(\d+, \d+, \d+, (?!0\))/.test(c)), `the corners are still coloured (${art.corners[0]})`);
  assert.deepEqual(errors, [], "no page errors");
  console.log("scanner-window.test.mjs — the middle of the scanner is a clear window onto the camera");
} finally {
  await browser.close();
}
