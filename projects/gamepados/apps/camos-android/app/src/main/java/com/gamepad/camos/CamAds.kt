package com.gamepad.camos

import android.app.Activity
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject

/**
 * "Watch an ad → 1080p HD for 45 minutes" (owner, 2026-11-26: ads "same as GamepadOS" = AdMob).
 * A cut-down copy of GamepadOS's AdsBridge.kt (AdMob part only).
 *
 * Nothing here shows an ad on its own: one plays only when the player taps "Watch an ad". Google's consent form
 * (EEA/UK) is asked on that first tap, never at launch.
 *
 * The unlock itself happens on the page (CamOS's plan rules all live on the phone). Ad unit: BuildConfig.ADMOB_REWARDED_ID,
 * Google's published TEST unit until CamOS has its own AdMob app (build.gradle.kts). Never watch or tap LIVE ads on
 * our own phones: AdMob counts that as invalid traffic (GamepadOS was limited for it on 2026-10-23).
 *
 * Answers go to window.camosOnAd({status: "rewarded" | "closed" | "failed", message?}) through [post].
 */
class CamAds(private val activity: Activity, private val post: (JSONObject) -> Unit) {

    private var ad: RewardedAd? = null
    private var loading = false
    private var started = false
    /** A tap that came before an ad had loaded: play it as soon as one does. */
    private var waiting = false

    private val consent: ConsentInformation by lazy { UserMessagingPlatform.getConsentInformation(activity) }

    /** The tap: consent if needed, then play an ad (loading one first if none is ready). */
    fun show() = activity.runOnUiThread {
        gatherConsent { problem ->
            if (problem != null) { post(failed(problem)); return@gatherConsent }
            startSdk()
            val ready = ad
            if (ready != null) play(ready) else { waiting = true; load() }
        }
    }

    /** Warm an ad while the HD card is on screen, so the tap is instant. Only after consent was given on an earlier
     *  tap: opening a screen must never pop a consent form. */
    fun preload() = activity.runOnUiThread {
        if (!consent.canRequestAds()) return@runOnUiThread
        startSdk()
        if (ad == null) load()
    }

    fun privacyOptionsRequired(): Boolean =
        consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    fun showPrivacyOptions() = activity.runOnUiThread { UserMessagingPlatform.showPrivacyOptionsForm(activity) { } }

    // ── inside ──────────────────────────────────────────────────────────────

    private fun gatherConsent(done: (String?) -> Unit) {
        consent.requestConsentInfoUpdate(activity, ConsentRequestParameters.Builder().build(), {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                when {
                    consent.canRequestAds() -> done(null)
                    formError != null -> done(consentProblem(formError.errorCode))
                    else -> done("Ads need your OK first. Tap Watch an ad again and choose an option on Google's form.")
                }
            }
        }, { error ->
            // The check failed (no internet, Private DNS, ad blocker). An answer saved earlier still counts.
            done(if (consent.canRequestAds()) null else consentProblem(error.errorCode))
        })
    }

    /** UMP codes: 1 internal, 2 internet, 3 setup, 4 timeout. */
    private fun consentProblem(code: Int): String = when (code) {
        2, 4 -> "Couldn't reach Google to check ad settings. Check your internet, or turn off Private DNS, VPN or ad blockers, then try again. (Error $code)"
        else -> "Couldn't check ad settings with Google right now. Turn off Private DNS, VPN or ad blockers and try again in a minute. (Error $code)"
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
        RewardedAd.load(activity, BuildConfig.ADMOB_REWARDED_ID, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(loaded: RewardedAd) {
                loading = false
                ad = loaded
                if (waiting) { waiting = false; play(loaded) }
            }
            override fun onAdFailedToLoad(error: LoadAdError) {
                loading = false
                ad = null
                if (waiting) { waiting = false; post(failed("No ad is available right now. Try again in a minute. (Error ${error.code})")) }
            }
        })
    }

    private fun play(rewarded: RewardedAd) {
        ad = null
        var earned = false
        rewarded.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                post(JSONObject().put("status", if (earned) "rewarded" else "closed"))
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                post(failed("The ad couldn't play. Try again in a minute. (Error ${error.code})"))
            }
        }
        rewarded.show(activity) { earned = true }
    }

    private fun failed(message: String) = JSONObject().put("status", "failed").put("message", message)
}
