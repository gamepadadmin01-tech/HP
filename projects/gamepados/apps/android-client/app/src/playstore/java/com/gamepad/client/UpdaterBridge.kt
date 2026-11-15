package com.gamepad.client

import android.webkit.JavascriptInterface
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.review.ReviewManagerFactory

// playstore flavor: updates come from GOOGLE PLAY ONLY. This build never consults
// the website's /api/version for its update banner — the site can advertise a
// release Play's review pipeline hasn't published yet, which produced a banner
// that dead-ended on a listing with no update. Play's In-App Updates API is the
// single source of truth here; the other store flavors keep the listing-page
// banner (src/store/java) and direct keeps the full self-updater (src/direct/java).
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class UpdaterBridge(activity: MainActivity) : AdsBridge(activity) {
    private val updateManager by lazy { AppUpdateManagerFactory.create(activity) }

    // JS (UpdateChecker) calls this instead of fetching /api/version; the answer
    // arrives via window.__onPlayUpdate(available, availableVersionCode). A
    // sideloaded copy of this flavor (no Play install record) fails the task —
    // that's reported as "no update" so the banner simply never shows.
    @JavascriptInterface
    fun checkPlayUpdate() {
        updateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                // Also treat an interrupted immediate update (user backgrounded the
                // app mid-download) as "available" so the banner stays and can
                // resume it — otherwise the update silently disappears and the user
                // is stuck on the old version with no in-app way to finish.
                val avail = info.updateAvailability()
                val available = (avail == UpdateAvailability.UPDATE_AVAILABLE &&
                    info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) ||
                    avail == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                emit(available, info.availableVersionCode())
            }
            .addOnFailureListener { emit(false, 0) }
    }

    // Hands the whole download+install to Play's full-screen immediate-update flow
    // (starts a fresh update or resumes one that was interrupted).
    @JavascriptInterface
    fun startPlayUpdate() {
        updateManager.appUpdateInfo.addOnSuccessListener { info ->
            val avail = info.updateAvailability()
            if (avail == UpdateAvailability.UPDATE_AVAILABLE ||
                avail == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                try {
                    updateManager.startUpdateFlow(
                        info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE)
                    )
                } catch (_: Exception) {
                    // Play UI refused to launch (rare; e.g. activity finishing) —
                    // nothing sensible to do in-app; the next check re-offers it.
                }
            }
        }
    }
    // Note: an update interrupted by backgrounding is recovered because the JS
    // UpdateChecker re-runs checkPlayUpdate() when the app returns to the
    // foreground (visibilitychange), and both check + start above accept the
    // IN_PROGRESS state — so the banner reappears and resumes the flow.

    // ── Rate us on Google Play (owner, 2026-11-15) ─────────────────────────────────────────────
    // Google's own rating card, shown inside the app; the stars go straight to the Play listing. The page
    // decides WHEN (FeatureIntroOverlay.askForRating: after a real session the player ended, rarely) and
    // never asks "do you like the app?" first (Play forbids sending only happy players to the card).
    // Google decides whether the card actually appears (it limits how often a person sees it) and never
    // says whether they rated, so there is nothing to report back.
    private val reviewManager by lazy { ReviewManagerFactory.create(activity) }

    @JavascriptInterface
    fun requestPlayReview() {
        activity.runOnUiThread {
            reviewManager.requestReviewFlow().addOnCompleteListener { task ->
                if (!task.isSuccessful || activity.isFinishing || activity.isDestroyed) return@addOnCompleteListener
                try { reviewManager.launchReviewFlow(activity, task.result) } catch (_: Exception) { }
            }
        }
    }

    private fun emit(available: Boolean, code: Int) {
        activity.evalJs("window.__onPlayUpdate && window.__onPlayUpdate($available, $code)")
    }
}
