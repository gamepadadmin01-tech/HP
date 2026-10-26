// ─── "Or keep playing free" ───────────────────────────────────────────────────
//
// The Plans page has one order (owner, 2026-10-26): what you have → Lifetime, the one big
// choice → this divider → one card holding everything about free time (the ads message, the
// ad button, and while ads are off the "Get free time" button) → sign-in and Support last.
// Builds without ads have no free card at all, so callers check freePlayAvailable() first.

import React from "react";
import { adsSupported } from "../platform/native";
import { AdRewardButton } from "./AdRewardButton";
import { AdsDownNote } from "./AppControl";

/** Does this build have a free way to more time (rewarded ads)? */
export function freePlayAvailable(): boolean {
  return adsSupported();
}

export function FreeDivider() {
  return <div className="calm-free-divider" role="separator"><span>or keep playing free</span></div>;
}

export function FreeCard({ onCredited, onSignIn }: { onCredited?: () => void; onSignIn?: () => void }) {
  if (!freePlayAvailable()) return null;
  return <div className="calm-free-card" data-testid="free-card">
    <AdsDownNote />
    <div className="flex justify-center"><AdRewardButton onCredited={onCredited} onSignIn={onSignIn} /></div>
  </div>;
}
