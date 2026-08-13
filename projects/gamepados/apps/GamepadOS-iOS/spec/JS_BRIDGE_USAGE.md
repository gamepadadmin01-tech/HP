# Native-bridge consumption in the GamepadOS controller UI
Files examined: F:\hlooo\apps\controller-ui\src\app\App.tsx, components\Dialogs.tsx, components\CustomPadEditor.tsx, components\Widgets.tsx. Line numbers below refer to these files.

## (A) Every AndroidBridge method the UI calls

Access pattern everywhere is `const bridge = (window as any).AndroidBridge` followed by `if (bridge && bridge.method)` or optional chaining; almost all calls are inside try/catch.

| Method | Where | Call frequency | Return consumed synchronously? | Expected return format | Fallback when bridge/method missing |
|---|---|---|---|---|---|
| playHaptic(event: string) | App.tsx 160-162 (triggerHaptic), 176 (playHaptic), 195 (rippleHaptic); Widgets.tsx 76 (releaseHaptic) | per-event (every button press/release/ripple) | No | void; arg is semantic intent string ("ripple", "buttonPress", "buttonTap", "buttonRelease") | falls through to `bridge.triggerHaptic(ms)`, then `navigator.vibrate(ms)`; rippleHaptic falls to playHapticWaveform envelope |
| triggerHaptic(ms: number) | App.tsx 164-165 (legacy path inside triggerHaptic) | per-event | No | void | navigator.vibrate(ms) |
| playHapticWaveform(timingsCsv: string, ampsCsv: string) | App.tsx 185-186 | per-event | No | void; both args are comma-joined number lists (`timings.join(",")`) | navigator.vibrate(timings) |
| getGyroscopeDataJson() | App.tsx 487, 516 (useGyro) | **polled setInterval 8 ms (120 Hz)** while controller mounted (data loop; separate rAF loop is display-only) | **Yes — `JSON.parse(bridge.getGyroscopeDataJson())` in the same statement** | JSON string `{nx: deg(±90), ny: deg, age: ms}` (nx/ny already OneEuro-filtered natively) | whole poll skipped; browser uses `deviceorientation` events (App.tsx 594+) |
| getNetworkTelemetryJson() | 7 sites: App.tsx 317 (useLatency), 785 (controller HUD), 1605 (useNetworkTelemetry), 1657 (handleWiredConnect verify), 3831+3851 (onUsbTetherChanged), 3884 (transport reconcile); Dialogs.tsx 346 (QR verify) | polled: 500 ms (useLatency), 200 ms (controller HUD), 500 ms (useNetworkTelemetry), 250 ms ×10 (wired verify), 250 ms ×24 ≈6 s (USB auto-pair verify), 1500 ms forever (reconcile), 150 ms ≤5 s (QR verify) | **Yes — `JSON.parse(...)` in the same expression at every site** (some use `bridge.getNetworkTelemetryJson?.() \|\| "{}"`) | JSON string with `latency:number`, `linkAlive:boolean`, `connectionType:string` ("wired", …), `engineRunning:boolean` | hooks return early → telemetry null → UI renders "—"; when USB-debug WS is open, JS substitutes `{linkAlive:true, latency:w.latency, connectionType:"usbdebug"}` |
| getRumbleState() | App.tsx 705-716 | **polled setInterval 33 ms (~30 Hz)** while controller active | **Yes — `String(bridge.getRumbleState()).split(":")`, `+parts[n]`** | plain string `"seq:left:right"`; fires onRumblePacket only when seq advances | poll never created; rumble arrives only via USB WS worker "RMB" messages |
| triggerRumble(left, right, durMs) | App.tsx 682-683 (inside onRumblePacket) | per rumble packet (≤30 Hz) | No | void; left/right pre-scaled 0..255, dur 20-100 ms | navigator.vibrate(dur) |
| connectToPC(ip, port, keyOrMode) | Dialogs.tsx 339 (QR: parsed key); App.tsx 1639 ("manual"), 1649 ("usb" bcast 255.255.255.255), 3840 (USB auto-pair, directed bcast, "usb"), 3911 (tether reconcile, throttled ≥4 s apart) | one-shot per connect intent | No | void; 3rd arg is pairing key or mode string | QR overlay logs "Mock QR Scan Received" and fakes success (onConnect+onClose); manual/wired just navigate |
| stopEngine() / stopNetworkNative() (legacy alias) | Dialogs.tsx 366 (QR timeout); App.tsx 3860 (USB verify timeout), 3903 (reconcile, usbdebug pref) | one-shot on failure/reconcile | No | void | no-op (try/catch swallow) |
| startCameraScan() | Dialogs.tsx 314 (QRScanOverlay mount), 382 (retryScan) | one-shot | No | void — native opens camera behind transparent WebView | nothing; browser never shows camera |
| stopCameraScan() | Dialogs.tsx 372 (overlay unmount) | one-shot | No | void | no-op |
| getSystemStatsJson() | App.tsx 2770-2786 (TabSystem) | immediate + **setInterval 1500 ms** | **Yes — JSON.parse** | JSON string `{battery:number, temp:number, shizuku:boolean, shizukuRunning:boolean, bypass:boolean}` | state stays defaults; `!isBridge` shows "OFFLINE BROWSER PREVIEW" banner |
| requestShizukuPermission() | App.tsx 2798-2799 | one-shot (button) | No | void | `setShizuku(true)` mock |
| setChargeBypass(v: boolean) | App.tsx 2807-2808 | one-shot (toggle) | No | void | local state only |
| getWifiInfoJson() | App.tsx 3250-3256 (LatencyCard) | immediate + **setInterval 2500 ms** | **Yes — JSON.parse** | JSON string `{band:string ("2.4 GHz"/"5 GHz"...), freq, linkSpeed, rssi}` | LatencyCard returns null (card hidden in browser) |
| isBatteryOptimized() | App.tsx 3253 (same 2500 ms poll) | polled 2500 ms | **Yes — `!!bridge.isBatteryOptimized()`** | boolean | skipped |
| requestBatteryExemption() | App.tsx 3263 | one-shot (Fix button) | No | void | no-op (optional chain) |
| getSafeAreaTop/Bottom/Left/Right() | App.tsx 3798-3808 | one-shot on app mount | **Yes — compared `> 0` and interpolated into CSS var in same statement** | number (px) | CSS vars unset → styles fall back to `env(safe-area-inset-*, 36px/0px)` |
| getUsbBroadcastAddress() | App.tsx 3839 (per tether event), 3894 (1500 ms reconcile) | per-event + polled 1500 ms | **Yes — string compared to "255.255.255.255" / used as connect target** | string, e.g. "192.168.42.255" | falls back to "255.255.255.255" limited broadcast |
| setScreenOrientation("landscape"\|"portrait") | App.tsx 3931/3943 (navigateTo), 3963/3970 (openEditor/closeEditor), 3980 (preset editor); CustomPadEditor.tsx 370-376 (mount/unmount) | one-shot per navigation | No | void | CustomPadEditor CSS-rotates 90° when `!hasBridge && isPortrait` (397-401) |
| exitApp() | App.tsx 4062-4063 (back at root view) | one-shot | No | void | nothing happens |
| getAppVersionName() / getAppVersionCode() | App.tsx 3114-3115 (getInstalledVersion, memoized once) | one-shot on mount | **Yes — `String(...)` / `Number(...) \|\| 0`** | string / number | defaults "1.0" / 0 |
| startApkUpdate(url, sha256) | App.tsx 3155-3157 | one-shot (Update button) | No | void; progress via `__onUpdateProgress`/`__onUpdateStatus` callbacks | falls back to `openUrl(url)` |
| openUrl(url) | App.tsx 1757 (download link), 3158/3160 (update fallback) | one-shot | No | void | `window.open(url, "_blank")` |

