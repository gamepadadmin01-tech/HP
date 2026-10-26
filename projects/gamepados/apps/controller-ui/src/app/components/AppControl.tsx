// ─── What the server says the app should show (store/appConfig.ts) ──────────
//
//   AdsDownNote      the plans-screen message while rewarded ads are switched off
//   FreeTimeButton   guests only, while ads are off: tap → server → time on the phone
//   NoticeLine       the one-line notice at the top of Home; tap for the whole text
//   KillScreen       this build was switched off: a full-screen lock with an update button
//
// Everything that pops up is a Sheet: rendered into <body> (so it sits above the controller
// and any transformed container), frosted see-through backdrop, one card in the middle.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bell, ChevronRight, Gift, Loader2, RefreshCw, X } from "lucide-react";
import { API_ORIGIN } from "../api/account";
import { getAppConfig, minutesShort, minutesText, onAppConfigChange, refreshAppConfig } from "../store/appConfig";
import { getSession, onSessionChange } from "../store/account";
import { guestTrial } from "../store/guestTrial";
import { announceExtraTime } from "../store/rewardedAd";
import { requestSignIn } from "../store/navIntent";
import { getAppInfo, nativeCreditGuestFreeTime, openUrl } from "../platform/native";
import { getInstallId } from "../feedback";
import { useShellAppearance } from "./CalmShell";

// Theme tokens (styles/calm-shell.css). Sheets render into <body>, so Sheet wraps them in a
// .gp-shell element carrying the current light/dark theme: these resolve exactly as on the page.
const ACCENT = "var(--calm-accent)";
const MUTED = "var(--calm-muted)";
const GOOD = "var(--calm-good)";
const DANGER = "var(--calm-error)";
const CARD_BG = "var(--calm-surface)";
const CARD_LINE = "var(--calm-line)";
const INK = "var(--calm-ink)";
const SOFT = "var(--calm-muted)";

const useConfig = () => useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);
const useSession = () => useSyncExternalStore(onSessionChange, getSession, getSession);


// ── The shared pop-up ───────────────────────────────────────────────────────

