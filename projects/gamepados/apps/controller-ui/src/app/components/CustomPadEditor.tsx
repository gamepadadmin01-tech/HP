import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, ArrowLeft, Settings, Trash2, Pencil, TriangleAlert } from "lucide-react";
import { useShellAppearance } from "./CalmShell";
import { ShellMotion } from "./ShellMotion";
import { CustomPad, CustomBtnDef, WidgetType } from "../types";
import { RED_NORM, ACCENT_RGB, buttonText } from "./Widgets";
import { TouchpadArt } from "./Touchpad";
import { TouchpadSettings } from "./TouchpadSettings";
import { ADD_MAP, AddItem } from "../addMap";
import { touchpadSize, isRoundPad } from "../touchpad";
import { SPRING, SPRING_SNAP, FADE, EXIT, cardIn, backdropIn } from "../motion";

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

const DEFAULT_NORM = "rgba(79, 134, 198, 0.12)";
const DEFAULT_HELD = "rgba(79, 134, 198, 0.85)";

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

// One projected button of the "+" map (addMap.ts), as the widget it would be: same drawing as on the pad.
const ghostOf = (it: AddItem): CustomBtnDef => ({
  uid: `ghost-${it.tag}`, type: it.type, shape: it.type === "trigger" || it.type === "touchpad" ? "rect" : "circle",
  opacity: 1, haptic: 0, macroBits: [], label: it.label, x: it.x, y: it.y, r: it.gr ?? 40, w: it.gw, h: it.gh,
  normColor: DEFAULT_NORM, heldColor: DEFAULT_HELD,
});

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
  const { appearance } = useShellAppearance();
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

      {/* "+" projection: every addable button drawn where it belongs on a controller, straight over the
          canvas. No panel and no cards. Tap one to add it; tap the empty canvas to close. It sits below the
          toolbar (later in the tree) so the toolbar stays usable. */}
      <AnimatePresence>
        {showAddMenu && (
          <motion.div
            key="add-projection"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: EXIT }}
            transition={FADE}
            className="absolute inset-0 flex items-center justify-center"
          >
            <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="w-full h-full max-h-full" style={{ touchAction: "none" }}>
              <rect width={CANVAS_W} height={CANVAS_H} fill="rgba(7,9,16,0.84)" onClick={() => setShowAddMenu(false)} />
              {ADD_MAP.map((it) => {
                const g = ghostOf(it);
                const bx = widgetBox(g);
                return (
                  <g key={it.tag} role="button" tabIndex={0} aria-label={`Add ${it.tag}`}
                    data-testid={`add-${it.tag.toLowerCase().replace(/\s/g, '-')}-widget-button`}
                    className="cursor-pointer transition-opacity duration-150 hover:opacity-100 active:opacity-60"
                    style={{ opacity: 0.92 }}
                    onClick={() => addWidget(it.type, it.label, it.r)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") addWidget(it.type, it.label, it.r); }}>
                    <g style={{ pointerEvents: "none" }}><WidgetPreview b={g} /></g>
                    <rect x={bx.x - 6} y={bx.y - 6} width={bx.w + 12} height={bx.h + 12} fill="transparent" />
                  </g>
                );
              })}
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename pill — top-left. Tap to edit the pad's name inline. */}
      <div data-calm-theme={appearance} className="gp-shell console-editor-rename absolute top-2 left-3 z-20 pointer-events-auto">
        {renaming ? (
          <input
            autoFocus
            value={padName}
            onChange={(e) => setPadName(e.target.value)}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
            maxLength={24}
            className="bg-zinc-900 border border-primary/60 rounded-full px-3 py-1.5 text-xs font-semibold text-white outline-none w-44"
            placeholder="Pad name"
          />
        ) : (
          <button
            data-testid="rename-layout-button"
            onClick={() => setRenaming(true)}
            className="bg-zinc-900/95 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-white/90 hover:text-white active:scale-95 transition-all shadow-lg max-w-[11rem]"
          >
            <span className="truncate">{padName || "My Custom Pad"}</span>
            <Pencil size={12} className="text-primary flex-shrink-0" />
          </button>
        )}
      </div>

      {/* Fluid toolbar — pinned to the very top edge of the canvas */}
      <div className="absolute top-1 left-0 right-0 flex justify-center pointer-events-none">
        <motion.div
          layout
          data-calm-theme={appearance} className="gp-shell console-editor-toolbar border flex items-center p-1.5 pointer-events-auto overflow-hidden"
          style={{ width: selectedId ? "280px" : "120px" }}
          transition={SPRING}
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
            <button data-testid="add-widget-button" aria-label="Add widget" onClick={() => { setShowAddMenu(true); setSelectedId(null); }} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white active:scale-95 transition-all z-10">
              <Plus size={20} />
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
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: EXIT }}
            transition={SPRING}
            className="absolute top-16 left-0 right-0 bottom-4 flex justify-center pointer-events-none"
          >
          <div data-calm-theme={appearance} className="gp-shell console-editor-panel w-[300px] max-h-full self-start border p-5 pointer-events-auto overflow-y-auto overscroll-contain touch-pan-y">
            <div className="flex items-center justify-between mb-4">
              <span className="text-white font-bold text-sm capitalize">{selectedBtn.type} settings</span>
              <button onClick={handleDelete} className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 active:scale-90 transition-all">
                <Trash2 size={16} />
              </button>
            </div>

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
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
          >
            <motion.div
              {...cardIn}
              transition={SPRING}
              data-calm-theme={appearance} role="dialog" aria-label="Unsaved changes" className="gp-shell console-editor-panel border p-6 w-full max-w-[320px] pointer-events-auto"
            >
              <h3 className="text-white font-bold text-lg mb-2">Unsaved Changes</h3>
              <p className="text-zinc-400 text-sm mb-6">Do you want to save your changes before leaving?</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => { setShowExitConfirm(false); handleSaveAndClose(); }}
                  className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm active:scale-95 transition-all"
                >
                  Save & Quit
                </button>
                <button
                  onClick={() => { setShowExitConfirm(false); close(); }}
                  className="w-full py-3 rounded-xl bg-red-500/20 text-red-400 font-bold text-sm hover:bg-red-500/30 active:scale-95 transition-all"
                >
                  Discard Changes
                </button>
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="w-full py-3 rounded-xl bg-white/5 text-white font-bold text-sm hover:bg-white/10 active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>{/* end rotation layer */}
    </motion.div>
  );
}
