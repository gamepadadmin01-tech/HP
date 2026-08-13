import React, { useState, useEffect, useRef } from "react";
// @ts-ignore - createPortal types
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, QrCode } from "lucide-react";
import { PollingHz } from "../types";

export const DIALOG_DUR  = 260;

export function useAnimatedDialog(open: boolean) {
  const [mounted, setMounted]   = useState(open);
  const [visible, setVisible]   = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), DIALOG_DUR + 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  return { mounted, visible };
}


export function DialogShell({ open, onClickOutside, children, zIndex = 30 }: {
  open: boolean; onClickOutside: () => void; children: React.ReactNode; zIndex?: number;
}) {
  const { mounted, visible } = useAnimatedDialog(open);
  if (!mounted) return null;
  return (
    <div
      className="absolute inset-0 flex items-center justify-center px-4"
      style={{
        zIndex,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${DIALOG_DUR}ms ease`,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClickOutside(); }}>
      <div
        style={{
          transform: visible ? "translate3d(0,0,0) scale(1)" : "translate3d(0,24px,0) scale(0.94)",
          transition: `transform ${DIALOG_DUR}ms cubic-bezier(0.34,1.56,0.64,1)`,
          width: "100%", maxWidth: "24rem",
          willChange: "transform",
          backfaceVisibility: "hidden",
        }}>
        {children}
      </div>
    </div>
  );
}

// ─── Advanced Tuning Dialog ───────────────────────────────────────────────────
export function TuningDialog({ open, pollingHz, setPollingHz, kernelBypass, setKernelBypass, gyroOn, setGyroOn, onDismiss }: {
  open: boolean;
  pollingHz: PollingHz; setPollingHz: (v: PollingHz) => void;
  kernelBypass: boolean; setKernelBypass: (v: boolean) => void;
  gyroOn: boolean; setGyroOn: (v: boolean) => void;
  onDismiss: () => void;
}) {
  return (
    <DialogShell open={open} onClickOutside={onDismiss}>
      <div className="rounded-2xl border p-5"
        style={{ background: "rgba(10,14,24,0.98)", borderColor: "rgba(79,134,198,0.15)", boxShadow: "0 0 48px rgba(0,0,0,0.9)" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-bold text-primary tracking-widest" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>ADVANCED TUNING</h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">System performance controls</p>
          </div>
          <button onClick={onDismiss} className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}><X size={14} /></button>
        </div>
        <div className="space-y-3">
          {[
            { label: "Kernel Charge Bypass", sub: "Shizuku · Prevents USB heat", val: kernelBypass, set: setKernelBypass },
            { label: "Zero-Lag Gyro Direct Mount", sub: "Shared memory IPC bypass", val: gyroOn, set: setGyroOn },
          ].map(({ label, sub, val, set }) => (
            <div key={label} className="flex items-center justify-between p-3.5 rounded-xl border"
              style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}>
              <div><p className="text-sm font-mono font-semibold text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p></div>
              <button onClick={() => set(!val)}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${val ? "bg-primary" : "bg-muted"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${val ? "translate-x-6" : ""}`} />
              </button>
            </div>
          ))}
          <div className="p-3.5 rounded-xl border" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}>
            <p className="text-sm font-mono font-semibold text-foreground mb-3">Telemetry Polling Rate</p>
            <div className="grid grid-cols-4 gap-2">
              {([60, 120, 500, 1000] as PollingHz[]).map((hz) => (
                <button key={hz} onClick={() => setPollingHz(hz)}
                  className={`py-2.5 rounded-lg text-xs font-mono font-bold border transition-all duration-200 ${pollingHz === hz
                    ? "bg-[#441111] text-[#dd4444] border-[#661111]"
                    : "bg-muted/20 text-muted-foreground border-border"}`}>
                  {hz >= 1000 ? "1kHz" : `${hz}Hz`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center font-mono">
              {pollingHz}Hz · {(1000 / pollingHz).toFixed(2)}ms/packet
            </p>
          </div>
        </div>
        <button onClick={onDismiss} className="mt-4 w-full py-3 rounded-xl font-mono text-sm font-bold tracking-widest"
          style={{ background: "rgba(90,16,16,0.2)", border: "1px solid rgba(90,16,16,0.4)", color: "#cc4444" }}>
          DISMISS
        </button>
      </div>
    </DialogShell>
  );
}

// ─── Playtime Credits Dialog ──────────────────────────────────────────────────
export function CreditsDialog({ open, credits, premium, setPremium, setCredits, onDismiss }: {
  open: boolean;
  credits: number; premium: boolean;
  setPremium: (v: boolean) => void; setCredits: (fn: (c: number) => number) => void;
  onDismiss: () => void;
}) {
  const [watching, setWatching] = useState(false);
  const [adPct, setAdPct] = useState(0);
  const adRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (adRef.current) clearInterval(adRef.current); }, []);
  const mins = Math.floor(credits / 60), secs = credits % 60;

  function watchAd() {
    setWatching(true); setAdPct(0); let p = 0;
    adRef.current = setInterval(() => {
      p += 3.33; setAdPct(Math.min(100, p));
      if (p >= 100) { clearInterval(adRef.current!); setWatching(false); setAdPct(0); setCredits(c => c + 35 * 60); }
    }, 100);
  }

  return (
    <DialogShell open={open} onClickOutside={onDismiss}>
      <div className="rounded-2xl border p-5"
        style={{ background: "rgba(10,14,24,0.98)", borderColor: "rgba(79,134,198,0.15)", boxShadow: "0 0 48px rgba(0,0,0,0.9)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-primary tracking-widest" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>PLAYTIME CREDITS</h3>
          <button onClick={onDismiss} className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}><X size={14} /></button>
        </div>
        <div className="text-center py-4 rounded-xl mb-4 border"
          style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}>
          {premium
            ? <><p className="text-3xl font-bold" style={{ fontFamily: "'Space Grotesk',sans-serif", color: "#64748B" }}>∞</p>
              <p className="text-xs font-mono text-muted-foreground mt-1">Unlimited · Premium Active</p></>
            : <><p className="text-3xl font-bold text-foreground tabular-nums" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
              {String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}</p>
              <p className="text-xs font-mono text-muted-foreground mt-1">Remaining</p>
              <div className="mx-6 mt-2 h-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100,(credits/(35*60))*100)}%` }} />
              </div></>}
        </div>
        <div className="space-y-2.5">
          {!premium && (
            watching
              ? <div className="p-3.5 rounded-xl border" style={{ background: "rgba(22,101,52,0.12)", borderColor: "rgba(22,101,52,0.3)" }}>
                <p className="text-xs font-mono text-green-400 mb-2">Watching… reward unlocks in {Math.ceil((100 - adPct) / 33.3)}s</p>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${adPct}%` }} />
                </div>
              </div>
              : <button onClick={watchAd} className="w-full py-3.5 rounded-xl font-mono text-sm font-semibold"
                style={{ background: "rgba(22,101,52,0.15)", border: "1px solid rgba(22,101,52,0.35)", color: "#4ade80" }}>
                ▶ WATCH AD  ·  +35 MINUTES
              </button>
          )}
          <button onClick={() => { setPremium(!premium); if (!premium) onDismiss(); }}
            className="w-full py-3.5 rounded-xl font-mono text-sm font-semibold"
            style={{ background: "rgba(147,51,234,0.12)", border: "1px solid rgba(147,51,234,0.35)", color: "#64748B" }}>
            {premium ? "✓ PREMIUM ACTIVE — tap to revoke" : "⚡ UPGRADE TO LIFETIME PREMIUM"}
          </button>
        </div>
        <button onClick={onDismiss} className="mt-3 w-full py-2.5 rounded-xl font-mono text-xs text-muted-foreground"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>DISMISS</button>
      </div>
    </DialogShell>
  );
}

// ─── Playtime Lockout Overlay ─────────────────────────────────────────────────
export function LockoutOverlay({ open, setCredits, setPremium }: {
  open: boolean;
  setCredits: (fn: (c: number) => number) => void; setPremium: (v: boolean) => void;
}) {
  const { mounted, visible } = useAnimatedDialog(open);
  const [watching, setWatching] = useState(false);
  const [adPct, setAdPct] = useState(0);
  const adRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (adRef.current) clearInterval(adRef.current); }, []);

  function watchAd() {
    setWatching(true); setAdPct(0); let p = 0;
    adRef.current = setInterval(() => {
      p += 3.33; setAdPct(Math.min(100, p));
      if (p >= 100) { clearInterval(adRef.current!); setWatching(false); setAdPct(0); setCredits(() => 35 * 60); }
    }, 100);
  }

  if (!mounted) return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6"
      style={{
        zIndex: 40,
        background: "rgba(0,0,0,0.97)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${DIALOG_DUR}ms ease`,
      }}>
      <div style={{
        transform: visible ? "translateY(0) scale(1)" : "translateY(24px) scale(0.96)",
        transition: `transform ${DIALOG_DUR}ms cubic-bezier(0.34,1.56,0.64,1)`,
        display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
      }}>
        <div className="relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-full"
            style={{ border: "3px solid rgba(185,28,28,0.25)" }} />
          <div className="absolute inset-0 rounded-full"
            style={{ border: "3px solid transparent", borderTopColor: "#dc2626", borderRightColor: "#dc2626", transform: "rotate(-30deg)" }} />
          <div className="absolute inset-2 rounded-full flex items-center justify-center">
            <div className="w-px h-5 bg-red-600 rounded-full" style={{ transform: "rotate(-30deg)" }} />
          </div>
        </div>
        <h2 className="text-xl font-bold text-red-500 text-center mb-2 tracking-widest"
          style={{ fontFamily: "'Space Grotesk',sans-serif" }}>SESSION PLAYTIME EXHAUSTED</h2>
        <p className="text-sm text-muted-foreground text-center mb-8 max-w-xs leading-relaxed">
          Streaming session limit reached. Recharge by watching a partner ad or unlock uncapped access instantly.
        </p>
        <div className="w-full max-w-xs space-y-3">
          {watching
            ? <div className="p-4 rounded-2xl border" style={{ background: "rgba(22,101,52,0.1)", borderColor: "rgba(22,101,52,0.3)" }}>
              <p className="text-xs font-mono text-green-400 mb-2 text-center">
                Watching Ad — reward in {Math.ceil((100 - adPct) / 33.3)}s
              </p>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${adPct}%` }} />
              </div>
            </div>
            : <button onClick={watchAd} className="w-full py-4 rounded-2xl font-mono font-semibold text-sm"
              style={{ background: "rgba(22,101,52,0.15)", border: "2px solid rgba(22,101,52,0.4)", color: "#4ade80" }}>
              ▶  WATCH AD  ·  +35 MINUTES FREE
            </button>}
          <button onClick={() => setPremium(true)} className="w-full py-4 rounded-2xl font-mono font-semibold text-sm"
            style={{ background: "rgba(147,51,234,0.15)", border: "2px solid rgba(147,51,234,0.4)", color: "#64748B" }}>
            ⚡  UPGRADE TO LIFETIME PREMIUM
          </button>
        </div>
      </div>
    </div>
  );
}

// Button bitmask mapping (matching gamepad-engine.cpp)

// Parse a scanned QR payload into {ip, port, key}. Robust to the CSV the server
// emits ("ip,port,key"), URL, JSON, and bare IP[:port] forms, trimming stray
// whitespace/newlines. Returns null when no valid IPv4 can be extracted.
function parsePairingPayload(raw: string): { ip: string; port: number; key: string } | null {
  const payload = (raw || "").trim().replace(/[\r\n]+/g, "");
  let ip = "", port = 7777, key = "";
  try {
    if (payload.includes(",")) {
      const p = payload.split(",");
      ip = (p[0] || "").trim();
      port = parseInt((p[1] || "").trim(), 10) || 7777;
      key = (p[2] || "").trim();
    } else if (payload.startsWith("http") || payload.startsWith("gamepad")) {
      const url = new URL(payload);
      ip = url.hostname;
      port = parseInt(url.port, 10) || 7777;
      key = url.searchParams.get("key") || url.pathname.replace(/\//g, "");
    } else if (payload.startsWith("{")) {
      const d = JSON.parse(payload);
      ip = (d.ip || d.host || "").trim();
      port = parseInt(d.port, 10) || 7777;
      key = (d.key || d.password || "").trim();
    } else {
      const p = payload.split(":");
      ip = (p[0] || "").trim();
      if (p.length > 1) port = parseInt((p[1] || "").trim(), 10) || 7777;
    }
  } catch {
    ip = payload;
  }
  // Validate IPv4 and port range — reject garbage instead of dialing a bad default.
  const ipOk = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every(o => { const n = +o; return n >= 0 && n <= 255; });
  // The KEY must be validated too, and this used to be missing. The server's
  // contract is exactly 8 hex chars (`pairing.rs::is_valid_key`, which mirrors
  // Python) and it turns the key into the u32 auth token every packet carries.
  // An empty or malformed key therefore produced a WRONG token: the phone dialled
  // the right PC, sent frames, and the server silently dropped every one of them.
  // With no reply the connect verifier just timed out, so a bad/partial QR was
  // reported to the user as "no response from the PC" — indistinguishable from a
  // firewall or network fault, and the single most misleading failure in this flow.
  // Reject it here so the scanner can say "that isn't a server QR" instead.
  const keyOk = /^[0-9a-fA-F]{8}$/.test(key);
  if (!ipOk || !keyOk || port < 1 || port > 65535) return null;
  return { ip, port, key: key.toLowerCase() };
}

export function QRScanOverlay({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  // null = scanning, "verifying" = sent, "failed" = bad scan / no link in time.
  const [status, setStatus] = useState<null | "verifying" | "failed">(null);
  const [statusMsg, setStatusMsg] = useState("");
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopVerifyTimers = () => {
    if (verifyTimer.current) { clearTimeout(verifyTimer.current); verifyTimer.current = null; }
    if (verifyPoll.current) { clearInterval(verifyPoll.current); verifyPoll.current = null; }
  };

  useEffect(() => {
    const bridge = (window as any).AndroidBridge;
    if (bridge && bridge.startCameraScan) bridge.startCameraScan();

    (window as any).onQRScanned = (payload: string) => {
      if (!bridge || !bridge.connectToPC) {
        // Browser/simulator fallback.
        console.log("Mock QR Scan Received:", payload);
        onConnect(); onClose();
        return;
      }

      const parsed = parsePairingPayload(payload);
      if (!parsed) {
        // Bad QR — surface it and keep scanning instead of dialing a wrong IP.
        setStatus("failed");
        setStatusMsg("That QR code isn't a valid server code. Make sure the PC server window is showing its QR, then try again.");
        return;
      }

      // ── Connect, then VERIFY the link actually carries packets ───────────────
      //
      // WHY THIS RETRIES. The previous version gave the link ONE 5-second shot and
      // called stopEngine() the moment it expired. That budget has to cover the
      // whole bring-up: connectToPC -> native engine start -> the GRX X25519
      // handshake -> first frame -> the server's ACK (only an ACK sets linkAlive;
      // "we sent" is not enough). On a weak or congested AP that occasionally runs
      // past 5s, and when it did, the phone had already been torn down — the user
      // saw "no response from the PC" even though the PC was fine and the very next
      // scan would work. That is exactly the "scans fine, connects only sometimes"
      // report: an intermittent TIMEOUT, not a refusal.
      //
      // So: several attempts, each with a realistic budget, and the engine is only
      // stopped after the LAST one. Re-dialling between attempts is deliberate —
      // a lost handshake datagram is unrecoverable without a fresh connectToPC.
      const ATTEMPT_MS = 6000;   // per attempt — covers engine start + GRX + first ACK
      const MAX_ATTEMPTS = 3;    // ~18s total before we call it dead
      let attempt = 0;

      const markWirelessIntent = () => {
        // A QR scan is a WIRELESS intent. The transport coordinator reads this to
        // protect a fresh native Wi-Fi link (won't stopEngine / won't open the
        // USB-debug WS as a second pad) WITHOUT wiping the user's explicit
        // Wired-mode choice — clobbering gp_wired_pref to "auto" used to silently
        // reset the mode they picked.
        //
        // ⚠️ REFRESHED CONTINUOUSLY while verifying, not stamped once. The
        // coordinator's protection window is a fixed 8s; this verifier can now run
        // ~18s. Stamping once meant the window expired MID-CONNECT and the
        // coordinator was free to stopEngine() an in-flight wireless connect (it
        // does exactly that when the wired pref is "usbdebug"). Keeping the stamp
        // fresh while we verify makes the two self-consistent no matter how the
        // timeouts are tuned later — the window now expires ~8s after verification
        // STOPS, which is what it was always meant to mean.
        try { (window as any).__wirelessIntentAt = Date.now(); } catch {}
      };

      const giveUp = () => {
        stopVerifyTimers();
        setStatus("failed");
        setStatusMsg(
          "Paired, but no response from the PC. Check that:\n" +
          "• the PC server is running\n" +
          "• phone and PC are on the same network\n" +
          "• the phone is NOT plugged in by USB (that uses a different path)\n" +
          "• Windows firewall isn't blocking it\n\nThen rescan."
        );
        try { const b = (window as any).AndroidBridge; (b?.stopEngine ? b.stopEngine() : b?.stopNetworkNative?.()); } catch {}
      };

      const startAttempt = () => {
        attempt += 1;
        markWirelessIntent();
        bridge.connectToPC(parsed.ip, parsed.port, parsed.key);
        setStatus("verifying");
        setStatusMsg(
          attempt === 1
            ? `Connecting to ${parsed.ip}…`
            : `Still connecting to ${parsed.ip}… (attempt ${attempt} of ${MAX_ATTEMPTS})`
        );

        verifyPoll.current = setInterval(() => {
          markWirelessIntent();   // keep the coordinator off this link while we wait
          try {
            const t = JSON.parse(bridge.getNetworkTelemetryJson?.() || "{}");
            if (t.linkAlive) {   // PC actually responded (ACK), not just "we sent"
              stopVerifyTimers();
              // No pairing cache — every connect is a fresh scan (avoids dialing a
              // stale PC when switching computers).
              onConnect();   // link confirmed → go to dashboard
              onClose();
            }
          } catch {}
        }, 150);

        verifyTimer.current = setTimeout(() => {
          stopVerifyTimers();
          // Do NOT stopEngine() between attempts — the engine may be mid-handshake
          // and killing it is what turned a slow connect into a failed one.
          if (attempt < MAX_ATTEMPTS) startAttempt();
          else giveUp();
        }, ATTEMPT_MS);
      };

      startAttempt();
    };

    return () => {
      stopVerifyTimers();
      if (bridge && bridge.stopCameraScan) bridge.stopCameraScan();
      delete (window as any).onQRScanned;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryScan = () => {
    setStatus(null);
    setStatusMsg("");
    const bridge = (window as any).AndroidBridge;
    try { bridge?.startCameraScan?.(); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-transparent scanner-overlay-active"
      style={{ fontFamily: "'Inter',sans-serif" }}>
      <style>{`
        /* Force transparent backgrounds down to the root for Android CameraX visibility */
        body, html, #root, .scanner-overlay-active, .fixed.bg-black { background: transparent !important; }
        @keyframes laserSweep2{0%,100%{top:0}50%{top:calc(100% - 3px)}}
        @keyframes cornerPulse2{0%,100%{opacity:0.55}50%{opacity:1}}
        .corner2{animation:cornerPulse2 2.4s ease-in-out infinite}
        .c-tl2{animation-delay:0s}.c-tr2{animation-delay:0.6s}.c-bl2{animation-delay:1.2s}.c-br2{animation-delay:1.8s}
        .laser2{position:absolute;left:0;right:0;height:3px;
          background:linear-gradient(90deg,transparent,#5D90CB,#5D90CB,transparent);
          box-shadow:0 0 10px rgba(79,134,198,0.6);
          animation:laserSweep2 3s ease-in-out infinite}
      `}</style>
      
      {/* Semi-transparent header/footer masks around transparent scanning cutout */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between z-10 px-5 pb-4 bg-black/60 backdrop-blur-sm"
        style={{ paddingTop: "calc(var(--android-safe-top, env(safe-area-inset-top, 36px)) + 12px)" }}>
        <p className="text-sm font-bold text-primary" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Scan QR Code</p>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full"
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <X size={14} className="text-foreground" />
        </button>
      </div>
      
      {/* 4-way layout masks to create a transparent central scanning cutout without expensive box-shadow repaints */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        {/* Top */}
        <div className="absolute top-0 left-0 right-0" style={{ height: "calc(50% - min(36vw, 26vh))", background: "rgba(0,0,0,0.85)" }} />
        {/* Bottom */}
        <div className="absolute left-0 right-0 bottom-0" style={{ top: "calc(50% + min(36vw, 26vh))", background: "rgba(0,0,0,0.85)" }} />
        {/* Left */}
        <div className="absolute left-0" style={{ top: "calc(50% - min(36vw, 26vh))", width: "calc(50% - min(36vw, 26vh))", height: "min(72vw, 52vh)", background: "rgba(0,0,0,0.85)" }} />
        {/* Right */}
        <div className="absolute right-0" style={{ top: "calc(50% - min(36vw, 26vh))", width: "calc(50% - min(36vw, 26vh))", height: "min(72vw, 52vh)", background: "rgba(0,0,0,0.85)" }} />
      </div>

      {/* Target Reticle box */}
      <div className="relative z-10 rounded-xl" style={{ width: "min(72vw,52vh)", height: "min(72vw,52vh)" }}>
        <div className="absolute inset-0 rounded-xl" style={{ background: "rgba(79,134,198,0.01)", border: "1px solid rgba(79,134,198,0.2)" }} />
        {[
          { pos:"top-0 left-0", cls:"c-tl2", style:{borderTop:"3px solid #5D90CB",borderLeft:"3px solid #5D90CB",borderRadius:"3px 0 0 0"} },
          { pos:"top-0 right-0", cls:"c-tr2", style:{borderTop:"3px solid #5D90CB",borderRight:"3px solid #5D90CB",borderRadius:"0 3px 0 0"} },
          { pos:"bottom-0 left-0", cls:"c-bl2", style:{borderBottom:"3px solid #5D90CB",borderLeft:"3px solid #5D90CB",borderRadius:"0 0 0 3px"} },
          { pos:"bottom-0 right-0", cls:"c-br2", style:{borderBottom:"3px solid #5D90CB",borderRight:"3px solid #5D90CB",borderRadius:"0 0 3px 0"} },
        ].map(({ pos, cls, style }) => (
          <div key={cls} className={`corner2 ${cls} absolute ${pos} w-10 h-10`} style={style} />
        ))}
        <div className="absolute inset-0 overflow-hidden rounded-xl"><div className="laser2" /></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <QrCode size={56} style={{ color: "rgba(79,134,198,0.06)" }} />
        </div>
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 p-8 bg-black/60 backdrop-blur-sm text-center z-10">
        <p className="text-xs font-mono text-primary/70">Align the PC Server QR Code within the frame</p>
      </div>

      {/* Verifying / failed status overlay */}
      {status && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center bg-black/80 backdrop-blur-sm">
          {status === "verifying" ? (
            <>
              <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-4" />
              <p className="text-sm font-bold text-primary" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Pairing…</p>
              <p className="text-xs text-white/60 mt-2 whitespace-pre-line">{statusMsg}</p>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center mb-4">
                <X size={22} className="text-red-400" />
              </div>
              <p className="text-sm font-bold text-red-400" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>Pairing failed</p>
              <p className="text-xs text-white/60 mt-2 whitespace-pre-line max-w-[300px]">{statusMsg}</p>
              <div className="flex gap-3 mt-6">
                <button onClick={retryScan}
                  className="px-5 py-2.5 rounded-full bg-primary text-black font-bold text-sm active:scale-95 transition-all">
                  Rescan
                </button>
                <button onClick={onClose}
                  className="px-5 py-2.5 rounded-full bg-white/10 text-white font-medium text-sm active:scale-95 transition-all">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

