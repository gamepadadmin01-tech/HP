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
  return ms;
}

import { Btn, Dpad, RightStick, TriggerPill, RED_NORM, RED_HELD, FACE_COLORS } from "./components/Widgets";

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
      let ws=null, latest=null, enabled=false;
      function connect(){
        try{
          ws=new WebSocket('ws://127.0.0.1:7777');
          ws.binaryType='arraybuffer';
          ws.onopen=function(){ postMessage({t:'open',v:true}); };
          ws.onclose=function(){ ws=null; postMessage({t:'open',v:false}); };
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
      setInterval(function(){
        if(!enabled){ if(ws){ disconnect(); postMessage({t:'open',v:false}); } return; }
        if(ws && ws.readyState===1){
          if(latest){
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
      },3);
      onmessage=function(e){
        var d=e.data;
        if(d && d.cmd==='connect'){ enabled=true; lastTry=0; }
        else if(d && d.cmd==='disconnect'){ enabled=false; disconnect(); postMessage({t:'open',v:false}); }
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
  send(buf: ArrayBuffer) {
    if (this.worker) { try { this.worker.postMessage(buf); } catch {} }
  },
};
(window as any).__usbWS = usbWS;
usbWS.start(); // creates the worker only; does NOT open the WS until connect() is called

// Wired transport preference (persisted). "auto" prefers USB-tethering and falls
// back to USB-debugging; "tether"/"usbdebug" force one. Read by the transport
// coordinator, the USB auto-pair handler, and the Wired tab UI.
type WiredPref = "auto" | "tether" | "usbdebug";
function getWiredPref(): WiredPref {
  try {
    const v = localStorage.getItem("gp_wired_pref");
    if (v === "tether" || v === "usbdebug" || v === "auto") return v;
  } catch {}
  return "auto";
}
function setWiredPref(v: WiredPref) { try { localStorage.setItem("gp_wired_pref", v); } catch {} }

function useGyro(maxAngle: number = 45, deadzone: number = 0, onGyroChange?: () => void, enabled: boolean = true) {
  const tiltRef = useRef({ left: 0, right: 0, x: 0, y: 0 });
  const leftBarRef = useRef<HTMLDivElement>(null);
  const rightBarRef = useRef<HTMLDivElement>(null);

  const onGyroChangeRef = useRef(onGyroChange);
  useEffect(() => {
    onGyroChangeRef.current = onGyroChange;
  });
  // Live-readable enabled flag so the poll can rest the bars when gyro is off
  // without tearing down/recreating the animation loop.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; });

  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.getGyroscopeDataJson) {
      // TWO loops, deliberately split:
      //  • DATA  @120 Hz (8 ms setInterval): reads the bridge, updates the steering
      //    value and fires the packet send. Decoupled from the display's 60 Hz rAF
      //    so the game gets ~4 ms-fresh gyro instead of up-to-16.7 ms-stale.
      //    (120 Hz, NOT 250 — each bridge read is a synchronous JNI hop; 250 Hz
      //    risks WebView jank on midrange phones for ~2 ms of extra freshness.)
      //  • RENDER @rAF with a LIGHT glide (k=0.45/frame ≈ 25 ms time constant):
      //    the bar slides smoothly across the 8 ms data steps. VISUAL ONLY — the
      //    steering value sent to the game is raw. This is NOT the heavy ~140 ms
      //    smoothing that was tried and rejected (see SKILL.md); 25 ms is below
      //    perception threshold for a readout bar.
      let targetBx = 0;   // indicator target (-1..1) from the data loop
      let dispBx = 0;     // displayed (glided) bar position
      let ageSum = 0, ageN = 0, lastAgeLog = Date.now(); // staleness telemetry

      const dataId = setInterval(() => {
        try {
          if (!enabledRef.current) {
            // Gyro off → rest the bars empty and don't feed tilt into the stick.
            tiltRef.current = { left: 0, right: 0, x: 0, y: 0 };
            targetBx = 0;
            return;
          }
          const data = JSON.parse(bridge.getGyroscopeDataJson());
          // data.nx/ny = RAW tilt ANGLE in degrees (native, +/-90).
          // sensitivity = full-lock angle (deg): tilt `maxAngle` deg => full ±1.
          // deadzone = ignore tilts below `deadzone` deg; past it the ABSOLUTE
          // angle is read (no re-normalization), e.g. dz=10, tilt 11 => 11/sens.
          const sensDeg = Math.max(1, maxAngle); // sensitivity = full-lock tilt angle in degrees (tilt this many deg => full ±1)
          const dzDeg = Math.max(0, deadzone);
          const gateX = Math.abs(data.nx || 0) < dzDeg ? 0 : (data.nx || 0);
          const gateY = Math.abs(data.ny || 0) < dzDeg ? 0 : (data.ny || 0);
          // STEERING value sent to the game — range (deadzone) APPLIED here.
          const rx = Math.max(-1, Math.min(1, gateX / sensDeg));
          const ry = Math.max(-1, Math.min(1, gateY / sensDeg));

          tiltRef.current = { left: rx < 0 ? Math.abs(rx) : 0, right: rx >= 0 ? rx : 0, x: rx, y: ry };

          // INDICATOR target: lock at the range mark while inside the range, then
          // follow real tilt. Negated so the bar fills the side you tilt toward.
          const indAbs = Math.abs(data.nx || 0);
          const indDir = (data.nx || 0) < 0 ? -1 : 1;
          let indMag;
          if (dzDeg > 0 && indAbs < dzDeg) indMag = indAbs < 2 ? 0 : (dzDeg / sensDeg);
          else indMag = indAbs / sensDeg;
          indMag = Math.min(1, indMag);
          targetBx = -(indDir * indMag);

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
      }, 8);

      let reqId: number;
      const render = () => {
        dispBx += (targetBx - dispBx) * 0.45;
        if (Math.abs(targetBx - dispBx) < 0.004) dispBx = targetBx; // snap the tail
        // scaleX (GPU-composited, no layout reflow) = smoothest update.
        if (leftBarRef.current)  leftBarRef.current.style.transform  = `scaleX(${dispBx < 0 ? -dispBx : 0})`;
        if (rightBarRef.current) rightBarRef.current.style.transform = `scaleX(${dispBx >= 0 ? dispBx : 0})`;
        reqId = requestAnimationFrame(render);
      };
      reqId = requestAnimationFrame(render);
      return () => { clearInterval(dataId); cancelAnimationFrame(reqId); };
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
      
      if (onGyroChangeRef.current) onGyroChangeRef.current();
    };

    window.addEventListener("deviceorientation", handleOrientation);
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [maxAngle, deadzone]);

  return { tiltRef, leftBarRef, rightBarRef };
}

// ─── Controller Screen ────────────────────────────────────────────────────────
function ControllerScreen({ onBack, premium, setPremium, credits, setCredits, isActive, activeMapping, customPad, controllerLayout, posOverride, gyroOn, setGyroOn, gyroMaxAngle, gyroDeadzone, gyroHaptic, rumbleOn, rumbleIntensity }: {
  onBack: () => void; isActive: boolean;
  premium: boolean; setPremium: (v: boolean) => void;
  credits: number; setCredits: (fn: (c: number) => number) => void;
  activeMapping: Partial<Record<BtnId, string>>;
  customPad?: CustomPad;
  controllerLayout?: "standard" | "mobile";
  posOverride?: PosOverrideMap;
  gyroOn: boolean;
  setGyroOn: (v: boolean) => void;
  gyroMaxAngle: number;
  gyroDeadzone: number;
  gyroHaptic: boolean;
  rumbleOn: boolean;
  rumbleIntensity: number;
}) {
  const [rumble, setRumble] = useState({ left: 0, right: 0, lt: 0, rt: 0 });
  const rumbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // The bridge calls this when a rumble packet arrives from PC
    (window as any).onRumblePacket = (leftMotor: number, rightMotor: number, ltHaptic: number, rtHaptic: number) => {
      setRumble({ left: leftMotor, right: rightMotor, lt: ltHaptic, rt: rtHaptic });
      
      if (rumbleOn) {
        const scale = rumbleIntensity / 100;
        const strength = Math.max(leftMotor, rightMotor) * scale; // 0..255 effective
        if (strength >= 1) {
          // Pulse LENGTH scales with strength too — so the Intensity slider is felt
          // even on phones without a variable-amplitude motor (where a custom
          // amplitude is silently ignored). Amplitude is also scaled when supported.
          const dur = Math.round(20 + (strength / 255) * 80); // 20..100ms
          const bridge = (window as any).AndroidBridge;
          if (bridge && bridge.triggerRumble) {
            bridge.triggerRumble(leftMotor * scale, rightMotor * scale, dur);
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
  }, [isActive, rumbleOn, rumbleIntensity]);
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
  const gyroTilt = useGyro(gyroMaxAngle, gyroDeadzone, () => sendTelemetryRef.current(), gyroOn);
  const lastGyroHitMax = useRef({ x: false, y: false });
  const [realTelemetry, setRealTelemetry] = useState(null);

  useEffect(() => {
    if (!isActive) return;
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.getNetworkTelemetryJson) {
      const interval = setInterval(() => {
        const w = (window as any).__usbWS;
        if (w && w.isOpen()) {
          setRealTelemetry({ linkAlive: true, latency: w.latency, connectionType: "usbdebug" });
          return;
        }
        try {
          const json = bridge.getNetworkTelemetryJson();
          const stats = JSON.parse(json);
          setRealTelemetry(stats);
        } catch (e) {
          console.error("Failed to parse network telemetry JSI", e);
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [isActive]);

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

    // Gyro = STEERING WHEEL: roll (tilt the phone left/right) drives the LEFT
    // stick X-axis, exactly like turning a wheel in a racing game (F1). Pitch
    // (forward/back tilt) is ignored — steering is a single axis.
    if (gyroOn) {
      // tiltRef.x is already the final steering value (-1..1): sensitivity (full-
      // lock angle) and the degree-deadzone are applied inside useGyro, so the
      // stick and the on-screen indicator always match exactly.
      const gx = gyroTilt.tiltRef.current.x;
      lx -= gx * 60;   // tilt left/right → steer left/right (negated so the CAR matches the on-screen indicator/physical tilt)

      if (gyroHaptic) {
        const isMaxX = Math.abs(gx) >= 0.99;  // full lock
        if (isMaxX && !lastGyroHitMax.current.x) triggerHaptic(15);
        lastGyroHitMax.current.x = isMaxX;
      }
    }
    
    const processStick = (x: number, y: number) => {
      const distance = Math.sqrt(x * x + y * y);
      const deadzoneRadius = (8 / 100) * 60; // 8% default deadzone
      if (distance >= deadzoneRadius && distance > 0) {
        const factor = (distance - deadzoneRadius) / (60 - deadzoneRadius);
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
    const lsXByte = axisByte(finalLs.x / 60);
    const lsYByte = axisByte(finalLs.y / 60);
    const rsXByte = axisByte(finalRs.x / 60);
    const rsYByte = axisByte(finalRs.y / 60);
    
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

  // Layout — scaled up to fill the 1264×570 canvas
  // Helper to apply position override for a named button
  function p(key: string, defaults: BtnPosOverride): BtnPosOverride {
    const ov = posOverride?.[key];
    return ov ? { ...defaults, ...ov } : defaults;
  }

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
        setWindowSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    handleResize(); // trigger once to be safe
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, []);

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

  const LB  = p("LB",  { cx: 90,  cy: 110,  r: 52 });
  const RB  = p("RB",  { cx: 252, cy: 110,  r: 52 });
  const FY  = p("Y",   { cx: 160, cy: 250, r: 56 });
  const FX  = p("X",   { cx: 60,  cy: 350, r: 56 });
  const FB  = p("B",   { cx: 260, cy: 350, r: 56 });
  const FA  = p("A",   { cx: 160, cy: 450, r: 56 });
  
  // Center-aligned:
  const LS  = p("lstick", { cx: 410 + offsetCenter, cy: 528, r: 40 });
  const _DP = p("dpad", { cx: 580 + offsetCenter, cy: 348, r: 138 });
  const _RS = p("rstick", { cx: 648 + offsetCenter, cy: 528, r: 138 });

  const DP  = { ..._DP };
  const RSL = p("rstick_btn", { cx: 758 + offsetCenter, cy: 528, r: 40 });
  
  const _LST = p("lstick", { cx: 284, cy: 308, r: 120 });
  const LST = { cx: _LST.cx, cy: _LST.cy, outerR: _LST.r, innerR: Math.round(_LST.r * 0.483) };

  // Right-aligned:
  const _RST = p("rstick", { cx: 926 + offsetRight, cy: 308, r: 120 });
  const RST = { cx: _RST.cx, cy: _RST.cy, outerR: _RST.r, innerR: Math.round(_RST.r * 0.483) };
  const LT  = { x: 1062 + offsetRight, y: 16, w: 92, h: 538, rx: 46 };
  const RT  = { x: 1166 + offsetRight, y: 16, w: 92, h: 538, rx: 46 };


  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#000000", touchAction: "none" }}>
      <button onClick={onBack}
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

      {/* Live latency badge — real measured round-trip ms. Always visible so
          you can compare against other apps under identical conditions.
          Green <20ms, amber 20–40, red >40. */}
      {(() => {
        const lat: number | null = (realTelemetry && typeof (realTelemetry as any).latency === "number")
          ? (realTelemetry as any).latency : null;
        const connected = !!(realTelemetry && (realTelemetry as any).linkAlive);
        const color = lat == null ? "rgba(255,255,255,0.4)"
          : lat < 20 ? "#34d399" : lat < 40 ? "#fbbf24" : "#f87171";
        return (
          <div className="absolute z-10 flex items-center gap-1 px-2 py-1 rounded-full pointer-events-none"
            style={{
              bottom: "max(6px, env(safe-area-inset-bottom))",
              left: "max(6px, env(safe-area-inset-left))",
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.1)",
              fontFamily: "'Oxanium','Inter',sans-serif",
            }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-[10px] font-bold tabular-nums" style={{ color }}>
              {connected && lat != null ? `${lat.toFixed(1)} ms` : "— ms"}
            </span>
          </div>
        );
      })()}

      {/* Top HUD: Gyro at top border, Tuning, Timer, Credits below it */}
      <div className="absolute z-10 flex flex-col items-center pointer-events-none w-full"
        style={{
          top: "max(3px, env(safe-area-inset-top))",
          left: "0",
          fontFamily: "'Inter',sans-serif"
        }}>
        
        {/* Gyro Fluid Indicator — ALWAYS shown on the top border. Dimmed when
            gyro is off (bars rest empty); full-bright + live when gyro is on.
            (Gyro only STEERS when enabled; this bar is the visual readout.) */}
        {(
          <div className="w-full overflow-hidden flex relative transition-opacity duration-200"
               style={{
                 height: "10px",
                 // Spans the FULL top edge (left edge → right edge). Visible track
                 // even at rest so it reads on a pure-black OLED screen.
                 background: gyroOn ? "rgba(0,212,255,0.14)" : "rgba(255,255,255,0.12)",
                 borderBottom: gyroOn ? "2px solid rgba(0,212,255,0.75)" : "1px solid rgba(0,212,255,0.3)",
                 boxShadow: gyroOn ? "0 0 14px rgba(0,212,255,0.5)" : "none",
                 opacity: gyroOn ? 1 : 0.7,
               }}>
            {/* center tick */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-white/50 z-10" />
            <div className="flex-1 overflow-hidden">
              {/* left half — scales from the RIGHT edge (toward center) */}
              <div ref={gyroTilt.leftBarRef} className="h-full w-full"
                   style={{ transform: "scaleX(0)", transformOrigin: "right center", willChange: "transform",
                            background: "#00d4ff", boxShadow: "0 0 8px rgba(0,212,255,0.9)" }} />
            </div>
            <div className="flex-1 overflow-hidden">
              {/* right half — scales from the LEFT edge (toward center) */}
              <div ref={gyroTilt.rightBarRef} className="h-full w-full"
                   style={{ transform: "scaleX(0)", transformOrigin: "left center", willChange: "transform",
                            background: "#00d4ff", boxShadow: "0 0 8px rgba(0,212,255,0.9)" }} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 mt-1 px-4 w-full">
          {/* Gyro toggle — TAP to turn steering on/off without leaving the controller.
              The parent HUD is pointer-events-none (so it never blocks the gamepad),
              so this button MUST re-enable pointer events on itself, and uses
              onPointerDown + stopPropagation so the tap is never swallowed by the pad. */}
          <button
            onPointerDown={(e) => { e.stopPropagation(); setGyroOn(!gyroOn); }}
            className="pointer-events-auto flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[9px] font-bold tracking-widest uppercase active:scale-90 transition-transform"
            style={{
              color: gyroOn ? "#00d4ff" : "rgba(255,255,255,0.45)",
              background: gyroOn ? "rgba(0,212,255,0.12)" : "rgba(255,255,255,0.05)",
              border: gyroOn ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.12)",
              touchAction: "manipulation",
              pointerEvents: "auto",
            }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: gyroOn ? "#00d4ff" : "rgba(255,255,255,0.3)",
              boxShadow: gyroOn ? "0 0 6px #00d4ff" : "none"
            }} />
            GYRO {gyroOn ? "ON" : "OFF"} · TAP
          </button>
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

      <div className="absolute inset-0 z-0 flex items-center justify-center" 
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
                    held={heldCustom}
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
                  y: { norm: "rgba(234, 179, 8, 0.18)",  held: "rgba(234, 179, 8, 0.9)" },
                  x: { norm: "rgba(59, 130, 246, 0.18)", held: "rgba(59, 130, 246, 0.9)" },
                  b: { norm: "rgba(239, 68, 68, 0.18)",  held: "rgba(239, 68, 68, 0.9)" },
                  a: { norm: "rgba(34, 197, 94, 0.18)",  held: "rgba(34, 197, 94, 0.9)" },
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
                        held={heldCustom}
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
              if (btn.type === "ltrt") {
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
                      held={heldCustom}
                      dn={dnCustom}
                      up={upCustom}
                      fill={ltFill}
                      onFillChange={(v) => {
                        // setLtFill sends synchronously; fire haptic AFTER the
                        // packet so a slow native vibrate never delays the press.
                        setLtFill(v);
                        if (v > 0 && btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                      }}
                      svgRef={svgRef}
                    />
                    <TriggerPill
                      x={rtX} y={pillY} w={pillW} h={pillH} rx={pillRx}
                      label="RT" id={`${btn.uid}_rt` as BtnId}
                      held={heldCustom}
                      dn={dnCustom}
                      up={upCustom}
                      fill={rtFill}
                      onFillChange={(v) => {
                        setRtFill(v);
                        if (v > 0 && btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                      }}
                      svgRef={svgRef}
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
                    held={heldCustom}
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
                      <circle cx={btn.x} cy={btn.y} r={btn.r + 6} fill="rgba(0,212,255,0.35)"
                        style={{ pointerEvents: "none", filter: "blur(8px)" }} />
                    )}
                    <circle cx={btn.x} cy={btn.y} r={btn.r}
                      fill={active ? "rgba(0,212,255,0.85)" : "rgba(0,212,255,0.12)"}
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
                    held={held}
                    dn={dn}
                    up={up}
                    fill={isLeft ? ltFill : rtFill}
                    onFillChange={(v) => {
                      // setLt/RtFill send synchronously; haptic fires AFTER.
                      (isLeft ? setLtFill : setRtFill)(v);
                      if (v > 0 && btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                    }}
                    svgRef={svgRef}
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
                  held={heldCustom}
                  dn={(id) => {
                    dnCustom(id);
                    if (btn.haptic > 0) triggerHaptic(Math.round(btn.haptic / 2));
                  }}
                  up={upCustom}
                  normColor={btn.normColor} heldColor={btn.heldColor}
                />
              );
            })}
          </>
        )}
      </svg>
      </div>

      {/* Rumble indicators removed — the phone's vibration is the feedback; no on-screen bars during play. */}


      {/* Tuning/Credits/Lockout dialogs removed for v1.0 (free, fixed 1000Hz). */}
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
  const realTelemetry = useNetworkTelemetry(true);
  const [tab, setTab] = useState<"wireless" | "wired">("wireless");
  const [wiredMode, setWiredModeState] = useState<WiredPref>(getWiredPref());
  const chooseWired = (m: WiredPref) => { setWiredPref(m); setWiredModeState(m); };
  const [showScanner, setShowScanner] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("7777");
  const [connecting, setConnecting] = useState(false);
  const [usbStatus, setUsbStatus] = useState<"idle" | "connecting" | "success" | "failed">("idle");
  // NOTE: USB auto-pair is handled globally at the app root (onUsbTetherChanged)
  // so it works from any screen and any plug-in ordering — not just here.

  // Recently-connected-PC caching was removed: on some phones, switching between
  // PCs could dial the stale saved PC instead of the freshly-scanned one. Every
  // connection is now a fresh QR scan. Purge any cache an older build left behind.
  useEffect(() => { try { localStorage.removeItem("last_server"); } catch {} }, []);

  function handleManualConnect() {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.connectToPC) {
      bridge.connectToPC(ip, parseInt(port) || 7777, "manual");
    }
    onDashboard();
  }

  function handleWiredConnect() {
    setConnecting(true);
    setUsbStatus("connecting");
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.connectToPC) {
      bridge.connectToPC("255.255.255.255", parseInt(port) || 7777, "usb");
    }
    
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const isConnected = bridge && (() => {
        try {
          const telemetryStr = bridge.getNetworkTelemetryJson();
          const tel = JSON.parse(telemetryStr);
          return tel && tel.linkAlive;
        } catch(e) { return false; }
      })();

      if (isConnected) {
        clearInterval(interval);
        setUsbStatus("success");
        setTimeout(() => {
          setConnecting(false);
          setUsbStatus("idle");
          onDashboard();
        }, 1200);
      } else if (attempts >= 10) { // 2.5 seconds timeout
        clearInterval(interval);
        setUsbStatus("failed");
        setConnecting(false);
      }
    }, 250);
  }

  const stepDot = (n: number, active: boolean) => (
    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
      style={{ background: active ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.05)", border: `1.5px solid ${active ? "#00d4ff" : "rgba(255,255,255,0.1)"}`, color: active ? "#00d4ff" : "rgba(255,255,255,0.35)" }}>
      {n}
    </div>
  );

  return (
    <div className={`absolute inset-0 flex flex-col overflow-hidden transition-colors duration-300 ${showScanner ? "bg-transparent" : "bg-background"}`}
      style={{ fontFamily: "'Inter',sans-serif" }}>
      {showScanner && <QRScanOverlay onClose={() => setShowScanner(false)} onConnect={onDashboard} />}

      {!showScanner && (
        <>
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 pb-4"
        style={{ background: "rgba(7,9,15,0.95)", borderBottom: "1px solid rgba(0,212,255,0.08)", paddingTop: "calc(var(--android-safe-top, env(safe-area-inset-top, 36px)) + 12px)" }}>
        <div className="flex items-center gap-2.5">
          <Gamepad2 size={17} className="text-primary" />
          <span className="text-base font-bold tracking-[0.18em] text-primary"
            style={{ fontFamily: "'Oxanium',sans-serif" }}>GAMEPAD OS</span>
        </div>
        <button onClick={onDashboard}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.18)", color: "rgba(0,212,255,0.75)" }}>
          <Settings size={11} /> Dashboard
        </button>
      </div>

      {/* Title */}
      <div className="flex-shrink-0 px-5 pt-5 pb-4">
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Oxanium',sans-serif" }}>Connect to PC</h1>
        <p className="text-xs text-muted-foreground mt-1">Choose your connection method below</p>
      </div>

      {/* Connection method tabs */}
      <div className="flex-shrink-0 px-5 mb-4">
        <div className="flex gap-2 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {(["wireless", "wired"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setShowManual(false); }}
              className="flex-1 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all duration-200"
              style={tab === t
                ? { background: t === "wireless" ? "rgba(0,212,255,0.15)" : "rgba(90,16,16,0.5)", color: t === "wireless" ? "#00d4ff" : "#ff6060", border: `1px solid ${t === "wireless" ? "rgba(0,212,255,0.3)" : "rgba(200,40,40,0.4)"}` }
                : { background: "transparent", color: "rgba(255,255,255,0.35)", border: "1px solid transparent" }}>
              {t === "wireless" ? "⌘ Wireless" : "⟠ Wired (USB)"}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-8">

        <AnimatePresence mode="wait">
          {/* ── Wireless Tab ── */}
          {tab === "wireless" && (
            <motion.div
              key="wireless"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-3"
            >
              {/* Step 1 */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-3">
                  {stepDot(1, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Get the PC Server</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Download and run the Gamepad Host app on your Windows PC
                    </p>
                    <button
                      onClick={() => {
                        const url = "https://gamepad.space/#download";
                        const b = (window as any).AndroidBridge;
                        if (b && b.openUrl) { try { b.openUrl(url); return; } catch {} }
                        try { window.open(url, "_blank"); } catch {}
                      }}
                      className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95 duration-150"
                      style={{ background: "transparent", border: "1px solid rgba(0,212,255,0.35)", color: "#00d4ff" }}>
                      Get Download Link
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-3">
                  {stepDot(2, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Prepare to Scan</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Ensure both devices are on the same Wi-Fi network. Open the PC app to display your connection QR code.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 3 — Scan action */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.15)" }}>
                <div className="flex items-start gap-3 mb-4">
                  {stepDot(3, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Scan &amp; Connect</p>
                    <p className="text-xs text-muted-foreground mt-1">Point your camera at the QR code shown on the PC app</p>
                  </div>
                </div>
                <button onClick={() => setShowScanner(true)}
                  className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] duration-150"
                  style={{ background: "rgba(0,212,255,0.18)", border: "1.5px solid rgba(0,212,255,0.4)", color: "#00d4ff" }}>
                  📷 Scan PC QR Code
                </button>
                <button onClick={() => setShowManual(v => !v)}
                  className="w-full mt-2 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground">
                  {showManual ? "▲ hide manual entry" : "or enter details manually"}
                </button>
                {showManual && (
                  <div className="mt-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">PC IP Address</label>
                        <input value={ip} onChange={e => setIp(e.target.value)}
                          placeholder="192.168.1.xxx" maxLength={15}
                          className="w-full px-2.5 py-2 rounded-lg text-xs text-foreground font-mono outline-none"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,212,255,0.2)" }} />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Port</label>
                        <input value={port} onChange={e => setPort(e.target.value)}
                          placeholder="7777" maxLength={5}
                          className="w-full px-2.5 py-2 rounded-lg text-xs text-foreground font-mono outline-none"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(0,212,255,0.2)" }} />
                      </div>
                    </div>
                    <button onClick={handleManualConnect}
                      className="w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98] duration-150"
                      style={{ background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff" }}>
                      Connect
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Wired (USB) Tab ── */}
          {tab === "wired" && (
            <motion.div
              key="wired"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-3"
            >
              {/* Wired mode selector: auto-prefers tethering, or force one. Exactly
                  ONE transport connects, so the phone never registers as two pads. */}
              <div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-[11px] font-semibold text-muted-foreground mb-2 px-0.5">WIRED MODE</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["auto", "Auto"], ["tether", "USB Tethering"], ["usbdebug", "USB Debugging"]] as [WiredPref, string][]).map(([m, label]) => {
                    const on = wiredMode === m;
                    return (
                      <button key={m} onClick={() => chooseWired(m)}
                        className="py-2 rounded-xl text-[11px] font-semibold transition-colors"
                        style={{
                          background: on ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.03)",
                          color: on ? "#fbbf24" : "rgba(255,255,255,0.6)",
                          border: `1px solid ${on ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 px-0.5 leading-relaxed">
                  {wiredMode === "auto" ? "Prefers USB tethering for lowest latency; falls back to USB debugging."
                    : wiredMode === "tether" ? "Forces USB tethering (enable it in Settings → Hotspot & tethering)."
                    : "Forces USB debugging over adb (Developer Options → USB Debugging)."}
                </p>
              </div>

              {/* Step 1 */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-3">
                  {stepDot(1, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Enable USB Debugging</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      On your phone: <span className="text-foreground font-semibold">Settings → Developer Options → USB Debugging</span>. (Tap <span className="text-foreground font-semibold">Build Number</span> 7× to unlock Developer Options.)
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-3">
                  {stepDot(2, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Plug in &amp; run the PC app</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Connect the USB cable and make sure <span className="text-foreground font-semibold">GamepadServer</span> is running on your PC.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 3 — fully automatic, no button. */}
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-3">
                  {stepDot(3, true)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">Automatic Connection</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      No button needed — your PC is detected and connected automatically over USB.
                    </p>
                  </div>
                </div>
                {(() => {
                  const connected = !!(realTelemetry && (realTelemetry as any).linkAlive);
                  return (
                    <div className="flex items-center justify-center gap-2 mt-4 py-2.5 rounded-xl"
                      style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`} />
                      <span className="text-[11px] font-mono" style={{ color: connected ? "#34d399" : "rgba(251,191,36,0.85)" }}>
                        {connected ? "USB connected — controller ready" : "Waiting for USB + PC server…"}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </>
      )}
    </div>
  );
}

// ─── Shared dashboard helpers ─────────────────────────────────────────────────
function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-card border border-border rounded-xl ${className}`} style={style}>{children}</div>;
}
function SLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">{children}</p>;
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
function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
      {ok ? "✓" : "✕"} {label}
    </span>
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
  return (
    <div className="rounded-2xl flex flex-col overflow-hidden transition-all duration-200 cursor-pointer"
      onClick={onSelect}
      style={{
        border: `1.5px solid ${active ? preset.color : "rgba(255,255,255,0.12)"}`,
        background: active ? `${preset.color}0e` : "rgba(255,255,255,0.02)",
        boxShadow: active ? `0 0 0 1px ${preset.color}, 0 0 18px ${preset.color}55` : "none",
      }}>
      {/* Card header: icon + name (compact — two cards share each row) */}
      <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base leading-none flex-shrink-0">{preset.icon}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground leading-tight truncate">{preset.name}</p>
            <p className="text-[9px] text-muted-foreground truncate">{preset.genre}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isModified && (
            <span className="text-[8px] font-semibold px-1 py-0.5 rounded"
              style={{ background: `${preset.color}20`, color: preset.color }}>edited</span>
          )}
          {active && <div className="w-2 h-2 rounded-full" style={{ background: preset.color }} />}
        </div>
      </div>

      {/* Full-width visual layout preview — same renderer as the custom pads */}
      <div className="mx-2.5 mb-1.5 rounded-lg overflow-hidden"
        style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <svg viewBox="0 0 1280 570" className="w-full block" preserveAspectRatio="xMidYMid meet" style={{ aspectRatio: "1280 / 570" }}>
          {STANDARD_LAYOUT_THUMB.map(b => <PadThumbWidget key={b.uid} b={b} accent={preset.color} />)}
        </svg>
      </div>

      {/* Actions */}
      <div className="px-2.5 pb-2.5 flex gap-1.5">
        <button onClick={onPlay}
          className="flex-1 py-2 rounded-lg text-[11px] font-black tracking-widest transition-all active:scale-[0.97] duration-150 select-none"
          style={{ background: active ? preset.color : `${preset.color}22`, color: active ? "#000001" : preset.color, border: `1px solid ${preset.color}50`, touchAction: 'manipulation' }}>
          <span>{active ? "LAUNCH" : "PLAY"}</span>
        </button>
        {onEdit && (
          <button onClick={onEdit}
            className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all active:scale-[0.97] duration-150"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}>
            EDIT
          </button>
        )}
      </div>
    </div>
  );
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#05070f] z-50 px-8 text-center">
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
  const fill = b.normColor || "#14143a";
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
  if (b.type === "ltrt") {
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
function CustomPadSlot({ pad, active, onPlay, onEdit, onDelete, onDuplicate, onSelect }: {
  pad: CustomPad; active: boolean;
  onPlay: () => void; onEdit: () => void; onDelete: () => void; onDuplicate: () => void; onSelect?: () => void;
}) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  // Full-width layout thumbnail — render the actual widget shapes (not labels),
  // scaled from the 1264×570 design canvas, like a mini image of the pad.
  const CW = 1280, CH = 570;

  return (
    <div className="rounded-2xl flex flex-col overflow-hidden transition-all duration-200"
      style={{
        border: `1.5px solid ${active ? pad.color : "rgba(255,255,255,0.12)"}`,
        background: active ? `${pad.color}0e` : "rgba(255,255,255,0.02)",
        boxShadow: active ? `0 0 0 1px ${pad.color}, 0 0 18px ${pad.color}55` : "none",
      }}>

      {/* Card header: name (compact — two cards share each row) */}
      <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1.5 min-w-0">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pad.color }} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground leading-tight truncate">{pad.name}</p>
          <p className="text-[9px] text-muted-foreground truncate">{pad.buttons.length} widget{pad.buttons.length !== 1 ? "s" : ""} · Custom</p>
        </div>
      </div>

      {/* Full-width layout preview thumbnail */}
      <div className="mx-2.5 mb-1.5 rounded-lg overflow-hidden cursor-pointer" onClick={onSelect}
        style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full block" preserveAspectRatio="xMidYMid meet" style={{ aspectRatio: `${CW} / ${CH}` }}>
          {pad.buttons.length === 0 && (
            <text x={CW / 2} y={CH / 2} textAnchor="middle" dominantBaseline="central"
              fontSize={36} fill="rgba(255,255,255,0.25)" style={{ fontFamily: "'Inter',sans-serif" }}>Empty layout</text>
          )}
          {pad.buttons.map(b => <PadThumbWidget key={b.uid} b={b} accent={pad.color} />)}
        </svg>
      </div>

      {/* Actions with animated delete confirm */}
      <AnimatePresence mode="wait" initial={false}>
        {showConfirmDelete ? (
          <motion.div key="confirm-delete"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="px-2.5 pb-2.5 flex flex-col gap-2">
            <p className="text-[10px] font-bold text-red-400 text-center pt-1">Delete &ldquo;{pad.name}&rdquo;?</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowConfirmDelete(false); onDelete(); }}
                className="flex-1 py-2 rounded-xl text-[11px] font-black bg-red-600 active:bg-red-700 text-white transition-all active:scale-[0.97] duration-150">
                DELETE
              </button>
              <button onClick={() => setShowConfirmDelete(false)}
                className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-white/70 transition-all active:scale-[0.97] duration-150"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                CANCEL
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="actions"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="px-2.5 pb-2.5 flex gap-1.5">
            <button onClick={onPlay}
              className="flex-1 py-2 rounded-lg text-[11px] font-black tracking-widest transition-all active:scale-[0.97] duration-150 select-none"
              style={{ background: active ? pad.color : `${pad.color}22`, color: active ? "#000001" : pad.color, border: `1px solid ${pad.color}50`, touchAction: "manipulation" }}>
              {active ? "LAUNCH" : "PLAY"}
            </button>
            <button onClick={onEdit}
              className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all active:scale-[0.97] duration-150"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}>
              EDIT
            </button>
            <button onClick={onDuplicate}
              className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all active:scale-[0.97] duration-150 text-white/60"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              title="Duplicate">
              ◫
            </button>
            <button onClick={e => { e.stopPropagation(); setShowConfirmDelete(true); }}
              className="px-2 py-1.5 rounded-lg text-[10px] transition-all active:scale-[0.97] duration-150 text-red-400"
              style={{ background: "rgba(255,0,0,0.05)", border: "1px solid rgba(255,0,0,0.15)" }}
              title="Delete">
              🗑️
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Custom pad builder (full-screen drag-and-drop canvas) ────────────────────

const PRESET_TEMPLATES: Record<string, { name: string; icon: string; buttons: () => CustomBtnDef[] }> = {
  standard: {
    name: "Standard Console",
    icon: "🎮",
    buttons: () => getTrueStandardLayout()
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Widget Registry Pattern
// ──────────────────────────────────────────────────────────────────────────────

interface WidgetProps {
  btn: CustomBtnDef;
  sel: boolean;
  padColor: string;
}

const noop = () => {};

// (WidgetDispatcher removed — the controller renders every pad through the
//  single data-driven loop in ControllerScreen; this was dead duplicate code.)



function TabHome({ onLaunch, onConnect, onLaunchEditor, selectedPresetId, onSelectPreset, customPads, onSaveCustomPad, onDeleteCustomPad, onDuplicateCustomPad, presetOverrides, onSavePresetOverride, onResetPreset, posOverrides, onSavePosOverride, onResetPosOverride, onNewLayout, pendingEditPad, onClearPendingEditPad }: {
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

  // When a new pad is created via the blueprint dialog (which lives in DashboardScreen),
  // open the editor automatically.
  useEffect(() => {
    if (pendingEditPad) {
      if (onLaunchEditor) onLaunchEditor(pendingEditPad);
      else setEditingPad(pendingEditPad);
      onClearPendingEditPad();
    }
  }, [pendingEditPad]);

  return (
    <div className="space-y-4">
      {/* Connect to PC banner */}
      <button onClick={onConnect}
        className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98] duration-150"
        style={{ background: "rgba(0,212,255,0.07)", border: "1.5px solid rgba(0,212,255,0.22)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,212,255,0.12)" }}>
            <Usb size={17} className="text-primary" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-primary">Connect to PC</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Wireless or USB — set up your connection</p>
          </div>
        </div>
        <span className="text-primary text-lg leading-none ml-2">›</span>
      </button>

      {/* Standard controllers */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Standard Controllers</p>
        <div className="grid grid-cols-2 gap-2.5">
          {GAMEPAD_PRESETS.map(preset => {
            const override = presetOverrides[preset.id];
            const effectivePreset = override ? { ...preset, mapping: { ...preset.mapping, ...override } } : preset;
            return (
              <GamepadCard key={preset.id} preset={effectivePreset}
                active={selectedPresetId === preset.id}
                isModified={!!override}
                onSelect={() => onSelectPreset(preset.id)}
                onPlay={() => { onSelectPreset(preset.id); onLaunch(); }} />
            );
          })}
        </div>
      </div>

      {/* Custom pads */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Custom Pads</p>
          <span className="text-[10px] font-mono text-muted-foreground/60">{customPads.length} layout{customPads.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {customPads.map(pad => (
            <CustomPadSlot key={pad.padId} pad={pad}
              active={selectedPresetId === pad.padId}
              onSelect={() => onSelectPreset(pad.padId)}
              onPlay={() => { onSelectPreset(pad.padId); onLaunch(); }}
              onEdit={() => { if (onLaunchEditor) onLaunchEditor(pad); else setEditingPad(pad); }}
              onDelete={() => onDeleteCustomPad(pad.padId)}
              onDuplicate={() => onDuplicateCustomPad(pad)} />
          ))}

          {/* Empty state placeholder */}
          {customPads.length === 0 && (
            <div className="col-span-full py-8 px-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] flex flex-col items-center justify-center text-center gap-2.5">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center border border-white/10 text-xl select-none">🎮</div>
              <div>
                <p className="text-sm font-semibold text-white/80">No Custom Layouts Yet</p>
                <p className="text-xs text-muted-foreground max-w-[280px] mx-auto mt-0.5">Design a personalized virtual controller layout tailored perfectly for your games.</p>
              </div>
            </div>
          )}

          {/* Create layout CTA card */}
          <motion.button whileTap={{ scale: 0.96 }}
            onClick={onNewLayout}
            className="rounded-2xl flex flex-col items-center justify-center gap-2 min-h-[100px] transition-all duration-150"
            style={{ background: "rgba(255,255,255,0.018)", border: "1.5px dashed rgba(255,255,255,0.14)" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <span className="text-white/55 text-lg leading-none">+</span>
            </div>
            <span className="text-[10px] font-bold text-muted-foreground/80 tracking-widest uppercase">New Layout</span>
          </motion.button>
        </div>
      </div>
      {/* Editor is rendered at the APP ROOT as its own full-screen view, not
          here — a fixed element under this CSS-transformed tab container would
          anchor to the transform and let the dashboard bleed through. */}

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

interface TabSystemProps {
  gyroOn: boolean;
  setGyroOn: (v: boolean) => void;
  gyroMaxAngle: number;
  setGyroMaxAngle: (v: number) => void;
  gyroDeadzone: number;
  setGyroDeadzone: (v: number) => void;
  gyroHaptic: boolean;
  setGyroHaptic: (v: boolean) => void;
  rumbleOn: boolean;
  setRumbleOn: (v: boolean) => void;
  rumbleIntensity: number;
  setRumbleIntensity: (v: number) => void;
}

function TabSystem({ gyroOn, setGyroOn, gyroMaxAngle, setGyroMaxAngle, gyroDeadzone, setGyroDeadzone, gyroHaptic, setGyroHaptic, rumbleOn, setRumbleOn, rumbleIntensity, setRumbleIntensity }: TabSystemProps) {
  // (Removed a 20Hz setTick interval that re-rendered this tab every 50ms and
  //  caused scroll jank — it only fed unused browser-preview gyro values.)
  const isBridge = typeof window !== "undefined" && !!(window as any).AndroidBridge;

  const [temp, setTemp] = useState(0);
  const [shizuku, setShizuku] = useState(false);
  const [shizukuRunning, setShizukuRunning] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [battery, setBattery] = useState(0);

  useEffect(() => {
    const bridge = (window as any).AndroidBridge;

    // Interval query for system stats
    const queryStats = () => {
      if (bridge && bridge.getSystemStatsJson) {
        try {
          const json = bridge.getSystemStatsJson();
          const stats = JSON.parse(json);
          setBattery(stats.battery);
          setTemp(stats.temp);
          setShizuku(stats.shizuku);
          setShizukuRunning(stats.shizukuRunning);
          setBypass(stats.bypass);
        } catch (e) {
          console.error("Failed to parse system stats", e);
        }
      }
    };

    queryStats();
    const id = setInterval(queryStats, 1500);
    return () => clearInterval(id);
  }, []);

  const status = temp < 38
    ? { label: "NOMINAL", c: "text-emerald-400", b: "bg-emerald-400", desc: "Cooling efficient. Power and refresh speeds are fully maximized." }
    : temp < 44 
      ? { label: "OPTIMIZED", c: "text-amber-400", b: "bg-amber-400", desc: "Balanced thermal levels. System throttling auto-managed." }
      : { label: "ELEVATED", c: "text-red-400", b: "bg-red-400", desc: "Bypass mode active to cool down processor immediately." };

  function handleGrantShizuku() {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.requestShizukuPermission) {
      bridge.requestShizukuPermission();
    } else {
      setShizuku(true);
    }
  }

  function handleToggleBypass(v: boolean) {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.setChargeBypass) {
      bridge.setChargeBypass(v);
    }
    setBypass(v);
  }

  return (
    <div className="space-y-4">
      {!isBridge && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
          <p className="text-xs font-bold text-red-400 font-mono tracking-widest">OFFLINE BROWSER PREVIEW</p>
          <p className="text-[10px] text-muted-foreground mt-1">Connect to Android App for real telemetry</p>
        </div>
      )}



      {/* Sensors Segment with radar calibration scope */}
      <LatencyCard />

      <SectionDivider>Tilt Controls</SectionDivider>
      <Card className="p-4 bg-black/40 border-border/40">
        <div className="flex justify-between items-center mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Tilt Steering</p>
            <p className="text-xs text-muted-foreground mt-0.5">Steer by tilting your phone left and right</p>
          </div>
          <Toggle on={gyroOn} onChange={setGyroOn} />
        </div>

        {gyroOn && (
          <div className="mb-4 bg-secondary/20 p-4 rounded-lg border border-border/40 space-y-5">

            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">Left/right device rotation</p>

            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground transform rotate-45">⤡</span>
                  <p className="text-sm text-foreground">Steering sensitivity</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input type="range" min="1" max="90" step="1" value={gyroMaxAngle} onChange={e => {
                  setGyroMaxAngle(Number(e.target.value));
                }}
                  className="w-full accent-red-600 h-1 rounded-lg appearance-none cursor-pointer bg-red-900" />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground font-mono">
                <p className="text-foreground">{gyroMaxAngle}°</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground transform rotate-45">⤡</span>
                  <p className="text-sm text-foreground">Steering range</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="30" step="1" value={gyroDeadzone} onChange={e => setGyroDeadzone(Number(e.target.value))}
                  className="w-full accent-red-600 h-1 rounded-lg appearance-none cursor-pointer bg-red-900" />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground space-y-3 font-mono">
                <div>
                  <p className="text-foreground">{gyroDeadzone}°</p>
                  <p>Default: 0°; Recommended: 0-15°</p>
                </div>
                <p className="font-sans leading-relaxed">Ignores tiny tilts, so the car stays straight when you want it to.</p>
                <p className="font-sans leading-relaxed">Once you tilt past this, steering follows your real tilt amount.</p>
                <p className="font-sans leading-relaxed">Set to 0 to react to the smallest tilt instantly.</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      <SectionDivider>Vibration & Rumble</SectionDivider>
      <Card className="p-4 bg-black/40 border-border/40 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm font-semibold text-foreground">App Vibration</p>
            <p className="text-xs text-muted-foreground mt-0.5">Button presses and full-turn bumps</p>
          </div>
          <Toggle on={gyroHaptic} onChange={setGyroHaptic} />
        </div>

        <div className="h-px w-full bg-white/5 my-2" />

        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm font-semibold text-foreground">Game Rumble Feedback</p>
            <p className="text-xs text-muted-foreground mt-0.5">Feel rumble from the game — crashes, weapons, terrain</p>
          </div>
          <Toggle on={rumbleOn} onChange={setRumbleOn} />
        </div>
        {rumbleOn && (
          <div className="space-y-3 bg-secondary/20 p-3 rounded-lg border border-border/40">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-foreground">Intensity</span>
                <span className="text-xs font-mono text-muted-foreground">{rumbleIntensity}%</span>
              </div>
              <input type="range" min="0" max="100" value={rumbleIntensity}
                onChange={e => setRumbleIntensity(Number(e.target.value))}
                className="w-full accent-red-600 h-1 bg-red-900 rounded-lg appearance-none cursor-pointer" />
              <p className="text-[10px] text-muted-foreground mt-1">Adjusts how strong the rumble feels</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                Left motor — heavy rumble
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                Right motor — fine vibration
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                LT haptic — brake / resistance
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                RT haptic — throttle / recoil
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Thermals Segment */}
      <SectionDivider>System Performance</SectionDivider>
      <Card className="p-4 bg-black/40 border-border/40 space-y-4">
        {/* Simple visual indicator */}
        <div className="flex items-start gap-3.5 p-3 rounded-xl border bg-secondary/20 border-border/40">
          <div className="relative flex items-center justify-center mt-1">
            <span className={`absolute inline-flex h-3 w-3 rounded-full ${status.b} opacity-75 animate-ping`} />
            <span className={`relative inline-flex rounded-full h-3 w-3 ${status.b}`} />
          </div>
          <div className="flex-1 space-y-0.5">
            <div className="flex justify-between items-baseline">
              <p className="text-xs font-bold text-foreground tracking-wide">THERMAL STATUS: {status.label}</p>
              <span className="text-xs font-mono font-bold text-primary">{temp.toFixed(1)}°C</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{status.desc}</p>
          </div>
        </div>

        {/* Modern gamer toggles */}
        {/* Lock low latency text */}
        <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center gap-2">
          <span className="text-primary text-xs">⚡</span>
          <span className="text-[11px] text-primary font-mono font-semibold">Performance Engine: Locked at Ultra-Low Latency (1ms / 1000Hz)</span>
        </div>
      </Card>

    </div>
  );
}

// ─── Developer Payload Simulator ─────────────────────────────────────────────

// (Developer Payload Simulator component completely removed for player simplicity)

// ─── Tab: Session (Playtime + Advanced) ──────────────────────────────────────

interface TabSessionProps {
  credits: number;
  setCredits: (fn: (c: number) => number) => void;
  premium: boolean;
  setPremium: (v: boolean) => void;
  gyroOn: boolean;
}

function TabSession({
  credits,
  setCredits,
  premium,
  setPremium,
  gyroOn
}: TabSessionProps) {
  // v1.0: free & unlimited. Fake credits/ads/premium removed for launch;
  // real AdMob + Play Billing land in a later update. This tab shows About.
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
