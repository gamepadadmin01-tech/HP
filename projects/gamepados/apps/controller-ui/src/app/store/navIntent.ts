// ─── "Take me to that tab" ────────────────────────────────────────────────────
//
// The dashboard's tab lives inside HomeScreen's own state, and the controller is
// a sibling view rendered over the top of it. So a button on the controller had
// no way to say "go back AND open Account" — it could only call onBack(), which
// returns to whichever tab was last open, usually Home.
//
// That is why the lockout's "See plans in Account" button appeared to do
// nothing: it did navigate, just to the wrong place, landing the user on Home
// with no idea what they were meant to do next.
//
// A one-value channel rather than lifting the tab into App.tsx: App.tsx is
// ~5,000 lines with a corruption incident behind it, and threading a controlled
// tab prop through it touches far more of that file than this does.

import type { DashTab } from "../types";

type Listener = (tab: DashTab) => void;

const listeners = new Set<Listener>();

/** Set when a request arrives with nobody listening — HomeScreen mounts or
 *  re-subscribes a moment later and picks it up. Without this the request is
 *  lost in exactly the case that matters: navigating from another view. */
let pending: DashTab | null = null;

export function requestDashboardTab(tab: DashTab): void {
  if (listeners.size === 0) {
    pending = tab;
    return;
  }
  listeners.forEach((fn) => fn(tab));
}

export function onDashboardTabRequest(fn: Listener): () => void {
  listeners.add(fn);
  // Deliver anything that arrived before this listener existed, once.
  if (pending !== null) {
    const t = pending;
    pending = null;
    fn(t);
  }
  return () => listeners.delete(fn);
}
