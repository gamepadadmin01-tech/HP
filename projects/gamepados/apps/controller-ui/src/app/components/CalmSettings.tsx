import React, { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WHEEL_RANGES } from "../store/prefs";
import { Gauge, Vibrate, Cpu, Crosshair, Globe, ChevronRight, Check } from "lucide-react";
import { stickFeel, setRightGain, RIGHT_GAIN_MIN, RIGHT_GAIN_MAX } from "../stickFeel";
import { Collapse } from "./Motion";
import { LANGS, setLangChoice, t, useLang, type LangChoice } from "../i18n";

// Settings (2.1, owner 2026-11-18): the settings most players use are always on the page; the extra, rarely used
// ones sit under "More settings" (closed by default). Every label is written in English here and shown through
// t(), so test ids and the smoke tests keep working in every language.

export interface CalmSettingsProps {
  children?: React.ReactNode;
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
}

const testId = (en: string) => en.toLowerCase().replace(/\s+/g, '-');

/** `label` is the English sentence; it is shown translated. */
export function CalmSwitch({label, detail, on, onChange}: {label:string; detail?:string; on:boolean; onChange:(v:boolean)=>void}) {
  const id=useId();
  const reduced = useReducedMotion();
  return <div className="calm-setting-row"><div className="calm-grow"><span id={id} className="calm-setting-label">{t(label)}</span>
    {detail && <p id={`${id}-detail`}>{t(detail)}</p>}</div>
    <button data-testid={`${testId(label)}-switch`} className="calm-switch" role="switch" aria-checked={on} aria-labelledby={id} aria-describedby={detail ? `${id}-detail` : undefined} onClick={()=>onChange(!on)}><span><motion.i animate={{ x: on ? 18 : 0 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 28 }} /></span></button>
  </div>;
}

