// Rating prompt — the one popup that appears after a session on the controller.
//
// Lifecycle:
//  • Never forced. The ✕ and the backdrop always dismiss.
//  • Dismissed without rating → returns later, paced by Controller↔Dashboard
//    transitions (recordIntroNav / snoozeIntro).
//  • A submitted rating sets a persisted flag and the feature goes inert — the
//    parent stops rendering it, so its state and timers are torn down.
//
// Two things it deliberately does NOT do:
//  • It never submits on pointer-down. Stars select on click and nothing is sent
//    until Submit is pressed, because a swipe that starts on a star used to fire
//    a permanent 1-star rating.
//  • It never thanks someone for a bad rating. Under 4 stars it asks what went
//    wrong and sends that to support instead of fishing for a store review.
//
// Delivery is feedback.ts, which queues offline and retries on reconnect.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Star, Send } from "lucide-react";
import { submitRating } from "./feedback";

const RATED_KEY = "feature_rated_v2"; // bump the suffix to re-introduce in a future version
const NAV_KEY = "intro_nav_count";
const NEXT_KEY = "intro_next_show";
// Transitions before the first ask. Enough that the user has genuinely played,
// come back, and done it again — asking after one round trip reads as nagging.
const FIRST_SHOW_AT = 4;
// After a dismiss-without-rating, wait this many more transitions before re-asking.
const REPEAT_INTERVAL = 6;

const ACCENT = "#5D90CB";
const STAR_ON = "#F5C451";
const PANEL = "#151A23";
const SUNK = "#10141C";
const MUTED = "#7C8AA0";

/** True once the user has submitted a rating — the feature is then permanently off. */
export function introRated(): boolean {
  try {
    return localStorage.getItem(RATED_KEY) === "1";
  } catch {
    return false;
  }
}

function markRated() {
  try {
    localStorage.setItem(RATED_KEY, "1");
    localStorage.removeItem(NAV_KEY);
    localStorage.removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
}

function readInt(key: string, dflt: number): number {
  try {
    const v = localStorage.getItem(key);
    const n = v == null ? dflt : parseInt(v, 10);
    return Number.isFinite(n) ? n : dflt;
  } catch {
    return dflt;
  }
}

/**
 * Record one Controller↔Dashboard transition and report whether the overlay
 * should now be shown. No-op (returns false) once the user has rated.
 */
export function recordIntroNav(): boolean {
  if (introRated()) return false;
  const count = readInt(NAV_KEY, 0) + 1;
  const nextShow = readInt(NEXT_KEY, FIRST_SHOW_AT);
  try {
    localStorage.setItem(NAV_KEY, String(count));
  } catch {
    /* ignore */
  }
  return count >= nextShow;
}

/** Push the next appearance out after a dismiss-without-rating. */
function snoozeIntro() {
  const count = readInt(NAV_KEY, 0);
  try {
    localStorage.setItem(NEXT_KEY, String(count + REPEAT_INTERVAL));
  } catch {
    /* ignore */
  }
}

// Motion: one spring, used for the card and the star pops, so everything on
// screen decelerates the same way. Short and slightly overshooting — it should
// feel like the sheet settled, not like it bounced.
const SPRING = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.9 };
const FADE = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

type Step = "rate" | "note" | "done";

