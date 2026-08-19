// ─── The playtime clock ───────────────────────────────────────────────────────
//
// Counts the time a capped plan is spending, reports it to the server, forwards
// the PC's capability ticket, and says when the quota is gone.
//
// ## What starts and stops it
//
// `isActive` on ControllerScreen — the signal added in 1.3.23 to fix the
// always-streaming bug. BILLING_DECISIONS §2.2 is explicit that this must be
// the gate and that a second one must not be invented: if the two ever
// disagreed, the app would bill for time it was not streaming.
//
// The clock is deliberately NOT conditional on the PC being connected. Opening
// the controller to look at a layout burns free minutes. That is a known,
// accepted trade — predictable and easy to explain, which is why it was chosen
// over a link-dependent rule.
//
// ## Why it counts locally as well as on the server
//
// Effective usage is `max(local, server)` (§2.2b). Counting only on the server
// would hand every offline player unlimited time; counting only locally would
// make "clear app data" a reset button that any forum post could teach. Taking
// the higher of the two closes both.
//
// A free user who defeats this costs nothing — gameplay is phone-to-PC over the
// LAN, with no seat and no bandwidth on our side. The integrity that matters is
// on the PAID side, and that stays server-verified through purchase tokens and
// signatures. This is an honest-user mechanism and is meant to be no stronger.
//
// ## The ticket
//
// Each server answer carries a short-lived Ed25519 ticket. Forwarding it arms
// the PC's gate; when quota runs out the server simply stops issuing them and
// the PC tears the session down on its own within the ticket's TTL. Nothing
// here has to reach out and kill anything, so a backend outage cannot strand a
// session in a killed state.
//
// A build whose bridge predates `sendPlaytimeTicket`, or a PC older than 2.1.0,
// never arms — and an un-armed gate never expires. That is the §2.5 rollout
// working as designed, not a failure.

import * as api from "../api/billing";
import { ApiError } from "../api/account";
import { getSession } from "./account";
import { getBillingState, refresh as refreshBilling } from "./billing";
import { sendPlaytimeTicket } from "../platform/native";
import { readJson, writeJson, KEYS } from "./storage";

export type PlaytimeStatus =
  /** Controller closed. */
  | "idle"
  /** Opening a session. */
  | "starting"
  /** Counting. */
  | "playing"
  /** Unlimited plan — running, but nothing to count. */
  | "unlimited"
  /** Signed out, or no plan known. Play is not gated. */
  | "untracked"
  /** Quota spent. The controller must not keep streaming. */
  | "blocked";

export type PlaytimeState = {
  status: PlaytimeStatus;
  /** null when unlimited or untracked. */
  remainingSeconds: number | null;
  limitSeconds: number | null;
  resetsAt: string | null;
  /** Safe to show. Empty unless something needs saying. */
  message: string;
};

const IDLE: PlaytimeState = {
  status: "idle",
  remainingSeconds: null,
  limitSeconds: null,
  resetsAt: null,
  message: "",
};

const listeners = new Set<() => void>();
let state: PlaytimeState = IDLE;

function emit() {
  listeners.forEach((fn) => fn());
}

function set(next: Partial<PlaytimeState>) {
  state = { ...state, ...next };
  emit();
}

export function onPlaytimeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPlaytimeState(): PlaytimeState {
  return state;
}

// ─── Selectors ────────────────────────────────────────────────────────────────
//
// The controller MUST NOT subscribe to the whole state object. `set()` builds a
// new object every second while the clock ticks, so a component reading it
// through useSyncExternalStore re-renders once a second -- and on the controller
// screen that means re-rendering the entire pad SVG, in the middle of play,
// forever. These selectors return primitives instead, so React's Object.is check
// short-circuits and nothing re-renders until the value genuinely changes.

/** Flips at most once per session. Safe for the controller to subscribe to. */
export function isBlocked(): boolean {
  return state.status === "blocked";
}

export type PlaytimeAlert = "none" | "warn-15" | "warn-10" | "warn-5";

/** Which countdown warning is currently showing, if any. A short-lived string,
 *  so subscribing costs a re-render only when a warning appears or clears. */
export function getPlaytimeAlert(): PlaytimeAlert {
  return alert;
}

// Minutes remaining at which the user is told. Each fires once per period --
// crossing 15 does not re-fire when the clock wobbles back over the boundary
// after a heartbeat reconciles usage upward.
const WARN_AT_MINUTES = [15, 10, 5];
const ALERT_VISIBLE_MS = 6000;

