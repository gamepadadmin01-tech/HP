package com.gamepad.camos

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
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
    val udp: Boolean = true,         // smooth Wi-Fi mode (UdpLink.kt); the USB cable always uses TCP
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
                udp = o.optBoolean("udp", true),
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
        /** A stream message that carries this phone's state for the PC window, not video (proto::FLAG_STATE). */
        const val FLAG_STATE = 8
        /** Smooth Wi-Fi mode: an empty "still here" message on TCP once a second (proto::FLAG_PING). */
        const val FLAG_PING = 16
        private const val TAG = "CamOS"

        /** HMAC-SHA256(key, nonce ‖ fixed[0..12] ‖ name), first 16 bytes. Mirrors proto::tag (Rust). */
        fun tag(key: String, nonce: ByteArray, fixed: ByteArray, name: ByteArray): ByteArray {
            // No key = a phone on the USB cable, which needs none (the PC accepts that only from the cable). Android's
            // HMAC refuses an empty key outright ("Empty key"), which used to abort every USB connection before the
            // phone said hello; the PC showed "hello: failed to fill whole buffer", the phone "PC not answering".
            if (key.isEmpty()) return ByteArray(16)
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key.toByteArray(Charsets.US_ASCII), "HmacSHA256"))
            mac.update(nonce)
            mac.update(fixed, 0, 12)
            mac.update(name)
            return mac.doFinal().copyOf(16)
        }

        /** flags bit 0 = "check only" (is this PC ready? no video follows); bit 1 = "I can send the video over UDP". */
        fun buildHello(key: String, nonce: ByteArray, w: Int, h: Int, fps: Int, deviceName: String, checkOnly: Boolean = false, udp: Boolean = false): ByteArray {
            val name = deviceName.toByteArray(Charsets.UTF_8).let { if (it.size > 40) it.copyOf(40) else it }
            val fixed = ByteArray(28)
            "CAMC".toByteArray(Charsets.US_ASCII).copyInto(fixed, 0)
            fixed[4] = 1
            fixed[5] = (w shr 8).toByte(); fixed[6] = w.toByte()
            fixed[7] = (h shr 8).toByte(); fixed[8] = h.toByte()
            fixed[9] = fps.toByte()
            fixed[10] = ((if (checkOnly) 1 else 0) or (if (udp) 2 else 0)).toByte()
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

        /** Starting bitrate. Lower than before (1080p was 8 Mbit/s, more than many home Wi-Fi links carry steadily);
         *  the adaptive control below lowers it further when Wi-Fi struggles and climbs back when it is healthy. */
        fun autoBitrate(quality: Int, fps: Int): Int {
            val base = when (quality) { 480 -> 1_200_000; 1080 -> 5_000_000; else -> 3_000_000 }
            return (base * (0.5 + 0.5 * fps / 30.0)).toInt()
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
    /** 60 fps on phones that only film that fast in Android's "high-speed video" camera mode. */
    @Volatile private var highSpeed = false
    private var hsRange: Range<Int>? = null

    // ── "Is the camera really giving 60?" (owner, 2026-11-23: phone and PC both showed 30 at 60 fps) ──
    /** The regular mode was measured short of 60: use the high-speed mode for the rest of this stream. */
    @Volatile private var preferHighSpeed = false
    /** Frame-rate range the camera was last asked for, electronic stabilisation on/off: for the PC log. */
    @Volatile private var aeRange: Range<Int>? = null
    @Volatile private var eisOn = false
    /** What the camera delivered in the last second, and what was sent. */
    @Volatile private var camFps = 0
    @Volatile private var sentFps = 0
    private var lastCamFrames = 0
    private var lowCamSeconds = 0
    /** The UI's last state message, re-sent every 2 s with the camera facts added (see sendState). */
    @Volatile private var lastUiState: String? = null
    private var lastStateResend = 0L

    /** One line for the PC's camos.log: which camera mode, size, range, and what it really gives. */
    private fun camLine(): String =
        "${if (highSpeed) "high-speed" else "regular"} mode ${cap.width}x${cap.height}, asked " +
            "${aeRange?.let { "${it.lower}-${it.upper}" } ?: "?"} fps (want ${settings.fps}), camera gives $camFps fps, " +
            "sends $sentFps fps, electronic stabilisation ${if (eisOn) "on" else "off"}"

    /**
     * Called once a second while streaming. Asked for 60 but the camera gives under 45 for 3 seconds in the regular
     * mode: many phones (Xiaomi, MediaTek) offer "30 to 60" and then pick 30 indoors for more light. Their
     * high-speed video mode runs at a fixed 60/120, so switch to it if the camera has one.
     */
    private fun fpsDoctor() {
        if (settings.fps < 60 || highSpeed || preferHighSpeed) { lowCamSeconds = 0; return }
        if (camFps !in 1..44) { lowCamSeconds = 0; return }
        if (++lowCamSeconds < 3) return
        val ch = chars ?: return
        if (highSpeedPlan(ch, max(out.width, out.height), minOf(out.width, out.height)) == null) {
            Log.i(TAG, "camera gives $camFps fps at 60 and has no high-speed mode")
            lowCamSeconds = Int.MIN_VALUE / 2   // don't keep checking
            return
        }
        Log.i(TAG, "camera gives $camFps fps in the regular mode at 60: switching to its high-speed mode")
        preferHighSpeed = true
        camHandler?.post { if (running.get()) { closeCameraOnly(); openCamera() } }
    }
    @Volatile var portrait = false; private set
    private var out = Size(1280, 720)
    private var cap = Size(1280, 720)
    private var preview: SurfaceTexture? = null
    private var previewW = 0
    private var previewH = 0
    private var bitrate = 4_000_000          // the ceiling: the user's choice or the automatic starting level
    @Volatile private var curBitrate = 0     // what the video chip is told right now (adaptive)
    @Volatile private var lastKeyAsk = 0L
    private var calmSince = 0L

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
        curBitrate = bitrate
        lastKeyAsk = 0L
        waitForKey = true
        linked = false
        udpBlocked = false
        preferHighSpeed = false
        lowCamSeconds = 0
        lastCamFrames = 0
        camFps = 0
        aeRange = null
        queue.clear()
        socket = null
        onState("connecting", "Connecting to $ip…", 0, 0)
        Thread({ networkMain(ip, key) }, "camos-net").start()
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        linked = false
        closeUdp()
        try { socket?.close() } catch (_: Exception) {}
        closeAll()
        onState("stopped", "", 0, 0)
    }

    fun isRunning() = running.get()

    /** The app is visible again: if Android took the camera away while it was hidden, open it again. */
    /** Requests from the PC window (JSON). Set by the activity; called on the network thread. */
    @Volatile var onRemote: ((String) -> Unit)? = null

    /** Tell the PC window what is set and what this phone's plan allows (a small JSON message in the stream). */
    fun sendState(json: String) {
        lastUiState = json
        if (!running.get() || !linked) return
        // The camera facts ride along ("cam"): the PC writes them to camos.log, so a frame-rate problem can be
        // read there afterwards. Older PC servers ignore the extra field.
        val merged = try { JSONObject(json).put("cam", camLine()).toString() } catch (_: Exception) { json }
        val b = merged.toByteArray(Charsets.UTF_8)
        if (b.size > 16 * 1024) return
        queue.offer(Packet(b, 0, FLAG_STATE))
    }

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

    // ───────────────────────── "where is my PC?" ─────────────────────────

    /**
     * Find Gamepad Server without knowing its address: a short UDP broadcast on port 7780 that only Gamepad Server
     * answers (proto.rs "Finding the PC"). With `key` it proves the pairing key, so the PC answers on Wi-Fi too (its
     * address may have changed); without a key only a PC on the USB cable answers. `usbOnly` = only ask on the USB
     * cable (tethering), after first trying the USB-debugging tunnel (127.0.0.1). Calls back with the PC's address
     * and name, or null.
     */
    fun find(key: String?, usbOnly: Boolean, done: (ip: String?, name: String, via: String) -> Unit) {
        Thread({
            // 1. USB debugging: Gamepad Server keeps "adb reverse tcp:7780" open, so the PC is at 127.0.0.1.
            if (usbOnly) {
                try {
                    Socket().use { s ->
                        s.connect(InetSocketAddress("127.0.0.1", PORT), 700)
                        s.soTimeout = 1500
                        val b = ByteArray(4)
                        DataInputStream(s.getInputStream()).readFully(b)
                        if (String(b, Charsets.US_ASCII) == "CAMS") { done("127.0.0.1", "PC (USB debugging)", "usb"); return@Thread }
                    }
                } catch (_: Exception) {}
            }
            // 2. Broadcast on each network the phone has (the USB-tether one only, for usbOnly).
            var sock: java.net.DatagramSocket? = null
            try {
                sock = java.net.DatagramSocket().apply { broadcast = true; soTimeout = 300 }
                val nonce = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
                val pkt = ByteArray(37)
                "CAMD".toByteArray(Charsets.US_ASCII).copyInto(pkt, 0)
                pkt[4] = 1
                nonce.copyInto(pkt, 5)
                if (!key.isNullOrEmpty()) {
                    val mac = Mac.getInstance("HmacSHA256")
                    mac.init(SecretKeySpec(key.toByteArray(Charsets.US_ASCII), "HmacSHA256"))
                    mac.update("CAMD".toByteArray(Charsets.US_ASCII)); mac.update(nonce)
                    mac.doFinal().copyOf(16).copyInto(pkt, 21)
                }
                val targets = ArrayList<java.net.InetAddress>()
                for (ni in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces() ?: return@Thread done(null, "", "none"))) {
                    if (!ni.isUp || ni.isLoopback) continue
                    val cable = ni.name.startsWith("rndis") || ni.name.startsWith("usb") || ni.name.startsWith("ncm")
                    if (usbOnly && !cable) continue
                    for (ia in ni.interfaceAddresses) ia.broadcast?.let { targets.add(it) }
                }
                if (!usbOnly) targets.add(java.net.InetAddress.getByName("255.255.255.255"))
                val deadline = System.currentTimeMillis() + 1800
                val buf = ByteArray(128)
                var nextSend = 0L
                while (System.currentTimeMillis() < deadline) {
                    if (System.currentTimeMillis() >= nextSend) {   // ask three times (Wi-Fi drops broadcasts now and then)
                        for (t in targets) try { sock.send(java.net.DatagramPacket(pkt, pkt.size, t, PORT)) } catch (_: Exception) {}
                        nextSend = System.currentTimeMillis() + 600
                    }
                    val r = java.net.DatagramPacket(buf, buf.size)
                    try { sock.receive(r) } catch (_: java.net.SocketTimeoutException) { continue }
                    val d = r.data
                    if (r.length >= 24 && String(d, 0, 4, Charsets.US_ASCII) == "CAMR" && d.copyOfRange(5, 21).contentEquals(nonce)) {
                        val nameLen = d[23].toInt() and 0xff
                        val name = if (24 + nameLen <= r.length) String(d, 24, nameLen, Charsets.UTF_8) else "PC"
                        done(r.address.hostAddress, name, if (usbOnly) "usb" else "wifi")
                        return@Thread
                    }
                }
                done(null, "", "none")
            } catch (_: Exception) {
                done(null, "", "none")
            } finally {
                try { sock?.close() } catch (_: Exception) {}
            }
        }, "camos-find").start()
    }

    // ───────────────────────── "is my PC ready?" ─────────────────────────

    /** Quick check right after pairing / when the home screen opens. Calls back with a status word + message. */
    fun check(ip: String, key: String, done: (status: String, message: String) -> Unit) {
        Thread({
            var s: Socket? = null
            try {
                s = Socket()
                bindToPcNetwork(s, ip)
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
                    1 -> done("badkey", "Pairing changed. Scan the QR code again.")
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
    /** Refusals that a retry cannot fix (wrong key, not our server): stop and say why. */
    private class FatalLinkException(message: String) : Exception(message)

    /**
     * Connect, stream, and — once the stream has been live — come back by itself after a network hiccup (owner,
     * 2026-11-23: "the PC server keeps on disconnecting" on campus Wi-Fi). The camera and video chip stay on while
     * the connection is re-made, so a drop is a short freeze on the PC instead of being thrown back to the home
     * screen. Gives up after 30 seconds without a connection.
     */
    private fun networkMain(ip: String, key: String) {
        var wasLive = false
        var busyRetried = false
        var downSince = 0L
        while (running.get()) {
            try {
                connectAndStream(ip, key) { wasLive = true; downSince = 0L }
                return   // returns normally only after stop()
            } catch (e: Exception) {
                linked = false
                closeUdp()
                try { socket?.close() } catch (_: Exception) {}
                if (!running.get()) return
                if (e is UdpBlockedException) {
                    // Not a drop: switch to the normal (TCP) way at once, no 30-second countdown.
                    onState("connecting", "This Wi-Fi blocks smooth mode. Switching to normal mode…", 0, 0)
                    downSince = 0L
                    continue
                }
                Log.w(TAG, "link lost (${e.javaClass.simpleName}: ${e.message})")
                if (!wasLive) {
                    // Never got going: a busy answer is usually our own "is my PC ready?" check still closing on the
                    // PC (one quiet retry); anything else is reported at once, as before.
                    if (e is BusyException && !busyRetried) { busyRetried = true; Thread.sleep(700); continue }
                    fail(firstConnectMessage(e)); return
                }
                if (e is FatalLinkException) { fail(e.message ?: "Gamepad Server refused the connection."); return }
                val now = android.os.SystemClock.elapsedRealtime()
                if (downSince == 0L) downSince = now
                if (now - downSince > 30_000) {
                    fail("Lost the connection to your PC for 30 seconds. Check the Wi-Fi and press Start camera again."); return
                }
                onState("connecting", "Connection dropped. Reconnecting…", 0, 0)
                Thread.sleep(700)
            }
        }
    }

    private fun firstConnectMessage(e: Exception): String {
        val network = e is java.net.SocketTimeoutException || e is java.net.ConnectException || e is java.net.NoRouteToHostException
        return when {
            e is FatalLinkException -> e.message ?: "Gamepad Server refused the connection."
            e is BusyException -> e.message ?: "Another phone is already streaming to this PC."
            e is java.net.ConnectException && (e.message ?: "").contains("refused", true) -> OLD_SERVER
            network -> NO_ANSWER
            else -> e.message ?: "Connection lost."
        }
    }

    /** True while a connection is up and taking frames. While it is down, frames are not queued (so a drop doesn't
     *  overflow the queue and halve the picture quality), and the next frame sent is a full picture. */
    @Volatile private var linked = false
    /** When the current write to the PC began (0 = not writing). A write stuck this long means the link is dead. */
    @Volatile private var writeSince = 0L

    /**
     * Send this socket over the network the PC is on (the Wi-Fi, or the USB cable). Without it, Android uses its
     * "default" network: on a campus/hotel Wi-Fi it considers "no internet", that is mobile data, and the PC can't be
     * reached from there.
     */
    private fun bindToPcNetwork(s: Socket, ip: String) {
        try { pcNetwork(ip)?.bindSocket(s) } catch (e: Exception) { Log.w(TAG, "bind to PC network: ${e.message}") }
    }

    private fun bindToPcNetwork(s: java.net.DatagramSocket, ip: String) {
        try { pcNetwork(ip)?.bindSocket(s) } catch (e: Exception) { Log.w(TAG, "bind UDP to PC network: ${e.message}") }
    }

    /** The network (Wi-Fi, USB tether) whose address range holds the PC's address; null for 127.0.0.1 (adb). */
    private fun pcNetwork(ip: String): android.net.Network? {
        val target = java.net.InetAddress.getByName(ip)
        if (target.isLoopbackAddress) return null   // USB debugging (adb tunnel)
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        @Suppress("DEPRECATION")
        for (n in cm.allNetworks) {
            val lp = cm.getLinkProperties(n) ?: continue
            if (lp.linkAddresses.any { sameSubnet(it.address, it.prefixLength, target) }) return n
        }
        return null
    }

    // ── Smooth Wi-Fi mode (UdpLink.kt) ──
    /** The video's UDP path for the current connection, or null (TCP: the USB cable, an older PC, or blocked). */
    @Volatile private var udp: UdpLink? = null
    /** This Wi-Fi didn't carry our UDP packets: stay on TCP until the next Start. */
    @Volatile private var udpBlocked = false
    private var udpFrame = 0
    @Volatile private var lastDown = 0L

    private fun closeUdp() {
        udp?.close()
        udp = null
    }

    /**
     * Quality from the PC's twice-a-second report (what video calls do): clear losses step the bitrate down at once
     * (at most once a second, the report needs time to show the effect); two clean seconds step it back up 15 %.
     * Light, random loss is left to the resends and doesn't lower the quality.
     */
    private fun onUdpReport(received: Int, lost: Int, skipped: Int) {
        val total = received + lost
        if (total <= 0) return
        val ratio = lost.toDouble() / total
        val now = android.os.SystemClock.elapsedRealtime()
        when {
            skipped > 0 || ratio > 0.10 -> if (now - lastDown >= 1000) { setBitrate(curBitrate * 7 / 10); lastDown = now; calmSince = now }
            ratio > 0.03 -> if (now - lastDown >= 1000) { setBitrate(curBitrate * 85 / 100); lastDown = now; calmSince = now }
            ratio < 0.01 -> if (now - calmSince >= 2000) { setBitrate(curBitrate * 115 / 100); calmSince = now }
            else -> calmSince = now
        }
    }

    private fun sameSubnet(a: java.net.InetAddress, prefix: Int, b: java.net.InetAddress): Boolean {
        val x = a.address; val y = b.address
        if (x.size != y.size || prefix <= 0) return false
        var bits = prefix
        for (i in x.indices) {
            if (bits <= 0) return true
            val mask = if (bits >= 8) 0xff else (0xff shl (8 - bits)) and 0xff
            if ((x[i].toInt() and mask) != (y[i].toInt() and mask)) return false
            bits -= 8
        }
        return true
    }

    private fun connectAndStream(ip: String, key: String, onLive: () -> Unit) {
        run {
            val s = Socket()
            s.tcpNoDelay = true
            s.sendBufferSize = 128 * 1024
            bindToPcNetwork(s, ip)
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
                throw FatalLinkException("Gamepad Server refused the connection.")
            }
            input.readFully(hello, 4, 17)
            if (String(hello, 0, 4, Charsets.US_ASCII) != "CAMS") throw FatalLinkException("This is not Gamepad Server")
            if (hello[4].toInt() != 1) throw FatalLinkException("Please update Gamepad Server on your PC")
            // Ask for smooth Wi-Fi mode unless it is switched off, already failed on this Wi-Fi, or this is the adb
            // cable (127.0.0.1 can't carry UDP). The PC says no for a USB-tether cable too.
            val wantUdp = settings.udp && !udpBlocked && !java.net.InetAddress.getByName(ip).isLoopbackAddress
            outStream.write(buildHello(key, hello.copyOfRange(5, 21), out.width, out.height, settings.fps, deviceName(), udp = wantUdp))
            outStream.flush()
            val ack = ByteArray(5)
            input.readFully(ack)
            when (ack[4].toInt()) {
                0 -> {}
                1 -> throw FatalLinkException("Wrong pairing key. Scan the QR code on your PC again.")
                2 -> { s.close(); throw BusyException() }
                else -> throw FatalLinkException("Gamepad Server refused the connection.")
            }
            closeUdp()
            if (wantUdp) {
                val g = ByteArray(15)
                input.readFully(g)
                if (String(g, 0, 4, Charsets.US_ASCII) != "CAMU") throw FatalLinkException("Please update Gamepad Server on your PC")
                if (g[4].toInt() == 1) {
                    val port = ((g[5].toInt() and 0xff) shl 8) or (g[6].toInt() and 0xff)
                    val ds = java.net.DatagramSocket()
                    bindToPcNetwork(ds, ip)
                    ds.sendBufferSize = 1 shl 20
                    ds.connect(InetSocketAddress(ip, port))
                    udp = UdpLink(ds, g.copyOfRange(7, 15)) { r, l, sk -> onUdpReport(r, l, sk) }
                    udpFrame = 0
                    Log.i(TAG, "smooth Wi-Fi mode: video over UDP to port $port")
                }
            }
            val link = udp
            val linkSince = android.os.SystemClock.elapsedRealtime()
            var lastPing = 0L
            s.soTimeout = 0

            // The camera starts with the first connection and stays on through reconnects.
            if (camThread == null) startCameraThread()
            queue.clear()
            waitForKey = true
            lastKeyAsk = 0L
            // A drop may have pushed the quality right down; start the new connection from a sensible level.
            setBitrate(max(curBitrate, bitrate * 2 / 3))
            linked = true
            requestKeyFrame()

            // Watchdog: a write that hasn't finished in 4 seconds means the Wi-Fi link is dead even though Android
            // hasn't noticed yet (it can take minutes). Closing the socket makes the sender fail and reconnect.
            Thread({
                while (running.get() && socket === s && !s.isClosed) {
                    try { Thread.sleep(500) } catch (_: InterruptedException) { break }
                    val since = writeSince
                    if (since != 0L && android.os.SystemClock.elapsedRealtime() - since > 4000) {
                        Log.w(TAG, "write stuck for 4 s: reconnecting")
                        try { s.close() } catch (_: Exception) {}
                    }
                }
            }, "camos-net-watch").start()

            // Reader: the server asks for a key frame with a single 'K', and the PC window sends requests as
            // 'C' + length + JSON ("zoom 2x"). Requests go to the UI, which applies them only if this phone's plan
            // allows (the PC never decides).
            Thread({
                try {
                    while (running.get()) {
                        val b = input.read()
                        if (b < 0) break
                        when (b) {
                            'K'.code -> requestKeyFrame()
                            'C'.code -> {
                                val len = input.readUnsignedShort()
                                if (len <= 0 || len > 16 * 1024) break   // not our protocol: stop reading
                                val msg = ByteArray(len)
                                input.readFully(msg)
                                onRemote?.invoke(String(msg, Charsets.UTF_8))
                            }
                        }
                    }
                } catch (_: Exception) {}
                // The PC closed this connection (or it broke): close it here too, so the sender notices and the
                // stream reconnects instead of ending.
                if (socket === s) try { s.close() } catch (_: Exception) {}
            }, "camos-net-read").start()

            onState("live", "", 0, 0)
            onLive()
            var window = System.nanoTime()
            var lastAdapt = System.nanoTime()
            calmSince = android.os.SystemClock.elapsedRealtime()
            while (running.get()) {
                if (s.isClosed) throw java.net.SocketException("connection closed")
                if (System.nanoTime() - lastAdapt >= 500_000_000L) { adaptBitrate(); lastAdapt = System.nanoTime() }
                if (link != null) {
                    val t = android.os.SystemClock.elapsedRealtime()
                    // No report from the PC within 3 s: this Wi-Fi doesn't carry our UDP packets (some campus and
                    // office networks block it). Go back to TCP for the rest of this stream.
                    if (link.lastReportAt == 0L && t - linkSince > 3000) { udpBlocked = true; throw UdpBlockedException() }
                    if (link.lastReportAt != 0L && t - link.lastReportAt > 6000) throw java.net.SocketException("no reports over UDP for 6 s")
                    // "Still here" on TCP once a second: in UDP mode no video travels on the TCP connection.
                    if (t - lastPing >= 1000) {
                        lastPing = t
                        writeSince = t
                        try {
                            outStream.writeInt(1); outStream.writeLong(0); outStream.writeByte(FLAG_PING); outStream.writeByte(0)
                            outStream.flush()
                        } finally { writeSince = 0L }
                    }
                }
                val p = queue.poll(if (link != null) 250 else 500, TimeUnit.MILLISECONDS) ?: continue
                if (link != null && p.flags and FLAG_STATE == 0) {
                    // Video over UDP; pieces are spread out at 4× the current bitrate.
                    link.sendFrame(udpFrame++, p.flags and 2 != 0, p.ptsUs, p.data, curBitrate * 4)
                } else {
                    writeSince = android.os.SystemClock.elapsedRealtime()
                    try {
                        outStream.writeInt(p.data.size)
                        outStream.writeLong(p.ptsUs)
                        outStream.writeByte(p.flags)
                        outStream.write(p.data)
                        if (queue.isEmpty()) outStream.flush()
                    } finally { writeSince = 0L }
                }
                if (p.flags and FLAG_STATE == 0) sentFrames++
                sentBytes += p.data.size + 13
                val now = System.nanoTime()
                if (now - window >= 1_000_000_000L) {
                    val secs = (now - window) / 1e9
                    val frames = gl?.camFrames ?: 0
                    camFps = ((frames - lastCamFrames) / secs).roundToInt().coerceAtLeast(0)
                    lastCamFrames = frames
                    sentFps = (sentFrames / secs).roundToInt()
                    fpsDoctor()
                    val t = android.os.SystemClock.elapsedRealtime()
                    if (t - lastStateResend >= 2000) { lastStateResend = t; lastUiState?.let { sendState(it) } }
                    onState("live", "", (sentFrames / secs).roundToInt(), (sentBytes * 8 / 1000 / secs).toInt())
                    sentFrames = 0; sentBytes = 0; window = now
                }
            }
        }
    }

    private val OLD_SERVER = "Your Gamepad Server is too old for CamOS. Install the latest one."
    private val NO_ANSWER = "No answer. Open the latest Gamepad Server, use the same Wi-Fi, and turn off any VPN on the PC."

    private class UdpBlockedException : java.net.SocketException("this Wi-Fi doesn't carry UDP")

    private fun fail(message: String) {
        if (!running.getAndSet(false)) return
        linked = false
        closeUdp()
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
                cap = planCapture(ch)
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

    /**
     * Decide how this camera will run, and at what picture size. Normally that is the regular video mode. For 60 fps
     * on a camera whose regular mode stops at 30, Android's "constrained high-speed" mode is used instead: it only
     * offers a few fixed sizes, so the picture size comes from that list.
     */
    private fun planCapture(ch: CameraCharacteristics): Size {
        highSpeed = false
        hsRange = null
        if (settings.fps >= 60) {
            // 1. Regular video mode, but only at a picture size the camera can really deliver 60 times a second.
            //    (Phones list "60 fps" for the camera as a whole; at big sizes they still give 30. Asking for 60 at
            //    such a size is what made 60 fps "not work".) Skipped once the camera was measured giving less than
            //    60 in this mode (preferHighSpeed, see fpsDoctor).
            val regular = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
            if (!preferHighSpeed && regular.any { it.upper >= 60 && it.lower <= 60 }) {
                pickCaptureSize(ch, minFps = 60)?.let { return it }
            }
            // 2. Android's high-speed video mode (often listed as 120 fps; the picture engine keeps every 2nd frame).
            highSpeedPlan(ch, max(out.width, out.height), minOf(out.width, out.height))?.let { (range, size) ->
                highSpeed = true
                hsRange = range
                return size
            }
            // 3. High-speed mode was preferred but isn't there after all: back to the regular mode.
            if (preferHighSpeed) {
                val regular = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
                if (regular.any { it.upper >= 60 && it.lower <= 60 }) pickCaptureSize(ch, minFps = 60)?.let { return it }
            }
            // 4. This camera can't do 60: stream at its best (30); the app tells the user.
        }
        return pickCaptureSize(ch) ?: Size(max(out.width, out.height), minOf(out.width, out.height))
    }

    private fun highSpeedPlan(ch: CameraCharacteristics, long: Int, short: Int): Pair<Range<Int>, Size>? = try {
        val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
        if (map == null || !caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO)) null
        else {
            val want = long.toFloat() / short
            // The slowest range that reaches 60 (60 before 120 before 240), steady ranges first.
            val ranges = map.highSpeedVideoFpsRanges.filter { it.upper >= 60 }
                .sortedWith(compareBy<Range<Int>> { it.upper }.thenByDescending { it.lower })
            ranges.firstNotNullOfOrNull { r ->
                val sizes = map.getHighSpeedVideoSizesFor(r).toList()
                val same = sizes.filter { abs(it.width.toFloat() / it.height - want) < 0.02f }
                val pick = same.filter { it.width >= long }.minByOrNull { it.width } ?: same.maxByOrNull { it.width }
                    ?: sizes.maxByOrNull { it.width * it.height }
                pick?.let { r to it }
            }
        }
    } catch (_: Exception) { null }

    /**
     * Camera picture size (in the camera's own sideways frame): same shape as the output, at least as big. With
     * `minFps`, only sizes the camera can deliver that often (its minimum frame time); null if there is none.
     */
    private fun pickCaptureSize(ch: CameraCharacteristics, minFps: Int = 0): Size? {
        val long = max(out.width, out.height)
        val short = minOf(out.width, out.height)
        val want = long.toFloat() / short
        val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return Size(long, short)
        var sizes = map.getOutputSizes(SurfaceTexture::class.java)?.toList() ?: return Size(long, short)
        if (minFps > 0) {
            val maxFrameNs = 1_000_000_000L / minFps + 500_000L   // a little slack for 59.94-style timings
            sizes = sizes.filter { sz -> try { map.getOutputMinFrameDuration(SurfaceTexture::class.java, sz) in 1..maxFrameNs } catch (_: Exception) { false } }
            if (sizes.isEmpty()) return null
        }
        val sameShape = sizes.filter { abs(it.width.toFloat() / it.height - want) < 0.02f }
        return sameShape.filter { it.width >= long }.minByOrNull { it.width }
            ?: sameShape.maxByOrNull { it.width }
            ?: sizes.filter { it.width >= long }.minByOrNull { it.width * it.height }
            ?: sizes.maxByOrNull { it.width * it.height }
    }

    private fun startEncoder() {
        val c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val cbr = try {
            c.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).encoderCapabilities
                .isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
        } catch (_: Exception) { false }
        val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, out.width, out.height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, curBitrate)
            if (cbr) setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
            setInteger(MediaFormat.KEY_FRAME_RATE, settings.fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            setInteger(MediaFormat.KEY_PRIORITY, 0)          // real-time
            if (Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            // No reordered frames: some phone video chips hold pictures back to compress better (B-frames), which
            // adds delay and makes the PC show frames unevenly. A webcam needs every picture out at once.
            if (Build.VERSION.SDK_INT >= 29) setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
            // Keep sending frames while the picture is still, so the PC never thinks the phone has gone.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000L)
        }
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
        // Reconnecting: nothing to send to. Drop the frame (queuing it would only overflow and halve the quality);
        // the new connection starts from a full picture.
        if (!linked) { waitForKey = true; return }
        if (waitForKey && !key) return
        waitForKey = false
        val data = if (key) (codecConfig ?: ByteArray(0)) + bytes else bytes
        val flags = if (key) 2 else 0
        if (!queue.offer(Packet(data, info.presentationTimeUs, flags))) {
            // Wi-Fi fell far behind: drop what is queued, halve the bitrate, and restart from a fresh full picture
            // (at most one ask a second). Before, the full picture was sent at the same high bitrate and was itself
            // too big, so it overflowed again: 1080p never recovered.
            queue.clear()
            waitForKey = true
            setBitrate(curBitrate / 2)
            requestKeyFrame()
        }
    }

    /** Ask the video chip for a full picture: at most one a second (the PC asks too after broken frames). */
    private fun requestKeyFrame() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (lastKeyAsk != 0L && now - lastKeyAsk < 1000) return
        lastKeyAsk = now
        try {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: Exception) {}
    }

    /** Change the video chip's bitrate on the fly, within [ceiling / 5 (≥ 300 kbit/s), ceiling]. */
    private fun setBitrate(want: Int) {
        val b = want.coerceIn(max(300_000, bitrate / 5), bitrate)
        if (abs(b - curBitrate) < curBitrate / 30) return
        curBitrate = b
        try {
            codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, b) })
        } catch (_: Exception) {}
    }

    /**
     * Adaptive bitrate, checked twice a second from the sending loop. A queue of waiting frames means Wi-Fi is not
     * keeping up: step down 25 % at once. Two calm seconds in a row: step back up 15 %, never above the ceiling
     * (was 10 % every 3 s: after one hiccup the picture stayed soft for about 45 seconds; now about 20).
     */
    private fun adaptBitrate() {
        val now = android.os.SystemClock.elapsedRealtime()
        val backlog = queue.size
        if (udp != null) {
            // Smooth Wi-Fi mode: the PC's loss reports steer the quality (onUdpReport). Only a real pile-up here
            // (the phone itself can't send fast enough) steps it down.
            if (backlog >= 12) { setBitrate(curBitrate * 3 / 4); calmSince = now }
            return
        }
        when {
            backlog >= 6 -> { setBitrate(curBitrate * 3 / 4); calmSince = now }
            backlog <= 1 -> if (now - calmSince >= 2000) { setBitrate(curBitrate * 115 / 100); calmSince = now }
            else -> calmSince = now
        }
    }

    @SuppressLint("MissingPermission")
    private fun openCamera() {
        if (!running.get()) return
        val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = pickCameraId(mgr)
        val ch = mgr.getCameraCharacteristics(id)
        chars = ch
        // A different lens may not offer the same picture size (or 60 fps the same way); ask for what it does.
        val size = planCapture(ch)
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
        val cb = object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(s: CameraCaptureSession) {
                session = s
                repeat()
                requestKeyFrame()
            }
            override fun onConfigureFailed(s: CameraCaptureSession) {
                if (highSpeed) {
                    // This phone said it could film 60 fps in high-speed mode but refused: carry on at 30.
                    Log.w(TAG, "high-speed session refused; falling back to regular video")
                    highSpeed = false
                    hsRange = null
                    chars?.let { ch -> val size = pickCaptureSize(ch) ?: cap; if (size != cap) { cap = size; gl?.setCaptureSize(size.width, size.height) } }
                    createSession(device)
                    return
                }
                fail("This camera can't stream at this size. Try a lower quality or another lens.")
            }
        }
        @Suppress("DEPRECATION")
        if (highSpeed) device.createConstrainedHighSpeedCaptureSession(listOf(target), cb, camHandler)
        else device.createCaptureSession(listOf(target), cb, camHandler)
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
            (if (highSpeed) hsRange else range)?.let { b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it); aeRange = it }

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
            // Electronic stabilisation is OFF at 60 fps: on many phones (MediaTek especially) it holds the camera to
            // 30 fps (owner, 2026-11-23: "kept 60 but getting 30"). A webcam usually stands still; the lens's own
            // optical stabilisation (below) stays on.
            val vs = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES) ?: intArrayOf()
            eisOn = st.stabilize && st.fps < 60 && vs.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON)
            if (vs.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON))
                b.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE,
                    if (eisOn) CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON else CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
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

            // High-speed mode takes the same request as a small burst (Android's rule for that mode); it ignores
            // the controls it doesn't support (noise reduction etc.) instead of failing.
            if (s is CameraConstrainedHighSpeedCaptureSession) s.setRepeatingBurst(s.createHighSpeedRequestList(b.build()), null, camHandler)
            else s.setRepeatingRequest(b.build(), null, camHandler)
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
            val hs60 = try {
                val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
                val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                map != null && caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO) &&
                    map.highSpeedVideoFpsRanges.any { r -> r.upper >= 60 && map.getHighSpeedVideoSizesFor(r).any { it.width >= 1280 } }
            } catch (_: Exception) { false }
            val reg60 = fpsRanges.any { it.upper >= 60 && it.lower <= 60 } && try {
                val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                map?.getOutputSizes(SurfaceTexture::class.java)?.any { it.width >= 1280 && map.getOutputMinFrameDuration(SurfaceTexture::class.java, it) in 1..17_200_000L } == true
            } catch (_: Exception) { false }
            for (f in listOf(15, 24, 30, 60))
                if (if (f == 60) reg60 || hs60 else fpsRanges.any { it.upper >= f && it.lower <= f }) fpsList.put(f)
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

    /**
     * Plain-text camera report for Settings → About (the owner screenshots it): what each camera offers to
     * third-party apps — frame-rate ranges, high-speed ranges, and the fastest each video size can go. This is what
     * decides whether 1080p60 / 4K30 are possible here; the phone's own camera app may use private modes.
     */
    fun report(context: Context): String {
        val mgr = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val sb = StringBuilder()
        sb.append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append(" · Android ").append(Build.VERSION.RELEASE).append('\n')
        for (id in mgr.cameraIdList) {
            val ch = try { mgr.getCameraCharacteristics(id) } catch (_: Exception) { continue }
            val facing = when (ch.get(CameraCharacteristics.LENS_FACING)) { CameraCharacteristics.LENS_FACING_FRONT -> "front"; CameraCharacteristics.LENS_FACING_BACK -> "back"; else -> "other" }
            val level = when (ch.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)) { 0 -> "limited"; 1 -> "full"; 2 -> "legacy"; 3 -> "level3"; 4 -> "external"; else -> "?" }
            sb.append("\nCamera ").append(id).append(" (").append(facing).append(", ").append(level).append(")\n")
            val fr = ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
            sb.append("  fps ranges: ").append(fr.joinToString(" ") { "[${it.lower}-${it.upper}]" }).append('\n')
            val map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            if (map != null) {
                val hs = try { map.highSpeedVideoFpsRanges.joinToString(" ") { "[${it.lower}-${it.upper}]" } } catch (_: Exception) { "" }
                sb.append("  high-speed: ").append(hs.ifEmpty { "none" }).append('\n')
                val sizes = (map.getOutputSizes(SurfaceTexture::class.java) ?: emptyArray())
                    .filter { it.width >= 1280 }.sortedByDescending { it.width * it.height }.take(8)
                for (sz in sizes) {
                    val ns = try { map.getOutputMinFrameDuration(SurfaceTexture::class.java, sz) } catch (_: Exception) { 0L }
                    val maxFps = if (ns > 0) (1_000_000_000.0 / ns).roundToInt() else 0
                    sb.append("  ").append(sz.width).append('x').append(sz.height).append(" up to ").append(maxFps).append(" fps\n")
                }
            }
        }
        return sb.toString().trimEnd()
    }
}
