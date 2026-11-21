package com.gamepad.camos

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** Everything the user can set. Comes from the UI as JSON (Settings tab + the live camera panel). */
data class CamSettings(
    val quality: Int = 720,          // 480 / 720 / 1080
    val fps: Int = 30,               // 15 / 24 / 30 / 60
    val bitrateKbps: Int = 0,        // 0 = automatic
    val shape: String = "auto",      // auto (as the phone is held when Start is pressed) / landscape / portrait
    val cameraId: String = "",       // "" = the main camera on the chosen side
    val front: Boolean = false,
    val zoom: Float = 1f,
    val focus: String = "auto",      // auto / manual
    val focusDistance: Float = 0f,   // manual focus: 0 = far … 1 = closest the lens can do
    val stabilize: Boolean = true,
    val ev: Int = 0,                 // brightness, in the camera's own exposure steps
    val wb: String = "auto",         // auto / daylight / cloudy / incandescent / fluorescent
    val antiband: String = "auto",   // auto / 50 / 60 / off
    val nr: String = "normal",       // off / normal / strong
    val lowLight: Boolean = false,
    val look: String = "none",       // none / warm / cool / vivid / bw / film (Premium)
    val smooth: Float = 0f,          // face smoothing 0…1 (Premium)
    val watermark: Boolean = true,
    val torch: Boolean = false,
    val mirror: Boolean = true,
) {
    companion object {
        fun from(json: String): CamSettings = try {
            val o = JSONObject(json)
            CamSettings(
                quality = o.optInt("quality", 720), fps = o.optInt("fps", 30), bitrateKbps = o.optInt("bitrate", 0),
                shape = o.optString("shape", "auto"), cameraId = o.optString("cameraId", ""), front = o.optBoolean("front", false),
                zoom = o.optDouble("zoom", 1.0).toFloat(), focus = o.optString("focus", "auto"),
                focusDistance = o.optDouble("focusDistance", 0.0).toFloat(), stabilize = o.optBoolean("stabilize", true),
                ev = o.optInt("ev", 0), wb = o.optString("wb", "auto"), antiband = o.optString("antiband", "auto"),
                nr = o.optString("nr", "normal"), lowLight = o.optBoolean("lowLight", false), look = o.optString("look", "none"),
                smooth = o.optDouble("smooth", 0.0).toFloat(), watermark = o.optBoolean("watermark", true),
                torch = o.optBoolean("torch", false), mirror = o.optBoolean("mirror", true),
            )
        } catch (_: Exception) { CamSettings() }

        val LOOKS = listOf("none", "warm", "cool", "vivid", "bw", "film")
    }
}

/**
 * The whole picture path on the phone, in one place:
 *
 *   camera (Camera2) ──► picture engine (GlPipeline: upright, crop, filters, mark) ──► video chip (H.264) ──► TCP :7780
 *                                                                              └──► the phone screen
 *
 * The wire protocol (handshake + frames) is documented in pc-server-rs/src/camera/proto.rs; the HMAC here must stay
 * byte-for-byte the same as `proto::tag` there.
 */
