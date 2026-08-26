// ─── Preference repository ────────────────────────────────────────────────────
//
// Motion and transport settings. Every default here is the behaviour already
// shipped — `gyroOn` defaults ON, `gyroThrottle` OFF, `nativeInput` ON, and so
// on — because changing a default silently changes how the controller feels for
// everyone who never opened the setting. Defaults are only ever read when a key
// is absent, so an existing choice always wins.

import {
  KEYS, readBool, writeBool, readNumber, writeNumber, readString, writeString,
} from "./storage";

// ─── Motion ───────────────────────────────────────────────────────────────────

export type GyroMode = "racing" | "3d";

export type GyroPrefs = {
  /** Master switch. */
  on: boolean;
  /** Tilt angle that reaches full stick deflection, in degrees. */
  maxAngle: number;
  /** "racing" = 2D steering on the left stick; "3d" = 2-axis look on the right. */
  mode: GyroMode;
  /** Dead zone before tilt registers, in degrees. */
  deadzone: number;
  /** Haptic tick while the gyro is driving. */
  haptic: boolean;
  /** Racing only: pitch drives left-stick Y for tilt throttle/brake. */
  throttle: boolean;
  /** Suppress gyro after a period with no touch, so a phone set down goes quiet. */
  idleDetect: boolean;
  /**
   * Wheel mode: the phone sits in a wheel mount and is physically ROTATED like a
   * steering wheel, instead of being tilted in the hands. Off by default, so no
   * existing setup changes.
   */
  wheel: boolean;
  /**
   * Wheel mode only: total lock-to-lock travel in degrees (900 = a sim truck wheel's
   * 2.5 turns, 720 = 2 turns). Half of this is the angle to full lock either way.
   */
  wheelRange: number;
};

export const GYRO_DEFAULTS: GyroPrefs = {
  on: true,
  maxAngle: 30,
  mode: "racing",
  deadzone: 0,
  haptic: true,
  throttle: false,
  idleDetect: true,
  wheel: false,
  wheelRange: 900,
};

/** Lock-to-lock ranges offered in the UI. 900° and 720° are what the ticket asked for. */
export const WHEEL_RANGES = [360, 540, 720, 900] as const;
/** Clamp a stored/incoming range into something the steering maths can use. */
export function clampWheelRange(v: number): number {
  return Number.isFinite(v) ? Math.min(1080, Math.max(180, Math.round(v))) : GYRO_DEFAULTS.wheelRange;
}

export function loadGyroPrefs(): GyroPrefs {
  const mode = readString(KEYS.gyroMode, GYRO_DEFAULTS.mode);
  return {
    on: readBool(KEYS.gyroOn, GYRO_DEFAULTS.on),
    maxAngle: readNumber(KEYS.gyroMaxAngle, GYRO_DEFAULTS.maxAngle),
    // An unknown string from a future build must not brick the motion engine.
    mode: mode === "racing" || mode === "3d" ? mode : GYRO_DEFAULTS.mode,
    deadzone: readNumber(KEYS.gyroDeadzone, GYRO_DEFAULTS.deadzone),
    haptic: readBool(KEYS.gyroHaptic, GYRO_DEFAULTS.haptic),
    throttle: readBool(KEYS.gyroThrottle, GYRO_DEFAULTS.throttle),
    idleDetect: readBool(KEYS.gyroIdleDetect, GYRO_DEFAULTS.idleDetect),
    wheel: readBool(KEYS.gyroWheel, GYRO_DEFAULTS.wheel),
    // Clamped on the way in: a corrupt or hand-edited value must not reach the
    // steering maths, where half of it becomes the angle to full lock.
    wheelRange: clampWheelRange(readNumber(KEYS.gyroWheelRange, GYRO_DEFAULTS.wheelRange)),
  };
}

export function saveGyroPrefs(p: GyroPrefs): void {
  writeBool(KEYS.gyroOn, p.on);
  writeNumber(KEYS.gyroMaxAngle, p.maxAngle);
  writeString(KEYS.gyroMode, p.mode);
  writeNumber(KEYS.gyroDeadzone, p.deadzone);
  writeBool(KEYS.gyroHaptic, p.haptic);
  writeBool(KEYS.gyroThrottle, p.throttle);
  writeBool(KEYS.gyroIdleDetect, p.idleDetect);
  writeBool(KEYS.gyroWheel, p.wheel);
  writeNumber(KEYS.gyroWheelRange, clampWheelRange(p.wheelRange));
}

// ─── Transport ────────────────────────────────────────────────────────────────

export type WiredPref = "auto" | "tether" | "usbdebug";

export function getWiredPref(): WiredPref {
  const v = readString(KEYS.wiredPref, "auto");
  return v === "tether" || v === "usbdebug" || v === "auto" ? v : "auto";
}

export function setWiredPref(v: WiredPref): void {
  writeString(KEYS.wiredPref, v);
}

/** Native touch input. Default ON — only an explicit "0" disables it, which is
 *  what `window.__setNativeInput(false)` writes as the runtime escape hatch. */
export function nativeInputEnabled(): boolean {
  return readString(KEYS.nativeInput, "1") !== "0";
}

export function setNativeInputEnabled(on: boolean): void {
  writeString(KEYS.nativeInput, on ? "1" : "0");
}

// ─── Backup ───────────────────────────────────────────────────────────────────

/** Back layouts up automatically after an edit. Default ON — the whole reason
 *  for an account is not losing your pads, and a backup nobody remembers to run
 *  is not a backup. Turning it off keeps the manual Sync button working. */
export function autoSyncEnabled(): boolean {
  return readBool(KEYS.autoSync, true);
}

export function setAutoSyncEnabled(on: boolean): void {
  writeBool(KEYS.autoSync, on);
}
