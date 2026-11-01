// Run: node overlay-motion.test.mjs
// Measures how a pop-up built from the app's shared motion rules (src/app/motion.ts) really opens and
// closes in a browser, frame by frame: smooth in, no bounce, quicker out, and truly gone afterwards.
// Covers the three shapes the app uses: a dimmed backdrop + card, a bottom sheet, and a toast.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { SPRING, SPRING_SNAP, FADE, cardIn, backdropIn, sheetIn, toastIn } from "./src/app/motion";
function App() {
  const [card, setCard] = useState(false), [sheet, setSheet] = useState(false), [toast, setToast] = useState(false);
  window.__set = (k, v) => ({ card: setCard, sheet: setSheet, toast: setToast })[k](v);
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <AnimatePresence>{card && (
        <motion.div id="scrim" key="s" {...backdropIn} transition={FADE} style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <motion.div id="card" {...cardIn} transition={SPRING} style={{ width: 300, height: 160, background: "#223" }} />
        </motion.div>)}
      </AnimatePresence>
      <AnimatePresence>{sheet && (
        <motion.div id="sheet" key="sh" {...sheetIn} transition={SPRING} style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 240, background: "#334" }} />)}
      </AnimatePresence>
      <AnimatePresence>{toast && (
        <motion.div id="toast" key="t" {...toastIn} transition={SPRING_SNAP} style={{ position: "fixed", top: 20, left: 20, width: 200, height: 40, background: "#432" }} />)}
      </AnimatePresence>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
`;
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 420, height: 800 });
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("http://t.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
  await page.goto("http://t.test/");
  await page.waitForSelector("#root div");

  // Sample one property of one element every frame for `ms`, flipping `key` to `value` at t=0.
  const run = (key, value, sel, prop, ms) => page.evaluate(async (key, value, sel, prop, ms) => {
    const samples = [];
    window.__set(key, value);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = performance.now() - t0;
        const el = document.querySelector(sel);
        let v = null;
        if (el) {
          const cs = getComputedStyle(el);
          if (prop === "opacity") v = parseFloat(cs.opacity);
          else {
            const m = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform);
            v = prop === "scale" ? m.a : prop === "y" ? m.m42 : 0;
          }
        }
        samples.push([t, v]);
        t < ms ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
    return samples;
  }, key, value, sel, prop, ms);
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxGap = (s) => s.slice(1).reduce((m, x, i) => Math.max(m, x[0] - s[i][0]), 0);
  const firstTime = (s, f) => { const x = s.find(([, v]) => v !== null && f(v)); return x ? x[0] : null; };
  const goneAt = (s) => { const x = s.find(([, v]) => v === null); return x ? x[0] : null; };

  // ── backdrop + card ───────────────────────────────────────────────────────
  let sc = await run("card", true, "#scrim", "opacity", 700);
  let cd = await run("card", false, "#card", "scale", 1);          // (already open: just a probe)
  await settle(50);
  // fresh open, measured on the card (scale) and the scrim (opacity)
  await run("card", false, "#scrim", "opacity", 600);              // close first so we can re-measure the open cleanly
  const openScrim = await run("card", true, "#scrim", "opacity", 600);
  await settle(300); await run("card", false, "#scrim", "opacity", 600);
  const openCard = await run("card", true, "#card", "scale", 700);
  const scrimIn = firstTime(openScrim, (v) => v >= 0.99);
  assert.ok(scrimIn !== null && scrimIn < 300, `the backdrop is fully in within 300 ms (took ${scrimIn})`);
  const peak = Math.max(...openCard.map(([, v]) => v ?? 0));
  assert.ok(peak <= 1.02, `the card settles without a bounce (peak scale ${peak.toFixed(3)})`);
  const cardIn_ = firstTime(openCard, (v) => v >= 0.995);
  assert.ok(cardIn_ !== null && cardIn_ < 450, `the card is in within 450 ms (took ${cardIn_})`);
  assert.ok(maxGap(openCard) < 60, `no stalled frames while opening (worst gap ${maxGap(openCard).toFixed(0)} ms)`);

  const closeScrim = await run("card", false, "#scrim", "opacity", 700);
  const gone = goneAt(closeScrim);
  assert.ok(closeScrim[2][1] !== null, "the pop-up is still on screen during the first frames of closing (it animates out, it does not vanish)");
  assert.ok(gone !== null && gone <= 330, `the pop-up is fully gone by 330 ms (gone at ${gone})`);
  const faded = firstTime(closeScrim, (v) => v <= 0.02);
  assert.ok(faded !== null && faded <= 260, `closing fades out within 260 ms (took ${faded})`);
  assert.ok(faded < scrimIn + 60, "leaving is not slower than arriving");

  // ── bottom sheet ─────────────────────────────────────────────────────────
  await settle(200);
  const sheetOpen = await run("sheet", true, "#sheet", "y", 700);
  const ys = sheetOpen.map(([, v]) => v).filter((v) => v !== null);
  assert.ok(ys[0] > 150, `the sheet starts below the edge (y ${ys[0]})`);
  assert.ok(Math.abs(ys[ys.length - 1]) < 0.6, `the sheet ends exactly in place (y ${ys[ys.length - 1]})`);
  assert.ok(Math.min(...ys) > -3, "the sheet never overshoots past its resting place");
  const sheetClose = await run("sheet", false, "#sheet", "y", 700);
  const sheetGone = goneAt(sheetClose);
  assert.ok(sheetClose[2][1] !== null && sheetGone !== null && sheetGone <= 360, `the sheet slides down and is gone by 360 ms (gone at ${sheetGone})`);
  assert.ok(Math.max(...sheetClose.map(([, v]) => v ?? 0)) > 60, "the sheet really travels down on the way out");

  // ── toast ────────────────────────────────────────────────────────────────
  await settle(200);
  const toastOpen = await run("toast", true, "#toast", "opacity", 500);
  assert.ok(firstTime(toastOpen, (v) => v >= 0.99) < 300, "the toast is in quickly");
  const toastClose = await run("toast", false, "#toast", "opacity", 500);
  assert.ok(goneAt(toastClose) !== null && goneAt(toastClose) <= 300, "the toast is gone quickly");

  assert.deepEqual(errors, [], "no page errors");
  console.log("overlay-motion.test.mjs — all assertions passed");
  console.log(`  backdrop in ${scrimIn.toFixed(0)} ms, card in ${cardIn_.toFixed(0)} ms (peak scale ${peak.toFixed(3)}), closing gone at ${gone.toFixed(0)} ms, sheet out at ${sheetGone.toFixed(0)} ms`);
} finally {
  await browser.close();
}
