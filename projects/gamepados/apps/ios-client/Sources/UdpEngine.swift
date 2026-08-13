import Foundation
import Darwin

// UDP input engine — Swift port of gamepad-engine.cpp's TX/RX loops per
// spec/WIRE_PROTOCOL.md. Everything little-endian; the 20-byte frame layout,
// change-detection, 3x redundancy, adaptive keep-alive, ACK-only liveness,
// broadcast lock-on and no-BYE teardown are all contract, not style — do not
// "improve" them without re-reading the spec.
final class UdpEngine {

    // ── Payload slot (latest-wins, JS injects at up to 120 Hz) ──
    private let cond = NSCondition()
    private var payload = [UInt8](repeating: 0, count: 20)
    private var payloadDirty = false
    private var running = false

    // ── Socket / peer (TX-thread owned after connect()) ──
    private var sock: Int32 = -1
    private var serverAddr = sockaddr_in()
    private var socketConnected = false
    private var connectedPeer: in_addr_t = 0
    private var expectedHash: UInt32 = 0
    private var recreateBackoffMs: UInt64 = 50
    private var nextRecreateNs: UInt64 = 0

    // ── Telemetry (stateLock) ──
    private let stateLock = NSLock()
    private var packetCount: Int64 = 0
    private var latencyMs: Float = 0
    private var hasLatencySample = false
    private var lastAckMonoNs: UInt64 = 0
    private var rumbleSeq: UInt64 = 0          // NOT reset across reconnects
    private var rumbleLeft: UInt8 = 0
    private var rumbleRight: UInt8 = 0

    private var thread: Thread?
    private let stopped = DispatchSemaphore(value: 0)

    // ── GRX (created per connect; TX thread flips ready during RX drain) ──
    private var grx: GrxSession?
    private var grxReady = false

    private(set) var serverIp = ""

    // MARK: - Public API (bridge-facing)

    func connect(ip: String, port: UInt16, key: String) {
        cond.lock()
        if running { cond.unlock(); return } // re-init guard: caller must stop first
        running = true
        // Neutral seed: sticks 128, everything else 0 — with lastSentInput
        // seeded 0xFF the first TX iteration always sends this frame, which is
        // what triggers server pad-acquisition + the discovery ACK.
        payload = [UInt8](repeating: 0, count: 20)
        payload[12] = 128; payload[13] = 128; payload[14] = 128; payload[15] = 128
        payloadDirty = false
        cond.unlock()

        serverIp = ip
        expectedHash = UInt32(key, radix: 16) ?? 0

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        inet_pton(AF_INET, ip, &addr.sin_addr)
        serverAddr = addr
        socketConnected = false
        connectedPeer = 0
        recreateBackoffMs = 50
        nextRecreateNs = 0

        stateLock.lock()
        packetCount = 0; latencyMs = 0; hasLatencySample = false
        lastAckMonoNs = 0; rumbleLeft = 0; rumbleRight = 0 // rumbleSeq stays monotonic
        stateLock.unlock()

        sock = makeSocket()

        // GRX: fresh session per connection (fresh ephemeral key — required).
        // Against a non-GRX server the handshake never completes and the
        // legacy cleartext path runs unchanged.
        grxReady = false
        if key != "usb" {
            let session = GrxSession(pairingKey: key) { [weak self] data in
                self?.sendBytes([UInt8](data))
            }
            session.onEstablished = { [weak self] in self?.grxReady = true }
            grx = session
        } else {
            grx = nil
        }

        let t = Thread { [weak self] in self?.txLoop() }
        t.name = "gamepad-tx"
        t.qualityOfService = .userInteractive
        thread = t
        t.start()

        grx?.start() // CLIENT_HELLO after the socket is up (Android ordering)
    }

    func stop() {
        cond.lock()
        let wasRunning = running
        running = false
        cond.signal()
        cond.unlock()
        guard wasRunning else { return }
        _ = stopped.wait(timeout: .now() + 1.0)
        if sock >= 0 { close(sock); sock = -1 }
        socketConnected = false
        grx = nil
        grxReady = false
        thread = nil
        // Deliberately NO BYE/teardown packet — an unauthenticated teardown
        // would let any LAN host spoof-kill the session. The server's idle
        // watchdog retires the pad in ~3 s.
    }

    /// Latest 20-byte frame from JS. Only offsets 8..15 reach the wire as-is;
    /// the TX thread overwrites timestamp (0..7) and authToken (16..19).
    func injectPayload(_ data: Data) {
        guard data.count == 20 else { return }
        cond.lock()
        payload = [UInt8](data)
        payloadDirty = true
        cond.signal()
        cond.unlock()
    }

