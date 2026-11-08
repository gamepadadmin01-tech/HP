// ─── Colour experiments (owner, 2026-11-08) ───────────────────────────────────
//
// Two test builds compare colour directions on a real phone, built from this same code (no copies of
// the project): set VITE_THEME_VARIANT when building the UI bundle.
//
//   ""      the normal app: orange on warm dark brown, the controller in teal smoked glass
//   "warm"  the CONTROLLER takes the app's colours: orange smoked glass on a warm dark brown page
//   "cool"  the APP takes the controller's colours: teal on a cool near-black (redesign.css,
//           :root[data-variant='cool'])
//
// Only colours change. The glass itself (white specular shine, blur, soft rim, shadows) is drawn the
// same way in every variant, so the controller never loses its glassy look.

export type ThemeVariant = "" | "warm" | "cool";

// `?.`: test harnesses bundle this file without Vite, where import.meta.env does not exist.
const raw = String(import.meta.env?.VITE_THEME_VARIANT ?? "");
export const THEME_VARIANT: ThemeVariant = raw === "warm" || raw === "cool" ? raw : "";

/** The controller's colours. `rgb` tints every glass control (resting 12%, pressed 85%); `shine` and
 *  `shineDeep` are the soft light inside the glass; `page` is the screen behind the pad; `chip` is the
 *  gyro chip and the small menu buttons; `thumb` is the accent of the layout pictures on Home. */
export const CONTROLLER = THEME_VARIANT === "warm"
  ? { rgb: "255, 104, 38", shine: "255, 226, 210", shineDeep: "244, 178, 146", page: "#120b09", chip: "255, 104, 38", thumb: "#ff6a2b" }
  : { rgb: "44, 170, 186", shine: "200, 225, 255", shineDeep: "150, 190, 240", page: "#000000", chip: "79, 134, 198", thumb: "#5D90CB" };

/** Mark the page so the app's own colours can follow the variant (only "cool" changes them). */
export function applyThemeVariant(): void {
  if (typeof document !== "undefined" && THEME_VARIANT) document.documentElement.dataset.variant = THEME_VARIANT;
}
