// ── Touchpad widget: slide a finger to push the right stick ──────────────────
// The rules live in ../touchpad.ts (mirrored natively by TouchpadMath.kt); this file is the look
// and the touch handling for the page. Two ways a finger reaches it:
//   • native input ON (default): the Android engine owns the finger and tells us where it is
//     through touchpadVisual.ts, once per frame. We only DRAW.
//   • native input OFF: pointer events land here and a TouchpadState does the maths.
// Both end in apply(frame), which moves SVG nodes directly. Nothing here sets React state per
// frame: a 60 fps animation through React would re-render the whole pad and cost input latency.
//
// What the player sees (all of it driven by the same two numbers, finger position and how hard
// the stick is being pushed):
//   • idle        a clean dark glass surface, like a laptop trackpad. Nothing is drawn on it (only a
//                 name the player typed). Rectangle or circle, chosen in the layout editor
//   • touch       a ripple spreads from the finger, a faint dot grid fades in, a glowing dot follows the finger
//   • sliding     the dot grid slides under the finger like a real trackpad surface; the edge glows
//                 with how hard the stick is pushed; speed feel leaves a comet and a short trail,
//                 distance feel draws a tension line back to where the finger first landed
//   • full push   the rim lights up (and the phone ticks) once, like a stick hitting its stop
//   • lift        everything eases out; with "glide" the dot visibly slides home with the stick

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { TouchpadState, cleanTouchpadOptions, STICK_R } from "../touchpad";
import { registerPadVisual, PadFrame } from "../touchpadVisual";
import { ACCENT_RGB, RED_NORM, PadGlassDefs } from "./Widgets";

const accent = (a: number) => `rgba(${ACCENT_RGB}, ${a})`;
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
const TRAIL = 6;          // afterimage dots behind the finger
const GRID = 34;          // dot-grid spacing, design units
const PARALLAX = 0.45;    // how far the grid slides per unit of finger travel