let alert: PlaytimeAlert = "none";
let alertTimer: ReturnType<typeof setTimeout> | null = null;
let warned = new Set<number>();

function raiseAlert(minutes: number) {
  alert = ("warn-" + minutes) as PlaytimeAlert;
  emit();
  if (alertTimer) clearTimeout(alertTimer);
  // Cleared by an explicit timer rather than by comparing clocks inside the
  // getter: useSyncExternalStore requires getSnapshot to keep returning the same
  // value until something notifies it, and a getter that decays on its own
  // breaks that contract.
  alertTimer = setTimeout(() => {
    alert = "none";
    alertTimer = null;
    emit();
  }, ALERT_VISIBLE_MS);
}

function clearAlerts() {
  if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }
  if (alert !== "none") { alert = "none"; emit(); }
}

/** Fire the highest warning the remaining time has just dropped past. */
function checkWarnings(left: number | null) {
  if (left === null) return;
  for (const m of WARN_AT_MINUTES) {
    if (left <= m * 60 && !warned.has(m)) {
      warned.add(m);
      raiseAlert(m);
      return;   // one at a time; the lower ones fire as the clock reaches them
    }
  }
}

// ─── Local counter ────────────────────────────────────────────────────────────

type LocalUsage = {
  /** The period this belongs to — the server's `resetsAt`. A different value
   *  means a new day and the count starts again. */
  periodKey: string;
  usedSeconds: number;
};

function loadLocal(): LocalUsage {
  const v = readJson<LocalUsage | null>(KEYS.playtime, null);
  if (v && typeof v.periodKey === "string" && typeof v.usedSeconds === "number") return v;
  return { periodKey: "", usedSeconds: 0 };
}

function saveLocal(u: LocalUsage) {
  writeJson(KEYS.playtime, u);
}

/**
 * How much time THIS DEVICE has counted for the given period.
 *
 * Exported so the Account panel can show the number that is actually enforced.
 * The clock bills `max(local, server)`, but the panel was rendering the server's
 * figure alone — so a device whose local count had run ahead (the normal state
 * between heartbeats, and always after offline play) showed "15 min left" and
 * then refused to start. Two different numbers for the same thing.
 *
 * Returns 0 when the stored count belongs to a different period: a stale
 * yesterday must never be folded into today.
 */
export function localUsedSeconds(resetsAt: string): number {
  const v = loadLocal();
  return v.periodKey === resetsAt ? v.usedSeconds : 0;
}

/** A stable per-install id. Random, persisted, and not derived from anything
 *  about the hardware — it only has to tell this install apart from the other
 *  device the same account was playing on. */
function deviceId(): string {
  let id = readJson<string | null>(KEYS.deviceId, null);
  if (typeof id === "string" && id.length >= 8) return id;
  id = "d-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  writeJson(KEYS.deviceId, id);
  return id;
}

// ─── Session ──────────────────────────────────────────────────────────────────

let sessionId: string | null = null;
let fence = 0;
let seq = 0;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let local: LocalUsage = { periodKey: "", usedSeconds: 0 };
let limitSeconds: number | null = null;
let unlimited = false;
/** Guards against beginPlay/endPlay racing on a fast open-close. */
let generation = 0;

