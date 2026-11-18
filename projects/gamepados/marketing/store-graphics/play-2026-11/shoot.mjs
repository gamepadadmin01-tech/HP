// Play Store screenshots of the REAL GamepadOS 2.0 UI (controller-ui/dist-play/index.html), 2026-11-17.
//
//   node shoot.mjs [name]   -> raw/<name>.png (the bare app screens), then `node compose.mjs` adds the headlines.
//
// Serves the built Google Play bundle locally, fakes the Android bridge as the PLAYSTORE build (2.0.0, ads on,
// a fresh player), blocks every outside request so nothing live leaks in, and captures phone-shaped screens.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('D:/AKHIL/HP/projects/gamepados/apps/controller-ui/package.json');
const puppeteer = require('puppeteer');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, process.env.RAW_DIR || 'raw');   // RAW_DIR=raw-4k SCALE=5 for the video
fs.mkdirSync(RAW, { recursive: true });
const DIST = 'D:/AKHIL/HP/projects/gamepados/apps/controller-ui/dist-play/index.html';
const PORT = 5198;
const ONLY = process.argv[2];

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(DIST));
}).listen(PORT);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--force-color-profile=srgb'],
});

/** The Play build, signed out, ads available. link: 'connected' | 'no-reply' | 'off'. */
function bridgeScript({ remaining, link }) {
  const tele = link === 'connected' ? { engineRunning: true, linkAlive: true, sinceAck: 40, rttMs: 4 }
    : link === 'no-reply' ? { engineRunning: true, linkAlive: false, sinceAck: -1 }
    : { engineRunning: false, linkAlive: false };
  return `(() => {
    const snap = () => JSON.stringify({ remainingSeconds: ${remaining}, limitSeconds: 0, resetsAt: Date.now() + 864e5,
      freeRemainingSeconds: 0, bankSeconds: ${remaining}, canEarnAd: ${remaining} < 1800 });
    window.AndroidBridge = {
      getAppVersionName: () => '2.0.0', getAppVersionCode: () => 72, getDistributionChannel: () => 'playstore',
      onUiReady() {}, exitApp() {}, stopEngine() {}, startEngine() {}, startCameraScan() {}, stopCameraScan() {},
      getNetworkTelemetryJson: () => ${JSON.stringify(JSON.stringify(tele))},
      getUsbBroadcastAddress: () => '', getSystemStatsJson: () => '{"temp":34}',
      getGuestTrialState: snap, setGuestTrialActive: () => snap(),
      adsAvailable: () => true, adNetwork: () => 'admob', preloadRewardedAd() {}, adPrivacyOptionsRequired: () => false,
      startPlayPurchase() {}, requestPlayReview() {},
    };
  })();`;
}

