// ─── "15 minutes left" ────────────────────────────────────────────────────────
//
// A countdown warning that must not cost the user a single frame of input.
//
// Three rules it follows, all of them about staying out of the way:
//
//   1. IT SUBSCRIBES TO THE STORE ITSELF. If ControllerScreen held this state,
//      every warning would re-render the whole pad SVG mid-game. Owning its own
//      subscription means only this ~30-node subtree re-renders, and only when
//      a warning actually appears or clears.
//
//   2. IT READS A PRIMITIVE. getPlaytimeAlert() returns a short string, so the
//      once-a-second emit from the playtime clock resolves to the same value
//      and React bails out before touching the DOM at all.
//
//   3. IT CANNOT BE TOUCHED. pointer-events: none, so it never swallows a tap
//      meant for a button underneath it, and it is positioned absolutely so it
//      cannot reflow anything. It also animates opacity and transform only --
//      both compositor properties, so it never triggers layout or paint on the
//      pad beneath.
//
// It is deliberately not dismissible: there is nothing to dismiss, it leaves on
// its own after a few seconds, and a close button would be one more thing to
// mis-tap during play.

import React, { useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock } from "lucide-react";
import { getPlaytimeAlert, onPlaytimeChange } from "../store/playtime";

const MINUTES: Record<string, number> = {
  "warn-15": 15,
  "warn-10": 10,
  "warn-5": 5,
};

export function PlaytimeToast() {
  const alert = useSyncExternalStore(onPlaytimeChange, getPlaytimeAlert, getPlaytimeAlert);
  const minutes = MINUTES[alert];

  // The last warning is the urgent one, so it is the only one that gets colour.
  const urgent = minutes === 5;
  const accent = urgent ? "#E2645D" : "#5D90CB";

  return (
    <div
      className="absolute inset-x-0 flex justify-center"
      style={{ top: "max(6px, env(safe-area-inset-top))", zIndex: 30, pointerEvents: "none" }}
    >
      <AnimatePresence>
        {minutes !== undefined && (
          <motion.div
            key={alert}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full"
            style={{
              background: "rgba(10,14,24,0.88)",
              border: `1px solid ${accent}55`,
              // No blur filter: backdrop-filter over a 60fps SVG is the one
              // cheap-looking effect that actually costs frames.
              boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
              willChange: "transform, opacity",
            }}
          >
            <Clock size={13} style={{ color: accent }} />
            <span
              className="text-xs font-semibold tabular-nums"
              style={{ color: "#FFFFFF", fontFamily: "'Space Grotesk',sans-serif" }}
            >
              {minutes} min left
            </span>
            <span className="text-[11px]" style={{ color: "#9AA4B4" }}>
              {urgent ? "wrapping up soon" : "today"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
