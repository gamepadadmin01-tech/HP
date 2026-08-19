// ─── Durable storage ──────────────────────────────────────────────────────────
//
// One place that knows every persisted key, what shape it holds, and how old
// installs are brought forward. Repositories build on this; components never
// call localStorage directly.
//
// Why: the app persists across ~11 keys read and written inline from wherever
// they happened to be needed. Nothing records which version wrote them, so a
// shape change means hand-written repair code at the call site — as
// `splitLegacyLtrt` already had to be. With 20+ shipped versions in the field
// and cloud sync coming, that does not scale.
//
// Two rules, both deliberate:
//
//  1. KEY NAMES NEVER CHANGE. Every key below is already on real phones. A
//     rename is silent data loss for anyone upgrading, so new data gets new
//     keys and old ones are migrated in place.
//
//  2. A read never throws. WebView storage can be disabled, full, or holding
//     text some earlier build wrote. Corrupt data yields the default and is
//     reported, because a broken preference must never stop the controller
//     from launching.

/** Every key this app persists. Adding one here is what makes it official. */
export const KEYS = {
  // Layouts and editor state
  customPads: "custom_pads",
  presetOverrides: "preset_overrides",
  posOverrides: "pos_overrides",

  // Motion
  gyroOn: "gyro_on",
  gyroMaxAngle: "gyro_maxAngle",
  gyroMode: "gyro_mode",
  gyroDeadzone: "gyro_deadzone",
  gyroHaptic: "gyro_haptic",
  gyroThrottle: "gyro_throttle",
  gyroIdleDetect: "gyro_idle_detect",

  // Transport
  nativeInput: "gp_native_input",
  wiredPref: "gp_wired_pref",

  // Signed-in user, absent while a guest
  account: "gp_account",

  // Layout sync
  deletedPads: "gp_deleted_pads",   // tombstones, so a delete propagates
  lastSync: "gp_last_sync",         // ISO time of the last successful sync
  autoSync: "gp_auto_sync",         // "1"/"0" — back up automatically after edits
  syncMark: "gp_sync_mark",         // fingerprint of the last synced library

  // Plan + quota, cached so the Account tab renders instantly and still shows
  // something useful offline. Never authoritative — the server decides.
  billing: "gp_billing",

  // Stable per-install id for the playtime session. A random UUID, not a
  // hardware identifier: it only has to distinguish "this install" from "the
  // other device you were playing on".
  deviceId: "gp_device_id",
  // Locally counted playtime for the current period. The server is
  // authoritative when reachable, but this is what governs offline and what
  // stops a clear-data wipe from restoring a spent quota.
  playtime: "gp_playtime",

  // Which one-off in-app notice has been dismissed, by id. A plain string so a
  // later announcement can use a new id and is not silenced by an old dismissal.
  noticeDismissed: "gp_notice_dismissed",
  // Set once the user has actually sent app feedback, so the launch notice can
  // stop asking for it.
  feedbackSent: "gp_feedback_sent",

  // Storage schema
  schemaVersion: "gp_schema_version",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

// ─── Primitives ───────────────────────────────────────────────────────────────

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rawSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota or disabled storage. Callers keep their in-memory value, so the
    // session still works — it just will not survive a restart.
    return false;
  }
}

function rawRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing sensible to do */
  }
}

/** Read JSON, falling back on absent, unparseable, or wrong-shaped data.
 *  `validate` is what stops a half-written array from reaching the UI. */
export function readJson<T>(
  key: StorageKey,
  fallback: T,
  validate?: (value: unknown) => value is T,
): T {
  const raw = rawGet(key);
  if (raw === null || raw === "") return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[storage] ${key} is not valid JSON — using default`);
    return fallback;
  }
  if (validate && !validate(parsed)) {
    console.warn(`[storage] ${key} failed validation — using default`);
    return fallback;
  }
  return parsed as T;
}

export function writeJson(key: StorageKey, value: unknown): boolean {
  try {
    return rawSet(key, JSON.stringify(value));
  } catch {
    // Circular structure — a programming error, not user data.
    console.error(`[storage] ${key} could not be serialised`);
    return false;
  }
}

/** Booleans are persisted as "1"/"0" — the format already on every phone. */
export function readBool(key: StorageKey, fallback: boolean): boolean {
  const raw = rawGet(key);
  if (raw === null) return fallback;
  return raw === "1";
}

export function writeBool(key: StorageKey, value: boolean): void {
  rawSet(key, value ? "1" : "0");
}

export function readNumber(key: StorageKey, fallback: number): number {
  const raw = rawGet(key);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function writeNumber(key: StorageKey, value: number): void {
  rawSet(key, String(value));
}

export function readString(key: StorageKey, fallback: string): string {
  return rawGet(key) ?? fallback;
}

export function writeString(key: StorageKey, value: string): void {
  rawSet(key, value);
}

export function remove(key: StorageKey): void {
  rawRemove(key);
}

// ─── Schema versioning ────────────────────────────────────────────────────────
//
// Version 0 = every install that predates this file, which is all of them. Each
// migration moves exactly one version forward and must be idempotent: an
// interrupted run (the user kills the app mid-migration) has to be safe to
// repeat.

export const CURRENT_SCHEMA_VERSION = 1;

type Migration = {
  to: number;
  describe: string;
  run: () => void;
};

const MIGRATIONS: Migration[] = [
  {
    to: 1,
    describe: "adopt versioned storage; existing keys are already correct",
    // Deliberately empty. v0 data is valid v1 data — this migration exists to
    // stamp the version so future ones have a floor to work from. Renaming or
    // rewriting keys here would risk every install in the field for no gain.
    run: () => {},
  },
];

/** Bring stored data up to CURRENT_SCHEMA_VERSION. Call once at boot, before
 *  any repository reads. Returns the version now stored. */
export function migrate(): number {
  let from = readNumber(KEYS.schemaVersion, 0);
  if (from >= CURRENT_SCHEMA_VERSION) return from;

  for (const m of MIGRATIONS) {
    if (m.to <= from) continue;
    try {
      m.run();
      writeNumber(KEYS.schemaVersion, m.to);
      from = m.to;
    } catch (e) {
      // Stop at the first failure and keep the old version stamped, so the next
      // launch retries this step instead of skipping past it with half-migrated
      // data. The app keeps running on whatever shape it has.
      console.error(`[storage] migration to v${m.to} failed (${m.describe})`, e);
      return from;
    }
  }
  return from;
}

