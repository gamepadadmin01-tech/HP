import { savedPc, connectionMode, rememberMode, pendingWireless, confirmWireless, cancelPendingWireless, selectedLayout, rememberLayout, dashboardTab, rememberTab } from "./store/connectionMemory";
import { createTransportCoordinator, USB_CHOICE_EVENT, WIRELESS_CHOICE_EVENT, prepareWirelessConnection } from "./transportCoordinator";
import React, { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
// @ts-ignore - Ignore missing declaration file error
import { createPortal } from "react-dom";
import { Home, Usb, Activity, Gamepad2, X, Settings, User, Check, ArrowUpRight, Plus, ChevronRight, MoreHorizontal } from "lucide-react";
import { QRScanOverlay } from "./components/Dialogs";
import { PlaytimeLockout } from "./components/PlaytimeLockout";
import { PlaytimeToast } from "./components/PlaytimeToast";
import { beginPlay, endPlay, getPlaytimeState, isBlocked, onPlaytimeChange } from "./store/playtime";
import { onDashboardTabRequest, requestDashboardTab } from "./store/navIntent";
import { LaunchNotice } from "./components/LaunchNotice";
import { CalmConnect } from "./components/CalmConnect";
import { CalmSettings as TabSystem } from "./components/CalmSettings";
import { useOverlayFocus, closeTopOverlay } from "./components/useOverlayFocus";
import { CalmBrand, AppearanceButton, ConnectionSummary, DashboardAllowance, useShellAppearance } from "./components/CalmShell";

import { ShellMotion } from "./components/ShellMotion";
import { ShellScreenTransition } from "./components/ShellScreenTransition";
import { SignInScreen } from "./components/SignInScreen";
import { Ticket } from "lucide-react";
import { getAppInfo } from "./platform/native";
import { motion, AnimatePresence, useIsPresent, useReducedMotion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────
import { View, BtnId, DashTab, GamepadPreset, CustomPad, CustomBtnDef, WidgetType, WidgetShape, WidgetAnchor, BtnPosOverride, PosOverrideMap } from "./types";
import { CustomPadEditor } from "./components/CustomPadEditor";
import { FeatureIntroOverlay, recordIntroNav, introRated } from "./FeatureIntroOverlay";
import { FEEDBACK_URL, initFeedbackSync, markFeedbackSent } from "./feedback";
import { stickFeel, stickMaxOffset, applyStickCurve, installStickFeelToggle } from "./stickFeel";
// Connection state is a 4-way classification, not a boolean — a link that is
// transmitting but never answered is NOT the same as one that is off. See
// linkState.ts for why that distinction had to exist.
import { linkState, linkLabel, linkHint, linkColor } from "./linkState";
// Saved layouts are owned by the store, not by this component. mkUid lives
// there too because pad migrations mint widget ids.
import {
  mkUid, loadPads, savePads, shareFingerprint, addTombstone, onPadsReplaced,
  loadPresetOverrides, savePresetOverrides, loadPosOverrides, savePosOverrides,
} from "./store/pads";
import { scheduleSync, onSignedInSync } from "./store/sync";
import {
  loadGyroPrefs, saveGyroPrefs, getWiredPref, setWiredPref,
  nativeInputEnabled, setNativeInputEnabled, clampWheelRange, WHEEL_RANGES,
} from "./store/prefs";
import type { WiredPref } from "./store/prefs";
import { TabAccount, AppSupport } from "./components/TabAccount";
import { getSession, onSessionChange, revalidate } from "./store/account";
import { SPRING, SPRING_SNAP, FADE, STEP, cardIn, backdropIn } from "./motion";

const GAMEPAD_PRESETS: GamepadPreset[] = [
  // color drives THREE things on the Home card: the selected ring, the status
  // dot and the LAUNCH button fill. It was #2563eb (Tailwind blue-600) — a
  // vivid brand blue that ignored the theme entirely and, once the UI moved to
  // Slate Navy, read as the one shouting element on the screen. Now the theme's
  // --primary, so the most prominent control on Home belongs to the palette.
  // (CUSTOM_COLORS below is deliberately NOT retargeted: those are per-pad
  // identity swatches the user picks, and they are meant to differ.)
  { id:"xbox", name:"Standard Controller", genre:"Full-size wireless controller layout", color:"#5D90CB", icon:"🟢",
    // Display real controller button names, not game-action nicknames.
    mapping:{ A:"A",B:"B",X:"X",Y:"Y",LT:"LT",RT:"RT",LB:"LB",RB:"RB",up:"↑",down:"↓",left:"←",right:"→",lstick:"L3",rstick:"R3" } },
];

// ─── Custom pad helpers ──────────────────────────────────────────────────────────────────────────────────
const CUSTOM_COLORS = ["#6366f1", "#e11d48", "#d97706", "#22c55e", "#64748B", "#3b82f6"];

export const BTN_PALETTE_COLORS = [
  { norm: "rgba(180, 10, 10, 0.85)", held: "rgba(220, 0, 0, 1.0)" },
  { norm: "rgba(20, 20, 58, 0.85)", held: "rgba(58, 58, 158, 1.0)" },
  { norm: "rgba(10, 30, 10, 0.85)", held: "rgba(26, 94, 26, 1.0)" },
  { norm: "rgba(46, 10, 22, 0.85)", held: "rgba(142, 24, 64, 1.0)" },
  { norm: "rgba(30, 16, 10, 0.85)", held: "rgba(126, 64, 16, 1.0)" },
  { norm: "rgba(10, 30, 46, 0.85)", held: "rgba(26, 94, 142, 1.0)" },
];

export function getTrueStandardLayout(): CustomBtnDef[] {
  // Match the exact same cyan/blue glassmorphic colors as TriggerPill (LT/RT)
  const NORM = "rgba(79, 134, 198, 0.12)";
  const HELD = "rgba(79, 134, 198, 0.85)";
  // Coordinates baked from the original RemoteGamepad app's canonical 1280×570
  // design space. All buttons scaled up to fill the controller more completely.
  //
  // `anchor` reproduces the old app's responsive edge-spreading:
  //   left   → absolute x (no offset)          [old: bare coordinate]
  //   center → x + offsetCenter                [old: x + Bt]
  //   right  → x + offsetRight                 [old: x + qn]
  // Only the standard preset sets anchors; user custom pads leave it undefined.
  const w = (
    type: WidgetType, label: string, x: number, y: number, r: number,
    anchor: WidgetAnchor, shape: WidgetShape = "circle",
    extra?: { w?: number; h?: number; rxFactor?: number }
  ): CustomBtnDef => {
    const btn: CustomBtnDef = { uid: mkUid(), type, shape, opacity: 1, haptic: 60, macroBits: [], label, x, y, r, normColor: NORM, heldColor: HELD, anchor };
    if (extra?.w != null) btn.w = extra.w;
    if (extra?.h != null) btn.h = extra.h;
    if (extra?.rxFactor != null) btn.rxFactor = extra.rxFactor;
    return btn;
  };
  // ── USER-DESIGNED STANDARD LAYOUT ──────────────────────────────────────────
  // This IS the "Replacement" pad the user built on-device (2026-07-13), promoted
  // to be the default Standard pad. Coordinates/sizes are their exact design in
  // the 1280×570 canvas; anchors keep the old edge-spreading behaviour.
  return [
    // LEFT: shoulder bumpers
    w("button", "LB", 101, 114, 65, "left"),
    w("button", "RB", 269, 116, 65, "left"),
    // LEFT: face buttons as one ABXY diamond cluster
    w("abxy", "ABXY", 188, 366, 148, "left"),
    // CENTER: modular D-pad
    w("dpad", "DPAD", 532, 324, 129, "center"),
    // CENTER-TOP: system buttons (view / home / menu)
    w("button", "view", 518, 115, 40, "center"),
    w("button", "home", 636, 114, 40, "center"),
    w("button", "menu", 753, 113, 40, "center"),
    // CENTER-BOTTOM: hybrid-stick L/R mode selectors
    w("stickmode", "L-Mod", 740, 514, 51, "center"),
    w("stickmode", "R-Mod", 873, 513, 49, "center"),
    // RIGHT: hybrid analog joystick
    w("thumbstick", "Hybrid", 805, 321, 122, "right"),
    // RIGHT: independent LT / RT trigger pills
    w("trigger", "LT", 1023, 289, 105, "right", "rect", { w: 160, h: 556, rxFactor: 0.43 }),
    w("trigger", "RT", 1188, 291, 105, "right", "rect", { w: 160, h: 554, rxFactor: 0.5 }),
  ];
}

// splitLegacyLtrt moved to store/pads.ts — pad shape migrations belong with the
// repository that loads them, so every read is normalised the same way.

function makeDefaultPad(padId: string, templateKey: string = "standard", name?: string): CustomPad {
  const norm = "#141A26";
  const held = "#2F4463";
  const btn = (label: string, x: number, y: number, r: number, type: WidgetType = "button", shape: WidgetShape = "circle"): CustomBtnDef =>
    ({ uid: mkUid(), type, shape, opacity: 1, haptic: 60, macroBits: [], label, x, y, r, normColor: norm, heldColor: held });
    
  let buttonsList: CustomBtnDef[] = [];
  if (templateKey === "fps") {
    buttonsList = [
      btn("AIM", 160, 240, 60, "trigger", "rect"),
      btn("FIRE", 1080, 240, 65, "trigger", "rect"),
      btn("LS", 240, 440, 65, "thumbstick"),
      btn("RS", 960, 440, 65, "thumbstick"),
      btn("JUMP", 850, 240, 50),
      btn("RELOAD", 780, 340, 45),
      btn("SPRINT", 140, 440, 40),
      btn("M1", 500, 480, 45, "macro"),
      btn("M2", 764, 480, 45, "macro"),
    ];
  } else if (templateKey === "fighter") {
    buttonsList = [
      btn("STICK", 280, 320, 75, "thumbstick"),
      btn("LP", 720, 200, 48),
      btn("MP", 830, 200, 48),
      btn("HP", 940, 200, 48),
      btn("LK", 700, 320, 48),
      btn("MK", 810, 320, 48),
      btn("HK", 920, 320, 48),
      btn("SELECT", 500, 100, 35),
      btn("START", 764, 100, 35),
    ];
  } else if (templateKey === "racing") {
    buttonsList = [
      btn("LS",    220, 390, 70, "thumbstick"),
      btn("GAS",  1100, 390, 65, "trigger", "rect"),
      btn("BRAKE", 163, 200, 60, "trigger", "rect"),
      btn("BOOST", 980, 200, 50),
      btn("DRIFT", 860, 320, 46),
      btn("HORN",  700, 100, 34),
      btn("CAM",   560, 100, 34),
      btn("SHIFT", 400, 200, 40, "macro"),
    ];
  } else if (templateKey === "rpg") {
    buttonsList = [
      btn("LS",    220, 410, 70, "thumbstick"),
      btn("RS",    880, 410, 60, "thumbstick"),
      btn("ATK",  1060, 280, 58),
      btn("SKILL", 940, 180, 50),
      btn("DODGE",1170, 180, 46),
      btn("BLOCK",1170, 380, 46),
      btn("↑",    290, 170, 40),
      btn("←",    165, 300, 40),
      btn("→",    415, 300, 40),
      btn("↓",    290, 430, 40),
      btn("MAP",   560,  90, 34),
      btn("MENU",  700,  90, 34),
    ];
  } else if (templateKey === "blank") {
    buttonsList = [];
  } else {
    buttonsList = getTrueStandardLayout();
  }
  
  return {
    padId,
    name: name || (templateKey === "fps" ? "FPS Pro Layout" : templateKey === "fighter" ? "Fighter Arcade" : templateKey === "racing" ? "Racing Layout" : templateKey === "rpg" ? "RPG Adventure" : templateKey === "blank" ? "Blank Canvas" : "My Custom Pad"),
    color: CUSTOM_COLORS[Math.floor(Math.random() * CUSTOM_COLORS.length)],
    buttons: buttonsList
  };
}

// ─── Dialog animation hook ────────────────────────────────────────────────────
// Keeps dialog mounted for exit animation, then unmounts.
// ─── Native Haptics Bridge ────────────────────────────────────────────────────
// Press haptic. `strength` is a 0-100 intensity: it selects one of the three
// device-tuned tiers (light TICK / medium CLICK / heavy HEAVY_CLICK) that the
// native playHaptic exposes, so a d-pad tap and a trigger pull feel genuinely
// different instead of all landing on the same medium buzz.
export function triggerHaptic(strength: number) {
  if ((window as any).hapticsEnabled === false) return;
  if (strength <= 0) return;
  const bridge = (window as any).AndroidBridge;
  const event = strength <= 30 ? "tick" : strength <= 65 ? "buttonPress" : "triggerPull";
  if (bridge && bridge.playHaptic) { try { bridge.playHaptic(event); return; } catch {} }
  // Fallbacks (older shell / browser): scale the oneshot duration by tier. Kept
  // SHORT on purpose — a haptic is a button-touch tick, not a vibration.
  const ms = strength <= 30 ? 8 : strength <= 65 ? 12 : 16;
  if (bridge && bridge.triggerHaptic) { bridge.triggerHaptic(ms); }
  else if (navigator.vibrate) { navigator.vibrate(ms); }
}

// Per-button haptic strength (0-100) chosen by the button's ROLE, so every
// control feels appropriate by default: triggers give a strong pull, face
// buttons a solid click, bumpers/sticks a medium tap, and the d-pad + system
// buttons a light crisp tick. A stored per-widget value (from the editor) that
// differs from the 60 default is respected as a user override; 0 means off.
export function hapticForRole(type: string, label?: string): number {
  const l = (label || "").trim().toUpperCase();
  if (type === "trigger") return 45;                                                  // medium click (a touch, not a long pull)
  if (type === "dpad") return 22;                                                     // light
  if (["↑", "↓", "←", "→", "UP", "DOWN", "LEFT", "RIGHT"].includes(l)) return 22;     // light d-pad
  if (["VIEW", "MENU", "HOME", "START", "SELECT", "BACK", "OPTIONS"].includes(l)) return 18; // light system
  if (["LB", "RB", "L1", "R1"].includes(l)) return 45;                                // medium bumper
  if (type === "thumbstick" || type === "stickmode") return 42;                       // medium stick
  if (type === "macro") return 55;                                                    // medium+ macro
  return 50;                                                                           // face / default medium
}

// Resolve the effective press strength for a widget: honour an explicit editor
// override, otherwise use the role default; 0 keeps it off.
export function widgetHaptic(btn: { type: string; label?: string; haptic?: number }): number {
  if (btn.haptic === 0) return 0;
  return (btn.haptic != null && btn.haptic !== 60) ? btn.haptic : hapticForRole(btn.type, btn.label);
}

// Standard-controller per-button press strengths (0-100) by BtnId.
const STD_BTN_HAPTIC: Record<string, number> = {
  A: 50, B: 50, X: 50, Y: 50,            // face buttons — solid click
  LB: 45, RB: 45,                        // bumpers — medium
  LT: 45, RT: 45,                        // triggers — medium click (touch feel, not a long pull)
  up: 22, down: 22, left: 22, right: 22, // d-pad — light tick
  view: 18, home: 18, menu: 18,          // system — light tick
  lstick: 42, rstick: 42,                // stick click — medium
};

// Semantic haptic (#4): intent → best device-tuned effect (primitive/waveform/
// oneshot). Falls back to triggerHaptic on older bridges / browsers.
export function playHaptic(event: string, fallbackMs = 14) {
  if ((window as any).hapticsEnabled === false) return;
  const bridge = (window as any).AndroidBridge;
  if (bridge && bridge.playHaptic) { try { bridge.playHaptic(event); return; } catch {} }
  triggerHaptic(fallbackMs);
}

// Amplitude envelope (#5): a rise→decay pulse synced to the ripple so the buzz
// feels like it "expands" with the wave rather than a flat on/off.
export function playHapticWaveform(timings: number[], amps: number[]) {
  if ((window as any).hapticsEnabled === false) return;
  const bridge = (window as any).AndroidBridge;
  if (bridge && bridge.playHapticWaveform) {
    try { bridge.playHapticWaveform(timings.join(","), amps.join(",")); return; } catch {}
  }
  if (navigator.vibrate) { try { navigator.vibrate(timings); } catch {} }
}

// The ripple's tactile twin: a short impact that fades — used by RippleButton.
export function rippleHaptic() {
  const bridge = (window as any).AndroidBridge;
  if ((window as any).hapticsEnabled === false) return;
  if (bridge && bridge.playHaptic) { try { bridge.playHaptic("ripple"); return; } catch {} }
  // Fallback envelope: peak then two fading steps (~280ms total).
  playHapticWaveform([0, 18, 50, 12, 60, 10], [0, 200, 0, 110, 0, 60]);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
// Digital-button hold state. `heldRef` mirrors `held` synchronously so the
// telemetry packet can be built from live values without waiting for a React
// render. `dn`/`up` update the ref first, then fire `onChange` immediately
// (lowest latency), then update React state for the visual highlight — the same
// ref-then-send design the analog sticks use (see useStick).
function useHeld(onChange?: () => void) {
  const [held, setHeld] = useState<Set<BtnId>>(new Set());
  const heldRef = useRef<Set<BtnId>>(held);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const dn = useCallback((id: BtnId) => {
    heldRef.current = new Set([...heldRef.current, id]);
    if (onChangeRef.current) onChangeRef.current();
    setHeld(new Set(heldRef.current));
    // Per-button press haptic for the STANDARD controller (custom pads fire their
    // own in the render loop). Each role gets a distinct tier so the pad feels
    // like a real controller: triggers pull hard, face buttons click, d-pad +
    // system buttons give a light tick.
    triggerHaptic(STD_BTN_HAPTIC[id] ?? 50);
  }, []);
  const up = useCallback((id: BtnId) => {
    const n = new Set(heldRef.current); n.delete(id); heldRef.current = n;
    if (onChangeRef.current) onChangeRef.current();
    setHeld(new Set(heldRef.current));
  }, []);
  const clear = useCallback(() => {
    heldRef.current = new Set();
    if (onChangeRef.current) onChangeRef.current();
    setHeld(new Set());
  }, []);
  return { held, heldRef, dn, up, clear };
}

function useStick(maxR: number, svgRef: React.RefObject<SVGSVGElement | null>, onChange?: () => void) {
  const posRef = useRef({ x: 0, y: 0 });
  const active = useRef(false);
  const centerRef = useRef({ x: 0, y: 0 });
  const knobRef = useRef<SVGGElement>(null);
  const atRim = useRef(false);   // for the "hit the edge" tick
  const pid = useRef<number | null>(null);   // pointerId that owns this stick

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const toSVG = (px: number, py: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = px; pt.y = py;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    return pt.matrixTransform(m.inverse());
  };

  const onDown = useCallback((e: React.PointerEvent, cx: number, cy: number, maxOff: number = 0) => {
    if (pid.current !== null) return;   // already owned by another finger — ignore
    pid.current = e.pointerId;
    active.current = true;
    // Anchor the stick to where the thumb actually landed. Pinned to the widget
    // centre, the first move event reported a deflection the user never made:
    // landing 20 design units off centre gives (20 - 4.8) / 55.2 ~= 27%.
    // maxOff 0 (the default, and what stickMaxOffset returns when follow is off)
    // restores the previous fixed-centre behaviour exactly.
    // MUST stay in step with NativeInputEngine.pressLocked.
    if (maxOff > 0) {
      const p = toSVG(e.clientX, e.clientY);
      const odx = p.x - cx, ody = p.y - cy;
      const od = Math.sqrt(odx * odx + ody * ody);
      centerRef.current = (od > maxOff && od > 0)
        ? { x: cx + (odx / od) * maxOff, y: cy + (ody / od) * maxOff }
        : { x: p.x, y: p.y };
    } else {
      centerRef.current = { x: cx, y: cy };
    }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch (err) {}
    if (knobRef.current) {
      const circle = knobRef.current.firstElementChild as SVGGraphicsElement;
      if (circle) circle.style.fill = "#e0e0e0";
    }
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!active.current || e.pointerId !== pid.current) return;
    const p = toSVG(e.clientX, e.clientY);
    const dx = p.x - centerRef.current.x, dy = p.y - centerRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = Math.min(dist, maxR), a = Math.atan2(dy, dx);
    const newX = Math.cos(a) * r;
    const newY = Math.sin(a) * r;

    // subtle "edge" tick — fire once when the knob first hits full deflection,
    // re-arm only after it eases back in. Mirrors a real stick's hard stop.
    const onRim = dist >= maxR - 0.5;
    if (onRim && !atRim.current) playHaptic("tick");
    atRim.current = onRim;

    posRef.current = { x: newX, y: newY };
    
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
    }
    
    if (onChangeRef.current) onChangeRef.current();
  }, [maxR]);

  const onUp = useCallback((pointerId?: number) => {
    // Only the owning finger releases the stick — a stray 2nd finger must not recenter
    // an active stick. Called with no arg by the panic-release to force-clear.
    if (pointerId != null && pid.current != null && pointerId !== pid.current) return;
    pid.current = null;
    active.current = false;
    atRim.current = false;
    posRef.current = { x: 0, y: 0 };
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(0px, 0px)`;
      const circle = knobRef.current.firstElementChild as SVGGraphicsElement;
      if (circle) circle.style.fill = "#d8d8d8";
    }
    if (onChangeRef.current) onChangeRef.current();
  }, []);
  
  return { posRef, onDown, onMove, onUp, knobRef };
}

import { Btn, Dpad, RightStick, TriggerPill, RED_NORM, RED_HELD, ACCENT_RGB } from "./components/Widgets";

// ─── Gyro indicator material ─────────────────────────────────────────────────
// SMOKED GLASS, matching the pad buttons. The bar used to be a solid #2CAABA
// slab with a `0 0 8px` glow; the buttons had already moved to translucent glass
// (dim body + white specular crown + hairline rim, see Widgets.tsx "Shared glass
// lighting"), so the bar was the last thing on the pad still reading as a
// sticker. This rebuilds the same material in CSS.
//
// Derives from ACCENT_RGB rather than repeating the hex, so a palette change
// stays the one-line edit Widgets.tsx intends.
//
// TWO HARD CONSTRAINTS, both load-bearing:
//
//  1. VERTICAL GRADIENTS ONLY. The bar is driven by `scaleX`, so a horizontal
//     gradient would squash as the fill grows and the colour would visibly
//     shift with tilt angle. Vertical stops are untouched by horizontal
//     scaling, so the material looks identical at 5% fill and 100%.
//
//  2. NO backdrop-filter. Real glass here would re-blur its region on every
//     one of up to 120 frames/sec, and it would buy nothing — what sits behind
//     the bar is flat dark pad background. This is the same call Widgets.tsx
//     already made for the buttons ("Glass is built from lighting layers
//     instead"). Simulated, not filtered.
//
// The glow is deliberately gone, not reduced: a glow is the opposite of smoke,
// and re-adding one is explicitly out of bounds for this element.
const GYRO_GLASS: React.CSSProperties = {
  // First layer paints on TOP. Crown -> tint -> smoke, i.e. light source above.
  backgroundImage: [
    // Specular crown. Mirrors the buttons' #padSpec ramp (0.42 -> 0.05 -> 0),
    // slightly softened because this strip is 7.5px tall, not a 40px button.
    "linear-gradient(to bottom, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0) 65%)",
    // Accent tint — the actual signal. Kept strong enough to stay readable as a
    // live readout; smoked glass that you cannot see is not an indicator.
    `linear-gradient(to bottom, rgba(${ACCENT_RGB}, 0.62) 0%, rgba(${ACCENT_RGB}, 0.38) 100%)`,
    // The smoke: a dark underlay that gives the glass depth against the pad.
    "linear-gradient(to bottom, rgba(6,14,16,0.42) 0%, rgba(6,14,16,0.62) 100%)",
  ].join(", "),
  // Hairline rim — lit top edge, dark bottom edge, same read as #padRim. Inset
  // shadows are painted pre-transform, but these are horizontal lines so scaleX
  // does not change their thickness.
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.38)",
};

// ─── Dialog shell — handles backdrop + card animation ─────────────────────────
const BTN_MAP: Record<string, number> = {
  A: 1 << 0,
  B: 1 << 1,
  X: 1 << 2,
  Y: 1 << 3,
  LB: 1 << 4,
  RB: 1 << 5,
  menu: 1 << 6,
  view: 1 << 7,
  lstick: 1 << 8,
  rstick: 1 << 9,
  up: 1 << 10,
  down: 1 << 11,
  left: 1 << 12,
  right: 1 << 13,
  home: 1 << 14,   // → DS4 PS/Guide button (decoded server-side)
};

const CUSTOM_LABEL_MAP: Record<string, string> = {
  "A": "A", "B": "B", "X": "X", "Y": "Y",
  "LB": "LB", "RB": "RB",
  "L3": "lstick", "LS": "lstick", "Left stick": "lstick",
  "R3": "rstick", "RS": "rstick", "Right stick": "rstick",
  "↑": "up", "↓": "down", "←": "left", "→": "right",
  "up": "up", "down": "down", "left": "left", "right": "right",
  "view": "view", "menu": "menu", "home": "home"
};

// ─── PHASE 3: native touch input — geometry export ────────────────────────────
// Flattens a pad's widgets into hit-shapes in DESIGN-SPACE coords (the same
// 1280×570 space the render loop uses) with PRE-RESOLVED button bits + haptic
// tiers, so the Kotlin NativeInputEngine needs no knowledge of labels or maps.
// MUST stay in lockstep with the ControllerScreen render loop: same expansion
// for abxy (spread r*0.71, btnR r*0.40), ltrt pills, trigger pill sizing, dpad
// ids, Hybrid-stick resolution. The Kotlin side transforms touches into this
// space via the published svg.getScreenCTM() and replicates the widget
// semantics (strict 4-way dpad, stick maxR 60, analog trigger fill).
// Flag lives in store/prefs.ts (nativeInputEnabled).

function buildNativeGeometry(pad: CustomPad): any[] {
  // Same tier thresholds as triggerHaptic; press strength for custom widgets is
  // Math.round(btn.haptic / 2) — exactly what the dn() wrappers pass.
  const tier = (s: number) => (s <= 0 ? "" : s <= 30 ? "tick" : s <= 65 ? "buttonPress" : "triggerPull");
  const bitFor = (label: string) => BTN_MAP[CUSTOM_LABEL_MAP[label] ?? label] ?? 0;
  const widgets: any[] = [];
  pad.buttons.forEach((btn: CustomBtnDef) => {
    const hap = tier(Math.round((btn.haptic || 0) / 2));
    if (btn.type === "dpad") {
      widgets.push({ k: "dpad", x: btn.x, y: btn.y, r: btn.r, hap,
        bits: { up: BTN_MAP.up, down: BTN_MAP.down, left: BTN_MAP.left, right: BTN_MAP.right },
        vis: { up: `${btn.uid}_up`, down: `${btn.uid}_down`, left: `${btn.uid}_left`, right: `${btn.uid}_right` } });
    } else if (btn.type === "abxy") {
      const spread = btn.r * 0.71, btnR = btn.r * 0.40;
      ([["y", 0, -spread], ["x", -spread, 0], ["b", spread, 0], ["a", 0, spread]] as [string, number, number][])
        .forEach(([key, dx, dy]) => {
          widgets.push({ k: "btn", shape: "circle", x: btn.x + dx, y: btn.y + dy, r: btnR,
            bits: BTN_MAP[key.toUpperCase()] ?? 0, vis: `${btn.uid}_${key}`, hap });
        });
    } else if ((btn.type as string) === "ltrt") {
      // Legacy compound widget: removed from WidgetType (splitLegacyLtrt migrates
      // saved pads), but still handled defensively here exactly like the render
      // loop does — an unmigrated pad must still export its two trigger pills.
      const pillW = btn.r, pillH = btn.r * 5.85, gap = btn.r * 0.13;
      widgets.push({ k: "trig", x: btn.x - gap / 2 - pillW / 2, y: btn.y, w: pillW, h: pillH,
        side: "L", digital: btn.analogTrigger === false, vis: `${btn.uid}_lt`, hap });
      widgets.push({ k: "trig", x: btn.x + gap / 2 + pillW / 2, y: btn.y, w: pillW, h: pillH,
        side: "R", digital: btn.analogTrigger === false, vis: `${btn.uid}_rt`, hap });
    } else if (btn.type === "thumbstick") {
      const up = btn.label.toUpperCase();
      const which = (up.startsWith("HYBRID") || up === "STICK") ? "H" : (up.startsWith("L") ? "L" : "R");
      widgets.push({ k: "stick", x: btn.x, y: btn.y, r: btn.r, which, vis: btn.uid, hap });
    } else if (btn.type === "stickmode") {
      widgets.push({ k: "mode", x: btn.x, y: btn.y, r: btn.r, mode: btn.label === "R-Mod" ? "R" : "L", hap });
    } else if (btn.type === "trigger") {
      const isLeft = btn.label.toUpperCase().startsWith("L");
      // Standard triggers press via useHeld.dn → STD_BTN_HAPTIC (full value, not halved).
      widgets.push({ k: "trig", x: btn.x, y: btn.y, w: btn.w ?? btn.r * 2, h: btn.h ?? btn.r * 5.85,
        side: isLeft ? "L" : "R", digital: btn.analogTrigger === false,
        vis: isLeft ? "LT" : "RT", std: true, hap: tier(STD_BTN_HAPTIC[isLeft ? "LT" : "RT"] ?? 50) });
    } else { // button | macro
      let bits = bitFor(btn.label);
      if (btn.type === "macro") btn.macroBits.forEach((mb) => { bits |= (BTN_MAP[mb] ?? 0); });
      if (btn.w != null && btn.h != null) {
        widgets.push({ k: "btn", shape: "rect", x: btn.x, y: btn.y, w: btn.w, h: btn.h, bits, vis: btn.uid, hap });
      } else {
        widgets.push({ k: "btn", shape: "circle", x: btn.x, y: btn.y, r: btn.r, bits, vis: btn.uid, hap });
      }
    }
  });
  return widgets;
}

// ─── USB-debugging transport (WebSocket over `adb reverse` to localhost) ──────
// The PC server runs `adb reverse tcp:7777 tcp:7777` + a WebSocket bridge, so the
// phone reaches the PC via ws://127.0.0.1:7777 with NO tethering — just USB
// debugging. Sends the same 20-byte packets; the server echoes an ACK for latency.
// The WebSocket runs in a Web Worker (background thread) so sending packets and
// processing ACKs never wait behind the controller's heavy rendering on the main
// thread — that main-thread jitter was the dominant latency. The worker also
// re-blasts the latest packet at ~200 Hz to keep the wired link hot.
// IMPORTANT: the WS only connects when USB-DEBUGGING is the chosen transport (the
// transport coordinator calls connect()/disconnect()). It used to auto-connect
// forever, which (a) made the PC give this phone a SECOND virtual pad on top of the
// Wi-Fi/tether pad (the "device connects twice" bug, since the server allocates a
// pad on every open WS), and (b) always won over USB-tethering so tethering was
// never actually used. Exactly one transport is live at a time now.
const usbWS = {
  worker: null as Worker | null,
  _open: false,
  latency: null as number | null,
  _started: false,
  start() {
    if (this._started) return;
    this._started = true;
    const code = `
      let ws=null, latest=null, enabled=false, stream=false;
      function connect(){
        try{
          const socket = new WebSocket('ws://127.0.0.1:7777');
          ws = socket;
          ws.binaryType='arraybuffer';
          ws.onopen=function(){ if(ws === socket && enabled) postMessage({t:'open',v:true}); };
          ws.onclose=function(){ if(ws !== socket) return; ws=null; postMessage({t:'open',v:false}); };
          ws.onerror=function(){};
          ws.onmessage=function(e){
            var b=new Uint8Array(e.data);
            if(b.length>=11 && b[0]===65 && b[1]===67 && b[2]===75){
              var dv=new DataView(b.buffer,b.byteOffset+3,8);
              var ts=Number(dv.getBigUint64(0,true));
              postMessage({t:'lat',v:Math.max(0,Date.now()-ts)});
            } else if(b.length>=5 && b[0]===82 && b[1]===77 && b[2]===66){
              // "RMB" + largeMotor + smallMotor — rumble from the PC
              postMessage({t:'rmb',l:b[3],r:b[4]});
            }
          };
        }catch(err){ ws=null; }
      }
      function disconnect(){ try{ if(ws) ws.close(); }catch(e){} ws=null; }
      var lastTry=0;
      var timer=null;
      function tick(){
        if(!enabled){ if(ws){ disconnect(); postMessage({t:'open',v:false}); } schedule(); return; }
        if(ws && ws.readyState===1){
          // 'stream' gates the re-blast to the CONTROLLER SCREEN only. Without
          // it, one packet ever stored in 'latest' was re-sent at ~200Hz from
          // EVERY screen forever — the PC held a virtual pad (with a stale
          // input snapshot latched in it) the whole time the app was open.
          // Found 2026-07-21 via server telemetry: ~250 identical pkt/s from
          // the dashboard, pad_writes=1. The connection itself stays open on
          // every screen (the server expects that standing link); only input
          // transmission is gated.
          if(stream && latest){
            // Stamp send-time into the packet so latency reflects TRUE wire transit,
            // not how long the (unchanged) packet has been sitting here.
            new DataView(latest).setBigUint64(0, BigInt(Date.now()), true);
            ws.send(latest);
          }
        } else if((!ws || ws.readyState>1) && Date.now()-lastTry>1000){
          // Reconnect with a 1s cooldown — never storm new sockets every 3ms.
          lastTry=Date.now();
          connect();
        }
        schedule();
      }
      // ADAPTIVE CADENCE. This used to be setInterval(...,3) with no
      // clearInterval anywhere and no worker.terminate() either, so the thread
      // woke 333x/second for as long as the app was open — on every screen,
      // forever, evaluating branches with nothing to send.
      //
      // The 3 ms re-blast is deliberate and stays EXACTLY as it was while
      // streaming; it is the mechanism that keeps the pad fed. What changes is
      // the idle case: with nothing to stream, the only job left is the 1 s
      // reconnect cooldown, which does not need a 3 ms tick to service. Falling
      // back to 250 ms there cuts ~333 wakeups/sec to 4 while touching nothing
      // about the streaming path.
      function schedule(){
        var fast = enabled && stream && ws && ws.readyState===1;
        timer = setTimeout(tick, fast ? 3 : 250);
      }
      // Re-arm NOW instead of serving out an idle delay. Without this, tapping
      // PLAY could sit up to 250 ms before the first re-blast — the one place
      // the slower idle cadence could have been felt.
      function wake(){ if(timer!==null) clearTimeout(timer); tick(); }
      schedule();
      onmessage=function(e){
        var d=e.data;
        if(d && d.cmd==='connect'){ enabled=true; lastTry=0; wake(); }
        else if(d && d.cmd==='disconnect'){ enabled=false; disconnect(); postMessage({t:'open',v:false}); }
        else if(d && d.cmd==='stream-on'){ stream=true; wake(); }
        else if(d && d.cmd==='stream-off'){
          // Also DROP the latched packet: a later stream-on must be primed by
          // fresh input, never replay a snapshot from the previous session.
          stream=false; latest=null;
        }
        else { latest=d; }
      };
    `;
    try {
      const blob = new Blob([code], { type: "application/javascript" });
      const w = new Worker(URL.createObjectURL(blob));
      this.worker = w;
      w.onmessage = (e: MessageEvent) => {
        const m: any = e.data;
        if (m.t === "open") this._open = m.v;
        else if (m.t === "lat") this.latency = m.v;
        else if (m.t === "rmb") { try { (window as any).onRumblePacket?.(m.l, m.r, 0, 0); } catch {} }
      };
    } catch (e) { console.log("[usbWS] worker init failed: " + String(e)); }
  },
  isOpen() { return this._open; },
  connect() { if (!this._started) this.start(); if (this.worker) { try { this.worker.postMessage({ cmd: "connect" }); } catch {} } },
  disconnect() { this._open = false; if (this.worker) { try { this.worker.postMessage({ cmd: "disconnect" }); } catch {} } },
  // Gate the worker's ~200Hz re-blast to the controller screen. The CONNECTION
  // is not touched — the standing link (and its RTT/rumble channel) stays up on
  // every screen; only input transmission starts/stops. Driven by the
  // ControllerScreen isActive effect.
  setStreaming(on: boolean) {
    if (this.worker) { try { this.worker.postMessage({ cmd: on ? "stream-on" : "stream-off" }); } catch {} }
  },
  send(buf: ArrayBuffer) {
    if (this.worker) { try { this.worker.postMessage(buf); } catch {} }
  },
};
(window as any).__usbWS = usbWS;
usbWS.start(); // creates the worker only; does NOT open the WS until connect() is called

// Wired transport preference (persisted). "auto" prefers USB-tethering and falls
// back to USB-debugging; "tether"/"usbdebug" force one. Read by the transport
// coordinator, the USB auto-pair handler, and the Wired tab UI.
// WiredPref, getWiredPref and setWiredPref live in store/prefs.ts.

// ── Persisted gyro calibration ───────────────────────────────────────────────
// The zero the user set with CALIBRATE, remembered across launches. See the long
// note at zeroRef below for why this is a bug fix and not auto-calibration.
// Mirrored into the native engine through the setNativeGyroConfig payload (zx/zy).
const GYRO_ZERO_KEY = "gp_gyro_zero";

function readGyroZero(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(GYRO_ZERO_KEY);
    if (!raw) return { x: 0, y: 0 };
    const v = JSON.parse(raw);
    // Reject anything that isn't a sane tilt: a corrupt value here would deflect the
    // stick permanently with no obvious cause, which is worse than not restoring.
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 180;
    return ok(v?.x) && ok(v?.y) ? { x: v.x as number, y: v.y as number } : { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

function writeGyroZero(z: { x: number; y: number }) {
  try { localStorage.setItem(GYRO_ZERO_KEY, JSON.stringify(z)); } catch {}
}

function useGyro(maxAngle: number = 45, deadzone: number = 0, onGyroChange?: () => void, enabled: boolean = true, active: boolean = true, wheel: boolean = false) {
  // `enabled` = the user's gyro toggle. When off the loop still runs, so the
  //             bars glide to rest instead of freezing mid-tilt.
  // `active`  = is the controller screen actually on screen. When false there is
  //             nothing to steer and nothing to draw, so the loop should not
  //             exist at all.
  //
  // Deliberately separate. Until `active` existed this was the ONLY loop in the
  // app with no screen gate: a requestAnimationFrame on every screen doing a
  // JSON.parse of the bridge string and firing a packet send per frame — 120 of
  // each per second on a 120 Hz panel, whether or not the phone was moving or
  // the user was anywhere near the controller.
  const tiltRef = useRef({ left: 0, right: 0, x: 0, y: 0 });
  const leftBarRef = useRef<HTMLDivElement>(null);
  const rightBarRef = useRef<HTMLDivElement>(null);
  // Resting-flat "idle" flag from the native detector (MainActivity.gyroRestingFlat,
  // surfaced as data.idle). idleRef is read on the hot send path (no re-render);
  // `idle` is a low-frequency mirror for the on-screen "Idle" indicator, updated
  // only on transitions so it never re-renders per frame.
  const idleRef = useRef(false);
  const [idle, setIdle] = useState(false);

  // ── CALIBRATE ──────────────────────────────────────────────────────────────
  // rawRef always holds the newest UNCORRECTED tilt angles; calibrate() snapshots
  // them into zeroRef, which is then subtracted from every later reading. Net
  // effect: "however I'm holding the phone right now is centre/neutral", so you
  // can play reclined or with the phone tilted and still get full ± range.
  // (This existed up to 1.3.7 and was lost in the 2026-07-14 App.tsx corruption
  // + reconstruction — restored here, same behaviour as the original.)
  const rawRef = useRef({ x: 0, y: 0 });
  // The zero PERSISTS across launches. It used to reset to {0,0} on every app start,
  // and {0,0} means "centre == phone perfectly flat" — so opening the controller while
  // holding the phone at any natural angle put the stick straight into a deflection
  // (at 45deg sensitivity, a 20deg holding angle is ~44% off-centre before you touch
  // anything). That is the "controller locks to one side when opening" report, and it
  // meant re-pressing CALIBRATE after every single launch.
  //
  // This is NOT auto-calibration. Nothing is ever zeroed on the user's behalf; we only
  // remember the zero they set themselves with the CALIBRATE button. It suits a mounted
  // phone especially well, where the mount angle is stable across sessions and having
  // the app silently re-zero to the current pose would be actively wrong.
  const zeroRef = useRef(readGyroZero());
  const calibrate = useCallback(() => {
    let zero = { ...rawRef.current };
    try {
      const result = (window as any).AndroidBridge?.nativeGyroCalibrate?.();
      if (typeof result === "string") {
        const nativeZero = JSON.parse(result);
        if (Number.isFinite(nativeZero.x) && Number.isFinite(nativeZero.y)) zero = nativeZero;
      }
    } catch {}
    zeroRef.current = zero;
    writeGyroZero(zeroRef.current);
  }, []);

  const onGyroChangeRef = useRef(onGyroChange);
  useEffect(() => {
    onGyroChangeRef.current = onGyroChange;
  });
  // Live-readable enabled flag so the poll can rest the bars when gyro is off
  // without tearing down/recreating the animation loop.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; });

  useEffect(() => {
    // Off screen: no loop, no listener, nothing scheduled.
    if (!active) return;
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.getGyroscopeDataJson) {
      // ONE rAF loop doing two jobs each frame:
      //  • DATA (pumpGyro): reads the bridge, updates the steering value and
      //    fires the packet send. Previously an 8ms setInterval — moved onto the
      //    rAF tick because Chromium defers DOM timers ~100ms around every
      //    touchstart, which froze steering on each button press (see pumpGyro).
      //  • RENDER with a LIGHT glide (~28 ms time constant): the bar slides
      //    smoothly across the 8 ms data steps. VISUAL ONLY — the steering value
      //    sent to the game is raw. This is NOT the heavy ~140 ms smoothing that
      //    was tried and rejected (see SKILL.md); it's below perception threshold
      //    for a readout bar.
      //    120 Hz-SAFE: the glide is DELTA-TIME based (k = 1 - e^(-dt/tau)), not a
      //    fixed per-frame factor. A per-frame 0.45 would converge twice as fast on
      //    a 120 Hz panel as on 60 Hz, so the bar felt different per device; this
      //    form gives identical real-time behaviour at any refresh rate (and
      //    reproduces the old 0.45/frame exactly at 60 Hz).
      // 28 -> 11: the bar was not dropping frames, it was DAMPED. Measured on a
      // Redmi Note 13: sensor delivers game_rotvec at samplingPeriod=5000us
      // (200 Hz), the rAF pump runs at 120 Hz and writes a GPU scaleX — every
      // link was already faster than the panel. The only thing between the hand
      // and the pixels was this glide, and tau=28 needs ~3*tau = 84 ms (~10
      // frames at 120 Hz) to cover 95% of a move, which reads as trailing lag.
      // Safe to shorten because noise is ALREADY handled upstream by the native
      // OneEuroFilter (minCutoff 2.8, beta 0.5), which is adaptive — it damps
      // hard when the hand is still and gets out of the way when it moves. This
      // fixed glide is not adaptive, so it taxed fast motion for no benefit.
      // tau=11 => 95% in ~33 ms (~4 frames). Raise it if a resting hand jitters.
      const GLIDE_TAU_MS = 11;
      let targetBx = 0;   // indicator target (-1..1) from the data loop
      let dispBx = 0;     // displayed (glided) bar position
      let lastFrameTs = 0; // rAF timestamp of the previous frame (for dt)
      let ageSum = 0, ageN = 0, lastAgeLog = Date.now(); // staleness telemetry

      // ── WHY THIS IS A FUNCTION CALLED FROM rAF, NOT A setInterval ──────────
      // MEASURED 2026-07-20 (CDP probe, 762 taps): Chromium's renderer scheduler
      // enters its `touchstart` use-case on every discrete tap and DEFERS DOM
      // TIMER queues for ~90-160ms — 399 such holes in one 2-min session, each
      // starting ~10-20ms BEFORE the JS pointerdown handler even runs. Long
      // tasks recorded: ZERO. rAF p95 through the same taps: 8.4ms (120Hz,
      // compositor-driven — NOT deferred by that policy). So an 8ms setInterval
      // here froze the steering for ~100ms on every button press while the main
      // thread sat idle; driving the same read from the rAF tick is immune.
      // (~8.3ms cadence on this 120Hz panel — same freshness as the old 8ms
      // interval; 16.7ms worst-case on a 60Hz panel, still ≪ a 100ms hole.)
      // Do NOT move this back to setInterval/setTimeout.
      const pumpGyro = () => {
        try {
          if (!enabledRef.current) {
            // Gyro off → rest the bars empty and don't feed tilt into the stick.
            tiltRef.current = { left: 0, right: 0, x: 0, y: 0 };
            targetBx = 0;
            if (idleRef.current) { idleRef.current = false; setIdle(false); }
            return;
          }
          const data = JSON.parse(bridge.getGyroscopeDataJson());
          // Resting-flat idle from the native detector. Update the render mirror
          // only on a transition (this loop runs ~120x/s; setIdle every frame
          // would thrash React).
          const nowIdle = !!data.idle;
          if (nowIdle !== idleRef.current) { idleRef.current = nowIdle; setIdle(nowIdle); }
          // data.nx/ny = RAW angle in degrees from the native fusion pipeline.
          // nx is atan2-derived and UNWRAPPED across the ±180° seam (see
          // MainActivity.unwrapRoll), so it is continuous multi-turn travel — up to
          // ±1080°, NOT ±90°. Wheel mode depends on that; anything assuming a ±90
          // range here will silently clip a truck wheel to a fraction of its lock.
          // sensitivity = full-lock angle (deg): tilt `maxAngle` deg => full ±1.
          // deadzone = ignore tilts below `deadzone` deg; past it the ABSOLUTE
          // angle is read (no re-normalization), e.g. dz=10, tilt 11 => 11/sens.
          const sensDeg = Math.max(1, maxAngle); // sensitivity = full-lock tilt angle in degrees (tilt this many deg => full ±1)
          const dzDeg = Math.max(0, deadzone);
          // Keep the uncorrected reading for calibrate(), then apply the zero offset
          // so "wherever the phone is held when you tap CALIBRATE" becomes centre.
          rawRef.current = { x: data.nx || 0, y: data.ny || 0 };
          const deltaX = (data.nx || 0) - zeroRef.current.x;
          const nx = wheel ? deltaX : ((deltaX + 180) % 360 + 360) % 360 - 180;
          const ny = (data.ny || 0) - zeroRef.current.y;
          const gateX = Math.abs(nx) < dzDeg ? 0 : nx;
          const gateY = Math.abs(ny) < dzDeg ? 0 : ny;
          // STEERING value sent to the game — range (deadzone) APPLIED here.
          const rx = Math.max(-1, Math.min(1, gateX / sensDeg));
          const ry = Math.max(-1, Math.min(1, gateY / sensDeg));

          tiltRef.current = { left: rx < 0 ? Math.abs(rx) : 0, right: rx >= 0 ? rx : 0, x: rx, y: ry };

          // INDICATOR target: lock at the range mark while inside the range, then
          // follow real tilt. Negated so the bar fills the side you tilt toward.
          const indAbs = Math.abs(nx);
          const indDir = nx < 0 ? -1 : 1;
          let indMag;
          if (dzDeg > 0 && indAbs < dzDeg) indMag = indAbs < 2 ? 0 : (dzDeg / sensDeg);
          else indMag = indAbs / sensDeg;
          indMag = Math.min(1, indMag);
          targetBx = -(indDir * indMag);
          // 3D mode's look-dot needs the PITCH axis too (the tilt bar is X-only).

          // Staleness verification: data.age = ms between the sensor event and this
          // read (native-stamped). Logged every 5 s — readable via logcat/CDP.
          if (typeof data.age === "number" && data.age >= 0) {
            ageSum += data.age; ageN++;
            if (Date.now() - lastAgeLog > 5000 && ageN > 0) {
              console.log(`[gyro] sensor→read staleness avg ${(ageSum / ageN).toFixed(1)}ms (${ageN} reads)`);
              ageSum = 0; ageN = 0; lastAgeLog = Date.now();
            }
          }

          if (onGyroChangeRef.current) onGyroChangeRef.current();
        } catch (e) {
          // ignore transient bridge/parse hiccups
        }
      };

      let reqId: number;
      const render = (ts?: number) => {
        // DATA first, on the rAF tick (immune to Chromium's touchstart timer
        // deferral — see pumpGyro above), then the visual glide below.
        pumpGyro();
        // Frame-rate independent exponential glide. dt is clamped so a stall (tab
        // hidden, GC pause) can't produce a huge jump on the next frame.
        const now = ts ?? performance.now();
        const dt = lastFrameTs ? Math.min(now - lastFrameTs, 100) : 16.7;
        lastFrameTs = now;
        const k = 1 - Math.exp(-dt / GLIDE_TAU_MS);
        dispBx += (targetBx - dispBx) * k;
        if (Math.abs(targetBx - dispBx) < 0.004) dispBx = targetBx; // snap the tail
        // scaleX (GPU-composited, no layout reflow) = smoothest update.
        if (leftBarRef.current)  leftBarRef.current.style.transform  = `scaleX(${dispBx < 0 ? -dispBx : 0})`;
        if (rightBarRef.current) rightBarRef.current.style.transform = `scaleX(${dispBx >= 0 ? dispBx : 0})`;
        // 3D look-dot: 2-axis, ±16px of travel inside its 44px scope box.
        reqId = requestAnimationFrame(render);
      };
      reqId = requestAnimationFrame(render);
      return () => { cancelAnimationFrame(reqId); };
    }

    const handleOrientation = (e: DeviceOrientationEvent) => {
      let pitch = 0;
      let roll = 0;
      const orientation = (window.screen && window.screen.orientation && window.screen.orientation.type) || "";
      const angle = typeof window.orientation === "number" ? window.orientation : 0;
      
      if (orientation.includes("landscape-primary") || angle === 90) {
        pitch = e.gamma || 0;
        roll = e.beta || 0;
      } else if (orientation.includes("landscape-secondary") || angle === -90) {
        pitch = -(e.gamma || 0);
        roll = -(e.beta || 0);
      } else {
        pitch = (e.beta || 0) - 45;
        roll = e.gamma || 0;
      }

      // Degree model (same as native): full lock at `sensDeg` deg of tilt; ignore
      // below `dzDeg` deg, then read the absolute angle.
      const sensDeg = Math.max(1, maxAngle); // sensitivity = full-lock tilt angle in degrees (tilt this many deg => full ±1)
      const dzDeg = Math.max(0, deadzone);
      // Same calibrate offset as the native path (see rawRef/zeroRef above).
      rawRef.current = { x: roll, y: pitch };
      roll -= zeroRef.current.x;
      pitch -= zeroRef.current.y;
      const gRoll = Math.abs(roll) < dzDeg ? 0 : roll;
      const gPitch = Math.abs(pitch) < dzDeg ? 0 : pitch;
      // STEERING value sent to the game — range (deadzone) applied.
      const clampX = Math.max(-1, Math.min(1, gRoll / sensDeg));
      const clampY = Math.max(-1, Math.min(1, gPitch / sensDeg));

      tiltRef.current = { left: clampX < 0 ? Math.abs(clampX) : 0, right: clampX >= 0 ? clampX : 0, x: clampX, y: clampY };

      // INDICATOR: lock at the range mark while inside the range, then follow real
      // tilt; rest at centre when ~neutral so noise doesn't peg it.
      const indAbs = Math.abs(roll);
      const indDir = roll < 0 ? -1 : 1;
      let indMag;
      if (dzDeg > 0 && indAbs < dzDeg) indMag = indAbs < 2 ? 0 : (dzDeg / sensDeg);
      else indMag = indAbs / sensDeg;
      indMag = Math.min(1, indMag);
      const bx = -(indDir * indMag);
      if (leftBarRef.current) {
        leftBarRef.current.style.width = `${(bx < 0 ? Math.abs(bx) : 0) * 100}%`;
      }
      if (rightBarRef.current) {
        rightBarRef.current.style.width = `${(bx >= 0 ? bx : 0) * 100}%`;
      }
      // 3D look-dot (browser fallback) — same ±16px scope travel as the native path.

      if (onGyroChangeRef.current) onGyroChangeRef.current();
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [maxAngle, deadzone, active, wheel]);

  return { tiltRef, leftBarRef, rightBarRef, calibrate, idleRef, idle };
}

// ─── Controller Screen ────────────────────────────────────────────────────────
function ControllerScreen({ onBack, isActive: screenActive, activeMapping, customPad, controllerLayout, posOverride, gyroOn, setGyroOn, gyroMaxAngle, gyroWheel, gyroMode, gyroDeadzone, gyroHaptic, gyroThrottle, gyroIdleDetect, rumbleOn }: {
  onBack: () => void; isActive: boolean;
  activeMapping: Partial<Record<BtnId, string>>;
  customPad?: CustomPad;
  controllerLayout?: "standard" | "mobile";
  posOverride?: PosOverrideMap;
  gyroOn: boolean;
  setGyroOn: (v: boolean) => void;
  gyroMaxAngle: number;
  /** Wheel mode on — orientation is pinned, so the driver needs a manual rotate. */
  gyroWheel: boolean;
  gyroMode: string;          // "racing" = 1-axis steering | "3d" = 2-axis look
  gyroDeadzone: number;
  gyroHaptic: boolean;
  gyroThrottle: boolean;     // racing only: tilt fwd/back → left-stick Y
  gyroIdleDetect: boolean;   // #2: whether flat-surface idle detection is enabled
  rumbleOn: boolean;
}) {
  const [rumble, setRumble] = useState({ left: 0, right: 0, lt: 0, rt: 0 });
  const rumbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Playtime ──────────────────────────────────────────────────────────────
  // Gated on `isActive`, the same signal the streaming worker uses (see the
  // 1.3.23 always-streaming fix). BILLING_DECISIONS 2.2 is explicit that this
  // must be the billing clock and that a second signal must not be invented:
  // if the two disagreed, the app would bill for time it was not streaming.
  // isBlocked, NOT getPlaytimeState: the state object is rebuilt every second
  // while the clock ticks, so subscribing to it re-rendered this whole screen --
  // pad SVG included -- once a second during play. A boolean flips at most once
  // a session, so React bails out until it actually changes.
  const present = useIsPresent();
  const isActive = screenActive && present;
  const outOfTime = useSyncExternalStore(onPlaytimeChange, isBlocked, isBlocked);
  // A fresh install could open this screen and stream real input with no
  // account at all — playtime was never tracked because nothing checked for
  // a session before letting the pad go live. `!!getSession()` is a plain
  // boolean, same reasoning as isBlocked above: flips at most once per
  // sign-in/out, so this does not re-render the pad on every tick either.
  const hasSession = useSyncExternalStore(onSessionChange, () => !!getSession(), () => !!getSession());

  useEffect(() => {
    if (!isActive) return;
    void beginPlay();
    return () => { void endPlay(); };
  }, [isActive, hasSession]);

  const leavingForPlans = useRef(false);
  useEffect(() => {
    if (!isActive || !outOfTime || hasSession || leavingForPlans.current) return;
    leavingForPlans.current = true;
    requestDashboardTab("account");
    onBack();
  }, [isActive, outOfTime, hasSession, onBack]);

  useEffect(() => {
    if (!isActive) return;

    // The bridge calls this when a rumble packet arrives from PC
    (window as any).onRumblePacket = (leftMotor: number, rightMotor: number, ltHaptic: number, rtHaptic: number) => {
      setRumble({ left: leftMotor, right: rightMotor, lt: ltHaptic, rt: rtHaptic });
      
      if (rumbleOn) {
        // Rumble is on or off; the game decides how hard it shakes. There is no
        // user intensity multiplier — a slider that scaled the game's own signal
        // only made strong effects weaker, and phones without variable-amplitude
        // motors ignored it anyway.
        const strength = Math.max(leftMotor, rightMotor); // 0..255 from the game
        if (strength >= 1) {
          // Pulse length still tracks strength, so a light bump and a crash feel
          // different even on a motor with no amplitude control.
          const dur = Math.round(20 + (strength / 255) * 80); // 20..100ms
          const bridge = (window as any).AndroidBridge;
          if (bridge && bridge.triggerRumble) {
            bridge.triggerRumble(leftMotor, rightMotor, dur);
          } else if (navigator.vibrate) {
            navigator.vibrate(dur);
          }
        }
      }

      // Auto-clear rumble display after 150ms of no new packets
      if (rumbleTimeoutRef.current) clearTimeout(rumbleTimeoutRef.current);
      rumbleTimeoutRef.current = setTimeout(() => {
        setRumble({ left: 0, right: 0, lt: 0, rt: 0 });
      }, 150);
    };

    // Wi-Fi rumble pump. Over USB the WebSocket worker calls onRumblePacket
    // directly ("rmb" message); over Wi-Fi the UDP socket lives in native code,
    // so we poll the native engine for the latest motor values and feed the SAME
    // sink. getRumbleState() returns "seq:left:right" — we fire only when the
    // sequence advances (a new RMB datagram arrived), so the motor isn't
    // re-triggered on idle polls and USB (seq always 0) never double-fires.
    const bridge = (window as any).AndroidBridge;
    let rumblePoll: ReturnType<typeof setInterval> | null = null;
    if (bridge && bridge.getRumbleState) {
      let lastSeq = -1;
      rumblePoll = setInterval(() => {
        try {
          const parts = String(bridge.getRumbleState()).split(":");
          const seq = +parts[0], left = +parts[1], right = +parts[2];
          if (seq !== lastSeq) {
            lastSeq = seq;
            (window as any).onRumblePacket?.(left, right, 0, 0);
          }
        } catch (e) {}
      }, 33);   // ~30Hz, matches the server's per-packet RMB cadence
    }

    return () => {
      delete (window as any).onRumblePacket;
      if (rumbleTimeoutRef.current) clearTimeout(rumbleTimeoutRef.current);
      if (rumblePoll) clearInterval(rumblePoll);
    };
  }, [isActive, rumbleOn]);
  const svgRef = useRef<SVGSVGElement>(null);
  const sendTelemetryRef = useRef<() => void>(() => {});
  const { held, heldRef, dn, up } = useHeld(() => sendTelemetryRef.current());
  // heldCustom (uid-keyed) mirrored into a ref so the packet builder reads live
  // values synchronously — same low-latency pattern as the sticks / useHeld.
  const [heldCustom, setHeldCustom] = useState<Set<string>>(new Set());
  const heldCustomRef = useRef<Set<string>>(heldCustom);
  const dnCustom = useCallback((uid: string) => {
    heldCustomRef.current = new Set([...heldCustomRef.current, uid]);
    sendTelemetryRef.current();
    setHeldCustom(new Set(heldCustomRef.current));
  }, []);
  const upCustom = useCallback((uid: string) => {
    const n = new Set(heldCustomRef.current); n.delete(uid); heldCustomRef.current = n;
    sendTelemetryRef.current();
    setHeldCustom(new Set(heldCustomRef.current));
  }, []);
  const rstick = useStick(60, svgRef, () => sendTelemetryRef.current());
  const lstick = useStick(60, svgRef, () => sendTelemetryRef.current());
  const stickModeRef = useRef<"L" | "R">("L");
  const [stickMode, setStickMode] = useState<"L" | "R">("L");
  const selectStickMode = useCallback((mode: "L" | "R") => {
    stickModeRef.current = mode;
    setStickMode(mode);
  }, []);

  // ── PHASE 3: native touch input path (feature-flagged) ──────────────────────
  // While active, the Kotlin overlay owns ALL widget touches + packet building
  // (incl. gyro), and JS only mirrors pressed-state for visuals (__nvis below).
  // nativeActiveRef gates sendGamepadTelemetry; nativeVis overrides the held
  // sets the widgets render from. Flag: localStorage gp_native_input ("0" = off),
  // runtime toggle window.__setNativeInput(bool).
  const nativeActiveRef = useRef(false);
  const [nativeVis, setNativeVis] = useState<{ held: Set<string>; stdHeld: Set<string> } | null>(null);
  const lastVisKeyRef = useRef("");
  const [nativeFlag, setNativeFlag] = useState<boolean>(nativeInputEnabled());

  // Fixed 1000Hz engine; tuning/credits removed for v1.0.
  // Trigger fills mirror into refs (read by the packet builder) and send
  // immediately on change, then update state for the visual fill — same
  // ref-then-send pattern as buttons/sticks so a digital trigger press isn't
  // delayed a full render before the packet goes out.
  const [ltFill, setLtFillState] = useState(0);
  const [rtFill, setRtFillState] = useState(0);
  const ltFillRef = useRef(0);
  const rtFillRef = useRef(0);
  const setLtFill = useCallback((v: number) => {
    ltFillRef.current = v;
    sendTelemetryRef.current();
    setLtFillState(v);
  }, []);
  const setRtFill = useCallback((v: number) => {
    rtFillRef.current = v;
    sendTelemetryRef.current();
    setRtFillState(v);
  }, []);
  // `isActive` is the same signal the streaming worker uses — see the 1.3.23
  // always-streaming fix. One source of truth for "the user is playing".
  const gyroTilt = useGyro(gyroMaxAngle, gyroDeadzone, () => sendTelemetryRef.current(), gyroOn, isActive, gyroWheel);
  const lastGyroHitMax = useRef({ x: false, y: false });
  // (The on-controller latency badge and the 200 ms telemetry poll that fed it
  // were removed on 2026-10-01: each poll stored a new object and re-rendered
  // the whole pad five times a second, for a number players don't need.)

  // Web browser emulation buffer logging state
  const [hudTelemetry, setHudTelemetry] = useState<{
    hex: string[];
    buttons: number;
    lt: number;
    rt: number;
    lsX: number;
    lsY: number;
    rsX: number;
    rsY: number;
    ts: string;
  } | null>(null);

  const isCustom = true;
  const activePad = useMemo(() => {
    if (customPad) return customPad;
    return makeDefaultPad(controllerLayout === "mobile" ? "mobile" : "standard");
  }, [customPad, controllerLayout]);

  // uid → canonical BtnId lookup + macro list, rebuilt only when the pad layout
  // changes — NOT on every packet (this used to be reconstructed per send).
  // "button"/"macro" pass btn.uid as id; compound widgets use "${uid}_subkey";
  // face_cluster/dpad_grid use hardcoded canonical ids directly (no lookup).
  const { uidBitMap, macroDefs } = useMemo(() => {
    const map: Record<string, string> = {};
    const macros: { uid: string; bits: string[] }[] = [];
    activePad.buttons.forEach((btn: CustomBtnDef) => {
      if (btn.type === "button" || btn.type === "macro") {
        map[btn.uid] = CUSTOM_LABEL_MAP[btn.label] ?? btn.label;
        if (btn.type === "macro") macros.push({ uid: btn.uid, bits: btn.macroBits });
      } else if (btn.type === "dpad") {
        map[`${btn.uid}_up`]    = "up";
        map[`${btn.uid}_down`]  = "down";
        map[`${btn.uid}_left`]  = "left";
        map[`${btn.uid}_right`] = "right";
      } else if (btn.type === "abxy") {
        map[`${btn.uid}_a`] = "A";
        map[`${btn.uid}_b`] = "B";
        map[`${btn.uid}_x`] = "X";
        map[`${btn.uid}_y`] = "Y";
      }
    });
    return { uidBitMap: map, macroDefs: macros };
  }, [activePad]);

  // Reuse one 20-byte packet across all sends instead of allocating per call.
  // Safe because send is synchronous: usbWS.send → worker.postMessage performs a
  // structured clone (copy), and the native JSI path reads the buffer before we
  // return — so the next mutation never races a previous send.
  const packetRef = useRef<{ buffer: ArrayBuffer; view: DataView } | null>(null);
  if (packetRef.current === null) {
    const buffer = new ArrayBuffer(20);
    packetRef.current = { buffer, view: new DataView(buffer) };
  }

  const sendGamepadTelemetry = useCallback(() => {
    // PHASE 3: while the native overlay owns input, JS must NOT send — the
    // native layer builds every payload (incl. gyro merge) and the C++ TX
    // thread handles redundancy/keep-alive. Exception-free early return keeps
    // the gyro rAF pump + heartbeat harmless while gated.
    if (nativeActiveRef.current) return;
    const buffer = packetRef.current!.buffer;
    const view = packetRef.current!.view;

    // 1. Timestamp (64-bit uint, little-endian)
    const now = Date.now();
    view.setBigUint64(0, BigInt(now), true);

    // 2. Button Bitmask (16-bit uint, little-endian)
    // Read live held state from refs (updated synchronously on pointerdown/up)
    // so both immediate sends and the keep-alive interval see current values.
    let bitmask = 0;
    const heldCustomSet = heldCustomRef.current;

    heldCustomSet.forEach(id => {
      const canonical = uidBitMap[id] ?? id;
      const bit = BTN_MAP[canonical];
      if (bit) bitmask |= bit;
    });

    // Process macros — macroBits fire additional buttons when the macro widget is held
    macroDefs.forEach(({ uid, bits }) => {
      if (heldCustomSet.has(uid)) {
        bits.forEach((mb) => {
          const bit = BTN_MAP[mb as BtnId];
          if (bit) bitmask |= bit;
        });
      }
    });

    // Add always-on system buttons
    heldRef.current.forEach(btnId => {
      const bit = BTN_MAP[btnId];
      if (bit) bitmask |= bit;
    });

    view.setUint16(8, bitmask, true);

    // 3. Triggers LT/RT with Hair-Trigger re-scaling (default 15%)
    const activeThreshold = Math.max(0.05, (100 - 15) / 100);
    const finalLtFill = Math.min(1.0, ltFillRef.current / activeThreshold);
    const finalRtFill = Math.min(1.0, rtFillRef.current / activeThreshold);
    const ltByte = Math.max(0, Math.min(255, Math.round(finalLtFill * 255)));
    const rtByte = Math.max(0, Math.min(255, Math.round(finalRtFill * 255)));
    view.setUint8(10, ltByte);
    view.setUint8(11, rtByte);

    // 4. Joysticks (Left Stick & Right Stick with Circular Deadzone)
    // Right Stick X/Y with Circular Deadzone outer mapping
    let rx = rstick.posRef.current.x;
    let ry = rstick.posRef.current.y;
    
    // Left Stick X/Y from the left thumbstick touch (movement).
    let lx = lstick.posRef.current.x;
    let ly = lstick.posRef.current.y;

    // ── Gyro idle gate ────────────────────────────────────────────────────────
    // Suppress gyro while the phone is resting flat on a surface. The flag is the
    // native flat+still detector (MainActivity.gyroRestingFlat via data.idle),
    // shared verbatim with the native engine so both transports behave identically.
    // A HELD phone at any angle never idles; only a set-down one does.
    const gyroIdle = gyroTilt.idleRef.current;

    // Gyro full-lock tick. RACING watches the steering axis only; 3D watches
    // both, since a 3D "look" can bottom out on either axis.
    // (The tilt itself is applied AFTER the stick deadzone — see below.)
    if (gyroOn && gyroHaptic && !gyroIdle) {
      const gx = gyroTilt.tiltRef.current.x;
      const gy = gyroTilt.tiltRef.current.y;
      const isMax = (gyroMode === "racing" ? Math.abs(gx) : Math.max(Math.abs(gx), Math.abs(gy))) >= 0.99;
      if (isMax && !lastGyroHitMax.current.x) triggerHaptic(15);
      lastGyroHitMax.current.x = isMax;
    }
    
    const processStick = (x: number, y: number) => {
      const distance = Math.sqrt(x * x + y * y);
      const deadzoneRadius = (8 / 100) * 60; // 8% default deadzone
      if (distance >= deadzoneRadius && distance > 0) {
        // applyStickCurve is the identity at exp 1 (the default), so this is
        // byte-identical to the previous linear map unless the user opts in.
        // Mirror of NativeInputEngine.radialDeadzone.
        const factor = applyStickCurve((distance - deadzoneRadius) / (60 - deadzoneRadius));
        return {
          x: (x / distance) * factor * 60,
          y: (y / distance) * factor * 60
        };
      }
      return { x: 0, y: 0 };
    };

    const finalLs = processStick(lx, ly);
    const finalRs = processStick(rx, ry);

    // Center on 128 (true neutral for a 0-255 axis). At rest finalLs/Rs = 0 →
    // exactly 128, so the PC's virtual stick sits dead-center and the Windows
    // shell doesn't see a phantom nudge.
    const axisByte = (norm: number) => Math.max(0, Math.min(255, Math.round(128 + norm * 127)));

    // ── Gyro → sticks, applied HERE (normalized -1..1, after the thumbstick's
    // radial deadzone) so a small tilt is never swallowed by the stick deadzone.
    // useGyro already applied its own degree-deadzone + sensitivity.
    //   RACING → steering wheel: tilt L/R drives LEFT-stick X. With tilt-throttle
    //            on, tilt fwd/back also drives LEFT-stick Y (accelerate/brake).
    //   3D     → 2-axis look: tilt drives the RIGHT stick on both axes.
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    let lsX = finalLs.x / 60, lsY = finalLs.y / 60;
    let rsX = finalRs.x / 60, rsY = finalRs.y / 60;
    if (gyroOn && !gyroIdle) {
      const gx = gyroTilt.tiltRef.current.x;
      const gy = gyroTilt.tiltRef.current.y;
      if (gyroMode === "racing") {
        lsX = clamp1(lsX - gx);                        // negated so the car matches the physical tilt
        if (gyroThrottle) lsY = clamp1(lsY - gy);      // forward = accelerate, back = brake
      } else {
        rsX = clamp1(rsX - gx);
        rsY = clamp1(rsY + gy);
      }
    }
    const lsXByte = axisByte(lsX);
    const lsYByte = axisByte(lsY);
    const rsXByte = axisByte(rsX);
    const rsYByte = axisByte(rsY);
    
    view.setUint8(12, lsXByte);
    view.setUint8(13, lsYByte);
    view.setUint8(14, rsXByte);
    view.setUint8(15, rsYByte);

    // 5. Auth Token (32-bit uint, little-endian, 0xABCD1234)
    view.setUint32(16, 0xABCD1234, true);

    // 6. Send — over the USB-debugging WebSocket if active, else the native JSI/UDP path.
    const jsiSend = (window as any).sendGamepadPacket;
    if (usbWS.isOpen()) {
      usbWS.send(buffer);
    } else if (jsiSend) {
      try {
        jsiSend(buffer);
      } catch (err) {
        console.error("Native sendGamepadPacket failed:", err);
      }
    }

    // 7. Render Emulated Live Data in browser environment
    if (!jsiSend) {
      const bytes = new Uint8Array(buffer);
      const hexArr = Array.from(bytes).map(b => b.toString(16).padStart(2, "0").toUpperCase());
      setHudTelemetry({
        hex: hexArr,
        buttons: bitmask,
        lt: ltByte,
        rt: rtByte,
        lsX: lsXByte,
        lsY: lsYByte,
        rsX: rsXByte,
        rsY: rsYByte,
        ts: now.toString(),
      });
    }
  }, [uidBitMap, macroDefs, gyroOn]);

  useEffect(() => {
    sendTelemetryRef.current = sendGamepadTelemetry;
  });

  // Buttons/triggers/sticks/gyro now each send SYNCHRONOUSLY the instant their
  // ref updates (see dn/up/dnCustom/upCustom, setLtFill/setRtFill, useStick,
  // useGyro), so we no longer wait for a render+effect to transmit a press.
  // This effect only pushes one packet on the edges that have no synchronous
  // send of their own: controller activation, and toggling gyro on/off.
  useEffect(() => {
    if (isActive) {
      sendTelemetryRef.current();
    }
  }, [isActive, gyroOn]);

  // Steady polling loop at the configured Hz. Event-driven sends alone are
  // fragile: a single dropped UDP packet on a change is never re-sent, and a
  // held-but-unchanging stick stops transmitting. This heartbeat re-sends the
  // CURRENT state every interval so the server always converges to the truth
  // and analog input stays smooth. Uses sendTelemetryRef (always latest fn).
  useEffect(() => {
    if (!isActive) return;
    // Engine runs at a fixed ~60Hz JS heartbeat (native C++ TX thread does the
    // real 1000Hz send). This re-sends current state so dropped packets recover.
    const id = setInterval(() => sendTelemetryRef.current(), 16);
    return () => clearInterval(id);
  }, [isActive]);

  // Input STREAMING follows the controller screen, and nothing else. Without
  // this gate the usbWS worker re-blasted its last packet at ~200Hz from every
  // screen — the PC kept a virtual pad (with a stale stick/gyro snapshot
  // latched) the entire time the app was open, exposing users to anything on
  // the PC that reacts to a controller (Game Bar volume, Steam overlays, ...).
  // Proven via server telemetry 2026-07-21: ~250 identical pkt/s from the
  // DASHBOARD, pad_writes=1. The wired CONNECTION stays open (standing link);
  // only transmission is gated. Cleanup also fires on unmount.
  useEffect(() => {
    // Quota gates actual input for both guests and signed-in accounts.
    // The expiry dialog is presentation; it does not enforce the allowance.
    // Latching NEUTRAL here also means the pad goes inert rather than
    // freezing on whatever was last held down.
    const streaming = isActive && !outOfTime && !isBlocked();
    usbWS.setStreaming(streaming);
    // Same gate for the NATIVE engine (Wi-Fi/tether). Its ~30Hz keep-alive
    // otherwise re-broadcasts the last real payload from every screen; when
    // gated off it latches NEUTRAL and keeps the keep-alive running, so the
    // link (ACK-driven) stays alive but the pad is inert. See checklist B0.
    const bridge = (window as any).AndroidBridge;
    try { bridge?.setInputStreaming?.(streaming); } catch {}
    return () => {
      usbWS.setStreaming(false);
      try { bridge?.setInputStreaming?.(false); } catch {}
    };
  }, [isActive, outOfTime]);

  // Measure screen dynamically for physical edge-anchoring bounds
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        // Same size -> keep the SAME object (2026-10-05). A new object re-ran
        // the native-touch effect below, whose cleanup deactivates the overlay
        // and releases every held finger -- a dropped throttle mid-race on a
        // resize event that changed nothing.
        const w = window.innerWidth, h = window.innerHeight;
        setWindowSize((p) => (p.width === w && p.height === h ? p : { width: w, height: h }));
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    handleResize(); // trigger once to be safe
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, []);

  // ── PHASE 3: runtime flag toggle (for A/B against the JS path) ──────────────
  useEffect(() => {
    (window as any).__setNativeInput = (v: boolean) => {
      setNativeInputEnabled(!!v);
      setNativeFlag(!!v);
    };
    return () => { delete (window as any).__setNativeInput; };
  }, []);

  // ── Stick feel toggle: window.__setStickFeel(follow, curve) ─────────────────
  // Bumping the nonce re-runs the geometry effect below, which republishes
  // stickFollow/curveExp to the native engine. Without that the JS path would
  // pick the new values up and the native path would keep the old ones.
  const [stickFeelNonce, setStickFeelNonce] = useState(0);
  useEffect(() => installStickFeelToggle(() => setStickFeelNonce((n) => n + 1)), []);

  // ── PHASE 3: publish geometry + hand touch ownership to the native overlay ──
  // Runs when the controller becomes active and re-runs on pad switch / resize
  // (the svg's screen matrix changes). Never activates while the USB-debugging
  // WebSocket owns the transport — that path bypasses the native engine, so JS
  // must keep sending; a 500ms watcher yields/reclaims on transport changes.
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    // `!hasSession || outOfTime` closes the actual bug: this effect answers
    // only to isActive, so with neither check it armed the NATIVE touch layer
    // -- which reads screen geometry directly and computes gamepad state on
    // its own -- regardless of whether anyone was allowed to play. Streaming
    // was already correctly blocked (see the other effect), so no packet
    // reached the PC, but every full-screen DOM overlay in this component
    // (SignInWall, PlaytimeLockout) sits ABOVE the pad in z-index only; native
    // touch capture does not consult DOM z-index at all, so it kept eating
    // every tap meant for the overlay's own buttons and inputs -- reported as
    // "I can touch the controller but not the sign-in box". Both overlays
    // share this one root cause and both are fixed by the same condition.
    if (!isActive || !nativeFlag || !bridge || !bridge.setNativeInputGeometry
      || outOfTime) return;
    let cancelled = false;
    let raf1 = 0, raf2 = 0;
    const deactivate = () => {
      if (!nativeActiveRef.current) return;
      nativeActiveRef.current = false;
      lastVisKeyRef.current = "";
      setNativeVis(null);
      try { bridge.setNativeInputActive(false); } catch {}
      // Reset the native-driven visuals so nothing stays deflected/pulled when
      // JS takes ownership back (native injects its own neutral frame too).
      try {
        if (lstick.knobRef.current) lstick.knobRef.current.style.transform = "translate(0px, 0px)";
        if (rstick.knobRef.current) rstick.knobRef.current.style.transform = "translate(0px, 0px)";
        setLtFill(0); setRtFill(0);
      } catch {}
    };
    // The geometry payload, built in ONE place, sent on activation.
    //
    // Do NOT re-send it mid-play for cosmetic reasons. Until 2026-10-01 the
    // draggable time chip re-sent it on every label change (once a minute), and
    // NativeInputEngine.setGeometry CLEARED all held input on each call -- the
    // F1 accelerator (held LT) dropped every minute. setGeometry now keeps held
    // fingers when the pad and matrix are unchanged, but sending less is still
    // the rule.
    const geometryJson = (m: DOMMatrix) => {
      const exclusions = Array.from(document.querySelectorAll("[data-nx]")).map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      return JSON.stringify({
        matrix: [m.a, m.b, m.c, m.d, m.e, m.f],
        dpr: window.devicePixelRatio || 1,
        exclusions,
        widgets: buildNativeGeometry(activePad),
        stickMode: stickModeRef.current,
        // Stick feel — the native engine applies these itself, so both paths
        // agree. Omitting them would leave the native path on its own defaults
        // while the JS path used the user's, which is exactly the drift that
        // caused 26d5368.
        stickFollow: stickFeel.follow,
        curveExp: stickFeel.curveExp,
        hapticsEnabled: (window as any).hapticsEnabled !== false,
      });
    };
    const tryActivate = () => {
      if (cancelled || usbWS.isOpen()) return;
      const svg = svgRef.current;
      const m = svg && svg.getScreenCTM();
      if (!m) return;
      try {
        bridge.setNativeInputGeometry(geometryJson(m));
        // Visual override starts EMPTY so any stale JS held-state can't linger.
        lastVisKeyRef.current = "";
        setNativeVis({ held: new Set(), stdHeld: new Set() });
        bridge.setNativeInputActive(true);
        nativeActiveRef.current = true;
      } catch (e) { console.error("native input activate failed", e); }
    };
    // Double-rAF so the svg's CTM is read after layout has settled.
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(tryActivate); });
    const transportPoll = setInterval(() => {
      if (cancelled) return;
      if (usbWS.isOpen()) deactivate();
      else if (!nativeActiveRef.current) tryActivate();
    }, 500);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2);
      clearInterval(transportPoll);
      deactivate();
    };
  }, [isActive, nativeFlag, activePad, windowSize, hasSession, outOfTime, stickFeelNonce]);

  // ── PHASE 3: keep the native gyro→payload math in sync with the JS settings ─
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || !bridge.setNativeGyroConfig) return;
    try {
      // zx/zy: the persisted CALIBRATE zero, so the native engine starts from the same
      // zero the JS path restored instead of from flat. Read straight from storage
      // rather than threaded out of useGyro — both read the one key, so they cannot
      // disagree. Pressing CALIBRATE still snapshots the native side directly via
      // nativeGyroCalibrate(), so the two stay in step after a manual re-zero.
      const gz = readGyroZero();
      bridge.setNativeGyroConfig(JSON.stringify({
        on: gyroOn, mode: gyroMode, sens: Math.max(1, gyroMaxAngle), dz: Math.max(0, gyroDeadzone),
        throttle: gyroThrottle, haptic: gyroHaptic, idleDetect: gyroIdleDetect,
        zx: gz.x, zy: gz.y,
        hapticsEnabled: (window as any).hapticsEnabled !== false,
      }));
    } catch {}
  }, [gyroOn, gyroMode, gyroMaxAngle, gyroDeadzone, gyroThrottle, gyroHaptic, gyroIdleDetect]);

  // ── PHASE 3: pressed-state mirror from native, one coalesced call per frame.
  // Held sets re-render only on real change (key compare); stick knobs update
  // imperatively (same transform the JS useStick path writes); trigger fills go
  // through setLt/RtFill (their send is gated, so this is visual-only).
  useEffect(() => {
    (window as any).__nvis = (v: any) => {
      try {
        if (!nativeActiveRef.current || !v) return;
        const key = (v.h || []).join(",") + "|" + (v.s || []).join(",");
        if (key !== lastVisKeyRef.current) {
          lastVisKeyRef.current = key;
          setNativeVis({ held: new Set<string>(v.h || []), stdHeld: new Set<string>(v.s || []) });
        }
        if (typeof v.lt === "number" && v.lt !== ltFillRef.current) setLtFill(v.lt);
        if (typeof v.rt === "number" && v.rt !== rtFillRef.current) setRtFill(v.rt);
        if (lstick.knobRef.current) lstick.knobRef.current.style.transform = `translate(${v.lx || 0}px, ${v.ly || 0}px)`;
        if (rstick.knobRef.current) rstick.knobRef.current.style.transform = `translate(${v.rx || 0}px, ${v.ry || 0}px)`;
        if (v.m && v.m !== stickModeRef.current) selectStickMode(v.m === "R" ? "R" : "L");
      } catch {}
    };
    return () => { delete (window as any).__nvis; };
  }, []);

  // Held sets the widgets actually render from — native override when active.
  const effHeldCustom = nativeVis ? nativeVis.held : heldCustom;
  const effHeldStd = nativeVis ? nativeVis.stdHeld : held;

  const aspect = windowSize.width / windowSize.height;
  const isPortrait = aspect < 1;
  // Fixed design space — MUST equal CustomPadEditor's CANVAS_W (1280) so a button
  // placed in the editor renders at the SAME spot in play (WYSIWYG). This used to
  // stretch to the device aspect ratio (570*aspect ≈ 1235), which shifted every
  // button horizontally — worse toward the right edge — so the play layout never
  // matched the editing canvas. The SVG scales uniformly (preserveAspectRatio
  // "meet"), exactly like the editor, so it stays centered on any screen.
  const W = 1280;
  // Anchor offsets DISABLED. The pad now lives in a FIXED 1280×570 design space
  // shared with the editor, so every button renders at its authored coordinate in
  // BOTH (true WYSIWYG). The old edge-spread offsets shifted center/right buttons
  // in play ONLY, which misaligned them against the editing canvas.
  const offsetCenter = 0;
  const offsetRight = 0;
  
  // Transform style for SVG wrapper if portrait to rotate it 90 deg visually
  const svgTransform = isPortrait 
    ? { transform: `rotate(90deg) translateY(-100%)`, transformOrigin: "top left", width: `${windowSize.height}px`, height: `${windowSize.width}px` } 
    : {};

  const LT  = { x: 1062 + offsetRight, y: 16, w: 92, h: 538, rx: 46 };
  const RT  = { x: 1166 + offsetRight, y: 16, w: 92, h: 538, rx: 46 };


  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#000000", touchAction: "none" }}>
      <button onClick={onBack} data-nx="1"
        className="absolute z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs font-bold transition-all hover:bg-white/10 active:scale-95"
        style={{ 
          top: "2px", 
          left: "max(4px, env(safe-area-inset-left))", 
          background: "rgba(255,255,255,0.03)", 
          border: "1px solid rgba(255,255,255,0.08)", 
          fontFamily: "'Inter',sans-serif" 
        }}>
        ← BACK
      </button>

      {/* (Latency badge removed 2026-10-01 -- owner's decision; see the note where its poll was.) */}

      {/* Gyro Fluid Indicator — its OWN layer at zIndex 0, BEHIND the button
          canvas (z-[5]). The buttons carry black silhouettes that occlude it
          wherever they overlap, so it only shows on the empty top edge and never
          paints over a button. (Regression fix: the App.tsx reconstruction had
          nested this INSIDE the z-10 HUD, putting it on TOP of every button —
          which violates the mandated z-0 layering.) Invisible at rest; only the
          live blue fill bars appear, and only while the gyro is actually tilting.
          RACING ONLY: the bar is a single left/right axis, so it can't represent a
          2-axis 3D look — it's hidden entirely in 3D mode rather than showing a
          misleading half-readout. */}
      {gyroMode !== "3d" && (
      <div className="absolute w-full overflow-hidden flex pointer-events-none transition-opacity duration-200"
        style={{
          top: "max(3px, env(safe-area-inset-top))",
          left: 0,
          height: "7.5px",   // 75% of the previous 10px thickness (user: decrease width to 75%)
          zIndex: 0,
          background: "transparent",
          opacity: gyroOn ? 1 : 0.7,
        }}>
        {/* center tick */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white/50 z-10" />
        <div className="flex-1 overflow-hidden">
          {/* left half — scales from the RIGHT edge (toward center) */}
          <div ref={gyroTilt.leftBarRef} className="h-full w-full"
               style={{ transform: "scaleX(0)", transformOrigin: "right center", willChange: "transform",
                        ...GYRO_GLASS }} />
        </div>
        <div className="flex-1 overflow-hidden">
          {/* right half — scales from the LEFT edge (toward center) */}
          <div ref={gyroTilt.rightBarRef} className="h-full w-full"
               style={{ transform: "scaleX(0)", transformOrigin: "left center", willChange: "transform",
                        ...GYRO_GLASS }} />
        </div>
      </div>
      )}

      {/* Top HUD: the Gyro TOGGLE + active-pad name. Stays at z-10 ABOVE the
          buttons (it's interactive); pushed down 14px to clear the gyro bar. */}
      <div className="absolute z-10 flex flex-col items-center pointer-events-none w-full"
        style={{
          top: "calc(max(3px, env(safe-area-inset-top)) + 14px)",
          left: "0",
          fontFamily: "'Inter',sans-serif"
        }}>
        <div className="flex items-center justify-center gap-2 px-4 w-full">
          {/* Gyro toggle — TAP to turn steering on/off without leaving the controller.
              The parent HUD is pointer-events-none (so it never blocks the gamepad),
              so this button MUST re-enable pointer events on itself, and uses
              onPointerDown + stopPropagation so the tap is never swallowed by the pad. */}
          <button data-nx="1"
            onPointerDown={(e) => { e.stopPropagation(); setGyroOn(!gyroOn); }}
            className="pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold tracking-wider uppercase active:scale-90 transition-transform"
            style={{
              color: gyroOn ? "#5D90CB" : "rgba(255,255,255,0.45)",
              background: gyroOn ? "rgba(79,134,198,0.12)" : "rgba(255,255,255,0.05)",
              border: gyroOn ? "1px solid rgba(79,134,198,0.5)" : "1px solid rgba(255,255,255,0.12)",
              touchAction: "manipulation",
              pointerEvents: "auto",
            }}>
            {/* State is carried by the dot's colour/glow, so the label stays a
                single word — the old "GYRO ON · TAP" was most of this button's width. */}
            <span style={{
              width: 4, height: 4, borderRadius: "50%",
              background: gyroOn ? "#5D90CB" : "rgba(255,255,255,0.3)",
              boxShadow: gyroOn ? "0 0 5px #5D90CB" : "none"
            }} />
            GYRO
          </button>
          {/* IDLE — shown beside GYRO only while the phone is resting flat on a
              surface and the tilt is therefore suppressed (data.idle from the
              native flat+still detector). It disappears the instant the phone is
              picked up. Non-interactive readout; amber to read as "paused", not
              an error, and clearly distinct from the blue GYRO-active state. */}
          {gyroOn && gyroTilt.idle && (
            <span className="pointer-events-none flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold tracking-wider uppercase"
              style={{
                color: "#E0A030",
                background: "rgba(224,160,48,0.12)",
                border: "1px solid rgba(224,160,48,0.45)",
              }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#E0A030" }} />
              Idle
            </span>
          )}
          {/* CALIBRATE — zeroes the tilt at however you're holding the phone right
              now, so you can play reclined / at an angle and still get full ± range.
              Only shown while gyro is ON (there's nothing to zero otherwise) — that
              was the original 1.3.7 behaviour too. Restored after being lost in the
              2026-07-14 App.tsx corruption + reconstruction. Styled to match the
              current calm palette rather than the old neon-cyan glow. */}
          {gyroOn && (
            <button data-nx="1"
              onPointerDown={(e) => {
                e.stopPropagation();
                gyroTilt.calibrate();
                // calibrate() uses the native snapshot for BOTH paths.
                triggerHaptic(15);
              }}
              className="pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold tracking-wider uppercase active:scale-90 transition-transform"
              style={{
                color: "rgba(255,255,255,0.72)",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.14)",
                touchAction: "manipulation",
                pointerEvents: "auto",
              }}>
              CALIBRATE
            </button>
          )}
          {/* ROTATE — only while wheel mode is on. Wheel mode pins the screen so a
              mounted phone being turned cannot flip the steering frame mid-corner, but
              that also takes away the driver’s normal way of choosing which way round
              to sit in the mount. This hands that choice back explicitly. Native side
              flips between the two landscape directions and resets the turn count, since
              re-framing the sensor invalidates any turns banked in the old frame. */}
          {gyroWheel && (
            <button data-nx="1"
              onPointerDown={(e) => {
                e.stopPropagation();
                try { (window as any).AndroidBridge?.rotateControllerScreen?.(); } catch {}
                triggerHaptic(15);
              }}
              className="pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold tracking-wider uppercase active:scale-90 transition-transform"
              style={{
                color: "rgba(255,255,255,0.72)",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.14)",
                touchAction: "manipulation",
                pointerEvents: "auto",
              }}>
              ROTATE
            </button>
          )}
          {/* Center: active pad name (tuning/timer/credits removed for v1.0) */}
          <div className="flex flex-col items-center flex-shrink-0">
            {isCustom && customPad && (
              <span className="text-[8px] font-semibold tracking-widest uppercase"
                style={{ color: customPad.color }}>
                {customPad.name}
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Button canvas sits ABOVE the gyro layer (zIndex 0) at z-[5] so buttons
          occlude the indicator; the HUD toggle stays above both at z-10. */}
      <div className="absolute inset-0 z-[5] flex items-center justify-center"
           style={svgTransform}>
        <svg ref={svgRef} viewBox={`0 0 ${W} 570`} className="w-full h-full max-h-full"
          style={{ touchAction: "none", userSelect: "none" }}>
        <defs>
          <clipPath id="clip-LT"><rect x={LT.x} y={LT.y} width={LT.w} height={LT.h} rx={LT.rx} /></clipPath>
          <clipPath id="clip-RT"><rect x={RT.x} y={RT.y} width={RT.w} height={RT.h} rx={RT.rx} /></clipPath>
        </defs>

        {/* view / home / menu are now regular editable widgets that live in the
            pad's button data (see getTrueStandardLayout) — rendered by the loop
            below with their icons, not hardcoded here. */}

        {(
          <>
            {activePad.buttons.length === 0 && (
              <text x={632} y={340} textAnchor="middle" dominantBaseline="central"
                fontSize={18} fill="rgba(255,255,255,0.18)"
                style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none" }}>
                No buttons — edit this pad in Dashboard
              </text>
            )}
            {activePad.buttons.map((rawBtn: CustomBtnDef) => {
              // Responsive anchor offset — reproduces the old app's Bt/qn edge
              // spreading. Only the standard preset sets `anchor`; custom pads
              // leave it undefined and are therefore never shifted.
              const _anchorOff = rawBtn.anchor === "center" ? offsetCenter
                               : rawBtn.anchor === "right"  ? offsetRight : 0;
              const btn: CustomBtnDef = _anchorOff ? { ...rawBtn, x: rawBtn.x + _anchorOff } : rawBtn;
              const size = btn.r;
              const w = btn.w ?? size;
              const h = btn.h ?? size;

              const triggerH = (hpt: number) => {
                 if (hpt > 0) triggerHaptic(Math.round(hpt / 2));
              };
              
              // ── Unified modular widget vocabulary ────────────────────────────
              // DPAD — single compound unit, emits uid_up/down/left/right
              if (btn.type === "dpad") {
                return (
                  <Dpad
                    key={btn.uid}
                    cx={btn.x} cy={btn.y} r={btn.r}
                    held={effHeldCustom}
                    dn={(id) => {
                      dnCustom(id);
                      if (btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                    }}
                    up={upCustom}
                    dirIds={{
                      up:    `${btn.uid}_up`    as BtnId,
                      down:  `${btn.uid}_down`  as BtnId,
                      left:  `${btn.uid}_left`  as BtnId,
                      right: `${btn.uid}_right` as BtnId,
                    }}
                  />
                );
              }

              // ABXY — single compound cluster, emits uid_a/uid_b/uid_x/uid_y.
              // Diamond spread/size derived from the base radius so the whole
              // unit scales as one (old footprint: spread≈100, btnR≈56 at r140).
              if (btn.type === "abxy") {
                const spread = btn.r * 0.71;
                const btnR   = btn.r * 0.40;
                const FACE: Record<string, { norm: string; held: string }> = {
                  y: { norm: RED_NORM, held: RED_HELD },
                  x: { norm: RED_NORM, held: RED_HELD },
                  b: { norm: RED_NORM, held: RED_HELD },
                  a: { norm: RED_NORM, held: RED_HELD },
                };
                const positions = [
                  { label: "Y", dx: 0,       dy: -spread, key: "y" },
                  { label: "X", dx: -spread, dy: 0,       key: "x" },
                  { label: "B", dx:  spread, dy: 0,       key: "b" },
                  { label: "A", dx: 0,       dy:  spread, key: "a" },
                ];
                return (
                  <g key={btn.uid}>
                    {positions.map(({ label, dx, dy, key }) => (
                      <Btn
                        key={key}
                        cx={btn.x + dx} cy={btn.y + dy} r={btnR}
                        label={label}
                        id={`${btn.uid}_${key}`}
                        held={effHeldCustom}
                        dn={(id) => {
                          dnCustom(id);
                          if (btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                        }}
                        up={upCustom}
                        normColor={FACE[key].norm}
                        heldColor={FACE[key].held}
                      />
                    ))}
                  </g>
                );
              }

              // LTRT — single compound unit: two trigger pills laid out
              // symmetrically about the widget's (x,y) centre. Drives the
              // analog ltFill / rtFill. Footprint matches the old app
              // (each pill w≈92 h≈538 at r92, ~12px centre gap).
              if ((btn.type as string) === "ltrt") {
                const pillW  = btn.r;
                const pillH  = btn.r * 5.85;
                const pillRx = btn.r * 0.5;
                const gap    = btn.r * 0.13;
                const ltX    = btn.x - gap / 2 - pillW;
                const rtX    = btn.x + gap / 2;
                const pillY  = btn.y - pillH / 2;
                return (
                  <g key={btn.uid}>
                    <TriggerPill
                      x={ltX} y={pillY} w={pillW} h={pillH} rx={pillRx}
                      label="LT" id={`${btn.uid}_lt` as BtnId}
                      held={effHeldCustom}
                      dn={dnCustom}
                      up={upCustom}
                      fill={ltFill}
                      onFillChange={(v) => {
                        // Haptic ONLY on the initial engage (0 → pulled), never on
                        // every fill step — otherwise an analog pull buzzes the whole
                        // way down and feels like a vibration, not a button touch.
                        const wasEngaged = ltFillRef.current > 0;
                        setLtFill(v);
                        if (v > 0 && !wasEngaged && btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                      }}
                      svgRef={svgRef}
                      digital={btn.analogTrigger === false}
                    />
                    <TriggerPill
                      x={rtX} y={pillY} w={pillW} h={pillH} rx={pillRx}
                      label="RT" id={`${btn.uid}_rt` as BtnId}
                      held={effHeldCustom}
                      dn={dnCustom}
                      up={upCustom}
                      fill={rtFill}
                      onFillChange={(v) => {
                        const wasEngaged = rtFillRef.current > 0;
                        setRtFill(v);
                        if (v > 0 && !wasEngaged && btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                      }}
                      svgRef={svgRef}
                      digital={btn.analogTrigger === false}
                    />
                  </g>
                );
              }

              // THUMBSTICK — analog only. Three variants by label:
              //   "Hybrid" → follows the selected stickMode (L or R), set by the
              //              Stick-Mode selector widgets ("L-Mod"/"R-Mod").
              //   "LS" / "Left…"  → always the LEFT stick (movement).
              //   "RS" / "Right…" → always the RIGHT stick (camera/aim).
              if (btn.type === "thumbstick") {
                const up = btn.label.toUpperCase();
                const isHybrid = up.startsWith("HYBRID") || up === "STICK";
                const isLeft = isHybrid ? (stickMode === "L") : up.startsWith("L");
                const activeStick = isLeft ? lstick : rstick;
                return (
                  <RightStick
                    key={btn.uid}
                    cx={btn.x} cy={btn.y} outerR={btn.r} innerR={btn.r * 0.48}
                    stick={activeStick}
                    id={btn.uid as BtnId}
                    held={effHeldCustom}
                    dn={(id) => {
                      dnCustom(id);
                      if (btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                    }}
                    up={upCustom}
                  />
                );
              }

              // STICK-MODE SELECTOR — only meaningful with a Hybrid stick. Tapping
              // sets which axis the hybrid drives. label "L-Mod" / "R-Mod".
              // Rendered inline (cyan when active) to avoid cross-file widget deps.
              if (btn.type === "stickmode") {
                const mode = btn.label === "R-Mod" ? "R" : "L";
                const active = stickMode === mode;
                return (
                  <g key={btn.uid} style={{ cursor: "pointer", touchAction: "none" }}
                    onPointerDown={(e) => {
                      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch (err) {}
                      selectStickMode(mode as "L" | "R"); triggerH(btn.haptic);
                    }}>
                    {active && (
                      <circle cx={btn.x} cy={btn.y} r={btn.r + 6} fill="rgba(79,134,198,0.35)"
                        style={{ pointerEvents: "none", filter: "blur(8px)" }} />
                    )}
                    <circle cx={btn.x} cy={btn.y} r={btn.r}
                      fill={active ? "rgba(79,134,198,0.85)" : "rgba(79,134,198,0.12)"}
                      stroke={active ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)"}
                      strokeWidth={active ? 2.5 : 1.5} />
                    <text x={btn.x} y={btn.y} textAnchor="middle" dominantBaseline="central"
                      fontSize={btn.r * 0.42} fontWeight="800" fill={active ? "#000" : "rgba(255,255,255,0.88)"}
                      style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none", userSelect: "none" }}>
                      {mode === "L" ? "L" : "R"}
                    </text>
                  </g>
                );
              }

              // SINGLE TRIGGER (analog LT/RT pill). ONLY real triggers route here.
              // Rectangular *buttons* (type button/macro with w/h) must NOT — they
              // fall through to the generic <Btn> below, which draws them at exactly
              // w×h like the editor. Sizing mirrors the editor preview:
              // w = btn.w ?? r*2, h = btn.h ?? r*5.85, corner radius = w*0.4.
              if (btn.type === "trigger") {
                const isLeft = btn.label.toUpperCase().startsWith("L");
                const pillW  = btn.w ?? btn.r * 2;
                const pillH  = btn.h ?? btn.r * 5.85;
                const pillRx = pillW * 0.4;
                return (
                  <TriggerPill
                    key={btn.uid}
                    x={btn.x - pillW / 2} y={btn.y - pillH / 2}
                    w={pillW} h={pillH} rx={pillRx}
                    label={btn.label}
                    id={(isLeft ? "LT" : "RT") as BtnId}
                    held={effHeldStd}
                    dn={dn}
                    up={up}
                    fill={isLeft ? ltFill : rtFill}
                    onFillChange={(v) => {
                      // The press haptic already fired via dn() on pointer-down, so
                      // DON'T re-fire per fill step here (that buzzed the whole pull
                      // and felt like a vibration instead of a single button touch).
                      (isLeft ? setLtFill : setRtFill)(v);
                    }}
                    svgRef={svgRef}
                    digital={btn.analogTrigger === false}
                  />
                );
              }

              // DEFAULT button (circle)
              // System buttons render an icon instead of their literal label.
              const SYS_ICON: Record<string, React.ReactNode> = {
                view: (
                  <g style={{ stroke: "currentColor", strokeWidth: 2.2, fill: "none" }}>
                    <rect x={-9} y={-9} width={18} height={7} rx={1.2} />
                    <rect x={-9} y={1} width={18} height={7} rx={1.2} />
                  </g>
                ),
                home: <tspan>🎮</tspan>,
                menu: <tspan>≡</tspan>,
              };
              const isSys = btn.label in SYS_ICON;
              const displayLabel = isSys
                ? SYS_ICON[btn.label]
                : ((activeMapping && activeMapping[btn.label as BtnId]) || btn.label);
              return (
                <Btn
                  key={btn.uid}
                  cx={btn.x} cy={btn.y} r={btn.r}
                  w={btn.w} h={btn.h} rxFactor={btn.rxFactor}
                  label={displayLabel} id={btn.uid}
                  fontSize={isSys ? (btn.label === "home" ? btn.r * 0.6 : btn.r * 0.7) : undefined}
                  held={effHeldCustom}
                  dn={(id) => {
                    dnCustom(id);
                    if (btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                  }}
                  up={upCustom}
                  normColor={RED_NORM}
                  heldColor={RED_HELD}
                />
              );
            })}
          </>
        )}
      </svg>
      </div>

      {/* Rumble indicators removed — the phone's vibration is the feedback; no on-screen bars during play. */}


      {/* Countdown warnings (15/10/5 min). Owns its own store subscription so a
          warning never re-renders the pad, and is pointer-events:none so it
          cannot swallow a tap during play. */}
      <PlaytimeToast />

      {/* Out of playtime. Rendered last so it sits over the pad. Note this is
          the SYMPTOM, not the mechanism -- transmission is already stopped by
          the streaming gate above, so a failure to mount this cannot leak
          input. */}
      <AnimatePresence>
        {outOfTime && (
          <PlaytimeLockout
            key="lockout"
            {...(({ message, resetsAt }) => ({ message, resetsAt }))(getPlaytimeState())}
            onBack={onBack}
          />
        )}
      </AnimatePresence>

      {/* No time display on the controller (owner's decision, 2026-10-01): it
          distracted players, and the dashboard and Time tab already show it.
          The draggable PlaytimeChip that sat here also caused the 1.4.6 held-input
          drop -- each label change re-sent the native geometry, which released
          every held button (see the geometry comment above). */}
    </div>
  );
}

// ─── QR Scanner overlay (used inside Wireless tab) ───────────────────────────
// ─── Connect to PC Screen ─────────────────────────────────────────────────────

function useNetworkTelemetry(isActive: boolean) {
  const [telemetry, setTelemetry] = React.useState<any>(null);
  React.useEffect(() => {
    if (!isActive) return;
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.getNetworkTelemetryJson) {
      const interval = setInterval(() => {
        const w = (window as any).__usbWS;
        if (w && w.isOpen()) {
          setTelemetry({ linkAlive: true, latency: w.latency, connectionType: "usbdebug" });
          return;
        }
        try {
          const json = bridge.getNetworkTelemetryJson();
          setTelemetry(JSON.parse(json));
        } catch (e) { }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isActive]);
  return telemetry;
}
function ScannerScreen({ onDashboard }: { onDashboard: () => void }) {
  const shellPresent = useIsPresent();
  const realTelemetry = useNetworkTelemetry(true);
  const { appearance, toggle } = useShellAppearance();
  const [showScanner, setShowScanner] = useState(false);
  useEffect(() => {
    (window as any).__scannerBack = () => {
      if (!showScanner) return false;
      setShowScanner(false); return true;
    };
    return () => { delete (window as any).__scannerBack; };
  }, [showScanner]);
  // USB auto-pair remains at the app root; never reintroduce cached PC addresses.

  const manualConnect = (ip: string, port: number, key: string) => {
    prepareWirelessConnection();
    pendingWireless({ ip, port, key });
    (window as any).AndroidBridge?.connectToPC?.(ip, port, key);
    onDashboard();
  };
  return <div className={`gp-connect gp-shell absolute inset-0 flex flex-col overflow-hidden ${showScanner ? "gp-camera-active" : ""}`} data-calm-theme={appearance} style={{ pointerEvents: shellPresent ? 'auto' : 'none' }}>
    {showScanner ? <QRScanOverlay onClose={() => setShowScanner(false)} onConnect={onDashboard} />
      : <CalmConnect telemetry={realTelemetry} appearance={appearance} onAppearance={toggle}
          onBack={onDashboard} onScan={() => setShowScanner(true)} onManual={manualConnect} />}
  </div>;
}

// ─── Shared dashboard helpers ─────────────────────────────────────────────────
function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-card border border-border rounded-xl ${className}`} style={style}>{children}</div>;
}
function SectionDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-2 mb-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.18em]">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${on ? "bg-primary" : "bg-muted"}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-6" : ""}`} />
    </button>
  );
}

// ─── Gamepad preset card ──────────────────────────────────────────────────────
// Standard layout, rendered ONCE for the thumbnail (same shapes/names as gameplay).
const STANDARD_LAYOUT_THUMB: CustomBtnDef[] = getTrueStandardLayout();

function GamepadCard({ preset, active, onPlay, onEdit, onSelect, isModified }: {
  preset: GamepadPreset; active: boolean; onPlay: () => void;
  onEdit?: () => void; onSelect?: () => void; isModified?: boolean;
}) {
  return <div className="calm-controller-card" data-selected={active}>
    <button data-no-shell-press className="calm-card-select" onClick={onSelect} aria-pressed={active}>
      <span><strong className="calm-card-name">{preset.name}</strong><small className="calm-card-detail">{isModified ? "Personalized controls" : "Ready for your next game"}</small></span>
      <span className="calm-card-check" aria-hidden="true"><Check size={16} /></span>
    </button>
    <button className="calm-pad-preview" onClick={onSelect} aria-label={`Select ${preset.name}`} aria-pressed={active}>
      <svg viewBox="0 0 1280 570" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {STANDARD_LAYOUT_THUMB.map(b => <PadThumbWidget key={b.uid} b={b} accent={preset.color} />)}
      </svg>
    </button>
    <div className="calm-card-actions">
      <button className="calm-primary" onClick={onPlay} aria-label={`Play ${preset.name}`}>Play<ArrowUpRight size={18} aria-hidden="true" /></button>
      {onEdit && <button className="calm-secondary" onClick={onEdit}>Edit</button>}
    </div>
  </div>;
}

// ─── Preset label editor ──────────────────────────────────────────────────────
// Default positions for the standard layout — single source of truth
const STANDARD_DEFAULTS: Record<string, BtnPosOverride> = {
  LB:         { cx: 80,  cy: 80,  r: 52  },
  RB:         { cx: 220, cy: 80,  r: 52  },
  Y:          { cx: 160, cy: 220, r: 56  },
  X:          { cx: 60,  cy: 320, r: 56  },
  B:          { cx: 260, cy: 320, r: 56  },
  A:          { cx: 160, cy: 420, r: 56  },
  lstick:     { cx: 340, cy: 500, r: 56  },
  view:       { cx: 500, cy: 140, r: 34  },
  home:       { cx: 620, cy: 140, r: 34  },
  menu:       { cx: 740, cy: 140, r: 34  },
  dpad:       { cx: 500, cy: 360, r: 120 },
  rstick_btn: { cx: 480, cy: 500, r: 56  },
  rstick:     { cx: 800, cy: 360, r: 120 },
};

function PresetEditor({ preset, currentMapping, currentPos, onSave, onSaveLayout, onReset, onClose }: {
  preset: GamepadPreset;
  currentMapping: Partial<Record<BtnId, string>>;
  currentPos: PosOverrideMap;
  onSave: (m: Partial<Record<BtnId, string>>) => void;
  onSaveLayout: (pos: PosOverrideMap) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"labels" | "layout">("labels");
  const [draft, setDraft] = useState<Partial<Record<BtnId, string>>>({ ...currentMapping });
  // pos state: merge defaults with any saved overrides
  const [pos, setPos] = useState<Record<string, BtnPosOverride>>(() => ({
    ...STANDARD_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(currentPos).filter(([, v]) => v != null) as [string, BtnPosOverride][]
    ),
  }));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const svgEditorRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ key: string; ox: number; oy: number } | null>(null);

  const [windowSize, setWindowSize] = useState({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 720,
  });

  useEffect(() => {
    let timeout: any;
    const handleResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setWindowSize({ w: window.innerWidth, h: window.innerHeight });
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, []);

  const isPortrait = windowSize.w < windowSize.h;

  const dn = preset.displayName ?? {};
  const rows: { id: BtnId; label: string }[] = [
    { id:"A",      label: dn.A  ? `A · ${dn.A}`   : "A — Bottom" },
    { id:"B",      label: dn.B  ? `B · ${dn.B}`   : "B — Right" },
    { id:"X",      label: dn.X  ? `X · ${dn.X}`   : "X — Left" },
    { id:"Y",      label: dn.Y  ? `Y · ${dn.Y}`   : "Y — Top" },
    { id:"LT",     label: dn.LT ?? "Left Trigger" },
    { id:"RT",     label: dn.RT ?? "Right Trigger" },
    { id:"LB",     label: dn.LB ?? "Left Bumper" },
    { id:"RB",     label: dn.RB ?? "Right Bumper" },
    { id:"up",     label: "D-Pad Up" },
    { id:"down",   label: "D-Pad Down" },
    { id:"left",   label: "D-Pad Left" },
    { id:"right",  label: "D-Pad Right" },
    { id:"lstick", label: "Left Stick (L3)" },
    { id:"rstick", label: "Right Stick (R3)" },
  ];

  // Layout button metadata for the draggable editor
  const layoutBtns: { key: string; label: React.ReactNode; color?: string }[] = [
    { key: "LB",         label: "LB" },
    { key: "RB",         label: "RB" },
    { key: "Y",          label: "Y" },
    { key: "X",          label: "X" },
    { key: "B",          label: "B" },
    { key: "A",          label: "A" },
    { key: "lstick",     label: <><tspan x="0" dy="-0.6em">Left</tspan><tspan x="0" dy="1.2em">stick</tspan></> },
    { key: "view",       label: "⧉" },
    { key: "home",       label: "🎮" },
    { key: "menu",       label: "≡" },
    { key: "dpad",       label: "D‑Pad" },
    { key: "rstick_btn", label: <><tspan x="0" dy="-0.6em">Right</tspan><tspan x="0" dy="1.2em">stick</tspan></> },
    { key: "rstick",     label: "R‑Stick" },
  ];

  function toSVGCoords(clientX: number, clientY: number) {
    const svg = svgEditorRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    
    const scaleX = 1264 / rect.width;
    const scaleY = 570 / rect.height;
    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;
    
    if (isNaN(x)) x = 0;
    if (isNaN(y)) y = 0;
    return { x, y };
  }

  function onBtnPointerDown(e: React.PointerEvent, key: string) {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("PresetEditor: Pointer capture failed", err);
    }
    const p = toSVGCoords(e.clientX, e.clientY);
    const btn = pos[key];
    dragRef.current = { key, ox: p.x - btn.cx, oy: p.y - btn.cy };
    setSelectedKey(key);
  }

  function onSVGPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const p = toSVGCoords(e.clientX, e.clientY);
    const { key, ox, oy } = dragRef.current;
    const r = pos[key].r;
    
    const nx = p.x - ox;
    const ny = p.y - oy;
    if (isNaN(nx) || isNaN(ny)) return;

    setPos(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        cx: Math.max(r, Math.min(1264 - r, nx)),
        cy: Math.max(r, Math.min(570 - r, ny)),
      },
    }));
  }

  function onSVGPointerUp() { dragRef.current = null; }

  // Compute diff — only save keys that differ from defaults
  function layoutDiff(): PosOverrideMap {
    const diff: PosOverrideMap = {};
    for (const [key, val] of Object.entries(pos)) {
      const def = STANDARD_DEFAULTS[key];
      if (!def) continue;
      if (
        Math.abs(val.cx - def.cx) > 0.5 ||
        Math.abs(val.cy - def.cy) > 0.5 ||
        Math.abs(val.r - def.r) > 0.5
      ) {
        diff[key] = val;
      }
    }
    return diff;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 overflow-hidden bg-black/70 backdrop-blur-sm touch-none select-none">
      
        {isPortrait ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070910] z-50 px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-white/50 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Rotate Your Device</h2>
            <p className="text-sm text-white/60">The editor requires a landscape orientation to give you enough space to design your gamepad.</p>
            <button onClick={onClose} className="mt-8 px-6 py-2.5 rounded-full bg-white/10 text-white font-medium hover:bg-white/20 transition-colors">
              Go Back
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-3xl border border-border flex flex-col"
        style={{ background: "rgba(10,14,24,0.99)", borderColor: `${preset.color}50`, maxHeight: "90vh", margin: "auto" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <span>{preset.icon}</span> {preset.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tab === "labels" ? "Rename button actions" : "Drag buttons to reposition"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { onReset(); setPos({ ...STANDARD_DEFAULTS }); onClose(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
              ↺ Reset
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.06)" }}><X size={14} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 px-5 mb-3">
          {(["labels", "layout"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-xl text-xs font-bold tracking-wide transition-all duration-150"
              style={tab === t
                ? { background: preset.color, color: "#fff" }
                : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {t === "labels" ? "🏷️ Labels" : "✋ Layout"}
            </button>
          ))}
        </div>

        {/* Tab: Labels */}
        {tab === "labels" && (
          <div className="flex-1 overflow-y-auto px-5 pb-3">
            <div className="grid grid-cols-2 gap-2">
              {rows.map(({ id, label }) => (
                <div key={id} className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
                  <input value={draft[id] ?? ""} onChange={e => setDraft(d => ({ ...d, [id]: e.target.value }))}
                    placeholder="e.g. Jump, Fire…" maxLength={14}
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs text-foreground outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${preset.color}30` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Layout — draggable SVG canvas */}
        {tab === "layout" && (
          <div className="flex-1 flex flex-col px-5 pb-3 min-h-0">
            {selectedKey && (
              <div className="flex flex-col gap-2.5 mb-3 bg-white/5 border border-white/10 rounded-2xl p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Selected:</span>
                  <span className="text-xs font-bold" style={{ color: preset.color }}>{selectedKey}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    ({Math.round(pos[selectedKey]?.cx ?? 0)}, {Math.round(pos[selectedKey]?.cy ?? 0)}, r: {Math.round(pos[selectedKey]?.r ?? 0)}px)
                  </span>
                  <button onClick={() => {
                    const def = STANDARD_DEFAULTS[selectedKey];
                    if (def) setPos(p => ({ ...p, [selectedKey]: { ...def } }));
                  }}
                    className="ml-auto text-[10px] px-2 py-1 rounded-lg font-semibold transition-all active:scale-95"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}>
                    Reset Button
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-12">Size:</span>
                  <input
                    type="range"
                    min="20"
                    max="180"
                    value={pos[selectedKey]?.r ?? 56}
                    onChange={e => {
                      const newR = parseInt(e.target.value, 10);
                      setPos(prev => ({
                        ...prev,
                        [selectedKey]: {
                          ...prev[selectedKey],
                          r: newR
                        }
                      }));
                    }}
                    className="flex-1 accent-primary h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: preset.color }}
                  />
                  <span className="text-xs font-mono w-12 text-right text-muted-foreground">
                    {Math.round(pos[selectedKey]?.r ?? 0)}px
                  </span>
                </div>
              </div>
            )}
            <div className="flex-1 rounded-2xl overflow-hidden border" style={{ borderColor: `${preset.color}30`, background: "rgba(0,0,0,0.5)" }}>
              <svg ref={svgEditorRef} viewBox="0 0 1264 570" className="w-full h-full"
                style={{ touchAction: "none", userSelect: "none", display: "block" }}
                onPointerMove={onSVGPointerMove}
                onPointerUp={onSVGPointerUp}
                onPointerLeave={onSVGPointerUp}>
                {/* Grid dots */}
                <defs>
                  <pattern id="ed-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.04)" />
                  </pattern>
                </defs>
                <rect width="1264" height="570" fill="url(#ed-grid)" />

                {/* LT / RT hint bars */}
                <rect x={1062} y={16} width={92} height={538} rx={46} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
                <rect x={1166} y={16} width={92} height={538} rx={46} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth={1.5} />
                <text x={1108} y={295} textAnchor="middle" fontSize={18} fill="rgba(255,255,255,0.2)" fontWeight="700">LT</text>
                <text x={1212} y={295} textAnchor="middle" fontSize={18} fill="rgba(255,255,255,0.2)" fontWeight="700">RT</text>

                {/* Draggable buttons */}
                {layoutBtns.map(({ key, label, color }) => {
                  const btn = pos[key];
                  if (!btn) return null;
                  const sel = key === selectedKey;
                  const btnColor = color ?? (sel ? preset.color : "rgba(255,255,255,0.55)");
                  return (
                    <g key={key} style={{ cursor: "grab", touchAction: "none" }}
                      onPointerDown={e => onBtnPointerDown(e, key)}>
                      {sel && (
                        <circle cx={btn.cx} cy={btn.cy} r={btn.r + 14} fill="none"
                          stroke={preset.color} strokeWidth="2.5" strokeDasharray="8 5" opacity={0.7}
                          style={{ pointerEvents: "none" }} />
                      )}
                      <circle cx={btn.cx} cy={btn.cy} r={btn.r}
                        fill={sel ? `${preset.color}22` : "rgba(255,255,255,0.06)"}
                        stroke={sel ? preset.color : "rgba(255,255,255,0.18)"}
                        strokeWidth={sel ? 2.5 : 1.5}
                        style={{ pointerEvents: "none" }} />
                      <text x={btn.cx} y={btn.cy} textAnchor="middle" dominantBaseline="central"
                        fontSize={Math.min(btn.r * 0.52, 30)} fontWeight="800" fill={btnColor}
                        style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none", userSelect: "none" }}>
                        {label}
                      </text>
                      {/* Transparent large hit area */}
                      <circle cx={btn.cx} cy={btn.cy} r={Math.max(btn.r, 40)} fill="transparent" />
                    </g>
                  );
                })}
              </svg>
            </div>
            <p className="text-[10px] text-center text-muted-foreground mt-2">Drag any button to reposition it. LT/RT are fixed sliders.</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-2 px-5 pb-8 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <button onClick={() => { onSave(draft); onSaveLayout(layoutDiff()); onClose(); }}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: preset.color, color: "#fff" }}>
            Save All Changes
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            Cancel
          </button>
        </div>
      </div>
      </div>
        )}
    </motion.div>
  );
}
// ─── Layout-thumbnail widget — draws the real shape of each widget so the card
//     preview looks like a mini picture of the pad (not text labels). ──────────
function PadThumbWidget({ b, accent }: { b: CustomBtnDef; accent: string }) {
  const { x, y, r } = b;
  const fill = RED_NORM;
  const stroke = "rgba(255,255,255,0.18)";
  // Small centred label, so the thumbnail shows each button's NAME like the pad.
  const txt = (tx: number, ty: number, s: string, fs: number) => (
    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize={fs}
      fontWeight={800} fill="rgba(255,255,255,0.82)"
      style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none" }}>{s}</text>
  );

  if (b.type === "dpad") {
    // Mirror the gameplay/editor Dpad: round pad with 4 pie sectors + centre hub.
    const inner = r * 0.28;
    const sector = (a1: number, a2: number) => {
      const rad = (d: number) => (d * Math.PI) / 180;
      const mk = (d: number, rr: number) => ({ x: x + Math.cos(rad(d)) * rr, y: y + Math.sin(rad(d)) * rr });
      const s1 = mk(a1, inner), s2 = mk(a1, r), e2 = mk(a2, r), e1 = mk(a2, inner);
      return `M${s1.x} ${s1.y} L${s2.x} ${s2.y} A${r} ${r} 0 0 1 ${e2.x} ${e2.y} L${e1.x} ${e1.y} A${inner} ${inner} 0 0 0 ${s1.x} ${s1.y}Z`;
    };
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
        {[-90, 0, 90, 180].map(a => (
          <path key={a} d={sector(a - 44, a + 44)} fill="rgba(255,255,255,0.06)"
            stroke="rgba(255,255,255,0.28)" strokeWidth={1.5} />
        ))}
        <circle cx={x} cy={y} r={inner} fill={fill} stroke="rgba(255,255,255,0.28)" strokeWidth={2} />
        {[{ a: -90, g: "▲" }, { a: 0, g: "▶" }, { a: 90, g: "▼" }, { a: 180, g: "◀" }].map(({ a, g }) => {
          const rad = (a * Math.PI) / 180;
          return <g key={a}>{txt(x + Math.cos(rad) * r * 0.63, y + Math.sin(rad) * r * 0.63, g, r * 0.3)}</g>;
        })}
      </g>
    );
  }
  if (b.type === "abxy") {
    const spread = r * 0.71, br = r * 0.4;
    const pts: [number, number, string][] = [[0, -spread, "Y"], [-spread, 0, "X"], [spread, 0, "B"], [0, spread, "A"]];
    return <g>{pts.map(([dx, dy, l], i) => (
      <g key={i}>
        <circle cx={x + dx} cy={y + dy} r={br} fill={fill} stroke={stroke} strokeWidth={2} />
        {txt(x + dx, y + dy, l, br * 0.8)}
      </g>
    ))}</g>;
  }
  if ((b.type as string) === "ltrt") {
    const pillW = r, pillH = r * 5.85, gap = r * 0.13, rx = r * 0.5;
    const ltX = x - gap / 2 - pillW, rtX = x + gap / 2;
    return (
      <g>
        <rect x={ltX} y={y - pillH / 2} width={pillW} height={pillH} rx={rx} fill={fill} stroke={stroke} strokeWidth={2} />
        <rect x={rtX} y={y - pillH / 2} width={pillW} height={pillH} rx={rx} fill={fill} stroke={stroke} strokeWidth={2} />
        {txt(ltX + pillW / 2, y + pillH * 0.32, "LT", pillW * 0.4)}
        {txt(rtX + pillW / 2, y + pillH * 0.32, "RT", pillW * 0.4)}
      </g>
    );
  }
  if (b.type === "trigger") {
    const w = b.w ?? r * 2, h = b.h ?? r * 5.85;
    return (
      <g>
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w * 0.4} fill={fill} stroke={stroke} strokeWidth={2} />
        {txt(x, y + h * 0.32, b.label || "T", w * 0.4)}
      </g>
    );
  }
  if (b.type === "thumbstick") {
    const tag = b.label.toUpperCase().startsWith("HYBRID") ? "H"
      : b.label.toUpperCase().startsWith("L") ? "L" : "R";
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
        <circle cx={x} cy={y} r={r * 0.48} fill="rgba(216,216,216,0.85)" />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.35}
          fontWeight={800} fill="rgba(40,40,40,0.9)"
          style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none" }}>{tag}</text>
      </g>
    );
  }
  if (b.type === "stickmode") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
        {txt(x, y, b.label === "R-Mod" ? "R" : "L", r * 0.5)}
      </g>
    );
  }
  // Rectangular button
  if ((b.type === "button" || b.type === "macro") && b.w != null && b.h != null) {
    return (
      <g>
        <rect x={x - b.w / 2} y={y - b.h / 2} width={b.w} height={b.h} rx={Math.min(b.w, b.h) * 0.28} fill={fill} stroke={stroke} strokeWidth={2} />
        {txt(x, y, b.label || (b.type === "macro" ? "M" : "B"), Math.min(b.w, b.h) * 0.42)}
      </g>
    );
  }
  // Circular button / macro
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} stroke={accent} strokeWidth={2} strokeOpacity={0.5} />
      {txt(x, y, b.label || (b.type === "macro" ? "M" : "B"), r * 0.52)}
    </g>
  );
}

