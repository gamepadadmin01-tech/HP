package com.gamepad.camos

import android.app.Activity
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
import org.json.JSONObject

/**
 * Buying CamOS Premium through Google Play (owner, 2026-11-26: payments "same as GamepadOS").
 * A cut-down copy of GamepadOS's playbilling BillingBridge.kt, selling the one thing CamOS sells: `camos_lifetime`.
 *
 * It never unlocks anything. A finished purchase gives a purchaseToken; the page sends it to
 * POST /api/billing/google/purchase with app "camos", and the SERVER checks it with Google and gives the account
 * Lifetime. That Lifetime is the same one GamepadOS uses, so one purchase covers both apps.
 *
 * Whose purchase it is: Play stamps an "obfuscated account id" on it and the server refuses one that is not this
 * account's. The id is sha256(userId) in hex, the same as GamepadOS and billing/providers/googleplay.js accountIdFor.
 *
 * Every answer goes to window.camosOnPurchase({state, purchaseToken?, message?, restored?}) through [post].
 */
class CamBilling(private val activity: Activity, private val post: (JSONObject) -> Unit) {

    companion object { const val PRODUCT = "camos_lifetime" }

    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val list = purchases.orEmpty()
                if (list.isEmpty()) post(state("cancelled")) else list.forEach { report(it, restored = false) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> post(state("cancelled"))
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> query(restored = false)
            else -> post(error(readable(result)))
        }
    }

    private val client: BillingClient by lazy {
        BillingClient.newBuilder(activity)
            .setListener(purchasesUpdated)
            // Required since Billing 7: slow payment methods (cash, bank transfer) make a purchase PENDING.
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
    }

    /** Run [block] on a connected client, reconnecting if Play dropped the connection (it does, freely). */
    private fun connected(onFail: (BillingResult) -> Unit, block: () -> Unit) {
        if (client.isReady) { block(); return }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) block() else onFail(result)
            }
            override fun onBillingServiceDisconnected() {}   // the next tap reconnects
        })
    }

    /** Open Google Play's purchase sheet. [userId] is the raw account id; it is hashed here. */
    fun buy(userId: String) {
        connected({ post(error(readable(it))) }) {
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(listOf(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT).setProductType(BillingClient.ProductType.INAPP).build()))
                .build()
            client.queryProductDetailsAsync(params) { result, query ->
                val product = query.productDetailsList.firstOrNull()
                when {
                    result.responseCode != BillingClient.BillingResponseCode.OK -> post(error(readable(result)))
                    // Play doesn't know the item for THIS install: installed from a file instead of Google Play, or
                    // the product isn't active in Play Console yet.
                    product == null -> post(error("Google Play doesn't offer Premium to this copy of CamOS. " +
                        "Buying only works in the version installed from Google Play."))
                    else -> launch(product, userId)
                }
            }
        }
    }

    /** Hand back anything already bought: a purchase can finish while CamOS is closed, or the server's answer can get
     *  lost. Answers carry `restored: true` so the page stays quiet unless Premium turns on. */
    fun restore() = query(restored = true)

    /** Report what Play says this phone owns. Also used when Play answers "already owned" to a tap on Get Premium:
     *  that purchase then goes to the server like a new one (and the player sees the answer). */
    private fun query(restored: Boolean) {
        connected({ if (!restored) post(error(readable(it))) }) {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
            ) { _, purchases ->
                val mine = purchases.filter { PRODUCT in it.products }
                if (mine.isEmpty() && !restored) post(error("Google Play says Premium is already bought, but couldn't hand it back. Try again in a minute."))
                mine.forEach { report(it, restored) }
            }
        }
    }

    /** Acknowledge a purchase the SERVER already credited. Only a safety net: the server acknowledges first, and
     *  Google refunds a purchase nobody acknowledged within 3 days. */
    fun acknowledge(purchaseToken: String) {
        connected({}) {
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchaseToken).build()) {}
        }
    }

    fun close() {
        try { if (client.isReady) client.endConnection() } catch (_: Throwable) {}
    }

    // ── inside ──────────────────────────────────────────────────────────────

    private fun launch(product: ProductDetails, userId: String) {
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).build()))
            .setObfuscatedAccountId(sha256Hex(userId))
            .build()
        activity.runOnUiThread {
            val result = client.launchBillingFlow(activity, flow)
            when (result.responseCode) {
                BillingClient.BillingResponseCode.OK -> Unit
                BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> query(restored = false)
                else -> post(error(readable(result)))
            }
            // On OK the answer arrives through purchasesUpdated.
        }
    }

    /** PENDING: not paid yet (cash, bank transfer). Play hands it back as PURCHASED once the money lands. */
    private fun report(purchase: Purchase, restored: Boolean) {
        val out = when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> state("purchased").put("purchaseToken", purchase.purchaseToken)
            Purchase.PurchaseState.PENDING -> state("pending").put("purchaseToken", purchase.purchaseToken)
            else -> return
        }
        if (restored) out.put("restored", true)
        post(out)
    }

    private fun state(s: String) = JSONObject().put("state", s)
    private fun error(message: String) = state("error").put("message", message)

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun readable(result: BillingResult): String = when (result.responseCode) {
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "Google Play billing isn't available on this phone."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "Premium isn't available on Google Play yet."
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> "You already own Premium. Sign in with the account you bought it with."
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingClient.BillingResponseCode.NETWORK_ERROR -> "Couldn't reach Google Play. Check your connection and try again."
        BillingClient.BillingResponseCode.DEVELOPER_ERROR -> "This copy of CamOS isn't set up for purchases yet."
        else -> result.debugMessage.ifBlank { "The purchase couldn't be completed." }
    }
}
