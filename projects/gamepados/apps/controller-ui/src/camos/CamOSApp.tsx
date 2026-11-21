import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Camera, Check, Download, Flashlight, FlashlightOff, Info, Monitor, Moon, MonitorSmartphone,
  QrCode, RefreshCw, ScanLine, Settings as SettingsIcon, Square, Ticket, Usb, User, Video, Wifi, X,
} from "lucide-react";
import { ChoiceBar, Collapse, SwapIn } from "../app/components/Motion";
import { ShellMotion } from "../app/components/ShellMotion";
import { ShellScreenTransition } from "../app/components/ShellScreenTransition";
import { CalmSwitch } from "../app/components/CalmSettings";
import { FADE, SPRING, backdropIn, cardIn, toastIn } from "../app/motion";

// ─── CamOS ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Phone as a webcam for Windows. Built from GamepadOS's OWN pieces, not look-alikes (owner, 2026-11-21: "theme should
// be like GamepadOS only ... consistent animations with all options"):
//   • the same shell: calm-header, calm-main, calm-nav with the sliding orange pill (layoutId), ShellMotion press feel
//   • the same motion: ShellScreenTransition between screens, calm-swap-in between tabs, ChoiceBar / SwapIn /
//     Collapse for options, cardIn / toastIn / backdropIn presets from motion.ts for everything that pops
//   • the same Connect screen and QR scanner layout as GamepadOS, and the same settings rows (CalmSwitch)
// Native side: apps/camos-android (window.CamOSBridge). PC side: Gamepad Server's camera module (port 7780).

type Bridge = {
  startScan(): void; stopScan(): void;
  start(ip: string, key: string, height: number, front: boolean): void;
  stop(): void; flip(): void; torch(on: boolean): void; dim(on: boolean): void; mirror?(on: boolean): void;
  deviceName(): string; version(): string;
};
const bridge = (): Bridge | undefined => (window as any).CamOSBridge;

type PC = { ip: string; key: string };
type Quality = "480" | "720" | "1080";
type Route = "dashboard" | "connect" | "live";
type Tab = "home" | "system" | "account";
type LiveState = { state: "connecting" | "live"; message: string; fps: number; kbps: number };

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
function useSaved<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => store.get(key, initial));
  return [v, (n: T) => { setV(n); store.set(key, n); }];
}

/** The Gamepad Server QR is "ip,port,key". CamOS always streams to port 7780, so only ip + key matter. */
export function parseQR(text: string): PC | null {
  const [ip, , key] = text.trim().split(",");
  const okIp = !!ip && ip.split(".").length === 4 && ip.split(".").every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  return okIp && /^[a-f0-9]{8}$/i.test(key ?? "") ? { ip, key: key.toLowerCase() } : null;
}

const QUALITY_HELP: Record<Quality, string> = {
  "480": "Smallest and coolest. Good on slow Wi-Fi.",
  "720": "Best for video calls. Recommended.",
  "1080": "Sharpest picture. Needs good Wi-Fi; the phone runs warmer.",
};

const TABS: { id: Tab; label: string; Icon: typeof Video }[] = [
  { id: "home", label: "Camera", Icon: Video },
  { id: "system", label: "Settings", Icon: SettingsIcon },
  { id: "account", label: "Plans", Icon: Ticket },
];

