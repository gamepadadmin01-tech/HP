// In-app rating feedback: device info + offline-safe queue + auto-sync.
//
// The rating is delivered through the SAME backend endpoint the support tray
// already uses (POST /api/support/ticket) — that pipeline auto-routes to the
// admin Inbox, broadcasts `ticket:new` to open dashboards, and is counted like
// any ticket, so no backend change is needed to "deliver to the inbox + keep a
// count". The star rating and device details ride in the ticket message.
//
// Offline safety: a submit that can't reach the network is persisted to
// localStorage and retried automatically when connectivity returns — the rating
// is never lost. All of this is fire-and-forget; the UI never blocks on it.

// Built from API_ORIGIN rather than hardcoded, so a build pointed at a LAN
// backend (VITE_API_ORIGIN) files its test feedback there instead of raising
// real support tickets on the live desk.
import { API_ORIGIN } from "./api/account";

export const FEEDBACK_URL = `${API_ORIGIN}/api/support/ticket`;
const QUEUE_KEY = "pending_feedback_v1";
// Schema requires a valid email; a rating has none, so we send a clearly
// non-reply marker address (valid format, obviously not a real inbox).
const RATING_EMAIL = "app-rating@gamepad.space";
const INSTALL_ID_KEY = "install_id_v1";

/**
 * A stable, anonymous per-install identifier.
 *
 * WHY: every rating is submitted under the same RATING_EMAIL, and the admin
 * portal groups a person's tickets by email — so without this, all ratings from
 * all users collapse into one apparent person, and a 1/5 from a stranger reads
 * as the same customer who left a 5/5 yesterday. Model + OS + app version can't
 * separate them either: every OnePlus 8 Pro on Android 11 produces an identical
 * fingerprint.
 *
 * This is a random number generated on this install, NOT a device identifier.
 * No IMEI, no MAC, no ANDROID_ID — Play policy forbids or discourages all of
 * those for this purpose, and none of them are needed to answer the only
 * question being asked: "are these two ratings the same install or not?"
 *
 * It resets on reinstall or clear-data. That is the correct trade-off for
 * something anonymous: it can distinguish installs without ever identifying
 * a person or following them across one.
 */
export function getInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);
    if (existing && /^[0-9a-f]{16}$/.test(existing)) return existing;
  } catch {
    /* storage disabled — fall through and return an ephemeral id */
  }
  const id = randomHex16();
  try {
    localStorage.setItem(INSTALL_ID_KEY, id);
  } catch {
    /* can't persist; the id is still useful within this session */
  }
  return id;
}

/** 64 random bits as hex. Uses the crypto RNG, with a fallback for old WebViews. */
function randomHex16(): string {
  const c = typeof crypto !== "undefined" ? (crypto as Crypto) : undefined;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(8);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  // Pre-crypto WebView. Weaker, but this only has to avoid collisions between
  // installs, not resist an attacker — there is nothing here worth forging.
  let s = "";
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  os: string;
  appVersion: string;
  appCode: string;
}

/** Device + app details, from the native bridge when present, else the UA. */
export function getDeviceInfo(): DeviceInfo {
  const bridge = (window as any).AndroidBridge;
  if (bridge && bridge.getDeviceInfoJson) {
    try {
      const d = JSON.parse(bridge.getDeviceInfoJson());
      return {
        model: String(d.model || "unknown"),
        manufacturer: String(d.manufacturer || "unknown"),
        os: String(d.os || "Android"),
        appVersion: String(d.appVersion || "unknown"),
        appCode: String(d.appCode || "?"),
      };
    } catch {
      /* fall through to the UA fallback */
    }
  }
  // Browser / no-bridge fallback (e.g. the offline preview).
  return {
    model: "web",
    manufacturer: "web",
    os: (typeof navigator !== "undefined" && navigator.userAgent) || "unknown",
    appVersion: "web",
    appCode: "?",
  };
}

interface QueuedRating {
  stars: number;
  ts: number;        // when the user rated (ms); stamped, never Date.now() in a loop
  device: DeviceInfo;
  note?: string;     // what went wrong, asked for on a low rating
  installId?: string; // optional: ratings queued before this field existed have none
}

