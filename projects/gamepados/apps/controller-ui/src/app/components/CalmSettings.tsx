import React, { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WHEEL_RANGES, clampWheelRange } from "../store/prefs";
import { Gauge, Vibrate, Cpu } from "lucide-react";

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

export function CalmSwitch({label, detail, on, onChange}: {label:string; detail?:string; on:boolean; onChange:(v:boolean)=>void}) {
  const id=useId();
  const reduced = useReducedMotion();
  return <div className="calm-setting-row"><div className="calm-grow"><span id={id} className="calm-setting-label">{label}</span>
    {detail && <p id={`${id}-detail`}>{detail}</p>}</div>
    <button data-testid={`${label.toLowerCase().replace(/\s+/g, '-')}-switch`} className="calm-switch" role="switch" aria-checked={on} aria-labelledby={id} aria-describedby={detail ? `${id}-detail` : undefined} onClick={()=>onChange(!on)}><span><motion.i animate={{ x: on ? 18 : 0 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 28 }} /></span></button>
  </div>;
}

function Range({label, detail, min, max, value, onChange}: {label:string;detail:string;min:number;max:number;value:number;onChange:(n:number)=>void}) {
  const id=useId();
  return <div className="calm-range"><div><label htmlFor={id}>{label}</label><output htmlFor={id}>{value}°</output></div>
    <input data-testid={`${label.toLowerCase().replace(/\s+/g, '-')}-slider`} id={id} type="range" min={min} max={max} step={1} value={value} aria-describedby={`${id}-detail`} aria-valuetext={`${value} degrees`} onChange={e=>onChange(Number(e.target.value))} />
    <p id={`${id}-detail`}>{detail}</p></div>;
}

export function CalmSettings(p:CalmSettingsProps) {
  const [temp,setTemp]=useState(0);
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
    <h1 className="sr-only" data-testid="settings-heading">Settings</h1>
    {!bridge && <p className="calm-inline-note">Browser preview · Live device readings are available in the Android app.</p>}
    <section data-tone="blue" className="calm-settings-section"><h2><Gauge size={15} />Motion</h2><div className="calm-settings-panel">
      <CalmSwitch label="Tilt steering" detail="Steer by tilting your phone left and right." on={p.gyroOn} onChange={p.setGyroOn}/>
      <AnimatePresence initial={false}>{p.gyroOn && <motion.div className="calm-setting-options" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .22 }} style={{ overflow: 'hidden' }}>
        <CalmSwitch label="Wheel mode" detail="For a mounted phone you turn like a steering wheel." on={p.gyroWheel} onChange={p.setGyroWheel}/>
        {p.gyroWheel ? <div className="calm-setting-detail"><h3>Lock-to-lock range</h3>
          <div className="calm-segment" role="group" aria-label="Wheel range">{WHEEL_RANGES.map(r=><button key={r} aria-pressed={p.gyroWheelRange===r} onClick={()=>p.setGyroWheelRange(r)}>{r}°</button>)}</div>
          <p>{Math.round(clampWheelRange(p.gyroWheelRange)/2)}° each way for full lock. Keep the phone mounted upright or tilted, never flat. The screen stays locked while wheel mode is on.</p>
        </div> : <Range label="Steering sensitivity" detail="The angle needed for full steering. A smaller angle responds to a smaller tilt." min={1} max={90} value={p.gyroMaxAngle} onChange={p.setGyroMaxAngle}/>}
        <Range label="Ignore small tilts" detail="Keeps the car straight around the centre. Set to 0° to respond to every tilt; steering follows your real angle beyond this range." min={0} max={30} value={p.gyroDeadzone} onChange={p.setGyroDeadzone}/>
        <div className="calm-setting-detail"><h3>Motion mode</h3><div className="calm-segment" role="group" aria-label="Motion mode">
          <button aria-pressed={p.gyroMode==="racing"} onClick={()=>p.setGyroMode("racing")}>Racing</button>
          <button aria-pressed={p.gyroMode==="3d"} onClick={()=>p.setGyroMode("3d")}>3D aim</button>
        </div><p>{p.gyroMode==="racing" ? "Left and right tilt controls the left stick." : "Tilt controls the right stick on both axes, with an on-screen scope."}</p></div>
        {p.gyroMode==="racing" && <CalmSwitch label="Tilt throttle" detail="Tilt forward to accelerate and back to brake (left-stick Y)." on={p.gyroThrottle} onChange={p.setGyroThrottle}/>}
        <CalmSwitch label="Pause when laid flat" detail="Pauses tilt while the phone rests flat. Switch off for continuous motion input." on={p.gyroIdleDetect} onChange={p.setGyroIdleDetect}/>
      </motion.div>}</AnimatePresence>
    </div></section>
    <section data-tone="violet" className="calm-settings-section"><h2><Vibrate size={15} />Feel</h2><div className="calm-settings-panel">
      <CalmSwitch label="App vibration" detail="Feedback for button presses and full-turn bumps." on={p.gyroHaptic} onChange={p.setGyroHaptic}/>
      <CalmSwitch label="Game rumble" detail="Feel crashes, weapons and terrain from your game." on={p.rumbleOn} onChange={p.setRumbleOn}/>
    </div></section>
    <section className="calm-settings-section"><h2><Cpu size={15} />Your device</h2><div className="calm-settings-panel"><div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">Temperature</span><p>Your phone manages its own thermal performance.</p></div><output className="calm-temperature">{temp>0?`${temp.toFixed(1)}°C`:"Unavailable"}</output></div></div></section>
    {p.children}
  </div>;
}
