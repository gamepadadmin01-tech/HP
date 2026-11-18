// node i18n-crawl.mjs   (with `npx vite --port 5187 --host 127.0.0.1 --strictPort` running)
// Walks the real app through its screens in headless Chrome (in English, or LANG_CODE=ja-JP to check a translation), and records every text and visible
// attribute it shows -> i18n-crawl.json. That list (plus the source scan) is what gets translated (2.1).
import fs from "node:fs";
import puppeteer from "puppeteer";

const ORIGIN = "http://127.0.0.1:5187/";
const seen = new Map();   // text -> first place seen
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bridge({ remaining, link, signedIn }) {
  const tele = link === "connected" ? { engineRunning: true, linkAlive: true, sinceAck: 40, rttMs: 4 }
    : link === "no-reply" ? { engineRunning: true, linkAlive: false, sinceAck: -1 } : { engineRunning: false, linkAlive: false };
  return `(() => {
    const snap = () => JSON.stringify({ remainingSeconds: ${remaining}, limitSeconds: 0, resetsAt: Date.now() + 864e5,
      freeRemainingSeconds: 0, bankSeconds: ${remaining}, canEarnAd: ${remaining} < 1800 });
    window.AndroidBridge = {
      getAppVersionName: () => '2.1.0', getAppVersionCode: () => 73, getDistributionChannel: () => 'playstore',
      onUiReady() {}, exitApp() {}, stopEngine() {}, startEngine() {}, startCameraScan() {}, stopCameraScan() {},
      getNetworkTelemetryJson: () => ${JSON.stringify(JSON.stringify(tele))},
      getUsbBroadcastAddress: () => '', getSystemStatsJson: () => '{"temp":34}',
      getGuestTrialState: snap, setGuestTrialActive: () => snap(),
      adsAvailable: () => true, adNetwork: () => 'admob', preloadRewardedAd() {}, adPrivacyOptionsRequired: () => true,
      startPlayPurchase() {}, requestPlayReview() {},
    };
    ${signedIn ? `localStorage.setItem('gp_account_session', JSON.stringify({ token: 't', user: { id: 'u', email: 'player@example.com', displayName: 'Player' } }));` : ""}
  })();`;
}

async function page(opts) {
  const { w = 412, h = 915, remaining = 1500, link = "off", signedIn = false, adsDown = false } = opts;
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await p.setRequestInterception(true);
  p.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(ORIGIN) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue();
    const json = (body) => r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    if (u.includes("/api/billing/plans")) return json({ success: true, channel: "playstore", currency: "INR", purchasable: true,
      plans: [{ code: "LIFETIME", displayName: "Lifetime", currency: "INR", priceMinor: 1900, unlimited: true, purchasable: true, priceFromStore: true, playProductId: "gpos_lifetime" }] });
    if (u.includes("/api/app-config")) return json({ success: true, ads: { available: !adsDown, message: "" },
      guest: { welcomeSeconds: 1800, adRewardSeconds: 1800, adCapSeconds: 3600, freeTime: { enabled: adsDown, seconds: 1800, belowSeconds: 1800, perDay: 6, title: "", body: "" } }, notice: null, kill: null });
    return r.abort();
  });
  await p.evaluateOnNewDocument(bridge({ remaining, link, signedIn }));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem("gp_language", "en"); } catch {} });
  await p.goto(ORIGIN, { waitUntil: "load" });
  await wait(2500);
  return p;
}

async function harvest(p, where) {
  // Navigation clicks use the English words; to check a translation, switch just for the reading, then back.
  if (process.env.LANG_CODE) { await p.evaluate((l) => window.__gpSetLang?.(l), process.env.LANG_CODE); await wait(300); }
  const items = await p.evaluate(() => {
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) { const t = n.data.trim(); if (t && !["SCRIPT", "STYLE"].includes(n.parentElement?.tagName)) out.push(t); }
      else for (const a of ["placeholder", "aria-label", "title", "alt"]) { const v = n.getAttribute(a); if (v) out.push(v.trim()); }
    }
    return out;
  });
  for (const t of items) if (/[A-Za-z]{2}/.test(t) && !seen.has(t)) seen.set(t, where);
  if (process.env.LANG_CODE) { await p.evaluate(() => window.__gpSetLang?.("en")); await wait(300); }
}
async function clickText(p, re, sel = "button, [role=button], a, [role=tab], [role=radio]") {
  const ok = await p.evaluate((sel, src) => {
    const re = new RegExp(src);
    const els = [...document.querySelectorAll(sel)].filter((e) => re.test((e.innerText || e.getAttribute("aria-label") || "").trim()) && e.offsetParent);
    els.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    if (!els[0]) return false; els[0].click(); return true;
  }, sel, re.source);
  await wait(900);
  return ok;
}
const tid = async (p, id) => { const ok = await p.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return false; e.click(); return true; }, id); await wait(900); return ok; };

