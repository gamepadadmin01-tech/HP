// ── Touchpad visuals fed from the native touch engine ────────────────────────
// With native input on (the default) the Android engine owns every finger, so the page never
// sees a pointer event on a touchpad. The engine tells the page where the finger is, once per
// frame, inside the same window.__nvis message it already sends for button and stick visuals:
//     p: [[id, fingerX, fingerY, stickX, stickY], ...]   design units; only pads that are active
// This module hands each entry to the widget that owns that id. No React state and no re-render:
// the widget moves its own SVG nodes directly, which is what keeps the animation smooth.

export type PadFrame = {
  fx: number; fy: number;      // where the finger is (design units)
  dx: number; dy: number;      // what the pad is pushing on the right stick (±60)
};

type Sink = (frame: PadFrame | null) => void;

const sinks = new Map<string, Sink>();
let lastActive = new Set<string>();

/** A touchpad widget calls this on mount. `null` means "the pad is idle". Returns the undo. */
export function registerPadVisual(id: string, sink: Sink): () => void {
  sinks.set(id, sink);
  return () => {
    if (sinks.get(id) === sink) sinks.delete(id);
    lastActive.delete(id);
  };
}

/** Called from the page's __nvis handler with the `p` list (or nothing). */
export function applyNativePadVisuals(list: unknown): void {
  const next = new Set<string>();
  if (Array.isArray(list)) {
    for (const e of list) {
      if (!Array.isArray(e) || typeof e[0] !== "string") continue;
      next.add(e[0]);
      const sink = sinks.get(e[0]);
      if (sink) sink({ fx: +e[1] || 0, fy: +e[2] || 0, dx: +e[3] || 0, dy: +e[4] || 0 });
    }
  }
  // A pad that was active last frame and is not in this one has gone idle.
  lastActive.forEach((id) => { if (!next.has(id)) sinks.get(id)?.(null); });
  lastActive = next;
}
