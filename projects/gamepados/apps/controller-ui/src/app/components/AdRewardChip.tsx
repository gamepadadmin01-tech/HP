// ─── "Watch an ad · +30 min" beside the play-time card (owner, 2026-11-02) ────
//
// The Play tab's play-time card ("YOUR PLAY TIME" / "YOUR MEMBERSHIP") now has the ad button right next to
// it, so a player who is low on time does not have to open the Plans tab to earn more. Same rules as the
// full button on the Plans tab (AdRewardButton): it only exists where ads exist and work, only while the
// player holds under the cap, never for Lifetime, and the server (or the phone, for a guest) does the crediting.
//
// Lives in its own file, not in AdRewardButton, because CalmShell imports it and AdRewardButton pulls in
// AppControl, which imports CalmShell: that would be an import loop.

import React, { useEffect, useSyncExternalStore } from "react";
import { PlayCircle, Loader2 } from "lucide-react";
import { getSession, onSessionChange } from "../store/account";
import { getBillingState, onBillingChange, refresh } from "../store/billing";
import { canShowAdButton, getAdState, onAdChange, watchAd } from "../store/rewardedAd";
import { adsSupported, preloadRewardedAd } from "../platform/native";
import { getAppConfig, onAppConfigChange, ruleWords } from "../store/appConfig";

/** The button. Renders nothing when there is nothing to watch for. */
export function AdRewardChip() {
  const ad = useSyncExternalStore(onAdChange, getAdState, getAdState);
  const billing = useSyncExternalStore(onBillingChange, getBillingState, getBillingState);
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  const cfg = useSyncExternalStore(onAppConfigChange, getAppConfig, getAppConfig);
  const words = ruleWords();
  const usable = adsSupported() && cfg.ads.available;

  // Warm an ad so the tap is instant (the Plans tab does the same for its button).
  useEffect(() => { if (usable) preloadRewardedAd(); }, [usable]);
  // A signed-in player's plan is only known once /billing/me has been read; the Play tab never reads it
  // on its own, so ask once, or the button could never appear for them.
  useEffect(() => {
    if (usable && session && !billing.entitlement && billing.status !== "loading") void refresh();
  }, [usable, session]);                                       // eslint-disable-line react-hooks/exhaustive-deps

  if (!usable || !canShowAdButton()) return null;
  const busy = ad.phase === "loading" || ad.phase === "crediting";
  return (
    <button type="button" className="calm-ad-chip" data-testid="watch-ad-chip" disabled={busy}
      onClick={() => { watchAd(); }} aria-label={`Watch an ad for ${words.reward} more play time`}>
      {busy ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <PlayCircle size={20} aria-hidden="true" />}
      <span className="calm-ad-chip-main">{busy ? "Loading…" : "Watch an ad"}</span>
      <span className="calm-ad-chip-sub">+{words.rewardShort}</span>
    </button>
  );
}

/** What the last ad did ("+30 minutes added", or why not), under the card. Only while there is something to say. */
export function AdRewardStatus() {
  const ad = useSyncExternalStore(onAdChange, getAdState, getAdState);
  if (ad.phase !== "done" && ad.phase !== "error") return null;
  return (
    <p role="status" className="calm-ad-status" data-phase={ad.phase} data-testid="watch-ad-status">{ad.message}</p>
  );
}
