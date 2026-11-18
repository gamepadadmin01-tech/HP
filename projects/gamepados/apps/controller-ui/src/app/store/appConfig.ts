// ─── App config from the server ──────────────────────────────────────────────
//
// What the app used to have baked into each APK and now asks the server for
// (GET /api/app-config, website/backend/appcontrol.js):
//
//   * ads      — are rewarded ads working? When not, the ad button stays visible
//                but disabled, guests get "Get free time", the plans screens say why.
//   * guest    — the signed-out time rules: one-time minutes, minutes per ad, the cap
//                under which an ad is offered, and the free-time button's numbers.
//   * notice   — one message for every player (the line at the top of Home).
//   * kill     — this exact build (channel + versionCode) has been switched off:
//                a full-screen lock sends the player to their store to update.
//
// The last answer is kept on the phone, so a killed build stays locked offline and
// the numbers survive a restart. Every number is CLAMPED here (and again natively in
// GuestTrial.kt): a wrong value on the server can make the app a little more or less
// generous, never unlimited.

import { API_ORIGIN } from "../api/account";
import { getInstallId } from "../feedback";
import { adNetwork, canSwitchAdNetwork, getAppInfo, nativeSetAdNetwork, nativeSetGuestRules } from "../platform/native";

export type FreeTimeConfig = {
  enabled: boolean;
  seconds: number;
  belowSeconds: number;
  perDay: number;
  title: string;
  body: string;
};

/** Where the notification's optional button goes (set in the portal's App control, 2026-11-08). */
export type NoticeActionKind = "link" | "plans" | "connect" | "settings" | "signin" | "layout";
export type NoticeAction = { kind: NoticeActionKind; label: string; url?: string };
const NOTICE_KINDS: NoticeActionKind[] = ["link", "plans", "connect", "settings", "signin", "layout"];

export type AppConfig = {
  ads: { available: boolean; message: string; network: "" | "admob" | "unity" };
  guest: { welcomeSeconds: number; adRewardSeconds: number; adCapSeconds: number; freeTime: FreeTimeConfig };
  /** translations: the notice in other app languages (2.1; portal "Translate"), by language code. */
  notice: { id: string; text: string; action?: NoticeAction; translations?: Record<string, { text: string; label?: string }> } | null;
  kill: { message: string; storeUrl: string } | null;
};

const MIN = 60;
export const DEFAULT_CONFIG: AppConfig = {
  ads: { available: true, message: "", network: "" },
  guest: {
    welcomeSeconds: 20 * MIN,   // 2026-11-09: 20 minutes free at the start (was 30)
    adRewardSeconds: 30 * MIN,
    adCapSeconds: 60 * MIN,     // 2026-11-09: ads only while under 1 hour is held (was 30 minutes)
    freeTime: {
      enabled: false, seconds: 30 * MIN, belowSeconds: 30 * MIN, perDay: 6,
      title: "Sign in to get unlimited time",
      body: "Rewarded ads aren't working right now, so we're giving free time instead. Signed-in players play unlimited until ads are back.",
    },
  },
  notice: null,
  kill: null,
};

const STORE_KEY = "gp_app_config_v1";
const REFRESH_MS = 5 * 60 * 1000;   // was 15 min: the portal's switches and notifications now reach an open app within ~5 min (2026-11-08)
const FOCUS_THROTTLE_MS = 2 * 60 * 1000;

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const str = (v: unknown, max: number, fallback = "") =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;

/** Anything missing or odd falls back to the built-in default; numbers are clamped. */
/** The button, only if it is one we know; a link only if it is a plain https:// address (the server
 *  checks this too, this is the second lock). Anything else: no button, the text still shows. */
function noticeAction(a: any): { action?: NoticeAction } {
  if (!a || typeof a !== "object" || !NOTICE_KINDS.includes(a.kind)) return {};
  const label = str(a.label, 30);
  if (!label) return {};
  if (a.kind !== "link") return { action: { kind: a.kind, label } };
  const url = typeof a.url === "string" ? a.url.trim() : "";
  try { if (new URL(url).protocol !== "https:") return {}; } catch { return {}; }
  return { action: { kind: "link", label, url: url.slice(0, 400) } };
}

/** The notice in other languages (2.1): short plain strings per language code, anything else dropped. */
function noticeTranslations(t: any): { translations?: Record<string, { text: string; label?: string }> } {
  if (!t || typeof t !== "object" || Array.isArray(t)) return {};
  const out: Record<string, { text: string; label?: string }> = {};
  for (const [code, v] of Object.entries(t).slice(0, 30)) {
    if (!/^[A-Za-z0-9-]{2,6}$/.test(code) || !v || typeof v !== "object") continue;
    const text = str((v as any).text, 800);
    if (!text) continue;
    const label = str((v as any).label, 30);
    out[code] = label ? { text, label } : { text };
  }
  return Object.keys(out).length ? { translations: out } : {};
}

