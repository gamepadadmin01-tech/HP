# GRX — Android engine wiring (code-grounded, device session)

Read of the real code (`gamepad-engine.cpp`, `MainActivity.kt`) — the key constraint:

> **The C++ engine owns the UDP socket end-to-end.** It creates it
> (`gamepad-engine.cpp:468`), `connect()`s to the locked peer (`:407`), builds the
> 20-byte `networkPayload` and sets `authToken = htole32(expectedHash)` (`:254`),
> and sends on the hot TX thread via `send(udpSocket, &networkPayload, 20, …)`
> (`:269`, fallback `sendto` `:273`). ACK/RMB receive is also in C++.
> `initNetworkNative(ip, port, key)` (`MainActivity.kt:43`) passes the pairing key
> down; the key reaches Kotlin from the QR scan (`connectToPC(...key)` `:327`,
> `serverKey = key` `:345`).

So Kotlin's `GrxClient` (which assumes a `send` callback) must bridge that callback
into C++, and C++ must route inbound handshake frames up to Kotlin. This is a
JNI-bridged feature — do it on-device (it can't be compile/run-verified off-device).

## Recommended: Option A (Kotlin seals via JNI) — reuses the TESTED crypto
Keeps all crypto in the verified `GrxCrypto.kt`/`GrxClient.kt`. Adds a JNI bridge.
Per-packet JNI up-call is µs-class — fine at this latency tier; profile, then move
to Option B only if it shows up.

**C++ side (gamepad-engine.cpp):**
1. Add `std::atomic<bool> grxReady{false};` (default false → working path untouched).
2. Cache the `JavaVM*` in `JNI_OnLoad`; helper to get a JNIEnv on the TX/RX threads
   (`AttachCurrentThread` once per thread, cache the method IDs).
3. **New JNI down-call** `nativeGrxSendRaw(JNIEnv*, jobject, jbyteArray)` → just
   `send(udpSocket, bytes, len, MSG_DONTWAIT)`. Kotlin uses this to send HELLO/CONFIRM.
4. **Hot-path hook** at the send site (`:269`/`:273`): 
   ```cpp
   if (grxReady.load()) {
       jbyteArray wire = upcall_grxSeal(env, payloadBytes20);   // -> 41-byte frame
       send(udpSocket, wireBytes, 41, MSG_DONTWAIT);
   } else {
       send(udpSocket, &networkPayload, sizeof(GamepadPayload), MSG_DONTWAIT);  // legacy
   }
   ```
5. **RX hook**: when an inbound datagram's first byte is 0xE1/0xE2/0xE3 (GRX control),
   up-call `onGrxControl(byte[])` instead of the ACK/RMB handling; leave 20→ACK/RMB as-is.
   (s2c rumble stays cleartext in v1 — server doesn't encrypt it yet.)

**Kotlin side (MainActivity.kt):**
```kotlin
private var grx: GrxClient? = null
private external fun nativeGrxSendRaw(bytes: ByteArray)
private external fun nativeSetGrxReady(ready: Boolean)

// on connectToPC(ip, port, key) — key is the scanned pairing key (:345):
grx = GrxClient(GrxCrypto.pskFromPairingKey(key), GrxCrypto.GRX_LTID) { nativeGrxSendRaw(it) }
grx?.start()                                   // sends CLIENT_HELLO via C++

// JNI up-call target, invoked by C++ RX for control frames:
fun onGrxControl(frame: ByteArray) {
    grx?.onServerMessage(frame)
    if (grx?.established == true) nativeSetGrxReady(true)   // flips the hot-path hook
}

// JNI up-call target, invoked by C++ hot path to seal:
fun grxSeal(frame20: ByteArray): ByteArray? = grx?.seal(frame20)
```
- `nativeSetGrxReady(true)` sets the C++ `grxReady` atomic once the handshake completes.
- If `grxSeal` returns null (not yet established), C++ should fall back to NOT sending
  that frame (or send legacy) — but with `grxReady` only set after `established`, this
  won't happen in practice.

## Option B (native crypto in C++) — preserves the hot path, more work
Bundle mbedTLS (has AES-128-GCM, X25519/ECDH, HKDF) in the CMake build; reimplement
the handshake + per-packet seal in C++ byte-matching `grx_crypto.py`/GRX_PROTOCOL.md.
No JNI per packet. Do this only if Option A's up-call cost is measured to matter.
(libsodium's AEAD is AES-256-GCM, not AES-128 — would force a spec change; mbedTLS fits.)

## Ready-to-paste C++ bridge (Option A) — gamepad-engine.cpp

Kotlin side is already in MainActivity.kt (dormant behind `GRX_ENABLED=false`). Paste
the native half below, then flip `GRX_ENABLED=true`. `grxReady` defaults false → the
existing send path is byte-identical until the handshake completes, so this is safe to
add incrementally.

```cpp
// --- (1) globals, near the other engine globals (~top, by udpSocket/expectedHash) ---
#include <atomic>
static JavaVM*   g_vm = nullptr;
static jobject   g_activity = nullptr;       // global ref to MainActivity
static jmethodID g_mid_seal = nullptr;       // byte[] grxSeal(byte[])
static jmethodID g_mid_ctrl = nullptr;       // void onGrxControl(byte[])
static std::atomic<bool> grxReady{false};

static JNIEnv* grxEnv() {                     // JNIEnv for whatever thread calls us
    JNIEnv* e = nullptr;
    if (g_vm->GetEnv((void**)&e, JNI_VERSION_1_6) == JNI_EDETACHED)
        g_vm->AttachCurrentThread(&e, nullptr);
    return e;
}

// --- (2) cache the VM (merge into JNI_OnLoad if one already exists) ---
extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) { g_vm = vm; return JNI_VERSION_1_6; }

// --- (3) in initNetworkNative(env, thiz, ...): cache the activity + method ids ONCE ---
//     g_activity = env->NewGlobalRef(thiz);
//     jclass c = env->GetObjectClass(thiz);
//     g_mid_seal = env->GetMethodID(c, "grxSeal",      "([B)[B");
//     g_mid_ctrl = env->GetMethodID(c, "onGrxControl", "([B)V");

// --- (4) Kotlin->C++ down-call: send raw bytes (handshake) on the udp socket ---
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_nativeGrxSendRaw(JNIEnv* env, jobject, jbyteArray data) {
    jsize n = env->GetArrayLength(data);
    jbyte* b = env->GetByteArrayElements(data, nullptr);
    if (udpSocket >= 0) send(udpSocket, b, (size_t)n, MSG_DONTWAIT);
    env->ReleaseByteArrayElements(data, b, JNI_ABORT);
}
extern "C" JNIEXPORT void JNICALL
Java_com_gamepad_client_MainActivity_nativeSetGrxReady(JNIEnv*, jobject, jboolean r) {
    grxReady.store(r == JNI_TRUE);
}

// --- (5) HOT PATH: replace the send at gamepad-engine.cpp:269/:273 with: ---
//   if (grxReady.load() && g_mid_seal) {
//       JNIEnv* e = grxEnv();
//       jbyteArray in = e->NewByteArray(sizeof(GamepadPayload));
//       e->SetByteArrayRegion(in, 0, sizeof(GamepadPayload), (const jbyte*)&networkPayload);
//       jbyteArray wire = (jbyteArray)e->CallObjectMethod(g_activity, g_mid_seal, in);
//       if (wire) {
//           jsize wn = e->GetArrayLength(wire);
//           jbyte* wb = e->GetByteArrayElements(wire, nullptr);
//           sent = send(udpSocket, wb, (size_t)wn, MSG_DONTWAIT);   // 41-byte encrypted frame
//           e->ReleaseByteArrayElements(wire, wb, JNI_ABORT);
//           e->DeleteLocalRef(wire);
//       }
//       e->DeleteLocalRef(in);
//   } else {
//       sent = send(udpSocket, &networkPayload, sizeof(GamepadPayload), MSG_DONTWAIT);  // legacy
//   }

// --- (6) RX: when an inbound datagram's first byte is a GRX control type, route it up ---
//   if (recvLen > 0 && (rxbuf[0]==0xE1 || rxbuf[0]==0xE2 || rxbuf[0]==0xE3)) {
//       JNIEnv* e = grxEnv();
//       jbyteArray a = e->NewByteArray(recvLen);
//       e->SetByteArrayRegion(a, 0, recvLen, (const jbyte*)rxbuf);
//       e->CallVoidMethod(g_activity, g_mid_ctrl, a);
//       e->DeleteLocalRef(a);
//       continue;   // not an ACK/RMB
//   }
```
Then in Kotlin `connectToPC`, call `grx?.start()` **after** `initNetworkNative(...)` so the
socket exists before CLIENT_HELLO is sent. Flip `GRX_ENABLED=true`.

## Device-test checklist (unchanged)
- [ ] Builds (Tink + JNI methods compile); APK installs (same release.keystore).
- [ ] Handshake completes; `grxReady` flips; encrypted input drives the pad.
- [ ] Wrong-PSK/tampered peer → no input. RTT (echoed timestamp) shows no regression.
- [ ] Flip server `GRX_REQUIRED=True`, remove the legacy branch, bump versions.

## Why this wasn't auto-edited
The hooks above are in the C++ hot path + JNI bridge — untestable off-device and a
wrong native edit can crash the live app. Server side is fully wired + tested; this
is the one part that must be finished with the phone connected. `grxReady` defaults
false so even a partial wiring leaves the working cleartext path intact.
