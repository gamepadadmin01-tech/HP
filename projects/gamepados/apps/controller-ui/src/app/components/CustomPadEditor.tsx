import React, { useState, useRef } from "react";
import { CONTROLLER } from "../themeVariant";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Plus, ArrowLeft, Settings, Trash2, Pencil, TriangleAlert, GripHorizontal } from "lucide-react";
import { ShellMotion } from "./ShellMotion";
import { CustomPad, CustomBtnDef, WidgetType } from "../types";
import { RED_NORM, ACCENT_RGB, buttonText } from "./Widgets";
import { TouchpadArt } from "./Touchpad";
import { TouchpadSettings } from "./TouchpadSettings";
import { ADD_ITEMS, ADD_CELL, AddItem } from "../addItems";
import { touchpadSize, isRoundPad } from "../touchpad";
import { SPRING, SPRING_SNAP, FADE, EXIT, cardIn, backdropIn, popupIn, tileIn } from "../motion";

// ── Custom pointer-driven slider ──────────────────────────────────────────────
// Native <input type="range"> does NOT drag reliably inside this editor: the
// surface sets `touch-action: none` (swallows the gesture) and is CSS-rotated
// 90° in portrait (scrambles the slider's drag axis). This slider tracks the
// pointer against its own bounding rect — which already reflects the rotation —
// so dragging works in any orientation.
function RangeSlider({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const setFromClient = (clientX: number, clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Use whichever axis the track is actually longer on, so it works whether
    // the panel is upright or rotated 90°.
    let t: number;
    if (r.width >= r.height) {
      t = (clientX - r.left) / r.width;
    } else {
      t = (clientY - r.top) / r.height;
    }
    t = Math.max(0, Math.min(1, t));
    onChange(Math.round(min + t * (max - min)));
  };

  return (
    <div
      ref={trackRef}
      className="relative w-full h-9 flex items-center cursor-pointer select-none"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
        setFromClient(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        // Only react to a drag that actually STARTED on this track (we captured
        // the pointer in onPointerDown). Without this, dragging across the panel
        // — e.g. scrolling it — that happens to cross a slider would snap the
        // value to wherever the pointer passed, silently corrupting the layout.
        if (e.buttons === 0) return;
        try { if (!(e.currentTarget as Element).hasPointerCapture(e.pointerId)) return; } catch {}
        setFromClient(e.clientX, e.clientY);
      }}
    >
      {/* track */}
      <div className="absolute left-0 right-0 h-1.5 rounded-full bg-white/12" />
      {/* fill */}
      <div className="absolute left-0 h-1.5 rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
      {/* thumb */}
      <div
        className="absolute w-5 h-5 rounded-full bg-white shadow-md border border-black/10 -translate-x-1/2"
        style={{ left: `${pct * 100}%` }}
      />
    </div>
  );
}

// Labels that resolve to a REAL gamepad input (must mirror CUSTOM_LABEL_MAP /
// BTN_MAP in App.tsx). A plain button/macro whose label isn't here sends
// nothing to the PC, so the editor warns about it.
const KNOWN_BUTTON_LABELS = new Set([
  "A", "B", "X", "Y", "LB", "RB",
  "L3", "LS", "Left stick", "R3", "RS", "Right stick",
  "↑", "↓", "←", "→", "up", "down", "left", "right",
  "view", "menu", "home", "LT", "RT",
]);
// Widget types that are always valid regardless of label (compound/analog).
// "stickmode" is the Hybrid-stick axis selector (labels "L-Mod"/"R-Mod"); the
// gameplay engine handles it by TYPE, not label, so it must be here or the editor
// falsely warns "won't register in games" about a working palette widget.
const SELF_MAPPED_TYPES = new Set(["dpad", "abxy", "thumbstick", "trigger", "stickmode", "touchpad"]);

// ── Editor canvas matches the controller's virtual space ──────────────────────
const CANVAS_W = 1280;
const CANVAS_H = 570;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;

const DEFAULT_NORM = `rgba(${CONTROLLER.rgb}, 0.12)`;   // the controller colour (themeVariant.ts); was blue
const DEFAULT_HELD = `rgba(${CONTROLLER.rgb}, 0.85)`;

// The toolbar, collapsed (nothing selected): back, a pencil (rename the layout), then +. Rename lives here since
// 2026-11-08: the name used to float in the top-left corner, right over buttons like LB. The toolbar stays this
// small so it covers no more of the pad than before; it widens only while a widget is selected or while typing a
// new name. The "+" popup grows out of the "+", so its origin is derived from these.
const TOOLBAR_W = 168;                                   // collapsed width, px (was 120: back + only)
const TOOLBAR_WIDE = 280;                                // while a widget is selected, or while renaming
const PLUS_OFFSET = TOOLBAR_W / 2 - 6 - 40 / 2;          // the "+" centre: half the toolbar, minus its 6px padding, minus half a 40px button

// The widget-settings panel is drawn at 75% of its design size (so it hides less of the canvas) and can be dragged
// anywhere by its header. Positions are in the editor layer's own pixels; the layer may be CSS-rotated on desktop.
const PANEL_SCALE = 0.75;
const PANEL_W = 300;      // design width, before the scale
const PANEL_GAP = 8;      // gap between the toolbar and the panel when it first opens
const PANEL_EDGE = 4;     // the panel never goes closer than this to a screen edge

