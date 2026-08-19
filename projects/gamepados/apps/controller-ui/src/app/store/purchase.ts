// ─── Buying a plan ────────────────────────────────────────────────────────────
//
// One function, two providers, and a hard rule underneath both: **the client
// never grants anything**. A purchase here ends in a server call that verifies
// the payment independently, and the entitlement only exists once that call
// succeeds. Nothing in this file can make the app think it is Premium.
//
// The shape is the same either way:
//
//   1. ask the server to start it (Razorpay) or read the product id (Play)
//   2. hand off to the native sheet through the bridge
//   3. wait for `window.onPurchaseResult`
//   4. send the receipt back for verification
//   5. re-read the entitlement
//
// Step 4 is the one that matters. Steps 1–3 are just how the money moves.
//
// Why native sheets rather than Razorpay's checkout.js: the UI is served from
// appassets.androidplatform.net, so the web checkout would be running
// cross-origin inside a WebView, where its popup and redirect handling is
// exactly the part that breaks. The Android SDKs are the supported path.

import * as api from "../api/billing";
import { ApiError } from "../api/account";
import { getSession } from "./account";
import { refresh } from "./billing";
import {
  getAppInfo,
  startPlayPurchase,
  startRazorpayCheckout,
  restorePurchases as bridgeRestore,
  canRestorePurchases,
  acknowledgePlayPurchase,
} from "../platform/native";
import { clearBlock } from "./playtime";

/** What the native side posts back to `window.onPurchaseResult`. */
type NativeResult =
  | { status: "ok"; provider: "play"; purchaseToken: string; productId: string; orderId?: string }
  | { status: "ok"; provider: "razorpay"; razorpay_payment_id: string; razorpay_order_id?: string;
      razorpay_subscription_id?: string; razorpay_signature: string }
  | { status: "cancelled" }
  | { status: "error"; message?: string };

export type PurchaseOutcome = {
  ok: boolean;
  /** Set only when `ok`. */
  plan?: api.PlanCode;
  /** The user backed out. Not a failure — the caller should say nothing. */
  cancelled?: boolean;
  /** Set when `ok` is false and `cancelled` is not. Safe to show the user. */
  message?: string;
};

const CANCELLED: PurchaseOutcome = { ok: false, cancelled: true };

function failed(message: string): PurchaseOutcome {
  return { ok: false, cancelled: false, message };
}

// ─── The callback ─────────────────────────────────────────────────────────────
//
// A single pending waiter, deliberately. Two purchase sheets cannot be open at
// once, so a second attempt while one is in flight is a bug in the caller, not
// a case to support — and queueing them would let a stale result settle the
// wrong purchase.

let pending: ((r: NativeResult) => void) | null = null;

declare global {
  interface Window {
    onPurchaseResult?: (json: string) => void;
  }
}

function installCallback() {
  if (window.onPurchaseResult) return;
  window.onPurchaseResult = (json: string) => {
    let parsed: NativeResult;
    try {
      parsed = JSON.parse(json) as NativeResult;
    } catch {
      parsed = { status: "error", message: "The payment app sent something unreadable." };
    }
    const waiter = pending;
    pending = null;
    // No waiter means Play handed us a purchase we did not ask for in this
    // session — a restore, or a payment that completed after the app was
    // killed. Credit it anyway; the user paid.
    if (!waiter) {
      if (parsed.status === "ok" && parsed.provider === "play") void creditPlay(parsed);
      return;
    }
    waiter(parsed);
  };
}

/** Resolve when the sheet answers, or after `timeoutMs` of silence. The timeout
 *  exists so a sheet that dies without a callback cannot leave the button
 *  spinning forever; it never cancels the payment, which is why the entitlement
 *  is re-read afterwards regardless. */
function awaitResult(timeoutMs = 10 * 60 * 1000): Promise<NativeResult> {
  installCallback();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending) {
        pending = null;
        resolve({ status: "error", message: "The payment screen didn't come back." });
      }
    }, timeoutMs);
    pending = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
  });
}

// ─── Google Play ──────────────────────────────────────────────────────────────

async function creditPlay(r: Extract<NativeResult, { provider: "play" }>): Promise<PurchaseOutcome> {
  const session = getSession();
  if (!session) return failed("Sign in to finish this purchase.");
  try {
    const out = await api.confirmPlayPurchase(session.token, {
      purchaseToken: r.purchaseToken,
      productId: r.productId,
      orderId: r.orderId,
    });
    // The server acknowledges on Play as part of crediting. This is the
    // fallback for the case where it credited but its own call to Play failed:
    // Play auto-refunds anything unacknowledged after three days, which would
    // silently reverse a purchase the user is already using. Safe to call
    // unconditionally -- it is a no-op once acknowledged.
    acknowledgePlayPurchase(r.purchaseToken);
    await refresh();
    // Someone who just bought their way out of a lockout should not have to
    // back out of the controller and come in again.
    clearBlock();
    return { ok: true, plan: out.plan };
  } catch (e) {
    // The money is already gone at this point, so this must never read as
    // "purchase failed" — Play will re-deliver an unacknowledged purchase and
    // the reconciler picks up the rest.
    const msg = e instanceof ApiError ? e.message : "Could not confirm the purchase.";
    return failed(`${msg} Your payment is safe — reopen the app in a minute and it will appear.`);
  }
}