class CamStreamer(
    private val context: Context,
    private val displayRotation: () -> Int,
    private val onState: (state: String, message: String, fps: Int, kbps: Int) -> Unit,
) {
    companion object {
        const val PORT = 7780
        private const val TAG = "CamOS"

        /** HMAC-SHA256(key, nonce ‖ fixed[0..12] ‖ name), first 16 bytes. Mirrors proto::tag (Rust). */
        fun tag(key: String, nonce: ByteArray, fixed: ByteArray, name: ByteArray): ByteArray {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key.toByteArray(Charsets.US_ASCII), "HmacSHA256"))
            mac.update(nonce)
            mac.update(fixed, 0, 12)
            mac.update(name)
            return mac.doFinal().copyOf(16)
        }

        /** flags bit 0 = "check only" (is this PC ready? no video follows). */
        fun buildHello(key: String, nonce: ByteArray, w: Int, h: Int, fps: Int, deviceName: String, checkOnly: Boolean = false): ByteArray {
            val name = deviceName.toByteArray(Charsets.UTF_8).let { if (it.size > 40) it.copyOf(40) else it }
            val fixed = ByteArray(28)
            "CAMC".toByteArray(Charsets.US_ASCII).copyInto(fixed, 0)
            fixed[4] = 1
            fixed[5] = (w shr 8).toByte(); fixed[6] = w.toByte()
            fixed[7] = (h shr 8).toByte(); fixed[8] = h.toByte()
            fixed[9] = fps.toByte()
            fixed[10] = if (checkOnly) 1 else 0
            fixed[11] = name.size.toByte()
            tag(key, nonce, fixed, name).copyInto(fixed, 12)
            return fixed + name
        }

        fun deviceName() = (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim()

        /** Output size for a quality and shape. 480p is 4:3 (640×480), the others 16:9. */
        fun outputSize(quality: Int, portrait: Boolean): Size {
            val (w, h) = when (quality) { 480 -> 640 to 480; 1080 -> 1920 to 1080; else -> 1280 to 720 }
            return if (portrait) Size(h, w) else Size(w, h)
        }

        fun autoBitrate(quality: Int, fps: Int): Int {
            val base = when (quality) { 480 -> 1_500_000; 1080 -> 8_000_000; else -> 4_000_000 }
            return (base * (0.6 + 0.4 * fps / 30.0)).toInt()
        }
    }

    private class Packet(val data: ByteArray, val ptsUs: Long, val flags: Int)

    private val running = AtomicBoolean(false)
    private var camThread: HandlerThread? = null
    private var camHandler: Handler? = null
    private var camera: CameraDevice? = null
    private var chars: CameraCharacteristics? = null
    private var session: CameraCaptureSession? = null
    private var codec: MediaCodec? = null
    private var encoderSurface: Surface? = null
    private var gl: GlPipeline? = null
    private var camSurface: Surface? = null
    private var socket: Socket? = null
    private val queue = ArrayBlockingQueue<Packet>(45)
    @Volatile private var codecConfig: ByteArray? = null
    @Volatile private var waitForKey = true

    @Volatile var settings = CamSettings(); private set
    @Volatile var portrait = false; private set
    private var out = Size(1280, 720)
    private var cap = Size(1280, 720)
    private var preview: SurfaceTexture? = null
    private var previewW = 0
    private var previewH = 0
    private var bitrate = 4_000_000

    @Volatile private var sentFrames = 0
    @Volatile private var sentBytes = 0L

    val facingFront get() = settings.front

    /** Start streaming with these settings. `portrait` = the picture shape decided by the activity. */
    fun start(ip: String, key: String, s: CamSettings, portrait: Boolean) {
        if (!running.compareAndSet(false, true)) return
        settings = s
        this.portrait = portrait
        out = outputSize(s.quality, portrait)
        bitrate = if (s.bitrateKbps > 0) s.bitrateKbps * 1000 else autoBitrate(s.quality, s.fps)
        waitForKey = true
        queue.clear()
        socket = null
        onState("connecting", "Connecting to $ip…", 0, 0)
        Thread({ networkMain(ip, key) }, "camos-net").start()
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        try { socket?.close() } catch (_: Exception) {}
        closeAll()
        onState("stopped", "", 0, 0)
    }

    fun isRunning() = running.get()

    /** The app is visible again: if Android took the camera away while it was hidden, open it again. */
    fun resumeCamera() {
        if (!running.get()) return
        camHandler?.post { if (camera == null && camSurface != null) openCamera() }
    }

    /** The phone screen preview (may arrive before or after the stream starts). */
    fun setPreview(st: SurfaceTexture?, w: Int, h: Int) {
        preview = st; previewW = w; previewH = h
        gl?.setPreview(st, w, h)
    }

    fun previewResized(w: Int, h: Int) { previewW = w; previewH = h; gl?.previewResized(w, h) }

    /** Change settings while live. Camera and filter settings apply at once; quality / frame rate / bitrate / shape
     *  need a new stream, so the UI only offers those before Start. */
    fun update(s: CamSettings) {
        val old = settings
        settings = s
        applyFilters()
        val h = camHandler ?: return
        if (s.front != old.front || s.cameraId != old.cameraId) h.post { closeCameraOnly(); openCamera() }
        else h.post { repeat() }
    }

    // ───────────────────────── "is my PC ready?" ─────────────────────────

    /** Quick check right after pairing / when the home screen opens. Calls back with a status word + message. */
    fun check(ip: String, key: String, done: (status: String, message: String) -> Unit) {
        Thread({
            var s: Socket? = null
            try {
                s = Socket()
                s.connect(InetSocketAddress(ip, PORT), 2500)
                s.soTimeout = 3000
                val input = DataInputStream(s.getInputStream())
                val hello = ByteArray(21)
                input.readFully(hello, 0, 4)
                if (String(hello, 0, 4, Charsets.US_ASCII) == "CAMA") {
                    if (input.read() == 2) done("busy", "Another phone is streaming to this PC right now.")
                    else done("error", "Gamepad Server refused the check.")
                    return@Thread
                }
                input.readFully(hello, 4, 17)
                if (String(hello, 0, 4, Charsets.US_ASCII) != "CAMS" || hello[4].toInt() != 1) {
                    done("old", "Your PC's Gamepad Server needs updating for CamOS."); return@Thread
                }
                s.getOutputStream().write(buildHello(key, hello.copyOfRange(5, 21), 1280, 720, 30, deviceName(), checkOnly = true))
                val ack = ByteArray(5)
                input.readFully(ack)
                when (ack[4].toInt()) {
                    0 -> done("ready", "")
                    1 -> done("badkey", "The pairing key changed. Scan the QR code on your PC again.")
                    2 -> done("busy", "Another phone is streaming to this PC right now.")
                    else -> done("error", "Gamepad Server refused the check.")
                }
            } catch (e: Exception) {
                // Port 7780 did not answer. A "refused" means the PC is there but nothing listens: an older Gamepad
                // Server. Usually, though, Windows' firewall drops the knock silently, and then "old server" and
                // "PC not on this Wi-Fi" look exactly the same from the phone, so say both. (An older server's own
                // ports only answer packets carrying the pairing key, which would create a virtual pad: not an option.)
                if (e is java.net.ConnectException && (e.message ?: "").contains("refused", true)) done("old", OLD_SERVER)
                else done("unreachable", NO_ANSWER)
            } finally {
                try { s?.close() } catch (_: Exception) {}
            }
        }, "camos-check").start()
    }

    // ───────────────────────── network ─────────────────────────

    private class BusyException : Exception("Another phone is already streaming to this PC.")

    private fun networkMain(ip: String, key: String) {
        try {
            try { connectAndStream(ip, key) }
            catch (e: BusyException) {
                // Usually our own "is my PC ready?" check, still closing on the PC. One quiet retry.
                Thread.sleep(700)
                if (running.get()) connectAndStream(ip, key)
            }
        } catch (e: Exception) {
            if (running.get()) {
                val network = e is java.net.SocketTimeoutException || e is java.net.ConnectException || e is java.net.NoRouteToHostException
                val msg = when {
                    e is java.net.SocketException && !network && socket?.isConnected == true ->
                        "The connection to your PC dropped. Check the Wi-Fi and press Start camera again."
                    e is java.net.ConnectException && (e.message ?: "").contains("refused", true) -> OLD_SERVER
                    network -> NO_ANSWER
                    else -> e.message ?: "Connection lost."
                }
                fail(msg)
            }
        }
    }

    private fun connectAndStream(ip: String, key: String) {
        run {
            val s = Socket()
            s.tcpNoDelay = true
            s.sendBufferSize = 512 * 1024
            s.connect(InetSocketAddress(ip, PORT), 4000)
            s.soTimeout = 5000
            socket = s
            val input = DataInputStream(s.getInputStream())
            val outStream = DataOutputStream(BufferedOutputStream(s.getOutputStream(), 256 * 1024))

            val hello = ByteArray(21)
            input.readFully(hello, 0, 4)
            // A PC that is already busy answers straight away with "CAMA" + status, without a challenge.
            if (String(hello, 0, 4, Charsets.US_ASCII) == "CAMA") {
                if (input.read() == 2) { s.close(); throw BusyException() }
                throw Exception("Gamepad Server refused the connection.")
            }
            input.readFully(hello, 4, 17)
            if (String(hello, 0, 4, Charsets.US_ASCII) != "CAMS") throw Exception("This is not Gamepad Server")
            if (hello[4].toInt() != 1) throw Exception("Please update Gamepad Server on your PC")
            outStream.write(buildHello(key, hello.copyOfRange(5, 21), out.width, out.height, settings.fps, deviceName()))
            outStream.flush()
            val ack = ByteArray(5)
            input.readFully(ack)
            when (ack[4].toInt()) {
                0 -> {}
                1 -> throw Exception("Wrong pairing key. Scan the QR code on your PC again.")
                2 -> { s.close(); throw BusyException() }
                else -> throw Exception("Gamepad Server refused the connection.")
            }
            s.soTimeout = 0

            startCameraThread()

            // Reader: the server asks for a key frame with a single 'K'.
            Thread({
                try {
                    while (running.get()) {
                        val b = input.read()
                        if (b < 0) break
                        if (b == 'K'.code) requestKeyFrame()
                    }
                } catch (_: Exception) {}
                if (running.get()) fail("Gamepad Server closed the connection.")
            }, "camos-net-read").start()

            onState("live", "", 0, 0)
            var window = System.nanoTime()
            while (running.get()) {
                val p = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                outStream.writeInt(p.data.size)
                outStream.writeLong(p.ptsUs)
                outStream.writeByte(p.flags)
                outStream.write(p.data)
                if (queue.isEmpty()) outStream.flush()
                sentFrames++
                sentBytes += p.data.size + 13
                val now = System.nanoTime()
                if (now - window >= 1_000_000_000L) {
                    val secs = (now - window) / 1e9
                    onState("live", "", (sentFrames / secs).roundToInt(), (sentBytes * 8 / 1000 / secs).toInt())
                    sentFrames = 0; sentBytes = 0; window = now
                }
            }
        }
    }

    private val OLD_SERVER = "Your PC is on, but its Gamepad Server has no camera support yet. Install the latest Gamepad Server."
    private val NO_ANSWER = "No answer from your PC. Check that Gamepad Server is open and is the latest version (older ones have no camera part), and that the phone and PC are on the same Wi-Fi."

    private fun fail(message: String) {
        if (!running.getAndSet(false)) return
        try { socket?.close() } catch (_: Exception) {}
        closeAll()
        onState("error", message, 0, 0)
    }

    // ───────────────────────── camera + encoder + picture engine ─────────────────────────

    private fun startCameraThread() {
        val t = HandlerThread("camos-camera").also { it.start() }
        camThread = t
        camHandler = Handler(t.looper)
        camHandler?.post {
            try {
                val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val id = pickCameraId(mgr)
                val ch = mgr.getCameraCharacteristics(id)
                cap = pickCaptureSize(ch)
                startEncoder()
                val pipe = GlPipeline(displayRotation) { fail(it) }
                gl = pipe
                applyFilters()
                val st = pipe.start(out.width, out.height, cap.width, cap.height, encoderSurface!!)
                    ?: return@post
                camSurface = Surface(st)
                preview?.let { pipe.setPreview(it, previewW, previewH) }
                openCamera()
            } catch (e: Exception) {
                Log.e(TAG, "camera start failed", e)
                fail(if (e is MediaCodec.CodecException || e is IllegalArgumentException)
                    "This phone's video chip can't do ${out.width}×${out.height} at ${settings.fps} fps. Try a lower quality or frame rate."
                    else "Camera failed to start: ${e.message}")
            }
        }
    }

    private fun applyFilters() {
        val g = gl ?: return
        val s = settings
        g.front = s.front
        g.look = CamSettings.LOOKS.indexOf(s.look).coerceAtLeast(0)
        g.smooth = s.smooth.coerceIn(0f, 1f)
        g.lowLight = if (s.lowLight) 0.7f else 0f
        g.watermark = s.watermark
        g.mirrorPreview = s.mirror
        g.fpsLimit = s.fps
    }

    private fun pickCameraId(mgr: CameraManager): String {
        val s = settings
        if (s.cameraId.isNotEmpty() && mgr.cameraIdList.contains(s.cameraId)) {
            val f = mgr.getCameraCharacteristics(s.cameraId).get(CameraCharacteristics.LENS_FACING)
            if ((f == CameraCharacteristics.LENS_FACING_FRONT) == s.front) return s.cameraId
        }
        val wanted = if (s.front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
        return mgr.cameraIdList.firstOrNull { mgr.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == wanted }
            ?: mgr.cameraIdList.first()
    }

    /** Camera picture size (in the camera's own sideways frame): same shape as the output, at least as big. */
    private fun pickCaptureSize(ch: CameraCharacteristics): Size {
        val long = max(out.width, out.height)
        val short = minOf(out.width, out.height)
        val want = long.toFloat() / short
        val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(SurfaceTexture::class.java)
            ?: return Size(long, short)
        val sameShape = sizes.filter { abs(it.width.toFloat() / it.height - want) < 0.02f }
        return sameShape.filter { it.width >= long }.minByOrNull { it.width }
            ?: sameShape.maxByOrNull { it.width }
            ?: sizes.filter { it.width >= long }.minByOrNull { it.width * it.height }
            ?: sizes.maxByOrNull { it.width * it.height }!!
    }

    private fun startEncoder() {
        val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, out.width, out.height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, settings.fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            setInteger(MediaFormat.KEY_PRIORITY, 0)          // real-time
            if (Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            // Keep sending frames while the picture is still, so the PC never thinks the phone has gone.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000L)
        }
        val c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        c.setCallback(object : MediaCodec.Callback() {
            override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {}
            override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
                try {
                    val buf = codec.getOutputBuffer(index)
                    if (buf != null && info.size > 0) {
                        buf.position(info.offset); buf.limit(info.offset + info.size)
                        val bytes = ByteArray(info.size); buf.get(bytes)
                        onEncoded(bytes, info)
                    }
                    codec.releaseOutputBuffer(index, false)
                } catch (_: IllegalStateException) {}
            }
            override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) { fail("Video encoder error: ${e.diagnosticInfo}") }
            override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {}
        }, camHandler)
        c.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoderSurface = c.createInputSurface()
        c.start()
        codec = c
    }

    private fun onEncoded(bytes: ByteArray, info: MediaCodec.BufferInfo) {
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
            codecConfig = bytes          // SPS + PPS: the decoder's "how to read this video" header
            return
        }
        val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        if (waitForKey && !key) return
        waitForKey = false
        val data = if (key) (codecConfig ?: ByteArray(0)) + bytes else bytes
        val flags = if (key) 2 else 0
        if (!queue.offer(Packet(data, info.presentationTimeUs, flags))) {
            // Wi-Fi cannot keep up: drop what is queued and restart from a fresh key frame rather than lag behind.
            queue.clear()
            waitForKey = true
            requestKeyFrame()
        }
    }

    private fun requestKeyFrame() {
        try {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: Exception) {}
    }

    @SuppressLint("MissingPermission")
    private fun openCamera() {
        if (!running.get()) return
        val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = pickCameraId(mgr)
        val ch = mgr.getCameraCharacteristics(id)
        chars = ch
        // A different lens may not offer the same picture size; ask for one it does.
        val size = pickCaptureSize(ch)
        if (size != cap) { cap = size; gl?.setCaptureSize(size.width, size.height) }
        gl?.sensorOrientation = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
        gl?.front = ch.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
        mgr.openCamera(id, object : CameraDevice.StateCallback() {
            override fun onOpened(device: CameraDevice) {
                if (!running.get()) { device.close(); return }
                camera = device
                createSession(device)
            }
            override fun onDisconnected(device: CameraDevice) {
                // Android takes the camera away when CamOS goes to the background (no foreground service yet).
                // The stream keeps its connection; resumeCamera() opens the camera again when the app is back.
                device.close()
                if (camera == device) { camera = null; session = null }
            }
            override fun onError(device: CameraDevice, error: Int) {
                device.close()
                fail(if (error == ERROR_CAMERA_IN_USE || error == ERROR_MAX_CAMERAS_IN_USE)
                    "The camera is busy in another app." else "Camera error ($error).")
            }
        }, camHandler)
    }

    private fun createSession(device: CameraDevice) {
        val target = camSurface ?: return
        @Suppress("DEPRECATION")
        device.createCaptureSession(listOf(target), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(s: CameraCaptureSession) {
                session = s
                repeat()
                requestKeyFrame()
            }
            override fun onConfigureFailed(s: CameraCaptureSession) {
                fail("This camera can't stream at this size. Try a lower quality or another lens.")
            }
        }, camHandler)
    }

    /** Apply every camera setting to the running camera. Called on the camera thread. */
    private fun repeat() {
        val dev = camera ?: return
        val s = session ?: return
        val ch = chars ?: return
        val st = settings
        try {
            val b = dev.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
            camSurface?.let { b.addTarget(it) }

            // Frame rate. Low-light lets the camera slow down to 15 fps in the dark for brighter frames.
            val ranges = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
            val want = st.fps
            val range = (if (st.lowLight) ranges.filter { it.upper == want && it.lower <= 15 }.minByOrNull { it.lower } else null)
                ?: ranges.firstOrNull { it.lower == want && it.upper == want }
                ?: ranges.filter { it.upper >= want }.minByOrNull { abs(it.upper - want) * 10 + abs(it.lower - want) }
                ?: ranges.maxByOrNull { it.upper }
            range?.let { b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it) }

            // Zoom.
            if (Build.VERSION.SDK_INT >= 30 && ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) != null) {
                val zr = ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)!!
                b.set(CaptureRequest.CONTROL_ZOOM_RATIO, st.zoom.coerceIn(zr.lower, zr.upper))
            } else {
                val active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
                val maxZ = ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f
                val z = st.zoom.coerceIn(1f, maxZ)
                if (active != null && z > 1f) {
                    val w = (active.width() / z).toInt(); val h = (active.height() / z).toInt()
                    val l = (active.width() - w) / 2; val t = (active.height() - h) / 2
                    b.set(CaptureRequest.SCALER_CROP_REGION, Rect(l, t, l + w, t + h))
                }
            }

            // Focus.
            val afModes = ch.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
            val minFocus = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
            if (st.focus == "manual" && minFocus > 0f) {
                b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                b.set(CaptureRequest.LENS_FOCUS_DISTANCE, st.focusDistance.coerceIn(0f, 1f) * minFocus)
            } else if (afModes.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)) {
                b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
            }

            // Stabilisation (electronic, plus optical where the lens has it).
            val vs = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES) ?: intArrayOf()
            if (vs.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON))
                b.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                    if (st.stabilize) CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON else CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
            val ois = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION) ?: intArrayOf()
            if (ois.contains(CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON))
                b.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
                    if (st.stabilize) CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON else CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_OFF)

            // Brightness.
            val evRange = ch.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)
            if (evRange != null) b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, st.ev.coerceIn(evRange.lower, evRange.upper))

            // White balance.
            val awb = when (st.wb) {
                "daylight" -> CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT
                "cloudy" -> CameraMetadata.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT
                "incandescent" -> CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT
                "fluorescent" -> CameraMetadata.CONTROL_AWB_MODE_FLUORESCENT
                else -> CameraMetadata.CONTROL_AWB_MODE_AUTO
            }
            if ((ch.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES) ?: intArrayOf()).contains(awb)) b.set(CaptureRequest.CONTROL_AWB_MODE, awb)

            // Anti-flicker (match the mains frequency of the room lights: 50 Hz in India and Europe, 60 Hz in the US).
            val ab = when (st.antiband) {
                "50" -> CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_50HZ
                "60" -> CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_60HZ
                "off" -> CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_OFF
                else -> CameraMetadata.CONTROL_AE_ANTIBANDING_MODE_AUTO
            }
            if ((ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_ANTIBANDING_MODES) ?: intArrayOf()).contains(ab)) b.set(CaptureRequest.CONTROL_AE_ANTIBANDING_MODE, ab)

            // Noise reduction.
            val nr = when (st.nr) {
                "off" -> CameraMetadata.NOISE_REDUCTION_MODE_OFF
                "strong" -> CameraMetadata.NOISE_REDUCTION_MODE_HIGH_QUALITY
                else -> CameraMetadata.NOISE_REDUCTION_MODE_FAST
            }
            if ((ch.get(CameraCharacteristics.NOISE_REDUCTION_AVAILABLE_NOISE_REDUCTION_MODES) ?: intArrayOf()).contains(nr)) b.set(CaptureRequest.NOISE_REDUCTION_MODE, nr)

            // Flashlight (back camera only).
            val hasFlash = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            b.set(CaptureRequest.FLASH_MODE, if (st.torch && hasFlash) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF)

            s.setRepeatingRequest(b.build(), null, camHandler)
        } catch (e: Exception) {
            Log.w(TAG, "repeat failed", e)
        }
    }

    private fun closeCameraOnly() {
        try { session?.close() } catch (_: Exception) {}
        session = null
        try { camera?.close() } catch (_: Exception) {}
        camera = null
    }

    private fun closeAll() {
        val h = camHandler
        val work = Runnable {
            closeCameraOnly()
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            codec = null
            try { gl?.release() } catch (_: Exception) {}
            gl = null
            try { camSurface?.release() } catch (_: Exception) {}
            camSurface = null
            try { encoderSurface?.release() } catch (_: Exception) {}
            encoderSurface = null
            camThread?.quitSafely()
            camThread = null
            camHandler = null
        }
        if (h != null) h.post(work) else work.run()
    }
}

