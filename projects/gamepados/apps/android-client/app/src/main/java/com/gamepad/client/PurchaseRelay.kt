package com.gamepad.client

import org.json.JSONObject

// One-way channel from whichever billing SDK this flavor was built with back to
// the WebView, plus the JSON shapes both of them speak.
//
// It exists so the two payment integrations share a result format and an escape
// path without either of them knowing about the WebView. src/direct talks to
// Razorpay, src/playstore talks to Play Billing, and neither can reference the
// other's classes — but both can call post().
//
// The sink is attached by MainActivity once the WebView exists and cleared when
// it is destroyed, so a result arriving after teardown is dropped rather than
// crashing on a dead WebView.
//
// A dropped result is NOT a lost payment. Both providers settle server-side —
// Play re-delivers unacknowledged purchases on the next connection, and
// Razorpay's webhook credits the entitlement whether or not the client ever
// reports back. The app re-reads /api/billing/me on the next launch and the
// plan is simply there.
object PurchaseRelay {

    @Volatile
    private var sink: ((String) -> Unit)? = null

    fun attach(f: (String) -> Unit) { sink = f }

    fun detach() { sink = null }

    /** Deliver a result JSON payload to JS. Silently dropped when nothing is
     *  listening — see the note above on why that is safe. */
    fun post(json: String) {
        sink?.invoke(json)
    }

    // ── Payload builders ─────────────────────────────────────────────────────
    // Built with JSONObject rather than string concatenation because a payment
    // description or an SDK error message can contain quotes and newlines, and
    // this string is about to be embedded in a JavaScript call.

    fun cancelled(): String =
        JSONObject().put("status", "cancelled").toString()

    fun error(message: String?): String =
        JSONObject()
            .put("status", "error")
            .put("message", message ?: "The payment was not completed.")
            .toString()

    fun play(purchaseToken: String, productId: String, orderId: String?): String =
        JSONObject()
            .put("status", "ok")
            .put("provider", "play")
            .put("purchaseToken", purchaseToken)
            .put("productId", productId)
            .apply { if (orderId != null) put("orderId", orderId) }
            .toString()

    fun razorpay(paymentId: String, orderId: String?, subscriptionId: String?, signature: String): String =
        JSONObject()
            .put("status", "ok")
            .put("provider", "razorpay")
            .put("razorpay_payment_id", paymentId)
            .put("razorpay_signature", signature)
            .apply {
                if (orderId != null) put("razorpay_order_id", orderId)
                if (subscriptionId != null) put("razorpay_subscription_id", subscriptionId)
            }
            .toString()
}
