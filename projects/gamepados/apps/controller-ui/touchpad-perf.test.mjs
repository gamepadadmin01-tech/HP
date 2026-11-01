// Run: node touchpad-perf.test.mjs
// Is the touchpad's animation cheap and smooth? The Android engine sends the finger position once per frame.
// This feeds the real <Touchpad> 900 frames of a finger drawing circles (rectangle AND circle pad, both feels)
// through the same function the app uses, and checks:
//   * React never re-renders the pad while it animates (a re-render per frame would cost input latency)
//   * the work per frame is tiny (well under a millisecond)
//   * the pad draws what it should (a finger dot, a glow) and cleans up completely when the finger lifts
//   * no frame throws, and nothing is left running afterwards
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { Touchpad } from "./src/app/components/Touchpad";
import { applyNativePadVisuals } from "./src/app/touchpadVisual";
window.__commits = 0; window.__apply = applyNativePadVisuals;
const q = new URLSearchParams(location.search);
function App() {
  const ref = React.useRef(null);
  return (
    <React.Profiler id="pad" onRender={() => { window.__commits++; }}>
      <svg ref={ref} id="s" viewBox="0 0 1280 570" width="1280" height="570" style={{ background: "#111", display: "block" }}>
        <Touchpad id="tp1" x={640} y={285} w={400} h={240} round={q.get("round") === "1"} svgRef={ref}
          feel={q.get("feel") || undefined} onStick={() => {}} />
      </svg>
    </React.Profiler>
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
  const results = [];
  for (const query of ["", "round=1", "feel=distance", "round=1&feel=distance"]) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 570 });
    await page.setRequestInterception(true);
    page.on("request", (r) => r.url().startsWith("http://perf.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
    await page.goto("http://perf.test/?" + query);
    await page.waitForSelector("svg#s");
    const r = await page.evaluate(async () => {
      const commitsBefore = window.__commits;
      const costs = [];
      let dotMoves = 0, last = "";
      const svg = document.getElementById("s");
      const dot = svg.querySelector("circle[r='58']").parentElement.parentElement;
      for (let i = 0; i < 900; i++) {
        // a finger drawing a circle of radius 70 around the middle, with the stick following it
        const a = i / 18, fx = 640 + Math.cos(a) * 70, fy = 285 + Math.sin(a) * 70;
        const dx = Math.cos(a + 1.57) * 40, dy = Math.sin(a + 1.57) * 40;
        const t0 = performance.now();
        window.__apply([["tp1", fx, fy, dx, dy]]);
        costs.push(performance.now() - t0);
        const tr = dot.style.transform; if (tr !== last) { dotMoves++; last = tr; }
        await new Promise((res) => requestAnimationFrame(res));
      }
      const live = svg.querySelector("g[style*='transition: opacity'][style*='opacity: 1']") !== null || [...svg.querySelectorAll("g")].some((g) => g.style.opacity === "1" && g.querySelector("circle[r='58']"));
      window.__apply([]);                                   // the engine says: no active pad any more
      await new Promise((res) => setTimeout(res, 400));
      const idleOpacity = [...svg.querySelectorAll("g")].filter((g) => g.querySelector("circle[r='58']") && g.style.pointerEvents === "none").map((g) => g.style.opacity);
      const grid = svg.querySelector('[data-tp="grid"]').style.opacity;
      costs.sort((x, y) => x - y);
      return {
        commits: window.__commits - commitsBefore, dotMoves, live, idleOpacity, grid,
        avg: costs.reduce((s, v) => s + v, 0) / costs.length, p99: costs[Math.floor(costs.length * 0.99)], max: costs[costs.length - 1],
      };
    });
    results.push(`${(query || "rectangle, speed").padEnd(22)} avg ${r.avg.toFixed(3)} ms   p99 ${r.p99.toFixed(3)} ms   worst ${r.max.toFixed(2)} ms   React redraws ${r.commits}`);
    assert.equal(r.commits, 0, `React must not redraw the pad while it animates (${query || "default"})`);
    assert.ok(r.avg < 0.5, `work per frame is tiny (avg ${r.avg.toFixed(3)} ms)`);
    assert.ok(r.p99 < 3, `even the slow frames stay cheap (p99 ${r.p99.toFixed(3)} ms)`);
    assert.ok(r.dotMoves > 850, `the finger dot moved on nearly every frame (${r.dotMoves}/900)`);
    assert.ok(r.live, "the live layer was visible while the finger was down");
    assert.ok(r.idleOpacity.every((o) => o === "0"), "everything fades out when the finger lifts");
    assert.equal(r.grid, "0", "the dot grid is gone again");
    await page.close();
  }
  assert.deepEqual(errors, [], "no frame threw");
  console.log("  " + results.join("\n  "));
  console.log("touchpad-perf.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
