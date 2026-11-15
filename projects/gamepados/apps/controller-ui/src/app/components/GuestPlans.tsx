import { useEffect, useState, useSyncExternalStore } from "react";
import { Clock, CloudOff } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { getPlans, type Catalogue } from "../api/billing";
import { getAppInfo, playSellsNothing } from "../platform/native";
import { getSession, onSessionChange } from "../store/account";
import { guestTrial } from "../store/guestTrial";
import { formatDuration } from "../store/billing";
import { requestSignIn } from "../store/navIntent";
import { GooglePlayCard, PlanCard } from "./PlanPanel";
import { getAdState, onAdChange } from "../store/rewardedAd";
import { getAppConfig, onAppConfigChange, outOfTimeText } from "../store/appConfig";
import { FreeCard, FreeDivider, freePlayAvailable } from "./FreePlay";

/** The plans a signed-out player sees. Choosing one opens the app's sign-in page (owner, 2026-11-08: the same
 *  page as the account button, instead of a second sign-in form inside Plans); after signing in the player lands
 *  on Account, where the same plan card buys it. */
export function GuestPlans() {
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const reduced = useReducedMotion();
  // Re-render when an ad lands: the phone's clock (guestTrial) just grew.
  useSyncExternalStore(onAdChange, getAdState, getAdState);
  useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);   // ads on/off and the time rules
  const playComingSoon = playSellsNothing();   // only a Play build WITHOUT billing hides the plans
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

  if (session) return null;
  const trial = guestTrial();
  const expired = trial.remainingSeconds <= 0;
  const offers = catalogue?.plans.filter(p => p.code !== "FREE" && p.purchasable) || [];

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


  const plans = loading
    ? <div className="console-plans-loading" role="status" aria-label="Loading plans" data-testid="plans-loading"><motion.div animate={reduced ? {} : { opacity: [.4, 1, .4] }} transition={{ duration: 1.4, repeat: Infinity }}><i /><i /></motion.div></div>
    : error
      ? <motion.div className="console-plans-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><CloudOff size={26} /><p role="status" className="text-sm calm-muted">{error}</p><button data-testid="plans-retry-button" className="guest-back mt-2" onClick={() => setAttempt(a => a + 1)}>Try again</button></motion.div>
      : catalogue?.buyOnGooglePlay
        ? <GooglePlayCard url={catalogue.playStoreUrl} guest />
      : catalogue?.purchasable && offers.length
        ? <div className="space-y-2">
          {offers.map(plan => <PlanCard key={plan.code} plan={plan} onChoose={() => requestSignIn()} />)}
        </div>
        : null;

  return <section className="guest-plans space-y-3">
    {status}
    {plans}
    {plans && freePlayAvailable() && <FreeDivider />}
    <FreeCard />
  </section>;
}
