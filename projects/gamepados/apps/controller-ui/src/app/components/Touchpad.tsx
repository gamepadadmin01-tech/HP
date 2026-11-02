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
//   • touch       a ripple spreads from the finger and a glowing dot sits right under it
//   • sliding     the dot stays glued to the finger (see LEAD below) and leaves a short trail along
//                 the finger's REAL path; the edge glows with how hard the stick is pushed. Nothing
//                 else moves: no background grid, no straight streaks
//   • full push   the rim lights up (and the phone ticks) once, like a stick hitting its stop
//   • lift        everything eases out; with "glide" the dot visibly slides home with the stick

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { TouchpadState, cleanTouchpadOptions, STICK_R } from "../touchpad";
import { registerPadVisual, PadFrame } from "../touchpadVisual";
import { ACCENT_RGB, RED_NORM, PadGlassDefs } from "./Widgets";

const accent = (a: number) => `rgba(${ACCENT_RGB}, ${a})`;
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
// The phone reports the finger a frame or two late (it has to cross into the web view), so the dot looks
// like it trails the finger. The dot is drawn that much AHEAD along the finger's own speed to cancel it.
const LEAD = 0.034;       // seconds of look-ahead
const LEAD_MAX = 34;      // design units: never further ahead than this
const VEL_TAU = 0.03;     // seconds: how quickly the speed estimate follows the finger
const SETTLE_MS = 70;     // no new frame for this long: the finger stopped, so the dot sits exactly on it
const TRAIL_MS = 150;     // how much of the finger's path the trail shows
const TRAIL_MAX = 10;     // most points kept

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

