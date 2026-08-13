import React, { useState } from "react";
import { Gamepad2, Mail, Lock, User as UserIcon, Eye, EyeOff, ArrowLeft, KeyRound } from "lucide-react";
import { signIn, createAccount, confirmEmail } from "../store/account";
import { ApiError, forgotPassword, resetPassword, resendCode } from "../api/account";

// ─── Sign in / create account ─────────────────────────────────────────────────
//
// The signed-out Account tab. Standard flows, nothing invented:
//
//   sign in ──> signed in
//      │  └─ forgot ──> emailed code ──> new password ──> sign in
//      └─ create ──> emailed 6-digit code ──> verify ──> signed in
//
// Rules it follows because real apps do:
//   • the submit button is disabled until the form can actually succeed;
//   • server errors are shown verbatim, never flattened to "an error occurred";
//   • the password field can be revealed, because typing one blind on a phone
//     keyboard is how people get locked out;
//   • an unverified sign-in attempt is routed to the verify step instead of
//     dead-ending on an error.

type Mode = "signin" | "create" | "verify" | "forgot" | "reset";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;

export function AccountAuth() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const emailOk = EMAIL_RE.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const nameOk = name.trim().length >= 2;
  const codeOk = /^\d{6}$/.test(code.trim());

  const canSubmit =
    mode === "signin" ? emailOk && password.length > 0
    : mode === "create" ? nameOk && emailOk && passwordOk
    : mode === "verify" ? codeOk
    : mode === "forgot" ? emailOk
    : codeOk && passwordOk;

  function go(next: Mode) {
    setMode(next); setError(""); setNotice("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else if (mode === "create") {
        await createAccount(name, email, password);
        setNotice(`We sent a 6-digit code to ${email.trim()}.`);
        setMode("verify");
      } else if (mode === "verify") {
        await confirmEmail(email, code);
      } else if (mode === "forgot") {
        await forgotPassword(email.trim().toLowerCase());
        setNotice(`If that email has an account, a reset code is on its way.`);
        setMode("reset");
      } else {
        await resetPassword(email.trim().toLowerCase(), code.trim(), password);
        setNotice("Password changed. Sign in with your new password.");
        setCode(""); setPassword(""); setMode("signin");
      }
    } catch (err) {
      const e2 = err as ApiError;
      // An unverified account trying to sign in belongs on the verify step, not
      // staring at an error it can do nothing about.
      if (e2.code === "unverified") {
        setNotice("Confirm your email to finish setting up your account.");
        setMode("verify");
      } else {
        setError(e2.message || "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await resendCode(email.trim().toLowerCase());
      setNotice("New code sent.");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin" ? "Sign in"
    : mode === "create" ? "Create your account"
    : mode === "verify" ? "Confirm your email"
    : mode === "forgot" ? "Reset password"
    : "Choose a new password";

  const blurb =
    mode === "signin" ? "Sign in to keep your controller layouts safe."
    : mode === "create" ? "Save your layouts and get them back on any phone."
    : mode === "verify" ? `Enter the 6-digit code sent to ${email.trim() || "your email"}.`
    : mode === "forgot" ? "We'll email you a code to set a new password."
    : "Enter the code from your email and a new password.";

  return (
    <div className="pt-2 pb-10">
      {/* Brand */}
      <div className="flex flex-col items-center mb-7">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: "rgba(79,134,198,0.12)",
            border: "1px solid rgba(79,134,198,0.25)",
            boxShadow: "0 0 28px rgba(79,134,198,0.18)",
          }}>
          <Gamepad2 size={30} style={{ color: "#5D90CB" }} />
        </div>
        <h2 className="text-xl font-bold text-white text-center"
          style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{title}</h2>
        <p className="text-xs mt-1.5 text-center px-4" style={{ color: "#7C8AA0" }}>{blurb}</p>
      </div>

      {mode !== "signin" && (
        <button onClick={() => go(mode === "verify" || mode === "create" ? "signin" : "signin")}
          className="flex items-center gap-1.5 text-xs font-semibold mb-4"
          style={{ color: "#7C8AA0" }}>
          <ArrowLeft size={13} /> Back to sign in
        </button>
      )}

      <form onSubmit={submit} className="space-y-3">
        {error && <Banner tone="error">{error}</Banner>}
        {notice && !error && <Banner tone="info">{notice}</Banner>}

        {mode === "create" && (
          <Field icon={<UserIcon size={15} />}>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Display name" autoComplete="name" style={inputStyle} />
          </Field>
        )}

        {(mode === "signin" || mode === "create" || mode === "forgot") && (
          <Field icon={<Mail size={15} />}>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
              placeholder="Email address" autoComplete="email" style={inputStyle} />
          </Field>
        )}

        {(mode === "verify" || mode === "reset") && (
          <Field icon={<KeyRound size={15} />}>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" placeholder="6-digit code" autoComplete="one-time-code"
              style={{ ...inputStyle, letterSpacing: "0.35em", fontWeight: 700 }} />
          </Field>
        )}

        {(mode === "signin" || mode === "create" || mode === "reset") && (
          <Field icon={<Lock size={15} />}>
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type={show ? "text" : "password"} autoCapitalize="none"
              placeholder={mode === "signin" ? "Password" : `Password (${MIN_PASSWORD}+ characters)`}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              style={{ ...inputStyle, paddingRight: 44 }} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-3" style={{ color: "#7C8AA0" }}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </Field>
        )}

        <button type="submit" disabled={!canSubmit || busy}
          className="w-full py-3.5 rounded-xl font-bold text-sm tracking-wide transition-all active:scale-[0.99] disabled:opacity-45"
          style={{
            fontFamily: "'Space Grotesk',sans-serif",
            background: "#5D90CB", color: "#0B0E14",
            boxShadow: canSubmit && !busy ? "0 0 18px rgba(79,134,198,0.30)" : "none",
          }}>
          {busy ? "Please wait…"
            : mode === "signin" ? "Sign in"
            : mode === "create" ? "Create account"
            : mode === "verify" ? "Confirm email"
            : mode === "forgot" ? "Send reset code"
            : "Change password"}
        </button>
      </form>

      {/* Secondary actions */}
      <div className="mt-5 space-y-2 text-center">
        {mode === "signin" && (
          <>
            <button onClick={() => go("forgot")} className="text-xs font-semibold" style={{ color: "#7C8AA0" }}>
              Forgot your password?
            </button>
            <p className="text-xs" style={{ color: "#7C8AA0" }}>
              New here?{" "}
              <button onClick={() => go("create")} className="font-bold" style={{ color: "#5D90CB" }}>
                Create an account
              </button>
            </p>
          </>
        )}
        {mode === "verify" && (
          <button onClick={resend} disabled={busy} className="text-xs font-semibold disabled:opacity-50"
            style={{ color: "#5D90CB" }}>
            Didn't get it? Send a new code
          </button>
        )}
        {mode === "create" && (
          <p className="text-xs" style={{ color: "#7C8AA0" }}>
            Already have an account?{" "}
            <button onClick={() => go("signin")} className="font-bold" style={{ color: "#5D90CB" }}>Sign in</button>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1B2230",
  border: "1px solid rgba(79,134,198,0.14)",
  color: "#E2E8F0",
  borderRadius: 12,
  padding: "13px 14px 13px 40px",
  fontSize: 14,
  fontFamily: "'Inter',sans-serif",
  outline: "none",
};

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#7C8AA0" }}>
        {icon}
      </span>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const error = tone === "error";
  return (
    <div className="p-3 rounded-xl text-xs text-center leading-relaxed"
      style={{
        background: error ? "rgba(224,87,79,0.12)" : "rgba(79,134,198,0.10)",
        border: `1px solid ${error ? "rgba(224,87,79,0.25)" : "rgba(79,134,198,0.22)"}`,
        color: error ? "#E2645D" : "#93A2BB",
      }}>
      {children}
    </div>
  );
}
