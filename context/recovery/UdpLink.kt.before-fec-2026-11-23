package com.gamepad.camos

import android.os.SystemClock
import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.SocketTimeoutException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.LockSupport
import kotlin.math.max

/**
 * Smooth Wi-Fi mode (owner, 2026-11-23): the phone's half of pc-server-rs/src/camera/udp.rs — read that file for the
 * why. In short: each picture goes out as numbered pieces of at most 1200 bytes; the PC asks again for pieces that
 * didn't arrive (NACK), skips a picture it can't complete in ~0.2 s, and twice a second reports how many packets
 * arrived and how many were lost, which drives the quality up or down (`onReport`).
 *
 * The packet layouts must stay byte-for-byte the same as udp.rs:
 *   video  token[8] kind=1 flags frame:u32 idx:u16 count:u16 pts_us:u64 seq:u32 data[..1200]
 *   nack   token[8] kind=2 frame:u32 n:u8 idx:u16 × n          (n = 255: the whole frame)
 *   report token[8] kind=3 received:u32 lost:u32 skipped:u16
 *
 * `sock` must already be bound to the PC's network and connected to the PC's UDP port.
 */
class UdpLink(
    private val sock: DatagramSocket,
    private val token: ByteArray,
    private val onReport: (received: Int, lost: Int, skipped: Int) -> Unit,
) {
    companion object {
        const val HEADER = 30
        const val MAX_CHUNK = 1200
        const val MAX_CHUNKS = 4096
        private const val KIND_VIDEO = 1
        private const val KIND_NACK = 2
        private const val KIND_REPORT = 3
        /** Pictures kept for resends (about a second at 60 fps; the PC gives up after 0.2 s). */
        private const val KEEP = 64
        /** Pieces sent back to back before pacing starts (a short burst is fine for any Wi-Fi). */
        private const val BURST = 10
        private const val TAG = "CamOS"
    }

    private val seq = AtomicInteger(0)
    private val recent = arrayOfNulls<Array<ByteArray>>(KEEP)
    private val recentFrame = IntArray(KEEP) { -1 }
    private val sendLock = Any()
    @Volatile private var closed = false
    /** When the PC's last report arrived (0 = none yet): no report means the PC isn't getting our packets. */
    @Volatile var lastReportAt = 0L; private set
    @Volatile var resent = 0; private set

    init {
        sock.soTimeout = 500
        Thread({ receive() }, "camos-udp-rx").start()
    }

    /**
     * Send one picture as pieces. After a short burst the pieces are spread out at `paceBps` so a big full picture
     * doesn't arrive at the Wi-Fi router all at once (routers drop what they can't hold).
     */
    fun sendFrame(frame: Int, key: Boolean, ptsUs: Long, data: ByteArray, paceBps: Int) {
        if (data.isEmpty()) return
        val count = (data.size + MAX_CHUNK - 1) / MAX_CHUNK
        if (count > MAX_CHUNKS) return
        val pkts = Array(count) { i ->
            val off = i * MAX_CHUNK
            val len = minOf(MAX_CHUNK, data.size - off)
            val p = ByteArray(HEADER + len)
            token.copyInto(p, 0, 0, 8)
            p[8] = KIND_VIDEO.toByte()
            p[9] = if (key) 2 else 0
            putInt(p, 10, frame)
            putShort(p, 14, i)
            putShort(p, 16, count)
            putLong(p, 18, ptsUs)
            System.arraycopy(data, off, p, HEADER, len)
            p
        }
        synchronized(recent) {
            recent[frame and (KEEP - 1)] = pkts
            recentFrame[frame and (KEEP - 1)] = frame
        }
        val nsPerByte = 8e9 / max(paceBps, 4_000_000)
        val start = System.nanoTime()
        var paced = 0L
        for ((i, p) in pkts.withIndex()) {
            if (i >= BURST) {
                val due = start + (paced * nsPerByte).toLong()
                val wait = due - System.nanoTime()
                if (wait > 50_000) LockSupport.parkNanos(wait)
                paced += p.size
            }
            send(p.copyOf())
        }
    }

    /** Every packet on the air gets the next number (resends too), so the PC can count what the air lost. */
    private fun send(p: ByteArray) {
        putInt(p, 26, seq.getAndIncrement())
        try {
            synchronized(sendLock) { sock.send(DatagramPacket(p, p.size)) }
        } catch (e: Exception) {
            if (!closed) Log.w(TAG, "udp send: ${e.message}")
        }
    }

    private fun receive() {
        val buf = ByteArray(2048)
        while (!closed) {
            val dp = DatagramPacket(buf, buf.size)
            try { sock.receive(dp) } catch (_: SocketTimeoutException) { continue } catch (_: Exception) { if (closed) break else continue }
            val n = dp.length
            if (n < 9 || !tokenOk(buf)) continue
            when (buf[8].toInt()) {
                KIND_NACK -> if (n >= 14) {
                    val frame = getInt(buf, 9)
                    val cnt = buf[13].toInt() and 0xff
                    val pkts = synchronized(recent) {
                        if (recentFrame[frame and (KEEP - 1)] == frame) recent[frame and (KEEP - 1)] else null
                    } ?: continue
                    val list = if (cnt == 255) pkts.indices.toList()
                        else (0 until cnt).filter { 14 + 2 * it + 1 < n }.map { getShort(buf, 14 + 2 * it) }
                    for (i in list) if (i in pkts.indices) { resent++; send(pkts[i].copyOf()) }
                }
                KIND_REPORT -> if (n >= 19) {
                    lastReportAt = SystemClock.elapsedRealtime()
                    onReport(getInt(buf, 9), getInt(buf, 13), getShort(buf, 17))
                }
            }
        }
    }

    fun close() {
        closed = true
        try { sock.close() } catch (_: Exception) {}
    }

    private fun tokenOk(b: ByteArray): Boolean {
        var d = 0
        for (i in 0 until 8) d = d or (b[i].toInt() xor token[i].toInt())
        return d == 0
    }

    private fun putInt(b: ByteArray, at: Int, v: Int) {
        b[at] = (v ushr 24).toByte(); b[at + 1] = (v ushr 16).toByte(); b[at + 2] = (v ushr 8).toByte(); b[at + 3] = v.toByte()
    }
    private fun putShort(b: ByteArray, at: Int, v: Int) { b[at] = (v ushr 8).toByte(); b[at + 1] = v.toByte() }
    private fun putLong(b: ByteArray, at: Int, v: Long) { for (i in 0 until 8) b[at + i] = (v ushr (56 - 8 * i)).toByte() }
    private fun getInt(b: ByteArray, at: Int) =
        ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
    private fun getShort(b: ByteArray, at: Int) = ((b[at].toInt() and 0xff) shl 8) or (b[at + 1].toInt() and 0xff)
}
