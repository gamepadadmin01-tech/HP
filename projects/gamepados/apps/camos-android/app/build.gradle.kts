plugins {
    id("com.android.application")
}

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
        versionCode = 27
        versionName = "0.6.5-test"
        // Real phones only (64- and 32-bit ARM). The x86 copies of the native libraries exist only for PC
        // emulators and doubled the app's size once TensorFlow Lite was added.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }
    androidResources {
        noCompress += "tflite"   // the person model is memory-mapped straight from the APK
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
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
}
