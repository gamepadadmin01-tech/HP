// ─── Billing + playtime API client ────────────────────────────────────────────
//
// The only place that talks to /api/billing/* and /api/play/*. Sits beside
// account.ts and borrows its ApiError so every screen reports failures the same
// way, but keeps its own file: account.ts is about WHO you are, this is about
// WHAT you may do, and the two have different lifetimes on screen.
//
// Two rules this file exists to enforce:
//
//   1. Prices are never computed here. `priceMinor` comes from the server, and
//      when `priceFromStore` is set (the playstore flavour) even that must not
//      be rendered — Play Console is authoritative and showing our own number
//      next to a Play SKU is a policy violation. The UI reads the flag.
//
//   2. Whether a purchase surface may be shown at all is the SERVER's decision,
//      returned as `purchasable` for the channel we report. amazonstore,
//      aptoide, uptodown, indusstore and apkpure get plan status and nothing
//      else. The app must not second-guess that with its own allowlist, or the
//      two drift and a store build grows a buy button.

import { ApiError, API_ORIGIN, apiFetch, type ApiRequest } from "./account";
import { canBuyWithPlay } from "../platform/native";

export type PlanCode = "FREE" | "THREE_DAY" | "QUARTERLY" | "LIFETIME";

/** One row of the catalogue from GET /api/billing/plans. */
export type CataloguePlan = {
  code: PlanCode;
  displayName: string;
  currency: string;
  /** Minor units — paise for INR. 40000 = ₹400. */
  priceMinor: number;
  unlimited: boolean;
  /** null = no daily cap. */
  dailySeconds: number | null;
  durationHours: number | null;
  durationMonths: number | null;
  purchasable: boolean;
  /** true on playstore: render Play's ProductDetails price, never priceMinor. */
  priceFromStore: boolean;
  playProductId?: string;
};

export type Catalogue = {
  channel: string;
  currency: string;
  purchasable: boolean;
  plans: CataloguePlan[];
  /** Outside India while Razorpay takes Indian payments only (2026-11-15): nothing is sold here; the player is
   *  sent to Google Play (`playStoreUrl`) instead. */
  buyOnGooglePlay?: boolean;
  playStoreUrl?: string;
};

/** GET /api/billing/me — the effective entitlement plus today's usage. */
export type Entitlement = {
  plan: PlanCode;
  unlimited: boolean;
  startsAt: string | null;
  endsAt: string | null;
  autoRenew: boolean;
  source: string | null;
  today: {
    /** null when the plan is unlimited. */
    limitSeconds: number | null;
    usedSeconds: number;
    /** null when unlimited. Includes the ad bank (server 2026-09-29+). */
    remainingSeconds: number | null;
    /** Today's free allowance alone, without the ad bank. Absent on older servers. */
    freeRemainingSeconds?: number | null;
  };
  /** Rewarded-ad time. Absent on servers older than the ad bank. */
  adTime?: {
    /** Banked seconds still available: stack, never expire, spent after the free time. */
    bankSeconds: number;
    /** What one ad adds (1800). */
    rewardSeconds: number;
    /** false on Lifetime: no button at all. */
    canEarn: boolean;
  };
  resetsAt: string;
  resetTimezone: string;
  heartbeatSeconds: number;
  /** Server clock. The UI ticks from a monotonic offset against this and never
   *  trusts the phone's own clock — changing it in Settings must not buy time. */
  serverTime: string;
};

export type SessionStart = {
  sessionId: string;
  fence: number;
  plan: PlanCode;
  unlimited: boolean;
  remainingSeconds: number | null;
  resetsAt: string;
  nextHeartbeatMs: number;
  serverTime: string;
  /** Base64 capability ticket for the PC server. Forward over the TCP control
   *  channel — never the UDP input channel. */
  ticket: string;
};

export type Heartbeat = {
  quotaExhausted?: boolean;
  remainingSeconds: number | null;
  unlimited: boolean;
  plan: PlanCode;
  usedSeconds: number;
  resetsAt: string;
  nextHeartbeatMs?: number;
  serverTime: string;
  /** null once quota is spent: issuance simply stops and the PC tears down. */
  ticket: string | null;
};

// ─── Transport ────────────────────────────────────────────────────────────────

type Req = ApiRequest;

/** Every billing call goes through the shared helper in api/account.ts, which has the 10-second deadline
 *  (a hung fetch never rejects; without it a Wi-Fi link that routes nowhere left screens blank forever). */
function request<T>(path: string, req: Req = {}): Promise<T> {
  return apiFetch<T>(`${API_ORIGIN}${path}`, req);
}

// ─── Catalogue and entitlement ────────────────────────────────────────────────

/** Public — the plan list is shown before sign-in too. `channel` must be the
 *  build's own DISTRIBUTION_CHANNEL: it is what decides `purchasable`. */
/** Which currency this player sees prices in on the website and other non-Play builds: rupees in India,
 *  dollars everywhere else (owner, 2026-11-02: Lifetime is Rs 19 in India and $0.50 elsewhere). India is
 *  decided by the phone's time zone or region setting. The Play build ignores this: Google Play shows its own. */
export function regionCurrency(): "INR" | "USD" {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
    const langs = (typeof navigator !== "undefined" && navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
    if (langs.some((l) => /-IN$/i.test(String(l)))) return "INR";
  } catch { /* no Intl: fall through to dollars */ }
  return "USD";
}

