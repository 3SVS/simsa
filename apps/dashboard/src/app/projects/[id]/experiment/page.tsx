"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, loadExtendedProjectData, getUserKey } from "@/lib/workflow-store";
import {
  EXPERIMENT_TEMPLATES,
  buildCandidatePrompt,
  buildAllPromptsText,
  canSaveExperiment,
  canCreateBenchmarkFromExperiment,
  buildExperimentDecision,
} from "@/lib/agent-experiment.mjs";
import type {
  AgentExperimentRole,
  SuggestedAgent,
} from "@/lib/agent-experiment.mjs";
import {
  saveExperiment,
  listExperiments,
  getExperiment,
  patchExperimentCandidate,
  createBenchmarkFromExperiment,
  saveExperimentDecision,
  getOutcomeScorecard,
  saveEvolutionActionPack,
  listEvolutionActionPacks,
  getEvolutionActionPack,
  patchEvolutionActionPackFollowup,
  getEvolutionActionPackImpact,
  getEvolutionImpactSummary,
  type SavedExperimentListItem,
  type SavedExperiment,
  type ExperimentCandidate,
  type OutcomeScorecard,
  type SavedEvolutionActionPackDetail,
  type SavedEvolutionActionPackListItem,
  type ActionPackFollowupStatus,
  type EvolutionImpactComparison,
  type EvolutionImpactSummary,
} from "@/lib/workspace-experiment-api";
import {
  FOLLOWUP_STATUSES,
  followupStatusLabelKey,
  buildFollowupPayload,
} from "@/lib/action-pack-followup.mjs";
import {
  impactVerdictLabelKey,
  impactReasonLabelKey,
  formatDeltaInt,
  formatDeltaPercent,
  formatRate,
  isImpactEmpty,
} from "@/lib/evolution-impact.mjs";
import {
  summaryVerdictLabelKey,
  summaryReasonLabelKey,
  formatAverageDeltaPercent,
  formatAverageDeltaCount,
  summaryHasNoFollowups,
} from "@/lib/evolution-impact-summary.mjs";
import { listProjectReviewHistory, type ProjectReviewHistoryItem } from "@/lib/workspace-github-api";
import { getSavedBenchmark } from "@/lib/workspace-benchmark-api";
import { gradeLabelKey, actionLabelKey, reasonLabelKey } from "@/lib/outcome-labels.mjs";
import {
  buildEvolutionActionPack,
  buildEvolutionActionPackText,
  type EvolutionActionPack,
} from "@/lib/evolution-action-pack.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

function outcomeText(t: Dictionary, key: string): string {
  return (t.outcome as unknown as Record<string, string>)[key] ?? key;
}

function templateTitle(t: Dictionary, id: string): string {
  if (id === "single_agent_baseline") return t.experiment.tplSingleTitle;
  if (id === "multi_agent_split") return t.experiment.tplMultiTitle;
  return t.experiment.tplBuilderReviewerTitle;
}
function templateDesc(t: Dictionary, id: string): string {
  if (id === "single_agent_baseline") return t.experiment.tplSingleDesc;
  if (id === "multi_agent_split") return t.experiment.tplMultiDesc;
  return t.experiment.tplBuilderReviewerDesc;
}
function candidateLabel(t: Dictionary, labelKey: string): string {
  const map: Record<string, string> = {
    candSingleBuilder: t.experiment.candSingleBuilder,
    candBuilderA: t.experiment.candBuilderA,
    candBuilderB: t.experiment.candBuilderB,
    roleBuilder: t.experiment.roleBuilder,
    roleReviewer: t.experiment.roleReviewer,
    roleFixer: t.experiment.roleFixer,
  };
  return map[labelKey] ?? labelKey;
}
function roleLabel(t: Dictionary, role: AgentExperimentRole): string {
  if (role === "builder") return t.experiment.roleBuilder;
  if (role === "reviewer") return t.experiment.roleReviewer;
  if (role === "fixer") return t.experiment.roleFixer;
  return t.experiment.roleIntegrator;
}
function roleInstruction(t: Dictionary, role: AgentExperimentRole, label: string): string {
  const tpl =
    role === "reviewer"
      ? t.experiment.roleInstructionReviewer
      : role === "fixer"
        ? t.experiment.roleInstructionFixer
        : role === "integrator"
          ? t.experiment.roleInstructionIntegrator
          : t.experiment.roleInstructionBuilder;
  return tpl.replace("{label}", label);
}
function agentLabel(t: Dictionary, agent: SuggestedAgent): string {
  if (agent === "claude_code") return t.benchmark.sourceClaude;
  if (agent === "codex") return t.benchmark.sourceCodex;
  if (agent === "cursor") return t.benchmark.sourceCursor;
  if (agent === "manual") return t.benchmark.sourceManual;
  return t.benchmark.sourceOther;
}

function candidateStatusLabel(t: Dictionary, status: string): string {
  if (status === "planned") return t.experiment.statPlanned;
  if (status === "pr_linked") return t.experiment.statPrLinked;
  if (status === "reviewed") return t.experiment.statReviewed;
  if (status === "benchmarked") return t.experiment.statBenchmarked;
  if (status === "selected") return t.experiment.statSelected;
  if (status === "rejected") return t.experiment.statRejected;
  if (status === "needs_fix") return t.experiment.statNeedsFix;
  return status;
}

function expDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch { return iso; }
}