// ── Home in three link states, See why? ──
for (const link of ["off", "connected", "no-reply"]) {
  const p = await page({ link }); await harvest(p, `home-${link}`);
  if (link === "no-reply") { await tid(p, "connection-see-why"); await harvest(p, "why"); }
  await p.close();
}
// ── Connect: Wi-Fi, manual, USB modes and help ──
{
  const p = await page({}); await clickText(p, /^Connect to PC$/); await harvest(p, "connect-wifi");
  await clickText(p, /Connect manually/); await harvest(p, "connect-manual");
  await clickText(p, /^USB$/); await harvest(p, "connect-usb");
  for (const m of [/^Tethering$/, /^Debugging$/, /^Auto$/]) { await clickText(p, m); await harvest(p, "connect-usb-mode"); }
  await clickText(p, /Using USB debugging instead/); await clickText(p, /Developer options\?/); await harvest(p, "connect-usb-help");
  await clickText(p, /^Wi-Fi$/); await clickText(p, /Scan PC QR code/); await harvest(p, "scanner");
  await p.close();
}
// ── Settings, More settings, Language list ──
{
  const p = await page({ link: "connected" }); await clickText(p, /^Settings$/); await tid(p, "more-settings"); await tid(p, "language-row"); await harvest(p, "settings");
  await p.close();
}
// ── Plans: guest with time, out of time, ads down; signed in ──
for (const o of [{ remaining: 1500 }, { remaining: 0 }, { remaining: 0, adsDown: true }, { remaining: 1500, signedIn: true }]) {
  const p = await page(o); await harvest(p, "home-plans");
  await clickText(p, /^Plans$/); await harvest(p, `plans-${JSON.stringify(o)}`);
  await clickText(p, /Have a code\?/); await harvest(p, "plans-code");
  await p.close();
}
// ── Account / sign in flows ──
{
  const p = await page({}); await p.evaluate(() => document.querySelector('[aria-label="Open your profile"], [aria-label="Sign in to GamepadOS"]')?.click()); await wait(1200);
  await harvest(p, "signin");
  await clickText(p, /Create an account/); await harvest(p, "signup");
  await clickText(p, /Already have an account/); await clickText(p, /Forgot your password/); await harvest(p, "forgot");
  await p.close();
}
{
  const p = await page({ signedIn: true }); await p.evaluate(() => document.querySelector('[aria-label="Open your profile"]')?.click()); await wait(1500); await harvest(p, "account");
  await clickText(p, /Delete account/); await harvest(p, "account-delete");
  await p.close();
}
// ── Notifications bell, Create a layout, feedback ──
{
  const p = await page({ link: "connected" });
  await p.evaluate(() => document.querySelector('[aria-label^="Notifications"]')?.click()); await wait(900); await harvest(p, "notifications");
  await p.keyboard.press("Escape"); await wait(600);
  await p.evaluate(() => document.querySelector('[data-testid="create-layout-button"]')?.click()); await wait(1200); await harvest(p, "create-layout");
  await clickText(p, /Import from code/); await harvest(p, "import-code");
  await p.close();
}
// ── Controller and editor (landscape) ──
{
  const p = await page({ w: 915, h: 412, link: "connected" });
  await p.evaluate(() => document.querySelector('button[aria-label="Play Standard Controller"]')?.click()); await wait(2600); await harvest(p, "controller");
  await p.close();
}
{
  const p = await page({ w: 915, h: 412 });
  await p.evaluate(() => document.querySelector('[data-testid="create-layout-button"]')?.click()); await wait(1400);
  await p.evaluate(() => [...document.querySelectorAll(".calm-lay-option")].find((b) => b.textContent.includes("Create custom pad") || b.textContent.includes("Standard"))?.click()); await wait(2600);
  await harvest(p, "editor");
  await p.evaluate(() => document.querySelector('[aria-label="Add a button"]')?.click()); await wait(1200); await harvest(p, "editor-add");
  await p.close();
}

await browser.close();
const out = Object.fromEntries(seen);
fs.writeFileSync(process.env.LANG_CODE ? `i18n-crawl-${process.env.LANG_CODE}.json` : "i18n-crawl.json", JSON.stringify(out, null, 1));
console.log(seen.size, "texts");
