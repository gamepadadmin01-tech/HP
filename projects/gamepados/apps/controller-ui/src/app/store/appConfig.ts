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
import { getAppInfo, nativeSetGuestRules } from "../platform/native";

export type FreeTimeConfig = {
  enabled: boolean;
  seconds: number;
  belowSeconds: number;
  perDay: number;
  title: string;
  body: string;
};

export type AppConfig = {
  ads: { available: boolean; message: string };
  guest: { welcomeSeconds: number; adRewardSeconds: number; adCapSeconds: number; freeTime: FreeTimeConfig };
  notice: { id: string; text: string } | null;
  kill: { message: string; storeUrl: string } | null;
};

const MIN = 60;
export const DEFAULT_CONFIG: AppConfig = {
  ads: { available: true, message: "" },
  guest: {
    welcomeSeconds: 30 * MIN,
    adRewardSeconds: 30 * MIN,
    adCapSeconds: 60 * MIN,
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
const REFRESH_MS = 15 * 60 * 1000;
const FOCUS_THROTTLE_MS = 2 * 60 * 1000;

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const str = (v: unknown, max: number, fallback = "") =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;

/** Anything missing or odd falls back to the built-in default; numbers are clamped. */
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
      ? { id: str(n.id, 32) || "notice", text: str(n.text, 800) }
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
    const q = `?channel=${encodeURIComponent(info.channel || "direct")}&versionCode=${encodeURIComponent(String(info.build || 0))}`;
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

/** The current guest numbers as words: { reward: "30 minutes", cap: "1 hour", welcome: "30 minutes" }. */
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
