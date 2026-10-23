// ─── Account API client ───────────────────────────────────────────────────────
//
// The only place that talks to the accounts backend. One request helper, one
// error shape, so every screen reports the same way and no component has to
// know about fetch, tokens or status codes.
//
// Auth is a bearer token, not a cookie: the WebView is served from
// appassets.androidplatform.net and the API lives on gamepad.space, so a cookie
// would be third-party and dropped.

/** Backend origin. Exported because billing lives at /api/billing and /api/play,
 *  not under /api/account — one host, declared once.
 *
 *  Overridable at BUILD time with VITE_API_ORIGIN so a test build can be pointed
 *  at a backend on the LAN — the same pattern the website uses (VITE_API_BASE in
 *  website/frontend/js/config.js). Unset, which is every real build, it is
 *  production. Nothing reads it at runtime, so a shipped APK cannot be
 *  redirected by anything on the device. */
export const API_ORIGIN = (
  (import.meta as any).env?.VITE_API_ORIGIN || "https://supportportal.gamepad.space"
).replace(/\/+$/, "");

const BASE = `${API_ORIGIN}/api/account`;

export type User = { id: string; email: string; displayName: string };

/** Thrown for every failure — network, validation or server. `message` is safe
 *  to show the user; `code` lets a screen react (e.g. unverified → verify step). */
export class ApiError extends Error {
  code: string;
  constructor(message: string, code = "error") {
    super(message);
    this.code = code;
  }
}

/** See the matching note in api/billing.ts — a hung fetch never rejects, so
 *  without a deadline the "never a silent failure" promise below only held for
 *  requests that failed outright, not for ones that simply never answered.
 *  That is what made the app slower on Wi-Fi than with no network at all:
 *  no route fails instantly, a route to nowhere black-holes. */
const REQUEST_TIMEOUT_MS = 10_000;

function deadline(ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  const d = deadline(REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: d.signal,
    });
  } catch (e) {
    // Offline, DNS, TLS, or a server that never answered — never a silent failure.
    throw new ApiError(
      (e as { name?: string } | null)?.name === "AbortError"
        ? "GamepadOS took too long to respond. Try again in a moment."
        : "Couldn't reach GamepadOS. Check your connection.",
      "network"
    );
  } finally {
    d.clear();
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body — handled below */
  }

  if (!res.ok || !payload?.success) {
    throw new ApiError(
      payload?.error || `Something went wrong (${res.status}).`,
      payload?.code || String(res.status),
    );
  }
  return payload as T;
}

export function register(email: string, password: string, displayName: string) {
  return request<{ success: true }>("/register", { email, password, displayName });
}

export function verify(email: string, code: string) {
  return request<{ success: true; token: string; user: User }>("/verify", { email, code });
}

export function resendCode(email: string) {
  return request<{ success: true }>("/resend", { email });
}

export function login(email: string, password: string) {
  return request<{ success: true; token: string; user: User }>("/login", { email, password });
}

// ── Sign in with Google (system browser + one-time code; see website/backend/google.js) ──
/** Is Google sign-in switched on at the server, and which web client id does it use?
 *  Older servers have no such route (or no client id): { enabled: false } / no id. */
export async function googleConfig(): Promise<{ enabled: boolean; webClientId?: string }> {
  try {
    const r = await request<{ success: true; enabled: boolean; webClientId?: string }>("/google/config");
    return { enabled: r.enabled === true, webClientId: typeof r.webClientId === "string" && r.webClientId ? r.webClientId : undefined };
  } catch {
    return { enabled: false };
  }
}

/** A single-use nonce for the native flow: Google writes it into the ID token, we check it comes back. */
export async function googleNonce(): Promise<string> {
  const r = await request<{ success: true; nonce: string }>("/google/nonce");
  return r.nonce;
}

/** Trade the ID token from Android's own Google account chooser (plus our nonce) for a session. */
export function googleIdToken(idToken: string, nonce: string) {
  return request<{ success: true; token: string; user: User }>("/google/idtoken", { idToken, nonce });
}

/** Where the browser goes to start the flow. `challenge` is SHA-256(verifier), base64url. */
export function googleStartUrl(challenge: string) {
  return `${BASE}/google/start?challenge=${encodeURIComponent(challenge)}`;
}

/** Trade the one-time code from the deep link (plus our verifier) for a normal session. */
export function googleExchange(code: string, verifier: string) {
  return request<{ success: true; token: string; user: User }>("/google/exchange", { code, verifier });
}

export function me(token: string) {
  return request<{ success: true; user: User }>("/me", undefined, token);
}

export function logout(token: string) {
  return request<{ success: true }>("/logout", {}, token);
}

/** Irreversible. Requires the current password even though we hold a session. */
export function deleteAccount(token: string, password: string) {
  return request<{ success: true }>("/delete", { password }, token);
}

export function forgotPassword(email: string) {
  return request<{ success: true }>("/password/forgot", { email });
}

export function resetPassword(email: string, code: string, password: string) {
  return request<{ success: true }>("/password/reset", { email, code, password });
}
