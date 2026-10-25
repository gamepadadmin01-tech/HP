// ─── Open play ────────────────────────────────────────────────────────────────
//
// While the owner has OPEN_PLAY_UNTIL switched on at the server (rewarded ads are down),
// everyone plays unlimited.
//
//   * Signed in: the server resolves the account as unlimited (plans.js freeEffective). Nothing
//     to do here but show the note.
//   * Signed out: the play time lives on the PHONE (GuestTrial.kt), so the phone has to be told.
//     This asks /api/billing/open-play on launch, on return to the app and every 10 minutes, and
//     hands the answer to the native clock together with a 30-minute lease.
//
// FAILS CLOSED. Anything but { open: true } (offline, server error, a switch turned off) means the
// normal rules, and the lease runs out by itself even if the phone never hears from us again, so
// "unlimited" can never outlive the server's say-so by more than half an hour.

import { getOpenPlay } from "../api/billing";
import { nativeGuestOpenPlay } from "../platform/native";
import { getSession } from "./account";
import { clearBlock } from "./playtime";

const REFRESH_MS = 10 * 60 * 1000;
const LEASE_SECONDS = 30 * 60;

let open = false;
let lastOk = 0;
let inflight = false;
const listeners = new Set<() => void>();

/** Is open play on right now, as last confirmed by the server? */
export function isOpenPlay(): boolean {
  return open;
}

export function onOpenPlayChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function apply(next: boolean) {
  try { nativeGuestOpenPlay(next, LEASE_SECONDS); } catch { /* an old or broken bridge: normal rules */ }
  const changed = next !== open;
  open = next;
  if (changed) listeners.forEach((fn) => fn());
  // A signed-out player who was already blocked is let back in the moment it opens, as after an ad.
  if (next && !getSession()) clearBlock();
}

export async function refreshOpenPlay(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const r = await getOpenPlay();
    lastOk = Date.now();
    apply(r.open === true);
  } catch {
    // Offline or server trouble: keep what we know only as long as the native lease would.
    if (open && Date.now() - lastOk > LEASE_SECONDS * 1000) apply(false);
  } finally {
    inflight = false;
  }
}

if (typeof window !== "undefined") {
  setTimeout(() => { void refreshOpenPlay(); }, 0);
  setInterval(() => { void refreshOpenPlay(); }, REFRESH_MS);
  window.addEventListener("focus", () => { void refreshOpenPlay(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshOpenPlay(); });
}
