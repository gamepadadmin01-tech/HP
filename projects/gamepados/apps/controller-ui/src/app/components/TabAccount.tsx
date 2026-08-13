import React, { useMemo, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPRING, FADE } from "../motion";
import { Edit3, ChevronRight, Vibrate, LogOut, Mail, RefreshCw, Cloud, CloudOff, Trash2 } from "lucide-react";
import { getAppInfo, openUrl, testRumble } from "../platform/native";
import { getSession, onSessionChange, signOut, deleteAccount } from "../store/account";
import { ApiError } from "../api/account";
import { getSyncState, onSyncChange, syncNow, lastSyncedAt, cancelScheduledSync } from "../store/sync";
import { autoSyncEnabled, setAutoSyncEnabled } from "../store/prefs";
import { AccountAuth } from "./AccountAuth";

// ─── GamepadOS Account ────────────────────────────────────────────────────────
//
// Signed out, this tab is the sign-in screen and nothing else — no profile, no
// settings, no pretend identity.
//
// The app-info block (version, update check, feedback) stays visible in both
// states on purpose: it is not a setting, and someone who cannot sign in still
// has to be able to update the app and report the problem.

export function TabAccount({
  customPadsCount,
  gyroHaptic,
  gyroMode,
  gyroThrottle,
  rumbleOn,
  privacyUrl,
  onOpenSystem,
  updateChecker,
  feedback,
}: {
  customPadsCount: number;
  gyroHaptic: boolean;
  gyroMode: string;
  gyroThrottle: boolean;
  rumbleOn: boolean;
  privacyUrl: string;
  onOpenSystem: () => void;
  updateChecker: React.ReactNode;
  feedback: React.ReactNode;
}) {
  const app = useMemo(() => getAppInfo(), []);
  const session = useSyncExternalStore(onSessionChange, getSession, getSession);

  // Support and App are two panels, each built from the same rows as the rest of
  // the page — no cards nested inside cards, one heading per section.
  const support = (
    <Section title="Support">
      <Panel>{feedback}</Panel>
    </Section>
  );

  const appPanel = (
    <Section title="App">
      <Panel>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold tracking-widest"
              style={{ fontFamily: "'Space Grotesk',sans-serif", color: "#5D90CB" }}>GAMEPADOS</span>
            {app.version && (
              <span className="text-xs font-semibold" style={{ color: "#7C8AA0" }}>v{app.version}</span>
            )}
          </div>
          <p className="text-xs leading-relaxed mt-2" style={{ color: "#7C8AA0" }}>
            Turn your phone into a low-latency wireless or USB controller for your PC.
          </p>
        </div>
        {updateChecker}
        <button onClick={() => openUrl(privacyUrl)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors text-left">
          <span className="text-sm font-medium text-white/90">Privacy policy</span>
          <ChevronRight size={16} style={{ color: "#7C8AA0" }} />
        </button>
      </Panel>
    </Section>
  );

  // ── Signed out: the sign-in screen, plus support and app info. Nothing else. ──
  if (!session) {
    return (
      <div className="space-y-6 pb-10">
        <AccountAuth />
        {support}
        {appPanel}
      </div>
    );
  }

  const { user } = session;

  return (
    <div className="space-y-6 pb-10">
      {/* ── Identity ── */}
      <section className="flex flex-col items-center pt-1">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-3"
          style={{
            background: "linear-gradient(135deg,#5D90CB 0%,#2A4B75 100%)",
            border: "2px solid rgba(79,134,198,0.40)",
            boxShadow: "0 0 24px rgba(79,134,198,0.25)",
          }}>
          <span className="text-3xl font-bold text-white"
            style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
            {user.displayName.trim().charAt(0).toUpperCase()}
          </span>
        </div>
        <h2 className="text-xl font-bold text-white"
          style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{user.displayName}</h2>
        <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "#7C8AA0" }}>
          <Mail size={11} /> {user.email}
        </p>
      </section>

      {/* ── The user's own layouts ── */}
      <Section title="Controller Library">
        <div className="p-4 rounded-xl flex items-center gap-4"
          style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="p-2.5 rounded-xl" style={{ background: "rgba(79,134,198,0.10)", color: "#5D90CB" }}>
            <Edit3 size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white/90">My layouts</p>
            <p className="text-xs" style={{ color: "#7C8AA0" }}>
              {customPadsCount === 0
                ? "None yet — create one from Home."
                : `${customPadsCount} saved on this phone`}
            </p>
          </div>
          <span className="text-2xl font-bold text-white/90"
            style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{customPadsCount}</span>
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
            <span className="text-sm font-medium text-white/90">Change these in System</span>
            <ChevronRight size={16} style={{ color: "#7C8AA0" }} />
          </button>
        </Panel>
      </Section>

      {support}
      {appPanel}

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
      <h3 className="text-[10px] font-bold tracking-widest uppercase mb-2 px-1" style={{ color: "#7C8AA0" }}>
        {title}
      </h3>
      {children}
    </section>
  );
});

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden divide-y divide-white/5"
      style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.05)" }}>
      {children}
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between p-4">
      <span className="text-sm font-medium text-white/90">{label}</span>
      <span className="text-xs font-semibold" style={{ color: "#5D90CB" }}>{value}</span>
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
            color: failed ? "#E2645D" : "#5D90CB",
          }}>
          {failed ? <CloudOff size={18} /> : <Cloud size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white/90">Cloud backup</p>
          <p className="text-xs truncate" style={{ color: failed ? "#E2645D" : "#7C8AA0" }}>{detail}</p>
        </div>
      </div>

      {/* Auto */}
      <div className="flex items-center justify-between p-4 gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/90">Auto backup</p>
          <p className="text-xs mt-0.5" style={{ color: "#7C8AA0" }}>
            Save layouts to your account whenever you change one.
          </p>
        </div>
        <Toggle on={auto} onChange={toggleAuto} />
      </div>

      {/* Manual — always available, even with auto off */}
      <button
        onClick={() => { void syncNow().then(() => force((n) => n + 1)); }}
        disabled={busy}
        className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <RefreshCw
            size={15}
            style={{ color: "#5D90CB", animation: busy ? "gp-spin 900ms linear infinite" : undefined }}
          />
          <span className="text-sm font-medium text-white/90">{busy ? "Syncing…" : "Sync now"}</span>
        </div>
        <ChevronRight size={16} style={{ color: "#7C8AA0" }} />
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
            <LogOut size={15} style={{ color: "#E2645D" }} />
            <span className="text-sm font-medium" style={{ color: "#E2645D" }}>Sign out</span>
          </div>
          <ChevronRight size={16} style={{ color: "#7C8AA0" }} />
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
          <div className="p-4 space-y-3">
            <p className="text-xs" style={{ color: "#7C8AA0" }}>
              Your layouts stay on this phone. Sign in again any time.
            </p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.10)" }}>
                Cancel
              </button>
              <button disabled={busy}
                onClick={async () => { setBusy(true); await signOut(); }}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                style={{ background: "rgba(224,87,79,0.12)", color: "#E2645D", border: "1px solid rgba(224,87,79,0.30)" }}>
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
            <Trash2 size={15} style={{ color: "#E2645D" }} />
            <span className="text-sm font-medium" style={{ color: "#E2645D" }}>Delete account</span>
          </div>
          <ChevronRight size={16} style={{ color: "#7C8AA0" }} />
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
      <p className="text-sm font-bold" style={{ color: "#E2645D" }}>Delete this account permanently?</p>
      <p className="text-xs leading-relaxed" style={{ color: "#7C8AA0" }}>
        {email} and every layout backed up to it will be erased. This cannot be undone.
        <br /><br />
        <span style={{ color: "#93A2BB" }}>Layouts saved on this phone are kept</span> — the app
        keeps working without an account.
      </p>
      {error && (
        <div className="p-2.5 rounded-lg text-xs text-center"
          style={{ background: "rgba(224,87,79,0.12)", border: "1px solid rgba(224,87,79,0.25)", color: "#E2645D" }}>
          {error}
        </div>
      )}
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Confirm your password" autoComplete="current-password" autoCapitalize="none"
        className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
        style={{ background: "#1B2230", border: "1px solid rgba(224,87,79,0.25)", color: "#E2E8F0" }}
      />
      <div className="flex gap-2">
        <button disabled={busy}
          onClick={cancel}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.10)" }}>
          Keep my account
        </button>
        <button disabled={busy || !password}
          onClick={confirm}
          className="flex-1 py-2.5 rounded-lg text-xs font-bold disabled:opacity-45"
          style={{ background: "rgba(224,87,79,0.14)", color: "#E2645D", border: "1px solid rgba(224,87,79,0.35)" }}>
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
        <Vibrate size={15} style={{ color: "#7C8AA0" }} />
        <span className="text-sm font-medium text-white/90">Test rumble</span>
      </div>
      <span className="text-xs font-semibold"
        style={{ color: state === "unavailable" ? "#E2645D" : "#5D90CB" }}>
        {!on ? "Rumble off"
          : state === "buzzing" ? "Buzzing…"
          : state === "unavailable" ? "Not supported"
          : "Tap to test"}
      </span>
    </button>
  );
}
