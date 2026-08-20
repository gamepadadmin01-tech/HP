// ─── "Plans are coming" ───────────────────────────────────────────────────────
//
// The heads-up that ships ONE RELEASE BEFORE the daily limit does, which is the
// mitigation BILLING_DECISIONS §2.1 requires and which the first plan of record
// had no room for. A limit people were warned about is accepted; one that
// appears overnight is not — and Play production access was granted only on
// 2026-08-12, with no ratings history to absorb a wave of 1-stars.
//
// It also closes a hole in the launch bonus: the gift is granted per ACCOUNT,
// and most live users have never made one. Without this notice they would find
// out that accounts mattered on the day the gift had already been handed out.
//
// Four things it is careful about:
//
//   * It opens as a DISCLOSURE. Closed, it is one line and two progress chips —
//     enough to be noticed, small enough not to sit on top of the app someone
//     opened to play a game.
//   * It adapts rather than nags. Signed out it asks for an account; signed in
//     it asks for feedback; once both are done it says so and stops asking.
//   * It closes smoothly and stays closed. Dismissing collapses the whole card
//     rather than yanking it out of the column, and the choice is remembered
//     against this notice's id so a LATER announcement is not pre-silenced.
//
//   * Its entrance is CHEAP, on purpose. This card lives inside TabHome, which
//     App.tsx mounts with `{tab === "home" && <TabHome/>}` — a full unmount,
//     not a display toggle — so this component (and its mount animation)
//     re-runs every single time the user returns to Home, including every
//     time they back out of a game. That is far from "once ever", which is
//     what an earlier version of this file assumed when it used Collapse's
//     "slide" mode for the outer wrapper. "slide" genuinely animates
//     grid-template-rows, which reflows on every frame of the transition —
//     fine for something that fires once, a visible stutter for something
//     that fires on every Home visit. It now uses the default "reveal" mode
//     everywhere: one instant layout pass, then a compositor-only fade/slide.
//   * It never claims the gift is already yours. Nothing here grants anything —
//     the entitlement is written server-side by grant-launch-bonus.js.
//
// All motion goes through Collapse (a CSS grid-row transition) rather than an
// animated height, so opening it never reflows the page under it. See that file.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Sparkles, X, ChevronDown, ChevronRight, Check } from "lucide-react";
import { getSession, onSessionChange } from "../store/account";
import { requestDashboardTab } from "../store/navIntent";
import { hasSentFeedback } from "../feedback";
import { readJson, writeJson, KEYS } from "../store/storage";
import { Collapse } from "./Collapse";

const ACCENT = "#5D90CB";
const MUTED = "#7C8AA0";
const GOOD = "#5FBF8F";

/** Bumped if the notice is ever reused for a later change, so a previous
 *  dismissal does not silence a new announcement. */
const NOTICE_ID = "plans-1.3.29";
const CLOSE_MS = 260;

function dismissed(): boolean {
  return readJson<string | null>(KEYS.noticeDismissed, null) === NOTICE_ID;
}

export function LaunchNotice() {
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);
  const [gone, setGone] = useState(() => dismissed());
  const [open, setOpen] = useState(false);
  // Drives the closing animation. The card stays mounted at zero height until
  // the transition ends, because unmounting immediately is what makes a
  // dismissal look like the row was deleted rather than put away.
  const [closing, setClosing] = useState(false);
  // Off on the first paint so the card animates IN rather than appearing
  // already open. One frame is enough for the browser to record the start.
  const [entered, setEntered] = useState(false);

  const sentFeedback = hasSentFeedback();

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (gone) return null;

  const hasAccount = !!session;
  const done = hasAccount && sentFeedback;
  const cta = !hasAccount ? "Create an account" : !sentFeedback ? "Send feedback" : null;

  function close() {
    setClosing(true);
    writeJson(KEYS.noticeDismissed, NOTICE_ID);
    window.setTimeout(() => setGone(true), CLOSE_MS + 40);
  }

  return (
    <Collapse open={entered && !closing} durationMs={CLOSE_MS}>
      <div
        className="w-full rounded-2xl overflow-hidden"
        style={{
          background: "rgba(79,134,198,0.07)",
          border: "1.5px solid rgba(79,134,198,0.22)",
        }}
      >
        {/* ── The row that is always visible ── */}
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-3 flex-1 min-w-0 text-left"
          >
            <span className="p-2 rounded-xl shrink-0"
              style={{ background: "rgba(79,134,198,0.12)", color: ACCENT, display: "flex" }}>
              <Sparkles size={16} />
            </span>

            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-white/90"
                style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
                A heads-up, and a thank-you
              </span>
              <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
                {done ? "You're all set for the 24-hour gift" : "Plans are coming · 24h unlimited for you"}
              </span>
            </span>

            <span
              className="shrink-0"
              style={{
                color: MUTED,
                display: "flex",
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 200ms ease",
              }}
            >
              <ChevronDown size={17} />
            </span>
          </button>

          <button onClick={close} aria-label="Dismiss"
            className="p-1.5 rounded-lg shrink-0" style={{ color: MUTED }}>
            <X size={14} />
          </button>
        </div>

        {/* ── The detail ── */}
        <Collapse open={open}>
          <div className="px-4 pb-4">
            <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
              We&rsquo;ve rebuilt the input path — this build is the fastest GamepadOS has
              been. To keep that work going, plans are coming in a future update.
              They&rsquo;ll be cheap, and <span style={{ color: "#FFFFFF" }}>an hour of play
              every day stays free, forever</span>.
            </p>

            <p className="text-xs leading-relaxed mt-2" style={{ color: MUTED }}>
              {done
                ? "Your 24 hours of unlimited playtime will be waiting on your account when plans arrive."
                : hasAccount
                  ? "Everyone already using GamepadOS gets 24 hours of unlimited playtime when that lands, tied to your account — and yours is ready. Tell us how the app is doing while you're here."
                  : "Everyone already using GamepadOS gets 24 hours of unlimited playtime when that lands. It's tied to your account, so make one now — and tell us what you think while you're there."}
            </p>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Step label="Account" done={hasAccount} />
              <Step label="Feedback" done={sentFeedback} />
            </div>

            {cta && (
              <button
                onClick={() => requestDashboardTab("account")}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold active:scale-[0.98]"
                style={{
                  background: "rgba(79,134,198,0.14)",
                  border: "1px solid rgba(79,134,198,0.35)",
                  color: ACCENT,
                  transition: "transform 120ms ease",
                }}
              >
                {cta} <ChevronRight size={13} />
              </button>
            )}
          </div>
        </Collapse>
      </div>
    </Collapse>
  );
}

/** A done/not-done chip. Two steps, so a progress bar would be overkill. */
function Step({ label, done }: { label: string; done: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
      style={{
        background: done ? "rgba(95,191,143,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${done ? "rgba(95,191,143,0.30)" : "rgba(255,255,255,0.07)"}`,
        color: done ? GOOD : MUTED,
        transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
      }}>
      {done ? <Check size={10} /> : null}
      {label}
    </span>
  );
}
