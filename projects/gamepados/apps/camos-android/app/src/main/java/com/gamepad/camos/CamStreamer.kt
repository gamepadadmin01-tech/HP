package com.gamepad.camos

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
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
import android.view.Surface
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

/**
 * The whole picture path on the phone, in one place:
 *
 *   camera (Camera2) ──► the phone's video chip (MediaCodec, H.264) ──► TCP :7780 ──► Gamepad Server
 *              └─────► the preview on screen (a TextureView)
 *
 * New words:
 *  - **Camera2** is Android's direct camera API. One camera can feed two "surfaces" at once: the screen and the
 *    encoder. CameraX (used for QR scanning) cannot feed an encoder surface and a preview together as simply.
 *  - **MediaCodec** is the phone's hardware video compressor. We give it a Surface; the camera draws into it and
 *    out come small H.264 frames, at almost no battery cost.
 *  - The wire protocol (handshake + frames) is documented in pc-server-rs/src/camera/proto.rs; the HMAC here
 *    must stay byte-for-byte the same as `proto::tag` there.
 */
class CamStreamer(
    private val context: Context,
    private val onState: (state: String, message: String, fps: Int, kbps: Int) -> Unit,
) {
    companion object {
        const val PORT = 7780
        private const val TAG = "CamOS"
        private const val FPS = 30

        /** HMAC-SHA256(key, nonce ‖ fixed[0..12] ‖ name), first 16 bytes. Mirrors proto::tag (Rust). */
        fun tag(key: String, nonce: ByteArray, fixed: ByteArray, name: ByteArray): ByteArray {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key.toByteArray(Charsets.US_ASCII), "HmacSHA256"))
            mac.update(nonce)
            mac.update(fixed, 0, 12)
            mac.update(name)
            return mac.doFinal().copyOf(16)
        }

        fun buildHello(key: String, nonce: ByteArray, w: Int, h: Int, fps: Int, deviceName: String): ByteArray {
            val name = deviceName.toByteArray(Charsets.UTF_8).let { if (it.size > 40) it.copyOf(40) else it }
            val fixed = ByteArray(28)
            "CAMC".toByteArray(Charsets.US_ASCII).copyInto(fixed, 0)
            fixed[4] = 1
            fixed[5] = (w shr 8).toByte(); fixed[6] = w.toByte()
            fixed[7] = (h shr 8).toByte(); fixed[8] = h.toByte()
            fixed[9] = fps.toByte()
            fixed[10] = 0
            fixed[11] = name.size.toByte()
            tag(key, nonce, fixed, name).copyInto(fixed, 12)
            return fixed + name
        }
    }

    private class Packet(val data: ByteArray, val ptsUs: Long, val flags: Int)

    private val running = AtomicBoolean(false)
    private var camThread: HandlerThread? = null
    private var camHandler: Handler? = null
    private var camera: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var codec: MediaCodec? = null
    private var encoderSurface: Surface? = null
    private var previewSurface: Surface? = null
    private var socket: Socket? = null
    private val queue = ArrayBlockingQueue<Packet>(45)
    @Volatile private var codecConfig: ByteArray? = null
    @Volatile private var waitForKey = true
    @Volatile private var torchOn = false
    @Volatile var facingFront = false; private set

    private var width = 1280
    private var height = 720
    private var preview: SurfaceTexture? = null

    // Statistics for the "Live · 30 fps" badge.
    @Volatile private var sentFrames = 0
    @Volatile private var sentBytes = 0L

    /** Start streaming. `height` is 480, 720 or 1080 (width follows at 16:9, 640 for 480p). */
    fun start(ip: String, key: String, height: Int, front: Boolean, preview: SurfaceTexture?) {
        if (!running.compareAndSet(false, true)) return
        this.height = height
        this.width = when (height) { 480 -> 640; 1080 -> 1920; else -> 1280 }
        this.facingFront = front
        this.preview = preview
        waitForKey = true
        queue.clear()
        onState("connecting", "Connecting to $ip…", 0, 0)
        Thread({ networkMain(ip, key) }, "camos-net").start()
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        try { socket?.close() } catch (_: Exception) {}
        closeCamera()
        onState("stopped", "", 0, 0)
    }

    fun isRunning() = running.get()

    fun flip(preview: SurfaceTexture?) {
        facingFront = !facingFront
        this.preview = preview
        camHandler?.post {
            closeCameraOnly()
            openCamera()
        }
    }

    fun setTorch(on: Boolean) {
        torchOn = on
        camHandler?.post { repeat() }
    }

    // ───────────────────────── network ─────────────────────────

    private fun networkMain(ip: String, key: String) {
        try {
            val s = Socket()
            s.tcpNoDelay = true
            s.sendBufferSize = 512 * 1024
            s.connect(InetSocketAddress(ip, PORT), 4000)
            s.soTimeout = 5000
            socket = s
            val input = DataInputStream(s.getInputStream())
            val out = DataOutputStream(BufferedOutputStream(s.getOutputStream(), 256 * 1024))

            val hello = ByteArray(21)
            input.readFully(hello, 0, 4)
            // A PC that is already busy answers straight away with "CAMA" + status, without a challenge.
            if (String(hello, 0, 4, Charsets.US_ASCII) == "CAMA") {
                throw Exception(if (input.read() == 2) "Another phone is already streaming to this PC." else "Gamepad Server refused the connection.")
            }
            input.readFully(hello, 4, 17)
            if (String(hello, 0, 4, Charsets.US_ASCII) != "CAMS") throw Exception("This is not Gamepad Server")
            if (hello[4].toInt() != 1) throw Exception("Please update Gamepad Server on your PC")
            val nonce = hello.copyOfRange(5, 21)
            val name = (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim()
            out.write(buildHello(key, nonce, width, height, FPS, name))
            out.flush()
            val ack = ByteArray(5)
            input.readFully(ack)
            when (ack[4].toInt()) {
                0 -> {}
                1 -> throw Exception("Wrong pairing key. Scan the QR code on your PC again.")
                2 -> throw Exception("Another phone is already streaming to this PC.")
                else -> throw Exception("Gamepad Server refused the connection.")
            }
            s.soTimeout = 0

            // Camera + encoder only once the PC has said yes.
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
                out.writeInt(p.data.size)
                out.writeLong(p.ptsUs)
                out.writeByte(p.flags)
                out.write(p.data)
                if (queue.isEmpty()) out.flush()
                sentFrames++
                sentBytes += p.data.size + 13
                val now = System.nanoTime()
                if (now - window >= 1_000_000_000L) {
                    val secs = (now - window) / 1e9
                    onState("live", "", (sentFrames / secs).toInt(), (sentBytes * 8 / 1000 / secs).toInt())
                    sentFrames = 0; sentBytes = 0; window = now
                }
            }
        } catch (e: Exception) {
            if (running.get()) {
                val msg = when (e) {
                    is java.net.SocketTimeoutException -> "Your PC did not answer. Is Gamepad Server open, on the same Wi-Fi?"
                    is java.net.ConnectException -> "Could not reach your PC. Open Gamepad Server and keep both on the same Wi-Fi."
                    else -> e.message ?: "Connection lost."
                }
                fail(msg)
            }
        }
    }

    private fun fail(message: String) {
        if (!running.getAndSet(false)) return
        try { socket?.close() } catch (_: Exception) {}
        closeCamera()
        onState("error", message, 0, 0)
    }

    // ───────────────────────── camera + encoder ─────────────────────────

    private fun startCameraThread() {
        val t = HandlerThread("camos-camera").also { it.start() }
        camThread = t
        camHandler = Handler(t.looper)
        camHandler?.post {
            try {
                startEncoder()
                openCamera()
            } catch (e: Exception) {
                Log.e(TAG, "camera start failed", e)
                fail("Camera failed to start: ${e.message}")
            }
        }
    }

    private fun startEncoder() {
        val bitrate = when (height) { 480 -> 2_000_000; 1080 -> 8_000_000; else -> 4_500_000 }
        val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, FPS)
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
        // Every key frame carries the header in front of it, so the PC can (re)start decoding from any key frame.
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
        val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val wanted = if (facingFront) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
        val id = mgr.cameraIdList.firstOrNull {
            mgr.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == wanted
        } ?: mgr.cameraIdList.first()
        mgr.openCamera(id, object : CameraDevice.StateCallback() {
            override fun onOpened(device: CameraDevice) {
                if (!running.get()) { device.close(); return }
                camera = device
                createSession(device)
            }
            override fun onDisconnected(device: CameraDevice) { device.close(); if (camera == device) camera = null }
            override fun onError(device: CameraDevice, error: Int) {
                device.close()
                fail(if (error == ERROR_CAMERA_IN_USE || error == ERROR_MAX_CAMERAS_IN_USE)
                    "The camera is busy in another app." else "Camera error ($error).")
            }
        }, camHandler)
    }

    private fun createSession(device: CameraDevice) {
        val targets = ArrayList<Surface>()
        encoderSurface?.let { targets.add(it) }
        preview?.let {
            it.setDefaultBufferSize(width, height)
            val s = Surface(it)
            previewSurface = s
            targets.add(s)
        }
        @Suppress("DEPRECATION")
        device.createCaptureSession(targets, object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(s: CameraCaptureSession) {
                session = s
                repeat()
                requestKeyFrame()
            }
            override fun onConfigureFailed(s: CameraCaptureSession) {
                fail("This phone's camera does not support ${height}p streaming. Try a lower quality.")
            }
        }, camHandler)
    }

    private fun repeat() {
        val dev = camera ?: return
        val s = session ?: return
        try {
            val b = dev.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
            encoderSurface?.let { b.addTarget(it) }
            previewSurface?.let { b.addTarget(it) }
            b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(FPS, FPS))
            b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
            b.set(CaptureRequest.FLASH_MODE, if (torchOn && !facingFront) CaptureRequest.FLASH_MODE_TORCH else CaptureRequest.FLASH_MODE_OFF)
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
        try { previewSurface?.release() } catch (_: Exception) {}
        previewSurface = null
    }

    private fun closeCamera() {
        val h = camHandler
        val work = Runnable {
            closeCameraOnly()
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            codec = null
            try { encoderSurface?.release() } catch (_: Exception) {}
            encoderSurface = null
            camThread?.quitSafely()
            camThread = null
            camHandler = null
        }
        if (h != null) h.post(work) else work.run()
    }
}
