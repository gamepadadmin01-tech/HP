// ── Touchpad settings panel (layout editor) ──────────────────────────────────
// Three choices, each with the recommended one marked, and a live "Try it" area so a player can
// FEEL the difference before saving: slide a finger and a small right stick shows what the real
// pad would push. The Try-it uses the same TouchpadState as the game, scaled so one finger-width
// of travel is the same distance as on the real pad.

import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { CustomBtnDef } from "../types";
import {
  TouchpadState, cleanTouchpadOptions, touchpadSize, isRoundPad, STICK_R,
  TP_DEFAULT_FEEL, TP_DEFAULT_RELEASE, TP_DEFAULT_SENS, TP_SENS_MIN, TP_SENS_MAX,
} from "../touchpad";

type Slider = (value: number, min: number, max: number, onChange: (v: number) => void) => React.ReactNode;

const LABEL = "text-[10px] uppercase font-bold text-zinc-500 tracking-wider";

/** Two-or-more choice switch with a gliding highlight and a "Recommended" tag. */
function Segmented<T extends string>({ group, value, options, onChange }: {
  group: string; value: T; options: { id: T; label: string; recommended?: boolean }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-2xl bg-white/5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={on}
            className={`relative flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${on ? "text-black" : "text-zinc-400 hover:text-zinc-200"}`}>
            {on && <motion.span layoutId={`tp-seg-${group}`} className="absolute inset-0 rounded-xl bg-primary"
              transition={{ type: "spring", damping: 26, stiffness: 420 }} />}
            <span className="relative z-10 flex flex-col items-center leading-tight">
              {o.label}
              {o.recommended && <span className={`text-[8px] font-bold tracking-wide ${on ? "text-black/60" : "text-primary/80"}`}>RECOMMENDED</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small pad plus a small right stick. Sliding on the pad moves the stick exactly as the real
 *  touchpad would. All motion is written straight to the DOM; nothing re-renders while sliding. */
function TryIt({ b }: { b: CustomBtnDef }) {
  const o = cleanTouchpadOptions({ feel: b.tpFeel, release: b.tpRelease, sens: b.tpSens });
  const padRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const st = useRef<TouchpadState | null>(null);
  const pid = useRef<number | null>(null);
  const raf = useRef(0);
  const scale = useRef(1);                      // design units per local pixel

  useEffect(() => { st.current = null; }, [o.feel, o.release, o.sens]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const draw = (s: TouchpadState) => {
    const k = 26;                                // px the knob travels at full push
    if (knobRef.current) knobRef.current.style.transform = `translate(${(s.x / STICK_R) * k}px, ${(s.y / STICK_R) * k}px)`;
    if (dotRef.current) {
      const el = padRef.current;
      const on = s.active && el;
      dotRef.current.style.opacity = on ? "1" : "0";
      if (on) dotRef.current.style.transform = `translate(${s.fingerX / scale.current}px, ${s.fingerY / scale.current}px)`;
    }
    if (hintRef.current) hintRef.current.style.opacity = s.active ? "0" : "1";
  };
  const loop = (now: number) => {
    raf.current = 0;
    const s = st.current; if (!s) return;
    s.tick(now); draw(s);
    if (s.active) raf.current = requestAnimationFrame(loop);
  };
  // offsetX/offsetY are in the element's OWN (unrotated) pixels, so this also works while the
  // editor is rotated into landscape on a portrait phone.
  const local = (e: React.PointerEvent) => ({ x: e.nativeEvent.offsetX * scale.current, y: e.nativeEvent.offsetY * scale.current });

  return (
    <div className="flex gap-3 items-center">
      <div ref={padRef}
        className={`relative ${isRoundPad(b) ? "w-24 h-24 shrink-0 rounded-full" : "flex-1 h-24 rounded-2xl"} border border-white/10 bg-white/5 overflow-hidden touch-none select-none`}
        onPointerDown={(e) => {
          if (pid.current !== null) return;
          pid.current = e.pointerId; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
          scale.current = touchpadSize(b).w / Math.max(1, e.currentTarget.offsetWidth);
          if (!st.current) st.current = new TouchpadState(o.feel, o.release, o.sens);
          const p = local(e); st.current.down(p.x, p.y, e.timeStamp); draw(st.current);
          if (!raf.current) raf.current = requestAnimationFrame(loop);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== pid.current || !st.current) return;
          const p = local(e); st.current.move(p.x, p.y, e.timeStamp); draw(st.current);
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== pid.current || !st.current) return;
          pid.current = null; st.current.up(e.timeStamp); draw(st.current);
          if (st.current.active && !raf.current) raf.current = requestAnimationFrame(loop);
        }}
        onPointerCancel={(e) => {
          if (e.pointerId !== pid.current || !st.current) return;
          pid.current = null; st.current.reset(); draw(st.current);
        }}>
        <span ref={hintRef} className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tracking-widest text-zinc-500 pointer-events-none transition-opacity">
          SLIDE HERE TO TRY
        </span>
        <div ref={dotRef} className="absolute left-0 top-0 pointer-events-none" style={{ opacity: 0 }}>
          <div className="w-7 h-7 -ml-3.5 -mt-3.5 rounded-full bg-primary/90 shadow-[0_0_18px_rgba(44,170,186,0.7)] border border-white/60" />
        </div>
      </div>
      <div className="relative w-[72px] h-[72px] rounded-full border border-white/15 bg-white/5 shrink-0" aria-hidden>
        <div ref={knobRef} className="absolute left-1/2 top-1/2 w-6 h-6 -ml-3 -mt-3 rounded-full bg-zinc-200 shadow-md" />
      </div>
    </div>
  );
}

export function TouchpadSettings({ b, update, slider }: {
  b: CustomBtnDef;
  update: (u: Partial<CustomBtnDef>) => void;
  slider: Slider;
}) {
  const o = cleanTouchpadOptions({ feel: b.tpFeel, release: b.tpRelease, sens: b.tpSens });
  const { w, h } = touchpadSize(b);
  const round = isRoundPad(b);
  const isDefault = o.feel === TP_DEFAULT_FEEL && o.release === TP_DEFAULT_RELEASE && o.sens === TP_DEFAULT_SENS;
  const sensPct = Math.round(o.sens * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Try it</span>
        <TryIt b={b} />
        <span className="text-[10px] text-zinc-500 leading-snug">
          The small stick on the right shows what this pad pushes. Change a setting below and try again.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Feel</span>
        <Segmented group="feel" value={o.feel} onChange={(v) => update({ tpFeel: v })}
          options={[{ id: "speed", label: "Speed", recommended: true }, { id: "distance", label: "Distance" }]} />
        <span className="text-[10px] text-zinc-500 leading-snug">
          {o.feel === "speed"
            ? "Like a mouse: a fast swipe turns fast, a slow swipe turns slowly, and the stick returns to centre when your finger stops. Best for turning the camera."
            : "Like a floating stick: the further your finger is from where you first touched, the harder the stick is pushed, and it stays pushed while you hold."}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>When you lift your finger</span>
        <Segmented group="release" value={o.release} onChange={(v) => update({ tpRelease: v })}
          options={[{ id: "instant", label: "Instant", recommended: true }, { id: "glide", label: "Glide" }]} />
        <span className="text-[10px] text-zinc-500 leading-snug">
          {o.release === "instant"
            ? "The stick snaps back to centre the moment you lift."
            : "The stick eases back to centre. Smoother, but the camera drifts a little after you let go."}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className={LABEL}>Sensitivity</span>
          <span className="text-[11px] font-bold text-white tabular-nums">{(sensPct / 100).toFixed(2)}×</span>
        </div>
        {slider(sensPct, Math.round(TP_SENS_MIN * 100), Math.round(TP_SENS_MAX * 100), (v) => update({ tpSens: v / 100 }))}
        <span className="text-[10px] text-zinc-500 leading-snug">Lower for slow, precise aim. Higher for quick turns. Recommended: 1.00×.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Shape</span>
        <Segmented group="shape" value={round ? "circle" : "rect"}
          onChange={(v) => update(v === "circle" ? { tpShape: "circle", w: Math.round(Math.min(w, h)), h: Math.round(Math.min(w, h)) } : { tpShape: "rect" })}
          options={[{ id: "rect", label: "Rectangle" }, { id: "circle", label: "Circle" }]} />
        <span className="text-[10px] text-zinc-500 leading-snug">
          {round ? "A round pad. Only the circle takes touches." : "A flat pad like a laptop trackpad. You can make it wide or tall."}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Size</span>
        {round ? (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-zinc-500">Diameter</span>
            {slider(Math.round(Math.min(w, h)), 140, 520, (v) => update({ w: v, h: v }))}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">Width</span>
              {slider(Math.round(w), 160, 760, (v) => update({ w: v, h }))}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500">Height</span>
              {slider(Math.round(h), 100, 520, (v) => update({ h: v, w }))}
            </div>
          </>
        )}
      </div>

      {!isDefault && (
        <button onClick={() => update({ tpFeel: TP_DEFAULT_FEEL, tpRelease: TP_DEFAULT_RELEASE, tpSens: TP_DEFAULT_SENS })}
          className="py-2 rounded-xl text-xs font-bold bg-white/5 text-primary hover:bg-white/10 transition-colors active:scale-[0.98]">
          Use the recommended settings
        </button>
      )}
    </div>
  );
}