function clearTimers() {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function forward(ticket: string | null | undefined) {
  if (ticket) sendPlaytimeTicket(ticket);
}

/** Fold a server answer into the local counter, taking the higher of the two. */
function reconcile(usedSeconds: number, resetsAt: string) {
  if (local.periodKey !== resetsAt) {
    // New period: the server's number is the truth to start from, and the
    // warnings the user already saw belong to a day that is over.
    warned = new Set();
    local = { periodKey: resetsAt, usedSeconds };
  } else {
    local = { periodKey: resetsAt, usedSeconds: Math.max(local.usedSeconds, usedSeconds) };
  }
  saveLocal(local);
}

function remaining(): number | null {
  if (unlimited || limitSeconds === null) return null;
  return Math.max(0, limitSeconds - local.usedSeconds);
}

/**
 * Work out the daily cap from a server answer.
 *
 * Every playtime response carries `remainingSeconds` alongside the usage it just
 * recorded, so the cap is simply the sum. Deriving it here rather than reading
 * it from the billing store matters: this clock must not depend on the Account
 * tab having been opened. It previously did, and the failure was silent -- with
 * no cached entitlement, `limitSeconds` stayed null, `tick()` returned early,
 * and the quota was never counted or enforced at all.
 */
function noteRemaining(used: number, remainingSeconds: number | null | undefined) {
  if (unlimited) { limitSeconds = null; return; }
  if (typeof remainingSeconds === "number") {
    limitSeconds = used + remainingSeconds;
  }
}

function publish(status: PlaytimeStatus, message = "") {
  set({
    status,
    remainingSeconds: remaining(),
    limitSeconds,
    resetsAt: local.periodKey || null,
    message,
  });
}

function block(message: string) {
  clearTimers();
  clearAlerts();   // the lockout says it better than a 5-minute warning does
  const id = sessionId;
  const f = fence;
  const sq = ++seq;
  sessionId = null;
  publish("blocked", message);
  // Tell the server before letting go of the session id.
  //
  // The local counter is what stops play, and it can reach the limit between
  // two heartbeats — a whole minute during which the server still believes
  // there is time left. Releasing the session without flushing meant endPlay()
  // found no id, skipped its stop call, and the Account tab went on showing
  // "4s left" underneath a lockout saying the day was over. The heartbeat bills
  // the real total; the stop closes cleanly rather than waiting for the reaper.
  void flushAndRefresh(id, f, sq);
}

async function flushAndRefresh(id: string | null, f: number, sq: number) {
  const session = getSession();
  if (id && session) {
    try {
      await api.heartbeatSession(session.token, {
        sessionId: id, fence: f, seq: sq, clientSeconds: local.usedSeconds,
      });
    } catch {
      // A 402 here is the expected answer, not a failure: the server agrees the
      // quota is gone and has closed the session itself.
    }
    try {
      await api.stopSession(session.token, { sessionId: id, fence: f });
    } catch { /* already closed by the 402 above */ }
  }
  // Only now is the panel in Account guaranteed to agree with the overlay.
  void refreshBilling();
}

/** One second of play. Counts even while the app is backgrounded with the
 *  controller open — that is the rule, not an oversight. */
function tick() {
  if (unlimited || limitSeconds === null) return;
  local = { ...local, usedSeconds: local.usedSeconds + 1 };
  saveLocal(local);
  const left = remaining();
  if (left !== null && left <= 0) {
    block("You're out of time — upgrade to play more, or wait for your next quota.");
    return;
  }
  checkWarnings(left);
  publish("playing");
}

async function beat(myGeneration: number) {
  if (myGeneration !== generation || !sessionId) return;
  const session = getSession();
  if (!session) return;

  seq += 1;
  try {
    const r = await api.heartbeatSession(session.token, {
      sessionId,
      fence,
      seq,
      clientSeconds: local.usedSeconds,
    });
    if (myGeneration !== generation) return;

    unlimited = r.unlimited;
    reconcile(r.usedSeconds, r.resetsAt);
    noteRemaining(r.usedSeconds, r.remainingSeconds);
    forward(r.ticket);
    publish(unlimited ? "unlimited" : "playing");
    schedule(myGeneration, r.nextHeartbeatMs || 60_000);
  } catch (e) {
    if (myGeneration !== generation) return;
    const err = e instanceof ApiError ? e : null;

    if (err && err.code === "QUOTA_EXHAUSTED") {
      // The server closed the session and billed what was owed before saying
      // so, which is why this is terminal rather than retried.
      const payload = (err as ApiError & { payload?: { usedSeconds?: number; resetsAt?: string } }).payload;
      if (payload?.resetsAt) reconcile(payload.usedSeconds ?? local.usedSeconds, payload.resetsAt);
      block(err.message || "Daily playtime used up.");
      return;
    }

    if (err && (err.code === "SESSION_GONE" || err.code === "410")) {
      // Reaped, or taken over on another device. Try to reopen once; if the
      // quota is genuinely gone, start() will say so.
      sessionId = null;
      clearTimers();
      void beginPlay();
      return;
    }

    // Anything else — offline, a 500, DNS — must not stop play. Keep counting
    // locally and try again on the next beat.
    schedule(myGeneration, 60_000);
  }
}

function schedule(myGeneration: number, ms: number) {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => void beat(myGeneration), Math.max(15_000, ms));
}

// ─── Entry points ─────────────────────────────────────────────────────────────

/**
 * The controller opened. Start counting.
 *
 * Never throws and never blocks the UI: a failure here leaves play running and
 * untracked rather than locking someone out because a request timed out.
 */
