import React, { useRef } from "react";
import { BtnId } from "../types";

// Stick API shape — matches the object returned by useStick() in App.tsx.
// Declared here so RightStick stays a pure component (no hook import).
export type StickApi = {
  posRef: React.MutableRefObject<{ x: number; y: number }>;
  onDown: (e: React.PointerEvent, cx: number, cy: number) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (pointerId?: number) => void;
  knobRef: React.RefObject<SVGGElement | null>;
};

// ─── Controller colors — OLED-friendly premium neon and glassmorphic palette ──
// ONE source of truth for the pad accent. Every widget colour below derives from
// it, so a palette change is a one-line edit instead of hunting literals.
// Kept as a bare "r, g, b" string because SVG presentation attributes (fill=…)
// cannot resolve a CSS var() — only the style={{}} call sites could, and mixing
// the two would leave half the pad on the old colour.
// Matches --primary in the theme (Deep Teal #2CAABA).
export const ACCENT_RGB = "44, 170, 186";

// NOTE: the RED_* names are historical — these have not been red for a long
// time. Renaming would touch every widget call site, so the names stay and the
// values are what actually matter.
export const RED_NORM = `rgba(${ACCENT_RGB}, 0.12)`;  // resting fill
export const RED_HELD = `rgba(${ACCENT_RGB}, 0.85)`;  // pressed fill — the press
                                                      // feedback depends on this
                                                      // staying distinct from NORM
export const FACE_COLORS = {
  Y: { norm: "rgba(234, 179, 8, 0.15)", held: "rgba(234, 179, 8, 0.85)" },  // Neon Yellow
  X: { norm: "rgba(59, 130, 246, 0.15)", held: "rgba(59, 130, 246, 0.85)" }, // Neon Blue
  A: { norm: "rgba(34, 197, 94, 0.15)", held: "rgba(34, 197, 94, 0.85)" },  // Neon Green
  B: { norm: "rgba(239, 68, 68, 0.15)", held: "rgba(239, 68, 68, 0.85)" },  // Neon Red
};

// ─── Touch ripple (#5) ───────────────────────────────────────────────────────
// A wave that expands from the EXACT touch point to the button edges, clipped to
// the button shape. SVG-native: a <circle> whose `r` and opacity are CSS-
// transitioned (supported in the Chromium WebView), eased like a water droplet.
// The press haptic fires on the same pointer event, so visual + tactile stay in
// sync (see triggerHaptic → "ripple" composition in App.tsx).
type RippleHit = { k: number; x: number; y: number; grown: boolean };

function useSvgRipple() {
  const [ripples, setRipples] = React.useState<RippleHit[]>([]);
  const key = React.useRef(0);
  const spawn = React.useCallback((e: React.PointerEvent) => {
    // Map the screen touch point into the SVG's user space (same units as cx/cy/r).
    let x = 0, y = 0, ok = false;
    try {
      const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement as any;
      if (svg && svg.createSVGPoint) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const m = svg.getScreenCTM();
        if (m) { const p = pt.matrixTransform(m.inverse()); x = p.x; y = p.y; ok = true; }
      }
    } catch {}
    if (!ok) return;
    const k = ++key.current;
    setRipples(rs => (rs.length >= 4 ? rs.slice(-3) : rs).concat({ k, x, y, grown: false }));
    // Two rAFs so the circle paints at r=0 before transitioning to full size.
    requestAnimationFrame(() => requestAnimationFrame(() =>
      setRipples(rs => rs.map(r => (r.k === k ? { ...r, grown: true } : r)))));
    window.setTimeout(() => setRipples(rs => rs.filter(r => r.k !== k)), 540);
  }, []);
  return { ripples, spawn };
}

function rippleCircles(ripples: RippleHit[], cx: number, cy: number, coverBase: number) {
  return ripples.map(rp => {
    const coverR = coverBase + Math.hypot(rp.x - cx, rp.y - cy) + 4;
    return (
      <circle key={rp.k} cx={rp.x} cy={rp.y} r={rp.grown ? coverR : 0}
        fill="rgba(255,255,255,0.5)" opacity={rp.grown ? 0 : 0.5}
        style={{ transition: "r 0.5s cubic-bezier(0.22,1,0.36,1), opacity 0.54s ease-out", pointerEvents: "none" }} />
    );
  });
}

// ─── SVG Controller sub-components ───────────────────────────────────────────
// Light haptic on button RELEASE — paired with the press haptic so each button
// gives a two-stage "press + release" feel like the reference app. Calls the
// native bridge directly (Widgets stays decoupled from App.tsx); no-op if haptics
// are disabled or there's no bridge.
function releaseHaptic() {
  if (typeof window === "undefined" || (window as any).hapticsEnabled === false) return;
  try { (window as any).AndroidBridge?.playHaptic?.("buttonRelease"); } catch {}
}