export function getPlans(channel: string, currency: string = __PLAY__ ? "INR" : regionCurrency()) {
  // `playBilling=1`: this Play build can pay through Google Play. Without it the server never offers an
  // older Play build (no billing code inside) a buy button.
  const q = `?channel=${encodeURIComponent(channel || "direct")}&currency=${encodeURIComponent(currency)}`
    + (channel === "playstore" && canBuyWithPlay() ? "&playBilling=1" : "");
  return request<{ success: true } & Catalogue>(`/api/billing/plans${q}`);
}

export function getMe(token: string) {
  return request<{ success: true } & Entitlement>("/api/billing/me", { token });
}

export function redeemPromo(token: string, code: string) {
  return request<{ success: true; plan: PlanCode; endsAt: string | null }>(
    "/api/billing/promo/redeem",
    { body: { code: code.trim().toUpperCase() }, token },
  );
}

/** A finished Unity rewarded ad (direct and uptodown builds). `nonce` is the one-time claim id the
 *  phone made for that ad; the server credits it once, and only under its 30-minute rule. */
export function claimUnityAd(token: string, nonce: string) {
  return request<{ success: true; credited: boolean; reason?: string }>(
    "/api/ads/unity/claim",
    { body: { nonce }, token },
  );
}

/** What happened when the player tapped "Watch an ad". When the ad network had no ad (or failed on its
 *  own side) the server answers `compensated` with the free seconds: a signed-in player's are already
 *  banked (send the token); a guest's are added on the phone by the caller. */
export type AdOutcomeResult = "rewarded" | "closed" | "nofill" | "error" | "network" | "other";
export function reportAdOutcome(
  body: { installId: string; network: string; result: AdOutcomeResult; code?: string; channel?: string; versionCode?: number },
  token?: string,
) {
  return request<{ success: true; compensated: boolean; seconds?: number; reason?: string }>(
    "/api/ads/outcome",
    { body, token },
  );
}

// ─── Razorpay (direct build only) ─────────────────────────────────────────────

export type RazorpayOrder = {
  kind: "order" | "subscription";
  orderId?: string;
  subscriptionId?: string;
  keyId: string;
  planCode: PlanCode;
  amountMinor: number;
  currency: string;
};

/** The amount is decided server-side from our own Plan table — nothing the
 *  client sends can influence what is charged. */
export function createRazorpayOrder(token: string, planCode: PlanCode, currency = "INR") {
  return request<{ success: true } & RazorpayOrder>("/api/billing/razorpay/order", {
    body: { planCode, currency },
    token,
  });
}

export type RazorpayResult = {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
};

/** Hands checkout's signature back for verification. The signature only proves
 *  the ids are authentic — the server re-fetches the payment to confirm money
 *  actually moved and the amount matched, so this call is not the entitlement. */
export function verifyRazorpay(token: string, planCode: PlanCode, result: RazorpayResult) {
  return request<{ success: true; plan: PlanCode; endsAt: string | null }>(
    "/api/billing/razorpay/verify",
    { body: { planCode, ...result }, token },
  );
}

/** A Google Play purchase token, for the SERVER to check with Google. The plan is decided from what
 *  Google says was bought, never from anything sent here. `pending`: the payment has not cleared. */
/** `app`: which of our Play apps made the purchase (CamOS sends "camos"; GamepadOS sends nothing, the default). */
export function verifyGoogle(token: string, purchaseToken: string, app?: "camos") {
  return request<{
    success: true; pending?: boolean; message?: string; alreadyCredited?: boolean; acknowledged?: boolean;
    plan?: PlanCode; endsAt?: string | null;
  }>("/api/billing/google/purchase", { body: app ? { purchaseToken, app } : { purchaseToken }, token });
}

/** A Google Play purchase that did not finish, with what Google told the app (code, sub-reason, Play country, time
 *  on Google's sheet), for the portal's "Google Play purchases that didn't finish" list (2026-11-14). */
export type PlayAttempt = {
  outcome: "cancelled" | "error";
  stage: "setup" | "query" | "launch" | "sheet" | "pending" | "timeout";
  code?: string; subCode?: string; debug?: string; message?: string; country?: string; ms?: number;
  productId?: string; appVersion?: string;
};
export function reportPlayAttempt(token: string, attempt: PlayAttempt) {
  return request<{ success: true }>("/api/billing/google/attempt", { body: attempt, token });
}

// ─── Play session lifecycle ───────────────────────────────────────────────────
//
// One call before play, one per minute during, one after. Never on the input
// path — the gameplay loop must not await any of these.

export function startSession(
  token: string,
  args: { deviceId: string; deviceLabel?: string; takeover?: boolean },
) {
  return request<{ success: true } & SessionStart>("/api/play/session/start", {
    body: args,
    token,
  });
}

/** `clientSeconds` is the app's running TOTAL for the period, never a duration:
 *  the server takes max(local, server) so clearing app data restores nothing. */
export function heartbeatSession(
  token: string,
  args: { sessionId: string; fence: number; seq: number; clientSeconds?: number },
) {
  return request<{ success: true } & Heartbeat>("/api/play/session/heartbeat", {
    body: args,
    token,
  });
}

export function stopSession(token: string, args: { sessionId: string; fence: number }) {
  return request<{ success: true; ok: true; usedSeconds?: number; resetsAt?: string }>(
    "/api/play/session/stop",
    { body: args, token },
  );
}
