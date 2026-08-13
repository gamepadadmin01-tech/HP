---
name: downloads-feedback-platform
description: "Downloads counter + in-app/PC feedback routed to the admin portal, and the live wrong-flavour-APK bug"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04fa20ba-c801-4536-9b63-6783224ac0d6
  modified: 2026-08-13T18:51:38.305Z
---

Built 2026-06-22 across the website backend, admin portal, both clients and the installer. Sits on
[[website-backend-architecture]].

## What it does

- **Feedback** from the PC server (Tkinter dialog) and the Android app (About tab) POSTs to
  `/api/support/ticket` with `source` = `pc` | `mobile` | `web`, so it lands in the normal ticket
  flow tagged with a 🖥/📱 badge. Email is required so every message is repliable.
- **Downloads** are counted as **unique users by IP/day** — `recordDownload()` stores a salted
  SHA-256 of the IP with a `@@unique([asset, ipHash, day])` constraint. `GET /api/download/:asset`
  records then serves. Live stat-cards in the admin portal via SSE `download:update`.
- `publicCors` (`origin:true`, no credentials) sits **before** the allowlist CORS on
  `/api/support/ticket` and `/api/download` so the WebView and PC client can post cross-origin.

Prisma needs `prisma db push` on deploy — it runs in `prestart`.

## 🚨 Live bug: the website serves the wrong APK flavour

The active release on the site is an **amazonstore** build (`GamepadOS-1.3.21.apk` == the
amazonstore artifact). Only the `direct` flavour has the in-app updater compiled in — every other
flavour has it stripped. **So the self-updater is dead for everyone who downloaded from the
website.** Fix: publish the *direct* APK and Register & Activate it
([[reference_release_checklist]]).

## Two things that look like bugs but are not

- **"+N today" counts RETURNING downloaders, not new ones.** The `unique` total legitimately sits
  flat while "+N today" moves. Not a counting error.
- **The Amazon rejection of 1.3.0 / 1.3.21 was a false positive** — the artifacts contain zero ad
  libraries. Worth appealing rather than rebuilding.

## Known state

- A `/admin/analytics` page plus `analytics.js` were built but were **uncommitted** as of
  2026-07-16 — check before rebuilding them.
- 1.3.21 store artifacts were rebuilt and hardened; aptoide was dropped as a channel.
- Mobile feedback was originally broken because the UI loaded from a `file://` origin, which modern
  WebView blocks `fetch()` from. Fixed in 1.3.1 by serving via `WebViewAssetLoader` from
  `https://appassets.androidplatform.net/`, with a one-time localStorage migration so users didn't
  lose their custom pads on the origin switch.

Blow-by-blow history: `context/archive/memory-history/project_downloads_feedback_FULL_2026-08-14.md`.
