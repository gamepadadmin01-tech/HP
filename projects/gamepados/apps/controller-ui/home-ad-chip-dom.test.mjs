// Run: node home-ad-chip-dom.test.mjs
// "Keep the Watch an ad +30 min button on the Play tab, beside the membership card" (owner, 2026-11-02).
// The REAL play-time card in headless Chrome, with a fake phone and fake server:
//   * low on time, ads working      -> the button is there, beside the card, and tapping it asks the phone for an ad
//   * holding the cap or more       -> no button (ads are only offered under 30 minutes)
//   * ads switched off by the portal -> no button
//   * a Lifetime owner              -> no button
//   * a signed-in player            -> the button appears even though this tab never read the plan itself
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardAllowance } from "./src/app/components/CalmShell";
createRoot(document.getElementById("root")).render(<div className="gp-shell" style={{ width: 380 }}><DashboardAllowance /></div>);
`;
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __PLAY__: "false" },
});
const html = `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function open({ remaining, signed = false, plan = "FREE", adsAvailable = true }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((remaining, signed, adsAvailable) => {
    try { localStorage.clear(); if (signed) localStorage.setItem("gp_account", JSON.stringify({ token: "t", user: { id: "u1", email: "a@x.invalid", displayName: "Akhil" } })); } catch {}
    window.__asked = 0;
    window.AndroidBridge = {
      getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.13", getAppVersionCode: () => 67,
      adsAvailable: () => true, adNetwork: () => "unity", preloadRewardedAd: () => {},
      showRewardedAd: () => { window.__asked++; },
      getGuestTrialState: () => JSON.stringify({ remainingSeconds: remaining, limitSeconds: 0, resetsAt: Date.now() + 1e7, bankSeconds: remaining, canEarnAd: remaining < 1800 }),
      setGuestTrialActive: () => JSON.stringify({ remainingSeconds: remaining, limitSeconds: 0, resetsAt: Date.now() + 1e7 }),
    };
  }, remaining, signed, adsAvailable);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: CORS, body: "" });
    if (u.origin === "http://home.test") return r.respond({ status: 200, contentType: "text/html", body: html });
    const json = (body) => r.respond({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (u.pathname === "/api/app-config") return json({ success: true, ads: { available: adsAvailable, message: "" }, guest: { welcomeSeconds: 1800, adRewardSeconds: 1800, adCapSeconds: 1800, freeTime: { enabled: !adsAvailable, seconds: 1800, belowSeconds: 1800, perDay: 6, title: "", body: "" } }, notice: null, kill: null });
    if (u.pathname === "/api/billing/me") {
      const life = plan === "LIFETIME";
      return json({ success: true, plan, unlimited: life, startsAt: null, endsAt: null, autoRenew: false, source: life ? "PLAY" : null,
        today: { limitSeconds: life ? null : 0, usedSeconds: 0, remainingSeconds: life ? null : 600 }, adTime: { bankSeconds: life ? 0 : 600, rewardSeconds: 1800, canEarn: !life },
        resetsAt: new Date(Date.now() + 3e6).toISOString(), resetTimezone: "Asia/Kolkata", heartbeatSeconds: 60, serverTime: new Date().toISOString() });
    }
    return r.respond({ status: 404, contentType: "application/json", headers: CORS, body: "{}" });
  });
  await page.goto("http://home.test/");
  await page.waitForSelector('[data-testid="daily-allowance"]');
  await new Promise((r) => setTimeout(r, 900));
  return page;
}
const chip = (p) => p.evaluate(() => { const b = document.querySelector('[data-testid="watch-ad-chip"]'); return b ? { text: b.innerText.replace(/\s+/g, " ").trim(), box: b.getBoundingClientRect().toJSON() } : null; });

try {
  // low on time, ads working: the button is there, to the RIGHT of the card, same row
  {
    const p = await open({ remaining: 600 });
    const c = await chip(p);
    assert.ok(c, "the button is shown when the player is under the cap");
    assert.match(c.text, /Watch an ad\s*\+30 min/, "and says exactly that");
    // (This page loads no stylesheet, so the screenshot checks the look; here we check the structure.)
    const sameRow = await p.evaluate(() => {
      const row = document.querySelector('[data-testid="watch-ad-chip"]').closest(".calm-allowance-row");
      return !!row && row.contains(document.querySelector('[data-testid="daily-allowance"]'));
    });
    assert.ok(sameRow, "the button lives in the same row as the play-time card, so it sits beside it");
    await p.click('[data-testid="watch-ad-chip"]');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await p.evaluate(() => window.__asked), 1, "tapping it asks the phone to show an ad");
    assert.ok((await p.evaluate(() => document.querySelector('[data-testid="watch-ad-chip"]').disabled)), "and it waits while the ad loads");
    await p.close();
  }
  // holding the cap: no button
  { const p = await open({ remaining: 1800 }); assert.equal(await chip(p), null, "no button at 30 minutes or more"); await p.close(); }
  // ads switched off in the portal: no button
  { const p = await open({ remaining: 600, adsAvailable: false }); assert.equal(await chip(p), null, "no button while ads are switched off"); await p.close(); }
  // signed in, free plan: the button appears although this tab never read the plan on its own
  { const p = await open({ remaining: 600, signed: true }); const c = await chip(p); assert.ok(c, "a signed-in free player gets the button too"); assert.match(c.text, /Watch an ad/); await p.close(); }
  // signed in, Lifetime: no button
  { const p = await open({ remaining: 600, signed: true, plan: "LIFETIME" }); assert.equal(await chip(p), null, "a Lifetime owner never sees it"); await p.close(); }

  assert.deepEqual(errors, [], "no page errors");
  console.log("home-ad-chip-dom.test.mjs — all assertions passed");
} finally {
  await browser.close();
}