// The toolbar can be dragged anywhere (owner, 2026-11-08). A slide of more than TOOLBAR_DRAG_SLOP px on it moves it;
// a shorter touch is still a normal tap on its buttons. Its place is remembered (as a fraction of the screen, so it
// survives rotation and other screen sizes). It is kept fully on screen even at its WIDE size.
const TOOLBAR_DRAG_SLOP = 6;
const TOOLBAR_H = 57;     // measured: p-1.5 + a 44px-min button + border
const TOOLBAR_EDGE = 4;
const TOOLBAR_POS_KEY = "gp_editor_toolbar_pos";
function loadToolbarFrac(): { fx: number; fy: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TOOLBAR_POS_KEY) || "null");
    return v && typeof v.fx === "number" && typeof v.fy === "number" ? v : null;
  } catch { return null; }
}
function saveToolbarFrac(v: { fx: number; fy: number }) {
  try { localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(v)); } catch {}
}

// Per-type default radius (single source for both "Add" and resize bounds).
const DEFAULT_R: Record<WidgetType, number> = {
  button: 56,
  macro: 56,
  thumbstick: 110,
  trigger: 82,
  dpad: 120,
  abxy: 140,
  stickmode: 40,
  touchpad: 100,      // default footprint 360 x 220 (touchpadSize)
};

const FACE = {
  y: DEFAULT_HELD,
  x: DEFAULT_HELD,
  b: DEFAULT_HELD,
  a: DEFAULT_HELD,
};

// Bounding box used for selection outline + drag hit-box.
// MUST mirror the gameplay render in App.tsx.
function widgetBox(b: CustomBtnDef) {
  const r = b.r;
  if (b.type === "touchpad") {
    const { w, h } = touchpadSize(b);
    return { x: b.x - w / 2, y: b.y - h / 2, w, h };
  }
  if (b.type === "trigger") {
    const w = b.w ?? r * 2;
    const h = b.h ?? r * 5.85;
    return { x: b.x - w / 2, y: b.y - h / 2, w, h };
  }
  // Rectangular button (explicit w/h set in settings).
  if ((b.type === "button" || b.type === "macro") && b.w != null && b.h != null) {
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }
  // round widgets (button / macro / thumbstick / dpad / abxy)
  return { x: b.x - r, y: b.y - r, w: r * 2, h: r * 2 };
}