export async function beginPlay(): Promise<void> {
  const myGeneration = ++generation;
  clearTimers();

  const session = getSession();
  if (!session) {
    // Signing in to play is a separate product gate (§2.3) and is deliberately
    // NOT switched on here — turning it on silently would put a wall between
    // install and first play with no warning release in front of it.
    publish("untracked");
    return;
  }

  // Start from whatever is on disk so an offline session still counts, and so a
  // spent quota is spent before the first request comes back.
  local = loadLocal();
  // The clock can be started without the Account tab ever having been opened,
  // in which case nothing has fetched the entitlement yet. Fetch it now --
  // refresh() is single-flight and fails soft, so this costs one request at
  // most and never blocks play on a network error.
  if (!getBillingState().entitlement) {
    try { await refreshBilling(); } catch { /* handled inside refresh */ }
  }
  if (myGeneration !== generation) return;
  const ent = getBillingState().entitlement;
  unlimited = ent?.unlimited ?? false;
  limitSeconds = ent?.today.limitSeconds ?? null;
  if (ent) {
    reconcile(Math.max(local.usedSeconds, ent.today.usedSeconds), ent.resetsAt);
    const left = remaining();
    if (left !== null && left <= 0) {
      publish("blocked", "You're out of time — upgrade to play more, or wait for your next quota.");
      return;
    }
  }

  publish(unlimited ? "unlimited" : "starting");

  let started: api.SessionStart;
  try {
    started = await api.startSession(session.token, {
      deviceId: deviceId(),
      deviceLabel: "This phone",
    });
  } catch (e) {
    if (myGeneration !== generation) return;
    const err = e instanceof ApiError ? e : null;

    if (err && err.code === "QUOTA_EXHAUSTED") {
      publish("blocked", err.message || "Daily playtime used up.");
      return;
    }
    if (err && err.code === "SESSION_EXISTS") {
      // Playing on another device. Taking over is the behaviour a user expects
      // from picking up a different phone, and the server enforces one session
      // either way.
      try {
        started = await api.startSession(session.token, {
          deviceId: deviceId(),
          deviceLabel: "This phone",
          takeover: true,
        });
      } catch {
        if (myGeneration !== generation) return;
        startLocalOnly(myGeneration);
        return;
      }
    } else {
      // Offline or server trouble: count locally, enforce locally, keep playing.
      startLocalOnly(myGeneration);
      return;
    }
  }

  if (myGeneration !== generation) return;

  sessionId = started.sessionId;
  fence = started.fence;
  seq = 0;
  unlimited = started.unlimited;
  reconcile(local.usedSeconds, started.resetsAt);
  noteRemaining(local.usedSeconds, started.remainingSeconds);
  forward(started.ticket);

  // The server may already consider the quota spent even though it opened a
  // session -- for instance when this device counted more offline than the
  // server had recorded.
  const leftNow = remaining();
  if (leftNow !== null && leftNow <= 0) {
    block("You're out of time — upgrade to play more, or wait for your next quota.");
    return;
  }

  if (!unlimited) tickTimer = setInterval(tick, 1000);
  publish(unlimited ? "unlimited" : "playing");
  schedule(myGeneration, started.nextHeartbeatMs || 60_000);
}

/** No session, but a known limit: count and enforce on this device alone. */
function startLocalOnly(myGeneration: number) {
  if (myGeneration !== generation) return;
  sessionId = null;
  if (unlimited || limitSeconds === null) {
    publish(unlimited ? "unlimited" : "untracked");
    return;
  }
  tickTimer = setInterval(tick, 1000);
  publish("playing");
  // Keep trying to re-establish: the moment the network returns, usage syncs.
  schedule(myGeneration, 60_000);
}

/** The controller closed. Bill the remainder and stop. */
export async function endPlay(): Promise<void> {
  generation += 1;
  clearTimers();
  clearAlerts();
  const id = sessionId;
  sessionId = null;
  state = IDLE;
  emit();

  const session = getSession();
  if (!id || !session) return;
  try {
    await api.stopSession(session.token, { sessionId: id, fence });
  } catch {
    // A clean close is an optimisation — the server reaps abandoned sessions on
    // its own, capped at the grace window.
  }
  void refreshBilling();
}

/** After a purchase or a promo: drop the block and let the user back in without
 *  making them reopen the controller. */
export function clearBlock() {
  if (state.status === "blocked") {
    local = loadLocal();
    publish("idle");
  }
}