type ResolvedCandidate = {
  id: string;
  label: string;
  role: AgentExperimentRole;
  suggestedAgent: SuggestedAgent;
  prompt: string;
};

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [selectedId, setSelectedId] = useState(EXPERIMENT_TEMPLATES[0].id);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Stage 72: persistence + candidate linking
  const [titleInput, setTitleInput] = useState("");
  const [savePhase, setSavePhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saved, setSaved] = useState<SavedExperimentListItem[]>([]);
  const [openExp, setOpenExp] = useState<SavedExperiment | null>(null);
  const [reviewRuns, setReviewRuns] = useState<ProjectReviewHistoryItem[]>([]);
  const [benchPhase, setBenchPhase] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [scorecard, setScorecard] = useState<OutcomeScorecard | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);

  // Stage 75: load the outcome quality scorecard whenever the open experiment
  // changes (open / decision saved / benchmark created all replace openExp).
  useEffect(() => {
    if (!openExp || !userKey) {
      setScorecard(null);
      return;
    }
    let cancelled = false;
    setScorecardLoading(true);
    getOutcomeScorecard(id, openExp.id, userKey).then((res) => {
      if (cancelled) return;
      setScorecard(res.ok ? res.scorecard : null);
      setScorecardLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, userKey, openExp]);

  const loadSaved = useCallback(async () => {
    if (!userKey) return;
    const res = await listExperiments(id, userKey);
    if (res.ok) setSaved(res.experiments);
  }, [id, userKey]);

  const openExperiment = useCallback(async (experimentId: string) => {
    if (!userKey) return;
    setBenchPhase("idle");
    const res = await getExperiment(id, experimentId, userKey);
    if (res.ok) setOpenExp(res.experiment);
  }, [id, userKey]);

  useEffect(() => {
    void loadSaved();
    (async () => {
      const res = await listProjectReviewHistory(id, userKey ?? "", { limit: 50 });
      if (res.ok) setReviewRuns(res.runs);
    })();
    // Stage 73: deep-link from a benchmark's "Source experiment" → auto-open it.
    const qp = new URLSearchParams(window.location.search).get("experiment");
    if (qp) void openExperiment(qp);
  }, [id, userKey, loadSaved, openExperiment]);

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  const ext = loadExtendedProjectData(id);
  const spec = ext?.productSpec as { oneLine?: string; problem?: string } | undefined;
  const brief = (spec?.oneLine || spec?.problem || project.spec?.goal || "").trim() || t.experiment.briefFallback;
  const acceptanceItems = (project.requirements ?? []).map((r) => r.title);

  const template = EXPERIMENT_TEMPLATES.find((tpl) => tpl.id === selectedId) ?? EXPERIMENT_TEMPLATES[0];

  const candidates: ResolvedCandidate[] = template.candidates.map((c) => {
    const label = candidateLabel(t, c.labelKey);
    const prompt = buildCandidatePrompt({
      roleInstruction: roleInstruction(t, c.role, label),
      contextHeading: t.experiment.promptContextHeading,
      context: t.experiment.projectContextLine.replace("{title}", project.name),
      briefHeading: t.experiment.promptBriefHeading,
      brief,
      acceptanceHeading: t.experiment.promptAcceptanceHeading,
      acceptanceItems,
      constraintsHeading: t.experiment.promptConstraintsHeading,
      constraints: [t.experiment.constraintScope, t.experiment.constraintReviewable],
      outputHeading: t.experiment.promptOutputHeading,
      output: t.experiment.promptOutput,
      reportHeading: t.experiment.promptReportHeading,
      report: t.experiment.promptReport,
    });
    return { id: c.id, label, role: c.role, suggestedAgent: c.suggestedAgent, prompt };
  });

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    }).catch(() => {});
  }

  function copyAll() {
    const text = buildAllPromptsText({
      heading: t.experiment.copyAllHeading,
      candidatePrefix: t.experiment.candidatePrefix,
      candidates: candidates.map((c) => ({ label: c.label, prompt: c.prompt })),
    });
    copy("__all__", text);
  }

  async function handleSaveExperiment() {
    if (!userKey || !canSaveExperiment(titleInput, template.id)) return;
    setSavePhase("saving");
    const res = await saveExperiment(id, {
      userKey,
      title: titleInput.trim(),
      templateId: template.id,
      candidates: candidates.map((c) => ({ id: c.id, label: c.label, mode: template.mode, role: c.role, suggestedAgent: c.suggestedAgent })),
    });
    if (res.ok) {
      setSavePhase("saved");
      setTitleInput("");
      await loadSaved();
      setOpenExp(res.experiment);
      setTimeout(() => setSavePhase((p) => (p === "saved" ? "idle" : p)), 2000);
    } else {
      setSavePhase("error");
    }
  }

  async function handleCreateBenchmark() {
    if (!userKey || !openExp) return;
    setBenchPhase("creating");
    const res = await createBenchmarkFromExperiment(id, openExp.id, userKey);
    if (res.ok) {
      setOpenExp(res.experiment);
      setBenchPhase("done");
      await loadSaved();
    } else {
      setBenchPhase("error");
    }
  }

  async function handlePatchCandidate(
    candidateRowId: string,
    patch: { pullRequestNumber?: number; reviewRunId?: string },
  ): Promise<boolean> {
    if (!userKey || !openExp) return false;
    const res = await patchExperimentCandidate(id, openExp.id, candidateRowId, { userKey, ...patch });
    if (res.ok) {
      setOpenExp({ ...openExp, candidates: openExp.candidates.map((c) => (c.id === candidateRowId ? res.candidate : c)) });
      return true;
    }
    return false;
  }

  const steps = [t.experiment.step1, t.experiment.step2, t.experiment.step3, t.experiment.step4, t.experiment.step5, t.experiment.step6];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-gray-900">{t.experiment.title}</h2>
        <p className="mt-0.5 text-sm text-gray-500">{t.experiment.subtitle}</p>
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{t.experiment.purposeNote}</p>
      </div>

      {/* Template selector */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t.experiment.chooseTemplate}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {EXPERIMENT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => setSelectedId(tpl.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${tpl.id === selectedId ? "border-indigo-300 bg-indigo-50/50" : "border-gray-200 bg-white hover:border-indigo-200"}`}
            >
              <p className="text-sm font-semibold text-gray-800">{templateTitle(t, tpl.id)}</p>
              <p className="mt-1 text-xs text-gray-500">{templateDesc(t, tpl.id)}</p>
            </button>
          ))}
        </div>
      </section>

      {/* No brief / items hint */}
      {acceptanceItems.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">{t.experiment.noBrief}</div>
      )}

      {/* Candidate prompts */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{templateTitle(t, template.id)}</h3>
          <button
            onClick={copyAll}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {copiedKey === "__all__" ? t.experiment.copied : t.experiment.copyAllPrompts}
          </button>
        </div>
        {candidates.map((c) => (
          <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{c.label}</p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {t.experiment.roleLabel}: {roleLabel(t, c.role)} · {t.experiment.suggestedAgentLabel}: {agentLabel(t, c.suggestedAgent)}
                </p>
              </div>
              <button
                onClick={() => copy(c.id, c.prompt)}
                className="flex-shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                {copiedKey === c.id ? t.experiment.copied : t.experiment.copyPrompt}
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-700">{c.prompt}</pre>
            </div>
          </div>
        ))}
      </section>

      {/* Save experiment */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800">{t.experiment.createExperiment}</h3>
        <p className="mt-0.5 text-xs text-gray-400">{t.experiment.saveHint}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder={t.experiment.titlePlaceholder}
            maxLength={120}
            className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            onClick={handleSaveExperiment}
            disabled={!canSaveExperiment(titleInput, template.id) || savePhase === "saving"}
            className="flex-shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {savePhase === "saving" ? t.experiment.saving : t.experiment.saveExperiment}
          </button>
        </div>
        {savePhase === "saved" && <p className="mt-2 text-xs text-green-600">{t.experiment.saved}</p>}
        {savePhase === "error" && <p className="mt-2 text-xs text-red-500">{t.experiment.saveError}</p>}
      </section>

      {/* Saved experiments */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800">{t.experiment.savedExperiments}</h3>
        {saved.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">{t.experiment.noSavedExperiments}</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {saved.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-gray-700">{e.title}</p>
                  <p className="truncate text-[11px] text-gray-400">{templateTitle(t, e.templateId)} · {e.candidateCount} · {expDate(e.createdAt, locale)}</p>
                </div>
                <button onClick={() => openExperiment(e.id)} className="flex-shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50">
                  {t.experiment.open}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Candidate linking for the opened experiment */}
      {openExp && (
        <section className="rounded-xl border border-indigo-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-800">{openExp.title}</h3>
          <p className="mt-0.5 text-xs text-gray-400">{templateTitle(t, openExp.templateId)}</p>
          <div className="mt-3 space-y-3">
            {openExp.candidates.map((c) => (
              <CandidateLinkCard key={c.id} candidate={c} reviewRuns={reviewRuns} onPatch={handlePatchCandidate} t={t} locale={locale} />
            ))}
          </div>

          {/* Benchmark handoff */}
          {(() => {
            const linkedBenchmarkId = openExp.candidates.find((c) => c.benchmarkId)?.benchmarkId;
            const canCreate = canCreateBenchmarkFromExperiment(openExp.candidates);
            return (
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-800">{t.experiment.benchmarkHandoff}</p>
                <p className="mt-0.5 text-xs text-gray-400">{t.experiment.benchmarkHandoffDesc}</p>
                {linkedBenchmarkId ? (
                  <div className="mt-2">
                    <p className="text-xs text-green-600">{benchPhase === "done" ? t.experiment.benchmarkCreated : t.experiment.benchmarkLinked}</p>
                    <Link href={`/projects/${id}/benchmark/${linkedBenchmarkId}`} className="mt-1 inline-block rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50">
                      {t.experiment.openBenchmarkResult}
                    </Link>
                  </div>
                ) : canCreate ? (
                  <div className="mt-2">
                    <button
                      onClick={handleCreateBenchmark}
                      disabled={benchPhase === "creating"}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {benchPhase === "creating" ? t.experiment.creatingBenchmark : t.experiment.createBenchmarkFromExperiment}
                    </button>
                    {benchPhase === "error" && <p className="mt-1 text-xs text-red-500">{t.experiment.benchmarkFromExpError}</p>}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-amber-700">{t.experiment.benchmarkNeedsTwo}</p>
                )}
              </div>
            );
          })()}

          {/* Decision (Stage 74) */}
          <DecisionSection
            experiment={openExp}
            hasBenchmark={openExp.candidates.some((c) => c.benchmarkId)}
            projectId={id}
            userKey={userKey ?? ""}
            onSaved={setOpenExp}
            t={t}
          />

          {/* Outcome quality scorecard (Stage 75) */}
          <OutcomeQualitySection
            scorecard={scorecard}
            loading={scorecardLoading}
            projectId={id}
            experiment={openExp}
            userKey={userKey ?? ""}
            t={t}
          />
        </section>
      )}

      {/* Workflow guide */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-800">{t.experiment.workflowTitle}</h3>
        <ol className="mt-2 space-y-1.5 text-sm text-gray-600">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="flex-shrink-0 font-semibold text-indigo-500">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Benchmark link */}
      <section className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4">
        <p className="text-xs text-gray-500">{t.experiment.afterReview}</p>
        <p className="mt-0.5 text-xs text-gray-400">{t.experiment.benchmarkHint}</p>
        <Link
          href={`/projects/${id}/benchmark`}
          className="mt-2 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
        >
          {t.experiment.openBenchmark}
        </Link>
      </section>
    </div>
  );
}

// Stage 74: experiment outcome decision section.
function DecisionSection({
  experiment,
  hasBenchmark,
  projectId,
  userKey,
  onSaved,
  t,
}: {
  experiment: SavedExperiment;
  hasBenchmark: boolean;
  projectId: string;
  userKey: string;
  onSaved: (exp: SavedExperiment) => void;
  t: Dictionary;
}) {
  const [outcomes, setOutcomes] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of experiment.candidates) init[c.candidateId] = c.outcome ?? "undecided";
    return init;
  });
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of experiment.candidates) init[c.candidateId] = c.outcomeNote ?? "";
    return init;
  });
  const [decisionNote, setDecisionNote] = useState(experiment.decisionNote ?? "");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function setOutcome(cid: string, outcome: string) {
    setOutcomes((prev) => {
      const toggledOff = prev[cid] === outcome;
      const next = { ...prev };
      if (!toggledOff && outcome === "selected") {
        for (const k of Object.keys(next)) if (next[k] === "selected") next[k] = "undecided";
      }
      next[cid] = toggledOff ? "undecided" : outcome;
      return next;
    });
  }

  async function save() {
    if (!userKey) return;
    setPhase("saving");
    const payload = buildExperimentDecision(outcomes, notes, decisionNote);
    const res = await saveExperimentDecision(projectId, experiment.id, { userKey, ...payload });
    if (res.ok) {
      setPhase("saved");
      onSaved(res.experiment);
      setTimeout(() => setPhase((p) => (p === "saved" ? "idle" : p)), 2000);
    } else {
      setPhase("error");
    }
  }

  const options: Array<[string, string, string]> = [
    ["selected", t.experiment.selectAsWinner, "bg-green-600"],
    ["needs_fix", t.experiment.needsFixes, "bg-amber-500"],
    ["rejected", t.experiment.reject, "bg-red-600"],
  ];

  return (
    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
      <p className="text-sm font-semibold text-gray-800">{t.experiment.decision}</p>
      <p className="mt-0.5 text-xs text-gray-400">{t.experiment.decisionDesc}</p>
      <p className={`mt-1 text-[11px] ${hasBenchmark ? "text-gray-400" : "text-amber-700"}`}>
        {hasBenchmark ? t.experiment.useBenchmarkEvidence : t.experiment.createBenchmarkFirst}
      </p>
      <div className="mt-3 space-y-2">
        {experiment.candidates.map((c) => (
          <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-800">{c.label}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {options.map(([val, label, color]) => (
                <button
                  key={val}
                  onClick={() => setOutcome(c.candidateId, val)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${outcomes[c.candidateId] === val ? `${color} border-transparent text-white` : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={notes[c.candidateId] ?? ""}
              onChange={(e) => setNotes((p) => ({ ...p, [c.candidateId]: e.target.value }))}
              placeholder={t.experiment.candidateNotePlaceholder}
              maxLength={300}
              className="mt-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
        ))}
      </div>
      <label className="mt-3 block text-[11px] text-gray-500">{t.experiment.decisionNoteLabel}</label>
      <textarea
        value={decisionNote}
        onChange={(e) => setDecisionNote(e.target.value)}
        rows={2}
        maxLength={1000}
        className="mt-0.5 w-full resize-none rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={phase === "saving"}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
        >
          {phase === "saving" ? t.experiment.savingDecision : t.experiment.saveDecision}
        </button>
        {phase === "saved" && <span className="text-xs text-green-600">{t.experiment.decisionSaved}</span>}
        {phase === "error" && <span className="text-xs text-red-500">{t.experiment.decisionSaveError}</span>}
      </div>
    </div>
  );
}

// Stage 72: per-candidate PR / review-run linking card.
function CandidateLinkCard({
  candidate,
  reviewRuns,
  onPatch,
  t,
  locale,
}: {
  candidate: ExperimentCandidate;
  reviewRuns: ProjectReviewHistoryItem[];
  onPatch: (candidateRowId: string, patch: { pullRequestNumber?: number; reviewRunId?: string }) => Promise<boolean>;
  t: Dictionary;
  locale: Locale;
}) {
  const [pr, setPr] = useState(candidate.pullRequestNumber ? String(candidate.pullRequestNumber) : "");
  const [runId, setRunId] = useState(candidate.reviewRunId ?? "");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function update() {
    setPhase("saving");
    const prNum = pr.trim() ? Number(pr) : undefined;
    const ok = await onPatch(candidate.id, {
      pullRequestNumber: prNum && Number.isInteger(prNum) && prNum > 0 ? prNum : undefined,
      reviewRunId: runId || undefined,
    });
    setPhase(ok ? "saved" : "error");
    if (ok) setTimeout(() => setPhase((p) => (p === "saved" ? "idle" : p)), 2000);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">{candidate.label}</span>
        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600">
          {t.experiment.candidateStatus}: {candidateStatusLabel(t, candidate.status)}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <label className="mb-0.5 block text-[11px] text-gray-500">{t.experiment.prNumber}</label>
          <input
            type="number"
            min={1}
            value={pr}
            onChange={(e) => setPr(e.target.value)}
            className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex-1">
          <label className="mb-0.5 block text-[11px] text-gray-500">{t.experiment.linkReviewRun}</label>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="">{t.experiment.selectReviewRun}</option>
            {reviewRuns.map((r) => (
              <option key={r.id} value={r.id}>
                PR #{r.prNumber} · {expDate(r.createdAt, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={update}
            disabled={phase === "saving"}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-white disabled:opacity-40"
          >
            {phase === "saving" ? t.experiment.updating : t.experiment.update}
          </button>
        </div>
      </div>
      {phase === "saved" && <p className="mt-1 text-[11px] text-green-600">{t.experiment.updated}</p>}
      {phase === "error" && <p className="mt-1 text-[11px] text-red-500">{t.experiment.updateError}</p>}
    </div>
  );
}

const GRADE_BADGE: Record<string, string> = {
  strong: "bg-green-50 text-green-700 border-green-200",
  promising: "bg-blue-50 text-blue-700 border-blue-200",
  needs_work: "bg-amber-50 text-amber-700 border-amber-200",
  inconclusive: "bg-gray-100 text-gray-500 border-gray-200",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function OutcomeQualitySection({
  scorecard,
  loading,
  projectId,
  experiment,
  userKey,
  t,
}: {
  scorecard: OutcomeScorecard | null;
  loading: boolean;
  projectId: string;
  experiment: SavedExperiment;
  userKey: string;
  t: Dictionary;
}) {
  const linkedBenchmarkId = experiment.candidates.find((c) => c.benchmarkId)?.benchmarkId;
  const selected = experiment.candidates.find(
    (c) => c.candidateId === scorecard?.selectedCandidateId || c.id === scorecard?.selectedCandidateId,
  );
  const fixRunId = selected?.reviewRunId;

  const [pack, setPack] = useState<EvolutionActionPack | null>(null);
  const [packText, setPackText] = useState("");
  const [packPhase, setPackPhase] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const [copied, setCopied] = useState(false);

  // Stage 77: persisted action packs.
  const [savedPacks, setSavedPacks] = useState<SavedEvolutionActionPackListItem[]>([]);
  const [savePhase, setSavePhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openedPack, setOpenedPack] = useState<SavedEvolutionActionPackDetail | null>(null);
  const [openPhase, setOpenPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [copiedSaved, setCopiedSaved] = useState(false);

  // Stage 78: follow-up tracking form.
  const [followupStatus, setFollowupStatus] = useState<ActionPackFollowupStatus>("not_started");
  const [followupPr, setFollowupPr] = useState("");
  const [followupRunId, setFollowupRunId] = useState("");
  const [followupBenchId, setFollowupBenchId] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [followupPhase, setFollowupPhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [followupError, setFollowupError] = useState<string | null>(null);

  // Stage 79: before/after impact (auto-loaded when a saved pack opens).
  const [impact, setImpact] = useState<EvolutionImpactComparison | null>(null);
  const [impactPhase, setImpactPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Stage 80: experiment-level impact summary (auto-loaded with the section).
  const [summary, setSummary] = useState<EvolutionImpactSummary | null>(null);
  const [summaryPhase, setSummaryPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Reset the generated pack whenever the scorecard changes (new experiment / decision).
  useEffect(() => {
    setPack(null);
    setPackText("");
    setPackPhase("idle");
    setCopied(false);
    setOpenedPack(null);
    setOpenPhase("idle");
    setSavePhase("idle");
    setSaveError(null);
    setImpact(null);
    setImpactPhase("idle");
    setSummary(null);
    setSummaryPhase("idle");
  }, [scorecard]);

  // Load saved action packs whenever the experiment changes.
  useEffect(() => {
    let cancelled = false;
    if (!userKey) return;
    listEvolutionActionPacks(projectId, experiment.id, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) setSavedPacks(res.actionPacks);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, experiment.id, userKey]);

  // Stage 80: auto-load the experiment-level summary whenever saved packs
  // change (initial mount, after Save, after follow-up Save). One round trip
  // per material change — no polling.
  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    setSummaryPhase("loading");
    getEvolutionImpactSummary(projectId, experiment.id, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSummary(res.summary);
        setSummaryPhase("ready");
      } else {
        setSummary(null);
        setSummaryPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, experiment.id, userKey, savedPacks]);

  // Sync follow-up form with the opened pack's snapshot.
  useEffect(() => {
    if (!openedPack) return;
    const f = openedPack.followup;
    setFollowupStatus(f.status);
    setFollowupPr(f.pullRequestNumber ? String(f.pullRequestNumber) : "");
    setFollowupRunId(f.reviewRunId ?? "");
    setFollowupBenchId(f.benchmarkId ?? "");
    setFollowupNote(f.note ?? "");
    setFollowupPhase("idle");
    setFollowupError(null);
  }, [openedPack]);

  // Stage 79: auto-load impact whenever the opened pack changes (or after a
  // follow-up save updates the snapshot).
  useEffect(() => {
    if (!openedPack || !userKey) {
      setImpact(null);
      setImpactPhase("idle");
      return;
    }
    let cancelled = false;
    setImpactPhase("loading");
    getEvolutionActionPackImpact(projectId, experiment.id, openedPack.id, userKey).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setImpact(res.impact);
        setImpactPhase("ready");
      } else {
        setImpact(null);
        setImpactPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openedPack, userKey, projectId, experiment.id]);

  const s = t.evolution as unknown as Record<string, string>;

  async function handleGenerate() {
    if (!scorecard) return;
    setPackPhase("generating");
    // Pull the benchmark snapshot for focus-item titles (best effort; the pack
    // still builds without it, falling back to itemId).
    let benchmark = null;
    if (scorecard.signals.hasBenchmark && linkedBenchmarkId && userKey) {
      const res = await getSavedBenchmark(projectId, linkedBenchmarkId, userKey);
      if (res.ok) benchmark = res.benchmark.result;
    }
    const built = buildEvolutionActionPack({ projectId, experiment, scorecard, benchmark }, s);
    const target = experiment.candidates.find(
      (c) => c.candidateId === built.targetCandidateId || c.id === built.targetCandidateId,
    );
    const text = buildEvolutionActionPackText(built, s, {
      experimentTitle: experiment.title,
      targetCandidateLabel: target ? candidateLabel(t, target.label) : undefined,
    });
    setPack(built);
    setPackText(text);
    setPackPhase("ready");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(packText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — preview still shown */
    }
  }

  async function handleSave() {
    if (!scorecard || !userKey) return;
    setSavePhase("saving");
    setSaveError(null);
    const res = await saveEvolutionActionPack(projectId, experiment.id, userKey);
    if (res.ok) {
      // Prefer server version after save (Stage 77 contract).
      setOpenedPack(res.actionPack);
      setOpenPhase("ready");
      setSavedPacks((prev) => [
        {
          id: res.actionPack.id,
          experimentId: res.actionPack.experimentId,
          recommendedAction: res.actionPack.recommendedAction,
          title: res.actionPack.title,
          createdAt: res.actionPack.createdAt,
          followupStatus: res.actionPack.followup.status,
          followupPullRequestNumber: res.actionPack.followup.pullRequestNumber,
          followupReviewRunId: res.actionPack.followup.reviewRunId,
          followupBenchmarkId: res.actionPack.followup.benchmarkId,
          followedAt: res.actionPack.followup.followedAt,
        },
        ...prev,
      ]);
      setSavePhase("saved");
      window.setTimeout(() => setSavePhase("idle"), 1500);
    } else {
      setSaveError(res.error);
      setSavePhase("error");
    }
  }

  async function handleOpenSaved(actionPackId: string) {
    if (!userKey) return;
    setOpenPhase("loading");
    const res = await getEvolutionActionPack(projectId, experiment.id, actionPackId, userKey);
    if (res.ok) {
      setOpenedPack(res.actionPack);
      setOpenPhase("ready");
    } else {
      setOpenPhase("error");
    }
  }

  async function handleCopySaved() {
    if (!openedPack) return;
    try {
      await navigator.clipboard.writeText(openedPack.text);
      setCopiedSaved(true);
      window.setTimeout(() => setCopiedSaved(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function refreshSavedPackInList(detail: SavedEvolutionActionPackDetail) {
    setSavedPacks((prev) =>
      prev.map((p) =>
        p.id === detail.id
          ? {
              ...p,
              followupStatus: detail.followup.status,
              followupPullRequestNumber: detail.followup.pullRequestNumber,
              followupReviewRunId: detail.followup.reviewRunId,
              followupBenchmarkId: detail.followup.benchmarkId,
              followedAt: detail.followup.followedAt,
            }
          : p,
      ),
    );
  }

  async function submitFollowup(payload: ReturnType<typeof buildFollowupPayload>) {
    if (!openedPack) return;
    setFollowupPhase("saving");
    setFollowupError(null);
    const res = await patchEvolutionActionPackFollowup(projectId, experiment.id, openedPack.id, payload);
    if (res.ok) {
      setOpenedPack(res.actionPack);
      refreshSavedPackInList(res.actionPack);
      setFollowupPhase("saved");
      window.setTimeout(() => setFollowupPhase("idle"), 1500);
    } else {
      setFollowupError(res.error);
      setFollowupPhase("error");
    }
  }

  async function handleSaveFollowup() {
    if (!userKey || !openedPack) return;
    const prNumber = followupPr.trim() ? Number(followupPr.trim()) : undefined;
    const payload = buildFollowupPayload({
      userKey,
      status: followupStatus,
      pullRequestNumber: prNumber,
      reviewRunId: followupRunId || undefined,
      benchmarkId: followupBenchId || undefined,
      note: followupNote || undefined,
    });
    await submitFollowup(payload);
  }

  async function handleMarkCopied() {
    if (!userKey || !openedPack) return;
    const payload = buildFollowupPayload({ userKey, status: "copied" });
    await submitFollowup(payload);
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-100 bg-white p-4">
      <p className="text-sm font-semibold text-gray-800">{t.outcome.title}</p>
      <p className="mt-0.5 text-xs text-gray-400">{t.outcome.desc}</p>

      {loading && <p className="mt-3 text-xs text-gray-400">{t.outcome.loading}</p>}

      {!loading && scorecard && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                GRADE_BADGE[scorecard.quality.grade] ?? GRADE_BADGE.inconclusive
              }`}
            >
              {outcomeText(t, gradeLabelKey(scorecard.quality.grade))}
            </span>
            <span className="text-[11px] text-gray-400">
              {t.outcome.score}: {scorecard.quality.score}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            <Metric label={t.outcome.acceptancePassRate} value={pct(scorecard.quality.acceptancePassRate)} />
            <Metric label={t.outcome.criticalIssues} value={String(scorecard.quality.criticalIssueCount)} />
            <Metric label={t.outcome.notVerified} value={String(scorecard.quality.notVerifiedCount)} />
            <Metric label={t.outcome.needsDecision} value={String(scorecard.quality.needsDecisionCount)} />
            <Metric label={t.outcome.unresolvedBlockers} value={String(scorecard.quality.unresolvedBlockerCount)} />
            <Metric label={t.outcome.evidenceCoverage} value={pct(scorecard.quality.evidenceCoverageRate)} />
          </dl>

          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.outcome.recommendedNext}</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-800">
              {outcomeText(t, actionLabelKey(scorecard.nextEvolution.recommendedAction))}
            </p>
            {scorecard.nextEvolution.reasons.length > 0 && (
              <>
                <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.outcome.reasonsLabel}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                  {scorecard.nextEvolution.reasons.map((r) => (
                    <li key={r} className="flex gap-1.5">
                      <span className="text-gray-300">•</span>
                      <span>{outcomeText(t, reasonLabelKey(r))}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {scorecard.nextEvolution.suggestedFocusItemIds.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.outcome.suggestedFocus}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {scorecard.nextEvolution.suggestedFocusItemIds.map((itemId) => (
                  <span key={itemId} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-mono text-gray-600">
                    {itemId}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {linkedBenchmarkId && (
              <Link
                href={`/projects/${projectId}/benchmark/${linkedBenchmarkId}`}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t.outcome.openBenchmarkEvidence}
              </Link>
            )}
            {fixRunId && (
              <Link
                href={`/projects/${projectId}/github/history/${fixRunId}?action=fix-pack`}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {t.outcome.createFixInstructions}
              </Link>
            )}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {t.outcome.planAnotherExperiment}
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-gray-400">{t.outcome.basis}</p>

          {/* Evolution action pack (Stage 76 + Stage 77 persistence) */}
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-800">{t.evolution.title}</p>
            <p className="mt-0.5 text-xs text-gray-400">{t.evolution.desc}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={packPhase === "generating"}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
              >
                {t.evolution.generate}
              </button>
              {pack && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  {copied ? t.evolution.copied : t.evolution.copy}
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={savePhase === "saving"}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-40"
              >
                {savePhase === "saving"
                  ? t.evolution.saving
                  : savePhase === "saved"
                    ? t.evolution.savedOk
                    : t.evolution.save}
              </button>
            </div>

            {savePhase === "error" && (
              <p className="mt-2 text-xs text-red-600">
                {t.evolution.saveFailed}
                {saveError ? `: ${saveError}` : ""}
              </p>
            )}

            {pack && packPhase === "ready" && !openedPack && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-gray-500">{t.evolution.recommendedAction}:</span>
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    {pack.title}
                  </span>
                  {pack.targetCandidateId && (
                    <span className="text-gray-400">
                      {t.evolution.targetCandidate}: {pack.targetCandidateId}
                    </span>
                  )}
                </div>
                {pack.sections.map((sec, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{sec.title}</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-gray-700">{sec.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Stage 80: experiment-level Evolution impact summary */}
            <div className="mt-4 rounded-lg border border-gray-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{t.evolution.summaryTitle}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">{t.evolution.summaryDesc}</p>
                </div>
                {summary && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      summary.overallVerdict === "mostly_improved"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : summary.overallVerdict === "regressed"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : summary.overallVerdict === "mixed"
                            ? "border-gray-200 bg-gray-50 text-gray-700"
                            : summary.overallVerdict === "mostly_inconclusive"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-gray-200 bg-white text-gray-500"
                    }`}
                  >
                    {t.evolution[summaryVerdictLabelKey(summary.overallVerdict) as keyof typeof t.evolution]}
                  </span>
                )}
              </div>

              {summaryPhase === "loading" && (
                <p className="mt-2 text-xs text-gray-400">{t.outcome.loading}</p>
              )}

              {summaryPhase === "ready" && summary && (
                <>
                  {summaryHasNoFollowups(summary) ? (
                    <p className="mt-2 text-xs text-gray-500">
                      {summary.actionPackCount === 0
                        ? t.evolution.summaryEmptyPacks
                        : t.evolution.summaryEmptyFollowups}
                    </p>
                  ) : (
                    <>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryActionPacks}</dt>
                          <dd className="font-semibold text-gray-800">{summary.actionPackCount}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryFollowedPacks}</dt>
                          <dd className="font-semibold text-gray-800">{summary.followedPackCount}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryImprovedPacks}</dt>
                          <dd className="font-semibold text-emerald-700">{summary.verdictCounts.improved}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryRegressedPacks}</dt>
                          <dd className="font-semibold text-red-700">{summary.verdictCounts.regressed}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryUnchangedPacks}</dt>
                          <dd className="font-semibold text-gray-700">{summary.verdictCounts.unchanged}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
                          <dt className="text-gray-400">{t.evolution.summaryInconclusivePacks}</dt>
                          <dd className="font-semibold text-amber-700">{summary.verdictCounts.inconclusive}</dd>
                        </div>
                      </dl>

                      <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 p-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">{t.evolution.summaryAverageChange}</p>
                        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-4">
                          <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactPassRate}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaPercent(summary.averageDelta.passRateDelta)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactCritical}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(summary.averageDelta.criticalIssueDelta)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactNotVerified}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(summary.averageDelta.notVerifiedDelta)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactBlockers}</dt><dd className="font-semibold text-gray-700">{formatAverageDeltaCount(summary.averageDelta.blockerDelta)}</dd></div>
                        </dl>
                      </div>

                      {summary.recommendedActionVerdicts.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.summaryActionBreakdown}</p>
                          <ul className="mt-1 space-y-1 text-xs">
                            {summary.recommendedActionVerdicts.map((r) => (
                              <li
                                key={r.recommendedAction}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-2 py-1"
                              >
                                <span className="font-mono text-[11px] text-gray-600">{r.recommendedAction}</span>
                                <span className="text-[11px] text-gray-500">
                                  {r.total} · <span className="text-emerald-700">↑{r.improved}</span> · <span className="text-red-700">↓{r.regressed}</span> · <span className="text-gray-500">={r.unchanged}</span> · <span className="text-amber-700">?{r.inconclusive}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  {summary.reasons.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.summaryReasonsLabel}</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                        {summary.reasons.map((r) => (
                          <li key={r} className="flex gap-1.5">
                            <span className="text-gray-300">•</span>
                            <span>{t.evolution[summaryReasonLabelKey(r) as keyof typeof t.evolution]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {summary.limitations.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.summaryLimitationsLabel}</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {summary.limitations.map((l) => (
                          <li
                            key={l}
                            className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-500"
                          >
                            {l}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {summaryPhase === "error" && (
                <p className="mt-2 text-xs text-red-600">{t.errors.loadFailed}</p>
              )}
            </div>

            {/* Stage 77: saved action packs list */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.saved}</p>
              {savedPacks.length === 0 ? (
                <p className="mt-1 text-xs text-gray-400">{t.evolution.noSaved}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {savedPacks.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-gray-700">{p.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              p.followupStatus === "completed" || p.followupStatus === "benchmarked"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : p.followupStatus === "abandoned"
                                  ? "border-gray-200 bg-gray-50 text-gray-500"
                                  : p.followupStatus === "not_started"
                                    ? "border-gray-200 bg-white text-gray-500"
                                    : "border-indigo-200 bg-indigo-50 text-indigo-700"
                            }`}
                          >
                            {t.evolution[followupStatusLabelKey(p.followupStatus) as keyof typeof t.evolution]}
                          </span>
                          {p.followupPullRequestNumber && (
                            <span className="text-[10px] text-gray-400">PR #{p.followupPullRequestNumber}</span>
                          )}
                          <span className="text-[10px] text-gray-400">
                            {t.evolution.createdAt}: {new Date(p.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenSaved(p.id)}
                        className="rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        {t.evolution.open}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Stage 77 + Stage 78: opened saved pack detail with follow-up tracking */}
            {openedPack && openPhase === "ready" && (
              <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{t.evolution.serverGenerated}</p>
                    <p className="text-[11px] text-gray-400">{t.evolution.serverGeneratedDesc}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleMarkCopied}
                      disabled={followupPhase === "saving"}
                      className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-40"
                    >
                      {t.evolution.markCopied}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopySaved}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      {copiedSaved ? t.evolution.copied : t.evolution.copySaved}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-gray-500">{t.evolution.recommendedAction}:</span>
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    {openedPack.title}
                  </span>
                  {openedPack.pack.targetCandidateId && (
                    <span className="text-gray-400">
                      {t.evolution.targetCandidate}: {openedPack.pack.targetCandidateId}
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {openedPack.pack.sections.map((sec, i) => (
                    <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{sec.title}</p>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-gray-700">{sec.body}</p>
                    </div>
                  ))}
                </div>

                {/* Stage 78: follow-up tracking form */}
                <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-800">{t.evolution.followup}</p>
                      <p className="text-[11px] text-gray-400">{t.evolution.followupDesc}</p>
                    </div>
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      {t.evolution[followupStatusLabelKey(openedPack.followup.status) as keyof typeof t.evolution]}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[11px] text-gray-500">
                      {t.evolution.followupStatus}
                      <select
                        value={followupStatus}
                        onChange={(e) => setFollowupStatus(e.target.value as ActionPackFollowupStatus)}
                        className="mt-0.5 block w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                      >
                        {FOLLOWUP_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {t.evolution[followupStatusLabelKey(st) as keyof typeof t.evolution]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-gray-500">
                      {t.evolution.followupPullRequestNumber}
                      <input
                        type="number"
                        min={1}
                        value={followupPr}
                        onChange={(e) => setFollowupPr(e.target.value)}
                        className="mt-0.5 block w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                    <label className="text-[11px] text-gray-500">
                      {t.evolution.followupReviewRun}
                      <input
                        type="text"
                        value={followupRunId}
                        onChange={(e) => setFollowupRunId(e.target.value)}
                        placeholder="wprr_…"
                        className="mt-0.5 block w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-mono text-gray-700"
                      />
                    </label>
                    <label className="text-[11px] text-gray-500">
                      {t.evolution.followupBenchmark}
                      <input
                        type="text"
                        value={followupBenchId}
                        onChange={(e) => setFollowupBenchId(e.target.value)}
                        placeholder="wab_…"
                        className="mt-0.5 block w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-mono text-gray-700"
                      />
                    </label>
                  </div>

                  <label className="mt-2 block text-[11px] text-gray-500">
                    {t.evolution.followupNote}
                    <textarea
                      value={followupNote}
                      onChange={(e) => setFollowupNote(e.target.value)}
                      maxLength={1000}
                      rows={2}
                      className="mt-0.5 block w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveFollowup}
                      disabled={followupPhase === "saving"}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {followupPhase === "saving"
                        ? t.evolution.savingFollowup
                        : followupPhase === "saved"
                          ? t.evolution.followupSaved
                          : t.evolution.saveFollowup}
                    </button>
                    {openedPack.followup.followedAt && (
                      <span className="text-[11px] text-gray-400">
                        {t.evolution.followedAt}: {new Date(openedPack.followup.followedAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {followupPhase === "error" && (
                    <p className="mt-2 text-xs text-red-600">
                      {t.evolution.followupFailed}
                      {followupError ? `: ${followupError}` : ""}
                    </p>
                  )}
                </div>

                {/* Stage 79: before/after evolution impact comparison (auto-loaded) */}
                <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-800">{t.evolution.impact}</p>
                      <p className="text-[11px] text-gray-400">{t.evolution.impactDesc}</p>
                    </div>
                    {impact && (
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          impact.verdict === "improved"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : impact.verdict === "regressed"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : impact.verdict === "unchanged"
                                ? "border-gray-200 bg-white text-gray-600"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {t.evolution[impactVerdictLabelKey(impact.verdict) as keyof typeof t.evolution]}
                      </span>
                    )}
                  </div>

                  {impactPhase === "loading" && (
                    <p className="mt-2 text-xs text-gray-400">{t.outcome.loading}</p>
                  )}

                  {impactPhase === "ready" && impact && (
                    <>
                      {isImpactEmpty(impact) ? (
                        <p className="mt-2 text-xs text-gray-500">{t.evolution.impactMissingFollowup}</p>
                      ) : (
                        <>
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div className="rounded-md border border-gray-100 bg-white p-2">
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">{t.evolution.impactBefore}</p>
                              {impact.before ? (
                                <dl className="mt-1 space-y-0.5 text-[11px]">
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactPassRate}</dt><dd className="font-semibold text-gray-700">{formatRate(impact.before.passRate)}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactCritical}</dt><dd className="font-semibold text-gray-700">{impact.before.criticalIssueCount}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactNotVerified}</dt><dd className="font-semibold text-gray-700">{impact.before.notVerifiedCount}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactBlockers}</dt><dd className="font-semibold text-gray-700">{impact.before.blockerCount}</dd></div>
                                </dl>
                              ) : (
                                <p className="mt-1 text-[11px] text-gray-400">—</p>
                              )}
                            </div>
                            <div className="rounded-md border border-gray-100 bg-white p-2">
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">{t.evolution.impactAfter}</p>
                              {impact.after ? (
                                <dl className="mt-1 space-y-0.5 text-[11px]">
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactPassRate}</dt><dd className="font-semibold text-gray-700">{formatRate(impact.after.passRate)}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactCritical}</dt><dd className="font-semibold text-gray-700">{impact.after.criticalIssueCount}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactNotVerified}</dt><dd className="font-semibold text-gray-700">{impact.after.notVerifiedCount}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.impactBlockers}</dt><dd className="font-semibold text-gray-700">{impact.after.blockerCount}</dd></div>
                                </dl>
                              ) : (
                                <p className="mt-1 text-[11px] text-gray-400">—</p>
                              )}
                            </div>
                            <div className="rounded-md border border-gray-100 bg-white p-2">
                              <p className="text-[10px] uppercase tracking-wide text-gray-400">{t.evolution.impactDelta}</p>
                              {impact.delta ? (
                                <dl className="mt-1 space-y-0.5 text-[11px]">
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.deltaPassRate}</dt><dd className="font-semibold text-gray-700">{formatDeltaPercent(impact.delta.passRateDelta)}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.deltaCritical}</dt><dd className="font-semibold text-gray-700">{formatDeltaInt(impact.delta.criticalIssueDelta)}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.deltaNotVerified}</dt><dd className="font-semibold text-gray-700">{formatDeltaInt(impact.delta.notVerifiedDelta)}</dd></div>
                                  <div className="flex justify-between"><dt className="text-gray-400">{t.evolution.deltaBlockers}</dt><dd className="font-semibold text-gray-700">{formatDeltaInt(impact.delta.blockerDelta)}</dd></div>
                                </dl>
                              ) : (
                                <p className="mt-1 text-[11px] text-gray-400">—</p>
                              )}
                            </div>
                          </div>

                          {impact.verdict === "inconclusive" && (
                            <p className="mt-2 text-[11px] text-amber-700">{t.evolution.impactInconclusiveExplanation}</p>
                          )}

                          {impact.reasons.length > 0 && (
                            <div className="mt-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.impactReasons}</p>
                              <ul className="mt-1 flex flex-wrap gap-1.5">
                                {impact.reasons.map((r) => (
                                  <li
                                    key={r}
                                    className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600"
                                  >
                                    {t.evolution[impactReasonLabelKey(r) as keyof typeof t.evolution]}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {impact.limitations.length > 0 && (
                            <div className="mt-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{t.evolution.impactLimitations}</p>
                              <ul className="mt-1 flex flex-wrap gap-1.5">
                                {impact.limitations.map((l) => (
                                  <li
                                    key={l}
                                    className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-mono text-gray-500"
                                  >
                                    {l}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {impactPhase === "error" && (
                    <p className="mt-2 text-xs text-red-600">{t.errors.loadFailed}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !scorecard && (
        <p className="mt-3 text-xs text-gray-400">{t.evolution.needScorecard}</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-gray-50 py-0.5">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-semibold text-gray-800">{value}</dd>
    </div>
  );
}