// ─── Render isolation (gyro-stall fix) ───────────────────────────────────────
// Every press/release used to re-render EVERY widget on the pad: App.tsx passes
// `held` as a brand-new Set plus fresh inline dn/up closures each render, so one
// tap = the whole SVG tree re-rendered ~5× (down, up, 3 ripple states). On a
// midrange phone at idle clocks that render burst blocks the WebView main
// thread — the SAME thread running the 8ms gyro data loop and the gyro-bar rAF
// glide — so the gyro visibly froze on every button press.
// Each widget is therefore memo'd with a comparator that looks at what actually
// affects its pixels: geometry/style scalars and ITS OWN derived held state
// (held.has(id)), not the Set's identity. dn/up/onFillChange identity is
// deliberately IGNORED: those closures only capture per-pad constants (btn.haptic)
// and stable callbacks (dnCustom/upCustom), and every held-state flip re-renders
// the widget anyway, re-adopting fresh props — so a stale closure can never
// outlive the next press of that same widget.
function labelEq(a: React.ReactNode, b: React.ReactNode): boolean {
  if (a === b) return true;
  const prim = (v: any) => typeof v === "string" || typeof v === "number";
  if (prim(a) || prim(b)) return a === b;
  if (React.isValidElement(a) && React.isValidElement(b)) {
    if (a.type !== b.type) return false;
    // Icon labels (tspan/g/Fragment) are recreated inline each parent render but
    // never change content for a given button — compare primitive children when
    // present, otherwise treat same-type elements as equal.
    const ac = (a.props as any)?.children, bc = (b.props as any)?.children;
    return prim(ac) || prim(bc) ? ac === bc : true;
  }
  return false;
}

// ─── Shared glass lighting ───────────────────────────────────────────────────
// The pad is one <svg>, so backdrop-filter cannot apply here (SVG shapes have no
// backdrop root). Glass is built from lighting layers instead. All of these are
// colour-INDEPENDENT, so every widget keeps its own hue.
//
//   padSpec   bright crown fading by ~45%   = specular highlight on a curve
//   padRim    lit top-left -> dark bottom-right = an edge with a light source
//   padUnder  soft contact shadow            = it sits ON something
//   padPhong  real feSpecularLighting (Phong) from a point light
//
// Rendered by every widget. The ids are identical and colour-independent, so
// url(#…) resolving to the first instance is correct — one definition, not 61.
// OPTION C — real Phong specular via feSpecularLighting, on top of the gradients.
// Measured free at the real 61-shape count on a Redmi Note 13 (16.6ms median,
// 0 frames >20ms). It IS a filter though, so cost scales with the device: flip
// this to false and the gradient lighting alone still carries the look.
export const PAD_PHONG = true;
const phong = PAD_PHONG ? "url(#padPhong)" : undefined;

export function PadGlassDefs() {
  return (
    <defs>
      <linearGradient id="padSpec" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.42" />
        <stop offset="45%"  stopColor="#ffffff" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="padRim" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.50" />
        <stop offset="45%"  stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
      </linearGradient>
      <radialGradient id="padUnder" cx="0.5" cy="0.5" r="0.5">
        <stop offset="55%"  stopColor="#000000" stopOpacity="0.34" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
      {/* OPTION C — genuine Phong lighting. SourceAlpha is blurred into a bump
          map, feSpecularLighting reflects a point light off it, and the result is
          clipped back to the shape and added over the original. Measured free at
          the real 61-shape count on a Redmi Note 13 (16.6ms median, 0 frames
          >20ms), but it IS a filter, so cost scales with the device — the
          gradients above carry the look on weaker phones even if this is off. */}
      <filter id="padPhong" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="bump" />
        <feSpecularLighting in="bump" surfaceScale="3.2" specularConstant="0.9"
                            specularExponent="24" lightingColor="#ffffff" result="spec">
          <fePointLight x="-30" y="-60" z="110" />
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
        <feComposite in="SourceGraphic" in2="specClip" operator="arithmetic"
                     k1="0" k2="1" k3="1" k4="0" />
      </filter>
    </defs>
  );
}

