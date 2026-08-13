// GamepadOS iOS bridge shim — injected as a WKUserScript at documentStart.
//
// The React controller-ui was written against Android's `window.AndroidBridge`
// (a JNI object whose getters return SYNCHRONOUSLY). WKWebView has no sync
// JS->native return path, so this shim keeps the exact same synchronous API
// surface but backs every getter with `__ios.state`, which the Swift side
// pushes into the page via evaluateJavaScript at 60-120 Hz (gyro/telemetry/
// rumble) or on-change (safe area, battery). Actions post one-way messages to
// webkit.messageHandlers.bridge. The UI bundle runs byte-identical to Android.
(function () {
  if (window.AndroidBridge) return; // never double-install

  var state = {
    safeArea: { top: 44, bottom: 24, left: 0, right: 0 },
    gyro: { nx: 0, ny: 0, age: -1 },
    telemetry: { packetCount: 0, hz: 0, latency: 0, connectionType: "none", linkAlive: false, engineRunning: false },
    rumble: "0:0:0",
    stats: { battery: 75, temp: 30.0, shizuku: false, shizukuRunning: false, bypass: false },
    netDetails: { wifiIp: "", usbIp: "" },
    wifi: { band: "—", freq: 0, linkSpeed: 0, rssi: 0 },
    haptics: { hasVibrator: true, amplitude: true, primitives: true },
    versionName: "0.0.0", // overwritten by the first native push
    versionCode: 0
  };

  function post(m, a) {
    try { window.webkit.messageHandlers.bridge.postMessage({ m: m, a: a || [] }); } catch (e) {}
  }

  function setSafeAreaVars() {
    var s = state.safeArea, d = document.documentElement.style;
    // Same CSS custom-property names the Android host sets — the UI reads
    // --android-safe-* regardless of platform.
    d.setProperty("--android-safe-top", s.top + "px");
    d.setProperty("--android-safe-bottom", s.bottom + "px");
    d.setProperty("--android-safe-left", s.left + "px");
    d.setProperty("--android-safe-right", s.right + "px");
  }

  // Native -> JS state push. Swift batches gyro+telemetry+rumble into a single
  // call per tick to keep evaluateJavaScript overhead to one hop.
  window.__iosPush = function (partial) {
    for (var k in partial) state[k] = partial[k];
    if (partial.safeArea) setSafeAreaVars();
  };

  window.AndroidBridge = {
    // ── Safe area (pt; same semantics as Android dp) ──
    getSafeAreaTop: function () { return state.safeArea.top; },
    getSafeAreaBottom: function () { return state.safeArea.bottom; },
    getSafeAreaLeft: function () { return state.safeArea.left; },
    getSafeAreaRight: function () { return state.safeArea.right; },

    // ── Hot path: 20-byte input frame, base64, 60 Hz ──
    sendGamepadPacketNative: function (base64Data) { post("packet", [base64Data]); },

    // ── Pairing / connection ──
    startCameraScan: function () { post("startCameraScan"); },
    stopCameraScan: function () { post("stopCameraScan"); },
    connectToPC: function (ip, port, key) { post("connectToPC", [ip, port, key]); },
    exitSession: function () { post("exitSession"); },
    stopEngine: function () { post("stopEngine"); },
    setScreenOrientation: function (o) { post("setScreenOrientation", [o]); },

    // ── Synchronous JSON getters (backed by pushed state) ──
    getSystemStatsJson: function () { return JSON.stringify(state.stats); },
    getGyroscopeDataJson: function () { return JSON.stringify(state.gyro); },
    getNetworkTelemetryJson: function () { return JSON.stringify(state.telemetry); },
    getRumbleState: function () { return state.rumble; },
    getNetworkDetailsJson: function () { return JSON.stringify(state.netDetails); },
    getWifiInfoJson: function () { return JSON.stringify(state.wifi); },
    getHapticCapabilities: function () { return JSON.stringify(state.haptics); },

    // ── Version / update. startApkUpdate is deliberately ABSENT: the UI
    //    checks `if (bridge.startApkUpdate)` and falls back to openUrl —
    //    iOS updates come from the App Store, never a downloaded binary. ──
    getAppVersionName: function () { return state.versionName; },
    getAppVersionCode: function () { return state.versionCode; },
    openUrl: function (url) { post("openUrl", [url]); },

    // ── Android-only surfaces, stubbed honestly on iOS ──
    isUsbTetherActive: function () { return false; },
    getUsbBroadcastAddress: function () { return ""; },
    requestShizukuPermission: function () {},
    setChargeBypass: function (enabled) {},
    isBatteryOptimized: function () { return false; },
    requestBatteryExemption: function () {},
    exitApp: function () { post("exitApp"); }, // iOS: no programmatic exit; native no-ops

    // ── Haptics ──
    triggerHaptic: function (ms) { post("triggerHaptic", [ms]); },
    triggerRumble: function (l, r, ms) { post("triggerRumble", [l, r, ms]); },
    playHaptic: function (event) { post("playHaptic", [event]); },
    playHapticWaveform: function (t, a) { post("playHapticWaveform", [t, a]); },

    // ── Native text input (keyboard stays in the native layer) ──
    showTextInput: function (cur, hint) { post("showTextInput", [cur, hint]); }
  };

  // Android injects these two on onPageFinished; here they ship in the shim.
  window.sendGamepadPacket = function (buffer) {
    var bytes = new Uint8Array(buffer), bin = "";
    for (var i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    window.AndroidBridge.sendGamepadPacketNative(window.btoa(bin));
  };
  window.exitSession = function () { window.AndroidBridge.exitSession(); };

  if (document.documentElement) setSafeAreaVars();
  else document.addEventListener("DOMContentLoaded", setSafeAreaVars);
})();