    var isRunning: Bool {
        cond.lock(); defer { cond.unlock() }
        return running
    }

    func telemetrySnapshot() -> (packetCount: Int64, hz: Int, latencyMs: Float,
                                 connectionType: String, linkAlive: Bool, engineRunning: Bool) {
        let run = isRunning
        stateLock.lock()
        let count = packetCount
        let lat = latencyMs
        let sinceAck: Int64 = lastAckMonoNs == 0 ? -1
            : Int64((monoNs() &- lastAckMonoNs) / 1_000_000)
        stateLock.unlock()
        let alive = run && sinceAck >= 0 && sinceAck <= 2500
        return (run ? count : 0, run ? 1000 : 0, run ? lat : 0,
                run ? "wireless" : "none", alive, run)
    }

    /// "seq:left:right" — UI fires the vibrator only when seq advances.
    func rumbleStateString() -> String {
        guard isRunning else { return "0:0:0" }
        stateLock.lock(); defer { stateLock.unlock() }
        return "\(rumbleSeq):\(rumbleLeft):\(rumbleRight)"
    }

    // MARK: - TX loop

    private func txLoop() {
        var lastSentInput = [UInt8](repeating: 0xFF, count: 8) // first frame always "changed"
        var redundancyRemaining = 0
        var lastSendNs: UInt64 = 0

        while true {
            cond.lock()
            if !running { cond.unlock(); break }
            var frame = payload
            payloadDirty = false
            cond.unlock()

            let now = monoNs()

            if sock < 0, now >= nextRecreateNs { // backoff socket recovery
                sock = makeSocket()
                socketConnected = false
            }

            if sock >= 0 {
                let curInput = Array(frame[8..<16])
                let changed = curInput != lastSentInput
                stateLock.lock()
                let rumbleActive = rumbleLeft != 0 || rumbleRight != 0
                stateLock.unlock()
                // 60 Hz uplink during rumble halves rumble-update latency (the
                // PC only emits fresh RMB in reply to inbound frames).
                let heartbeatNs: UInt64 = rumbleActive ? 16_000_000 : 33_000_000
                let heartbeat = now &- lastSendNs >= heartbeatNs
                let redundant = redundancyRemaining > 0

                if changed || heartbeat || redundant {
                    writeLE64(&frame, at: 0, now)          // monotonic ns, TX-stamped
                    writeLE32(&frame, at: 16, expectedHash)
                    var wire = frame
                    // Seal ONLY on ticks that send (fixed perf bug — never
                    // seal on idle polls); silent fallback to cleartext.
                    if grxReady, let sealed = grx?.seal(Data(frame)),
                       sealed.count > 0, sealed.count <= 64 {
                        wire = [UInt8](sealed)
                    }
                    if sendBytes(wire) {
                        stateLock.lock(); packetCount += 1; stateLock.unlock()
                        lastSentInput = curInput
                        lastSendNs = now
                        if changed { redundancyRemaining = 2 } // 3 sends total
                        else if redundancyRemaining > 0 { redundancyRemaining -= 1 }
                        recreateBackoffMs = 50
                    } else if [ENETUNREACH, ENETDOWN, EADDRNOTAVAIL, EBADF].contains(errno) {
                        close(sock); sock = -1; socketConnected = false
                        nextRecreateNs = now &+ recreateBackoffMs &* 1_000_000
                        recreateBackoffMs = min(recreateBackoffMs * 2, 1000)
                    }
                }
                drainRx()
            }

            cond.lock()
            if !payloadDirty && running {
                // 2 ms tick keeps RX drained + redundancy/keep-alive firing;
                // injectPayload signals so fresh input transmits immediately.
                cond.wait(until: Date().addingTimeInterval(0.002))
            }
            cond.unlock()
        }
        stopped.signal()
    }

    // MARK: - RX

    private func drainRx() {
        var buf = [UInt8](repeating: 0, count: 128)
        while true {
            var src = sockaddr_in()
            var slen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &src) { p in
                p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    recvfrom(sock, &buf, 127, 0, sa, &slen)
                }
            }
            if n <= 0 { return }

            // GRX control frames route whole to the handshake layer, never
            // parsed as ACK/RMB (0xE1/E2/E3 can't collide: 'A'=0x41,'R'=0x52).
            if buf[0] == 0xE1 || buf[0] == 0xE2 || buf[0] == 0xE3 {
                grx?.onServerMessage(Data(buf[0..<n]))
                continue
            }

