# GamepadOS Android MainActivity.kt (lines 1050–1571 + referenced decls) — iOS Port Spec

Source: F:\hlooo\apps\android-client\app\src\main\java\com\gamepad\client\MainActivity.kt (~1571 lines). Other .kt files in package: GamepadApplication.kt, GrxClient.kt, GrxCrypto.kt, MainActivity.kt. OneEuroFilter is NOT a separate file — it is a private inner class of MainActivity (lines 1291–1319).

## 1. QR scan result delivery (processImage, ~1072–1159)

- CameraX ImageAnalysis feeds `processImage(imageProxy)`; throttled to one decode per 300 ms (`now - lastAnalysisTime < 300` → drop frame). Frames are also dropped entirely while `isEngineRunning` is true.
- ZXing decodes off the Y (luminance) plane of the YUV_420_888 frame (manual row-stride/pixel-stride copy into a `ByteArray(width*height)`). Decode strategy: try center-crop (80% of width/height, centered) first, then full frame; for each source try HybridBinarizer then GlobalHistogramBinarizer; `qrReader.reset()` in a finally after each attempt. First success wins.
- On success (and `!isEngineRunning`), the raw decoded text is delivered to JS on the UI thread with this exact escaping order — backslash FIRST, then quote, then newlines (comment warns a `\'` payload otherwise breaks out of the JS string literal):
```kotlin
val escapedPayload = found
    .replace("\\", "\\\\")
    .replace("'", "\\'")
    .replace("\n", "\\n")
    .replace("\r", "\\r")
webView?.evaluateJavascript("if (window.onQRScanned) window.onQRScanned('$escapedPayload');", null)
```
- NO payload parsing in Kotlin — the full raw QR string is passed to JS global `window.onQRScanned(payload)`; the web layer does all interpretation. iOS: after AVFoundation/Vision decode, call the same `window.onQRScanned('<escaped>')` via `evaluateJavaScript`, with identical escaping.

## 2. beginApkUpdate (1486–1550) + launchApkInstaller (1552–1565)

