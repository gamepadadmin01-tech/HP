package com.gamepad.client

import android.webkit.JavascriptInterface

// direct flavor only: exposes the in-app self-updater to JS. Google Play forbids an
// app from updating its own APK by any method other than Play's own mechanism, so
// this class — and the REQUEST_INSTALL_PACKAGES permission it needs — must never be
// compiled into a store-distributed build. See build.gradle.kts / AndroidManifest.xml
// (src/direct overlay) for the other half of this split.
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class UpdaterBridge(activity: MainActivity) : UpdaterBridgeBase(activity) {
    @JavascriptInterface
    fun startApkUpdate(url: String, sha256: String) {
        activity.beginApkUpdate(url, sha256)
    }
}