function Sheet({ open, onClose, children, label, z = 2000 }: {
  open: boolean; onClose?: () => void; children: React.ReactNode; label: string; z?: number;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  // The app's own light/dark setting, so a sheet in <body> matches the page under it.
  const { appearance: theme } = useShellAppearance();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="gp-shell" data-calm-theme={theme} style={{ background: "transparent" }}>
      <div role="dialog" aria-modal="true" aria-label={label}
        onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
        style={{
          position: "fixed", inset: 0, zIndex: z, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))",
          background: theme === "light" ? "rgba(24,24,26,0.32)" : "rgba(0,0,0,0.55)",
          backdropFilter: "blur(14px) saturate(1.1)", WebkitBackdropFilter: "blur(14px) saturate(1.1)",
          animation: "gpSheetIn 0.2s ease-out",
        }}>
        <style>{`@keyframes gpSheetIn{from{opacity:0}to{opacity:1}}@keyframes gpCardIn{from{opacity:0;transform:translateY(10px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
        <div style={{
          width: "100%", maxWidth: 380, maxHeight: "100%", overflowY: "auto", borderRadius: 16, padding: "22px 20px 18px",
          background: CARD_BG, border: `1px solid ${CARD_LINE}`, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", color: INK,
          fontFamily: "var(--calm-body)", animation: "gpCardIn 0.24s cubic-bezier(0.2,0.8,0.2,1)",
        }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{
    width: "100%", minHeight: 48, padding: "12px 16px", borderRadius: 12, border: "none", fontSize: 14, fontWeight: 600,
    background: ACCENT, color: "var(--calm-on-accent)", opacity: disabled ? 0.5 : 1,
  }}>{children}</button>;
}

function QuietButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{
    width: "100%", minHeight: 48, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, marginTop: 8,
    background: "transparent", color: INK, border: `1px solid ${CARD_LINE}`,
  }}>{children}</button>;
}

function SheetIcon({ children, tint = "var(--calm-tint)", color = ACCENT }: { children: React.ReactNode; tint?: string; color?: string }) {
  return <div style={{ width: 46, height: 46, borderRadius: 12, display: "grid", placeItems: "center", background: tint, color, marginBottom: 14 }}>{children}</div>;
}

// ── Plans screens: why ads are off ──────────────────────────────────────────

export function AdsDownNote() {
  const cfg = useConfig();
  if (cfg.ads.available || !cfg.ads.message) return null;
  return <div role="status" data-testid="ads-down-note" style={{
    display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
    background: "var(--calm-warning-bg)", color: INK,
  }}>
    <AlertTriangle size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2, color: "var(--calm-warning)" }} />
    <span>{cfg.ads.message}</span>
  </div>;
}

// ── The ad button while ads are off: visible, never tappable ───────────────

export function DisabledAdButton({ rewardSeconds }: { rewardSeconds: number }) {
  return <button disabled data-testid="watch-ad-button-disabled" aria-disabled="true"
    className="w-full rounded-xl text-sm font-semibold flex flex-col items-center justify-center"
    style={{
      padding: "10px 8px", minHeight: 58, cursor: "not-allowed", opacity: 0.75,
      background: "var(--calm-soft)", border: `1px dashed ${CARD_LINE}`, color: MUTED,
    }}>
    <span>Watch an ad</span>
    <small style={{ fontSize: 11, fontWeight: 500, marginTop: 2 }}>+{minutesShort(rewardSeconds)} · not working now</small>
  </button>;
}

// ── "Get free time" (guests, while ads are off) ─────────────────────────────

type Phase = "idle" | "loading" | "done" | "error";

export function FreeTimeButton({ onSignIn }: { onSignIn?: () => void }) {
  const cfg = useConfig();
  const session = useSession();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [tapsLeft, setTapsLeft] = useState<number | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    // The phone's clock moves while this is on screen; re-read it so the button opens on time.
    const t = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(t); };
  }, []);

  const ft = cfg.guest.freeTime;
  if (session || !ft.enabled) return null;
  const remaining = guestTrial().remainingSeconds;
  const tooMuch = remaining >= ft.belowSeconds;
  const disabled = tooMuch || !online || phase === "loading";

  const close = () => { setPhase("idle"); setMessage(""); };
  const signIn = () => { close(); if (onSignIn) onSignIn(); else requestSignIn(); };

  async function claim() {
    if (disabled) return;
    setPhase("loading"); setMessage(""); setTapsLeft(null);
    try {
      const info = getAppInfo();
      const res = await fetch(`${API_ORIGIN}/api/guest/free-time`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installId: getInstallId(), channel: info.channel || "direct", versionCode: info.build || 0 }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json.success !== true) {
        if (json.code === "closed") void refreshAppConfig();   // ads are back: the button goes away
        if (json.code === "limit") setTapsLeft(0);
        setMessage(json.error || "Couldn't add free time. Try again in a moment.");
        setPhase("error");
        return;
      }
      const r = nativeCreditGuestFreeTime(Number(json.seconds) || ft.seconds, ft.belowSeconds);
      if (!r) { setMessage("This version of the app can't add free time. Update to the latest version."); setPhase("error"); return; }
      if (!r.credited) {
        setMessage(`You already have ${minutesText(ft.belowSeconds)} or more. Free time opens again when you're under that.`);
        setPhase("error");
        return;
      }
      setTapsLeft(typeof json.tapsLeft === "number" ? json.tapsLeft : null);
      // Same listeners as an ad: the out-of-time screen restarts play, plans re-read the clock.
      announceExtraTime(`+${minutesText(Number(json.seconds) || ft.seconds)} added.`);
      setPhase("done");
    } catch {
      setMessage("You need an internet connection to get free time.");
      setPhase("error");
    }
  }

  return <>
    <button data-testid="free-time-button" onClick={() => { void claim(); }} disabled={disabled}
      className="w-full rounded-xl text-sm font-semibold flex flex-col items-center justify-center"
      style={{
        padding: "10px 8px", minHeight: 58, opacity: disabled ? 0.5 : 1,
        background: "var(--calm-good-bg)", border: "1px solid var(--calm-good)", color: GOOD,
      }}>
      <span className="flex items-center gap-1.5">{phase === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />} Get free time</span>
      <small style={{ fontSize: 11, fontWeight: 500, marginTop: 2 }}>
        {!online ? "Needs internet" : tooMuch ? `Opens under ${minutesShort(ft.belowSeconds)} left` : `+${minutesShort(ft.seconds)} · ${ft.perDay} a day`}
      </small>
    </button>

    <Sheet open={phase !== "idle"} onClose={phase === "loading" ? undefined : close} label={ft.title}>
      <SheetIcon tint="var(--calm-good-bg)" color={GOOD}>{phase === "loading" ? <Loader2 size={22} className="animate-spin" /> : <Gift size={22} />}</SheetIcon>
      <h2 style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.25, fontFamily: "var(--calm-display, system-ui, sans-serif)" }}>{ft.title}</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, color: SOFT, marginTop: 8 }}>{ft.body}</p>
      <div role="status" style={{
        marginTop: 14, padding: "11px 13px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.45,
        background: phase === "error" ? "var(--calm-soft)" : phase === "done" ? "var(--calm-good-bg)" : "var(--calm-soft)",
        color: phase === "error" ? DANGER : phase === "done" ? GOOD : SOFT,
      }}>
        {phase === "loading" && "Adding your free time…"}
        {phase === "done" && <>
          <b>+{minutesText(ft.seconds)} added.</b>
          {tapsLeft !== null && <> {tapsLeft === 0 ? "That was today's last free-time tap." : `${tapsLeft} free-time tap${tapsLeft === 1 ? "" : "s"} left today.`}</>}
        </>}
        {phase === "error" && message}
      </div>
      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={signIn} disabled={phase === "loading"}>Sign in for unlimited time</PrimaryButton>
        {phase !== "loading" && <QuietButton onClick={close}>{phase === "done" ? "Continue playing" : "Close"}</QuietButton>}
      </div>
    </Sheet>
  </>;
}

