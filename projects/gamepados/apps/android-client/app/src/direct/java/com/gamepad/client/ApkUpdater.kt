package com.gamepad.client

// ── In-app self-update — "direct" flavor ONLY ────────────────────────────────
// Mirrors the PC server's one-click updater. Android can't install silently or
// auto-relaunch a sideloaded app, so the flow is: (one-time) grant "install
// unknown apps" → download with progress → verify SHA-256 → system install
// screen → user taps "Open". Progress/status are pushed to the React UI via
// window.__onUpdateProgress(pct) / window.__onUpdateStatus(phase, message).
//
// WHY THIS FILE IS IN src/direct AND NOT src/main:
// this machinery used to live in MainActivity (src/main), i.e. it was COMPILED
// INTO every store flavor and merely left unreachable — nothing called it once
// the store UpdaterBridge stopped exposing startApkUpdate, so R8 dead-stripped
// the calls. That made store-safety a side effect of minification rather than a
// property of the build: R8 still left the literal
// "application/vnd.android.package-archive" sitting in the string pool of every
// store APK, and turning minification off would have silently shipped the whole
// installer to Amazon/Play/Uptodown/Indus. Amazon's automated review scans the
// DEX for APK-install capability, so that remnant was a standing false-positive
// risk (it plausibly contributed to the 1.3.0/1.3.21 "ad network libraries"
// auto-rejection, whose stated reason did not otherwise match the artifact).
// Living here, the code is absent from store builds BY CONSTRUCTION.
//
// The manifest half of the same split is src/direct/AndroidManifest.xml
// (REQUEST_INSTALL_PACKAGES + the FileProvider). Keep the two halves together:
// if this file ever moves back to src/main, the string comes back with it.

private fun MainActivity.postUpdateProgress(pct: Int) {
    evalJs("window.__onUpdateProgress && window.__onUpdateProgress($pct)")
}

private fun MainActivity.postUpdateStatus(phase: String, message: String) {
    val safe = message.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
    evalJs("window.__onUpdateStatus && window.__onUpdateStatus('$phase','$safe')")
}

// Called from the direct-flavor UpdaterBridge's @JavascriptInterface startApkUpdate.
internal fun MainActivity.beginApkUpdate(url: String, sha256: String) {
    if (url.isBlank()) { postUpdateStatus("error", "No update URL."); return }
    // Android 8+: the app needs the user's permission to install packages. If we
    // don't have it yet, send them to the setting and ask them to tap Update again.
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O
            && !packageManager.canRequestPackageInstalls()) {
        postUpdateStatus("permission",
            "Allow \"Install unknown apps\" for GamepadOS, then tap Update again.")
        try {
            startActivity(android.content.Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                android.net.Uri.parse("package:$packageName"))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {}
        return
    }
    postUpdateStatus("downloading", "Starting download…")
    Thread {
        try {
            val dir = java.io.File(cacheDir, "updates").apply { mkdirs() }
            val apk = java.io.File(dir, "update.apk")
            val conn = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 30000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "GamepadOS/" + BuildConfig.VERSION_NAME)
            }
            val total = conn.contentLength
            val md = if (sha256.isNotBlank()) java.security.MessageDigest.getInstance("SHA-256") else null
            conn.inputStream.use { input ->
                java.io.FileOutputStream(apk).use { out ->
                    val buf = ByteArray(65536)
                    var done = 0L
                    var lastPct = -1
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        md?.update(buf, 0, n)
                        done += n
                        if (total > 0) {
                            val pct = (done * 100 / total).toInt()
                            if (pct != lastPct) { lastPct = pct; postUpdateProgress(pct) }
                        }
                    }
                }
            }
            if (apk.length() == 0L) { apk.delete(); postUpdateStatus("error", "Downloaded 0 bytes."); return@Thread }
            if (md != null) {
                val hex = md.digest().joinToString("") { "%02x".format(it) }
                if (!hex.equals(sha256, ignoreCase = true)) {
                    apk.delete(); postUpdateStatus("error", "Checksum mismatch — download corrupt."); return@Thread
                }
            }
            // Sanity-check it's a real APK before invoking the installer.
            if (packageManager.getPackageArchiveInfo(apk.absolutePath, 0) == null) {
                apk.delete(); postUpdateStatus("error", "Downloaded file isn't a valid app."); return@Thread
            }
            postUpdateStatus("installing", "Opening installer…")
            runOnUiThread { launchApkInstaller(apk) }
        } catch (e: Exception) {
            postUpdateStatus("error", "Download failed: " + (e.message ?: "unknown"))
        }
    }.start()
}

private fun MainActivity.launchApkInstaller(apk: java.io.File) {
    try {
        val uri = androidx.core.content.FileProvider.getUriForFile(
            this, "$packageName.fileprovider", apk)
        startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        })
        finish()
    } catch (e: Exception) {
        postUpdateStatus("error", "Couldn't open installer: " + (e.message ?: "unknown"))
    }
}