function sanitize(raw: any): AppConfig {
  const d = DEFAULT_CONFIG;
  const g = raw?.guest ?? {};
  const f = g.freeTime ?? {};
  const k = raw?.kill;
  const n = raw?.notice;
  return {
    ads: {
      available: raw?.ads?.available !== false,
      message: str(raw?.ads?.message, 600),
      // Play build only: which ad network the portal chose for it (2026-11-09). "" = keep what it has.
      network: raw?.ads?.network === "admob" || raw?.ads?.network === "unity" ? raw.ads.network : "",
    },
    guest: {
      welcomeSeconds: num(g.welcomeSeconds, 0, 120 * MIN, d.guest.welcomeSeconds),
      adRewardSeconds: num(g.adRewardSeconds, 5 * MIN, 60 * MIN, d.guest.adRewardSeconds),
      adCapSeconds: num(g.adCapSeconds, 30 * MIN, 180 * MIN, d.guest.adCapSeconds),
      freeTime: {
        enabled: f.enabled === true,
        seconds: num(f.seconds, MIN, 60 * MIN, d.guest.freeTime.seconds),
        belowSeconds: num(f.belowSeconds, MIN, 60 * MIN, d.guest.freeTime.belowSeconds),
        perDay: num(f.perDay, 0, 50, d.guest.freeTime.perDay),
        title: str(f.title, 80, d.guest.freeTime.title) || d.guest.freeTime.title,
        body: str(f.body, 600, d.guest.freeTime.body) || d.guest.freeTime.body,
      },
    },
    notice: n && typeof n.text === "string" && n.text.trim()
      ? { id: str(n.id, 32) || "notice", text: str(n.text, 800), ...noticeAction(n.action), ...noticeTranslations(n.translations) }
      : null,
    kill: k && k.killed === true && typeof k.storeUrl === "string" && /^https:\/\//.test(k.storeUrl)
      ? { message: str(k.message, 600) || "This version is no longer supported. Please update to keep playing.", storeUrl: k.storeUrl }
      : null,
  };
}

function load(): AppConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch { /* storage off or a bad value: defaults */ }
  return DEFAULT_CONFIG;
}

let config: AppConfig = load();
const listeners = new Set<() => void>();

export function getAppConfig(): AppConfig {
  return config;
}

export function onAppConfigChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Hand the guest numbers to the phone's own clock (GuestTrial.kt clamps them again). */
function applyNative(c: AppConfig) {
  try { nativeSetGuestRules(c.guest.welcomeSeconds, c.guest.adRewardSeconds, c.guest.adCapSeconds); } catch { /* old APK */ }
  // The portal's ad network for the Play build (AdMob or Unity); every other build ignores it.
  try { if (c.ads.network) nativeSetAdNetwork(c.ads.network); } catch { /* old APK */ }
}

let inflight = false;
let lastAsk = 0;

export async function refreshAppConfig(): Promise<void> {
  if (inflight) return;
  inflight = true;
  lastAsk = Date.now();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const info = getAppInfo();
    const net = adNetwork();   // which ad network this build plays, so the server picks the right switch
    const q = `?channel=${encodeURIComponent(info.channel || "direct")}&versionCode=${encodeURIComponent(String(info.build || 0))}`
      + (net ? `&network=${encodeURIComponent(net)}` : "")
      // A Play build that can switch networks: the server answers with the network the portal chose for it.
      + (canSwitchAdNetwork() ? "&switchable=1" : "")
      // The app's random install id, so the portal can count active players (stored scrambled, once a day).
      + `&installId=${encodeURIComponent(getInstallId())}`
      // The phone's offset from UTC in minutes (India = 330), so scheduled notifications start at the
      // player's own local time (website/backend/noticeSchedule.js). Without it the server uses India time.
      + `&tz=${-new Date().getTimezoneOffset()}`;
    const res = await fetch(`${API_ORIGIN}/api/app-config${q}`, { cache: "no-store", signal: ctrl?.signal });
    if (!res.ok) return;                                   // keep what we had
    const json = await res.json();
    if (!json || json.success !== true) return;
    const next = sanitize(json);
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...next, kill: next.kill ? { killed: true, ...next.kill } : null })); } catch { /* ignore */ }
    const changed = JSON.stringify(next) !== JSON.stringify(config);
    config = next;
    applyNative(next);
    if (changed) listeners.forEach((fn) => fn());
  } catch {
    // Offline or a timeout: keep the last answer (and its kill state).
  } finally {
    if (timer) clearTimeout(timer);
    inflight = false;
  }
}

// ── Words built from the numbers, so the text always matches the rules ──────

/** 1800 → "30 minutes", 3600 → "1 hour", 5400 → "1 h 30 min". */
export function minutesText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60), r = m % 60;
  if (!r) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} h ${r} min`;
}

/** 1800 → "30 min", 3600 → "1 hr". Short, for buttons. */
export function minutesShort(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} hr`;
}

/** The current guest numbers as words: { reward: "30 minutes", cap: "30 minutes", welcome: "30 minutes" }. */
export function ruleWords() {
  const g = config.guest;
  return {
    reward: minutesText(g.adRewardSeconds),
    rewardShort: minutesShort(g.adRewardSeconds),
    cap: minutesText(g.adCapSeconds),
    welcome: minutesText(g.welcomeSeconds),
  };
}

/** What the out-of-time screens say, following the rules and whether ads work right now. */
export function outOfTimeText({ guest, playstore }: { guest: boolean; playstore: boolean }): string {
  const w = ruleWords();
  if (guest && !config.ads.available) {
    return "Your play time is used up. Ads aren't working right now: get free time below, or sign in for unlimited time.";
  }
  if (!guest) return `You're out of play time. Watch an ad for ${w.reward} more.`;
  // Play sells nothing (2026-09-30): an ad is the only way to more time there.
  return playstore
    ? `Your play time is used up. Watch an ad for ${w.reward} more.`
    : `Your play time is used up. Watch an ad for ${w.reward} more, or get Lifetime.`;
}

if (typeof window !== "undefined") {
  applyNative(config);                                     // last known numbers, before the network answers
  setTimeout(() => { void refreshAppConfig(); }, 0);
  setInterval(() => { void refreshAppConfig(); }, REFRESH_MS);
  const maybe = () => { if (Date.now() - lastAsk > FOCUS_THROTTLE_MS) void refreshAppConfig(); };
  window.addEventListener("focus", maybe);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) maybe(); });
}
