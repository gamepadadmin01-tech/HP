package com.gamepad.client

import android.content.Intent
import android.webkit.JavascriptInterface
import com.razorpay.Checkout

// direct flavor only: payments go through Razorpay, our own channel with no
// store cut. Google Play forbids this path for digital goods, so this class —
// and the Razorpay dependency it needs — must never be compiled into a
// store-distributed build. The playstore flavor gets Play Billing instead
// (src/playstore/java) and the remaining five stores get neither
// (src/store/java).
//
// The checkout sheet itself is hosted by RazorpayActivity, because the SDK
// reports its result to the Activity that opened it and MainActivity is shared
// across every flavor — see the comment at the top of that file.
//
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class BillingBridge(activity: MainActivity) : UpdaterBridge(activity) {

    init {
        // Pulls Razorpay's assets into memory ahead of the first tap. Cheap, and
        // it removes a visible delay between pressing Buy and the sheet
        // appearing on a cold start.
        try {
            Checkout.preload(activity.applicationContext)
        } catch (_: Exception) {
            // Preloading is an optimisation; a failure here must not stop a sale.
        }
    }

    /**
     * Open Razorpay's checkout sheet.
     *
     * [optionsJson] comes from store/purchase.ts and carries the key id, amount
     * and order (or subscription) the SERVER created. Nothing in it is decided
     * by the client: the amount is echoed from our own Plan table, and Razorpay
     * validates it against the order it issued, so a tampered amount is simply
     * rejected rather than charged.
     */
    @JavascriptInterface
    fun startRazorpayCheckout(optionsJson: String) {
        val intent = Intent(activity, RazorpayActivity::class.java)
            .putExtra(RazorpayActivity.EXTRA_OPTIONS, optionsJson)
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            PurchaseRelay.post(PurchaseRelay.error("Checkout could not be opened."))
        }
    }
}
