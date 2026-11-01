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
import { claimUnityAd, reportAdOutcome, type AdOutcomeResult } from "../api/billing";
import { guestTrial } from "./guestTrial";
import { adsSupported, getAppInfo, nativeCreditGuestFreeTime, showRewardedAd } from "../platform/native";
import { getAppConfig, minutesText, ruleWords } from "./appConfig";
import { getInstallId } from "../feedback";

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
  // Ads only while under 30 minutes are left (an hour until 2026-10-30). The phone says so; an
  // older native side without the field falls back to the same sum here.
  if (!getSession()) {
    const t = guestTrial();
    return t.canEarnAd ?? t.remainingSeconds < getAppConfig().guest.adCapSeconds;
  }
  const ent = getBillingState().entitlement;
  // Until the plan is known, say nothing: offering an ad to a Lifetime holder
  // for the half-second before /billing/me answers would be wrong.
  if (!ent) return false;
  if (ent.unlimited) return false;
  return ent.adTime?.canEarn !== false;
}

/** Ads exist here and this player could earn, but already holds 30 minutes or
 *  more: the button is hidden and a short note says why. */
export function adCapReached(): boolean {
  if (!adsSupported() || canShowAdButton()) return false;
  if (!getSession()) return true;
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

/** kind (on "failed"): who is to blame. "nofill" = the ad network had no ad, "error" = it failed on its
 *  own side (both earn the player free time, see below); "network" = the player's own connection;
 *  "other" = anything else (nothing is given). network = which ad network this build plays. */
type NativeResult = {
  status: "rewarded" | "closed" | "failed" | "consent"; message?: string; guest?: boolean; claim?: string;
  kind?: "nofill" | "error" | "network" | "other"; code?: string; network?: string;
};

/** Tell the server what happened to this tap -- it counts them (the portal's "How ads are doing")
 *  and decides whether a failure earns free time. Resolves null if it could not be reached. */
async function reportOutcome(r: NativeResult, result: AdOutcomeResult) {
  if (r.network !== "admob" && r.network !== "unity") return null;     // an app too old to say
  const info = getAppInfo();
  try {
    return await reportAdOutcome({
      installId: getInstallId(), network: r.network, result, code: r.code,
      channel: info.channel || "direct", versionCode: info.build || 0,
    }, getSession()?.token);
  } catch {
    return null;
  }
}

/** The ad network could not supply an ad: ask the server for the "sorry" time (20 minutes, 3 a day)
 *  and add it. A guest's minutes are added on the phone (like "Get free time"); a signed-in player's
 *  were banked by the server, so we only re-read the bank. Returns "" when the player got the time,
 *  a sentence to show when the daily limit stopped it, null when nothing could be given. */
async function compensate(r: NativeResult, result: "nofill" | "error"): Promise<string | null> {
  const signedIn = !!getSession();
  const out = await reportOutcome(r, result);
  if (out && !out.compensated && out.reason === "limit") {
    return "No ad is available right now, and today's free time is already used. Try again a bit later.";
  }
  if (!out || !out.compensated || !out.seconds) return null;
  if (signedIn) {
    await refreshBilling().catch(() => { /* refresh fails soft */ });
  } else {
    const c = nativeCreditGuestFreeTime(out.seconds, getAppConfig().guest.adCapSeconds);
    if (!c?.credited) return null;
    guestTrial();                                  // re-read the phone's clock: the bank just grew
  }
  settle("done", `We couldn't get an ad for you just now, so here are ${minutesText(out.seconds)} of free time.`);
  credited.forEach((fn) => fn());
  return "";
}

async function handle(r: NativeResult) {
  if (r.status === "rewarded") void reportOutcome(r, "rewarded");
  else if (r.status === "closed") void reportOutcome(r, "closed");
  if (r.status === "rewarded") {
    if (r.guest || !getSession()) {
      guestTrial();                      // re-read the phone's clock: the bank just grew
      settle("done", `+${ruleWords().reward} added. They never expire.`);
      credited.forEach((fn) => fn());
      return;
    }
    set({ phase: "crediting", message: `Adding your ${ruleWords().reward}…` });
    // Unity builds (direct, uptodown): there is no signed callback, so the phone hands over a
    // one-time claim id and WE ask the server to credit it (it applies the 30-minute rule).
    const session = getSession();
    if (r.claim && session) {
      try {
        const out = await claimUnityAd(session.token, r.claim);
        await refreshBilling().catch(() => { /* refresh fails soft */ });
        if (out.credited) {
          settle("done", `+${ruleWords().reward} added. They never expire.`);
          credited.forEach((fn) => fn());
        } else {
          settle("error", `You already have ${ruleWords().cap} or more saved, so this ad added nothing.`);
        }
      } catch {
        settle("error", "Couldn't add your time. Check your internet and watch the ad again.");
      }
      return;
    }
    // AdMob: Google calls our server a moment after the ad ends; poll until the bank
    // shows it. Usually the first or second read.
    for (let i = 0; i < 10; i++) {
      await sleep(i === 0 ? 1200 : 2000);
      try { await refreshBilling(); } catch { /* refresh fails soft */ }
      if (bankNow() > bankBefore) {
        settle("done", `+${ruleWords().reward} added. They never expire.`);
        credited.forEach((fn) => fn());
        return;
      }
    }
    // Google retries its callback, so a slow server is not a lost reward.
    settle("done", "Your time is on the way. It will appear in a moment.");
    credited.forEach((fn) => fn());
    return;
  }
  if (r.status === "closed") { settle("error", `Watch the ad to the end to get the ${ruleWords().reward}.`); return; }
  const sorry = r.message || "No ad is available right now. Try again in a minute.";
  if (r.status === "failed" && r.kind) {
    if (r.kind === "nofill" || r.kind === "error") {
      set({ phase: "crediting", message: "No ad for you right now. Adding free time…" });
      const done = await compensate(r, r.kind);
      if (done === "") return;                    // the free time was added and announced
      if (done) { settle("error", done); return; }
    } else {
      void reportOutcome(r, r.kind);
    }
  }
  settle("error", sorry);
}

/** Time added another way (the guest "Get free time" button): shown like an ad's result and
 *  told to the same listeners, so the out-of-time screen restarts play and every plans screen
 *  re-reads the phone's clock. */
export function announceExtraTime(message: string) {
  guestTrial();
  settle("done", message);
  credited.forEach((fn) => fn());
}

(window as unknown as { onRewardedAdResult?: (json: string) => void }).onRewardedAdResult = (json: string) => {
  let r: NativeResult;
  try { r = JSON.parse(json) as NativeResult; } catch { return; }
  void handle(r);
};
