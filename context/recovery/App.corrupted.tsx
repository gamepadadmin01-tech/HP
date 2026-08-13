import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
// @ts-ignore - Ignore missing declaration file error
import { createPortal } from "react-dom";
import { Home, Usb, Activity, Gamepad2, QrCode, X, Settings, Sparkles } from "lucide-react";
import { TuningDialog, CreditsDialog, LockoutOverlay, QRScanOverlay } from "./components/Dialogs";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────
import { View, BtnId, DashTab, PollingHz, GamepadPreset, CustomPad, CustomBtnDef, WidgetType, WidgetShape, WidgetAnchor, BtnPosOverride, PosOverrideMap } from "./types";
import { CustomPadEditor } from "./components/CustomPadEditor";

const GAMEPAD_PRESETS: GamepadPreset[] = [
  { id:"xbox", name:"Standard Controller", genre:"Full-size wireless controller layout", color:"#2563eb", icon:"🟢",
    // Display real controller button names, not game-action nicknames.
    mapping:{ A:"A",B:"B",X:"X",Y:"Y",LT:"LT",RT:"RT",LB:"LB",RB:"RB",up:"↑",down:"↓",left:"←",right:"→",lstick:"L3",rstick:"R3" } },
];

// ─── Custom pad helpers ──────────────────────────────────────────────────────────────────────────────────
const CUSTOM_COLORS = ["#6366f1", "#e11d48", "#d97706", "#22c55e", "#a855f7", "#3b82f6"];
const mkUid = () => `cb${Math.random().toString(36).slice(2, 14)}`;

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
  const NORM = "rgba(0, 212, 255, 0.12)";
  const HELD = "rgba(0, 212, 255, 0.85)";
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

// Saved pads from versions <= 1.3.7 may still contain the legacy "ltrt" compound
// widget (LT+RT fused as one unit). Split it into two independent "trigger"
// widgets with the exact same on-screen footprint (pill w=r, h=r*5.85, r*0.13
// centre gap) so old layouts look identical but each trigger now selects,
// moves and resizes on its own in the editor.
function splitLegacyLtrt(pads: CustomPad[]): CustomPad[] {
  return pads.map((p) => ({
    ...p,
    buttons: (p.buttons || []).flatMap((b) => {
      if ((b.type as string) !== "ltrt") return [b];
      const pillW = b.r, pillH = b.r * 5.85, gap = b.r * 0.13;
      const mk = (label: string, cx: number): CustomBtnDef => ({
        ...b, uid: mkUid(), type: "trigger", shape: "rect", label,
        x: cx, w: pillW, h: pillH, macroBits: [],
      });
      return [
        mk("LT", b.x - gap / 2 - pillW / 2),
        mk("RT", b.x + gap / 2 + pillW / 2),
      ];
    }),
  }));
}

function makeDefaultPad(padId: string, templateKey: string = "standard", name?: string): CustomPad {
  const norm = "#14143a";
  const held = "#3a3a9e";
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

// ─── Transition constants ─────────────────────────────────────────────────────
const SCREEN_EASE = "cubic-bezier(0.4,0,0.2,1)";
const SCREEN_DUR  = "380ms";

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
  // Fallbacks (older shell / browser): scale the oneshot duration by tier.
  const ms = strength <= 30 ? 9 : strength <= 65 ? 16 : 26;
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
  if (type === "trigger") return 85;                                                  // heavy pull
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
  LT: 85, RT: 85,                        // triggers — heavy pull
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

  const onDown = useCallback((e: React.PointerEvent, cx: number, cy: number) => {
    if (pid.current !== null) return;   // already owned by another finger — ignore
    pid.current = e.pointerId;
    active.current = true;
    centerRef.current = { x: cx, y: cy };
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

// Returns real round-trip latency (ms) from the native bridge, or null when
// there's no bridge (desktop browser) — callers render "—" instead of a fake
// number. Previously this emitted random 2–12ms which was misleading.
function useLatency(): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || !bridge.getNetworkTelemetryJson) return;
    const id = setInterval(() => {
      try {
        const stats = JSON.parse(bridge.getNetworkTelemetryJson());
        if (typeof stats.latency === "number") setMs(stats.latency);
      } catch (e) {}
    }, 500);
    return () => clearInterval(id);
  }, []);

    return (
    <div className="space-y-4">
      <SectionDivider>About</SectionDivider>
      <Card className="p-4 bg-black/40 border-border/40 space-y-2">
        <div className="flex items-center gap-2">
          <Gamepad2 size={16} className="text-primary" />
          <span className="text-sm font-bold text-primary tracking-widest" style={{ fontFamily: "'Oxanium',sans-serif" }}>GamepadOS</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Turn your phone into a low-latency wireless (or USB) controller for your PC. Scan the PC server QR over Wi-Fi, or use USB tethering for a wired-quality link.
        </p>
      </Card>
      <UpdateChecker />
      <FeedbackCard />
      <Card className="p-4 bg-black/40 border-border/40 space-y-2">
        <SLabel>Performance</SLabel>
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/15">
          <span className="text-primary text-xs">⚡</span>
          <span className="text-[11px] text-primary font-mono font-semibold">Engine locked at 1000 Hz · ultra-low latency</span>
        </div>
      </Card>
    </div>
  );
}

