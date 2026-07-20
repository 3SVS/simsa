"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  DEFAULT_LOCALE,
  getDictionary,
  detectInitialLocale,
  writeStoredLocale,
} from "@/i18n/dictionary.mjs";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Start from the default so SSR and first client paint agree, then hydrate the
  // persisted choice from localStorage.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    // Explicit choice wins; first-time Korean browsers start in Korean.
    const initial = detectInitialLocale(
      typeof window !== "undefined" ? window.localStorage : null,
      typeof navigator !== "undefined" ? navigator.language : null
    );
    if (initial !== locale) setLocaleState(initial);
    // 2026-07-20 P1: 감지된 locale을 즉시 저장한다. 저장하지 않으면 UI는
    // ko(감지)인데 API 호출부(readStoredLocale — 저장값 없음 → 기본 en)는
    // en을 보내서, 토글을 안 건드린 한국 첫 방문 유저의 제품 설명서가
    // 영어로 생성됐다(journey-audit 실측). UI 언어와 API 언어의 단일화.
    writeStoredLocale(typeof window !== "undefined" ? window.localStorage : null, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStoredLocale(typeof window !== "undefined" ? window.localStorage : null, next);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: getDictionary(locale) }}>
      {children}
    </I18nContext.Provider>
  );
}

/** Access the active dictionary + locale controls. Falls back to the default
 *  dictionary when used outside a provider (keeps leaf components resilient). */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return { locale: DEFAULT_LOCALE, setLocale: () => {}, t: getDictionary(DEFAULT_LOCALE) };
}