// ─── Razorpay ─────────────────────────────────────────────────────────────────

async function buyWithRazorpay(plan: api.CataloguePlan): Promise<PurchaseOutcome> {
  const session = getSession();
  if (!session) return failed("Sign in to buy a plan.");

  let order: api.RazorpayOrder;
  try {
    order = await api.createRazorpayOrder(session.token, plan.code, plan.currency);
  } catch (e) {
    return failed(e instanceof ApiError ? e.message : "Could not start checkout.");
  }

  // Everything the sheet needs. The amount is echoed from the server's answer,
  // never recomputed here — Razorpay checks it against the order anyway, and a
  // mismatch would simply be rejected.
  const launched = startRazorpayCheckout({
    key: order.keyId,
    amount: order.amountMinor,
    currency: order.currency,
    name: "GamepadOS",
    description: plan.displayName,
    orderId: order.orderId,
    subscriptionId: order.subscriptionId,
    prefillEmail: session.user.email,
    prefillName: session.user.displayName,
  });
  if (!launched) return failed("This build cannot take payments. Buy at gamepad.space instead.");

  const r = await awaitResult();
  if (r.status === "cancelled") return CANCELLED;
  if (r.status === "error") return failed(r.message || "The payment was not completed.");
  if (r.provider !== "razorpay") return failed("The payment app answered unexpectedly.");

  try {
    const out = await api.verifyRazorpay(session.token, plan.code, {
      razorpay_payment_id: r.razorpay_payment_id,
      razorpay_order_id: r.razorpay_order_id,
      razorpay_subscription_id: r.razorpay_subscription_id,
      razorpay_signature: r.razorpay_signature,
    });
    await refresh();
    clearBlock();
    return { ok: true, plan: out.plan };
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : "Payment could not be verified.";
    // Same reasoning as Play: the webhook settles this even if the client call
    // never lands, so do not tell the user they were not charged.
    return failed(`${msg} If you were charged, it will appear within a few minutes.`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

let busy = false;

/**
 * Buy `plan`. Routes by the build's own distribution channel — a playstore
 * build must go through Play Billing and a direct build through Razorpay, and
 * neither may offer the other.
 *
 * The caller is still responsible for only showing a button when the SERVER
 * said the channel is purchasable. This function refuses anything else as a
 * backstop, not as the gate.
 */
export async function purchase(plan: api.CataloguePlan): Promise<PurchaseOutcome> {
  if (busy) return failed("A purchase is already in progress.");
  if (!plan.purchasable) return failed("This build cannot sell plans.");

  busy = true;
  try {
    const channel = getAppInfo().channel || "direct";
    const session = getSession();
    if (!session) return failed("Sign in to buy a plan.");

    if (channel === "playstore") {
      if (!plan.playProductId) return failed("That plan is not available here yet.");
      installCallback();
      if (!startPlayPurchase(plan.playProductId, session.user.id)) {
        return failed("Google Play billing is unavailable on this device.");
      }
      const r = await awaitResult();
      if (r.status === "cancelled") return CANCELLED;
      if (r.status === "error") return failed(r.message || "The purchase was not completed.");
      if (r.provider !== "play") return failed("The store answered unexpectedly.");
      return creditPlay(r);
    }

    if (channel === "direct") return buyWithRazorpay(plan);

    // amazonstore, aptoide, uptodown, indusstore, apkpure — the store's own
    // billing is mandatory, so there is nothing to launch and nothing to link.
    return failed("Plans cannot be bought in this version of the app.");
  } finally {
    busy = false;
  }
}

/**
 * Ask Play to re-deliver anything already owned. Worth offering because a
 * purchase can complete while the app is dead — Play holds it and hands it over
 * on the next connection, which is what this triggers.
 *
 * Results arrive on the same callback and are credited by `creditPlay`, so this
 * returns only whether the request could be made at all.
 */
export function restorePurchases(): boolean {
  installCallback();
  return bridgeRestore();
}

/** Whether offering a restore button makes sense at all. False on Razorpay
 *  builds, where an entitlement lives on the ACCOUNT rather than in a store, so
 *  signing in already restores it and a button would imply otherwise. */
export function canRestore(): boolean {
  return canRestorePurchases();
}