function Range({label, detail, min, max, value, onChange, step = 1, unit = "°"}: {label:string;detail?:string;min:number;max:number;value:number;onChange:(n:number)=>void;step?:number;unit?:string}) {
  const id=useId();
  return <div className="calm-range"><div><label htmlFor={id}>{t(label)}</label><output htmlFor={id}>{value}{unit}</output></div>
    <input data-testid={`${testId(label)}-slider`} id={id} type="range" min={min} max={max} step={step} value={value} aria-describedby={detail ? `${id}-detail` : undefined} aria-valuetext={unit === "°" ? t("{n} degrees", { n: value }) : `${value}${unit}`} style={{ "--pct": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} onChange={e=>onChange(Number(e.target.value))} />
    {detail && <p id={`${id}-detail`}>{t(detail)}</p>}</div>;
}

/** Right stick sensitivity (a customer asked for it). Talks to the shared stick-feel store directly, so the
 *  page's packet builder and the phone's touch engine both pick the new value up (see stickFeel.ts). */
function RightStickSensitivity() {
  const [pct, setPct] = useState(() => Math.round(stickFeel.rightGain * 100));
  const set = (v: number) => { setPct(v); setRightGain(v / 100); };
  return <>
    <Range label="Right stick sensitivity" min={Math.round(RIGHT_GAIN_MIN * 100)} max={Math.round(RIGHT_GAIN_MAX * 100)} step={5} unit="%" value={pct} onChange={set}
      />
    <div className="calm-segment" role="group" aria-label="Right stick sensitivity presets">
      {[50, 75, 100, 150].map((v) => <button key={v} aria-pressed={pct === v} onClick={() => set(v)}>{v === 100 ? `${t("Normal")} 100%` : v + "%"}</button>)}
    </div>
  </>;
}

/** Language: Automatic (follows the phone) or one of LANGS, each in its own name. Away from English the row also
 *  says "Language" in English, so someone who lands in a language they cannot read can still find it. */
function LanguageRow() {
  const { lang, choice } = useLang();
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = LANGS.find((l) => l.code === lang)?.name ?? "English";
  const options: { code: LangChoice; name: string }[] = [{ code: "auto", name: t("Automatic (phone language)") }, ...LANGS];
  return <div className="calm-lang">
    <button type="button" className="calm-setting-row calm-lang-row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} data-testid="language-row">
      <Globe size={18} className="calm-lang-icon" aria-hidden="true" />
      <div className="calm-grow"><span className="calm-setting-label">{t("Language")}{lang !== "en" && <span className="calm-lang-en"> · Language</span>}</span></div>
      <span className="calm-lang-value">{choice === "auto" ? `${t("Automatic")} · ${current}` : current}</span>
      <span className="calm-help-chevron" aria-hidden="true"><ChevronRight size={16} /></span>
    </button>
    <Collapse open={open} id={id}>
      <div role="radiogroup" aria-label={t("Language")} className="calm-lang-list">
        {options.map((o) => <button key={o.code} type="button" role="radio" aria-checked={choice === o.code} lang={o.code === "auto" ? undefined : o.code}
          data-testid={`lang-${o.code}`} onClick={() => { setLangChoice(o.code); setOpen(false); }}>
          <span>{o.name}</span>{choice === o.code && <Check size={18} aria-hidden="true" />}
        </button>)}
      </div>
    </Collapse>
  </div>;
}

export function CalmSettings(p:CalmSettingsProps) {
  useLang();                                   // re-render every label when the language changes
  const [temp,setTemp]=useState(0);
  const [more, setMore] = useState(false);
  const moreId = useId();
  const bridge=(window as any).AndroidBridge;
  useEffect(()=>{
    if (!bridge?.getSystemStatsJson) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update=()=>{try {const t=JSON.parse(bridge.getSystemStatsJson()||"{}");if(typeof t.temp==="number")setTemp(t.temp);}catch { /* Preserve unavailable readings. */ }};
    const syncVisibility=()=>{
      clearInterval(timer);
      if (!document.hidden) { update(); timer=setInterval(update,1500); }
    };
    syncVisibility(); document.addEventListener('visibilitychange',syncVisibility);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',syncVisibility);};
  },[bridge]);
  return <div className="calm-settings">
    {/* The visible intro lines were removed (owner request, 2026-10-12). The heading stays for screen readers and for the UI tests. */}
    <h1 className="sr-only" data-testid="settings-heading">{t("Settings")}</h1>
    {!bridge && <p className="calm-inline-note">{t("Browser preview · Live device readings are available in the Android app.")}</p>}

    {/* ── Used most: always on the page ── */}
    <section data-tone="blue" className="calm-settings-section"><h2><Gauge size={15} />{t("Motion")}</h2><div className="calm-settings-panel">
      <CalmSwitch label="Tilt steering" on={p.gyroOn} onChange={p.setGyroOn}/>
      <AnimatePresence initial={false}>{p.gyroOn && <motion.div className="calm-setting-options" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .22 }} style={{ overflow: 'hidden' }}>
        {p.gyroWheel ? <div className="calm-setting-detail"><h3>{t("Lock-to-lock range")}</h3>
          <div className="calm-segment" role="group" aria-label={t("Wheel range")}>{WHEEL_RANGES.map(r=><button key={r} aria-pressed={p.gyroWheelRange===r} onClick={()=>p.setGyroWheelRange(r)}>{r}°</button>)}</div>
        </div> : <Range label="Steering sensitivity" min={1} max={90} value={p.gyroMaxAngle} onChange={p.setGyroMaxAngle}/>}
        <Range label="Ignore small tilts" min={0} max={30} value={p.gyroDeadzone} onChange={p.setGyroDeadzone}/>
      </motion.div>}</AnimatePresence>
    </div></section>
    <section data-tone="violet" className="calm-settings-section"><h2><Vibrate size={15} />{t("Feel")}</h2><div className="calm-settings-panel">
      <CalmSwitch label="App vibration" on={p.gyroHaptic} onChange={p.setGyroHaptic}/>
      <CalmSwitch label="Game rumble" on={p.rumbleOn} onChange={p.setRumbleOn}/>
    </div></section>
    <section className="calm-settings-section calm-lang-section"><div className="calm-settings-panel">
      <LanguageRow />
    </div></section>

    {/* ── Used rarely: under "More settings" ── */}
    <div className="calm-help calm-more">
      <button type="button" className="calm-help-toggle" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)} data-testid="more-settings">
        <span className="calm-help-chevron" aria-hidden="true"><ChevronRight size={16} /></span>{t("More settings")}
      </button>
      <Collapse open={more} id={moreId}>
        <section data-tone="blue" className="calm-settings-section"><h2><Crosshair size={15} />{t("Aim")}</h2><div className="calm-settings-panel">
          <RightStickSensitivity />
        </div></section>
        {p.gyroOn && <section data-tone="blue" className="calm-settings-section"><h2><Gauge size={15} />{t("Tilt steering")}</h2><div className="calm-settings-panel">
          <CalmSwitch label="Wheel mode" on={p.gyroWheel} onChange={p.setGyroWheel}/>
          <div className="calm-setting-detail"><h3>{t("Motion mode")}</h3><div className="calm-segment" role="group" aria-label={t("Motion mode")}>
            <button aria-pressed={p.gyroMode==="racing"} onClick={()=>p.setGyroMode("racing")}>{t("Racing")}</button>
            <button aria-pressed={p.gyroMode==="3d"} onClick={()=>p.setGyroMode("3d")}>{t("3D aim")}</button>
          </div></div>
          <CalmSwitch label="Pause when laid flat" on={p.gyroIdleDetect} onChange={p.setGyroIdleDetect}/>
        </div></section>}
        <section className="calm-settings-section"><h2><Cpu size={15} />{t("Your device")}</h2><div className="calm-settings-panel"><div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">{t("Temperature")}</span></div><output className="calm-temperature">{temp>0?`${temp.toFixed(1)}°C`:t("Unavailable")}</output></div></div></section>
      </Collapse>
    </div>
    {p.children}
  </div>;
}
