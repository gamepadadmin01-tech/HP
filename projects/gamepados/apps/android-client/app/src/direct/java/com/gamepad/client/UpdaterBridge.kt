package com.gamepad.client

import android.webkit.JavascriptInterface

// direct (website) and uptodown flavors only (uptodown since 2026-11-09): exposes the in-app self-updater to JS.
// Google Play forbids an app from updating its own APK by any method other than Play's own mechanism, so this
// class — and the REQUEST_INSTALL_PACKAGES permission it needs — must never be compiled into the Play build.
// See build.gradle.kts and the direct / uptodown AndroidManifest.xml overlays for the other half of this split.
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class UpdaterBridge(activity: MainActivity) : AdsBridge(activity) {
    @JavascriptInterface
    fun startApkUpdate(url: String, sha256: String) {
        activity.beginApkUpdate(url, sha256)
    }
}
