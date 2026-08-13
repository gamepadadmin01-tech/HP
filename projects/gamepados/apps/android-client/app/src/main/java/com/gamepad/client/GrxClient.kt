package com.gamepad.client

/**
 * GRX client session manager — transport-agnostic. Drives the 1-RTT handshake
 * over whatever socket the engine already owns (via the `send` callback), then
 * seals outgoing 20-byte input frames into 41-byte GRX wire frames.
 *
 * This is the ONLY Android piece the engine has to wire in. Minimal glue (device
 * session): derive the PSK from the scanned pairing key, create a GrxClient with
 * a send callback, call start() on connect, feed inbound control frames to
 * onServerMessage(), and route each outgoing input frame through seal().
 *
 *   val client = GrxClient(
 *       GrxCrypto.pskFromPairingKey(pairingKey),   // 3rd CSV field of the QR
 *       GrxCrypto.GRX_LTID
 *   ) { bytes -> nativeSocketSend(bytes) }          // your existing UDP send
 *
 *   client.start()                                  // -> sends CLIENT_HELLO
 *
 *   // for every datagram received from the server:
 *   if (GrxClient.isControl(pkt)) { client.onServerMessage(pkt); return }
 *
 *   // to send input (drop frames until established):
 *   client.seal(frame20)?.let { nativeSocketSend(it) }
 *
 * Server side (server.py run_udp_loop) already routes the handshake + decrypts.
 * Until GRX_REQUIRED flips on the server, the legacy cleartext path still works,
 * so this can ship incrementally.
 */
class GrxClient(
    psk: ByteArray,
    ltid: ByteArray,
    private val send: (ByteArray) -> Unit
) {
    private val session = GrxCrypto.ClientSession(psk, ltid)

    val established: Boolean get() = session.established

    /** Call on each (re)connect. Sends CLIENT_HELLO; resets are handled by a new GrxClient. */
    fun start() {
        send(session.hello())
    }

    /**
     * Feed server->client CONTROL frames (SERVER_HELLO). Returns true if the frame
     * was a handshake message (and thus consumed). On success it auto-sends
     * CLIENT_CONFIRM and flips `established`. A null result means the server failed
     * authentication (wrong pairing key / MITM) — we stay unestablished and send no input.
     */
    fun onServerMessage(frame: ByteArray): Boolean {
        if (frame.isEmpty()) return false
        val t = frame[0].toInt() and 0xFF
        if (t == GrxCrypto.T_SHELLO && !session.established) {
            val confirm = session.handleServerHello(frame)
            if (confirm != null) send(confirm)   // handshake complete; input may now flow
            return true                           // consumed regardless (don't treat as data)
        }
        return false
    }

    /** Seal a 20-byte input frame -> 41-byte GRX wire frame, or null if not yet established. */
    fun seal(frame20: ByteArray): ByteArray? =
        if (session.established) session.seal(frame20) else null

    /** Decrypt an s2c (rumble/ack) frame, or null. NOTE: server s2c is still cleartext in v1. */
    fun open(frame: ByteArray): ByteArray? = session.open(frame)

    companion object {
        /** True if `frame` is a GRX handshake control frame (not an input data frame). */
        fun isControl(frame: ByteArray): Boolean {
            if (frame.isEmpty()) return false
            val t = frame[0].toInt() and 0xFF
            return t == GrxCrypto.T_HELLO || t == GrxCrypto.T_SHELLO || t == GrxCrypto.T_CONFIRM
        }
    }
}
