// ─── Motion vocabulary ────────────────────────────────────────────────────────
//
// One place that decides how things move, so every surface decelerates the same
// way. Before this, dialogs used four different springs and five different
// durations, which is what made the app feel like separate pieces bolted
// together rather than one product.
//
// Two rules behind the numbers:
//
//  1. Things that APPEAR scale and fade from where they already are. They never
//     travel across the screen — a panel that flies in from an edge reads as
//     "coming from somewhere else", and on a controller app the eye is already
//     at the centre.
//
//  2. Motion is short. A UI spring that keeps wobbling looks slow even when it
//     is fast, so these are critically damped: they settle, they do not bounce.

/** Overlays, dialogs, sheets — anything that takes over the screen. */
export const SPRING = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.85,
};

/** Small things: menus, chips, inline reveals. Slightly quicker. */
export const SPRING_SNAP = {
  type: "spring" as const,
  stiffness: 520,
  damping: 36,
  mass: 0.7,
};

/** The app's easing curve. Fast out, gentle settle — matches the tab slide
 *  already used by the dashboard, so nothing feels out of step. */
export const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Backdrops and cross-fades. */
export const FADE = { duration: 0.18, ease: EASE };

/** Step-to-step changes inside a dialog. Short, because the container is
 *  already on screen and only its contents are swapping. */
export const STEP = { duration: 0.16, ease: EASE };

// ─── Reusable variants ────────────────────────────────────────────────────────

/** A dialog or overlay card. Scale + fade only: no travel. */
export const cardIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
};

/** A backdrop behind a card. */
export const backdropIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Step transition inside a wizard. `dir` is +1 going forward, -1 going back,
 *  so the content always moves the way the user is travelling. Kept small
 *  (10px) — enough to read as movement, not enough to look like a slide show. */
export const stepIn = (dir: 1 | -1 = 1) => ({
  initial: { opacity: 0, x: 10 * dir },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 * dir },
});
