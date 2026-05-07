"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { createT, type Lang, type TranslationKey } from "@/lib/i18n";
import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────
interface I18nContextValue {
  lang: Lang;
  /** Set and persist a new language (updates localStorage + API). */
  setLang: (code: Lang) => void;
  /** Translate a key to the current language. */
  t: (key: TranslationKey) => string;
}

// ─── Context ─────────────────────────────────────────────────────────────────
const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => undefined,
  t: createT("en"),
});

const STORAGE_KEY = "clarimetis_lang";

function isValidLang(v: string | null): v is Lang {
  return ["en", "es", "pt", "fr", "zh-TW", "ja", "ko", "it"].includes(v ?? "");
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();

  // Always start with "en" so the first render matches the server HTML.
  // After mount, read localStorage and switch — this avoids the hydration mismatch
  // caused by the server and client rendering different text on the first pass.
  const [lang, setLangState] = useState<Lang>("en");

  // Hydrate from localStorage after the first client render.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidLang(stored) && stored !== "en") {
      setLangState(stored);
    }
  }, []);

  // Sync with server preference once signed in.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const { preferred_language } = await api.getLanguage(token);
        if (!cancelled && isValidLang(preferred_language)) {
          setLangState(preferred_language);
          localStorage.setItem(STORAGE_KEY, preferred_language);
        }
      } catch {
        // silently ignore – fall back to stored/default
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, getToken]);

  const setLang = useCallback(
    (code: Lang) => {
      setLangState(code);
      localStorage.setItem(STORAGE_KEY, code);
      // Fire-and-forget API update.
      (async () => {
        try {
          const token = await getToken();
          if (token) await api.setLanguage(token, code);
        } catch {
          // silently ignore
        }
      })();
    },
    [getToken],
  );

  const t = useMemo(() => createT(lang), [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useI18n() {
  return useContext(I18nContext);
}