// ── Static preview of a widget (no interactivity) ─────────────────────────────
// Memoized: only the widget whose geometry/label/colour actually changed will
// re-render. Without this, every slider tick / drag frame re-renders ALL widgets
// (each is several SVG nodes), which is the main source of editor lag.
const WidgetPreview = React.memo(function WidgetPreview({ b }: { b: CustomBtnDef }) {
  const { x, y, r } = b;
  const stroke = "rgba(255,255,255,0.12)";
  // The live pad draws every widget in RED_NORM and ignores the colours stored on the
  // widget, so the preview must too (it used a blue default, and ABXY drew at 85 %).
  const fill = RED_NORM;

  if (b.type === "dpad") {
    // Mirror the gameplay Dpad exactly: circular pad, 4 pie sectors, glossy top
    // highlight, centre hub, and ▲▶▼◀ glyphs (see Dpad in components/Widgets.tsx).
    const inner = r * 0.28;
    const sector = (a1: number, a2: number) => {
      const rad = (d: number) => (d * Math.PI) / 180;
      const mk = (d: number, rr: number) => ({ x: x + Math.cos(rad(d)) * rr, y: y + Math.sin(rad(d)) * rr });
      const s1 = mk(a1, inner), s2 = mk(a1, r), e2 = mk(a2, r), e1 = mk(a2, inner);
      return `M${s1.x} ${s1.y} L${s2.x} ${s2.y} A${r} ${r} 0 0 1 ${e2.x} ${e2.y} L${e1.x} ${e1.y} A${inner} ${inner} 0 0 0 ${s1.x} ${s1.y}Z`;
    };
    const dirs = [
      { angle: -90, label: "▲" }, { angle: 0, label: "▶" },
      { angle: 90, label: "▼" }, { angle: 180, label: "◀" },
    ];
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <ellipse cx={x} cy={y - r * 0.25} rx={r * 0.6} ry={r * 0.2} fill="rgba(255,255,255,0.08)" />
        {dirs.map(({ angle }) => (
          <path key={angle} d={sector(angle - 44, angle + 44)} fill="transparent"
            stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
        ))}
        <circle cx={x} cy={y} r={inner} fill={fill} stroke="rgba(0,0,0,0.2)" strokeWidth={2} />
        {dirs.map(({ angle, label }) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <text key={label} x={x + Math.cos(rad) * r * 0.63} y={y + Math.sin(rad) * r * 0.63}
              textAnchor="middle" dominantBaseline="central" fontSize={r * 0.3} fontWeight={700}
              fill="rgba(255,255,255,0.55)" style={{ fontFamily: "monospace" }}>{label}</text>
          );
        })}
      </g>
    );
  }

  if (b.type === "abxy") {
    const spread = r * 0.71;
    const br = r * 0.40;
    const pts = [
      { dx: 0, dy: -spread, l: "Y", c: FACE.y },
      { dx: -spread, dy: 0, l: "X", c: FACE.x },
      { dx: spread, dy: 0, l: "B", c: FACE.b },
      { dx: 0, dy: spread, l: "A", c: FACE.a },
    ];
    return (
      <g>
        {pts.map((p) => (
          <g key={p.l}>
            <circle cx={x + p.dx} cy={y + p.dy} r={br} fill={fill} stroke={stroke} strokeWidth={1.5} />
            <text x={x + p.dx} y={y + p.dy} textAnchor="middle" dominantBaseline="central"
              fontSize={br * 0.52} fontWeight={800} fill="rgba(255,255,255,0.85)"
              style={{ fontFamily: "'Inter',sans-serif" }}>{p.l}</text>
          </g>
        ))}
      </g>
    );
  }

  if (b.type === "thumbstick") {
    const tag = b.label.toUpperCase().startsWith("HYBRID") ? "H"
      : b.label.toUpperCase().startsWith("L") ? "L" : "R";
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <circle cx={x} cy={y} r={r * 0.48} fill="#d8d8d8" stroke="rgba(150,150,150,0.3)" strokeWidth={2} />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
          fontSize={r * 0.35} fontWeight={800} fill="rgba(40,40,40,0.9)"
          style={{ fontFamily: "'Inter',sans-serif" }}>{tag}</text>
      </g>
    );
  }

  if (b.type === "stickmode") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={`rgba(${ACCENT_RGB}, 0.12)`} stroke={stroke} strokeWidth={1.5} />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
          fontSize={r * 0.42} fontWeight={800} fill="rgba(255,255,255,0.85)"
          style={{ fontFamily: "'Inter',sans-serif" }}>{b.label === "R-Mod" ? "R" : "L"}</text>
      </g>
    );
  }

  if (b.type === "touchpad") {
    // The same art the live pad uses (idle state), so the editor shows exactly what players get.
    const { w, h } = touchpadSize(b);
    return <TouchpadArt id={b.uid} x={x} y={y} w={w} h={h} label={b.label === "Touchpad" ? undefined : b.label} round={isRoundPad(b)} />;
  }

  if (b.type === "trigger") {
    const w = b.w ?? r * 2;
    const h = b.h ?? r * 5.85;
    return (
      <g>
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w * 0.4} fill={fill} stroke={stroke} strokeWidth={1.5} />
        {/* same place and size as the live TriggerPill label: baseline 22 above the bottom edge */}
        <text x={x} y={y + h / 2 - 22} textAnchor="middle"
          fontSize={w * 0.32} fontWeight={800} fill="rgba(255,255,255,0.85)"
          style={{ fontFamily: "'Inter',sans-serif" }}>{b.label || "T"}</text>
      </g>
    );
  }

  // System buttons (view / home / menu) render an icon, matching gameplay.
  if (b.label === "view") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <g transform={`translate(${x},${y})`} style={{ stroke: "rgba(255,255,255,0.85)", strokeWidth: r * 0.07, fill: "none" }}>
          <rect x={-r * 0.28} y={-r * 0.28} width={r * 0.56} height={r * 0.22} rx={2} />
          <rect x={-r * 0.28} y={r * 0.05} width={r * 0.56} height={r * 0.22} rx={2} />
        </g>
      </g>
    );
  }
  if (b.label === "home" || b.label === "menu") {
    return (
      <g>
        <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
          fontSize={r * (b.label === "home" ? 0.6 : 0.7)} fontWeight={800} fill="rgba(255,255,255,0.85)"
          style={{ fontFamily: "'Inter',sans-serif" }}>{b.label === "home" ? "🎮" : "≡"}</text>
      </g>
    );
  }

  // Rectangular button (explicit width/height) — must mirror gameplay Btn.
  if (b.w != null && b.h != null) {
    const rx = Math.min(b.w, b.h) * (b.rxFactor ?? 0.28);
    return (
      <g>
        <rect x={x - b.w / 2} y={y - b.h / 2} width={b.w} height={b.h} rx={rx}
          fill={fill} stroke={stroke} strokeWidth={1.5} />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
          fontSize={Math.min(b.w, b.h) * 0.42} fontWeight={800} fill="rgba(255,255,255,0.85)"
          style={{ fontFamily: "'Inter',sans-serif" }}>{buttonText(b.label) || (b.type === "macro" ? "M" : "B")}</text>
      </g>
    );
  }

  // button / macro (circle)
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fontSize={r * 0.52} fontWeight={800} fill="rgba(255,255,255,0.85)"
        style={{ fontFamily: "'Inter',sans-serif" }}>{buttonText(b.label) || (b.type === "macro" ? "M" : "B")}</text>
    </g>
  );
});

// One tile of the "+" popup (addItems.ts) as the widget it would be: the same drawing as on the pad, centred in its tile.
const tilePreview = (it: AddItem): CustomBtnDef => ({
  uid: `tile-${it.tag}`, type: it.type, shape: it.type === "trigger" || it.type === "touchpad" ? "rect" : "circle",
  opacity: 1, haptic: 0, macroBits: [], label: it.label, x: it.vw / 2, y: it.vh / 2, r: it.pr, w: it.pw, h: it.ph,
  normColor: DEFAULT_NORM, heldColor: DEFAULT_HELD,
});
// Built once: the same objects every render, so each tile's memoised preview never redraws while the popup is open.
const ADD_TILES = ADD_ITEMS.map((it) => ({ it, b: tilePreview(it) }));

