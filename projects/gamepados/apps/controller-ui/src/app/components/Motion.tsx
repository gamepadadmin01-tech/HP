// ─── Shared motion pieces (owner, 2026-11-08: "same kind of animation for the same set of actions") ──────────
//
// Every drop-down in the app opens and closes the same way (Collapse), every "switch what is shown" uses the
// same quick fade-up (SwapIn), and every choice bar slides its orange pill the same way (ChoiceBar). They are
// CSS-driven on purpose: the browser animates them itself (grid rows, transform, opacity), so nothing runs in
// JavaScript on every frame, which is what made the old height animations feel laggy in the phone's WebView.
// Styles: redesign.css, section 20. Reduced motion turns all of it off there.

import React, { useLayoutEffect, useRef, useState } from "react";

/** Opens and closes its content smoothly. The content stays in the page (so closing animates too) but is
 *  hidden from taps, focus and screen readers while closed. */
export function Collapse({ open, children, className = "", id }: {
  open: boolean; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <div id={id} className={`calm-collapse ${className}`} data-open={open ? "1" : "0"} aria-hidden={!open}
      {...(!open ? { inert: "" as unknown as boolean } : {})}>
      <div className="calm-collapse-inner">{children}</div>
    </div>
  );
}

/** Content that should fade up when it changes: give it a different `swapKey` for each version. */
export function SwapIn({ swapKey, children, className = "" }: { swapKey: string; children: React.ReactNode; className?: string }) {
  return <div key={swapKey} className={`calm-swap-in ${className}`}>{children}</div>;
}

export type Choice<T extends string> = { value: T; label: React.ReactNode; testId: string };

/** A row of options; the chosen one gets an orange pill that GLIDES to it (one element moved with transform). */
export function ChoiceBar<T extends string>({ label, value, choices, onChoose, className = "" }: {
  label: string; value: T; choices: Choice<T>[]; onChoose: (v: T) => void; className?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; h: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);       // no glide on the very first paint
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const btn = bar.querySelector<HTMLElement>(`button[aria-pressed="true"]`);
      if (!btn) return;
      setPill({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(bar);
    return () => ro?.disconnect();
  }, [value]);
  useLayoutEffect(() => { if (pill && !ready) requestAnimationFrame(() => setReady(true)); }, [pill, ready]);
  return (
    <div ref={barRef} className={`calm-segment calm-segment-slide ${className}`} aria-label={label}>
      {pill && <span aria-hidden="true" className={`calm-seg-pill${ready ? " calm-seg-pill-ready" : ""}`}
        style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }} />}
      {choices.map((c) => (
        <button key={c.value} type="button" data-testid={c.testId} aria-pressed={value === c.value} onClick={() => onChoose(c.value)}>
          <span className="calm-seg-label">{c.label}</span>
        </button>
      ))}
    </div>
  );
}
