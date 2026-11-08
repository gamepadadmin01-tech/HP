// ─── "Create a layout": pick a layout, start a custom pad, or import one ───────
//
// This pop-up used to live inside the dashboard component with its eleven pieces of state, so opening it
// and every key typed into it re-rendered the WHOLE dashboard while the pop-up was trying to animate. That
// was the lag. Now:
//   • it owns all of its own state, so only this small tree re-renders;
//   • open/closed lives in a tiny store (like navIntent), so tapping "Create a layout" does not re-render
//     the dashboard at all;
//   • its content is keyed per opening, so it always starts fresh and unmounts after it has animated out.
// Looks come from the app's own tokens (".calm-lay-*" in calm-shell.css / redesign.css).
//
// 2026-11-08 (owner): one list, text only, full names, and nothing else. Since 2026-11-09: "Standard Controller",
// "Standard Racing Controller" (the owner's shared layout HS2EMN, built in), "Create custom pad", "Import from
// code"; the Touchpad Camera layout is gone, there are no arrows on the rows, and the card is about half the size. Tapping a layout or "Create custom pad" goes
// straight into the editor with that name (no name/colour step; it can be renamed in the editor's toolbar).
// "Import from code" unfolds a code box under its row (the shared Collapse); a valid code adds the layout to
// the list on Home and says "Added" here, and the pop-up stays open.

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Check } from "lucide-react";
import { SPRING_SNAP, EASE, cardIn, backdropIn } from "../motion";
import { useOverlayFocus } from "./useOverlayFocus";
import { Collapse } from "./Motion";

/** Accent colours a new layout can take (also used by the editor's default for a fresh pad). */
export const PAD_COLORS = ["#6366f1", "#e11d48", "#d97706", "#22c55e", "#64748B", "#3b82f6"];

/** What each row makes: the template it starts from and the name it opens with in the editor. */
const LAYOUTS = [
  { key: "standard", name: "Standard Controller", color: PAD_COLORS[0] },
  { key: "standardRacing", name: "Standard Racing Controller", color: PAD_COLORS[1] },
];
const CUSTOM = { key: "blank", name: "Custom Pad", color: PAD_COLORS[0] };

// ── open / closed, outside React ─────────────────────────────────────────────
let isOpen = false;
let openCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function openLayoutDialog() { if (isOpen) return; isOpen = true; openCount++; emit(); }
export function closeLayoutDialog() { if (!isOpen) return; isOpen = false; emit(); }
export function isLayoutDialogOpen() { return isOpen; }

type Props = {
  /** Make the pad and open it in the editor. */
  onCreate: (template: string, name: string, color: string) => void;
  /** Fetch a shared pad by code and add it to the list. */
  onImport: (code: string) => Promise<{ error: string } | { name: string }>;
};

export function LayoutDialog({ onCreate, onImport }: Props) {
  const open = useSyncExternalStore(subscribe, isLayoutDialogOpen, isLayoutDialogOpen);
  return createPortal(
    <AnimatePresence>
      {open && <Inner key={openCount} onCreate={onCreate} onImport={onImport} />}
    </AnimatePresence>,
    document.body,
  );
}

function Inner({ onCreate, onImport }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(true, cardRef, closeLayoutDialog);

  // Track the visible viewport (keyboard open, native pan) so the card stays centred over what is visible.
  const readVp = () => { const vv = window.visualViewport; return { top: vv ? Math.round(vv.offsetTop) : 0, h: vv ? Math.round(vv.height) : window.innerHeight }; };
  const [vp, setVp] = useState(readVp);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => { const n = readVp(); setVp((o) => (o.top === n.top && o.h === n.h ? o : n)); };
    vv?.addEventListener("resize", update); vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { vv?.removeEventListener("resize", update); vv?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  const create = (l: { key: string; name: string; color: string }) => { onCreate(l.key, l.name, l.color); closeLayoutDialog(); };
  const doImport = async () => {
    if (busy) return;
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { setAdded(""); setError("Enter the code from the person who shared the layout."); return; }
    setBusy(true); setError(""); setAdded("");
    const result = await onImport(c);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else { setAdded(result.name); setCode(""); }
  };

  // A plain function (not a component), so rows are never re-created and keep their pressed state and focus.
  const row = (label: string, onClick: () => void, expanded?: boolean) => (
    <button key={label} type="button" className="calm-lay-option" onClick={onClick}
      {...(expanded !== undefined ? { "aria-expanded": expanded, "aria-controls": "calm-lay-import" } : {})}>
      <strong>{label}</strong>
    </button>
  );

  return (
    <motion.div className="gp-shell calm-dialog calm-lay-scrim" {...backdropIn} transition={{ duration: reduced ? 0 : 0.14, ease: EASE }}
      style={{ top: vp.top, height: vp.h }}>
      <motion.div ref={cardRef} className="calm-lay-card" role="dialog" aria-modal="true" aria-label="Create or import a layout"
        {...cardIn} transition={reduced ? { duration: 0 } : SPRING_SNAP}
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        <div className="calm-lay-step">
          <div className="calm-lay-head">
            <div className="calm-lay-headtext"><h3 className="calm-lay-title">Create a layout</h3></div>
            <button type="button" className="calm-lay-iconbtn" aria-label="Close" onClick={closeLayoutDialog}><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="calm-lay-list">
            {LAYOUTS.map((l) => row(l.name, () => create(l)))}
            {row("Create custom pad", () => create(CUSTOM))}
            {row("Import from code", () => { setImportOpen((v) => !v); setError(""); setAdded(""); }, importOpen)}
            <Collapse open={importOpen} id="calm-lay-import">
              <div className="calm-lay-import">
                <div className="calm-lay-import-row">
                  <input className="calm-lay-input calm-lay-code" value={code} maxLength={12} autoCapitalize="characters" aria-label="Share code"
                    placeholder="Enter code" onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); setAdded(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void doImport(); }} />
                  <button type="button" className="calm-lay-primary" disabled={busy} onClick={() => void doImport()}>{busy ? "Adding…" : "Import"}</button>
                </div>
                {error && <p role="alert" className="calm-lay-error">{error}</p>}
                {added && <p role="status" className="calm-lay-added"><Check size={16} strokeWidth={3} aria-hidden="true" />Added “{added}” to your layouts</p>}
              </div>
            </Collapse>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
