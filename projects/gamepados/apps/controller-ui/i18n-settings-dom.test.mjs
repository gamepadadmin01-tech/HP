// Run: node i18n-settings-dom.test.mjs
// 2.1 languages, on the REAL Settings screen in headless Chrome:
//   • the phone's language decides (Automatic); English phones stay English; mapping of regional codes;
//   • the most-used settings are on the page, the rare ones are hidden under "More settings" until it is opened;
//   • picking a language in the Language row re-labels the screen at once, is remembered, and test ids stay English;
//   • Automatic goes back to the phone's language.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { CalmSettings } from "./src/app/components/CalmSettings";
import { fromPhone } from "./src/app/i18n";
window.__fromPhone = fromPhone;
const noop = () => {};
createRoot(document.getElementById("root")).render(
  <CalmSettings gyroOn gyroMaxAngle={30} gyroWheel={false} gyroWheelRange={900} gyroMode="racing" gyroDeadzone={0}
    gyroHaptic gyroThrottle={false} gyroIdleDetect rumbleOn
    setGyroOn={noop} setGyroMaxAngle={noop} setGyroWheel={noop} setGyroWheelRange={noop} setGyroMode={noop}
    setGyroDeadzone={noop} setGyroHaptic={noop} setGyroThrottle={noop} setGyroIdleDetect={noop} setRumbleOn={noop} />);
`;
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __PLAY__: "false" },
});
const html = `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\/script>")}</script>`;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function open(langs) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((l) => { Object.defineProperty(navigator, "languages", { get: () => l }); }, langs);
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("http://set.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
  await page.goto("http://set.test/");
  await page.waitForSelector('[data-testid="settings-heading"]');
  return page;
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const label = (page, testid) => page.$eval(`[data-testid="${testid}"]`, (b) => document.getElementById(b.getAttribute("aria-labelledby")).textContent);
const hidden = (page, testid) => page.$eval(`[data-testid="${testid}"]`, (b) => !!b.closest('[aria-hidden="true"]'));

try {
  // ── English phone ──
  let page = await open(["en-US", "en"]);
  assert.equal(await text(page, '[data-testid="settings-heading"]'), "Settings");
  assert.equal(await label(page, "tilt-steering-switch"), "Tilt steering");
  assert.ok(await page.$('[data-testid="steering-sensitivity-slider"]'), "steering sensitivity is on the page");
  assert.ok(await page.$('[data-testid="right-stick-sensitivity-slider"]'), "right stick sensitivity is on the page");
  assert.ok(await page.$('[data-testid="game-rumble-switch"]'), "game rumble is on the page");
  // rare settings: under More settings, closed
  assert.equal(await hidden(page, "wheel-mode-switch"), true, "wheel mode starts hidden under More settings");
  assert.equal(await hidden(page, "pause-when-laid-flat-switch"), true);
  await page.click('[data-testid="more-settings"]'); await pause(350);
  assert.equal(await hidden(page, "wheel-mode-switch"), false, "More settings opens");
  assert.equal(await page.$eval('[data-testid="more-settings"]', (b) => b.getAttribute("aria-expanded")), "true");
  assert.match(await text(page, '[data-testid="language-row"]'), /Automatic · English/);

  // ── pick Japanese ──
  await page.click('[data-testid="language-row"]'); await pause(350);
  await page.click('[data-testid="lang-ja-JP"]'); await pause(200);
  assert.equal(await text(page, '[data-testid="settings-heading"]'), "設定", "the screen re-labels at once");
  assert.equal(await label(page, "tilt-steering-switch"), "チルト操作");
  assert.match(await text(page, '[data-testid="language-row"]'), /言語 · Language/, "says Language in English too");
  assert.equal(await page.evaluate(() => localStorage.getItem("gp_language")), "ja-JP", "remembered");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "ja-JP");
  await page.reload(); await page.waitForSelector('[data-testid="settings-heading"]');
  assert.equal(await text(page, '[data-testid="settings-heading"]'), "設定", "still Japanese after a restart");

  // ── back to Automatic (phone = English) ──
  await page.click('[data-testid="language-row"]'); await pause(350);
  await page.click('[data-testid="lang-auto"]'); await pause(200);
  assert.equal(await text(page, '[data-testid="settings-heading"]'), "Settings");
  await page.close();

  // ── a Russian phone opens in Russian by itself ──
  page = await open(["ru-RU"]);
  assert.equal(await text(page, '[data-testid="settings-heading"]'), "Настройки");
  assert.match(await text(page, '[data-testid="language-row"]'), /Автоматически · Русский/);

  // ── phone language mapping ──
  const map = await page.evaluate(() => [
    ["es-MX"], ["es-ES"], ["es"], ["pt-PT"], ["pt-BR"], ["pt"], ["zh-Hant-TW"], ["zh-HK"], ["zh-CN"], ["zh"],
    ["in-ID"], ["ar-SA"], ["ar-SA", "fr-FR"], ["en-IN", "hi-IN"], ["hi-IN"],
  ].map((l) => window.__fromPhone(l)));
  assert.deepEqual(map, ["es-419", "es-ES", "es-419", "pt-PT", "pt-BR", "pt-BR", "zh-TW", "zh-TW", "zh-CN", "zh-CN",
    "id", "en", "fr-FR", "en", "hi-IN"]);   // Arabic is not offered: alone -> English; with French next -> French
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("i18n settings: OK");
} finally {
  await browser.close();
}
