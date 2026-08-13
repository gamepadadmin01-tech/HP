export type View = "scanner" | "dashboard" | "controller" | "editor";
export type BtnId =
  | "A" | "B" | "X" | "Y"
  | "LB" | "RB" | "LT" | "RT"
  | "up" | "down" | "left" | "right"
  | "view" | "home" | "menu" | "lstick" | "rstick";
// "account" carries what used to live in the Advanced tab: about, updates and
// feedback, plus the user's layouts. Guests see it too — it is not a gate.
export type DashTab = "home" | "system" | "account";
export type PollingHz = 60 | 120 | 500 | 1000;

export type GamepadPreset = {
  id: string; name: string; genre: string; color: string; icon: string;
  displayName?: Partial<Record<BtnId, string>>;
  layout?: "standard" | "mobile";
  mapping: Partial<Record<BtnId, string>>;
};

export type BtnPosOverride = { cx: number; cy: number; r: number };
export type PosOverrideMap = Partial<Record<string, BtnPosOverride>>;

// ── Unified widget vocabulary ──────────────────────────────────────────────
//  Individual widgets: button | thumbstick | trigger | macro
//  Compound/modular widgets (single draggable unit, multiple inputs):
//    dpad  → emits  uid_up / uid_down / uid_left / uid_right
//    abxy  → emits  uid_a / uid_b / uid_x / uid_y
//  LT/RT are always two independent "trigger" widgets — the legacy "ltrt"
//  compound was removed; splitLegacyLtrt() in App.tsx migrates saved pads.
export type WidgetType = "button" | "thumbstick" | "trigger" | "macro" | "dpad" | "abxy" | "stickmode";
export type WidgetShape = "circle" | "rect" | "cluster";

// Optional responsive anchor. Used ONLY by the standard preset so its widgets
// spread to the screen edges (old-app Bt/qn behaviour). Custom pads leave it
// undefined → no offset, so they are unaffected.
export type WidgetAnchor = "left" | "center" | "right";

export type CustomBtnDef = {
  uid: string;
  type: WidgetType;
  shape: WidgetShape;
  opacity: number;
  haptic: number;
  macroBits: string[];
  label: string;
  x: number;
  y: number;
  r: number;
  w?: number;
  h?: number;
  rxFactor?: number;   // rect corner radius as a fraction of min(w,h); 0 = square, 0.5 = pill. Default 0.28.
  // Trigger widgets only. true/undefined = Throttle: finger
  // position sets an analog 0..1 pull, like a real trigger. false = Normal: a tap
  // instantly gives full 100%, like a regular button. Default true preserves the
  // existing analog behavior for pads saved before this option existed.
  analogTrigger?: boolean;
  normColor: string;
  heldColor: string;
  groupId?: string;
  anchor?: WidgetAnchor;
};

export type CustomPad = {
  padId: string;
  name: string;
  color: string;
  buttons: CustomBtnDef[];
  // Stamped by store/pads.ts when a pad's content changes, so cloud save can
  // tell which copy is newer. Optional because pads saved before this existed
  // have none, and an undated pad must still load. Not sent when sharing by
  // code — that payload is picked explicitly as { name, color, buttons }.
  updatedAt?: string;   // ISO 8601, last local edit
  // Share-by-code memo. `shareCode` is the code the server issued for this
  // layout; `shareHash` is a fingerprint of the content that was shared. If the
  // pad still hashes to shareHash we show shareCode straight away and make no
  // request at all — one code per layout, and no server work for repeat taps.
  shareCode?: string;
  shareHash?: string;
};
