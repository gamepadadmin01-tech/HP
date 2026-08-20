// ─── Layout sync ──────────────────────────────────────────────────────────────
//
// Backs saved pads up to the signed-in account and brings them back on a new
// install. Local storage stays authoritative — the editor never waits on a
// network — and this reconciles in the background.
//
// Merge rule: last write wins per padId, compared on `updatedAt`. Deletes travel
// as tombstones, never as an absence, so signing in on a fresh phone pulls the
// account's layouts down instead of pushing emptiness up and wiping them.
//
// ── Whose data local storage currently holds ──────────────────────────────────
//
// custom_pads, gp_deleted_pads, gp_sync_mark and gp_last_sync are plain, single,
// device-wide keys — nothing in them says which account they belong to. That
// was a real bug: sign in as A, save a pad, sign out, sign in as B on the same
// phone, and onSignedInSync() below would push whatever local storage still
// held — A's pad — up as part of B's sync payload, because it never checked
// whose it was. B would see it. Delete it as B, and the tombstone for it was
// STILL sitting in the same global gp_deleted_pads, so the next time A signed
// back in, that tombstone rode along in A's own sync payload and deleted it
// there too. Two different people, one shared bucket.
//
// The fix is an owner tag. Every successful sync records which account's view
// local storage now represents. On the next sign-in, if the incoming account
// does not match, local storage is not this account's to push — it is cleared
// FIRST, so the sync that follows is a pure pull of that account's own
// server-side layouts, never a push of someone else's.
//
// An unset owner (fresh install, or pads made before ever signing in) is not a
// mismatch: that local library legitimately belongs to whoever signs in first,
// and clearing it would just delete a new user's pre-signup work for nothing.

function syncOwner(): string {
  return readString(KEYS.syncOwner, "");
}

function setSyncOwner(email: string): void {
  writeString(KEYS.syncOwner, email.toLowerCase());
}

/** Drop everything pad-related that local storage holds. Used only when the
 *  data on disk belongs to a DIFFERENT account than the one signing in now. */
function discardLocalPadState(): void {
  replacePads([]);
  pruneTombstones(new Set());   // keep-set empty = every tombstone is dropped
  remove(KEYS.syncMark);
  remove(KEYS.lastSync);
}

// ── Why the scheduling looks the way it does ──────────────────────────────────
//
// A backup that uploads on every state change is a battery and data leak, and
// the first version of this file had a worse problem: adopting a sync result
// called setCustomPads, which re-ran the save effect, which scheduled another
// sync — a permanent loop of one upload every few seconds.
//
// The fix is a dirty check rather than a flag. We fingerprint what was last
// successfully synced; if the library still matches, there is nothing to send
// and the request is skipped. Adopting the server's answer stores that same
// fingerprint, so the follow-up schedule finds nothing to do and stops. Common
// practice for offline-first sync — a change-tracking layer so empty syncs never
// happen, plus exponential backoff on failure.

import { CustomPad } from "../types";
import { getSession } from "./account";
import { API_ORIGIN } from "../api/account";
import { KEYS, readString, writeString, remove } from "./storage";
import { autoSyncEnabled } from "./prefs";
import {
  loadPads, replacePads, loadTombstones, pruneTombstones,
} from "./pads";

// Was a hardcoded production URL, independent of API_ORIGIN — every other
// module (api/account.ts, api/billing.ts) reads that one setting so a LAN test
// build can point the whole app at a local backend at once. This file quietly
// never did, so a LAN build's layout sync always hit production regardless —
// invisible on the real shipped app (API_ORIGIN defaults to production anyway,
// so the two happened to agree there), but it meant a local/LAN test build's
// sync calls were silently talking to the live database the whole time, and
// made this file impossible to test against a local backend at all.
const BASE = `${API_ORIGIN}/api/account`;

/** Quiet period after an edit before uploading. Long enough that a burst of
 *  edits is one request, short enough that closing the app right after a change
 *  still saves it. */
const IDLE_DELAY_MS = 12_000;

/** Failure backoff: 1 min → 5 min → 15 min, then hold. Jitter is added so many
 *  devices coming back online together do not arrive as a spike. */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

export type SyncState =
  | { status: "off" }                                   // signed out
  | { status: "idle"; lastSync: string | null }
  | { status: "syncing" }
  | { status: "error"; message: string; lastSync: string | null };

type WireLayout = {
  padId: string;
  name: string;
  data: string;
  updatedAt: string;
  deletedAt?: string | null;
};

const listeners = new Set<() => void>();
let state: SyncState = { status: "off" };

export function getSyncState(): SyncState {
  return state;
}

export function onSyncChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: SyncState) {
  state = next;
  listeners.forEach((fn) => fn());
}

export function lastSyncedAt(): string | null {
  return readString(KEYS.lastSync, "") || null;
}

// ─── Dirty tracking ───────────────────────────────────────────────────────────

/** Cheap fingerprint of everything sync would send. FNV-1a: a collision would
 *  only mean one skipped upload, and the next edit re-arms it. */
