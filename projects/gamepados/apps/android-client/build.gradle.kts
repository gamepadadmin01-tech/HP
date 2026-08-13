plugins {
    // 8.2.0 predated AGP's automatic 16 KB native-library zip alignment (added in
    // 8.5.1) -- bumped so Play Console's "Memory page size" check passes. Needs
    // Gradle 8.7+ (see tools/gradle-8.9, up from tools/gradle-8.5).
    // 8.6.1 -> 8.13.2 (2026-08-03). Reason: Play Console's App Bundle Explorer
    // showed "Optimisation percentage", "Shrinking percentage" and "R8
    // configuration" as "-". R8 DID run (the dex marker read
    // r8-mode:"full", version 8.6.27) — those fields are populated from a newer
    // structured R8 metadata record that R8 8.6 does not emit, so this is a
    // reporting gap, not a missing optimization. A newer R8 ships with a newer
    // AGP, hence the bump.
    // 8.13.2 -> 9.3.1 (2026-08-04). 9.x is no longer new — 9.0 is several
    // releases back and 9.3.1 is the current stable — so the earlier "stay on
    // 8.x until 9 settles" hold no longer applies. What AGP 9 buys us: R8
    // repackaging and optimized resource shrinking are ON by default, which is
    // the "Repackage classes" / "Resource shrinking optimised" pair Play
    // Console's App Bundle Explorer reports as disabled.
    // REQUIREMENTS this pulled in (see build_apk.bat): Gradle 9.5.0+ — we run
    // tools/gradle-9.6.1; gradle-8.14.4 is kept only for reference and CANNOT
    // build this. JDK 17 still fine. Build-Tools 36.0.0+ (36.1.0 installed).
    // ⚠️ AGP 9 reworked the CMake/NDK integration and this app has a real
    // native input engine (src/main/cpp/gamepad-engine.cpp, implicit JNI
    // binding). A clean build does NOT prove it: device-test pairing + input
    // before shipping any build made with this.
    id("com.android.application") version "9.3.1" apply false
    // The org.jetbrains.kotlin.android plugin (was 2.4.0) is GONE — AGP 9 ships
    // built-in Kotlin support and hard-fails if KGP is also applied:
    //   "The 'org.jetbrains.kotlin.android' plugin is no longer required for
    //    Kotlin support since AGP 9.0."
    // The Kotlin compiler now comes from AGP's own KGP dependency. To pin a
    // different Kotlin version, add a buildscript classpath on
    // org.jetbrains.kotlin:kotlin-gradle-plugin — do NOT re-add the plugin id.
    // See https://kotl.in/gradle/agp-built-in-kotlin
}
