import { useEffect } from "react";
import { useAppStore } from "../stores/useAppStore";

type Resolved = "light" | "dark";

export function resolveTheme(pref: "light" | "dark" | "system"): Resolved {
  if (pref !== "system") return pref;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

/** Applies the theme to <html> and reacts to OS changes in system mode. */
export function useTheme(): void {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.classList.toggle("dark", resolved === "dark");
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (theme !== "system") return;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener?.("change", apply);
      return () => mq.removeEventListener?.("change", apply);
    }
  }, [theme]);
}

/** Keeps <html dir/lang> in sync with UI language (RTL for Persian). */
export function useDirection(lang: "en" | "fa"): void {
  useEffect(() => {
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);
}