async function page({ w, h, remaining = 1500, link = 'off', storage = {} }) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: Number(process.env.SCALE || 2.5), isMobile: true, hasTouch: true });
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url();
    if (u.startsWith(`http://127.0.0.1:${PORT}`) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    // Pretend server answers (nothing live is contacted): the Play plan list and the app settings.
    const json = (body) => r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (u.includes('/api/billing/plans')) return json({ success: true, channel: 'playstore', currency: 'INR', purchasable: true,
      plans: [{ code: 'LIFETIME', displayName: 'Lifetime', currency: 'INR', priceMinor: 1900, unlimited: true, dailySeconds: null,
        durationHours: null, durationMonths: null, purchasable: true, priceFromStore: true, playProductId: 'gpos_lifetime' }] });
    if (u.includes('/api/app-config')) return json({ success: true, ads: { available: true, message: '' },
      guest: { welcomeSeconds: 1800, adRewardSeconds: 1800, adCapSeconds: 3600, freeTime: { enabled: false, seconds: 1800, belowSeconds: 1800, perDay: 6, title: '', body: '' } }, notice: null, kill: null });
    return r.abort();
  });
  p.on('pageerror', e => console.log('  pageerror:', e.message));
  await p.evaluateOnNewDocument(bridgeScript({ remaining, link }));
  await p.evaluateOnNewDocument((s) => { try { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch {} }, storage);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await wait(2200);
  return p;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function snap(p, name) {
  if (process.env.DEBUG) console.log(`--- ${name}\n` + (await p.evaluate(() => document.body.innerText)).slice(0, 500));
  await p.screenshot({ path: path.join(RAW, name + '.png') }); console.log('raw/' + name + '.png');
}
/** Click the smallest visible element of `sel` whose text (or aria-label) matches `re`. */
async function clickText(p, sel, re) {
  const ok = await p.evaluate((sel, src, flags) => {
    const re = new RegExp(src, flags);
    const els = [...document.querySelectorAll(sel)].filter(e => re.test((e.innerText || e.getAttribute('aria-label') || '').trim()) && e.offsetParent);
    els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    if (!els[0]) return false;
    els[0].click(); return true;
  }, sel, re.source, re.flags);
  if (!ok) console.log('  no element for', re);
  return ok;
}

// Screen shape. Default 9:16; PHONE=poco shoots the shape of a normal modern Android phone (POCO X6 Pro:
// 1220x2712 px = 20:9, about 407x904 in CSS pixels), so the phone in the store images looks like a real phone.
const SHAPE = process.env.PHONE === 'poco' ? { w: 407, h: 904 } : { w: 432, h: 768 };
const PORTRAIT = { w: SHAPE.w, h: SHAPE.h }, LANDSCAPE = { w: SHAPE.h, h: SHAPE.w };
const SHOTS = {
  async controller() {          // the Standard controller, connected
    const p = await page({ ...LANDSCAPE, link: 'connected' });
    await p.evaluate(() => document.querySelector('button[aria-label="Play Standard Controller"]').click());
    await wait(2600);
    await snap(p, 'controller'); await p.close();
  },
  async racing() {              // the racing layout (gyro steering)
    const p = await page({ ...LANDSCAPE, link: 'connected' });
    await p.evaluate(() => document.querySelector('button[aria-label="Play Standard Racing Controller"]').click());
    await wait(2600);
    await snap(p, 'racing'); await p.close();
  },
  async home() {                // home: status, Connect, the layouts
    const p = await page({ ...PORTRAIT, link: 'connected' });
    await snap(p, 'home'); await p.close();
  },
  async connect() {             // Connect to PC: Wi-Fi or USB
    const p = await page({ ...PORTRAIT });
    await clickText(p, 'button', /Connect to PC/);
    await wait(1800);
    await snap(p, 'connect'); await p.close();
  },
  async why() {                 // the PC does not answer -> See why?
    const p = await page({ ...PORTRAIT, link: 'no-reply' });
    await wait(1500);
    await clickText(p, 'button', /^See why\?$/);
    await wait(1400);
    await snap(p, 'why'); await p.close();
  },
  async editor() {              // the layout editor, landscape
    const p = await page({ ...LANDSCAPE });
    await p.click('[data-testid="create-layout-button"]');
    await wait(1600);
    await p.evaluate(() => [...document.querySelectorAll('.calm-lay-option')].find((b) => b.textContent.includes('Standard Controller')).click());
    await wait(2800);
    await snap(p, 'editor'); await p.close();
  },
  async settings() {
    const p = await page({ ...PORTRAIT, link: 'connected' });
    await clickText(p, 'button', /^Settings$/);
    await wait(1600);
    await snap(p, 'settings'); await p.close();
  },
  async plans() {
    const p = await page({ ...PORTRAIT, remaining: 1500 });
    await clickText(p, 'button', /^Plans$/);
    await wait(1800);
    await snap(p, 'plans'); await p.close();
  },
};

for (const [name, fn] of Object.entries(SHOTS)) if (!ONLY || ONLY === name) await fn();
await browser.close(); server.close();
