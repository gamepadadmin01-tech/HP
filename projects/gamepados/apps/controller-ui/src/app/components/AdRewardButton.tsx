// ─── "Watch an ad · +30 min" ──────────────────────────────────────────────────
//
// One button, used on the out-of-time screen, the guest plans screen and the
// signed-in plan panel. Renders nothing in builds without ads, for Lifetime,
// and until the plan is known — see canShowAdButton in store/rewardedAd.ts.
// Under it: what the player has saved, or the result of the last ad. Hidden,
// with a one-line note instead, once an hour or more is held (2026-09-30).

import React, { useEffect, useSyncExternalStore } from "react";
import { PlayCircle, Loader2 } from "lucide-react";
import { getSession, onSessionChange } from "../store/account";
import { getBillingState, onBillingChange, formatDuration } from "../store/billing";
import { guestTrial } from "../store/guestTrial";
import { adCapReached, canShowAdButton, getAdState, onAdChange, onAdCredited, watchAd } from "../store/rewardedAd";
import { adPrivacyOptionsRequired, adsSupported, preloadRewardedAd, showAdPrivacyOptions } from "../platform/native";
import { getAppConfig, onAppConfigChange, ruleWords } from "../store/appConfig";
import { DisabledAdButton, FreeTimeButton, RateAppLink } from "./AppControl";

const ACCENT = "var(--calm-accent, #abc8db)";
const MUTED = "var(--calm-muted, #a6b0b3)";
const GOOD = "var(--calm-good, #a7cfb6)";
const DANGER = "var(--calm-error, #ffaba6)";

export function AdRewardButton({ onCredited, onSignIn }: { onCredited?: () => void; onSignIn?: () => void }) {
  const ad = useSyncExternalStore(onAdChange, getAdState, getAdState);
  const billing = useSyncExternalStore(onBillingChange, getBillingState, getBillingState);
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  const cfg = useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);
  const words = ruleWords();

  // While ads are switched off nothing is preloaded: there is nothing to load.
  useEffect(() => { if (cfg.ads.available) preloadRewardedAd(); }, [cfg.ads.available]);
  useEffect(() => (onCredited ? onAdCredited(onCredited) : undefined), [onCredited]);

  // Ads switched off at the server (store/appConfig.ts). The ad button stays where players expect
  // it, visibly disabled; guests get "Get free time" beside it. Signed-in players are unlimited
  // while the switch is on, so they see nothing here (also while their plan is still loading).
  if (adsSupported() && !cfg.ads.available) {
    if (session && (billing.entitlement?.unlimited ?? true)) return null;
    return (
      <div className="w-full max-w-xs" data-testid="ads-down-block">
        <div className="grid gap-2" style={{ gridTemplateColumns: session ? "1fr" : "1fr 1fr" }}>
          <DisabledAdButton rewardSeconds={cfg.guest.adRewardSeconds} />
          {!session && <FreeTimeButton onSignIn={onSignIn} />}
        </div>
        <p role="status" className="text-xs mt-2 text-center" style={{ color: ad.phase === "done" ? GOOD : MUTED }}>
          {ad.phase === "done" ? ad.message : "Ads aren't working right now."}
        </p>
        <RateAppLink />
      </div>
    );
  }

  if (!canShowAdButton()) {
    // Over the cap (an hour) held: no button, but say why -- and keep
    // the "+30 minutes added" that pushed them over visible for its moment.
    if (!adCapReached()) return null;
    const done = ad.phase === "done" ? ad.message : "";
    return <p role="status" className="w-full max-w-xs text-xs text-center"
      style={{ color: done ? GOOD : MUTED }}>
      {done || `You have ${words.cap} or more saved. Ads come back when it drops below ${words.cap}.`}
    </p>;
  }

  const bank = session
    ? billing.entitlement?.adTime?.bankSeconds ?? 0
    : guestTrial().bankSeconds ?? 0;
  const busy = ad.phase === "loading" || ad.phase === "crediting";
  const note = ad.phase === "done" || ad.phase === "error" ? ad.message : "";

  return (
    <div className="w-full max-w-xs">
      <button
        data-nx="1"
        data-testid="watch-ad-button"
        disabled={busy}
        onClick={() => { watchAd(); }}
        className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
        style={{
          background: "rgba(79,134,198,0.14)",
          border: "1px solid rgba(79,134,198,0.35)",
          color: ACCENT,
          opacity: busy ? 0.75 : 1,
        }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
        {busy ? ad.message : `Watch an ad · +${words.rewardShort}`}
      </button>
      <p role="status" className="text-xs mt-2 text-center"
        style={{ color: note ? (ad.phase === "error" ? DANGER : GOOD) : MUTED }}>
        {note
          || (bank > 0
            ? `Saved: ${formatDuration(bank)} · never expires`
            : `Optional. Each ad adds ${words.reward} that never expire.`)}
      </p>
      {adPrivacyOptionsRequired() && (
        <button className="text-xs mt-1 w-full text-center underline" style={{ color: MUTED }}
          onClick={() => showAdPrivacyOptions()}>
          Ad privacy choices
        </button>
      )}
      <RateAppLink />
    </div>
  );
}
