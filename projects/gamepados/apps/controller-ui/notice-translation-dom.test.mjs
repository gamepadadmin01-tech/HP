// Run: node notice-translation-dom.test.mjs   (vite on 127.0.0.1:5187)
// Portal notifications in the player's language (owner, 2026-11-18, option 3). The real app, a pretend server whose
// /api/app-config sends a notice with translations:
//   • app in Japanese -> the bell shows the Japanese text and the Japanese button label;
//   • app in English -> the English the owner typed;
//   • a language the notice has no translation for -> English (never blank).
import puppeteer from "puppeteer";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

const NOTICE = {
  id: "n1", text: "Version 2.1 is out: the app now speaks your language.", action: { kind: "plans", label: "See plans" },
  translations: { "ja-JP": { text: "バージョン 2.1 が出ました。アプリがあなたの言語に対応しました。", label: "プランを見る" },
    "de-DE": { text: "Version 2.1 ist da: Die App spricht jetzt deine Sprache." } },
};

async function bellIn(lang) {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 412, height: 915 });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/app-config")) return r.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ success: true, ads: { available: true, message: "" }, guest: {}, notice: NOTICE, kill: null }) });
    return u.startsWith("http://127.0.0.1:5187") || u.startsWith("data:") ? r.continue() : r.abort("failed");
  });
  await page.evaluateOnNewDocument((lang) => {
    try { localStorage.clear(); localStorage.setItem("gp_language", lang); } catch {}
    window.AndroidBridge = { onUiReady() {}, exitApp() {}, getDistributionChannel: () => "direct", getAppVersionName: () => "2.1.0", getAppVersionCode: () => 73,
      getNetworkTelemetryJson: () => JSON.stringify({ engineRunning: false, linkAlive: false }), getUsbBroadcastAddress: () => "", stopEngine() {} };
  }, lang);
  await page.goto("http://127.0.0.1:5187/");
  await page.waitForSelector('[data-testid="notice-bell"]'); await pause(1500);
  await page.click('[data-testid="notice-bell"]'); await page.waitForSelector('[data-testid="notice-text"]'); await pause(400);
  const got = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="notice-text"]');
    const buttons = [...p.parentElement.querySelectorAll("button")].map((b) => b.textContent.trim());
    return { text: p.textContent, buttons };
  });
  assert.deepEqual(errors, []);
  await page.close();
  return got;
}

try {
  const ja = await bellIn("ja-JP");
  assert.equal(ja.text, NOTICE.translations["ja-JP"].text, "Japanese text");
  assert.ok(ja.buttons.includes("プランを見る"), `Japanese button label (${ja.buttons})`);
  const en = await bellIn("en");
  assert.equal(en.text, NOTICE.text, "English text");
  assert.ok(en.buttons.includes("See plans"));
  const de = await bellIn("de-DE");
  assert.equal(de.text, NOTICE.translations["de-DE"].text, "German text");
  assert.ok(de.buttons.includes("See plans"), "no German label sent -> the English label");
  const ko = await bellIn("ko-KR");
  assert.equal(ko.text, NOTICE.text, "no Korean translation -> English, never blank");
  console.log("PASS notice translation: Japanese, English, German (English label), Korean falls back to English");
} finally {
  await browser.close();
}
