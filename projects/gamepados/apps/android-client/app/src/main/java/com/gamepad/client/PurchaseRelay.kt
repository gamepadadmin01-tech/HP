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

    fun cancelled(): String =
        JSONObject().put("status", "cancelled").toString()

    fun error(message: String?): String =
        JSONObject()
            .put("status", "error")
            .put("message", message ?: "The payment was not completed.")
            .toString()

    // The Razorpay success payload is built in src/razorpay/RazorpayActivity, not
    // here — this file ships in the Play build, and Play must carry no Razorpay code.
    // (The Play Billing payload builder was removed on 2026-09-30 with Play Billing.)
}