// ─── In-app feedback ──────────────────────────────────────────────────────────
// Sends a message straight into the team's admin portal, tagged source="mobile".
const FEEDBACK_URL = "https://supportportal.gamepad.space/api/support/ticket";
const CONTACT_URL = "https://gamepad.space/contact.html";
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
      if (res.ok) setState("ok");
      else { setState("err"); setErr("Server error — please try again."); }
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
      <Card className="p-4 bg-black/40 border-border/40 space-y-3">
        <SLabel>Feedback &amp; Support</SLabel>
        <p className="text-[11px] text-muted-foreground leading-relaxed">Found a bug or have an idea? Send us a message — we read every one and reply by email.</p>
        <div className="flex gap-2">
          <button onClick={openTray}
            className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold active:scale-95 transition-transform"
            style={{ background: "rgba(0,212,255,0.15)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.35)" }}>
            Submit feedback
          </button>
          <button onClick={() => openExternal(CONTACT_URL)}
            className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold active:scale-95 transition-transform"
            style={{ background: "transparent", color: "rgba(255,255,255,0.72)", border: "1px solid rgba(255,255,255,0.14)" }}>
            Contact us
          </button>
        </div>
      </Card>

      {/* Slide-up feedback tray (bottom sheet) */}
      <div
        onClick={closeTray}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.6)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.22s ease",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 520,
            background: "#0a0e1a",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "20px 20px 0 0",
            padding: "12px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
            transform: open ? "translateY(0)" : "translateY(100%)",
            transition: "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
            maxHeight: "88vh", overflowY: "auto",
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)", margin: "2px auto 14px" }} />
          {state === "ok" ? (
            <div className="py-6 text-center space-y-2">
              <p className="text-[15px] font-semibold text-emerald-400">Thanks! Your feedback was sent ✓</p>
              <p className="text-[12px] text-muted-foreground">We'll reply to your email if it needs a response.</p>
              <button onClick={closeTray} className="mt-2 px-5 py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: "rgba(0,212,255,0.15)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.35)" }}>Done</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-bold text-foreground">Send feedback</p>
                <button onClick={closeTray} aria-label="Close" className="text-muted-foreground text-lg leading-none px-2 py-1">✕</button>
              </div>
              <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email"
                className="w-full text-[14px] rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Tell us what's on your mind…"
                className="w-full text-[14px] rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-primary/50" />
              {/* Live hint so the send button is never a mysterious "dead" button. */}
              <div className="flex items-center justify-between text-[11px]">
                <span className={msgLen >= 10 ? "text-muted-foreground" : "text-amber-400"}>
                  {msgLen === 0 ? "Write at least 10 characters" : msgLen < 10 ? `${10 - msgLen} more character${10 - msgLen === 1 ? "" : "s"}` : "Message looks good"}
                </span>
                {email.length > 0 && !emailOk && <span className="text-amber-400">Enter a valid email</span>}
              </div>
              {state === "err" && <p className="text-[12px] text-red-400">{err}</p>}
              <button disabled={!valid || state === "sending"} onClick={submit}
                className="w-full py-3 rounded-lg text-[14px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={{
                  background: valid ? "rgba(0,212,255,0.18)" : "rgba(255,255,255,0.04)",
                  color: valid ? "#00d4ff" : "rgba(255,255,255,0.4)",
                  border: `1px solid ${valid ? "rgba(0,212,255,0.4)" : "rgba(255,255,255,0.08)"}`,
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
  const [info, setInfo] = useState<{ version?: string; url?: string; notes?: string; sha256?: string }>({});
  // In-app download/install progress (null = not updating).
  const [dl, setDl] = useState<{ pct: number; phase: string; msg: string } | null>(null);

  const check = useCallback(() => {
    setState("checking");
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
      .then(r => r.json())
      .then(d => {
        const a = (d && d.android) || {};
        if (typeof a.versionCode === "number" && a.versionCode > installed.code) {
          setInfo({ version: a.version, url: a.url, notes: a.notes, sha256: a.sha256 });
          setState("available");
        } else setState("latest");
      })
      .catch(() => setState("error"));
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
      <div className="mb-3 rounded-xl p-3 flex items-center justify-between gap-3"
        style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)" }}>
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground">Update available{info.version ? ` · v${info.version}` : ""}</p>
          {info.notes && <p className="text-[10px] text-muted-foreground truncate">{info.notes}</p>}
        </div>
        {busy ? (
          <span className="flex-shrink-0 text-[11px] font-bold" style={{ color: "#00d4ff" }}>{dlText}</span>
        ) : (
          <button onClick={download}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
            style={{ background: "rgba(0,212,255,0.18)", border: "1px solid rgba(0,212,255,0.4)", color: "#00d4ff" }}>
            {dl ? "Retry" : "Update"}
          </button>
        )}
      </div>
    );
  }

  // Full card (About tab): version + status + manual check / download.
  return (
    <Card className="p-4 bg-black/40 border-border/40 space-y-2">
      <SLabel>App version</SLabel>
      <p className="text-[11px] font-mono text-muted-foreground/70">Version {installed.name} · Free</p>
      {state === "available" ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "#00d4ff" }}>Update available{info.version ? `: v${info.version}` : ""}</p>
          {info.notes && <p className="text-[11px] text-muted-foreground leading-relaxed">{info.notes}</p>}
          {busy ? (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                <div className="h-full transition-all" style={{ width: `${Math.max(3, dl?.pct ?? 0)}%`, background: "#00d4ff" }} />
              </div>
              <p className="text-[11px]" style={{ color: "#00d4ff" }}>{dlText}</p>
            </div>
          ) : (
            <>
              {dl && (dl.phase === "error" || dl.phase === "permission") && (
                <p className="text-[11px]" style={{ color: dl.phase === "error" ? "#ff6b6b" : "#00d4ff" }}>{dl.msg}</p>
              )}
              <button onClick={download}
                className="w-full py-2 rounded-lg text-xs font-bold active:scale-95 transition-transform"
                style={{ background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.35)", color: "#00d4ff" }}>
                {dl ? "Retry update" : (canSelfUpdate ? "Download & install update" : getDistributionChannel() === "playstore" ? "Update via Google Play" : "Update via store")}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {state === "checking" ? "Checking for updates…" :
             state === "latest"   ? "You're on the latest version." :
                                    "Couldn't check right now."}
          </span>
          <button onClick={check} disabled={state === "checking"}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold active:scale-95 transition-transform"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", opacity: state === "checking" ? 0.6 : 1 }}>
            Check for updates
          </button>
        </div>
      )}
    </Card>
  );
}

