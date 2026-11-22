import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Camera, Check, ChevronRight, Crown, Download, Flashlight, FlashlightOff, Info, Lock, Monitor, Moon,
  MonitorSmartphone, Palette, Play, QrCode, RefreshCw, ScanLine, Settings as SettingsIcon, SlidersHorizontal, Smartphone, Sparkles, RectangleHorizontal, RectangleVertical,
  Square, Sun, SwitchCamera, Timer, Usb, Video, Wifi, X,
} from "lucide-react";
import { ChoiceBar, Collapse, SwapIn } from "../app/components/Motion";
import { ShellMotion } from "../app/components/ShellMotion";
import { ShellScreenTransition } from "../app/components/ShellScreenTransition";
import { CalmSwitch } from "../app/components/CalmSettings";
import { FADE, SPRING, backdropIn, cardIn, toastIn } from "../app/motion";

// ─── CamOS ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Phone as a webcam for Windows, built from GamepadOS's OWN pieces (shell, tabs, settings rows, plan cards, Connect
// screen, QR scanner, motion presets). Owner, 2026-11-21:
//   • two sections only: Camera (home) and Settings, and Settings holds EVERY camera setting
//   • home has "Watch an ad → 1080p HD for 45 minutes"; Premium lives in Settings
//   • Premium = HD always + no watermark + special filters (colour looks, face smoothing, low-light boost, blur)
//   • the app turns with the phone before Start; after Start the picture follows the chosen settings
// Native side: apps/camos-android (window.CamOSBridge). PC side: Gamepad Server's camera module (port 7780).

type Bridge = {
  startScan(): void; stopScan(): void;
  start(ip: string, key: string, settings: string): void;
  update(settings: string): void;
  stop(): void; dim(on: boolean): void;
  check(ip: string, key: string): void;
  cameras(): string;
  deviceName(): string; version(): string; isTestBuild?(): boolean;
  sendState?(json: string): void;
  cameraReport?(): string;
  find?(key: string, usbOnly: boolean): void;
  openTetherSettings?(): void;
};
const bridge = (): Bridge | undefined => (window as any).CamOSBridge;

type PC = { ip: string; key: string; via?: "usb" | "wifi" };
type Route = "dashboard" | "connect" | "live";
type Tab = "home" | "system";
type LiveState = { state: "connecting" | "live"; message: string; fps: number; kbps: number; portrait?: boolean };
type PcStatus = { status: "unknown" | "checking" | "ready" | "old" | "unreachable" | "badkey" | "busy" | "error"; message: string };
type Lens = { id: string; front: boolean; label: string; zoomMin: number; zoomMax: number; evMin: number; evMax: number; evStep: number;
  flash: boolean; manualFocus: boolean; stabilize: boolean; fps: number[] };

/** Everything the user can set. Mirrors CamSettings in CamStreamer.kt (same names). */
type Settings = {
  quality: 480 | 720 | 1080; fps: 15 | 24 | 30 | 60; bitrate: number; shape: "auto" | "landscape" | "portrait";
  cameraId: string; front: boolean; zoom: number; focus: "auto" | "manual"; focusDistance: number; stabilize: boolean;
  ev: number; wb: string; antiband: string; nr: string; torch: boolean; mirror: boolean;
  lowLight: boolean; look: string; smooth: number; autoDim: boolean;
  /** Smooth Wi-Fi mode: video over UDP like a video call (pc-server-rs/src/camera/udp.rs). The USB cable ignores it. */
  udp: boolean;
};
const DEFAULTS: Settings = {
  quality: 720, fps: 30, bitrate: 0, shape: "auto", cameraId: "", front: false, zoom: 1, focus: "auto", focusDistance: 0,
  stabilize: true, ev: 0, wb: "auto", antiband: "auto", nr: "normal", torch: false, mirror: true,
  lowLight: false, look: "none", smooth: 0, autoDim: false, udp: true,
};
const HD_MINUTES = 45;

/** Lenses to show in the browser preview (the phone reports its real ones). */
const PREVIEW_LENSES: Lens[] = [
  { id: "0", front: false, label: "Back · main", zoomMin: 0.6, zoomMax: 8, evMin: -12, evMax: 12, evStep: 1 / 6, flash: true, manualFocus: true, stabilize: true, fps: [15, 24, 30, 60] },
  { id: "1", front: true, label: "Front", zoomMin: 1, zoomMax: 4, evMin: -12, evMax: 12, evStep: 1 / 6, flash: false, manualFocus: false, stabilize: true, fps: [15, 24, 30] },
];

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
function useSaved<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void] {
  const [v, setV] = useState<T>(() => store.get(key, initial));
  return [v, (n) => setV((old) => { const next = typeof n === "function" ? (n as (o: T) => T)(old) : n; store.set(key, next); return next; })];
}

/** The Gamepad Server QR is "ip,port,key". CamOS always streams to port 7780, so only ip + key matter. */
export function parseQR(text: string): PC | null {
  const [ip, , key] = text.trim().split(",");
  const okIp = !!ip && ip.split(".").length === 4 && ip.split(".").every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  return okIp && /^[a-f0-9]{8}$/i.test(key ?? "") ? { ip, key: key.toLowerCase() } : null;
}

const QUALITY_HELP: Record<number, string> = {
  480: "Smallest and coolest. Good on slow Wi-Fi.",
  720: "Best for video calls. Recommended.",
  1080: "Sharpest picture. Needs good Wi-Fi; the phone runs warmer.",
};
const SHAPE_HELP: Record<Settings["shape"], string> = {
  auto: "Wide if you hold the phone sideways when you press Start, tall if you hold it upright.",
  landscape: "Always a wide picture, like a normal webcam. Best for Zoom, Meet and Teams.",
  portrait: "Always a tall picture. Apps that expect wide video show it with bars at the sides.",
};
const LOOKS: { value: string; label: string }[] = [
  { value: "none", label: "None" }, { value: "warm", label: "Warm" }, { value: "cool", label: "Cool" },
  { value: "vivid", label: "Vivid" }, { value: "bw", label: "B&W" }, { value: "film", label: "Film" },
];
const lensShort = (l: Lens) => l.front ? "Front" : l.label.replace("Back · ", "").replace(/^main$/, "Main").replace(/^./, (c) => c.toUpperCase());
const fmtEv = (ev: number, step: number) => { const v = ev * step; return `${v > 0 ? "+" : ""}${v.toFixed(1)}`; };
const minutesLeft = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 60000));

const TABS: { id: Tab; label: string; Icon: typeof Video }[] = [
  { id: "home", label: "Camera", Icon: Video },
  { id: "system", label: "Settings", Icon: SettingsIcon },
];

