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

import { ApiError, API_ORIGIN } from "./account";

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

type Req = { method?: "GET" | "POST"; body?: unknown; token?: string };

/**
 * Hard deadline for every call.
 *
 * There was none, and a hung fetch NEVER rejects — so the catch below, and the
 * friendly "couldn't reach GamepadOS" it throws, could only fire when the
 * request failed outright. A request that merely hung left the caller awaiting
 * forever, and the screens that make these calls on mount just stayed blank.
 *
 * That is why the app felt slower ON Wi-Fi than off it: with no network the
 * connection is refused immediately and the UI moves on, while a Wi-Fi link that
 * routes nowhere (a captive portal, a dead DHCP lease, an unreachable backend)
 * black-holes the packets and nothing ever comes back. Counter-intuitive from
 * the outside, entirely mechanical once you see there is no timeout.
 *
 * AbortController rather than AbortSignal.timeout: this ships inside an Android
 * WebView whose version tracks the device, and the older ones predate it.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function deadline(ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}

async function request<T>(path: string, { method, body, token }: Req = {}): Promise<T> {
  let res: Response;
  const d = deadline(REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: d.signal,
    });
  } catch (e) {
    // Name the timeout separately: "check your connection" is misleading advice
    // when the connection is up and the server simply never answered.
    throw new ApiError(
      (e as { name?: string } | null)?.name === "AbortError"
        ? "GamepadOS took too long to respond. Try again in a moment."
        : "Couldn't reach GamepadOS. Check your connection.",
      "network"
    );
  } finally {
    d.clear();
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body — handled below */
  }

  if (!res.ok || !payload?.success) {
    // Quota exhaustion and "already playing elsewhere" are ordinary states, not
    // faults, so their code travels intact for the caller to branch on, and the
    // body rides along for the fields (resetsAt, deviceLabel) they carry.
    const err = new ApiError(
      payload?.error || `Something went wrong (${res.status}).`,
      payload?.code || String(res.status),
    );
    (err as ApiError & { payload?: unknown }).payload = payload;
    throw err;
  }
  return payload as T;
}

// ─── Catalogue and entitlement ────────────────────────────────────────────────

/** Public — the plan list is shown before sign-in too. `channel` must be the
 *  build's own DISTRIBUTION_CHANNEL: it is what decides `purchasable`. */
export function getPlans(channel: string, currency = "INR") {
  const q = `?channel=${encodeURIComponent(channel || "direct")}&currency=${encodeURIComponent(currency)}`;
  return request<{ success: true } & Catalogue>(`/api/billing/plans${q}`);
}

/** Public. Is "open play" switched on at the server (everyone plays unlimited)? The server never
 *  says until when: it is ended by the owner, not by a date the app could show or count down to. */
export function getOpenPlay() {
  return request<{ success: true; open: boolean }>("/api/billing/open-play");
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
