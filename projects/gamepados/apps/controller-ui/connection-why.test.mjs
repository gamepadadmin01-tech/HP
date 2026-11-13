// Run: node connection-why.test.mjs   (vite on 127.0.0.1:5187)
// "See why?" (owner, 2026-11-13): when the PC is not replying or the connection broke, the long reason must not sit
// in the page. A small accent TEXT button "See why?" appears beside the short status, only while there is a problem,
// and opens the reason in a pop-up that covers the whole screen and is drawn in the app's colours.
// Checks, on Home and on the Connect screen, for each state: off / connected show no button; not replying and
// interrupted show the short title + the button and NOT the long reason; the pop-up shows the reason, has a solid
// themed card, a full-screen backdrop, and OK / tapping outside close it. Also: the Share card is drawn in the theme.
import puppeteer from "puppeteer";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const STATES = {
  off: { engineRunning: false, linkAlive: false },
  connected: { engineRunning: true, linkAlive: true, connectionType: "wireless" },
  "no-reply": { engineRunning: true, linkAlive: false, sinceAck: -1, connectionType: "wireless" },
  stalled: { engineRunning: true, linkAlive: false, sinceAck: 9000, connectionType: "wireless" },
};
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const results = [];
try {
  for (const [name, tele] of Object.entries(STATES)) {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 412, height: 915 });
    await page.setRequestInterception(true);
    page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187") || r.url().startsWith("data:") ? r.continue() : r.respond({ status: 404, body: "{}" })));
    await page.evaluateOnNewDocument((t) => {
      try { localStorage.clear(); } catch {}
      window.AndroidBridge = { onUiReady() {}, exitApp() {}, getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.16", getAppVersionCode: () => 70,
        getNetworkTelemetryJson: () => JSON.stringify(t), getUsbBroadcastAddress: () => "", stopEngine() {}, setScreenOrientation() {} };
    }, tele);
    await page.goto("http://127.0.0.1:5187/");
    await page.waitForSelector('[data-testid="home-heading"]'); await pause(1500);
    const problem = name === "no-reply" || name === "stalled";
    for (const where of ["Home", "Connect"]) {
      if (where === "Connect") { await page.click('[data-testid="connect-pc-button"]'); await pause(900); }
      const scope = where === "Home" ? ".console-connect-entry" : ".calm-connection";
      const v = await page.evaluate((sc) => { const el = document.querySelector(sc); return el ? { text: el.textContent, btn: !!el.querySelector('[data-testid="connection-see-why"]'),
        btnTag: el.querySelector('[data-testid="connection-see-why"]')?.tagName, btnBg: el.querySelector('[data-testid="connection-see-why"]') ? getComputedStyle(el.querySelector('[data-testid="connection-see-why"]')).backgroundColor : "",
        btnColor: el.querySelector('[data-testid="connection-see-why"]') ? getComputedStyle(el.querySelector('[data-testid="connection-see-why"]')).color : "",
        accent: getComputedStyle(el).getPropertyValue("--calm-accent").trim() } : null; }, scope);
      assert.ok(v, `${name} / ${where}: the connection status is on screen`);
      const longReason = /isn't answering|stopped answering/.test(v.text);
      if (!problem) {
        assert.ok(!v.btn, `${name} / ${where}: no "See why?" when there is no problem`);
      } else {
        assert.ok(v.btn && v.btnTag === "BUTTON", `${name} / ${where}: a "See why?" button appears`);
        assert.ok(v.text.includes("See why?"), `${name} / ${where}: it is labelled "See why?"`);
        assert.ok(!longReason, `${name} / ${where}: the long reason is no longer written in the page`);
        assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(v.btnBg), `${name} / ${where}: it is a text button, no button box (${v.btnBg})`);
        await page.click(`${scope} [data-testid="connection-see-why"]`); await pause(700);
        const d = await page.evaluate(() => { const dlg = document.querySelector('[data-testid="connection-why-dialog"]'); if (!dlg) return null; const b = dlg.parentElement.getBoundingClientRect();
          const cs = getComputedStyle(dlg); return { text: dlg.textContent, bg: cs.backgroundColor, box: [b.left, b.top, b.width, b.height].map(Math.round), vw: innerWidth, vh: innerHeight,
          ink: getComputedStyle(dlg.querySelector("h3")).color }; });
        assert.ok(d, `${name} / ${where}: tapping "See why?" opens the pop-up`);
        assert.ok(/isn't answering|stopped answering/.test(d.text), `${name} / ${where}: the pop-up explains the reason`);
        assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg), `${name} / ${where}: the pop-up card is solid, in the app's colour (${d.bg})`);
        assert.deepEqual(d.box, [0, 0, d.vw, d.vh], `${name} / ${where}: its backdrop covers the whole screen`);
        await page.evaluate(() => [...document.querySelectorAll('[data-testid="connection-why-dialog"] button')].find((b) => b.textContent.trim() === "OK").click()); await pause(600);
        assert.equal(await page.$('[data-testid="connection-why-dialog"]'), null, `${name} / ${where}: OK closes it`);
        await page.click(`${scope} [data-testid="connection-see-why"]`); await pause(600);
        await page.mouse.click(206, 40); await pause(600);
        assert.equal(await page.$('[data-testid="connection-why-dialog"]'), null, `${name} / ${where}: tapping outside closes it`);
      }
      results.push(`${name} / ${where}: ok`);
    }
    assert.deepEqual(errors, [], `${name}: no page errors`);
    await page.close();
  }
  // The Share card (rendered at the page's top level) must keep the theme's card colour.
  const page = await browser.newPage();
  await page.setViewport({ width: 412, height: 915 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187") || r.url().startsWith("data:") ? r.continue() : r.respond({ status: 404, body: "{}" })));
  await page.evaluateOnNewDocument(() => { if (sessionStorage.getItem("s")) return; sessionStorage.setItem("s", "1"); localStorage.clear();
    localStorage.setItem("custom_pads", JSON.stringify([{ padId: "p1", name: "Racing", color: "#ff7a2f", buttons: [] }])); });
  await page.goto("http://127.0.0.1:5187/"); await page.waitForSelector('[data-testid="home-heading"]'); await pause(900);
  await page.click('button[aria-label="More options for Racing"]'); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === "Share").click()); await pause(800);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"][aria-label="Share controller layout"]')).backgroundColor);
  assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(bg), `the Share card is solid, in the app's colour (${bg})`);
  results.push(`share card colour: ok (${bg})`);
  console.log(results.join("\n"));
  console.log("PASS See why?: only on a connection problem, text button, reason in a themed full-screen pop-up (Home + Connect); Share card themed");
} finally { await browser.close(); }
