// Run: node rightGain-dom.test.mjs
// The REAL settings screen in headless Chrome: the "Right stick sensitivity" slider and its presets
// change the shared stick setting (what the packet builder and the native engine read), remember it,
// and tell the native engine. Also checks the other sliders still read in degrees.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { CalmSettings } from "./src/app/components/CalmSettings";
import { stickFeel, installStickFeelToggle } from "./src/app/stickFeel";
window.__changes = 0; window.__stickFeel = stickFeel;
installStickFeelToggle(() => { window.__changes++; });
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
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("http://set.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
  await page.goto("http://set.test/");
  const SL = '[data-testid="right-stick-sensitivity-slider"]';
  await page.waitForSelector(SL);

  const read = () => page.evaluate((SL) => {
    const el = document.querySelector(SL);
    const group = [...document.querySelectorAll('[aria-label="Right stick sensitivity presets"] button')];
    return {
      value: el.value, min: el.min, max: el.max, step: el.step, valuetext: el.getAttribute("aria-valuetext"),
      shown: el.closest(".calm-range").querySelector("output").textContent,
      gain: window.__stickFeel.rightGain, saved: localStorage.getItem("gp_right_gain"), changes: window.__changes,
      pressed: group.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent),
      steering: document.querySelector('[data-testid="steering-sensitivity-slider"]')?.closest(".calm-range").querySelector("output").textContent,
    };
  }, SL);
  const slide = (v) => page.evaluate((SL, v) => {
    const el = document.querySelector(SL);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, SL, v);

  let s = await read();
  assert.deepEqual([s.value, s.min, s.max, s.step, s.shown], ["100", "20", "200", "5", "100%"], "starts at 100%, from 20% to 200%");
  assert.equal(s.gain, 1, "nothing changes for a player who never opens it");
  assert.equal(s.saved, null, "and nothing is saved until they move it");
  assert.deepEqual(s.pressed, ["Normal 100%"]);
  assert.equal(s.steering, "30°", "the other sliders still read in degrees");

  await slide(50);
  s = await read();
  assert.equal(s.shown, "50%");
  assert.equal(s.valuetext, "50%");
  assert.equal(s.gain, 0.5, "the packet builder's setting follows the slider");
  assert.equal(s.saved, "0.5", "and it is remembered");
  assert.equal(s.changes, 1, "the native engine is told");
  assert.deepEqual(s.pressed, ["50%"], "the matching preset lights up");

  await slide(65);
  s = await read();
  assert.deepEqual([s.gain, s.pressed.length], [0.65, 0], "an in-between value lights no preset");

  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Right stick sensitivity presets"] button')].find((b) => b.textContent === "Normal 100%").click());
  s = await read();
  assert.deepEqual([s.value, s.gain, s.saved, s.pressed], ["100", 1, "1", ["Normal 100%"]], "Normal puts everything back");

  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Right stick sensitivity presets"] button')].find((b) => b.textContent === "150%").click());
  s = await read();
  assert.deepEqual([s.gain, s.shown], [1.5, "150%"]);
  assert.deepEqual(errors, [], "no page errors");
  console.log("rightGain-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