// ── The notice line at the top of Home ──────────────────────────────────────

export function NoticeLine() {
  const cfg = useConfig();
  const [open, setOpen] = useState(false);
  if (!cfg.notice) return null;
  const text = cfg.notice.text;
  return <>
    <button data-testid="notice-line" onClick={() => setOpen(true)} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, textAlign: "left",
      background: CARD_BG, border: `1px solid ${CARD_LINE}`,
      color: INK, marginBottom: 14,
    }}>
      <Bell size={15} aria-hidden="true" style={{ flex: "none", color: ACCENT }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      <ChevronRight size={16} aria-hidden="true" style={{ flex: "none", color: MUTED }} />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} label="Notice">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <SheetIcon><Bell size={22} /></SheetIcon>
        <button aria-label="Close" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: SOFT, padding: 4 }}><X size={18} /></button>
      </div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: SOFT, marginBottom: 6 }}>From GamepadOS</div>
      <p style={{ fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{text}</p>
      <div style={{ marginTop: 18 }}><PrimaryButton onClick={() => setOpen(false)}>Got it</PrimaryButton></div>
    </Sheet>
  </>;
}

// ── Kill switch: this build is switched off ─────────────────────────────────

const STORE_NAMES: Record<string, string> = {
  playstore: "Google Play", uptodown: "Uptodown", aptoide: "Aptoide", amazonstore: "Amazon Appstore",
  indusstore: "Indus Appstore", apkpure: "APKPure",
};

export function KillScreen() {
  const cfg = useConfig();
  const kill = cfg.kill;
  useEffect(() => {
    if (!kill) return;
    // Nothing must reach the PC from a switched-off build, whatever screen was open.
    try { (window as any).AndroidBridge?.setInputStreaming?.(false); } catch { /* old bridge */ }
  }, [kill]);
  if (!kill) return null;
  const info = getAppInfo();
  const store = STORE_NAMES[info.channel];
  return <Sheet open label="Update required" z={2147483000}>
    <div data-testid="kill-screen" style={{ textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <SheetIcon><RefreshCw size={22} /></SheetIcon>
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--calm-display, system-ui, sans-serif)" }}>Update GamepadOS</h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: SOFT, marginTop: 10 }}>{kill.message}</p>
      <div style={{ marginTop: 20 }}>
        <PrimaryButton onClick={() => openUrl(kill.storeUrl)}>{store ? `Update on ${store}` : "Download the update"}</PrimaryButton>
      </div>
      {info.version && <p style={{ fontSize: 11.5, color: SOFT, opacity: 0.75, marginTop: 12 }}>You have version {info.version}.</p>}
    </div>
  </Sheet>;
}
