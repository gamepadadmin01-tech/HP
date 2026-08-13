#include <stdint.h>
#include <cstdint>
#include <jni.h>
#include <android/log.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <pthread.h>
#include <sched.h>
#include <time.h>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <signal.h>
#include <fcntl.h>
#include <cmath>
#include <sys/resource.h>
#include <errno.h>

// Portable little-endian helpers (Android is always LE — these are identity ops)
static inline uint16_t htole16_safe(uint16_t v) { return v; }
static inline uint32_t htole32_safe(uint32_t v) { return v; }
static inline uint64_t htole64_safe(uint64_t v) { return v; }

#ifdef htole16
#undef htole16
#endif
#define htole16(x) htole16_safe(x)

#ifdef htole32
#undef htole32
#endif
#define htole32(x) htole32_safe(x)

#ifdef htole64
#undef htole64
#endif
#define htole64(x) htole64_safe(x)

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "GamepadEngine", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "GamepadEngine", __VA_ARGS__)

// ==========================================
// 1. STRICT 20-BYTE PAYLOAD ALIGNMENT
// ==========================================
#pragma pack(push, 1)
struct GamepadPayload {
    uint64_t timestamp;   // 8 bytes
    uint16_t buttons;     // 2 bytes
    uint8_t leftTrigger;  // 1 byte
    uint8_t rightTrigger; // 1 byte
    uint8_t leftStickX;   // 1 byte
    uint8_t leftStickY;   // 1 byte
    uint8_t rightStickX;  // 1 byte
    uint8_t rightStickY;  // 1 byte
    uint32_t authToken;   // 4 bytes
};
#pragma pack(pop)

static_assert(sizeof(GamepadPayload) == 20, "FATAL: Payload struct is not exactly 20 bytes!");

// ==========================================
// ENGINE STATE (Globally Pre-Allocated)
// ==========================================
std::atomic<bool> isRunning(false);
int udpSocket = -1;
// AOA (Android Open Accessory) direct-USB transport. When accessoryMode is true the
// TX thread write()s/read()s 20-byte frames to this fd (raw USB bulk to/from the PC)
// instead of the UDP socket — SAME event-driven send loop, redundancy, and RT
// priority, just a different transport. Set up by initAccessoryNative(fd).
int accessoryFd = -1;
std::atomic<bool> accessoryMode(false);
struct sockaddr_in serverAddr;
uint32_t expectedHash = 0;
pthread_t txThread;
std::atomic<uint64_t> packetCount(0);

// ── GRX encrypted-input bridge. LIVE: the hot-path/RX hooks + initNetworkNative
//    caching are applied and Kotlin sets GRX_ENABLED=true. Once a handshake
//    establishes, onGrxControl flips grxReady and the TX loop seals via grxSeal.
//    While grxReady is false (no GRX server / pre-handshake) the path stays inert
//    and the legacy 20-byte cleartext send is byte-identical. (Threads that take
//    the seal/RX up-calls JVM-detach themselves at txThreadLoop exit.)
static JavaVM*   g_vm = nullptr;
static jobject   g_activity = nullptr;   // global ref to MainActivity (cached in initNetworkNative)
static jmethodID g_mid_seal = nullptr;   // byte[] grxSeal(byte[])
static jmethodID g_mid_ctrl = nullptr;   // void onGrxControl(byte[])
static std::atomic<bool> grxReady{false};
static JNIEnv* grxEnv() {
    JNIEnv* e = nullptr;
    if (g_vm && g_vm->GetEnv((void**)&e, JNI_VERSION_1_6) == JNI_EDETACHED)
        g_vm->AttachCurrentThread(&e, nullptr);
    return e;
}
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

// FIX 2: once we've locked onto the PC's unicast IP we connect() the UDP socket
// so the kernel caches the route and we can use send() (no per-call route
// lookup / address copy) on the hot path. Stays false during broadcast
// discovery (connect() to a broadcast addr is not what we want) and is reset
// whenever the socket is recreated. We also remember which peer we connected to
// so we can re-connect() if the locked IP ever changes.
bool socketConnected = false;
struct in_addr connectedPeer = { 0 };

// Real round-trip latency (ms). Computed from the send-timestamp the PC echoes
// back inside each ACK. Exposed via JNI so the HUD shows a true number.
std::atomic<float>    latencyMsAtomic(0.0f);
// Monotonic-ns timestamp of the last ACK received from the PC. This is the
// ONLY reliable "the PC is actually there" signal: UDP sendto() succeeds locally
// even when nothing is listening, so a rising packet-send count does NOT mean
// connected. The link is "alive" only if an ACK arrived recently.
std::atomic<uint64_t> lastAckMonoNs(0);

// Rumble from the PC over Wi-Fi (UDP). The PC sends "RMB" + large + small for
// THIS phone's virtual pad. We stash the latest motor values and bump a sequence
// so the JS layer can poll, apply the user's on/off + intensity, and fire the
// vibrator — mirroring the USB/WebSocket rumble path (which the Wi-Fi path was
// missing entirely, so wireless phones never felt in-game rumble).
std::atomic<int>      rumbleLeft(0);    // large / low-freq motor, 0..255
std::atomic<int>      rumbleRight(0);   // small / high-freq motor, 0..255
std::atomic<uint32_t> rumbleSeq(0);     // ++ on every RMB datagram received

