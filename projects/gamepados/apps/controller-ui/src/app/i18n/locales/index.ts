// The translation files, imported by name (works in Vite and in the esbuild-based DOM tests alike).
// Adding a language: add its file in this folder, a line here, and its entry in ../index.ts LANGS.

import L_zh_CN from "./zh-CN.json";
import L_zh_TW from "./zh-TW.json";
import L_ja_JP from "./ja-JP.json";
import L_ko_KR from "./ko-KR.json";
import L_hi_IN from "./hi-IN.json";
import L_id from "./id.json";
import L_vi from "./vi.json";
import L_th from "./th.json";
import L_ru_RU from "./ru-RU.json";
import L_uk from "./uk.json";
import L_tr_TR from "./tr-TR.json";
import L_de_DE from "./de-DE.json";
import L_fr_FR from "./fr-FR.json";
import L_it_IT from "./it-IT.json";
import L_pl_PL from "./pl-PL.json";
import L_es_ES from "./es-ES.json";
import L_es_419 from "./es-419.json";
import L_pt_BR from "./pt-BR.json";
import L_pt_PT from "./pt-PT.json";

export const LOCALES: Record<string, Record<string, string>> = {
  "zh-CN": L_zh_CN,
  "zh-TW": L_zh_TW,
  "ja-JP": L_ja_JP,
  "ko-KR": L_ko_KR,
  "hi-IN": L_hi_IN,
  "id": L_id,
  "vi": L_vi,
  "th": L_th,
  "ru-RU": L_ru_RU,
  "uk": L_uk,
  "tr-TR": L_tr_TR,
  "de-DE": L_de_DE,
  "fr-FR": L_fr_FR,
  "it-IT": L_it_IT,
  "pl-PL": L_pl_PL,
  "es-ES": L_es_ES,
  "es-419": L_es_419,
  "pt-BR": L_pt_BR,
  "pt-PT": L_pt_PT,
};
