// Play Store screenshots of the REAL app UI (controller-ui/dist/index.html), 2026-10-01.
//
//   node shoot.mjs            -> PNGs next to this file
//
// Serves the built single-file UI locally, fakes the Android bridge as the PLAYSTORE build
// (no prices, ads on, a fresh player with the one-time 30 minutes), blocks every outside request
// so nothing live leaks in, and captures at Play's sizes: 1080x1920 portrait, 1920x1080 landscape
// (Play: 320-3840 px per side, long side at most twice the short side).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer-core');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = 'D:/AKHIL/HP/projects/gamepados/apps/controller-ui/dist/index.html';
const PORT = 5197;
const ONLY = process.argv[2];   // optional: shoot one screen by name

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(DIST));
}).listen(PORT);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--force-color-profile=srgb'],
});

/** A fake Android bridge: the Play build, signed out, ads available, `remaining` seconds left. */
function bridgeScript(remaining) {
  return `(() => {
    const snap = () => JSON.stringify({ remainingSeconds: ${remaining}, limitSeconds: 0, resetsAt: Date.now() + 864e5,
      freeRemainingSeconds: 0, bankSeconds: ${remaining}, canEarnAd: ${remaining} < 3600 });
    window.AndroidBridge = {
      getAppVersionName: () => '1.4.6', getAppVersionCode: () => 60, getDistributionChannel: () => 'playstore',
      onUiReady() {}, exitApp() {}, stopEngine() {}, startCameraScan() {}, stopCameraScan() {},
      getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }),
      getUsbBroadcastAddress: () => '',
      getGuestTrialState: snap, setGuestTrialActive: () => snap(),
      adsAvailable: () => true, preloadRewardedAd() {}, adPrivacyOptionsRequired: () => false,
    };
  })();`;
}

async function page({ w, h, remaining = 1800, storage = {} }) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  await p.setRequestInterception(true);
  p.on('request', r => (r.url().startsWith(`http://127.0.0.1:${PORT}`) || r.url().startsWith('data:')) ? r.continue() : r.abort());
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.evaluateOnNewDocument(bridgeScript(remaining));
  await p.evaluateOnNewDocument((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1800));
  return p;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function snap(p, name) { await p.screenshot({ path: path.join(HERE, name) }); console.log(name); }

const SHOTS = {
  // 1. Home: the first thing a new player sees (welcome card included).
  async home() {
    const p = await page({ w: 432, h: 768 });
    await snap(p, '01-home-1080x1920.png'); await p.close();
  },
  // 2. The controller itself, landscape, with the draggable time chip.
  async controller() {
    const p = await page({ w: 768, h: 432 });
    await clickText(p, 'button', /^Play/);
    await wait(2200);
    await snap(p, '02-controller-1920x1080.png'); await p.close();
  },
  // 3. Connect to PC: Wi-Fi or USB.
  async connect() {
    const p = await page({ w: 432, h: 768 });
    await clickText(p, 'button', /Connect to PC/);
    await wait(1500);
    await snap(p, '03-connect-1080x1920.png'); await p.close();
  },
  // 4. Time tab: what's left, and the ad button.
  async time() {
    const p = await page({ w: 432, h: 768, remaining: 1440 });
    await clickText(p, 'button', /^Time$/);
    await wait(1500);
    await snap(p, '04-time-1080x1920.png'); await p.close();
  },
  // 5. Custom layout editor, landscape.
  async editor() {
    const p = await page({ w: 768, h: 432 });
    await clickText(p, 'button, [role=button], a, div', /Make it your own/);
    await wait(1500);
    await clickText(p, 'button, [role=button], div', /^Standard Layouts/);
    await wait(1500);
    await clickText(p, 'button, [role=button], div, p, span', /Full-size wireless/);
    await wait(1500);
    await clickText(p, 'button', /CREATE & OPEN EDITOR/i);
    await wait(2500);
    if (process.env.DEBUG) console.log(await p.evaluate(() => document.body.innerText.slice(0, 600)));
    await snap(p, '05-editor-1920x1080.png'); await p.close();
  },
  // 6. Settings.
  async settings() {
    const p = await page({ w: 432, h: 768 });
    await clickText(p, 'button', /^Settings$/);
    await wait(1500);
    await snap(p, '06-settings-1080x1920.png'); await p.close();
  },
};

/** Click the smallest visible element of `sel` whose text matches `re`. */
async function clickText(p, sel, re) {
  const ok = await p.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const els = [...document.querySelectorAll(sel)].filter(e => re.test((e.innerText || e.getAttribute('aria-label') || '').trim()) && e.offsetParent);
    els.sort((a, b) => a.innerText.length - b.innerText.length);
    if (!els[0]) return false;
    els[0].click(); return true;
  }, sel, re.source, re.flags);
  if (!ok) console.log('  no element for', re);
}

for (const [name, fn] of Object.entries(SHOTS)) if (!ONLY || ONLY === name) await fn();
await browser.close(); server.close();
