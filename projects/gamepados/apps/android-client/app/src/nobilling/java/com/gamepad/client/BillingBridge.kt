package com.gamepad.client

// playstore / aptoide / amazonstore / indusstore / apkpure: deliberately empty.
//
// Play sells nothing since 2026-09-30 (rewarded ads are the only way to more
// time there); the other four mandate their own billing or have not confirmed
// ours. So these builds contain no purchase surface at all — not even a
// "manage your plan at gamepad.space" link, which is already a policy breach on
// Amazon. Because WebView's @JavascriptInterface reflection walks the whole class
// hierarchy of the bound object, a method absent from this chain is genuinely
// absent from window.AndroidBridge rather than merely disabled: JS feature-detects
// startPlayPurchase/startRazorpayCheckout, finds neither, and renders plan status
// only.
//
// The server agrees independently — /api/billing/plans reports purchasable:false
// for these channels — so the two would have to BOTH be wrong for a buy button to
// appear. See PlanPanel.tsx.
//
// open: MainActivity's anonymous JS-interface object extends this class directly.
open class BillingBridge(activity: MainActivity) : UpdaterBridge(activity)