function BtnBase({ cx, cy, r, label, id, held, dn, up, fontSize, normColor = RED_NORM, heldColor = RED_HELD, w, h, rxFactor }: {
  cx: number; cy: number; r: number; label: React.ReactNode;
  id: string; held: Set<any>; dn: (id: any) => void; up: (id: any) => void;
  fontSize?: number; normColor?: string; heldColor?: string;
  w?: number; h?: number; rxFactor?: number;
}) {
  const isHeld = held.has(id);
  // Rectangular when explicit width/height are set; otherwise a circle of radius r.
  const isRect = w != null && h != null;
  const fs = fontSize ?? (isRect ? Math.min(w!, h!) * 0.42 : r * 0.52);
  const rx = isRect ? Math.min(w!, h!) * (rxFactor ?? 0.28) : 0; // adjustable rounded corners
  const { ripples, spawn } = useSvgRipple();
  const clipId = "rip-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  const coverBase = isRect ? Math.hypot(w!, h!) / 2 : r;
  const span = isRect ? w! * 0.34 : r * 0.6;   // how far the wave shimmer travels
  return (
    <g style={{ cursor: "pointer", touchAction: "none" }}
      onPointerDown={(e) => {
        dn(id);
        spawn(e);
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn("Btn: Pointer capture failed", err);
        }
      }}
      onPointerUp={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        up(id);
        releaseHaptic();
      }}
      onPointerCancel={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        up(id);
      }}
      onLostPointerCapture={() => up(id)}>
      {/* Opaque black silhouette under the translucent body — invisible on the
          pure-black screen, but stops the gyro indicator (z-0, behind the canvas)
          shining through the ~90%-transparent button fills. */}
      {isRect ? (
        <rect x={cx - w! / 2} y={cy - h! / 2} width={w!} height={h!} rx={rx} fill="#000" style={{ pointerEvents: "none" }} />
      ) : (
        <circle cx={cx} cy={cy} r={r} fill="#000" style={{ pointerEvents: "none" }} />
      )}
      {/* Soft glow — always rendered so it can FADE in/out (opacity transitions,
          `transparent`/conditional mounts can't). Pale target so the press reads as
          a gentle bloom, not a hard flash. */}
      {isRect ? (
        <rect x={cx - w! / 2 - 6} y={cy - h! / 2 - 6} width={w! + 12} height={h! + 12} rx={rx + 6}
          fill={heldColor} style={{ pointerEvents: "none", filter: "blur(12px)", opacity: isHeld ? 0.11 : 0, transition: "opacity 0.2s ease-out" }} />
      ) : (
        <circle cx={cx} cy={cy} r={r + 14} fill={heldColor}
          style={{ pointerEvents: "none", filter: "blur(12px)", opacity: isHeld ? 0.11 : 0, transition: "opacity 0.2s ease-out" }} />
      )}
      <g style={{
        transform: isHeld ? "scale(0.96)" : "scale(1)",
        transformOrigin: `${cx}px ${cy}px`,
        // Gentle, symmetric ease both ways — a subtle settle, no spring overshoot,
        // so the press feels smooth and professional rather than snappy/aggressive.
        transition: "transform 0.16s cubic-bezier(0.22,0.61,0.36,1)",
      }}>
        {/* ── GLASS LIGHTING ─────────────────────────────────────────────────
            The pad is one <svg>, so backdrop-filter cannot apply here (SVG
            shapes have no backdrop root) — that is why these buttons read flat
            while the rest of the app went glassy.

            Real glass is instead built from three colour-INDEPENDENT layers, so
            each button keeps its own hue (ABXY stay yellow/blue/green/red):
              gSpec  a bright cap over the top ~45%   = the specular highlight
              gRim   a stroke lit top-left, dark bottom-right = a lit edge
              gUnder a soft contact shadow underneath = it sits ON something

            Gradients, not SVG filters, deliberately. Measured on a Redmi Note 13
            at the real 61-shape pad count: gradients and feSpecularLighting were
            BOTH free (16.6ms median, 0 frames >20ms). Gradients win anyway because
            they are SVG 1.1 — identical on every phone — whereas filter cost
            scales with the device, and this is the gameplay layer where a lost
            frame is a lost input.

            ids are shared across buttons on purpose: the defs are identical and
            colour-independent, so `url(#…)` resolving to the first one is correct
            and costs one definition instead of 61. */}
        <PadGlassDefs />

        {/* contact shadow — sits under the body, never intercepts touch */}
        {isRect ? (
          <ellipse cx={cx} cy={cy + h! * 0.40} rx={w! * 0.48} ry={h! * 0.20}
            fill="url(#padUnder)" style={{ pointerEvents: "none" }} />
        ) : (
          <ellipse cx={cx} cy={cy + r * 0.72} rx={r * 0.92} ry={r * 0.30}
            fill="url(#padUnder)" style={{ pointerEvents: "none" }} />
        )}

        {/* GLASS BODY — stays translucent at all times with a thin rim that
            brightens on press, exactly like the LT/RT pill. fill/stroke live in
            `style` (NOT attributes) because CSS transitions only animate CSS
            properties — as attributes the rim used to snap instead of easing. */}
        {isRect ? (
          <rect x={cx - w! / 2} y={cy - h! / 2} width={w!} height={h!} rx={rx}
            style={{
              fill: normColor, filter: phong,
              stroke: isHeld ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.07)",
              strokeWidth: isHeld ? "2px" : "1.5px",
              transition: "stroke 0.16s ease-out, stroke-width 0.16s ease-out",
            }} />
        ) : (
          <circle cx={cx} cy={cy} r={r}
            style={{
              fill: normColor, filter: phong,
              stroke: isHeld ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.07)",
              strokeWidth: isHeld ? "2px" : "1.5px",
              transition: "stroke 0.16s ease-out, stroke-width 0.16s ease-out",
            }} />
        )}
        {/* Dim press tint INSIDE the glass — the button softly lights up rather
            than going solid/opaque, keeping the glassy edge readable (mirrors the
            trigger's dim gradient fill sitting inside its glass pill). */}
        {isRect ? (
          <rect x={cx - w! / 2} y={cy - h! / 2} width={w!} height={h!} rx={rx}
            style={{ fill: heldColor, pointerEvents: "none", opacity: isHeld ? 0.26 : 0, transition: "opacity 0.16s ease-out" }} />
        ) : (
          <circle cx={cx} cy={cy} r={r}
            style={{ fill: heldColor, pointerEvents: "none", opacity: isHeld ? 0.26 : 0, transition: "opacity 0.16s ease-out" }} />
        )}
        {/* SPECULAR CAP — replaces the old flat 10%-white ellipse. A gradient
            that is bright at the crown and gone by ~45% down reads as light
            landing on a curved surface; a flat ellipse reads as a painted dot.
            This is the single biggest difference between "glassy" and "sticker". */}
        {isRect ? (
          <rect x={cx - w! / 2 + 1} y={cy - h! / 2 + 1} width={w! - 2} height={h! * 0.52} rx={rx * 0.85}
            fill="url(#padSpec)"
            style={{ pointerEvents: "none", opacity: isHeld ? 0.75 : 1, transition: "opacity 0.16s ease-out" }} />
        ) : (
          <ellipse cx={cx} cy={cy - r * 0.34} rx={r * 0.80} ry={r * 0.52}
            fill="url(#padSpec)"
            style={{ pointerEvents: "none", opacity: isHeld ? 0.75 : 1, transition: "opacity 0.16s ease-out" }} />
        )}

        {/* LIT RIM — bright top-left fading to dark bottom-right. A single flat
            stroke reads as an outline; a directional one reads as an edge with a
            light source. Drawn last so it sits above the specular. */}
        {isRect ? (
          <rect x={cx - w! / 2} y={cy - h! / 2} width={w!} height={h!} rx={rx}
            fill="none" stroke="url(#padRim)"
            style={{ pointerEvents: "none", strokeWidth: isHeld ? "2px" : "1.5px",
                     transition: "stroke-width 0.16s ease-out" }} />
        ) : (
          <circle cx={cx} cy={cy} r={r}
            fill="none" stroke="url(#padRim)"
            style={{ pointerEvents: "none", strokeWidth: isHeld ? "2px" : "1.5px",
                     transition: "stroke-width 0.16s ease-out" }} />
        )}
        {typeof label === "string" || typeof label === "number" || (React.isValidElement(label) && (label.type === "tspan" || label.type === React.Fragment)) ? (
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
            fontSize={fs} fontWeight="800" fill={isHeld ? "#ffffff" : "#e5e7eb"}
            style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none", userSelect: "none", letterSpacing: "-0.02em" }}>
            {label}
          </text>
        ) : (
          <g transform={`translate(${cx}, ${cy})`} style={{ color: isHeld ? "#ffffff" : "rgba(255,255,255,0.88)" }}>
            {label}
          </g>
        )}
      </g>
      {(isHeld || ripples.length > 0) && (
        <clipPath id={clipId}>
          {isRect
            ? <rect x={cx - w! / 2} y={cy - h! / 2} width={w!} height={h!} rx={rx} />
            : <circle cx={cx} cy={cy} r={r} />}
        </clipPath>
      )}
      {/* Wave shimmer while held — a soft blurred light sweeping across the button,
          matching the LT/RT trigger's wave crest. Low opacity = dim, clipped to the
          button shape, gentle SMIL side-to-side travel. */}
      {isHeld && (
        <g clipPath={`url(#${clipId})`} style={{ pointerEvents: "none" }}>
          <ellipse cx={cx} cy={cy} rx={span * 0.9} ry={(isRect ? h! : r * 2) * 0.3}
            fill="rgba(200,225,255,0.10)" style={{ filter: "blur(6px)" }}>
            <animate attributeName="cx"
              values={`${cx - span};${cx + span};${cx - span}`}
              dur="1.6s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
          </ellipse>
        </g>
      )}
      {ripples.length > 0 && (
        <g clipPath={`url(#${clipId})`}>
          {rippleCircles(ripples, cx, cy, coverBase)}
        </g>
      )}
    </g>
  );
}

