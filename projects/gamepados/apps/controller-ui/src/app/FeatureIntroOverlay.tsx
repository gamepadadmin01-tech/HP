// Rating prompt — the one popup that appears after a session on the controller.
//
// Lifecycle:
//  • Never forced. The ✕ and the backdrop always dismiss.
//  • Dismissed without rating → returns much later, and only a few times (see the pacing rules below).
//  • Never asked when the controller OPENS, and never right after a forced exit (out of play time):
//    only after a real session the player closed themselves (recordSessionEnd).
//  • A submitted rating sets a persisted flag and the feature goes inert — the
//    parent stops rendering it, so its state and timers are torn down.
//
// Two things it deliberately does NOT do:
//  • It never submits on pointer-down. Stars select on click and nothing is sent
//    until Submit is pressed, because a swipe that starts on a star used to fire
//    a permanent 1-star rating.
//  • It never thanks someone for a bad rating. Under 4 stars it asks what went
//    wrong and sends that to support instead of fishing for a store review. That reason is REQUIRED
//    (owner, 2026-11-02: too many ratings arrived as a bare star with no comment); 4 and 5 stay one tap.
//
// The thank-you step invites EVERY rater to follow the Instagram page (Akhil's
// call, 2026-09-23 — not only the 4-5 star ones). It used to close itself after
// 1.4s, too fast to read a button, let alone tap it, so it now stays until the
// user taps Follow or ✕. The rating is already saved before this step appears,
// so closing it any way at all is simply "done".
//
// Delivery is feedback.ts, which queues offline and retries on reconnect.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Star, Send, Instagram } from "lucide-react";
import { submitRating } from "./feedback";
import { openUrl } from "./platform/native";
import { INSTAGRAM_URL } from "./social";
import { useOverlayFocus } from "./components/useOverlayFocus";

const RATED_KEY = "feature_rated_v2"; // bump the suffix to re-introduce in a future version
// ── Pacing (owner, 2026-11-02) ──────────────────────────────────────────────────────────────────
// The prompt used to count every Controller<->Dashboard move, in BOTH directions: it could pop up while the
// controller was opening, and right after the app threw a player out for running out of play time, which
// is where a lot of 1-star ratings came from. Now:
//   * it never appears when the controller opens, only after the player CLOSES it themselves;
//   * only after a real session (MIN_SESSION_MS), never after a forced exit (suppressIntroOnce);
//   * the first ask comes after FIRST_SHOW_AT such sessions; after any ask at least REPEAT_INTERVAL more
//     sessions AND MIN_GAP_MS must pass; and never more than MAX_ASKS times in total.
const SESSIONS_KEY = "intro2_sessions";   // real sessions that ended on the player's own choice
const NEXT_KEY = "intro2_next";           // ask again once the count reaches this
const ASKS_KEY = "intro2_asks";           // how many times the prompt has been shown
const LAST_KEY = "intro2_last";           // when it was last shown (ms since 1970)
export const FIRST_SHOW_AT = 5;
export const REPEAT_INTERVAL = 15;
export const MIN_SESSION_MS = 5 * 60 * 1000;
export const MIN_GAP_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_ASKS = 3;
/** Ratings below this need a written reason (4 and 5 stay one tap). */
export const COMMENT_REQUIRED_BELOW = 4;
export const MIN_NOTE_CHARS = 5;

const ACCENT = "var(--calm-accent, #abc8db)";
const STAR_ON = "#F5C451";
const PANEL = "var(--calm-surface, #202527)";
const SUNK = "var(--calm-soft, #292f31)";
const MUTED = "var(--calm-muted, #a6b0b3)";

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
    for (const k of [SESSIONS_KEY, NEXT_KEY, ASKS_KEY, LAST_KEY, "intro_nav_count", "intro_next_show"]) localStorage.removeItem(k);
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

function writeInt(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}

/** The whole "is it time to ask?" rule, with no storage in it so a test can check it. */
export function shouldShowIntro(s: { sessions: number; next: number; asks: number; last: number; now: number }): boolean {
  return s.asks < MAX_ASKS && s.sessions >= s.next && (s.last === 0 || s.now - s.last >= MIN_GAP_MS);
}

let openedAt = 0;
let forcedExit = false;

/** The controller just opened. Starts the session clock. Never shows anything. */
export function noteControllerOpened(now: number = Date.now()): void {
  openedAt = now;
  forcedExit = false;
}

/** The app is about to send the player out by itself (out of play time): that exit must not ask. */
export function suppressIntroOnce(): void {
  forcedExit = true;
}

/**
 * The player closed the controller. Returns true when the prompt should now be shown. Only a real session
 * that the player ended themselves counts. When it says yes the ask is recorded and the next one pushed out
 * right away, so closing the app before answering cannot bring it straight back.
 */
