// ─── The on-controller time chip ──────────────────────────────────────────────
//
// Replaces GuestTrialPill (signed-out only, fixed at the bottom). Now shown to
// EVERYONE on a time limit — free time + ad bank, signed in or out — hidden on an
// unlimited plan, and DRAGGABLE anywhere on the controller screen so it never
// sits on the buttons a player uses. It stays where they put it, next session
// too (owner's request, 2026-09-30).
//
// A tap (no real movement) still does what the pill did: goes where more time
// is — the plan panel with the "Watch an ad" button (and Lifetime, where sold).
//
// How it coexists with the native touch path. Over Wi-Fi, NativeInputEngine.kt
// captures touches ABOVE the WebView and ignores DOM z-index. It declines
// touches inside "exclusion" rects — every element marked data-nx — which is
// how the chip receives its drag at all. Those rects are sent to native once,
// at activation, so after a move (or when the chip appears) this dispatches
// NX_CHANGED and ControllerScreen re-sends them. The trade-off, and the reason
// it is movable: wherever the chip is parked, that small area belongs to it.
//
// Cost: subscribes to a short string that changes once a minute (every second
// only in the final minute), and moves by transform only — no layout.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { getRemainingLabel, getRemainingMinutes, onPlaytimeChange } from "../store/playtime";
import { readJson, writeJson, KEYS } from "../store/storage";

export const NX_CHANGED = "gp:nx-changed";
const announce = () => { try { window.dispatchEvent(new Event(NX_CHANGED)); } catch { /* old WebView */ } };

type Pos = { fx: number; fy: number } | null;   // top-left as fractions of the viewport; null = default
const MARGIN = 4;
const BOTTOM = 8;                                // default: where the old pill sat
const TAP_SLOP = 8;                              // px of movement before a press becomes a drag

function clampPx(x: number, y: number, w: number, h: number) {
  const W = window.innerWidth, H = window.innerHeight;
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, W - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, H - h - MARGIN)),
  };
}

export function PlaytimeChip({ onTap }: { onTap: () => void }) {
  const label = useSyncExternalStore(onPlaytimeChange, getRemainingLabel, getRemainingLabel);
  const minutes = useSyncExternalStore(onPlaytimeChange, getRemainingMinutes, getRemainingMinutes);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos>(() => {
    const p = readJson<Pos>(KEYS.timeChipPos, null);
    return p && Number.isFinite(p.fx) && Number.isFinite(p.fy) ? p : null;
  });
  const drag = useRef<{ id: number; dx: number; dy: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const visible = label !== null;

  const place = useCallback((p: Pos) => {
    const el = ref.current;
    if (!el) return { x: 0, y: 0 };
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!p) return clampPx(window.innerWidth * 0.4 - w / 2, window.innerHeight - h - BOTTOM, w, h);
    return clampPx(p.fx * window.innerWidth, p.fy * window.innerHeight, w, h);
  }, []);

  const apply = (x: number, y: number) => {
    if (ref.current) ref.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };

  // Position on appear / move / label width change; then re-send the exclusions.
  useLayoutEffect(() => {
    if (!visible) return;
    const { x, y } = place(pos);
    apply(x, y);
    announce();
  }, [visible, pos, place, label]);

  useEffect(() => {
    if (!visible) return;
    const onResize = () => { const { x, y } = place(pos); apply(x, y); announce(); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); announce(); };
  }, [visible, pos, place]);

  if (!visible) return null;

  const urgent = minutes !== null && minutes <= 5;

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, el = ref.current;
    if (!d || d.id !== e.pointerId || !el) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TAP_SLOP) return;
    d.moved = true;
    const c = clampPx(e.clientX - d.dx, e.clientY - d.dy, el.offsetWidth, el.offsetHeight);
    d.x = c.x; d.y = c.y;
    apply(c.x, c.y);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    if (!d.moved) {
      if (e.type === "pointerup") onTap();
      return;
    }
    const next = { fx: d.x / window.innerWidth, fy: d.y / window.innerHeight };
    writeJson(KEYS.timeChipPos, next);
    setPos(next);                                  // layout effect re-applies + announces
  };

  return (
    <button
      ref={ref}
      type="button"
      data-nx="1"
      className="guest-trial-pill playtime-chip"
      aria-label={`${label} of play left. Tap for more time, drag to move.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      style={{
        // Positioned by transform alone (see apply) — override the pill's own
        // bottom/left/translate so the two never fight.
        left: 0, top: 0, bottom: "auto",
        touchAction: "none",
        willChange: "transform",
        borderColor: urgent ? "rgba(226,100,93,.55)" : undefined,
      }}
    >
      <Clock size={12} style={{ color: urgent ? "#E2645D" : undefined }} /> {label} left
    </button>
  );
}
