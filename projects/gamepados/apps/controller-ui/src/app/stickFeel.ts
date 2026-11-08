// ── Stick feel ───────────────────────────────────────────────────────────────
// Shared by App.tsx (the JS packet builder) and Widgets.tsx (the touch handlers),
// and mirrored EXACTLY by NativeInputEngine.kt, which receives these two values
// through setNativeInputGeometry as `stickFollow` / `curveExp`.
//
// It lives in its own module rather than in App.tsx because Widgets.tsx is imported
// BY App.tsx — reading it from there would be a circular import.
//
// The native engine and the JS path drifting apart is what caused 26d5368, so any
// change here MUST be made in NativeInputEngine.kt in the same commit:
//   follow  -> pressLocked (origin capture + the maxOff clamp)
//   curveExp-> radialDeadzone
//   rightGain -> radialDeadzone (right stick only; see applyStickGain)
//
// Persisted in localStorage, matching the gp_native_input convention:
//   gp_stick_follow  "0" = off        (default ON)
//   gp_stick_curve   "1" = linear     (default 1 = previous behaviour exactly)
//   gp_right_gain    "1" = unchanged  (right stick sensitivity, 0.2 - 2; default 1 = previous behaviour exactly)
// Runtime toggle: window.__setStickFeel(follow, curve)

/** Knob travel in design units. Mirrors NativeInputEngine.STICK_MAX_R. */
export const STICK_MAX_R = 60;

/** 8% circular deadzone. Mirrors NativeInputEngine.STICK_DEADZONE. */
export const STICK_DEADZONE = 0.08 * STICK_MAX_R;

/** Right-stick sensitivity (owner, 2026-11-02; a customer asked: "some games feel very high sensitivity
 *  even when it's set to lowest in game"). A multiplier on the right stick's final value: 0.5 means full
 *  push gives half the camera speed. 1 is exactly the old behaviour. Above 1, full speed is reached with
 *  less thumb travel (still never more than full). Mirrors StickMath.kt. */
export const RIGHT_GAIN_MIN = 0.2;
export const RIGHT_GAIN_MAX = 2;
export const RIGHT_GAIN_DEFAULT = 1;

export function clampRightGain(v: number): number {
  return Number.isFinite(v) ? Math.min(RIGHT_GAIN_MAX, Math.max(RIGHT_GAIN_MIN, v)) : RIGHT_GAIN_DEFAULT;
}

/** The stick's response (0..1, after deadzone and curve) with the sensitivity applied.
 *  gain 1 returns the input untouched, so the default is byte-identical to before. */
export function applyStickGain(factor: number, gain: number): number {
  return gain === 1 ? factor : Math.min(1, factor * gain);
}

function readRightGain(): number {
  try {
    const raw = localStorage.getItem("gp_right_gain");
    return raw == null ? RIGHT_GAIN_DEFAULT : clampRightGain(parseFloat(raw));
  } catch {
    return RIGHT_GAIN_DEFAULT;
  }
}

/** Set by installStickFeelToggle: republish the geometry so the native engine hears about a change. */
let onFeelChange: (() => void) | null = null;

function readFollow(): boolean {
  try {
    return localStorage.getItem("gp_stick_follow") !== "0";
  } catch {
    return true;
  }
}

function readCurve(): number {
  try {
    const v = parseFloat(localStorage.getItem("gp_stick_curve") || "1");
    // Below 1 would amplify near-centre movement (twitchier than linear, never
    // wanted here); above 3 is unusable. Same clamp as setGeometry's coerceIn.
    return Number.isFinite(v) ? Math.min(3, Math.max(1, v)) : 1;
  } catch {
    return 1;
  }
}

/**
 * Live values. Plain mutable fields, not React state: `processStick` runs on the
 * input path and must not pay a localStorage read or a hook subscription per packet.
 */
export const stickFeel = {
  follow: readFollow(),
  curveExp: readCurve(),
  rightGain: readRightGain(),
};

/** The settings slider's setter: remember it, use it, and tell the native engine. Returns the clamped value. */
export function setRightGain(v: number): number {
  stickFeel.rightGain = clampRightGain(v);
  try {
    localStorage.setItem("gp_right_gain", String(stickFeel.rightGain));
  } catch {}
  onFeelChange?.();
  return stickFeel.rightGain;
}

/**
 * How far the stick origin may sit from the widget centre, in design units.
 *
 * Half the knob travel (30 units, ~3.7mm), never more than the widget's own radius.
 * That covers a real thumb-landing offset while keeping the knob rendered near its
 * base ring.
 *
 * Deliberately NOT `widgetR - STICK_MAX_R`: the default lstick has r=56 against a
 * STICK_MAX_R of 60, so that formula collapses to 0 and silently disables follow on
 * the most-used stick. MUST match NativeInputEngine.pressLocked.
 */
export function stickMaxOffset(widgetR: number): number {
  if (!stickFeel.follow) return 0;
  return Math.min(widgetR, STICK_MAX_R * 0.5);
}

/**
 * The whole stick response in one place: circular deadzone, the curve, then the sensitivity gain.
 * Input is the stick's position in design units (±STICK_MAX_R); output is the normalized -1..1 value that
 * becomes the axis byte. App.tsx's packet builder calls this for BOTH sticks (gain 1 for the left one), and
 * StickMath.response is its line-for-line mirror in the phone engine: a test replays the same inputs through
 * both (stickFeel.test.mjs writes them, StickMathTest.kt reads them), so they cannot drift apart unseen.
 */
export function stickResponse(x: number, y: number, gain = 1, curveExp = stickFeel.curveExp): { x: number; y: number } {
  const distance = Math.sqrt(x * x + y * y);
  if (distance >= STICK_DEADZONE && distance > 0) {
    const f = (distance - STICK_DEADZONE) / (STICK_MAX_R - STICK_DEADZONE);
    const factor = applyStickGain(curveExp === 1 ? f : Math.pow(f, curveExp), gain);
    return { x: (x / distance) * factor, y: (y / distance) * factor };
  }
  return { x: 0, y: 0 };
}

/** Install window.__setStickFeel. Returns a disposer. */
export function installStickFeelToggle(onChange: () => void): () => void {
  onFeelChange = onChange;
  (window as any).__setStickFeel = (follow?: boolean, curve?: number, gain?: number) => {
    if (follow !== undefined) {
      stickFeel.follow = !!follow;
      try {
        localStorage.setItem("gp_stick_follow", follow ? "1" : "0");
      } catch {}
    }
    if (curve !== undefined && Number.isFinite(curve)) {
      stickFeel.curveExp = Math.min(3, Math.max(1, curve));
      try {
        localStorage.setItem("gp_stick_curve", String(stickFeel.curveExp));
      } catch {}
    }
    if (gain !== undefined && Number.isFinite(gain)) {
      stickFeel.rightGain = clampRightGain(gain);
      try {
        localStorage.setItem("gp_right_gain", String(stickFeel.rightGain));
      } catch {}
    }
    // Republish geometry so the native engine picks the new values up too —
    // otherwise the JS path would change and the native path would not.
    onChange();
    return { follow: stickFeel.follow, curve: stickFeel.curveExp, rightGain: stickFeel.rightGain };
  };
  return () => {
    delete (window as any).__setStickFeel;
    onFeelChange = null;
  };
}
