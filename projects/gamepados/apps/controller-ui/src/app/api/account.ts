// ─── Account API client ───────────────────────────────────────────────────────
//
// The only place that talks to the accounts backend. One request helper, one
// error shape, so every screen reports the same way and no component has to
// know about fetch, tokens or status codes.
//
// Auth is a bearer token, not a cookie: the WebView is served from
// appassets.androidplatform.net and the API lives on gamepad.space, so a cookie
// would be third-party and dropped.

const BASE = "https://supportportal.gamepad.space/api/account";

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

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // Offline, DNS, TLS — never a silent failure.
    throw new ApiError("Couldn't reach GamepadOS. Check your connection.", "network");
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