Separate JSI global (NOT on AndroidBridge): **`window.sendGamepadPacket(buffer: ArrayBuffer)`** — App.tsx 977-986. Called synchronously on EVERY input edge (button dn/up, stick move, trigger, and each 8 ms gyro tick via sendTelemetryRef), i.e. bursts up to 120 Hz. Return ignored. Priority: USB-debug WS if open, else jsiSend; if jsiSend absent (browser), renders emulated hex HUD telemetry instead (989-1003).

## (B) window.* globals the UI defines for native→JS callbacks

| Global | Defined at | Argument shape | Lifetime |
|---|---|---|---|
| `window.onQRScanned(payload: string)` | Dialogs.tsx 316 | raw QR payload string (formats: "ip,port,key", http/gamepad URL, JSON `{ip/host, port, key/password}`, or "ip:port") | while QRScanOverlay mounted; `delete` on unmount |
| `window.onUsbTetherChanged(active: boolean)` | App.tsx 3822 | boolean — USB tether interface up/down | app-root lifetime |
| `window.onRumblePacket(left, right, ltHaptic, rtHaptic)` | App.tsx 670 | four numbers 0-255 | while controller view active; also invoked from JS itself (USB WS worker "RMB" and the 33 ms getRumbleState poll) |
| `window.handleAndroidBack()` | App.tsx 4048 | no args; called by native on back gesture | app-root lifetime |
| `window.__onUpdateProgress(pct: number)` | App.tsx 3144 | download percent 0-100 | while UpdateChecker mounted |
| `window.__onUpdateStatus(phase: string, msg: string)` | App.tsx 3146 | phase ∈ "downloading"/"installing"/"error"/"permission" | while UpdateChecker mounted |

