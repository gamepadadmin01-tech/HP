package com.gamepad.camos

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.os.Build
import android.os.Bundle
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * CamOS shell — the same pattern as GamepadOS: a native window that holds a WebView showing the React UI
 * (built from apps/controller-ui with `npm run build:camos`), plus a small bridge (`window.CamOSBridge`) the UI
 * calls for the things only Android can do: the camera, the QR scanner, the network.
 *
 * Layers, bottom to top:
 *   1. cameraView   — TextureView showing exactly what the PC gets (drawn by GlPipeline; visible only while live)
 *   2. qrView       — CameraX preview for the QR scanner (visible only while scanning)
 *   3. webView      — the UI. GamepadOS's brown, and see-through ONLY while a camera layer is showing
 *                     (the GamepadOS launch-glitch lesson: never a surface under a transparent page otherwise).
 *   4. dimCover     — black cover for "dim screen" (the PC keeps getting the picture)
 *
 * TextureView, not SurfaceView, for both camera layers: a SurfaceView punches a hole through the window, which is
 * exactly what caused GamepadOS's "app opens twice" flash.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var root: FrameLayout
    private lateinit var cameraView: TextureView
    /** A preview texture kept alive for the camera while CamOS was in the background in direct mode. */
    private var orphanPreview: SurfaceTexture? = null
    private lateinit var qrView: PreviewView
    private lateinit var webView: WebView
    private lateinit var dimCover: View

    private lateinit var streamer: CamStreamer
    /** Google Play purchases (Get Premium). Created on first use; answers go to window.camosOnPurchase. */
    private val billing by lazy {
        CamBilling(this) { json -> js("window.camosOnPurchase && window.camosOnPurchase(${JSONObject.quote(json.toString())})") }
    }
    private var billingUsed = false
    /** "Watch an ad → 45 min HD". Answers go to window.camosOnAd. */
    private val ads by lazy {
        CamAds(this) { json -> js("window.camosOnAd && window.camosOnAd(${JSONObject.quote(json.toString())})") }
    }
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

    private val qrExecutor = Executors.newSingleThreadExecutor()
    private var qrProvider: ProcessCameraProvider? = null
    private val qrReader = QRCodeReader()
    private val qrHints = mapOf<DecodeHintType, Any>(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
    @Volatile private var lastQrTry = 0L
    @Volatile private var scanning = false

    private val page = Color.parseColor("#1A1210")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        root = FrameLayout(this).apply { setBackgroundColor(page) }
        cameraView = TextureView(this).apply {
            visibility = View.INVISIBLE
            // The picture engine draws the preview here itself, so the preview is always exactly what the PC gets.
            surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(s: SurfaceTexture, w: Int, h: Int) { streamer.setPreview(s, w, h) }
                override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) { streamer.previewResized(w, h) }
                override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                    streamer.setPreview(null, 0, 0)
                    // Direct 60 fps: the camera itself draws into this preview; releasing it while streaming in the
                    // background would break the camera session. Keep it until the stream ends.
                    if (streamer.direct && streamer.isRunning()) { orphanPreview = s; return false }
                    return true
                }
                override fun onSurfaceTextureUpdated(s: SurfaceTexture) {}
            }
        }
        qrView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE   // TextureView inside, no window hole
            visibility = View.INVISIBLE
        }
        dimCover = View(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            setOnClickListener { setDim(false) }
        }

        streamer = CamStreamer(this, ::displayRotationDegrees) { state, message, fps, kbps -> runOnUiThread { onStreamState(state, message, fps, kbps) } }
        // The streaming notification's Stop button.
        CamService.onStopPressed = { runOnUiThread { streamer.stop() } }
        // Requests from the PC window go to the page, which checks them against this phone's plan before applying.
        streamer.onRemote = { json -> js("window.camosOnRemote && window.camosOnRemote(${JSONObject.quote(json)})") }

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        webView = WebView(this).apply {
            setBackgroundColor(page)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)   // as GamepadOS: GPU-drawn page, smooth motion
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
            }
            addJavascriptInterface(Bridge(), "CamOSBridge")
            loadUrl("https://appassets.androidplatform.net/assets/dist/index.html")
        }

        val full = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        root.addView(cameraView, full)
        root.addView(qrView, FrameLayout.LayoutParams(full))
        root.addView(webView, FrameLayout.LayoutParams(full))
        root.addView(dimCover, FrameLayout.LayoutParams(full))
        setContentView(root)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1)
        }
        preferHighestRefreshRate()
        startUsbWatch()

        // Back: the page decides first (close the scanner, leave Connect, stop streaming, go back to the Camera tab),
        // exactly like GamepadOS; only when it has nothing to close does Back leave the app.
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (dimCover.visibility == View.VISIBLE) { setDim(false); return }
                webView.evaluateJavascript("(window.camosBack && window.camosBack()) ? 'y' : 'n'") { r ->
                    if (r?.contains("y") != true) { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
                }
            }
        })
    }

    /** Same as GamepadOS: ask for the screen's fastest refresh rate (120 Hz phones), so every animation is smooth. */
    private fun preferHighestRefreshRate() {
        try {
            val d = if (Build.VERSION.SDK_INT >= 30) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
            val cur = d?.mode ?: return
            val best = d.supportedModes.filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
                .maxByOrNull { it.refreshRate } ?: return
            val lp = window.attributes
            lp.preferredDisplayModeId = best.modeId
            window.attributes = lp
        } catch (_: Exception) {}
    }

    // ───────────────────────── USB: connect by itself ─────────────────────────

    @Volatile private var usbWatch = true

    /**
     * Owner, 2026-11-22: "the phone should auto-connect after USB tethering or debugging is turned on". Every 2 s,
     * cheaply: is there a USB-tether network (rndis/usb/ncm with an address)? Or is USB debugging on while the phone
     * charges over USB, and does Gamepad Server's adb tunnel answer on 127.0.0.1:7780? On each change the page is
     * told (window.camosOnUsb), and it finds and connects to the PC. The tunnel is knocked only until it answers,
     * never while streaming, so this costs nothing in normal use.
     */
    private fun startUsbWatch() {
        Thread({
            var lastTether = false
            var lastAdb = false
            while (usbWatch) {
                val tether = try {
                    java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: null).any { ni ->
                        ni.isUp && (ni.name.startsWith("rndis") || ni.name.startsWith("usb") || ni.name.startsWith("ncm")) &&
                            ni.interfaceAddresses.any { it.address is java.net.Inet4Address }
                    }
                } catch (_: Exception) { false }
                val usbPower = try {
                    registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
                        ?.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) == android.os.BatteryManager.BATTERY_PLUGGED_USB
                } catch (_: Exception) { false }
                val adbOn = try { android.provider.Settings.Global.getInt(contentResolver, android.provider.Settings.Global.ADB_ENABLED, 0) == 1 } catch (_: Exception) { false }
                val adb = when {
                    !(adbOn && usbPower) -> false
                    lastAdb || streamer.isRunning() -> lastAdb
                    else -> try {
                        java.net.Socket().use { sk ->
                            sk.connect(java.net.InetSocketAddress("127.0.0.1", CamStreamer.PORT), 300)
                            sk.soTimeout = 800
                            val b = ByteArray(4)
                            java.io.DataInputStream(sk.getInputStream()).readFully(b)
                            String(b, Charsets.US_ASCII) == "CAMS"
                        }
                    } catch (_: Exception) { false }
                }
                if (tether != lastTether || adb != lastAdb) {
                    lastTether = tether; lastAdb = adb
                    val json = JSONObject().put("on", tether || adb).put("via", if (adb) "adb" else if (tether) "tether" else "none")
                    js("window.camosOnUsb && window.camosOnUsb(${JSONObject.quote(json.toString())})")
                }
                try { Thread.sleep(2000) } catch (_: InterruptedException) { break }
            }
        }, "camos-usb-watch").apply { isDaemon = true }.start()
    }

    /** How the screen is turned right now: 0, 90, 180 or 270 (Android's own Surface.ROTATION_* in degrees). */
    private fun displayRotationDegrees(): Int {
        val r = try { if (Build.VERSION.SDK_INT >= 30) display?.rotation ?: 0 else @Suppress("DEPRECATION") windowManager.defaultDisplay.rotation } catch (_: Exception) { 0 }
        return when (r) { Surface.ROTATION_90 -> 90; Surface.ROTATION_180 -> 180; Surface.ROTATION_270 -> 270; else -> 0 }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        js("window.camosOnPermission && window.camosOnPermission(${ok})")
    }

    override fun onResume() {
        super.onResume()
        streamer.resumeCamera()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        usbWatch = false
        streamer.stop()
        CamService.stop(this)
        if (billingUsed) billing.close()
        stopQr()
        releaseWifiLock()
        super.onDestroy()
    }

    private fun hideSystemBars() {
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.hide(WindowInsetsCompat.Type.systemBars())
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun js(script: String) {
        runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    private fun hasCamera() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    // ───────────────────────── streaming ─────────────────────────

    /** Direct 60 fps: the camera draws straight into cameraView, so fit and turn it here (the picture engine does
     *  this itself otherwise). The camera hands it over turned for the phone held upright: a tall picture. */
    private var directFitted = false
    private fun fitDirectPreview() {
        val size = streamer.directPreviewSize ?: return
        val vw = cameraView.width.toFloat(); val vh = cameraView.height.toFloat()
        if (vw <= 0f || vh <= 0f) return
        val rot = displayRotationDegrees()
        val m = android.graphics.Matrix()
        val cx = vw / 2f; val cy = vh / 2f
        val bw = size.height.toFloat(); val bh = size.width.toFloat()   // tall
        if (rot == 90 || rot == 270) {
            val view = android.graphics.RectF(0f, 0f, vw, vh)
            val buf = android.graphics.RectF(0f, 0f, bw, bh)
            buf.offset(cx - buf.centerX(), cy - buf.centerY())
            m.setRectToRect(view, buf, android.graphics.Matrix.ScaleToFit.FILL)
            val scale = minOf(vh / bw, vw / bh)   // whole picture visible, like the picture engine's preview
            m.postScale(scale, scale, cx, cy)
            m.postRotate((rot - 180).toFloat(), cx, cy)
        } else {
            val bufAspect = bw / bh; val viewAspect = vw / vh
            if (viewAspect > bufAspect) m.setScale(bufAspect / viewAspect, 1f, cx, cy) else m.setScale(1f, viewAspect / bufAspect, cx, cy)
            if (rot == 180) m.postRotate(180f, cx, cy)
        }
        cameraView.setTransform(m)
        directFitted = true
    }

    private fun onStreamState(state: String, message: String, fps: Int, kbps: Int) {
        if (state == "live" && !directFitted) fitDirectPreview()
        if (state == "error" || state == "stopped") {
            // Back to the picture engine: undo the direct-mode fit AND the camera's buffer size (1920×1080), or the
            // engine's next preview is drawn into a wrongly sized buffer (shifted, with a black bar).
            if (directFitted) { cameraView.setTransform(null); directFitted = false }
            if (cameraView.width > 0) cameraView.surfaceTexture?.setDefaultBufferSize(cameraView.width, cameraView.height)
            cameraView.visibility = View.INVISIBLE
            // Free rotation again once the camera is off (owner: the app turns normally before Start).
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            webView.setBackgroundColor(page)
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            setDim(false)
            releaseWifiLock()
            CamService.stop(this)
            orphanPreview?.let { o -> if (o !== cameraView.surfaceTexture) o.release() }
            orphanPreview = null
        }
        val json = JSONObject().put("state", state).put("message", message).put("fps", fps).put("kbps", kbps)
            .put("front", streamer.facingFront).put("portrait", streamer.portrait).put("direct", streamer.direct).put("height", streamer.sentShortSide)
        js("window.camosOnState && window.camosOnState(${JSONObject.quote(json.toString())})")
    }

    private fun startStream(ip: String, key: String, json: String) {
        if (!hasCamera()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1)
            onStreamState("error", "CamOS needs the camera permission to work as a webcam.", 0, 0)
            return
        }
        stopQr()
        val s = CamSettings.from(json)
        // Picture shape, and the screen holds still while streaming so the preview matches what the PC gets.
        val heldUpright = resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
        val portrait = when (s.shape) { "portrait" -> true; "landscape" -> false; else -> heldUpright }
        requestedOrientation = when (s.shape) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_LOCKED
        }
        cameraView.visibility = View.VISIBLE
        webView.setBackgroundColor(Color.TRANSPARENT)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        acquireWifiLock()
        streamer.start(ip, key, s, portrait)
        // Keep the camera when the screen goes off or another app comes in front (CamService.kt). Its notification
        // needs Android 13's notification permission; asked once, the stream works either way.
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && !getPreferences(MODE_PRIVATE).getBoolean("askedNotify", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("askedNotify", true).apply()
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
        }
        CamService.start(this)
    }

    private fun setDim(on: Boolean) {
        dimCover.visibility = if (on) View.VISIBLE else View.GONE
        val lp = window.attributes
        lp.screenBrightness = if (on) 0.01f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        window.attributes = lp
    }

    private fun acquireWifiLock() {
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            val mode = if (Build.VERSION.SDK_INT >= 29) android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                else @Suppress("DEPRECATION") android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF
            wifiLock = wm.createWifiLock(mode, "CamOSStream").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {}
    }

    private fun releaseWifiLock() {
        try { wifiLock?.release() } catch (_: Exception) {}
        wifiLock = null
    }

    // ───────────────────────── QR scanner ─────────────────────────

    private fun startQr() {
        if (!hasCamera()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1)
            return
        }
        scanning = true
        qrView.visibility = View.VISIBLE
        webView.setBackgroundColor(Color.TRANSPARENT)
        val f = ProcessCameraProvider.getInstance(this)
        f.addListener({
            try {
                val p = f.get()
                qrProvider = p
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(qrView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                    .also { it.setAnalyzer(qrExecutor) { img -> decodeQr(img) } }
                p.unbindAll()
                p.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                js("window.camosOnState && window.camosOnState(${JSONObject.quote(JSONObject().put("state", "error").put("message", "Camera failed: ${e.message}").toString())})")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun stopQr() {
        scanning = false
        try { qrProvider?.unbindAll() } catch (_: Exception) {}
        qrView.visibility = View.INVISIBLE
        if (!streamer.isRunning()) webView.setBackgroundColor(page)
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun decodeQr(img: ImageProxy) {
        try {
            val now = System.currentTimeMillis()
            val image = img.image
            if (!scanning || image == null || now - lastQrTry < 250) return
            lastQrTry = now
            val w = image.width; val h = image.height
            val plane = image.planes[0]
            val buf = plane.buffer; val rs = plane.rowStride; val ps = plane.pixelStride
            val data = ByteArray(w * h)
            for (y in 0 until h) for (x in 0 until w) {
                val i = y * rs + x * ps
                if (i < buf.limit()) data[y * w + x] = buf.get(i)
            }
            val src = PlanarYUVLuminanceSource(data, w, h, 0, 0, w, h, false)
            val text = try { qrReader.decode(BinaryBitmap(HybridBinarizer(src)), qrHints).text } catch (_: Exception) { null } finally { qrReader.reset() }
            if (text != null) {
                scanning = false
                runOnUiThread {
                    stopQr()
                    js("window.camosOnQR && window.camosOnQR(${JSONObject.quote(text)})")
                }
            }
        } finally {
            img.close()
        }
    }

    // ───────────────────────── the bridge the UI calls ─────────────────────────

    inner class Bridge {
        @JavascriptInterface fun startScan() = runOnUiThread { startQr() }
        @JavascriptInterface fun stopScan() = runOnUiThread { stopQr() }
        /** Start streaming with every setting as JSON (see CamSettings). */
        @JavascriptInterface fun start(ip: String, key: String, settings: String) = runOnUiThread { startStream(ip, key, settings) }
        /** Change settings while live: camera, lens, flashlight, filters apply at once. */
        @JavascriptInterface fun update(settings: String) = streamer.update(CamSettings.from(settings))
        @JavascriptInterface fun stop() = runOnUiThread { streamer.stop() }
        /** "Is my PC ready?" — answers through window.camosOnCheck({ip, status, message}). */
        @JavascriptInterface fun check(ip: String, key: String) = streamer.check(ip, key) { status, message ->
            val json = JSONObject().put("ip", ip).put("status", status).put("message", message)
            js("window.camosOnCheck && window.camosOnCheck(${JSONObject.quote(json.toString())})")
        }
        /** "Where is my PC?" — answers through window.camosOnFind({ip, name, via}); ip is null if nothing answered. */
        @JavascriptInterface fun find(key: String, usbOnly: Boolean) = streamer.find(key.ifEmpty { null }, usbOnly) { ip, name, via ->
            val json = JSONObject().put("ip", ip ?: JSONObject.NULL).put("name", name).put("via", via)
            js("window.camosOnFind && window.camosOnFind(${JSONObject.quote(json.toString())})")
        }
        /** Android's tethering settings (where "USB tethering" is switched on). */
        @JavascriptInterface fun openTetherSettings() = runOnUiThread {
            val tries = listOf(
                android.content.Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings"),
                android.content.Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS),
                android.content.Intent(android.provider.Settings.ACTION_SETTINGS))
            for (i in tries) { try { startActivity(i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)); break } catch (_: Exception) {} }
        }
        /** Every lens and what it can do, for the Settings screen. */
        @JavascriptInterface fun cameras(): String = try { CameraCatalog.describe(this@MainActivity) } catch (_: Exception) { "[]" }
        /** Plain-text report of what the cameras offer to apps (Settings → About → Camera report). */
        @JavascriptInterface fun cameraReport(): String = try { CameraCatalog.report(this@MainActivity) } catch (e: Exception) { "Report failed: ${e.message}" }
        @JavascriptInterface fun dim(on: Boolean) = runOnUiThread { setDim(on) }
        /** The page's answer to the PC window: what is set and what this phone's plan allows. */
        @JavascriptInterface fun sendState(json: String) = streamer.sendState(json)
        @JavascriptInterface fun deviceName(): String = CamStreamer.deviceName()
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        /** Test builds can pretend to be Premium or pretend an ad was watched, so every screen can be tried. */
        @JavascriptInterface fun isTestBuild(): Boolean = BuildConfig.DEBUG
        /** Get Premium: Google Play's purchase sheet for camos_lifetime, stamped with this account. */
        @JavascriptInterface fun startPlayPurchase(userId: String) { billingUsed = true; billing.buy(userId) }
        /** Anything this phone already bought, handed back to the page (restored: true). */
        @JavascriptInterface fun restorePurchases() { billingUsed = true; billing.restore() }
        @JavascriptInterface fun acknowledgeIfServerCredited(purchaseToken: String) { billingUsed = true; billing.acknowledge(purchaseToken) }
        /** Play a rewarded ad (Google's consent form first, where the law needs it). */
        @JavascriptInterface fun showRewardedAd() = ads.show()
        /** Load an ad while the HD card is on screen, so the tap is instant (only after consent was given once). */
        @JavascriptInterface fun preloadRewardedAd() = ads.preload()
        @JavascriptInterface fun adPrivacyOptionsRequired(): Boolean = ads.privacyOptionsRequired()
        @JavascriptInterface fun showAdPrivacyOptions() = ads.showPrivacyOptions()
    }
}
