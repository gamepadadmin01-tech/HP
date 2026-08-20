import java.util.Properties
import java.io.FileInputStream

plugins {
    // No Kotlin plugin: AGP 9 has built-in Kotlin support and rejects
    // org.jetbrains.kotlin.android being applied alongside it (see the root
    // build.gradle.kts note).
    id("com.android.application")
}

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localProperties.load(FileInputStream(localPropertiesFile))
}

android {
    namespace = "com.gamepad.client"
    // Play requires targeting the latest API level (36 as of this release) for new
    // uploads; compileSdk must be >= targetSdk.
    compileSdk = 36
    // Pin to the build-tools actually installed. AGP 8.13 defaults to 35.0.0,
    // which is not on this machine (34.0.0 and 36.1.0 are), and there is no
    // cmdline-tools/sdkmanager here to auto-fetch it — the build fails with
    // "Failed to install ... licences have not been accepted". 36.1.0 is newer
    // than AGP's default, which AGP accepts. Install 35.0.0 or re-pin if this
    // machine's SDK changes.
    buildToolsVersion = "36.1.0"
    // Pin to the NDK actually installed (local.properties ndk.dir) — AGP
    // otherwise defaults to a newer NDK and fails the build (CXX1104).
    ndkVersion = "25.1.8937393"

    defaultConfig {
        applicationId = "com.gamepad.client"
        minSdk = 24
        targetSdk = 36
        // versionCode is permanently consumed per-app on Play Console the instant ANY
        // track sees it — even a draft upload that errored out and was never
        // published. 22 got burned during testing, 23 got burned by the upload
        // attempt that hit the 16KB-alignment warning, 24 is the live Play build.
        // EVERY future re-upload to Play, fix or not, needs a fresh number.
        // 25 = 1.3.1: WebViewAssetLoader origin switch (fixes in-app feedback +
        // update check being blocked on the file:// origin) + editor panel scroll
        // fix — activated on the website 2026-07-11, so 25 is consumed too.
        // 26 = 1.3.2: playstore flavor gets updates from Google Play's In-App
        // Updates API instead of the website manifest (site could be ahead of
        // Play review → banner dead-ended on a listing with no update).
        // 27 = 1.3.3: bug-hunt fixes — update-banner callback clobber between the
        // two mounted checkers, preset/pos overrides now persisted, migration
        // replay reloads unconditionally, WebView navigation pinned to our origin,
        // connect-failure Wi-Fi lock leak, JSON-escaped network details, Play
        // interrupted-update recovery, stickmode false warning, slider drag guard.
        // 28 = 1.3.4: feedback UI redesign — "Submit feedback" opens a slide-up
        // tray with the form (+ live char hint so the send button is never a
        // mystery "dead" button), and a "Contact us" button opens the website
        // contact page.
        // 29 = 1.3.5: focused-audit follow-ups — feedback tray always opens fresh
        // (no stale/duplicate send), foreground update re-check no longer blanks
        // an active banner/download, and shouldOverrideUrlLoading now matches the
        // parsed host exactly (a lookalike like appassets…@evil.com is no longer
        // allowed into the privileged WebView).
        // 30 = 1.3.6: build-tooling modernization only (Kotlin 1.9→2.4, Gradle
        // 8.9→8.14.4, androidx core/appcompat/material bumped).
        // 31 = 1.3.7: per-button haptic profiles (d-pad/system = light tick, face/
        // bumper/stick = medium click, triggers = heavy pull, editable per widget)
        // + smoother button animations (snappy press, springy release, color fade).
        // Includes the 1.3.6 toolchain change. Device-test pairing+input before ship.
        // 32 = 1.3.8: controller layout redesign — split LT/RT into independent
        // buttons, increased all button sizes (LB/RB +25%, ABXY +18%, DPAD +20%,
        // system/mode +25%, hybrid stick +21%) to fill the controller more completely.
        // 33 = 1.3.9: transport-coordinator fix — a wireless (QR/manual) connect no
        // longer silently resets the user's explicit Wired-mode choice to "auto";
        // instead a transient wireless-intent flag protects the live Wi-Fi link so
        // the coordinator can't stopEngine() it or open a 2nd-pad WS.
        // 34 = 1.3.10: Standard pad IS now the user's on-device "My Custom Pad"
        // design (getTrueStandardLayout replaced) + rename-pad pill in the editor.
        // 35 = 1.3.11: Standard pad swapped to the user's newer "Replacement" design.
        // 36 = 1.3.12: import/share controller layouts by code (New Layout → Import
        // from Code; Share button on pad cards) backed by /api/pads on the server.
        // 37 = 1.3.13: custom-pad card cleanup — only LAUNCH stays; Edit/Duplicate/
        // Share/Delete moved into a ⋮ menu with an inline delete confirm.
        // 38 = 1.3.14: temperature section is now a plain read-only indicator —
        // removed the fake NOMINAL/OPTIMIZED/ELEVATED status + throttling/bypass copy
        // (the OS handles real thermal throttling); dropped unused shizuku/bypass code.
        // 39 = 1.3.15: ⋮ menu no longer clipped (card overflow) + smoother spring
        // animation; removed "Performance Engine 1000Hz" from System + Advanced tabs;
        // added Privacy Policy link + app version to Advanced tab; opening logo splash.
        // 40 = 1.3.16: NEW "Graphite Steel" theme (charcoal + steel-blue, replaces the
        // neon cyan/purple) + Space Grotesk headings; native Android 12 SplashScreen
        // kills the black cold-start window (branded logo paints instantly, hands off
        // to the JS splash); dropped the deprecated View.SYSTEM_UI_FLAG_* edge-to-edge
        // bitmask (Play "deprecated edge-to-edge APIs" warning) for WindowInsetsController.
        // 41 = 1.3.17: Added manifest compat properties and letterboxing guard for Android 16 large-screen resizability.
        // 42 = 1.3.18: Fixed large-screen letterboxing guard to trigger on cold launch (in onCreate).
        // 43 = 1.3.19: Adaptive large-screen letterboxing: detects portrait (9:20) vs landscape (20:9) controller transitions.
        // 44 = 1.3.20: Unlocked dashboard orientation: allow freely rotating between portrait and landscape (manifest unspecified).
        // 45 = 1.3.21: JS Bridge orientation override: map "portrait" request to "unspecified" so dashboard doesn't re-lock after exiting controller.
        // 46 = 1.3.22: Controller feel + Play-compliance pass. D-pad is strict 4-way
        // (no accidental adjacent/opposite arrows); all button + trigger animations
        // calmed to smooth pale fades with a soft wave shimmer and a glassy rim
        // (translucent body, no solid press fill); analog throttle now tracks the
        // finger 1:1 (dropped the CSS-geometry transition that made it stick);
        // haptics are a short button-touch tick, fired ONCE per press instead of
        // buzzing through the whole trigger pull; gyro indicator moved back BEHIND
        // the buttons (z-0) at 7.5px with no persistent track line, and its glide is
        // now delta-time based so it behaves identically on 60 Hz and 120 Hz panels.
        // Play Console: dropped the unused Material dependency (removes the
        // deprecated setStatusBarColor/setNavigationBarColor edge-to-edge warning,
        // ~830 KB smaller) and replaced the deprecated LAYOUT_IN_DISPLAY_CUTOUT_MODE_
        // SHORT_EDGES with ALWAYS on API 30+.
        // 47 = 1.3.23: (no changelog entry was recorded for this code).
        // 48 = 1.3.24: GamepadOS Account. Bottom nav is Home · System · Account —
        // the old Advanced/Session tab is gone and its About text, update checker
        // and feedback card moved into Account. Signed out, Account IS the sign-in
        // screen (email + password, create account with a 6-digit email code,
        // forgot/reset password); there is no guest identity and no profile or
        // settings are shown until signed in. Layouts are now owned by a storage
        // layer (versioned schema + migrations) instead of inline localStorage, and
        // each pad carries an updatedAt so a cloud save can tell which copy is
        // newer. Account adds a rumble self-test. The rating prompt was rebuilt:
        // stars select on tap and nothing is submitted until Submit is pressed (it
        // previously fired on pointer-down, so a swipe could set a permanent
        // 1-star), under 4 stars asks what went wrong instead of thanking you, and
        // it now matches the app's theme and motion. Dropped the unused shadcn
        // scaffold and 53 unused dependencies — the UI bundle is 62 KB smaller.
        // NOTE: sign-in needs the /api/account/* backend deployed.
        // 49 = 1.3.25: visual system rebuild — "Deep Teal" palette replaces
        // Graphite Steel (surfaces now step 1.23/1.24, Apple's iOS dark ladder;
        // the old 1.11/1.09 step was below the visibility threshold, which is
        // what made the UI read as flat), spring easings solved from the damped-
        // oscillator ODE instead of cubic-beziers (transform only — a colour
        // that overshoots looks like a bug), and a liquid-glass material layer.
        // Glass is deliberately restricted to FIXED chrome (header, bottom bar,
        // modals): a backdrop-filter inside an overflow-y-auto list recomposites
        // the whole blurred region every scroll frame, which juddered Home,
        // System, Account and Connect-to-PC. Everything that scrolls gets a flat
        // translucent fill instead — same look, zero compositing cost. The
        // gameplay overlay (gyro bar, tilt arc, pad canvas) is explicitly
        // excluded so no grey band appears behind the live gyro line.
        // Honours prefers-reduced-transparency.
        // 50 = 1.3.26: three things.
        //  (a) THEME — the app is back on its blue "Slate Navy" identity. The
        //      1.3.25 re-skin retargeted the theme tokens to Deep Teal, but the
        //      Account tab hardcodes its colours (37 hex + 22 rgba vs 2 tokens),
        //      so Account stayed blue while Home/System — which ARE token-driven
        //      — went teal. Rather than repaint Account, the tokens were moved
        //      back onto its palette, which re-skins every token-driven screen at
        //      once. Surfaces are solved to the SAME contrast ladder as before
        //      (1.229/1.235) instead of being picked by eye, and two of Account's
        //      own colours were lifted 8% because they failed AA at the text size
        //      they are used at (#4F86C6 4.22:1, #E0574F 4.28:1 — the latter is
        //      the exact colour the theme file had already rejected once).
        //  (b) GYRO INDICATOR — smoked glass instead of a solid #2CAABA slab with
        //      an 8px glow, matching the pad buttons' material (specular crown +
        //      accent tint + dark underlay + hairline rim). Vertical gradients
        //      only: the bar is scaleX-driven, so a horizontal one would squash
        //      as it fills. Geometry, z-0 layering and the scaleX drive unchanged.
        //  (c) QR CONNECT RELIABILITY — the "scans fine, connects only sometimes"
        //      bug. The verifier gave the whole bring-up (engine start -> GRX
        //      handshake -> first frame -> ACK) ONE 5s shot and called stopEngine()
        //      the moment it expired, so a slow-but-healthy connect was actively
        //      killed and reported as "no response from the PC". Now 3 attempts of
        //      6s with teardown only after the last. The scanner also validates the
        //      pairing key (8 hex chars) instead of dialling with a bad token and
        //      surfacing it as a network fault, and it refreshes the transport
        //      coordinator's wireless-intent stamp while verifying so the
        //      coordinator can no longer stopEngine() an in-flight wireless link.
        // 51 = 1.3.27: BUILD TOOLCHAIN ONLY — no app code changed, the UI bundle
        // is byte-identical to 1.3.26. AGP 8.13.2 -> 9.3.1, which required
        // Gradle 8.14.4 -> 9.6.1 (tools/gradle-9.6.1; AGP 9 needs 9.5.0+) and
        // dropping the org.jetbrains.kotlin.android plugin entirely — AGP 9 has
        // built-in Kotlin and hard-fails if KGP is applied alongside it, so the
        // Kotlin compiler now comes from AGP. ndk.dir was also removed from
        // local.properties (deprecated, [CXX5106]); ndkVersion still pins the
        // same NDK 25.1.8937393, so the native build inputs are unchanged.
        // WHY: Play Console's App Bundle Explorer reported "Repackage classes"
        // and "Resource shrinking optimised" as off — both are R8/AGP defaults
        // that only flip on in AGP 9.
        // ⚠️ AGP 9 reworked the CMake/NDK integration and this app binds JNI by
        // symbol name. A clean build does not prove the native input path still
        // works: device-test pairing + input before this ships.
        // 52 = 1.3.28: RE-RELEASE OF 1.3.27, no code change whatsoever — 51 was
        // already consumed on Play Console (confirmed 2026-08-17), and a
        // versionCode is burned permanently the instant any track sees it. The
        // artifacts are otherwise identical to the 1.3.27 build: AGP 9.3.1 /
        // Gradle 9.6.1 toolchain, same UI bundle, same native inputs.
        // versionName was bumped alongside it so two different builds never share
        // the name "1.3.27" in support conversations.
        // 53 = 1.3.28 again: 52 was ALSO already consumed on Play (2026-08-17).
        // versionName deliberately NOT bumped this time — no user has ever received
        // a build called 1.3.28, so reusing the name is unambiguous, and bumping it
        // per rejected upload would fill the changelog with versions that never
        // shipped. Play only requires versionCode to be unique and increasing.
        // Codes 51 and 52 are both burned; neither can ever be reused.
        // 54 = 1.3.29: the first build since 1.3.26 with real user-facing change,
        // so the versionName moves too (1.3.27/1.3.28 were toolchain-only and
        // versionCode re-rolls after Play consumed 51 and 52).
        //
        //   * Battery: the WS worker's 3 ms tick is now adaptive — 3 ms while
        //     streaming, 250 ms idle. It used to wake ~333x/second for the life
        //     of the app, on every screen, with no clearInterval anywhere.
        //   * Battery: onPause now clears FLAG_KEEP_SCREEN_ON and releases the
        //     Wi-Fi low-latency and multicast locks. Backgrounding used to leave
        //     all three held indefinitely.
        //   * Battery: the gyro requestAnimationFrame loop is screen-gated. It
        //     was the only loop in the app with no isActive guard — a JSON.parse
        //     and a packet send per frame, at 120 Hz, on every screen.
        //   * Anonymous install id on in-app ratings, so feedback from different
        //     people stops collapsing into one apparent person.
        //
        // None of this touches the input path. Findings from the 2026-08-18
        // performance audit; see docs/research/GAMEPADOS_AUDIT_ROUND2.md §7.
        //
        // versionName moved to 1.4.0 (code STAYS 54 — never consumed on Play or
        // registered in the admin portal, so renaming costs nothing). What made
        // this a minor bump rather than another patch: the billing system
        // (plans, the daily quota, the in-app purchase flow) and the launch
        // notice banner, all landed on top of the 1.3.29 base above. Held back
        // from Register & Activate deliberately — see BILLING_DECISIONS.md and
        // RELEASE.md — until it has been tested through, on real hardware,
        // start to finish.
        versionCode = 54
        versionName = "1.4.0"

        ndk {
            // Broad device coverage (universal APK for sideload + in-app updater):
            //  arm64-v8a   — all modern phones/tablets (primary)
            //  armeabi-v7a — older / budget 32-bit ARM phones
            //  x86_64      — Android emulators, Chromebooks, x86 tablets
            // (32-bit x86 omitted: effectively dead, only adds size.)
            abiFilters.add("arm64-v8a")
            abiFilters.add("armeabi-v7a")
            abiFilters.add("x86_64")
        }

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-O3", "-flto", "-ffast-math")
            }
        }
    }

    // Two kinds of build:
    //  - "direct": the full-featured build for our own website. Keeps the in-app
    //    self-updater (REQUEST_INSTALL_PACKAGES + FileProvider install trigger).
    //  - "playstore" / "aptoide" / "uptodown" / "amazonstore": the store-safe build.
    //    The self-updater is compiled OUT entirely (no permission declared, no
    //    JS-visible startApkUpdate method — see UpdaterBridge.kt) so every
    //    marketplace gets a clean review; updates instead flow through each
    //    store's own mechanism. All flavors share one applicationId — this is
    //    purely a feature toggle, not a different app identity.
    flavorDimensions += "distribution"
    productFlavors {
        create("direct") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "true")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"direct\"")
        }
        create("playstore") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"playstore\"")
        }
        create("aptoide") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"aptoide\"")
        }
        create("uptodown") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"uptodown\"")
        }
        create("amazonstore") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"amazonstore\"")
        }
        create("indusstore") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"indusstore\"")
        }
        create("apkpure") {
            dimension = "distribution"
            buildConfigField("Boolean", "SELF_UPDATE_ENABLED", "false")
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"apkpure\"")
        }
    }

    // aptoide/uptodown/amazonstore are identical store-safe builds — they all pull
    // the SAME no-op UpdaterBridge from src/store/java instead of each needing
    // their own copy. playstore has its OWN UpdaterBridge (src/playstore/java):
    // it drives updates through Google Play's In-App Updates API instead of the
    // website manifest, so the banner only appears when Play actually has the
    // new version published (the site can be ahead of Play's review pipeline).
    // ⚠️ AGP 9: these MUST register on `kotlin`, not just `java`. Under AGP 9's
    // built-in Kotlin, `java.srcDir()` adds a dir to the JAVA compilation only —
    // the Kotlin compiler reads `kotlin.srcDir()`, whose convention already
    // covers src/<flavor>/java + src/<flavor>/kotlin. That convention is why
    // direct and playstore kept building on a java-only srcDir (their dirs are
    // named after the flavor) while the five store flavors, which share the
    // non-conventional src/store/java, failed with
    //   "Unresolved reference 'UpdaterBridge'" (MainActivity.kt:560).
    // Registering both keeps Java and Kotlin sources in the same folder working.
    sourceSets {
        listOf("aptoide", "uptodown", "amazonstore", "indusstore", "apkpure").forEach { flavor ->
            getByName(flavor).java.srcDir("src/store/java")
            getByName(flavor).kotlin.srcDir("src/store/java")
        }
        getByName("playstore").java.srcDir("src/playstore/java")
        getByName("playstore").kotlin.srcDir("src/playstore/java")
        getByName("direct").java.srcDir("src/direct/java")
        getByName("direct").kotlin.srcDir("src/direct/java")
    }

    signingConfigs {
        create("release") {
            storeFile = file("release.keystore")
            storePassword = localProperties.getProperty("keystore.password")
            keyAlias = localProperties.getProperty("key.alias")
            keyPassword = localProperties.getProperty("key.password")
        }
    }

    buildTypes {
        // A debug build installs as com.gamepad.client.dev, so a test build
        // pointed at a LAN backend sits BESIDE the real app instead of
        // replacing it — the release APK is signed with release.keystore and a
        // debug-signed APK of the same applicationId could only be installed by
        // uninstalling first, taking the user's layouts with it.
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true   // strip unused resources (smaller APK for users)
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    // Kotlin 2.x removed the android{ kotlinOptions {} } block — the jvmTarget now
    // lives in the top-level kotlin{} compilerOptions DSL below.
    externalNativeBuild {
        cmake {
            path("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    buildFeatures {
        // BuildConfig.DEBUG gates the dev-server probe and WebView debugging so
        // they never run in release builds. (AGP 8 no longer generates
        // BuildConfig unless this is explicitly enabled.)
        buildConfig = true
        // viewBinding removed: the UI is built entirely in code / the WebView,
        // there are no XML layouts, so no binding classes were ever generated.
    }
}

// Kotlin 2.x compilerOptions DSL (replaces the removed kotlinOptions block).
// JVM_1_8 kept to match the Java compileOptions above and avoid any behaviour
// change from the toolchain bump.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // NOTE: com.google.android.material was REMOVED (2026-07-19). It was never
    // referenced by any code, theme or layout (the splash theme parents off
    // Theme.SplashScreen), but its bundled datepicker classes call
    // Window.setStatusBarColor / setNavigationBarColor — both deprecated in
    // Android 15 — which is exactly what Play Console flagged under "deprecated
    // APIs for edge-to-edge". Dropping the unused dep removes the warning at the
    // source and shrinks the APK. Re-add ONLY if a Material component is used.
    // WebViewAssetLoader — serves the bundled UI from the secure
    // https://appassets.androidplatform.net origin (see MainActivity).
    implementation("androidx.webkit:webkit:1.10.0")

    // Core SplashScreen — the Android 12+ SplashScreen API backported to API 24.
    // Draws the branded logo on splash_bg from the instant the process starts,
    // eliminating the black cold-start window (see Theme.App.Splash + MainActivity).
    implementation("androidx.core:core-splashscreen:1.0.1")

    // CameraX (camera + frame analysis for QR scanning)
    // 1.4.0 resolves the Play Console 16 KB page-size warning for
    // libimage_processing_util_jni.so (the 1.3.x .so wasn't 16K-aligned).
    val cameraxVersion = "1.4.0"
    implementation("androidx.camera:camera-core:$cameraxVersion")
    implementation("androidx.camera:camera-camera2:$cameraxVersion")
    implementation("androidx.camera:camera-lifecycle:$cameraxVersion")
    implementation("androidx.camera:camera-view:$cameraxVersion")

    // ZXing — lightweight, offline QR decoding (replaces ML Kit's ~4.9 MB bundle)
    implementation("com.google.zxing:core:3.5.3")

    // Tink — X25519 + HKDF for the GRX encrypted-input handshake (GrxCrypto.kt).
    // AES-GCM itself uses javax.crypto (hardware AES). Confirm version on build.
    implementation("com.google.crypto.tink:tink-android:1.13.0")

    // Play In-App Updates — playstore flavor ONLY (src/playstore UpdaterBridge).
    // Must never leak into direct/other-store builds: Play-services update UI in
    // a non-Play build is dead weight and confuses store reviews.
    add("playstoreImplementation", "com.google.android.play:app-update:2.1.0")

    // ── Billing, per flavor ──────────────────────────────────────────────────
    // Deliberately NOT in the shared `implementation` block. Each store forbids
    // the others' payment path for digital goods, so the SDK a build must not
    // use is not merely unreachable in it — it is not in the APK at all. The
    // matching BillingBridge lives in the same flavor's source set
    // (src/playstore/java, src/direct/java) and src/store/java has neither.
    //
    // Google Play Billing — playstore flavor only.
    add("playstoreImplementation", "com.android.billingclient:billing-ktx:7.1.1")
    // Razorpay Checkout — direct flavor only (our own site's build, no store cut).
    // 1.6.38, NOT 1.6.40. From 1.6.40 the SDK is split into
    // com.razorpay:checkout + com.razorpay:core, and both artifacts declare the
    // namespace "com.razorpay" -- which AGP 9 rejects outright at manifest
    // merge ("Namespace is used in multiple modules"). It compiles fine and
    // fails only when an APK is actually assembled, so do not "upgrade" this
    // without assembling a direct build to check.
    add("directImplementation", "com.razorpay:checkout:1.6.38")
}
