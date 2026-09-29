// ─── "Watch an ad · +30 min" ──────────────────────────────────────────────────
//
// One button, used on the out-of-time screen, the guest plans screen and the
// signed-in plan panel. Renders nothing in builds without ads, for Lifetime,
// and until the plan is known — see canShowAdButton in store/rewardedAd.ts.
// Under it: what the player has saved from ads, or the result of the last ad.

import React, { useEffect, useSyncExternalStore } from "react";
import { PlayCircle, Loader2 } from "lucide-react";
import { getSession, onSessionChange } from "../store/account";
import { getBillingState, onBillingChange, formatDuration } from "../store/billing";
import { guestTrial } from "../store/guestTrial";
import { canShowAdButton, getAdState, onAdChange, onAdCredited, watchAd } from "../store/rewardedAd";
import { adPrivacyOptionsRequired, preloadRewardedAd, showAdPrivacyOptions } from "../platform/native";

const ACCENT = "var(--calm-accent, #abc8db)";
const MUTED = "var(--calm-muted, #a6b0b3)";
const GOOD = "var(--calm-good, #a7cfb6)";
const DANGER = "var(--calm-error, #ffaba6)";

export function AdRewardButton({ onCredited }: { onCredited?: () => void }) {
  const ad = useSyncExternalStore(onAdChange, getAdState, getAdState);
  const billing = useSyncExternalStore(onBillingChange, getBillingState, getBillingState);
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);

  useEffect(() => { preloadRewardedAd(); }, []);
  useEffect(() => (onCredited ? onAdCredited(onCredited) : undefined), [onCredited]);

  if (!canShowAdButton()) return null;

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
        {busy ? ad.message : "Watch an ad · +30 min"}
      </button>
      <p role="status" className="text-xs mt-2 text-center"
        style={{ color: note ? (ad.phase === "error" ? DANGER : GOOD) : MUTED }}>
        {note
          || (bank > 0
            ? `Saved from ads: ${formatDuration(bank)} · never expires`
            : "Optional. Each ad adds 30 minutes that never expire.")}
      </p>
      {adPrivacyOptionsRequired() && (
        <button className="text-xs mt-1 w-full text-center underline" style={{ color: MUTED }}
          onClick={() => showAdPrivacyOptions()}>
          Ad privacy choices
        </button>
      )}
    </div>
  );
}