export default function CamOSApp() {
  const [route, setRoute] = useState<Route>("dashboard");
  const [tab, setTab] = useState<Tab>("home");
  const [pc, setPc] = useSaved<PC | null>("camos.pc", null);
  const [quality, setQuality] = useSaved<Quality>("camos.quality", "720");
  const [front, setFront] = useSaved<boolean>("camos.front", false);
  const [mirror, setMirror] = useSaved<boolean>("camos.mirror", true);
  const [autoDim, setAutoDim] = useSaved<boolean>("camos.autoDim", false);
  const [live, setLive] = useState<LiveState>({ state: "connecting", message: "", fps: 0, kbps: 0 });
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number>(0);
  const showToast = (m: string) => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(""), 4200); };

  // The camera is drawn BEHIND the page while scanning or live, so the page background must let it through.
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    const see = route === "live" || scanning;
    document.documentElement.style.background = see ? "transparent" : "";
    document.body.style.background = see ? "transparent" : "";
  }, [route, scanning]);

  function start(target: PC | null = pc) {
    if (!target) { setRoute("connect"); return; }
    const b = bridge();
    if (!b) { showToast("Open CamOS on your Android phone to stream."); return; }
    setLive({ state: "connecting", message: `Connecting to ${target.ip}…`, fps: 0, kbps: 0 });
    setRoute("live");
    b.start(target.ip, target.key, Number(quality), front);
    b.mirror?.(mirror);
  }

  useEffect(() => {
    (window as any).camosOnQR = (text: string) => {
      setScanning(false);
      const found = parseQR(text);
      if (!found) { showToast("That QR code is not from Gamepad Server. Scan the code in the Gamepad Server window."); return; }
      setPc(found); start(found);
    };
    (window as any).camosOnState = (json: string) => {
      const s = JSON.parse(json);
      if (s.state === "stopped") { setRoute("dashboard"); return; }
      if (s.state === "error") { setScanning(false); setRoute((r) => (r === "live" ? "dashboard" : r)); showToast(s.message); return; }
      setLive({ state: s.state, message: s.message, fps: s.fps, kbps: s.kbps });
      if (typeof s.front === "boolean") setFront(s.front);
    };
    (window as any).camosOnPermission = (ok: boolean) => { if (!ok) showToast("CamOS needs the camera permission to work as a webcam."); };
    // Android back button: the native side asks us first (true = handled here).
    (window as any).camosBack = () => {
      if (scanning) { bridge()?.stopScan(); setScanning(false); return true; }
      if (route === "connect") { setRoute("dashboard"); return true; }
      if (route === "live") { bridge()?.stop(); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    };
  });

  return <>
  <AnimatePresence mode="wait" initial={false}>
    {route === "dashboard" && <ShellScreenTransition key="dashboard" direction={1} className="absolute inset-0">
      <Dashboard tab={tab} setTab={setTab} pc={pc} onStart={() => start()} onConnect={() => setRoute("connect")}
        quality={quality} setQuality={setQuality} front={front} setFront={setFront}
        mirror={mirror} setMirror={setMirror} autoDim={autoDim} setAutoDim={setAutoDim}
        onForget={() => { setPc(null); showToast("This phone forgot the PC. Scan its QR code to pair again."); }} />
    </ShellScreenTransition>}
    {route === "connect" && <ShellScreenTransition key="connect" direction={-1} className="absolute inset-0">
      <ConnectScreen scanning={scanning} setScanning={setScanning} onBack={() => setRoute("dashboard")}
        onManual={(found) => { setPc(found); start(found); }} />
    </ShellScreenTransition>}
    {route === "live" && <ShellScreenTransition key="live" direction={1} className="absolute inset-0">
      <LiveScreen live={live} quality={quality} front={front} autoDim={autoDim} />
    </ShellScreenTransition>}
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

// ─── Dashboard: the GamepadOS shell (header + tabs) ─────────────────────────────────────────────────────────────
function Dashboard(p: {
  tab: Tab; setTab: (t: Tab) => void; pc: PC | null; onStart: () => void; onConnect: () => void;
  quality: Quality; setQuality: (q: Quality) => void; front: boolean; setFront: (f: boolean) => void;
  mirror: boolean; setMirror: (v: boolean) => void; autoDim: boolean; setAutoDim: (v: boolean) => void; onForget: () => void;
}) {
  const reduced = useReducedMotion();
  const mainRef = useRef<HTMLElement>(null);
  const entered = useRef(false);
  useEffect(() => { entered.current = true; }, []);
  const change = (t: Tab) => { if (t === p.tab) return; mainRef.current?.scrollTo({ top: 0 }); p.setTab(t); };

  return <div className="gp-dashboard gp-shell camos-shell flex flex-col h-full">
    <ShellMotion />
    <header className="calm-header calm-header-centred">
      <span className="camos-brand" aria-label="CamOS"><Camera size={18} aria-hidden="true" />CamOS</span>
      <span aria-hidden="true" />
      <div className="calm-header-actions">
        <button className="calm-account-shortcut" onClick={() => change("account")} aria-label="Your plan"><User size={18} aria-hidden="true" /></button>
      </div>
    </header>

    <main ref={mainRef} className="calm-main">
      <div className={p.tab === "home" ? "calm-home-content" : "calm-legacy-content"}>
        <TabFade key={p.tab} animate={!reduced && entered.current}>
          {p.tab === "home" && <TabCamera {...p} />}
          {p.tab === "system" && <TabSettings {...p} />}
          {p.tab === "account" && <TabPlans />}
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
function TabCamera(p: { pc: PC | null; onStart: () => void; onConnect: () => void; quality: Quality; setQuality: (q: Quality) => void; front: boolean; setFront: (f: boolean) => void }) {
  return <div className="calm-home">
    <h1 className="sr-only">Camera</h1>
    <div className="console-connect-entry" data-link-state={p.pc ? "paired" : "none"}>
      {p.pc
        ? <button className="console-connect-button" data-testid="camos-start" onClick={p.onStart}><Video size={20} aria-hidden="true" /><span>Start camera</span><ArrowRight size={18} aria-hidden="true" /></button>
        : <button className="console-connect-button" data-testid="camos-connect" onClick={p.onConnect}><Monitor size={20} aria-hidden="true" /><span>Connect to PC</span><ArrowRight size={18} aria-hidden="true" /></button>}
      <p className="console-connect-status"><span className="console-connect-status-dot" />
        <span>{p.pc ? `Paired with ${p.pc.ip}` : "No PC paired yet"}</span>
        {p.pc && <button className="calm-why-link" onClick={p.onConnect}>Change PC</button>}
      </p>
    </div>

    <div className="calm-section-heading"><h2>Picture</h2></div>
    <div className="calm-settings-panel camos-quick">
      <div className="calm-setting-detail camos-first"><h3>Quality</h3>
        <ChoiceBar label="Picture quality" value={p.quality} onChoose={p.setQuality}
          choices={[{ value: "480", label: "480p", testId: "q-480" }, { value: "720", label: "720p", testId: "q-720" }, { value: "1080", label: <>1080p<span className="camos-hd">HD</span></>, testId: "q-1080" }]} />
        <SwapIn swapKey={p.quality}><p>{QUALITY_HELP[p.quality]}</p></SwapIn>
      </div>
      <div className="calm-setting-detail"><h3>Camera</h3>
        <ChoiceBar label="Camera" value={p.front ? "front" : "back"} onChoose={(v) => p.setFront(v === "front")}
          choices={[{ value: "back", label: "Back", testId: "cam-back" }, { value: "front", label: "Front", testId: "cam-front" }]} />
        <p>Hold the phone sideways. 30 frames per second.</p>
      </div>
    </div>

    <div className="calm-section-heading camos-gap"><h2>Use it on your PC</h2></div>
    <ol className="calm-steps">
      <li className="calm-step"><span className="calm-step-number" aria-hidden="true">1</span><div><h2>Keep Gamepad Server open</h2><p>Windows 11, same Wi-Fi as this phone.</p></div></li>
      <li className="calm-step"><span className="calm-step-number" aria-hidden="true">2</span><div><h2>Pick “CamOS Camera”</h2><p>In Zoom, Google Meet, Teams, Discord, OBS or the Camera app.</p></div></li>
    </ol>
  </div>;
}

// ─── Settings tab (GamepadOS settings sections + CalmSwitch rows) ───────────────────────────────────────────────
function TabSettings(p: { pc: PC | null; quality: Quality; setQuality: (q: Quality) => void; front: boolean; setFront: (f: boolean) => void;
  mirror: boolean; setMirror: (v: boolean) => void; autoDim: boolean; setAutoDim: (v: boolean) => void; onForget: () => void; onConnect: () => void }) {
  const version = (() => { try { return bridge()?.version() ?? "browser preview"; } catch { return ""; } })();
  return <div className="calm-settings">
    <h1 className="sr-only">Settings</h1>
    <section data-tone="blue" className="calm-settings-section"><h2><Video size={15} />Picture</h2><div className="calm-settings-panel">
      <div className="calm-setting-detail camos-first"><h3>Quality</h3>
        <ChoiceBar label="Picture quality" value={p.quality} onChoose={p.setQuality}
          choices={[{ value: "480", label: "480p", testId: "s-q-480" }, { value: "720", label: "720p", testId: "s-q-720" }, { value: "1080", label: <>1080p<span className="camos-hd">HD</span></>, testId: "s-q-1080" }]} />
        <SwapIn swapKey={p.quality}><p>{QUALITY_HELP[p.quality]}</p></SwapIn>
      </div>
      <div className="calm-setting-detail"><h3>Camera</h3>
        <ChoiceBar label="Camera" value={p.front ? "front" : "back"} onChoose={(v) => p.setFront(v === "front")}
          choices={[{ value: "back", label: "Back", testId: "s-cam-back" }, { value: "front", label: "Front", testId: "s-cam-front" }]} />
      </div>
      <CalmSwitch label="Mirror the front camera on this phone" detail="Only the phone's preview. Your PC always gets the true picture." on={p.mirror} onChange={p.setMirror} />
    </div></section>

    <section data-tone="violet" className="calm-settings-section"><h2><Moon size={15} />While streaming</h2><div className="calm-settings-panel">
      <CalmSwitch label="Dim the screen after 30 seconds" detail="Saves battery and heat. The PC keeps getting the picture; tap the phone to wake it." on={p.autoDim} onChange={p.setAutoDim} />
    </div></section>

    <section className="calm-settings-section"><h2><MonitorSmartphone size={15} />Your PC</h2><div className="calm-settings-panel">
      <div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">{p.pc ? `Paired with ${p.pc.ip}` : "No PC paired"}</span>
        <p>{p.pc ? "Uses the same pairing as GamepadOS." : "Scan the QR code in the Gamepad Server window."}</p></div>
        {p.pc ? <button className="calm-text-button" onClick={p.onForget}>Forget</button> : <button className="calm-text-button" onClick={p.onConnect}>Pair</button>}
      </div>
    </div></section>

    <section className="calm-settings-section"><h2><Info size={15} />About</h2><div className="calm-settings-panel">
      <div className="calm-setting-row"><div className="calm-grow"><span className="calm-setting-label">CamOS</span><p>Version {version}. Made by the GamepadOS team.</p></div></div>
    </div></section>
  </div>;
}

// ─── Plans tab (GamepadOS plan cards; buying arrives with the store release) ────────────────────────────────────
function TabPlans() {
  const card = (plan: string, name: string, price: string, bullets: string[], action: string, delay: number) =>
    <motion.div className="console-plan-card" data-plan={plan} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-sm font-bold calm-ink">{name}</p>
          <ul className="mt-1.5 space-y-0.5">{bullets.map((b) => <li key={b} className="text-xs calm-muted"><Check size={12} aria-hidden="true" />{b}</li>)}</ul></div>
        <p className="console-plan-price text-xl font-bold shrink-0">{price}</p>
      </div>
      <button className="console-plan-buy mt-3 w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60" disabled>{action}</button>
    </motion.div>;
  return <div className="calm-account space-y-3 pb-6">
    <h1 className="sr-only">Plans</h1>
    <section className="guest-plans space-y-3">
      <div className="guest-status"><Ticket size={16} aria-hidden="true" /><span><b>Free</b> · 480p and 720p with a small CamOS mark</span></div>
      <div className="space-y-2">
        {card("LIFETIME", "Lifetime", "₹19", ["1080p HD, always", "No watermark", "No ads", "Also unlocks GamepadOS"], "Get Lifetime", 0)}
        {card("AD", "Watch an ad", "Free", ["45 minutes of 1080p HD", "Watch again any time"], "Watch an ad", 0.04)}
      </div>
      <p className="calm-inline-note">Buying and ads arrive with the Play Store release. One purchase covers both CamOS and GamepadOS.</p>
    </section>
  </div>;
}

// ─── Connect screen (same layout as GamepadOS's CalmConnect) ────────────────────────────────────────────────────
function ConnectScreen({ scanning, setScanning, onBack, onManual }: {
  scanning: boolean; setScanning: (v: boolean) => void; onBack: () => void; onManual: (pc: PC) => void;
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
                  {step(1, "Open Gamepad Server", <>Keep your phone and PC on the same Wi-Fi network.<button className="calm-text-button" onClick={() => window.open("https://gamepad.space/#download", "_blank")}><Download size={16} aria-hidden="true" />Get the PC server</button></>)}
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
                  {step(1, "USB is on its way", "Streaming over a USB cable comes in the next CamOS update.")}
                  {step(2, "Use Wi-Fi for now", "Wi-Fi works with the same Gamepad Server, no cable needed.")}
                </ol>
                <button className="calm-secondary" onClick={() => setMethod("wireless")}><Wifi size={18} aria-hidden="true" />Use Wi-Fi</button>
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

// ─── Live: the picture fills the screen, the controls float over it ─────────────────────────────────────────────
function LiveScreen({ live, quality, front, autoDim }: { live: LiveState; quality: Quality; front: boolean; autoDim: boolean }) {
  const [torch, setTorch] = useState(false);
  const isLive = live.state === "live";
  // Auto-dim (Settings → While streaming): 30 s after going live, and again 30 s after each touch.
  useEffect(() => {
    if (!autoDim || !isLive) return;
    let t = window.setTimeout(() => bridge()?.dim(true), 30_000);
    const poke = () => { clearTimeout(t); t = window.setTimeout(() => bridge()?.dim(true), 30_000); };
    window.addEventListener("pointerdown", poke);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", poke); };
  }, [autoDim, isLive]);

  return <div className="gp-shell camos-live">
    <ShellMotion />
    <motion.div className="camos-pill" data-state={live.state} {...cardIn} transition={SPRING}>
      <span className="camos-dot" aria-hidden="true" />
      <SwapIn swapKey={isLive ? "live" : "wait"} className="camos-pill-text">
        {isLive ? <>Live on PC · {quality}p · {live.fps || "…"} fps{live.kbps ? ` · ${(live.kbps / 1000).toFixed(1)} Mbit/s` : ""}</> : live.message || "Connecting…"}
      </SwapIn>
    </motion.div>
    <motion.nav className="camos-bar" aria-label="Camera controls" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: .05 }}>
      <button className="calm-icon-button" onClick={() => { bridge()?.flip(); setTorch(false); }} aria-label="Switch camera"><RefreshCw size={20} /></button>
      <button className="calm-icon-button" disabled={front} data-on={torch} onClick={() => { const v = !torch; setTorch(v); bridge()?.torch(v); }} aria-label={torch ? "Flashlight off" : "Flashlight on"}>{torch ? <FlashlightOff size={20} /> : <Flashlight size={20} />}</button>
      <button className="calm-icon-button" onClick={() => bridge()?.dim(true)} aria-label="Dim screen (keeps streaming)"><Moon size={20} /></button>
      <button className="calm-primary camos-stop" onClick={() => bridge()?.stop()}><Square size={14} aria-hidden="true" />Stop</button>
    </motion.nav>
  </div>;
}