            // Source guard: once locked to a unicast peer, ignore datagrams
            // from anyone else (anti-spoof for liveness/RTT/rumble). During
            // broadcast discovery any source is accepted.
            let destIsBroadcast = Self.isBroadcast(serverAddr.sin_addr)
            let sourceOk = destIsBroadcast || src.sin_addr.s_addr == serverAddr.sin_addr.s_addr

            if n >= 5, buf[0] == 0x52, buf[1] == 0x4D, buf[2] == 0x42 { // "RMB"
                if sourceOk {
                    stateLock.lock()
                    rumbleLeft = buf[3]
                    rumbleRight = buf[4]
                    rumbleSeq &+= 1 // every RMB datagram, even identical values
                    stateLock.unlock()
                }
                continue
            }

            guard n >= 3, buf[0] == 0x41, buf[1] == 0x43, buf[2] == 0x4B, // "ACK"
                  sourceOk else { continue }

            let now = monoNs()
            stateLock.lock()
            lastAckMonoNs = now // the ONLY "PC is alive" signal
            if n >= 11 {
                let echoed = readLE64(Data(buf[3..<11]), at: 0)
                if echoed != 0 && now > echoed {
                    let rtt = Float(Double(now - echoed) / 1e6)
                    if rtt >= 0 && rtt < 1000 {
                        latencyMs = hasLatencySample ? latencyMs * 0.8 + rtt * 0.2 : rtt
                        hasLatencySample = true
                    }
                }
            }
            stateLock.unlock()

            // Broadcast -> unicast lock-on, then connect() so the kernel
            // caches the route; keep sendto() if connect ever fails.
            if destIsBroadcast { serverAddr.sin_addr = src.sin_addr }
            if !Self.isBroadcast(serverAddr.sin_addr),
               !socketConnected || connectedPeer != serverAddr.sin_addr.s_addr {
                var addr = serverAddr
                let r = withUnsafePointer(to: &addr) { p in
                    p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                        Darwin.connect(sock, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }
                if r == 0 {
                    socketConnected = true
                    connectedPeer = serverAddr.sin_addr.s_addr
                }
            }
            return // an ACK ends the drain for this tick
        }
    }

    // MARK: - Socket plumbing

    private func makeSocket() -> Int32 {
        let s = socket(AF_INET, SOCK_DGRAM, 0)
        guard s >= 0 else { return -1 }
        let flags = fcntl(s, F_GETFL, 0)
        _ = fcntl(s, F_SETFL, flags | O_NONBLOCK)
        var one: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_BROADCAST, &one, socklen_t(MemoryLayout<Int32>.size))
        // DSCP EF + Wi-Fi voice access class — best-effort, failures ignored
        // (the Android engine sets IP_TOS 0xB8 + SO_PRIORITY 6 / WMM AC_VO).
        var tos: Int32 = 0xB8
        setsockopt(s, IPPROTO_IP, IP_TOS, &tos, socklen_t(MemoryLayout<Int32>.size))
        var svc: Int32 = NET_SERVICE_TYPE_VO
        setsockopt(s, SOL_SOCKET, SO_NET_SERVICE_TYPE, &svc, socklen_t(MemoryLayout<Int32>.size))
        return s
    }

    @discardableResult
    private func sendBytes(_ bytes: [UInt8]) -> Bool {
        guard sock >= 0 else { return false }
        let sent: Int
        if socketConnected {
            sent = send(sock, bytes, bytes.count, 0)
        } else {
            var addr = serverAddr
            sent = withUnsafePointer(to: &addr) { p in
                p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    sendto(sock, bytes, bytes.count, 0, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        return sent == bytes.count
    }

    private static func isBroadcast(_ a: in_addr) -> Bool {
        let host = UInt32(bigEndian: a.s_addr)
        return host == INADDR_BROADCAST || (host & 0xFF) == 0xFF
    }

    private func monoNs() -> UInt64 {
        clock_gettime_nsec_np(CLOCK_MONOTONIC)
    }

    private func writeLE32(_ b: inout [UInt8], at offset: Int, _ v: UInt32) {
        for k in 0..<4 { b[offset + k] = UInt8(truncatingIfNeeded: v >> (8 * k)) }
    }

    private func writeLE64(_ b: inout [UInt8], at offset: Int, _ v: UInt64) {
        for k in 0..<8 { b[offset + k] = UInt8(truncatingIfNeeded: v >> (8 * k)) }
    }
}
