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

// playstore flavour: Lifetime is bought through Google Play Billing and nowhere else (Google Play
// requires its own billing for digital goods). Brought back on 2026-11-02 from the version archived at
// context/archive/play-billing-bridge-2026-09-30, cut down to the one thing sold on Play: a one-time
// product (gpos_lifetime).
//
// ## What this class does NOT do
//
// It never grants anything. A finished purchase produces a purchaseToken; the page forwards it to
// POST /api/billing/google/purchase and the SERVER checks it with Google and decides. Acknowledging
// from the phone alone would tell Play the player has their goods before we confirmed it, and a client
// that can acknowledge is a client that can be patched to acknowledge without paying. The one
// acknowledgement below is only a safety net for a purchase our server credited but could not
// acknowledge itself (Google refunds an unacknowledged purchase after 3 days).
//
// ## Whose purchase it is
//
// Play stamps an "obfuscated account id" on the purchase and the server refuses one whose id is not
// this account's. The id is sha256(userId) in hex, 64 characters (Play's limit), computed here and
// by billing/providers/googleplay.js accountIdFor on the server: the two must stay identical.
//
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class BillingBridge(activity: MainActivity) : UpdaterBridge(activity) {

    // Every purchase the library reports (a flow we started, a restore, one that finished while the
    // app was closed) arrives here.
    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val list = purchases.orEmpty()
                if (list.isEmpty()) PurchaseRelay.post(PurchaseRelay.cancelled())
                else list.forEach { report(it) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> PurchaseRelay.post(PurchaseRelay.cancelled())
            else -> PurchaseRelay.post(PurchaseRelay.error(readable(result)))
        }
    }

    private val client: BillingClient by lazy {
        BillingClient.newBuilder(activity)
            .setListener(purchasesUpdated)
            // Required since Billing 7: a slow payment method (cash, bank transfer) makes a one-time
            // purchase PENDING, and the flow is refused unless this is declared.
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
    }

    /** Run [block] on a connected client, reconnecting if the service dropped (Play's client
     *  disconnects freely: updates, low memory). Every entry point must be ready to reconnect. */
    private fun connected(block: () -> Unit) {
        if (client.isReady) { block(); return }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) block()
                else PurchaseRelay.post(PurchaseRelay.error(readable(result)))
            }
            // Not retried in a loop: the next player action calls connected() again.
            override fun onBillingServiceDisconnected() {}
        })
    }

    // ── JS surface ───────────────────────────────────────────────────────────

    /** Open Play's purchase sheet for [productId]. [accountId] is the RAW user id; it is hashed here
     *  rather than in JS because the WebView's only hash (crypto.subtle) is async. */
    @JavascriptInterface
    fun startPlayPurchase(productId: String, accountId: String) {
        connected {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()))
                .build()
            client.queryProductDetailsAsync(params) { result, queryResult ->
                val product = queryResult.productDetailsList.firstOrNull()
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    PurchaseRelay.post(PurchaseRelay.error(readable(result)))
                } else if (product == null) {
                    // Google Play does not know this item for THIS install. Typical reasons: the app was installed
                    // from a file instead of Google Play (purchases only work in the Play-installed version), the
                    // version uploaded to Play does not carry billing yet, or the product is not active.
                    PurchaseRelay.post(PurchaseRelay.error(
                        "Google Play does not offer this item to this install. Buying only works in the version " +
                        "installed from Google Play. If you installed from a file, install it from Play instead."))
                } else {
                    launch(product, accountId)
                }
            }
        }
    }

    /** Hand back anything this account already owns. A purchase can finish while the app is closed;
     *  Play holds it and re-delivers it on the next query, which is what this triggers. Also the
     *  recovery path when our server credited a purchase but the page never heard back. */
    @JavascriptInterface
    fun restorePurchases() {
        connected {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
            ) { _, purchases -> purchases.forEach { report(it) } }
        }
    }

    /** Ask Google Play for these products' real prices, in the player's own currency, and hand them to the
     *  page as window.onPlayPrices({ productId: "₹19.00", ... }). Play's price is the one Google charges,
     *  so it is the only one the plan card may show next to a Play product. A product Play cannot find
     *  (for example in a test build that was not installed from Play) is simply left out. */
    @JavascriptInterface
    fun queryPlayPrices(idsCsv: String) {
        val ids = idsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(10)
        if (ids.isEmpty()) return
        connected {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(ids.map {
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(it)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                })
                .build()
            client.queryProductDetailsAsync(params) { result, queryResult ->
                val out = org.json.JSONObject()
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    for (p in queryResult.productDetailsList) {
                        val price = p.oneTimePurchaseOfferDetails?.formattedPrice
                        if (!price.isNullOrBlank()) out.put(p.productId, price)
                    }
                }
                val js = "window.onPlayPrices && window.onPlayPrices(" + org.json.JSONObject.quote(out.toString()) + ")"
                activity.runOnUiThread { activity.evalJs(js) }
            }
        }
    }

    /** Acknowledge a purchase the SERVER already credited (see the class comment). */
    @JavascriptInterface
    fun acknowledgeIfServerCredited(purchaseToken: String) {
        connected {
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchaseToken).build()
            ) { /* best effort: the server's own acknowledgement is the primary one */ }
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private fun launch(product: ProductDetails, accountId: String) {
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).build()))
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

    /** Forward one purchase to the page. PENDING is reported as an error on purpose: the player has
     *  not paid yet (cash, bank transfer), so there is nothing to credit; Play re-delivers it as
     *  PURCHASED once the money lands. */
    private fun report(purchase: Purchase) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                val productId = purchase.products.firstOrNull() ?: return
                PurchaseRelay.post(PurchaseRelay.play(purchase.purchaseToken, productId, purchase.orderId))
            }
            Purchase.PurchaseState.PENDING ->
                PurchaseRelay.post(PurchaseRelay.error("Your payment is still being processed. It will appear once it completes."))
            else -> Unit
        }
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun readable(result: BillingResult): String = when (result.responseCode) {
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "Google Play billing is unavailable on this device."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "That plan is not available on Google Play yet."
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> "You already own this. Open your plan to bring it back."
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE -> "Couldn't reach Google Play. Check your connection and try again."
        BillingClient.BillingResponseCode.DEVELOPER_ERROR -> "This build isn't set up for purchases yet."
        else -> result.debugMessage.ifBlank { "The purchase could not be completed." }
    }
}
