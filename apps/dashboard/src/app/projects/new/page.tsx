"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  // useSearchParams needs a Suspense boundary when the route is prerendered.
  return (
    <Suspense fallback={null}>
      <NewProjectInner />
    </Suspense>
  );
}

function NewProjectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  // Single entry → adaptive branch. The chosen branch fills the P1 entry_path.
  // Until a branch is picked the chooser shows; then the step flow proceeds.
  //
  // The chosen branch is mirrored in the URL (?path=idea|code|spec) so every
  // way "back" works: the browser back button, the sidebar "새 프로젝트" link
  // (plain /projects/new → chooser), and the visible back button below. Typed
  // input is intentionally kept when returning — only the screen changes.
  const [entryPath, setEntryPath] = useState<"idea" | "code" | "spec" | null>(null);
  // Code branch: skip the idea step entirely (that's the branch's normal path).
  const [appName, setAppName] = useState("");
  const [codeDesc, setCodeDesc] = useState("");
  const [isCreatingCode, setIsCreatingCode] = useState(false);

  function toggleBuiltWith(tool: string) {
    setBuiltWithTools((prev) => (prev.includes(tool) ? prev.filter((x) => x !== tool) : [...prev, tool]));
  }

  const answeredCount = Object.keys(answers).length;
  const questions = result?.questions ?? [];

  // URL is the source of truth for the chosen branch: /projects/new shows the
  // chooser; ?path=idea|code|spec shows that branch. This makes browser-back
  // and a re-click on the sidebar "new project" link both land on the chooser.
  useEffect(() => {
    const raw = searchParams.get("path");
    const fromUrl = raw === "idea" || raw === "code" || raw === "spec" ? raw : null;
    setEntryPath(fromUrl);
    if (fromUrl === null) setStep(1);
  }, [searchParams]);

  function chooseBranch(id: "idea" | "code" | "spec") {
    setEntryPath(id); // immediate — the effect above re-confirms from the URL
    setStep(1);
    router.push(`/projects/new?path=${id}`);
  }

  function backToChooser() {
    router.push("/projects/new");
  }

  /** Prominent "back to the three choices" button, shown on every branch screen. */
  function BackToChooserButton() {
    return (
      <button
        type="button"
        onClick={backToChooser}
        className="mb-6 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
      >
        <span aria-hidden="true">←</span> {t.branch.backToChooser}
      </button>
    );
  }

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

  // Spec branch: paste → one-shot conversion → straight to the preview (step 4).
  // No understanding-confirm / question round — a written plan already carries
  // its decisions; asking again is friction.
  async function handleGenerateFromSpec() {
    if (!ideaText.trim()) return;
    setIsLoading(true);
    setIsFallback(false);
    setRateLimitMsg(null);
    const res = await callWorkspaceApi({ idea: ideaText });
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
    setIsLoading(false);
  }

  // Code branch: name + builtWith (+ optional one-liner) → create the project
  // and go STRAIGHT to code connect (settings). Skipping the idea step is this
  // branch's normal path — with a one-liner we still draft checklist items in
  // the same call, without one the project starts empty (items are optional
  // here; the progress map treats prepare as optional for code entry).
  async function handleCreateCodeProject() {
    const name = appName.trim();
    if (!name || isCreatingCode) return;
    setIsCreatingCode(true);
    setRateLimitMsg(null);

    let generated: IdeaToSpecDraftResponse | null = null;
    if (codeDesc.trim()) {
      const res = await callWorkspaceApi({ idea: codeDesc.trim() });
      if (res.ok) generated = res.data;
      else if (res.error !== "rate_limited") generated = res.fallback;
    }

    const id = generateProjectId();
    saveProject({
      id,
      name,
      description: generated?.productSpec.oneLine ?? codeDesc.trim(),
      createdAt: new Date().toISOString().slice(0, 10),
      spec: {
        completeness: generated ? 60 : 0,
        goal: generated?.productSpec.problem ?? "",
        included: generated?.productSpec.included ?? [],
        excluded: generated?.productSpec.excluded ?? [],
        openDecisions: generated?.productSpec.openQuestions ?? [],
      },
      requirements: (generated?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    });
    saveExtendedProjectData(id, {
      ...(generated
        ? {
            productSpec: generated.productSpec,
            itemCriteria: Object.fromEntries(generated.items.map((i) => [i.id, i.criteria ?? []])),
          }
        : {}),
      entryPath: "code",
    });
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: name,
      idea: codeDesc.trim(),
      understood: generated?.understood ?? {},
      productSpec: generated?.productSpec ?? {},
      items: generated?.items ?? [],
      builtWith:
        builtWithTools.length || builtWithOther.trim()
          ? { tools: builtWithTools, other: builtWithOther.trim() || undefined }
          : undefined,
      entryPath: "code",
    }).catch(() => undefined);
    // Straight to code connect — that IS this branch's step 1.
    router.push(`/projects/${id}/settings`);
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
      entryPath: entryPath ?? "idea",
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
      // The branch the user chose at the single entry (idea/code/spec).
      entryPath: entryPath ?? "idea",
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
          {/* Step 0: single entry → "what do you have?" branch chooser.
              Asks the user's situation, not a "type" — no jargon. The choice
              sets entry_path (idea/code/spec) which persists to the P1 envelope. */}
          {entryPath === null && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.branch.title}</h1>
              <p className="mb-8 mt-2 text-sm text-gray-500">{t.branch.subtitle}</p>
              <div className="space-y-3">
                {([
                  ["idea", t.branch.ideaTitle, t.branch.ideaDesc],
                  ["code", t.branch.codeTitle, t.branch.codeDesc],
                  ["spec", t.branch.specTitle, t.branch.specDesc],
                ] as const).map(([id, title, desc]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => chooseBranch(id)}
                    className="card w-full p-5 text-left transition-colors hover:border-brand-300"
                  >
                    <span className="block text-sm font-semibold text-gray-900">{title}</span>
                    <span className="mt-1 block text-xs text-gray-500">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: idea */}
          {/* CODE branch step 1 — name + builtWith (+ optional one-liner) →
              straight to code connect. No idea step: that's this branch's
              normal path, not a deficit. */}
          {entryPath === "code" && step === 1 && (
            <div>
              <BackToChooserButton />
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.branch.codeStepTitle}</h1>
              <p className="mb-8 mt-2 text-sm text-gray-500">{t.branch.codeStepSub}</p>

              <label className="mb-1 block text-xs font-semibold text-gray-600">{t.branch.codeName}</label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder={t.branch.codeNamePlaceholder}
                className="input mb-6"
              />

              <p className="mb-1 text-xs font-semibold text-gray-600">{t.builtWith.question}</p>
              <p className="mb-3 text-xs text-gray-500">{t.builtWith.hint}</p>
              <div className="mb-6 flex flex-wrap gap-2">
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
                className="input mb-6 text-sm"
              />

              <label className="mb-1 block text-xs font-semibold text-gray-600">{t.branch.codeDescLabel}</label>
              <textarea
                value={codeDesc}
                onChange={(e) => setCodeDesc(e.target.value)}
                placeholder={t.branch.codeDescPlaceholder}
                rows={2}
                className="input mb-8 resize-none rounded-lg"
              />

              <button
                onClick={handleCreateCodeProject}
                disabled={!appName.trim() || isCreatingCode}
                className="btn btn-primary w-full py-3"
              >
                {isCreatingCode ? t.branch.codeCreating : `${t.branch.codeCreate} →`}
              </button>
              {rateLimitMsg && <div className="callout mt-4 border-amber-200 bg-amber-50 text-amber-800">{rateLimitMsg}</div>}
            </div>
          )}

          {/* SPEC branch step 1 — paste the plan → one-shot conversion → preview. */}
          {entryPath === "spec" && step === 1 && (
            <div>
              <BackToChooserButton />
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.branch.specStepTitle}</h1>
              <p className="mb-8 mt-2 text-sm text-gray-500">{t.branch.specStepSub}</p>
              <textarea
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                placeholder={t.branch.specPastePlaceholder}
                rows={12}
                className="input mb-8 resize-none rounded-lg font-mono text-sm"
              />
              <button
                onClick={handleGenerateFromSpec}
                disabled={!ideaText.trim() || isLoading}
                className="btn btn-primary w-full py-3"
              >
                {isLoading ? t.np.reading : `${t.branch.specGenerate} →`}
              </button>
              {rateLimitMsg && <div className="callout mt-4 border-amber-200 bg-amber-50 text-amber-800">{rateLimitMsg}</div>}
              <p className="mt-3 text-center text-xs text-gray-500">{t.np.freeBeta}</p>
            </div>
          )}

          {entryPath === "idea" && step === 1 && (
            <div>
              <BackToChooserButton />
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
                <p className="mb-2 text-xs text-gray-500">{t.np.examplesLabel}</p>
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
              <p className="mt-3 text-center text-xs text-gray-500">{t.np.freeBeta}</p>
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
              <button onClick={() => setStep(1)} className="mt-3 w-full text-center text-xs text-gray-500 underline hover:text-gray-600">
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
              {/* Spec branch never visited the question steps — its back goes to
                  the paste screen (step 1). Sending it to step 3 stranded the
                  user on an empty-questions screen with a blank step 2 behind it. */}
              <SpecPreview
                t={t}
                data={(specResult ?? result)!}
                isFallback={isFallback}
                backLabel={entryPath === "spec" ? t.branch.backToPaste : t.np.editQuestions}
                onBack={() => setStep(entryPath === "spec" ? 1 : 3)}
                onSave={handleSave}
              />
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
        <span className="font-mono text-xs text-gray-500">{index + 1} / {total}</span>
        {answer && answer !== "defer" && <span className="text-xs font-medium text-green-600">✓ {t.np.answered}</span>}
        {answer === "defer" && <span className="text-xs text-gray-500">{t.np.decideLater}</span>}
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
              answer === "defer" ? "border-gray-300 bg-gray-200 text-gray-700" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
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
  backLabel,
  onBack,
  onSave,
}: {
  t: Dictionary;
  data: IdeaToSpecDraftResponse;
  isFallback: boolean;
  backLabel: string;
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
          ← {backLabel}
        </button>
        <button onClick={onSave} className="btn btn-primary flex-[2] py-3">
          {t.np.saveAndStart} →
        </button>
      </div>
    </div>
  );
}

