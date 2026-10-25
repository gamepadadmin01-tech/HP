import React, { useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPRING, FADE } from "../motion";
import { Edit3, ChevronRight, Vibrate, LogOut, Mail, RefreshCw, Cloud, CloudOff, Trash2 } from "lucide-react";
import { openUrl, testRumble } from "../platform/native";
import { getSession, onSessionChange, signOut, deleteAccount } from "../store/account";
import { ApiError } from "../api/account";
import { getSyncState, onSyncChange, syncNow, lastSyncedAt, cancelScheduledSync } from "../store/sync";
import { autoSyncEnabled, setAutoSyncEnabled } from "../store/prefs";
import { PlanPanel } from "./PlanPanel";
import { GuestPlans } from "./GuestPlans";
import { CalmSwitch } from "./CalmSettings";

// ─── GamepadOS Account ────────────────────────────────────────────────────────
//
// Signed out, this tab holds plans. The header shortcut has its own dedicated
// sign-in destination. Signed in, this tab holds the player's real profile.
//
// Support and app information live in Settings and remain available to guests.

export function TabAccount({
  customPadsCount,
  gyroHaptic,
  gyroMode,
  gyroThrottle,
  rumbleOn,
  onOpenSystem,
  onSignIn,
  support,
}: {
  customPadsCount: number;
  gyroHaptic: boolean;
  gyroMode: string;
  gyroThrottle: boolean;
  rumbleOn: boolean;
  onOpenSystem: () => void;
  onSignIn: () => void;
  /** Feedback, contact and the privacy policy (AppSupport), last on the page. */
  support?: React.ReactNode;
}) {
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);

  // Plans remain a separate destination; the header goes directly to sign-in.
  if (!session) {
    return (
      <div className="calm-account space-y-4 pb-8">
        <div className="calm-intro"><span className="console-eyebrow">GOOD GAMES DESERVE MORE TIME</span><h1 data-testid="account-heading">Stay in the game.</h1><p>Your playtime. Your pace. Your pick.</p></div>
        <GuestPlans key="guest-plans" />
        <button data-testid="account-signin-toggle-button" className="guest-back" onClick={onSignIn}>
          Already have an account? Sign in
        </button>
        {support}
      </div>
    );
  }

  const { user } = session;

  return (
    <div data-testid="profile-screen" className="calm-account space-y-4 pb-8">
      <div className="calm-intro"><span className="console-eyebrow">THE PLAYER BEHIND THE CONTROLLER</span><h1 data-testid="account-heading">Your player profile.</h1><p>All your play, in one place.</p></div>
      <GuestPlans key="guest-plans" />
      {/* ── Identity ── */}
      <section className="calm-profile flex flex-col items-center pt-1">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-3"
          style={{
            background: "var(--calm-tint, #293944)",
            border: "2px solid rgba(79,134,198,0.40)",
            boxShadow: "none",
          }}>
          <span className="text-3xl font-bold calm-ink"
            style={{ fontFamily: "system-ui, sans-serif" }}>
            {user.displayName.trim().charAt(0).toUpperCase()}
          </span>
        </div>
        <h2 className="text-xl font-bold calm-ink"
          style={{ fontFamily: "system-ui, sans-serif" }}>{user.displayName}</h2>
        <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "var(--calm-muted, #a6b0b3)" }}>
          <Mail size={11} /> {user.email}
        </p>
      </section>

      {/* ── Plan, quota and upgrades ── Placed first because it is what this
          tab is opened to check, and because a limit the user cannot find is
          indistinguishable from a limit that appeared without warning. ── */}
      <PlanPanel />

      {/* ── The user's own layouts ── */}
      <Section title="Controller Library">
        <div className="p-4 rounded-xl flex items-center gap-4"
          style={{ background: "var(--calm-surface, #202527)", border: "1px solid var(--calm-line, #343c3f)" }}>
          <div className="p-2.5 rounded-xl" style={{ background: "rgba(79,134,198,0.10)", color: "var(--calm-accent, #abc8db)" }}>
            <Edit3 size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold calm-ink">My layouts</p>
            <p className="text-xs" style={{ color: "var(--calm-muted, #a6b0b3)" }}>
              {customPadsCount === 0
                ? "None yet — create one from Play."
                : `${customPadsCount} saved on this phone`}
            </p>
          </div>
          <span className="text-2xl font-bold calm-ink"
            style={{ fontFamily: "system-ui, sans-serif" }}>{customPadsCount}</span>
        </div>
      </Section>

      <Section title="Backup">
        <Panel><SyncPanel /></Panel>
      </Section>

      {/* ── Preferences ── */}
      <Section title="Preferences">
        <Panel>
          <Setting label="Haptics" value={gyroHaptic ? "On" : "Off"} />
          <Setting label="Motion mode" value={gyroMode === "3d" ? "3D aim" : "Racing"} />
          <Setting label="Tilt throttle" value={gyroThrottle ? "On" : "Off"} />
          <RumbleTest on={rumbleOn} />
          <button onClick={onOpenSystem}
            className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors text-left">
            <span className="text-sm font-medium calm-ink">Change these in Settings</span>
            <ChevronRight size={16} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
          </button>
        </Panel>
      </Section>


      {support}

      {/* ── Destructive actions, last ── */}
      <Section title="Session">
        <Panel>
          <SignOutRow />
        </Panel>
      </Section>

      <Section title="Danger zone">
        <Panel><DeleteAccountRow email={user.email} /></Panel>
      </Section>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

