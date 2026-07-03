"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callWorkspaceApi } from "@/lib/workspace-api";
import {
  saveProject,
  generateProjectId,
  saveExtendedProjectData,
  getUserKey,
} from "@/lib/workflow-store";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import type {
  IdeaToSpecDraftResponse,
  WorkspaceQuestion,
} from "@/lib/workspace-types";
// Stage 267 — draft rendering shared with the document-intake draft page.
import { UnderstoodCard, SpecDraftBody } from "@/components/SpecDraftView";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";

type Step = 1 | 2 | 3 | 4;

// builtWith options — id matches the central-plane canonical ids (built-with.ts);
// labelKey indexes t.builtWith.tools. "other" is the free-text input, not a chip.
const BUILT_WITH_OPTIONS: ReadonlyArray<{ id: string; labelKey: keyof Dictionary["builtWith"]["tools"] }> = [
  { id: "v0", labelKey: "v0" },
  { id: "lovable", labelKey: "lovable" },
  { id: "bolt", labelKey: "bolt" },
  { id: "cursor", labelKey: "cursor" },
  { id: "claude-code", labelKey: "claudeCode" },
  { id: "replit", labelKey: "replit" },
  { id: "windsurf", labelKey: "windsurf" },
  { id: "codex", labelKey: "codex" },
  { id: "hand-coded", labelKey: "handCoded" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const [ideaText, setIdeaText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const [result, setResult] = useState<IdeaToSpecDraftResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
  const [specResult, setSpecResult] = useState<IdeaToSpecDraftResponse | null>(null);
  // builtWith — which AI tool(s) built this app (per-agent moat tag).
  const [builtWithTools, setBuiltWithTools] = useState<string[]>([]);
  const [builtWithOther, setBuiltWithOther] = useState("");

  function toggleBuiltWith(tool: string) {
    setBuiltWithTools((prev) => (prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool]));
  }

  const answeredCount = Object.keys(answers).length;
  const questions = result?.questions ?? [];

  async function handleGenerateUnderstanding() {
    if (!ideaText.trim()) return;
    setIsLoading(true);
    setIsFallback(false);
    setRateLimitMsg(null);
    const res = await callWorkspaceApi({ idea: ideaText });
    if (res.ok) {
      setResult(res.data);
      setIsFallback(res.data.source === "mock-fallback");
      setStep(2);
    } else if (res.error === "rate_limited") {
      setRateLimitMsg(t.common.rateLimited);
    } else {
      setResult(res.fallback);
      setIsFallback(true);
      setStep(2);
    }
    setIsLoading(false);
  }

  async function handleGenerateSpec() {
    if (!result) return;
    setIsGeneratingSpec(true);
    setRateLimitMsg(null);
    const answerArray = Object.entries(answers).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));
    const res = await callWorkspaceApi({ idea: ideaText, answers: answerArray });
    if (res.ok) {
      setSpecResult(res.data);
      setIsFallback(res.data.source === "mock-fallback");
      setStep(4);
    } else if (res.error === "rate_limited") {
      setRateLimitMsg(t.common.rateLimited);
    } else {
      setSpecResult(res.fallback);
      setIsFallback(true);
      setStep(4);
    }
    setIsGeneratingSpec(false);
  }

  function handleSave() {
    const spec = specResult ?? result;
    if (!spec) return;
    const id = generateProjectId();
    saveProject({
      id,
      name: spec.productSpec.productName,
      description: spec.productSpec.oneLine,
      createdAt: new Date().toISOString().slice(0, 10),
      spec: {
        completeness: 60,
        goal: spec.productSpec.problem,
        included: spec.productSpec.included,
        excluded: spec.productSpec.excluded,
        openDecisions: spec.productSpec.openQuestions,
      },
      requirements: spec.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    });
    saveExtendedProjectData(id, {
      productSpec: spec.productSpec,
      itemCriteria: Object.fromEntries(spec.items.map((i) => [i.id, i.criteria ?? []])),
    });
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: spec.productSpec.productName,
      idea: ideaText,
      understood: spec.understood,
      productSpec: spec.productSpec,
      items: spec.items,
      builtWith:
        builtWithTools.length || builtWithOther.trim()
          ? { tools: builtWithTools, other: builtWithOther.trim() || undefined }
          : undefined,
    }).catch(() => undefined);
    router.push(`/projects/${id}`);
  }

  const progressWidth = { 1: "25%", 2: "50%", 3: "75%", 4: "100%" }[step];

  return (
    <div className="flex flex-col">
      <div className="h-0.5 bg-gray-100">
        <div className="h-0.5 bg-brand-600 transition-all duration-500" style={{ width: progressWidth }} />
      </div>

      <main className="flex flex-1 justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          {/* Step 1: idea */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.np.step1Title}</h1>
              <p className="mb-8 mt-2 text-sm text-gray-500">{t.np.step1Sub}</p>
              <textarea
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                placeholder={t.np.ideaPlaceholder}
                rows={5}
                className="input resize-none rounded-lg"
              />
              <div className="mb-8 mt-4">
                <p className="mb-2 text-xs text-gray-400">{t.np.examplesLabel}</p>
                <div className="flex flex-col gap-2">
                  {t.np.examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setIdeaText(ex)}
                      className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm text-gray-600 transition-all hover:border-brand-300 hover:bg-brand-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleGenerateUnderstanding}
                disabled={!ideaText.trim() || isLoading}
                className="btn btn-primary w-full py-3"
              >
                {isLoading ? t.np.reading : `${t.np.generateSpec} →`}
              </button>
              {rateLimitMsg && <div className="callout mt-4 border-amber-200 bg-amber-50 text-amber-800">{rateLimitMsg}</div>}
              <p className="mt-3 text-center text-xs text-gray-400">{t.np.freeBeta}</p>
            </div>
          )}

          {/* Step 2: understanding */}
          {step === 2 && result && (
            <div>
              <div className="mb-6 flex items-center gap-2">
                <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{t.brand.wordmark}</span>
                <span className="text-sm text-gray-500">{t.np.understood}</span>
                {isFallback && (
                  <span className="rounded border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                    {t.np.draftTag}
                  </span>
                )}
              </div>

              {isFallback && <div className="callout mb-5 border-amber-100 bg-amber-50 text-xs text-amber-700">{t.np.draftNote}</div>}

              <UnderstoodCard t={t} understood={result.understood} />

              <button onClick={() => setStep(3)} className="btn btn-primary w-full py-3">
                {t.np.confirmAnswer} →
              </button>
              <button onClick={() => setStep(1)} className="mt-3 w-full text-center text-xs text-gray-400 underline hover:text-gray-600">
                {t.np.editIdea}
              </button>
            </div>
          )}

          {/* Step 3: questions */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">{t.np.step3Title}</h2>
              <p className="mb-8 mt-1 text-sm text-gray-500">{t.np.step3Sub}</p>

              <div className="mb-8 space-y-4">
                {questions.map((q, i) => (
                  <ApiQuestionCard
                    key={q.id}
                    t={t}
                    question={q}
                    index={i}
                    total={questions.length}
                    answer={answers[q.id]}
                    onAnswer={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
                  />
                ))}
              </div>

              {rateLimitMsg && <div className="callout mb-4 border-amber-200 bg-amber-50 text-amber-800">{rateLimitMsg}</div>}
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="btn btn-secondary flex-1 py-3">
                  ← {t.np.back}
                </button>
                <button onClick={handleGenerateSpec} disabled={isGeneratingSpec} className="btn btn-primary flex-[2] py-3">
                  {isGeneratingSpec ? t.np.generating : `${t.np.generateSpec} (${answeredCount}/${questions.length}) →`}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: result */}
          {step === 4 && (specResult ?? result) && (
            <>
              <div className="card mb-4 p-5">
                <h3 className="text-sm font-semibold text-gray-800">{t.builtWith.question}</h3>
                <p className="mb-3 mt-1 text-xs text-gray-500">{t.builtWith.hint}</p>
                <div className="flex flex-wrap gap-2">
                  {BUILT_WITH_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleBuiltWith(opt.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        builtWithTools.includes(opt.id)
                          ? "border-brand-300 bg-brand-50 text-brand-700"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {t.builtWith.tools[opt.labelKey]}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={builtWithOther}
                  onChange={(e) => setBuiltWithOther(e.target.value)}
                  placeholder={t.builtWith.otherPlaceholder}
                  className="input mt-3 text-sm"
                />
              </div>
              <SpecPreview t={t} data={(specResult ?? result)!} isFallback={isFallback} onBack={() => setStep(3)} onSave={handleSave} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ApiQuestionCard({
  t,
  question,
  index,
  total,
  answer,
  onAnswer,
}: {
  t: Dictionary;
  question: WorkspaceQuestion;
  index: number;
  total: number;
  answer: string | undefined;
  onAnswer: (v: string) => void;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="font-mono text-xs text-gray-400">{index + 1} / {total}</span>
        {answer && answer !== "defer" && <span className="text-xs font-medium text-green-600">✓ {t.np.answered}</span>}
        {answer === "defer" && <span className="text-xs text-gray-400">{t.np.decideLater}</span>}
      </div>
      <p className="mb-4 text-base font-medium leading-snug text-gray-900">{question.question}</p>
      <div className="mb-5 rounded-lg bg-brand-50 px-4 py-3">
        <p className="mb-0.5 text-xs font-semibold text-brand-700">{t.np.recommended}: {question.recommendation}</p>
        <p className="text-xs leading-relaxed text-brand-600">{question.reason}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {question.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onAnswer(opt)}
            className={`rounded-lg border px-4 py-2 text-sm transition-all ${
              answer === opt
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50"
            }`}
          >
            {opt}
          </button>
        ))}
        {question.allowLater && (
          <button
            onClick={() => onAnswer("defer")}
            className={`rounded-lg border px-4 py-2 text-sm transition-all ${
              answer === "defer" ? "border-gray-300 bg-gray-200 text-gray-700" : "border-gray-200 bg-white text-gray-400 hover:bg-gray-50"
            }`}
          >
            {t.np.decideLater}
          </button>
        )}
        {question.allowCustom && (
          <button
            onClick={() => onAnswer("custom")}
            className={`rounded-lg border px-4 py-2 text-sm transition-all ${
              answer === "custom" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {t.np.customInput}
          </button>
        )}
      </div>
      {answer === "custom" && (
        <input
          autoFocus
          type="text"
          placeholder={t.np.typeYourOwn}
          className="input mt-3"
          onBlur={(e) => e.target.value && onAnswer(e.target.value)}
        />
      )}
    </div>
  );
}

function SpecPreview({
  t,
  data,
  isFallback,
  onBack,
  onSave,
}: {
  t: Dictionary;
  data: IdeaToSpecDraftResponse;
  isFallback: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-gray-900">{t.np.specReady}</h2>
      <p className="mb-6 mt-1 text-sm text-gray-500">{t.np.saveNote}</p>

      {isFallback && <div className="callout mb-5 border-amber-100 bg-amber-50 text-xs text-amber-700">{t.np.draftNote}</div>}

      <SpecDraftBody t={t} data={data} />

      <div className="flex gap-3">
        <button onClick={onBack} className="btn btn-secondary flex-1 py-3">
          ← {t.np.editQuestions}
        </button>
        <button onClick={onSave} className="btn btn-primary flex-[2] py-3">
          {t.np.saveAndStart} →
        </button>
      </div>
    </div>
  );
}

