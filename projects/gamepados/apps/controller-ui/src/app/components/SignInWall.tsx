// ─── Sign in to play ────────────────────────────────────────────────────────
//
// The real bug this closes: a fresh install could open the controller and
// send real input to a PC with no account at all — playtime was never
// tracked, quota never applied, because nothing checked for a session before
// letting the pad stream. BILLING_DECISIONS §2.3 always intended sign-in to
// be required to play; the code never actually enforced it (see the removed
// comment in store/playtime.ts, which explicitly left this off pending a
// warning release — 1.4.0's launch banner is that release).
//
// Two rules this follows, matching how PlaytimeLockout enforces the quota:
//
//   1. THIS COMPONENT IS NOT THE ENFORCEMENT. It's what the user sees. The
//      real gate is in App.tsx's streaming effect — `isActive && !outOfTime
//      && hasSession` — which is what actually decides whether a packet ever
//      leaves the phone. A dialog that fails to render, or that a user finds
//      a way to dismiss, must never be the only thing stopping input. Even if
//      this file vanished entirely, a signed-out user still could not play;
//      they would just see a bare black screen instead of an explanation.
//
//   2. NO WAY OUT except signing in. Every other overlay in this app has a
//      dismiss or a "back" button; this one deliberately does not, because
//      the whole point is that there is no play-without-an-account path
//      anymore. The Android system back gesture still works — it returns to
//      Home, which stays open on purpose (browsing, pad editing and PC
//      pairing are not gated, only PLAY is) — but nothing inside this
//      component itself offers a way to proceed without an account.
//
// AccountAuth is the existing sign-in/create/verify/forgot/reset flow —
// complete, working, and never mounted anywhere before this. Embedded
// directly rather than linking off to it, so there is no second tap required
// and no route that could be skipped.

import React from "react";
import { motion } from "framer-motion";
import { AccountAuth } from "./AccountAuth";

export function SignInWall() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 overflow-y-auto"
      // z-index above the pad and above PlaytimeToast/PlaytimeLockout's own
      // z-40 — signed-out is checked first, so if this is showing, the quota
      // question has not even come up yet.
      style={{ zIndex: 45, background: "rgba(4,6,12,0.97)" }}
    >
      <div className="min-h-full flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-xs">
          <AccountAuth />
        </div>
      </div>
    </motion.div>
  );
}
