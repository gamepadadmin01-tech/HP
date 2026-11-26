import { useEffect, useState } from "react";
import { getSession, onSessionChange, revalidate, signOut, type Session } from "../app/store/account";
import { getMe } from "../app/api/billing";
import { ApiError } from "../app/api/account";

/**
 * CamOS's account (owner, 2026-11-26: payments "same as GamepadOS"). The same GamepadOS account signs in here, and
 * Premium is simply "this account owns Lifetime" — bought in either app (or on the website), decided by the server.
 *
 * The last answer is kept on the phone, so Premium keeps working offline or when the server is slow; it is asked
 * again on opening the app, after signing in, and whenever CamOS comes back to the screen.
 */
const CACHE = "camos.lifetime";

type Cached = { userId: string; lifetime: boolean };

function readCache(session: Session): boolean {
  if (!session) return false;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || "null") as Cached | null;
    return !!c && c.userId === session.user.id && c.lifetime === true;
  } catch { return false; }
}

function writeCache(userId: string | null, lifetime: boolean) {
  try {
    if (userId) localStorage.setItem(CACHE, JSON.stringify({ userId, lifetime }));
    else localStorage.removeItem(CACHE);
  } catch { /* storage refused: the next check asks the server again */ }
}

export type Account = {
  session: Session;
  /** The account owns Lifetime (CamOS Premium). */
  lifetime: boolean;
  checking: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAccount(): Account {
  const [session, setSession] = useState<Session>(() => getSession());
  const [lifetime, setLifetime] = useState<boolean>(() => readCache(getSession()));
  const [checking, setChecking] = useState(false);

  useEffect(() => onSessionChange(() => setSession(getSession())), []);
  useEffect(() => { revalidate().catch(() => {}); }, []);

  const refresh = async () => {
    const s = getSession();
    if (!s) { setLifetime(false); writeCache(null, false); return; }
    setChecking(true);
    try {
      const me = await getMe(s.token);
      const lt = me.plan === "LIFETIME";
      setLifetime(lt);
      writeCache(s.user.id, lt);
    } catch (e) {
      // Signed out on the server (token expired): the account store notices on revalidate; keep the last answer
      // for anything else (no network), so a Premium user isn't locked out on a train.
      if (e instanceof ApiError && e.code === "unauthenticated") { setLifetime(false); writeCache(null, false); }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { setLifetime(readCache(session)); refresh(); }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  return { session, lifetime, checking, refresh, signOut: async () => { await signOut(); setLifetime(false); writeCache(null, false); } };
}
