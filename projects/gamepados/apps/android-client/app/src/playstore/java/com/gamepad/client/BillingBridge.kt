package com.gamepad.client

import android.webkit.JavascriptInterface
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.security.MessageDigest

// playstore flavor: purchases go through Google Play Billing and nowhere else.
// Play's policy requires it for digital goods, and the direct build's Razorpay
// path is compiled out of this flavor entirely (src/direct/java) for the same
// reason this class is compiled out of that one.
//
// ## What this class does NOT do
//
// It never grants anything. A completed purchase here produces a purchaseToken,
// which JS forwards to /api/billing/google/purchase; the SERVER verifies it with
// Play's Developer API, decides the entitlement, and acknowledges the purchase
// on Play. Acknowledging locally would tell Play the user has their goods before
// we had confirmed it, and a client that can acknowledge is a client that can be
// patched to acknowledge without paying.
//
// The one acknowledgement below is a safety net for a purchase our server has
// already credited but could not acknowledge — see acknowledgeIfServerCredited.
//
// ## Binding a purchase to an account
//
// Play stamps an "obfuscated account id" on the purchase, and the backend
// refuses to credit one whose id does not match the caller (routes.googleplay.js
// -> purchaseBelongsTo). That id must be sha256(userId) in hex to match what the
// server computes — 64 characters, which is also exactly Play's field limit.
//
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class BillingBridge(activity: MainActivity) : UpdaterBridge(activity) {

    // Every purchase the library reports — whether from a flow we started, a
    // restore, or one that completed while the app was dead — arrives here.
    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val list = purchases.orEmpty()
                if (list.isEmpty()) {
                    PurchaseRelay.post(PurchaseRelay.cancelled())
                } else {
                    list.forEach { report(it) }
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED ->
                PurchaseRelay.post(PurchaseRelay.cancelled())
            else ->
                PurchaseRelay.post(PurchaseRelay.error(readable(result)))
        }
    }

    private val client: BillingClient by lazy {
        BillingClient.newBuilder(activity)
            .setListener(purchasesUpdated)
            // Required from Billing 7 onwards. Both of our one-time products
            // (3-Day Pass, Lifetime) can go PENDING when the user pays by a
            // slow method, so this must be declared or the flow is refused.
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build()
    }

    /** Run `block` on a connected client, reconnecting if the service dropped.
     *  Play's client disconnects freely (updates, low memory), so every entry
     *  point has to be prepared to reconnect rather than assume readiness. */
    private fun connected(block: () -> Unit) {
        if (client.isReady) {
            block()
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    block()
                } else {
                    PurchaseRelay.post(PurchaseRelay.error(readable(result)))
                }
            }

            override fun onBillingServiceDisconnected() {
                // Deliberately not retried in a loop: the next user action calls
                // connected() again, and an automatic retry here would fire
                // while nobody is waiting for an answer.
            }
        })
    }

    // ── JS surface ───────────────────────────────────────────────────────────

    /**
     * Open Play's purchase sheet for [productId].
     *
     * [accountId] is the RAW user id. It is hashed here rather than in JS
     * because the WebView's only hash is crypto.subtle, which is async and would
     * put a promise between the tap and the sheet for no benefit.
     */
    @JavascriptInterface
    fun startPlayPurchase(productId: String, accountId: String) {
        connected {
            // Our catalogue mixes one-time products (3-Day Pass, Lifetime) with a
            // subscription (Quarterly), and Play will not tell you which a given
            // id is — you have to ask for a type. Try one-time first, because two
            // of the three are, then fall back.
            queryAndLaunch(productId, accountId, BillingClient.ProductType.INAPP) {
                queryAndLaunch(productId, accountId, BillingClient.ProductType.SUBS, null)
            }
        }
    }

    /**
     * Hand back anything this account already owns.
     *
     * Worth offering because a purchase can complete while the app is dead: Play
     * holds it and re-delivers on the next query, which is what this triggers.
     * Also the recovery path when our server credited a purchase but the client
     * never heard back.
     */
    @JavascriptInterface
    fun restorePurchases() {
        connected {
            listOf(BillingClient.ProductType.INAPP, BillingClient.ProductType.SUBS).forEach { type ->
                client.queryPurchasesAsync(
                    QueryPurchasesParams.newBuilder().setProductType(type).build()
                ) { _, purchases -> purchases.forEach { report(it) } }
            }
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private fun queryAndLaunch(
        productId: String,
        accountId: String,
        type: String,
        onMissing: (() -> Unit)?,
    ) {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(type)
                        .build()
                )
            )
            .build()

        client.queryProductDetailsAsync(params) { result, details ->
            val product = details.firstOrNull()
            if (result.responseCode != BillingClient.BillingResponseCode.OK || product == null) {
                if (onMissing != null) onMissing()
                else PurchaseRelay.post(
                    PurchaseRelay.error("That plan is not available on Google Play yet.")
                )
                return@queryProductDetailsAsync
            }
            launch(product, accountId)
        }
    }

    private fun launch(product: ProductDetails, accountId: String) {
        val builder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)

        // A subscription must name which offer is being bought. We publish one
        // base plan per subscription product, so the first offer is the only
        // offer; a missing one means the product is misconfigured in Play
        // Console and launching would fail with a less useful message.
        if (product.productType == BillingClient.ProductType.SUBS) {
            val offer = product.subscriptionOfferDetails?.firstOrNull()
            if (offer == null) {
                PurchaseRelay.post(
                    PurchaseRelay.error("That subscription is not set up on Google Play yet.")
                )
                return
            }
            builder.setOfferToken(offer.offerToken)
        }

        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(builder.build()))
            .setObfuscatedAccountId(sha256Hex(accountId))
            .build()

        activity.runOnUiThread {
            val result = client.launchBillingFlow(activity, flow)
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                PurchaseRelay.post(PurchaseRelay.error(readable(result)))
            }
            // On OK the answer arrives through purchasesUpdated, not here.
        }
    }

    /**
     * Forward one purchase to JS.
     *
     * PENDING is reported as an error on purpose: the user has not paid yet
     * (cash, bank transfer), so there is nothing to credit, and saying "done"
     * would show them a plan that may never arrive. Play re-delivers it as
     * PURCHASED once the money lands.
     */
    private fun report(purchase: Purchase) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                val productId = purchase.products.firstOrNull() ?: return
                PurchaseRelay.post(
                    PurchaseRelay.play(purchase.purchaseToken, productId, purchase.orderId)
                )
            }
            Purchase.PurchaseState.PENDING ->
                PurchaseRelay.post(
                    PurchaseRelay.error("Your payment is still being processed. It will appear once it completes.")
                )
            else -> Unit
        }
    }

    /**
     * Acknowledge a purchase the SERVER has already credited.
     *
     * Play auto-refunds anything unacknowledged after three days, so a purchase
     * our backend credited but could not acknowledge — its own call to Play
     * failed — would silently reverse. The server acknowledges first and this is
     * only the fallback, which is why it is called from JS after a successful
     * /api/billing/google/purchase and never before one.
     */
    @JavascriptInterface
    fun acknowledgeIfServerCredited(purchaseToken: String) {
        connected {
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchaseToken)
                    .build()
            ) { /* best-effort: the server's own acknowledgement is the primary */ }
        }
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun readable(result: BillingResult): String = when (result.responseCode) {
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE ->
            "Google Play billing is unavailable on this device."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE ->
            "That plan is not available on Google Play yet."
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED ->
            "You already own this. Tap restore to bring it back."
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE ->
            "Couldn't reach Google Play. Check your connection and try again."
        BillingClient.BillingResponseCode.DEVELOPER_ERROR ->
            "This build isn't set up for purchases yet."
        else ->
            result.debugMessage.ifBlank { "The purchase could not be completed." }
    }
}
