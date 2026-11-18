// ─── Live screen translation (2.1) ───────────────────────────────────────────
//
// The screens are written in English. Instead of editing hundreds of sentences across the app, this watches the
// page and swaps each English text for its translation as it appears: text between tags, and the visible
// attributes placeholder / aria-label / title / alt. React never notices: only the TEXT of an existing node
// changes, never the page structure (structure changes are what breaks React with browser translators).
//
//   • Sentences with numbers are entries with {n}: "{n}m left" matches "25m left".
//   • Anything inside [data-no-translate] is left alone (layout names people typed, player names, codes).
//   • English, or a sentence missing from the language file, stays as written.
//   • Switching language re-translates the whole page from the original English, no restart.
//
// Cost: a MutationObserver that only wakes for text and those four attributes (never for style changes), so the
// 120 Hz controller screen, which changes styles every frame, does not wake it.

import { currentLang, onLangChange, dictFor } from "./index";

const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "NOSCRIPT"]);

type Pattern = { re: RegExp; keys: string[]; to: string };
let exact = new Map<string, string>();
let patterns: Pattern[] = [];

function compile() {
  const d = dictFor(currentLang());
  exact = new Map();
  patterns = [];
  if (!d) return;
  for (const [en, to] of Object.entries(d)) {
    if (!to) continue;
    if (/\{\w+\}/.test(en)) {
      const keys: string[] = [];
      const src = en.split(/(\{\w+\})/).map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) { keys.push(m[1]); return "(.+?)"; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("");
      patterns.push({ re: new RegExp(`^${src}$`), keys, to });
    } else {
      exact.set(en, to);
    }
  }
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);   // most specific first
}

/** The translation of one English string, or null when there is none. Exported for tests. */
export function translateText(en: string): string | null {
  const core = en.trim();
  if (!core || !/[A-Za-z]/.test(core)) return null;
  let out = exact.get(core);
  if (out === undefined) {
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      // a filled-in part that is itself a known phrase (a built-in layout name) is translated too
      out = p.to.replace(/\{(\w+)\}/g, (all, k) => { const i = p.keys.indexOf(k); return i >= 0 ? (exact.get(m[i + 1]) ?? m[i + 1]) : all; });
      break;
    }
  }
  if (out === undefined) return null;
  const lead = en.slice(0, en.length - en.trimStart().length), trail = en.slice(en.trimEnd().length);
  return lead + out + trail;
}

// The English each node/attribute came with, and what we last wrote, so a change made by React (new English) is
// told apart from our own write.
const textOrig = new WeakMap<Text, string>();
const textSet = new WeakMap<Text, string>();
const attrOrig = new WeakMap<Element, Record<string, string>>();
const attrSet = new WeakMap<Element, Record<string, string>>();

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName) || e.hasAttribute("data-no-translate") || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function doText(node: Text) {
  if (skipped(node.parentElement)) return;
  const now = node.data;
  if (textSet.get(node) !== now) textOrig.set(node, now);         // React wrote new English
  const en = textOrig.get(node) ?? now;
  const want = currentLang() === "en" ? en : (translateText(en) ?? en);
  if (want !== now) node.data = want;          // our own write comes back as a mutation and is a no-op
  textSet.set(node, want);
}

function doAttr(el: Element, name: string) {
  const now = el.getAttribute(name);
  if (now == null || skipped(el)) return;
  const orig = attrOrig.get(el) ?? {}; const set = attrSet.get(el) ?? {};
  if (set[name] !== now) orig[name] = now;
  const en = orig[name] ?? now;
  const want = currentLang() === "en" ? en : (translateText(en) ?? en);
  if (want !== now) el.setAttribute(name, want);
  set[name] = want; attrOrig.set(el, orig); attrSet.set(el, set);
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (SKIP_TAGS.has(el.tagName) || el.hasAttribute("data-no-translate")) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else for (const a of ATTRS) if ((n as Element).hasAttribute(a)) doAttr(n as Element, a);
  }
}

let observer: MutationObserver | null = null;

/** Start translating everything under `root` (the whole page by default). Safe to call once at start-up. */
export function startScreenTranslation(root: Node = document.body) {
  if (observer || typeof MutationObserver === "undefined") return;
  compile();
  walk(root);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes" && m.attributeName) doAttr(m.target as Element, m.attributeName);
      else m.addedNodes.forEach((n) => walk(n));
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  onLangChange(() => { compile(); walk(root); });
}
