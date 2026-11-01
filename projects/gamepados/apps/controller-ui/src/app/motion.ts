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

/** Leaving. Always quicker than arriving and accelerating (ease-in), so a dismissed pop-up gets
 *  out of the way instead of lingering: arriving is a decision the eye follows, leaving is not.
 *  This is the only exit curve; every overlay's exit goes through it. */
export const EXIT = { duration: 0.14, ease: [0.4, 0, 1, 1] as [number, number, number, number] };

/** A bottom sheet leaving travels the whole way down, so it gets a touch more time than a card. */
export const EXIT_SHEET = { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] };

// ─── Reusable variants ────────────────────────────────────────────────────────

/** A dialog or overlay card. Scale + fade only: no travel. */
export const cardIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98, transition: EXIT },
};

/** A backdrop behind a card. */
export const backdropIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: EXIT },
};

/** A bottom sheet: slides up from the edge it is attached to and leaves the same way. Transform
 *  only (no height/top), so it stays on the GPU. Pair with SPRING for the way in. */
export const sheetIn = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%", transition: EXIT_SHEET },
};

/** A small floating message (toast, hint) that drops in from just above where it sits. */
export const toastIn = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8, transition: EXIT },
};

/** Step transition inside a wizard. `dir` is +1 going forward, -1 going back,
 *  so the content always moves the way the user is travelling. Kept small
 *  (10px) — enough to read as movement, not enough to look like a slide show. */
export const stepIn = (dir: 1 | -1 = 1) => ({
  initial: { opacity: 0, x: 10 * dir },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 * dir },
});
