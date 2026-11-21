import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Camera, Flashlight, FlashlightOff, Monitor, Moon, RefreshCw, ScanLine, Square, X } from "lucide-react";
import { ChoiceBar, Collapse, SwapIn } from "../app/components/Motion";
import { FADE, SPRING, cardIn } from "../app/motion";

// CamOS — phone as a webcam for Windows. Same look and motion as GamepadOS (calm-shell.css, Motion.tsx, motion.ts);
// the Android side is apps/camos-android (window.CamOSBridge), the PC side is Gamepad Server's camera module.
//
// Screens: Home (connect + choose quality/camera) -> Scanner (QR) -> Live (camera picture with a control bar).

type Bridge = {
  startScan(): void; stopScan(): void;
  start(ip: string, key: string, height: number, front: boolean): void;
  stop(): void; flip(): void; torch(on: boolean): void; dim(on: boolean): void;
  deviceName(): string; version(): string;
};
const bridge = (): Bridge | undefined => (window as any).CamOSBridge;

type PC = { ip: string; key: string };
type Quality = "480" | "720" | "1080";
type Live = { state: "idle" | "connecting" | "live" | "error"; message: string; fps: number; kbps: number };

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** The Gamepad Server QR is "ip,port,key". CamOS always uses port 7780 for video, so only ip + key matter. */
export function parseQR(text: string): PC | null {
  const [ip, , key] = text.trim().split(",");
  const okIp = !!ip && ip.split(".").length === 4 && ip.split(".").every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  return okIp && /^[a-f0-9]{8}$/i.test(key ?? "") ? { ip, key: key.toLowerCase() } : null;
}