const reducedMotion = (): boolean => {
  try { return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
};

// ── The static look. Used by the live widget below AND by the layout editor's preview, so the
//    two can never drift apart.
/** A rounded rectangle, or an ellipse (a circle when w == h), drawn from its CENTRE. One place for the
 *  outline so the silhouette, glass, rim, glow, clip and touch surface can never disagree. */
type ShpProps = { round?: boolean; x: number; y: number; w: number; h: number; rx?: number }
  & Omit<React.SVGProps<SVGElement>, "x" | "y" | "ref">;
const Shp = React.forwardRef<SVGElement, ShpProps>(({ round, x, y, w, h, rx = 0, ...p }, ref) => round
  ? <ellipse ref={ref as React.Ref<SVGEllipseElement>} cx={x} cy={y} rx={w / 2} ry={h / 2} {...(p as React.SVGProps<SVGEllipseElement>)} />
  : <rect ref={ref as React.Ref<SVGRectElement>} x={x - w / 2} y={y - h / 2} width={w} height={h} rx={rx} {...(p as React.SVGProps<SVGRectElement>)} />);

export function TouchpadArt({ id, x, y, w, h, label, round, patternRef }: {
  id: string; x: number; y: number; w: number; h: number; label?: string; round?: boolean;
  patternRef?: React.Ref<SVGPatternElement>;
}) {
  const k = safeId(id);
  const rx = Math.min(w, h) * 0.14;
  const left = x - w / 2, top = y - h / 2;
  const fs = Math.max(13, Math.min(w, h) * 0.06);
  return (
    <g style={{ pointerEvents: "none" }}>
      <PadGlassDefs />
      <defs>
        <clipPath id={`tpc-${k}`}><Shp round={round} x={x} y={y} w={w} h={h} rx={rx} /></clipPath>
        <pattern ref={patternRef} id={`tpg-${k}`} patternUnits="userSpaceOnUse" width={GRID} height={GRID}>
          <circle cx={GRID / 2} cy={GRID / 2} r={1.7} fill="rgba(255,255,255,0.20)" />
        </pattern>
        <radialGradient id={`tpv-${k}`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
      </defs>
      {/* black silhouette: hides the gyro bar that sits behind the canvas (same as every widget) */}
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill="#000" />
      {/* contact shadow */}
      <ellipse cx={x} cy={y + h * 0.46} rx={w * 0.46} ry={h * 0.12} fill="url(#padUnder)" />
      {/* glass body */}
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill={RED_NORM} stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} />
      <g clipPath={`url(#tpc-${k})`}>
        {/* the dot grid is only there while a finger is down (it slides under the finger) */}
        <g data-tp="grid" style={{ opacity: 0, transition: "opacity 0.25s ease-out" }}>
          <rect x={left} y={top} width={w} height={h} fill={`url(#tpg-${k})`} />
        </g>
        <rect x={left} y={top} width={w} height={h} fill={`url(#tpv-${k})`} />
        <rect x={left} y={top} width={w} height={h * 0.46} fill="url(#padSpec)" opacity={0.4} />
      </g>
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill="none" stroke="url(#padRim)" strokeWidth={1.5} opacity={0.55} />
      {/* No joystick drawing and no default text: a clean surface. Only a name the player typed shows. */}
      {label ? (
        <text x={x} y={top + h - fs * 1.1} textAnchor="middle" fontSize={fs} fontWeight={700} letterSpacing={fs * 0.16}
          fill="rgba(255,255,255,0.30)" style={{ fontFamily: "'Inter',sans-serif", userSelect: "none" }}>{label.toUpperCase()}</text>
      ) : null}
    </g>
  );
}

type Props = {
  id: string;
  x: number; y: number; w: number; h: number;      // centre and size, design units
  label?: string;
  round?: boolean;                                  // a circle / ellipse instead of a rounded rectangle
  feel?: unknown; release?: unknown; sens?: unknown;
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** What this pad is pushing on the right stick right now (page-side touch only). */
  onStick: (id: string, x: number, y: number) => void;
  onPress?: () => void;       // first touch: the press haptic
  onRelease?: () => void;     // finger lifted: the release haptic
  onEdge?: () => void;        // stick reached its stop: one tick
};

function TouchpadBase({ id, x, y, w, h, label, round, feel, release, sens, svgRef, onStick, onPress, onRelease, onEdge }: Props) {
  const k = safeId(id);
  const rx = Math.min(w, h) * 0.14;
  const left = x - w / 2, top = y - h / 2;
  const opts = useMemo(() => cleanTouchpadOptions({ feel, release, sens }), [feel, release, sens]);
  const reduce = useRef(reducedMotion());

  // refs to the nodes the animation moves
  const patternRef = useRef<SVGPatternElement>(null);
  const rootRef = useRef<SVGGElement>(null);
  const activeRef = useRef<SVGGElement>(null);
  const gridRef = useRef<SVGGElement | null>(null);
  const dotRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  const coreRef = useRef<SVGGElement>(null);
  const edgeRef = useRef<SVGElement>(null);
  const rimRef = useRef<SVGElement>(null);
  const tensionRef = useRef<SVGLineElement>(null);
  const originRef = useRef<SVGCircleElement>(null);
  const cometRef = useRef<SVGLineElement>(null);
  const trailRef = useRef<SVGGElement>(null);
  const rippleRef = useRef<SVGCircleElement>(null);

  const anim = useRef({
    on: false, full: false, ox: 0, oy: 0,
    trail: [] as { x: number; y: number }[],
  });
  const optsRef = useRef(opts); optsRef.current = opts;
  const cbRef = useRef({ onStick, onPress, onRelease, onEdge });
  cbRef.current = { onStick, onPress, onRelease, onEdge };

  // ── Draw one frame. null = idle. Shared by the native feed and the page-side touch path.
  const apply = useCallback((f: PadFrame | null) => {
    const a = anim.current;
    const act = activeRef.current;
    if (!act) return;
    if (!gridRef.current) gridRef.current = rootRef.current?.querySelector('[data-tp="grid"]') as SVGGElement | null;
    const grid = gridRef.current;

    if (!f) {
      if (!a.on) return;
      a.on = false; a.full = false; a.trail = [];
      act.style.opacity = "0";
      if (grid) grid.style.opacity = "0";
      if (coreRef.current) coreRef.current.style.transform = "scale(0.55)";
      if (rimRef.current) rimRef.current.style.stroke = "rgba(255,255,255,0.07)";
      return;
    }

    const mag = Math.min(1, Math.hypot(f.dx, f.dy) / STICK_R);
    if (!a.on) {
      a.on = true; a.ox = f.fx; a.oy = f.fy; a.trail = [];
      act.style.opacity = "1";
      if (grid) grid.style.opacity = "1";
      if (coreRef.current) coreRef.current.style.transform = "scale(1)";
      const rp = rippleRef.current;
      if (rp && !reduce.current && rp.animate) {
        rp.setAttribute("cx", String(f.fx)); rp.setAttribute("cy", String(f.fy));
        rp.animate(
          [{ transform: "scale(0.15)", opacity: 0.75 }, { transform: "scale(1.15)", opacity: 0 }],
          { duration: 560, easing: "cubic-bezier(0.22,1,0.36,1)" });
      }
    }

    // the finger dot and its halo (the halo swells with the push)
    if (dotRef.current) dotRef.current.style.transform = `translate(${f.fx}px, ${f.fy}px)`;
    if (haloRef.current) haloRef.current.style.transform = `scale(${1 + 0.7 * mag})`;
    // the dot grid slides under the finger like a trackpad surface
    patternRef.current?.setAttribute("patternTransform", `translate(${(f.fx * PARALLAX).toFixed(1)} ${(f.fy * PARALLAX).toFixed(1)})`);
    // the edge glows with how hard the stick is pushed
    if (edgeRef.current) edgeRef.current.style.opacity = String(0.12 + 0.6 * mag);

    const distance = optsRef.current.feel === "distance";
    const t = tensionRef.current, o = originRef.current, c = cometRef.current, tr = trailRef.current;
    if (distance) {
      if (t) {
        t.setAttribute("x1", String(a.ox)); t.setAttribute("y1", String(a.oy));
        t.setAttribute("x2", String(f.fx)); t.setAttribute("y2", String(f.fy));
        t.style.opacity = String(Math.min(1, mag * 3));
        t.style.strokeWidth = String(2 + 4 * mag);
      }
      if (o) { o.setAttribute("cx", String(a.ox)); o.setAttribute("cy", String(a.oy)); o.style.opacity = "1"; }
      if (c) c.style.opacity = "0";
      if (tr) tr.style.opacity = "0";
    } else {
      if (t) t.style.opacity = "0";
      if (o) o.style.opacity = "0";
      const m = Math.hypot(f.dx, f.dy);
      if (c) {
        if (m < 1.5) c.style.opacity = "0";
        else {
          const len = 16 + 120 * mag;
          c.setAttribute("x1", String(f.fx)); c.setAttribute("y1", String(f.fy));
          c.setAttribute("x2", String(f.fx - (f.dx / m) * len)); c.setAttribute("y2", String(f.fy - (f.dy / m) * len));
          c.style.opacity = String(0.2 + 0.7 * mag);
          c.style.strokeWidth = String(4 + 10 * mag);
        }
      }
      if (tr && !reduce.current) {
        a.trail.push({ x: f.fx, y: f.fy });
        if (a.trail.length > TRAIL) a.trail.shift();
        const kids = tr.children;
        for (let i = 0; i < kids.length; i++) {
          const p = a.trail[a.trail.length - 1 - i];
          const el = kids[i] as SVGCircleElement;
          if (!p) { el.style.opacity = "0"; continue; }
          el.setAttribute("cx", String(p.x)); el.setAttribute("cy", String(p.y));
          el.style.opacity = String((1 - i / TRAIL) * 0.5 * Math.min(1, mag * 2.5));
        }
        tr.style.opacity = "1";
      }
    }

    // full push: the rim lights up once, like a stick reaching its stop
    const full = mag >= 0.98;
    if (full !== a.full) {
      a.full = full;
      if (rimRef.current) rimRef.current.style.stroke = full ? accent(0.95) : "rgba(255,255,255,0.07)";
    }
  }, []);

  // ── Native feed: the Android engine tells us where the finger is.
  useEffect(() => registerPadVisual(id, apply), [id, apply]);

  // ── Page-side touch (only reached when native input is off)
  const st = useRef<TouchpadState | null>(null);
  const pid = useRef<number | null>(null);
  const raf = useRef(0);
  const last = useRef({ x: 0, y: 0 });

  const ensure = () => {
    const o = optsRef.current;
    if (!st.current) st.current = new TouchpadState(o.feel, o.release, o.sens);
    return st.current;
  };
  useEffect(() => { st.current = null; }, [opts]);   // a changed setting starts a fresh state

  const publish = useCallback((s: TouchpadState) => {
    if (s.x !== last.current.x || s.y !== last.current.y) {
      last.current = { x: s.x, y: s.y };
      cbRef.current.onStick(id, s.x, s.y);
      const full = Math.hypot(s.x, s.y) >= STICK_R * 0.98;
      if (full && !anim.current.full) cbRef.current.onEdge?.();
    }
    apply(s.active ? { fx: s.fingerX, fy: s.fingerY, dx: s.x, dy: s.y } : null);
  }, [id, apply]);

  const loop = useCallback((now: number) => {
    raf.current = 0;
    const s = st.current; if (!s) return;
    s.tick(now);
    publish(s);
    if (s.active) raf.current = requestAnimationFrame(loop);
  }, [publish]);

  const toSVG = (cx: number, cy: number) => {
    const svg = svgRef.current; const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    return pt.matrixTransform(m.inverse());
  };

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (last.current.x !== 0 || last.current.y !== 0) cbRef.current.onStick(id, 0, 0);
  }, [id]);

  return (
    <g ref={rootRef}>
      <TouchpadArt id={id} x={x} y={y} w={w} h={h} label={label} round={round} patternRef={patternRef} />

      {/* live layers: invisible until a finger arrives */}
      <g ref={activeRef} style={{ opacity: 0, transition: "opacity 0.25s ease-out", pointerEvents: "none" }}>
        <defs>
          <radialGradient id={`tph-${k}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={`rgba(${ACCENT_RGB}, 0.55)`} />
            <stop offset="100%" stopColor={`rgba(${ACCENT_RGB}, 0)`} />
          </radialGradient>
        </defs>
        <g clipPath={`url(#tpc-${k})`}>
          <circle ref={rippleRef} r={80} fill="none" stroke={accent(0.9)} strokeWidth={3} opacity={0}
            style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          <line ref={tensionRef} stroke={accent(0.75)} strokeLinecap="round" strokeWidth={3} opacity={0} />
          <circle ref={originRef} r={16} fill="none" stroke={accent(0.7)} strokeWidth={2.5} strokeDasharray="3 6" opacity={0} />
          <line ref={cometRef} stroke={accent(0.85)} strokeLinecap="round" strokeWidth={6} opacity={0} />
          <g ref={trailRef} opacity={0}>
            {Array.from({ length: TRAIL }, (_, i) => (
              <circle key={i} r={14 - i * 1.6} fill={accent(0.9)} opacity={0} />
            ))}
          </g>
          <g ref={dotRef} style={{ transform: `translate(${x}px, ${y}px)` }}>
            <g ref={haloRef} style={{ transition: "transform 0.12s ease-out" }}>
              <circle r={58} fill={`url(#tph-${k})`} />
            </g>
            <g ref={coreRef} style={{ transform: "scale(0.55)", transition: "transform 0.22s cubic-bezier(0.22,1,0.36,1)" }}>
              <circle r={17} fill={accent(0.95)} />
              <circle r={17} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={2} />
              <circle r={6} fill="rgba(255,255,255,0.85)" />
            </g>
          </g>
        </g>
        <Shp round={round} ref={edgeRef} x={x} y={y} w={w - 4} h={h - 4} rx={Math.max(0, rx - 2)} fill="none"
          stroke={accent(1)} strokeWidth={7} opacity={0.12} />
      </g>
      <Shp round={round} ref={rimRef} x={x} y={y} w={w} h={h} rx={rx} fill="none"
        stroke="rgba(255,255,255,0.07)" strokeWidth={2.5}
        style={{ pointerEvents: "none", transition: "stroke 0.16s ease-out" }} />

      {/* the touch surface */}
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill="transparent"
        style={{ touchAction: "none", cursor: "pointer" }}
        onPointerDown={(e) => {
          if (pid.current !== null) return;                 // one finger owns the pad
          pid.current = e.pointerId;
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
          const s = ensure(); const p = toSVG(e.clientX, e.clientY);
          s.down(p.x, p.y, e.timeStamp);
          cbRef.current.onPress?.();
          publish(s);
          if (!raf.current) raf.current = requestAnimationFrame(loop);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== pid.current) return;
          const s = st.current; if (!s) return;
          const p = toSVG(e.clientX, e.clientY);
          s.move(p.x, p.y, e.timeStamp);
          publish(s);
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== pid.current) return;
          try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch {}
          pid.current = null;
          const s = st.current; if (!s) return;
          s.up(e.timeStamp);
          cbRef.current.onRelease?.();
          publish(s);
          if (s.active && !raf.current) raf.current = requestAnimationFrame(loop);
        }}
        onPointerCancel={(e) => {
          if (e.pointerId !== pid.current) return;
          pid.current = null;
          const s = st.current; if (!s) return;
          s.reset();
          publish(s);
        }}
        onLostPointerCapture={(e) => {
          if (e.pointerId !== pid.current) return;
          pid.current = null;
          const s = st.current; if (!s) return;
          s.up(e.timeStamp);
          publish(s);
          if (s.active && !raf.current) raf.current = requestAnimationFrame(loop);
        }} />
    </g>
  );
}

export const Touchpad = React.memo(TouchpadBase, (p, n) =>
  p.id === n.id && p.x === n.x && p.y === n.y && p.w === n.w && p.h === n.h && p.label === n.label &&
  p.round === n.round && p.feel === n.feel && p.release === n.release && p.sens === n.sens && p.svgRef === n.svgRef
);
