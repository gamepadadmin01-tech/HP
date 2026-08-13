package com.gamepad.client

import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * GRX crypto — Android (client) side. Mirrors apps/pc-server/grx_crypto.py +
 * grx_session.py BYTE-FOR-BYTE (see apps/docs/GRX_PROTOCOL.md). The Python
 * reference is the source of truth and is unit-tested; this must produce the
 * identical wire bytes and derive the identical keys.
 *
 * Primitives: X25519 + HKDF-SHA256 via Tink (works back to API 19, unlike
 * java.security X25519 which is API 31+); AES-128-GCM + HMAC via javax.crypto
 * (hardware AES on ARMv8). Fresh ephemeral PER CONNECTION; counter never resets.
 *
 * Gradle: implementation("com.google.crypto.tink:tink-android:1.13.0")
 * NOTE: not yet build-verified on the project toolchain — confirm the Tink
 * version/API and that the engine wiring (below) compiles before shipping.
 */
object GrxCrypto {
    const val VERSION: Byte = 1
    const val CIPHER_ID: Byte = 1
    const val DIR_C2S = 1            // client -> server (input)
    const val DIR_S2C = 2            // server -> client (rumble / ack)
    const val KEY_LEN = 16
    const val TAG_LEN = 16
    const val PLAINTEXT_LEN = 20
    const val HEADER_LEN = 5         // version(1) + counter_low32(4)
    const val WIRE_LEN = HEADER_LEN + PLAINTEXT_LEN + TAG_LEN   // 41

    // frame type bytes (data frames start with VERSION=1, no collision)
    const val T_HELLO = 0xE1
    const val T_SHELLO = 0xE2
    const val T_CONFIRM = 0xE3

    private val HMAC = "HmacSHA256"

    /** Fixed domain id bound into the handshake transcript (== server GRX_LTID). */
    val GRX_LTID: ByteArray get() = "gamepados-grx-v1".toByteArray(Charsets.US_ASCII)

    /**
     * Derive the GRX PSK from the existing pairing key (the 3rd CSV field in the
     * QR). MUST match server.py:_grx_psk_from_key — parse the key as hex (Python
     * bytes.fromhex), falling back to UTF-8 bytes if it isn't valid hex, then
     * HKDF-SHA256(ikm, salt="", info="grx psk v1", 32).
     */
    fun pskFromPairingKey(key: String): ByteArray {
        val ikm = parseHexOrNull(key) ?: key.toByteArray(Charsets.UTF_8)
        return Hkdf.computeHkdf(HMAC, ikm, ByteArray(0),
            "grx psk v1".toByteArray(Charsets.US_ASCII), 32)
    }

    private fun parseHexOrNull(s: String): ByteArray? {
        if (s.isEmpty() || s.length % 2 != 0) return null
        val out = ByteArray(s.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(s[i * 2], 16)
            val lo = Character.digit(s[i * 2 + 1], 16)
            if (hi < 0 || lo < 0) return null
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    private fun lp(b: ByteArray): ByteArray =
        ByteBuffer.allocate(4 + b.size).order(ByteOrder.LITTLE_ENDIAN).putInt(b.size).put(b).array()

    fun transcriptHash(clientPub: ByteArray, serverPub: ByteArray, longTermId: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(lp(byteArrayOf(VERSION, CIPHER_ID)))
        md.update(lp(clientPub)); md.update(lp(serverPub)); md.update(lp(longTermId))
        return md.digest()
    }

    /** ikm = shared||psk, salt = transcript, info = label — one HKDF per key. */
    private fun hk(ikm: ByteArray, salt: ByteArray, info: ByteArray, n: Int): ByteArray =
        Hkdf.computeHkdf(HMAC, ikm, salt, info, n)

    class Keys(val c2s: ByteArray, val s2c: ByteArray, val confirm: ByteArray, val transcript: ByteArray)

    fun deriveKeys(shared: ByteArray, psk: ByteArray, th: ByteArray): Keys {
        val ikm = shared + psk
        return Keys(
            c2s = hk(ikm, th, "grx c2s v1".toByteArray(Charsets.US_ASCII), KEY_LEN),
            s2c = hk(ikm, th, "grx s2c v1".toByteArray(Charsets.US_ASCII), KEY_LEN),
            confirm = hk(ikm, th, "grx confirm v1".toByteArray(Charsets.US_ASCII), 32),
            transcript = th
        )
    }

    /** role: 'C' (client) or 'S' (server). */
    fun confirmTag(confirmKey: ByteArray, th: ByteArray, role: Byte): ByteArray {
        val mac = Mac.getInstance(HMAC)
        mac.init(SecretKeySpec(confirmKey, HMAC))
        mac.update(th); mac.update(role)
        return mac.doFinal()
    }

    private fun nonce(direction: Int, counter: Long): ByteArray =
        ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN).putInt(direction).putLong(counter).array()

    private fun aad(counter: Long): ByteArray =
        ByteBuffer.allocate(9).order(ByteOrder.LITTLE_ENDIAN).put(VERSION).putLong(counter).array()

    /** Outbound (c2s input). Counter starts at 1, strictly monotonic, never resets. */
    class Sender(key: ByteArray, private val direction: Int) {
        private val secret = SecretKeySpec(key, "AES")
        private var counter = 0L
        // Reuse one Cipher instance across seals: Cipher.getInstance does a JCE
        // provider lookup (allocations + service scan) EVERY call, and this runs on
        // the hot send path. GCM requires a fresh IV per encryption, which we already
        // guarantee (counter is strictly monotonic → a distinct nonce every init), so
        // re-init()ing a cached Cipher is safe and byte-identical on the wire.
        private val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        fun seal(plaintext: ByteArray): ByteArray {
            require(plaintext.size == PLAINTEXT_LEN)
            counter += 1
            cipher.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(TAG_LEN * 8, nonce(direction, counter)))
            cipher.updateAAD(aad(counter))
            val body = cipher.doFinal(plaintext)          // ciphertext||tag (16-byte tag appended)
            return ByteBuffer.allocate(WIRE_LEN).order(ByteOrder.LITTLE_ENDIAN)
                .put(VERSION).putInt(counter.toInt()).put(body).array()
        }
    }

