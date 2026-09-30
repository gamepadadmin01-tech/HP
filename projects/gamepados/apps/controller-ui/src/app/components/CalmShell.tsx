import React, { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Clock3, Monitor, Moon, Sun, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { KEYS, readString, writeString } from "../store/storage";
import { linkHint, linkState, type LinkTelemetry } from "../linkState";
import { guestTrial } from "../store/guestTrial";
import { formatDuration } from "../store/billing";
import { getSession, onSessionChange } from "../store/account";
import { requestDashboardTab } from "../store/navIntent";

type Appearance = "light" | "dark";
const themeEvent = "gp-shell-appearance";
const readAppearance = (): Appearance => readString(KEYS.shellAppearance, "dark") === "light" ? "light" : "dark";

/** This preference belongs to the surrounding screens, never the gameplay UI. */
export function useShellAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  useEffect(() => {
    const update = () => setAppearance(readAppearance());
    window.addEventListener(themeEvent, update);
    return () => window.removeEventListener(themeEvent, update);
  }, []);
  const toggle = () => {
    const next = appearance === "dark" ? "light" : "dark";
    writeString(KEYS.shellAppearance, next);
    setAppearance(next);
    window.dispatchEvent(new Event(themeEvent));
  };
  return { appearance, toggle };
}

export function CalmBrand() {
  return <div className="calm-brand" data-testid="app-brand"><span className="calm-mark" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M4 4h7v4H8v8h8v-3h-4V9h8v11H4V4Z" fill="currentColor"/><path d="M15 4h5v3h-5z" fill="currentColor"/></svg></span><span>gamepad<span className="console-brand-os">os</span><span className="console-brand-dot">.</span></span></div>;
}

export function AppearanceButton({ appearance, onClick }: { appearance: Appearance; onClick: () => void }) {
  const reduced = useReducedMotion();
  return <motion.button data-no-shell-press data-testid="appearance-toggle-button" whileTap={reduced ? undefined : { rotate: 35, scale: .9 }} className="calm-icon-button" onClick={onClick}
    aria-label={`Use ${appearance === "dark" ? "light" : "dark"} appearance`}>
    {appearance === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
  </motion.button>;
}

export function connectionName(telemetry?: LinkTelemetry | null) {
  if (telemetry?.connectionType === "usbdebug") return "USB debugging";
  if (telemetry?.connectionType === "wired") return "USB tethering";
  if (telemetry?.connectionType === "wireless") return "Wi-Fi";
  return "PC connection";
}

/** Preserve all four real link states; transmitting is not proof of a reply. */
export function ConnectionSummary({ telemetry, onClick }: { telemetry?: LinkTelemetry | null; onClick?: () => void }) {
  const reduced = useReducedMotion();
  const descriptionId = React.useId();
  const state = linkState(telemetry);
  const title = state === "connected" ? "You’re connected" : state === "no-reply" ? "PC not replying"
    : state === "stalled" ? "Connection interrupted" : "No PC connected";
  const detail = state === "connected" ? `${connectionName(telemetry)} · Ready to play`
    : state === "off" ? "Pair up. Power on." : linkHint(state);
  const Icon = state === "off" ? Monitor : telemetry?.connectionType === "wireless" ? Wifi : Monitor;
  if (onClick) return <div className="console-connect-entry" data-link-state={state}>
    <motion.button type="button" data-no-shell-press data-testid="connect-pc-button"
      className="console-connect-button" onClick={onClick} aria-describedby={descriptionId}
      whileTap={reduced ? undefined : { scale: .985, y: 1 }}
      transition={{ duration: reduced ? 0 : .12, ease: [.2, .8, .2, 1] }}>
      <Monitor size={21} aria-hidden="true" />
      <span>{state === 'connected' ? 'Manage PC connection' : 'Connect to PC'}</span>
      <ArrowRight size={19} aria-hidden="true" />
    </motion.button>
    <p id={descriptionId} data-testid="connect-pc-status" className="console-connect-status" role="status">
      <span className="console-connect-status-dot" aria-hidden="true" />
      <span>{state === 'off' ? 'No PC connected · Wi-Fi or USB' : <>{title}<span className="console-connect-detail">{detail}</span></>}</span>
    </p>
  </div>;
  const body = <><span className="calm-connection-icon"><Icon size={21} aria-hidden="true" /></span>
    <span className="calm-grow"><strong>{title}</strong><small>{detail}</small></span></>;
  return <div className="calm-connection" data-link-state={state} role="status">{body}</div>;
}

export function DashboardAllowance() {
  const [session, setSession] = useState(getSession);
  const [remaining, setRemaining] = useState(() => guestTrial().remainingSeconds);
  useEffect(() => onSessionChange(() => setSession(getSession())), []);
  useEffect(() => {
    if (session) return;
    // No gameplay clock is started here. Refresh on resume/focus only.
    const update = () => setRemaining(guestTrial().remainingSeconds);
    const timer = window.setInterval(update, 30000);
    const visible = () => { if (!document.hidden) update(); };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", visible); };
  }, [session]);
  return <div className="calm-allowance" data-testid="daily-allowance">
    <span className="console-allowance-icon"><Clock3 size={20} aria-hidden="true" /></span>
    <div className="calm-grow"><span className="console-eyebrow">{session ? "YOUR MEMBERSHIP" : "YOUR PLAY TIME"}</span>
      <strong>{session ? "Your plan & playtime" : remaining > 0 ? <><span data-testid="remaining-playtime">{formatDuration(remaining)}</span> <small>left</small></> : "Watch an ad for 30 minutes"}</strong>
    </div>
    <button data-testid="view-plans-button" onClick={() => requestDashboardTab("account")} aria-label={session ? "View account" : "View plans"}><ChevronRight size={19} /></button>
  </div>;
}
