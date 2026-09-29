package com.gamepad.client

import android.webkit.JavascriptInterface
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject

// Rewarded ads — playstore, direct and uptodown only (build.gradle.kts wires src/ads/java into those
// three; the other stores get the empty class in src/noads/java, so these methods are absent from
// window.AndroidBridge there, the same store-safety boundary as BillingBridge and UpdaterBridge).
//
// ## The only ad in the app, and it is optional
//
// Nothing here shows an ad on its own. An ad plays only when the player taps "Watch an ad · +30 min"
// (showRewardedAd). Never on the controller screen while input is live, never at launch.
//
// ## Who grants the 30 minutes
//
//   * Signed in: the SERVER. The account id rides on the ad as Google's server-side-verification
//     user id; when the ad completes, Google calls /api/ads/admob/reward with a signed message and
//     the server banks the time. This class grants nothing for a signed-in player — a patched app
//     that claims a reward gets nothing, because only Google's signature counts.
//   * Signed out: there is no account to credit, so the phone banks it itself (GuestTrial.creditAd),
//     exactly like the daily 30 free minutes, which are also counted on the phone.
//
// ## Consent (Google's User Messaging Platform)
//
// Asked on the first tap, not at launch: a consent form is only worth showing to someone who has
// chosen to watch an ad. Where the law needs it (EEA/UK), Google's own form appears once; after
// that canRequestAds() stays true across launches. adPrivacyOptionsRequired/showAdPrivacyOptions
// let the settings screen offer "Ad privacy choices", which the EEA requires to be reachable.
//
// Results reach JS as window.onRewardedAdResult(json), json = { status, message?, guest? } where
// status is "rewarded" | "closed" (dismissed before the reward) | "failed" | "consent".
open class AdsBridge(activity: MainActivity) : UpdaterBridgeBase(activity) {

    private var ad: RewardedAd? = null
    private var loading = false
    private var started = false
    /** A tap that arrived before an ad had loaded: show it as soon as one does. */
    private var waitingUser: String? = null

    private val consent: ConsentInformation by lazy { UserMessagingPlatform.getConsentInformation(activity) }

    @JavascriptInterface
    fun adsAvailable(): Boolean = true

    /** Tap: ask for consent if needed, then show an ad (loading one first if none is ready). */
    @JavascriptInterface
    fun showRewardedAd(userId: String) {
        activity.runOnUiThread {
            gatherConsent { ok ->
                if (!ok) { report("consent", "Ads could not be shown without your ad choices."); return@gatherConsent }
                startSdk()
                val ready = ad
                if (ready != null) show(ready, userId)
                else { waitingUser = userId; load() }
            }
        }
    }

    /** Warm an ad so the tap is instant. Does nothing until consent was given on an earlier tap —
     *  merely opening a screen must never pop a consent form. */
    @JavascriptInterface
    fun preloadRewardedAd() {
        activity.runOnUiThread {
            if (!consent.canRequestAds()) return@runOnUiThread
            startSdk()
            if (ad == null) load()
        }
    }

    @JavascriptInterface
    fun adPrivacyOptionsRequired(): Boolean =
        consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    @JavascriptInterface
    fun showAdPrivacyOptions() {
        activity.runOnUiThread { UserMessagingPlatform.showPrivacyOptionsForm(activity) { } }
    }

    private fun gatherConsent(done: (Boolean) -> Unit) {
        val params = ConsentRequestParameters.Builder().build()
        consent.requestConsentInfoUpdate(activity, params, {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { _ -> done(consent.canRequestAds()) }
        }, { _ ->
            // No network for the consent check: fall back to what was decided last time.
            done(consent.canRequestAds())
        })
    }

    private fun startSdk() {
        if (started) return
        started = true
        // Google asks for initialize() off the main thread; ads may be requested before it finishes.
        Thread { try { MobileAds.initialize(activity) { } } catch (_: Throwable) { } }.start()
    }

    private fun load() {
        if (loading) return
        loading = true
        RewardedAd.load(activity, BuildConfig.ADMOB_REWARDED_ID, AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(loaded: RewardedAd) {
                    loading = false
                    ad = loaded
                    waitingUser?.let { u -> waitingUser = null; show(loaded, u) }
                }
                override fun onAdFailedToLoad(error: LoadAdError) {
                    loading = false
                    ad = null
                    if (waitingUser != null) {
                        waitingUser = null
                        report("failed", "No ad is available right now. Try again in a minute.")
                    }
                }
            })
    }

    private fun show(rewarded: RewardedAd, userId: String) {
        ad = null
        val signedIn = userId.isNotBlank()
        if (signedIn) {
            rewarded.setServerSideVerificationOptions(
                ServerSideVerificationOptions.Builder().setUserId(userId).build())
        }
        var earned = false
        rewarded.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                report(if (earned) "rewarded" else "closed", null, guest = !signedIn)
                load()   // the next one is ready before they want it
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                report("failed", "The ad could not play. Try again in a minute.")
                load()
            }
        }
        rewarded.show(activity) { _ ->
            earned = true
            if (!signedIn) activity.creditGuestAdReward()
        }
    }

    private fun report(status: String, message: String?, guest: Boolean = false) {
        val json = JSONObject().put("status", status).put("guest", guest)
        if (message != null) json.put("message", message)
        activity.evalJs("window.onRewardedAdResult && window.onRewardedAdResult(" +
            JSONObject.quote(json.toString()) + ")")
    }
}
