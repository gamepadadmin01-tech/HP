// ─── Native bridge façade ─────────────────────────────────────────────────────
//
// Every call into Android goes through this file. Nothing else in the UI may
// touch `window.AndroidBridge` directly.
//
// Why this exists: the bridge is 40+ methods reached as
// `(window as any).AndroidBridge?.foo?.()`, so a wrong method name is invisible
// — the optional-chain swallows it and the caller silently takes its fallback.
// That is exactly how a since-removed patch shipped `getVersionName()` (the real
// method is `getAppVersionName`) and would have displayed a fake "1.0.0" version
// forever. Typed here, that mistake is a compile error.
//
// The bridge is absent in a desktop browser (`npm run dev`), so every wrapper
// degrades to a sensible default instead of throwing. `isNative()` tells the UI
// which world it is in when the difference actually matters.

/** The Kotlin object bound as `AndroidBridge`. Optional members = added in a
 *  later APK than some installs in the field, so always feature-detect. */
export interface AndroidBridge {
  // Layout / window
  getSafeAreaTop(): number;
  getSafeAreaBottom(): number;
  getSafeAreaLeft(): number;
  getSafeAreaRight(): number;
  setScreenOrientation(orientation: "portrait" | "landscape"): void;

  // Input path
  sendGamepadPacketNative(base64Data: string): void;
  sendGamepadPacketL1(data: string): void;
  setNativeInputGeometry(json: string): void;
  setNativeInputActive(active: boolean): void;
  setNativeGyroConfig(json: string): void;
  nativeGyroCalibrate(): void;
  setInputStreaming(on: boolean): void;

  // Session / transport
  connectToPC(ip: string, port: number, key: string): void;
  exitSession(): void;
  stopEngine(): void;
  startCameraScan(): void;
  stopCameraScan(): void;

  // Telemetry
  getSystemStatsJson(): string;
  getGyroscopeDataJson(): string;
  getNetworkTelemetryJson(): string;
  getNetworkDetailsJson(): string;
  getWifiInfoJson(): string;
  getRumbleState(): string;
  isUsbTetherActive(): boolean;
  getUsbBroadcastAddress(): string;
  logMetric(line: string): void;

  // Identity of the build
  getAppVersionName(): string;
  getAppVersionCode(): number;
  getDistributionChannel(): string;
  getDeviceInfoJson(): string;

  // Haptics
  triggerHaptic(durationMs: number): void;
  triggerRumble(left: number, right: number, durationMs: number): void;
  getHapticCapabilities(): string;
  playHaptic(event: string): void;
  playHapticWaveform(timingsCsv: string, ampsCsv: string): void;

  // System
  openUrl(url: string): void;
  exitApp(): void;
  onUiReady(): void;
  isBatteryOptimized(): boolean;
  requestBatteryExemption(): void;
  requestShizukuPermission(): void;
  setChargeBypass(enabled: boolean): void;
  showTextInput(currentValue: string, hint: string): void;

  // Durable key/value owned by Android (SharedPreferences "gamepados").
  // Added after 1.3.23 — feature-detect before use. Survives WebView storage
  // being cleared, which localStorage does not.
  prefGet?(key: string): string;
  prefSet?(key: string, value: string): void;
}

function bridge(): AndroidBridge | null {
  const b = (window as unknown as { AndroidBridge?: AndroidBridge }).AndroidBridge;
  return b ?? null;
}

export function isNative(): boolean {
  return bridge() !== null;
}

/** Call a bridge method, returning `fallback` if the bridge, the method, or the
 *  call itself fails. Never throws — a native hiccup must not blank the UI. */
function call<K extends keyof AndroidBridge, T>(
  method: K,
  invoke: (b: AndroidBridge) => T,
  fallback: T,
): T {
  const b = bridge();
  if (!b || typeof b[method] !== "function") return fallback;
  try {
    return invoke(b);
  } catch {
    return fallback;
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ─── Build identity ───────────────────────────────────────────────────────────

export type AppInfo = {
  /** e.g. "1.3.23" — empty string when not running natively. */
  version: string;
  /** versionCode, 0 when unknown. */
  build: number;
  /** "direct" | "play" | "amazon" | … — empty string when unknown. */
  channel: string;
};

/** Real values from BuildConfig. Anything unavailable stays empty/0 so the UI
 *  can hide the row rather than invent a version number. */
export function getAppInfo(): AppInfo {
  return {
    version: call("getAppVersionName", (b) => b.getAppVersionName(), ""),
    build: call("getAppVersionCode", (b) => b.getAppVersionCode(), 0),
    channel: call("getDistributionChannel", (b) => b.getDistributionChannel(), ""),
  };
}

// ─── Device identity ──────────────────────────────────────────────────────────

export type DeviceInfo = {
  model: string;
  manufacturer: string;
  os: string;
  appVersion: string;
  appCode: number;
};

const EMPTY_DEVICE: DeviceInfo = {
  model: "", manufacturer: "", os: "", appVersion: "", appCode: 0,
};

export function getDeviceInfo(): DeviceInfo {
  const raw = call("getDeviceInfoJson", (b) => b.getDeviceInfoJson(), "");
  return parseJson<DeviceInfo>(raw, EMPTY_DEVICE);
}

/** Human label for this phone, e.g. "Xiaomi 2311DRK48I". Empty when unknown —
 *  callers must render nothing rather than a placeholder like "Android Phone". */
export function getDeviceLabel(): string {
  const d = getDeviceInfo();
  return [d.manufacturer, d.model].filter(Boolean).join(" ").trim();
}

// ─── Installation identity ────────────────────────────────────────────────────
//
// A stable id for THIS install on THIS phone. Deliberately not an account and
// not a hardware id:
//   • guests have one, so device management and layout ownership work with no
//     sign-in;
//   • it is the tie-breaker when the same account edits a layout on two phones;
//   • it is random per install, so it carries no advertising/tracking identity
//     and disappears with the app.
//
// Stored natively when the bridge supports it (survives clearing WebView data);
// otherwise localStorage. The key name is shared by both so an install that
// upgrades into a bridge-capable build keeps its existing id.

const INSTALL_ID_KEY = "gp_install_id";

function readStored(key: string): string {
  const native = call("prefGet", (b) => b.prefGet!(key), "");
  if (native) return native;
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string): void {
  call("prefSet", (b) => b.prefSet!(key, value), undefined as void);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the native copy is the durable one */
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Older WebViews lack randomUUID; getRandomValues is available far earlier.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let cachedInstallId = "";

/** Stable installation id, created on first call and persisted from then on. */
export function getInstallId(): string {
  if (cachedInstallId) return cachedInstallId;
  let id = readStored(INSTALL_ID_KEY);
  if (!id) {
    id = newId();
    writeStored(INSTALL_ID_KEY, id);
  }
  cachedInstallId = id;
  return id;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** Open a URL in the system browser. No-op off-device. */
export function openUrl(url: string): void {
  call("openUrl", (b) => b.openUrl(url), undefined as void);
}

/** Haptic capability report, or null when the device/build cannot say. */
export function getHapticCapabilities(): Record<string, unknown> | null {
  const raw = call("getHapticCapabilities", (b) => b.getHapticCapabilities(), "");
  return raw ? parseJson<Record<string, unknown> | null>(raw, null) : null;
}
