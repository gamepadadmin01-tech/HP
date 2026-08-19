package com.gamepad.client

import androidx.appcompat.app.AppCompatActivity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity(), SurfaceHolder.Callback, android.hardware.SensorEventListener {

    // Native JNI hooks
    private external fun initGameplaySurface(surface: Surface, width: Int, height: Int)
    private external fun destroyGameplaySurface()
    // MUST stay private (or public), NEVER internal: Kotlin name-mangles internal
    // members with a $module suffix, which breaks the JNI symbol lookup
    // (Java_com_gamepad_client_MainActivity_injectNativePayload) → instant
    // UnsatisfiedLinkError crash at runtime (hit on-device 2026-07-20). The PHASE 3
    // NativeInputEngine goes through the injectPayload wrapper below instead.
    private external fun injectNativePayload(data: ByteArray)
    /** PHASE 3: plain-Kotlin wrapper for NativeInputEngine (safe to mangle). */
    internal fun injectPayload(data: ByteArray) = injectNativePayload(data)
    private external fun initNetworkNative(ip: String, port: Int, key: String)
    private external fun stopNetworkNative()
    // Streaming gate (checklist B0): off = engine latches NEUTRAL and drops all
    // payload injections, so leaving the controller screen can't leave a stale
    // input snapshot re-broadcasting at the keep-alive rate. private, NOT
    // internal — see the mangling warning above.
    private external fun setInputStreamingNative(on: Boolean)
    // AOA direct-USB: hand the opened accessory's raw fd to the native engine.
    private external fun initAccessoryNative(fd: Int)
    private external fun getNativePacketCount(): Long
    private external fun getNativeLatencyMs(): Float
    private external fun getMsSinceLastAck(): Long
    private external fun getNativeRumble(): Long

    // ── GRX encrypted input — LIVE (GRX_ENABLED=true). The C++ JNI bridge is applied
    //    (see apps/docs/GRX_ANDROID_WIRING.md). On each non-USB connect a GrxClient is
    //    built and start() sends a CLIENT_HELLO; once the handshake establishes,
    //    onGrxControl flips nativeSetGrxReady(true) and the C++ hot path seals input.
    //    Against a non-GRX server the handshake never completes, grxReady stays false,
    //    and the legacy 20-byte cleartext path runs unchanged (graceful fallback).
    //    NOTE: requires a GRX-aware GamepadServer.exe (rebuild the PyInstaller bundle).
    private val GRX_ENABLED = true
    private var grx: GrxClient? = null
    private external fun nativeGrxSendRaw(bytes: ByteArray)   // Kotlin -> C++: send raw bytes on udpSocket
    private external fun nativeSetGrxReady(ready: Boolean)    // flips the C++ hot-path seal hook

    /** JNI up-call from the C++ hot TX path: seal a 20-byte frame -> 41-byte wire frame (null if not ready). */
    fun grxSeal(frame20: ByteArray): ByteArray? = grx?.seal(frame20)

    /** JNI up-call from the C++ RX path for GRX control frames (first byte 0xE1/0xE2/0xE3). */
    fun onGrxControl(frame: ByteArray) {
        val c = grx ?: return
        c.onServerMessage(frame)
        if (c.established) { try { nativeSetGrxReady(true) } catch (e: Exception) {} }
    }

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var sensorManager: android.hardware.SensorManager
    // STEERING via SENSOR FUSION (matches the reference app): the Game Rotation
    // Vector (gyro+accel fused, no magnetometer → drift-free heading-independent,
    // and crucially NO gravity blind-spot) feeds getRotationMatrixFromVector →
    // remapCoordinateSystem(display) → getOrientation. The remap relocates the
    // Euler gimbal-singularity OUT of the steering range, so roll stays correct at
    // ANY hold angle (flat, reclined, or phone held vertical facing the player).
    private var rotationSensor: android.hardware.Sensor? = null
    private val fusionRotMatrix = FloatArray(9)
    private val fusionRemapped  = FloatArray(9)
    // internal (not private): the PHASE 3 NativeInputEngine reads these directly on
    // its native gyro→payload path (same values the JS bridge poll exposes).
    @Volatile internal var fusedRollDeg = 0f   // roll = left/right steering (deg), 1€-filtered
    @Volatile internal var fusedPitchDeg = 0f  // pitch = forward/back lean (deg) — 3D-mode look Y
    @Volatile private var lastSensorEventNs = 0L  // event.timestamp of the latest sample (staleness probe)

    // ── Resting-flat detection (gyro idle) ────────────────────────────────────
    // "Placed on a flat surface" ⇔ the screen is horizontal (world-up points out
    // of the screen, |uz|≈1) AND the phone is motionless. BOTH are required:
    // orientation alone would wrongly idle a phone HELD flat like a racing wheel,
    // and stillness alone would idle a phone held perfectly still upright — which
    // the product spec explicitly forbids. A hand always carries micro-tremor, so
    // a held phone never satisfies the stillness half; only a phone resting on a
    // real surface does. Stillness is measured on the RAW up-vector, never on roll
    // (atan2 is numerically unstable near flat and would read as constant motion).
    // The authoritative flag both the native engine and the JS layer read.
    @Volatile internal var gyroRestingFlat = false
    // User setting (#2 System → Automatic Gyro Idle Detection). When off, the pad
    // never idles from pose; pushed in via setGyroConfig(idleDetect).
    @Volatile internal var gyroIdleDetectEnabled = true
    private var prevUx = 0f
    private var prevUy = 0f
    private var prevUz = 0f
    private var stillSinceNs = 0L
    // |uz| ≥ this ≈ within ~20° of horizontal. Normal holds sit near uz=0; even a
    // steep 3D-look lean (~45-60°) stays well under this, so only a truly flat
    // pose qualifies.
    private val flatUz = 0.94f
    // Per-sample up-vector L1 delta above which the phone counts as MOVING. Hand
    // tremor comfortably exceeds this; a phone on a table sits far below it.
    private val stillEps = 0.006f
    // How long flat + still must persist before idling (ns). Matches the 1s the
    // spec describes and debounces brief flat-crossings during play.
    private val idleNs = 1_000_000_000L
    // Steering (roll) + look (pitch) are read DIRECTLY from the gravity/up vector in a
    // display-remapped landscape frame: roll = atan2(up.x, up.y), pitch = asin(up.z).
    // Stable (full-magnitude legs, no short-vector jitter), decoupled (leaning forward
    // does NOT move steering), and NO gimbal-lock in play holds — it only degrades when
    // the screen faces straight up/down, which isn't a play pose. No neutral capture.
    // Flip a SIGN if an axis reads reversed on-device (tilt-right must steer-right).
    private var STEER_SIGN = 1.0
    private var PITCH_SIGN = -1.0
    // Sensor events are delivered on a DEDICATED thread (not the main/UI looper) so the
    // ~200 Hz fusion math never contends with the WebView's UI work — this removes the
    // jitter that main-thread delivery causes under load. fused* are @Volatile so the
    // JS-bridge reads on the UI thread stay safe.
    private var sensorThread: android.os.HandlerThread? = null
    private var sensorHandler: android.os.Handler? = null
    // 1€ (One Euro) filters — adaptive low-pass: smooth when slow/still, lag-free on fast
    // motion. One per axis (roll = steering, pitch = 3D look).
    private val rollFilter  = OneEuroFilter(minCutoff = 2.8, beta = 0.5)
    private val pitchFilter = OneEuroFilter(minCutoff = 2.8, beta = 0.5)
    private var lastAnalysisTime = 0L
    @Volatile
    private var isEngineRunning = false
    private val isTransitioning = java.util.concurrent.atomic.AtomicBoolean(false)
    // ── AOA (Android Open Accessory) direct-USB transport ─────────────────────
    private var usbAccessory: android.hardware.usb.UsbAccessory? = null
    private var usbPermissionReceiver: android.content.BroadcastReceiver? = null
    private val ACTION_USB_PERMISSION = "com.gamepad.client.USB_PERMISSION"
    private var webView: android.webkit.WebView? = null
    // PHASE 3: native touch input engine (overlay above the WebView; see
    // NativeInputEngine.kt). Created in setupHybridLayout.
    internal lateinit var nativeInput: NativeInputEngine
    // Secure origin the bundled UI is served from (WebViewAssetLoader) — replaces
    // the old file:///android_asset/dist/index.html, whose file:// origin blocked
    // fetch() to the backend (feedback + update check).
    private val APP_URL = "https://appassets.androidplatform.net/assets/dist/index.html"
    // Holds the old file:// origin's localStorage (custom pads, gyro settings)
    // between migrate.html's dump and its replay into the new origin.
    private var pendingLegacyStorage: String? = null

    // Lets flavor bridges (e.g. the playstore UpdaterBridge's Play update
    // callback) push results into the JS side from any thread.
    internal fun evalJs(script: String) {
        // try/catch: evaluateJavascript throws if the WebView is already torn
        // down (e.g. a background thread posting an update after onDestroy).
        runOnUiThread { try { webView?.evaluateJavascript(script, null) } catch (e: Exception) {} }
    }

    // ── Haptics (class-level so both the JS bridge and the PHASE 3 native input
    //    path fire the exact same effects; bodies moved unchanged out of the
    //    bridge object) ─────────────────────────────────────────────────────────

    // Shared robust vibrator (matches the reference app): VibratorManager
    // on Android 12+ (else legacy), and uses a custom amplitude ONLY when
    // the device supports it — otherwise a custom amplitude can be silently
    // ignored on some phones, giving no buzz at all.
    internal fun doVibrate(durationMs: Int, amplitude: Int) {
        try {
            val vibrator: android.os.Vibrator =
                if (android.os.Build.VERSION.SDK_INT >= 31)
                    (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
                else @Suppress("DEPRECATION") (getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator)
            if (!vibrator.hasVibrator()) return
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                if (amplitude in 1..255 && vibrator.hasAmplitudeControl()) {
                    // Variable-amplitude motor (e.g. POCO): scale amplitude directly — best feel.
                    vibrator.vibrate(android.os.VibrationEffect.createOneShot(durationMs.toLong(), amplitude.coerceIn(1, 255)))
                } else if (amplitude in 1..254) {
                    // No amplitude control (e.g. Moto G84): every custom amplitude silently
                    // collapses to FULL strength, so weak rumble feels as strong as strong
                    // rumble — and under sustained rumble the back-to-back full pulses read
                    // as one continuous buzz. Emulate intensity with a duty-cycle (PWM)
                    // waveform: on-time per ~16ms cycle is proportional to the requested
                    // amplitude, so a low value pulses briefly (gentle) and a high value
                    // stays on longer (strong).
                    val period = 16L
                    val on = (period * amplitude / 255).coerceIn(1, period)
                    val off = (period - on).coerceAtLeast(0)
                    val cycles = (durationMs / period).toInt().coerceIn(1, 8)
                    val timings = LongArray(cycles * 2 + 1) { i ->
                        if (i == 0) 0L else if (i % 2 == 1) on else off
                    }
                    vibrator.vibrate(android.os.VibrationEffect.createWaveform(timings, -1))
                } else {
                    // amplitude <= 0 (DEFAULT requested) or == 255 (max): plain full-strength oneshot.
                    vibrator.vibrate(android.os.VibrationEffect.createOneShot(durationMs.toLong(), android.os.VibrationEffect.DEFAULT_AMPLITUDE))
                }
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(durationMs.toLong())
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ── Premium haptics: capability detection + tiered rendering ──
    // Tier A: VibrationEffect.Composition primitives (OEM-tuned → the
    //   most consistent feel across devices). Tier B: amplitude waveform.
    //   Tier C: plain oneshot. Picks the best the device supports.
    internal fun vib(): android.os.Vibrator =
        if (android.os.Build.VERSION.SDK_INT >= 31)
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") (getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator)

    internal fun playHapticEvent(event: String) {
        runOnUiThread {
            try {
                val v = vib()
                if (!v.hasVibrator()) return@runOnUiThread
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    // OEM-TUNED PREDEFINED EFFECT played as a TOUCH haptic — exactly
                    // what the system and the reference app (Remote Gamepad) use on LRA
                    // phones: a crisp "click" that scales with the user's haptic-strength
                    // setting, NOT a flat oneshot buzz. (Verified via dumpsys: the
                    // reference fires Prebaked=CLICK with usage=TOUCH.) Composition
                    // primitives are intentionally dropped — many LRA phones report
                    // supportedPrimitives=[] and silently fall back to that buzz.
                    // No amplitude control (e.g. Moto G84): the motor plays only ONE effect
                    // at a time, so a press CLICK gets cancelled_superseded by the release
                    // TICK ~45ms later and the press+release "double" collapses into a single
                    // buzz. For press-type events on such motors, play an ATOMIC double-pulse
                    // waveform (one effect — can't be superseded mid-play) so the double lands.
                    // Amplitude-capable motors (e.g. POCO) keep the OEM-tuned predefined effects.
                    val pressLike = event != "tick" && event != "uiToggle" && event != "buttonRelease" && event != "triggerPull"
                    if (pressLike && !v.hasAmplitudeControl()) {
                        v.vibrate(android.os.VibrationEffect.createWaveform(longArrayOf(0, 16, 30, 16), -1))
                        return@runOnUiThread
                    }
                    val id = when (event) {
                        // RELEASE + subtle UI → a light tick (the reference fires a
                        // distinct, softer haptic on button release vs press).
                        "tick", "uiToggle", "buttonRelease" -> android.os.VibrationEffect.EFFECT_TICK
                        "triggerPull"                       -> android.os.VibrationEffect.EFFECT_HEAVY_CLICK  // heavier pull
                        else                                -> android.os.VibrationEffect.EFFECT_CLICK        // PRESS (matches reference)
                    }
                    val effect = android.os.VibrationEffect.createPredefined(id)
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        val attrs = android.os.VibrationAttributes.Builder()
                            .setUsage(android.os.VibrationAttributes.USAGE_TOUCH).build()
                        v.vibrate(effect, attrs)
                    } else {
                        v.vibrate(effect)
                    }
                } else {
                    // API 24-28: no predefined effects → strong oneshot at full amplitude.
                    val strong = event != "tick" && event != "uiToggle"
                    doVibrate(if (strong) 22 else 14, if (strong) 255 else 150)
                }
            } catch (e: Exception) { e.printStackTrace() }
        }
    }
    private lateinit var gameContainer: FrameLayout
    private lateinit var gameSurfaceView: SurfaceView
    private lateinit var previewView: PreviewView
    private var activeCameraProvider: ProcessCameraProvider? = null
    // ZXing QR decoder (used on the single-threaded cameraExecutor → no sharing issues).
    private val qrReader = QRCodeReader()
    private val qrHints = mapOf<DecodeHintType, Any>(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true
    )

    // Connection cache to support seamless reconnects
    private var serverIp = ""
    private var connectionType = "wireless"  // "wired" (USB tether) or "wireless" (Wi-Fi)
    private var serverPort = 0
    private var serverKey = ""

    // Subnet-agnostic USB-tether detection: any interface named rndis*/usb* that
    // is UP with an IPv4 address. Works across all OEMs regardless of the subnet
    // they assign (Samsung/Pixel/Xiaomi etc. differ).
    private fun isUsbTetherActiveInternal(): Boolean = usbBroadcastAddress() != null

    // Returns the USB-tether interface's DIRECTED broadcast address (e.g.
    // "192.168.42.255"), or null if no USB link is up. This is the key to USB
    // working: a limited broadcast (255.255.255.255) only egresses the default
    // route (Wi-Fi), so it never reaches the PC over USB. A directed subnet
    // broadcast is routed out the interface that owns that subnet (rndis0).
    // Read live from the OS → works on any OEM/subnet, nothing hardcoded.
    private fun usbBroadcastAddress(): String? {
        try {
            val ifaces = java.net.NetworkInterface.getNetworkInterfaces() ?: return null
            for (el in ifaces) {
                val n = el.name?.lowercase() ?: continue
                if ((n.contains("rndis") || n.contains("usb")) && el.isUp) {
                    for (ia in el.interfaceAddresses) {
                        val a = ia.address
                        val b = ia.broadcast
                        if (a is java.net.Inet4Address && !a.isLoopbackAddress && b is java.net.Inet4Address) {
                            return b.hostAddress
                        }
                    }
                }
            }
        } catch (e: Exception) { e.printStackTrace() }
        return null
    }

    // Flipped true once the React UI has painted its first frame (via
    // AndroidBridge.onUiReady, with a failsafe timeout). While false, the native
    // splash screen is kept on screen so the cold-start never shows a blank/black
    // window — it hands straight off to the JS splash.
    @Volatile private var uiReady = false

    // UI State
    private var lastTopDp = 44f
    private var lastBottomDp = 24f
    private var lastLeftDp = 0f
    private var lastRightDp = 0f

    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null
    // Keeps the Wi-Fi radio in a high-performance, low-latency state while
    // streaming. Without this, Android power-saves the radio between our small
    // UDP packets, causing 10–40ms latency spikes. WIFI_MODE_FULL_LOW_LATENCY
    // (API 29+) is the strongest hint; we fall back to HIGH_PERF on older OSes.
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

    // ── Continuous USB-tether watcher ─────────────────────────────────────────
    // Polls the USB interface every second for the entire app lifetime and
    // notifies the web layer on any change. This covers every ordering needed
    // for a Play Store release:
    //   • server first, then app          → state already true on first tick
    //   • app first, then plug in USB      → rising edge fires while app open
    //   • both open, cable plugged later   → rising edge fires
    //   • cable unplugged / replugged      → falling then rising edge
    // It only NOTIFIES; the web layer decides whether to auto-connect (it skips
    // if already connected), so we never double-start the engine.
    private var lastUsbActive: Boolean? = null
    private val usbWatchRunnable = object : Runnable {
        override fun run() {
            val active = isUsbTetherActiveInternal()
            // Fire when USB is active AND either the state just changed (rising edge
            // when cable is plugged in) OR the engine isn't running yet (keep nudging
            // until the server appears). The JS handler no-ops if already connecting.
            val changed = (active != lastUsbActive)
            lastUsbActive = active
            if (active && (changed || !isEngineRunning)) {
                try {
                    webView?.evaluateJavascript(
                        "if(window.onUsbTetherChanged)window.onUsbTetherChanged(true);", null)
                } catch (e: Exception) {}
            }
            mainHandler.postDelayed(this, 1500)
        }
    }

    private val REQUEST_CODE_PERMISSIONS = 10
    private val REQUIRED_PERMISSIONS = arrayOf(android.Manifest.permission.CAMERA)

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE_PERMISSIONS) {
            if (allPermissionsGranted()) {
                previewView.visibility = View.VISIBLE
                startCameraXScanner()
            } else {
                Toast.makeText(this, "Permissions not granted by the user.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Install the SplashScreen BEFORE super.onCreate so it paints from the very
        // first frame — this is what removes the ~1s black window on cold start.
        // Keep it up until the WebView/React UI has actually painted (uiReady), then
        // cross-fade it out so it dissolves into the identical JS splash beneath it
        // (same #070910 bg + centered logo) = one continuous, smooth opening.
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { !uiReady }
        splashScreen.setOnExitAnimationListener { provider ->
            // One clean intro: the app-icon splash zoom-fades away to reveal the
            // app beneath it (the React UI settles in at the same time). The logo
            // eases up in scale while the whole splash fades out.
            val decel = android.view.animation.DecelerateInterpolator()
            try {
                provider.iconView.animate()
                    .scaleX(1.18f).scaleY(1.18f)
                    .alpha(0f)
                    .setDuration(360L)
                    .setInterpolator(decel)
                    .start()
            } catch (e: Exception) {}
            provider.view.animate()
                .alpha(0f)
                .setDuration(360L)
                .setInterpolator(decel)
                .withEndAction { provider.remove() }
                .start()
        }
        // Failsafe: if the JS side never signals (load failure), lift the splash
        // anyway so the app can never hang on the logo.
        mainHandler.postDelayed({ uiReady = true }, 3000)

        super.onCreate(savedInstanceState)

        // Cutout handling. Android 15 (SDK 35) DEPRECATED the DEFAULT/SHORT_EDGES/
        // NEVER modes — apps targeting 35 get ALWAYS behaviour regardless, and Play
        // Console flags the deprecated constant. ALWAYS (API 30+) is the supported
        // replacement and is safe here because the window insets listener already
        // reads displayCutout() and pads the UI, so nothing lands under the notch.
        // Pre-API-30 devices keep SHORT_EDGES (not deprecated on those releases).
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.attributes.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            @Suppress("DEPRECATION")
            window.attributes.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        
        // 1. OLED Blackout & Thermal Optimization
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Brand-colored decor (matches the splash + JS splash) instead of pure black,
        // so any handoff frame between the native splash and the React UI is invisible.
        window.decorView.setBackgroundColor(Color.parseColor("#070910"))
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Render at the display's MAX refresh rate (e.g. 120Hz) instead of the default
        // 60Hz, so the WebView UI + animations can be smooth on high-refresh phones.
        // Picks the highest-rate supported mode; harmless/no-op on 60Hz-only devices.
        try {
            val disp = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) display
                       else @Suppress("DEPRECATION") windowManager.defaultDisplay
            disp?.supportedModes?.maxByOrNull { it.refreshRate }?.let { best ->
                val lp = window.attributes
                lp.preferredDisplayModeId = best.modeId
                lp.preferredRefreshRate = best.refreshRate
                window.attributes = lp
            }
        } catch (e: Exception) {}
        // The manifest sets windowSoftInputMode="adjustNothing" so the immersive
        // fullscreen layout never pans/resizes when the keyboard opens. The JS
        // layer instead uses visualViewport.offsetTop + visualViewport.height to
        // position any dialog exactly over the still-visible area.

        prefs = getSharedPreferences("gamepad_prefs", Context.MODE_PRIVATE)

        cameraExecutor = Executors.newSingleThreadExecutor()

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as android.hardware.SensorManager
        // Prefer the fused GAME_ROTATION_VECTOR (gyro+accel, no mag → no slow yaw
        // drift); fall back to ROTATION_VECTOR (adds magnetometer) if the device
        // lacks it. Both are consumed identically via getRotationMatrixFromVector.
        rotationSensor =
            sensorManager.getDefaultSensor(android.hardware.Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sensorManager.getDefaultSensor(android.hardware.Sensor.TYPE_ROTATION_VECTOR)

        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Check if the soft keyboard is visible using WindowInsets (reliable on all Android versions).
                // If visible, just hide it — do NOT call handleAndroidBack which would navigate the JS app.
                val imeVisible = androidx.core.view.ViewCompat
                    .getRootWindowInsets(window.decorView)
                    ?.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()) ?: false
                if (imeVisible) {
                    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                    val focusedView = currentFocus ?: window.decorView
                    imm.hideSoftInputFromWindow(focusedView.windowToken, 0)
                    focusedView.clearFocus()
                    return
                }
                webView?.evaluateJavascript("if (window.handleAndroidBack) { window.handleAndroidBack(); } else { AndroidBridge.exitApp(); }", null)
            }
        })

        setupHybridLayout()
        
        // Fix for large-screen guard: apply letterboxing on cold launch, not just rotation
        applyLetterboxing(resources.configuration)
    }

    private fun setupHybridLayout() {
        gameContainer = FrameLayout(this)

        // 1. SurfaceView at the bottom (transparent, maps directly to JNI game canvas)
        gameSurfaceView = SurfaceView(this)
        gameSurfaceView.holder.addCallback(this)
        gameContainer.addView(gameSurfaceView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        // 2. CameraX PreviewView in the middle (starts invisible)
        previewView = PreviewView(this).apply {
            visibility = View.INVISIBLE
            implementationMode = PreviewView.ImplementationMode.PERFORMANCE
        }
        gameContainer.addView(previewView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        // Only allow Chrome DevTools to attach to the WebView in debug builds.
        // In a signed release this would let anyone with adb invoke every
        // AndroidBridge method (connectToPC, exitApp, …) — so gate it off.
        if (BuildConfig.DEBUG) {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        }

        // 3. Transparent high-performance WebView to host our "Smart React Brain" on top
        val webViewInstance = android.webkit.WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            setLayerType(View.LAYER_TYPE_HARDWARE, null) // Hardware acceleration for ultra-low latency rendering
            
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE

                // The UI is served via WebViewAssetLoader on the secure
                // https://appassets.androidplatform.net origin (see webViewClient
                // below) instead of file:///android_asset. fetch() from a file://
                // page is blocked by modern WebView no matter what flags are set —
                // that's what silently broke the in-app feedback + update check —
                // and the old allow*FromFileURLs escape hatches are deprecated and
                // flagged by Play's pre-launch security report.
                // Allow the WebView to open ws://127.0.0.1 (USB-debugging transport)
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            clearCache(true)

            // Purchase results (Play Billing or Razorpay, depending on flavor)
            // reach JS through here. JSONObject.quote makes the payload a valid
            // JS string literal — an SDK error message can contain quotes and
            // newlines, and this is being concatenated into a script.
            PurchaseRelay.attach { json ->
                evalJs("window.onPurchaseResult && window.onPurchaseResult(" +
                    org.json.JSONObject.quote(json) + ")")
            }
            
            // JSI-like JS-to-Java WebView Bridge. Extends BillingBridge, which
            // extends UpdaterBridge — both flavor-specific classes (src/direct,
            // src/playstore or src/store) that either do or don't add
            // startApkUpdate / startRazorpayCheckout / startPlayPurchase to this
            // object's class hierarchy; see UpdaterBridgeBase.kt for why that's
            // the store-safety boundary. A method absent from the chain is
            // absent from window.AndroidBridge, not merely disabled.
            addJavascriptInterface(object : BillingBridge(this@MainActivity) {
                @android.webkit.JavascriptInterface
                fun getSafeAreaTop(): Float { return lastTopDp }
                @android.webkit.JavascriptInterface
                fun getSafeAreaBottom(): Float { return lastBottomDp }
                @android.webkit.JavascriptInterface
                fun getSafeAreaLeft(): Float { return lastLeftDp }
                @android.webkit.JavascriptInterface
                fun getSafeAreaRight(): Float { return lastRightDp }

                @android.webkit.JavascriptInterface
                fun sendGamepadPacketNative(base64Data: String) {
                    try {
                        val bytes = android.util.Base64.decode(base64Data, android.util.Base64.NO_WRAP)
                        injectNativePayload(bytes)
                    } catch (e: Exception) {
                        android.util.Log.e("GamepadEngine", "Error decoding JSI gamepad telemetry packet", e)
                    }
                }

                /**
                 * PERF (hot path): latin1 passthrough — the fast replacement for the
                 * base64 bridge above. The old path did, per packet: an O(n) JS string
                 * concat, btoa(), JS->Java String marshal, THEN android.util.Base64
                 * .decode() allocating a fresh array. Every payload byte is 0..255, so
                 * the JS side can hand us the bytes directly as one 20-char latin1
                 * string and we map it back 1:1 with ISO-8859-1 — dropping BOTH base64
                 * encode and decode plus their allocations. Byte-exact round trip:
                 * chars 0..255 (including NUL) survive JS->Java marshalling unchanged.
                 * sendGamepadPacketNative is kept for compatibility/fallback.
                 */
                /**
                 * PHASE 0: metric sink. The WebView has no WebChromeClient, so
                 * console.log() from injected JS is discarded — it never reaches
                 * logcat. This gives the measurement harness a real output path:
                 *   adb logcat -s GPM
                 */
                @android.webkit.JavascriptInterface
                fun logMetric(line: String) {
                    android.util.Log.i("GPM", line)
                }

                @android.webkit.JavascriptInterface
                fun sendGamepadPacketL1(data: String) {
                    try {
                        injectNativePayload(data.toByteArray(Charsets.ISO_8859_1))
                    } catch (e: Exception) {
                        android.util.Log.e("GamepadEngine", "Error decoding latin1 gamepad packet", e)
                    }
                }

                // ── PHASE 3: native touch input path (see NativeInputEngine.kt) ──
                // JS publishes the pad geometry + activates the overlay when the
                // controller screen is live (feature-flagged; the overlay declines
                // everything while inactive, so behaviour is unchanged by default).
                @android.webkit.JavascriptInterface
                fun setNativeInputGeometry(json: String) {
                    runOnUiThread {
                        try { nativeInput.setGeometry(json) }
                        catch (e: Exception) { android.util.Log.e("NIN", "setGeometry failed", e) }
                    }
                }

                @android.webkit.JavascriptInterface
                fun setNativeInputActive(active: Boolean) {
                    runOnUiThread {
                        try { nativeInput.setActive(active) } catch (e: Exception) {}
                    }
                }

                @android.webkit.JavascriptInterface
                fun setNativeGyroConfig(json: String) {
                    try { nativeInput.setGyroConfig(json) } catch (e: Exception) {}
                }

                @android.webkit.JavascriptInterface
                fun nativeGyroCalibrate() {
                    try { nativeInput.calibrate() } catch (e: Exception) {}
                }

                @android.webkit.JavascriptInterface
                fun startCameraScan() {
                    runOnUiThread {
                        if (allPermissionsGranted()) {
                            previewView.visibility = View.VISIBLE
                            startCameraXScanner()
                        } else {
                            ActivityCompat.requestPermissions(this@MainActivity, REQUIRED_PERMISSIONS, REQUEST_CODE_PERMISSIONS)
                        }
                    }
                }

                @android.webkit.JavascriptInterface
                fun stopCameraScan() {
                    runOnUiThread {
                        stopCameraXScanner()
                        previewView.visibility = View.INVISIBLE
                    }
                }

                @android.webkit.JavascriptInterface
                fun connectToPC(ip: String, port: Int, key: String) {
                    runOnUiThread {
                        // The transition guard is the ONLY gate here — a connect call while a
                        // session is live/being established must be a harmless NO-OP, never a
                        // teardown. (JS retry/nudge paths call this repeatedly before the first
                        // ACK lands; tearing down on each call caused disconnect→reconnect
                        // flapping. Transport switches go through stopEngine() first, which is
                        // what releases this guard.)
                        if (isTransitioning.compareAndSet(false, true)) {
                            try {
                                isEngineRunning = true
                                serverIp = ip
                                serverPort = port
                                serverKey = key
                                // GRX (dormant unless GRX_ENABLED): derive PSK from the pairing
                                // key + start the handshake. start() must run AFTER the socket is
                                // up (initNetworkNative) when wiring — harmless while disabled.
                                grx = if (GRX_ENABLED && key != "usb") {
                                    try { GrxClient(GrxCrypto.pskFromPairingKey(key), GrxCrypto.GRX_LTID) { b -> nativeGrxSendRaw(b) } }
                                    catch (e: Exception) { null }
                                } else null
                                // Classify the link for the dashboard badge by the ACTUAL
                                // active interface (works on every OEM/subnet), not a
                                // hardcoded IP prefix. Explicit "usb" connect mode also counts.
                                connectionType = if (key == "usb" || isUsbTetherActiveInternal()) "wired" else "wireless"
                                
                                // Acquire MulticastLock for reliable UDP broadcasting on this device
                                try {
                                    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
                                    multicastLock = wifiManager.createMulticastLock("GamepadOSBroadcastLock").apply {
                                        setReferenceCounted(true)
                                        acquire()
                                    }
                                    android.util.Log.i("GamepadOS", "MulticastLock successfully acquired.")

                                    // Pin the Wi-Fi radio to low-latency mode — biggest single
                                    // anti-jitter win (stops between-packet radio power saving).
                                    val lockMode = if (android.os.Build.VERSION.SDK_INT >= 29)
                                        android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                                    else
                                        @Suppress("DEPRECATION") android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF
                                    wifiLock = wifiManager.createWifiLock(lockMode, "GamepadOSLowLatencyLock").apply {
                                        setReferenceCounted(false)
                                        acquire()
                                    }
                                    android.util.Log.i("GamepadOS", "Wi-Fi low-latency lock acquired (mode=$lockMode).")
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }

                                startChargeBypass()
                                initNetworkNative(serverIp, serverPort, serverKey)
                                // GRX: socket is up now → start the handshake (sends CLIENT_HELLO
                                // via nativeGrxSendRaw). Null-safe → no-op unless GRX_ENABLED.
                                try { grx?.start() } catch (e: Exception) {}

                                hideSystemUI()
                                // SUCCESS: isTransitioning stays true — it acts as the connected
                                // mutex and is released only by stopEngine() or cleanupSessionAndReturn().
                            } catch (e: Exception) {
                                // initNetworkNative or another step threw — undo everything
                                // and release the guard so the user can retry.
                                android.util.Log.e("GamepadOS", "connectToPC failed: ${e.message}")
                                isEngineRunning = false
                                try { stopNetworkNative() } catch (ignored: Exception) {}
                                // Release the Wi-Fi/multicast locks acquired above —
                                // otherwise a failed connect leaks them (a retry
                                // overwrites the fields, orphaning the held locks and
                                // pinning the radio in low-latency mode till process death).
                                try { multicastLock?.let { if (it.isHeld) it.release() }; multicastLock = null } catch (ignored: Exception) {}
                                try { wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null } catch (ignored: Exception) {}
                                isTransitioning.set(false)
                            }
                        }
                    }
                }

                @android.webkit.JavascriptInterface
                fun exitSession() {
                    runOnUiThread {
                        cleanupSessionAndReturn()
                    }
                }

                // Stop the network engine WITHOUT leaving the session UI. Used by
                // the USB auto-retry: if a connect attempt gets no response, we
                // stop cleanly so the next attempt can start. CRITICAL: this must
                // reset isTransitioning, otherwise connectToPC's compareAndSet
                // guard stays locked and all future connects are silently blocked.
                @android.webkit.JavascriptInterface
                fun stopEngine() {
                    runOnUiThread {
                        isEngineRunning = false
                        isTransitioning.set(false)
                        try { stopNetworkNative() } catch (e: Exception) {}
                        try {
                            multicastLock?.let { if (it.isHeld) it.release() }
                            multicastLock = null
                            wifiLock?.let { if (it.isHeld) it.release() }
                            wifiLock = null
                        } catch (e: Exception) {}
                    }
                }

                // Streaming gate (checklist B0), driven by ControllerScreen's
                // isActive effect in App.tsx — the native sibling of
                // usbWS.setStreaming. Catch Throwable, not Exception: a JNI
                // registration problem surfaces as UnsatisfiedLinkError (an
                // Error), and input gating must never crash the app.
                @android.webkit.JavascriptInterface
                fun setInputStreaming(on: Boolean) {
                    try { setInputStreamingNative(on) } catch (t: Throwable) {}
                }

                /**
                 * Send a playtime capability ticket to the PC server.
                 *
                 * The ticket rides the SAME UDP socket as input, unencrypted,
                 * because that is the only channel every user actually has: the
                 * native engine opens exactly one socket (SOCK_DGRAM), and the
                 * loopback WebSocket bridge is reachable only through
                 * `adb reverse`, i.e. USB debugging. Wi-Fi and tether users --
                 * the whole population this gates -- never touch it. The server
                 * agrees; see the comment above the ticket drain in
                 * pc-server-rs/src/main.rs.
                 *
                 * Not encrypted, and it does not need to be: the ticket is
                 * Ed25519-signed and the server verifies the signature. GRX
                 * seals 20-byte input frames into 41 bytes, so an encrypted
                 * ticket would not survive `looks_like_ticket` anyway.
                 *
                 * Not flavor-gated. Quota applies to every build; only the
                 * ability to BUY is flavor-specific (see BillingBridge).
                 */
                @android.webkit.JavascriptInterface
                fun sendPlaytimeTicket(base64Ticket: String) {
                    try {
                        val bytes = android.util.Base64.decode(base64Ticket, android.util.Base64.NO_WRAP)
                        nativeGrxSendRaw(bytes)
                    } catch (t: Throwable) {
                        // A ticket that cannot be sent is not fatal: the PC's
                        // gate stays un-armed and simply never tears the session
                        // down, which is the same permissive behaviour every
                        // pre-2.1.0 server already has.
                        android.util.Log.w("Playtime", "ticket send failed", t)
                    }
                }

                @android.webkit.JavascriptInterface
                fun setScreenOrientation(orientation: String) {
                    runOnUiThread {
                        try {
                            if (orientation == "landscape") {
                                requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                hideSystemUI()
                            } else if (orientation == "portrait") {
                                requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                                showSystemUI()
                            } else {
                                requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }
                @android.webkit.JavascriptInterface
                fun getSystemStatsJson(): String {
                    var batteryPct = 75
                    var tempC = 38.4f
                    try {
                        val filter = android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)
                        val batteryStatus = this@MainActivity.registerReceiver(null, filter)
                        val level = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
                        val scale = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
                        if (level >= 0 && scale > 0) {
                            batteryPct = (level * 100) / scale
                        }
                        val tempDeciC = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0) ?: 384
                        tempC = tempDeciC / 10.0f
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }

                    return "{\"battery\":$batteryPct,\"temp\":$tempC,\"shizuku\":false,\"shizukuRunning\":false,\"bypass\":false}"
                }

                @android.webkit.JavascriptInterface
                fun getGyroscopeDataJson(): String {
                    // Real, already-normalized tilt (-1..1) straight from the native
                    // sensor-fusion filter. `nx`=roll(left/right), `ny`=pitch(up/down).
                    // The JS indicator consumes these directly (no re-processing) for
                    // a true zero-lag readout.
                    // Tilt is valid whenever the sensor is feeding the native filter —
                    // independent of the network engine, so gyro also works in
                    // USB-debugging (WebSocket) mode where the native engine isn't started.
                    // nx = roll (left/right STEERING, deg), ny = pitch (fwd/back, deg),
                    // both from the fused rotation-vector pipeline (onSensorChanged).
                    // age = ms between the sensor event and this read — lets the JS
                    // layer measure true sensor→read staleness (latency verification).
                    val nx = fusedRollDeg   // steering vs captured neutral (recenter baked into sensor math)
                    val ny = fusedPitchDeg
                    val age = if (lastSensorEventNs == 0L) -1.0
                              else (android.os.SystemClock.elapsedRealtimeNanos() - lastSensorEventNs) / 1e6
                    // idle = the authoritative resting-flat flag; the JS layer uses
                    // it for the "Idle" indicator AND to gate its own gyro merge, so
                    // both transports share one detector (see gyroRestingFlat docs).
                    // Locale.US: a comma-decimal locale would emit "2,5" and break JSON.parse.
                    return "{\"nx\":$nx,\"ny\":$ny,\"idle\":$gyroRestingFlat,\"age\":${String.format(java.util.Locale.US, "%.1f", age)}}"
                }



                @android.webkit.JavascriptInterface
                fun getNetworkTelemetryJson(): String {
                    val count = if (isEngineRunning) getNativePacketCount() else 0L
                    val hz = if (isEngineRunning) 1000 else 0
                    // Real measured round-trip latency from the native engine (via PC ACK).
                    val latency = if (isEngineRunning) getNativeLatencyMs() else 0f
                    val conn = if (isEngineRunning) connectionType else "none"
                    // linkAlive = the PC actually responded recently (ACK within 2.5s).
                    // This is the true "connected" signal — packetCount only proves WE
                    // are sending (UDP sendto succeeds even with nothing listening), so
                    // closing the PC server now correctly flips the UI to disconnected.
                    val sinceAck = if (isEngineRunning) getMsSinceLastAck() else -1L
                    val linkAlive = sinceAck in 0..2500
                    // engineRunning = the native UDP TX thread is alive and transmitting
                    // REGARDLESS of ACKs. The transport coordinator must use THIS (not
                    // linkAlive) to decide whether a native socket already owns a pad,
                    // otherwise it can open the USB-debug WebSocket during an ACK gap and
                    // produce two virtual controllers.
                    //
                    // sinceAck is exported RAW (-1 = no ACK has EVER arrived) because the
                    // UI needs to tell two very different failures apart:
                    //   -1        we are transmitting and the PC has never once answered
                    //             -> wrong IP, or something is eating the return path
                    //                (VPN, firewall). Input may still be working!
                    //   > 2500    it answered before and went quiet
                    //             -> server closed, PC asleep, Wi-Fi dropped.
                    // Collapsing both into "disconnected" is what made the VPN bug of
                    // 2026-08-10 so confusing: the app said disconnected while the game
                    // was responding to the sticks. See linkState.ts.
                    return "{\"packetCount\":$count,\"hz\":$hz,\"latency\":$latency,\"connectionType\":\"$conn\",\"linkAlive\":$linkAlive,\"engineRunning\":$isEngineRunning,\"sinceAck\":$sinceAck}"
                }

                // Latest Wi-Fi rumble from the native UDP engine, polled by the web UI.
                // Returns "seq:left:right" (packed long split out): the UI fires the
                // motor only when seq changes, so the on/off + intensity controls in JS
                // still apply. Over USB this stays at seq 0 (rumble comes via WebSocket),
                // so the two transports never double-trigger.
                @android.webkit.JavascriptInterface
                fun getRumbleState(): String {
                    if (!isEngineRunning) return "0:0:0"
                    val packed = getNativeRumble()
                    val seq = packed ushr 16
                    val left = (packed ushr 8) and 0xFF
                    val right = packed and 0xFF
                    return "$seq:$left:$right"
                }

                // ── In-app update check ──────────────────────────────────────
                // The web UI compares these to the backend version manifest and,
                // if newer, offers a direct download via openUrl().
                @android.webkit.JavascriptInterface
                fun getAppVersionName(): String = BuildConfig.VERSION_NAME

                @android.webkit.JavascriptInterface
                fun getAppVersionCode(): Int = BuildConfig.VERSION_CODE

                // Device details for in-app rating feedback (feedback.ts).
                // Returns a JSON string with model, manufacturer, OS, app
                // version, and version code so ratings land in the admin
                // inbox with full device context.
                @android.webkit.JavascriptInterface
                fun getDeviceInfoJson(): String {
                    return org.json.JSONObject().apply {
                        put("model", android.os.Build.MODEL)
                        put("manufacturer", android.os.Build.MANUFACTURER)
                        put("os", "Android " + android.os.Build.VERSION.RELEASE)
                        put("appVersion", BuildConfig.VERSION_NAME)
                        put("appCode", BuildConfig.VERSION_CODE)
                    }.toString()
                }

                // Open a URL (e.g. the new APK) in the browser / package installer.
                @android.webkit.JavascriptInterface
                fun openUrl(url: String) {
                    runOnUiThread {
                        try {
                            val i = android.content.Intent(android.content.Intent.ACTION_VIEW,
                                                           android.net.Uri.parse(url))
                            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            startActivity(i)
                        } catch (e: Exception) { e.printStackTrace() }
                    }
                }

                // In-app one-click update (direct flavor only): download the new APK
                // (progress + status posted back to JS), verify its SHA-256, then
                // launch the system installer. startApkUpdate itself now comes from
                // the flavor-specific UpdaterBridge superclass — present for
                // "direct", absent for every store flavor. The JS UI falls back to
                // openUrl() (opening the store listing) whenever it's absent.

                // Tells the JS UI which build this is ("direct", "playstore",
                // "aptoide", "uptodown", "amazonstore") so the update-check request
                // can ask the backend for the right update destination.
                @android.webkit.JavascriptInterface
                fun getDistributionChannel(): String = BuildConfig.DISTRIBUTION_CHANNEL

                @android.webkit.JavascriptInterface
                fun getNetworkDetailsJson(): String {
                    // "wifiIp" is the PC server's address from the last connect (the
                    // web UI labels it that way). Empty when never connected — no
                    // fabricated placeholder values that look like detected IPs.
                    val wifiIp = serverIp

                    var usbIp = ""
                    try {
                        val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
                        if (interfaces != null) {
                            while (interfaces.hasMoreElements()) {
                                val element = interfaces.nextElement()
                                if (element.name.contains("rndis") || element.name.contains("usb")) {
                                    val addresses = element.inetAddresses
                                    while (addresses.hasMoreElements()) {
                                        val addr = addresses.nextElement()
                                        if (!addr.isLoopbackAddress && addr is java.net.Inet4Address) {
                                            usbIp = addr.hostAddress ?: ""
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }

                    // Build via JSONObject so a scanned-QR IP containing a quote or
                    // backslash can't break out of the string and corrupt the JSON
                    // (wifiIp comes from the QR payload; usbIp is locally derived).
                    return org.json.JSONObject().put("wifiIp", wifiIp).put("usbIp", usbIp).toString()
                }

                // True only when a USB-tether (RNDIS) interface is actually UP with
                // an IPv4 address — used to auto-pair over USB with no QR scan.
                @android.webkit.JavascriptInterface
                fun isUsbTetherActive(): Boolean = isUsbTetherActiveInternal()

                // USB interface directed-broadcast address (e.g. "192.168.42.255"),
                // or "" if no USB link. The web layer sends USB discovery here so
                // it actually egresses the USB interface, not the Wi-Fi default route.
                @android.webkit.JavascriptInterface
                fun getUsbBroadcastAddress(): String = usbBroadcastAddress() ?: ""

                @android.webkit.JavascriptInterface
                fun requestShizukuPermission() {
                    runOnUiThread {
                        // Shizuku removed for v1.0 — no-op.
                    }
                }

                @android.webkit.JavascriptInterface
                fun setChargeBypass(enabled: Boolean) {
                    runOnUiThread {
                        try {
                            prefs.edit().putBoolean("charge_bypass", enabled).apply()
                            if (enabled) {
                                startChargeBypass()
                            } else {
                                stopChargeBypass()
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }

                @android.webkit.JavascriptInterface
                fun exitApp() {
                    runOnUiThread {
                        finish()
                    }
                }

                // React calls this on its first painted frame → dismiss the native
                // splash now so it hands off to the JS splash with no blank frame.
                @android.webkit.JavascriptInterface
                fun onUiReady() {
                    uiReady = true
                }

                // doVibrate / vib / the playHaptic body moved to MainActivity level
                // (see playHapticEvent) so the PHASE 3 NativeInputEngine can fire the
                // exact same tiers from the native touch path. The @JavascriptInterface
                // wrappers below delegate — JS behaviour is unchanged.
                @android.webkit.JavascriptInterface
                fun triggerHaptic(durationMs: Int) {
                    runOnUiThread { doVibrate(durationMs, -1) }   // -1 => DEFAULT_AMPLITUDE
                }

                @android.webkit.JavascriptInterface
                fun triggerRumble(left: Double, right: Double, durationMs: Int) {
                    runOnUiThread {
                        val intensity = Math.max(left, right).toInt().coerceIn(0, 255)
                        if (intensity < 1) return@runOnUiThread
                        doVibrate(durationMs, intensity)
                    }
                }

                @android.webkit.JavascriptInterface
                fun getHapticCapabilities(): String {
                    return try {
                        val v = vib()
                        val hasAmp = android.os.Build.VERSION.SDK_INT >= 26 && v.hasAmplitudeControl()
                        var prims = false
                        if (android.os.Build.VERSION.SDK_INT >= 30) {
                            prims = v.areAllPrimitivesSupported(
                                android.os.VibrationEffect.Composition.PRIMITIVE_CLICK,
                                android.os.VibrationEffect.Composition.PRIMITIVE_TICK)
                        }
                        "{\"hasVibrator\":${v.hasVibrator()},\"amplitude\":$hasAmp,\"primitives\":$prims}"
                    } catch (e: Exception) {
                        "{\"hasVibrator\":false,\"amplitude\":false,\"primitives\":false}"
                    }
                }

                // Semantic haptic event → best available effect (intent, not raw ms).
                // Body lives in MainActivity.playHapticEvent so the PHASE 3 native
                // input path fires the identical tiers.
                @android.webkit.JavascriptInterface
                fun playHaptic(event: String) {
                    playHapticEvent(event)
                }

                // Arbitrary amplitude envelope (for the ripple-synced 'expanding' feel).
                // timingsCsv/ampsCsv are comma-separated; amps 0-255 used only when the
                // device has amplitude control, else a plain on/off waveform.
                @android.webkit.JavascriptInterface
                fun playHapticWaveform(timingsCsv: String, ampsCsv: String) {
                    runOnUiThread {
                        try {
                            val v = vib()
                            if (!v.hasVibrator()) return@runOnUiThread
                            val timings = timingsCsv.split(",").mapNotNull { it.trim().toLongOrNull() }.toLongArray()
                            if (timings.isEmpty()) return@runOnUiThread
                            if (android.os.Build.VERSION.SDK_INT >= 26) {
                                val amps = ampsCsv.split(",").mapNotNull { it.trim().toIntOrNull()?.coerceIn(0, 255) }.toIntArray()
                                val effect = if (v.hasAmplitudeControl() && amps.size == timings.size)
                                    android.os.VibrationEffect.createWaveform(timings, amps, -1)
                                else
                                    android.os.VibrationEffect.createWaveform(timings, -1)
                                v.vibrate(effect)
                            } else {
                                @Suppress("DEPRECATION") v.vibrate(timings, -1)
                            }
                        } catch (e: Exception) { e.printStackTrace() }
                    }
                }

                // ── Latency diagnostics: Wi-Fi band/link + battery optimization ──
                @android.webkit.JavascriptInterface
                fun getWifiInfoJson(): String {
                    return try {
                        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
                        @Suppress("DEPRECATION") val info = wm.connectionInfo
                        val freq = info.frequency   // MHz
                        val band = when {
                            freq >= 5925 -> "6 GHz"
                            freq >= 4900 -> "5 GHz"
                            freq >= 2400 -> "2.4 GHz"
                            else -> "—"
                        }
                        "{\"band\":\"$band\",\"freq\":$freq,\"linkSpeed\":${info.linkSpeed},\"rssi\":${info.rssi}}"
                    } catch (e: Exception) {
                        "{\"band\":\"—\",\"freq\":0,\"linkSpeed\":0,\"rssi\":0}"
                    }
                }

                @android.webkit.JavascriptInterface
                fun isBatteryOptimized(): Boolean {
                    return try {
                        if (android.os.Build.VERSION.SDK_INT >= 23) {
                            val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                            pm.isIgnoringBatteryOptimizations(packageName).not()
                        } else {
                            false
                        }
                    } catch (e: Exception) {
                        false
                    }
                }

                // Open the system prompt to exempt us from battery optimization —
                // the biggest fix for MIUI/HyperOS Wi-Fi radio throttling (latency).
                @android.webkit.JavascriptInterface
                fun requestBatteryExemption() {
                    runOnUiThread {
                        try {
                            if (android.os.Build.VERSION.SDK_INT >= 23) {
                                startActivity(android.content.Intent(
                                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    android.net.Uri.parse("package:$packageName")))
                            }
                        } catch (e: Exception) {
                            try {
                                startActivity(android.content.Intent(
                                    android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                            } catch (e2: Exception) { e2.printStackTrace() }
                        }
                    }
                }

                @android.webkit.JavascriptInterface
                fun showTextInput(currentValue: String, hint: String) {
                    runOnUiThread {
                        // Native EditText inside a dialog — keyboard opens in NATIVE layer,
                        // completely separate from the WebView. No WebView pan ever occurs.
                        val editText = android.widget.EditText(this@MainActivity).apply {
                            setText(currentValue)
                            setHint(hint)
                            setSingleLine(true)
                            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                                android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS
                            setSelectAllOnFocus(true)
                            filters = arrayOf(android.text.InputFilter.LengthFilter(24))
                        }
                        val container = android.widget.FrameLayout(this@MainActivity).apply {
                            val pad = (16 * resources.displayMetrics.density).toInt()
                            setPadding(pad, 0, pad, 0)
                            addView(editText)
                        }
                        android.app.AlertDialog.Builder(this@MainActivity)
                            .setTitle("Layout Name")
                            .setView(container)
                            .setPositiveButton("Done") { _, _ ->
                                val result = editText.text.toString().trim()
                                val escaped = result
                                    .replace("\\", "\\\\")
                                    .replace("'", "\\'")
                                webView?.evaluateJavascript(
                                    "if(window.__textInputCallback){window.__textInputCallback('$escaped');delete window.__textInputCallback;}",
                                    null
                                )
                            }
                            .setNegativeButton("Cancel", null)
                            .show()
                        // Auto-show keyboard for the native EditText
                        editText.postDelayed({
                            editText.requestFocus()
                            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                            imm.showSoftInput(editText, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
                        }, 100)
                    }
                }

                // One-time storage migration receiver — migrate.html (loaded once
                // from the legacy file:// origin) dumps that origin's localStorage
                // here; onPageFinished replays it into the new https origin so
                // users keep their custom pads + gyro settings across the switch.
                @android.webkit.JavascriptInterface
                fun onLegacyStorageDump(json: String) {
                    pendingLegacyStorage = json
                    runOnUiThread { loadUrl(APP_URL) }
                }
            }, "AndroidBridge")
            
            // Serves the bundled UI from https://appassets.androidplatform.net —
            // a real secure origin, so fetch()/CORS to the backend work normally
            // (file:// pages block them, which is what broke in-app feedback).
            val assetLoader = androidx.webkit.WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", androidx.webkit.WebViewAssetLoader.AssetsPathHandler(this@MainActivity))
                .build()

            webViewClient = object : android.webkit.WebViewClient() {
                override fun shouldInterceptRequest(
                    view: android.webkit.WebView,
                    request: android.webkit.WebResourceRequest
                ): android.webkit.WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }

                // Pin in-WebView navigation to our own origins. The AndroidBridge
                // (connectToPC, exitApp, and in the direct flavor startApkUpdate)
                // is attached to EVERY page loaded here, so a stray navigation to
                // an external URL would hand a foreign page those privileged
                // methods. Anything that isn't our UI opens in the real browser.
                override fun shouldOverrideUrlLoading(
                    view: android.webkit.WebView,
                    request: android.webkit.WebResourceRequest
                ): Boolean {
                    val u = request.url ?: return false
                    // Compare PARSED scheme/host, never a raw string prefix: a URL
                    // like https://appassets.androidplatform.net@evil.com/ or
                    // https://appassets.androidplatform.net.evil.com/ passes a
                    // startsWith() check yet actually resolves to evil.com, which
                    // would then inherit the AndroidBridge. Match the host exactly.
                    val http = u.scheme == "https" && u.host == "appassets.androidplatform.net"
                    val asset = u.scheme == "file" && u.host.isNullOrEmpty() && (u.path?.startsWith("/android_asset/") == true)
                    val dbg = BuildConfig.DEBUG && u.scheme == "http" && (u.host?.startsWith("192.168.") == true)
                    val allowed = http || asset || dbg
                    if (allowed) return false // let the WebView load it
                    // External link: open in the user's browser, keep it out of ours.
                    try { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                    return true
                }

                override fun onPageFinished(view: android.webkit.WebView?, url: String?) {
                    super.onPageFinished(view, url)

                    // Replay the legacy file:// origin's localStorage into the new
                    // origin exactly once, then reload so React boots from the
                    // restored values (its useState initializers already ran).
                    val dump = pendingLegacyStorage
                    if (dump != null && url != null && url.startsWith("https://appassets.androidplatform.net")) {
                        pendingLegacyStorage = null
                        getSharedPreferences("gamepados", MODE_PRIVATE)
                            .edit().putBoolean("webstorage_migrated", true).apply()
                        if (dump != "{}") {
                            val b64 = android.util.Base64.encodeToString(dump.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)
                            // Reload UNCONDITIONALLY (finally) even if a setItem throws
                            // (e.g. QuotaExceededError). Otherwise the page would never
                            // reload, so the sendGamepadPacket/exitSession bridge below
                            // never injects and controller input is dead for the session.
                            view?.evaluateJavascript(
                                "try{var d=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('$b64'),function(c){return c.charCodeAt(0)})));" +
                                "for(var k in d){try{localStorage.setItem(k,d[k]);}catch(_){}}}" +
                                "catch(e){console.error('storage migration failed',e);}" +
                                "finally{location.reload();}",
                                null
                            )
                            return // reload re-enters onPageFinished; bridge JS injects then
                        }
                    }

                    view?.evaluateJavascript("""
                        // ── PHASE 0: latency measurement harness (defined FIRST) ───
                        // Declared before sendGamepadPacket because the send path
                        // reads GPM on every packet — input must never depend on a
                        // later statement having executed.
                        window.GPM = { on: true, dispatch: [], bridge: [], last: 0,
                            add: function(a, v) { if (a.length < 4000) a.push(v); },
                            stat: function(a) {
                                if (!a.length) return 'n/a';
                                var s = a.slice().sort(function(x, y) { return x - y; });
                                var sum = 0; for (var i = 0; i < s.length; i++) sum += s[i];
                                var p = function(q) { return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
                                return 'n=' + s.length + ' avg=' + (sum / s.length).toFixed(2)
                                     + ' p50=' + p(0.5).toFixed(2) + ' p95=' + p(0.95).toFixed(2)
                                     + ' max=' + s[s.length - 1].toFixed(2) + 'ms';
                            },
                            out: function(s) {
                                // console.log is a dead end here (no WebChromeClient),
                                // so send metrics through the bridge to real logcat.
                                if (window.AndroidBridge && window.AndroidBridge.logMetric) {
                                    window.AndroidBridge.logMetric(s);
                                } else { console.log(s); }
                            },
                            report: function() {
                                this.out('touch->JS dispatch: ' + this.stat(this.dispatch));
                                this.out('JS->native bridge : ' + this.stat(this.bridge));
                                this.dispatch = []; this.bridge = [];
                            } };

                        // ── PERF: fast send path (latin1, no base64) ──────────────
                        // 20 bytes -> one 20-char latin1 string -> ISO-8859-1 in Kotlin.
                        // Removes the O(n) concat loop, btoa(), and the Java base64
                        // decode + allocation that the old bridge did on every packet.
                        // Falls back to the legacy base64 method on older shells.
                        var GP_L1 = !!(window.AndroidBridge && window.AndroidBridge.sendGamepadPacketL1);
                        window.sendGamepadPacket = function(buffer) {
                            var bytes = new Uint8Array(buffer);
                            var t0 = GPM.on ? performance.now() : 0;
                            if (GP_L1) {
                                window.AndroidBridge.sendGamepadPacketL1(
                                    String.fromCharCode.apply(null, bytes));
                            } else if (window.AndroidBridge && window.AndroidBridge.sendGamepadPacketNative) {
                                var binary = '';
                                for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                                window.AndroidBridge.sendGamepadPacketNative(window.btoa(binary));
                            }
                            if (GPM.on) GPM.add(GPM.bridge, performance.now() - t0);
                        };

                        // Measures the segment the RTT badge CANNOT see:
                        //   dispatch = performance.now() - event.timeStamp
                        //              i.e. hardware/OS input timestamp -> JS handler.
                        //              This is the WebView input pipeline cost.
                        //   bridge   = synchronous cost of the JS->native send call
                        //              (encode + marshal + JNI + native enqueue).
                        // Both use the same clock domain, so no correlation needed.
                        // Summary prints every 5s -> visible via logcat (tag chromium)
                        // or CDP. Set window.GPM.on = false to silence.
                        // Capture phase so we time the event BEFORE React's handlers run.
                        window.addEventListener('pointerdown', function(e) {
                            if (!GPM.on || !e.timeStamp) return;
                            var d = performance.now() - e.timeStamp;
                            if (d >= 0 && d < 500) GPM.add(GPM.dispatch, d);
                        }, true);
                        setInterval(function() {
                            if (GPM.on && (GPM.dispatch.length || GPM.bridge.length)) GPM.report();
                        }, 5000);

                        window.exitSession = function() {
                            if (window.AndroidBridge && window.AndroidBridge.exitSession) {
                                window.AndroidBridge.exitSession();
                            }
                        };
                        console.log('JSI sendGamepadPacket bridge injected!');
                        
                        document.documentElement.style.setProperty('--android-safe-top', '${lastTopDp}px');
                        document.documentElement.style.setProperty('--android-safe-bottom', '${lastBottomDp}px');
                        document.documentElement.style.setProperty('--android-safe-left', '${lastLeftDp}px');
                        document.documentElement.style.setProperty('--android-safe-right', '${lastRightDp}px');
                    """.trimIndent(), null)
                }
            }

            // ─── URL Loader ─────────────────────────────────────────────────
            // DEBUG builds only: probe the live Vite dev server first (instant
            // hot-reload), falling back to the bundled assets. RELEASE builds
            // always load the bundled production assets directly — they must
            // never probe the LAN for a dev server (a hostile host answering at
            // that address would otherwise be loaded into this privileged WebView).
            // First launch after the file:// → https origin switch goes through
            // migrate.html (old origin) to carry localStorage over; afterwards —
            // and on fresh installs after one pass — straight to APP_URL.
            val prefs = getSharedPreferences("gamepados", MODE_PRIVATE)
            val needsStorageMigration = !prefs.getBoolean("webstorage_migrated", false)
            val startUrl = if (needsStorageMigration) "file:///android_asset/migrate.html" else APP_URL

            if (needsStorageMigration) {
                // Watchdog: if migrate.html never calls back (JS failure), don't
                // hang on a blank page — skip migration and boot the app.
                postDelayed({
                    if (this.url?.startsWith("file://") == true) {
                        android.util.Log.w("GamepadOS", "Storage migration watchdog fired — booting without migration")
                        prefs.edit().putBoolean("webstorage_migrated", true).apply()
                        loadUrl(APP_URL)
                    }
                }, 4000)
            }

            if (BuildConfig.DEBUG) {
                val DEV_SERVER = "http://192.168.1.39:5173"
                Thread {
                    val useLiveServer = try {
                        val conn = java.net.URL("$DEV_SERVER/").openConnection() as java.net.HttpURLConnection
                        conn.connectTimeout = 800
                        conn.readTimeout = 800
                        conn.responseCode == 200
                    } catch (e: Exception) { false }

                    val urlToLoad = if (useLiveServer) DEV_SERVER else startUrl
                    android.util.Log.i("GamepadOS", "Loading UI from: $urlToLoad")
                    runOnUiThread { loadUrl(urlToLoad) }
                }.start()
            } else {
                loadUrl(startUrl)
            }
        }
        
        webView = webViewInstance
        
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(webViewInstance) { view, insets ->
            val systemBars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            val displayMetrics = resources.displayMetrics
            
            lastTopDp = if (systemBars.top > 0) systemBars.top / displayMetrics.density else 44f
            lastBottomDp = if (systemBars.bottom > 0) systemBars.bottom / displayMetrics.density else 24f
            lastLeftDp = if (systemBars.left > 0) systemBars.left / displayMetrics.density else 0f
            lastRightDp = if (systemBars.right > 0) systemBars.right / displayMetrics.density else 0f
            
            webViewInstance.evaluateJavascript("""
                document.documentElement.style.setProperty('--android-safe-top', '${lastTopDp}px');
                document.documentElement.style.setProperty('--android-safe-bottom', '${lastBottomDp}px');
                document.documentElement.style.setProperty('--android-safe-left', '${lastLeftDp}px');
                document.documentElement.style.setProperty('--android-safe-right', '${lastRightDp}px');
            """.trimIndent(), null)
            
            insets
        }

        gameContainer.addView(webViewInstance, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        // PHASE 3: invisible native touch overlay ABOVE the WebView. It consumes
        // touches only while the JS controller screen has published geometry and
        // called setNativeInputActive(true); otherwise it is GONE and the WebView
        // receives every event exactly as before.
        nativeInput = NativeInputEngine(this)
        gameContainer.addView(nativeInput.overlay, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        setContentView(gameContainer)

        // Force the inset dispatch immediately
        androidx.core.view.ViewCompat.requestApplyInsets(webViewInstance)
    }

    // Immersive fullscreen via the modern WindowInsetsController only. The legacy
    // View.SYSTEM_UI_FLAG_* bitmask was deprecated in API 30 and is exactly what
    // Play Console flags as "deprecated APIs for edge-to-edge"; edge-to-edge layout
    // is already established by WindowCompat.setDecorFitsSystemWindows(window, false)
    // in onCreate, so the controller.hide() below is all that's needed to also hide
    // the bars during gameplay.
    private fun hideSystemUI() {
        runOnUiThread {
            try {
                val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
                windowInsetsController.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showSystemUI() {
        runOnUiThread {
            try {
                val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
                windowInsetsController.show(WindowInsetsCompat.Type.systemBars())
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun startCameraXScanner() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()
                activeCameraProvider = cameraProvider
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val imageAnalysis = ImageAnalysis.Builder().build().also {
                    it.setAnalyzer(cameraExecutor) { imageProxy -> processImage(imageProxy) }
                }
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis)
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(this, "Failed to initialize camera: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun stopCameraXScanner() {
        try {
            activeCameraProvider?.unbindAll()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun processImage(imageProxy: ImageProxy) {
        val now = System.currentTimeMillis()
        if (now - lastAnalysisTime < 300) {
            try { imageProxy.close() } catch(e: Exception) {}
            return
        }
        lastAnalysisTime = now

        if (isEngineRunning) {
            try { imageProxy.close() } catch(e: Exception) {}
            return
        }

        try {
            val mediaImage = imageProxy.image
            if (mediaImage == null) {
                try { imageProxy.close() } catch(e: Exception) {}
                return
            }

            // Decode with ZXing off the Y (luminance) plane of the YUV_420_888 frame.
            val width = mediaImage.width
            val height = mediaImage.height
            val plane = mediaImage.planes[0]
            val buffer = plane.buffer
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            val data = ByteArray(width * height)
            val rowBytes = ByteArray(rowStride)
            buffer.rewind()
            var outPos = 0
            for (row in 0 until height) {
                val toRead = minOf(rowStride, buffer.remaining())
                if (toRead <= 0) break
                buffer.get(rowBytes, 0, toRead)
                if (pixelStride == 1) {
                    System.arraycopy(rowBytes, 0, data, outPos, minOf(width, toRead))
                } else {
                    var col = 0
                    while (col < width && col * pixelStride < toRead) { data[outPos + col] = rowBytes[col * pixelStride]; col++ }
                }
                outPos += width
            }

            // Try center-crop first (QR rarely fills the frame), then the full frame;
            // and two binarizers (Hybrid, then GlobalHistogram) — raw ZXing needs the help.
            val full = PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
            val cropW = (width * 0.8).toInt().coerceAtLeast(1)
            val cropH = (height * 0.8).toInt().coerceAtLeast(1)
            val cropped = try {
                PlanarYUVLuminanceSource(data, width, height, (width - cropW) / 2, (height - cropH) / 2, cropW, cropH, false)
            } catch (e: Exception) { full }
            val payload: String? = run decode@{
                for (src in listOf(cropped, full)) {
                    for (useGlobal in listOf(false, true)) {
                        try {
                            val binarizer = if (useGlobal) com.google.zxing.common.GlobalHistogramBinarizer(src) else HybridBinarizer(src)
                            return@decode qrReader.decode(BinaryBitmap(binarizer), qrHints).text
                        } catch (e: Exception) {
                            // not found with this combo — try next
                        } finally { qrReader.reset() }
                    }
                }
                null
            }
            android.util.Log.d("QRScan", "frame ${width}x${height} stride=$rowStride px=$pixelStride decoded=${payload != null}")

            if (payload != null && !isEngineRunning) {
                val found: String = payload
                runOnUiThread {
                    // Escape backslash FIRST, then the quote — otherwise a payload
                    // containing \' breaks out of the JS string literal (or a raw
                    // newline makes the script a syntax error and pairing silently
                    // fails). Matches showTextInput.
                    val escapedPayload = found
                        .replace("\\", "\\\\")
                        .replace("'", "\\'")
                        .replace("\n", "\\n")
                        .replace("\r", "\\r")
                    webView?.evaluateJavascript("if (window.onQRScanned) window.onQRScanned('$escapedPayload');", null)
                }
            }
            try { imageProxy.close() } catch(e: Exception) {}
        } catch (e: Exception) {
            e.printStackTrace()
            try { imageProxy.close() } catch(e: Exception) {}
        }
    }

    private fun cleanupSessionAndReturn() {
        isEngineRunning = false
        isTransitioning.set(false)
        stopChargeBypass()
        stopNetworkNative()

        // Release MulticastLock safely to prevent battery drainage
        try {
            multicastLock?.let {
                if (it.isHeld) {
                    it.release()
                }
            }
            multicastLock = null
            wifiLock?.let { if (it.isHeld) it.release() }
            wifiLock = null
            android.util.Log.i("GamepadOS", "MulticastLock + Wi-Fi low-latency lock released.")
        } catch (e: Exception) {
            e.printStackTrace()
        }
        
        runOnUiThread {
            previewView.visibility = View.INVISIBLE
            stopCameraXScanner()
            showSystemUI()
            // PHASE 3: session teardown must also take the native overlay out of the
            // touch path (JS deactivates on screen-leave too; this is belt-and-braces).
            try { if (::nativeInput.isInitialized) nativeInput.setActive(false) } catch (e: Exception) {}
            webView?.evaluateJavascript("if (window.onSessionExited) window.onSessionExited();", null)
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        initGameplaySurface(holder.surface, width, height)
    }

    private fun startChargeBypass() {
        // Charge bypass removed for v1.0 (was Shizuku-only) — no-op.
    }

    private fun stopChargeBypass() {
        // Charge bypass removed for v1.0 — no-op.
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        applyLetterboxing(newConfig)
    }

    private fun applyLetterboxing(config: android.content.res.Configuration) {
        runOnUiThread {
            try {
                val parent = gameContainer.parent as? android.widget.FrameLayout ?: return@runOnUiThread
                val lp = gameContainer.layoutParams as? android.widget.FrameLayout.LayoutParams ?: return@runOnUiThread
                
                if (config.smallestScreenWidthDp >= 600) {
                    val displayMetrics = resources.displayMetrics
                    val screenW = displayMetrics.widthPixels
                    val screenH = displayMetrics.heightPixels
                    
                    // Determine target phone aspect ratio based on active orientation
                    val isLandscape = config.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
                    val targetRatio = if (isLandscape) 20.0 / 9.0 else 9.0 / 20.0
                    
                    var targetW = screenW
                    var targetH = (targetW / targetRatio).toInt()
                    
                    // Constrain so it doesn't overflow the screen bounds
                    if (targetH > screenH) {
                        targetH = screenH
                        targetW = (targetH * targetRatio).toInt()
                    }
                    
                    lp.width = targetW
                    lp.height = targetH
                    lp.gravity = android.view.Gravity.CENTER
                    gameContainer.layoutParams = lp
                    parent.setBackgroundColor(Color.parseColor("#070910"))
                } else {
                    lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                    lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                    lp.gravity = android.view.Gravity.TOP or android.view.Gravity.START
                    gameContainer.layoutParams = lp
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Restore the keep-awake flag that onPause drops. Symmetric by design:
        // the flag is scoped to "the user is looking at us", not to the process
        // lifetime, which is what it used to be.
        //
        // Scoping it further — to the controller screen only, so browsing pads
        // doesn't hold the display awake — is the next improvement, and needs
        // the isActive signal plumbed through to native.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Register ONLY the fused rotation-vector sensor for steering. Raw accel/gyro
        // are no longer used (they had a gravity blind-spot at steep/vertical holds).
        // FASTEST = up to 200 Hz on this device (vs 50 Hz for GAME) → more samples
        // than the display refresh, so the indicator never repeats a frame = smooth.
        if (sensorThread == null) {
            sensorThread = android.os.HandlerThread("gyro-sensor").apply { start() }
            sensorHandler = android.os.Handler(sensorThread!!.looper)
        }
        rotationSensor?.let {
            // 4-arg overload → events delivered on sensorHandler's thread, off the UI looper.
            sensorManager.registerListener(this, it, android.hardware.SensorManager.SENSOR_DELAY_FASTEST, sensorHandler)
        }
        // (Re)start the USB-tether watcher. Reset lastUsbActive so the current
        // state is re-broadcast on resume — handles "plugged in while app was
        // backgrounded" and "returned to app after enabling USB tethering".
        lastUsbActive = null
        mainHandler.removeCallbacks(usbWatchRunnable)
        mainHandler.post(usbWatchRunnable)
        // Catch a cold-start launch via USB accessory attach (the launch Intent
        // persists across onCreate→onResume; handleAccessoryIntent no-ops if we're
        // already on an AOA session).
        handleAccessoryIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        sensorManager.unregisterListener(this)
        mainHandler.removeCallbacks(usbWatchRunnable)

        // ── Release everything that only makes sense while the user is here ──
        //
        // Until this was added, a backgrounded-but-still-paired app kept the
        // screen forced awake, Wi-Fi power-save disabled and a multicast lock
        // held — indefinitely, because none of them were released anywhere
        // except on explicit teardown. Leaving the app entirely did not stop
        // them. That is the battery and heat complaint a paying user notices,
        // and it costs nothing to fix.
        //
        // FLAG_KEEP_SCREEN_ON is the worst of the three: it was added once,
        // under a comment reading "OLED Blackout & Thermal Optimization", and
        // never cleared. It did the exact opposite of what the comment claims.
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        releaseRadioLocks()

        // NOTE: the UDP engine is deliberately NOT stopped here. It holds the
        // standing link the PC server expects on every screen, and tearing it
        // down on a notification shade or an incoming call would drop the
        // session and force a re-pair. Stopping it needs the reconnect path
        // exercised on a real device first — see the audit's P0-2.
    }

    /**
     * Drop the Wi-Fi low-latency and multicast locks if we hold them.
     *
     * Safe to call when they are already released or were never taken: both are
     * null-checked and `isHeld`-checked. They are re-acquired by the connect
     * path, so a resume that reconnects gets them back.
     */
    private fun releaseRadioLocks() {
        try { multicastLock?.let { if (it.isHeld) it.release() } } catch (ignored: Exception) {}
        try { wifiLock?.let { if (it.isHeld) it.release() } } catch (ignored: Exception) {}
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Phone already running when plugged into the PC → warm USB-accessory attach.
        handleAccessoryIntent(intent)
    }

    override fun onSensorChanged(event: android.hardware.SensorEvent) {
        val t = event.sensor.type
        if (t != android.hardware.Sensor.TYPE_GAME_ROTATION_VECTOR &&
            t != android.hardware.Sensor.TYPE_ROTATION_VECTOR) return

        // Fused attitude → rotation matrix (device→world).
        android.hardware.SensorManager.getRotationMatrixFromVector(fusionRotMatrix, event.values)

        // Remap into a consistent LANDSCAPE-VIEW frame so the zero + axes are identical in
        // either landscape orientation (app is SENSOR_LANDSCAPE → ROTATION_90 or _270).
        val (axisX, axisY) = if (currentDisplayRotation() == android.view.Surface.ROTATION_270)
            android.hardware.SensorManager.AXIS_MINUS_Y to android.hardware.SensorManager.AXIS_X
        else
            android.hardware.SensorManager.AXIS_Y to android.hardware.SensorManager.AXIS_MINUS_X
        android.hardware.SensorManager.remapCoordinateSystem(fusionRotMatrix, axisX, axisY, fusionRemapped)

        // World-up in the remapped view frame (3rd row). Level phone (screen vertical,
        // facing you) → up ≈ (0, 1, 0).
        val ux = fusionRemapped[6]
        val uy = fusionRemapped[7]
        val uz = fusionRemapped[8].coerceIn(-1f, 1f)
        // ROLL = angle of up WITHIN the screen plane = left/right steering. Both legs
        // (ux,uy) stay large in play holds → stable; ratio is preserved as you lean
        // forward/back → decoupled from pitch; no gimbal-lock except screen-flat.
        val rollDeg  = STEER_SIGN  * Math.toDegrees(Math.atan2(ux.toDouble(), uy.toDouble()))
        // PITCH = how far up tips OUT of the screen plane = forward/back lean (3D look Y).
        val pitchDeg = PITCH_SIGN * Math.toDegrees(Math.asin(uz.toDouble()))
        fusedRollDeg  = rollFilter.filter(rollDeg, event.timestamp).toFloat()
        fusedPitchDeg = pitchFilter.filter(pitchDeg, event.timestamp).toFloat()
        lastSensorEventNs = event.timestamp

        // Resting-flat detection — see the field docs. Uses the raw up-vector
        // (well-defined at every pose, unlike roll), gated by the user setting.
        if (gyroIdleDetectEnabled) {
            val flat = kotlin.math.abs(uz) >= flatUz
            val moved = kotlin.math.abs(ux - prevUx) + kotlin.math.abs(uy - prevUy) +
                        kotlin.math.abs(uz - prevUz) > stillEps
            if (moved || !flat) stillSinceNs = event.timestamp
            gyroRestingFlat = flat && (event.timestamp - stillSinceNs) >= idleNs
        } else {
            gyroRestingFlat = false
            stillSinceNs = event.timestamp
        }
        prevUx = ux; prevUy = uy; prevUz = uz
        // PHASE 3: while the native input path owns the payload, each ~200 Hz fused
        // sample rebuilds + injects it right here on the sensor thread — gyro cadence
        // is decoupled from the WebView AND the display refresh (the Phase 3a goal).
        // No-op unless the overlay is active and gyro is on.
        if (::nativeInput.isInitialized) nativeInput.onGyroSample()
    }

    // Display rotation, version-safe (Activity.display on API 30+, else WindowManager).
    private fun currentDisplayRotation(): Int = try {
        if (android.os.Build.VERSION.SDK_INT >= 30) display?.rotation ?: android.view.Surface.ROTATION_0
        else @Suppress("DEPRECATION") windowManager.defaultDisplay.rotation
    } catch (e: Exception) { android.view.Surface.ROTATION_0 }

    override fun onAccuracyChanged(sensor: android.hardware.Sensor, accuracy: Int) {}

    // ── 1€ (One Euro) filter ──────────────────────────────────────────────────
    // Casiez, Roussel & Vogel (CHI 2012). A first-order low-pass whose cutoff
    // ADAPTS to signal speed: slow/still → low cutoff (strong smoothing, no jitter);
    // fast motion → high cutoff (little smoothing, no lag). Beats a fixed low-pass,
    // which must trade jitter for lag. Runs per sensor sample with real dt.
    // Defaults mirror the SHIPPED tune (both filters are constructed with 2.8/0.5 at
    // the call site) so the class is self-documenting — a reader no longer sees a
    // gentler 1.0/0.1 filter than what actually runs. This is a latency-biased tune
    // (higher minCutoff/beta favour low lag over still-hand smoothness); revisit with
    // on-device RMS-jitter measurement if steady-hand micro-steer becomes an issue.
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
            if (dt <= 0.0 || dt > 0.1) dt = 1.0 / 200.0   // guard bad/large gaps
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

    // ── AOA direct-USB transport (Plan B): ~1-2 ms wired latency ──────────────
    // When the phone is plugged into the PC running GamepadServer (which performs
    // the AOA handshake), Android delivers a USB_ACCESSORY_ATTACHED intent. We open
    // the accessory, hand its raw fd to the native engine, and the existing low-
    // latency TX thread write()s/read()s 20-byte frames over USB bulk — no IP stack,
    // no adb. Identity strings must match res/xml/accessory_filter.xml AND the PC's
    // handshake (apps/pc-server/aoa_transport.py).
    private fun handleAccessoryIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action != android.hardware.usb.UsbManager.ACTION_USB_ACCESSORY_ATTACHED) return
        // Already on an AOA session? don't double-start. (If we're on Wi-Fi/tether,
        // usbAccessory is null, so we proceed and switch transports below.)
        if (isEngineRunning && usbAccessory != null) return
        val accessory: android.hardware.usb.UsbAccessory? =
            intent.getParcelableExtra(android.hardware.usb.UsbManager.EXTRA_ACCESSORY)
        if (accessory != null) connectAccessory(accessory)
    }

    private fun connectAccessory(accessory: android.hardware.usb.UsbAccessory) {
        val usbManager = getSystemService(Context.USB_SERVICE) as android.hardware.usb.UsbManager
        if (usbManager.hasPermission(accessory)) {
            openAccessoryAndStart(usbManager, accessory)
            return
        }
        // Register a one-shot permission receiver, then ask the user.
        if (usbPermissionReceiver == null) {
            usbPermissionReceiver = object : android.content.BroadcastReceiver() {
                override fun onReceive(ctx: Context, recvIntent: Intent) {
                    if (recvIntent.action != ACTION_USB_PERMISSION) return
                    val granted = recvIntent.getBooleanExtra(
                        android.hardware.usb.UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    val acc: android.hardware.usb.UsbAccessory? =
                        recvIntent.getParcelableExtra(android.hardware.usb.UsbManager.EXTRA_ACCESSORY)
                    if (granted && acc != null) {
                        openAccessoryAndStart(
                            getSystemService(Context.USB_SERVICE) as android.hardware.usb.UsbManager, acc)
                    } else {
                        android.util.Log.w("GamepadOS", "USB accessory permission denied.")
                    }
                }
            }
            val filter = android.content.IntentFilter(ACTION_USB_PERMISSION)
            // API 33+ requires an explicit exported/not-exported flag on runtime receivers.
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                registerReceiver(usbPermissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(usbPermissionReceiver, filter)
            }
        }
        val piFlags = if (android.os.Build.VERSION.SDK_INT >= 31)
            android.app.PendingIntent.FLAG_MUTABLE else 0
        val pi = android.app.PendingIntent.getBroadcast(
            this, 0, Intent(ACTION_USB_PERMISSION).setPackage(packageName), piFlags)
        usbManager.requestPermission(accessory, pi)
    }

    private fun openAccessoryAndStart(
        usbManager: android.hardware.usb.UsbManager,
        accessory: android.hardware.usb.UsbAccessory
    ) {
        runOnUiThread {
            // Single engine / single TX thread: tear down any existing Wi-Fi or
            // tether session first (mirrors connectToPC's transition guard).
            if (isEngineRunning) {
                try { stopNetworkNative() } catch (e: Exception) {}
                try {
                    multicastLock?.let { if (it.isHeld) it.release() }; multicastLock = null
                    wifiLock?.let { if (it.isHeld) it.release() }; wifiLock = null
                } catch (e: Exception) {}
                isEngineRunning = false
                isTransitioning.set(false)
            }
            // BUG 8 FIX: null out the old GrxClient so grxSeal() doesn't use the
            // stale Wi-Fi UDP session to send encrypted frames over a dead socket.
            grx = null
            try {
                val pfd = usbManager.openAccessory(accessory) ?: run {
                    android.util.Log.e("GamepadOS", "openAccessory returned null.")
                    return@runOnUiThread
                }
                // detachFd() transfers fd ownership to native (which close()s it in
                // stopNetworkNative). The ParcelFileDescriptor must NOT also close it.
                val fd = pfd.detachFd()
                usbAccessory = accessory
                isEngineRunning = true
                connectionType = "wired"
                startChargeBypass()
                initAccessoryNative(fd)
                hideSystemUI()
                // Tell the web UI it's on the AOA wired path (so it shows the right
                // badge and doesn't also try the WebSocket/UDP transports).
                webView?.evaluateJavascript(
                    "if(window.onAccessoryConnected)window.onAccessoryConnected();", null)
                android.util.Log.i("GamepadOS", "AOA accessory engine started (fd=$fd).")
            } catch (e: Exception) {
                // BUG 4 FIX: if initAccessoryNative (or anything above) throws, reset
                // isEngineRunning so the app isn't permanently stuck thinking it's connected.
                android.util.Log.e("GamepadOS", "Failed to start AOA accessory: ${e.message}")
                isEngineRunning = false
                usbAccessory = null
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Before anything else: a payment SDK can call back on its own thread
        // well after this point, and the sink it would reach is about to die.
        PurchaseRelay.detach()
        cameraExecutor.shutdown()
        try { sensorManager.unregisterListener(this) } catch (e: Exception) {}
        sensorThread?.quitSafely(); sensorThread = null; sensorHandler = null
        try { usbPermissionReceiver?.let { unregisterReceiver(it) }; usbPermissionReceiver = null } catch (e: Exception) {}
        // BUG 5 FIX: always reset both flags in onDestroy so a recreated Activity
        // (rotation, memory pressure) starts fresh and isn't blocked by stale state.
        isTransitioning.set(false)
        if (isEngineRunning) {
            stopChargeBypass()
            stopNetworkNative()
        }
        isEngineRunning = false
        // Release the Wi-Fi/multicast locks here too. exitApp() and swipe-from-
        // recents reach onDestroy without going through cleanupSessionAndReturn,
        // so without this the low-latency WifiLock + MulticastLock would stay held
        // by the cached process and drain the battery.
        try {
            multicastLock?.let { if (it.isHeld) it.release() }
            multicastLock = null
            wifiLock?.let { if (it.isHeld) it.release() }
            wifiLock = null
        } catch (e: Exception) {}
        destroyGameplaySurface()
        // Destroy the WebView so its renderer threads don't outlive the activity.
        try {
            webView?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                it.destroy()
            }
            webView = null
        } catch (e: Exception) {}
    }

    override fun surfaceCreated(h: SurfaceHolder) {}
    override fun surfaceDestroyed(h: SurfaceHolder) { destroyGameplaySurface() }

    companion object {
        init { System.loadLibrary("gamepad_engine") }
    }
}
