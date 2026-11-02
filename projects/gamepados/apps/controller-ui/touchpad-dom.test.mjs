// Run: node touchpad-dom.test.mjs
// Renders the real <Touchpad> in headless Chrome, drives it with a real mouse (which Chrome turns
// into pointer events) and checks BOTH what it pushes on the right stick AND what it draws.
// Also feeds it the same messages the Android engine sends, to check the native animation path.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { Touchpad } from "./src/app/components/Touchpad";
import { applyNativePadVisuals } from "./src/app/touchpadVisual";
const log = []; window.__log = log; window.__apply = applyNativePadVisuals;
const q = new URLSearchParams(location.search);
function App() {
  const ref = React.useRef(null);
  return (
    <svg ref={ref} id="s" viewBox="0 0 1280 570" width="1280" height="570" style={{ background: "#111", display: "block" }}>
      <Touchpad id="tp1" x={640} y={285} w={400} h={240} svgRef={ref} round={q.get("round") === "1"} label={q.get("label") || undefined}
        feel={q.get("feel") || undefined} release={q.get("release") || undefined} sens={q.get("sens") ? +q.get("sens") : undefined}
        onStick={(id, x, y) => log.push([x, y])} onPress={() => log.push("press")}
        onRelease={() => log.push("release")} onEdge={() => log.push("edge")} />
    </svg>
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fresh(query = "") {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewport({ width: 1280, height: 570 });
  // serve the page from an http-like origin so query strings work
  await page.setRequestInterception(true);
  page.on("request", (r) => r.url().startsWith("http://pad.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort());
  await page.goto("http://pad.test/?" + query);
  await page.waitForSelector("svg#s");
  return page;
}
const state = (page) => page.evaluate(() => {
  const svg = document.getElementById("s");
  const act = svg.querySelector("g[style*='transition: opacity']");
  const groups = [...svg.querySelectorAll("g")];
  const active = groups.find((g) => g.style.opacity !== "" && g.style.pointerEvents === "none" && g.querySelector("circle[r='46']"));
  const lines = svg.querySelectorAll("line").length;           // straight streaks: there must be none
  const trailPath = svg.querySelector("path[stroke-linecap='round']");
  const text = [...svg.querySelectorAll("text")].map((t) => t.textContent).join("|");
  const surface = [...svg.querySelectorAll("rect,ellipse")].find((e) => e.getAttribute("fill") === "transparent");
  const sb = surface ? surface.getBoundingClientRect() : null;
  const dot = svg.querySelector("circle[r='46']")?.parentElement?.parentElement;
  const last = window.__log.filter(Array.isArray).slice(-1)[0] || null;
  return {
    activeOpacity: active ? active.style.opacity : null,
    lines, hasGrid: !!svg.querySelector("pattern, [data-tp='grid']"),
    trailD: trailPath ? trailPath.getAttribute("d") : null, trailOpacity: trailPath ? trailPath.style.opacity : null,
    text,
    hasJoystickDrawing: !!svg.querySelector(".gp-tp-breath, .gp-tp-nl, .gp-tp-nr, .gp-tp-nu, .gp-tp-nd"),
    surfaceTag: surface ? surface.tagName : null,
    surfaceBox: sb ? { l: sb.left, t: sb.top, w: sb.width, h: sb.height } : null,
    dotTransform: dot ? dot.style.transform : null,
    last, count: window.__log.filter(Array.isArray).length, events: window.__log.filter((x) => typeof x === "string"),
  };
});
async function swipe(page, x0, y0, dx, dy, steps, gap = 16) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + dx * i, y0 + dy * i); await sleep(gap); }
}

try {
  // ── idle: the hint is showing, nothing live is drawn
  {
    const p = await fresh();
    const s = await state(p);
    assert.equal(s.activeOpacity, "0", "idle: the live layer is hidden");
    assert.equal(s.hasGrid, false, "no dot grid on the pad at all, the surface is clean");
    assert.equal(s.lines, 0, "no straight lines anywhere on the pad");
    assert.equal(s.hasJoystickDrawing, false, "idle: no joystick drawing (ring or arrows) on the pad");
    assert.equal(s.text, "", "idle: no words on the pad unless the player typed a name");
    await p.close();
  }

  // ── speed feel (the recommended default): a fast swipe right pushes the stick right, a stop lets it go home
  {
    const p = await fresh();
    await swipe(p, 560, 285, 22, 0, 12);
    let s = await state(p);
    assert.ok(s.last && s.last[0] > 30, `fast swipe right pushes the stick right (got ${s.last && s.last[0]})`);
    assert.ok(Math.abs(s.last[1]) < 6, "a straight swipe has no sideways push");
    assert.equal(s.activeOpacity, "1", "touching shows the live layer");
    assert.ok(/translate\(/.test(s.dotTransform) && !/translate\(640px, 285px\)/.test(s.dotTransform), "the finger dot follows the finger");
    assert.equal(s.hasGrid, false, "touching never brings a background grid back");
    assert.equal(s.lines, 0, "and never draws a straight streak out of the finger");
    assert.ok(s.trailD && s.trailD.startsWith("M") && s.trailD.includes("L"), "the trail is a path made of where the finger really went");
    assert.ok(s.events.includes("press"), "the press haptic fired once on landing");
    await sleep(450);                                             // finger rests, still down
    s = await state(p);
    assert.ok(Math.abs(s.last[0]) < 4, `a resting finger lets the stick go home by itself (got ${s.last[0]})`);
    await p.mouse.up();
    await sleep(100);
    s = await state(p);
    assert.deepEqual(s.last, [0, 0], "lifting leaves the stick at centre");
    assert.ok(s.events.includes("release"), "the release haptic fired");
    await sleep(350);
    s = await state(p);
    assert.equal(s.activeOpacity, "0", "everything fades out after the lift");
    await p.close();
  }

  // ── a name the player typed is shown, quietly
  {
    const p = await fresh("label=CAMERA");
    const s = await state(p);
    assert.equal(s.text, "CAMERA", "a typed name is shown");
    await p.close();
  }

  // ── a circle pad: round outline, and touches in the corners of its box do nothing
  {
    const p = await fresh("round=1");
    const s0 = await state(p);
    assert.equal(s0.surfaceTag, "ellipse", "the touch surface is an ellipse");
    assert.equal(s0.hasJoystickDrawing, false);
    // the top-left corner of the pad's box is outside the circle
    await swipe(p, 452, 177, 22, 0, 12);
    let s = await state(p);
    assert.equal(s.count, 0, "touching the corner of a circle pad pushes nothing");
    await p.mouse.up();
    await sleep(60);
    // the middle works like any pad
    await swipe(p, 560, 285, 22, 0, 12);
    s = await state(p);
    assert.ok(s.last && s.last[0] > 30, `a swipe inside the circle pushes the stick (got ${s.last && s.last[0]})`);
    await p.mouse.up();
    await p.close();
  }

  // ── a rectangle pad takes touches in its corners
  {
    const p = await fresh();
    const s0 = await state(p);
    assert.equal(s0.surfaceTag, "rect", "the default touch surface is a rectangle");
    await swipe(p, 452, 177, 22, 0, 12);
    const s = await state(p);
    assert.ok(s.last && s.last[0] > 30, "a swipe in the corner of a rectangle pad works");
    await p.mouse.up();
    await p.close();
  }

  // ── distance feel + glide: pushed by distance, holds while resting, eases home after lifting
  {
    const p = await fresh("feel=distance&release=glide");
    await p.mouse.move(600, 285); await p.mouse.down();
    await p.mouse.move(645, 285); await sleep(60); await p.mouse.move(645, 285);
    await sleep(250);
    let s = await state(p);
    assert.ok(s.last[0] > 25 && s.last[0] < 35, `45 units of drag is about half a push (got ${s.last[0]})`);
    await p.mouse.up();
    await sleep(40);
    s = await state(p);
    assert.ok(s.last[0] > 0 && s.last[0] < 30, `glide: the stick eases down rather than snapping (got ${s.last[0]})`);
    await sleep(900);
    s = await state(p);
    assert.deepEqual(s.last, [0, 0], "glide ends exactly at centre");
    await p.close();
  }

  // ── sensitivity: higher pushes harder for the same swipe
  {
    const lo = await fresh("sens=0.5"); await swipe(lo, 560, 285, 10, 0, 10); const a = (await state(lo)).last[0]; await lo.mouse.up(); await lo.close();
    const hi = await fresh("sens=2.5"); await swipe(hi, 560, 285, 10, 0, 10); const b = (await state(hi)).last[0]; await hi.mouse.up(); await hi.close();
    assert.ok(b > a, `higher sensitivity pushes harder (${a} vs ${b})`);
  }

  // ── native feed: the Android engine sends finger positions; the page only draws them
  {
    const p = await fresh();
    await p.evaluate(() => window.__apply([["tp1", 700, 300, 30, 0]]));
    let s = await state(p);
    assert.equal(s.activeOpacity, "1", "native feed: the live layer shows");
    assert.ok(/700px, 300px/.test(s.dotTransform), `native feed: the dot is at the finger (${s.dotTransform})`);
    await p.evaluate(() => window.__apply([["tp1", 710, 300, 45, 0]]));
    s = await state(p);
    const at = (t) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(t); return m ? { x: +m[1], y: +m[2] } : null; };
    let d = at(s.dotTransform);
    assert.ok(d.x >= 710 && d.x <= 710 + 34, `native feed: while moving right the dot is a little AHEAD of the reported finger, to cancel the report delay (${d.x})`);
    assert.equal(d.y, 300, "and never drifts sideways");
    // a finger that stops sends no more frames: the dot must settle exactly onto it by itself
    await sleep(260);
    s = await state(p);
    d = at(s.dotTransform);
    assert.equal(d.x, 710, `native feed: once the finger rests the dot sits exactly on it (${d.x})`);
    // the pad's own edge is a wall: a fast finger near it never pulls the dot outside the pad
    await p.evaluate(() => { window.__apply([["tp1", 1100, 300, 30, 0]]); window.__apply([["tp1", 1270, 300, 60, 0]]); });
    s = await state(p);
    d = at(s.dotTransform);
    const box = s.surfaceBox;
    assert.ok(d.x <= box.l + box.w + 0.5, `the look-ahead never pushes the dot off the pad (${d.x} vs right edge ${box.l + box.w})`);
    assert.ok(d.x >= box.l - 0.5, "and never off its left edge either");
    await p.evaluate(() => window.__apply([]));
    await sleep(350);
    s = await state(p);
    assert.equal(s.activeOpacity, "0", "native feed: an empty list sends the pad idle");
    await p.evaluate(() => window.__apply(undefined));          // an old message with no pad list must be harmless
    assert.equal(s.count, 0, "the native feed pushed nothing onto the stick (the engine does that itself)");
    await p.close();
  }

  assert.deepEqual(errors, [], "no console or page errors");
  console.log("touchpad-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
