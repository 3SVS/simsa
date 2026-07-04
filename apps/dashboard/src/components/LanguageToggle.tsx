"use client";

import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/dictionary.mjs";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "ko", label: "KO" },
];

export function LanguageToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <div role="group" aria-label="Language" className="inline-flex items-center gap-px rounded-md bg-gray-100 p-0.5">
      {OPTIONS.map((o) => {
        const active = locale === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setLocale(o.value)}
            aria-pressed={active}
            className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors ${
              active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
