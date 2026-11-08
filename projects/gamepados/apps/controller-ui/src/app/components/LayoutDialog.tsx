// ─── "Create a layout": pick a layout, start from blank, or import one ─────────
//
// This pop-up used to live inside the dashboard component with its eleven pieces of state, so opening it
// and every key typed into the name box re-rendered the WHOLE dashboard (Play tab, cards, nav...) while the
// pop-up was trying to animate. That was the lag. Now:
//   • it owns all of its own state, so only this small tree re-renders;
//   • open/closed lives in a tiny store (like navIntent), so tapping "Create a layout" does not re-render
//     the dashboard at all;
//   • its content is keyed per opening, so it always starts fresh and unmounts after it has animated out.
// Looks come from the app's own tokens (".calm-lay-*" in calm-shell.css / redesign.css).
//
// 2026-11-08 (owner): one short list — every layout by name, "Custom layout" (blank) and "Import from code" —
// with no descriptions, and no separate "Choose template" step. Motion: the card opens on the quick spring,
// the card's HEIGHT eases to fit each step (it used to jump in one frame), and steps slide in over each other
// instead of the old one vanishing first.

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, ArrowLeft, Plus, Download, Check, Gamepad2, Hand, ChevronRight } from "lucide-react";
import { SPRING_SNAP, EASE, EXIT, cardIn, backdropIn } from "../motion";
import { useOverlayFocus } from "./useOverlayFocus";

/** Accent colours a new layout can take (also used by the editor's default for a fresh pad). */
export const PAD_COLORS = ["#6366f1", "#e11d48", "#d97706", "#22c55e", "#64748B", "#3b82f6"];

/** The built-in layouts a new one can start from. */
const TEMPLATES = [
  { key: "standard", name: "Standard", Icon: Gamepad2, padName: "My Custom Pad" },
  { key: "touchpad", name: "Touchpad Camera", Icon: Hand, padName: "Touchpad Camera" },
];

// ── open / closed, outside React ─────────────────────────────────────────────
let isOpen = false;
let openCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function openLayoutDialog() { if (isOpen) return; isOpen = true; openCount++; emit(); }
export function closeLayoutDialog() { if (!isOpen) return; isOpen = false; emit(); }
export function isLayoutDialogOpen() { return isOpen; }

type Step = "pick" | "name" | "import";