function readQueue(): QueuedRating[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedRating[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage full / disabled — nothing we can safely do */
  }
}

function ratingToTicket(r: QueuedRating) {
  const d = r.device;
  const stamp = new Date(r.ts).toISOString();
  const message =
    `In-app rating: ${r.stars}/5\n\n` +
    (r.note ? `What they told us:\n${r.note}\n\n` : "") +
    `Rated: ${stamp}\n` +
    `Device: ${d.manufacturer} ${d.model}\n` +
    `OS: ${d.os}\n` +
    `App: ${d.appVersion} (code ${d.appCode})` +
    // Last line, and omitted entirely when absent, so ratings queued by an older
    // build still render cleanly in the portal.
    (r.installId ? `\nInstall: ${r.installId}` : "");
  return {
    name: "App User",
    email: RATING_EMAIL,
    subject: "feedback",
    message,
    source: "mobile",
  };
}

/** POST one rating. Resolves true on a 2xx, false on any network/server error. */
async function postRating(r: QueuedRating): Promise<boolean> {
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ratingToTicket(r)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let flushing = false;

/**
 * Try to send every queued rating. Successful ones are removed; failures stay
 * for the next attempt. Safe to call repeatedly and concurrently (guarded).
 * When the queue drains, the online listener is detached (nothing left to sync).
 */
export async function flushFeedbackQueue(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = readQueue();
  if (queue.length === 0) {
    detachSync();
    return;
  }
  flushing = true;
  try {
    const remaining: QueuedRating[] = [];
    for (const r of queue) {
      const ok = await postRating(r);
      if (!ok) remaining.push(r);
    }
    writeQueue(remaining);
    if (remaining.length === 0) detachSync();
  } finally {
    flushing = false;
  }
}

let syncAttached = false;
function onlineHandler() {
  void flushFeedbackQueue();
}
/** Attach the reconnect listener (idempotent). */
function attachSync() {
  if (syncAttached || typeof window === "undefined") return;
  window.addEventListener("online", onlineHandler);
  syncAttached = true;
}
/** Detach it once there's nothing left to sync — no idle listener lingers. */
function detachSync() {
  if (!syncAttached || typeof window === "undefined") return;
  window.removeEventListener("online", onlineHandler);
  syncAttached = false;
}

/**
 * Submit a star rating. Tries to send immediately; if that fails (offline or
 * server error) it is queued and retried automatically on reconnect. Never
 * throws, never blocks the caller.
 */
export function submitRating(stars: number, nowMs: number, note?: string): void {
  const trimmed = note?.trim();
  const rating: QueuedRating = {
    stars, ts: nowMs, device: getDeviceInfo(), installId: getInstallId(),
    ...(trimmed ? { note: trimmed } : {}),
  };
  // Enqueue first so a crash between POST and enqueue can't lose it; a
  // successful immediate send then clears it.
  const q = readQueue();
  q.push(rating);
  writeQueue(q);
  attachSync();
  void flushFeedbackQueue();
}

/**
 * Whether this install has ever sent feedback.
 *
 * Local only, and deliberately so: it drives what the launch notice ASKS for,
 * never what anyone is entitled to. The gift is granted server-side, and a
 * flag in localStorage must not be able to influence that.
 */
export function hasSentFeedback(): boolean {
  try {
    return localStorage.getItem("gp_feedback_sent") === "1";
  } catch {
    return false;
  }
}

/** Record that feedback went through. Safe to call more than once. */
export function markFeedbackSent(): void {
  try {
    localStorage.setItem("gp_feedback_sent", "1");
  } catch {
    /* storage disabled — the notice just keeps asking, which is harmless */
  }
}

/**
 * Call once at app start: if a previous session left a rating queued (submitted
 * while offline, app closed before reconnect), sync it now / on the next
 * reconnect. No-op when the queue is empty.
 */
export function initFeedbackSync(): void {
  if (readQueue().length > 0) {
    attachSync();
    void flushFeedbackQueue();
  }
}
