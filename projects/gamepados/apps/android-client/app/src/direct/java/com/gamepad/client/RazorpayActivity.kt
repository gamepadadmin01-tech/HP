package com.gamepad.client

import android.app.Activity
import android.os.Bundle
import com.razorpay.Checkout
import com.razorpay.PaymentData
import com.razorpay.PaymentResultWithDataListener
import org.json.JSONObject

// A no-UI host for Razorpay's checkout sheet, direct flavor only.
//
// ## Why this is a separate Activity at all
//
// Razorpay delivers its result by calling back into the Activity that opened the
// sheet, which therefore has to implement PaymentResultWithDataListener. That
// interface only exists on the direct flavor's classpath, and MainActivity is in
// src/main and compiled into all seven flavors — making it implement the
// interface would break every build that has no Razorpay dependency. So the
// listener lives here, in a class that only the direct build ever compiles.
//
// It is translucent and finishes as soon as the sheet closes, so the user sees
// the checkout appear over the app rather than a blank screen in between.
//
// The result is handed back through PurchaseRelay rather than setResult(), so
// MainActivity needs no onActivityResult branch — another thing that would have
// had to live in shared code.
class RazorpayActivity : Activity(), PaymentResultWithDataListener {

    // Guards against reporting twice. Razorpay can call back on an Activity that
    // is being recreated, and a second result would settle the NEXT purchase.
    private var reported = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // A recreated instance has already handed its sheet to Razorpay; opening
        // a second one would charge twice.
        if (savedInstanceState != null) {
            finish()
            return
        }

        val raw = intent.getStringExtra(EXTRA_OPTIONS)
        if (raw.isNullOrBlank()) {
            report(PurchaseRelay.error("Checkout could not be started."))
            return
        }

        try {
            val src = JSONObject(raw)
            val checkout = Checkout()
            checkout.setKeyID(src.getString("key"))
            checkout.open(this, razorpayOptions(src))
        } catch (e: Exception) {
            report(PurchaseRelay.error(e.message))
        }
    }

    /** Translate our own option names into the ones Razorpay's SDK expects. */
    private fun razorpayOptions(src: JSONObject): JSONObject {
        val out = JSONObject()
        out.put("name", src.optString("name", "GamepadOS"))
        out.put("description", src.optString("description"))
        out.put("currency", src.optString("currency", "INR"))
        out.put("amount", src.optInt("amount"))

        // Exactly one of these is set by the server: an order for the one-off
        // passes, a subscription for Quarterly.
        src.optString("orderId").takeIf { it.isNotBlank() }?.let { out.put("order_id", it) }
        src.optString("subscriptionId").takeIf { it.isNotBlank() }?.let {
            out.put("subscription_id", it)
            out.put("recurring", true)
        }

        val prefill = JSONObject()
        src.optString("prefillEmail").takeIf { it.isNotBlank() }?.let { prefill.put("email", it) }
        src.optString("prefillName").takeIf { it.isNotBlank() }?.let { prefill.put("name", it) }
        if (prefill.length() > 0) out.put("prefill", prefill)

        out.put("theme", JSONObject().put("color", "#5D90CB"))
        // Closing the sheet must come back to us as a cancellation rather than
        // leaving the Activity sitting there with nothing on it.
        out.put("modal", JSONObject().put("backdropclose", false))
        return out
    }

    override fun onPaymentSuccess(razorpayPaymentId: String?, paymentData: PaymentData?) {
        val paymentId = razorpayPaymentId ?: paymentData?.paymentId
        val signature = paymentData?.signature
        // Both are required for the server to verify the signature. Without them
        // there is nothing to send — but the payment may still have gone
        // through, so this is reported as an error the user can act on rather
        // than as a cancellation they would read as "nothing happened".
        if (paymentId.isNullOrBlank() || signature.isNullOrBlank()) {
            report(PurchaseRelay.error("Payment completed but the receipt was incomplete. It will appear shortly."))
            return
        }

        val data = paymentData?.data
        val subscriptionId = data?.optString("razorpay_subscription_id")?.takeIf { it.isNotBlank() }

        report(
            PurchaseRelay.razorpay(
                paymentId = paymentId,
                orderId = paymentData?.orderId?.takeIf { it.isNotBlank() },
                subscriptionId = subscriptionId,
                signature = signature,
            )
        )
    }

    override fun onPaymentError(code: Int, response: String?, paymentData: PaymentData?) {
        if (code == Checkout.PAYMENT_CANCELED) {
            report(PurchaseRelay.cancelled())
            return
        }
        report(PurchaseRelay.error(describe(response)))
    }

    /** Razorpay's error body is a JSON envelope; the useful sentence is nested
     *  inside it, and the raw JSON must never reach the user. */
    private fun describe(response: String?): String {
        if (response.isNullOrBlank()) return "The payment was not completed."
        return try {
            JSONObject(response)
                .optJSONObject("error")
                ?.optString("description")
                ?.takeIf { it.isNotBlank() }
                ?: "The payment was not completed."
        } catch (_: Exception) {
            "The payment was not completed."
        }
    }

    private fun report(json: String) {
        if (reported) return
        reported = true
        PurchaseRelay.post(json)
        finish()
    }

    override fun onDestroy() {
        // Swipe-away, back press, or a process-level kill: the JS side is
        // waiting on a callback and would otherwise sit on a spinner until its
        // timeout. Razorpay's webhook still settles a payment that did go
        // through, so calling this a cancellation costs nothing.
        if (!reported) {
            reported = true
            PurchaseRelay.post(PurchaseRelay.cancelled())
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_OPTIONS = "com.gamepad.client.RAZORPAY_OPTIONS"
    }
}