/**
 * What this phone's cameras can do, for the Settings screen: every lens, its zoom range, brightness range, whether it
 * has a flashlight / manual focus / stabilisation, and which frame rates it supports.
 */
object CameraCatalog {
    fun describe(context: Context): String {
        val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val list = JSONArray()
        val infos = mgr.cameraIdList.mapNotNull { id -> try { id to mgr.getCameraCharacteristics(id) } catch (_: Exception) { null } }
        val mainBackFocal = infos.firstOrNull { it.second.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK }
            ?.second?.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: 0f
        var backN = 0
        for ((id, ch) in infos) {
            val facing = ch.get(CameraCharacteristics.LENS_FACING)
            if (facing != CameraCharacteristics.LENS_FACING_BACK && facing != CameraCharacteristics.LENS_FACING_FRONT) continue
            val front = facing == CameraCharacteristics.LENS_FACING_FRONT
            val focal = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: 0f
            val label = if (front) "Front" else {
                backN++
                when {
                    backN == 1 -> "Back · main"
                    mainBackFocal > 0 && focal < mainBackFocal * 0.75f -> "Back · ultra-wide"
                    mainBackFocal > 0 && focal > mainBackFocal * 1.5f -> "Back · telephoto"
                    else -> "Back · lens $backN"
                }
            }
            val zr: Range<Float> = if (Build.VERSION.SDK_INT >= 30 && ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) != null)
                ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)!!
                else Range(1f, ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM) ?: 1f)
            val ev = ch.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE) ?: Range(0, 0)
            val evStep = ch.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.toFloat() ?: 0f
            val fpsRanges = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
            val fpsList = JSONArray()
            for (f in listOf(15, 24, 30, 60)) if (fpsRanges.any { it.upper >= f && it.lower <= f }) fpsList.put(f)
            val vs = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES) ?: intArrayOf()
            val ois = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION) ?: intArrayOf()
            list.put(JSONObject()
                .put("id", id).put("front", front).put("label", label)
                .put("zoomMin", zr.lower.toDouble()).put("zoomMax", minOf(zr.upper, 10f).toDouble())
                .put("evMin", ev.lower).put("evMax", ev.upper).put("evStep", evStep.toDouble())
                .put("flash", ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true)
                .put("manualFocus", (ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f) > 0f)
                .put("stabilize", vs.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON) || ois.contains(CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON))
                .put("fps", fpsList))
        }
        return list.toString()
    }
}