export function CustomPadEditor({
  pad,
  onSave,
  onClose,
  onCancel,
}: {
  pad: CustomPad;
  onSave: (p: CustomPad) => void;
  onClose?: () => void;
  onCancel?: () => void;
}) {
  const close = onClose || onCancel || (() => {});
  const [buttons, setButtons] = useState<CustomBtnDef[]>(pad.buttons || []);
  // Editable pad name (rename from inside the canvas).
  const [padName, setPadName] = useState<string>(pad.name || "My Custom Pad");
  const [renaming, setRenaming] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Settings stay CLOSED on select so the widget can be dragged first — the
  // panel would otherwise cover the very button being placed. Opened via the
  // gear button in the toolbar.
  const [showSettings, setShowSettings] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const reduceMotion = useReducedMotion();   // the "+" popup then only fades: no growth, no stagger
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  React.useEffect(() => {
    (window as any).__editorBack = () => {
      if (showExitConfirm) setShowExitConfirm(false);
      else if (showSettings) setShowSettings(false);
      else if (showAddMenu) setShowAddMenu(false);
      else if (renaming) setRenaming(false);
      else {
        const clean = JSON.stringify(buttons) === initialButtonsJson.current
          && (padName.trim() || pad.name) === (pad.name || "");
        if (clean) close(); else setShowExitConfirm(true);
      }
      return true;
    };
    return () => { delete (window as any).__editorBack; };
  }, [showExitConfirm, showSettings, showAddMenu, renaming, buttons, padName, pad.name, close]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Snapshot of the pad as it was opened — the back button compares against it
  // so an untouched editor closes silently instead of asking "save changes?".
  const initialButtonsJson = useRef(JSON.stringify(pad.buttons || []));

  const dragInfo = useRef<{ id: string; sx: number; sy: number; bx: number; by: number } | null>(null);
  const pendingDrag = useRef<{ dx: number; dy: number } | null>(null);
  const rafId = useRef<number | null>(null);

  // Physically rotate the device to landscape AND hide the status/navigation
  // bars while the editor is open — same native bridge the controller screen
  // uses. (The CSS rotation only spins the web content; without this the phone
  // stays physically portrait and shows its portrait system bars.) On unmount
  // we hand control back to portrait so the dashboard returns to normal.
  React.useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.setScreenOrientation) {
      try { bridge.setScreenOrientation("landscape"); } catch {}
    }
    return () => {
      const b = (window as any).AndroidBridge;
      if (b && b.setScreenOrientation) {
        try { b.setScreenOrientation("portrait"); } catch {}
      }
    };
  }, []);

  // Track viewport so the editor can auto-rotate into landscape (exactly like
  // the controller screen) instead of asking the user to rotate their phone.
  const [winSize, setWinSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setWinSize({ w: window.innerWidth, h: window.innerHeight }), 120);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, []);
  // On a real device the native bridge physically rotates the screen to
  // landscape (handled by openEditor), so NO CSS rotation is needed — that's
  // what removes the visible "spin". CSS rotation is only a fallback for desktop
  // browsers / when the bridge is absent.
  const hasBridge = typeof window !== "undefined" && !!(window as any).AndroidBridge;
  const isPortrait = winSize.h > winSize.w;
  const rotStyle: React.CSSProperties = (!hasBridge && isPortrait)
    ? { transform: "rotate(90deg) translateY(-100%)", transformOrigin: "top left", width: `${winSize.h}px`, height: `${winSize.w}px` }
    : {};

  // Rotation-safe screen→SVG mapping. matrixTransform reflects the live CSS
  // transform, so dragging stays correct in both orientations.
  const toSVG = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const r = pt.matrixTransform(m.inverse());
    return { x: r.x || 0, y: r.y || 0 };
  };

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    // Selecting a different widget keeps the panel state per-tap simple: close
    // it so the fresh selection can be moved without the panel hiding it.
    if (id !== selectedId) setShowSettings(false);
    setSelectedId(id);
    setShowAddMenu(false);
    const cur = toSVG(e.clientX, e.clientY);
    const btn = buttons.find((b) => b.uid === id);
    if (btn) {
      dragInfo.current = { id, sx: cur.x, sy: cur.y, bx: btn.x, by: btn.y };
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragInfo.current) return;
    const cur = toSVG(e.clientX, e.clientY);
    const dx = cur.x - dragInfo.current.sx;
    const dy = cur.y - dragInfo.current.sy;
    if (isNaN(dx) || isNaN(dy)) return;

    // Coalesce to one state update per animation frame. Pointer events fire far
    // faster than the screen refreshes; without this each event forces its own
    // synchronous re-render, which is what makes dragging feel laggy.
    pendingDrag.current = { dx, dy };
    if (rafId.current == null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const p = pendingDrag.current;
        const di = dragInfo.current;
        if (!p || !di) return;
        const nx = Math.round(di.bx + p.dx);
        const ny = Math.round(di.by + p.dy);
        if (isNaN(nx) || isNaN(ny)) return;
        setButtons((prev) => prev.map((b) => (b.uid === di.id ? { ...b, x: nx, y: ny } : b)));
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragInfo.current) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
      dragInfo.current = null;
      pendingDrag.current = null;
      if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
    }
  };

  const selectedBtn = buttons.find((b) => b.uid === selectedId);
  const isCustomSize = selectedBtn?.w !== undefined && selectedBtn?.h !== undefined;

  const updateSelectedBtn = (updates: Partial<CustomBtnDef>) =>
    setButtons((prev) => prev.map((b) => (b.uid === selectedId ? { ...b, ...updates } : b)));

  // rAF-coalesced resize: sliders fire onChange far faster than the screen
  // refreshes; batching to one update per frame keeps resizing smooth.
  const pendingResize = useRef<Partial<CustomBtnDef> | null>(null);
  const resizeRaf = useRef<number | null>(null);
  const queueResize = (updates: Partial<CustomBtnDef>) => {
    pendingResize.current = { ...pendingResize.current, ...updates };
    if (resizeRaf.current == null) {
      resizeRaf.current = requestAnimationFrame(() => {
        resizeRaf.current = null;
        const u = pendingResize.current;
        pendingResize.current = null;
        if (u) updateSelectedBtn(u);
      });
    }
  };

  const handleDelete = () => {
    setButtons((prev) => prev.filter((b) => b.uid !== selectedId));
    setSelectedId(null);
    setShowSettings(false);
  };

  // ── Settings panel position ──
  // Drag is done with raw pointer events on the header and written straight to the element's style, so a drag
  // re-renders nothing; the position is committed to state on release (and re-clamped if the screen is resized).
  const toolbarRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const panelDrag = useRef<{ sx: number; sy: number; x: number; y: number; cur?: { x: number; y: number } } | null>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const rotated = !hasBridge && isPortrait;
  const layerW = rotated ? winSize.h : winSize.w;
  const layerH = rotated ? winSize.w : winSize.h;
  const clampPanel = (x: number, y: number) => {
    const h = (panelBodyRef.current?.offsetHeight ?? 0) * PANEL_SCALE;
    return {
      x: Math.max(PANEL_EDGE, Math.min(layerW - PANEL_W * PANEL_SCALE - PANEL_EDGE, x)),
      y: Math.max(PANEL_EDGE, Math.min(layerH - h - PANEL_EDGE, y)),
    };
  };
  // ── Toolbar position (draggable) ──
  // Held as a fraction of the layer and turned into pixels here, clamped so even the WIDE toolbar stays on screen.
  const [tbFrac, setTbFrac] = useState<{ fx: number; fy: number } | null>(loadToolbarFrac);
  const clampTb = (cx: number, top: number) => ({
    cx: Math.max(TOOLBAR_WIDE / 2 + TOOLBAR_EDGE, Math.min(layerW - TOOLBAR_WIDE / 2 - TOOLBAR_EDGE, cx)),
    top: Math.max(TOOLBAR_EDGE, Math.min(layerH - TOOLBAR_H - TOOLBAR_EDGE, top)),
  });
  const tb = tbFrac ? clampTb(tbFrac.fx * layerW, tbFrac.fy * layerH) : clampTb(layerW / 2, TOOLBAR_EDGE);
  const tbLow = tb.top + TOOLBAR_H / 2 > layerH / 2;      // in the lower half: things open ABOVE it instead of below
  // The drag follows the finger across the WHOLE screen (window listeners), not only while it is over the toolbar,
  // so a fast swipe never loses it. Taps are untouched: under TOOLBAR_DRAG_SLOP px of movement nothing happens and
  // the button's own click runs; after a real drag the one click the browser sends on release is swallowed.
  const toolbarDragging = useRef(false);
  const onToolbarDown = (e: React.PointerEvent) => {
    if (renaming || toolbarDragging.current || !toolbarRef.current) return;   // typing a name: the text box gets the touch
    const el = toolbarRef.current;
    const sx = e.clientX, sy = e.clientY, start = { cx: tb.cx, top: tb.top }, id = e.pointerId;
    let moved = false;
    let cur = start;
    toolbarDragging.current = true;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < TOOLBAR_DRAG_SLOP) return;
        moved = true;
        setShowAddMenu(false);
      }
      const l = toLayerDelta(dx, dy);
      cur = clampTb(start.cx + l.x, start.top + l.y);
      el.style.left = cur.cx + "px";                         // straight to the element: a drag re-renders nothing
      el.style.top = cur.top + "px";
    };
    const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      toolbarDragging.current = false;
      if (!moved) return;
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      const f = { fx: cur.cx / layerW, fy: cur.top / layerH };
      setTbFrac(f); saveToolbarFrac(f);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // First opening: centred on the toolbar with a real gap so the two never touch: under it, or above it when the
  // toolbar has been dragged into the lower half of the screen.
  const defaultPanelPos = () => {
    const h = (panelBodyRef.current?.offsetHeight ?? 0) * PANEL_SCALE;
    const x = tb.cx - (PANEL_W * PANEL_SCALE) / 2;
    const y = tbLow ? tb.top - PANEL_GAP - h : tb.top + TOOLBAR_H + PANEL_GAP;
    return clampPanel(x, y);
  };
  const pos = panelPos ?? defaultPanelPos();
  // A screen-space drag, expressed in the layer's own axes (they differ only in the rotated desktop fallback).
  const toLayerDelta = (dx: number, dy: number) => (rotated ? { x: dy, y: -dx } : { x: dx, y: dy });
  const onPanelDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    panelDrag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
  };
  const onPanelMove = (e: React.PointerEvent) => {
    const d = panelDrag.current;
    if (!d || !panelRef.current) return;
    const l = toLayerDelta(e.clientX - d.sx, e.clientY - d.sy);
    const next = clampPanel(d.x + l.x, d.y + l.y);
    d.cur = next;
    panelRef.current.style.left = next.x + "px";
    panelRef.current.style.top = next.y + "px";
  };
  const onPanelUp = (e: React.PointerEvent) => {
    const d = panelDrag.current;
    panelDrag.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
    if (d?.cur) setPanelPos(d.cur);
  };
  React.useEffect(() => { setPanelPos((p) => (p ? clampPanel(p.x, p.y) : p)); }, [layerW, layerH]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAndClose = () => {
    onSave({ ...pad, name: padName.trim() || pad.name, buttons });
    close();
  };

  const addWidget = (type: WidgetType, label: string, r?: number) => {
    const newBtn: CustomBtnDef = {
      uid: `cb${Date.now()}`,
      type,
      shape: type === "trigger" || type === "touchpad" ? "rect" : "circle",
      opacity: 1,
      haptic: 60,
      macroBits: [],
      label,
      x: CX,
      y: CY,
      r: r ?? DEFAULT_R[type] ?? 80,
      normColor: DEFAULT_NORM,
      heldColor: DEFAULT_HELD,
    };
    setButtons((prev) => [...prev, newBtn]);
    setShowAddMenu(false);
    setSelectedId(newBtn.uid);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: EXIT }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      style={{ willChange: "transform, opacity", backfaceVisibility: "hidden" }}
      data-testid="layout-editor-screen" className="fixed inset-0 z-50 bg-[#070910] overflow-hidden touch-none select-none"
    >
      <ShellMotion />
      {/* Rotation layer — auto-rotates the whole editor (canvas + overlays) into
          landscape in portrait, mirroring the controller screen. No rotate-wall.
          MUST be a plain div: Framer Motion would drive the `transform` property
          and clobber the rotate() here. The opening animation lives on the root
          motion.div above, which composes with this rotation correctly. */}
      <div className="absolute inset-0" style={rotStyle}>
          <div className="absolute inset-0 flex items-center justify-center" onPointerDown={() => { setSelectedId(null); setShowSettings(false); setShowAddMenu(false); }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              className="w-full h-full max-h-full"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ touchAction: "none" }}
            >
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

              {buttons.map((b) => {
                const sel = b.uid === selectedId;
                const box = widgetBox(b);
                return (
                  <g
                    key={b.uid}
                    onPointerDown={(e) => handlePointerDown(e, b.uid)}
                    style={{ cursor: "grab" }}
                  >
                    {sel && (
                      <rect
                        x={box.x - 6} y={box.y - 6} width={box.w + 12} height={box.h + 12}
                        rx={16} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="7 7"
                      />
                    )}
                    <g style={{ pointerEvents: "none" }}>
                      <WidgetPreview b={b} />
                    </g>
                    <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />
                  </g>
                );
              })}
            </svg>
          </div>

      {/* "+" popup: a container that grows out of the "+" button, one big tile per button drawn as it looks on the
          pad. Tap a tile to add it; tap outside, the "+" again, or Back to close. The dim is a plain scrim (no blur:
          a blur re-renders every frame while it fades). It sits below the toolbar (later in the tree), so the "+"
          stays tappable. Motion tokens live in motion.ts (popupIn, tileIn). With reduced motion it only fades. */}
      <AnimatePresence>
        {showAddMenu && (
          <motion.div key="add-scrim" {...backdropIn} exit={{ opacity: 0, pointerEvents: "none", transition: EXIT }} transition={FADE} className="absolute inset-0 bg-black/55"
            onPointerDown={() => setShowAddMenu(false)} />
        )}
        {showAddMenu && (
          <motion.div
            key="add-popup"
            {...popupIn}
            exit={reduceMotion ? { opacity: 0, pointerEvents: "none" as const, transition: EXIT } : popupIn.exit}
            transition={SPRING}
            role="dialog" aria-label="Add a button"
            className="gp-shell console-editor-panel absolute left-0 right-0 mx-auto w-[62%] min-w-[300px] max-w-[620px] border p-3 flex flex-col"
            /* Opens under the toolbar (or above it when the toolbar sits in the lower half) and grows out of the "+"
               wherever the toolbar has been dragged (see PLUS_OFFSET). */
            style={tbLow
              ? { bottom: layerH - tb.top + 8, maxHeight: tb.top - 16, transformOrigin: `calc(50% + ${tb.cx + PLUS_OFFSET - layerW / 2}px) 100%` }
              : { top: tb.top + TOOLBAR_H + 8, maxHeight: layerH - tb.top - TOOLBAR_H - 16, transformOrigin: `calc(50% + ${tb.cx + PLUS_OFFSET - layerW / 2}px) 0px` }}
          >
            <div className="grid gap-2 overflow-y-auto overscroll-contain touch-pan-y min-h-0 justify-center"
              style={{ gridTemplateColumns: `repeat(auto-fill, ${ADD_CELL}px)`, gridAutoRows: `${ADD_CELL}px`, gridAutoFlow: "dense" }}>
              {ADD_TILES.map(({ it, b }, i) => (
                <motion.button
                  key={it.tag}
                  data-testid={`add-${it.tag.toLowerCase().replace(/\s/g, '-')}-widget-button`}
                  aria-label={`Add ${it.tag}`}
                  variants={tileIn} initial="initial" animate="animate" custom={reduceMotion ? 0 : i}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => addWidget(it.type, it.label, it.r)}
                  className="rounded-2xl bg-white/[0.07] hover:bg-white/10 p-1.5"
                  style={{ gridColumn: `span ${it.cols}`, gridRow: `span ${it.rows}` }}
                >
                  <svg viewBox={`0 0 ${it.vw} ${it.vh}`} className="w-full h-full pointer-events-none"><WidgetPreview b={b} /></svg>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fluid toolbar: top-centre at first; slide it to move it anywhere (its place is remembered). The wrapper is
          positioned by its CENTRE, so the toolbar grows evenly both ways when it widens. */}
      <div ref={toolbarRef} className="absolute flex justify-center pointer-events-none"
        style={{ left: tb.cx, top: tb.top, transform: "translateX(-50%)" }}>
        <motion.div
          layout
          data-testid="editor-toolbar"
          className="gp-shell console-editor-toolbar border flex items-center p-1.5 pointer-events-auto overflow-hidden"
          style={{ width: selectedId || renaming ? `${TOOLBAR_WIDE}px` : `${TOOLBAR_W}px`, touchAction: "none" }}
          transition={SPRING}
          onPointerDown={onToolbarDown}
        >
          <div className="w-full flex justify-between items-center relative">
            <button
              data-testid="editor-back-button" aria-label="Exit layout editor"
              onClick={() => {
                // Nothing changed → close silently; only a real edit earns the
                // "save changes?" confirmation. A renamed pad also counts as dirty.
                const clean = JSON.stringify(buttons) === initialButtonsJson.current
                  && (padName.trim() || pad.name) === (pad.name || "");
                if (clean) close();
                else setShowExitConfirm(true);
              }}
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white active:scale-95 transition-all z-10">
              <ArrowLeft size={20} />
            </button>
            <AnimatePresence initial={false}>
              {!selectedId && (
                <motion.div key="name"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: EXIT }}
                  transition={SPRING_SNAP}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 console-editor-name"
                >
                  {/* Rename the layout right here in the toolbar (nothing is laid over the pad). */}
                  {renaming ? (
                    <input
                      autoFocus
                      value={padName}
                      onChange={(e) => setPadName(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => setRenaming(false)}
                      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
                      maxLength={32}
                      aria-label="Layout name"
                      placeholder="Layout name"
                    />
                  ) : (
                    <button data-testid="rename-layout-button" aria-label={`Rename layout: ${padName || "My Custom Pad"}`} title={padName || "My Custom Pad"}
                      onClick={() => setRenaming(true)} className="console-editor-pencil active:scale-95 transition-all">
                      <Pencil size={18} aria-hidden="true" />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {selectedId && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6, transition: EXIT }}
                  transition={SPRING_SNAP}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
                >
                  {/* Gear TOGGLES the settings panel — selection alone never
                      opens it, so a freshly selected widget can be dragged
                      without the panel covering it. */}
                  <button
                    data-testid="widget-settings-button" aria-label="Widget settings"
                    onClick={() => setShowSettings((s) => !s)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all ${
                      showSettings ? "bg-primary text-black" : "bg-primary/20 text-primary"
                    }`}
                  >
                    <Settings size={20} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <button data-testid="add-widget-button" aria-label={showAddMenu ? "Close" : "Add widget"} aria-expanded={showAddMenu} onClick={() => { setShowAddMenu((v) => !v); setSelectedId(null); }} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white active:scale-95 transition-all z-10">
              <motion.span animate={{ rotate: showAddMenu ? 45 : 0 }} transition={SPRING_SNAP} className="flex"><Plus size={20} /></motion.span>
            </button>
          </div>
        </motion.div>
      </div>

      {/* Settings panel */}
      {/* NOTE: the motion.div MUST be the AnimatePresence child — a plain div
          there breaks framer's exit tracking and leaves the whole editor stuck
          mounted (invisible, still swallowing taps) after it closes. */}
      <AnimatePresence>
        {selectedBtn && showSettings && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, pointerEvents: "none" as const, transition: EXIT }}
            transition={SPRING}
            className="absolute z-10"
            style={{ left: pos.x, top: pos.y, width: 0, height: 0 }}
          >
          <div ref={panelBodyRef} data-testid="widget-settings-panel"
            className="gp-shell console-editor-panel absolute left-0 top-0 border p-5 flex flex-col overflow-hidden"
            style={{ width: PANEL_W, maxHeight: (layerH - pos.y - PANEL_EDGE) / PANEL_SCALE, transform: `scale(${PANEL_SCALE})`, transformOrigin: "top left" }}>
            {/* The header is the drag handle: hold it and move the panel anywhere on the screen. */}
            <div data-testid="widget-settings-handle" className="flex items-center justify-between gap-2 mb-4 cursor-grab active:cursor-grabbing"
              style={{ touchAction: "none" }}
              onPointerDown={onPanelDown} onPointerMove={onPanelMove} onPointerUp={onPanelUp} onPointerCancel={onPanelUp}>
              <span className="text-white font-bold text-sm capitalize">{selectedBtn.type} settings</span>
              <GripHorizontal size={18} className="text-zinc-500 flex-1" aria-hidden="true" />
              <button onPointerDown={(e) => e.stopPropagation()} onClick={handleDelete} aria-label="Delete button" className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 active:scale-90 transition-all">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y">

            {/* Warn if this widget's label won't map to any real gamepad input —
                e.g. a legacy custom button with a free-text label. Such a button
                renders but sends nothing to the PC. */}
            {!SELF_MAPPED_TYPES.has(selectedBtn.type) && !KNOWN_BUTTON_LABELS.has(selectedBtn.label) && (
              <div className="mb-4 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-start gap-2">
                <TriangleAlert size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-amber-200 leading-snug">
                  “{selectedBtn.label}” isn’t a gamepad input. Use A, B, X, Y, LB, RB, LT or RT.
                </span>
              </div>
            )}

            {/* Rectangular mode — available for triggers and plain buttons/macros.
                Compound widgets (dpad/abxy/stick) stay single-radius. */}
            {(selectedBtn.type === "trigger" || selectedBtn.type === "button" || selectedBtn.type === "macro") && (
              <label className="flex items-center gap-2 mb-4 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox" className="accent-primary w-4 h-4"
                  checked={isCustomSize}
                  onChange={(e) =>
                    e.target.checked
                      ? updateSelectedBtn({ w: selectedBtn.r * 2, h: selectedBtn.r * 2 })
                      : updateSelectedBtn({ w: undefined, h: undefined })
                  }
                />
                Rectangular
              </label>
            )}

            {selectedBtn.type === "touchpad" ? (
              <TouchpadSettings
                b={selectedBtn}
                update={queueResize}
                slider={(value, min, max, onChange) => <RangeSlider min={min} max={max} value={value} onChange={onChange} />}
              />
            ) : !isCustomSize ? (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Size</span>
                <RangeSlider min={40} max={320} value={selectedBtn.r}
                  onChange={(v) => queueResize({ r: v })} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Width</span>
                  {/* Width capped at 20% of canvas width (full width was too wide). */}
                  <RangeSlider min={30} max={Math.round(CANVAS_W * 0.2)} value={selectedBtn.w!}
                    onChange={(v) => queueResize({ w: v })} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Height</span>
                  {/* Max = full canvas height (570). */}
                  <RangeSlider min={30} max={CANVAS_H} value={selectedBtn.h!}
                    onChange={(v) => queueResize({ h: v })} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Roundness</span>
                  {/* Corner radius as a % of the shorter side: 0 = sharp square, 50 = full pill. */}
                  <RangeSlider min={0} max={50} value={Math.round((selectedBtn.rxFactor ?? 0.28) * 100)}
                    onChange={(v) => queueResize({ rxFactor: v / 100 })} />
                </div>
              </div>
            )}

            {/* Trigger response mode — Throttle (analog, drag 0-100%) vs Normal
                (digital, tap = instant 100%). Applies to every "trigger" widget
                (LT/RT and custom ones like GAS/BRAKE/AIM/FIRE). */}
            {selectedBtn.type === "trigger" && (
              <div className="flex flex-col gap-1 mt-4">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Response</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateSelectedBtn({ analogTrigger: true })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                      (selectedBtn.analogTrigger ?? true) ? "bg-primary text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    Throttle
                  </button>
                  <button
                    onClick={() => updateSelectedBtn({ analogTrigger: false })}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${
                      selectedBtn.analogTrigger === false ? "bg-primary text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    Normal
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Exit confirmation modal — inside the rotation layer so it is shown in
          landscape, matching the rest of the editor. motion.div is the
          AnimatePresence child (see settings-panel note). */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            {...backdropIn}
            transition={FADE}
            className="absolute inset-0 z-[100] flex items-center justify-center px-4 console-editor-confirm-scrim"
            onPointerDown={(e) => { if (e.target === e.currentTarget) setShowExitConfirm(false); }}
          >
            {/* In the app's own colours (owner, 2026-11-08: it still had the old grey/red look). Styles: redesign.css
                section 22 (.console-editor-confirm). */}
            <motion.div
              {...cardIn}
              transition={SPRING}
              role="dialog" aria-modal="true" aria-labelledby="editor-confirm-title" className="gp-shell console-editor-confirm pointer-events-auto"
            >
              <h3 id="editor-confirm-title">Save changes?</h3>
              <p>You changed this layout. Save it before you leave the editor?</p>
              <button data-testid="editor-save-quit-button" className="console-editor-confirm-primary"
                onClick={() => { setShowExitConfirm(false); handleSaveAndClose(); }}>Save and exit</button>
              <div className="console-editor-confirm-row">
                <button data-testid="editor-discard-button" className="console-editor-confirm-danger"
                  onClick={() => { setShowExitConfirm(false); close(); }}>Discard</button>
                <button data-testid="editor-keep-editing-button" onClick={() => setShowExitConfirm(false)}>Keep editing</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>{/* end rotation layer */}
    </motion.div>
  );
}
