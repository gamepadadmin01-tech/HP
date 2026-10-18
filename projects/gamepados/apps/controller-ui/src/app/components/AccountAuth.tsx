import React, { useState, useEffect } from "react";
import { Eye, EyeOff, ArrowLeft, LoaderCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { signIn, createAccount, confirmEmail, googleAvailable, beginGoogleSignIn, onGoogleResult } from "../store/account";
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

export function AccountAuth({ standalone = false }: { standalone?: boolean } = {}) {
  const reduced = useReducedMotion();
  const formId = React.useId();
  const [mode, setMode] = useState<Mode>("signin");
  useEffect(() => {
    (window as any).__authBack = () => {
      if (mode === "signin") return false;
      go("signin"); return true;
    };
    return () => { delete (window as any).__authBack; };
  }, [mode]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Continue with Google: shown only where the whole flow can work (inside the app, switched
  // on at the server). The result comes back later, through the browser, not from this call.
  const [gAvailable, setGAvailable] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  useEffect(() => {
    let on = true;
    googleAvailable().then((v) => { if (on) setGAvailable(v); });
    return () => { on = false; };
  }, []);
  useEffect(() => onGoogleResult((r) => { setGBusy(false); if (r.ok === false) { setNotice(""); setError(r.message); } }), []);
  // Came back from the browser without finishing (closed it): don't leave the button stuck.
  useEffect(() => {
    if (!gBusy) return;
    const giveUp = setTimeout(() => setGBusy(false), 120000);
    const onFocus = () => setTimeout(() => setGBusy(false), 2500);
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(giveUp); window.removeEventListener("focus", onFocus); };
  }, [gBusy]);
  async function google() {
    if (gBusy || busy) return;
    setError(""); setNotice(""); setGBusy(true);
    try { await beginGoogleSignIn(); }
    catch { setGBusy(false); setError("Couldn't open Google sign-in. Try again."); }
  }

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

  return <motion.section key={mode} className="calm-auth" data-testid={`auth-${mode}-form`} initial={{ opacity: 0, x: reduced ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
    <div className="calm-auth-heading">{!standalone && <span className="console-eyebrow">YOUR PLAYER PROFILE</span>}<h2 data-testid="auth-heading">{title}</h2><p>{blurb}</p></div>
    {mode !== "signin" && <button data-testid="auth-back-signin-button" className="calm-text-button" onClick={() => go("signin")}><ArrowLeft size={17} aria-hidden="true" />Back to sign in</button>}
    {(mode === "signin" || mode === "create") && gAvailable && <>
      <button data-testid="auth-google-button" type="button" className="calm-google-button" onClick={google} disabled={gBusy || busy}>
        {gBusy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <GoogleG />}
        {gBusy ? "Opening Google…" : "Continue with Google"}
      </button>
      <div className="calm-auth-or" role="separator"><span>or use your email</span></div>
    </>}
    <form onSubmit={submit} className="calm-auth-form">
      {error && <Banner tone="error">{error}</Banner>}
      {notice && !error && <Banner tone="info">{notice}</Banner>}
      {mode === "create" && <label className="calm-form-field" htmlFor={`${formId}-name`}><span>Display name</span>
        <input data-testid="auth-name-input" id={`${formId}-name`} value={name} onChange={e=>setName(e.target.value)} autoComplete="name" /></label>}
      {(mode === "signin" || mode === "create" || mode === "forgot") && <label className="calm-form-field" htmlFor={`${formId}-email`}><span>Email address</span>
        <input data-testid="auth-email-input" id={`${formId}-email`} value={email} onChange={e=>setEmail(e.target.value)} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" /></label>}
      {(mode === "verify" || mode === "reset") && <label className="calm-form-field" htmlFor={`${formId}-code`}><span>6-digit email code</span>
        <input data-testid="auth-code-input" id={`${formId}-code`} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g, "").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label>}
      {(mode === "signin" || mode === "create" || mode === "reset") && <div className="calm-form-field"><label htmlFor={`${formId}-password`}>{mode === "signin" ? "Password" : `New password (${MIN_PASSWORD}+ characters)`}</label>
        <div className="calm-password-field"><input data-testid="auth-password-input" id={`${formId}-password`} value={password} onChange={e=>setPassword(e.target.value)} type={show ? "text" : "password"} autoCapitalize="none" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          <button data-testid="auth-password-reveal-button" type="button" onClick={()=>setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      </div>}
      <button data-testid="auth-submit-button" className="calm-primary" type="submit" disabled={!canSubmit || busy}>
        {busy && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "create" ? "Create account" : mode === "verify" ? "Confirm email" : mode === "forgot" ? "Send reset code" : "Change password"}
      </button>
    </form>
    <div className="calm-auth-links">
      {mode === "signin" && <><button data-testid="auth-forgot-password-button" className="calm-text-button" onClick={()=>go("forgot")}>Forgot your password?</button><button data-testid="auth-create-account-button" className="calm-text-button" onClick={()=>go("create")}>Create an account</button></>}
      {mode === "verify" && <button className="calm-text-button" onClick={resend} disabled={busy}>Didn’t get it? Send a new code</button>}
      {mode === "create" && <button className="calm-text-button" onClick={()=>go("signin")}>Already have an account? Sign in</button>}
    </div>
  </motion.section>;
}

/** The Google "G", in Google's own colours (required by their branding rules for the button). */
function GoogleG() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

function Banner({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return <div className={`calm-form-message ${tone === "error" ? "calm-form-error" : ""}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
