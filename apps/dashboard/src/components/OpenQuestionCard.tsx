"use client";

// C2 (openQuestions 질문화): turns one "still to decide" item from a dead bullet
// into an answerable card. "추천 받기" fetches a real recommendation (gateway-
// routed LLM); the user accepts it or types their own. Honest by contract — a
// failed recommendation shows "추천을 못 가져왔어요, 다시 시도", never a fabricated
// default (Bae ②).

import { useState } from "react";
import { recommendAnswer, type RecommendAnswerResult } from "@/lib/workspace-api";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  question: string;
  productName?: string;
  oneLine?: string;
  targetUsers?: string[];
  projectId?: string;
  userKey?: string;
  /** Set once the user has settled this decision — renders the resolved view. */
  resolvedAnswer?: string;
  onResolved: (question: string, answer: string) => void;
};

type Phase = "idle" | "loading" | "recommended" | "error" | "rate_limited";

export function OpenQuestionCard({
  question,
  productName,
  oneLine,
  targetUsers,
  projectId,
  userKey,
  resolvedAnswer,
  onResolved,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rec, setRec] = useState<{ recommendation: string; reason: string; options: string[] } | null>(null);
  const [rateMsg, setRateMsg] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  async function fetchRecommendation() {
    setPhase("loading");
    const res: RecommendAnswerResult = await recommendAnswer({
      question,
      productName,
      oneLine,
      targetUsers,
      projectId,
      userKey,
    });
    if (res.ok) {
      setRec({ recommendation: res.recommendation, reason: res.reason, options: res.options });
      setPhase("recommended");
    } else if (res.error === "rate_limited") {
      setRateMsg(res.message);
      setPhase("rate_limited");
    } else {
      setPhase("error");
    }
  }

  // ── Resolved view — the decision is settled ────────────────────────────────
  if (resolvedAnswer) {
    return (
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-green-500">✓</span>
          <div className="flex-1">
            <p className="text-sm text-gray-500 line-through">{question}</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {t.np.openQDecided}: {resolvedAnswer}
            </p>
          </div>
          <button
            onClick={() => {
              setPhase("idle");
              setRec(null);
              onResolved(question, ""); // clear → back to open
            }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {t.np.openQChange}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-slate-400">!</span>
        <p className="flex-1 text-sm text-slate-700">{question}</p>
      </div>

      {phase === "idle" && (
        <button onClick={fetchRecommendation} className="btn btn-sm btn-secondary mt-3">
          {t.np.openQGet}
        </button>
      )}

      {phase === "loading" && (
        <p className="mt-3 text-sm text-gray-500">{t.np.openQThinking}</p>
      )}

      {phase === "error" && (
        <div className="mt-3">
          <p className="text-sm text-red-600">{t.np.openQFailed}</p>
          <button onClick={fetchRecommendation} className="btn btn-sm btn-secondary mt-2">
            {t.common.retry}
          </button>
        </div>
      )}

      {phase === "rate_limited" && (
        <div className="mt-3">
          <p className="text-sm text-amber-700">{rateMsg}</p>
          <button onClick={fetchRecommendation} className="btn btn-sm btn-secondary mt-2">
            {t.common.retry}
          </button>
        </div>
      )}

      {phase === "recommended" && rec && (
        <div className="mt-3">
          <div className="rounded-lg bg-brand-50 px-4 py-3">
            <p className="text-xs font-semibold text-brand-700">
              {t.np.recommended}: {rec.recommendation}
            </p>
            {rec.reason && <p className="mt-0.5 text-xs leading-relaxed text-brand-600">{rec.reason}</p>}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onResolved(question, rec.recommendation)}
              className="btn btn-sm btn-primary"
            >
              {t.np.openQUse}
            </button>
            {rec.options
              .filter((o) => o !== rec.recommendation)
              .map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onResolved(question, opt)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-all hover:border-brand-300 hover:bg-brand-50"
                >
                  {opt}
                </button>
              ))}
            <button
              onClick={() => setCustomOpen((v) => !v)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 transition-all hover:bg-gray-50"
            >
              {t.np.customInput}
            </button>
          </div>

          {customOpen && (
            <input
              autoFocus
              type="text"
              placeholder={t.np.typeYourOwn}
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) onResolved(question, v);
                }
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v) onResolved(question, v);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
