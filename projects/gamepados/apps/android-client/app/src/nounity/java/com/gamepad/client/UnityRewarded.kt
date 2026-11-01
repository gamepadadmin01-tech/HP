package com.gamepad.client

import android.app.Activity

// The playstore build stays on AdMob and carries no Unity SDK. This class only lets AdsBridge compile
// the same way in all three ad builds; AdsBridge never calls it unless BuildConfig.AD_NETWORK == "unity".
@Suppress("UNUSED_PARAMETER")
class UnityRewarded(activity: Activity) {
    private val none = AdProblem("Unity ads are not part of this build.", AdFailure.OTHER, "NOT_IN_BUILD")
    fun start(personalised: Boolean, done: (AdProblem?) -> Unit) = done(none)
    fun loadThen(done: (AdProblem?) -> Unit) = done(none)
    fun show(done: (Boolean, AdProblem?) -> Unit) = done(false, none)
}
