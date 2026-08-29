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
//
// Persisted in localStorage, matching the gp_native_input convention:
//   gp_stick_follow  "0" = off        (default ON)
//   gp_stick_curve   "1" = linear     (default 1 = previous behaviour exactly)
// Runtime toggle: window.__setStickFeel(follow, curve)

/** Knob travel in design units. Mirrors NativeInputEngine.STICK_MAX_R. */
export const STICK_MAX_R = 60;

/** 8% circular deadzone. Mirrors NativeInputEngine.STICK_DEADZONE. */
export const STICK_DEADZONE = 0.08 * STICK_MAX_R;

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
};

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
 * Radial response curve, magnitude only so direction and the circular deadzone
 * shape are untouched (a per-axis curve would reintroduce the diagonal drift the
 * circular deadzone exists to prevent).
 *
 * exp 1 is the identity and reproduces the previous linear map exactly. Above 1
 * trades top-end travel — where a touch stick is already saturated — for
 * near-centre resolution: at 1.6, 10% output needs ~1.9mm of thumb travel instead
 * of ~0.66mm. MUST match NativeInputEngine.radialDeadzone.
 */
export function applyStickCurve(factor: number): number {
  const exp = stickFeel.curveExp;
  return exp === 1 ? factor : Math.pow(factor, exp);
}

/** Install window.__setStickFeel. Returns a disposer. */
export function installStickFeelToggle(onChange: () => void): () => void {
  (window as any).__setStickFeel = (follow?: boolean, curve?: number) => {
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
    // Republish geometry so the native engine picks the new values up too —
    // otherwise the JS path would change and the native path would not.
    onChange();
    return { follow: stickFeel.follow, curve: stickFeel.curveExp };
  };
  return () => {
    delete (window as any).__setStickFeel;
  };
}