const Section = React.memo(function Section(
  { title, children }: { title: string; children: React.ReactNode },
) {
  return (
    <section>
      <h3 className="calm-account-section-title" style={{ color: "var(--calm-muted, #a6b0b3)" }}>
        {title}
      </h3>
      {children}
    </section>
  );
});

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden divide-y divide-white/5"
      style={{ background: "var(--calm-surface, #202527)", border: "1px solid var(--calm-line, #343c3f)" }}>
      {children}
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-4">
      <span className="text-sm font-medium calm-ink">{label}</span>
      <span className="text-xs font-semibold" style={{ color: "var(--calm-accent, #abc8db)" }}>{value}</span>
    </div>
  );
}

/** Cloud backup: what state it is in, whether it runs by itself, and a way to
 *  run it right now. Status reports what actually happened — a failed backup
 *  says so instead of quietly implying the layouts are safe. */
function SyncPanel() {
  const sync = useSyncExternalStore(onSyncChange, getSyncState, getSyncState);
  const [auto, setAuto] = useState(() => autoSyncEnabled());
  const [, force] = useState(0);
  const last = lastSyncedAt();

  const busy = sync.status === "syncing";
  const failed = sync.status === "error";

  const detail =
    busy ? "Backing up…"
    : failed ? (sync as { message: string }).message
    : last ? `Last backed up ${relativeTime(last)}`
    : auto ? "Not backed up yet" : "Automatic backup is off";

  function toggleAuto(next: boolean) {
    setAutoSyncEnabled(next);
    setAuto(next);
    // Don't let an upload queued a moment ago fire after opting out.
    if (!next) cancelScheduledSync();
    else void syncNow().then(() => force((n) => n + 1));
  }

  return (
    <>
      {/* Status */}
      <div className="flex items-center gap-3 p-4">
        <div className="p-2.5 rounded-xl"
          style={{
            background: failed ? "rgba(224,87,79,0.10)" : "rgba(79,134,198,0.10)",
            color: failed ? "var(--calm-error, #ffaba6)" : "var(--calm-accent, #abc8db)",
          }}>
          {failed ? <CloudOff size={18} /> : <Cloud size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold calm-ink">Cloud backup</p>
          <p className="text-xs truncate" style={{ color: failed ? "var(--calm-error, #ffaba6)" : "var(--calm-muted, #a6b0b3)" }}>{detail}</p>
        </div>
      </div>

      {/* Auto */}
      <CalmSwitch label="Auto backup" detail="Save layouts to your account whenever you change one." on={auto} onChange={toggleAuto} />

      {/* Manual — always available, even with auto off */}
      <button
        onClick={() => { void syncNow().then(() => force((n) => n + 1)); }}
        disabled={busy}
        className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <RefreshCw
            size={15}
            style={{ color: "var(--calm-accent, #abc8db)", animation: busy ? "gp-spin 900ms linear infinite" : undefined }}
          />
          <span className="text-sm font-medium calm-ink">{busy ? "Syncing…" : "Sync now"}</span>
        </div>
        <ChevronRight size={16} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
      </button>
      <style>{"@keyframes gp-spin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}

/** Matches the toggle used throughout the System tab. */
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      data-no-press
      className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${on ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-6" : ""}`} />
    </button>
  );
}

/** "just now" / "5 min ago" / "3 days ago" — a timestamp nobody has to decode. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Two-step, because signing out on a phone is easy to do by accident. */
function SignOutRow() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Same grow-in-place treatment as Delete account, so the two destructive
  // controls behave identically.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!confirming ? (
        <motion.button
          key="row"
          onClick={() => setConfirming(true)}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={FADE}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] text-left"
        >
          <div className="flex items-center gap-3">
            <LogOut size={15} style={{ color: "var(--calm-error, #ffaba6)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--calm-error, #ffaba6)" }}>Sign out</span>
          </div>
          <ChevronRight size={16} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
        </motion.button>
      ) : (
        <motion.div
          key="confirm"
          // Kept as a height animation deliberately: these are one-line status
          // rows in a small panel, so the reflow is trivial. The plans list was
          // different — a tall list inside a long scrolling column.
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={SPRING}
          style={{ overflow: "hidden" }}
        >
          <div className="p-4 space-y-3">
            <p className="text-xs" style={{ color: "var(--calm-muted, #a6b0b3)" }}>
              Your layouts stay on this phone. Sign in again any time.
            </p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                style={{ background: "var(--calm-soft, #292f31)", color: "var(--calm-muted, #a6b0b3)", border: "1px solid var(--calm-line, #343c3f)" }}>
                Cancel
              </button>
              <button disabled={busy}
                onClick={async () => { setBusy(true); await signOut(); }}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                style={{ background: "rgba(224,87,79,0.12)", color: "var(--calm-error, #ffaba6)", border: "1px solid rgba(224,87,79,0.30)" }}>
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Delete the account. Deliberately the most awkward control on the page:
 * two taps, then the password, before anything irreversible happens.
 *
 * It also states plainly that local layouts survive — someone deleting an
 * account usually wants their data off our servers, not their work destroyed.
 */
function DeleteAccountRow({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!password || busy) return;
    setBusy(true); setError("");
    try {
      await deleteAccount(password);
      // The provider clears the session, so this component unmounts itself.
    } catch (e) {
      setError((e as ApiError).message || "Could not delete the account.");
      setBusy(false);
    }
  }

  // The row and the confirmation are two states of ONE element, so the panel
  // grows out of the row rather than replacing it. Height is animated from 0 so
  // the rows below slide down with it instead of jumping.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!open ? (
        <motion.button
          key="row"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] text-left"
        >
          <div className="flex items-center gap-3">
            <Trash2 size={15} style={{ color: "var(--calm-error, #ffaba6)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--calm-error, #ffaba6)" }}>Delete account</span>
          </div>
          <ChevronRight size={16} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
        </motion.button>
      ) : (
        <motion.div
          key="confirm"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={SPRING}
          style={{ overflow: "hidden" }}
        >
          <ConfirmBody
            email={email} password={password} setPassword={setPassword}
            busy={busy} error={error} confirm={confirm}
            cancel={() => { setOpen(false); setPassword(""); setError(""); }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConfirmBody({ email, password, setPassword, busy, error, confirm, cancel }: {
  email: string; password: string; setPassword: (v: string) => void;
  busy: boolean; error: string; confirm: () => void; cancel: () => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <p className="text-sm font-bold" style={{ color: "var(--calm-error, #ffaba6)" }}>Delete this account permanently?</p>
      <p className="text-xs leading-relaxed" style={{ color: "var(--calm-muted, #a6b0b3)" }}>
        {email} and every layout backed up to it will be erased. This cannot be undone.
        <br /><br />
        <span style={{ color: "var(--calm-muted, #a6b0b3)" }}>Layouts saved on this phone are kept</span> — the app
        keeps working without an account.
      </p>
      {error && (
        <div className="p-2.5 rounded-lg text-xs text-center"
          style={{ background: "rgba(224,87,79,0.12)", border: "1px solid rgba(224,87,79,0.25)", color: "var(--calm-error, #ffaba6)" }}>
          {error}
        </div>
      )}
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        aria-label="Confirm your password" placeholder="Confirm your password" autoComplete="current-password" autoCapitalize="none"
        className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
        style={{ background: "var(--calm-soft, #292f31)", border: "1px solid rgba(224,87,79,0.25)", color: "var(--calm-ink, #f0f2ed)" }}
      />
      <div className="flex gap-2">
        <button disabled={busy}
          onClick={cancel}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
          style={{ background: "var(--calm-soft, #292f31)", color: "var(--calm-muted, #a6b0b3)", border: "1px solid var(--calm-line, #343c3f)" }}>
          Keep my account
        </button>
        <button disabled={busy || !password}
          onClick={confirm}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-45"
          style={{ background: "rgba(224,87,79,0.14)", color: "var(--calm-error, #ffaba6)", border: "1px solid rgba(224,87,79,0.35)" }}>
          {busy ? "Deleting…" : "Delete forever"}
        </button>
      </div>
    </div>
  );
}

/** Fires both motors so the user can feel whether rumble reaches the phone. */
function RumbleTest({ on }: { on: boolean }) {
  const [state, setState] = useState<"idle" | "buzzing" | "unavailable">("idle");

  function fire() {
    if (!on) return;
    const ok = testRumble();
    setState(ok ? "buzzing" : "unavailable");
    if (ok) setTimeout(() => setState("idle"), 700);
  }

  return (
    <button onClick={fire} disabled={!on}
      className="w-full flex items-center justify-between p-4 transition-colors text-left disabled:opacity-50 hover:bg-white/[0.03]">
      <div className="flex items-center gap-3">
        <Vibrate size={15} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
        <span className="text-sm font-medium calm-ink">Test rumble</span>
      </div>
      <span className="text-xs font-semibold"
        style={{ color: state === "unavailable" ? "var(--calm-error, #ffaba6)" : "var(--calm-accent, #abc8db)" }}>
        {!on ? "Rumble off"
          : state === "buzzing" ? "Buzzing…"
          : state === "unavailable" ? "Not supported"
          : "Tap to test"}
      </span>
    </button>
  );
}

/** Support, at the end of the Plans page (signed in or not): feedback, contact, and the privacy
 *  policy as one quiet line. The policy link must stay reachable inside the app (Google Play user
 *  data policy), but it does not need its own section. */
export function AppSupport({ privacyUrl, feedback }: { privacyUrl: string; feedback: React.ReactNode }) {
  return (
    <Section title="Support">
      <Panel>
        {feedback}
        <button onClick={() => openUrl(privacyUrl)} data-testid="privacy-policy-link"
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          style={{ borderTop: "1px solid var(--calm-line, #343c3f)", minHeight: 0 }}>
          <span className="text-xs" style={{ color: "var(--calm-muted, #a6b0b3)" }}>Privacy policy</span>
          <ChevronRight size={14} style={{ color: "var(--calm-muted, #a6b0b3)" }} />
        </button>
      </Panel>
    </Section>
  );
}
