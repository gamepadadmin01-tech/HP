// Run: node play-plans-dom.test.mjs
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
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function open({ channel, billing }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((channel, billing) => {
    try { localStorage.clear(); } catch {}
    const bridge = {
      getDistributionChannel: () => channel, getAppVersionName: () => "1.4.13", getAppVersionCode: () => 67,
      adsAvailable: () => true, adNetwork: () => "unity",
    };
    if (billing) bridge.startPlayPurchase = () => {};
    window.AndroidBridge = bridge;
  }, channel, billing);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === "http://plans.test") return r.respond({ status: 200, contentType: "text/html", body: html });
    const json = (body) => r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    if (u.pathname === "/api/billing/plans") {
      const ch = u.searchParams.get("channel");
      // the real server's rule: the Play build is only offered the shop when it says playBilling=1
      const purchasable = ch === "direct" || (ch === "playstore" && u.searchParams.get("playBilling") === "1");
      return json({
        success: true, channel: ch, currency: "INR", purchasable,
        plans: [{ code: "LIFETIME", displayName: "Lifetime", currency: "INR", priceMinor: 1900, unlimited: true, dailySeconds: null,
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
  // (a) Play build WITH Google billing: the plan is there, the price is Play's
  {
    const p = await open({ channel: "playstore", billing: true });
    const t = await text(p);
    assert.match(t, /Lifetime/, "the Play build with billing shows the Lifetime plan");
    assert.doesNotMatch(t, /₹\s?19|Rs\.?\s?19|19\.00/, "and never shows OUR price next to a Play product (Play shows its own)");
    assert.match(t, /price|buy/i, "with a way to see the price and buy");
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
  // (c) the website build: unchanged
  {
    const p = await open({ channel: "direct", billing: false });
    const t = await text(p);
    assert.match(t, /Lifetime/, "the website build still shows the plan");
    assert.match(t, /19/, "with our own price");
    await p.close();
  }
  assert.deepEqual(errors, [], "no page errors");
  console.log("play-plans-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
