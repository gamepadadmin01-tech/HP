// ─── Settings backup (2.1) ────────────────────────────────────────────────────
//
// Owner, 2026-11-18: "the settings page is not syncing". Layouts were backed up to the account (sync.ts), the
// Settings page never was. This backs up the Settings page the same way:
//
//   • What: tilt steering, steering sensitivity, ignore small tilts, wheel mode + range, motion mode, pause when laid
//     flat, app vibration, game rumble, right stick sensitivity, language.
//   • Rule: the newest change wins, by the time the player last changed a setting ON THAT PHONE. A phone where
//     nothing was changed sends no time, so signing in on a new phone brings the saved settings down instead of
//     overwriting them with that phone's defaults. The server keeps one row per account (backend/settingsSync.js).
//   • When: a few seconds after a change (only with Auto backup on, like layouts), and on every sign-in (always,
//     like layouts: restoring what the account has is not uploading).
//
// Settings are compared by their real values (defaults filled in), never by which keys happen to be stored, so the
// app writing its defaults at start-up is not mistaken for the player changing something.

import { KEYS, readString, writeString } from "./storage";
import { loadGyroPrefs, saveGyroPrefs, loadRumbleOn, saveRumbleOn, autoSyncEnabled, GYRO_DEFAULTS } from "./prefs";
import { getSession } from "./account";
import { apiFetch, API_ORIGIN } from "../api/account";
import { stickFeel, setRightGain, RIGHT_GAIN_DEFAULT } from "../stickFeel";
import { langChoice, setLangChoice, LANGS, type LangChoice } from "../i18n";

type Settings = Record<string, string | number | boolean>;

/** The Settings page as one flat object. Keys are the storage key names. */
export function currentSettings(): Settings {
  const g = loadGyroPrefs();
  return {
    [KEYS.gyroOn]: g.on, [KEYS.gyroMaxAngle]: g.maxAngle, [KEYS.gyroMode]: g.mode, [KEYS.gyroDeadzone]: g.deadzone,
    [KEYS.gyroHaptic]: g.haptic, [KEYS.gyroIdleDetect]: g.idleDetect, [KEYS.gyroWheel]: g.wheel,
    [KEYS.gyroWheelRange]: g.wheelRange, [KEYS.rumbleOn]: loadRumbleOn(),
    [KEYS.rightGain]: Math.round(stickFeel.rightGain * 100) / 100, [KEYS.language]: langChoice(),
  };
}

function defaults(): Settings {
  const g = GYRO_DEFAULTS;
  return {
    [KEYS.gyroOn]: g.on, [KEYS.gyroMaxAngle]: g.maxAngle, [KEYS.gyroMode]: g.mode, [KEYS.gyroDeadzone]: g.deadzone,
    [KEYS.gyroHaptic]: g.haptic, [KEYS.gyroIdleDetect]: g.idleDetect, [KEYS.gyroWheel]: g.wheel,
    [KEYS.gyroWheelRange]: g.wheelRange, [KEYS.rumbleOn]: true, [KEYS.rightGain]: RIGHT_GAIN_DEFAULT, [KEYS.language]: "auto",
  };
}

const fingerprint = (s: Settings) => JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));

/** First run of 2.1 on this phone: remember the settings as they are. Settings a player chose BEFORE updating count
 *  as a real change (so they get backed up); untouched defaults do not (so they never overwrite an account's). */
function baseline() {
  if (readString(KEYS.settingsSeen, "")) return;
  const now = currentSettings();
  writeString(KEYS.settingsSeen, fingerprint(now));
  if (fingerprint(now) !== fingerprint(defaults())) writeString(KEYS.settingsUpdatedAt, new Date().toISOString());
}

const restoredListeners = new Set<() => void>();
/** Called after settings were brought down from the account, so screens can re-read them. */
export function onSettingsRestored(fn: () => void): () => void {
  restoredListeners.add(fn);
  return () => { restoredListeners.delete(fn); };
}

