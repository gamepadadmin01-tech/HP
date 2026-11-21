package com.gamepad.camos

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.os.Build
import android.os.Bundle
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
 *   1. cameraView   — TextureView showing what the phone streams (visible only while live)
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
    private lateinit var qrView: PreviewView
    private lateinit var webView: WebView
    private lateinit var dimCover: View

    private lateinit var streamer: CamStreamer
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
        cameraView = TextureView(this).apply { visibility = View.INVISIBLE }
        qrView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE   // TextureView inside, no window hole
            visibility = View.INVISIBLE
        }
        dimCover = View(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            setOnClickListener { setDim(false) }
        }

        streamer = CamStreamer(this) { state, message, fps, kbps -> runOnUiThread { onStreamState(state, message, fps, kbps) } }

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        webView = WebView(this).apply {
            setBackgroundColor(page)
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
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        js("window.camosOnPermission && window.camosOnPermission(${ok})")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        streamer.stop()
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

    private fun onStreamState(state: String, message: String, fps: Int, kbps: Int) {
        if (state == "error" || state == "stopped") {
            cameraView.visibility = View.INVISIBLE
            webView.setBackgroundColor(page)
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            setDim(false)
            releaseWifiLock()
        }
        val json = JSONObject().put("state", state).put("message", message).put("fps", fps).put("kbps", kbps)
            .put("front", streamer.facingFront)
        js("window.camosOnState && window.camosOnState(${JSONObject.quote(json.toString())})")
    }

    /** The TextureView's surface exists only once it has been laid out; wait for it before opening the camera. */
    private fun withPreview(block: (SurfaceTexture?) -> Unit) {
        val st = cameraView.surfaceTexture
        if (st != null) { block(st); return }
        cameraView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(s: SurfaceTexture, w: Int, h: Int) { block(s) }
            override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) {}
            override fun onSurfaceTextureDestroyed(s: SurfaceTexture) = true
            override fun onSurfaceTextureUpdated(s: SurfaceTexture) {}
        }
    }

    private fun startStream(ip: String, key: String, height: Int, front: Boolean) {
        if (!hasCamera()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1)
            onStreamState("error", "CamOS needs the camera permission to work as a webcam.", 0, 0)
            return
        }
        stopQr()
        cameraView.visibility = View.VISIBLE
        cameraView.scaleX = if (front) -1f else 1f     // mirror the preview only; the PC gets the true picture
        webView.setBackgroundColor(Color.TRANSPARENT)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        acquireWifiLock()
        withPreview { st -> streamer.start(ip, key, height, front, st) }
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
        @JavascriptInterface fun start(ip: String, key: String, height: Int, front: Boolean) = runOnUiThread { startStream(ip, key, height, front) }
        @JavascriptInterface fun stop() = runOnUiThread { streamer.stop() }
        @JavascriptInterface fun flip() = runOnUiThread {
            withPreview { st -> streamer.flip(st) }
            cameraView.scaleX = if (!streamer.facingFront) 1f else -1f
        }
        @JavascriptInterface fun torch(on: Boolean) = streamer.setTorch(on)
        @JavascriptInterface fun dim(on: Boolean) = runOnUiThread { setDim(on) }
        @JavascriptInterface fun deviceName(): String = (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim()
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
    }
}