export const Btn = React.memo(BtnBase, (p, n) =>
  p.cx === n.cx && p.cy === n.cy && p.r === n.r && p.w === n.w && p.h === n.h &&
  p.rxFactor === n.rxFactor && p.fontSize === n.fontSize &&
  p.normColor === n.normColor && p.heldColor === n.heldColor &&
  p.id === n.id && labelEq(p.label, n.label) &&
  p.held.has(p.id) === n.held.has(n.id)
);

function DpadBase({ cx, cy, r, held, dn, up, dirIds }: {
  cx: number; cy: number; r: number;
  held: Set<any>; dn: (id: any) => void; up: (id: any) => void;
  dirIds?: { up: string; down: string; left: string; right: string; }
}) {
  const dirs: { id: string; angle: number; label: string }[] = [
    { id: dirIds?.up || "up", angle: -90, label: "▲" }, { id: dirIds?.right || "right", angle: 0, label: "▶" },
    { id: dirIds?.down || "down", angle: 90, label: "▼" }, { id: dirIds?.left || "left", angle: 180, label: "◀" },
  ];
  const sector = (a1: number, a2: number) => {
    const rad = (d: number) => (d * Math.PI) / 180;
    const inner = r * 0.28;
    const mk = (d: number, rr: number) => ({ x: cx + Math.cos(rad(d)) * rr, y: cy + Math.sin(rad(d)) * rr });
    const s1 = mk(a1, inner), s2 = mk(a1, r), e2 = mk(a2, r), e1 = mk(a2, inner);
    return `M${s1.x} ${s1.y} L${s2.x} ${s2.y} A${r} ${r} 0 0 1 ${e2.x} ${e2.y} L${e1.x} ${e1.y} A${inner} ${inner} 0 0 0 ${s1.x} ${s1.y}Z`;
  };
  const { ripples, spawn } = useSvgRipple();
  const clipId = `dpad-rip-${Math.round(cx)}-${Math.round(cy)}`;
  const anyHeld = dirs.some(d => held.has(d.id));
  const inner = r * 0.28;                       // center deadzone radius
  const pid = useRef<number | null>(null);      // owning pointer
  const activeDirs = useRef<Set<string>>(new Set());
  const idFor = {
    up: dirIds?.up || "up", down: dirIds?.down || "down",
    left: dirIds?.left || "left", right: dirIds?.right || "right",
  };
  // Convert a pointer event to this dpad's SVG user-space coords.
  const toSVG = (e: React.PointerEvent) => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return null;
    return pt.matrixTransform(m.inverse());
  };
  // Strict 4-way: the pointer resolves to the SINGLE nearest cardinal, so only one
  // arrow is ever active. Accidental diagonals (two ADJACENT arrows firing from one
  // press) and physically impossible OPPOSITE pairs (up+down / left+right) can't
  // happen. Sliding the thumb across the pad rolls cleanly from one arrow to the
  // next — never lighting two at once. (For diagonals, press two arrows with two
  // fingers isn't possible here by design — this is a single-pointer digital pad.)
  const dirsAt = (px: number, py: number): Set<string> => {
    const out = new Set<string>();
    const dx = px - cx, dy = py - cy;
    if (Math.hypot(dx, dy) < inner) return out;          // dead center → no direction
    const a = Math.atan2(dy, dx) * 180 / Math.PI;        // -180..180 (0=right, 90=down, -90=up, ±180=left)
    if (a >= -45 && a < 45) out.add(idFor.right);
    else if (a >= 45 && a < 135) out.add(idFor.down);
    else if (a >= 135 || a < -135) out.add(idFor.left);
    else out.add(idFor.up);
    return out;
  };
  const apply = (next: Set<string>) => {
    activeDirs.current.forEach(id => { if (!next.has(id)) up(id); });
    next.forEach(id => { if (!activeDirs.current.has(id)) { dn(id); } });
    activeDirs.current = next;
  };
  const clearAll = () => { activeDirs.current.forEach(id => up(id)); activeDirs.current = new Set(); pid.current = null; };
  return (
    <g style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        if (pid.current !== null) return;
        pid.current = e.pointerId;
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch (err) {}
        spawn(e);
        const p = toSVG(e); if (p) apply(dirsAt(p.x, p.y));
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pid.current) return;
        const p = toSVG(e); if (p) apply(dirsAt(p.x, p.y));
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pid.current) return;
        try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
        clearAll(); releaseHaptic();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId !== pid.current) return;
        try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch (err) {}
        clearAll();
      }}
      onLostPointerCapture={() => clearAll()}>
      {/* Black silhouette — occludes the gyro bar behind the canvas (see Btn). */}
      <PadGlassDefs />
      <ellipse cx={cx} cy={cy + r * 0.72} rx={r * 0.92} ry={r * 0.30}
        fill="url(#padUnder)" style={{ pointerEvents: "none" }} />
      <circle cx={cx} cy={cy} r={r} fill="#000" style={{ pointerEvents: "none" }} />
      <circle cx={cx} cy={cy} r={r} fill={RED_NORM} filter={phong}
        stroke={anyHeld ? `rgba(${ACCENT_RGB}, 0.35)` : "rgba(255,255,255,0.06)"} strokeWidth={1.5}
        style={{ transition: "stroke 0.12s ease-out" }} />
      <ellipse cx={cx} cy={cy - r * 0.30} rx={r * 0.78} ry={r * 0.50}
        fill="url(#padSpec)" style={{ pointerEvents: "none" }} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#padRim)" strokeWidth={1.5}
        style={{ pointerEvents: "none" }} />
      {dirs.map(({ id, angle }) => (
        // Always rendered so the highlight can FADE in/out (a transition can't
        // animate from `transparent`). Pale target opacity → soft, not a harsh flash.
        <path key={id} d={sector(angle - 44, angle + 44)} fill={RED_HELD}
          style={{ pointerEvents: "none", opacity: held.has(id) ? 0.5 : 0, transition: "opacity 0.16s ease-out" }} />
      ))}
      {ripples.length > 0 && (
        <>
          <clipPath id={clipId}><circle cx={cx} cy={cy} r={r} /></clipPath>
          <g clipPath={`url(#${clipId})`}>{rippleCircles(ripples, cx, cy, r)}</g>
        </>
      )}
      <circle cx={cx} cy={cy} r={r * 0.28} fill={RED_NORM}
        stroke="rgba(0,0,0,0.2)" strokeWidth={2} style={{ pointerEvents: "none" }} />
      {dirs.map(({ id, angle, label }) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <text key={id + "-l"} x={cx + Math.cos(rad) * r * 0.63} y={cy + Math.sin(rad) * r * 0.63}
            textAnchor="middle" dominantBaseline="central" fontSize={r * 0.3} fontWeight="700"
            style={{ fontFamily: "monospace", pointerEvents: "none", userSelect: "none",
              fill: held.has(id) ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.5)", transition: "fill 0.16s ease-out" }}>
            {label}
          </text>
        );
      })}
    </g>
  );
}