export default function CamOSApp() {
  const [route, setRoute] = useState<Route>("dashboard");
  const [tab, setTab] = useState<Tab>("home");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("menu");
  const [pc, setPc] = useSaved<PC | null>("camos.pc", null);
  const [settings, setSettingsRaw] = useSaved<Settings>("camos.settings", DEFAULTS);
  const s: Settings = { ...DEFAULTS, ...settings };
  const set = (patch: Partial<Settings>) => setSettingsRaw((old) => ({ ...DEFAULTS, ...old, ...patch }));
  const [premium, setPremium] = useSaved<boolean>("camos.premiumTest", false);
  const [hdUntil, setHdUntil] = useSaved<number>("camos.hdUntil", 0);
  const [now, setNow] = useState(Date.now());
  const [pcStatus, setPcStatus] = useState<PcStatus>({ status: "unknown", message: "" });
  const [live, setLive] = useState<LiveState>({ state: "connecting", message: "", fps: 0, kbps: 0 });
  const [toast, setToast] = useState("");
  const [adPlaying, setAdPlaying] = useState(false);
  const toastTimer = useRef<number>(0);
  const restartAfterStop = useRef(false);
  /** When this phone's own stream last ended, and whether the PC check after it was already retried. */
  const streamEndedAt = useRef(0);
  const busyRetried = useRef(false);
  /** 60 fps chosen but the camera delivers much less: count live seconds, tell the user once. */
  const lowFpsSeconds = useRef(0);
  /** Wi-Fi: the saved address didn't answer, so the phone asked "where is my PC?" once (the PC's address changes
   *  when it joins another network or the router hands out a new one). */
  const refinding = useRef<{ forIp: string; message: string } | null>(null);
  const [usbSearch, setUsbSearch] = useState<"idle" | "searching" | "failed">("idle");
  /** USB tethering or USB debugging is on (told by the native watcher): connect over the cable by itself. */
  const [usbOn, setUsbOn] = useState(false);
  const findUsb = () => { const b = bridge(); if (!b?.find) return; setUsbSearch("searching"); b.find(pc?.key ?? "", true); };
  const told60 = useRef(false);
  const showToast = (m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(""), 4600); };

  const testBuild = (() => { try { return bridge()?.isTestBuild?.() ?? true; } catch { return false; } })();
  const lenses: Lens[] = useMemo(() => {
    try { const b = bridge(); const l = b ? JSON.parse(b.cameras()) as Lens[] : PREVIEW_LENSES; return l.length ? l : PREVIEW_LENSES; } catch { return PREVIEW_LENSES; }
  }, []);
  const lens = lenses.find((l) => l.id === s.cameraId && l.front === s.front) ?? lenses.find((l) => l.front === s.front) ?? lenses[0];

  // HD = Premium, or the 45 minutes from an ad. The minute counter ticks while time is left.
  const adHd = hdUntil > now;
  const hdAllowed = premium || adHd;
  useEffect(() => { if (!adHd) return; const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, [adHd]);

  /** What the phone actually streams: locked extras fall back to what this user has. */
  const nativeSettings = (st: Settings = s) => JSON.stringify({
    ...st,
    quality: st.quality === 1080 && !hdAllowed ? 720 : st.quality,
    fps: st.fps <= 30 ? st.fps : lens.fps.includes(60) ? 60 : 30,
    cameraId: lens.id,
    front: lens.front,
    watermark: !premium,
    look: premium ? st.look : "none",
    smooth: premium ? st.smooth : 0,
    lowLight: premium ? st.lowLight : false,
  });

  // The camera is drawn BEHIND the page while scanning or live, so the page background must let it through.
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    const see = route === "live" || scanning;
    document.documentElement.style.background = see ? "transparent" : "";
    document.body.style.background = see ? "transparent" : "";
  }, [route, scanning]);

  // "Is my PC ready?" — after pairing, on opening the app and every time the home screen comes back.
  function checkPc(target: PC | null = pc) {
    if (!target) { setPcStatus({ status: "unknown", message: "" }); return; }
    const b = bridge();
    if (!b) { setPcStatus({ status: "unknown", message: "" }); return; }
    setPcStatus({ status: "checking", message: "" });
    b.check(target.ip, target.key);
  }
  useEffect(() => {
    if (route !== "dashboard") return;
    // Right after this phone stopped streaming, the PC may still be closing that stream for a moment: wait a
    // little before asking, so the answer isn't "busy with another phone" about ourselves.
    const justStopped = Date.now() - streamEndedAt.current < 2000;
    busyRetried.current = false;
    if (!justStopped) { checkPc(); return; }
    setPcStatus({ status: "checking", message: "" });
    const t = window.setTimeout(() => checkPc(), 900);
    return () => clearTimeout(t);
  }, [route, pc?.ip, pc?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  function start(target: PC | null = pc) {
    if (!target) { setRoute("connect"); return; }
    const b = bridge();
    if (!b) { showToast("Open CamOS on your Android phone to stream."); return; }
    if (s.quality === 1080 && !hdAllowed) showToast("1080p HD needs Premium or an ad unlock. Streaming in 720p.");
    setLive({ state: "connecting", message: `Connecting to ${target.ip}…`, fps: 0, kbps: 0 });
    setRoute("live");
    b.start(target.ip, target.key, nativeSettings());
  }

  // While live, every change applies straight away (camera, lens, flashlight, filters).
  const firstLive = useRef(true);
  useEffect(() => {
    if (route !== "live") { firstLive.current = true; return; }
    if (firstLive.current) { firstLive.current = false; return; }
    bridge()?.update(nativeSettings());
  }, [route, JSON.stringify(s), premium]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the ad's 45 minutes run out mid-stream, carry on in 720p instead of stopping.
  useEffect(() => {
    if (route !== "live" || premium || !adHd || s.quality !== 1080) return;
    const t = window.setTimeout(() => {
      setNow(Date.now());
      restartAfterStop.current = true;
      bridge()?.stop();
      showToast(`Your ${HD_MINUTES} minutes of HD are over. Streaming in 720p now.`);
    }, Math.max(0, hdUntil - Date.now()));
    return () => clearTimeout(t);
  }, [route, premium, adHd, hdUntil, s.quality]);

  /** Some changes (picture shape, quality) need a new stream: stop, then start again with them. */
  function restartWith(patch: Partial<Settings>, message: string) {
    set(patch);
    restartAfterStop.current = true;
    setLive((l) => ({ ...l, state: "connecting", message }));
    bridge()?.stop();
  }

  // ── The PC window as a remote (owner, 2026-11-22). The PHONE decides: every request below goes through the
  // same plan checks as the phone's own buttons, and the phone then reports what is really set. A modified PC
  // server can only ask; it cannot unlock Premium, HD or remove the watermark (those are applied on the phone).
  const other = lenses.find((l) => l.front !== lens.front);
  const portraitNow = live.portrait ?? s.shape === "portrait";
  const effQuality = s.quality === 1080 && !hdAllowed ? 720 : s.quality;
  const phoneState = () => JSON.stringify({
    quality: effQuality, fps: s.fps <= 30 ? s.fps : lens.fps.includes(60) ? 60 : 30, portrait: portraitNow, front: lens.front,
    zoom: Math.min(Math.max(s.zoom, lens.zoomMin), lens.zoomMax), zoomMin: lens.zoomMin, zoomMax: lens.zoomMax,
    ev: s.ev, evMin: lens.evMin, evMax: lens.evMax, evStep: lens.evStep,
    look: premium ? s.look : "none", smooth: premium ? s.smooth : 0, lowLight: premium && s.lowLight,
    torch: lens.flash && s.torch, premium, hd: hdAllowed, flash: lens.flash, otherLens: !!other,
  });
  const pushState = () => { try { bridge()?.sendState?.(phoneState()); } catch { /* older native side */ } };
  const stateKey = route === "live" && live.state === "live" ? phoneState() : "";
  useEffect(() => {
    if (!stateKey) return;
    pushState();
    // A quiet repeat, so a PC window that opened late (or restarted) still gets the picture of things.
    const t = window.setInterval(pushState, 5000);
    return () => clearInterval(t);
  }, [stateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function onRemote(json: string) {
    let m: { set?: Record<string, unknown>; action?: string };
    try { m = JSON.parse(json); } catch { return; }
    if (route !== "live") return;
    const b = bridge();
    switch (m.action) {
      case "flip": if (other) set({ front: other.front, cameraId: other.id, zoom: 1, torch: false }); break;
      case "reshape": restartWith({ shape: portraitNow ? "landscape" : "portrait" }, portraitNow ? "Switching to wide…" : "Switching to tall…"); break;
      case "dim": b?.dim(true); break;
      case "stop": b?.stop(); break;
    }
    for (const [k, v] of Object.entries(m.set ?? {})) {
      const num = typeof v === "number" && Number.isFinite(v) ? v : null;
      if (k === "torch" && typeof v === "boolean" && lens.flash) set({ torch: v });
      else if (k === "zoom" && num !== null) set({ zoom: Math.min(Math.max(num, lens.zoomMin), lens.zoomMax) });
      else if (k === "ev" && num !== null) set({ ev: Math.round(Math.min(Math.max(num, lens.evMin), lens.evMax)) });
      else if (k === "look" && typeof v === "string" && premium && LOOKS.some((l) => l.value === v)) set({ look: v });
      else if (k === "smooth" && num !== null && premium) set({ smooth: Math.min(Math.max(num, 0), 1) });
      else if (k === "lowLight" && typeof v === "boolean" && premium) set({ lowLight: v });
      else if (k === "quality" && (num === 480 || num === 720 || num === 1080) && (num !== 1080 || hdAllowed) && num !== effQuality)
        restartWith({ quality: num as Settings["quality"] }, `Switching to ${num}p…`);
      // Anything else (locked, unknown, out of range) is ignored; the state below shows the PC the truth.
    }
    pushState();
  }

  function watchAd() {
    if (premium) return;
    if (!testBuild) { showToast("Ads arrive with the Play Store release."); return; }
    setAdPlaying(true);
  }

  useEffect(() => {
    (window as any).camosOnQR = (text: string) => {
      setScanning(false);
      const found = parseQR(text);
      if (!found) { showToast("That QR code is not from Gamepad Server. Scan the code in the Gamepad Server window."); return; }
      setPc(found);
      setRoute("dashboard");   // the home screen checks the PC as it opens
    };
    (window as any).camosOnCheck = (json: string) => {
      const r = JSON.parse(json);
      if (!pc || r.ip !== pc.ip) return;   // a late answer for a PC this phone no longer uses
      if (r.status === "busy" && !busyRetried.current && Date.now() - streamEndedAt.current < 8000) {
        // Almost certainly our own stream still closing on the PC: one quiet retry instead of a false alarm.
        busyRetried.current = true;
        setPcStatus({ status: "checking", message: "" });
        window.setTimeout(() => checkPc(), 1200);
        return;
      }
      if (r.status === "unreachable" && pc.key && pc.via !== "usb" && refinding.current?.forIp !== pc.ip && bridge()?.find) {
        // Before saying "not answering", look for the PC at a new address (only it can answer: needs the key).
        refinding.current = { forIp: pc.ip, message: r.message };
        setPcStatus({ status: "checking", message: "" });
        bridge()!.find!(pc.key, false);
        return;
      }
      setPcStatus({ status: r.status, message: r.message });
    };
    (window as any).camosOnUsb = (json: string) => {
      const r = JSON.parse(json) as { on: boolean; via: string };
      setUsbOn(r.on);
      if (r.on) {
        // Cable just came up: find the PC on it and connect (no button needed). Not while streaming.
        if (route !== "live") findUsb();
      } else if (pc?.via === "usb") {
        // Cable gone: forget the cable address's "USB" mark so the phone looks for the PC on Wi-Fi again.
        setPc({ ip: pc.ip, key: pc.key });
        refinding.current = null;
      }
    };
    (window as any).camosOnFind = (json: string) => {
      const r = JSON.parse(json) as { ip: string | null; name: string; via: string };
      if (r.via === "usb" || usbSearch === "searching") {
        if (r.ip) {
          setUsbSearch("idle");
          setPc({ ip: r.ip, key: pc?.key ?? "", via: "usb" });
          setRoute("dashboard");
          showToast(`Connected to ${r.name || "your PC"} over USB.`);
        } else {
          setUsbSearch("failed");
          // Cable is on but no PC answered yet (Gamepad Server not open?): try again in a few seconds.
          if (usbOn) window.setTimeout(() => { if (route !== "live") findUsb(); }, 5000);
        }
        return;
      }
      const waiting = refinding.current;
      if (!pc || !waiting || waiting.forIp !== pc.ip) return;
      if (r.ip && r.ip !== pc.ip) {
        setPc({ ...pc, ip: r.ip });   // the home screen re-checks at the new address by itself
        showToast(`Found your PC at its new address (${r.ip}).`);
      } else {
        setPcStatus({ status: "unreachable", message: waiting.message });
      }
    };
    (window as any).camosOnState = (json: string) => {
      const st = JSON.parse(json);
      if (st.state === "stopped" || st.state === "error") { streamEndedAt.current = Date.now(); lowFpsSeconds.current = 0; }
      if (st.state === "stopped") {
        if (restartAfterStop.current) { restartAfterStop.current = false; setTimeout(() => start(), 400); return; }
        setRoute("dashboard"); return;
      }
      if (st.state === "error") { setScanning(false); setRoute((r) => (r === "live" ? "dashboard" : r)); showToast(st.message); return; }
      setLive({ state: st.state, message: st.message, fps: st.fps, kbps: st.kbps, portrait: st.portrait });
      if (st.state === "live" && st.fps > 0) {
        lowFpsSeconds.current = s.fps === 60 && st.fps < 45 ? lowFpsSeconds.current + 1 : 0;
        if (lowFpsSeconds.current === 5 && !told60.current) {
          told60.current = true;
          showToast(`Your phone gives CamOS ${st.fps} fps at this size. Try 720p for 60, or see Settings → About → Camera report.`);
        }
      }
    };
    (window as any).camosOnRemote = onRemote;
    (window as any).camosOnPermission = (ok: boolean) => { if (!ok) showToast("CamOS needs the camera permission to work as a webcam."); };
    // Android back button: the native side asks us first (true = handled here).
    (window as any).camosBack = () => {
      if (adPlaying) return true;
      if (scanning) { bridge()?.stopScan(); setScanning(false); return true; }
      if (route === "connect") { setRoute("dashboard"); return true; }
      if (route === "live") { bridge()?.stop(); return true; }
      if (tab === "system" && settingsPage !== "menu") { setSettingsPage("menu"); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    };
  });

  const goPremium = () => { setTab("system"); setSettingsPage("premium"); };

  return <>
  <AnimatePresence mode="wait" initial={false}>
    {route === "dashboard" && <ShellScreenTransition key="dashboard" direction={1} className="absolute inset-0">
      <Dashboard tab={tab} setTab={setTab} page={settingsPage} setPage={setSettingsPage} pc={pc} pcStatus={pcStatus} s={s} set={set} lenses={lenses} lens={lens}
        premium={premium} setPremium={setPremium} testBuild={testBuild} adHd={adHd} hdUntil={hdUntil} hdAllowed={hdAllowed}
        onStart={() => start()} onConnect={() => setRoute("connect")} onCheck={() => { refinding.current = null; if (usbOn) findUsb(); else checkPc(); }} onWatchAd={watchAd} goPremium={goPremium}
        showToast={showToast}
        onForget={() => { setPc(null); setPcStatus({ status: "unknown", message: "" }); showToast("This phone forgot the PC. Scan its QR code to pair again."); }} />
    </ShellScreenTransition>}
    {route === "connect" && <ShellScreenTransition key="connect" direction={-1} className="absolute inset-0">
      <ConnectScreen scanning={scanning} setScanning={setScanning} onBack={() => { setUsbSearch("idle"); setRoute("dashboard"); }}
        onManual={(found) => { setPc(found); setRoute("dashboard"); }}
        usbSearch={usbSearch}
        onUsb={() => { const b = bridge(); if (!b?.find) { showToast("Open CamOS on your Android phone to connect."); return; } setUsbSearch("searching"); b.find(pc?.key ?? "", true); }} />
    </ShellScreenTransition>}
    {route === "live" && <ShellScreenTransition key="live" direction={1} className="absolute inset-0">
      <LiveScreen live={live} s={s} set={set} lens={lens} lenses={lenses} premium={premium} hdAllowed={hdAllowed} goPremium={() => { bridge()?.stop(); goPremium(); }} showToast={showToast}
        onReshape={(shape) => restartWith({ shape }, shape === "landscape" ? "Switching to wide…" : "Switching to tall…")} />
    </ShellScreenTransition>}
  </AnimatePresence>
  <AnimatePresence>
    {adPlaying && <TestAd key="ad" onDone={() => { setAdPlaying(false); const until = Date.now() + HD_MINUTES * 60_000; setHdUntil(until); setNow(Date.now()); set({ quality: 1080 }); showToast(`HD unlocked for ${HD_MINUTES} minutes. 1080p is on.`); }}
      onCancel={() => setAdPlaying(false)} />}
  </AnimatePresence>
  <Toast message={toast} onClose={() => setToast("")} />
  </>;
}

// ─── Toast (same preset as GamepadOS's toasts: toastIn) ─────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="camos-toast-layer" aria-live="polite">
    <AnimatePresence>
      {message && <motion.div key={message} className="gp-shell camos-toast" role="status" {...toastIn} transition={SPRING}>
        <Info size={16} aria-hidden="true" /><span>{message}</span>
        <button className="camos-toast-close" onClick={onClose} aria-label="Dismiss"><X size={14} /></button>
      </motion.div>}
    </AnimatePresence>
  </div>;
}

/** Test builds only: a pretend 5-second ad, so the 45-minute HD unlock can be tried before real ads exist. */
function TestAd({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(5);
  useEffect(() => {
    if (left <= 0) { onDone(); return; }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  return <motion.div className="gp-shell camos-ad" {...backdropIn} transition={FADE} role="dialog" aria-label="Test ad">
    <motion.div className="camos-ad-card" {...cardIn} transition={SPRING}>
      <span className="camos-ad-tag">TEST AD</span>
      <Play size={34} aria-hidden="true" />
      <p className="camos-ad-title">A real ad plays here in the store version</p>
      <p className="camos-ad-count">HD unlocks in {left} s</p>
      <div className="camos-ad-bar"><motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 5, ease: "linear" }} /></div>
      <button className="calm-text-button" onClick={onCancel}>Cancel</button>
    </motion.div>
  </motion.div>;
}

// ─── Dashboard: the GamepadOS shell (header + two tabs) ─────────────────────────────────────────────────────────
type DashProps = {
  tab: Tab; setTab: (t: Tab) => void; page: SettingsPage; setPage: (p: SettingsPage) => void; pc: PC | null; pcStatus: PcStatus; s: Settings; set: (p: Partial<Settings>) => void;
  lenses: Lens[]; lens: Lens; premium: boolean; setPremium: (v: boolean) => void; testBuild: boolean;
  adHd: boolean; hdUntil: number; hdAllowed: boolean;
  onStart: () => void; onConnect: () => void; onCheck: () => void; onWatchAd: () => void; goPremium: () => void;
  onForget: () => void; showToast: (m: string) => void;
};

function Dashboard(p: DashProps) {
  const reduced = useReducedMotion();
  const mainRef = useRef<HTMLElement>(null);
  const entered = useRef(false);
  useEffect(() => { entered.current = true; }, []);
  const change = (t: Tab) => {
    if (t === p.tab) { if (t === "system" && p.page !== "menu") p.setPage("menu"); return; }
    mainRef.current?.scrollTo({ top: 0 }); p.setTab(t);
    if (t === "home") p.setPage("menu");
  };
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [p.page]);

  return <div className="gp-dashboard gp-shell camos-shell flex flex-col h-full">
    <ShellMotion />
    <header className="calm-header calm-header-centred">
      <span className="camos-brand" aria-label="CamOS"><Camera size={18} aria-hidden="true" />CamOS</span>
      <span aria-hidden="true" />
      <div className="calm-header-actions">
        <button className="calm-account-shortcut" data-premium={p.premium} onClick={p.goPremium} aria-label="Premium"><Crown size={18} aria-hidden="true" /></button>
      </div>
    </header>

    <main ref={mainRef} className="calm-main">
      <div className={p.tab === "home" ? "calm-home-content" : "calm-legacy-content"}>
        <TabFade key={p.tab} animate={!reduced && entered.current}>
          {p.tab === "home" && <TabCamera {...p} openSettings={() => { p.setPage("video"); change("system"); }} />}
          {p.tab === "system" && <TabSettings {...p} />}
        </TabFade>
      </div>
    </main>

    <nav className="calm-nav" aria-label="Main navigation">
      {TABS.map(({ id, label, Icon }) => <motion.button data-no-shell-press data-testid={`nav-${id}-button`} key={id} onClick={() => change(id)}
        aria-current={p.tab === id ? "page" : undefined} whileTap={reduced ? undefined : { scale: .94 }}>
        <span className="console-nav-icon">{p.tab === id && <motion.span className="console-nav-active" layoutId="camos-active-tab" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}<Icon size={20} /></span>
        <span>{label}</span>
      </motion.button>)}
    </nav>
  </div>;
}

/** Same as GamepadOS's TabFade: the new tab fades up (calm-swap-in), never on the very first paint. */
function TabFade({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const [cls] = useState(animate ? "calm-swap-in" : undefined);
  return <div className={cls}>{children}</div>;
}

// ─── Camera tab (Home) ─────────────────────────────────────────────────────────────────────────────────────────
/** Short words next to the big button (GamepadOS's layout); the full explanation sits in a note under it. */
function statusLine(pc: PC | null, st: PcStatus): { text: string; tone: "ok" | "wait" | "warn" | "none" } {
  if (!pc) return { text: "No PC paired yet", tone: "none" };
  switch (st.status) {
    case "checking": return { text: "Checking your PC…", tone: "wait" };
    case "ready": return { text: pc.via === "usb" ? "PC ready · USB" : `PC ready · ${pc.ip}`, tone: "ok" };
    case "unknown": return { text: `Paired with ${pc.ip}`, tone: "wait" };
    case "old": return { text: "Update Gamepad Server", tone: "warn" };
    case "badkey": return { text: "Pairing key changed", tone: "warn" };
    case "busy": return { text: "PC busy with another phone", tone: "warn" };
    case "unreachable": return { text: "PC not answering", tone: "warn" };
    default: return { text: "Your PC said no", tone: "warn" };
  }
}

function TabCamera(p: DashProps & { openSettings: () => void }) {
  const line = statusLine(p.pc, p.pcStatus);
  const left = minutesLeft(p.hdUntil);

  // Owner, 2026-11-22: big button in the middle, status under it, fewer words, steps first, then the HD offer.
  return <div className="calm-home camos-home">
    <h1 className="sr-only">Camera</h1>
    <div className="camos-start" data-tone={line.tone}>
      {p.pc
        ? <button className="console-connect-button" data-testid="camos-start" onClick={p.onStart}><Video size={20} aria-hidden="true" /><span>Start camera</span></button>
        : <button className="console-connect-button" data-testid="camos-connect" onClick={p.onConnect}><Monitor size={20} aria-hidden="true" /><span>Connect to PC</span></button>}
      <p className="camos-status" data-tone={line.tone}><span className="camos-status-dot" aria-hidden="true" />
        <SwapIn swapKey={line.text}><span>{line.text}</span></SwapIn></p>
      {p.pc && <p className="camos-status-actions">
        {p.pcStatus.status !== "checking" && <button className="camos-link" onClick={p.onCheck}>Check again</button>}
        <button className="camos-link" onClick={p.onConnect}>{p.pcStatus.status === "badkey" ? "Scan again" : "Change PC"}</button>
      </p>}
    </div>
    <Collapse open={line.tone === "warn"}>
      <div className="camos-notice" role="status">
        <p>{p.pcStatus.message}</p>
        {(p.pcStatus.status === "old" || p.pcStatus.status === "unreachable") &&
          <p className="camos-pc-hint"><Download size={14} aria-hidden="true" />On your PC, go to <b>gamepad.space</b> and download the PC server.</p>}
      </div>
    </Collapse>

    <div className="calm-section-heading"><h2>On your PC</h2></div>
    <ol className="calm-steps">
      <li className="calm-step"><span className="calm-step-number" aria-hidden="true">1</span><div><h2>Open Gamepad Server</h2><p>Same Wi-Fi as this phone.</p></div></li>
      <li className="calm-step"><span className="calm-step-number" aria-hidden="true">2</span><div><h2>Pick “CamOS Camera”</h2><p>In Zoom, Meet, Teams or any app.</p></div></li>
    </ol>

    {/* HD for 45 minutes from one ad. Premium users already have HD. */}
    <div className="calm-section-heading camos-gap"><h2>HD</h2></div>
    <SwapIn swapKey={p.premium ? "premium" : p.adHd ? "active" : "offer"}>
      {p.premium
        ? <div className="console-plan-card camos-hd-card" data-plan="LIFETIME"><div className="camos-hd-row"><Crown size={18} aria-hidden="true" />
            <p className="text-sm font-bold calm-ink">Premium · HD always</p></div></div>
        : p.adHd
        ? <div className="console-plan-card camos-hd-card" data-plan="AD"><div className="camos-hd-row"><Timer size={18} aria-hidden="true" />
            <p className="text-sm font-bold calm-ink calm-grow">HD on · {left} min left</p></div>
            <div className="camos-hd-meter"><span style={{ transform: `scaleX(${Math.min(1, left / HD_MINUTES)})` }} /></div></div>
        : <div className="console-plan-card camos-hd-card" data-plan="AD">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold calm-ink">1080p HD for {HD_MINUTES} min</p>
              <p className="console-plan-price text-xl font-bold shrink-0">Free</p>
            </div>
            <button className="console-plan-buy mt-3 w-full py-3 rounded-xl text-sm font-semibold transition-colors" data-testid="camos-watch-ad" onClick={p.onWatchAd}><Play size={14} aria-hidden="true" /> Watch an ad</button>
            <button className="camos-link camos-premium-link" onClick={p.goPremium}><Crown size={14} aria-hidden="true" />Or go Premium</button>
          </div>}
    </SwapIn>
  </div>;
}

// ─── Settings tab: Premium + every camera setting (GamepadOS settings sections, rows, switches, sliders) ────────
/** Same markup as GamepadOS's settings slider (calm-range), so it looks and moves the same. */
function CamRange({ label, detail, min, max, step = 1, value, shown, onChange, testId }: {
  label: string; detail?: string; min: number; max: number; step?: number; value: number; shown: string; onChange: (n: number) => void; testId?: string;
}) {
  const id = useId();
  return <div className="calm-range"><div><label htmlFor={id}>{label}</label><output htmlFor={id}>{shown}</output></div>
    <input data-testid={testId} id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={shown}
      style={{ "--pct": `${((value - min) / (max - min || 1)) * 100}%` } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
    {detail && <p>{detail}</p>}</div>;
}

/** What this phone's cameras offer to apps (frame rates, high-speed modes, fastest rate per size). For support:
 *  it shows whether 1080p60 / 4K are possible for CamOS on this phone. */
function CameraReport() {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => { try { return open ? bridge()?.cameraReport?.() ?? "Open CamOS on your phone to see this." : ""; } catch { return ""; } }, [open]);
  return <>
    <div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">Camera report</span>
      <p>What your cameras offer to apps: frame rates and sizes.</p></div>
      <button className="calm-text-button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide" : "Show"}</button></div>
    <Collapse open={open}><pre className="camos-report">{text}</pre></Collapse>
  </>;
}

const premiumBadge = <span className="camos-badge"><Crown size={11} aria-hidden="true" />Premium</span>;

export type SettingsPage = "menu" | "premium" | "video" | "camera" | "light" | "filters" | "screen" | "pc" | "about";

/** Settings = a short list of categories (GamepadOS's chevron rows); each opens its own page (owner, 2026-11-21:
 *  "divide the settings based on the category and type, so that users can handle easily"). */
function TabSettings(p: DashProps) {
  const firstPaint = useRef(true);
  useEffect(() => { firstPaint.current = false; }, []);
  const { s, set, lens } = p;
  const version = (() => { try { return bridge()?.version() ?? "browser preview"; } catch { return ""; } })();
  const fpsChoices = [15, 24, 30, 60] as const;
  const can60 = lens.fps.includes(60);
  const fpsNow = s.fps === 60 && !can60 ? 30 : s.fps;
  const lockedTap = (what: string) => { p.showToast(`${what} is part of Premium.`); p.goPremium(); };
  const chooseQuality = (v: string) => {
    const q = Number(v) as Settings["quality"];
    if (q === 1080 && !p.hdAllowed) { p.showToast("1080p HD: watch an ad on the Camera tab for 45 minutes, or get Premium."); return; }
    set({ quality: q });
  };
  const panel = (body: React.ReactNode, cls = "") => <div className={`calm-settings-panel ${cls}`}>{body}</div>;
  const wbName: Record<string, string> = { auto: "Auto", daylight: "Sunny", cloudy: "Cloudy", incandescent: "Bulb", fluorescent: "Tube light" };
  const lookName = LOOKS.find((l) => l.value === s.look)?.label ?? "None";
  const q = s.quality === 1080 && !p.hdAllowed ? 720 : s.quality;

  const pages: { id: Exclude<SettingsPage, "menu">; title: string; Icon: typeof Video; tone?: string; summary: string; badge?: boolean; body: () => React.ReactNode }[] = [
    { id: "premium", title: "Premium", Icon: Crown, summary: p.premium ? "Active · HD, no watermark, filters" : "₹19 Lifetime · HD, no watermark, filters",
      body: () => <div className="space-y-2">
      <div className="space-y-2">
        <div className="console-plan-card" data-plan="LIFETIME">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-sm font-bold calm-ink">{p.premium ? "Premium is on" : "CamOS Premium · Lifetime"}</p>
              <ul className="mt-1.5 space-y-0.5">{["1080p HD, always", "No watermark", "Filters: colour looks, face smoothing, low-light boost", "No ads", "Also unlocks GamepadOS"].map((b) =>
                <li key={b} className="text-xs calm-muted"><Check size={12} aria-hidden="true" />{b}</li>)}</ul></div>
            <p className="console-plan-price text-xl font-bold shrink-0">₹19</p>
          </div>
          <button className="console-plan-buy mt-3 w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60" disabled>{p.premium ? "Active" : "Get Premium"}</button>
        </div>
        {!p.premium && <p className="calm-inline-note">Buying arrives with the Play Store release. One purchase covers both CamOS and GamepadOS.</p>}
        {p.testBuild && <div className="calm-settings-panel"><CalmSwitch label="Test build: pretend Premium" detail="Only in test builds, so every Premium screen and filter can be tried." on={p.premium} onChange={p.setPremium} /></div>}
      </div>
      </div> },
    { id: "video", title: "Video quality", Icon: Video, tone: "blue", summary: `${q}p · ${fpsNow} fps · ${s.bitrate ? `${(s.bitrate / 1000).toFixed(1)} Mbit/s` : "Auto bitrate"} · ${{ auto: "Auto shape", landscape: "Wide", portrait: "Tall" }[s.shape]}`,
      body: () => panel(<>
      <div className="calm-setting-detail camos-first"><h3>Quality</h3>
        <ChoiceBar label="Picture quality" value={String(s.quality)} onChoose={chooseQuality}
          choices={[{ value: "480", label: "480p", testId: "s-q-480" }, { value: "720", label: "720p", testId: "s-q-720" },
            { value: "1080", label: <>1080p<span className="camos-hd">{p.hdAllowed ? "HD" : <Lock size={9} />}</span></>, testId: "s-q-1080" }]} />
        <SwapIn swapKey={String(s.quality)}><p>{QUALITY_HELP[s.quality]}</p></SwapIn>
      </div>
      <div className="calm-setting-detail"><h3>Frame rate</h3>
        <ChoiceBar label="Frame rate" value={String(s.fps)} onChoose={(v) => set({ fps: Number(v) as Settings["fps"] })}
          choices={fpsChoices.map((f) => ({ value: String(f), label: `${f} fps`, testId: `s-fps-${f}` }))} />
        <SwapIn swapKey={`${s.fps}-${can60}`}><p>{s.fps >= 60 ? (can60 ? "Smoothest motion. Uses more Wi-Fi and battery." : "This lens can't film 60 fps, so CamOS uses 30. Try another lens.")
          : s.fps <= 15 ? "Saves Wi-Fi and battery. Motion looks choppy." : "30 fps is what most webcams use."}</p></SwapIn>
      </div>
      <CalmSwitch label="Automatic bitrate" detail="CamOS picks how much detail to send for your quality and frame rate." on={s.bitrate === 0} onChange={(v) => set({ bitrate: v ? 0 : 6000 })} />
      <Collapse open={s.bitrate !== 0}>
        <CamRange label="Bitrate" min={1000} max={20000} step={500} value={s.bitrate || 6000} shown={`${((s.bitrate || 6000) / 1000).toFixed(1)} Mbit/s`}
          detail="Higher is sharper but needs stronger Wi-Fi. If the picture stutters, lower it." onChange={(v) => set({ bitrate: v })} testId="s-bitrate" />
      </Collapse>
      <CalmSwitch label="Smooth Wi-Fi mode" detail="Sends video the way video calls do, so a weak moment in the Wi-Fi doesn't freeze the picture. The USB cable doesn't need it."
        on={s.udp} onChange={(v) => set({ udp: v })} />
      <div className="calm-setting-detail"><h3>Picture shape</h3>
        <ChoiceBar label="Picture shape" value={s.shape} onChoose={(v) => set({ shape: v })}
          choices={[{ value: "auto", label: "Auto", testId: "s-shape-auto" }, { value: "landscape", label: "Wide", testId: "s-shape-wide" }, { value: "portrait", label: "Tall", testId: "s-shape-tall" }]} />
        <SwapIn swapKey={s.shape}><p>{SHAPE_HELP[s.shape]}</p></SwapIn>
      </div>
      </>) },
    { id: "camera", title: "Lens & focus", Icon: Camera, tone: "green", summary: `${lensShort(lens)} · ${s.zoom.toFixed(1)}× · ${lens.manualFocus && s.focus === "manual" ? "Manual focus" : "Auto focus"}${lens.flash && s.torch ? " · Flashlight on" : ""}`,
      body: () => panel(<>
      <div className="calm-setting-detail camos-first"><h3>Lens</h3>
        <ChoiceBar label="Lens" value={lens.id} onChoose={(id) => { const l = p.lenses.find((x) => x.id === id); if (l) set({ cameraId: l.id, front: l.front, zoom: 1, torch: l.flash && s.torch }); }}
          choices={p.lenses.map((l) => ({ value: l.id, label: lensShort(l), testId: `s-lens-${l.id}` }))} />
      </div>
      {lens.zoomMax > lens.zoomMin && <CamRange label="Zoom" min={lens.zoomMin} max={lens.zoomMax} step={0.1} value={Math.min(Math.max(s.zoom, lens.zoomMin), lens.zoomMax)} shown={`${s.zoom.toFixed(1)}×`}
        detail={lens.zoomMin < 1 ? "Below 1× uses the ultra-wide lens, where the phone has one." : undefined} onChange={(v) => set({ zoom: v })} testId="s-zoom" />}
      <div className="calm-setting-detail"><h3>Focus</h3>
        <ChoiceBar label="Focus" value={lens.manualFocus ? s.focus : "auto"} onChoose={(v) => set({ focus: v })}
          choices={[{ value: "auto", label: "Auto", testId: "s-focus-auto" }, ...(lens.manualFocus ? [{ value: "manual" as const, label: "Manual", testId: "s-focus-manual" }] : [])]} />
        {!lens.manualFocus && <p>This lens has fixed focus.</p>}
      </div>
      <Collapse open={lens.manualFocus && s.focus === "manual"}>
        <CamRange label="Focus distance" min={0} max={100} value={Math.round(s.focusDistance * 100)} shown={s.focusDistance < 0.05 ? "Far" : s.focusDistance > 0.9 ? "Closest" : `${Math.round(s.focusDistance * 100)}%`}
          detail="Locks focus so it doesn't hunt when you move your hands." onChange={(v) => set({ focusDistance: v / 100 })} testId="s-focus-distance" />
      </Collapse>
      {lens.stabilize && <CalmSwitch label="Stabilisation" detail="Smooths out shaky hands. Turn off if the picture looks slightly zoomed." on={s.stabilize} onChange={(v) => set({ stabilize: v })} />}
      {lens.flash && <CalmSwitch label="Flashlight" detail="Lights you up in a dark room. Back camera only." on={s.torch} onChange={(v) => set({ torch: v })} />}
      </>) },
    { id: "light", title: "Light & colour", Icon: Sun, tone: "yellow", summary: `Brightness ${fmtEv(s.ev, lens.evStep)} · ${wbName[s.wb] ?? "Auto"} white balance`,
      body: () => panel(<>
      {lens.evMax > lens.evMin && <CamRange label="Brightness" min={lens.evMin} max={lens.evMax} value={s.ev} shown={fmtEv(s.ev, lens.evStep)} onChange={(v) => set({ ev: v })} testId="s-ev" />}
      <div className="calm-setting-detail"><h3>White balance</h3>
        <ChoiceBar label="White balance" value={s.wb} onChoose={(v) => set({ wb: v })}
          choices={[{ value: "auto", label: "Auto" }, { value: "daylight", label: "Sunny" }, { value: "cloudy", label: "Cloudy" }, { value: "incandescent", label: "Bulb" }, { value: "fluorescent", label: "Tube light" }].map((c) => ({ ...c, testId: `s-wb-${c.value}` }))} />
        <p>Fixes skin that looks too yellow or too blue under room lights.</p>
      </div>
      <div className="calm-setting-detail"><h3>Anti-flicker</h3>
        <ChoiceBar label="Anti-flicker" value={s.antiband} onChoose={(v) => set({ antiband: v })}
          choices={[{ value: "auto", label: "Auto" }, { value: "50", label: "50 Hz" }, { value: "60", label: "60 Hz" }, { value: "off", label: "Off" }].map((c) => ({ ...c, testId: `s-ab-${c.value}` }))} />
        <p>Stops lights from flickering on camera. India and Europe use 50 Hz.</p>
      </div>
      <div className="calm-setting-detail"><h3>Noise reduction</h3>
        <ChoiceBar label="Noise reduction" value={s.nr} onChoose={(v) => set({ nr: v })}
          choices={[{ value: "off", label: "Off" }, { value: "normal", label: "Normal" }, { value: "strong", label: "Strong" }].map((c) => ({ ...c, testId: `s-nr-${c.value}` }))} />
        <p>Cleans up grain in dim rooms. Strong can look a little soft.</p>
      </div>
      </>) },
    { id: "filters", title: "Filters", Icon: Sparkles, tone: "violet", badge: !p.premium,
      summary: p.premium ? [lookName !== "None" ? lookName : "", s.smooth ? `Smoothing ${Math.round(s.smooth * 100)}%` : "", s.lowLight ? "Low-light boost" : ""].filter(Boolean).join(" · ") || "No filter" : "Colour looks, face smoothing, low-light boost",
      body: () => panel(<>
      <div className="calm-setting-detail camos-first"><h3>Colour look</h3>
        <ChoiceBar label="Colour look" value={p.premium ? s.look : "none"} onChoose={(v) => p.premium ? set({ look: v }) : lockedTap("Colour looks")}
          choices={LOOKS.map((l) => ({ value: l.value, label: l.label, testId: `s-look-${l.value}` }))} />
      </div>
      <CamRange label="Face smoothing" min={0} max={100} step={5} value={p.premium ? Math.round(s.smooth * 100) : 0} shown={!p.premium || s.smooth === 0 ? "Off" : `${Math.round(s.smooth * 100)}%`}
        detail="Softens skin, keeps eyes and outlines sharp." onChange={(v) => p.premium ? set({ smooth: v / 100 }) : lockedTap("Face smoothing")} testId="s-smooth" />
      <CalmSwitch label="Low-light boost" detail="Brightens a dark room. The camera may drop to 15 fps in the dark to gather more light." on={p.premium && s.lowLight} onChange={(v) => p.premium ? set({ lowLight: v }) : lockedTap("Low-light boost")} />
      <div className="calm-setting-row camos-soon"><div className="calm-grow"><span className="calm-setting-label">Background blur</span><p>Blurs the room behind you. Coming in the next update.</p></div><Lock size={16} aria-hidden="true" /></div>
      </>, p.premium ? "" : "camos-locked") },
    { id: "screen", title: "Phone screen", Icon: Smartphone, summary: `${s.autoDim ? "Dims after 30 s" : "Stays bright"}${lens.front || p.lenses.some((l) => l.front) ? ` · ${s.mirror ? "Mirrored" : "Not mirrored"} front preview` : ""}`,
      body: () => panel(<>
      {p.lenses.some((l) => l.front) && <CalmSwitch label="Mirror the preview on this phone" detail="Only the phone's preview. Your PC always gets the true picture." on={s.mirror} onChange={(v) => set({ mirror: v })} />}
      <CalmSwitch label="Dim the screen after 30 seconds" detail="Saves battery and heat. The PC keeps getting the picture; tap the phone to wake it." on={s.autoDim} onChange={(v) => set({ autoDim: v })} />
      </>) },
    { id: "pc", title: "Your PC", Icon: MonitorSmartphone, summary: p.pc ? `Paired with ${p.pc.ip}` : "Not paired",
      body: () => panel(<>
      <div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">{p.pc ? `Paired with ${p.pc.ip}` : "No PC paired"}</span>
        <p>{p.pc ? "Uses the same pairing as GamepadOS." : "Scan the QR code in the Gamepad Server window."}</p></div>
        {p.pc ? <button className="calm-text-button" onClick={p.onForget}>Forget</button> : <button className="calm-text-button" onClick={p.onConnect}>Pair</button>}
      </div>
      </>) },
    { id: "about", title: "About", Icon: Info, summary: `Version ${version}`,
      body: () => panel(<>
      <div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">CamOS</span><p>Version {version}. Made by the GamepadOS team.</p></div></div>
      <CameraReport />
      </>) },
  ];
  const open = pages.find((x) => x.id === p.page);

  // Same feel as the Camera tab (calm-swap-in, 0.22 s): the new page shows at once and glides in; nothing waits
  // for the old page to leave. No glide on the very first paint (the tab's own fade covers that).
  const anim = firstPaint.current ? "" : open ? "camos-page-in" : "camos-menu-in";
  return <div className="calm-settings camos-settings">
      {!open
        ? <div key="menu" className={anim}>
            <h1 className="sr-only">Settings</h1>
            <div className="calm-settings-panel camos-menu">
              {pages.map(({ id, title, Icon, tone, summary, badge }) =>
                <button key={id} type="button" className="calm-setting-row camos-menu-row" data-tone={tone} data-testid={`settings-${id}`} onClick={() => p.setPage(id)}>
                  <span className="camos-menu-icon" aria-hidden="true"><Icon size={18} /></span>
                  <div className="calm-grow"><span className="calm-setting-label">{title}{badge && premiumBadge}</span><p>{summary}</p></div>
                  <span className="calm-help-chevron" aria-hidden="true"><ChevronRight size={18} /></span>
                </button>)}
            </div>
          </div>
        : <div key={open.id} className={anim}>
            <div className="camos-page-head">
              <button className="calm-icon-button" onClick={() => p.setPage("menu")} aria-label="Back to settings" data-testid="settings-back"><ArrowLeft size={20} aria-hidden="true" /></button>
              <h1><open.Icon size={18} aria-hidden="true" />{open.title}{open.badge && premiumBadge}</h1>
            </div>
            <section className="calm-settings-section" data-tone={open.tone}>{open.body()}</section>
          </div>}
  </div>;
}

// ─── Connect screen (same layout as GamepadOS's CalmConnect) ────────────────────────────────────────────────────
function ConnectScreen({ scanning, setScanning, onBack, onManual, usbSearch, onUsb }: {
  scanning: boolean; setScanning: (v: boolean) => void; onBack: () => void; onManual: (pc: PC) => void;
  usbSearch: "idle" | "searching" | "failed"; onUsb: () => void;
}) {
  const [method, setMethod] = useState<"wireless" | "wired">("wireless");
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const scan = () => { setScanning(true); bridge()?.startScan(); };
  const closeScan = () => { bridge()?.stopScan(); setScanning(false); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = parseQR(`${ip.trim()},7777,${key.trim()}`);
    if (!found) { setError("Enter the PC IP address and the 8-character pairing key shown in Gamepad Server."); return; }
    setError(""); onManual(found);
  };
  const step = (n: number, title: string, body: React.ReactNode) =>
    <li className="calm-step"><span className="calm-step-number" aria-hidden="true">{n}</span><div><h2>{title}</h2><p>{body}</p></div></li>;

  return <div className={`gp-connect gp-shell absolute inset-0 flex flex-col overflow-hidden ${scanning ? "gp-camera-active" : ""}`}>
    <ShellMotion />
    {/* Scanner <-> Connect fade through each other, exactly as in GamepadOS. */}
    <AnimatePresence mode="wait" initial={false}>
      {scanning
        ? <motion.div key="scanner" className="absolute inset-0" {...backdropIn} transition={FADE}><Scanner onClose={closeScan} /></motion.div>
        : <motion.div key="connect" className="flex flex-1 min-h-0 flex-col" {...backdropIn} transition={FADE}>
          <header className="calm-header calm-header-centred">
            <button className="calm-icon-button" onClick={onBack} aria-label="Back"><ArrowLeft size={22} aria-hidden="true" /></button>
            <span aria-hidden="true" /><span aria-hidden="true" />
          </header>
          <div className="console-connect-chrome">
            <h1 className="sr-only">Connect to your PC</h1>
            <ChoiceBar label="Connection method" value={method} onChoose={(v) => { setMethod(v); setError(""); }}
              choices={[{ value: "wireless", testId: "connection-wireless-button", label: <><Wifi size={18} aria-hidden="true" />Wi-Fi</> },
                        { value: "wired", testId: "connection-usb-button", label: <><Usb size={18} aria-hidden="true" />USB</> }]} />
          </div>
          <main className="calm-connect-scroll"><div className="calm-connect-content">
            <SwapIn swapKey={method}>
              {method === "wireless" ? <>
                <ol className="calm-steps">
                  {step(1, "Open Gamepad Server", <>Same Wi-Fi as this phone. No server yet? On your PC, go to <b>gamepad.space</b> and download it.</>)}
                  {step(2, "Scan the code on your PC", "The code appears in the Gamepad Server window. It is the same code GamepadOS uses.")}
                </ol>
                <button className="calm-primary" data-testid="scan-qr-button" onClick={scan}><ScanLine size={20} aria-hidden="true" />Scan PC QR code</button>
                <button className="calm-text-button calm-manual-toggle" aria-expanded={manual} onClick={() => { setManual((v) => !v); setError(""); }}>{manual ? "Hide manual entry" : "Connect manually instead"}</button>
                <Collapse open={manual}><form className="calm-manual" onSubmit={submit}>
                  <p>Enter the IP address and pairing key shown below your PC’s QR code.</p>
                  <div className="calm-fields">
                    <label>PC IP address<input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={15} aria-invalid={!!error} /></label>
                    <label>Pairing key<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="8 characters" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8} aria-invalid={!!error} /></label>
                  </div>
                  {error && <p className="calm-error" role="alert">{error}</p>}
                  <button className="calm-primary" type="submit">Connect<ArrowRight size={18} aria-hidden="true" /></button>
                </form></Collapse>
              </> : <>
                <ol className="calm-steps">
                  {step(1, "Plug in the USB cable", "Phone to PC. Keep Gamepad Server open.")}
                  {step(2, "Turn on USB tethering", <>Or USB debugging, if you use it.<button className="calm-text-button" onClick={() => bridge()?.openTetherSettings?.()}>Open tethering settings</button></>)}
                </ol>
                <button className="calm-primary" data-testid="usb-connect-button" disabled={usbSearch === "searching"} onClick={onUsb}>
                  <Usb size={20} aria-hidden="true" />{usbSearch === "searching" ? "Looking for your PC…" : "Connect over USB"}</button>
                {usbSearch === "failed" && <p className="calm-error" role="alert">No PC on the cable. Check that Gamepad Server is open and USB tethering is on.</p>}
              </>}
            </SwapIn>
          </div></main>
        </motion.div>}
    </AnimatePresence>
  </div>;
}

/** GamepadOS's QR scanner, same markup and class names as Dialogs.tsx QRScanOverlay, so calm-shell.css styles both
 *  identically: dark cover with a rounded window, pulsing orange corners, sweeping laser. */
function Scanner({ onClose }: { onClose: () => void }) {
  const cover = "rgba(0,0,0,0.85)";
  return (
    <div className="gp-shell console-scanner fixed inset-0 z-50 flex flex-col items-center justify-center bg-transparent scanner-overlay-active">
      <style>{`
        @keyframes laserSweep2{0%,100%{top:0}50%{top:calc(100% - 3px)}}
        @keyframes cornerPulse2{0%,100%{opacity:0.55}50%{opacity:1}}
        .corner2{animation:cornerPulse2 2.4s ease-in-out infinite}
        .c-tl2{animation-delay:0s}.c-tr2{animation-delay:0.6s}.c-bl2{animation-delay:1.2s}.c-br2{animation-delay:1.8s}
        .laser2{position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,var(--calm-accent),var(--calm-accent),transparent);box-shadow:0 0 10px var(--calm-accent);animation:laserSweep2 3s ease-in-out infinite}
      `}</style>
      <div className="console-scanner-top absolute top-0 left-0 right-0 flex items-center justify-between z-10 px-5 pb-4 bg-black/60"
        style={{ paddingTop: "calc(var(--android-safe-top, env(safe-area-inset-top, 0px)) + 12px)" }}>
        <p className="text-sm font-bold text-primary">Scan. Pair. Stream.</p>
        <button aria-label="Close scanner" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full"
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}><X size={14} className="text-foreground" /></button>
      </div>
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0" style={{ height: "calc(50% - min(36vw, 26vh))", background: cover }} />
        <div className="absolute left-0 right-0 bottom-0" style={{ top: "calc(50% + min(36vw, 26vh))", background: cover }} />
        <div className="absolute left-0" style={{ top: "calc(50% - min(36vw, 26vh))", width: "calc(50% - min(36vw, 26vh))", height: "min(72vw, 52vh)", background: cover }} />
        <div className="absolute right-0" style={{ top: "calc(50% - min(36vw, 26vh))", width: "calc(50% - min(36vw, 26vh))", height: "min(72vw, 52vh)", background: cover }} />
      </div>
      <div className="scan-window relative z-10 rounded-[24px]" style={{ width: "min(72vw,52vh)", height: "min(72vw,52vh)" }}>
        {[["top-0 left-0", "100% 100%"], ["top-0 right-0", "0% 100%"], ["bottom-0 left-0", "100% 0%"], ["bottom-0 right-0", "0% 0%"]].map(([pos, at]) => (
          <div key={pos} aria-hidden="true" className={`absolute ${pos} pointer-events-none`}
            style={{ width: 24, height: 24, background: `radial-gradient(circle at ${at}, transparent 23.5px, ${cover} 24px)` }} />
        ))}
        {[
          { pos: "top-0 left-0", cls: "c-tl2", style: { borderTop: "3px solid var(--calm-accent)", borderLeft: "3px solid var(--calm-accent)", borderRadius: "24px 0 0 0" } },
          { pos: "top-0 right-0", cls: "c-tr2", style: { borderTop: "3px solid var(--calm-accent)", borderRight: "3px solid var(--calm-accent)", borderRadius: "0 24px 0 0" } },
          { pos: "bottom-0 left-0", cls: "c-bl2", style: { borderBottom: "3px solid var(--calm-accent)", borderLeft: "3px solid var(--calm-accent)", borderRadius: "0 0 0 24px" } },
          { pos: "bottom-0 right-0", cls: "c-br2", style: { borderBottom: "3px solid var(--calm-accent)", borderRight: "3px solid var(--calm-accent)", borderRadius: "0 0 24px 0" } },
        ].map(({ pos, cls, style }) => <div key={cls} className={`corner2 ${cls} absolute ${pos} w-10 h-10`} style={style} />)}
        <div className="absolute inset-0 overflow-hidden rounded-[24px]"><div className="laser2" /></div>
        <div className="absolute inset-0 flex items-center justify-center"><QrCode size={56} style={{ color: "rgba(255,104,38,0.06)" }} /></div>
      </div>
      {!bridge() && <div className="console-browser-camera"><p>Camera pairing works in the Android app. Open Gamepad Server on your PC, then scan its QR code with your phone.</p><button className="calm-text-button" onClick={onClose}>Back to connection options</button></div>}
      <div className="console-scanner-bottom absolute bottom-0 left-0 right-0 p-8 bg-black/60 text-center z-10">
        <p className="text-xs">Align the Gamepad Server QR code within the frame</p>
      </div>
    </div>
  );
}

// ─── Live: the picture fills the screen; the camera controls float over it ─────────────────────────────────────
function LiveScreen({ live, s, set, lens, lenses, premium, hdAllowed, goPremium, showToast, onReshape }: {
  live: LiveState; s: Settings; set: (p: Partial<Settings>) => void; lens: Lens; lenses: Lens[]; premium: boolean; hdAllowed: boolean;
  goPremium: () => void; showToast: (m: string) => void; onReshape: (shape: "landscape" | "portrait") => void;
}) {
  const portraitNow = live.portrait ?? s.shape === "portrait";
  const [panel, setPanel] = useState(false);
  const isLive = live.state === "live";
  const q = s.quality === 1080 && !hdAllowed ? 720 : s.quality;
  const other = lenses.find((l) => l.front !== lens.front);
  // Auto-dim (Settings → While streaming): 30 s after going live, and again 30 s after each touch.
  useEffect(() => {
    if (!s.autoDim || !isLive) return;
    let t = window.setTimeout(() => bridge()?.dim(true), 30_000);
    const poke = () => { clearTimeout(t); t = window.setTimeout(() => bridge()?.dim(true), 30_000); };
    window.addEventListener("pointerdown", poke);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", poke); };
  }, [s.autoDim, isLive]);

  return <div className="gp-shell camos-live">
    <ShellMotion />
    <motion.div className="camos-pill" data-state={live.state} {...cardIn} transition={SPRING}>
      <span className="camos-dot" aria-hidden="true" />
      <SwapIn swapKey={isLive ? "live" : "wait"} className="camos-pill-text">
        {isLive ? <>Live · {q}p · {live.fps || "…"} fps{live.kbps ? ` · ${(live.kbps / 1000).toFixed(1)} Mbit/s` : ""}</> : live.message || "Connecting…"}
      </SwapIn>
    </motion.div>

    <AnimatePresence>
      {panel && <motion.div key="panel" className="camos-panel" {...cardIn} transition={SPRING} role="dialog" aria-label="Camera adjustments">
        {lens.zoomMax > lens.zoomMin && <CamRange label="Zoom" min={lens.zoomMin} max={lens.zoomMax} step={0.1} value={Math.min(Math.max(s.zoom, lens.zoomMin), lens.zoomMax)} shown={`${s.zoom.toFixed(1)}×`} onChange={(v) => set({ zoom: v })} testId="live-zoom" />}
        {lens.evMax > lens.evMin && <CamRange label="Brightness" min={lens.evMin} max={lens.evMax} value={s.ev} shown={fmtEv(s.ev, lens.evStep)} onChange={(v) => set({ ev: v })} testId="live-ev" />}
        <div className="calm-setting-detail"><h3><Palette size={13} aria-hidden="true" /> Colour look {!premium && premiumBadge}</h3>
          <ChoiceBar label="Colour look" value={premium ? s.look : "none"} onChoose={(v) => premium ? set({ look: v }) : (showToast("Colour looks are part of Premium."), undefined)}
            choices={LOOKS.map((l) => ({ value: l.value, label: l.label, testId: `live-look-${l.value}` }))} />
        </div>
        <CamRange label="Face smoothing" min={0} max={100} step={5} value={premium ? Math.round(s.smooth * 100) : 0} shown={!premium || s.smooth === 0 ? "Off" : `${Math.round(s.smooth * 100)}%`}
          onChange={(v) => premium ? set({ smooth: v / 100 }) : showToast("Face smoothing is part of Premium.")} testId="live-smooth" />
        {!premium && <button className="calm-text-button camos-premium-link" onClick={goPremium}><Crown size={14} aria-hidden="true" />See Premium</button>}
      </motion.div>}
    </AnimatePresence>

    <motion.nav className="camos-bar" aria-label="Camera controls" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: .05 }}>
      {other && <button className="calm-icon-button" onClick={() => set({ front: other.front, cameraId: other.id, zoom: 1, torch: false })} aria-label="Switch camera"><SwitchCamera size={20} /></button>}
      {lens.flash && <button className="calm-icon-button" data-on={s.torch} onClick={() => set({ torch: !s.torch })} aria-label={s.torch ? "Flashlight off" : "Flashlight on"}>{s.torch ? <FlashlightOff size={20} /> : <Flashlight size={20} />}</button>}
      <button className="calm-icon-button" data-testid="live-reshape" disabled={!isLive} onClick={() => onReshape(portraitNow ? "landscape" : "portrait")}
        aria-label={portraitNow ? "Switch to a wide picture" : "Switch to a tall picture"}>{portraitNow ? <RectangleHorizontal size={20} /> : <RectangleVertical size={20} />}</button>
      <button className="calm-icon-button" data-on={panel} onClick={() => setPanel((v) => !v)} aria-label="Adjust picture" aria-expanded={panel}><SlidersHorizontal size={20} /></button>
      <button className="calm-icon-button" onClick={() => bridge()?.dim(true)} aria-label="Dim screen (keeps streaming)"><Moon size={20} /></button>
      <button className="calm-primary camos-stop" onClick={() => bridge()?.stop()}><Square size={14} aria-hidden="true" />Stop</button>
    </motion.nav>
  </div>;
}