// ─── Connection & latency diagnostics (#2) ────────────────────────────────────
// Surfaces the Wi-Fi band/link (2.4 vs 5 GHz is the #1 cause of latency gaps
// between phones) and a one-tap battery-optimization exemption (the fix for
// MIUI/HyperOS Wi-Fi radio throttling). Bridge-only; hidden in the browser.
function LatencyCard() {
  const [wifi, setWifi] = useState<{ band: string; freq: number; linkSpeed: number; rssi: number } | null>(null);
  const [optimized, setOptimized] = useState(false);
  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (!bridge || !bridge.getWifiInfoJson) return;
    const poll = () => {
      try { setWifi(JSON.parse(bridge.getWifiInfoJson())); } catch {}
      try { if (bridge.isBatteryOptimized) setOptimized(!!bridge.isBatteryOptimized()); } catch {}
    };
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, []);
  if (!wifi) return null;
  const slow = wifi.band === "2.4 GHz";
  const bandColor = (wifi.band.startsWith("5") || wifi.band.startsWith("6")) ? "#22c55e"
                    : slow ? "#f59e0b" : "rgba(255,255,255,0.5)";
  const fix = () => { try { (window as any).AndroidBridge?.requestBatteryExemption?.(); } catch {} };
  return (
    <>
      <SectionDivider>Connection &amp; latency</SectionDivider>
      <Card className="p-4 bg-black/40 border-border/40 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Band</p>
            <p className="text-sm font-bold" style={{ color: bandColor }}>{wifi.band}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Link</p>
            <p className="text-sm font-bold text-foreground">{wifi.linkSpeed > 0 ? `${wifi.linkSpeed} Mbps` : "—"}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Signal</p>
            <p className="text-sm font-bold text-foreground">{wifi.rssi < 0 ? `${wifi.rssi} dBm` : "—"}</p>
          </div>
        </div>
        {slow && (
          <p className="text-[11px] leading-relaxed" style={{ color: "#f59e0b" }}>
            You're on 2.4 GHz — switching to your router's 5 GHz network gives noticeably lower latency.
          </p>
        )}
        {optimized && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Battery optimization can throttle the Wi-Fi radio and add latency. Allow unrestricted background activity for the smoothest, most consistent input.
            </p>
            <button onClick={fix}
              className="w-full py-2 rounded-lg text-xs font-bold active:scale-95 transition-transform"
              style={{ background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.35)", color: "#00d4ff" }}>
              Optimize for low latency
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Bottom nav (3 tabs) ──────────────────────────────────────────────────────
const TABS: { id: DashTab; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "home",   label: "Home",   Icon: Home },
  { id: "system", label: "System", Icon: Activity },
  { id: "session", label: "Advanced", Icon: Sparkles },
];

// ─── Dashboard Screen ─────────────────────────────────────────────────────────
function DashboardScreen({
  onLaunch, onBack, onLaunchEditor, realTelemetry, premium, setPremium, credits, setCredits, selectedPresetId, onSelectPreset, customPads, onSaveCustomPad, onDeleteCustomPad, onDuplicateCustomPad, presetOverrides, onSavePresetOverride, onResetPreset,
  posOverrides, onSavePosOverride, onResetPosOverride,
  gyroOn, setGyroOn,
  gyroMaxAngle, setGyroMaxAngle,
  gyroMode, setGyroMode,
  gyroDeadzone, setGyroDeadzone,
  gyroHaptic, setGyroHaptic,
  gyroThrottle, setGyroThrottle,
  rumbleOn, setRumbleOn,
  rumbleIntensity, setRumbleIntensity
}: {
  onLaunch: () => void; onBack: () => void; onLaunchEditor?: (pad: CustomPad) => void; pendingEditPad?: CustomPad | null; onClearPendingEditPad?: () => void; realTelemetry: any;
  premium: boolean; setPremium: (v: boolean) => void;
  credits: number; setCredits: (fn: (c: number) => number) => void;
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
  gyroMode: string; setGyroMode: (v: string) => void;
  gyroDeadzone: number; setGyroDeadzone: (v: number) => void;
  gyroHaptic: boolean; setGyroHaptic: (v: boolean) => void;
  gyroThrottle: boolean; setGyroThrottle: (v: boolean) => void;
  rumbleOn: boolean; setRumbleOn: (v: boolean) => void;
  rumbleIntensity: number; setRumbleIntensity: (v: number) => void;
}) {
  const [tab, setTab] = useState<DashTab>("home");
  const [slideClass, setSlideClass] = useState("tab-r");
  const prevIdxRef = useRef(0);

  // ── Blueprint dialog state (hoisted here so dialog renders outside scrollable area) ──
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false);
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
    { key: "standard", name: "Standard",   desc: "Full-size wireless controller layout.",       icon: "🟢", color: "from-[#2563eb]/30 to-[#2563eb]/10" },
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
    if (newTab === tab) return;
    const newIdx = TABS.findIndex(t => t.id === newTab);
    setSlideClass(newIdx > prevIdxRef.current ? "tab-r" : "tab-l");
    prevIdxRef.current = newIdx;
    setTab(newTab);
  }

  // Register a global hook so handleAndroidBack (App level) can close our dialog
  // instead of navigating to scanner when the Android back gesture fires during keyboard use.
  useEffect(() => {
    (window as any).__dashboardCloseDialog = () => {
      if (showBlueprintDialog) {
        closeBlueprintDialog();
        return true; // handled
      }
      return false; // nothing open, let back navigate normally
    };
    return () => {
      delete (window as any).__dashboardCloseDialog;
    };
  }, [showBlueprintDialog]);


  return (
    <div className="flex flex-col h-full bg-background" style={{ fontFamily: "'Inter',sans-serif" }}>
      <style>{`
        @keyframes tabR { from{transform:translate3d(24px,0,0);opacity:0} to{transform:translate3d(0,0,0);opacity:1} }
        @keyframes tabL { from{transform:translate3d(-24px,0,0);opacity:0} to{transform:translate3d(0,0,0);opacity:1} }
        /* expo-out easing → fast start, gentle settle = "buttery". GPU-composited. */
        .tab-r{animation:tabR 340ms cubic-bezier(0.16,1,0.3,1);will-change:transform,opacity;backface-visibility:hidden}
        .tab-l{animation:tabL 340ms cubic-bezier(0.16,1,0.3,1);will-change:transform,opacity;backface-visibility:hidden}
      `}</style>

      <header className="flex-shrink-0 flex items-center justify-between px-4 pb-3 border-b border-border bg-[#09101a]"
        style={{ paddingTop: "calc(var(--android-safe-top, env(safe-area-inset-top, 36px)) + 12px)" }}>
        <div className="flex items-center gap-2">
          <Gamepad2 size={14} className="text-primary" />
          <span className="text-sm font-bold text-primary tracking-widest uppercase"
            style={{ fontFamily: "'Oxanium',sans-serif" }}>GamepadOS</span>
        </div>
        <div className="flex flex-col items-end opacity-90 pointer-events-none">
          {(() => {
            const connected = !!(realTelemetry && realTelemetry.linkAlive);
            const type = realTelemetry?.connectionType; // "usbdebug" | "wired"(tether) | "wireless" | "none"
            const isWired = type === "wired" || type === "usbdebug";
            const label = type === "usbdebug" ? "🔌 USB DEBUG" : type === "wired" ? "⟠ USB TETHER" : "⌘ WIRELESS";
            const dot = connected ? "bg-emerald-400 animate-pulse" : "bg-red-500";
            const glow = connected ? "0 0 6px rgba(52,211,153,0.8)" : "0 0 6px rgba(239,68,68,0.8)";
            return (
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${dot}`} style={{ boxShadow: glow }} />
                <span className="text-[9px] font-bold tracking-widest text-white drop-shadow-md">
                  {connected ? "CONNECTED" : "DISCONNECTED"}
                </span>
                {connected && (type === "usbdebug" || type === "wired" || type === "wireless") && (
                  <span className="text-[8px] font-bold tracking-wider px-1.5 py-[1px] rounded-full"
                    style={{
                      color: isWired ? "#fbbf24" : "#00d4ff",
                      background: isWired ? "rgba(251,191,36,0.12)" : "rgba(0,212,255,0.12)",
                      border: `1px solid ${isWired ? "rgba(251,191,36,0.35)" : "rgba(0,212,255,0.35)"}`,
                    }}>
                    {label}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 max-w-lg mx-auto">
          <UpdateChecker compact />
          <div key={tab} className={slideClass}>
            {tab === "home"   && <TabHome onLaunch={onLaunch} onConnect={onBack}
              onLaunchEditor={onLaunchEditor}
              selectedPresetId={selectedPresetId} onSelectPreset={onSelectPreset}
              customPads={customPads} onSaveCustomPad={onSaveCustomPad} onDeleteCustomPad={onDeleteCustomPad}
              onDuplicateCustomPad={onDuplicateCustomPad}
              presetOverrides={presetOverrides} onSavePresetOverride={onSavePresetOverride} onResetPreset={onResetPreset}
              posOverrides={posOverrides} onSavePosOverride={onSavePosOverride} onResetPosOverride={onResetPosOverride}
              onNewLayout={openBlueprintDialog}
              pendingEditPad={pendingEditPad}
              onClearPendingEditPad={() => setPendingEditPad(null)} />}
            {tab === "system" && <TabSystem gyroOn={gyroOn} setGyroOn={setGyroOn} gyroMaxAngle={gyroMaxAngle} setGyroMaxAngle={setGyroMaxAngle} gyroMode={gyroMode} setGyroMode={setGyroMode} gyroDeadzone={gyroDeadzone} setGyroDeadzone={setGyroDeadzone} gyroHaptic={gyroHaptic} setGyroHaptic={setGyroHaptic} gyroThrottle={gyroThrottle} setGyroThrottle={setGyroThrottle} rumbleOn={rumbleOn} setRumbleOn={setRumbleOn} rumbleIntensity={rumbleIntensity} setRumbleIntensity={setRumbleIntensity} />}
            {tab === "session" && (
              <TabSession
                credits={credits}
                setCredits={setCredits}
                premium={premium}
                setPremium={setPremium}
                gyroOn={gyroOn}
              />
            )}
          </div>
        </div>
      </main>

      <nav className="flex-shrink-0 flex border-t border-border bg-[#0a0e1a]"
        style={{ paddingBottom: "var(--android-safe-bottom, env(safe-area-inset-bottom, 0px))" }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => changeTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors duration-150"
              style={{ minHeight: "58px" }}>
              <div className={`flex items-center justify-center rounded-2xl transition-all duration-200 ${active ? "bg-primary/12 px-5 py-1" : "px-3 py-1"}`}>
                <Icon size={20} className={active ? "text-primary" : "text-muted-foreground"} />
              </div>
              <span className={`text-[10px] font-semibold transition-colors duration-150 ${active ? "text-primary" : "text-muted-foreground"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Blueprint dialog — Portal into document.body so it's completely immune to
          parent transforms, stacking contexts, and keyboard-triggered event bugs */}
      {createPortal(
        <AnimatePresence>
          {showBlueprintDialog && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
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
              <motion.div
                initial={{ scale: 0.92, y: 10, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.96, y: 8, opacity: 0 }}
                transition={{ type: "spring", damping: 24, stiffness: 350 }}
                style={{
                  width: "100%", maxWidth: "384px", borderRadius: "24px",
                  background: "#05070f", border: "1px solid rgba(255,255,255,0.09)",
                  maxHeight: "85vh", overflow: "hidden",
                  boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
                }}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onTouchEnd={e => e.stopPropagation()}
              >
            <AnimatePresence mode="wait">
              {createStep === "type" ? (
                <motion.div
                  key="type"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <h3 className="text-lg font-black text-white tracking-tight">Choose Type</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">How would you like to start?</p>
                    </div>
                    <button
                      onClick={closeBlueprintDialog}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground active:scale-90 transition-all mt-0.5"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
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
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800/30 to-zinc-700/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        ✦
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-tight">Blank Canvas</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Start completely empty and build widget by widget.</p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setCreateStep("template");
                      }}
                      className="text-left p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform duration-100"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600/30 to-indigo-600/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        🎮
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-tight">Standard Layouts</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Choose from a variety of pre-configured gamepads.</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setImportError(""); setImportCode(""); setCreateStep("import"); }}
                      className="text-left p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform duration-100"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600/30 to-teal-600/30 border border-white/10 flex items-center justify-center text-2xl flex-shrink-0">
                        ⤓
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-tight">Import from Code</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Got a share code? Paste it to load someone's controller.</p>
                      </div>
                    </button>
                  </div>
                </motion.div>
              ) : createStep === "import" ? (
                <motion.div
                  key="import"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep("type")}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-lg font-black text-white tracking-tight">Import from Code</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Paste the code someone shared with you</p>
                    </div>
                  </div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 block">Share Code</label>
                  <input
                    value={importCode}
                    onChange={e => { setImportCode(e.target.value.toUpperCase()); setImportError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") importByCode(); }}
                    placeholder="e.g. K7M2QP"
                    maxLength={12}
                    autoCapitalize="characters"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-center text-lg font-mono tracking-[0.3em] outline-none focus:border-primary/60 uppercase"
                  />
                  {importError && (
                    <p className="text-[11px] text-red-400 mt-2 leading-snug">{importError}</p>
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
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.15 }}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep("type")}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-lg font-black text-white tracking-tight">Choose Template</h3>
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
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${bp.color} border border-white/10 flex items-center justify-center text-2xl flex-shrink-0`}>
                          {bp.icon}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white leading-tight">{bp.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{bp.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.15 }}
                  className="p-5 pb-8 overflow-y-auto" style={{ maxHeight: "85vh" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => setCreateStep(selectedTemplate === "blank" ? "type" : "template")}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-white/60 active:scale-90 transition-all text-sm font-bold flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      ←
                    </button>
                    <div>
                      <h3 className="text-base font-black text-white tracking-tight">Name Your Pad</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Customize before building</p>
                    </div>
                  </div>

                  <div className="mb-5">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 block">Layout Name</label>
                    <input
                      ref={nameInputRef}
                      value={newPadName}
                      onChange={e => setNewPadName(e.target.value)}
                      maxLength={24}
                      onKeyDown={e => { if (e.key === "Enter") commitNewPad(); }}
                      className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none transition-colors"
                      style={{ background: "rgba(255,255,255,0.05)", border: `1.5px solid ${newPadName ? newPadColor + "80" : "rgba(255,255,255,0.1)"}`, caretColor: newPadColor }}
                      placeholder="My Custom Layout"
                    />
                  </div>


                  <div className="mb-7">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 block">Accent Color</label>
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
                    className="w-full py-3.5 rounded-2xl text-sm font-black tracking-widest transition-all duration-150 active:scale-95"
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
  const [rumbleOn, setRumbleOn] = useState(true);
  const [rumbleIntensity, setRumbleIntensity] = useState(100);
  const realTelemetry = useNetworkTelemetry(true);

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
      curtainTimers.current.push(setTimeout(finish, 350));   // lift after rotation completes
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

  // ── Global USB auto-pair ──────────────────────────────────────────────────
  // The native layer continuously watches the USB-tether interface and calls
  // this on any change. Handles every ordering (server-first, app-first,
  // plugged-in-later, replug) for the Play Store release. We only auto-connect
  // when USB becomes active AND we're not already connected — so it never
  // fights an existing Wi-Fi/QR session or double-starts the engine.
  const [usbToast, setUsbToast] = useState(false);
  useEffect(() => {
    (window as any).onUsbTetherChanged = (active: boolean) => {
      if (!active) return;
      // If the user forced USB-debugging, don't auto-start the native tether engine
      // (that would create a second pad — the transport coordinator owns the WS).
      if (getWiredPref() === "usbdebug") return;
      const bridge = (window as any).AndroidBridge;
      if (!bridge || !bridge.connectToPC) return;
      // Skip if a link is genuinely alive (PC responding) — don't disrupt it.
      try {
        const t = JSON.parse(bridge.getNetworkTelemetryJson?.() || "{}");
        if (t.linkAlive) return;
      } catch {}
      // Auto-connect over USB. CRITICAL: target the USB interface's DIRECTED
      // broadcast (e.g. 192.168.42.255), not 255.255.255.255 — a limited
      // broadcast only egresses the default route (Wi-Fi) and never reaches the
      // PC over USB. Fall back to limited broadcast only if we can't read it.
      let usbBcast = "255.255.255.255";
      try { usbBcast = bridge.getUsbBroadcastAddress?.() || "255.255.255.255"; } catch {}
      bridge.connectToPC(usbBcast, 7777, "usb");
      setUsbToast(true);
      setTimeout(() => setUsbToast(false), 2600);

      // If the PC server isn't running yet (USB plugged but server not open),
      // no packets will flow. Verify; if it doesn't confirm within 6s, stop the
      // engine so the watcher can cleanly auto-retry once the server appears.
      let tries = 0;
      const verify = setInterval(() => {
        tries++;
        try {
          const t = JSON.parse(bridge.getNetworkTelemetryJson?.() || "{}");
          if (t.linkAlive) { clearInterval(verify); return; } // PC responded → confirmed
        } catch {}
        if (tries >= 24) { // ~6s
          clearInterval(verify);
          // Server not up yet — stop the engine cleanly (resets the transition
          // guard so future connects aren't blocked). The native watcher keeps
          // nudging while USB stays plugged and the engine is off, so this
          // auto-retries cleanly once the PC server starts.
          try { (bridge.stopEngine ? bridge.stopEngine() : bridge.stopNetworkNative?.()); } catch {}
        }
      }, 250);
    };
    return () => { delete (window as any).onUsbTetherChanged; };
  }, []);

  // ── Transport coordinator: exactly ONE transport live at a time ─────────────
  // Fixes the "device connects twice" double-pad and makes USB-tethering usable.
  // The PC allocates a virtual pad for EVERY open WebSocket and for every UDP
  // source, so we must never have the USB-debug WS open at the same time as a
  // native (Wi-Fi/tether) link. Reconciles every 1.5s based on the wired pref:
  //   usbdebug → force WS on + stop the native engine
  //   tether   → native only (never WS); initiate the tether connect if needed
  //   auto     → native (Wi-Fi or tether) wins; WS only as a last-resort fallback
  useEffect(() => {
    let lastConnectAttempt = 0;
    const reconcile = () => {
      const bridge = (window as any).AndroidBridge;
      const w = (window as any).__usbWS;
      if (!w) return;
      const pref = getWiredPref();
      let nativeLink = false, ctype = "", engineRunning = false;
      try {
        const t = JSON.parse(bridge?.getNetworkTelemetryJson?.() || "{}");
        nativeLink = !!t.linkAlive; ctype = t.connectionType || "";
        // engineRunning = native UDP TX thread is alive REGARDLESS of ACKs. This is
        // the true "a native socket already owns a pad" signal; linkAlive can be false
        // during an ACK gap while the engine is still blasting UDP, so gating the WS on
        // linkAlive would let a second virtual pad open. Use engineRunning below.
        engineRunning = !!t.engineRunning;
      } catch {}
      let usbBcast = "", tetherAvail = false;
      try {
        const b = bridge?.getUsbBroadcastAddress?.();
        if (b && b !== "255.255.255.255") { usbBcast = b; tetherAvail = true; }
      } catch {}
      const now = Date.now();

      // WIRELESS PROTECTION: a Wi-Fi (QR/manual) link uses the native engine just
      // like tether does. If one is live — or was just requested (the 8s window
      // covers the initial connect before the first ACK sets linkAlive) — never let
      // a forced wired pref stopEngine() it, and keep the USB-debug WS closed so the
      // phone can't register as a second pad. This is what lets the user keep an
      // explicit Wired-mode selection without it clobbering a fresh wireless connect.
      const wirelessIntentAt = (window as any).__wirelessIntentAt || 0;
      const wirelessLive = nativeLink && ctype === "wireless";
      if (wirelessLive || (now - wirelessIntentAt < 8000)) {
        if (w.isOpen()) w.disconnect();
        return;
      }

      if (pref === "usbdebug") {
        // Force USB-debugging: WS on, native engine off (no phantom UDP pad).
        // Stop whenever the engine is RUNNING (not merely linkAlive) so a native
        // socket can never coexist with the WS during an ACK gap.
        if (engineRunning) { try { bridge?.stopEngine?.(); } catch {} }
        w.connect();
      } else if (pref === "tether") {
        // Force USB-tethering: native only, never the WS.
        if (w.isOpen()) w.disconnect();
        const onTether = nativeLink && ctype === "wired";
        if (!onTether && tetherAvail && now - lastConnectAttempt > 4000) {
          lastConnectAttempt = now;
          try { bridge?.connectToPC?.(usbBcast, 7777, "usb"); } catch {}
        }
      } else {
        // auto: native (Wi-Fi or tether) wins; WS only when there's no native path.
        // "native path exists" = the engine is running (covers the ACK-gap window)
        // or a tether adapter is present — NOT linkAlive, which misses a running-but-
        // unACKed engine and would let the WS open a second pad.
        if (engineRunning || tetherAvail) { if (w.isOpen()) w.disconnect(); }
        else { w.connect(); }
      }
    };
    const id = setInterval(reconcile, 1500);
    reconcile();
    return () => clearInterval(id);
  }, []);

  function navigateTo(target: View) {
    if ((view === "dashboard" && target === "controller") || (view === "controller" && target === "dashboard")) {
      runCurtainSequence(() => {
        const bridge = (window as any).AndroidBridge;
        if (bridge && bridge.setScreenOrientation) {
          try {
            bridge.setScreenOrientation(target === "controller" ? "landscape" : "portrait");
          } catch (e) { console.error(e); }
        }
        setView(target);
        viewRef.current = target;
      });
    } else {
      setView(target);
      viewRef.current = target;
      const bridge = (window as any).AndroidBridge;
      if (bridge && bridge.setScreenOrientation) {
        try {
          bridge.setScreenOrientation(target === "controller" ? "landscape" : "portrait");
        } catch (e) {}
      }
    }
  }

  const [premium, setPremium] = useState(false);
  const [credits, setCredits] = useState(35 * 60);
  const [selectedPresetId, setSelectedPresetId] = useState("xbox");
  const [editingPad, setEditingPad] = useState<CustomPad | null>(null);

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
      try { bridge?.setScreenOrientation?.(viewRef.current === "controller" ? "landscape" : "portrait"); } catch (e) {}
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

  const [customPads, setCustomPads] = useState<CustomPad[]>(() => {
    try {
      const saved = localStorage.getItem("custom_pads");
      return saved ? splitLegacyLtrt(JSON.parse(saved)) : [];
    } catch (e) {
      return [];
    }
  });
  // Persisted like custom_pads — otherwise a user's saved preset button remaps and
  // dragged widget positions silently vanished on every app restart.
  const [presetOverrides, setPresetOverrides] = useState<Record<string, Partial<Record<BtnId, string>>>>(() => {
    try { const s = localStorage.getItem("preset_overrides"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [posOverrides, setPosOverrides] = useState<Record<string, PosOverrideMap>>(() => {
    try { const s = localStorage.getItem("pos_overrides"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });

  // Gyro settings persist across app restarts (saved to localStorage below).
  const [gyroOn, setGyroOn] = useState(() => {
    // Default ON; respects a saved choice if the user later turns it off.
    try { const v = localStorage.getItem("gyro_on"); return v === null ? true : v === "1"; } catch { return true; }
  });
  const [gyroMaxAngle, setGyroMaxAngle] = useState(() => {
    try { const v = localStorage.getItem("gyro_maxAngle"); return v ? Number(v) : 30; } catch { return 30; }
  });
  // Gyro mode: "racing" = 2D steering (left stick X, shows the tilt bar) | "3d" = 2-axis
  // look/aim (right stick X+Y, shows only a small "gyro active" chip). Persisted below.
  const [gyroMode, setGyroMode] = useState<string>(() => {
    try { return localStorage.getItem("gyro_mode") || "racing"; } catch { return "racing"; }
  });
  const [gyroDeadzone, setGyroDeadzone] = useState(() => {
    try { const v = localStorage.getItem("gyro_deadzone"); return v ? Number(v) : 0; } catch { return 0; }
  });
  const [gyroHaptic, setGyroHaptic] = useState(() => {
    try { const v = localStorage.getItem("gyro_haptic"); return v === null ? true : v === "1"; } catch { return true; }
  });
  // Racing tilt-throttle: OFF by default. When on, pitch (tilt forward/back) drives
  // the LEFT stick Y so you can accelerate/brake by tilting — 3D mode is unaffected.
  const [gyroThrottle, setGyroThrottle] = useState(() => {
    try { const v = localStorage.getItem("gyro_throttle"); return v === null ? false : v === "1"; } catch { return false; }
  });

  // Sync hapticsEnabled so standalone triggerHaptic() can see it
  useEffect(() => {
    (window as any).hapticsEnabled = gyroHaptic;
  }, [gyroHaptic]);

  // Persist gyro settings so the user's choice survives app restarts.
  useEffect(() => {
    try {
      localStorage.setItem("gyro_on", gyroOn ? "1" : "0");
      localStorage.setItem("gyro_maxAngle", String(gyroMaxAngle));
      localStorage.setItem("gyro_deadzone", String(gyroDeadzone));
      localStorage.setItem("gyro_haptic", gyroHaptic ? "1" : "0");
      localStorage.setItem("gyro_mode", gyroMode);
      localStorage.setItem("gyro_throttle", gyroThrottle ? "1" : "0");
    } catch {}
  }, [gyroOn, gyroMaxAngle, gyroDeadzone, gyroHaptic, gyroMode, gyroThrottle]);

  useEffect(() => {
    try {
      localStorage.setItem("custom_pads", JSON.stringify(customPads));
    } catch (e) {
      console.error("Failed to save custom pads to localStorage", e);
    }
  }, [customPads]);

  useEffect(() => {
    try { localStorage.setItem("preset_overrides", JSON.stringify(presetOverrides)); } catch {}
  }, [presetOverrides]);

  useEffect(() => {
    try { localStorage.setItem("pos_overrides", JSON.stringify(posOverrides)); } catch {}
  }, [posOverrides]);


  useEffect(() => {
    (window as any).handleAndroidBack = () => {
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
        navigateTo("scanner");
      } else {
        const bridge = (window as any).AndroidBridge;
        if (bridge && bridge.exitApp) {
          bridge.exitApp();
        }
      }
    };
    return () => {
      delete (window as any).handleAndroidBack;
    };
  }, []);


  useEffect(() => {
    if (view === "scanner") {
      const exitFn = (window as any).exitSession;
      if (exitFn) {
        exitFn();
      }
    }
  }, [view]);

  function saveCustomPad(p: CustomPad) {
    setCustomPads(prev => {
      const idx = prev.findIndex(x => x.padId === p.padId);
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next; }
      return [...prev, p];
    });
  }

  function deleteCustomPad(padId: string) {
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
            initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            transition={{ type: "spring", damping: 24, stiffness: 320 }}
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
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="absolute inset-0 z-50 bg-black flex items-center justify-center"
          >
            <Gamepad2 className="w-12 h-12 text-[#00ffcc]/30 animate-pulse" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {view === "scanner" && (
          <motion.div
            key="scanner"
            initial={{ opacity: 0, x: "-8%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "-8%" }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
            className="absolute inset-0 z-0"
          >
            <ScannerScreen onDashboard={() => navigateTo("dashboard")} />
          </motion.div>
        )}

        {view === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: "8%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "8%" }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
            className="absolute inset-0 z-10"
          >
            <DashboardScreen
              onLaunch={() => navigateTo("controller")}
              onBack={() => navigateTo("scanner")}
              onLaunchEditor={openEditor}
              realTelemetry={realTelemetry}
              premium={premium} setPremium={setPremium}
              credits={credits} setCredits={setCredits}
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
              gyroMode={gyroMode} setGyroMode={setGyroMode}
              gyroDeadzone={gyroDeadzone} setGyroDeadzone={setGyroDeadzone}
              gyroHaptic={gyroHaptic} setGyroHaptic={setGyroHaptic}
              gyroThrottle={gyroThrottle} setGyroThrottle={setGyroThrottle}
              rumbleOn={rumbleOn} setRumbleOn={setRumbleOn}
              rumbleIntensity={rumbleIntensity} setRumbleIntensity={setRumbleIntensity}
            />
          </motion.div>
        )}

        {view === "controller" && (
          <motion.div
            key="controller"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
            className="absolute inset-0 z-20"
          >
            <ControllerScreen
              onBack={() => navigateTo("dashboard")}
              isActive={view === "controller"}
              premium={premium} setPremium={setPremium}
              credits={credits} setCredits={setCredits}
              activeMapping={activeMapping}
              customPad={activeCustomPad}
              controllerLayout={activeCustomPad ? "standard" : controllerLayout}
              posOverride={posOverrides[selectedPresetId]}
              gyroOn={gyroOn} setGyroOn={setGyroOn}
              gyroMaxAngle={gyroMaxAngle}
              gyroMode={gyroMode}
              gyroDeadzone={gyroDeadzone}
              gyroHaptic={gyroHaptic}
              gyroThrottle={gyroThrottle}
              rumbleOn={rumbleOn}
              rumbleIntensity={rumbleIntensity}
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
              if (p.buttons.length === 0) deleteCustomPad(p.padId);
              else saveCustomPad(p);
              closeEditor();
            }}
            onCancel={() => {
              // Same rule on discard: if the pad was ALREADY empty when the
              // editor opened (fresh Blank Canvas abandoned untouched), drop it.
              if (editingPad && (editingPad.buttons || []).length === 0) deleteCustomPad(editingPad.padId);
              closeEditor();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
