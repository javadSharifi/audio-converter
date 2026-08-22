import { en, type TranslationKey } from "./en";
import { fa } from "./fa";

export type Lang = "en" | "fa";

const dictionaries: Record<Lang, Record<TranslationKey, string>> = {
  en,
  fa,
};

export function translate(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
  let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? String(key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

export type { TranslationKey };
export const isRtl = (lang: Lang): boolean => lang === "fa";
