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

  // Billing. Optional on every build: the store flavours never ship them, and
  // an install older than the billing release will not have them either — so
  // the UI must feature-detect rather than assume. Both are fire-and-forget;
  // the answer arrives on `window.onPurchaseResult`.
  startPlayPurchase?(productId: string, accountId: string): void;
  startRazorpayCheckout?(optionsJson: string): void;
  /** Play Billing only: re-deliver purchases made outside the app (or lost to a
   *  crash between payment and acknowledgement). Answers on the same callback. */
  restorePurchases?(): void;
  /** Play Billing only: last-resort acknowledgement for a purchase the SERVER
   *  already credited but could not acknowledge itself. Play auto-refunds
   *  anything unacknowledged after three days. */
  acknowledgeIfServerCredited?(purchaseToken: string): void;

  /** Playtime: forward a capability ticket to the PC over the input socket.
   *  Present on every flavour — quota is not a store-specific concern. */
  sendPlaytimeTicket?(base64Ticket: string): void;

  // System
  openUrl(url: string): void;
  exitApp(): void;
  onUiReady(): void;
  requestShizukuPermission(): void;
  setChargeBypass(enabled: boolean): void;
  showTextInput(currentValue: string, hint: string): void;
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

// ─── Build identity ───────────────────────────────────────────────────────────

export type AppInfo = {
  /** e.g. "1.3.23" — empty string when not running natively. */
  version: string;
  /** versionCode, 0 when unknown. */
  build: number;
  /** "direct" | "play" | "amazon" | … — empty string when unknown. */
  channel: string;
};

let cachedAppInfo: AppInfo | null = null;

/** Real values from BuildConfig. Anything unavailable stays empty/0 so the UI
 *  can hide the row rather than invent a version number.
 *
 *  Cached: these are compile-time constants, and each read is a JNI crossing.
 *  Nothing here can change while the process lives. */
export function getAppInfo(): AppInfo {
  if (cachedAppInfo) return cachedAppInfo;
  cachedAppInfo = {
    version: call("getAppVersionName", (b) => b.getAppVersionName(), ""),
    build: call("getAppVersionCode", (b) => b.getAppVersionCode(), 0),
    channel: call("getDistributionChannel", (b) => b.getDistributionChannel(), ""),
  };
  return cachedAppInfo;
}

// ─── Rumble ───────────────────────────────────────────────────────────────────

/** Fire both motors at full strength so the user can confirm rumble reaches the
 *  phone. Returns false when the bridge cannot do it, so the UI can say so
 *  instead of pretending. There is no intensity argument: rumble is on or off,
 *  and in play the game decides how hard it shakes. */
export function testRumble(): boolean {
  const b = bridge();
  if (!b || typeof b.triggerRumble !== "function") return false;
  try {
    b.triggerRumble(1, 1, 400);
    return true;
  } catch {
    return false;
  }
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** Open a URL in the system browser. No-op off-device. */
export function openUrl(url: string): void {
  call("openUrl", (b) => b.openUrl(url), undefined as void);
}

// ─── Billing ──────────────────────────────────────────────────────────────────

/** Launch Google Play's purchase sheet. Returns false when this build has no
 *  Play Billing in it, so the caller can say so rather than hang on a callback
 *  that will never fire. */
export function startPlayPurchase(productId: string, accountId: string): boolean {
  const b = bridge();
  if (!b || typeof b.startPlayPurchase !== "function") return false;
  try {
    // accountId is the raw user id; the native side hashes it into the
    // obfuscated account id Play stamps on the purchase, which the backend
    // checks before crediting. Without it a purchase cannot be bound to a user.
    b.startPlayPurchase(productId, accountId);
    return true;
  } catch {
    return false;
  }
}

/** Launch Razorpay's checkout sheet with an order created server-side. */
export function startRazorpayCheckout(options: unknown): boolean {
  const b = bridge();
  if (!b || typeof b.startRazorpayCheckout !== "function") return false;
  try {
    b.startRazorpayCheckout(JSON.stringify(options));
    return true;
  } catch {
    return false;
  }
}

/** Ask Play to re-deliver owned purchases. No-op where unsupported. */
export function restorePurchases(): boolean {
  const b = bridge();
  if (!b || typeof b.restorePurchases !== "function") return false;
  try {
    b.restorePurchases();
    return true;
  } catch {
    return false;
  }
}

/** Whether this build can restore purchases — i.e. is a Play build. Used to
 *  decide whether to offer the button at all, since there is nothing to restore
 *  on a Razorpay build (entitlements there live on the account, not the store). */
export function canRestorePurchases(): boolean {
  const b = bridge();
  return !!b && typeof b.restorePurchases === "function";
}

/** Belt-and-braces acknowledgement after our server credited a Play purchase.
 *  Safe to call unconditionally; absent on non-Play builds. */
export function acknowledgePlayPurchase(purchaseToken: string): void {
  call("acknowledgeIfServerCredited",
    (b) => b.acknowledgeIfServerCredited!(purchaseToken), undefined as void);
}

// ─── Playtime ─────────────────────────────────────────────────────────────────

/** Forward a capability ticket to the PC server.
 *
 *  Returns false when the bridge cannot do it — an older install, or a desktop
 *  browser. That is not an error: the PC's gate stays un-armed and never tears
 *  the session down, which is exactly how every pre-2.1.0 server behaves. */
export function sendPlaytimeTicket(base64Ticket: string): boolean {
  const b = bridge();
  if (!b || typeof b.sendPlaytimeTicket !== "function") return false;
  try {
    b.sendPlaytimeTicket(base64Ticket);
    return true;
  } catch {
    return false;
  }
}

