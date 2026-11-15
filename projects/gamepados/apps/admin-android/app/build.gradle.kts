import java.util.Properties
plugins { id("com.android.application") }
// The signing key lives in D:/AKHIL/HP/keys/admin-android (moved from the Codex folder 2026-11-15). It is never
// committed: keys/ is outside git and *.jks is ignored everywhere. Losing it means the app cannot be updated in place.
val signingDir = rootProject.file("../../../../keys/admin-android")
val signingProps = Properties().apply { File(signingDir, "release.properties").inputStream().use { load(it) } }
android {
    namespace = "space.gamepad.admin"
    compileSdk = 36
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = "space.gamepad.admin"
        minSdk = 29
        targetSdk = 36
        versionCode = 5
        versionName = "1.3.1"
    }
    signingConfigs {
        create("adminRelease") {
            storeFile = File(signingDir, "admin-release.jks")
            storePassword = signingProps.getProperty("password")
            keyAlias = "admin"
            keyPassword = signingProps.getProperty("password")
        }
    }
    buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("adminRelease") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
