// ─── Plan + quota state ───────────────────────────────────────────────────────
//
// What the signed-in user is allowed to do, and how much of today they have
// left. Kept separate from store/account.ts on purpose: identity changes rarely
// and survives offline, whereas an entitlement is a server fact with a clock
// attached and has to be re-read.
//
// Three things this file is careful about:
//
//   • The phone's clock is never trusted. The server sends `serverTime` with
//     every answer; we record the offset once against a MONOTONIC timer
//     (performance.now) and tick from that. Changing the timezone in Settings
//     must not roll "today" over and hand out a second free hour.
//
//   • The last answer is cached, so opening the Account tab shows the plan
//     immediately instead of a spinner, and still says something useful with no
//     signal. The cache is display only — it can never grant anything.
//
//   • Signing out clears it. An entitlement belongs to an account, and leaving a
//     stale "Lifetime" on screen after a sign-out would be a lie.

import { readJson, writeJson, remove, KEYS } from "./storage";
import { getSession, onSessionChange } from "./account";
import * as api from "../api/billing";
import { ApiError } from "../api/account";
import { getAppInfo } from "../platform/native";

export type BillingState = {
  /** "stale" = showing a cached answer while a fresh one is in flight. */
  status: "signedOut" | "loading" | "ready" | "stale" | "error";
  entitlement: api.Entitlement | null;
  catalogue: api.Catalogue | null;
  /** Only set when status is "error", and safe to show the user. */
  message: string;
};

const EMPTY: BillingState = {
  status: "signedOut",
  entitlement: null,
  catalogue: null,
  message: "",
};

const listeners = new Set<() => void>();
let state: BillingState = EMPTY;
let inFlight: Promise<void> | null = null;
let loadedCache = false;

/** Milliseconds to add to Date.now() to get server time. Set from the last
 *  answer; 0 until we have heard from the server at all. */
let clockSkewMs = 0;

function emit() {
  listeners.forEach((fn) => fn());
}

function set(next: Partial<BillingState>) {
  state = { ...state, ...next };
  emit();
}

// ─── Cache ────────────────────────────────────────────────────────────────────

type Cached = { entitlement: api.Entitlement; catalogue: api.Catalogue | null; email: string };

function loadCache() {
  if (loadedCache) return;
  loadedCache = true;
  const session = getSession();
  if (!session) return;
  const c = readJson<Cached | null>(KEYS.billing, null);
  // Bound to the email it was written for: a different account must never
  // inherit the previous one's plan, even for the half-second before the
  // network answers.
  if (c && c.entitlement && c.email === session.user.email) {
    state = { status: "stale", entitlement: c.entitlement, catalogue: c.catalogue, message: "" };
  }
}

function saveCache() {
  const session = getSession();
  if (!session || !state.entitlement) return;
  writeJson(KEYS.billing, {
    entitlement: state.entitlement,
    catalogue: state.catalogue,
    email: session.user.email,
  });
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export function onBillingChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Safe to call during render. */
export function getBillingState(): BillingState {
  loadCache();
  return state;
}

// Signing in or out invalidates everything here.
onSessionChange(() => {
  const session = getSession();
  if (!session) {
    state = EMPTY;
    loadedCache = true;
    remove(KEYS.billing);
    emit();
    return;
  }
  state = { ...EMPTY, status: "loading" };
  loadedCache = true;
  emit();
  void refresh();
});

// ─── The clock ────────────────────────────────────────────────────────────────

function noteServerTime(iso: string) {
  const t = Date.parse(iso);
  if (Number.isFinite(t)) clockSkewMs = t - Date.now();
}

/** Server time as a millisecond timestamp. Use this for every countdown and
 *  every "resets at" comparison — never Date.now() on its own. */
export function serverNow(): number {
  return Date.now() + clockSkewMs;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Re-read the plan and the catalogue.
 *
 * Concurrent callers share one request — the Account tab mounting while a
 * purchase is settling must not fire two.
 */
export function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  const session = getSession();
  if (!session) {
    state = EMPTY;
    emit();
    return Promise.resolve();
  }

  // Always announce "loading", not just on the first-ever call. Gating this
  // on `!state.entitlement` was the actual reason the refresh button in
  // PlanPanel looked broken: after the first successful load, every later tap
  // fetched fine in the background but never flipped status away from
  // "ready", so the button's spin icon (bound to status === "loading") never
  // moved — no feedback that anything happened at all, especially when the
  // numbers coming back were unchanged. The full-panel loading view is still
  // guarded elsewhere by `state.status === "loading" && !ent`, so this does
  // not regress into a blank screen on a manual refresh — it only makes the
  // small spinner honest.
  set({ status: "loading", message: "" });

  const channel = getAppInfo().channel || "direct";

  inFlight = (async () => {
    try {
      // The catalogue is public and rarely changes; the entitlement is the one
      // that matters. Fetched together so the panel never renders half-filled.
      const [me, plans] = await Promise.all([
        api.getMe(session.token),
        api.getPlans(channel).catch(() => null),   // a missing catalogue hides
      ]);                                          // the cards, not the plan
      noteServerTime(me.serverTime);
      state = {
        status: "ready",
        entitlement: me,
        catalogue: plans ? { ...plans } : state.catalogue,
        message: "",
      };
      saveCache();
      emit();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load your plan.";
      // Offline with a cached answer is not an error worth shouting about —
      // keep showing what we had and stay quiet.
      if (state.entitlement && e instanceof ApiError && e.code === "network") {
        set({ status: "stale", message: "" });
      } else {
        set({ status: "error", message: msg });
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Redeem a promo code, then re-read the plan so the panel reflects it. */
export async function redeemPromo(code: string): Promise<api.PlanCode> {
  const session = getSession();
  if (!session) throw new ApiError("You are not signed in.", "unauthenticated");
  const r = await api.redeemPromo(session.token, code);
  await refresh();
  return r.plan;
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/** Seconds left today, or null when the plan is unlimited. */
export function remainingSeconds(s: BillingState): number | null {
  if (!s.entitlement) return null;
  if (s.entitlement.unlimited) return null;
  return Math.max(0, s.entitlement.today.remainingSeconds ?? 0);
}

/** True when a limited plan has nothing left today. */
export function isExhausted(s: BillingState): boolean {
  const left = remainingSeconds(s);
  return left !== null && left <= 0;
}

/** "1h 00m" / "42m" / "38s" — the shape the quota is actually read in. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** ₹400 from 40000. Minor units, and the currency symbol only for the ones we
 *  actually sell in — anything else falls back to the ISO code so a new
 *  currency reads as "USD 5.00" rather than "₹5.00". */
export function formatPrice(minor: number, currency: string): string {
  const major = minor / 100;
  const text = Number.isInteger(major) ? String(major) : major.toFixed(2);
  if (currency === "INR") return `₹${text}`;
  if (currency === "USD") return `$${text}`;
  return `${currency} ${text}`;
}

/** When today's quota comes back, in the user's own words. The reset boundary
 *  is decided server-side per account, so this only formats what it is told. */
export function formatResetsAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const left = Math.max(0, t - serverNow());
  const hours = Math.floor(left / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  if (hours >= 1) return `Resets in ${hours}h ${String(mins).padStart(2, "0")}m`;
  if (mins >= 1) return `Resets in ${mins}m`;
  return "Resets shortly";
}