// Compare the four per-direction held states (that's all the Set drives here).
export const Dpad = React.memo(DpadBase, (p, n) => {
  if (p.cx !== n.cx || p.cy !== n.cy || p.r !== n.r) return false;
  const ids = ["up", "down", "left", "right"] as const;
  for (const d of ids) {
    const pid = p.dirIds?.[d] || d, nid = n.dirIds?.[d] || d;
    if (pid !== nid || p.held.has(pid) !== n.held.has(nid)) return false;
  }
  return true;
});

function RightStickBase({ cx, cy, outerR, innerR, stick, id, held, dn, up }: {
  cx: number; cy: number; outerR: number; innerR: number;
  stick: StickApi;
  id: BtnId; held: Set<string>; dn: (id: BtnId) => void; up: (id: BtnId) => void;
}) {
  const { ripples, spawn } = useSvgRipple();
  const clipId = `stick-rip-${Math.round(cx)}-${Math.round(cy)}`;
  const isHeld = held.has(id);
  return (
    <g
      style={{ touchAction: "none", cursor: "grab" }}
      onPointerDown={(e) => {
        dn(id);
        spawn(e);
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn("RightStick: Pointer capture failed", err);
        }
        stick.onDown(e, cx, cy);
      }}
      onPointerMove={stick.onMove}
      onPointerUp={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        stick.onUp(e.pointerId);
        up(id);
        releaseHaptic();
      }}
      onPointerCancel={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        stick.onUp(e.pointerId);
        up(id);
      }}
      onLostPointerCapture={(e) => { stick.onUp(e.pointerId); up(id); }}
    >
      {/* Black silhouette — occludes the gyro bar behind the canvas (see Btn). */}
      <circle cx={cx} cy={cy} r={outerR} fill="#000" style={{ pointerEvents: "none" }} />
      {/* Soft neon ring while the stick is grabbed — always rendered so it fades
          in/out smoothly rather than snapping on. */}
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke={`rgba(${ACCENT_RGB}, 0.55)`} strokeWidth={3}
        style={{ pointerEvents: "none", filter: "blur(3px)", opacity: isHeld ? 1 : 0, transition: "opacity 0.2s ease-out" }} />
      <PadGlassDefs />
      <ellipse cx={cx} cy={cy + outerR * 0.74} rx={outerR * 0.92} ry={outerR * 0.28}
        fill="url(#padUnder)" style={{ pointerEvents: "none" }} />
      <circle cx={cx} cy={cy} r={outerR} fill={RED_NORM} filter={phong}
        stroke={isHeld ? `rgba(${ACCENT_RGB}, 0.4)` : "rgba(255,255,255,0.06)"} strokeWidth={1.5}
        style={{ pointerEvents: "all", transition: "stroke 0.12s ease-out" }} />
      <ellipse cx={cx} cy={cy - outerR * 0.30} rx={outerR * 0.80} ry={outerR * 0.50}
        fill="url(#padSpec)" style={{ pointerEvents: "none" }} />
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="url(#padRim)" strokeWidth={1.5}
        style={{ pointerEvents: "none" }} />
      {ripples.length > 0 && (
        <>
          <clipPath id={clipId}><circle cx={cx} cy={cy} r={outerR} /></clipPath>
          <g clipPath={`url(#${clipId})`}>{rippleCircles(ripples, cx, cy, outerR)}</g>
        </>
      )}
      <g ref={stick.knobRef} style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={innerR}
          fill="#d8d8d8"
          stroke="rgba(150,150,150,0.3)" strokeWidth={2.5}
          style={{ pointerEvents: "none" }} />
        <ellipse cx={cx} cy={cy - innerR * 0.34} rx={innerR * 0.72} ry={innerR * 0.46}
          fill="url(#padSpec)" style={{ pointerEvents: "none" }} />
        <circle cx={cx} cy={cy} r={innerR * 0.18} fill="rgba(100,100,100,0.35)"
          style={{ pointerEvents: "none" }} />
      </g>
    </g>
  );
}

