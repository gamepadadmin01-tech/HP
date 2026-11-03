// ── The editor's "+" popup: every button a player can add ────────────────────────────────────────
// Tapping "+" opens a container with one big tile per button, each showing the button exactly as it
// looks on the pad. Tapping a tile adds that button, as always.
//
//   type / label   what is added (`label` is what the engine maps to a gamepad bit, see CUSTOM_LABEL_MAP)
//   tag            its name, also used for the test id (add-<tag>-widget-button)
//   r              the radius the new widget is added with
//   cols, rows     how many grid cells its tile covers (sticks and the D-pad are double size, a trigger is tall)
//   vw, vh         the tile's drawing space; the button is drawn centred in it
//   pr             the drawn button's radius in that space; pw / ph its width and height when it is a rectangle
//
// Cells are square, so a tile that is cols x rows cells has the aspect ratio vw:vh = cols:rows.

import type { WidgetType } from "./types";

export type AddItem = {
  type: WidgetType; label: string; tag: string; r?: number;
  cols: number; rows: number; vw: number; vh: number; pr: number; pw?: number; ph?: number;
};

/** One grid cell of the popup, in CSS px. The editor lays its grid out with this and additems.test.mjs checks tap sizes with it. */
export const ADD_CELL = 92;

const one = { cols: 1, rows: 1, vw: 140, vh: 140 };
const big = { cols: 2, rows: 2, vw: 280, vh: 280 };

export const ADD_ITEMS: AddItem[] = [
  // Compound units
  { type: "dpad", label: "DPAD", tag: "D-Pad", ...big, pr: 112 },
  { type: "abxy", label: "ABXY", tag: "ABXY", ...big, pr: 110 },
  // Analog sticks
  { type: "thumbstick", label: "LS", tag: "L Stick", ...big, pr: 112 },
  { type: "thumbstick", label: "RS", tag: "R Stick", ...big, pr: 112 },
  { type: "thumbstick", label: "Hybrid", tag: "Hybrid", ...big, pr: 112 },
  // Slide a finger to push the right stick, like a laptop trackpad
  { type: "touchpad", label: "Touchpad", tag: "Touchpad", r: 100, cols: 2, rows: 1, vw: 280, vh: 140, pr: 50, pw: 248, ph: 112 },
  // Hybrid-stick mode selectors
  { type: "stickmode", label: "L-Mod", tag: "L-Mode", r: 40, ...one, pr: 54 },
  { type: "stickmode", label: "R-Mod", tag: "R-Mode", r: 40, ...one, pr: 54 },
  // Face buttons
  { type: "button", label: "A", tag: "A", r: 56, ...one, pr: 56 },
  { type: "button", label: "B", tag: "B", r: 56, ...one, pr: 56 },
  { type: "button", label: "X", tag: "X", r: 56, ...one, pr: 56 },
  { type: "button", label: "Y", tag: "Y", r: 56, ...one, pr: 56 },
  // Bumpers
  { type: "button", label: "LB", tag: "LB", r: 52, ...one, pr: 56 },
  { type: "button", label: "RB", tag: "RB", r: 52, ...one, pr: 56 },
  // Triggers (tall tiles)
  { type: "trigger", label: "LT", tag: "LT", cols: 1, rows: 2, vw: 140, vh: 280, pr: 45, pw: 92, ph: 244 },
  { type: "trigger", label: "RT", tag: "RT", cols: 1, rows: 2, vw: 140, vh: 280, pr: 45, pw: 92, ph: 244 },
  // Stick clicks (L3 / R3)
  { type: "button", label: "Left stick", tag: "L3", r: 40, ...one, pr: 54 },
  { type: "button", label: "Right stick", tag: "R3", r: 40, ...one, pr: 54 },
  // System buttons
  { type: "button", label: "view", tag: "View", r: 40, ...one, pr: 54 },
  { type: "button", label: "home", tag: "Home", r: 40, ...one, pr: 54 },
  { type: "button", label: "menu", tag: "Menu", r: 40, ...one, pr: 54 },
];
