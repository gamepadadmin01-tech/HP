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
};

export const GYRO_DEFAULTS: GyroPrefs = {
  on: true,
  maxAngle: 30,
  mode: "racing",
  deadzone: 0,
  haptic: true,
  throttle: false,
  idleDetect: true,
};

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
