package com.gamepad.client

// Common base for the flavor-specific JS-interface object bound to "AndroidBridge".
// The real "AndroidBridge" object (built in MainActivity) extends the concrete
// UpdaterBridge from EITHER src/direct/java (has startApkUpdate) OR src/store/java
// (does not) — see build.gradle.kts's per-flavor sourceSets wiring. Because WebView's
// @JavascriptInterface reflection walks the full class hierarchy of the bound object,
// a method simply absent from this hierarchy is truly absent from window.AndroidBridge
// in JS, not just internally disabled — that's what keeps the self-updater fully out
// of the store-safe builds rather than merely unreachable.
abstract class UpdaterBridgeBase(protected val activity: MainActivity)