    /** Inbound (s2c rumble/ack). 64-entry replay window (s2c is low-rate). */
    class Receiver(key: ByteArray, private val direction: Int) {
        private val secret = SecretKeySpec(key, "AES")
        private var high = 0L
        private var mask = 0L                              // bit i set => (high - i) accepted

        private fun reconstruct(low32: Int): Long {
            val lo = low32.toLong() and 0xFFFFFFFFL
            var cand = (high and 0xFFFFFFFF00000000UL.toLong()) or lo
            if (cand + 0x80000000L < high) cand += 0x100000000L
            else if (cand > high + 0x80000000L && cand >= 0x100000000L) cand -= 0x100000000L
            return cand
        }

        /** Returns the 20-byte plaintext, or null to DROP (old/dup/forged/garbage). */
        fun open(frame: ByteArray): ByteArray? {
            if (frame.size != WIRE_LEN) return null
            val bb = ByteBuffer.wrap(frame).order(ByteOrder.LITTLE_ENDIAN)
            if (bb.get() != VERSION) return null
            val counter = reconstruct(bb.int)
            if (counter <= 0) return null
            // pre-auth replay check
            if (counter <= high) {
                val off = high - counter
                if (off >= 64 || (mask ushr off.toInt()) and 1L == 1L) return null
            }
            val body = ByteArray(frame.size - HEADER_LEN); bb.get(body)
            val pt = try {
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG_LEN * 8, nonce(direction, counter)))
                c.updateAAD(aad(counter))
                c.doFinal(body)
            } catch (e: Exception) {
                return null                                // auth fail -> drop, window UNTOUCHED
            }
            // advance ONLY on auth success
            if (counter > high) {
                val shift = (counter - high).toInt()
                mask = if (shift >= 64) 1L else (mask shl shift) or 1L
                high = counter
            } else {
                mask = mask or (1L shl (high - counter).toInt())
            }
            return pt
        }
    }

    // --- client handshake (mirrors grx_session.GrxClientSession) ---------------
    class ClientSession(private val psk: ByteArray, private val longTermId: ByteArray) {
        private val ephPriv: ByteArray = X25519.generatePrivateKey()
        private val ephPub: ByteArray = X25519.publicFromPrivate(ephPriv)
        private var keys: Keys? = null
        var established = false; private set
        var sender: Sender? = null; private set
        var receiver: Receiver? = null; private set

        /** 0xE1 | client_eph_pub(32) | lp(long_term_id) */
        fun hello(): ByteArray =
            ByteBuffer.allocate(1 + 32 + 4 + longTermId.size).order(ByteOrder.LITTLE_ENDIAN)
                .put(T_HELLO.toByte()).put(ephPub).putInt(longTermId.size).put(longTermId).array()

        /** Consume SERVER_HELLO; returns CLIENT_CONFIRM to send, or null on failure. */
        fun handleServerHello(frame: ByteArray): ByteArray? {
            if (frame.size < 65 || (frame[0].toInt() and 0xFF) != T_SHELLO) return null
            val serverPub = frame.copyOfRange(1, 33)
            val serverConfirm = frame.copyOfRange(33, 65)
            val shared = X25519.computeSharedSecret(ephPriv, serverPub)
            val th = transcriptHash(ephPub, serverPub, longTermId)
            val k = deriveKeys(shared, psk, th)
            if (!MessageDigest.isEqual(serverConfirm, confirmTag(k.confirm, th, 'S'.code.toByte()))) return null
            keys = k
            sender = Sender(k.c2s, DIR_C2S)
            receiver = Receiver(k.s2c, DIR_S2C)
            established = true
            val cc = confirmTag(k.confirm, th, 'C'.code.toByte())
            return ByteBuffer.allocate(1 + 32).put(T_CONFIRM.toByte()).put(cc).array()
        }

        fun seal(plaintext: ByteArray): ByteArray = sender!!.seal(plaintext)
        fun open(frame: ByteArray): ByteArray? = receiver?.open(frame)
    }
}
