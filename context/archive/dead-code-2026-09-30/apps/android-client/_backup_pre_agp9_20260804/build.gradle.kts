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
    // Deliberately the LATEST 8.x, NOT 9.x: AGP 9 reworks the CMake/NDK
    // native-build integration and must be validated on a real device
    // (pairing + input), not just compiled. Staying inside 8.x keeps the native
    // build path unchanged. Play's own hint suggests 9.0 — ignore it until
    // there's a device-tested upgrade.
    id("com.android.application") version "8.13.2" apply false
    // Kotlin 1.9.0 -> 2.4.0 (K2 compiler). Source-compatible for this app; verified
    // by a clean release build of all flavors.
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}