// Mark a UDP socket as low-latency / interactive so routers and Wi-Fi QoS
// prioritise it over bulk traffic. IPTOS_LOWDELAY (0x10) + DSCP EF (0xB8) both
// signal "expedite"; we set the combined high-priority TOS byte.
static void applyLowLatencyTos(int sock) {
    if (sock < 0) return;
    int tos = 0xB8; // DSCP EF (Expedited Forwarding) << 2 | ECN 0
    setsockopt(sock, IPPROTO_IP, IP_TOS, &tos, sizeof(tos));
    // Android/Linux Wi-Fi WMM access-category selection is driven by skb->priority
    // (SO_PRIORITY), which many Wi-Fi HALs honour even when they ignore IP_TOS/DSCP.
    // prio 6 (TC_PRIO_INTERACTIVE) maps to WMM AC_VO — the same high-priority queue the
    // WIFI_MODE_FULL_LOW_LATENCY lock targets, so they compound and cut uplink queuing
    // jitter on busy APs. Best-effort: prio <= 6 is allowed unprivileged; failure is
    // harmless (older kernels may not define SO_PRIORITY).
#ifdef SO_PRIORITY
    int prio = 6;
    setsockopt(sock, SOL_SOCKET, SO_PRIORITY, &prio, sizeof(prio));
#endif
}

GamepadPayload currentPayload;
std::mutex payloadMutex;
// Input streaming gate — the native half of the "input must stream ONLY from
// the controller screen" fix (REGRESSION_CHECKLIST B0). The ~30Hz keep-alive
// below re-sends the LAST payload forever; without this gate, leaving the
// controller screen left a stale touch/gyro snapshot broadcasting from every
// screen, so the PC held a virtual pad (with deflected sticks latched in it)
// the whole time the app was open.
//
// Semantics when OFF (set from JS via AndroidBridge.setInputStreaming):
//   * the current payload is LATCHED TO NEUTRAL (sticks 128, no buttons), and
//   * new injections are DROPPED at the choke point below.
// The keep-alive itself continues, deliberately: the PC only ACKs inbound
// frames, and those ACKs are what linkAlive (and the dashboard's CONNECTED
// state, and the transport coordinator's fallback logic) feed on. Going fully
// silent would make every non-controller screen look like a dead link and
// invite coordinator churn — the double-pad class of bug. A neutral pad is
// inert: nothing to walk a volume slider with, no Guide press to open an
// overlay, no stale gyro. Defaults to true so old JS assets that never call
// the gate keep the pre-fix behaviour.
std::atomic<bool> inputStreaming(true);
// Event-driven send: injectNativePayload sets payloadDirty (under payloadMutex)
// and notifies payloadCv, so the TX thread wakes the instant input changes rather
// than waiting out a fixed poll tick. This is the core "latency → zero" change.
std::condition_variable payloadCv;
bool payloadDirty = false; // guarded by payloadMutex
float screenWidthFloat = 1920.0f;
float screenHeightFloat = 1080.0f;
// (The old native sensor-fusion path and its state were removed: gyro steering
// is implemented in Kotlin — onSensorChanged → rotation vector + 1€ filter —
// and reaches this engine inside the regular 20-byte payload from JS.)

// ==========================================
// FATAL NATIVE CRASH SIGNAL HANDLER
// ==========================================
void crashSignalHandler(int sig, siginfo_t* info, void* context) {
    // Reset to default action and re-raise to allow Android OS crash logging.
    // (The old crash-marker file write was removed: its consumer, the Shizuku
    // watchdog, no longer exists in v1.0.)
    struct sigaction sa;
    sa.sa_handler = SIG_DFL;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(sig, &sa, NULL);
    raise(sig);
}

void registerSignalHandler() {
    struct sigaction sa;
    sa.sa_sigaction = crashSignalHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO;
    
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);
    sigaction(SIGBUS,  &sa, NULL);
    sigaction(SIGFPE,  &sa, NULL);
    sigaction(SIGILL,  &sa, NULL);
}

// Cheap loss-recovery redundancy: when the input CHANGES, send the SAME packet
// this many times back-to-back over consecutive polls. The PC server dedups by
// content + orders by timestamp, so duplicates are harmless no-ops; this just
// makes a single dropped UDP datagram recover within a couple of 2ms polls
// instead of waiting up to ~33ms for the next change or keep-alive. Keep-alive
// (heartbeat) packets are NOT duplicated.
static const int CHANGED_PACKET_REDUNDANCY = 3;

// Upper bound on how long the TX thread sleeps when input is IDLE. New input wakes
// it immediately via payloadCv; this timeout just keeps ACK/rumble draining and the
// ~30Hz keep-alive firing while the pad is held steady. Kept equal to the old 2ms
// poll tick, so idle wakeup cadence (CPU/heat) is unchanged — we only REMOVE the
// up-to-2ms latency the fixed tick used to add to every fresh input.
static const long RX_POLL_NS = 2000000L; // 2 ms