export default function CamOSApp() {
  const [pc, setPc] = useState<PC | null>(() => store.get<PC | null>("camos.pc", null));
  const [quality, setQuality] = useState<Quality>(() => store.get<Quality>("camos.quality", "720"));
  const [front, setFront] = useState<boolean>(() => store.get<boolean>("camos.front", false));
  const [screen, setScreen] = useState<"home" | "scan" | "live">("home");
  const [live, setLive] = useState<Live>({ state: "idle", message: "", fps: 0, kbps: 0 });
  const [error, setError] = useState("");
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState("");
  const [key, setKey] = useState("");

  // The camera is drawn BEHIND the page while scanning or live, so the page background must let it through.
  useEffect(() => {
    const see = screen !== "home";
    document.documentElement.style.background = see ? "transparent" : "";
    document.body.style.background = see ? "transparent" : "";
  }, [screen]);

  useEffect(() => {
    (window as any).camosOnQR = (text: string) => {
      const found = parseQR(text);
      if (!found) { setError("That QR code is not from Gamepad Server. Scan the code in the Gamepad Server window."); setScreen("home"); return; }
      setPc(found); store.set("camos.pc", found); setError(""); go(found);
    };
    (window as any).camosOnState = (json: string) => {
      const s = JSON.parse(json);
      if (s.state === "stopped") { setLive({ state: "idle", message: "", fps: 0, kbps: 0 }); setScreen("home"); setTorch(false); return; }
      if (s.state === "error") { setError(s.message); setLive({ state: "idle", message: "", fps: 0, kbps: 0 }); setScreen("home"); setTorch(false); return; }
      setLive({ state: s.state, message: s.message, fps: s.fps, kbps: s.kbps });
      if (typeof s.front === "boolean") setFront(s.front);
    };
    return () => { delete (window as any).camosOnQR; delete (window as any).camosOnState; };
  });

  function go(target: PC | null = pc) {
    if (!target) { scan(); return; }
    const b = bridge();
    if (!b) { setError("Open CamOS on your Android phone to stream."); return; }
    setError(""); setScreen("live"); setLive({ state: "connecting", message: `Connecting to ${target.ip}…`, fps: 0, kbps: 0 });
    b.start(target.ip, target.key, Number(quality), front);
  }
  function scan() { setError(""); setScreen("scan"); bridge()?.startScan(); }
  function cancelScan() { bridge()?.stopScan(); setScreen("home"); }
  function stop() { bridge()?.stop(); }
  function chooseQuality(q: Quality) { setQuality(q); store.set("camos.quality", q); }
  function chooseCamera(c: "back" | "front") { setFront(c === "front"); store.set("camos.front", c === "front"); }
  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const found = parseQR(`${ip.trim()},7777,${key.trim()}`);
    if (!found) { setError("Enter the PC IP address and the 8-character pairing key shown in Gamepad Server."); return; }
    setPc(found); store.set("camos.pc", found); go(found);
  }

  return <div className="gp-shell camos-root" data-screen={screen}>
    <AnimatePresence mode="popLayout" initial={false}>
      {screen === "home" && <motion.div key="home" className="camos-home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
        <header className="calm-header camos-header">
          <span className="camos-wordmark"><Camera size={20} aria-hidden="true" />CamOS</span>
          <span className="camos-tagline">Your phone as a webcam</span>
        </header>
        <main className="camos-grid">
          <section className="camos-col">
            <ol className="calm-steps">
              <li className="calm-step"><span className="calm-step-number" aria-hidden="true">1</span><div><h2>Open Gamepad Server on your PC</h2><p>Windows 11. Keep your phone and PC on the same Wi-Fi.</p></div></li>
              <li className="calm-step"><span className="calm-step-number" aria-hidden="true">2</span><div><h2>Pick “CamOS Camera” in your app</h2><p>Zoom, Google Meet, Teams, Discord, OBS or the Camera app.</p></div></li>
            </ol>
            {pc && <button className="calm-primary" data-testid="camos-start" onClick={() => go()}>
              <Monitor size={20} aria-hidden="true" />Start camera on {pc.ip}<ArrowRight size={18} aria-hidden="true" /></button>}
            <button className={pc ? "calm-secondary" : "calm-primary"} data-testid="camos-scan" onClick={scan}><ScanLine size={20} aria-hidden="true" />{pc ? "Scan a different PC" : "Scan PC QR code"}</button>
            <button className="calm-text-button calm-manual-toggle" aria-expanded={manual} onClick={() => setManual((v) => !v)}>{manual ? "Hide manual entry" : "Connect manually instead"}</button>
            <Collapse open={manual}><form className="calm-manual" onSubmit={submitManual}>
              <div className="calm-fields">
                <label>PC IP address<input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={15} /></label>
                <label>Pairing key<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="8 characters from your PC" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8} /></label>
              </div>
              <button className="calm-primary" type="submit">Connect<ArrowRight size={18} aria-hidden="true" /></button>
            </form></Collapse>
            {error && <p className="calm-error camos-error" role="alert">{error}</p>}
          </section>
          <section className="camos-col">
            <span className="console-eyebrow">PICTURE QUALITY</span>
            <ChoiceBar label="Picture quality" value={quality} onChoose={chooseQuality}
              choices={[{ value: "480", label: "480p", testId: "q-480" }, { value: "720", label: "720p", testId: "q-720" }, { value: "1080", label: <>1080p <span className="camos-hd">HD</span></>, testId: "q-1080" }]} />
            <SwapIn swapKey={quality}><p className="calm-mode-help">{quality === "480" ? "Smallest and coolest. Good on slow Wi-Fi." : quality === "720" ? "Best for video calls. Recommended." : "Sharpest picture. Needs good Wi-Fi; the phone runs warmer."}</p></SwapIn>
            <span className="console-eyebrow camos-gap">CAMERA</span>
            <ChoiceBar label="Camera" value={front ? "front" : "back"} onChoose={chooseCamera}
              choices={[{ value: "back", label: "Back", testId: "cam-back" }, { value: "front", label: "Front", testId: "cam-front" }]} />
            <p className="calm-mode-help">Hold the phone sideways. 30 frames per second.</p>
          </section>
        </main>
      </motion.div>}

      {screen === "scan" && <motion.div key="scan" className="camos-scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
        <div className="camos-scan-frame" aria-hidden="true" />
        <p className="camos-scan-hint">Point at the QR code in the Gamepad Server window</p>
        <button className="calm-icon-button camos-scan-close" onClick={cancelScan} aria-label="Cancel scanning"><X size={22} /></button>
      </motion.div>}

      {screen === "live" && <motion.div key="live" className="camos-live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
        <motion.div className="camos-pill" {...cardIn} transition={SPRING} data-state={live.state}>
          <span className="camos-dot" aria-hidden="true" />
          {live.state === "live" ? <>Live on PC · {quality}p · {live.fps || "…"} fps{live.kbps ? ` · ${(live.kbps / 1000).toFixed(1)} Mbit/s` : ""}</> : live.message || "Connecting…"}
        </motion.div>
        <nav className="camos-bar" aria-label="Camera controls">
          <button className="calm-icon-button" onClick={() => bridge()?.flip()} aria-label="Switch camera"><RefreshCw size={20} /></button>
          <button className="calm-icon-button" disabled={front} data-on={torch} onClick={() => { const v = !torch; setTorch(v); bridge()?.torch(v); }} aria-label={torch ? "Flashlight off" : "Flashlight on"}>{torch ? <FlashlightOff size={20} /> : <Flashlight size={20} />}</button>
          <button className="calm-icon-button" onClick={() => bridge()?.dim(true)} aria-label="Dim screen (keeps streaming)"><Moon size={20} /></button>
          <button className="calm-primary camos-stop" onClick={stop}><Square size={16} aria-hidden="true" />Stop</button>
        </nav>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
