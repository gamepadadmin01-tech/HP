-keepclasseswithmembernames class * {
    native <methods>;
}

-keep class com.gamepad.client.MainActivity { *; }
-keep class com.gamepad.client.GamepadService { *; }
-keep class com.gamepad.client.GamepadApplication { *; }

# ── Billing ──────────────────────────────────────────────────────────────────
# Release builds are minified (isMinifyEnabled = true), and both payment SDKs
# are reached reflectively, so without these the purchase flow works in debug
# and fails only in the build that ships.
#
# Razorpay (direct flavor). Its checkout calls back into onPaymentSuccess /
# onPaymentError by name, and drives its own WebView through @JavascriptInterface.
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** { *; }
-keep class com.gamepad.client.RazorpayActivity { *; }
-keepclasseswithmembers class * {
    public void onPayment*(...);
}
# Razorpay's own guidance: inlining breaks its callback dispatch.
-optimizations !method/inlining/*

# Google Play Billing (playstore flavor).
-dontwarn com.android.billingclient.**
-keep class com.android.billingclient.api.** { *; }

# The result channel both flavors post into, called from SDK threads.
-keep class com.gamepad.client.PurchaseRelay { *; }
