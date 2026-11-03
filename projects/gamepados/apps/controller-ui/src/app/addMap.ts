// ── The "+" projection: every button the editor can add, shown where it belongs ──────────────────
// Tapping "+" no longer opens a box of tiny swatches. It projects each button, drawn exactly as it looks
// on the pad, at the place it has on a controller, straight over the canvas (same 1280x570 space as the
// pad itself). Nothing is wrapped in a card. Tapping one adds it to the pad.
//
//   type / label   what is added (`label` is what the engine maps to a gamepad bit, see CUSTOM_LABEL_MAP)
//   tag            its name, also used for the test id (add-<tag>-widget-button)
//   r              the radius the new widget is added with (as before)
//   x, y           where it is projected
//   gr / gw, gh    how big it is projected (a circle radius, or a width and height for triggers and the pad)
//
// Left hand left, right hand right, centre buttons in the middle. Every projected button is at least
// 68 units wide and keeps a clear gap from its neighbours (checked by addmap.test.mjs).

import type { WidgetType } from "./types";

export type AddItem = {
  type: WidgetType; label: string; tag: string; r?: number;
  x: number; y: number; gr?: number; gw?: number; gh?: number;
};

export const ADD_MAP: AddItem[] = [
  // top edge: triggers on the outer corners, bumpers beside them
  { type: "trigger", label: "LT", tag: "LT", x: 80, y: 110, gw: 84, gh: 120 },
  { type: "button", label: "LB", tag: "LB", r: 52, x: 230, y: 80, gr: 44 },
  { type: "button", label: "RB", tag: "RB", r: 52, x: 1050, y: 80, gr: 44 },
  { type: "trigger", label: "RT", tag: "RT", x: 1200, y: 110, gw: 84, gh: 120 },
  // centre top: View, Home, Menu
  { type: "button", label: "view", tag: "View", r: 40, x: 545, y: 110, gr: 38 },
  { type: "button", label: "home", tag: "Home", r: 40, x: 640, y: 110, gr: 38 },
  { type: "button", label: "menu", tag: "Menu", r: 40, x: 735, y: 110, gr: 38 },
  // left hand: stick, its click, the D-pad
  { type: "thumbstick", label: "LS", tag: "L Stick", x: 180, y: 270, gr: 62 },
  { type: "button", label: "Left stick", tag: "L3", r: 40, x: 180, y: 440, gr: 38 },
  { type: "dpad", label: "DPAD", tag: "D-Pad", x: 330, y: 440, gr: 70 },
  // centre: the hybrid stick and its two mode buttons, the touchpad below
  { type: "stickmode", label: "L-Mod", tag: "L-Mode", r: 40, x: 520, y: 250, gr: 38 },
  { type: "thumbstick", label: "Hybrid", tag: "Hybrid", x: 640, y: 250, gr: 62 },
  { type: "stickmode", label: "R-Mod", tag: "R-Mode", r: 40, x: 760, y: 250, gr: 38 },
  { type: "touchpad", label: "Touchpad", tag: "Touchpad", r: 100, x: 640, y: 450, gw: 240, gh: 130 },
  // right hand: single face buttons, the right stick and its click, the ABXY cluster
  { type: "button", label: "X", tag: "X", r: 56, x: 850, y: 180, gr: 40 },
  { type: "button", label: "Y", tag: "Y", r: 56, x: 950, y: 180, gr: 40 },
  { type: "button", label: "A", tag: "A", r: 56, x: 850, y: 290, gr: 40 },
  { type: "button", label: "B", tag: "B", r: 56, x: 950, y: 290, gr: 40 },
  { type: "thumbstick", label: "RS", tag: "R Stick", x: 1100, y: 270, gr: 62 },
  { type: "button", label: "Right stick", tag: "R3", r: 40, x: 1100, y: 440, gr: 38 },
  { type: "abxy", label: "ABXY", tag: "ABXY", x: 950, y: 450, gr: 88 },
];
