import { nativeGuestTrial, type GuestTrialSnapshot } from "../platform/native";
import { readJson, writeJson, KEYS } from "./storage";

// Rules of 2026-09-30 (the same as the phone's GuestQuota): no daily free time,
// a ONE-TIME 30 minutes, ads add 30 more each and are offered only while under
// an hour is left.
export const GUEST_SECONDS = 30 * 60;
export const AD_CAP_SECONDS = 60 * 60;
type BrowserUsage = { bank: number; welcome: boolean };
let browserActive = false;
let lastTick = performance.now();
let usage = readJson<BrowserUsage>(KEYS.guestTrial, { bank: 0, welcome: false });

/** Android owns the real allowance. This fallback makes the browser preview usable. */
export function guestTrial(active?: boolean): GuestTrialSnapshot {
  try {
    const native = nativeGuestTrial(active);
    if (native) return native;
  } catch {
    // A broken native response must not create a second, fresh allowance.
    return { remainingSeconds: 0, limitSeconds: 0, resetsAt: Date.now(), canEarnAd: true };
  }
  const elapsed = performance.now();
  const delta = Math.max(0, elapsed - lastTick) / 1000;
  lastTick = elapsed;
  // An older preview stored { used, resetsAt }: start it over under the new shape.
  if (typeof usage.bank !== "number" || !Number.isFinite(usage.bank)) usage = { bank: 0, welcome: false };
  if (!usage.welcome) { usage.bank += GUEST_SECONDS; usage.welcome = true; }
  if (browserActive) usage.bank = Math.max(0, usage.bank - delta);
  if (active !== undefined) browserActive = active;
  writeJson(KEYS.guestTrial, usage);
  return { remainingSeconds: usage.bank, limitSeconds: 0, resetsAt: 0,
    freeRemainingSeconds: 0, bankSeconds: usage.bank, canEarnAd: usage.bank < AD_CAP_SECONDS };
}
