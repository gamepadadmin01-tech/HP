// Same Android Gradle Plugin as GamepadOS (apps/android-client) so one Gradle (tools/gradle-9.8.2) builds both.
// AGP 9 has built-in Kotlin: do NOT add the org.jetbrains.kotlin.android plugin.
plugins {
    id("com.android.application") version "9.5.0" apply false
}
