---
name: kotlin-jni-internal-mangling
description: "GamepadOS gotcha: marking an `external fun` `internal` in Kotlin breaks JNI at runtime (name mangling) — compiles fine, crashes on device"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 664c6c96-23e9-4864-92eb-4e269c0d4182
  modified: 2026-07-21T03:16:02.169Z
---

**Never mark a Kotlin `external fun` (JNI method) as `internal`.** Kotlin
name-mangles `internal` members with a `$module` suffix, so the symbol the C++
side exports no longer matches. It **compiles cleanly and only fails at
runtime** with `UnsatisfiedLinkError: No implementation found for ...
injectNativePayload$GamepadClient_app_directRelease(byte[])`.

Hit for real on 2026-07-20 in `apps/android-client/.../MainActivity.kt` while
wiring the Phase 3 native input engine: `injectNativePayload` was widened from
`private` to `internal` so another class could call it → instant force-close the
moment the controller screen opened (thrown on the gyro-sensor thread).

**How to apply:** keep the `external fun` `private` (or public — public is not
mangled) and expose it through a **plain Kotlin wrapper**, which is safe to
mangle:
```kotlin
private external fun injectNativePayload(data: ByteArray)
internal fun injectPayload(data: ByteArray) = injectNativePayload(data)
```
Also catch **`Throwable`, not `Exception`**, around JNI calls made from sensor
or touch threads — a linkage failure raises an `Error`, which `catch (e: Exception)`
does not catch, so it kills the whole app.

**Why:** this class of bug is invisible to every pre-device check (gradle build,
lint, unit tests all pass), so it can only be caught by installing and running.
Always launch the app on the phone after touching a JNI signature.

Related: [[realtime-latency-stack]], [[gamepados-double-pad-bug]].
