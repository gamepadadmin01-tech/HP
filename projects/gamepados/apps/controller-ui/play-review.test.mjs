// Run: node play-review.test.mjs
// "Rate us on Google Play" (owner, 2026-11-15). When it is time to ask for a rating (recordSessionEnd said yes):
//   * the Google Play build asks GOOGLE for its in-app rating card and does NOT open our own star popup;
//   * a Play build whose phone side has no rating card (older native code) falls back to our popup;
//   * every other build (website, Uptodown, the stores) shows our popup and never asks Google, even if a
//     bridge method of that name existed.
// The REAL askForRating from FeatureIntroOverlay, bundled twice (Play and non-Play) and run in headless Chrome.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import { askForRating } from "./src/app/FeatureIntroOverlay";
window.run = () => {
  let own = 0;
  const used = askForRating(() => { own++; });
  return { used, own, asked: window.__asked || 0 };
};
`;
async function bundle(play) {
  const out = await build({
    stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', __PLAY__: play ? "true" : "false" },
  });
  return `<!doctype html><meta charset="utf-8"><body><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;
}
const htmlPlay = await bundle(true), htmlWeb = await bundle(false);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function run({ play, channel, hasReview }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(play ? htmlPlay : htmlWeb);
  // The fake phone side. askForRating looks the bridge up when it runs, so setting it now is enough.
  await page.evaluate((channel, hasReview) => {
    const bridge = { getDistributionChannel: () => channel, getAppVersionName: () => "1.4.18", getAppVersionCode: () => 72 };
    if (hasReview) bridge.requestPlayReview = () => { window.__asked = (window.__asked || 0) + 1; };
    window.AndroidBridge = bridge;
  }, channel, hasReview);
  const r = await page.evaluate(() => window.run());
  await page.close();
  return r;
}

try {
  {
    const r = await run({ play: true, channel: "playstore", hasReview: true });
    assert.deepEqual(r, { used: "play", own: 0, asked: 1 }, "Play build: Google's card is asked for, and our popup stays closed");
  }
  {
    const r = await run({ play: true, channel: "playstore", hasReview: false });
    assert.deepEqual(r, { used: "own", own: 1, asked: 0 }, "Play build without the card on the phone side: our popup instead");
  }
  for (const channel of ["direct", "uptodown", "aptoide", "amazonstore"]) {
    const r = await run({ play: false, channel, hasReview: true });
    assert.deepEqual(r, { used: "own", own: 1, asked: 0 }, `${channel}: our popup, Google is never asked`);
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("play-review.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