export function TouchpadArt({ id, x, y, w, h, label, round }: {
  id: string; x: number; y: number; w: number; h: number; label?: string; round?: boolean;
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
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill={RED_NORM} stroke="rgba(255,255,255,0.07)" strokeWidth={0.75} />
      <g clipPath={`url(#tpc-${k})`}>
        <rect x={left} y={top} width={w} height={h} fill={`url(#tpv-${k})`} />
        <rect x={left} y={top} width={w} height={h * 0.46} fill="url(#padSpec)" opacity={0.4} />
      </g>
      <Shp round={round} x={x} y={y} w={w} h={h} rx={rx} fill="none" stroke="url(#padRim)" strokeWidth={0.75} opacity={0.55} />
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
  const activeRef = useRef<SVGGElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  const coreRef = useRef<SVGGElement>(null);
  const edgeRef = useRef<SVGElement>(null);
  const rimRef = useRef<SVGElement>(null);
  const originRef = useRef<SVGCircleElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const rippleRef = useRef<SVGCircleElement>(null);

  const anim = useRef({
    on: false, full: false, ox: 0, oy: 0,
    px: 0, py: 0, pt: 0, vx: 0, vy: 0,          // the previous frame and the finger's smoothed speed
    mq: -1, eased: false, tx: 0, ty: 0,         // push level last drawn; dot easing flag; last trail point
    settle: 0 as ReturnType<typeof setTimeout> | 0,
    trail: [] as { x: number; y: number; t: number }[],
  });
  const geo = useRef({ l: 0, t: 0, r: 0, b: 0 });
  geo.current = { l: left, t: top, r: left + w, b: top + h };
  const optsRef = useRef(opts); optsRef.current = opts;
  const cbRef = useRef({ onStick, onPress, onRelease, onEdge });
  cbRef.current = { onStick, onPress, onRelease, onEdge };

  // ── Draw one frame. null = idle. Shared by the native feed and the page-side touch path.
  const apply = useCallback((f: PadFrame | null) => {
    const a = anim.current;
    const act = activeRef.current;
    if (!act) return;

    if (!f) {
      if (!a.on) return;
      a.on = false; a.full = false; a.trail = []; a.mq = -1;
      if (a.settle) { clearTimeout(a.settle); a.settle = 0; }
      act.style.opacity = "0";
      if (trailRef.current) trailRef.current.style.opacity = "0";
      if (coreRef.current) coreRef.current.style.transform = "scale(0.55)";
      if (rimRef.current) rimRef.current.style.stroke = "rgba(255,255,255,0.07)";
      return;
    }

    const mag = Math.min(1, Math.hypot(f.dx, f.dy) / STICK_R);
    if (!a.on) {
      a.on = true; a.ox = f.fx; a.oy = f.fy; a.trail = [];
      a.px = f.fx; a.py = f.fy; a.pt = performance.now(); a.vx = 0; a.vy = 0;
      act.style.opacity = "1";
      if (coreRef.current) coreRef.current.style.transform = "scale(1)";
      const rp = rippleRef.current;
      if (rp && !reduce.current && rp.animate) {
        rp.setAttribute("cx", String(f.fx)); rp.setAttribute("cy", String(f.fy));
        rp.animate(
          [{ transform: "scale(0.15)", opacity: 0.75 }, { transform: "scale(1.15)", opacity: 0 }],
          { duration: 560, easing: "cubic-bezier(0.22,1,0.36,1)" });
      }
    }

    // Where to draw the dot: on the finger, nudged ahead by its own speed to cancel the report delay.
    const now = performance.now();
    const dt = Math.max((now - a.pt) / 1000, 0.008);
    const kv = 1 - Math.exp(-dt / VEL_TAU);
    a.vx += ((f.fx - a.px) / dt - a.vx) * kv;
    a.vy += ((f.fy - a.py) / dt - a.vy) * kv;
    a.px = f.fx; a.py = f.fy; a.pt = now;
    const g = geo.current;
    const clampLead = (v: number) => Math.max(-LEAD_MAX, Math.min(LEAD_MAX, v * LEAD));
    const dx = Math.max(g.l, Math.min(g.r, f.fx + clampLead(a.vx)));
    const dy = Math.max(g.t, Math.min(g.b, f.fy + clampLead(a.vy)));
    if (dotRef.current) {
      if (a.eased) { dotRef.current.style.transition = ""; a.eased = false; }
      dotRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    // The halo swells and the edge glows with how hard the stick is pushed. They only change in eighths:
    // the edge glow covers the whole pad, so redrawing it on every frame was the most expensive thing here.
    const mq = Math.round(mag * 8) / 8;
    if (mq !== a.mq) {
      a.mq = mq;
      if (haloRef.current) haloRef.current.style.transform = `scale(${1 + 0.7 * mq})`;
      if (edgeRef.current) edgeRef.current.style.opacity = String(0.12 + 0.6 * mq);
    }

    // A finger that stops sends no more frames, so settle the dot exactly onto it by ourselves.
    if (a.settle) clearTimeout(a.settle);
    const fx = f.fx, fy = f.fy;
    a.settle = setTimeout(() => {
      a.settle = 0; a.vx = 0; a.vy = 0;
      if (dotRef.current) { a.eased = true; dotRef.current.style.transition = "transform 0.08s ease-out"; dotRef.current.style.transform = `translate(${fx}px, ${fy}px)`; }
      if (trailRef.current) trailRef.current.style.opacity = "0";
      a.trail = [];
    }, SETTLE_MS);

    const o = originRef.current, tr = trailRef.current;
    if (optsRef.current.feel === "distance") {
      // a floating stick: a ring marks where the finger first landed
      if (o) { o.setAttribute("cx", String(a.ox)); o.setAttribute("cy", String(a.oy)); o.style.opacity = "1"; }
      if (tr) tr.style.opacity = "0";
    } else {
      if (o) o.style.opacity = "0";
      if (tr && !reduce.current) {
        // the trail is the finger's real path, a few frames of it, so it bends where the finger bends
        const tl = a.trail;
        tl.push({ x: dx, y: dy, t: now });
        while (tl.length > TRAIL_MAX || (tl.length > 0 && now - tl[0].t > TRAIL_MS)) tl.shift();
        if (tl.length >= 2) {
          let d = `M${tl[0].x.toFixed(1)} ${tl[0].y.toFixed(1)}`;
          for (let i = 1; i < tl.length; i++) d += `L${tl[i].x.toFixed(1)} ${tl[i].y.toFixed(1)}`;
          tr.setAttribute("d", d);
          tr.style.opacity = String(0.55 * Math.min(1, mag * 2.5));
        } else tr.style.opacity = "0";
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
    if (anim.current.settle) clearTimeout(anim.current.settle);
    if (last.current.x !== 0 || last.current.y !== 0) cbRef.current.onStick(id, 0, 0);
  }, [id]);

  return (
    <g>
      <TouchpadArt id={id} x={x} y={y} w={w} h={h} label={label} round={round} />

      {/* live layers: invisible until a finger arrives */}
      <g ref={activeRef} style={{ opacity: 0, transition: "opacity 0.25s ease-out", pointerEvents: "none" }}>
        <defs>
          <radialGradient id={`tph-${k}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={`rgba(${ACCENT_RGB}, 0.55)`} />
            <stop offset="100%" stopColor={`rgba(${ACCENT_RGB}, 0)`} />
          </radialGradient>
        </defs>
        <g clipPath={`url(#tpc-${k})`}>
          <circle ref={rippleRef} r={80} fill="none" stroke={accent(0.9)} strokeWidth={1.5} opacity={0}
            style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          <circle ref={originRef} r={16} fill="none" stroke={accent(0.7)} strokeWidth={1.25} strokeDasharray="3 6" opacity={0} />
          <path ref={trailRef} fill="none" stroke={accent(0.85)} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0} />
          <g ref={dotRef} style={{ transform: `translate(${x}px, ${y}px)` }}>
            <g ref={haloRef} style={{ transition: "transform 0.12s ease-out" }}>
              <circle r={46} fill={`url(#tph-${k})`} />
            </g>
            <g ref={coreRef} style={{ transform: "scale(0.55)", transition: "transform 0.22s cubic-bezier(0.22,1,0.36,1)" }}>
              <circle r={17} fill={accent(0.95)} />
              <circle r={17} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.25} />
              <circle r={6} fill="rgba(255,255,255,0.85)" />
            </g>
          </g>
        </g>
        <Shp round={round} ref={edgeRef} x={x} y={y} w={w - 2} h={h - 2} rx={Math.max(0, rx - 1)} fill="none"
          stroke={accent(1)} strokeWidth={3.5} opacity={0.12} />
      </g>
      <Shp round={round} ref={rimRef} x={x} y={y} w={w} h={h} rx={rx} fill="none"
        stroke="rgba(255,255,255,0.07)" strokeWidth={1.25}
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
