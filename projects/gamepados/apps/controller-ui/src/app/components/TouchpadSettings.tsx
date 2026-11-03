// ── Touchpad settings panel (layout editor) ──────────────────────────────────
// Just the choices: how it feels, what happens on lift, how sensitive, how big. A touchpad is
// always a rectangle.

import React from "react";
import { motion } from "framer-motion";
import { CustomBtnDef } from "../types";
import {
  cleanTouchpadOptions, touchpadSize,
  TP_DEFAULT_FEEL, TP_DEFAULT_RELEASE, TP_DEFAULT_SENS, TP_SENS_MIN, TP_SENS_MAX,
} from "../touchpad";

type Slider = (value: number, min: number, max: number, onChange: (v: number) => void) => React.ReactNode;

const LABEL = "text-[10px] uppercase font-bold text-zinc-500 tracking-wider";

/** Two-choice switch with a gliding highlight. */
function Segmented<T extends string>({ group, value, options, onChange }: {
  group: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
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
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
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
  const isDefault = o.feel === TP_DEFAULT_FEEL && o.release === TP_DEFAULT_RELEASE && o.sens === TP_DEFAULT_SENS;
  const sensPct = Math.round(o.sens * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Feel</span>
        <Segmented group="feel" value={o.feel} onChange={(v) => update({ tpFeel: v })}
          options={[{ id: "speed", label: "Speed" }, { id: "distance", label: "Distance" }]} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>On lift</span>
        <Segmented group="release" value={o.release} onChange={(v) => update({ tpRelease: v })}
          options={[{ id: "instant", label: "Instant" }, { id: "glide", label: "Glide" }]} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className={LABEL}>Sensitivity</span>
          <span className="text-[11px] font-bold text-white tabular-nums">{(sensPct / 100).toFixed(2)}×</span>
        </div>
        {slider(sensPct, Math.round(TP_SENS_MIN * 100), Math.round(TP_SENS_MAX * 100), (v) => update({ tpSens: v / 100 }))}
      </div>

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Width</span>
        {slider(Math.round(w), 160, 760, (v) => update({ w: v, h }))}
      </div>
      <div className="flex flex-col gap-1">
        <span className={LABEL}>Height</span>
        {slider(Math.round(h), 100, 520, (v) => update({ h: v, w }))}
      </div>

      {!isDefault && (
        <button onClick={() => update({ tpFeel: TP_DEFAULT_FEEL, tpRelease: TP_DEFAULT_RELEASE, tpSens: TP_DEFAULT_SENS })}
          className="py-2 rounded-xl text-xs font-bold bg-white/5 text-primary hover:bg-white/10 transition-colors active:scale-[0.98]">
          Reset
        </button>
      )}
    </div>
  );
}