JS-internal window globals (not called by native, but shared cross-component): `__dashboardCloseDialog()` → boolean (App 3439, consulted by handleAndroidBack), `hapticsEnabled: boolean` (App 4023, read by all haptic helpers incl. Widgets), `__usbWS` (App 444, WebSocket worker singleton), and `window.exitSession` which is READ at App 4075 (called when view returns to "scanner") but never defined in these four files — guarded with `if (exitFn)`.

## (C) Native-app vs browser detection

Detection is simply `typeof window !== "undefined" && !!(window as any).AndroidBridge`:
- `isBridge` — App.tsx 2757 (TabSystem)
- `hasBridge` — CustomPadEditor.tsx 397
- plus per-call `if (bridge && bridge.method)` guards everywhere else, and `!jsiSend` (absence of window.sendGamepadPacket) for the packet path.

Browser-mode differences: red "OFFLINE BROWSER PREVIEW" banner in System tab (App 2815-2818); CustomPadEditor CSS-rotates content 90° instead of physically rotating the device; QR overlay fakes a successful pair on any onQRScanned call; packet builder shows emulated hex HUD instead of sending; latency/telemetry stay null → "—"; LatencyCard hidden; haptics degrade to navigator.vibrate; safe-area CSS vars fall back to `env(safe-area-inset-*, 36px top / 0px bottom)`; APK update falls back to window.open. Also App.tsx 3380-3386 uses `window.visualViewport` (offsetTop/height, falling back to window.innerHeight) to keep the blueprint dialog visible above the Android soft keyboard.

## (D) QR scanning UX flow

1. ScannerScreen sets `showScanner=true` → mounts `QRScanOverlay` (App 1690; component in Dialogs.tsx 300).
2. On mount the overlay calls `bridge.startCameraScan()` (Dialogs 314). **The camera preview is native** — rendered behind the transparent WebView; JS only draws the header/footer masks, transparent cutout and laser-sweep animation (`scanner-overlay-active`).
3. Native decodes a QR and calls `window.onQRScanned(payload)`. JS parses via `parsePairingPayload` (Dialogs 261-298: CSV / URL / JSON / ip:port forms, strict IPv4 + port validation; invalid → "failed" status, keep scanning).
4. On valid payload: force `gp_wired_pref = "auto"`, call `bridge.connectToPC(ip, port, key)`, set status "verifying", then poll `getNetworkTelemetryJson` every **150 ms** for `linkAlive`; success → `onConnect()` (dashboard) + `onClose()`. 5 s timeout → "failed" message + `stopEngine()`/`stopNetworkNative()`.
5. Retry button re-calls `startCameraScan()`; unmount calls `stopCameraScan()` and deletes `window.onQRScanned`.
6. No bridge → mock: logs payload, immediately onConnect()+onClose().