// `stick` is a fresh object literal each render but its members are stable refs —
// compare knobRef so a Hybrid stick's L↔R swap (lstick↔rstick) still re-renders.
export const RightStick = React.memo(RightStickBase, (p, n) =>
  p.cx === n.cx && p.cy === n.cy && p.outerR === n.outerR && p.innerR === n.innerR &&
  p.id === n.id && p.stick.knobRef === n.stick.knobRef &&
  p.held.has(p.id) === n.held.has(n.id)
);

function TriggerPillBase({ x, y, w, h, rx, label, id, held, dn, up, fill, onFillChange, svgRef, digital = false }: {
  x: number; y: number; w: number; h: number; rx: number; label: string;
  id: BtnId; held: Set<string>; dn: (id: BtnId) => void; up: (id: BtnId) => void;
  fill: number; onFillChange: (v: number) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
  // digital=true ("Normal" mode in the editor): tap = instant full 100%, no feathering —
  // a regular button that happens to look like a trigger. digital=false ("Throttle"
  // mode, default): finger position within the pill sets an analog 0..1 pull.
  digital?: boolean;
}) {
  const isHeld = fill > 0.01;
  const clipId = `clip-${id}-${Math.round(x)}-${Math.round(y)}`;
  const fillGradId = `tfill-${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}-${Math.round(x)}`;
  const surfaceY = y + h * (1 - fill);   // the fill's top surface (moves with fill)
  const { ripples, spawn } = useSvgRipple();
  const tcx = x + w / 2, tcy = y + h / 2;
  const down = useRef(false);
  // Analog fill from the finger's Y within the pill: top → 1.0, bottom → 0.
  const fillAt = (e: React.PointerEvent): number => {
    const svg = svgRef.current; if (!svg) return 1;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return 1;
    const p = pt.matrixTransform(m.inverse());
    return Math.max(0, Math.min(1, (y + h - p.y) / h));
  };

  return (
    <g style={{ cursor: "pointer", touchAction: "none" }}
      onPointerDown={(e) => {
        dn(id);
        spawn(e);
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn("TriggerPill: Pointer capture failed", err);
        }
        down.current = true;
        onFillChange(digital ? 1.0 : Math.max(0.06, fillAt(e)));   // digital: instant full pull; analog: touch position sets it
      }}
      onPointerMove={(e) => {
        if (!down.current || digital) return;       // digital mode never feathers
        onFillChange(fillAt(e));                    // slide to feather the trigger
      }}
      onPointerUp={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        down.current = false;
        onFillChange(0);
        up(id);
        releaseHaptic();
      }}
      onPointerCancel={(e) => {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch (err) {}
        down.current = false;
        onFillChange(0);
        up(id);
      }}
      onLostPointerCapture={() => { down.current = false; onFillChange(0); up(id); }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w} height={h} rx={rx} />
        </clipPath>
        {/* Dim vertical gradient for the fill — low brightness (soft, liquid). */}
        <linearGradient id={fillGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={`rgba(${ACCENT_RGB}, 0.10)`} />
          <stop offset="100%" stopColor={`rgba(${ACCENT_RGB}, 0.36)`} />
        </linearGradient>
      </defs>

      {/* Black silhouette — occludes the gyro bar behind the canvas (see Btn). */}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="#000" style={{ pointerEvents: "none" }} />

      {/* Soft outer glow when active — low intensity, fades in/out smoothly. */}
      <rect x={x - 8} y={y - 8} width={w + 16} height={h + 16} rx={rx + 8}
        fill={RED_HELD}
        style={{ pointerEvents: "none", filter: "blur(14px)", opacity: isHeld ? 0.22 : 0, transition: "opacity 0.2s ease-out" }} />

      <rect x={x} y={y} width={w} height={h} rx={rx}
        style={{
          fill: RED_NORM,
          stroke: isHeld ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.07)",
          strokeWidth: isHeld ? "2.5px" : "1.5px",
          transition: "stroke 0.16s ease-out, stroke-width 0.16s ease-out"
        }} />
      {/* Soft DIM "liquid" fill — low brightness. Geometry via plain SVG ATTRIBUTES
          (x/y/height), NOT CSS geometry props, and with NO transition. So it updates
          instantly and reliably every frame on every WebView: an analog throttle
          tracks the finger 1:1 with zero lag and can never stick, rubber-band, or
          chase. (The old CSS-geometry + transition fill lagged/stuck on the phone.) */}
      <rect x={x} y={surfaceY} width={w} height={h * fill} clipPath={`url(#${clipId})`}
        fill={`url(#${fillGradId})`} style={{ pointerEvents: "none" }} />
      {/* Wave crest — a soft blurred light riding the fill's top surface, with a
          gentle SMIL shimmer travelling side-to-side for a "wave" feel. Low opacity
          = dim. Pinned to the surface by the same `fill` (attributes, so in sync). */}
      {isHeld && (
        <g clipPath={`url(#${clipId})`} style={{ pointerEvents: "none" }}>
          <rect x={x} y={surfaceY - 2.5} width={w} height={6}
            fill="rgba(150,190,240,0.28)" style={{ filter: "blur(3px)" }} />
          <ellipse cx={x + w / 2} cy={surfaceY} rx={w * 0.24} ry={4}
            fill="rgba(200,225,255,0.34)" style={{ filter: "blur(4px)" }}>
            <animate attributeName="cx"
              values={`${x + w * 0.22};${x + w * 0.78};${x + w * 0.22}`}
              dur="1.5s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />
          </ellipse>
        </g>
      )}
      <PadGlassDefs />
      <ellipse cx={x + w / 2} cy={y + h + 4} rx={w * 0.52} ry={h * 0.045}
        fill="url(#padUnder)" style={{ pointerEvents: "none" }} />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={x + 6} y1={y + h * (1 - f)} x2={x + w - 6} y2={y + h * (1 - f)}
          style={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: "1px", pointerEvents: "none" }} />
      ))}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke="url(#padRim)"
        style={{ pointerEvents: "none", strokeWidth: "1.5px" }} />
      {/* Top gloss — a centered ellipse to match the highlight on every other
          button (was an off-center rounded rect that read as a stray square). */}
      {/* Specular cap — a gradient over the top of the pill instead of the old
          flat 10%-white ellipse. Same reason as every other widget: a falloff
          reads as light on a curved surface, a flat blob reads as a painted dot. */}
      <rect x={x + 1} y={y + 1} width={w - 2} height={h * 0.42} rx={Math.min(w, h * 0.42) * 0.48}
        fill="url(#padSpec)" style={{ pointerEvents: "none" }} />
      <text x={x + w / 2} y={y + h - 22} textAnchor="middle"
        fontSize={w * 0.32} fontWeight="800"
        fill={isHeld ? "#ffffff" : "#e5e7eb"}
        style={{ fontFamily: "'Inter',sans-serif", pointerEvents: "none", userSelect: "none" }}>
        {label}
      </text>
      {isHeld && (
        <text x={x + w / 2} y={y + h - 7} textAnchor="middle" fontSize={9}
          style={{ fontFamily: "monospace", pointerEvents: "none", userSelect: "none", fill: "rgba(255,255,255,0.35)" }}>
          {Math.round(fill * 100)}%
        </text>
      )}
      {ripples.length > 0 && (
        <g clipPath={`url(#${clipId})`}>
          {rippleCircles(ripples, tcx, tcy, Math.hypot(w, h) / 2)}
        </g>
      )}
    </g>
  );
}

// `fill` changes every step of an analog pull — that's intended (the liquid fill
// must track the finger 1:1); the memo only stops OTHER widgets' presses from
// re-rendering this pill.
export const TriggerPill = React.memo(TriggerPillBase, (p, n) =>
  p.x === n.x && p.y === n.y && p.w === n.w && p.h === n.h && p.rx === n.rx &&
  p.label === n.label && p.id === n.id && p.digital === n.digital &&
  p.fill === n.fill && p.held.has(p.id) === n.held.has(n.id)
);
