package com.gamepad.client

import android.app.Activity
import com.unity3d.ads.IUnityAdsInitializationListener
import com.unity3d.ads.IUnityAdsLoadListener
import com.unity3d.ads.IUnityAdsShowListener
import com.unity3d.ads.UnityAds
import com.unity3d.ads.UnityAdsShowOptions
import com.unity3d.ads.metadata.MetaData

// Unity rewarded ads — the direct (website) and uptodown builds (build.gradle.kts, 2026-10-30).
// The playstore build has an inert class of the same name in src/nounity/java and stays on AdMob.
//
// Three steps, each calling back on the main thread with null (fine) or an AdProblem (the sentence
// for the player, who is to blame, and Unity's error name -- see AdFailure):
//   start()    starts the SDK once, with the game id from BuildConfig
//   loadThen() makes sure one ad is ready
//   show()     plays it; the answer says whether the player watched it to the end
//
// Unity's own code on the phone is the only proof an ad finished, so a signed-in claim is checked by
// the server's 30-minute rule alone (routes.ads.js, /api/ads/unity/claim) — see AdsBridge.
class UnityRewarded(private val activity: Activity) {

    private var initializing = false
    private var ready = false
    private var loaded = false
    private var loading = false
    private val startWaiting = mutableListOf<(AdProblem?) -> Unit>()
    private val loadWaiting = mutableListOf<(AdProblem?) -> Unit>()

    /** [personalised] false in the EEA/UK-style regions where consent is required: no tracking. */
    fun start(personalised: Boolean, done: (AdProblem?) -> Unit) {
        if (ready) { done(null); return }
        startWaiting += done
        if (initializing) return
        initializing = true
        MetaData(activity).apply { set("gdpr.consent", personalised); commit() }
        UnityAds.initialize(activity.applicationContext, BuildConfig.UNITY_GAME_ID, BuildConfig.UNITY_TEST_MODE,
            object : IUnityAdsInitializationListener {
                override fun onInitializationComplete() = main {
                    ready = true; initializing = false
                    flush(startWaiting, null)
                }
                override fun onInitializationFailed(error: UnityAds.UnityAdsInitializationError?, message: String?) = main {
                    initializing = false
                    flush(startWaiting, AdProblem("Couldn't start the ad service. Check your internet, or turn off " +
                        "Private DNS, VPN or ad blockers, then try again. (Error ${error?.name ?: "unknown"})",
                        AdFailure.NETWORK, error?.name ?: "UNKNOWN"))
                }
            })
    }

    fun loadThen(done: (AdProblem?) -> Unit) {
        if (loaded) { done(null); return }
        loadWaiting += done
        if (loading) return
        loading = true
        UnityAds.load(BuildConfig.UNITY_REWARDED_PLACEMENT, object : IUnityAdsLoadListener {
            override fun onUnityAdsAdLoaded(placementId: String?) = main {
                loading = false; loaded = true
                flush(loadWaiting, null)
            }
            override fun onUnityAdsFailedToLoad(placementId: String?, error: UnityAds.UnityAdsLoadError?, message: String?) = main {
                loading = false; loaded = false
                flush(loadWaiting, AdProblem("No ad is available right now. Try again in a minute. (Error ${error?.name ?: "unknown"})",
                    AdFailure.unityLoad(error?.name), error?.name ?: "UNKNOWN"))
            }
        })
    }

    /** [done] gets (true, null) when the player watched to the end, (false, null) when they skipped
     *  or closed it, and (false, problem) when it could not play. */
    fun show(done: (Boolean, AdProblem?) -> Unit) {
        loaded = false
        UnityAds.show(activity, BuildConfig.UNITY_REWARDED_PLACEMENT, UnityAdsShowOptions(), object : IUnityAdsShowListener {
            override fun onUnityAdsShowFailure(placementId: String?, error: UnityAds.UnityAdsShowError?, message: String?) = main {
                done(false, AdProblem("The ad could not play. Try again in a minute. (Error ${error?.name ?: "unknown"})",
                    AdFailure.unityShow(error?.name), error?.name ?: "UNKNOWN"))
            }
            override fun onUnityAdsShowStart(placementId: String?) {}
            override fun onUnityAdsShowClick(placementId: String?) {}
            override fun onUnityAdsShowComplete(placementId: String?, state: UnityAds.UnityAdsShowCompletionState?) = main {
                done(state == UnityAds.UnityAdsShowCompletionState.COMPLETED, null)
            }
        })
    }

    private fun flush(waiting: MutableList<(AdProblem?) -> Unit>, problem: AdProblem?) {
        val copy = waiting.toList()
        waiting.clear()
        copy.forEach { it(problem) }
    }

    private fun main(block: () -> Unit) = activity.runOnUiThread(block)
}
