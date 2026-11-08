import React, { useId, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Download, ScanLine, Usb, Wifi } from "lucide-react";
import { ShellMotion } from "./ShellMotion";
import { getWiredPref, setWiredPref, type WiredPref } from "../store/prefs";
import { linkState, type LinkTelemetry } from "../linkState";
import { openUrl } from "../platform/native";
import { ConnectionSummary } from "./CalmShell";
import { ChoiceBar, Collapse, SwapIn } from "./Motion";

// ── Motion for this screen (owner, 2026-11-08: "same kind of animation for the same set of actions") ────────────
// Three kinds of action, three motions, all from ./Motion so they match the rest of the app:
//   • choosing an option (Wi-Fi/USB, Auto/Tethering/Debugging): the orange pill glides to it  -> ChoiceBar
//   • what is shown changes because of that choice: the new content fades up at once          -> SwapIn
//   • opening/closing something (manual entry, both USB help questions): it unfolds/folds back -> Collapse
// Nothing waits for the old content to leave first, which is what made the old version feel laggy.

/** A question that opens to show its answer. */
function FoldOut({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="calm-help">
    <button type="button" className="calm-help-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
      <span className="calm-help-chevron" aria-hidden="true"><ChevronRight size={16} /></span>
      {summary}
    </button>
    <Collapse open={open} id={id}><p>{children}</p></Collapse>
  </div>;
}

export function CalmConnect({ telemetry, onBack, onScan, onManual }: {
  telemetry: LinkTelemetry | null;
  onBack: () => void; onScan: () => void;
  onManual: (ip: string, port: number, key: string) => void;
}) {
  const [tab, setTab] = useState<"wireless" | "wired">("wireless");
  const [wired, setWired] = useState<WiredPref>(getWiredPref);
  const [manual, setManual] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("7777");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
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
    {/* Top bar: just the back arrow on the left. */}
    <header className="calm-header calm-header-centred">
      <button data-testid="connect-back-button" className="calm-icon-button" onClick={onBack} aria-label="Back to Play"><ArrowLeft size={22} aria-hidden="true" /></button>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </header>
      <div className="console-connect-chrome">
        <h1 className="sr-only" data-testid="connect-heading">Make the connection.</h1>
        <ChoiceBar label="Connection method" value={tab}
          choices={[{ value: "wireless", testId: "connection-wireless-button", label: <><Wifi size={18} aria-hidden="true" />Wi-Fi</> },
                    { value: "wired", testId: "connection-usb-button", label: <><Usb size={18} aria-hidden="true" />USB</> }]}
          onChoose={(v) => { if (v === "wireless") { setTab("wireless"); setError(""); } else { setTab("wired"); chooseWired(wired); setManual(false); setError(""); } }} />
      </div>
    <main className="calm-connect-scroll">
      <div className="calm-connect-content">
        <SwapIn swapKey={tab}>
          {tab === "wireless" ? <>
            <ol className="calm-steps">
              {step(1, "Open GamepadServer", <>Keep your phone and PC on the same Wi-Fi network.<button className="calm-text-button" onClick={() => openUrl("https://gamepad.space/#download")}><Download size={16} aria-hidden="true" />Get the PC server</button></>)}
              {step(2, "Scan the code on your PC", "The code appears in the GamepadServer window. Point your phone camera at it to pair.")}
            </ol>
            <button data-testid="scan-qr-button" className="calm-primary" onClick={onScan}><ScanLine size={20} aria-hidden="true" />Scan PC QR code</button>
            <button data-testid="manual-entry-toggle-button" className="calm-text-button calm-manual-toggle" aria-expanded={manual} aria-controls="calm-manual-form" onClick={() => { setManual(v => !v); setError(""); }}>{manual ? "Hide manual entry" : "Connect manually instead"}</button>
            <Collapse open={manual}><form id="calm-manual-form" className="calm-manual" onSubmit={submitManual}>
              <p>Enter the IP address and pairing key shown below your PC’s QR code. Keep port 7777 unless your PC shows a different port.</p>
              <div className="calm-fields"><label htmlFor="calm-pc-ip">PC IP address<input data-testid="manual-ip-input" id="calm-pc-ip" value={ip} onChange={e => setIp(e.target.value)} placeholder="192.168.1.10" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={15} aria-invalid={!!error} aria-describedby={error ? "calm-connect-error" : undefined} /></label>
                <label htmlFor="calm-pc-port">Port<input data-testid="manual-port-input" id="calm-pc-port" value={port} onChange={e => setPort(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={5} aria-invalid={!!error} /></label>
                <label htmlFor="calm-pc-key">Pairing key<input data-testid="manual-key-input" id="calm-pc-key" value={key} onChange={e => setKey(e.target.value)} placeholder="8 characters from your PC" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={8} aria-invalid={!!error} aria-describedby={error ? "calm-connect-error" : undefined} /></label></div>
              {error && <p className="calm-error" id="calm-connect-error" role="alert">{error}</p>}
              <button data-testid="manual-connect-button" className="calm-primary" type="submit">Connect<ArrowRight size={18} aria-hidden="true" /></button>
            </form></Collapse>
          </> : <>
            <ChoiceBar label="USB connection mode" className="calm-usb-modes" value={wired}
              choices={([["auto", "Auto"], ["tether", "Tethering"], ["usbdebug", "Debugging"]] as const).map(([mode, label]) => ({ value: mode, label, testId: `usb-mode-${mode}-button` }))}
              onChoose={chooseWired} />
            {/* What each USB mode shows fades up when the mode changes (same motion as Wi-Fi <-> USB). */}
            <SwapIn swapKey={wired}>
              <p className="calm-mode-help">{wired === "auto" ? "Auto prefers USB tethering and can fall back to USB debugging." : wired === "tether" ? "Use your phone's USB tethering connection." : "Use the USB debugging connection to your PC."}</p>
              <ol className="calm-steps">
                {step(1, "Connect a USB data cable", "Plug your phone into your PC and open GamepadServer.")}
                {wired === "usbdebug" ? step(2, "Allow USB debugging", "On your phone, open Developer options and enable USB debugging. Approve your PC when the authorization prompt appears.")
                  : step(2, "Turn on USB tethering", "On your phone, look under Settings → Hotspot & tethering → USB tethering. The setting name may vary by phone.")}
                {step(3, "Wait for the connection", "GamepadOS connects automatically when the selected USB connection and PC server are ready.")}
              </ol>
              {wired === "auto" && <FoldOut summary="Using USB debugging instead?">Enable USB debugging in Developer options and approve your PC's authorization prompt. Auto can use this connection when tethering is unavailable.</FoldOut>}
              {wired === "usbdebug" && <FoldOut summary="Can't find Developer options?">In your phone's About screen, tap Build number seven times, then return to Settings and open Developer options.</FoldOut>}
            </SwapIn>
          </>}
        </SwapIn>
        <div className="calm-live-link"><ConnectionSummary telemetry={telemetry} />{connected && <button className="calm-secondary" onClick={onBack}>Back to Play<ArrowRight size={18} aria-hidden="true" /></button>}</div>
      </div>
    </main>
  </>;
}
