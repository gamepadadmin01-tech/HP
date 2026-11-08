// ─── "Make it your own": create or import a controller layout ─────────────────
//
// This pop-up used to live inside the dashboard component with its eleven pieces of state, so opening it
// and every key typed into the name box re-rendered the WHOLE dashboard (Play tab, cards, nav...) while the
// pop-up was trying to animate. That was the lag. Now:
//   • it owns all of its own state, so only this small tree re-renders;
//   • open/closed lives in a tiny store (like navIntent), so tapping "Make it your own" does not re-render
//     the dashboard at all;
//   • its content is keyed per opening, so it always starts fresh and unmounts after it has animated out.
// Looks come from the app's own tokens (calm-shell.css, ".calm-lay-*"), so it matches every other overlay.
// Motion comes from ../motion: scale + fade in, quicker ease-in out, and steps swap with a short fade only
// (no waiting for the old step to leave first).

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowLeft, Plus, Download, Check, Gamepad2, Hand, LayoutGrid } from "lucide-react";
import { SPRING, FADE, STEP, cardIn, backdropIn } from "../motion";
import { useOverlayFocus } from "./useOverlayFocus";

/** Accent colours a new layout can take (also used by the editor's default for a fresh pad). */
export const PAD_COLORS = ["#6366f1", "#e11d48", "#d97706", "#22c55e", "#64748B", "#3b82f6"];

const TEMPLATES = [
  { key: "standard", name: "Standard", desc: "Full-size wireless controller layout.", Icon: Gamepad2, padName: "My Custom Pad" },
  { key: "touchpad", name: "Touchpad Camera", desc: "Slide a finger like a laptop trackpad to turn the camera.", Icon: Hand, padName: "Touchpad Camera" },
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

type Step = "type" | "template" | "name" | "import";

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
  const [step, setStep] = useState<Step>("type");
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PAD_COLORS[0]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  const stepProps = { initial: { opacity: 0, x: 8 }, animate: { opacity: 1, x: 0 }, transition: STEP };
  const Back = ({ to }: { to: Step }) => (
    <button type="button" className="calm-lay-iconbtn" aria-label="Back" onClick={() => setStep(to)}><ArrowLeft size={16} aria-hidden="true" /></button>
  );

  return (
    <motion.div className="gp-shell calm-dialog calm-lay-scrim" {...backdropIn} transition={FADE}
      style={{ top: vp.top, height: vp.h }}>
      <motion.div ref={cardRef} className="calm-lay-card" role="dialog" aria-modal="true" aria-label="Create or import a layout"
        {...cardIn} transition={SPRING}
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
        {step === "type" && (
          <div key="type" className="calm-lay-step">
            <div className="calm-lay-head">
              <div className="calm-lay-headtext"><h3 className="calm-lay-title">Choose type</h3><p className="calm-lay-sub">How would you like to start?</p></div>
              <button type="button" className="calm-lay-iconbtn" aria-label="Close" onClick={closeLayoutDialog}><X size={16} aria-hidden="true" /></button>
            </div>
            <div className="calm-lay-list">
              <button type="button" className="calm-lay-option" onClick={() => pick("blank", "Blank Canvas", PAD_COLORS[0])}>
                <span className="calm-lay-option-icon"><Plus size={22} aria-hidden="true" /></span>
                <span><strong>Blank canvas</strong><small>Start completely empty and build widget by widget.</small></span>
              </button>
              <button type="button" className="calm-lay-option" onClick={() => setStep("template")}>
                <span className="calm-lay-option-icon"><LayoutGrid size={22} aria-hidden="true" /></span>
                <span><strong>Standard layouts</strong><small>Choose from a variety of pre-configured gamepads.</small></span>
              </button>
              <button type="button" className="calm-lay-option" onClick={() => { setError(""); setCode(""); setStep("import"); }}>
                <span className="calm-lay-option-icon"><Download size={22} aria-hidden="true" /></span>
                <span><strong>Import from code</strong><small>Got a share code? Paste it to load someone's controller.</small></span>
              </button>
            </div>
          </div>
        )}

        {step === "template" && (
          <motion.div key="template" className="calm-lay-step" {...stepProps}>
            <div className="calm-lay-head">
              <Back to="type" />
              <div className="calm-lay-headtext"><h3 className="calm-lay-title">Choose template</h3><p className="calm-lay-sub">Pick a starting point for your layout</p></div>
            </div>
            <div className="calm-lay-list">
              {TEMPLATES.map(({ key, name: tn, desc, Icon, padName }, i) => (
                <button key={key} type="button" className="calm-lay-option" onClick={() => pick(key, padName || tn, PAD_COLORS[i % PAD_COLORS.length])}>
                  <span className="calm-lay-option-icon"><Icon size={22} aria-hidden="true" /></span>
                  <span><strong>{tn}</strong><small>{desc}</small></span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === "import" && (
          <motion.div key="import" className="calm-lay-step" {...stepProps}>
            <div className="calm-lay-head">
              <Back to="type" />
              <div className="calm-lay-headtext"><h3 className="calm-lay-title">Import from code</h3><p className="calm-lay-sub">Paste the code someone shared with you</p></div>
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
          <motion.div key="name" className="calm-lay-step" {...stepProps}>
            <div className="calm-lay-head">
              <Back to={template === "blank" ? "type" : "template"} />
              <div className="calm-lay-headtext"><h3 className="calm-lay-title">Name your layout</h3><p className="calm-lay-sub">Customize before building</p></div>
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
      </motion.div>
    </motion.div>
  );
}
