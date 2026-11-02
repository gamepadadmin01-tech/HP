import type { CustomBtnDef, WidgetType, WidgetShape } from "./types";
import { mkUid } from "./store/pads";

// ── Standard Layout 2: the Xbox Wireless Controller's own arrangement ─────────────────────────────────
// Real Xbox pads are deliberately asymmetric, and so is this: the LEFT STICK sits high on the left, the
// D-PAD below it and nearer the middle; the face buttons sit high on the right as a diamond (Y top, X left,
// B right, A bottom); the RIGHT STICK sits low and nearer the middle. View, Home and Menu are in the centre
// (Home on top, View and Menu either side just below it). Bumpers run along the top over each side's
// cluster, with the triggers on the outer top corners.
//
// Coordinates are the 1280x570 design canvas. The cluster centres mirror each other about the middle
// (x = 640): sticks/ABXY 440 away, D-pad/right stick 230 away. Every neighbour has clear space between it
// and the next (checked when this was made); nothing here depends on the screen size.
//   touchpads = false  two real thumbsticks
//   touchpads = true   both sticks become round touchpads: left = movement ("distance" feel, a floating
//                      stick), right = camera ("speed" feel). Same places, bigger target.
export function getXboxLayout2(touchpads: boolean): CustomBtnDef[] {
  const NORM = "rgba(79, 134, 198, 0.12)";
  const HELD = "rgba(79, 134, 198, 0.85)";
  const mk = (type: WidgetType, label: string, x: number, y: number, r: number,
    shape: WidgetShape = "circle", extra: Partial<CustomBtnDef> = {}): CustomBtnDef =>
    ({ uid: mkUid(), type, shape, opacity: 1, haptic: 60, macroBits: [], label, x, y, r, normColor: NORM, heldColor: HELD, ...extra });
  const CX = 640;                       // the controller's centre line
  const ROW1 = 225, ROW2 = 405;         // upper row (left stick, ABXY) and lower row (D-pad, right stick)
  const pad = (label: string, x: number, y: number, left: boolean): CustomBtnDef =>
    mk("touchpad", label, x, y, 100, "rect", {
      w: 220, h: 220, tpShape: "circle", tpStick: left ? "L" : "R",
      tpFeel: left ? "distance" : "speed", tpRelease: "instant", tpSens: 1,
    });
  return [
    // top edge: triggers on the outer corners, bumpers beside them
    mk("trigger", "LT", 60, 108, 55, "rect", { w: 110, h: 110, rxFactor: 0.4 }),   // below the app's own Back button
    mk("button", "LB", 230, 52, 34, "rect", { w: 210, h: 68, rxFactor: 0.5 }),
    mk("button", "RB", 2 * CX - 230, 52, 34, "rect", { w: 210, h: 68, rxFactor: 0.5 }),
    mk("trigger", "RT", 2 * CX - 60, 108, 55, "rect", { w: 110, h: 110, rxFactor: 0.4 }),
    // centre: Home above, View and Menu either side below it
    mk("button", "home", CX, 125, 36),
    mk("button", "view", CX - 80, ROW1, 32),
    mk("button", "menu", CX + 80, ROW1, 32),
    // upper row: left stick (top-left) and the ABXY diamond (top-right)
    touchpads ? pad("LEFT STICK", CX - 440, ROW1 + 25, true) : mk("thumbstick", "LS", CX - 440, ROW1, 92),
    mk("abxy", "ABXY", CX + 440, ROW1, 104),
    // lower row: D-pad (inboard left) and right stick (inboard right)
    mk("dpad", "DPAD", CX - 230, ROW2, 84),
    touchpads ? pad("RIGHT STICK", CX + 230, ROW2, false) : mk("thumbstick", "RS", CX + 230, ROW2, 92),
  ];
}
