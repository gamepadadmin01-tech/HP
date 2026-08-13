---
name: indus-update-api
description: "Indus Appstore Update API is enabled; upload script at F:\\hlooo\\tools\\indus-upload.ps1, key expected in F:\\hlooo\\secrets\\indus-api-key.txt"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 27798912-a432-4944-85a4-bcd9d3b3b0d3
---

Indus Appstore Update API (enabled 2026-07-17 on the developer dashboard; key is a lifetime "O-Bearer" token the user holds — never seen in chat, masked on the dashboard page).

- Base URL: `https://developer-api.indusappstore.com` (old `/apis/indus-developerdashboard-service` base is being deprecated)
- Auth header: `Authorization: O-Bearer <key>` on every request
- Key endpoints (package = `com.gamepad.client`):
  - `POST /devtools/apk/upgrade/{package}` — multipart `file` = APK (upgrade only; initial submission must use the dashboard)
  - `GET /devtools/app/versions/{package}` — uploaded APKs + `reviewState`
  - `GET /devtools/app/app-versions/{package}` — published version history
  - `GET /devtools/app/stats/{package}` — installs / updateCount / install24hrs / appRating
  - `POST /devtools/review/cancel/{package}` — body `{id}` from versions list
  - Errors: 403 bad key, 404 package not on store, 409 already in review, 433 wrong file format
- Helper script: `F:\hlooo\tools\indus-upload.ps1` — default action uploads `F:\hlooo\releases\store\<Version>\GamepadOS-<Version>-indusstore.apk` (default 1.3.21) via curl.exe multipart; `-Check` lists review states, `-Stats` shows installs. Reads key from `F:\hlooo\secrets\indus-api-key.txt` or `INDUS_API_KEY` env var.
- `F:\hlooo\secrets\` is outside all git repos; keep it that way.

Related: [[downloads-feedback-platform]] (store rollout status), GRX update chain in [[grx-crypto-big-update]].
