import { nativeGuestTrial, type GuestTrialSnapshot } from "../platform/native";
import { readJson, writeJson, KEYS } from "./storage";

export const GUEST_SECONDS = 30 * 60;
type BrowserUsage = { used: number; resetsAt: number };
let browserActive = false;
let lastTick = performance.now();
let usage = readJson<BrowserUsage>(KEYS.guestTrial, { used: 0, resetsAt: 0 });

/** Android owns the real allowance. This fallback makes the browser preview usable. */
export function guestTrial(active?: boolean): GuestTrialSnapshot {
  try {
    const native = nativeGuestTrial(active);
    if (native) return native;
  } catch {
    // A broken native response must not create a second, fresh allowance.
    return { remainingSeconds: 0, limitSeconds: GUEST_SECONDS, resetsAt: Date.now() };
  }
  const now = Date.now();
  const elapsed = performance.now();
  const delta = Math.max(0, elapsed - lastTick) / 1000;
  lastTick = elapsed;
  if (!Number.isFinite(usage.used) || !Number.isFinite(usage.resetsAt)) usage = { used: 0, resetsAt: 0 };
  if (now >= usage.resetsAt) {
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    usage.used = browserActive ? Math.min(delta, (now - midnight.getTime()) / 1000) : 0;
    midnight.setDate(midnight.getDate() + 1);
    usage.resetsAt = midnight.getTime();
  } else if (browserActive) usage.used += delta;
  usage.used = Math.max(0, Math.min(GUEST_SECONDS, usage.used));
  if (active !== undefined) browserActive = active;
  writeJson(KEYS.guestTrial, usage);
  return { remainingSeconds: GUEST_SECONDS - usage.used, limitSeconds: GUEST_SECONDS, resetsAt: usage.resetsAt };
}
