// ─── Colour experiments (owner, 2026-11-08) ───────────────────────────────────
//
// Two test builds compare colour directions on a real phone, built from this same code (no copies of
// the project): set VITE_THEME_VARIANT when building the UI bundle.
//
//   ""      the normal app: orange on warm dark brown, and since 2026-11-08 the controller too (orange
//           smoked glass on a warm dark page -- the owner picked the "warm" test build for the real app)
//   "warm"  same as normal now (kept so old test builds still mean something)
//   "cool"  the old teal: the app AND the controller in teal on a cool near-black (redesign.css,
//           :root[data-variant='cool'])
//
// Only colours change. The glass itself (white specular shine, blur, soft rim, shadows) is drawn the
// same way in every variant, so the controller never loses its glassy look.

export type ThemeVariant = "" | "warm" | "cool";

// `?.`: test harnesses bundle this file without Vite, where import.meta.env does not exist.
const raw = String(import.meta.env?.VITE_THEME_VARIANT ?? "");
export const THEME_VARIANT: ThemeVariant = raw === "warm" || raw === "cool" ? raw : "";

/** The controller's colours. `rgb` tints every glass control (resting 12%, pressed 85%); `shine` and
 *  `shineDeep` are the soft light inside the glass; `page` is the screen behind the pad (a CSS background:
 *  in the warm look a soft amber glow in the middle fading to near-black at the edges, 2026-11-08); `chip` is the
 *  gyro chip and the small menu buttons; `thumb` is the accent of the layout pictures on Home. */
export const CONTROLLER = THEME_VARIANT === "cool"
  ? { rgb: "44, 170, 186", shine: "200, 225, 255", shineDeep: "150, 190, 240", page: "#000000", chip: "79, 134, 198", thumb: "#5D90CB" }
  : { rgb: "255, 104, 38", shine: "255, 226, 210", shineDeep: "244, 178, 146", page: "radial-gradient(120% 95% at 50% 42%, #2a160e 0%, #170d09 52%, #0b0605 100%)", chip: "255, 104, 38", thumb: "#ff6a2b" };

/** Mark the page so the app's own colours can follow the variant (only "cool" changes them). */
export function applyThemeVariant(): void {
  if (typeof document !== "undefined" && THEME_VARIANT) document.documentElement.dataset.variant = THEME_VARIANT;
}