## (E) Exact polling rates

- **getGyroscopeDataJson: 8 ms setInterval (120 Hz)** data loop (App 507-567) — comment explicitly notes each read is "a synchronous JNI hop" and 250 Hz was rejected for jank. A separate requestAnimationFrame loop (60/120 Hz) does display-only smoothing; it never touches the bridge.
- **getRumbleState: 33 ms setInterval (~30 Hz)** (App 707-716), fires onRumblePacket only when `seq` advances.
- **getNetworkTelemetryJson:** 200 ms (controller HUD, App 778-791); 500 ms (useLatency App 315-320 and useNetworkTelemetry App 1598-1608); 1500 ms (transport reconcile, App 3922); 250 ms ×10 = 2.5 s (wired connect verify, App 1653-1677); 250 ms ×24 ≈ 6 s (USB auto-pair verify, App 3848-3862); 150 ms ≤ 5 s (QR verify, Dialogs 344-355).
- Others: getSystemStatsJson 1500 ms; getWifiInfoJson + isBatteryOptimized 2500 ms; reconcile also calls getUsbBroadcastAddress every 1500 ms.

## (F) Why the port MUST keep synchronous returns (Promise would break it)

There is not a single `await` or `.then` on any bridge call; every getter's value is consumed in the same expression. If a getter returned a Promise instead of a string/number/boolean:

- `JSON.parse(bridge.getGyroscopeDataJson())` (App 516) throws every 8 ms ("[object Promise]" isn't JSON), silently caught → **gyro completely dead**.
- `JSON.parse(bridge.getNetworkTelemetryJson())` throws at all 7 sites. Worst cascades: QR verify never sees `linkAlive` → ALWAYS "failed" at 5 s and calls `stopEngine()`, actively killing a good connection; transport reconcile (App 3884-3891) reads `engineRunning=false` → opens the USB-debug WS while native UDP runs → the double-virtual-pad bug returns; USB auto-pair verify stops the engine after 6 s every time. Note the `|| "{}"` guards don't save you — a Promise is truthy, so the bad value still reaches JSON.parse.
- `String(bridge.getRumbleState()).split(":")` → "[object Promise]" → `seq = NaN`; since `NaN !== NaN`, the "seq advanced" check passes on EVERY 33 ms tick → onRumblePacket(NaN, NaN) spam / setRumble re-render churn 30×/s.
- `bridge.getSafeAreaTop() > 0` → false (Promise not coercible) → safe-area CSS vars never set.
- `Number(b.getAppVersionCode()) || 0` → 0 → update banner permanently claims an update is available; `String(getAppVersionName())` renders "[object Promise]".
- `!!bridge.isBatteryOptimized()` → always true (truthy object) → falsely reports the exemption as granted.
- `getUsbBroadcastAddress()` at App 3894: `if (b && b !== "255.255.255.255")` — a Promise passes both checks → `tetherAvail=true` with a garbage address, so reconcile "auto" mode keeps the WS closed and dials `connectToPC(<Promise>, 7777, "usb")`.
- `JSON.parse(getSystemStatsJson()/getWifiInfoJson())` throw → System tab stuck at zeros with a console error every 1.5 s; Wi-Fi card hidden.

Conclusion: all string/number/boolean getters (getGyroscopeDataJson, getNetworkTelemetryJson, getRumbleState, getSystemStatsJson, getWifiInfoJson, getSafeAreaTop/Bottom/Left/Right, getUsbBroadcastAddress, getAppVersionName/Code, isBatteryOptimized) must remain synchronous @JavascriptInterface-style returns, and `window.sendGamepadPacket` must accept an ArrayBuffer synchronously. Fire-and-forget methods (haptics, connectToPC, startCameraScan, setScreenOrientation, etc.) could tolerate async internals since no return value is read, but the getters cannot. Any async port needs push-style callbacks (like onRumblePacket/onQRScanned already are) instead of Promise-returning getters.