export function recordSessionEnd(now: number = Date.now()): boolean {
  if (introRated()) return false;
  const forced = forcedExit;
  const started = openedAt;
  forcedExit = false;
  openedAt = 0;
  if (forced || !started || now - started < MIN_SESSION_MS) return false;
  const sessions = readInt(SESSIONS_KEY, 0) + 1;
  writeInt(SESSIONS_KEY, sessions);
  const asks = readInt(ASKS_KEY, 0);
  const show = shouldShowIntro({ sessions, next: readInt(NEXT_KEY, FIRST_SHOW_AT), asks, last: readInt(LAST_KEY, 0), now });
  if (show) {
    writeInt(ASKS_KEY, asks + 1);
    writeInt(LAST_KEY, now);
    writeInt(NEXT_KEY, sessions + REPEAT_INTERVAL);
  }
  return show;
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
  const dialogRef=useRef<HTMLDivElement>(null);

  function finish(stars: number, text?: string) {
    markRated();
    submitRating(stars, now(), text);
    setStep("done");
  }

  function followInstagram() {
    openUrl(INSTAGRAM_URL);
    onRated();
  }

  function submit() {
    if (!picked) return;
    // Four or five is a happy user: thank them and stop. Below that, ask what
    // went wrong — a complaint we can act on beats a star we can't.
    if (picked >= COMMENT_REQUIRED_BELOW) finish(picked);
    else setStep("note");
  }

  // ✕, backdrop, Escape and Android Back all come through here. Before a rating
  // that is a dismissal (ask again later); on the thank-you step the rating is
  // already saved, so it is simply the end.
  const dismiss = () => {
    if (step === "done") { onRated(); return; }
    onClose();
  };
  useOverlayFocus(open, dialogRef, dismiss);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="rating-overlay"
          className="gp-shell calm-rating"
          role="dialog" aria-modal="true" aria-label="Rate your GamepadOS experience"
          ref={dialogRef}
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
              boxShadow: "none",
              overflow: "hidden",
              fontFamily: "system-ui, sans-serif",
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
                      fontSize: 18, fontWeight: 700, color: "var(--calm-ink, #f0f2ed)", margin: "14px 0 0",
                      fontFamily: "system-ui, sans-serif",
                    }}>
                      How's GamepadOS playing?
                    </h2>
                    <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, margin: "8px 6px 0" }}>
                      How does it feel to play? Tell us what works for you and
                      what could feel better.
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
                                color: active ? STAR_ON : "var(--calm-muted, #a6b0b3)",
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
                        fontFamily: "system-ui, sans-serif",
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
                      fontSize: 18, fontWeight: 700, color: "var(--calm-ink, #f0f2ed)", margin: "14px 0 0",
                      fontFamily: "system-ui, sans-serif",
                    }}>
                      What went wrong?
                    </h2>
                    <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55, margin: "8px 6px 0" }}>
                      Tell us what to fix and it reaches the team directly. A short
                      reason is needed, so we can actually fix it.
                    </p>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={4}
                      placeholder="Lag, a button that doesn't work, anything…"
                      style={{
                        width: "100%", boxSizing: "border-box", marginTop: 16, padding: 12,
                        borderRadius: 12, background: SUNK,
                        border: "1px solid rgba(79,134,198,0.14)",
                        color: "var(--calm-ink, #f0f2ed)", fontSize: 13, lineHeight: 1.5,
                        fontFamily: "system-ui, sans-serif", resize: "none", outline: "none",
                      }}
                    />
                    <p style={{ fontSize: 11, color: MUTED, margin: "8px 2px 0", minHeight: 15, textAlign: "left" }}>
                      {note.trim().length < MIN_NOTE_CHARS ? `Please write at least ${MIN_NOTE_CHARS} characters so we can fix it.` : " "}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <motion.button
                        onClick={() => finish(picked, note)}
                        disabled={note.trim().length < MIN_NOTE_CHARS}
                        whileTap={{ scale: 0.98 }}
                        animate={{ opacity: note.trim().length < MIN_NOTE_CHARS ? 0.45 : 1 }}
                        transition={FADE}
                        style={{
                          flex: 1.4, padding: "12px 0", borderRadius: 12, border: "none",
                          background: ACCENT, color: "#0B0E14",
                          fontSize: 13, fontWeight: 700,
                          fontFamily: "system-ui, sans-serif",
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
                      fontSize: 15.5, fontWeight: 700, color: "var(--calm-ink, #f0f2ed)", margin: 0,
                      fontFamily: "system-ui, sans-serif",
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
                    <motion.button
                      onClick={followInstagram}
                      whileTap={{ scale: 0.98 }}
                      style={{
                        width: "100%", marginTop: 20, padding: "13px 0",
                        borderRadius: 12, border: "none",
                        background: ACCENT, color: "#0B0E14",
                        fontSize: 13.5, fontWeight: 700, letterSpacing: "0.02em",
                        fontFamily: "system-ui, sans-serif",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        cursor: "pointer", touchAction: "manipulation",
                      }}
                    >
                      <Instagram size={16} aria-hidden="true" /> Follow us on Instagram
                    </motion.button>
                    <p style={{ fontSize: 11, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
                      Tips, updates and new features first.
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
        boxShadow: "none",
      }}
    >
      <Star size={24} style={{ color: ACCENT }} />
    </motion.div>
  );
}