// ==========================================
// 2. NETWORK TX THREAD (1000Hz Heartbeat)
// ==========================================
void* txThreadLoop(void* arg) {
    (void)arg;
    // NOTE: no CPU-affinity pinning. Forcing cores 4-7 (big cores) kept them spun
    // up 1000x/second, which was the main source of high CPU + phone heat. This
    // thread is now light (it mostly sleeps), so the scheduler can keep it on an
    // efficiency core. (Affinity pinning was intentionally removed for thermal
    // reasons — do NOT re-add it.)

    // FIX 3: best-effort TX-thread priority bump. We want this latency-critical
    // send loop to wake on time even under load. Try a LOW real-time priority via
    // SCHED_FIFO first; on stock Android this almost always fails with EPERM
    // (needs CAP_SYS_NICE), so we ALSO fall back to a nice() bump. Every step is
    // best-effort and must degrade gracefully — never crash, never block.
    {
        struct sched_param sp;
        memset(&sp, 0, sizeof(sp));
        // Use a low RT priority: just above normal, well clear of audio/driver
        // threads. sched_get_priority_min gives the floor for SCHED_FIFO.
        int rtMin = sched_get_priority_min(SCHED_FIFO);
        sp.sched_priority = (rtMin > 0) ? rtMin + 1 : 1;
        int rc = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
        if (rc != 0) {
            // SCHED_FIFO denied (typical on Android without CAP_SYS_NICE).
            // Fall back to the strongest CFS niceness we can get. setpriority
            // returns -1 on failure but -1 is also a valid niceness, so clear
            // errno first and check it afterwards.
            errno = 0;
            if (setpriority(PRIO_PROCESS, 0, -19) != 0 && errno != 0) {
                LOGI("TX thread priority bump unavailable (SCHED_FIFO rc=%d, setpriority errno=%d); running at default.", rc, errno);
            } else {
                LOGI("TX thread niced to high CFS priority (SCHED_FIFO denied rc=%d).", rc);
            }
        } else {
            LOGI("TX thread elevated to SCHED_FIFO prio %d.", sp.sched_priority);
        }
    }

    GamepadPayload networkPayload;
    uint8_t lastSentInput[8];
    memset(lastSentInput, 0xFF, sizeof(lastSentInput)); // != neutral → forces the first send
    uint64_t lastSendNs = 0;
    // FIX 1: remaining back-to-back resends for the most recent CHANGED input.
    // Set to CHANGED_PACKET_REDUNDANCY when input changes; decremented each poll
    // it forces an extra send. Keep-alive heartbeats do not touch this.
    int redundancyRemaining = 0;

    while (isRunning) {
        // Lock, snapshot newest state, clear the dirty flag (we're consuming this
        // input), unlock. (Ultra-fast, prevents tearing.)
        {
            std::lock_guard<std::mutex> lock(payloadMutex);
            networkPayload = currentPayload;
            payloadDirty = false;
        }

        // Decide whether to actually transmit. Holding the pad still used to blast
        // ~1000 identical packets/second (the CPU + heat hog); now we send ONLY when
        // the input changed, plus a ~30Hz keep-alive so the link/ACK stays warm and
        // dropped packets recover. Real input still goes out within one 2ms poll, so
        // responsiveness is unchanged. (buttons..rightStickY = 8 contiguous bytes.)
        uint8_t curInput[8];
        memcpy(curInput, &networkPayload.buttons, 8);
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        uint64_t rawTimestamp = (uint64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
        bool changed   = (memcmp(curInput, lastSentInput, 8) != 0);
        // Adaptive keep-alive: ~30Hz normally (the thermal/CPU win noted above), but
        // ~60Hz while rumble is active. The PC only emits fresh RMB in reply to an
        // inbound frame, so when the pad is held steady during rumble a 30Hz uplink
        // caps rumble-state updates at ~33ms; 60Hz halves that. Reverts to 30Hz the
        // moment rumble clears (rumbleLeft/Right are the last values the PC sent us).
        bool rumbleActive = (rumbleLeft.load(std::memory_order_relaxed) != 0) ||
                            (rumbleRight.load(std::memory_order_relaxed) != 0);
        uint64_t heartbeatNs = rumbleActive ? 16000000ULL : 33000000ULL;
        bool heartbeat = (rawTimestamp - lastSendNs) >= heartbeatNs; // adaptive keep-alive
        // FIX 1: a fresh change arms CHANGED_PACKET_REDUNDANCY back-to-back sends.
        // While that counter is positive we keep re-sending (redundant) even when
        // the input hasn't changed again, so a single dropped datagram recovers
        // fast. The counter is (re)armed below once we confirm a successful send.
        bool redundant = (redundancyRemaining > 0);
        bool doSend    = changed || heartbeat || redundant;

        networkPayload.timestamp = htole64(rawTimestamp);
        networkPayload.buttons = htole16(networkPayload.buttons);
        networkPayload.authToken = htole32(expectedHash);
        // Note: uint8_t analog values do not require endianness swapping.

        // GRX: when the encrypted session is established (grxReady), seal the 20-byte
        // frame into a 41-byte wire frame via a Kotlin up-call. grxReady=false leaves
        // outBuf/outLen at the raw payload → byte-identical to the legacy path. Applies
        // to the UDP send/sendto path; AOA stays raw 20B for now (server AOA isn't GRX yet).
        const void* outBuf = &networkPayload;
        size_t outLen = sizeof(GamepadPayload);
        uint8_t grxBuf[64];
        // Only seal when we're actually transmitting this tick. The seal is a JNI
        // up-call into Kotlin AES-GCM plus heap allocations; gating it on grxReady
        // ALONE (the old code) ran it on every idle 2ms poll — ~500 seals/sec whose
        // output was discarded because the send below is gated on doSend. Gating on
        // doSend cuts that to only the frames we send (change + redundancy + keep-alive).
        if (doSend && grxReady.load() && g_mid_seal && g_activity) {
            JNIEnv* e = grxEnv();
            if (e) {
                jbyteArray in = e->NewByteArray((jsize)sizeof(GamepadPayload));
                if (in) {
                    e->SetByteArrayRegion(in, 0, (jsize)sizeof(GamepadPayload), (const jbyte*)&networkPayload);
                    jbyteArray wire = (jbyteArray)e->CallObjectMethod(g_activity, g_mid_seal, in);
                    if (wire) {
                        jsize wn = e->GetArrayLength(wire);
                        if (wn > 0 && wn <= (jsize)sizeof(grxBuf)) {
                            e->GetByteArrayRegion(wire, 0, wn, (jbyte*)grxBuf);
                            outBuf = grxBuf;
                            outLen = (size_t)wn;
                        }
                        e->DeleteLocalRef(wire);
                    }
                    e->DeleteLocalRef(in);
                }
            }
        }

        // Fire & Forget (Zero Blocking) — only when there's something to send.
        bool haveTransport = accessoryMode ? (accessoryFd != -1) : (udpSocket != -1);
        if (haveTransport && doSend) {
            ssize_t sent;
            if (accessoryMode) {
                // AOA: write the 20-byte frame straight to the accessory fd (raw USB
                // bulk → PC). No addressing/auth handshake — USB is point-to-point.
                sent = write(accessoryFd, &networkPayload, sizeof(GamepadPayload));
            } else if (socketConnected) {
                // FIX 2: socket is connect()ed to the locked unicast peer, so the
                // kernel route is cached — send() skips the per-call route lookup
                // and address copy that sendto() repeats every time.
                sent = send(udpSocket, outBuf, outLen, MSG_DONTWAIT);
            } else {
                // Broadcast discovery (or not yet locked on): keep the explicit
                // destination so the datagram still reaches the broadcast address.
                sent = sendto(udpSocket, outBuf, outLen, MSG_DONTWAIT,
                              (struct sockaddr*)&serverAddr, sizeof(serverAddr));
            }
            if (sent > 0) {
                packetCount++;
                memcpy(lastSentInput, curInput, 8);   // remember what we sent
                lastSendNs = rawTimestamp;
                // FIX 1: (re)arm redundancy on a genuine input change; otherwise
                // burn down the counter so each armed extra send fires once.
                if (changed) {
                    redundancyRemaining = CHANGED_PACKET_REDUNDANCY - 1; // this send counts as the 1st
                } else if (redundancyRemaining > 0) {
                    redundancyRemaining--;
                }
            }
            if (sent < 0) {
                int err = errno;
                if (accessoryMode) {
                    // EAGAIN/EWOULDBLOCK = USB OUT buffer momentarily full; harmless,
                    // the keep-alive/redundancy resends recover it. Any other error
                    // means the accessory detached → close so Kotlin tears down.
                    if (err != EAGAIN && err != EWOULDBLOCK) {
                        LOGE("Accessory write failed (errno %d). Closing accessory fd.", err);
                        close(accessoryFd);
                        accessoryFd = -1;
                    }
                } else if (err == ENETUNREACH || err == ENETDOWN || err == EADDRNOTAVAIL || err == EBADF) {
                    LOGE("Network failure detected (errno %d). Closing socket...", err);
                    close(udpSocket);
                    udpSocket = -1;
                    socketConnected = false;            // socket gone → must reconnect
                    connectedPeer.s_addr = 0;
                }
            }
        }

        // FIX 4: drain incoming ACK / rumble EVERY poll, regardless of whether we
        // transmitted this tick. Previously this lived inside `if (doSend)`, so
        // when input was steady the RX queue was only serviced at the ~30Hz
        // keep-alive — adding up to ~33ms of latency to rumble and to the
        // link-alive / RTT signals. Now it runs at the full 2ms poll rate.
        {
            // Check for incoming acknowledgment packet from the PC to lock destination IP to unicast
            if (!accessoryMode && udpSocket != -1) {
                char rxBuffer[128];   // >= 65 for a GRX SERVER_HELLO (0xE2 + 2x32B pub/confirm)
                struct sockaddr_in fromAddr;
                while (true) {
                    // On a connect()ed UDP socket the kernel already filters to the
                    // peer, but recvfrom() still fills fromAddr correctly, so the
                    // existing source-guard logic below keeps working unchanged for
                    // both connected and unconnected (broadcast) sockets.
                    socklen_t fromLen = sizeof(fromAddr);
                    ssize_t rec = recvfrom(udpSocket, rxBuffer, sizeof(rxBuffer) - 1, MSG_DONTWAIT,
                                           (struct sockaddr*)&fromAddr, &fromLen);
                    if (rec <= 0) {
                        break; // Queue is empty or read would block
                    }
                    // GRX handshake control frame (0xE1/0xE2/0xE3) → hand up to Kotlin.
                    // Never fires for legacy traffic (ACK='A', RMB='R'); inert unless a
                    // GRX-capable server replied (and Kotlin no-ops if grx is null).
                    {
                        unsigned char t0 = (unsigned char)rxBuffer[0];
                        if (g_mid_ctrl && g_activity && (t0 == 0xE1 || t0 == 0xE2 || t0 == 0xE3)) {
                            JNIEnv* e = grxEnv();
                            if (e) {
                                jbyteArray a = e->NewByteArray((jsize)rec);
                                if (a) {
                                    e->SetByteArrayRegion(a, 0, (jsize)rec, (const jbyte*)rxBuffer);
                                    e->CallVoidMethod(g_activity, g_mid_ctrl, a);
                                    e->DeleteLocalRef(a);
                                }
                            }
                            continue; // not an ACK/RMB
                        }
                    }
                    // Rumble from the PC: "RMB" + largeMotor + smallMotor (5 bytes).
                    // Honour it only from our locked unicast peer (same guard as the
                    // ACK below) so no other LAN host can drive the phone's motor.
                    if (rec >= 5 && rxBuffer[0] == 'R' && rxBuffer[1] == 'M' && rxBuffer[2] == 'B') {
                        uint32_t dst = ntohl(serverAddr.sin_addr.s_addr);
                        bool dstBroadcast = (dst == INADDR_BROADCAST) || ((dst & 0xFF) == 0xFF);
                        if (!dstBroadcast && fromAddr.sin_addr.s_addr != serverAddr.sin_addr.s_addr) {
                            continue; // rumble from an unexpected host — ignore it
                        }
                        rumbleLeft.store((uint8_t)rxBuffer[3], std::memory_order_relaxed);
                        rumbleRight.store((uint8_t)rxBuffer[4], std::memory_order_relaxed);
                        rumbleSeq.fetch_add(1, std::memory_order_relaxed);
                        continue; // keep draining the queue; rumble handled
                    }
                    // ACK is "ACK" (3 bytes) optionally followed by the 8-byte
                    // little-endian timestamp the PC echoed back from the packet
                    // it just processed. We need >=3 bytes starting with "ACK".
                    if (rec < 3 || rxBuffer[0] != 'A' || rxBuffer[1] != 'C' || rxBuffer[2] != 'K') {
                        continue; // Not an ACK (ignore our own 20-byte loopback, etc.)
                    }
                    // Once locked onto the PC's unicast address, only accept ACKs
                    // FROM that address. Otherwise any LAN host could spoof the
                    // link-alive heartbeat or poison the RTT statistic. (During
                    // broadcast discovery the source is by definition unknown.)
                    {
                        uint32_t dest = ntohl(serverAddr.sin_addr.s_addr);
                        bool destIsBroadcast = (dest == INADDR_BROADCAST) || ((dest & 0xFF) == 0xFF);
                        if (!destIsBroadcast && fromAddr.sin_addr.s_addr != serverAddr.sin_addr.s_addr) {
                            continue; // ACK from an unexpected host — ignore it
                        }
                    }
                    {
                        struct timespec ackNow;
                        clock_gettime(CLOCK_MONOTONIC, &ackNow);
                        uint64_t ackNs = (uint64_t)ackNow.tv_sec * 1000000000LL + ackNow.tv_nsec;
                        lastAckMonoNs.store(ackNs, std::memory_order_relaxed);  // link-alive heartbeat

                        // TRUE round-trip: the PC echoed back the exact send-time we
                        // stamped into this packet's `timestamp` field. RTT = now −
                        // that echoed time. (Old code compared against the LAST send,
                        // which had just been overwritten → it measured ~microseconds
                        // between two adjacent C++ lines, not the network. Fixed.)
                        if (rec >= 11) {
                            uint64_t echoed = 0;
                            std::memcpy(&echoed, rxBuffer + 3, 8);  // little-endian on Android
                            if (echoed != 0 && ackNs > echoed) {
                                float rttMs = (float)(ackNs - echoed) / 1000000.0f;
                                if (rttMs >= 0.0f && rttMs < 1000.0f) {  // sanity clamp
                                    float prev = latencyMsAtomic.load(std::memory_order_relaxed);
                                    float smoothed = (prev <= 0.0f) ? rttMs : (prev * 0.8f + rttMs * 0.2f);
                                    latencyMsAtomic.store(smoothed, std::memory_order_relaxed);
                                }
                            }
                        }
                        // Lock onto the PC's unicast IP if we're currently sending to
                        // ANY broadcast address — both limited (255.255.255.255) and a
                        // DIRECTED subnet broadcast (e.g. 192.168.42.255, used for USB).
                        // Detect broadcast by a trailing .255 octet; the ACK source is
                        // the real unicast host, so switching to it stops the wasteful
                        // 1000Hz broadcast and is required on networks that rate-limit it.
                        uint32_t curDest = ntohl(serverAddr.sin_addr.s_addr);
                        bool curIsBroadcast = (curDest == INADDR_BROADCAST) || ((curDest & 0xFF) == 0xFF);
                        if (curIsBroadcast) {
                            serverAddr.sin_addr = fromAddr.sin_addr;
                            char ipStr[INET_ADDRSTRLEN];
                            inet_ntop(AF_INET, &serverAddr.sin_addr, ipStr, sizeof(ipStr));
                            LOGI("Received ACK from PC. Locked destination IP to unicast: %s", ipStr);
                        }
                        // FIX 2: connect() the UDP socket to the locked unicast
                        // peer so the hot path can use send() with a cached route.
                        // Only do this once per peer (and re-connect if the locked
                        // IP ever changes). Never connect() to a broadcast address.
                        {
                            uint32_t lockedDest = ntohl(serverAddr.sin_addr.s_addr);
                            bool lockedIsBroadcast = (lockedDest == INADDR_BROADCAST) || ((lockedDest & 0xFF) == 0xFF);
                            bool peerChanged = (serverAddr.sin_addr.s_addr != connectedPeer.s_addr);
                            if (!lockedIsBroadcast && (!socketConnected || peerChanged)) {
                                if (connect(udpSocket, (struct sockaddr*)&serverAddr, sizeof(serverAddr)) == 0) {
                                    socketConnected = true;
                                    connectedPeer = serverAddr.sin_addr;
                                    char cIp[INET_ADDRSTRLEN];
                                    inet_ntop(AF_INET, &serverAddr.sin_addr, cIp, sizeof(cIp));
                                    LOGI("UDP socket connect()ed to peer %s — hot path now uses send().", cIp);
                                } else {
                                    // connect() failed: fall back to sendto() (leave
                                    // socketConnected false). Non-fatal, best-effort.
                                    LOGE("connect() to locked peer failed (errno %d); keeping sendto() path.", errno);
                                }
                            }
                        }
                        break; // Successfully handled the ACK, exit the loop
                    }
                }
            }
        }

        // AOA RX: drain ACK / rumble from the accessory fd (raw USB bulk IN ← PC).
        // USB is point-to-point, so there's no source-address spoofing to guard
        // against and no broadcast lock-on / connect() — far simpler than UDP RX.
        if (accessoryMode && accessoryFd != -1) {
            uint8_t rxBuffer[64];
            while (true) {
                ssize_t rec = read(accessoryFd, rxBuffer, sizeof(rxBuffer));
                if (rec <= 0) break; // EAGAIN (empty) or fd closed
                // Rumble: "RMB" + largeMotor + smallMotor (5 bytes).
                if (rec >= 5 && rxBuffer[0] == 'R' && rxBuffer[1] == 'M' && rxBuffer[2] == 'B') {
                    rumbleLeft.store(rxBuffer[3], std::memory_order_relaxed);
                    rumbleRight.store(rxBuffer[4], std::memory_order_relaxed);
                    rumbleSeq.fetch_add(1, std::memory_order_relaxed);
                    continue;
                }
                // ACK: "ACK" + 8-byte echoed send-timestamp → true round-trip latency.
                if (rec >= 3 && rxBuffer[0] == 'A' && rxBuffer[1] == 'C' && rxBuffer[2] == 'K') {
                    struct timespec ackNow;
                    clock_gettime(CLOCK_MONOTONIC, &ackNow);
                    uint64_t ackNs = (uint64_t)ackNow.tv_sec * 1000000000LL + ackNow.tv_nsec;
                    lastAckMonoNs.store(ackNs, std::memory_order_relaxed);
                    if (rec >= 11) {
                        uint64_t echoed = 0;
                        std::memcpy(&echoed, rxBuffer + 3, 8);
                        if (echoed != 0 && ackNs > echoed) {
                            float rttMs = (float)(ackNs - echoed) / 1000000.0f;
                            if (rttMs >= 0.0f && rttMs < 1000.0f) {
                                float prev = latencyMsAtomic.load(std::memory_order_relaxed);
                                float smoothed = (prev <= 0.0f) ? rttMs : (prev * 0.8f + rttMs * 0.2f);
                                latencyMsAtomic.store(smoothed, std::memory_order_relaxed);
                            }
                        }
                    }
                    continue;
                }
            }
        }

        // Exponential backoff recovery state (UDP only — AOA has no socket to recover).
        if (!accessoryMode && udpSocket == -1 && isRunning) {
            int backoff = 50; // ms
            while (isRunning && udpSocket == -1) {
                udpSocket = socket(AF_INET, SOCK_DGRAM, 0);
                if (udpSocket != -1) {
                    int flags = fcntl(udpSocket, F_GETFL, 0);
                    fcntl(udpSocket, F_SETFL, flags | O_NONBLOCK);
                    int broadcastEnable = 1;
                    setsockopt(udpSocket, SOL_SOCKET, SO_BROADCAST, &broadcastEnable, sizeof(broadcastEnable));
                    applyLowLatencyTos(udpSocket);
                    // FIX 2: a fresh socket is unconnected. Force re-discovery via
                    // sendto() until we re-lock + re-connect() to the unicast peer.
                    socketConnected = false;
                    connectedPeer.s_addr = 0;
                    LOGI("Socket successfully recovered.");
                    break;
                }
                LOGE("Socket recovery failed. Retrying in %d ms...", backoff);
                // Split ms into sec + nsec: tv_nsec must be < 1e9, and at the
                // 1000ms cap the old {0, backoff*1e6} hit exactly 1e9 → EINVAL →
                // nanosleep returned immediately → 100% CPU busy-spin.
                struct timespec backoffTime = {backoff / 1000, (long)(backoff % 1000) * 1000000L};
                nanosleep(&backoffTime, NULL);
                backoff = std::min(backoff * 2, 1000);
            }
        }

        // Event-driven wait: block until injectNativePayload signals new input
        // (payloadDirty) so a fresh touch is sent within microseconds instead of
        // waiting out a poll tick — or until RX_POLL_NS elapses so ACK/rumble keep
        // draining, redundancy resends fire ~2ms apart, and the ~30Hz keep-alive
        // still goes out when the pad is held steady. The predicate also guards
        // against lost wakeups (input that arrives between snapshot and wait).
        {
            std::unique_lock<std::mutex> lock(payloadMutex);
            if (!payloadDirty && isRunning) {
                payloadCv.wait_for(lock, std::chrono::nanoseconds(RX_POLL_NS),
                                   [] { return payloadDirty || !isRunning.load(); });
            }
        }
    }
    // GRX: the grxSeal / onGrxControl up-calls (grxEnv) JVM-attach THIS thread on
    // demand. A pthread that exits while still attached makes ART abort the process
    // ("native thread exited without detaching"), so detach before returning. Safe
    // whether or not we ever attached — GetEnv reports JNI_EDETACHED when we didn't,
    // and we skip the detach in that case.
    if (g_vm) {
        JNIEnv* je = nullptr;
        if (g_vm->GetEnv((void**)&je, JNI_VERSION_1_6) != JNI_EDETACHED)
            g_vm->DetachCurrentThread();
    }
    return nullptr;
}

// ==========================================
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_injectNativePayload(JNIEnv* env, jobject thiz, jbyteArray data) {
    // Choke point of the streaming gate: while streaming is off, EVERY payload
    // source (JS heartbeat, touch, gyro) is dropped here, so nothing can
    // overwrite the neutral latched by setInputStreamingNative.
    if (!inputStreaming.load(std::memory_order_relaxed)) return;
    jsize len = env->GetArrayLength(data);
    if (len == sizeof(GamepadPayload)) {
        // FIX 5: single-copy JNI. GetByteArrayRegion copies the 20 bytes straight
        // into currentPayload (no Get/Release pin pair, no intermediate buffer +
        // extra memcpy). Done under payloadMutex so it can't tear against the TX
        // thread's read. The 20-byte length guard above is preserved.
        {
            std::lock_guard<std::mutex> lock(payloadMutex);
            env->GetByteArrayRegion(data, 0, sizeof(GamepadPayload), reinterpret_cast<jbyte*>(&currentPayload));
            payloadDirty = true;
        }
        // Wake the TX thread NOW so this input transmits immediately rather than on
        // the next poll tick. Notify after releasing the lock so the woken thread
        // doesn't immediately block on a mutex we still hold.
        payloadCv.notify_one();
    }
}

extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_setInputStreamingNative(JNIEnv*, jobject, jboolean on) {
    bool was = inputStreaming.exchange(on != JNI_FALSE, std::memory_order_relaxed);
    if (was && on == JNI_FALSE) {
        // Turning OFF: latch neutral and push it out NOW, so the PC's pad drops
        // to rest within one poll instead of holding the last real input until
        // its own 0.5s anti-stuck kicks in. Same locking discipline as
        // injectNativePayload; timestamp/auth are stamped by the TX thread.
        {
            std::lock_guard<std::mutex> lock(payloadMutex);
            currentPayload.buttons = 0;
            currentPayload.leftTrigger = 0;  currentPayload.rightTrigger = 0;
            currentPayload.leftStickX = 128; currentPayload.leftStickY = 128;
            currentPayload.rightStickX = 128; currentPayload.rightStickY = 128;
            payloadDirty = true;
        }
        payloadCv.notify_one();
        LOGI("input streaming OFF — payload latched neutral (keep-alive continues)");
    } else if (!was && on != JNI_FALSE) {
        LOGI("input streaming ON");
    }
}

// ==========================================
// 4. JNI LIFECYCLE HOOKS
// ==========================================

// GRX down-calls (Kotlin -> C++). Inert until grxReady is set by the wiring.
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_nativeGrxSendRaw(JNIEnv* env, jobject, jbyteArray data) {
    if (udpSocket < 0) return;                 // send handshake bytes on the engine's socket
    jsize n = env->GetArrayLength(data);
    jbyte* b = env->GetByteArrayElements(data, nullptr);
    if (b) {
        // Mirror the hot path: send() once connect()ed, else sendto(serverAddr) so the
        // handshake still goes out during discovery (before the unicast peer is locked).
        if (socketConnected) {
            send(udpSocket, b, (size_t)n, MSG_DONTWAIT);
        } else {
            sendto(udpSocket, b, (size_t)n, MSG_DONTWAIT,
                   (struct sockaddr*)&serverAddr, sizeof(serverAddr));
        }
        env->ReleaseByteArrayElements(data, b, JNI_ABORT);
    }
}
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_nativeSetGrxReady(JNIEnv*, jobject, jboolean ready) {
    grxReady.store(ready == JNI_TRUE);
}

extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_initNetworkNative(JNIEnv* env, jobject thiz, jstring ipStr, jint port, jstring keyStr) {
    // Re-init guard: starting while already running would leak the previous
    // udpSocket and orphan the old 1000Hz thread (its handle gets overwritten).
    // Callers are supposed to stopNetworkNative() first; enforce it here.
    if (isRunning) {
        LOGE("initNetworkNative called while engine already running — ignoring (stop first).");
        return;
    }
    // GRX: cache the activity + seal/control method ids for the hot-path/RX up-calls (once).
    if (!g_activity) {
        g_activity = env->NewGlobalRef(thiz);
        jclass c = env->GetObjectClass(thiz);
        g_mid_seal = env->GetMethodID(c, "grxSeal", "([B)[B");
        g_mid_ctrl = env->GetMethodID(c, "onGrxControl", "([B)V");
    }
    const char* ip = env->GetStringUTFChars(ipStr, 0);
    const char* key = env->GetStringUTFChars(keyStr, 0);
    if (ip == nullptr || key == nullptr) {
        if (ip != nullptr) env->ReleaseStringUTFChars(ipStr, ip);
        if (key != nullptr) env->ReleaseStringUTFChars(keyStr, key);
        return;
    }

    // Parse security hash
    expectedHash = (uint32_t)strtoul(key, NULL, 16);

    // Setup UDP Socket
    udpSocket = socket(AF_INET, SOCK_DGRAM, 0);
    if (udpSocket != -1) {
        int flags = fcntl(udpSocket, F_GETFL, 0);
        fcntl(udpSocket, F_SETFL, flags | O_NONBLOCK);
        int broadcastEnable = 1;
        setsockopt(udpSocket, SOL_SOCKET, SO_BROADCAST, &broadcastEnable, sizeof(broadcastEnable));
        applyLowLatencyTos(udpSocket);
    }
    // FIX 2: start unconnected — the hot path uses sendto() during broadcast
    // discovery and only switches to send() after we connect() to the locked peer.
    socketConnected = false;
    connectedPeer.s_addr = 0;
    memset(&serverAddr, 0, sizeof(serverAddr));
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(port);
    inet_pton(AF_INET, ip, &serverAddr.sin_addr);

    env->ReleaseStringUTFChars(ipStr, ip);
    env->ReleaseStringUTFChars(keyStr, key);

    // Pre-allocate neutral controller state. Hold payloadMutex: the WebView's
    // JS bridge thread can call injectNativePayload concurrently during a
    // reconnect, and these writes must not tear against its memcpy.
    {
        std::lock_guard<std::mutex> lock(payloadMutex);
        // Center = 128 (matches App.tsx 128+norm*127 and server.py (b-128)/127).
        currentPayload.leftStickX = 128;  currentPayload.leftStickY = 128;
        currentPayload.rightStickX = 128; currentPayload.rightStickY = 128;
    }

    // Start Tx Thread
    packetCount = 0;
    lastAckMonoNs.store(0, std::memory_order_relaxed);   // reset link-alive state
    latencyMsAtomic.store(0.0f, std::memory_order_relaxed);
    rumbleLeft.store(0, std::memory_order_relaxed);       // clear stale motor state
    rumbleRight.store(0, std::memory_order_relaxed);      // (seq stays monotonic)
    isRunning = true;
    registerSignalHandler(); // Register the fatal crash signal handler
    pthread_create(&txThread, nullptr, txThreadLoop, nullptr);
    LOGI("Native UDP Engine Initialized and Tx Thread started.");
}

extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_stopNetworkNative(JNIEnv* env, jobject thiz) {
    if (isRunning) {
        isRunning = false;
        payloadCv.notify_all(); // wake the TX thread out of its wait so it exits promptly
        pthread_join(txThread, nullptr);
    }
    // NOTE: no "BYE" packet on purpose. A cleartext, unauthenticated teardown
    // packet lets any LAN host spoof our source IP and kill the session (even a
    // GRX-encrypted one) with 3 bytes. The server's idle watchdog cleans up the
    // pad within ~3s anyway — that latency is the price of not shipping a
    // remote kill-switch.
    if (udpSocket != -1) {
        close(udpSocket);
        udpSocket = -1;
    }
    if (accessoryFd != -1) {
        // We took fd ownership via ParcelFileDescriptor.detachFd() on the Kotlin
        // side, so we are responsible for closing it.
        close(accessoryFd);
        accessoryFd = -1;
    }
    accessoryMode = false;
    // FIX 2: clear connected-socket state so the next init starts fresh.
    socketConnected = false;
    connectedPeer.s_addr = 0;
    LOGI("Native Engine Stopped.");
}

// Start the engine on the AOA direct-USB transport. `fd` is the raw file descriptor
// from UsbManager.openAccessory(...).detachFd() — ownership transfers to native.
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_initAccessoryNative(JNIEnv* env, jobject thiz, jint fd) {
    (void)env; (void)thiz;
    // Re-init guard (same contract as initNetworkNative): stop first.
    if (isRunning) {
        LOGE("initAccessoryNative called while engine already running — ignoring (stop first).");
        return;
    }
    if (fd < 0) {
        LOGE("initAccessoryNative: invalid fd %d", (int)fd);
        return;
    }
    accessoryFd = (int)fd;
    // Non-blocking so the TX thread's RX drain never blocks on read().
    int aflags = fcntl(accessoryFd, F_GETFL, 0);
    if (aflags != -1) fcntl(accessoryFd, F_SETFL, aflags | O_NONBLOCK);
    accessoryMode = true;
    udpSocket = -1;              // AOA path uses no UDP socket
    socketConnected = false;
    connectedPeer.s_addr = 0;
    expectedHash = 0;           // USB transport: authToken unused by the server's AOA loop

    // Neutral controller state (same as the UDP init), guarded against the JS
    // bridge thread's concurrent injectNativePayload. Center = 128 (matches
    // App.tsx and server.py).
    {
        std::lock_guard<std::mutex> lock(payloadMutex);
        currentPayload.leftStickX = 128;  currentPayload.leftStickY = 128;
        currentPayload.rightStickX = 128; currentPayload.rightStickY = 128;
    }

    packetCount = 0;
    lastAckMonoNs.store(0, std::memory_order_relaxed);
    latencyMsAtomic.store(0.0f, std::memory_order_relaxed);
    rumbleLeft.store(0, std::memory_order_relaxed);
    rumbleRight.store(0, std::memory_order_relaxed);
    isRunning = true;
    registerSignalHandler();
    pthread_create(&txThread, nullptr, txThreadLoop, nullptr);
    LOGI("Native AOA Accessory Engine initialized (fd=%d) and Tx Thread started.", accessoryFd);
}

extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_initGameplaySurface(JNIEnv* env, jobject thiz, jobject surface, jint width, jint height) {
    (void)env; (void)thiz; (void)surface;
    screenWidthFloat = (float)width;
    screenHeightFloat = (float)height;
    LOGI("Surface dimensions locked at %f x %f", screenWidthFloat, screenHeightFloat);
}

extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_destroyGameplaySurface(JNIEnv* env, jobject thiz) {
    (void)env; (void)thiz;
    LOGI("Surface destroyed.");
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_gamepad_client_MainActivity_getNativePacketCount(JNIEnv* env, jobject thiz) {
    return (jlong)packetCount.load();
}

// Real measured round-trip latency in milliseconds (0 if no ACK yet).
extern "C" JNIEXPORT jfloat JNICALL
Java_com_gamepad_client_MainActivity_getNativeLatencyMs(JNIEnv* env, jobject thiz) {
    return (jfloat)latencyMsAtomic.load(std::memory_order_relaxed);
}

// Milliseconds since the last ACK from the PC, or -1 if no ACK ever received.
// The UI treats the link as CONNECTED only when this is small (PC responding).
extern "C" JNIEXPORT jlong JNICALL
Java_com_gamepad_client_MainActivity_getMsSinceLastAck(JNIEnv* env, jobject thiz) {
    uint64_t last = lastAckMonoNs.load(std::memory_order_relaxed);
    if (last == 0) return (jlong)-1;
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    uint64_t nowNs = (uint64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
    if (nowNs <= last) return 0;
    return (jlong)((nowNs - last) / 1000000ULL);
}

// Latest Wi-Fi rumble, packed for one cheap JNI poll from JS:
//   bits 16+   = sequence (changes whenever a new RMB datagram arrived)
//   bits 8..15 = left / large motor   (0..255)
//   bits 0..7  = right / small motor  (0..255)
// JS polls this and fires the vibrator only when the sequence changes, so the
// user's on/off toggle and intensity slider still apply (same path as USB).
extern "C" JNIEXPORT jlong JNICALL
Java_com_gamepad_client_MainActivity_getNativeRumble(JNIEnv* env, jobject thiz) {
    uint32_t seq = rumbleSeq.load(std::memory_order_relaxed);
    int l = rumbleLeft.load(std::memory_order_relaxed) & 0xFF;
    int r = rumbleRight.load(std::memory_order_relaxed) & 0xFF;
    return ((jlong)seq << 16) | (jlong)(l << 8) | (jlong)r;
}
