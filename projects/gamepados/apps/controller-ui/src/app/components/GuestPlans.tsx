import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Clock, ArrowLeft, CloudOff } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { getPlans, type Catalogue, type PlanCode } from "../api/billing";
import { getAppInfo } from "../platform/native";
import { getSession, onSessionChange } from "../store/account";
import { guestTrial } from "../store/guestTrial";
import { formatDuration } from "../store/billing";
import { AccountAuth } from "./AccountAuth";
import { PlanCard } from "./PlanPanel";
import { getAdState, onAdChange } from "../store/rewardedAd";
import { getAppConfig, onAppConfigChange, outOfTimeText } from "../store/appConfig";
import { FreeCard, FreeDivider, freePlayAvailable } from "./FreePlay";

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
  useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);   // ads on/off and the time rules
  const playComingSoon = getAppInfo().channel === "playstore";
  useEffect(() => {
    if (playComingSoon) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError("");
    getPlans(getAppInfo().channel || "direct").then(value => {
      if (!cancelled) setCatalogue(value);
    }).catch(() => {
      if (!cancelled) setError("Plans could not load. Your play time still works offline.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt, session?.token, playComingSoon]);

  if (session && !selected) return null;
  const trial = guestTrial();
  const expired = trial.remainingSeconds <= 0;
  const offers = catalogue?.plans.filter(p => p.code !== "FREE" && p.purchasable) || [];
  const chosen = offers.find(p => p.code === selected);

  // The Plans page order (owner, 2026-10-26): what you have, then Lifetime as the one big
  // choice, then "or keep playing free" with everything about free time in one card. Sign-in
  // and Support follow in TabAccount.
  const status = <div className="guest-status" data-testid="guest-status">
    <Clock size={16} aria-hidden="true" />
    <span>{expired
      ? outOfTimeText({ guest: true, playstore: playComingSoon })
      : <><b>{formatDuration(trial.remainingSeconds)} left</b> · No sign-in needed</>}</span>
  </div>;

  // Play build: rewarded ads are the ONLY way to more time -- no plans, no
  // Lifetime, no link to buy on the website (owner's decision, 2026-09-30).
  if (playComingSoon) return <section className="guest-plans space-y-3">
    {status}
    <FreeCard />
  </section>;

  if (selected) return <section className="guest-plans space-y-3">
    <button className="guest-back" onClick={() => setSelected(null)}>
      <ArrowLeft size={16} /> Back to plans
    </button>
    {!session ? <div className="guest-checkout">
      <p className="mb-4 text-sm calm-muted">Sign in to attach this purchase to your account. You can review the plan again before paying.</p>
      <AccountAuth />
    </div> : chosen ? <div className="space-y-3">
      <PlanCard plan={chosen} />
      <p className="text-xs calm-muted">Payment is confirmed before access is added.</p>
    </div> : null}
  </section>;

  const plans = loading
    ? <div className="console-plans-loading" role="status" aria-label="Loading plans" data-testid="plans-loading"><motion.div animate={reduced ? {} : { opacity: [.4, 1, .4] }} transition={{ duration: 1.4, repeat: Infinity }}><i /><i /></motion.div></div>
    : error
      ? <motion.div className="console-plans-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><CloudOff size={26} /><p role="status" className="text-sm calm-muted">{error}</p><button data-testid="plans-retry-button" className="guest-back mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button></motion.div>
      : catalogue?.purchasable && offers.length
        ? <div className="space-y-2">
          {offers.map(plan => <PlanCard key={plan.code} plan={plan} onChoose={p => setSelected(p.code)} />)}
          <p className="text-xs calm-muted">Compare first. Sign in only when you choose to buy.</p>
        </div>
        : null;

  return <section className="guest-plans space-y-3">
    {status}
    {plans}
    {plans && freePlayAvailable() && <FreeDivider />}
    <FreeCard />
  </section>;
}

// (GuestTrialPill was removed on 2026-09-30: PlaytimeChip replaced it on the
// controller. Its CSS class, .guest-trial-pill, is still used by the chip.)