let timer: ReturnType<typeof setTimeout> | undefined;
const IDLE_DELAY_MS = 8_000;

/** Call after any setting was saved. Records the change time (only if a value really changed) and backs it up a
 *  few seconds later. Cheap: compares one short string. */
export function noteSettingsChanged(): void {
  baseline();
  const fp = fingerprint(currentSettings());
  if (fp === readString(KEYS.settingsSeen, "")) return;
  writeString(KEYS.settingsSeen, fp);
  writeString(KEYS.settingsUpdatedAt, new Date().toISOString());
  if (!getSession() || !autoSyncEnabled()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void syncSettings(); }, IDLE_DELAY_MS);
}

/** Write settings that came from the account, then tell the screens. Unknown or bad values are skipped. */
function apply(s: Settings) {
  const g = loadGyroPrefs();
  const bool = (k: string, d: boolean) => (typeof s[k] === "boolean" ? (s[k] as boolean) : d);
  const num = (k: string, d: number) => (typeof s[k] === "number" && Number.isFinite(s[k]) ? (s[k] as number) : d);
  const mode = s[KEYS.gyroMode] === "3d" || s[KEYS.gyroMode] === "racing" ? (s[KEYS.gyroMode] as "racing" | "3d") : g.mode;
  saveGyroPrefs({
    ...g, on: bool(KEYS.gyroOn, g.on), maxAngle: num(KEYS.gyroMaxAngle, g.maxAngle), mode,
    deadzone: num(KEYS.gyroDeadzone, g.deadzone), haptic: bool(KEYS.gyroHaptic, g.haptic),
    idleDetect: bool(KEYS.gyroIdleDetect, g.idleDetect), wheel: bool(KEYS.gyroWheel, g.wheel),
    wheelRange: num(KEYS.gyroWheelRange, g.wheelRange), throttle: false,
  });
  saveRumbleOn(bool(KEYS.rumbleOn, loadRumbleOn()));
  if (typeof s[KEYS.rightGain] === "number") setRightGain(s[KEYS.rightGain] as number);
  const lang = s[KEYS.language];
  if (typeof lang === "string" && (lang === "auto" || LANGS.some((l) => l.code === lang)) && lang !== langChoice()) setLangChoice(lang as LangChoice);
  restoredListeners.forEach((fn) => fn());
}

let busy = false;

/** Send this phone's settings, adopt the account's if they are newer. Never throws; quiet on failure (the next
 *  change or sign-in tries again). */
export async function syncSettings(): Promise<boolean> {
  const session = getSession();
  if (!session || busy) return false;
  baseline();
  busy = true;
  try {
    const email = session.user.email.toLowerCase();
    const owner = readString(KEYS.settingsOwner, "");
    // Another account's settings on this phone, or Auto backup off: do not upload, only receive.
    const mayUpload = autoSyncEnabled() && (!owner || owner === email);
    const localAt = mayUpload ? readString(KEYS.settingsUpdatedAt, "") || null : null;
    const res = await apiFetch<{ success: true; settings: Settings | null; updatedAt: string | null }>(
      `${API_ORIGIN}/api/account/settings/sync`,
      { body: { settings: currentSettings(), updatedAt: localAt }, token: session.token },
    );
    writeString(KEYS.settingsOwner, email);
    if (res.settings && res.updatedAt) {
      const theirs = { ...currentSettings(), ...res.settings };
      const newer = !localAt || new Date(res.updatedAt) > new Date(localAt);
      if (newer && fingerprint(theirs) !== fingerprint(currentSettings())) apply(res.settings);
      writeString(KEYS.settingsSeen, fingerprint(currentSettings()));
      writeString(KEYS.settingsUpdatedAt, res.updatedAt);
    }
    return true;
  } catch {
    return false;
  } finally {
    busy = false;
  }
}
