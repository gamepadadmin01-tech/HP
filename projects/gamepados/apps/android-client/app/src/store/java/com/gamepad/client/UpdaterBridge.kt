package com.gamepad.client

// playstore / aptoide / uptodown / amazonstore: deliberately empty. No
// startApkUpdate method exists on this class, so window.AndroidBridge.startApkUpdate
// is undefined in JS and the existing UpdateChecker fallback (App.tsx) opens the
// store's own listing page instead of downloading and installing an APK in-app.
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class UpdaterBridge(activity: MainActivity) : UpdaterBridgeBase(activity)
