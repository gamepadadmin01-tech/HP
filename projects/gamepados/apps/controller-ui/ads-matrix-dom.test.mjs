// Run: node ads-matrix-dom.test.mjs
// Every combination that decides whether "Watch an ad +30 min" shows on the Play tab, in the REAL play-time card
// (headless Chrome, fake phone, fake server), checked against a rule written out here, not copied from the code:
//   shown  =  this build has ads  AND  the portal has ads on  AND  not a Lifetime owner  AND  holds under 30 minutes
// Dimensions: build with ads / build without ads (Aptoide, Amazon)  x  guest / signed in  x  FREE / LIFETIME
//             x  time held (10 min, exactly 30 min, 40 min)  x  portal ads on / off.
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const CAP = 1800;
const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardAllowance } from "./src/app/components/CalmShell";
createRoot(document.getElementById("root")).render(<div className="gp-shell" style={{ width: 380 }}><DashboardAllowance /></div>);
`;
async function bundle(play) {
  const out = await build({
    stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "tsx", sourcefile: "entry.tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', __PLAY__: play ? "true" : "false" },
  });
  return `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\\/script>")}</script>`;
}
const htmlWeb = await bundle(false), htmlPlay = await bundle(true);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function chipFor({ bridgeAds, signed, plan, held, portalAds, play }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((held, signed, bridgeAds) => {
    try { localStorage.clear(); if (signed) localStorage.setItem("gp_account", JSON.stringify({ token: "t", user: { id: "u1", email: "a@x.invalid", displayName: "P" } })); } catch {}
    window.AndroidBridge = {
      getDistributionChannel: () => "direct", getAppVersionName: () => "1.4.13", getAppVersionCode: () => 67,
      adsAvailable: () => bridgeAds, adNetwork: () => "unity", preloadRewardedAd: () => {}, showRewardedAd: () => {},
      getGuestTrialState: () => JSON.stringify({ remainingSeconds: held, limitSeconds: 0, resetsAt: Date.now() + 1e7, bankSeconds: held, canEarnAd: held < 1800 }),
      setGuestTrialActive: () => JSON.stringify({ remainingSeconds: held, limitSeconds: 0, resetsAt: Date.now() + 1e7 }),
    };
  }, held, signed, bridgeAds);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: CORS, body: "" });
    if (u.origin === "http://matrix.test") return r.respond({ status: 200, contentType: "text/html", body: play ? htmlPlay : htmlWeb });
    const json = (body) => r.respond({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (u.pathname === "/api/app-config") return json({ success: true, ads: { available: portalAds, message: "" }, guest: { welcomeSeconds: 1800, adRewardSeconds: 1800, adCapSeconds: 1800, freeTime: { enabled: !portalAds, seconds: 1800, belowSeconds: 1800, perDay: 6, title: "", body: "" } }, notice: null, kill: null });
    if (u.pathname === "/api/billing/me") {
      const life = plan === "LIFETIME";
      return json({ success: true, plan, unlimited: life, startsAt: null, endsAt: null, autoRenew: false, source: life ? "PLAY" : null,
        today: { limitSeconds: life ? null : 0, usedSeconds: 0, remainingSeconds: life ? null : held },
        adTime: { bankSeconds: life ? 0 : held, rewardSeconds: 1800, canEarn: !life && held < CAP },
        resetsAt: new Date(Date.now() + 3e6).toISOString(), resetTimezone: "Asia/Kolkata", heartbeatSeconds: 60, serverTime: new Date().toISOString() });
    }
    return r.respond({ status: 404, contentType: "application/json", headers: CORS, body: "{}" });
  });
  await page.goto("http://matrix.test/");
  await page.waitForSelector('[data-testid="daily-allowance"]');
  await new Promise((r) => setTimeout(r, 650));
  const text = await page.evaluate(() => { const b = document.querySelector('[data-testid="watch-ad-chip"]'); return b ? b.innerText.replace(/\s+/g, " ").trim() : null; });
  await page.close();
  return text;
}

let n = 0;
try {
  const bad = [];
  const check = async (c) => {
    const want = c.bridgeAds && c.portalAds && c.plan !== "LIFETIME" && c.held < CAP;
    const got = await chipFor(c);
    n++;
    if (!!got !== want) bad.push(`${JSON.stringify(c)} -> wanted ${want ? "button" : "no button"}, got ${got ? `"${got}"` : "none"}`);
    else if (got && !/Watch an ad\s*\+30 min/.test(got)) bad.push(`${JSON.stringify(c)} -> wrong label "${got}"`);
  };
  for (const bridgeAds of [true, false]) for (const portalAds of [true, false]) for (const held of [600, 1800, 2400]) {
    await check({ bridgeAds, signed: false, plan: "FREE", held, portalAds });
    for (const plan of ["FREE", "LIFETIME"]) await check({ bridgeAds, signed: true, plan, held, portalAds });
  }
  // the Google Play bundle follows the same rule
  await check({ bridgeAds: true, signed: false, plan: "FREE", held: 600, portalAds: true, play: true });
  await check({ bridgeAds: true, signed: true, plan: "FREE", held: 600, portalAds: true, play: true });
  await check({ bridgeAds: true, signed: true, plan: "LIFETIME", held: 600, portalAds: true, play: true });
  assert.deepEqual(bad, [], "every combination follows the rule:\n" + bad.join("\n"));
  assert.deepEqual(errors, [], "no page errors");
  console.log(`ads-matrix-dom.test.mjs — all ${n} combinations behave correctly`);
} finally {
  await browser.close();
}
