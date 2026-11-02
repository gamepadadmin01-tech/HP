// Run: node rating-prompt-dom.test.mjs
// The rating prompt (owner, 2026-11-02): it must never ask when the controller opens or right after the app
// threw the player out for running out of play time, only after a real session the player closed
// themselves, rarely, and a rating below 4 stars must come with a written reason (no Skip).
// Runs the REAL FeatureIntroOverlay in headless Chrome.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import * as P from "./src/app/FeatureIntroOverlay";
window.P = P;
function App() {
  const [open, setOpen] = React.useState(true);
  return <P.FeatureIntroOverlay open={open} onClose={() => { window.__closed = true; setOpen(false); }}
    onRated={() => { window.__rated = true; setOpen(false); }} now={() => 1700000000000} />;
}
createRoot(document.getElementById("root")).render(<App />);
`;
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __PLAY__: "false" },
});
const html = `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function fresh() {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });   // every page starts with empty storage
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("http://rate.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
  await page.goto("http://rate.test/");
  await page.waitForSelector('[role="dialog"]');
  return page;
}
const click = (page, text) => page.evaluate((text) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().includes(text) || x.getAttribute("aria-label") === text); if (!b) throw new Error("no button " + text); b.click(); }, text);
const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => ({ text: b.textContent.trim(), label: b.getAttribute("aria-label"), disabled: b.disabled })));
const queue = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("pending_feedback_v1") || "[]"));
const type = async (page, text) => { await page.focus("textarea"); await page.keyboard.type(text); };

try {
  // ───────────────────────────── the pacing rules ─────────────────────────────
  {
    const page = await fresh();
    const r = await page.evaluate(() => {
      const P = window.P, MIN = 60000, DAY = 86400000, T0 = 1_700_000_000_000;
      localStorage.clear();
      // one session: open, play `mins`, close. forced = the app threw the player out (out of play time).
      let clock = T0;
      const session = (mins, forced = false) => { P.noteControllerOpened(clock); if (forced) P.suppressIntroOnce(); clock += mins * MIN; const asked = P.recordSessionEnd(clock); clock += 60 * 1000; return asked; };
      const res = {};
      res.constants = [P.FIRST_SHOW_AT, P.REPEAT_INTERVAL, P.MAX_ASKS, P.MIN_SESSION_MS / MIN, P.MIN_GAP_MS / DAY, P.COMMENT_REQUIRED_BELOW, P.MIN_NOTE_CHARS];
      // opening alone never asks (there is no way to even ask on open: noteControllerOpened returns nothing)
      res.openReturns = P.noteControllerOpened(clock);
      // short sessions never count
      res.shortSessions = Array.from({ length: 12 }, () => session(2)).some(Boolean);
      // forced exits (out of time) never count, however long
      res.forcedSessions = Array.from({ length: 12 }, () => session(40, true)).some(Boolean);
      // a close with no open (should not happen) never counts
      res.closeWithoutOpen = P.recordSessionEnd(clock);
      // real sessions: asks on the 5th, not before
      const first = Array.from({ length: 5 }, () => session(20));
      res.firstFive = first;
      // right after an ask: nothing for a long while (needs 15 more sessions AND 3 days)
      res.nextFourteenSameDay = Array.from({ length: 14 }, () => session(20)).some(Boolean);
      res.sixteenthButTooSoon = session(20);                        // 15 more sessions done, but under 3 days since the ask
      clock += 4 * DAY;
      res.afterThreeDays = session(20);                              // enough sessions and enough days: ask #2
      // third ask
      for (let i = 0; i < 15; i++) session(20);
      clock += 4 * DAY;
      res.third = session(20);
      // never a fourth
      for (let i = 0; i < 40; i++) session(20);
      clock += 30 * DAY;
      res.fourth = session(20);
      res.asksSaved = localStorage.getItem("intro2_asks");
      // someone who rated is never asked again
      localStorage.setItem("feature_rated_v2", "1");
      res.afterRating = session(20);
      return res;
    });
    assert.deepEqual(r.constants, [5, 15, 3, 5, 3, 4, 5], "the pacing numbers are the agreed ones");
    assert.equal(r.openReturns, undefined, "opening the controller cannot trigger the prompt");
    assert.equal(r.shortSessions, false, "a session under 5 minutes never counts");
    assert.equal(r.forcedSessions, false, "being thrown out for running out of play time never asks");
    assert.equal(r.closeWithoutOpen, false);
    assert.deepEqual(r.firstFive, [false, false, false, false, true], "the first ask comes on the 5th real session");
    assert.equal(r.nextFourteenSameDay, false, "no re-ask in the next 14 sessions");
    assert.equal(r.sixteenthButTooSoon, false, "15 more sessions are not enough without 3 days between asks");
    assert.equal(r.afterThreeDays, true, "15 sessions AND 3 days later: the second ask");
    assert.equal(r.third, true, "a third ask is the last");
    assert.equal(r.fourth, false, "never more than 3 asks, however long the player plays");
    assert.equal(r.asksSaved, "3");
    assert.equal(r.afterRating, false, "someone who rated is never asked again");
    await page.close();
  }

  // ───────────────────────── 1 to 3 stars: a reason is required ─────────────────────────
  {
    const page = await fresh();
    await click(page, "2 stars");
    await click(page, "Submit");
    await page.waitForSelector("textarea");
    let b = await buttons(page);
    assert.ok(!b.some((x) => /skip/i.test(x.text)), "there is no Skip button any more");
    let send = b.find((x) => /send/i.test(x.text));
    assert.ok(send && send.disabled, "Send is switched off until a reason is written");
    assert.match(await page.evaluate(() => document.body.innerText), /at least 5 characters/, "it says why");
    await type(page, "ab");
    send = (await buttons(page)).find((x) => /send/i.test(x.text));
    assert.ok(send.disabled, "two characters are not a reason");
    await type(page, "   ");
    send = (await buttons(page)).find((x) => /send/i.test(x.text));
    assert.ok(send.disabled, "spaces are not a reason");
    assert.deepEqual(await queue(page), [], "nothing is sent yet");
    await type(page, "lag");
    send = (await buttons(page)).find((x) => /send/i.test(x.text));
    assert.ok(!send.disabled, "five real characters switch Send on");
    await click(page, "Send");
    await page.waitForFunction(() => /message sent/.test(document.body.innerText));
    const q = await queue(page);
    assert.equal(q.length, 1);
    assert.deepEqual([q[0].stars, q[0].note], [2, "ab   lag"], "the rating goes out together with the reason");
    await page.close();
  }

  // ───────────────────────── 1 star, then closing without a reason sends nothing ─────────────────────────
  {
    const page = await fresh();
    await click(page, "1 star");
    await click(page, "Submit");
    await page.waitForSelector("textarea");
    await click(page, "Close");
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(await queue(page), [], "closing the prompt without a reason sends no bare star");
    assert.equal(await page.evaluate(() => window.__closed === true), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("feature_rated_v2")), null, "and it does not count as rated");
    await page.close();
  }

  // ───────────────────────── 4 and 5 stars stay one tap ─────────────────────────
  for (const stars of [4, 5]) {
    const page = await fresh();
    await click(page, `${stars} stars`);
    await click(page, "Submit");
    await page.waitForFunction(() => /Thanks for the rating/.test(document.body.innerText));
    assert.equal(await page.evaluate(() => !!document.querySelector("textarea")), false, `${stars} stars: no form to fill`);
    const q = await queue(page);
    assert.deepEqual([q.length, q[0].stars], [1, stars]);
    await page.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("rating-prompt-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
