// ─── Rewarded ads: "Watch an ad · +30 min" ────────────────────────────────────
//
// The app's only ads, and only ever on a tap. Owner's rules (2026-09-28): one
// ad = 30 minutes, they stack and never expire, Lifetime never sees the button,
// signed in or out makes no difference. Since 2026-09-30: no daily free time
// (a one-time 30 minutes instead), and the button shows only while under an
// hour is left -- one ad still adds the full 30, so up to 89 minutes.
//
// Who grants the time is the whole design:
//   • Signed in — the SERVER, from Google's signed callback
//     (/api/ads/admob/reward). The phone only learns about it by re-reading
//     /api/billing/me, so after the ad this polls until the bank grows. Nothing
//     here can add a second to an account.
//   • Signed out — the phone (GuestTrial.creditAd), because there is no account
//     to credit; the one-time 30 free minutes are counted on the phone too.
//
// Android shows the ad and answers on window.onRewardedAdResult. A build
// without the AdMob SDK has no showRewardedAd at all, and the button never
// renders there (canShowAdButton).

import { getSession } from "./account";
import { getBillingState, refresh as refreshBilling } from "./billing";
import { guestTrial } from "./guestTrial";
import { adsSupported, showRewardedAd } from "../platform/native";

export type AdPhase = "idle" | "loading" | "crediting" | "done" | "error";
export type AdState = { phase: AdPhase; message: string };

const IDLE: AdState = { phase: "idle", message: "" };
let state: AdState = IDLE;
const listeners = new Set<() => void>();
const credited = new Set<() => void>();
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let bankBefore = 0;

function set(next: AdState) {
  state = next;
  listeners.forEach((fn) => fn());
}

/** Show a result, then fall back to idle so the button is usable again. */
function settle(phase: "done" | "error", message: string) {
  if (watchdog) clearTimeout(watchdog);
  set({ phase, message });
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => set(IDLE), 7000);
}

export function onAdChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAdState(): AdState {
  return state;
}

/** Fires once the 30 minutes are really there (or on their way, for a slow
 *  server) — e.g. the out-of-time screen restarts play. */
export function onAdCredited(fn: () => void): () => void {
  credited.add(fn);
  return () => credited.delete(fn);
}

function bankNow(): number {
  return getBillingState().entitlement?.adTime?.bankSeconds ?? 0;
}

/** Whether the button belongs on screen at all. */
export function canShowAdButton(): boolean {
  if (!adsSupported()) return false;
  // Ads only while under an hour is left (2026-09-30). The phone says so; an
  // older native side without the field falls back to the same sum here.
  if (!getSession()) {
    const t = guestTrial();
    return t.canEarnAd ?? t.remainingSeconds < 3600;
  }
  const ent = getBillingState().entitlement;
  // Until the plan is known, say nothing: offering an ad to a Lifetime holder
  // for the half-second before /billing/me answers would be wrong.
  if (!ent) return false;
  if (ent.unlimited) return false;
  return ent.adTime?.canEarn !== false;
}

/** Ads exist here and this player could earn, but already holds an hour or
 *  more: the button is hidden and a short note says why. */
export function adCapReached(): boolean {
  if (!adsSupported() || canShowAdButton()) return false;
  if (!getSession()) return !guestTrial().unlimited;   // open play: no ad, and no "you hold an hour" note
  const ent = getBillingState().entitlement;
  return !!ent && !ent.unlimited && ent.adTime?.canEarn === false;
}

/** The tap. Returns false when nothing will happen (no ads in this build, or
 *  one is already in progress). */
export function watchAd(): boolean {
  if (state.phase === "loading" || state.phase === "crediting") return false;
  const session = getSession();
  bankBefore = session ? bankNow() : 0;
  if (settleTimer) clearTimeout(settleTimer);
  set({ phase: "loading", message: "Loading an ad…" });
  if (!showRewardedAd(session?.user.id ?? "")) {
    settle("error", "Ads are not available in this version of the app.");
    return false;
  }
  // The answer normally comes when the ad closes. If Android never answers
  // (the app was killed mid-ad, a bridge fault), do not leave the button
  // spinning forever.
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    if (state.phase === "loading") settle("error", "The ad did not start. Try again in a minute.");
  }, 120_000);
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type NativeResult = { status: "rewarded" | "closed" | "failed" | "consent"; message?: string; guest?: boolean };

async function handle(r: NativeResult) {
  if (r.status === "rewarded") {
    if (r.guest || !getSession()) {
      guestTrial();                      // re-read the phone's clock: the bank just grew
      settle("done", "+30 minutes added. They never expire.");
      credited.forEach((fn) => fn());
      return;
    }
    set({ phase: "crediting", message: "Adding your 30 minutes…" });
    // Google calls our server a moment after the ad ends; poll until the bank
    // shows it. Usually the first or second read.
    for (let i = 0; i < 10; i++) {
      await sleep(i === 0 ? 1200 : 2000);
      try { await refreshBilling(); } catch { /* refresh fails soft */ }
      if (bankNow() > bankBefore) {
        settle("done", "+30 minutes added. They never expire.");
        credited.forEach((fn) => fn());
        return;
      }
    }
    // Google retries its callback, so a slow server is not a lost reward.
    settle("done", "Your 30 minutes are on the way — they will appear in a moment.");
    credited.forEach((fn) => fn());
    return;
  }
  if (r.status === "closed") { settle("error", "Watch the ad to the end to get the 30 minutes."); return; }
  settle("error", r.message || "No ad is available right now. Try again in a minute.");
}

(window as unknown as { onRewardedAdResult?: (json: string) => void }).onRewardedAdResult = (json: string) => {
  let r: NativeResult;
  try { r = JSON.parse(json) as NativeResult; } catch { return; }
  void handle(r);
};