function libraryFingerprint(): string {
  const pads = loadPads()
    .map((p) => `${p.padId}:${p.updatedAt || ""}`)
    .sort()
    .join("|");
  const dead = loadTombstones().map((t) => `${t.padId}:${t.deletedAt}`).sort().join("|");
  const text = `${pads}#${dead}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

function markSynced() {
  writeString(KEYS.syncMark, libraryFingerprint());
}

/** True when there is genuinely something new to upload. */
function isDirty(): boolean {
  return readString(KEYS.syncMark, "") !== libraryFingerprint();
}

// ─── Wire conversion ──────────────────────────────────────────────────────────

function toWire(pad: CustomPad): WireLayout {
  return {
    padId: pad.padId,
    name: pad.name,
    // Everything except the identity fields travels as one blob, so adding a
    // pad property later needs no protocol change.
    data: JSON.stringify({
      color: pad.color,
      buttons: pad.buttons,
      shareCode: pad.shareCode,
      shareHash: pad.shareHash,
    }),
    updatedAt: pad.updatedAt || new Date(0).toISOString(),
  };
}

function fromWire(l: WireLayout): CustomPad | null {
  try {
    const d = JSON.parse(l.data || "{}");
    if (!Array.isArray(d.buttons)) return null;
    return {
      padId: l.padId,
      name: l.name,
      color: d.color || "#6366f1",
      buttons: d.buttons,
      updatedAt: l.updatedAt,
      ...(d.shareCode ? { shareCode: d.shareCode } : {}),
      ...(d.shareHash ? { shareHash: d.shareHash } : {}),
    };
  } catch {
    return null;
  }
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let onlineHooked = false;

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Retry when the device comes back, instead of burning battery guessing. */
function hookOnline() {
  if (onlineHooked || typeof window === "undefined") return;
  onlineHooked = true;
  window.addEventListener("online", () => {
    if (getSession() && autoSyncEnabled() && isDirty()) void syncNow();
  });
}

function scheduleRetry() {
  const base = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  const jitter = base * 0.2 * Math.random();
  clearTimer();
  timer = setTimeout(() => { void syncNow(); }, base + jitter);
}

/**
 * Push local layouts, adopt the merged result. Never throws.
 * `force` is what the Sync button passes: a manual tap should work even when
 * nothing looks dirty, because the user may be checking that it works.
 */
export async function syncNow(force = true): Promise<boolean> {
  const session = getSession();
  if (!session) { set({ status: "off" }); return false; }
  if (state.status === "syncing") return false;
  if (!force && !isDirty()) return true;      // nothing to send — stay quiet

  hookOnline();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    set({ status: "error", message: "Offline. Layouts stay on this phone.", lastSync: lastSyncedAt() });
    return false;                              // the online listener will retry
  }

  clearTimer();
  set({ status: "syncing" });

  const payload: WireLayout[] = [
    ...loadPads().map(toWire),
    ...loadTombstones().map((t) => ({
      padId: t.padId, name: "", data: "{}", updatedAt: t.deletedAt, deletedAt: t.deletedAt,
    })),
  ];

  try {
    const res = await fetch(`${BASE}/layouts/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ layouts: payload }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body?.success) {
      failures++;
      const message = res.status === 401
        ? "Sign in again to back up."
        : body?.error || "Backup failed. It will retry.";
      set({ status: "error", message, lastSync: lastSyncedAt() });
      // 401 will not fix itself by retrying — the user has to sign in.
      if (res.status !== 401) scheduleRetry();
      return false;
    }

    const wire: WireLayout[] = Array.isArray(body.layouts) ? body.layouts : [];
    const merged = wire.filter((l) => !l.deletedAt).map(fromWire).filter((p): p is CustomPad => p !== null);

    // Adopt the account's view: this restores layouts on a fresh install and
    // applies a delete made on another device.
    replacePads(merged);
    pruneTombstones(new Set(wire.filter((l) => l.deletedAt).map((l) => l.padId)));

    // Record the state we just synced. The save effect that follows
    // replacePads() will call scheduleSync(), find nothing dirty, and stop —
    // this is what breaks the sync→adopt→sync loop.
    markSynced();
    // And record WHO it was synced for — set here, on every successful sync,
    // not only the sign-in one. If the sign-in sync happens to fail (offline
    // at the moment of signing in) and a background retry succeeds later, the
    // owner still gets recorded — otherwise a later account switch on this
    // device would see an unset owner and wrongly treat it as a fresh device.
    setSyncOwner(session.user.email);

    const at = body.syncedAt || new Date().toISOString();
    writeString(KEYS.lastSync, at);
    failures = 0;
    set({ status: "idle", lastSync: at });
    return true;
  } catch {
    failures++;
    set({ status: "error", message: "No connection. Layouts stay on this phone.", lastSync: lastSyncedAt() });
    scheduleRetry();
    return false;
  }
}

/** Session changed. Signing in pulls the account's layouts down even with auto
 *  backup off — restoring what the account already holds is not the same as
 *  uploading, and it is the only way a fresh install gets its pads back. */
export function onSignedInSync(): void {
  const session = getSession();
  if (session) {
    failures = 0;
    const owner = syncOwner();
    const incoming = session.user.email.toLowerCase();
    // Only a RECORDED, DIFFERENT owner counts as a switch. An unset owner is a
    // fresh device or a guest's pre-signup pads — those are meant to sync up,
    // not be wiped.
    if (owner && owner !== incoming) {
      discardLocalPadState();
    }
    void syncNow(true);
  } else {
    clearTimer();
    failures = 0;
    set({ status: "off" });
  }
}

/** Called after a local edit. Does nothing unless something actually changed,
 *  then waits for the user to stop editing before uploading. */
export function scheduleSync(): void {
  if (!getSession() || !autoSyncEnabled()) return;
  if (!isDirty()) return;                      // no-op saves never reach the network
  hookOnline();
  clearTimer();
  timer = setTimeout(() => { void syncNow(false); }, IDLE_DELAY_MS);
}

/** Cancel a pending backup — used when auto backup is switched off so an
 *  already-queued upload does not fire after the user opted out. */
export function cancelScheduledSync(): void {
  clearTimer();
}
