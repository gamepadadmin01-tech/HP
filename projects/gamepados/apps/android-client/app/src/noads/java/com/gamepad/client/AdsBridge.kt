package com.gamepad.client

// aptoide / amazonstore / indusstore / apkpure: no ads, deliberately empty.
//
// These builds contain no ad SDK at all (build.gradle.kts adds play-services-ads only to playstore,
// direct and uptodown). Because WebView's @JavascriptInterface reflection walks the whole class
// hierarchy of the bound object, showRewardedAd & co. are genuinely absent from window.AndroidBridge
// here, so the UI feature-detects them, finds nothing, and never renders the "Watch an ad" button.
//
// open: every flavour's UpdaterBridge extends this class.
open class AdsBridge(activity: MainActivity) : UpdaterBridgeBase(activity)
