// Run: node play-plans-dom.test.mjs
// Two UI bundles (2026-11-02): the Google Play bundle (__PLAY__ true) and the one every other build ships.
//   Play bundle : shows ONLY the price Google Play reports; never ours, never a guess.
//   Other bundle: rupees in India (Lifetime ₹19), dollars elsewhere (Lifetime $0.50).
// "I can't see plans in the Play build" (2026-11-02): the signed-out Plans screen still had the old rule
// "the Play build sells nothing" hard-coded. The REAL GuestPlans screen in headless Chrome, pretending to be:
//   (a) the Play build WITH Google billing   -> must show the Lifetime plan (price comes from Play, not us)
//   (b) an older Play build WITHOUT billing  -> must show no plan and no purchase
//   (c) the website build                    -> unchanged, shows the plan with our price
// The server's answers are faked, but the rule the real server follows is mirrored: a Play build is only
// offered the shop when it says playBilling=1.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { GuestPlans } from "./src/app/components/GuestPlans";
createRoot(document.getElementById("root")).render(<div style={{ width: 420 }}><GuestPlans /></div>);
`;
async function bundle(play) {
  const out = await build({
    stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', __PLAY__: play ? "true" : "false" },
  });
  return `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;
}
const htmlPlay = await bundle(true), htmlWeb = await bundle(false);
const requested = [];

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function open({ channel, billing, playPrice = null, tz = "Asia/Kolkata" }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateTimezone(tz);
  await page.evaluateOnNewDocument((channel, billing, playPrice) => {
    try { localStorage.clear(); } catch {}
    const bridge = {
      getDistributionChannel: () => channel, getAppVersionName: () => "1.4.13", getAppVersionCode: () => 67,
      adsAvailable: () => true, adNetwork: () => "unity",
    };
    if (billing) bridge.startPlayPurchase = () => {};
    // Google Play's answer to "what does gpos_lifetime cost?" (null = Play cannot say, e.g. a test install)
    if (billing && playPrice) bridge.queryPlayPrices = () => setTimeout(() => window.onPlayPrices(JSON.stringify({ gpos_lifetime: playPrice })), 30);
    window.AndroidBridge = bridge;
  }, channel, billing, playPrice);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === "http://plans.test") return r.respond({ status: 200, contentType: "text/html", body: channel === "playstore" ? htmlPlay : htmlWeb });
    const json = (body) => r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    if (u.pathname === "/api/billing/plans") {
      const ch = u.searchParams.get("channel");
      // the real server's rule: the Play build is only offered the shop when it says playBilling=1
      const purchasable = ch === "direct" || ch === "uptodown" || (ch === "playstore" && u.searchParams.get("playBilling") === "1");
      const cur = (u.searchParams.get("currency") || "INR").toUpperCase();
      requested.push(cur);
      return json({
        success: true, channel: ch, currency: cur, purchasable,
        plans: [{ code: "LIFETIME", displayName: "Lifetime", currency: cur, priceMinor: cur === "USD" ? 50 : 1900, unlimited: true, dailySeconds: null,
          durationHours: null, durationMonths: null, purchasable, priceFromStore: ch === "playstore", playProductId: ch === "playstore" ? "gpos_lifetime" : undefined }],
      });
    }
    if (u.pathname === "/api/app-config") return json({ success: true, ads: { available: true, message: "" }, guest: { welcomeSeconds: 1800, adRewardSeconds: 1800, adCapSeconds: 1800, freeTime: { enabled: false, seconds: 1800, belowSeconds: 1800, perDay: 6, title: "", body: "" } }, notice: null, kill: null });
    return r.respond({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("http://plans.test/");
  await page.waitForSelector(".guest-plans");
  await new Promise((r) => setTimeout(r, 700));      // let the plans request answer
  return page;
}
const text = (page) => page.evaluate(() => document.querySelector(".guest-plans").innerText);

try {
  // (a) Play build WITH Google billing: the plan is there, with the price Google Play reports
  {
    const p = await open({ channel: "playstore", billing: true, playPrice: "US$0.50", tz: "America/New_York" });
    const t = await text(p);
    assert.match(t, /Lifetime/, "the Play build with billing shows the Lifetime plan");
    assert.match(t, /US\$0\.50/, "with Google Play's own price, in the player's currency");
    assert.match(t, /Buy for US\$0\.50/, "and the button says what it costs");
    assert.doesNotMatch(t, /₹/, "never our rupee price instead of Play's");
    await p.close();
  }
  // (a2) Play cannot say the price (a test install from outside Play), player in India: still no price of ours
  {
    const p = await open({ channel: "playstore", billing: true, playPrice: null, tz: "Asia/Kolkata" });
    const t = await text(p);
    assert.match(t, /Price shown by\s+Google Play/, "India too: the Play build waits for Google Play's price");
    assert.doesNotMatch(t, /₹|\$|19|0\.50/, "and never shows our own number, even in India");
    await p.close();
  }
  // (a3) Play cannot say the price, player outside India: no guessed number, an honest line instead
  {
    const p = await open({ channel: "playstore", billing: true, playPrice: null, tz: "America/New_York" });
    const t = await text(p);
    assert.match(t, /Lifetime/);
    assert.match(t, /Price shown by\s+Google Play/, "says where the price will appear");
    assert.match(t, /Buy with Google Play/);
    assert.doesNotMatch(t, /₹|\$/, "and shows no guessed price");
    assert.match(t, /Watch an ad|Ads come back/i, "the free-time and ads card is still there beside it (a new player holds 30 free minutes, so it says when ads come back)");
    await p.close();
  }
  // (b) an older Play build (no billing code): no plan, no purchase
  {
    const p = await open({ channel: "playstore", billing: false });
    const t = await text(p);
    assert.doesNotMatch(t, /Lifetime/, "an older Play build shows no plan");
    assert.doesNotMatch(t, /Explore plans|See plans/i);
    await p.close();
  }
  // (c) the website build: rupees in India, dollars everywhere else
  {
    const p = await open({ channel: "direct", billing: false, tz: "Asia/Kolkata" });
    const t = await text(p);
    assert.match(t, /Lifetime/, "the website build still shows the plan");
    assert.match(t, /₹\s?19\b/, "in India the price is ₹19");
    assert.doesNotMatch(t, /\$/, "with no dollar sign");
    await p.close();
    const q = await open({ channel: "direct", billing: false, tz: "America/New_York" });
    const t2 = await text(q);
    assert.match(t2, /\$0\.50/, "outside India the price is $0.50");
    assert.doesNotMatch(t2, /₹/, "with no rupee sign");
    await q.close();
    const g = await open({ channel: "uptodown", billing: false, tz: "Europe/Berlin" });
    assert.match(await text(g), /\$0\.50/, "the other non-Play builds follow the same rule (Germany: $0.50)");
    await g.close();
  }
  assert.ok(requested.includes("USD") && requested.includes("INR"), "the catalogue was asked for dollars and for rupees");
  assert.deepEqual(errors, [], "no page errors");
  console.log("play-plans-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