type Props = {
  /** Make the pad and open it in the editor. */
  onCreate: (template: string, name: string, color: string) => void;
  /** Fetch a shared pad by code and open it. Resolves with an error message, or null when it worked. */
  onImport: (code: string) => Promise<string | null>;
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
  const [step, setStep] = useState<Step>("pick");
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PAD_COLORS[0]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  // The card's height follows its content smoothly: measure the current step, ease the wrapper to it.
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const pick = (key: string, defaultName: string, colour: string) => { setTemplate(key); setName(defaultName); setColor(colour); setStep("name"); };
  const create = () => { onCreate(template, name, color); closeLayoutDialog(); };
  const doImport = async () => {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { setError("Enter the code from the person who shared the pad."); return; }
    setBusy(true); setError("");
    const err = await onImport(c);
    setBusy(false);
    if (err) setError(err); else closeLayoutDialog();
  };

  // Forward (pick -> name/import) slides in from the right, back slides in from the left; the old step
  // fades out quickly at the same time (popLayout), so nothing waits and nothing jumps.
  const dir = step === "pick" ? -1 : 1;
  const stepMotion = {
    initial: (d: number) => ({ opacity: 0, x: reduced ? 0 : 18 * d }),
    animate: { opacity: 1, x: 0, transition: reduced ? { duration: 0 } : { duration: 0.2, ease: EASE } },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : -12 * d, transition: reduced ? { duration: 0 } : EXIT }),
  };
  const Back = () => (
    <button type="button" className="calm-lay-iconbtn" aria-label="Back" onClick={() => setStep("pick")}><ArrowLeft size={18} aria-hidden="true" /></button>
  );
  const Row = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
    <button type="button" className="calm-lay-option" onClick={onClick}>
      <span className="calm-lay-option-icon">{icon}</span>
      <strong>{label}</strong>
      <ChevronRight className="calm-lay-chevron" size={18} aria-hidden="true" />
    </button>
  );

  return (
    <motion.div className="gp-shell calm-dialog calm-lay-scrim" {...backdropIn} transition={{ duration: reduced ? 0 : 0.14, ease: EASE }}
      style={{ top: vp.top, height: vp.h }}>
      <motion.div ref={cardRef} className="calm-lay-card" role="dialog" aria-modal="true" aria-label="Create or import a layout"
        {...cardIn} transition={reduced ? { duration: 0 } : SPRING_SNAP}
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        <motion.div className="calm-lay-viewport" initial={false} animate={{ height }}
          transition={reduced ? { duration: 0 } : { duration: 0.22, ease: EASE }}>
          <div ref={contentRef}>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              {step === "pick" && (
                <motion.div key="pick" className="calm-lay-step" custom={dir} variants={stepMotion} initial="initial" animate="animate" exit="exit">
                  <div className="calm-lay-head">
                    <div className="calm-lay-headtext"><h3 className="calm-lay-title">Create a layout</h3></div>
                    <button type="button" className="calm-lay-iconbtn" aria-label="Close" onClick={closeLayoutDialog}><X size={18} aria-hidden="true" /></button>
                  </div>
                  <div className="calm-lay-list">
                    {TEMPLATES.map(({ key, name: tn, Icon, padName }, i) => (
                      <Row key={key} icon={<Icon size={22} aria-hidden="true" />} label={tn}
                        onClick={() => pick(key, padName || tn, PAD_COLORS[i % PAD_COLORS.length])} />
                    ))}
                    <Row icon={<Plus size={22} aria-hidden="true" />} label="Custom layout" onClick={() => pick("blank", "Custom layout", PAD_COLORS[0])} />
                    <Row icon={<Download size={22} aria-hidden="true" />} label="Import from code" onClick={() => { setError(""); setCode(""); setStep("import"); }} />
                  </div>
                </motion.div>
              )}

              {step === "import" && (
                <motion.div key="import" className="calm-lay-step" custom={dir} variants={stepMotion} initial="initial" animate="animate" exit="exit">
                  <div className="calm-lay-head">
                    <Back />
                    <div className="calm-lay-headtext"><h3 className="calm-lay-title">Import from code</h3></div>
                  </div>
                  <label className="calm-lay-label" htmlFor="calm-lay-code">Share code</label>
                  <input id="calm-lay-code" className="calm-lay-input calm-lay-code" value={code} maxLength={12} autoCapitalize="characters"
                    placeholder="e.g. K7M2QP" onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void doImport(); }} />
                  {error && <p role="alert" className="calm-lay-error">{error}</p>}
                  <button type="button" className="calm-lay-primary" disabled={busy} onClick={() => void doImport()}>{busy ? "Importing…" : "Import layout"}</button>
                </motion.div>
              )}

              {step === "name" && (
                <motion.div key="name" className="calm-lay-step" custom={dir} variants={stepMotion} initial="initial" animate="animate" exit="exit">
                  <div className="calm-lay-head">
                    <Back />
                    <div className="calm-lay-headtext"><h3 className="calm-lay-title">Name your layout</h3></div>
                  </div>
                  <label className="calm-lay-label" htmlFor="calm-lay-name">Layout name</label>
                  <input id="calm-lay-name" className="calm-lay-input" value={name} maxLength={24} placeholder="My Custom Layout"
                    style={{ borderColor: name ? color + "80" : undefined, caretColor: color }}
                    onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
                  <span className="calm-lay-label calm-lay-label-gap">Accent color</span>
                  <div className="calm-lay-swatches" role="radiogroup" aria-label="Accent color">
                    {PAD_COLORS.map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className="calm-lay-swatch"
                        data-on={color === c ? "1" : undefined} style={{ background: c, "--sw": c } as React.CSSProperties} onClick={() => setColor(c)}>
                        {color === c && <Check size={16} strokeWidth={3} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="calm-lay-primary" onClick={create}>Create and open editor</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
