---
name: latest-tooling
description: "User wants dependencies/build tools kept on current versions, not old ones — incl. Android"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6098ea47-06de-42b9-a2c6-9d4070ced1e7
  modified: 2026-08-12T13:53:17.776Z
---

The user wants tooling and dependencies kept CURRENT across the whole project (web, backend, PC server, and especially the Android app) — no needlessly old versions.

**Why:** Stated 2026-07-12. They value being on modern, supported versions.

**How to apply:** Prefer current, supported versions. BUT do NOT blind-bump a live app to "absolute latest" — apply patch/minor updates freely, and do MAJOR jumps (Kotlin, AGP/Gradle, React, Express) deliberately with a full build + on-device/behaviour test, because a careless major upgrade can reintroduce regressions on a shipping app. As of 2026-07-12 the web/backend were already very current (Express 5, Tailwind 4, TS 6, Vite 6, Prisma 5).

**DONE 2026-07-12 (Android toolchain modernization, build-verified, NOT device-tested/shipped):** Kotlin 1.9.0 → **2.4.0** (latest; K2). Required: migrating the removed `android{ kotlinOptions{} }` block to the top-level `kotlin{ compilerOptions{ jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8) } }` DSL, and a newer Gradle. Installed **tools/gradle-8.14.4** (Kotlin 2.4's minimum; tools/gradle-8.9 + gradle-8.5 now FAIL on Kotlin 2.4). AndroidX bumped: core-ktx 1.13.1, appcompat 1.7.0, material 1.12.0. **build_apk.bat now points to gradle-8.14.4.** All 5 flavors + native C++ engine build CLEAN. **~~DEFERRED: AGP 8.6.1 → 9.2.0~~ — DONE, verified in source 2026-08-12: root build.gradle.kts now runs `com.android.application` version **9.3.1**, and app/build.gradle.kts is `compileSdk = 36` / `targetSdk = 36` at 1.3.27/code 51.** So the AGP-9 jump the notes deferred was actually taken, and the separate "AGP 8.13 + targetSdk 36" plan recorded in [[downloads-feedback-platform]] was superseded — don't follow that plan, it describes a road not taken. **NDK still pinned 25.1.8937393** (CXX1104 fix). This modernization is at SOURCE level only — next app release (1.3.6+) will use it; do an on-device smoke test before shipping since Kotlin was a major bump. Related: [[project-grx-crypto]].
