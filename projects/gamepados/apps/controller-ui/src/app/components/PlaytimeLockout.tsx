// ─── Out of playtime ──────────────────────────────────────────────────────────
//
// Replaces the fake lockout that used to live in Dialogs.tsx, whose "upgrade"
// button was a client-side boolean and whose other button granted 35 minutes for
// watching an ad that did not exist. There are no ads in this product and the
// client cannot grant anything.
//
// What this says is deliberately short. The user came here to play and cannot;
// the useful information is when they can again, and that there is a way out.
// Everything else is in the Account tab, one tap behind the button.

import React from "react";
import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import { formatResetsAt } from "../store/billing";
import { requestDashboardTab } from "../store/navIntent";

const MUTED = "#7C8AA0";
const ACCENT = "#5D90CB";

export function PlaytimeLockout({
  message,
  resetsAt,
  onBack,
}: {
  message: string;
  resetsAt: string | null;
  onBack: () => void;
}) {
  const resets = resetsAt ? formatResetsAt(resetsAt) : "";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 flex flex-col items-center justify-center px-8"
      // Above the pad, below nothing. The controller underneath has already
      // stopped streaming — this is not what stops it, and must not be the only
      // thing standing between a spent quota and input reaching the PC.
      style={{ zIndex: 40, background: "rgba(4,6,12,0.97)" }}
    >
      <div className="p-3.5 rounded-2xl mb-5"
        style={{ background: "rgba(79,134,198,0.10)", color: ACCENT }}>
        <Clock size={26} />
      </div>

      <h2 className="text-lg font-bold text-white text-center"
        style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
        That&rsquo;s your time for today
      </h2>

      <p className="text-sm text-center mt-2 max-w-xs leading-relaxed" style={{ color: MUTED }}>
        {message || "You're out of time — upgrade to play more, or wait for your next quota."}
      </p>

      {resets && (
        <p className="text-xs mt-3" style={{ color: ACCENT }}>{resets}</p>
      )}

      {/* Ask for the Account tab BEFORE leaving. onBack() alone returns to
          whichever tab was last open -- almost always Home -- which is why this
          button looked like it did nothing at all. */}
      <button
        onClick={() => { requestDashboardTab("account"); onBack(); }}
        className="mt-7 w-full max-w-xs py-3.5 rounded-xl text-sm font-semibold"
        style={{
          background: "rgba(79,134,198,0.14)",
          border: "1px solid rgba(79,134,198,0.35)",
          color: ACCENT,
        }}
      >
        See plans in Account
      </button>
    </motion.div>
  );
}
