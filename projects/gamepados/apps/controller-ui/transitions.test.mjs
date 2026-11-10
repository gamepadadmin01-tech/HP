// Run: node transitions.test.mjs   (vite on 127.0.0.1:5187; ROUNDS=10 for the long version)
// Thorough check of the controller / editor open-close motion (owner, 2026-11-11: "check 1 to 10 times").
// Added after the motion was rebuilt as ONE fade-through move under a cover (App.tsx coverThrough). Phone-like: CPU 4x slower, the screen "turns"
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
        window.__f.push({ t: performance.now() - t0, cover, home, pad, editor, shown, nav: document.documentElement.dataset.navDir || "", land: innerWidth > innerHeight });
        if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
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
    await pause(1500);
    const f = await page.evaluate(() => window.__f);
    const blank = f.filter((x) => x.cover + x.shown < 0.9);
    const moving = f.filter((x) => x.nav || (x.cover > 0.02 && x.cover < 0.98));
    // Smoothness counts only frames you can SEE change: while the cover is solid (>= 0.98) the phone is building
    // the next screen and nothing is visible, which is the point of the cover.
    let worst = 0, wi = 0;
    for (let i = 1; i < f.length; i++) {
      const moved = ["cover", "home", "pad", "editor"].some((k) => Math.abs(f[i][k] - f[i - 1][k]) > 0.01);
      if ((f[i].nav || f[i - 1].nav) && moved && (f[i].cover < 0.98 || f[i - 1].cover < 0.98)) { const g = f[i].t - f[i - 1].t; if (g > worst) { worst = g; wi = i; } }
    }
    if (worst > 60 && process.env.WHERE) { const fr = (x) => `${Math.round(x.t)}ms cover=${x.cover.toFixed(2)} home=${x.home.toFixed(2)} pad=${x.pad.toFixed(2)} ed=${x.editor.toFixed(2)} nav=${x.nav}`; console.log(`    [${label}] slow frame between: ${fr(f[wi - 1])}  ->  ${fr(f[wi])}`); }
    const settled = f.find((x, i) => i > 3 && !x.nav && x.cover === 0 && x.shown > 0.99 && f.slice(0, i).some((y) => y.nav));
    const state = await page.evaluate(() => ({ cover: !!document.querySelector(".gp-cover"), nav: document.documentElement.dataset.navDir || "", pad: document.documentElement.dataset.pad || "",
      home: !!document.querySelector('[data-testid="home-heading"]'), ctl: !!document.querySelector('[data-screen="pad"]'), editor: !!document.querySelector('[data-screen="editor"]') }));
    const atEnd = endScreen === "home" ? state.home && !state.ctl : endScreen === "pad" ? state.ctl : state.editor;
    check(blank.length === 0, `${label}: no blank frame${blank.length ? " (" + blank.length + " blank, first at " + Math.round(blank[0].t) + "ms)" : ""}`);
    check(atEnd && !state.cover && !state.nav && !state.pad, `${label}: ends clean on ${endScreen} (cover=${state.cover} nav="${state.nav}" pad="${state.pad}")`);
    check(worst <= 60, `${label}: smooth while moving, longest frame gap ${Math.round(worst)} ms (CPU 4x slower)`);
    return { settledMs: settled ? Math.round(settled.t) : -1, worst: Math.round(worst), frames: f };
  };
  const tapCard = (name) => page.evaluate((n) => document.querySelector(`button[aria-label="Play ${n}"]`).click(), name);
  const times = [];

  // ── A. ROUNDS rounds, alternating the two layouts and the two Back routes ─────────────────────────────────────
  for (let i = 1; i <= ROUNDS; i++) {
    const layout = i % 2 ? "Standard Controller" : "Standard Racing Controller";
    const geoBefore = await page.evaluate(() => window.__geo.length);
    await page.evaluate(() => window.__arm());
    await tapCard(layout);
    const o = await analyse(`round ${i} open (${layout})`, "pad");
    const geo = await page.evaluate((n) => window.__geo.slice(n), geoBefore);
    check(geo.length >= 1 && Math.abs(geo[geo.length - 1] - 0.715) < 0.01, `round ${i}: touch layer got the pad at full size (${geo.map((g) => g.toFixed(3)).join(", ") || "none"})`);
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
  const homeDuringEditorIn = ed.frames.filter((x) => x.nav && x.cover < 0.98 && x.home > 0.05 && x.editor > 0).length;
  check(homeDuringEditorIn === 0, `editor open: Home stays hidden underneath while the editor arrives (${homeDuringEditorIn} frames visible)`);
  await page.evaluate(() => window.__arm());
  await page.click('[data-testid="editor-back-button"]');
  const ec = await analyse("editor close", "home");
  const early = ec.frames.filter((x) => x.nav && x.editor > 0.02 && x.home > 0.02 && x.cover < 0.98).length;
  check(early === 0, `editor close: Home does not show through the fading editor (${early} frames)`);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check(errors.length === 0, `no page errors (${errors.length})`);
  console.log(results.join("\n"));
  console.log(`\ntap -> settled (open/close, ms, CPU 4x slower): ${times.join("  ")}`);
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} (${results.length} checks)`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
