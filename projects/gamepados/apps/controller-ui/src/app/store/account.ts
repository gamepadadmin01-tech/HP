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
