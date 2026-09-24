import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Download, Monitor, ScanLine, Smartphone, Usb, Wifi } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShellMotion } from "./ShellMotion";
import { getWiredPref, setWiredPref, type WiredPref } from "../store/prefs";
import { linkState, type LinkTelemetry } from "../linkState";
import { openUrl } from "../platform/native";
import { AppearanceButton, CalmBrand, ConnectionSummary } from "./CalmShell";

export function CalmConnect({ telemetry, appearance, onAppearance, onBack, onScan, onManual }: {
  telemetry: LinkTelemetry | null; appearance: "light" | "dark";
  onAppearance: () => void; onBack: () => void; onScan: () => void;
  onManual: (ip: string, port: number, key: string) => void;
}) {
  const [tab, setTab] = useState<"wireless" | "wired">("wireless");
  const [wired, setWired] = useState<WiredPref>(getWiredPref);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("7777");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const reduced = useReducedMotion();
  const connected = linkState(telemetry) === "connected";
  const chooseWired = (mode: WiredPref) => { setWiredPref(mode); setWired(mode); };
  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    const address = ip.trim();
    const parts = address.split(".");
    const validIP = parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
    const validPort = /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
    if (!validIP || !validPort) { setError("Enter a valid PC IPv4 address and a port from 1 to 65535."); return; }
    if (!/^[a-fA-F0-9]{8}$/.test(key.trim())) { setError("Enter the 8-character pairing key shown on your PC."); return; }
    if (!(window as any).AndroidBridge?.connectToPC) { setError("Manual connection is available in the Android app."); return; }
    setError(""); onManual(address, Number(port), key.trim().toLowerCase());
  };
  const step = (n: number, title: string, description: React.ReactNode) => <li className="calm-step">
    <span className="calm-step-number" aria-hidden="true">{n}</span><div><h2>{title}</h2><p>{description}</p></div></li>;

  return <>
    <ShellMotion />
    <header className="calm-header"><CalmBrand /><AppearanceButton appearance={appearance} onClick={onAppearance} /></header>
      <div className="console-connect-chrome">
        <button data-testid="connect-back-button" className="calm-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />Back to Play</button>
        <div className="calm-intro"><span className="console-eyebrow">TWO DEVICES. ONE GREAT SESSION.</span><h1 data-testid="connect-heading">Make the connection.</h1><p>Your PC meets its new controller.</p></div>
        <div className="calm-segment" aria-label="Connection method">
          <button data-testid="connection-wireless-button" aria-pressed={tab === "wireless"} onClick={() => { setTab("wireless"); setError(""); }}><Wifi size={18} aria-hidden="true" />Wi-Fi</button>
          <button data-testid="connection-usb-button" aria-pressed={tab === "wired"} onClick={() => { setTab("wired"); chooseWired(wired); setManual(false); setError(""); }}><Usb size={18} aria-hidden="true" />USB</button>
        </div>
      </div>
    <main className="calm-connect-scroll">
      <div className="calm-connect-content">
        <AnimatePresence mode="wait" initial={false}><motion.div key={tab} initial={{ opacity: reduced ? 1 : 0, x: 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 0 }} transition={{ duration: reduced ? 0 : .16 }}>
          <div className="calm-pairing" aria-hidden="true"><motion.span initial={{ scale: .9 }} animate={{ scale: 1 }}><Smartphone size={32} /></motion.span>{[0,1,2].map(n => <motion.i key={n} animate={reduced ? {} : { opacity: [.25, 1, .25] }} transition={{ duration: 1.6, repeat: Infinity, delay: n * .2 }} />)}<motion.span initial={{ scale: .9 }} animate={{ scale: 1 }}><Monitor size={32} /></motion.span></div>
          {tab === "wireless" ? <>
            <ol className="calm-steps">
              {step(1, "Open GamepadServer", <>Keep your phone and PC on the same Wi-Fi network.<button className="calm-text-button" onClick={() => openUrl("https://gamepad.space/#download")}><Download size={16} aria-hidden="true" />Get the PC server</button></>)}
              {step(2, "Scan the code on your PC", "The code appears in the GamepadServer window. Point your phone camera at it to pair.")}
            </ol>
            <button data-testid="scan-qr-button" className="calm-primary" onClick={onScan}><ScanLine size={20} aria-hidden="true" />Scan PC QR code</button>
            <button data-testid="manual-entry-toggle-button" className="calm-text-button calm-manual-toggle" aria-expanded={manual} aria-controls="calm-manual-form" onClick={() => { setManual(v => !v); setError(""); }}>{manual ? "Hide manual entry" : "Connect manually instead"}</button>
            <AnimatePresence>{manual && <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} id="calm-manual-form" className="calm-manual" onSubmit={submitManual}>
              <p>Enter the IP address and pairing key shown below your PC’s QR code. Keep port 7777 unless your PC shows a different port.</p>
              <div className="calm-fields"><label htmlFor="calm-pc-ip">PC IP address<input data-testid="manual-ip-input" id="calm-pc-ip" value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={15} aria-invalid={!!error} aria-describedby={error ? "calm-connect-error" : undefined} /></label>
                <label htmlFor="calm-pc-port">Port<input data-testid="manual-port-input" id="calm-pc-port" value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={5} aria-invalid={!!error} /></label>
                <label htmlFor="calm-pc-key">Pairing key<input data-testid="manual-key-input" id="calm-pc-key" value={key} onChange={e => setKey(e.target.value)} placeholder="8 characters from your PC" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8} aria-invalid={!!error} aria-describedby={error ? "calm-connect-error" : undefined} /></label></div>
              {error && <p className="calm-error" id="calm-connect-error" role="alert">{error}</p>}
              <button data-testid="manual-connect-button" className="calm-primary" type="submit">Connect<ArrowRight size={18} aria-hidden="true" /></button>
            </motion.form>}</AnimatePresence>
          </> : <>
            <div className="calm-segment calm-usb-modes" aria-label="USB connection mode">
              {([["auto", "Auto"], ["tether", "Tethering"], ["usbdebug", "Debugging"]] as const).map(([mode, label]) => <button data-testid={`usb-mode-${mode}-button`} key={mode} aria-pressed={wired === mode} onClick={() => chooseWired(mode)}>{label}</button>)}
            </div>
            <p className="calm-mode-help">{wired === "auto" ? "Auto prefers USB tethering and can fall back to USB debugging." : wired === "tether" ? "Use your phone's USB tethering connection." : "Use the USB debugging connection to your PC."}</p>
            <ol className="calm-steps">
              {step(1, "Connect a USB data cable", "Plug your phone into your PC and open GamepadServer.")}
              {wired === "usbdebug" ? step(2, "Allow USB debugging", "On your phone, open Developer options and enable USB debugging. Approve your PC when the authorization prompt appears.")
                : step(2, "Turn on USB tethering", "On your phone, look under Settings → Hotspot & tethering → USB tethering. The setting name may vary by phone.")}
              {step(3, "Wait for the connection", "GamepadOS connects automatically when the selected USB connection and PC server are ready.")}
            </ol>
            {wired === "auto" && <details className="calm-help"><summary>Using USB debugging instead?</summary><p>Enable USB debugging in Developer options and approve your PC's authorization prompt. Auto can use this connection when tethering is unavailable.</p></details>}
            {wired === "usbdebug" && <details className="calm-help"><summary>Can't find Developer options?</summary><p>In your phone's About screen, tap Build number seven times, then return to Settings and open Developer options.</p></details>}
          </>}
          <div className="calm-live-link"><ConnectionSummary telemetry={telemetry} />{connected && <button className="calm-secondary" onClick={onBack}>Back to Play<ArrowRight size={18} aria-hidden="true" /></button>}</div>
        </motion.div></AnimatePresence>
      </div>
    </main>
  </>;
}
