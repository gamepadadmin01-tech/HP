// Run: node settings-sync-dom.test.mjs
// 2.1 Settings backup (owner, 2026-11-18: "the settings page is not syncing"), against a pretend server that follows
// the real rule (backend/settingsSync.js: the newest change wins, a phone that changed nothing sends no time):
//   1. a new phone that changed nothing receives the account's settings and does NOT overwrite them;
//   2. a setting changed on the phone is uploaded with its time and wins;
//   3. settings chosen before updating to 2.1 count as a change and are uploaded;
//   4. a phone holding ANOTHER account's settings does not upload them over this account's;
//   5. with Auto backup off nothing is uploaded, but the account's settings still come down;
//   6. Game rumble is saved (it used to reset to ON at every launch).
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const entry = `
import * as s from "./src/app/store/settingsSync";
import * as prefs from "./src/app/store/prefs";
import { currentLang } from "./src/app/i18n";
import { stickFeel } from "./src/app/stickFeel";
window.__t = { ...s, prefs, currentLang, stickFeel };
`;
const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), loader: "ts", sourcefile: "entry.ts" },
  bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __PLAY__: "false" },
});
const html = `<!doctype html><meta charset="utf-8"><body><script>${out.outputFiles[0].text.replace(/<\/script>/g, "<\/script>")}</script>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];

/** One phone. `server` is the account row ({ settings, updatedAt } or null); `local` are stored keys before start. */
async function phone({ server, local = {}, email = "a@example.com" }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const state = { row: server, requests: [] };
  await page.exposeFunction("__serverSync", (bodyJson) => {
    const body = JSON.parse(bodyJson);
    state.requests.push(body);
    const when = body.updatedAt ? new Date(body.updatedAt) : null;
    if (when && (!state.row || when > new Date(state.row.updatedAt))) state.row = { settings: body.settings, updatedAt: when.toISOString() };
    return JSON.stringify({ success: true, settings: state.row ? state.row.settings : null, updatedAt: state.row ? state.row.updatedAt : null });
  });
  await page.evaluateOnNewDocument((local, email) => {
    localStorage.clear();
    localStorage.setItem("gp_account", JSON.stringify({ token: "t".repeat(64), user: { id: "u", email, displayName: "P" } }));
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      if (String(url).includes("/api/account/settings/sync")) {
        const text = await window.__serverSync(init.body);
        return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return realFetch(url, init);
    };
  }, local, email);
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://set.test/") ? r.respond({ status: 200, contentType: "text/html", body: html }) : r.abort()));
  await page.goto("http://set.test/");
  return { page, state };
}
const T_OLD = "2026-11-18T09:00:00.000Z";

try {
  // 1. New phone, nothing changed: receives the account's settings, uploads no time.
  {
    const { page, state } = await phone({ server: { settings: { gyro_maxAngle: 55, gp_language: "ja-JP", gp_rumble_on: false, gp_right_gain: 1.5, gyro_mode: "3d" }, updatedAt: T_OLD } });
    assert.equal(await page.evaluate(() => window.__t.syncSettings()), true);
    assert.equal(state.requests[0].updatedAt, null, "a phone that changed nothing sends no time");
    const got = await page.evaluate(() => ({ g: window.__t.prefs.loadGyroPrefs(), r: window.__t.prefs.loadRumbleOn(), lang: window.__t.currentLang(), gain: window.__t.stickFeel.rightGain }));
    assert.equal(got.g.maxAngle, 55); assert.equal(got.g.mode, "3d"); assert.equal(got.r, false);
    assert.equal(got.lang, "ja-JP"); assert.equal(got.gain, 1.5);
    assert.equal(state.row.updatedAt, T_OLD, "the account's settings were not overwritten");
    // 2. Now change a setting on this phone: it is uploaded with a time and wins.
    await page.evaluate(() => { const g = window.__t.prefs.loadGyroPrefs(); window.__t.prefs.saveGyroPrefs({ ...g, maxAngle: 70 }); window.__t.noteSettingsChanged(); });
    await page.evaluate(() => window.__t.syncSettings());
    assert.ok(state.requests[1].updatedAt, "a changed setting carries its time");
    assert.equal(state.row.settings.gyro_maxAngle, 70, "the newer change won on the account");
    await page.close();
  }
  // 3. Settings chosen before updating to 2.1 are a real change: uploaded.
  {
    const { page, state } = await phone({ server: null, local: { gyro_maxAngle: "40", gp_right_gain: "0.75" } });
    await page.evaluate(() => window.__t.syncSettings());
    assert.ok(state.requests[0].updatedAt, "earlier choices are sent with a time");
    assert.equal(state.row.settings.gyro_maxAngle, 40);
    assert.equal(state.row.settings.gp_right_gain, 0.75);
    await page.close();
  }
  // 3b. Untouched defaults on a fresh install are never uploaded as a "change".
  {
    const { page, state } = await phone({ server: null });
    await page.evaluate(() => { const g = window.__t.prefs.loadGyroPrefs(); window.__t.prefs.saveGyroPrefs(g); window.__t.noteSettingsChanged(); });
    await page.evaluate(() => window.__t.syncSettings());
    assert.equal(state.requests[0].updatedAt, null, "writing the defaults at start-up is not a change");
    assert.equal(state.row, null);
    await page.close();
  }
  // 4. This phone holds account B's settings; A signs in: nothing of B's is uploaded, A's come down.
  {
    const { page, state } = await phone({ email: "a@example.com", server: { settings: { gyro_maxAngle: 20 }, updatedAt: T_OLD },
      local: { gyro_maxAngle: "80", gp_settings_owner: "b@example.com", gp_settings_updated_at: "2026-11-18T11:00:00.000Z", gp_settings_seen: "x" } });
    await page.evaluate(() => window.__t.syncSettings());
    assert.equal(state.requests[0].updatedAt, null, "another account's settings are not uploaded");
    assert.equal(state.row.settings.gyro_maxAngle, 20);
    assert.equal(await page.evaluate(() => window.__t.prefs.loadGyroPrefs().maxAngle), 20, "A's own settings came down");
    await page.close();
  }
  // 5. Auto backup off: nothing uploaded, the account's settings still come down.
  {
    const { page, state } = await phone({ server: { settings: { gyro_deadzone: 7 }, updatedAt: T_OLD }, local: { gp_auto_sync: "0", gyro_maxAngle: "45" } });
    await page.evaluate(() => window.__t.syncSettings());
    assert.equal(state.requests[0].updatedAt, null, "no upload with Auto backup off");
    assert.equal(await page.evaluate(() => window.__t.prefs.loadGyroPrefs().deadzone), 7);
    await page.close();
  }
  // 6. Game rumble is saved.
  {
    const { page } = await phone({ server: null });
    await page.evaluate(() => window.__t.prefs.saveRumbleOn(false));
    assert.equal(await page.evaluate(() => localStorage.getItem("gp_rumble_on")), "0");
    assert.equal(await page.evaluate(() => window.__t.prefs.loadRumbleOn()), false);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("settings sync: OK (new phone receives, changes upload, old choices upload, defaults never overwrite, other account protected, auto backup off respected, rumble saved)");
} finally {
  await browser.close();
}
