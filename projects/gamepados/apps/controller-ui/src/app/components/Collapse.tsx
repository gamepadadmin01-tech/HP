// ─── Open and close, without the reflow ───────────────────────────────────────
//
// Every disclosure in the app used Framer's `animate={{ height: "auto" }}`:
// a JavaScript loop writing a new pixel height every frame, each write forcing
// the browser to re-lay-out everything below. That was the first stutter.
//
// The first replacement transitioned `grid-template-rows: 0fr -> 1fr` in CSS.
// Better — no JS in the loop — but STILL a layout animation: the browser
// re-lays-out the column on every frame of the transition, just on its own
// schedule. On the phone that remained visible when the plans list opened.
//
// So there are two modes, because the honest trade-off differs by use:
//
//   "reveal" — ZERO per-frame layout. The row snaps open in a single layout
//   pass, and all visible motion is the content fading and sliding in — both
//   compositor properties, both free. Closing fades first, then snaps shut.
//   Use for anything toggled often or sitting in a long column (the plans).
//
//   "slide" — the grid-row CSS transition. Genuinely animates the space, at
//   the cost of layout during the transition. Use for rare, small motions
//   where the sliding space IS the point (dismissing the banner, once ever).
//
// The children stay MOUNTED when closed. Re-mounting three plan cards on every
// toggle costs more than keeping them, and would throw away state they hold.

import React, { useEffect, useRef, useState } from "react";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function Collapse({
  open,
  children,
  durationMs = 220,
  mode = "reveal",
}: {
  open: boolean;
  children: React.ReactNode;
  durationMs?: number;
  mode?: "reveal" | "slide";
}) {
  return mode === "slide"
    ? <SlideCollapse open={open} durationMs={durationMs}>{children}</SlideCollapse>
    : <RevealCollapse open={open} durationMs={durationMs}>{children}</RevealCollapse>;
}

// ── "reveal": one layout pass, compositor-only motion ─────────────────────────

function RevealCollapse({
  open, durationMs, children,
}: { open: boolean; durationMs: number; children: React.ReactNode }) {
  // Two flags on purpose: the row and the content move at different moments.
  // Opening: expand NOW (one reflow), fade content in a frame later.
  // Closing: fade content out first, snap the row shut after it has gone —
  // collapsing a row full of visible content reads as it being crushed.
  const [expanded, setExpanded] = useState(open);
  const [shown, setShown] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (open) {
      setExpanded(true);
      // Next frame, so the browser has painted the expanded-but-transparent
      // state and the opacity change actually transitions instead of applying
      // in the same style pass. The timer is a FAILSAFE, not a race: rAF does
      // not fire while a WebView is throttled or hidden, and without it the
      // panel could sit expanded but fully transparent until the next repaint.
      // Both setters are idempotent, so whichever lands first wins harmlessly.
      raf.current = requestAnimationFrame(() => setShown(true));
      timer.current = setTimeout(() => setShown(true), 90);
    } else {
      setShown(false);
      timer.current = setTimeout(() => setExpanded(false), Math.round(durationMs * 0.7));
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [open, durationMs]);

  return (
    <div style={{ display: "grid", gridTemplateRows: expanded ? "1fr" : "0fr" }}>
      <div
        aria-hidden={!open}
        {...(!open ? { inert: "" as unknown as boolean } : {})}
        style={{
          overflow: "hidden",
          minHeight: 0,
          opacity: shown ? 1 : 0,
          transform: shown ? "translateY(0)" : "translateY(-6px)",
          transition: `opacity ${durationMs}ms ease, transform ${durationMs}ms ${EASE}`,
          willChange: "opacity, transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── "slide": the space itself animates (layout runs during it — use rarely) ───

function SlideCollapse({
  open, durationMs, children,
}: { open: boolean; durationMs: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${durationMs}ms ${EASE}`,
      }}
    >
      <div
        aria-hidden={!open}
        {...(!open ? { inert: "" as unknown as boolean } : {})}
        style={{
          overflow: "hidden",
          minHeight: 0,
          opacity: open ? 1 : 0,
          transition: `opacity ${Math.round(durationMs * 0.7)}ms ease`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
