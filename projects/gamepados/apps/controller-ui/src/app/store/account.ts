// ─── Account state ────────────────────────────────────────────────────────────
//
// Who is signed in, plus the session token. Signed out is a normal state and the
// controller works fully in it — the input path never reads this file. What
// signing in adds is the account surface, not the ability to play.
//
// Session handling follows what any real app does:
//   • the token and a cached user are persisted, so the app opens already signed
//     in instead of flashing a login screen on every launch;
//   • the cached user is revalidated against the server in the background, and a
//     rejected token signs out cleanly rather than leaving a stale identity;
//   • a network failure during revalidation does NOT sign the user out — being
//     offline is not the same as being logged out.

import { readJson, writeJson, remove, KEYS } from "./storage";
import * as api from "../api/account";

export type Session = {
  token: string;
  user: api.User;
} | null;

const listeners = new Set<() => void>();
let current: Session = null;
let loaded = false;
let revalidated = false;

function isSession(v: unknown): v is NonNullable<Session> {
  if (typeof v !== "object" || v === null) return false;
  const s = v as any;
  return typeof s.token === "string" && s.token.length > 0
    && typeof s.user?.email === "string" && typeof s.user?.displayName === "string";
}

function load(): Session {
  if (!loaded) {
    const stored = readJson<unknown>(KEYS.account, null);
    current = isSession(stored) ? stored : null;
    loaded = true;
  }
  return current;
}

function persist() {
  if (current) writeJson(KEYS.account, current);
  else remove(KEYS.account);
}

function emit() {
  listeners.forEach((fn) => fn());
}

/** Current session, or null when signed out. Safe to call during render. */
export function getSession(): Session {
  return load();
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function adopt(token: string, user: api.User) {
  current = { token, user };
  loaded = true;
  persist();
  emit();
}

function clear() {
  current = null;
  loaded = true;
  persist();
  emit();
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<void> {
  const r = await api.login(email.trim().toLowerCase(), password);
  adopt(r.token, r.user);
}

export async function createAccount(displayName: string, email: string, password: string) {
  await api.register(email.trim().toLowerCase(), password, displayName.trim());
}

export async function confirmEmail(email: string, code: string): Promise<void> {
  const r = await api.verify(email.trim().toLowerCase(), code.trim());
  adopt(r.token, r.user);
}

export async function signOut(): Promise<void> {
  const token = current?.token;
  // Drop local state first: the user asked to be signed out, and that must not
  // depend on the network succeeding.
  clear();
  if (token) {
    try { await api.logout(token); } catch { /* server-side cleanup is best-effort */ }
  }
}

/**
 * Delete the account on the server, then sign out locally.
 *
 * Layouts on this phone are left alone on purpose — the app works fine without
 * an account, and wiping someone's work as a side effect of closing an account
 * would be a cruel reading of "delete my account". The sync bookkeeping IS
 * cleared, so nothing tries to upload to an account that no longer exists.
 */
export async function deleteAccount(password: string): Promise<void> {
  const s = load();
  if (!s) throw new api.ApiError("You are not signed in.", "unauthenticated");
  await api.deleteAccount(s.token, password);
  try {
    remove(KEYS.lastSync);
    remove(KEYS.syncMark);
    remove(KEYS.deletedPads);
  } catch { /* storage unavailable — the sign-out below still matters */ }
  clear();
}

// ─── Sign in with Google ──────────────────────────────────────────────────────
//
// Two doors, one account.
//
// 1. NATIVE (preferred): on phones with Google Play services the app opens Android's own
//    Google account chooser over the app and gets an ID token back, with no browser. A
//    server-issued single-use nonce binds that token to this attempt (see google.js).
// 2. BROWSER (fallback): Google refuses OAuth inside an embedded WebView, so otherwise the
//    flow runs in the phone's browser and comes back through the gamepados://auth deep link
//    (MainActivity keeps the result until we ask for it with takeAuthReturn). `verifier`
//    stays on the phone until we redeem the one-time code; that is what stops another app
//    from firing the deep link with ITS code and signing us in as someone else.
//
// Anything that stops the native door (no Google Play services, no account on the phone, an
// error) falls through to the browser, so the button always has a way to work.
// See website/backend/google.js and docs/GOOGLE_SIGNIN_SETUP.md.

const GOOGLE_PENDING_KEY = "google_signin_pending";
const GOOGLE_PENDING_MS = 15 * 60 * 1000;

export type GoogleResult = { ok: true } | { ok: false; message: string };
const googleListeners = new Set<(r: GoogleResult) => void>();

/** Told when a Google sign-in finishes or fails, so the sign-in form can react. */
export function onGoogleResult(fn: (r: GoogleResult) => void): () => void {
  googleListeners.add(fn);
  return () => { googleListeners.delete(fn); };
}

function emitGoogle(r: GoogleResult) {
  googleListeners.forEach((fn) => fn(r));
}

const androidBridge = () => (typeof window !== "undefined" ? (window as any).AndroidBridge : undefined);

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let googleAvail: Promise<boolean> | null = null;
/** The public web client id the server reports, which Android's account chooser needs. */
let googleWebClientId: string | undefined;
/** The native attempt in flight: the nonce we asked the server for. */
let nativePending: { nonce: string; at: number } | null = null;

/** True only where the flow can actually work: inside the app (it needs the browser
 *  hand-off and the deep-link return), with SHA-256 available, and switched on at the
 *  server. Everywhere else the button is simply not shown. */
export function googleAvailable(): Promise<boolean> {
  if (!googleAvail) {
    googleAvail = (async () => {
      const b = androidBridge();
      // Truthiness, like every other bridge check in this app (e.g. startApkUpdate): a
      // method on a WebView JavaScript interface is present or absent, nothing more.
      if (!b?.openUrl || !b?.takeAuthReturn) return false;
      if (!globalThis.crypto?.subtle) return false;
      const cfg = await api.googleConfig();
      googleWebClientId = cfg.webClientId;
      return cfg.enabled;
    })();
    // Remember a "yes" for the life of the app, but forget a "no": it may only mean the
    // phone was offline, or the server had not switched Google on yet, and the next visit
    // to the sign-in page should ask again instead of staying hidden until the app is killed.
    const asked = googleAvail;
    asked.then((ok) => { if (!ok && googleAvail === asked) googleAvail = null; });
  }
  return googleAvail;
}

/** Start Google sign-in. The result arrives later through onGoogleResult. Uses Android's own
 *  account chooser where the app has it, and the browser where it does not or it fails. */
export async function beginGoogleSignIn(): Promise<void> {
  const b = androidBridge();
  if (b?.googleSignInNative && googleWebClientId) {
    try {
      const nonce = await api.googleNonce();
      nativePending = { nonce, at: Date.now() };
      b.googleSignInNative(googleWebClientId, nonce);
      return;
    } catch {
      nativePending = null;   // no nonce (offline?) or the call failed: the browser flow below reports what is wrong
    }
  }
  await beginBrowserGoogleSignIn();
}

/** The native door answered: { idToken } to redeem, { error: "cancelled" } if the person closed it,
 *  anything else (not available on this phone, a failure) means try the browser instead. */
async function onNativeGoogleResult(raw: unknown) {
  let data: { idToken?: string; error?: string } = {};
  try { data = JSON.parse(String(raw)); } catch { return; }
  const pending = nativePending;
  nativePending = null;
  if (!pending || Date.now() - pending.at > GOOGLE_PENDING_MS) return;   // stale or unexpected: ignore
  if (data.idToken) {
    try {
      const r = await api.googleIdToken(data.idToken, pending.nonce);
      adopt(r.token, r.user);
      emitGoogle({ ok: true });
    } catch (e) {
      emitGoogle({ ok: false, message: (e as api.ApiError).message || "Google sign-in didn't work. Try again." });
    }
    return;
  }
  if (data.error === "cancelled") { emitGoogle({ ok: false, message: GOOGLE_MESSAGES.cancelled }); return; }
  try { await beginBrowserGoogleSignIn(); }
  catch { emitGoogle({ ok: false, message: "Couldn't open Google sign-in. Try again." }); }
}

/** Open Google's sign-in in the browser (the fallback door). */
async function beginBrowserGoogleSignIn(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));          // 43 chars
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  try { localStorage.setItem(GOOGLE_PENDING_KEY, JSON.stringify({ verifier, at: Date.now() })); } catch { /* private mode: the return will say it expired */ }
  androidBridge().openUrl(api.googleStartUrl(challenge));
}

