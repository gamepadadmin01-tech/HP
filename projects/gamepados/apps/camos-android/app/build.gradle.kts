plugins {
    id("com.android.application")
}

// ── AdMob ("Watch an ad → 45 min HD", CamAds.kt) ──────────────────────────────
// Google's published TEST ids until CamOS has its own AdMob app and rewarded unit (the owner creates them in AdMob,
// then pastes them below). Debug builds always use the test ids; so does a release while the live ones are blank.
// Never watch or tap LIVE ads on our own phones (invalid traffic: AdMob limited GamepadOS for it on 2026-10-23);
// `-PtestAds=true` keeps the test ids in a release build meant for our own phone. Not secrets: they ship in the APK.
val admobTestAppId = "ca-app-pub-3940256099942544~3347511713"
val admobTestRewardedId = "ca-app-pub-3940256099942544/5224354917"
val admobLiveAppId = ""        // ca-app-pub-5878015482565093~NNNNNNNNNN  (AdMob > Apps > CamOS > App settings)
val admobLiveRewardedId = ""   // ca-app-pub-5878015482565093/NNNNNNNNNN  (AdMob > CamOS > Ad units > Rewarded)
val admobLive = admobLiveAppId.isNotBlank() && admobLiveRewardedId.isNotBlank() &&
    (findProperty("testAds") ?: "false").toString() != "true"

android {
    namespace = "com.gamepad.camos"
    compileSdk = 36
    buildToolsVersion = "37.0.0"   // same as GamepadOS: the build-tools installed in toolchain/android-sdk

    defaultConfig {
        // Its own Play Store listing, same developer prefix as GamepadOS (com.gamepad.client).
        applicationId = "com.gamepad.camos"
        // 26 = Android 8. Adaptive icons and every Camera2/MediaCodec feature we use exist from here.
        minSdk = 26
        targetSdk = 36
        versionCode = 31
        versionName = "0.6.9-test"
        // Real phones only (64- and 32-bit ARM). The x86 copies of the native libraries exist only for PC
        // emulators and doubled the app's size once TensorFlow Lite was added.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }

        buildConfigField("String", "ADMOB_REWARDED_ID", "\"$admobTestRewardedId\"")
        manifestPlaceholders["admobAppId"] = admobTestAppId
    }
    androidResources {
        noCompress += "tflite"   // the person model is memory-mapped straight from the APK
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (admobLive) {
                buildConfigField("String", "ADMOB_REWARDED_ID", "\"$admobLiveRewardedId\"")
                manifestPlaceholders["admobAppId"] = admobLiveAppId
            } else {
                logger.warn("CamOS release uses Google's TEST ads: no live AdMob ids yet (build.gradle.kts, top).")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Serves the bundled UI from https://appassets.androidplatform.net (as GamepadOS does).
    implementation("androidx.webkit:webkit:1.10.0")
    // QR scanning only (the same CameraX + ZXing pair as GamepadOS). Streaming uses Camera2 directly
    // (CamStreamer.kt), because it must feed the phone's video chip and the screen at the same time.
    val cameraxVersion = "1.4.0"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")
    implementation("com.google.zxing:core:3.5.3")
    // Premium filters (owner, 2026-11-23), both on a small copy of the picture on their own thread (Vision.kt):
    //  - background blur: Google's MediaPipe selfie-segmenter model (assets/models, ~250 KB, Apache-2.0) run by
    //    TensorFlow Lite (~3 MB per CPU type). ML Kit's bundled selfie segmentation was tried first: +20 MB per CPU type.
    //  - auto-framing: ML Kit face detection from Google Play services (model lives in Play services, ~0 MB here).
    // MediaPipe Tasks runs the model: it carries MediaPipe's own Convolution2DTransposeBias operation, which plain
    // TensorFlow Lite refuses even with its GPU runner (tried on the owner's phone, 2026-11-23).
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
    implementation("com.google.android.gms:play-services-mlkit-face-detection:17.1.0")
    // Get Premium through Google Play (CamBilling.kt), the same library and version as GamepadOS's Play build.
    // Adds the BILLING permission by itself.
    implementation("com.android.billingclient:billing-ktx:9.1.0")
    // "Watch an ad → 45 min HD" (CamAds.kt) + Google's consent form, the same versions as GamepadOS.
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    // The ads library asks for an old WorkManager whose rules broke GamepadOS's first shrunk build; use the current one.
    implementation("androidx.work:work-runtime:2.12.0")
}