// ─── Custom pad slot card ─────────────────────────────────────────────────────
function CustomPadSlot({ pad, active, onPlay, onEdit, onDelete, onDuplicate, onShare, onSelect }: {
  pad: CustomPad; active: boolean;
  onPlay: () => void; onEdit: () => void; onDelete: () => void; onDuplicate: () => void; onShare: () => void; onSelect?: () => void;
}) {
  // Only LAUNCH stays on the card; everything else lives behind a ⋮ menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const menuRef=useRef<HTMLDivElement>(null);
  useOverlayFocus(menuOpen,menuRef,()=>{setMenuOpen(false);setConfirmDel(false);});
  // Full-width layout thumbnail — render the actual widget shapes (not labels),
  // scaled from the 1264×570 design canvas, like a mini image of the pad.
  const CW = 1280, CH = 570;

  return (
    <div className="calm-controller-card" data-selected={active}>
      <button data-no-shell-press className="calm-card-select" onClick={onSelect} aria-pressed={active}>
        <span><strong className="calm-card-name">{pad.name}</strong><small className="calm-card-detail">{pad.buttons.length} controls · Your layout</small></span>
        <span className="calm-card-check" aria-hidden="true"><Check size={16} /></span>
      </button>
      <button className="calm-pad-preview" onClick={onSelect} aria-label={`Select ${pad.name}`} aria-pressed={active}>
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {pad.buttons.length === 0 && <text x={CW / 2} y={CH / 2} textAnchor="middle" dominantBaseline="central" fontSize={36} fill="rgba(255,255,255,0.5)">Empty layout</text>}
          {pad.buttons.map(b => <PadThumbWidget key={b.uid} b={b} accent={pad.color} />)}
        </svg>
      </button>
      <div className="calm-card-actions">
        <button className="calm-primary" onClick={onPlay} aria-label={`Play ${pad.name}`}>Play<ArrowUpRight size={18} aria-hidden="true" /></button>
        <button className="calm-icon-button" onClick={() => { setConfirmDel(false); setMenuOpen(v => !v); }} aria-label={`More options for ${pad.name}`} aria-expanded={menuOpen}>
          <MoreHorizontal size={22} aria-hidden="true" />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <>
              {/* tap-away backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setConfirmDel(false); }} />
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                ref={menuRef} role="dialog" aria-label={`Actions for ${pad.name}`}
                transition={SPRING_SNAP}
                style={{ transformOrigin: "bottom right" }}
                className="absolute right-2.5 bottom-12 z-50 w-36 rounded-xl overflow-hidden shadow-2xl calm-surface border border-white/12">
                {!confirmDel ? (
                  <>
                    <button onClick={() => { setMenuOpen(false); onEdit(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold calm-ink hover:bg-white/8 active:bg-white/12 transition-colors">
                      <span className="w-3.5 text-center text-primary">✎</span> Edit
                    </button>
                    <button onClick={() => { setMenuOpen(false); onDuplicate(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold calm-ink hover:bg-white/8 active:bg-white/12 transition-colors border-t border-white/5">
                      <span className="w-3.5 text-center calm-muted">◫</span> Duplicate
                    </button>
                    <button onClick={() => { setMenuOpen(false); onShare(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold calm-ink hover:bg-white/8 active:bg-white/12 transition-colors border-t border-white/5">
                      <span className="w-3.5 text-center text-primary">⤴</span> Share
                    </button>
                    <button onClick={() => setConfirmDel(true)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 active:bg-red-500/15 transition-colors border-t border-white/5">
                      <span className="w-3.5 text-center">🗑</span> Delete
                    </button>
                  </>
                ) : (
                  <div className="p-2.5">
                    <p className="text-xs font-bold text-red-400 text-center mb-2 leading-snug">Delete &ldquo;{pad.name}&rdquo;?</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => { setMenuOpen(false); setConfirmDel(false); onDelete(); }}
                        className="flex-1 py-1.5 rounded-lg text-xs font-black bg-red-600 active:bg-red-700 calm-ink transition-all active:scale-95">
                        DELETE
                      </button>
                      <button onClick={() => setConfirmDel(false)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold calm-muted transition-all active:scale-95"
                        style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Custom pad builder (full-screen drag-and-drop canvas) ────────────────────


// (WidgetDispatcher removed — the controller renders every pad through the
//  single data-driven loop in ControllerScreen; this was dead duplicate code.)



function TabHome({ realTelemetry, onLaunch, onConnect, onLaunchEditor, selectedPresetId, onSelectPreset, customPads, onSaveCustomPad, onDeleteCustomPad, onDuplicateCustomPad, presetOverrides, onSavePresetOverride, onResetPreset, posOverrides, onSavePosOverride, onResetPosOverride, onNewLayout, pendingEditPad, onClearPendingEditPad }: {
  realTelemetry: any;
  onLaunch: () => void; onConnect: () => void;
  selectedPresetId: string; onSelectPreset: (id: string) => void;
  customPads: CustomPad[]; onSaveCustomPad: (p: CustomPad) => void;
  onDeleteCustomPad: (id: string) => void;
  onDuplicateCustomPad: (pad: CustomPad) => void;
  presetOverrides: Record<string, Partial<Record<BtnId, string>>>;
  onSavePresetOverride: (id: string, m: Partial<Record<BtnId, string>>) => void;
  onResetPreset: (id: string) => void;
  posOverrides: Record<string, PosOverrideMap>;
  onSavePosOverride: (id: string, pos: PosOverrideMap) => void;
  onResetPosOverride: (id: string) => void;
  onNewLayout: () => void;
  onLaunchEditor?: (pad: CustomPad) => void;
  pendingEditPad: CustomPad | null;
  onClearPendingEditPad: () => void;
}) {
  const [editingPad, setEditingPad] = useState<CustomPad | null>(null);
  const [editingPreset, setEditingPreset] = useState<GamepadPreset | null>(null);
  useEffect(() => {
    (window as any).__presetBack = () => {
      if (!editingPreset) return false;
      setEditingPreset(null); return true;
    };
    return () => { delete (window as any).__presetBack; };
  }, [editingPreset]);
  // Share-by-code result modal state + publisher.
  const [shareState, setShareState] = useState<{ padName: string; status: "sharing" | "done" | "error"; code?: string; error?: string } | null>(null);
  const shareRef=useRef<HTMLDivElement>(null);
  useOverlayFocus(!!shareState,shareRef,()=>setShareState(null));
  // One code per layout. If this pad already has a code and its content has not
  // changed since, show that code immediately — no request, so tapping Share
  // repeatedly costs the server nothing and never burns the share rate limit.
  // Editing the layout changes the fingerprint, so it is shared again and gets
  // its own code; the old code keeps serving the old layout, which is what
  // anyone who already has it expects.
  async function sharePad(pad: CustomPad) {
    const fingerprint = await shareFingerprint(pad);
    if (pad.shareCode && pad.shareHash === fingerprint) {
      setShareState({ padName: pad.name, status: "done", code: pad.shareCode });
      return;
    }
    setShareState({ padName: pad.name, status: "sharing" });
    try {
      const res = await fetch(`${PADS_API_BASE}/share`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pad.name, color: pad.color, buttons: pad.buttons }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.success && body?.code) {
        setShareState({ padName: pad.name, status: "done", code: body.code });
        // Remember it so the next tap is instant.
        onSaveCustomPad({ ...pad, shareCode: body.code, shareHash: fingerprint });
      } else {
        setShareState({ padName: pad.name, status: "error", error: body?.error || "Couldn't share this pad." });
      }
    } catch {
      setShareState({ padName: pad.name, status: "error", error: "Couldn't reach the server. Check your connection." });
    }
  }

  // When a new pad is created via the blueprint dialog (which lives in DashboardScreen),
  // open the editor automatically.
  useEffect(() => {
    if (pendingEditPad) {
      if (onLaunchEditor) onLaunchEditor(pendingEditPad);
      else setEditingPad(pendingEditPad);
      onClearPendingEditPad();
    }
  }, [pendingEditPad]);
  const controllers = [
    ...GAMEPAD_PRESETS.map(preset => ({ id: preset.id, preset, pad: null as CustomPad | null })),
    ...customPads.map(pad => ({ id: pad.padId, preset: null as GamepadPreset | null, pad })),
  ];

  return (
    <div className="calm-home">
      <div className="calm-intro console-home-intro"><span className="console-eyebrow">LESS SETUP. MORE PLAY.</span><h1 data-testid="home-heading">Ready, player one.</h1><p>Your next session starts right here.</p></div>
      <ConnectionSummary telemetry={realTelemetry} onClick={onConnect} />
      <div className="calm-section-heading"><h2>Your loadout</h2><span>{controllers.length.toString().padStart(2, "0")} {controllers.length === 1 ? "LAYOUT" : "LAYOUTS"}</span></div>
      <div className="calm-library" data-count={controllers.length}>
        {controllers.map(({ id, preset, pad }) => pad ? <CustomPadSlot key={id} pad={pad}
          active={selectedPresetId === id} onSelect={() => onSelectPreset(id)}
          onPlay={() => { onSelectPreset(id); onLaunch(); }}
          onEdit={() => { if (onLaunchEditor) onLaunchEditor(pad); else setEditingPad(pad); }}
          onDelete={() => onDeleteCustomPad(id)} onDuplicate={() => onDuplicateCustomPad(pad)} onShare={() => sharePad(pad)} />
          : <GamepadCard key={id} preset={presetOverrides[id] ? { ...preset!, mapping: { ...preset!.mapping, ...presetOverrides[id] } } : preset!}
              active={selectedPresetId === id} isModified={!!presetOverrides[id]}
              onSelect={() => onSelectPreset(id)} onPlay={() => { onSelectPreset(id); onLaunch(); }} />)}
      </div>
      <button className="calm-create-layout" data-testid="create-layout-button" onClick={onNewLayout}>
        <span className="console-create-icon"><Plus size={22} aria-hidden="true" /></span><span className="calm-grow"><strong>Make it your own.</strong><small>Create a custom controller layout</small></span><ChevronRight size={18} aria-hidden="true" />
      </button>
      <DashboardAllowance />
      <LaunchNotice />
      {/* Editor is rendered at the APP ROOT as its own full-screen view, not
          here — a fixed element under this CSS-transformed tab container would
          anchor to the transform and let the dashboard bleed through. */}

      {shareState && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-6" onClick={() => setShareState(null)}>
          <div ref={shareRef} role="dialog" aria-modal="true" aria-label="Share controller layout" className="calm-surface border border-white/10 rounded-3xl p-6 w-full max-w-[320px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="calm-ink font-bold text-base truncate pr-2">Share "{shareState.padName}"</h3>
              <button onClick={() => setShareState(null)} className="w-8 h-8 rounded-full bg-white/5 calm-muted flex items-center justify-center active:scale-90 flex-shrink-0">
                <X size={15} />
              </button>
            </div>
            {shareState.status === "sharing" && (<p className="text-sm text-muted-foreground py-4 text-center">Uploading your layout...</p>)}
            {shareState.status === "error" && (<p className="text-sm text-red-400 py-2 leading-snug">{shareState.error}</p>)}
            {shareState.status === "done" && shareState.code && (
              <>
                <p className="text-xs text-muted-foreground mb-3 leading-snug">Anyone can load this controller in <span className="calm-ink">New Layout, Import from Code</span> using:</p>
                <div className="rounded-xl bg-primary/10 border border-primary/30 py-4 mb-3 text-center">
                  <span className="text-2xl font-mono font-black tracking-[0.35em] text-primary select-all">{shareState.code}</span>
                </div>
                <button onClick={() => { try { (navigator as any).clipboard?.writeText(shareState.code); } catch {} }}
                  className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 calm-ink text-xs font-bold active:scale-95 transition-all">Copy code</button>
              </>
            )}
          </div>
        </div>
      )}

      {editingPreset && (
        <PresetEditor
          preset={editingPreset}
          currentMapping={editingPreset.mapping}
          currentPos={posOverrides[editingPreset.id] ?? {}}
          onSave={m => { onSavePresetOverride(editingPreset.id, m); setEditingPreset(null); }}
          onSaveLayout={pos => onSavePosOverride(editingPreset.id, pos)}
          onReset={() => { onResetPreset(editingPreset.id); onResetPosOverride(editingPreset.id); setEditingPreset(null); }}
          onClose={() => setEditingPreset(null)} />
      )}

    </div>
  );
}

