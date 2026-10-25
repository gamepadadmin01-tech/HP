// ─── What the server says the app should show (store/appConfig.ts) ──────────
//
//   AdsDownNote      the plans-screen message while rewarded ads are switched off
//   FreeTimeButton   guests only, while ads are off: tap → server → time on the phone
//   NoticeLine       the one-line notice at the top of Home; tap for the whole text
//   KillScreen       this build was switched off: a full-screen lock with an update button
//   RateAppCard/Link let players rate the app from Account and from the ad area
//
// Everything that pops up is a Sheet: rendered into <body> (so it sits above the controller
// and any transformed container), frosted see-through backdrop, one card in the middle.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bell, ChevronRight, Gift, Loader2, RefreshCw, Star, X } from "lucide-react";
import { API_ORIGIN } from "../api/account";
import { getAppConfig, minutesShort, minutesText, onAppConfigChange, refreshAppConfig } from "../store/appConfig";
import { getSession, onSessionChange } from "../store/account";
import { guestTrial } from "../store/guestTrial";
import { announceExtraTime } from "../store/rewardedAd";
import { requestSignIn } from "../store/navIntent";
import { getAppInfo, nativeCreditGuestFreeTime, openUrl } from "../platform/native";
import { getInstallId, markFeedbackSent, submitRating } from "../feedback";

const ACCENT = "var(--calm-accent, #abc8db)";
const MUTED = "var(--calm-muted, #a6b0b3)";
const GOOD = "var(--calm-good, #a7cfb6)";
const DANGER = "var(--calm-error, #ffaba6)";
// Sheets live in <body>, outside the themed dashboard, so they carry their own colours.
const CARD_BG = "rgba(22,27,31,0.94)";
const CARD_LINE = "rgba(255,255,255,0.10)";
const INK = "#eef2f3";
const SOFT = "#a9b4b8";

const useConfig = () => useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);
const useSession = () => useSyncExternalStore(onSessionChange, getSession, getSession);

// ── The shared pop-up ───────────────────────────────────────────────────────

