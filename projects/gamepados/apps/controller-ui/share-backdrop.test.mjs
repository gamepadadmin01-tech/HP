// Run: node share-backdrop.test.mjs   (vite on 127.0.0.1:5187)
// The Share pop-up's dark backdrop must cover the WHOLE screen (owner's screenshot, 2026-11-11: it stopped short of
// the top bar and the bottom tabs, because it sat inside the Home tab's moving container). Checks, on a phone-sized
// screen with one saved layout: the backdrop's box equals the viewport, it is drawn over the top bar and the bottom
// tabs (the topmost element at those points is the backdrop), and tapping the backdrop closes the pop-up.
import puppeteer from "puppeteer";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 412, height: 915 });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187") || r.url().startsWith("data:") ? r.continue() : r.respond({ status: 404, body: "{}" })));
  await page.evaluateOnNewDocument(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("custom_pads", JSON.stringify([{ padId: "test-pad-1", name: "Racing", color: "#ff7a2f", buttons: [] }]));
  });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(900);
  await page.click('button[aria-label="More options for Racing"]'); await pause(400);
  await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === "Share").click());
  await page.waitForSelector('[role="dialog"][aria-label="Share controller layout"]'); await pause(700);
  const r = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Share controller layout"]');
    const back = dlg.parentElement;
    const b = back.getBoundingClientRect();
    const top = document.elementFromPoint(innerWidth / 2, 20), bottom = document.elementFromPoint(innerWidth / 2, innerHeight - 20);
    const left = document.elementFromPoint(4, innerHeight / 2);
    return { box: [b.left, b.top, b.width, b.height].map(Math.round), vw: innerWidth, vh: innerHeight,
      topIsBackdrop: back === top || back.contains(top), bottomIsBackdrop: back === bottom || back.contains(bottom), leftIsBackdrop: back === left || back.contains(left),
      underBody: back.parentElement === document.body };
  });
  assert.deepEqual(r.box, [0, 0, r.vw, r.vh], `the backdrop covers the whole screen (box ${r.box}, screen ${r.vw}x${r.vh})`);
  assert.ok(r.topIsBackdrop, "the backdrop is drawn over the top bar");
  assert.ok(r.bottomIsBackdrop, "the backdrop is drawn over the bottom tabs");
  assert.ok(r.leftIsBackdrop, "the backdrop reaches the screen's side edge");
  assert.ok(r.underBody, "the pop-up is rendered at the page's top level");
  await page.mouse.click(206, 30); await pause(700);
  assert.equal(await page.$('[role="dialog"][aria-label="Share controller layout"]'), null, "tapping the backdrop (even over the top bar) closes it");
  assert.deepEqual(errors, []);
  console.log("PASS share pop-up: backdrop covers the whole screen (over the top bar and bottom tabs), top level, tap outside closes");
} finally { await browser.close(); }
