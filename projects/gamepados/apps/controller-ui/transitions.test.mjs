// Run: node transitions.test.mjs   (vite on 127.0.0.1:5187; ROUNDS=10 for the long version)
// The controller / editor open-close, AS IN 1.4.16 (owner, 2026-11-11: "check our old version 1.4.16 ... taking that
// as reference"): the LOADING curtain (controller colour, pulsing gamepad) fades in, 0.1 s later the phone is asked to
// turn and the next screen is set, 0.18 s later the curtain lifts (App.tsx runCurtainSequence). On the phone, Android's
// own turn animation plays over the turn itself; a browser cannot show that, so this test checks the page's part
// (painted-frame stalls that contain a window resize, i.e. the turn, are left to Android's turn animation).
// Phone-like: CPU 4x slower; the screen turns 220 ms after the app asks, then the system bars resize it once more.
// Per open / close it checks: the curtain shows; the screen switches while the curtain covers it; the turn is asked
// for once, the right way; no blank frame; it ends clean on the right screen; smooth frames while the curtain fades;
// the touch layer ends with the pad's full-size position. Also: double tap, Back during opening, the layout editor.
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
  await page.exposeFunction("__turn", async (o) => {
    const land = o.startsWith("landscape");
    await pause(220); await page.setViewport({ ...(land ? { width: 915, height: 388 } : P), deviceScaleFactor: 2 });
    await pause(180); await page.setViewport({ ...(land ? L : P), deviceScaleFactor: 2 });
  });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); } catch {}
    window.__geo = []; window.__turns = [];
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.16", getAppVersionCode: () => 70,
      getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: true, linkAlive: true, connectionType: "wireless" }), getUsbBroadcastAddress: () => "", stopEngine() {},
      setScreenOrientation(o) { window.__turns.push(o); window.__turn(o); },
      setNativeInputGeometry(j) { window.__geo.push(JSON.parse(j).matrix[0]); }, setNativeInputActive() {}, setNativeGyroConfig() {} };
    window.__arm = () => {
      window.__f = []; const t0 = performance.now(); window.__turns.length = 0;
      const op = (sel) => { const e = document.querySelector(sel); return e ? +getComputedStyle(e).opacity : 0; };
      const tick = () => {
        const curtain = op('[data-testid="curtain"]');
        const home = op('[data-screen="home"]'), pad = op(".gp-ctl-wrap"), editor = op('[data-screen="editor"]');
        const screen = document.querySelector('[data-screen="editor"]') ? "editor" : document.querySelector('[data-screen="pad"]') ? "pad" : document.querySelector('[data-screen="home"]') ? "home" : "";
        window.__f.push({ t: performance.now() - t0, abs: performance.timeOrigin + performance.now(), wh: innerWidth + "x" + innerHeight, curtain, home, pad, editor, screen, shown: Math.max(home, pad, editor),
          loading: !!document.querySelector('[data-testid="curtain"]')?.textContent.includes("LOADING") });
        if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
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

  // What reaches the screen: Chrome's painted frames. The curtain's gamepad pulses all the time, so a gap between
  // changed painted frames while the curtain is up is a visible stall. A gap across a window resize (the simulated
  // turn) is skipped: on the phone, Android's own turn animation plays there.
  let painted = [];
  cdp.on("Page.screencastFrame", async (fr) => { painted.push({ t: fr.metadata.timestamp * 1000, data: fr.data, wh: fr.metadata.deviceWidth + "x" + fr.metadata.deviceHeight }); try { await cdp.send("Page.screencastFrameAck", { sessionId: fr.sessionId }); } catch {} });
  const paintStart = async () => { painted = []; await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 }); await pause(120); };
  const analyse = async (label, from, to, turnTo) => {
    await pause(2300);
    await cdp.send("Page.stopScreencast");
    const f = await page.evaluate(() => window.__f);
    const turns = await page.evaluate(() => window.__turns.slice());
    const sawCurtain = f.some((x) => x.curtain > 0.9 && x.loading);
    const k = f.findIndex((x) => x.screen === to);
    const switchedCovered = k > 0 && f[k].curtain > 0.5;
    const blank = f.filter((x) => x.curtain + x.shown < 0.9);
    const up = f.find((x) => x.curtain > 0.02), gone = up && f.find((x) => x.abs > up.abs && x.curtain === 0 && x.screen === to);
    let worst = 0, worstAt = 0;
    if (up && gone) { const ch = []; for (let i = 1; i < painted.length; i++) if (painted[i].data !== painted[i - 1].data && painted[i].t >= up.abs && painted[i].t <= gone.abs) ch.push(painted[i]);
      // The moments the window changed size (the turn, then the system bars): on the phone Android's turn animation covers them.
      const resizes = f.filter((x, j) => j > 0 && x.wh !== f[j - 1].wh).map((x) => x.abs);
      for (let i = 1; i < ch.length; i++) {
        const a = ch[i - 1].t, b = ch[i].t;
        if (ch[i].wh !== ch[i - 1].wh || resizes.some((r) => r >= a - 20 && r <= b + 20)) continue;
        if (b - a > worst) { worst = b - a; worstAt = a; }
      } }
    if (worst > 50 && process.env.WHERE) { const near = f.reduce((a, x) => Math.abs(x.abs - worstAt) < Math.abs(a.abs - worstAt) ? x : a, f[0]);
      console.log(`    [${label}] still ${Math.round(worst)} ms starting ${Math.round(worstAt - up.abs)} ms after the curtain began; then curtain=${near.curtain.toFixed(2)} screen=${near.screen}`); }
    const state = await page.evaluate(() => ({ curtain: !!document.querySelector('[data-testid="curtain"]'),
      home: !!document.querySelector('[data-testid="home-heading"]'), pad: !!document.querySelector('[data-screen="pad"]'), editor: !!document.querySelector('[data-screen="editor"]') }));
    const atEnd = to === "home" ? state.home && !state.pad && !state.editor : to === "pad" ? state.pad && !state.editor : state.editor;
    check(sawCurtain, `${label}: the LOADING curtain shows`);
    check(switchedCovered, `${label}: the screen switches from ${from} to ${to} while the curtain covers it${k > 0 ? ` (curtain ${f[k].curtain.toFixed(2)} at ${Math.round(f[k].t)} ms)` : " (never switched)"}`);
    check(turns.length >= 1 && turns.every((t) => t === turnTo), `${label}: the phone is asked to turn to ${turnTo}, and only that way (${JSON.stringify(turns)})`);
    check(blank.length === 0, `${label}: no blank frame${blank.length ? ` (${blank.length}, first at ${Math.round(blank[0].t)} ms)` : ""}`);
    check(atEnd && !state.curtain, `${label}: ends clean on ${to} (curtain gone: ${!state.curtain})`);
    check(!!(up && gone) && worst <= 50, `${label}: smooth on screen while the curtain is up (painted frames: longest still gap ${Math.round(worst)} ms; CPU 4x slower)`);
  };
  const tapCard = (name) => page.evaluate((n) => document.querySelector(`button[aria-label="Play ${n}"]`).click(), name);

  // ── A. Rounds, alternating the two layouts and the two Back routes ─────────────────────────────────────────────
  for (let i = 1; i <= ROUNDS; i++) {
    const layout = i % 2 ? "Standard Controller" : "Standard Racing Controller";
    const geoBefore = await page.evaluate(() => window.__geo.length);
    await paintStart(); await page.evaluate(() => window.__arm());
    await tapCard(layout);
    await analyse(`round ${i} open (${layout})`, "home", "pad", "landscape-locked");
    const geo = await page.evaluate((n) => window.__geo.slice(n), geoBefore);
    check(geo.length >= 1 && Math.abs(geo[geo.length - 1] - 0.715) < 0.01, `round ${i}: the touch layer ends with the pad's full-size position (${geo.map((g) => g.toFixed(3)).join(", ") || "none"})`);
    await paintStart(); await page.evaluate(() => window.__arm());
    if (i % 2) await page.evaluate(() => window.handleAndroidBack());
    else await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("BACK")).click());
    await analyse(`round ${i} close (${i % 2 ? "Android Back" : "BACK button"})`, "pad", "home", "portrait");
  }

  // ── B. Double tap on a card: opens once ───────────────────────────────────────────────────────────────────────
  await paintStart(); await page.evaluate(() => window.__arm());
  await page.evaluate(() => { const b = document.querySelector('button[aria-label="Play Standard Controller"]'); b.click(); setTimeout(() => b.isConnected && b.click(), 40); });
  await analyse("double tap", "home", "pad", "landscape-locked");
  await paintStart(); await page.evaluate(() => window.__arm()); await page.evaluate(() => window.handleAndroidBack()); await analyse("double tap: close", "pad", "home", "portrait");

  // ── C. Back pressed while it is still opening: ignored, the opening finishes ─────────────────────────────────
  await paintStart(); await page.evaluate(() => window.__arm());
  await tapCard("Standard Controller"); await pause(60); await page.evaluate(() => window.handleAndroidBack());
  await analyse("Back during opening", "home", "pad", "landscape-locked");
  await paintStart(); await page.evaluate(() => window.__arm()); await page.evaluate(() => window.handleAndroidBack()); await analyse("Back during opening: then close", "pad", "home", "portrait");

  // ── D. Layout editor (Create a layout -> Standard Controller opens it; its Back closes it) ────────────────────
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.click('[data-testid="create-layout-button"]'); await pause(500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await paintStart(); await page.evaluate(() => window.__arm());
  await page.evaluate(() => [...document.querySelectorAll(".calm-lay-option")].find((b) => b.textContent.includes("Standard Controller")).click());
  await analyse("editor open", "home", "editor", "landscape");
  await paintStart(); await page.evaluate(() => window.__arm());
  await page.click('[data-testid="editor-back-button"]');
  await analyse("editor close", "editor", "home", "portrait");

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check(errors.length === 0, `no page errors (${errors.length}${errors.length ? ": " + errors[0] : ""})`);
  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} (${results.length} checks)`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