export function FeatureIntroOverlay({
  open,
  onClose,
  onRated,
  now,
}: {
  open: boolean;
  /** Dismissed without rating (✕ or backdrop). */
  onClose: () => void;
  /** A rating was submitted — the parent should stop rendering this overlay. */
  onRated: () => void;
  /** Injected clock (ms). Kept out of the module so render stays deterministic. */
  now: () => number;
}) {
  const [picked, setPicked] = useState(0);
  const [step, setStep] = useState<Step>("rate");
  const [note, setNote] = useState("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function finish(stars: number, text?: string) {
    markRated();
    submitRating(stars, now(), text);
    setStep("done");
    closeTimer.current = setTimeout(() => onRated(), 1400);
  }

  function submit() {
    if (!picked) return;
    // Four or five is a happy user: thank them and stop. Below that, ask what
    // went wrong — a complaint we can act on beats a star we can't.
    if (picked >= 4) finish(picked);
    else setStep("note");
  }

  const dismiss = () => {
    snoozeIntro();
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="rating-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
          onPointerDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            padding: 20,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={SPRING}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 360,
              borderRadius: 16,
              background: PANEL,
              border: "1px solid rgba(79,134,198,0.12)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
              overflow: "hidden",
              fontFamily: "'Inter',sans-serif",
            }}
          >
            {/* ✕ — always available; the prompt is never forced. */}
            <button
              onClick={dismiss}
              onPointerDown={(e) => { e.stopPropagation(); dismiss(); }}
              aria-label="Close"
              style={{
                position: "absolute", top: 10, right: 10, zIndex: 2,
                width: 44, height: 44, display: "flex",
                alignItems: "center", justifyContent: "center",
                borderRadius: "50%", border: "none",
                background: "transparent", color: MUTED,
                touchAction: "manipulation", cursor: "pointer",
              }}
            >
              <X size={17} />
            </button>

            <div style={{ padding: "26px 22px 20px", textAlign: "center" }}>
              {/* Height animates between steps so the card grows smoothly rather
                  than snapping to a new size. */}
              <AnimatePresence mode="wait" initial={false}>
                {step === "rate" && (
                  <motion.div key="rate"
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }} transition={FADE}>
                    <Badge />
                    <h2 style={{
                      fontSize: 18, fontWeight: 700, color: "#E2E8F0", margin: "14px 0 0",
                      fontFamily: "'Space Grotesk','Inter',sans-serif",
                    }}>
                      How's GamepadOS playing?
                    </h2>
                    <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, margin: "8px 6px 0" }}>
                      This build brings a faster input path and a rebuilt motion
                      engine. Your rating tells us whether it landed.
                    </p>

                    <div style={{ display: "flex", justifyContent: "center", gap: 4, margin: "20px 0 6px" }}>
                      {[1, 2, 3, 4, 5].map((n) => {
                        const active = picked >= n;
                        return (
                          <motion.button
                            key={n}
                            aria-label={`${n} star${n > 1 ? "s" : ""}`}
                            onClick={() => setPicked(n)}
                            whileTap={{ scale: 0.86 }}
                            animate={{ scale: active ? 1.06 : 1 }}
                            transition={SPRING}
                            style={{
                              border: "none", background: "transparent",
                              padding: 6, cursor: "pointer", lineHeight: 0,
                              touchAction: "manipulation",
                            }}
                          >
                            <Star
                              size={32}
                              strokeWidth={1.75}
                              style={{
                                color: active ? STAR_ON : "rgba(255,255,255,0.20)",
                                fill: active ? STAR_ON : "transparent",
                                transition: "color 160ms ease, fill 160ms ease",
                              }}
                            />
                          </motion.button>
                        );
                      })}
                    </div>

                    <motion.p
                      animate={{ opacity: picked ? 1 : 0.55 }}
                      transition={FADE}
                      style={{ fontSize: 11, color: MUTED, minHeight: 16, margin: "2px 0 0" }}
                    >
                      {picked ? LABELS[picked] : "Tap a star"}
                    </motion.p>

                    <motion.button
                      onClick={submit}
                      disabled={!picked}
                      whileTap={picked ? { scale: 0.98 } : undefined}
                      animate={{ opacity: picked ? 1 : 0.45 }}
                      transition={FADE}
                      style={{
                        width: "100%", marginTop: 18, padding: "13px 0",
                        borderRadius: 12, border: "none",
                        background: ACCENT, color: "#0B0E14",
                        fontSize: 13.5, fontWeight: 700, letterSpacing: "0.02em",
                        fontFamily: "'Space Grotesk','Inter',sans-serif",
                        cursor: picked ? "pointer" : "default",
                        touchAction: "manipulation",
                      }}
                    >
                      Submit
                    </motion.button>
                  </motion.div>
                )}

                {step === "note" && (
                  <motion.div key="note"
                    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }} transition={FADE}>
                    <Badge />
                    <h2 style={{
                      fontSize: 18, fontWeight: 700, color: "#E2E8F0", margin: "14px 0 0",
                      fontFamily: "'Space Grotesk','Inter',sans-serif",
                    }}>
                      What went wrong?
                    </h2>
                    <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, margin: "8px 6px 0" }}>
                      Tell us what to fix and it reaches the team directly. Skip
                      if you'd rather not.
                    </p>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={4}
                      placeholder="Lag, a button that doesn't work, anything…"
                      style={{
                        width: "100%", marginTop: 16, padding: 12,
                        borderRadius: 12, background: SUNK,
                        border: "1px solid rgba(79,134,198,0.14)",
                        color: "#E2E8F0", fontSize: 13, lineHeight: 1.5,
                        fontFamily: "'Inter',sans-serif", resize: "none", outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => finish(picked)}
                        style={{
                          flex: 1, padding: "12px 0", borderRadius: 12,
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.10)",
                          color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600,
                          touchAction: "manipulation", cursor: "pointer",
                        }}
                      >
                        Skip
                      </button>
                      <motion.button
                        onClick={() => finish(picked, note)}
                        disabled={note.trim().length < 3}
                        whileTap={{ scale: 0.98 }}
                        animate={{ opacity: note.trim().length < 3 ? 0.45 : 1 }}
                        transition={FADE}
                        style={{
                          flex: 1.4, padding: "12px 0", borderRadius: 12, border: "none",
                          background: ACCENT, color: "#0B0E14",
                          fontSize: 13, fontWeight: 700,
                          fontFamily: "'Space Grotesk','Inter',sans-serif",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                          touchAction: "manipulation", cursor: "pointer",
                        }}
                      >
                        <Send size={14} /> Send
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {step === "done" && (
                  <motion.div key="done"
                    initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
                    transition={SPRING} style={{ padding: "18px 0 10px" }}>
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ ...SPRING, delay: 0.05 }}
                      style={{
                        width: 54, height: 54, margin: "0 auto 14px", borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: picked >= 4 ? "rgba(245,196,81,0.12)" : "rgba(79,134,198,0.12)",
                        border: `1px solid ${picked >= 4 ? "rgba(245,196,81,0.30)" : "rgba(79,134,198,0.28)"}`,
                      }}
                    >
                      {picked >= 4
                        ? <Star size={24} style={{ color: STAR_ON, fill: STAR_ON }} />
                        : <Send size={22} style={{ color: ACCENT }} />}
                    </motion.div>
                    <p style={{
                      fontSize: 15.5, fontWeight: 700, color: "#E2E8F0", margin: 0,
                      fontFamily: "'Space Grotesk','Inter',sans-serif",
                    }}>
                      {picked >= 4 ? "Thanks for the rating" : "Thanks — message sent"}
                    </p>
                    <p style={{ fontSize: 12, color: MUTED, marginTop: 7, lineHeight: 1.5 }}>
                      {picked >= 4
                        ? "It genuinely helps a small team."
                        : "We read every one and we'll get it fixed."}
                      {typeof navigator !== "undefined" && navigator.onLine === false
                        ? " Sends when you're back online."
                        : ""}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const LABELS: Record<number, string> = {
  1: "Something's badly broken",
  2: "Needs work",
  3: "It's okay",
  4: "Good",
  5: "Excellent",
};

function Badge() {
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ ...SPRING, delay: 0.04 }}
      style={{
        width: 52, height: 52, margin: "0 auto", borderRadius: 14,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(79,134,198,0.12)",
        border: "1px solid rgba(79,134,198,0.25)",
        boxShadow: "0 0 26px rgba(79,134,198,0.18)",
      }}
    >
      <Star size={24} style={{ color: ACCENT }} />
    </motion.div>
  );
}