const GOOGLE_MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  unverified: "Google says that email address isn't verified, so it can't be used.",
  expired: "That sign-in took too long. Try again.",
  disabled: "Google sign-in isn't available right now.",
};

async function finishGoogleSignIn(code: string) {
  let pending: { verifier?: string; at?: number } | null = null;
  try { pending = JSON.parse(localStorage.getItem(GOOGLE_PENDING_KEY) || "null"); } catch { pending = null; }
  try { localStorage.removeItem(GOOGLE_PENDING_KEY); } catch { /* ignore */ }
  if (!pending?.verifier || !pending.at || Date.now() - pending.at > GOOGLE_PENDING_MS) {
    emitGoogle({ ok: false, message: GOOGLE_MESSAGES.expired });
    return;
  }
  try {
    const r = await api.googleExchange(code, pending.verifier);
    adopt(r.token, r.user);
    emitGoogle({ ok: true });
  } catch (e) {
    emitGoogle({ ok: false, message: (e as api.ApiError).message || "Google sign-in didn't work. Try again." });
  }
}

/** Ask the app whether the browser has come back with a sign-in result. */
function checkAuthReturn() {
  let raw = "";
  try { raw = String(androidBridge()?.takeAuthReturn?.() || ""); } catch { raw = ""; }
  if (!raw) return;
  let data: { code?: string; error?: string } = {};
  try { data = JSON.parse(raw); } catch { return; }
  if (data.code) void finishGoogleSignIn(data.code);
  else emitGoogle({ ok: false, message: GOOGLE_MESSAGES[data.error || ""] || "Google sign-in didn't work. Try again." });
}

if (typeof window !== "undefined") {
  (window as any).onNativeGoogleResult = onNativeGoogleResult;   // called by AdsBridge.googleSignInNative
  window.addEventListener("gamepados:auth-return", checkAuthReturn);
  window.addEventListener("focus", checkAuthReturn);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAuthReturn(); });
  setTimeout(checkAuthReturn, 0);   // the app was opened cold by the deep link
}

/** Confirm the stored token is still good. Called once at startup.
 *  Signs out only on an explicit rejection — never on a network error. */
export async function revalidate(): Promise<void> {
  if (revalidated) return;
  revalidated = true;
  const s = load();
  if (!s) return;
  try {
    const r = await api.me(s.token);
    if (r.user.email !== s.user.email || r.user.displayName !== s.user.displayName) {
      adopt(s.token, r.user);   // profile changed elsewhere
    }
  } catch (e) {
    if (e instanceof api.ApiError && e.code === "network") return;  // offline: keep session
    clear();
  }
}
