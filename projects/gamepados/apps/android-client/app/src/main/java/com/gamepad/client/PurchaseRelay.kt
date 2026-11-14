package com.gamepad.client

import org.json.JSONObject

// One-way channel from the payment SDK back to the WebView, plus the shared JSON
// shapes (cancelled / error). Only src/razorpay (direct + uptodown builds) pays
// today; the Play build sells nothing since 2026-09-30. Kept in main because
// MainActivity attaches the sink in every flavour.
//
// The sink is attached by MainActivity once the WebView exists and cleared when
// it is destroyed, so a result arriving after teardown is dropped rather than
// crashing on a dead WebView.
//
// A dropped result is NOT a lost payment. Razorpay's webhook credits the
// entitlement whether or not the client ever reports back. The app re-reads
// /api/billing/me on the next launch and the plan is simply there.
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

    /** [diag]: what the payment SDK reported, for the server's "purchases that didn't finish" list
     *  (Google Play only, 2026-11-14; see playbilling BillingBridge.diag). Absent elsewhere. */
    fun cancelled(diag: JSONObject? = null): String =
        JSONObject().put("status", "cancelled").apply { if (diag != null) put("diag", diag) }.toString()

    fun error(message: String?, diag: JSONObject? = null): String =
        JSONObject()
            .put("status", "error")
            .put("message", message ?: "The payment was not completed.")
            .apply { if (diag != null) put("diag", diag) }
            .toString()

    // The Razorpay success payload is built in src/razorpay/RazorpayActivity, not
    // here — this file ships in the Play build, and Play must carry no Razorpay code.

    /** A finished Google Play purchase (2026-11-02). The page forwards the token to the server, which
     *  checks it with Google; nothing here grants anything. */
    fun play(purchaseToken: String, productId: String, orderId: String?): String =
        JSONObject()
            .put("status", "ok")
            .put("provider", "play")
            .put("purchaseToken", purchaseToken)
            .put("productId", productId)
            .apply { if (orderId != null) put("orderId", orderId) }
            .toString()
}
