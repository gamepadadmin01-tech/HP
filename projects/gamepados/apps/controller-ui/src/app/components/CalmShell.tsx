import React, { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRight, ChevronRight, Clock3, Monitor, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { linkHint, linkState, type LinkTelemetry } from "../linkState";
import { guestTrial } from "../store/guestTrial";
import { formatDuration } from "../store/billing";
import { getSession, onSessionChange } from "../store/account";
import { getAppConfig, onAppConfigChange, ruleWords } from "../store/appConfig";
import { requestDashboardTab } from "../store/navIntent";
import { AdRewardChip, AdRewardStatus } from "./AdRewardChip";

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
      <span>{state === 'off' ? 'No PC connected' : <>{title}<span className="console-connect-detail">{detail}</span></>}</span>
    </p>
  </div>;
  const body = <><span className="calm-connection-icon"><Icon size={21} aria-hidden="true" /></span>
    <span className="calm-grow"><strong>{title}</strong><small>{detail}</small></span></>;
  return <div className="calm-connection" data-link-state={state} role="status">{body}</div>;
}

function AllowanceCard() {
  const [session, setSession] = useState(getSession);
  const [remaining, setRemaining] = useState(() => guestTrial().remainingSeconds);
  const cfg = useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);
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
  // The WHOLE card is the button (it used to be only the small arrow, which was easy to miss).
  // The arrow keeps its test id so the UI tests that click it still reach the same handler.
  return <button type="button" className="calm-allowance" data-testid="daily-allowance" onClick={() => requestDashboardTab("account")}>
    <span className="console-allowance-icon"><Clock3 size={20} aria-hidden="true" /></span>
    <span className="calm-grow"><span className="console-eyebrow">{session ? "Your membership" : "Play time"}</span>
      <strong>{session ? "Your plan & playtime" : remaining > 0 ? <><span data-testid="remaining-playtime">{formatDuration(remaining)}</span></> : !cfg.ads.available ? "Get free time" : `Watch an ad for ${ruleWords().reward}`}</strong>
    </span>
    <span className="sr-only">{session ? "View account" : "View plans"}</span>
    <span className="calm-allowance-go" data-testid="view-plans-button" aria-hidden="true"><ChevronRight size={19} /></span>
  </button>;
}
/** The play-time card with the "Watch an ad +30 min" button right beside it (owner, 2026-11-02), and a line
 *  under both saying what the last ad did. The button only exists where ads exist and work. */
export function DashboardAllowance() {
  return (
    <div className="calm-allowance-block">
      <div className="calm-allowance-row">
        <AllowanceCard />
        <AdRewardChip />
      </div>
      <AdRewardStatus />
    </div>
  );
}
