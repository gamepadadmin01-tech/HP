// ─── Translations (2.1) ──────────────────────────────────────────────────────
//
// The app is written in English. Each other language is one file in ./locales/<code>.json that maps the
// English sentence to its translation: { "Tilt steering": "チルト操作" }. A sentence missing from a file simply
// shows in English, so a half-translated language never shows a blank or a key.
//
// Which language: the player's choice in Settings, else "Automatic", which follows the phone's language. A phone
// in English stays English (that is most of India, by the owner's decision), and Arabic is not offered (owner,
// 2026-11-18). Changing the language re-renders every screen that calls useLang(), no restart.
//
// Usage in a component:   const { t } = useLang();   <span>{t("Tilt steering")}</span>
// With a number:          t("{n} degrees", { n: 30 })
// Outside React:          t("…") reads the current language at the moment it is called.

import { useSyncExternalStore } from "react";
import { KEYS, readString, writeString } from "../store/storage";
import { LOCALES } from "./locales";

/** Every language the app speaks, in the order the Language list shows them. Native names, so a player who cannot
 *  read the current language still finds their own. */
export const LANGS = [
  { code: "en", name: "English" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "ja-JP", name: "日本語" },
  { code: "ko-KR", name: "한국어" },
  { code: "hi-IN", name: "हिन्दी" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "ru-RU", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "tr-TR", name: "Türkçe" },
  { code: "de-DE", name: "Deutsch" },
  { code: "fr-FR", name: "Français" },
  { code: "it-IT", name: "Italiano" },
  { code: "pl-PL", name: "Polski" },
  { code: "es-ES", name: "Español (España)" },
  { code: "es-419", name: "Español (Latinoamérica)" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "pt-PT", name: "Português (Portugal)" },
] as const;
export type LangCode = (typeof LANGS)[number]["code"];

type Dict = Record<string, string>;
const DICTS = LOCALES as Partial<Record<LangCode, Dict>>;

/** The phone's language mapped onto ours. Exported for tests. */
export function fromPhone(tags: readonly string[]): LangCode {
  for (const raw of tags) {
    const tag = raw.toLowerCase().replace(/_/g, "-");
    const [base, ...rest] = tag.split("-");
    const region = rest.join("-");
    switch (base) {
      case "en": return "en";
      case "zh": return /hant|tw|hk|mo/.test(region) ? "zh-TW" : "zh-CN";
      case "ja": return "ja-JP";
      case "ko": return "ko-KR";
      case "hi": return "hi-IN";
      case "id": case "in": return "id";       // "in" is Android's old code for Indonesian
      case "vi": return "vi";
      case "th": return "th";
      case "ru": return "ru-RU";
      case "uk": return "uk";
      case "tr": return "tr-TR";
      case "de": return "de-DE";
      case "fr": return "fr-FR";
      case "it": return "it-IT";
      case "pl": return "pl-PL";
      case "es": return region === "es" ? "es-ES" : "es-419";   // Spain, else Latin America (and plain "es")
      case "pt": return region === "br" || region === "" ? "pt-BR" : "pt-PT";
    }
  }
  return "en";
}

function phoneTags(): string[] {
  try {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) as string[];
    return list.filter(Boolean);
  } catch { return []; }
}

/** "auto" or a language code. */
export type LangChoice = "auto" | LangCode;
const isCode = (v: string): v is LangCode => LANGS.some((l) => l.code === v);

let choice: LangChoice = (() => { const v = readString(KEYS.language, "auto"); return v === "auto" || isCode(v) ? v : "auto"; })();
let lang: LangCode = choice === "auto" ? fromPhone(phoneTags()) : choice;
const listeners = new Set<() => void>();

function apply() {
  lang = choice === "auto" ? fromPhone(phoneTags()) : choice;
  try { document.documentElement.lang = lang; } catch { /* no DOM in tests */ }
  listeners.forEach((l) => l());
}
apply();

export function currentLang(): LangCode { return lang; }
/** The translations of one language (undefined for English). Used by the live screen translation (dom.ts). */
export function dictFor(code: LangCode): Dict | undefined { return code === "en" ? undefined : DICTS[code]; }
/** Called after every language change. */
export function onLangChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function langChoice(): LangChoice { return choice; }

export function setLangChoice(next: LangChoice) {
  choice = next;
  writeString(KEYS.language, next);
  apply();
}
// Development builds only: lets the screen-walking checks (i18n-crawl.mjs) switch language mid-run.
if ((import.meta as any).env?.DEV) (globalThis as any).__gpSetLang = setLangChoice;

/** The translation of an English sentence in the current language (English if there is none). `{name}` in the
 *  sentence is replaced from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  const out = (lang === "en" ? undefined : DICTS[lang]?.[en]) || en;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Re-renders the component when the language or the choice changes (Automatic and English can be the same
 *  language but are different choices, and the Language list must show which one is ticked). */
const snapshot = () => `${choice}|${lang}`;
export function useLang() {
  useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    snapshot, snapshot,
  );
  return { lang, choice, t };
}
