"use client";

import type { AdaptiveQuestion } from "@/lib/mock-generators";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  question: AdaptiveQuestion;
  index: number;
  total: number;
  answer: string | undefined;
  onAnswer: (value: string) => void;
};

export function QuestionCard({ question, index, total, answer, onAnswer }: Props) {
  const { t } = useI18n();
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-mono text-gray-500">
          {index + 1} / {total}
        </span>
        {answer && answer !== "defer" && (
          <span className="text-xs text-green-600 font-medium">{t.np.answered}</span>
        )}
        {answer === "defer" && (
          <span className="text-xs text-gray-500">{t.np.decideLater}</span>
        )}
      </div>

      <p className="text-base font-medium text-gray-900 mb-4 leading-snug">
        {question.question}
      </p>

      <div className="bg-brand-50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-brand-700 mb-0.5">
          {t.np.recommended}: {question.recommendation}
        </p>
        <p className="text-xs text-brand-600 leading-relaxed">
          {question.recommendationReason}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {question.options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onAnswer(opt.value)}
            className={`text-sm px-4 py-2 rounded-lg border transition-all ${
              answer === opt.value
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white text-gray-700 border-gray-200 hover:border-brand-300 hover:bg-brand-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => onAnswer("custom")}
          className={`text-sm px-4 py-2 rounded-lg border transition-all ${
            answer === "custom"
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
          }`}
        >
          {t.np.customInput}
        </button>
      </div>

      {answer === "custom" && (
        <input
          autoFocus
          type="text"
          placeholder={t.np.typeYourOwn}
          className="mt-3 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
          onBlur={(e) => e.target.value && onAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value;
              if (v) onAnswer(v);
            }
          }}
        />
      )}
    </div>
  );
}