function Sheet({ open, onClose, children, label, z = 2000, dim = 0.55 }: {
  open: boolean; onClose?: () => void; children: React.ReactNode; label: string; z?: number; dim?: number;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label}
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
      style={{
        position: "fixed", inset: 0, zIndex: z, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))",
        background: `rgba(6,8,11,${dim})`, backdropFilter: "blur(16px) saturate(1.15)", WebkitBackdropFilter: "blur(16px) saturate(1.15)",
        animation: "gpSheetIn 0.22s ease-out",
      }}>
      <style>{`@keyframes gpSheetIn{from{opacity:0}to{opacity:1}}@keyframes gpCardIn{from{opacity:0;transform:translateY(10px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
      <div style={{
        width: "100%", maxWidth: 380, maxHeight: "100%", overflowY: "auto", borderRadius: 22, padding: "22px 20px 18px",
        background: CARD_BG, border: `1px solid ${CARD_LINE}`, boxShadow: "0 24px 60px rgba(0,0,0,0.45)", color: INK,
        fontFamily: "var(--calm-body, system-ui, sans-serif)", animation: "gpCardIn 0.26s cubic-bezier(0.2,0.8,0.2,1)",
      }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{
    width: "100%", padding: "13px 16px", borderRadius: 14, border: "none", fontSize: 14, fontWeight: 700,
    background: "#cfe3ef", color: "#13222b", opacity: disabled ? 0.5 : 1,
  }}>{children}</button>;
}

function QuietButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{
    width: "100%", padding: "12px 16px", borderRadius: 14, fontSize: 14, fontWeight: 600, marginTop: 8,
    background: "transparent", color: SOFT, border: `1px solid ${CARD_LINE}`,
  }}>{children}</button>;
}

function SheetIcon({ children, tint = "rgba(171,200,219,0.14)", color = "#abc8db" }: { children: React.ReactNode; tint?: string; color?: string }) {
  return <div style={{ width: 48, height: 48, borderRadius: 16, display: "grid", placeItems: "center", background: tint, color, marginBottom: 14 }}>{children}</div>;
}

// ── Plans screens: why ads are off ──────────────────────────────────────────

export function AdsDownNote() {
  const cfg = useConfig();
  if (cfg.ads.available || !cfg.ads.message) return null;
  return <div role="status" data-testid="ads-down-note" style={{
    display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, fontSize: 13, lineHeight: 1.5,
    background: "var(--calm-warning-bg, rgba(240,196,120,0.10))", border: "1px solid var(--calm-warning, rgba(240,196,120,0.45))",
    color: "var(--calm-ink, #eef2f3)",
  }}>
    <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1.3 }}>⚠️</span>
    <span>{cfg.ads.message}</span>
  </div>;
}

// ── The ad button while ads are off: visible, never tappable ───────────────

export function DisabledAdButton({ rewardSeconds }: { rewardSeconds: number }) {
  return <button disabled data-testid="watch-ad-button-disabled" aria-disabled="true"
    className="w-full rounded-xl text-sm font-semibold flex flex-col items-center justify-center"
    style={{
      padding: "10px 8px", minHeight: 58, cursor: "not-allowed", opacity: 0.42,
      background: "rgba(79,134,198,0.08)", border: "1px dashed rgba(79,134,198,0.35)", color: ACCENT,
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
        background: "rgba(103,178,138,0.16)", border: "1px solid rgba(103,178,138,0.45)", color: GOOD,
      }}>
      <span className="flex items-center gap-1.5">{phase === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />} Get free time</span>
      <small style={{ fontSize: 11, fontWeight: 500, marginTop: 2 }}>
        {!online ? "Needs internet" : tooMuch ? `Opens under ${minutesShort(ft.belowSeconds)} left` : `+${minutesShort(ft.seconds)} · ${ft.perDay} a day`}
      </small>
    </button>

    <Sheet open={phase !== "idle"} onClose={phase === "loading" ? undefined : close} label={ft.title}>
      <SheetIcon tint="rgba(103,178,138,0.16)" color="#a7cfb6">{phase === "loading" ? <Loader2 size={22} className="animate-spin" /> : <Gift size={22} />}</SheetIcon>
      <h2 style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.25, fontFamily: "var(--calm-display, system-ui, sans-serif)" }}>{ft.title}</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, color: SOFT, marginTop: 8 }}>{ft.body}</p>
      <div role="status" style={{
        marginTop: 14, padding: "11px 13px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.45,
        background: phase === "error" ? "rgba(255,171,166,0.10)" : "rgba(255,255,255,0.05)",
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
      background: "var(--calm-tint, rgba(171,200,219,0.10))", border: "1px solid var(--calm-line, rgba(255,255,255,0.10))",
      color: "var(--calm-ink, #eef2f3)", marginBottom: 14,
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
  return <Sheet open label="Update required" z={2147483000} dim={0.5}>
    <div data-testid="kill-screen" style={{ textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <SheetIcon tint="rgba(207,227,239,0.14)" color="#cfe3ef"><RefreshCw size={22} /></SheetIcon>
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

// ── Rate the app ────────────────────────────────────────────────────────────

function RateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => { if (open) { setStars(0); setNote(""); setSent(false); } }, [open]);
  const send = () => {
    if (!stars) return;
    submitRating(stars, Date.now(), note);     // queued offline, delivered to the portal's App ratings
    markFeedbackSent();
    setSent(true);
  };
  return <Sheet open={open} onClose={onClose} label="Rate GamepadOS">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <SheetIcon tint="rgba(240,196,120,0.14)" color="#f0c478"><Star size={22} /></SheetIcon>
      <button aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", color: SOFT, padding: 4 }}><X size={18} /></button>
    </div>
    {sent ? <>
      <h2 style={{ fontSize: 19, fontWeight: 700 }}>Thank you!</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, color: SOFT, marginTop: 8 }}>We read every rating. It helps us make GamepadOS better.</p>
      <div style={{ marginTop: 16 }}><PrimaryButton onClick={onClose}>Done</PrimaryButton></div>
    </> : <>
      <h2 style={{ fontSize: 19, fontWeight: 700 }}>How is GamepadOS for you?</h2>
      <div role="radiogroup" aria-label="Your rating" style={{ display: "flex", gap: 6, justifyContent: "center", margin: "16px 0 12px" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)}
            data-testid={`rate-star-${n}`}
            style={{ background: "none", border: "none", padding: 4, color: n <= stars ? "#f0c478" : "rgba(255,255,255,0.25)" }}>
            <Star size={32} fill={n <= stars ? "#f0c478" : "none"} />
          </button>
        ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={3}
        placeholder={stars && stars <= 3 ? "What should we fix? (optional)" : "Anything you'd like to tell us? (optional)"}
        style={{ width: "100%", borderRadius: 12, padding: "10px 12px", fontSize: 14, resize: "none",
          background: "rgba(255,255,255,0.05)", border: `1px solid ${CARD_LINE}`, color: INK, outline: "none" }} />
      <div style={{ marginTop: 14 }}><PrimaryButton onClick={send} disabled={!stars}>Send rating</PrimaryButton></div>
    </>}
  </Sheet>;
}

/** Account tab: a small card. */
export function RateAppCard() {
  const [open, setOpen] = useState(false);
  return <>
    <div data-testid="rate-app-card" style={{
      display: "flex", alignItems: "center", gap: 12, padding: "14px 14px", borderRadius: 16,
      background: "var(--calm-surface, rgba(255,255,255,0.04))", border: "1px solid var(--calm-line, rgba(255,255,255,0.10))",
    }}>
      <Star size={18} aria-hidden="true" style={{ color: "#f0c478", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--calm-ink, #eef2f3)" }}>Enjoying GamepadOS?</div>
        <div style={{ fontSize: 12, color: MUTED }}>Rate the app and tell us what to improve.</div>
      </div>
      <button onClick={() => setOpen(true)} data-testid="rate-app-button" style={{
        padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 600, flex: "none",
        background: "transparent", color: ACCENT, border: "1px solid var(--calm-line, rgba(255,255,255,0.16))",
      }}>Rate</button>
    </div>
    <RateSheet open={open} onClose={() => setOpen(false)} />
  </>;
}

/** Under the ad buttons: one quiet link. */
export function RateAppLink() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)} data-testid="rate-app-link"
      className="text-xs mt-2 w-full text-center" style={{ color: MUTED, background: "none", border: "none" }}>
      ★ Rate the app
    </button>
    <RateSheet open={open} onClose={() => setOpen(false)} />
  </>;
}
