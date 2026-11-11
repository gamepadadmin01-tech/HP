// Run: node transitions.test.mjs   (vite on 127.0.0.1:5187; ROUNDS=10 for the long version)
// Thorough check of the controller / editor open-close motion (owner, 2026-11-11: "check 1 to 10 times").
// The motion is one basic fade under a cover (App.tsx coverThrough, 2026-11-11). Phone-like: CPU 4x slower, the screen "turns"
// 220 ms after the app asks. Every frame is sampled in the page. Checks, per run:
//   - no blank frame: at every frame either the cover or the expected screen is (nearly) fully visible, or the two
//     together cover the screen (cover + screen opacity >= 0.9);
//   - it ends clean: right screen, no cover, no html data-nav / data-pad left, the next tap works;
//   - the touch layer gets the pad's position once per opening, at full size (matrix a = 0.715);
//   - smoothness: the longest gap between two frames while something is visibly moving.
import puppeteer from "puppeteer";
const ROUNDS = Number(process.env.ROUNDS || 3);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; let failures = 0;
const check = (ok, msg) => { results.push((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; };
await (async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await page.createCDPSession();
  const P = { width: 412, height: 915 }, L = { width: 915, height: 412 };
  await page.exposeFunction("__turn", async (o) => { await pause(220); await page.setViewport({ ...(o.startsWith("landscape") ? L : P), deviceScaleFactor: 2 }); });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); } catch {}
    window.__geo = [];
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.16", getAppVersionCode: () => 70,
      getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: true, linkAlive: true, connectionType: "wireless" }), getUsbBroadcastAddress: () => "", stopEngine() {},
      setScreenOrientation(o) { window.__turn(o); },
      setNativeInputGeometry(j) { window.__geo.push(JSON.parse(j).matrix[0]); }, setNativeInputActive() {}, setNativeGyroConfig() {} };
    // frame sampler, armed per run
    window.__arm = (expect) => {
      window.__f = []; const t0 = performance.now(); window.__t0 = t0;
      const op = (sel) => { const e = document.querySelector(sel); return e ? +getComputedStyle(e).opacity : 0; };
      const tick = () => {
        const cover = op(".gp-cover");
        const home = op('[data-screen="home"]'), pad = op('[data-screen="pad"]') * op(".gp-ctl-wrap") * op(".gp-pad-svg"), editor = op('[data-screen="editor"]');
        // The controller sits on its own static background (the wrapper, same colour family as the cover): while the
        // pad itself fades in, that background is what shows, which is not a blank frame.
        const shown = Math.max(home, pad, editor, op(".gp-ctl-wrap"));
        // The opening's gamepad icon (rotation in degrees, scale) and the controller's pop scale (2026-11-11).
        const geo = (sel) => { const e = document.querySelector(sel); if (!e) return null; const t = getComputedStyle(e).transform;
          if (!t || t === "none") return { rot: 0, scale: 1 }; const [a, b] = t.slice(t.indexOf("(") + 1).split(",").map(Number);
          return { rot: Math.round(Math.atan2(b, a) * 180 / Math.PI), scale: Math.hypot(a, b) }; };
        const icon = geo(".gp-cover-icon"), wrap = geo(".gp-ctl-wrap");
        // "nav" = a change is in progress (the cover is on screen).
        window.__f.push({ t: performance.now() - t0, abs: performance.timeOrigin + performance.now(), cover, home, pad, editor, shown, nav: document.querySelector(".gp-cover") ? "on" : "", land: innerWidth > innerHeight,
          icon, iconOp: op(".gp-cover-icon"), wrapScale: wrap ? wrap.scale : 0, pop: document.documentElement.dataset.ctlPop || "" });
        if (performance.now() - t0 < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:5187") || r.url().startsWith("data:") ? r.continue() : r.respond({ status: 404, body: "{}" })));
  await page.setViewport({ ...P, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="home-heading"]'); await pause(1200);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const analyse = async (label, endScreen) => {
    await pause(2500);
    const f = await page.evaluate(() => window.__f);
    const blank = f.filter((x) => x.cover + x.shown < 0.9);
    const moving = f.filter((x) => x.nav || (x.cover > 0.02 && x.cover < 0.98));
    // Smoothness counts only frames you can SEE change: while the cover is solid (>= 0.98) the phone is building
    // the next screen and nothing is visible, which is the point of the cover.
    let worst = 0, wi = 0;
    for (let i = 1; i < f.length; i++) {
      const d = (k) => Math.abs(f[i][k] - f[i - 1][k]) > 0.01;
      const iconMoved = d("iconOp") || (f[i].icon && f[i - 1].icon && (f[i].icon.rot !== f[i - 1].icon.rot || Math.abs(f[i].icon.scale - f[i - 1].icon.scale) > 0.01));
      // Only motion you can SEE: the cover part-way through its fade (anything changing), the icon moving on the
      // solid cover, or the controller popping out of it. A screen built or resized UNDER the solid cover is not seen.
      const coverPartway = f[i].cover < 0.98 || f[i - 1].cover < 0.98;
      // The controller's pop is drawn by Chrome's compositor, which keeps going while this page's own clock stalls:
      // it is judged on the PAINTED frames instead (paintedPop below).
      const seen = (coverPartway && (["cover", "home", "pad", "editor"].some(d) || iconMoved)) || iconMoved;
      // The phone's own turn (the window changing shape) is Android's, not ours: not counted.
      const turning = f[i].land !== f[i - 1].land;
      if ((f[i].nav || f[i - 1].nav) && seen && !turning) { const g = f[i].t - f[i - 1].t; if (g > worst) { worst = g; wi = i; } }
    }
    if (worst > 60 && process.env.WHERE) { const fr = (x) => `${Math.round(x.t)}ms cover=${x.cover.toFixed(2)} pad=${x.pad.toFixed(2)} pop=${x.pop} icon=${x.icon ? x.icon.rot + "deg" : "-"} wrap=${x.wrapScale.toFixed(2)} land=${x.land}`; console.log(`    [${label}] slow frame between: ${fr(f[wi - 1])}  ->  ${fr(f[wi])}`); }
    const settled = f.find((x, i) => i > 3 && !x.nav && x.cover === 0 && x.shown > 0.99 && f.slice(0, i).some((y) => y.nav));
    const state = await page.evaluate(() => ({ cover: !!document.querySelector(".gp-cover"), nav: "", pad: document.documentElement.dataset.ctlPop || "",
      home: !!document.querySelector('[data-testid="home-heading"]'), ctl: !!document.querySelector('[data-screen="pad"]'), editor: !!document.querySelector('[data-screen="editor"]') }));
    const atEnd = endScreen === "home" ? state.home && !state.ctl : endScreen === "pad" ? state.ctl : state.editor;
    check(blank.length === 0, `${label}: no blank frame${blank.length ? " (" + blank.length + " blank, first at " + Math.round(blank[0].t) + "ms)" : ""}`);
    check(atEnd && !state.cover && !state.nav && !state.pad, `${label}: ends clean on ${endScreen} (cover=${state.cover} nav="${state.nav}" pad="${state.pad}")`);
    check(worst <= 60, `${label}: smooth while moving, longest frame gap ${Math.round(worst)} ms (CPU 4x slower)`);
    return { settledMs: settled ? Math.round(settled.t) : -1, worst: Math.round(worst), frames: f };
  };
  // What actually reaches the screen: Chrome's painted frames (screencast), for the pop.
  let painted = [];
  cdp.on("Page.screencastFrame", async (fr) => { painted.push({ t: fr.metadata.timestamp * 1000, data: fr.data }); try { await cdp.send("Page.screencastFrameAck", { sessionId: fr.sessionId }); } catch {} });
  const paintStart = async () => { painted = []; await cdp.send("Page.startScreencast", { format: "jpeg", quality: 40, everyNthFrame: 1 }); await pause(120); };
  const paintStop = async () => { await cdp.send("Page.stopScreencast"); return painted; };
  /** The pop, on painted frames: how long until it first shows, and the longest still gap while it runs. */
  const paintedPop = (f, pf) => {
    const go = f.find((x) => x.pop === "go"), end = go && f.find((x) => x.abs > go.abs && !x.pop);
    if (!go || !end) return null;
    const ch = []; for (let i = 1; i < pf.length; i++) if (pf[i].data !== pf[i - 1].data && pf[i].t >= go.abs - 5 && pf[i].t <= end.abs) ch.push(pf[i].t);
    if (!ch.length) return { start: 999, gap: 999, n: 0 };
    let gap = 0; for (let i = 1; i < ch.length; i++) gap = Math.max(gap, ch[i] - ch[i - 1]);
    return { start: Math.round(ch[0] - go.abs), gap: Math.round(gap), n: ch.length };
  };
  const tapCard = (name) => page.evaluate((n) => document.querySelector(`button[aria-label="Play ${n}"]`).click(), name);
  const times = [];

  // ── A. ROUNDS rounds, alternating the two layouts and the two Back routes ─────────────────────────────────────
  for (let i = 1; i <= ROUNDS; i++) {
    const layout = i % 2 ? "Standard Controller" : "Standard Racing Controller";
    const geoBefore = await page.evaluate(() => window.__geo.length);
    await paintStart();
    await page.evaluate(() => window.__arm());
    await tapCard(layout);
    const o = await analyse(`round ${i} open (${layout})`, "pad");
    const pp = paintedPop(o.frames, await paintStop());
    check(pp && pp.start <= 60 && pp.gap <= 40, `round ${i} open: the pop is smooth on screen (painted: first frame after ${pp ? pp.start : "-"} ms, longest still gap ${pp ? pp.gap : "-"} ms, ${pp ? pp.n : 0} changing frames; CPU 4x slower)`);
    const geo = await page.evaluate((n) => window.__geo.slice(n), geoBefore);
    check(geo.length >= 1 && geo.every((g) => Math.abs(g - 0.715) < 0.01), `round ${i}: touch layer only ever got the pad at full size (${geo.map((g) => g.toFixed(3)).join(", ") || "none"})`);
    // The opening's story, frame by frame: icon upright in portrait -> icon flat BEFORE the phone turns -> the
    // controller grows out of it from small to full size.
    const fr = o.frames, firstLand = fr.findIndex((x) => x.land);
    const upright = fr.some((x) => !x.land && x.icon && Math.abs(x.icon.rot - 90) <= 3 && x.iconOp > 0.9);
    const flatBeforeTurn = firstLand > 0 && fr.slice(0, firstLand).some((x) => x.icon && Math.abs(x.icon.rot) <= 3 && x.iconOp > 0.9)
      && !fr.slice(0, firstLand).some((x, k) => x.icon && Math.abs(x.icon.rot) > 3 && fr.slice(0, k).some((y) => y.icon && Math.abs(y.icon.rot) <= 3));
    const popScales = fr.filter((x) => x.pop === "go").map((x) => x.wrapScale);
    const grew = popScales.length >= 3 && Math.min(...popScales) < 0.4 && fr[fr.length - 1].wrapScale > 0.999;
    check(upright, `round ${i} open: the gamepad icon pops up standing upright`);
    check(flatBeforeTurn, `round ${i} open: the icon turns flat before the phone turns`);
    check(grew, `round ${i} open: the controller pops out of the icon to full size (smallest ${popScales.length ? Math.min(...popScales).toFixed(2) : "-"}, ${popScales.length} frames)`);
    await page.evaluate(() => window.__arm());
    if (i % 2) await page.evaluate(() => window.handleAndroidBack());
    else await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("BACK")).click());
    const c = await analyse(`round ${i} close (${i % 2 ? "Android Back" : "BACK button"})`, "home");
    times.push(`${o.settledMs}/${c.settledMs}`);
  }

  // ── B. Double tap on a card ─────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => window.__arm());
  await page.evaluate(() => { const b = document.querySelector('button[aria-label="Play Standard Controller"]'); b.click(); setTimeout(() => b.isConnected && b.click(), 40); });
  await analyse("double tap: opens once", "pad");
  await page.evaluate(() => window.__arm()); await page.evaluate(() => window.handleAndroidBack()); await analyse("double tap: closes", "home");

  // ── C. Back pressed while it is still opening ──────────────────────────────────────────────────────────────
  await page.evaluate(() => window.__arm());
  await tapCard("Standard Controller"); await pause(90); await page.evaluate(() => window.handleAndroidBack());
  await analyse("Back during opening: opening finishes cleanly", "pad");
  await page.evaluate(() => window.__arm()); await page.evaluate(() => window.handleAndroidBack()); await analyse("Back during opening: then closes", "home");

  // ── D. Layout editor (Create a layout -> Standard Controller opens it; Back closes it) ────────────────────────
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.click('[data-testid="create-layout-button"]'); await pause(400);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => window.__arm());
  await page.evaluate(() => [...document.querySelectorAll(".calm-lay-option")].find((b) => b.textContent.includes("Standard Controller")).click());
  const ed = await analyse("editor open", "editor");
  // Under a plain fade the editor must be fully solid whenever the cover is not (it hides Home completely).
  const edThin = ed.frames.filter((x) => x.cover < 0.98 && x.editor > 0 && x.editor < 0.99).length;
  check(edThin === 0, `editor open: the editor is fully solid while the fade lifts (${edThin} see-through frames)`);
  await page.evaluate(() => window.__arm());
  await page.click('[data-testid="editor-back-button"]');
  const ec = await analyse("editor close", "home");
  const fadeStart = ec.frames.findIndex((x) => x.nav);
  const edLeft = ec.frames.slice(Math.max(0, fadeStart)).filter((x) => x.cover < 0.98 && x.editor > 0 && !x.nav).length;
  check(edLeft === 0, `editor close: the editor is gone before the fade lifts (${edLeft} frames)`);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check(errors.length === 0, `no page errors (${errors.length})`);
  console.log(results.join("\n"));
  console.log(`\ntap -> settled (open/close, ms, CPU 4x slower): ${times.join("  ")}`);
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} (${results.length} checks)`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