Flow (Android-only, iOS won't self-update, but UI expects these callbacks):
1. `url.isBlank()` → `postUpdateStatus("error", "No update URL.")` and return.
2. API 26+ without `canRequestPackageInstalls()` → `postUpdateStatus("permission", "Allow \"Install unknown apps\" for GamepadOS, then tap Update again.")`, launch ACTION_MANAGE_UNKNOWN_APP_SOURCES, return.
3. `postUpdateStatus("downloading", "Starting download…")`, then on a background Thread: HttpURLConnection (connectTimeout 15000, readTimeout 30000, follows redirects, User-Agent `GamepadOS/<VERSION_NAME>`), downloads to `cacheDir/updates/update.apk` in 65536-byte chunks, computing SHA-256 incrementally (only if `sha256` param non-blank). Progress posted only when integer pct changes: `pct = (done * 100 / total)` when contentLength > 0.
4. Failure states: 0-byte file → status `("error", "Downloaded 0 bytes.")`; hex digest != sha256 (case-insensitive) → `("error", "Checksum mismatch — download corrupt.")`; `getPackageArchiveInfo` null → `("error", "Downloaded file isn't a valid app.")`; exception → `("error", "Download failed: <msg>")`.
5. Success: `postUpdateStatus("installing", "Opening installer…")` → FileProvider URI → ACTION_VIEW `application/vnd.android.package-archive` → `finish()`. Installer failure → `("error", "Couldn't open installer: <msg>")`.

Exact JS callbacks (both wrapped in runOnUiThread + try/catch):
```kotlin
// postUpdateProgress(pct: Int):
webView?.evaluateJavascript("window.__onUpdateProgress && window.__onUpdateProgress($pct)", null)
// postUpdateStatus(phase: String, message: String) — message escaped: \ → \\, ' → \', \n → space:
webView?.evaluateJavascript("window.__onUpdateStatus && window.__onUpdateStatus('$phase','$safe')", null)
```
Phase strings used: `"permission"`, `"downloading"`, `"installing"`, `"error"`. iOS: the React UI may call the update entry point and expect `window.__onUpdateStatus`/`window.__onUpdateProgress`; a stub that fires `__onUpdateStatus('error', 'Updates are delivered through the App Store on iOS.')` (or the UI's not-supported path) preserves the contract.

## 3. onSensorChanged — gyro/steering math (1241–1271)

Sensor selection (line 259–265, onCreate): prefer `TYPE_GAME_ROTATION_VECTOR` (gyro+accel, no magnetometer → no yaw drift), fall back to `TYPE_ROTATION_VECTOR`. onSensorChanged ignores any other type.

Registration (onResume, 1202–1226): dedicated `android.os.HandlerThread("gyro-sensor")` created once, and the 4-arg `registerListener(this, sensor, SensorManager.SENSOR_DELAY_FASTEST, sensorHandler)` delivers events on that thread, off the UI looper. FASTEST ≈ up to 200 Hz on their device (vs 50 Hz for GAME) — comment: more samples than display refresh so the indicator never repeats a frame. iOS equivalent: CMMotionManager deviceMotion (`.xArbitraryZVertical` for the no-magnetometer analog) at ~200 Hz (`deviceMotionUpdateInterval = 1.0/200`) on a dedicated OperationQueue.

Exact math:
```kotlin
SensorManager.getRotationMatrixFromVector(fusionRotMatrix, event.values)  // device→world
// Remap into a consistent LANDSCAPE-VIEW frame (app is SENSOR_LANDSCAPE → ROTATION_90 or _270):
val (axisX, axisY) = if (currentDisplayRotation() == Surface.ROTATION_270)
    SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
else
    SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
SensorManager.remapCoordinateSystem(fusionRotMatrix, axisX, axisY, fusionRemapped)
// World-up in the remapped view frame = 3rd ROW of the matrix. Level phone (screen vertical, facing you) → up ≈ (0,1,0):
val ux = fusionRemapped[6]
val uy = fusionRemapped[7]
val uz = fusionRemapped[8].coerceIn(-1f, 1f)
val rollDeg  = STEER_SIGN  * Math.toDegrees(Math.atan2(ux.toDouble(), uy.toDouble()))  // ROLL: up-vector angle WITHIN screen plane = left/right steering
val pitchDeg = PITCH_SIGN * Math.toDegrees(Math.asin(uz.toDouble()))                    // PITCH: up tipping OUT of screen plane = fwd/back lean (3D look Y)
fusedRollDeg  = rollFilter.filter(rollDeg, event.timestamp).toFloat()   // event.timestamp in NANOSECONDS
fusedPitchDeg = pitchFilter.filter(pitchDeg, event.timestamp).toFloat()
lastSensorEventNs = event.timestamp
```
Signs (lines 94–95, `var` but never reassigned anywhere in the file): `STEER_SIGN = 1.0`, `PITCH_SIGN = -1.0`.

Units and normalization: fusedRollDeg/fusedPitchDeg are DEGREES. The JS-facing bridge (line 511–530) `@JavascriptInterface fun getGyroscopeDataJson()` returns them RAW:
```kotlin
val nx = fusedRollDeg   // roll (left/right STEERING, deg)
val ny = fusedPitchDeg  // pitch (fwd/back, deg)
val age = if (lastSensorEventNs == 0L) -1.0 else (SystemClock.elapsedRealtimeNanos() - lastSensorEventNs) / 1e6
return "{\"nx\":$nx,\"ny\":$ny,\"age\":${String.format(java.util.Locale.US, "%.1f", age)}}"
```
So the -1..1 normalization is done in JS, NOT Kotlin — nx/ny cross the bridge in degrees (a stale header comment on line 513 says "already-normalized -1..1" but lines 520–521 and the code are authoritative: degrees). `age` = ms since the last sensor event (staleness metric), -1.0 if no event yet. Locale.US formatting is deliberate (comma-decimal locales would break JSON.parse). Recenter/neutral capture is "baked into the sensor math" (no explicit neutral offset appears in this bridge). Gyro works independently of the native engine (also valid in USB-debug/WebSocket mode).

## 4. OneEuroFilter (private inner class, 1291–1319) — port verbatim

Casiez/Roussel/Vogel CHI 2012. Parameters at construction (line 104–105): `rollFilter = OneEuroFilter(minCutoff = 2.8, beta = 0.5)` and `pitchFilter = OneEuroFilter(minCutoff = 2.8, beta = 0.5)`; dCutoff left at default `1.0`. Comment: latency-biased tune (higher minCutoff/beta favor low lag over still-hand smoothness).

```kotlin
private class OneEuroFilter(
    private val minCutoff: Double = 2.8,  // Hz — lower = smoother when still
    private val beta: Double = 0.5,       // speed coefficient — higher = less lag
    private val dCutoff: Double = 1.0     // cutoff for the derivative low-pass
) {
    private var xPrev = 0.0
    private var dxPrev = 0.0
    private var tPrevNs = 0L
    private var started = false
    private fun alpha(cutoff: Double, dt: Double): Double {
        val tau = 1.0 / (2.0 * Math.PI * cutoff)
        return 1.0 / (1.0 + tau / dt)
    }
    fun filter(x: Double, tNs: Long): Double {
        if (!started) { started = true; xPrev = x; dxPrev = 0.0; tPrevNs = tNs; return x }
        var dt = (tNs - tPrevNs) / 1_000_000_000.0
        if (dt <= 0.0 || dt > 0.1) dt = 1.0 / 200.0   // guard bad/large gaps → assume 200 Hz
        tPrevNs = tNs
        val dx = (x - xPrev) / dt
        val aD = alpha(dCutoff, dt)
        val edx = aD * dx + (1 - aD) * dxPrev
        dxPrev = edx
        val cutoff = minCutoff + beta * Math.abs(edx)
        val aX = alpha(cutoff, dt)
        val xFilt = aX * x + (1 - aX) * xPrev
        xPrev = xFilt
        return xFilt
    }
}
```
Notes for iOS: timestamps are nanoseconds (Android `event.timestamp`); on iOS use `CMDeviceMotion.timestamp` (seconds) and adapt the dt computation, keeping the `dt <= 0 || dt > 0.1 → 1/200` guard. First sample passes through unfiltered.

## 5. Lifecycle (1202–1239, 1426–1459) + cleanupSessionAndReturn (1161–1188)

- onResume: lazily create `HandlerThread("gyro-sensor")` + Handler; register rotation sensor at SENSOR_DELAY_FASTEST on that handler; reset `lastUsbActive = null` and (re)post `usbWatchRunnable` on mainHandler (USB-tether watcher, re-broadcasts current state); `handleAccessoryIntent(intent)` to catch cold-start AOA attach.
- onPause: `sensorManager.unregisterListener(this)` and `mainHandler.removeCallbacks(usbWatchRunnable)` ONLY. The native engine/network session is deliberately NOT stopped on pause (keep-alive across backgrounding); no JS visibility callback fired here.
- onDestroy: `cameraExecutor.shutdown()`; unregister sensor listener (try/catch); `sensorThread?.quitSafely()` and null the thread+handler; unregister usbPermissionReceiver; reset `isTransitioning` flag; if `isEngineRunning` → `stopChargeBypass()` + `stopNetworkNative()`; `isEngineRunning = false`; release MulticastLock and WifiLock if held (exitApp/swipe-from-recents reach onDestroy without cleanupSessionAndReturn, so locks must be released here too); `destroyGameplaySurface()`; remove WebView from parent and `webView.destroy()`, null it.
- cleanupSessionAndReturn (session teardown → back to menu): set `isEngineRunning = false`, `isTransitioning.set(false)`, `stopChargeBypass()`, `stopNetworkNative()`, release MulticastLock+WifiLock, then on UI thread: hide previewView, `stopCameraXScanner()` (unbindAll), `showSystemUI()`, and fire JS: `webView?.evaluateJavascript("if (window.onSessionExited) window.onSessionExited();", null)`.
- surfaceChanged → `initGameplaySurface(holder.surface, width, height)`; surfaceDestroyed → `destroyGameplaySurface()`; surfaceCreated is a no-op.
- companion object: `System.loadLibrary("gamepad_engine")` (JNI engine — iOS will replace with its own transport).

## 6. Charge bypass (1194–1200)

Both `startChargeBypass()` and `stopChargeBypass()` are NO-OPS: "Charge bypass removed for v1.0 (was Shizuku-only)". They are still called at session start/stop sites but do nothing. Related: the battery-status bridge (line 508) hardcodes `"shizuku":false,"shizukuRunning":false,"bypass":false`. iOS: omit entirely; keep the JSON fields false if the UI reads them.

## 7. Complete inventory of native→JS evaluateJavascript calls in lines 1050–1571

1. Line 1151 (QR decode): `"if (window.onQRScanned) window.onQRScanned('$escapedPayload');"`
2. Line 1186 (cleanupSessionAndReturn): `"if (window.onSessionExited) window.onSessionExited();"`
3. Lines 1413–1414 (openAccessoryAndStart, AOA wired USB connected — tells web UI to show wired badge and skip WebSocket/UDP transports): `"if(window.onAccessoryConnected)window.onAccessoryConnected();"`
4. Lines 1473–1474 (postUpdateProgress): `"window.__onUpdateProgress && window.__onUpdateProgress($pct)"`
5. Lines 1481–1482 (postUpdateStatus): `"window.__onUpdateStatus && window.__onUpdateStatus('$phase','$safe')"`

No other evaluateJavascript calls exist in lines 1050–1571. (The AOA/USB accessory subsystem itself — handleAccessoryIntent/connectAccessory/openAccessoryAndStart, lines 1328–1424 — is Android AOA-specific and has no iOS equivalent; only callback #3 matters if the shared web UI listens for it.)