// ─── Tab: System (Network + Sensors + Thermals) ───────────────────────────────

// ─── Developer Payload Simulator ─────────────────────────────────────────────

// (Developer Payload Simulator component completely removed for player simplicity)

// ─── Tab: Session (Playtime + Advanced) ──────────────────────────────────────

// ─── In-app feedback ──────────────────────────────────────────────────────────
// Sends a message straight into the team's admin portal, tagged source="mobile".
// FEEDBACK_URL now lives in feedback.ts, built from API_ORIGIN so a build
// pointed at a LAN backend does not file test tickets on the live support desk.
const CONTACT_URL = "https://gamepad.space/contact.html";
const PRIVACY_URL = "https://gamepad.space/privacy.html";
// Share / import controller layouts by code. POST here to publish (returns a
// code); GET `${PADS_API_BASE}/${code}` to import.
const PADS_API_BASE = "https://supportportal.gamepad.space/api/pads";
function openExternal(url: string) {
  const b = (window as any).AndroidBridge;
  if (b && b.openUrl) { try { b.openUrl(url); return; } catch {} }
  try { window.open(url, "_blank"); } catch {}
}
function FeedbackCard() {
  const [open, setOpen] = useState(false);
  const feedbackRef=useRef<HTMLDivElement>(null);
  useOverlayFocus(open,feedbackRef,()=>setOpen(false));
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [err, setErr] = useState("");
  const emailOk = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email.trim());
  const msgLen = message.trim().length;
  const valid = emailOk && msgLen >= 10;

  const submit = async () => {
    if (!valid || state === "sending") return;
    setState("sending"); setErr("");
    try {
      const res = await fetch(FEEDBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "App User", email: email.trim(), subject: "feedback", message: message.trim(), source: "mobile" }),
      });
      if (res.ok) {
        setState("ok");
        markFeedbackSent();   // lets the launch notice stop asking for feedback
      } else { setState("err"); setErr("Server error — please try again."); }
    } catch {
      setState("err"); setErr("No connection — check your internet.");
    }
  };
  // Every open starts a fresh form. This sidesteps the whole class of
  // stale-field / reset-timer races: it doesn't matter what state a
  // just-closed (or mid-send) tray is left in, opening always resets it, so a
  // reopened form is never pre-filled with an already-sent message (no
  // accidental duplicate send) and never gets blanked out from under the user
  // by a late timer.
  const openTray = () => { setEmail(""); setMessage(""); setErr(""); setState("idle"); setOpen(true); };
  const closeTray = () => { setOpen(false); };

  return (
    <>
      {/* Bare block: the Account page owns the panel and the heading. */}
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">Found a bug or have an idea? Send us a message — we read every one and reply by email.</p>
        <div className="flex gap-2">
          <button onClick={openTray}
            className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold active:scale-95 transition-transform"
            style={{ background: "transparent", color: "var(--calm-muted, #a6b0b3)", border: "1px solid var(--calm-line, #343c3f)" }}>
            Submit feedback
          </button>
          <button onClick={() => openExternal(CONTACT_URL)}
            className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold active:scale-95 transition-transform"
            style={{ background: "transparent", color: "var(--calm-muted, #a6b0b3)", border: "1px solid var(--calm-line, #343c3f)" }}>
            Contact us
          </button>
        </div>
      </div>

      {/* Slide-up feedback tray (bottom sheet) */}
      <div
        onClick={closeTray}
        aria-hidden={!open}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.22s ease",
          display: open ? "flex" : "none", alignItems: "flex-end", justifyContent: "center",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          ref={feedbackRef} role="dialog" aria-modal="true" aria-label="Send feedback"
          style={{
            width: "100%", maxWidth: 520,
            background: "var(--calm-surface, #202527)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "20px 20px 0 0",
            padding: "12px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
            transform: open ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
            maxHeight: "88vh", overflowY: "auto",
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--calm-soft, #292f31)", margin: "2px auto 14px" }} />
          {state === "ok" ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-[15px] font-semibold text-emerald-400">Thanks! Your feedback was sent ✓</p>
              <p className="text-[12px] text-muted-foreground">We'll reply to your email if it needs a response.</p>
              <button onClick={closeTray} className="mt-2 px-5 py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: "rgba(79,134,198,0.15)", color: "var(--calm-accent, #abc8db)", border: "1px solid rgba(79,134,198,0.35)" }}>Done</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-bold text-foreground">Send feedback</p>
                <button onClick={closeTray} aria-label="Close" className="text-muted-foreground text-lg leading-none px-2 py-1">✕</button>
              </div>
              <input aria-label="Your email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email"
                className="w-full text-[14px] rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
              <textarea aria-label="Feedback message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Tell us what's on your mind…"
                className="w-full text-[14px] rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-primary/50" />
              {/* Live hint so the send button is never a mysterious "dead" button. */}
              <div className="flex items-center justify-between text-xs">
                <span className={msgLen >= 10 ? "text-muted-foreground" : "text-amber-400"}>
                  {msgLen === 0 ? "Write at least 10 characters" : msgLen < 10 ? `${10 - msgLen} more character${10 - msgLen === 1 ? "" : "s"}` : "Message looks good"}
                </span>
                {email.length > 0 && !emailOk && <span className="text-amber-400">Enter a valid email</span>}
              </div>
              {state === "err" && <p className="text-[12px] text-red-400">{err}</p>}
              <button disabled={!valid || state === "sending"} onClick={submit}
                className="w-full py-3 rounded-lg text-[14px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={{
                  background: valid ? "rgba(79,134,198,0.18)" : "rgba(255,255,255,0.04)",
                  color: valid ? "var(--calm-accent, #abc8db)" : "rgba(255,255,255,0.4)",
                  border: `1px solid ${valid ? "rgba(79,134,198,0.4)" : "rgba(255,255,255,0.08)"}`,
                }}>
                {state === "sending" ? "Sending…" : "Send feedback"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── In-app update check ──────────────────────────────────────────────────────
// Fetches the backend version manifest and compares it to the installed app
// (versionCode, via the AndroidBridge). `compact` renders a top-of-dashboard
// banner only when an update exists; otherwise a full card for the About tab.
const UPDATE_MANIFEST_URL = "https://supportportal.gamepad.space/api/version";

function getInstalledVersion(): { name: string; code: number } {
  const b = (window as any).AndroidBridge;
  let name = "1.0", code = 0;
  try { if (b?.getAppVersionName) name = String(b.getAppVersionName()); } catch {}
  try { if (b?.getAppVersionCode) code = Number(b.getAppVersionCode()) || 0; } catch {}
  return { name, code };
}

// "direct" (our own site), "playstore", "aptoide", "uptodown", "amazonstore" — tells
// the backend which update destination to hand back (a raw APK vs. a store listing
// page). Absent on older/browser shells; those default to "direct" behavior.
function getDistributionChannel(): string {
  const b = (window as any).AndroidBridge;
  try { if (b?.getDistributionChannel) return String(b.getDistributionChannel()); } catch {}
  return "direct";
}

// Native update callbacks (window.__onUpdateProgress / __onUpdateStatus /
// __onPlayUpdate) are process-global, but UpdateChecker is mounted TWICE at once
// (the compact dashboard banner + the full About-tab card). With raw
// last-writer-wins globals, the second mount clobbered the first's handlers, and
// the first unmount deleted the shared global out from under the still-mounted
// one — freezing download progress or dropping the Play update answer entirely.
// Instead the globals are installed once and fan every native call out to every
// live subscriber.
type UpdateSub = {
  onProgress?: (pct: number) => void;
  onStatus?: (phase: string, msg: string) => void;
  onPlay?: (available: boolean, code: number) => void;
};
const _updateSubs = new Set<UpdateSub>();
function _installUpdateGlobals() {
  const w = window as any;
  if (w.__updateGlobalsInstalled) return;
  w.__updateGlobalsInstalled = true;
  w.__onUpdateProgress = (pct: number) => _updateSubs.forEach(s => { try { s.onProgress?.(pct); } catch {} });
  w.__onUpdateStatus = (phase: string, msg: string) => _updateSubs.forEach(s => { try { s.onStatus?.(phase, msg); } catch {} });
  w.__onPlayUpdate = (available: boolean, code: number) => _updateSubs.forEach(s => { try { s.onPlay?.(available, code); } catch {} });
}

function UpdateChecker({ compact = false }: { compact?: boolean }) {
  const installed = useMemo(getInstalledVersion, []);
  // Store builds have no startApkUpdate bridge method at all (see UpdaterBridge.kt),
  // so this is false there — the button falls back to opening the store listing.
  const canSelfUpdate = useMemo(() => !!(window as any).AndroidBridge?.startApkUpdate, []);
  const [state, setState] = useState<"checking" | "latest" | "available" | "error">("checking");
  // Set when a failed check still proves we had connectivity, so the error text
  // can point at the website instead of blaming the user's network.
  const reachedServer = useRef(false);
  const [info, setInfo] = useState<{ version?: string; url?: string; notes?: string; sha256?: string }>({});
  // In-app download/install progress (null = not updating).
  const [dl, setDl] = useState<{ pct: number; phase: string; msg: string } | null>(null);

  const check = useCallback(() => {
    setState("checking");
    reachedServer.current = false;   // fresh verdict every attempt
    const channel = getDistributionChannel();
    // Play builds ask GOOGLE PLAY, never our backend: the site can advertise a
    // release Play's review pipeline hasn't published yet, which used to show a
    // banner that dead-ended on a Play listing with no update. The playstore
    // UpdaterBridge answers through window.__onPlayUpdate. No checkPlayUpdate
    // method (older shell / browser preview reporting this channel) → no banner.
    if (channel === "playstore") {
      const b = (window as any).AndroidBridge;
      if (!b?.checkPlayUpdate) { setState("latest"); return; }
      // The answer arrives via this instance's subscriber onPlay (registered in
      // the effect below), not a raw global — so both mounted checkers hear it.
      try { b.checkPlayUpdate(); } catch { setState("error"); }
      return;
    }
    fetch(`${UPDATE_MANIFEST_URL}?channel=${encodeURIComponent(channel)}`, { cache: "no-store" })
      .then(r => {
        // A non-2xx PROVES we reached the internet and our own backend answered
        // badly — so the honest advice is "our service is down", never "check
        // your connection". Distinguished from a rejected fetch below.
        if (!r.ok) { reachedServer.current = true; throw new Error(`HTTP ${r.status}`); }
        return r.json();
      })
      .then(d => {
        const a = (d && d.android) || {};
        if (typeof a.versionCode === "number" && a.versionCode > installed.code) {
          setInfo({ version: a.version, url: a.url, notes: a.notes, sha256: a.sha256 });
          setState("available");
        } else setState("latest");
      })
      .catch(() => {
        // fetch rejected = network-level. navigator.onLine is only a link-layer
        // hint, but it's the one signal a WebView has: if the phone says it IS
        // online, our backend is the likely culprit, so offer the manual route.
        if (navigator.onLine !== false) reachedServer.current = true;
        setState("error");
      });
  }, [installed.code]);

  useEffect(() => { check(); }, [check]);  // auto-check on mount (≈ on launch)

  // Re-check when the app returns to the foreground. Matters for the Play channel:
  // if an immediate update was interrupted by backgrounding, this brings the
  // banner back (checkPlayUpdate reports the in-progress update) so the user can
  // resume it — the WebView stays mounted across backgrounding, so mount-only
  // checking would miss it. But do NOT re-check while an update is already
  // surfaced or an in-app download is running: check() sets state "checking"
  // (and a transient offline-on-resume sets "error"), either of which would blank
  // the banner and clobber live download progress. busyRef holds the latest
  // values so the (deps: [check]) listener isn't reading a stale closure.
  const busyRef = useRef(false);
  busyRef.current = state === "available" || dl != null;
  useEffect(() => {
    const onVis = () => { if (!document.hidden && !busyRef.current) check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [check]);

  // The native updater (MainActivity.startApkUpdate / the Play bridge) pushes
  // progress/status/Play-answer here. Each mounted instance subscribes its own
  // handlers and removes only its own on unmount, so the other instance keeps
  // working (see _updateSubs / _installUpdateGlobals).
  useEffect(() => {
    const sub: UpdateSub = {
      onProgress: (pct: number) => setDl(d => ({ pct, phase: "downloading", msg: d?.msg || "" })),
      onStatus: (phase: string, msg: string) => setDl(d => ({ pct: phase === "installing" ? 100 : (d?.pct ?? 0), phase, msg })),
      onPlay: (available: boolean) => {
        if (available) { setInfo({ notes: "A new version is ready on Google Play." }); setState("available"); }
        else setState("latest");
      },
    };
    _updateSubs.add(sub);
    _installUpdateGlobals();
    return () => { _updateSubs.delete(sub); };
  }, []);

  // One-click: native download → verify SHA-256 → system install. Falls back to a
  // plain browser download on older app shells without startApkUpdate.
  const download = () => {
    const b = (window as any).AndroidBridge;
    // playstore flavor: hand the whole flow to Play's own full-screen update UI.
    if (getDistributionChannel() === "playstore" && b?.startPlayUpdate) {
      try { b.startPlayUpdate(); } catch {}
      return;
    }
    if (b?.startApkUpdate) {
      setDl({ pct: 0, phase: "downloading", msg: "Starting…" });
      try { b.startApkUpdate(info.url || "", info.sha256 || ""); }
      catch { try { b.openUrl?.(info.url || ""); } catch {} }
    } else {
      try { b?.openUrl?.(info.url || ""); } catch {}
    }
  };

  const busy = !!dl && (dl.phase === "downloading" || dl.phase === "installing");
  const dlText = !dl ? "" :
    dl.phase === "installing" ? (dl.msg || "Opening installer…") :
    dl.phase === "error" ? (dl.msg || "Update failed.") :
    dl.phase === "permission" ? (dl.msg || "Permission needed — tap Update again.") :
    `Downloading… ${Math.max(0, dl.pct)}%`;

  // Compact = top-of-dashboard banner; nothing unless an update is available.
  if (compact) {
    if (state !== "available") return null;
    return (
      <div className="console-update-banner flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground">Update available{info.version ? ` · v${info.version}` : ""}</p>
          {info.notes && <p className="text-xs text-muted-foreground truncate">{info.notes}</p>}
        </div>
        {busy ? (
          <span className="flex-shrink-0 text-xs font-bold" style={{ color: "var(--calm-accent, #abc8db)" }}>{dlText}</span>
        ) : (
          <button data-testid="download-update-button" onClick={download} className="calm-text-button">
            {dl ? "Retry" : "Update"}
          </button>
        )}
      </div>
    );
  }

  // Bare block (Account tab): no card chrome and no heading of its own — the
  // Account page supplies the panel and the section title, so this reads as one
  // row of that page instead of a card floating inside another card.
  return (
    <div className="p-4 space-y-2">
      {state === "available" ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--calm-accent, #abc8db)" }}>Update available{info.version ? `: v${info.version}` : ""}</p>
          {info.notes && <p className="text-xs text-muted-foreground leading-relaxed">{info.notes}</p>}
          {busy ? (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--calm-soft, #292f31)" }}>
                <div className="h-full transition-all" style={{ width: `${Math.max(3, dl?.pct ?? 0)}%`, background: "var(--calm-accent, #abc8db)" }} />
              </div>
              <p className="text-xs" style={{ color: "var(--calm-accent, #abc8db)" }}>{dlText}</p>
            </div>
          ) : (
            <>
              {dl && (dl.phase === "error" || dl.phase === "permission") && (
                <p className="text-xs" style={{ color: dl.phase === "error" ? "#ff6b6b" : "var(--calm-accent, #abc8db)" }}>{dl.msg}</p>
              )}
              <button onClick={download}
                className="w-full py-2 rounded-lg text-xs font-bold active:scale-95 transition-transform"
                style={{ background: "rgba(79,134,198,0.15)", border: "1px solid rgba(79,134,198,0.35)", color: "var(--calm-accent, #abc8db)" }}>
                {dl ? "Retry update" : (canSelfUpdate ? "Download & install update" : getDistributionChannel() === "playstore" ? "Update via Google Play" : "Update via store")}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {state === "checking" ? "Checking for updates…" :
             state === "latest"   ? "You're on the latest version." :
             // Only the DIRECT build may point at the website: telling a store
             // user to sideload an APK breaks Play (and most marketplaces')
             // distribution policy. Store builds get a neutral retry message —
             // their store already handles delivering the update.
             getDistributionChannel() !== "direct" ? "Couldn't check right now. Try again shortly." :
             reachedServer.current
               ? <>Our update service isn't responding. Get the latest version at{" "}
                   <a href="https://gamepad.space/#download" target="_blank" rel="noreferrer"
                      className="underline" style={{ color: "var(--calm-accent, #abc8db)" }}>gamepad.space</a>.</>
               : "Couldn't check right now — check your connection."}
          </span>
          <button onClick={check} disabled={state === "checking"}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-transform"
            style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)", color: "var(--calm-muted, #a6b0b3)", opacity: state === "checking" ? 0.6 : 1 }}>
            Check for updates
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Bottom nav (3 tabs) ──────────────────────────────────────────────────────
const TABS: { id: DashTab; label: string; Icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: "home",   label: "Play",   Icon: Home },
  { id: "system", label: "Settings", Icon: Settings },
  { id: "account", label: "Account", Icon: User },
];

// ─── Dashboard Screen ─────────────────────────────────────────────────────────
function DashboardScreen({
  onLaunch, onBack, onLaunchEditor, realTelemetry, selectedPresetId, onSelectPreset, customPads, onSaveCustomPad, onDeleteCustomPad, onDuplicateCustomPad, presetOverrides, onSavePresetOverride, onResetPreset,
  posOverrides, onSavePosOverride, onResetPosOverride,
  gyroOn, setGyroOn,
  gyroMaxAngle, setGyroMaxAngle,
  gyroWheel, setGyroWheel,
  gyroWheelRange, setGyroWheelRange,
  gyroMode, setGyroMode,
  gyroDeadzone, setGyroDeadzone,
  gyroHaptic, setGyroHaptic,
  gyroThrottle, setGyroThrottle,
  gyroIdleDetect, setGyroIdleDetect,
  rumbleOn, setRumbleOn,
}: {
  onLaunch: () => void; onBack: () => void; onLaunchEditor?: (pad: CustomPad) => void; pendingEditPad?: CustomPad | null; onClearPendingEditPad?: () => void; realTelemetry: any;
  selectedPresetId: string; onSelectPreset: (id: string) => void;
  customPads: CustomPad[]; onSaveCustomPad: (p: CustomPad) => void;
  onDeleteCustomPad: (id: string) => void;
  onDuplicateCustomPad: (pad: CustomPad) => void;
  presetOverrides: Record<string, Partial<Record<BtnId, string>>>;
  onSavePresetOverride: (id: string, m: Partial<Record<BtnId, string>>) => void;
  onResetPreset: (id: string) => void;
  posOverrides: Record<string, PosOverrideMap>;
  onSavePosOverride: (id: string, pos: PosOverrideMap) => void;
  onResetPosOverride: (id: string) => void;
  gyroOn: boolean; setGyroOn: (v: boolean) => void;
  gyroMaxAngle: number; setGyroMaxAngle: (v: number) => void;
  gyroWheel: boolean; setGyroWheel: (v: boolean) => void;
  gyroWheelRange: number; setGyroWheelRange: (v: number) => void;
  gyroMode: string; setGyroMode: (v: string) => void;
  gyroDeadzone: number; setGyroDeadzone: (v: number) => void;
  gyroHaptic: boolean; setGyroHaptic: (v: boolean) => void;
  gyroThrottle: boolean; setGyroThrottle: (v: boolean) => void;
  gyroIdleDetect: boolean; setGyroIdleDetect: (v: boolean) => void;
  rumbleOn: boolean; setRumbleOn: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<DashTab>("home");
  const tabHistory = useRef<DashTab[]>([]);
  useEffect(() => { rememberTab(tab); }, [tab]);
  const [authOpen, setAuthOpen] = useState(false);
  const reduceShellMotion = useReducedMotion();
  const dashboardEntered = useRef(false);
  useEffect(() => { dashboardEntered.current = true; }, []);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const shellPresent = useIsPresent();
  const mainRef=useRef<HTMLElement>(null);
  const { appearance, toggle } = useShellAppearance();
  // Signed-in session, or null. Never gates the controller.
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  // Confirm a stored token is still valid, once. Offline keeps the session.
  useEffect(() => { revalidate(); }, []);
  // Pull the account's layouts whenever a session appears — this is what puts
  // your pads back after a reinstall or on a new phone.
  useEffect(() => { onSignedInSync(); }, [session?.token]);
  useEffect(() => {
    if (authOpen && session) {
      setAuthOpen(false);
      setTab('account');
      mainRef.current?.scrollTo({ top: 0 });
    }
  }, [authOpen, session]);
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSignIn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOpen]);

  // ── Blueprint dialog state (hoisted here so dialog renders outside scrollable area) ──
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false);
  const blueprintRef=useRef<HTMLDivElement>(null);
  useOverlayFocus(showBlueprintDialog,blueprintRef,()=>closeBlueprintDialog());
  const [createStep, setCreateStep] = useState<"type" | "template" | "name" | "import">("type");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [newPadName, setNewPadName] = useState("");
  const [newPadColor, setNewPadColor] = useState(CUSTOM_COLORS[0]);
  // Import-by-code state.
  const [importCode, setImportCode] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  // Track the pad being edited after creation (needed for handing off to TabHome)
  const [pendingEditPad, setPendingEditPad] = useState<CustomPad | null>(null);

  const TEMPLATE_DEFAULT_NAMES: Record<string, string> = {
    standard: "My Custom Pad", blank: "Blank Canvas", fps: "FPS Pro Layout", fighter: "Fighter Arcade", racing: "Racing Layout", rpg: "RPG Adventure"
  };
  const BLUEPRINTS = [
    { key: "standard", name: "Standard",   desc: "Full-size wireless controller layout.",       icon: "🟢", color: "from-[#5D90CB]/30 to-[#5D90CB]/10" },
  ];

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Track the visible viewport exactly — works for ALL Android keyboard modes:
  // adjustPan: vv.offsetTop tracks native pan offset
  // adjustNothing/edge-to-edge: vv.height shrinks to area above keyboard
  // adjustResize: both change together
  const [vpTop, setVpTop] = useState(0);
  const [vpHeight, setVpHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    if (!showBlueprintDialog) {
      setVpTop(0);
      setVpHeight(window.innerHeight);
      return;
    }
    const vv = window.visualViewport;
    const update = () => {
      const top = vv ? Math.round(vv.offsetTop) : 0;
      const h   = vv ? Math.round(vv.height)    : window.innerHeight;
      setVpTop(top);
      setVpHeight(h);
    };
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    update();
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, [showBlueprintDialog]);

  function openBlueprintDialog() {
    setShowBlueprintDialog(true);
    setCreateStep("type");
    setSelectedTemplate("");
    setNewPadName("");
    setNewPadColor(CUSTOM_COLORS[0]);
  }

  function closeBlueprintDialog() {
    setShowBlueprintDialog(false);
    setCreateStep("template");
  }

  function commitNewPad() {
    const newId = `cb${Date.now()}`;
    const newPad = makeDefaultPad(newId, selectedTemplate, newPadName.trim() || undefined);
    newPad.color = newPadColor;
    onSaveCustomPad(newPad);
    setPendingEditPad(newPad);
    setShowBlueprintDialog(false);
    setCreateStep("template");
    setSelectedTemplate("");
    setNewPadName("");
    setNewPadColor(CUSTOM_COLORS[0]);
  }

  // Import a shared layout by its code: fetch from the backend, add it as a fresh
  // custom pad (new padId + name suffix), then open it in the editor.
  async function importByCode() {
    const code = importCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) { setImportError("Enter the code from the person who shared the pad."); return; }
    setImportBusy(true); setImportError("");
    try {
      const res = await fetch(`${PADS_API_BASE}/${encodeURIComponent(code)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success || !body?.pad) {
        setImportError(body?.error || "No layout found for that code.");
        setImportBusy(false);
        return;
      }
      const p = body.pad;
      const newPad: CustomPad = {
        padId: `cb${Date.now()}`,
        name: (p.name || "Imported Pad").slice(0, 40),
        color: p.color || CUSTOM_COLORS[Math.floor(Math.random() * CUSTOM_COLORS.length)],
        // Re-key widget uids so they never collide with an existing pad's.
        buttons: (p.buttons || []).map((b: CustomBtnDef) => ({ ...b, uid: mkUid() })),
      };
      onSaveCustomPad(newPad);
      setPendingEditPad(newPad);
      setShowBlueprintDialog(false);
      setCreateStep("type");
      setImportCode("");
    } catch (e) {
      setImportError("Couldn't reach the server. Check your connection and try again.");
    }
    setImportBusy(false);
  }

  function changeTab(newTab: DashTab) {
    setAuthOpen(false);
    if (newTab === tab && !authOpen) return;
    if (newTab !== tab) tabHistory.current.push(tab);
    mainRef.current?.scrollTo({top:0});
    setTab(newTab);
  }

  function openProfile() {
    mainRef.current?.scrollTo({ top: 0 });
    if (getSession()) changeTab('account');
    else setAuthOpen(true);
  }

  function closeSignIn() {
    setAuthOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
    profileButtonRef.current?.focus({ preventScroll: true });
  }

  // Another view asking for a specific tab — currently the controller's
  // out-of-playtime overlay sending the user to Account to see the plans.
  // Without this it could only call onBack() and would land on Home.
  useEffect(() => onDashboardTabRequest((t) => changeTab(t)));

  // Register a global hook so handleAndroidBack (App level) can close our dialog
  // instead of navigating to scanner when the Android back gesture fires during keyboard use.
  useEffect(() => {
    (window as any).__dashboardCloseDialog = () => {
      if (showBlueprintDialog) {
        closeBlueprintDialog();
        return true; // handled
      }
      if (authOpen) { closeSignIn(); return true; }
      if (tab !== "home") {
        setTab(tabHistory.current.pop() || "home");
        mainRef.current?.scrollTo({ top: 0 });
        return true;
      }
      return false; // nothing open, let back navigate normally
    };
    return () => {
      delete (window as any).__dashboardCloseDialog;
    };
  }, [showBlueprintDialog, authOpen, tab]);


  return (
    <div className="gp-dashboard gp-shell flex flex-col h-full" data-calm-theme={appearance} style={{ pointerEvents: shellPresent ? 'auto' : 'none' }}>
      <ShellMotion />
      <header className="calm-header">
        <CalmBrand />
        <div className="calm-header-actions">
          <AppearanceButton appearance={appearance} onClick={toggle} />
          <button ref={profileButtonRef} data-testid="profile-shortcut-button" className="calm-account-shortcut" onClick={openProfile} aria-label={session ? 'Open your profile' : 'Sign in to GamepadOS'}>
            <User size={18} aria-hidden="true" />{session && <span>{session.user.displayName}</span>}
          </button>
        </div>
      </header>

      <main ref={mainRef} className="calm-main">
        <div className={authOpen ? 'console-auth-content' : tab === "home" ? "calm-home-content" : "calm-legacy-content"}>
          {/* Update banner. Renders nothing unless an update is actually
              available, and is hidden on Settings because that tab shows the full
              update block — otherwise the same notice would appear twice. */}
          <motion.div key={authOpen ? 'sign-in' : tab} initial={reduceShellMotion || !dashboardEntered.current ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceShellMotion ? 0 : .22, ease: [.22, 1, .36, 1] }}>
            {authOpen ? <SignInScreen onBack={closeSignIn} onPlans={() => changeTab('account')} /> : <>
            {tab === "home"   && <TabHome realTelemetry={realTelemetry} onLaunch={onLaunch} onConnect={onBack}
              onLaunchEditor={onLaunchEditor}
              selectedPresetId={selectedPresetId} onSelectPreset={onSelectPreset}
              customPads={customPads} onSaveCustomPad={onSaveCustomPad} onDeleteCustomPad={onDeleteCustomPad}
              onDuplicateCustomPad={onDuplicateCustomPad}
              presetOverrides={presetOverrides} onSavePresetOverride={onSavePresetOverride} onResetPreset={onResetPreset}
              posOverrides={posOverrides} onSavePosOverride={onSavePosOverride} onResetPosOverride={onResetPosOverride}
              onNewLayout={openBlueprintDialog}
              pendingEditPad={pendingEditPad}
              onClearPendingEditPad={() => setPendingEditPad(null)} />}
            {tab === "system" && <TabSystem gyroOn={gyroOn} setGyroOn={setGyroOn} gyroMaxAngle={gyroMaxAngle} setGyroMaxAngle={setGyroMaxAngle} gyroWheel={gyroWheel} setGyroWheel={setGyroWheel} gyroWheelRange={gyroWheelRange} setGyroWheelRange={setGyroWheelRange} gyroMode={gyroMode} setGyroMode={setGyroMode} gyroDeadzone={gyroDeadzone} setGyroDeadzone={setGyroDeadzone} gyroHaptic={gyroHaptic} setGyroHaptic={setGyroHaptic} gyroThrottle={gyroThrottle} setGyroThrottle={setGyroThrottle} gyroIdleDetect={gyroIdleDetect} setGyroIdleDetect={setGyroIdleDetect} rumbleOn={rumbleOn} setRumbleOn={setRumbleOn}><AppSupport privacyUrl={PRIVACY_URL} updateChecker={<UpdateChecker />} feedback={<FeedbackCard />} /></TabSystem>}
            {tab === "account" && (
              <TabAccount
                customPadsCount={customPads.length}
                gyroHaptic={gyroHaptic}
                gyroMode={gyroMode}
                gyroThrottle={gyroThrottle}
                rumbleOn={rumbleOn}
                onOpenSystem={() => changeTab("system")}
                onSignIn={openProfile}
              />
            )}
            </>}
          </motion.div>
          {!authOpen && tab !== "system" && <div className="calm-existing-update"><UpdateChecker compact /></div>}
        </div>
      </main>

      {!authOpen && <nav className="calm-nav" aria-label="Main navigation">
        {TABS.map(({ id, label, Icon }) => <motion.button data-no-shell-press data-testid={`nav-${id}-button`} key={id} onClick={() => changeTab(id)} aria-current={tab === id ? "page" : undefined} whileTap={reduceShellMotion ? undefined : { scale: .94 }}>
          <span className="console-nav-icon">{tab === id && <motion.span className="console-nav-active" layoutId="active-tab" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}{id === 'account' && !session ? <Ticket size={20} /> : <Icon size={20} />}</span><span>{id === 'account' && !session ? (getAppInfo().channel === 'playstore' ? 'Time' : 'Plans') : label}</span>
        </motion.button>)}
      </nav>}

      {/* Blueprint dialog — Portal into document.body so it's completely immune to
          parent transforms, stacking contexts, and keyboard-triggered event bugs */}
      {createPortal(
        <AnimatePresence>
          {showBlueprintDialog && (
            <motion.div
              className="gp-shell calm-dialog" data-calm-theme={appearance}
              {...backdropIn}
              transition={FADE}
              style={{
                position: "fixed",
                // Use exact visual viewport coordinates — counteracts adjustPan native pan
                // AND handles adjustResize/adjustNothing/edge-to-edge mandatory overlay
                top: vpTop,
                left: 0,
                right: 0,
                height: vpHeight,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                background: "rgba(0,0,0,0.88)",
              }}
            >
              {/* Scale + fade from the centre only. The old version also drifted
                  up on a y offset while the step content slid in from the left,
                  so the dialog looked like it was flying in from somewhere. */}
              <motion.div
                {...cardIn}
                role="dialog" aria-modal="true" aria-label="Create or import a layout"
                ref={blueprintRef}
                transition={SPRING}
                style={{
                  width: "100%", maxWidth: "384px", borderRadius: "24px",
                  background: "var(--calm-surface, #202527)", border: "1px solid var(--calm-line, #343c3f)",
                  maxHeight: "85vh", overflow: "hidden",
                  boxShadow: "none",
                }}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onTouchEnd={e => e.stopPropagation()}
              >
            {/* initial={false} — the first step is already inside a card that is
                animating in, so it must not animate as well. Only step CHANGES
                move, and they move forward: out to the left, in from the right. */}
            <AnimatePresence mode="wait" initial={false}>
              {createStep === "type" ? (
                <motion.div
                  key="type"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={STEP}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <h3 className="text-lg font-black calm-ink tracking-tight">Choose Type</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">How would you like to start?</p>
                    </div>
                    <button
                      onClick={closeBlueprintDialog}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground active:scale-90 transition-all mt-0.5"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => {
                        setSelectedTemplate("blank");
                        setNewPadName(TEMPLATE_DEFAULT_NAMES["blank"]);
                        setNewPadColor(CUSTOM_COLORS[0]);
                        setCreateStep("name");
                      }}
                      className="text-left p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform duration-100"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800/30 to-zinc-700/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        ✦
                      </div>
                      <div>
                        <p className="text-sm font-bold calm-ink leading-tight">Blank Canvas</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Start completely empty and build widget by widget.</p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setCreateStep("template");
                      }}
                      className="text-left p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform duration-100"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/30 to-indigo-600/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        🎮
                      </div>
                      <div>
                        <p className="text-sm font-bold calm-ink leading-tight">Standard Layouts</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Choose from a variety of pre-configured gamepads.</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setImportError(""); setImportCode(""); setCreateStep("import"); }}
                      className="text-left p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform duration-100"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600/30 to-teal-600/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        ⤓
                      </div>
                      <div>
                        <p className="text-sm font-bold calm-ink leading-tight">Import from Code</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Got a share code? Paste it to load someone's controller.</p>
                      </div>
                    </button>
                  </div>
                </motion.div>
              ) : createStep === "import" ? (
                <motion.div
                  key="import"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={STEP}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep("type")}
                      className="w-8 h-8 flex items-center justify-center rounded-full calm-muted active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-lg font-black calm-ink tracking-tight">Import from Code</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Paste the code someone shared with you</p>
                    </div>
                  </div>
                  <label className="text-xs font-bold text-muted-foreground mb-2 block">Share Code</label>
                  <input
                    value={importCode}
                    onChange={e => { setImportCode(e.target.value.toUpperCase()); setImportError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") importByCode(); }}
                    placeholder="e.g. K7M2QP"
                    maxLength={12}
                    autoCapitalize="characters"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 calm-ink text-center text-lg font-mono tracking-[0.3em] outline-none focus:border-primary/60"
                  />
                  {importError && (
                    <p className="text-xs text-red-400 mt-2 leading-snug">{importError}</p>
                  )}
                  <button
                    onClick={importByCode}
                    disabled={importBusy}
                    className="w-full mt-5 py-3 rounded-xl bg-primary text-black font-bold text-sm active:scale-95 transition-all disabled:opacity-50"
                  >
                    {importBusy ? "Importing…" : "Import Controller"}
                  </button>
                </motion.div>
              ) : createStep === "template" ? (
                <motion.div
                  key="template"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={STEP}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep("type")}
                      className="w-8 h-8 flex items-center justify-center rounded-full calm-muted active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-lg font-black calm-ink tracking-tight">Choose Template</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Pick a starting point for your layout</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {BLUEPRINTS.map((bp, i) => (
                      <button
                        key={bp.key}
                        onClick={() => {
                          setSelectedTemplate(bp.key);
                          setNewPadName(TEMPLATE_DEFAULT_NAMES[bp.key] || bp.name);
                          setNewPadColor(CUSTOM_COLORS[i % CUSTOM_COLORS.length]);
                          setCreateStep("name");
                        }}
                        className="text-left p-3.5 rounded-2xl flex flex-col gap-2.5 active:scale-95 transition-transform duration-100"
                        style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}
                      >
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${bp.color} border border-white/10 flex items-center justify-center text-2xl flex-shrink-0`}>
                          {bp.icon}
                        </div>
                        <div>
                          <p className="text-xs font-bold calm-ink leading-tight">{bp.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{bp.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={STEP}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep(selectedTemplate === "blank" ? "type" : "template")}
                      className="w-8 h-8 flex items-center justify-center rounded-full calm-muted active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "var(--calm-soft, #292f31)", border: "1px solid var(--calm-line, #343c3f)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-base font-black calm-ink tracking-tight">Name Your Pad</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Customize before building</p>
                    </div>
                  </div>

                  <div className="mb-5">
                    <label className="text-xs font-bold text-muted-foreground mb-2 block">Layout Name</label>
                    <input
                      ref={nameInputRef}
                      value={newPadName}
                      onChange={e => setNewPadName(e.target.value)}
                      maxLength={24}
                      onKeyDown={e => { if (e.key === "Enter") commitNewPad(); }}
                      className="w-full rounded-xl px-4 py-3 text-sm font-semibold calm-ink outline-none transition-colors"
                      style={{ background: "var(--calm-soft, #292f31)", border: `1.5px solid ${newPadName ? newPadColor + "80" : "rgba(255,255,255,0.1)"}`, caretColor: newPadColor }}
                      placeholder="My Custom Layout"
                    />
                  </div>


                  <div className="mb-7">
                    <label className="text-xs font-bold text-muted-foreground mb-3 block">Accent Color</label>
                    <div className="flex gap-3">
                      {CUSTOM_COLORS.map(c => (
                        <button key={c} onClick={() => setNewPadColor(c)}
                          className="w-9 h-9 rounded-full transition-all active:scale-90 duration-150 flex items-center justify-center"
                          style={{ background: c, boxShadow: newPadColor === c ? `0 0 0 2.5px white, 0 0 0 4px ${c}` : `0 0 0 1.5px ${c}40` }}>
                          {newPadColor === c && <span className="text-black font-black text-sm">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={commitNewPad}
                    className="w-full py-3.5 rounded-2xl text-sm font-black transition-all duration-150 active:scale-95"
                    style={{ background: newPadColor, color: "#000001" }}
                  >
                    CREATE &amp; OPEN EDITOR
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
// Transition contract (all reversible):
//   scanner  ↔ dashboard  : dashboard slides right  (translateX 100%↔0)
//   dashboard ↔ controller : controller slides up    (translateY 100%↔0)
//   Dashboard stays in place (translateX 0) while controller is open.
//   Controller back → dashboard (not scanner).
export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const firstRoute = useRef(true);
  useEffect(() => { firstRoute.current = false; }, []);
  // Feature-intro / rating overlay (#3). `rated` gates the whole feature off
  // once a rating is submitted, so it unmounts and disposes its resources.
  const [showIntro, setShowIntro] = useState(false);
  const [rated, setRated] = useState(() => introRated());
  // #4: if a prior session queued a rating while offline, sync it now / on reconnect.
  useEffect(() => { initFeedbackSync(); }, []);
  const [rumbleOn, setRumbleOn] = useState(true);
  // Paused while the controller is open (2026-10-01): each 500 ms poll set new
  // state here, re-rendering the whole app -- the pad included -- twice a second
  // during play. Only the dashboard shows these numbers.
  const realTelemetry = useNetworkTelemetry(view !== "controller");

  // The native app-icon SplashScreen is the ONLY intro. Signal it to dismiss once
  // the UI has painted a STABLE, FINAL-LOOKING frame — otherwise the splash lifts
  // onto a fallback-font layout that then snaps to Space Grotesk/Inter a beat
  // later (the WebView is LOAD_NO_CACHE, so those Google Fonts are re-fetched
  // over the network every launch), which reads as the app "opening twice".
  // Wait for document.fonts.ready (capped by a timeout so a slow/offline network
  // can't hang the splash — the native 3s failsafe is the final backstop), THEN
  // two rAFs past that so the font swap has actually been painted, THEN reveal.
  useEffect(() => {
    let cancelled = false;
    let raf1 = 0, raf2 = 0, t = 0;
    const settle = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          if (cancelled) return;
          try { (window as any).AndroidBridge?.onUiReady?.(); } catch {}
        });
      });
    };
    const fontsReady = (document as any).fonts?.ready as Promise<unknown> | undefined;
    if (fontsReady) {
      Promise.race([
        fontsReady,
        new Promise(resolve => { t = window.setTimeout(resolve, 900); }),
      ]).then(() => { if (!cancelled) settle(); });
    } else {
      settle();
    }
    return () => { cancelled = true; cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t); };
  }, []);

  const viewRef = useRef<View>(view);
  const [isCurtainDown, setIsCurtainDown] = useState(false);
  // Curtain transition driver. Tracks its timers and guards re-entrancy so a fast
  // double-tap or Android-back mid-transition can't wedge the screen black or leave
  // a view/orientation mismatch. A 1.2s failsafe always lifts the curtain.
  const curtainTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transitioningRef = useRef(false);
  const runCurtainSequence = useCallback((mid: () => void) => {
    if (transitioningRef.current) return;            // ignore overlapping navigations
    transitioningRef.current = true;
    curtainTimers.current.forEach(clearTimeout);
    curtainTimers.current = [];
    setIsCurtainDown(true);
    const finish = () => { setIsCurtainDown(false); transitioningRef.current = false; };
    const t1 = setTimeout(() => {
      try { mid(); } catch (e) { console.error(e); }   // fade in fully, then swap view/orientation
      curtainTimers.current.push(setTimeout(finish, 180));   // cover physical rotation, without a decorative loading pause
    }, 100);
    const tFailsafe = setTimeout(finish, 1200);        // never leave the curtain stuck down
    curtainTimers.current.push(t1, tFailsafe);
  }, []);

  useEffect(() => {
    // Pull the exact status bar height directly from the Kotlin bridge
    const bridge = (window as any).AndroidBridge;
    if (bridge) {
      try {
        if (bridge.getSafeAreaTop && bridge.getSafeAreaTop() > 0) {
          document.documentElement.style.setProperty('--android-safe-top', `${bridge.getSafeAreaTop()}px`);
        }
        if (bridge.getSafeAreaBottom && bridge.getSafeAreaBottom() > 0) {
          document.documentElement.style.setProperty('--android-safe-bottom', `${bridge.getSafeAreaBottom()}px`);
        }
        if (bridge.getSafeAreaLeft && bridge.getSafeAreaLeft() > 0) {
          document.documentElement.style.setProperty('--android-safe-left', `${bridge.getSafeAreaLeft()}px`);
        }
        if (bridge.getSafeAreaRight && bridge.getSafeAreaRight() > 0) {
          document.documentElement.style.setProperty('--android-safe-right', `${bridge.getSafeAreaRight()}px`);
        }
      } catch (e) {}
    }
  }, []);

  // Native tether notifications and explicit choices use the same coordinator.
  const [usbToast, setUsbToast] = useState(false);
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    const w = (window as any).__usbWS;
    if (!w) return;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const coordinator = createTransportCoordinator({
      now: Date.now,
      read: () => {
        let t: any = {}, broadcast = '';
        try { t = JSON.parse(bridge?.getNetworkTelemetryJson?.() || '{}'); confirmWireless(t); } catch {}
        try { broadcast = bridge?.getUsbBroadcastAddress?.() || ''; } catch {}
        return { running: !!t.engineRunning, alive: !!t.linkAlive, kind: t.connectionType || '',
          broadcast, wirelessIntentAt: (window as any).__wirelessIntentAt || 0, pref: getWiredPref(),
          sinceAck: typeof t.sinceAck === 'number' ? t.sinceAck : -1,
          hidden: document.hidden, canRestoreWifi: !!savedPc() };
      },
      stopNative: () => { try { bridge?.stopEngine?.(); } catch {} },
      // Wi-Fi self-heal (transportCoordinator.ts): the same thing a QR rescan
      // does, with the saved PC. Both calls queue on Android's UI thread in
      // order, so the stop finishes before the new session starts.
      restartWireless: () => {
        const pc = savedPc();
        if (!pc || !bridge?.connectToPC) return;
        try { bridge.stopEngine?.(); } catch {}
        pendingWireless(pc);
        try { bridge.connectToPC(pc.ip, pc.port, pc.key); } catch {}
      },
      startTether: broadcast => {
        try { bridge?.connectToPC?.(broadcast, 7777, 'usb'); } catch {}
        setUsbToast(true); clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setUsbToast(false), 2600);
      },
      connectDebug: () => w.connect(), disconnectDebug: () => w.disconnect(),
    });
    const chooseUsb = () => {
      rememberMode("usb"); cancelPendingWireless();
      (window as any).__wirelessIntentAt = 0;
      coordinator.chooseUsb();
    };
    window.addEventListener(USB_CHOICE_EVENT, chooseUsb);
    window.addEventListener(WIRELESS_CHOICE_EVENT, coordinator.chooseWireless);
    (window as any).onUsbTetherChanged = coordinator.reconcile;
    const id = setInterval(coordinator.reconcile, 1500);
    // Restore the last confirmed PC only for a remembered Wi-Fi choice.
    // A warm WebView already has a native engine: never tear it down on mount.
    const pc = savedPc();
    if (connectionMode() === "wireless" && pc && bridge?.connectToPC) {
      coordinator.chooseWireless();
      let running = false;
      try { running = !!JSON.parse(bridge.getNetworkTelemetryJson?.() || "{}").engineRunning; } catch {}
      if (!running) {
        prepareWirelessConnection(); pendingWireless(pc);
        bridge.connectToPC(pc.ip, pc.port, pc.key);
      }
    }
    coordinator.reconcile();
    const resumeTransport = () => { if (!document.hidden) coordinator.reconcile(); };
    document.addEventListener("visibilitychange", resumeTransport);
    return () => {
      document.removeEventListener("visibilitychange", resumeTransport);
      clearInterval(id);
      window.removeEventListener(USB_CHOICE_EVENT, chooseUsb);
      clearTimeout(toastTimer);
      window.removeEventListener(WIRELESS_CHOICE_EVENT, coordinator.chooseWireless);
      delete (window as any).onUsbTetherChanged;
    };
  }, []);

  function navigateTo(target: View) {
    if ((view === "dashboard" && target === "controller") || (view === "controller" && target === "dashboard")) {
      runCurtainSequence(() => {
        const bridge = (window as any).AndroidBridge;
        if (bridge && bridge.setScreenOrientation) {
          try {
            bridge.setScreenOrientation(target === "controller" ? "landscape-locked" : "portrait");
          } catch (e) { console.error(e); }
        }
        setView(target);
        viewRef.current = target;
      });
      // #3: a Controller<->Dashboard move is the paced trigger for the
      // feature-intro rating prompt (no-op once rated).
      if (recordIntroNav()) setShowIntro(true);
    } else {
      setView(target);
      viewRef.current = target;
      const bridge = (window as any).AndroidBridge;
      if (bridge && bridge.setScreenOrientation) {
        try {
          bridge.setScreenOrientation(target === "controller" ? "landscape-locked" : "portrait");
        } catch (e) {}
      }
    }
  }

  const [selectedPresetId, setSelectedPresetId] = useState(selectedLayout);
  useEffect(() => { rememberLayout(selectedPresetId); }, [selectedPresetId]);
  const [editingPad, setEditingPad] = useState<CustomPad | null>(null);
  // The editor's "Save & Quit" calls onSave and THEN its close handler, which is
  // onCancel. This flag lets onCancel know a save just happened so it does not
  // undo it — see the CustomPadEditor block below.
  const justSavedPadRef = useRef(false);

  // Open/close the editor through the SAME curtain + physical-rotation sequence
  // the controller (Play) uses. This is what makes it feel smooth: the black
  // curtain fades in first and hides the device's physical rotation, instead of
  // the editor visibly CSS-spinning while Android rotates underneath it.
  function openEditor(pad: CustomPad) {
    runCurtainSequence(() => {
      const bridge = (window as any).AndroidBridge;
      try { bridge?.setScreenOrientation?.("landscape"); } catch (e) {}
      setEditingPad(pad);
    });
  }
  function closeEditor() {
    runCurtainSequence(() => {
      const bridge = (window as any).AndroidBridge;
      try { bridge?.setScreenOrientation?.(viewRef.current === "controller" ? "landscape-locked" : "portrait"); } catch (e) {}
      setEditingPad(null);
    });
  }
  const [editingPreset, setEditingPreset] = useState<GamepadPreset | null>(null);
  // Orientation for the editor is handled inside openEditor/closeEditor (curtain
  // path). This effect now only covers the preset editor, which has no curtain.
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.setScreenOrientation && editingPreset) {
      try { bridge.setScreenOrientation("landscape"); } catch (e) {}
    }
  }, [editingPreset]);

  const [customPads, setCustomPads] = useState<CustomPad[]>(() => loadPads());
  // Persisted like custom_pads — otherwise a user's saved preset button remaps and
  // dragged widget positions silently vanished on every app restart.
  const [presetOverrides, setPresetOverrides] = useState<Record<string, Partial<Record<BtnId, string>>>>(() => loadPresetOverrides());
  const [posOverrides, setPosOverrides] = useState<Record<string, PosOverrideMap>>(() => loadPosOverrides());

  // Gyro settings persist across app restarts. Defaults and validation live in
  // store/prefs.ts (GYRO_DEFAULTS): ON, 30°, racing, no deadzone, haptic ON,
  // tilt-throttle OFF, idle detection ON — the behaviour already in the field.
  const savedGyro = useRef(loadGyroPrefs()).current;
  const [gyroOn, setGyroOn] = useState(savedGyro.on);
  const [gyroMaxAngle, setGyroMaxAngle] = useState(savedGyro.maxAngle);
  // Wheel mode (support ticket #1959ade3 — "900 and 720 degree gyro for truck or bus
  // sims"). The phone is mounted and ROTATED like a wheel rather than tilted in the
  // hands, so full lock is half the lock-to-lock range away instead of a wrist-flick.
  const [gyroWheel, setGyroWheel] = useState(savedGyro.wheel);
  const [gyroWheelRange, setGyroWheelRange] = useState(savedGyro.wheelRange);
  // Gyro mode: "racing" = 2D steering (left stick X, shows the tilt bar) | "3d" = 2-axis
  // look/aim (right stick X+Y, shows only a small "gyro active" chip).
  const [gyroMode, setGyroMode] = useState<string>(savedGyro.mode);
  const [gyroDeadzone, setGyroDeadzone] = useState(savedGyro.deadzone);
  const [gyroHaptic, setGyroHaptic] = useState(savedGyro.haptic);
  // Racing tilt-throttle: pitch (tilt forward/back) drives the LEFT stick Y so
  // you can accelerate/brake by tilting — 3D mode is unaffected.
  const [gyroThrottle, setGyroThrottle] = useState(savedGyro.throttle);
  // Automatic Gyro Idle Detection (#2). When off, gyro never idles from pose and
  // streams continuously — some players prefer that.
  const [gyroIdleDetect, setGyroIdleDetect] = useState(savedGyro.idleDetect);

  // Sync hapticsEnabled so standalone triggerHaptic() can see it
  useEffect(() => {
    (window as any).hapticsEnabled = gyroHaptic;
  }, [gyroHaptic]);

  // Persist gyro settings so the user's choice survives app restarts.
  useEffect(() => {
    saveGyroPrefs({
      on: gyroOn, maxAngle: gyroMaxAngle, mode: gyroMode as "racing" | "3d",
      deadzone: gyroDeadzone, haptic: gyroHaptic, throttle: gyroThrottle,
      idleDetect: gyroIdleDetect, wheel: gyroWheel, wheelRange: gyroWheelRange,
    });
  }, [gyroOn, gyroMaxAngle, gyroDeadzone, gyroHaptic, gyroMode, gyroThrottle, gyroIdleDetect, gyroWheel, gyroWheelRange]);

  // Tell the native layer whether wheel mode is on. This pushes a FLAG ONLY — it must
  // never change the screen orientation, because this effect runs on mount and on every
  // toggle, from whatever screen happens to be showing. An earlier version rotated the
  // screen from here, so simply having wheel mode saved threw the whole app into
  // landscape at startup, menus included.
  //
  // Orientation is owned by the navigation effect below, which knows which screen is up.
  // The only thing needed here is to RE-APPLY it when the flag changes while the
  // controller is already open, so turning wheel mode on pins the screen immediately
  // instead of on the next navigation.
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || !bridge.setWheelMode) return;   // older shell, or running in a browser
    try {
      bridge.setWheelMode(!!gyroWheel);
      if (viewRef.current === "controller") bridge.setScreenOrientation?.("landscape-locked");
    } catch {}
  }, [gyroWheel]);

  // The angle that actually reaches the steering maths. In wheel mode full lock is
  // half the lock-to-lock range away (900° wheel => 450° each way); otherwise it is the
  // plain tilt sensitivity. Derived ONCE here and handed to the controller screen, so
  // the JS gyro loop and the native engine cannot disagree about the current mode —
  // that split is what caused 26d5368 (sign-in enforced in JS but not in native).
  const gyroEffectiveAngle = gyroWheel
    ? Math.max(1, Math.round(clampWheelRange(gyroWheelRange) / 2))
    : gyroMaxAngle;

  useEffect(() => {
    if (!savePads(customPads)) {
      console.error("Failed to save custom pads — storage refused the write");
    }
    // Back the change up if signed in. Debounced, and a no-op for guests.
    scheduleSync();
  }, [customPads]);

  // Sync rewrites storage from outside React (restoring layouts after a
  // reinstall, or applying a delete made on another device), so adopt whatever
  // it settled on.
  useEffect(() => onPadsReplaced(setCustomPads), []);

  useEffect(() => { savePresetOverrides(presetOverrides); }, [presetOverrides]);

  useEffect(() => { savePosOverrides(posOverrides); }, [posOverrides]);


  useEffect(() => {
    (window as any).handleAndroidBack = () => {
      if (transitioningRef.current) return;
      if (closeTopOverlay()) return;
      if ((window as any).__editorBack?.()) return;
      if ((window as any).__authBack?.()) return;
      if ((window as any).__presetBack?.()) return;
      const currentView = viewRef.current;
      if (currentView === "controller") {
        navigateTo("dashboard");
      } else if (currentView === "dashboard") {
        // If a dialog is open, close it first — don't navigate away.
        // This prevents the keyboard-dismiss back gesture from wiping the whole view.
        const closeFn = (window as any).__dashboardCloseDialog;
        if (typeof closeFn === "function" && closeFn()) {
          return; // dialog was closed, stay on dashboard
        }
        (window as any).AndroidBridge?.exitApp?.();
      } else {
        if ((window as any).__scannerBack?.()) return;
        navigateTo("dashboard");
      }
    };
    return () => {
      delete (window as any).handleAndroidBack;
    };
  }, []);


  // Managing connection options is navigation, not a disconnect.

  function saveCustomPad(p: CustomPad) {
    setCustomPads(prev => {
      const idx = prev.findIndex(x => x.padId === p.padId);
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next; }
      return [...prev, p];
    });
  }

  function deleteCustomPad(padId: string) {
    // Record the delete before dropping it. Sync merges by padId, so an absent
    // pad means "this device hasn't seen it"; only a tombstone means "gone".
    addTombstone(padId);
    setCustomPads(prev => prev.filter(x => x.padId !== padId));
    if (selectedPresetId === padId) {
      setSelectedPresetId("xbox");
    }
  }

  function duplicateCustomPad(pad: CustomPad) {
    const newId = `cb${Date.now()}`;
    const copy = { ...pad, padId: newId, name: `${pad.name} (Copy)` };
    setCustomPads(prev => [...prev, copy]);
  }

  function savePresetOverride(id: string, m: Partial<Record<BtnId, string>>) {
    setPresetOverrides(prev => ({ ...prev, [id]: m }));
  }

  function resetPreset(id: string) {
    setPresetOverrides(prev => { const next = { ...prev }; delete next[id]; return next; });
  }

  function savePosOverride(id: string, pos: PosOverrideMap) {
    setPosOverrides(prev => ({ ...prev, [id]: pos }));
  }

  function resetPosOverride(id: string) {
    setPosOverrides(prev => { const next = { ...prev }; delete next[id]; return next; });
  }

  const activePreset = GAMEPAD_PRESETS.find(p => p.id === selectedPresetId);
  const activeCustomPad = customPads.find(p => p.padId === selectedPresetId);
  const override = presetOverrides[selectedPresetId];
  const activeMapping = activeCustomPad ? {} : override ? { ...activePreset?.mapping, ...override } : activePreset?.mapping ?? {};
  const controllerLayout = activePreset?.layout ?? "standard";

  return (
    <div className={`fixed inset-0 w-full h-full overflow-hidden ${view === "scanner" ? "bg-transparent" : "bg-black"}`}>

      {/* USB auto-connect toast */}
      <AnimatePresence>
        {usbToast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={SPRING}
            className="absolute z-[60] left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full"
            style={{
              top: "calc(env(safe-area-inset-top, 12px) + 10px)",
              background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)",
              backdropFilter: "blur(8px)", fontFamily: "'Inter',sans-serif",
            }}>
            <span className="text-amber-400 text-sm leading-none">⟠</span>
            <span className="text-[11px] font-bold text-amber-200">USB detected — connecting…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Black Curtain for Orientation Transitions */}
      <AnimatePresence>
        {isCurtainDown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: "#070910" }}
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 14, stiffness: 240 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="relative flex items-center justify-center">
                <div className="absolute w-24 h-24 rounded-full" style={{ background: "radial-gradient(circle, rgba(79,134,198,0.45), transparent 68%)", filter: "blur(16px)" }} />
                <Gamepad2 className="relative w-14 h-14 text-primary animate-pulse" strokeWidth={1.6} />
              </div>
              <span className="text-[11px] font-bold tracking-[0.3em] text-white/70" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>LOADING</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" custom={view}>
        {view === "scanner" && (
          <ShellScreenTransition key="scanner" direction={-1} className="absolute inset-0 z-0">
            <ScannerScreen onDashboard={() => navigateTo("dashboard")} />
          </ShellScreenTransition>
        )}

        {view === "dashboard" && (
          <ShellScreenTransition key="dashboard" direction={1} skipEntrance={firstRoute.current && !!(window as any).AndroidBridge?.onUiReady} className="absolute inset-0 z-10">
            <DashboardScreen
              onLaunch={() => navigateTo("controller")}
              onBack={() => navigateTo("scanner")}
              onLaunchEditor={openEditor}
              realTelemetry={realTelemetry}
              selectedPresetId={selectedPresetId} onSelectPreset={setSelectedPresetId}
              customPads={customPads} onSaveCustomPad={saveCustomPad} onDeleteCustomPad={deleteCustomPad}
              onDuplicateCustomPad={duplicateCustomPad}
              presetOverrides={presetOverrides}
              onSavePresetOverride={savePresetOverride}
              onResetPreset={resetPreset}
              posOverrides={posOverrides}
              onSavePosOverride={savePosOverride}
              onResetPosOverride={resetPosOverride}
              gyroOn={gyroOn} setGyroOn={setGyroOn}
              gyroMaxAngle={gyroMaxAngle} setGyroMaxAngle={setGyroMaxAngle}
              gyroWheel={gyroWheel} setGyroWheel={setGyroWheel}
              gyroWheelRange={gyroWheelRange} setGyroWheelRange={setGyroWheelRange}
              gyroMode={gyroMode} setGyroMode={setGyroMode}
              gyroDeadzone={gyroDeadzone} setGyroDeadzone={setGyroDeadzone}
              gyroHaptic={gyroHaptic} setGyroHaptic={setGyroHaptic}
              gyroThrottle={gyroThrottle} setGyroThrottle={setGyroThrottle}
              gyroIdleDetect={gyroIdleDetect} setGyroIdleDetect={setGyroIdleDetect}
              rumbleOn={rumbleOn} setRumbleOn={setRumbleOn}
            />
          </ShellScreenTransition>
        )}

        {view === "controller" && (
          <motion.div
            key="controller"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
            className="absolute inset-0 z-20"
          >
            <ControllerScreen
              onBack={() => navigateTo("dashboard")}
              isActive={view === "controller"}
              activeMapping={activeMapping}
              customPad={activeCustomPad}
              controllerLayout={activeCustomPad ? "standard" : controllerLayout}
              posOverride={posOverrides[selectedPresetId]}
              gyroOn={gyroOn} setGyroOn={setGyroOn}
              gyroMaxAngle={gyroEffectiveAngle}
              gyroWheel={gyroWheel}
              gyroMode={gyroMode}
              gyroDeadzone={gyroDeadzone}
              gyroHaptic={gyroHaptic}
              gyroThrottle={gyroThrottle}
              gyroIdleDetect={gyroIdleDetect}
              rumbleOn={rumbleOn}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom-pad editor — rendered at the ROOT (above every view) so its
          position:fixed surface anchors to the viewport, not a transformed
          tab container. Opens with the same scale+fade as the controller. */}
      <AnimatePresence>
        {editingPad && (
          <CustomPadEditor
            key="editor"
            pad={editingPad}
            onSave={(p) => {
              // A pad with zero widgets is useless — saving one deletes it
              // instead (covers "created a blank layout, added nothing").
              justSavedPadRef.current = true;
              if (p.buttons.length === 0) deleteCustomPad(p.padId);
              else saveCustomPad(p);
              closeEditor();
            }}
            onCancel={() => {
              // "Save & Quit" runs onSave and then the editor's close handler,
              // which IS this one. Without this guard the pad that was just
              // saved gets deleted a moment later, because `editingPad` is the
              // snapshot from when the editor opened — and a fresh Blank Canvas
              // is empty in that snapshot no matter what was added since. That
              // is why a blank layout you edited vanished from the dashboard.
              if (justSavedPadRef.current) {
                justSavedPadRef.current = false;
                closeEditor();
                return;
              }
              // Same rule on discard: if the pad was ALREADY empty when the
              // editor opened (fresh Blank Canvas abandoned untouched), drop it.
              if (editingPad && (editingPad.buttons || []).length === 0) deleteCustomPad(editingPad.padId);
              closeEditor();
            }}
          />
        )}
      </AnimatePresence>

      {/* Feature-introduction / rating overlay (#3). Guarded by `!rated` so
          once a rating is submitted, the entire component unmounts — disposing
          every timer, state, callback, and listener it owns. The overlay uses
          createPortal, so it renders at the body level above everything. */}
      {!rated && (
        <FeatureIntroOverlay
          open={showIntro}
          onClose={() => setShowIntro(false)}
          onRated={() => { setRated(true); setShowIntro(false); }}
          now={() => Date.now()}
        />
      )}
    </div>
  );
}
