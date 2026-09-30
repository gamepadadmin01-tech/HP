import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Clock, ArrowLeft, CloudOff } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { getPlans, type Catalogue, type PlanCode } from "../api/billing";
import { getAppInfo } from "../platform/native";
import { getSession, onSessionChange } from "../store/account";
import { guestTrial } from "../store/guestTrial";
import { formatDuration } from "../store/billing";
import { getPlaytimeState, onPlaytimeChange } from "../store/playtime";
import { AccountAuth } from "./AccountAuth";
import { PlanCard } from "./PlanPanel";
import { AdRewardButton } from "./AdRewardButton";
import { getAdState, onAdChange } from "../store/rewardedAd";

/** Kept mounted across sign-in so the selected plan is not lost at checkout. */
export function GuestPlans() {
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState<PlanCode | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const reduced = useReducedMotion();
  // Re-render when an ad lands: the phone's clock (guestTrial) just grew.
  useSyncExternalStore(onAdChange, getAdState, getAdState);
  const playComingSoon = getAppInfo().channel === "playstore";
  useEffect(() => {
    if (playComingSoon) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError("");
    getPlans(getAppInfo().channel || "direct").then(value => {
      if (!cancelled) setCatalogue(value);
    }).catch(() => {
      if (!cancelled) setError("Plans could not load. Your free trial still works offline.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt, session?.token, playComingSoon]);

  if (session && !selected) return null;
  const trial = guestTrial();
  const expired = trial.remainingSeconds <= 0;
  const offers = catalogue?.plans.filter(p => p.code !== "FREE" && p.purchasable) || [];
  const chosen = offers.find(p => p.code === selected);

  if (playComingSoon) return <section className="guest-plans space-y-4">
    <div className="guest-trial-summary"><Clock size={22} aria-hidden="true" /><div>
      <h2 className="text-lg font-semibold calm-ink">30 minutes, every day</h2>
      <p className="text-sm mt-1 calm-muted">{expired ? "Today's free time is used. Watch an ad for 30 more minutes, or come back after midnight." : `${formatDuration(trial.remainingSeconds)} to play. No sign-in needed.`}</p>
    </div></div>
    {/* Play build: rewarded ads are the ONLY way to more time -- no plans, no
        Lifetime, no link to buy on the website (owner's decision, 2026-09-30). */}
    <div className="flex justify-center"><AdRewardButton /></div>
  </section>;

  return <section className="guest-plans space-y-4">
    <div className="guest-trial-summary">
      <Clock size={22} aria-hidden="true" />
      <div>
        <h2 className="text-lg font-semibold calm-ink">{selected ? "Your selected plan" : expired ? "Keep playing your way" : "30 minutes, every day"}</h2>
        <p className="text-sm mt-1 calm-muted">
          {selected ? chosen?.displayName || "Choose a plan below"
            : expired ? "Today's free time is used. Watch an ad for 30 more minutes, choose a plan, or return after midnight."
            : `${formatDuration(trial.remainingSeconds)} to play. No sign-in needed.`}
        </p>
      </div>
    </div>
    {!selected && <div className="flex justify-center"><AdRewardButton /></div>}
    {selected && <button className="guest-back" onClick={() => setSelected(null)}>
      <ArrowLeft size={16} /> Back to plans
    </button>}
    {selected && !session ? <div className="guest-checkout">
      <p className="mb-4 text-sm calm-muted">Sign in to attach this purchase to your account. You can review the plan again before paying.</p>
      <AccountAuth />
    </div> : <>
      {loading ? <div className="console-plans-loading" role="status" aria-label="Loading plans" data-testid="plans-loading"><motion.div animate={reduced ? {} : { opacity: [.4, 1, .4] }} transition={{ duration: 1.4, repeat: Infinity }}><i /><i /></motion.div><motion.div animate={reduced ? {} : { opacity: [.4, 1, .4] }} transition={{ duration: 1.4, repeat: Infinity, delay: .2 }}><i /><i /></motion.div></div>
        : error ? <motion.div className="console-plans-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><CloudOff size={26} /><p role="status" className="text-sm calm-muted">{error}</p><button data-testid="plans-retry-button" className="guest-back mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button></motion.div>
        : catalogue?.purchasable ? <div className="space-y-3">
          {(selected && chosen ? [chosen] : offers).map(plan => <PlanCard key={plan.code} plan={plan}
            onChoose={session ? undefined : p => setSelected(p.code)} />)}
          {offers.length === 0 && <p className="text-sm calm-muted">No plans are available for purchase right now.</p>}
          <p className="text-xs calm-muted">{session ? "Payment is confirmed before access is added." : "Compare first. Sign in only when you choose to buy."}</p>
        </div> : <p className="text-sm calm-muted">Purchases are not available in this build. Your daily free trial is available here.</p>}
    </>}
  </section>;
}

/** Only this small readout renders on each clock tick, never the pad SVG. */
export function GuestTrialPill({ onPlans }: { onPlans: () => void }) {
  const state = useSyncExternalStore(onPlaytimeChange, getPlaytimeState, getPlaytimeState);
  return <button data-nx="1" onClick={onPlans} className="guest-trial-pill"
    aria-label="View subscription plans">
    <Clock size={12} /> {formatDuration(state.remainingSeconds ?? 1800)} free · Plans
  </button>;
}
