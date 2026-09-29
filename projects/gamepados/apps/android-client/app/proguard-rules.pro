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

# ── AdMob → WorkManager → Room (1.4.6) ─────────────────────────────────────
# The ads SDK pulls in WorkManager, which keeps a Room database. Room creates it
# by reflection (WorkDatabase_Impl's no-argument constructor). R8 full mode keeps
# a class named by an old `-keep class X` rule but NOT its constructor, so the
# first 1.4.6 build crashed at launch: "Failed to create an instance of
# androidx.work.impl.WorkDatabase". Keep every Room database's constructor.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
