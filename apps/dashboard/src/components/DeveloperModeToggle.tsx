"use client";
// Train N (D-17) — the single switch that reveals developer affordances
// (GitHub connect, code-change tab, Telegram, Advanced tools, Star on GitHub).
// Default OFF: the beginner flow never shows those words. Mounted on the
// account page and at the bottom of each project's prep/settings page so a
// developer can find it from where they'd expect the hidden sections to be.
import { useI18n } from "@/i18n/I18nProvider";
import { useDeveloperMode } from "@/lib/use-developer-mode";

export function DeveloperModeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useDeveloperMode();
  const d = t.devMode;
  return (
    <div className={compact ? "" : "card p-5"}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={compact ? "text-sm font-medium text-gray-800" : "section-title"}>{d.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{d.desc}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={d.title}
          onClick={() => setOn(!on)}
          className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors ${
            on ? "border-brand-700 bg-brand-700" : "border-gray-300 bg-gray-200"
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              on ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">{on ? d.stateOn : d.stateOff}</p>
    </div>
  );
}
