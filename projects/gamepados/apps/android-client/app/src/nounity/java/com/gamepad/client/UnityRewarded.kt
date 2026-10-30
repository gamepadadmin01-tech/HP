package com.gamepad.client

import android.app.Activity

// The playstore build stays on AdMob and carries no Unity SDK. This class only lets AdsBridge compile
// the same way in all three ad builds; AdsBridge never calls it unless BuildConfig.AD_NETWORK == "unity".
@Suppress("UNUSED_PARAMETER")
class UnityRewarded(activity: Activity) {
    private val none = "Unity ads are not part of this build."
    fun start(personalised: Boolean, done: (String?) -> Unit) = done(none)
    fun loadThen(done: (String?) -> Unit) = done(none)
    fun show(done: (Boolean, String?) -> Unit) = done(false, none)
}
