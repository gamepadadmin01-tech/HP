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
        versionCode = 22
        versionName = "0.6.0-test"
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
}
