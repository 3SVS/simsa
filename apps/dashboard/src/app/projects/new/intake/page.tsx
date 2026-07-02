"use client";

// Stage 101 — unified intake foundation UI.
// One front door with multiple starting points. Deterministic local preview
// only — no backend, no model call, no external fetch. Future stages wire real
// per-type analysis behind the same model.
import { useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { SimsaStampThinking } from "@/components/SimsaStampThinking";
import { getDefaultStampThinkingSteps } from "@/lib/stamp-thinking.mjs";
import {
  WORKSPACE_INTAKE_TYPES,
  INTAKE_META,
  INTAKE_OUTPUT_LABELS,
  buildIntakeDraft,
} from "@/lib/intake.mjs";
import type {
  WorkspaceIntakeType,
  WorkspaceIntakeDraft,
} from "@/lib/intake.mjs";
import { buildPrdIntakePreview, SAMPLE_PRD } from "@/lib/intake-prd.mjs";
import type { PrdIntakePreview } from "@/lib/intake-prd.mjs";
import {
  buildProductUrlIntakePreview,
  SAMPLE_PRODUCT_URL,
} from "@/lib/intake-url.mjs";
import type { ProductUrlIntakePreview } from "@/lib/intake-url.mjs";
import {
  buildGitHubRepoIntakePreview,
  SAMPLE_GITHUB_REPO,
} from "@/lib/intake-github-repo.mjs";
import type { GitHubRepoIntakePreview } from "@/lib/intake-github-repo.mjs";
import {
  buildAiBuiltAppRecoveryPreview,
  SAMPLE_AI_BUILT_APP,
} from "@/lib/intake-ai-built-app.mjs";
import type { AiBuiltAppRecoveryPreview } from "@/lib/intake-ai-built-app.mjs";
import {
  buildIntakeAcceptanceMap,
  NEXT_STEP_LABELS,
} from "@/lib/intake-acceptance-map.mjs";
import type { IntakeAcceptanceMap } from "@/lib/intake-acceptance-map.mjs";
import {
  buildIntakeStagePlan,
  STAGE_STATUS_LABELS,
  STAGE_KIND_LABELS,
} from "@/lib/intake-stage-plan.mjs";
import type { IntakeStagePlan } from "@/lib/intake-stage-plan.mjs";
import {
  buildAgentRunPlan,
  AGENT_ROLE_LABELS,
  AGENT_TOOL_LABELS,
  AGENT_STATUS_LABELS,
  AGENT_DECISION_LABELS,
} from "@/lib/intake-agent-run-plan.mjs";
import type { AgentRunPlan } from "@/lib/intake-agent-run-plan.mjs";
import {
  buildIntakeEvidencePlan,
  EVIDENCE_STATUS_LABELS,
  EVIDENCE_TYPE_LABELS,
} from "@/lib/intake-evidence-plan.mjs";
import type { IntakeEvidencePlan } from "@/lib/intake-evidence-plan.mjs";
import {
  saveWorkflowRecord,
  listWorkflowRecords,
  getWorkflowRecord,
  patchWorkflowRecordStatus,
  deleteWorkflowRecord,
} from "@/lib/workspace-agent-workflow-api";
import type {
  WorkflowRecord,
  WorkflowRecordListItem,
} from "@/lib/workspace-agent-workflow-api";
import { getUserKey } from "@/lib/workflow-store";
import { buildBetaFeedbackMailto } from "@/lib/beta-feedback.mjs";
import { getBetaOnboardingCopy } from "@/lib/beta-onboarding.mjs";
import { getBetaUsageBoundaryCopy } from "@/lib/beta-usage-boundary.mjs";
import { buildBenchmarkHandoffPreview } from "@/lib/intake-benchmark-handoff.mjs";
import { buildDecisionOutcomeLinkPreview } from "@/lib/intake-decision-outcome-link.mjs";
import { buildEvolutionActionPackPreview } from "@/lib/intake-evolution-action-preview.mjs";
import { buildAcceptanceGraphDerivedView } from "@/lib/acceptance-graph-derived.mjs";
import { buildRecurringBlockerDetectionView } from "@/lib/recurring-blocker-detection.mjs";
import { buildAgentToolRecommendationMemoryView } from "@/lib/agent-tool-recommendation-memory.mjs";
import { buildTemplateEffectivenessSignalsView } from "@/lib/template-effectiveness-signals.mjs";

export default function IntakePage() {
  // Stage 159 — dictionary-first i18n for the MCP handoff/intake destination.
  const { t: tr, locale } = useI18n();
  // Non-developer copy pass — locale-aware onboarding/usage-boundary copy.
  const ob = getBetaOnboardingCopy(locale);
  const ub = getBetaUsageBoundaryCopy(locale);
  // Stage 163 — localized thinking-step labels for genuinely-async waits.
  const loadingSteps = getDefaultStampThinkingSteps(tr.loading);
  // Non-developer copy pass — plain-language strings for this page.
  const ic = tr.intake.page;
  const statusText = (status: string) =>
    status === "archived" ? ic.statusArchived : status === "planned" ? ic.statusPlanned : status;
  const intakeTypeText = (value: string) => {
    const known = WORKSPACE_INTAKE_TYPES.find((x) => x === value);
    return known ? (tr.intake.startPoints[known]?.label ?? value.replace(/_/g, " ")) : value.replace(/_/g, " ");
  };
  const [type, setType] = useState<WorkspaceIntakeType | null>(null);
  const [rawInput, setRawInput] = useState("");
  const [draft, setDraft] = useState<WorkspaceIntakeDraft | null>(null);
  const [prdPreview, setPrdPreview] = useState<PrdIntakePreview | null>(null);
  const [urlPreview, setUrlPreview] = useState<ProductUrlIntakePreview | null>(null);
  const [repoPreview, setRepoPreview] = useState<GitHubRepoIntakePreview | null>(null);
  const [appPreview, setAppPreview] = useState<AiBuiltAppRecoveryPreview | null>(null);
  const [acceptanceMap, setAcceptanceMap] = useState<IntakeAcceptanceMap | null>(null);
  const [stagePlan, setStagePlan] = useState<IntakeStagePlan | null>(null);
  const [agentRunPlan, setAgentRunPlan] = useState<AgentRunPlan | null>(null);
  const [evidencePlan, setEvidencePlan] = useState<IntakeEvidencePlan | null>(null);

  // Stage 112 — persisted workflow records (save / list / reopen).
  const [saving, setSaving] = useState(false);
  const [savedRecord, setSavedRecord] = useState<WorkflowRecord | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<WorkflowRecordListItem[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [openRecord, setOpenRecord] = useState<WorkflowRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Stage 118 — saved workflow management (archive / restore / delete).
  const [showArchived, setShowArchived] = useState(false);
  const [manageBusyId, setManageBusyId] = useState<string | null>(null);
  const [manageMsg, setManageMsg] = useState<string | null>(null);

  const meta = type ? INTAKE_META[type] : null;

  // Stage 113 — deterministic benchmark handoff preview from the opened saved
  // record. Preview/linkage only — not executed or persisted.
  const handoff = useMemo(
    () =>
      openRecord
        ? buildBenchmarkHandoffPreview({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            acceptanceMap: openRecord.acceptanceMap,
            stagePlan: openRecord.stagePlan,
          })
        : null,
    [openRecord],
  );

  // Stage 114 — deterministic decision / outcome link preview from the opened
  // saved record + its handoff. Preview only — no decision/scorecard/action pack.
  const outcomeLink = useMemo(
    () =>
      openRecord
        ? buildDecisionOutcomeLinkPreview({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            acceptanceMap: openRecord.acceptanceMap,
            stagePlan: openRecord.stagePlan,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            benchmarkHandoffPreview: handoff ?? undefined,
          })
        : null,
    [openRecord, handoff],
  );

  // Stage 115 — deterministic evolution action pack preview from the opened
  // saved record + handoff + decision/outcome preview. Preview only — no action
  // pack persisted, no fix executed, no rerun, no evidence collected.
  const actionPack = useMemo(
    () =>
      openRecord
        ? buildEvolutionActionPackPreview({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            acceptanceMap: openRecord.acceptanceMap,
            stagePlan: openRecord.stagePlan,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            benchmarkHandoffPreview: handoff ?? undefined,
            decisionOutcomePreview: outcomeLink ?? undefined,
          })
        : null,
    [openRecord, handoff, outcomeLink],
  );

  // Stage 126 — derived Acceptance Graph view from the opened saved record +
  // its decision/outcome + evolution-action previews. Derived only — no graph DB.
  const graphView = useMemo(
    () =>
      openRecord
        ? buildAcceptanceGraphDerivedView({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            acceptanceMap: openRecord.acceptanceMap,
            stagePlan: openRecord.stagePlan,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            decisionOutcomePreview: outcomeLink ?? undefined,
            evolutionActionPreview: actionPack ?? undefined,
          })
        : null,
    [openRecord, outcomeLink, actionPack],
  );

  // Stage 127 — recurring blocker signals derived from the saved record + graph
  // view + decision/action previews. Derived only — signals, not verified defects.
  const blockerView = useMemo(
    () =>
      openRecord
        ? buildRecurringBlockerDetectionView({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            acceptanceGraphView: graphView ?? undefined,
            acceptanceMap: openRecord.acceptanceMap,
            stagePlan: openRecord.stagePlan,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            decisionOutcomePreview: outcomeLink ?? undefined,
            evolutionActionPreview: actionPack ?? undefined,
          })
        : null,
    [openRecord, graphView, outcomeLink, actionPack],
  );

  // Stage 128 — per-workflow agent/tool recommendation memory. Derived only —
  // tool fit is evidence alignment, not executed performance.
  const toolMemory = useMemo(
    () =>
      openRecord
        ? buildAgentToolRecommendationMemoryView({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            agentRunPlan: openRecord.agentRunPlan,
            evidencePlan: openRecord.evidencePlan,
            recurringBlockerDetectionView: blockerView ?? undefined,
          })
        : null,
    [openRecord, blockerView],
  );

  // Stage 129 — template effectiveness signals derived from the prior views.
  // Derived only — not statistically validated, no cross-project analytics.
  const templateSignals = useMemo(
    () =>
      openRecord
        ? buildTemplateEffectivenessSignalsView({
            workflowRecordId: openRecord.id,
            title: openRecord.title,
            sourceSummary: openRecord.sourceSummary,
            acceptanceGraphView: graphView ?? undefined,
            recurringBlockerDetectionView: blockerView ?? undefined,
            agentToolMemoryView: toolMemory ?? undefined,
            evidencePlan: openRecord.evidencePlan,
            stagePlan: openRecord.stagePlan,
            decisionOutcomePreview: outcomeLink ?? undefined,
            evolutionActionPreview: actionPack ?? undefined,
          })
        : null,
    [openRecord, graphView, blockerView, toolMemory, outcomeLink, actionPack],
  );

  function resetPreviews() {
    setDraft(null);
    setPrdPreview(null);
    setUrlPreview(null);
    setRepoPreview(null);
    setAppPreview(null);
    setAcceptanceMap(null);
    setStagePlan(null);
    setAgentRunPlan(null);
    setEvidencePlan(null);
    setSavedRecord(null);
    setSaveError(null);
  }

  // Stage 112 — save the generated workflow snapshot. Optional: the preview
  // works without saving. Not agent execution — nothing here is executed.
  async function saveWorkflow() {
    if (!type || !draft || !acceptanceMap || !stagePlan || !agentRunPlan || !evidencePlan) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedRecord(null);
    const res = await saveWorkflowRecord({
      userKey: getUserKey(),
      intakeType: type,
      title: draft.title,
      sourceSummary: draft.sourceSummary,
      rawInputExcerpt: rawInput.slice(0, 2000),
      acceptanceMap,
      stagePlan,
      agentRunPlan,
      evidencePlan,
      status: "planned",
    });
    if (res.ok) {
      setSavedRecord(res.record);
      void refreshSavedList();
    } else {
      setSaveError(res.error);
    }
    setSaving(false);
  }

  async function refreshSavedList(includeArchived = showArchived) {
    setListLoading(true);
    const res = await listWorkflowRecords(getUserKey(), { includeArchived });
    setSavedList(res.ok ? res.records : []);
    setListLoading(false);
  }

  function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    void refreshSavedList(next);
  }

  async function openSavedRecord(id: string) {
    setDetailLoading(true);
    setOpenRecord(null);
    const res = await getWorkflowRecord(id, getUserKey());
    if (res.ok) setOpenRecord(res.record);
    setDetailLoading(false);
  }

  // Stage 118 — archive / restore a saved record, then refresh the list.
  async function setRecordStatus(id: string, status: "planned" | "archived") {
    setManageBusyId(id);
    setManageMsg(null);
    const res = await patchWorkflowRecordStatus(id, getUserKey(), status);
    if (res.ok) {
      setManageMsg(status === "archived" ? ic.workflowArchived : ic.workflowRestored);
      if (openRecord?.id === id) setOpenRecord(res.record);
      await refreshSavedList();
    } else {
      setManageMsg(`${ic.couldNotUpdate} ${res.error}`);
    }
    setManageBusyId(null);
  }

  // Stage 118 — explicit delete (with confirmation), then refresh the list.
  async function removeRecord(id: string) {
    if (typeof window !== "undefined" && !window.confirm(ic.confirmDelete)) {
      return;
    }
    setManageBusyId(id);
    setManageMsg(null);
    const res = await deleteWorkflowRecord(id, getUserKey());
    if (res.ok) {
      setManageMsg(ic.workflowDeleted);
      if (openRecord?.id === id) setOpenRecord(null);
      await refreshSavedList();
    } else {
      setManageMsg(`${ic.couldNotDelete} ${res.error}`);
    }
    setManageBusyId(null);
  }

  function selectType(next: WorkspaceIntakeType) {
    setType(next);
    setRawInput("");
    resetPreviews();
  }

  function createDraft() {
    if (!type || !rawInput.trim()) return;
    setDraft(buildIntakeDraft(type, rawInput));
    // Stage 102/103: deterministic per-type previews (prd / product_url only).
    setPrdPreview(type === "prd" ? buildPrdIntakePreview(rawInput) : null);
    setUrlPreview(
      type === "product_url" ? buildProductUrlIntakePreview(rawInput) : null,
    );
    setRepoPreview(
      type === "github_repo" ? buildGitHubRepoIntakePreview(rawInput) : null,
    );
    setAppPreview(
      type === "ai_built_app" ? buildAiBuiltAppRecoveryPreview(rawInput) : null,
    );
    // Stage 106/107/110: shared acceptance map + stage plan + agent run plan.
    setAcceptanceMap(buildIntakeAcceptanceMap({ type, rawInput }));
    setStagePlan(buildIntakeStagePlan({ type, rawInput }));
    setAgentRunPlan(buildAgentRunPlan({ type, rawInput }));
    setEvidencePlan(buildIntakeEvidencePlan({ type, rawInput }));
  }

  return (
    <div className="flex flex-1 justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          {tr.intake.handoff.title}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {tr.intake.handoff.subtitle}
        </p>
        {/* Stage 119 — page-level beta feedback CTA */}
        <p className="mt-2 text-xs text-gray-400">
          <FeedbackLink label={tr.intake.handoff.feedbackLabel} context={{ section: "Intake workflow" }} />{" "}
          — {ob.safetyNotes.feedback}
        </p>

        {/* Stage 120 — preview-only onboarding panel */}
        <div className="card mt-6 p-5">
          <p className="text-sm font-semibold text-gray-900">{ob.heading}</p>
          <p className="mt-1 text-sm text-gray-500">{ob.intro}</p>
          <ol className="mt-3 space-y-1">
            {ob.steps.map((step, i) => (
              <li key={step} className="flex gap-2 text-sm text-gray-700">
                <span className="text-gray-400">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            {ob.safetyLine}
          </p>

          {/* Stage 120 — preview language legend */}
          <p className="mt-4 text-xs font-medium text-gray-500">{tr.intake.handoff.previewLanguageLabel}</p>
          <dl className="mt-1 space-y-1">
            {ob.previewLanguageItems.map((item) => (
              <div key={item.term} className="text-xs text-gray-600">
                <dt className="inline font-medium text-gray-700">{item.term}</dt>
                <dd className="inline"> — {item.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Stage 122 — beta usage / cost boundary panel */}
        <div className="card mt-6 p-5">
          <p className="text-sm font-semibold text-gray-900">
            {ub.heading}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
            {ub.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
            {ub.notActive}
          </p>
        </div>

        {/* Step 1 — pick a starting point */}
        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WORKSPACE_INTAKE_TYPES.map((t) => {
            const m = INTAKE_META[t];
            const selected = t === type;
            return (
              <button
                key={t}
                type="button"
                onClick={() => selectType(t)}
                className={`rounded-lg border px-4 py-3 text-left transition-all ${
                  selected
                    ? "border-brand-500 bg-brand-50"
                    : "border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50"
                }`}
              >
                <span className="block text-sm font-medium text-gray-900">
                  {tr.intake.startPoints[t]?.label ?? m.label}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {tr.intake.startPoints[t]?.description ?? m.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Stage 120 — empty state before a starting point is picked */}
        {!meta && (
          <p className="mt-4 text-sm text-gray-500">{ob.emptyStates.beforeInput}</p>
        )}

        {/* Step 2 — paste what you have */}
        {meta && (
          <div className="mt-8">
            <label className="mb-2 block text-sm font-medium text-gray-900">
              {tr.intake.handoff.pasteLabel}
            </label>
            <p className="text-xs text-gray-400">{meta.inputHint}</p>
            {/* Stage 120 — before-input beta safety note */}
            <p className="mb-2 mt-1 text-xs text-amber-600">
              {ob.safetyNotes.beforeInput}
            </p>
            <textarea
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                resetPreviews();
              }}
              placeholder={meta.placeholder}
              rows={5}
              className="input w-full resize-none rounded-lg"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={createDraft}
                disabled={!rawInput.trim()}
                className="btn btn-primary btn-md"
              >
                {ic.createDraftButton}
              </button>
              {type === "product_url" && (
                <button
                  type="button"
                  onClick={() => {
                    setRawInput(SAMPLE_PRODUCT_URL);
                    resetPreviews();
                  }}
                  className="btn btn-secondary btn-md"
                >
                  {ic.useExampleUrl}
                </button>
              )}
              {type === "github_repo" && (
                <button
                  type="button"
                  onClick={() => {
                    setRawInput(SAMPLE_GITHUB_REPO);
                    resetPreviews();
                  }}
                  className="btn btn-secondary btn-md"
                >
                  {ic.useExampleRepo}
                </button>
              )}
              {type === "ai_built_app" && (
                <button
                  type="button"
                  onClick={() => {
                    setRawInput(SAMPLE_AI_BUILT_APP);
                    resetPreviews();
                  }}
                  className="btn btn-secondary btn-md"
                >
                  {ic.useExampleApp}
                </button>
              )}
              {type === "prd" && (
                <button
                  type="button"
                  onClick={() => {
                    setRawInput(SAMPLE_PRD);
                    resetPreviews();
                  }}
                  className="btn btn-secondary btn-md"
                >
                  {ic.useExamplePrd}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3 — deterministic local preview */}
        {draft && (
          <div className="card mt-8 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.draftTitle}
            </p>
            <h2 className="mt-1 text-base font-semibold text-gray-900">
              {draft.title}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{draft.sourceSummary}</p>

            <p className="mt-5 text-sm font-medium text-gray-900">
              {ic.draftWillTurnInto}
            </p>
            <ul className="mt-2 space-y-1">
              {draft.expectedOutputs.map((out) => (
                <li
                  key={out}
                  className="rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
                >
                  {INTAKE_OUTPUT_LABELS[out]}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-gray-400">
              {ic.draftPreviewNote}
            </p>
          </div>
        )}

        {/* Stage 102 — deterministic PRD / spec preview (prd type only) */}
        {prdPreview && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.prdTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {prdPreview.confidence}
            </TechDetails>

            <p className="mt-3 text-sm font-medium text-gray-900">
              {ic.productIntent}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {prdPreview.productIntent}
            </p>

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.likelyUsers}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {prdPreview.likelyUsers.map((u) => (
                <span
                  key={u}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-600"
                >
                  {u}
                </span>
              ))}
            </div>

            <PrdList title={ic.candidateUserFlows} items={prdPreview.candidateUserFlows} />
            <PrdList
              title={ic.candidateAcceptanceItems}
              items={prdPreview.candidateAcceptanceItems}
            />
            <PrdList title={ic.missingQuestions} items={prdPreview.missingQuestions} />

            <p className="mt-4 text-xs text-gray-400">
              {ic.prdPreviewNote}
            </p>
          </div>
        )}

        {/* Stage 103 — deterministic Product URL preview (product_url type only) */}
        {urlPreview && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.urlTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {urlPreview.confidence}
            </TechDetails>

            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-400">{ic.normalizedUrl}</dt>
                <dd className="break-all text-sm text-gray-700">
                  {urlPreview.normalizedUrl || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.domain}</dt>
                <dd className="text-sm text-gray-700">{urlPreview.domain}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.surfaceType}</dt>
                <dd className="text-sm text-gray-700">{urlPreview.pathType}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.likelySurface}</dt>
                <dd className="text-sm text-gray-700">{urlPreview.likelySurface}</dd>
              </div>
            </dl>

            <PrdList title={ic.reviewFocusAreas} items={urlPreview.reviewFocusAreas} />
            <PrdList
              title={ic.candidateAcceptanceItems}
              items={urlPreview.candidateAcceptanceItems}
            />
            <PrdList title={ic.missingQuestions} items={urlPreview.missingQuestions} />

            <p className="mt-4 text-xs text-gray-400">
              {ic.urlPreviewNote}
            </p>
          </div>
        )}

        {/* Stage 104 — deterministic GitHub repo preview (github_repo type only) */}
        {repoPreview && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.repoTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {repoPreview.confidence}
            </TechDetails>

            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-gray-400">{ic.normalizedRepo}</dt>
                <dd className="text-sm text-gray-700">{repoPreview.normalizedRepo}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.owner}</dt>
                <dd className="text-sm text-gray-700">{repoPreview.owner}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.repository}</dt>
                <dd className="text-sm text-gray-700">{repoPreview.repo}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">{ic.likelyRepoType}</dt>
                <dd className="text-sm text-gray-700">{repoPreview.likelyRepoType}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-400">{ic.repoUrl}</dt>
                <dd className="break-all text-sm text-gray-700">
                  {repoPreview.repoUrl || "—"}
                </dd>
              </div>
            </dl>

            <PrdList title={ic.reviewFocusAreas} items={repoPreview.reviewFocusAreas} />
            <PrdList
              title={ic.candidateAcceptanceItems}
              items={repoPreview.candidateAcceptanceItems}
            />
            <PrdList title={ic.missingQuestions} items={repoPreview.missingQuestions} />

            <p className="mt-4 text-xs text-gray-400">
              {ic.repoPreviewNote}
            </p>
          </div>
        )}

        {/* Stage 105 — deterministic AI-built app recovery (ai_built_app only) */}
        {appPreview && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.appTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {appPreview.confidence}
            </TechDetails>

            <p className="mt-3 text-sm font-medium text-gray-900">
              {ic.currentStateSummary}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {appPreview.currentStateSummary}
            </p>

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.likelyProductSurface}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {appPreview.likelyProductSurface}
            </p>

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.recommendedNextAction}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {appPreview.recommendedNextAction.replace(/_/g, " ")}
            </p>

            <PrdList title={ic.recoveryFocusAreas} items={appPreview.recoveryFocusAreas} />
            <PrdList
              title={ic.candidateAcceptanceItems}
              items={appPreview.candidateAcceptanceItems}
            />
            <PrdList title={ic.likelyRisks} items={appPreview.likelyRisks} />

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.fixVsRebuildSignals}
            </p>
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FixRebuild title={ic.likelyKeep} items={appPreview.fixVsRebuildSignals.likelyKeep} />
              <FixRebuild title={ic.likelyFix} items={appPreview.fixVsRebuildSignals.likelyFix} />
              <FixRebuild title={ic.likelyRebuild} items={appPreview.fixVsRebuildSignals.likelyRebuild} />
              <FixRebuild
                title={ic.needsVerification}
                items={appPreview.fixVsRebuildSignals.needsVerification}
              />
            </div>

            <PrdList title={ic.missingQuestions} items={appPreview.missingQuestions} />

            <p className="mt-4 text-xs text-gray-400">
              {ic.appPreviewNote}
            </p>
          </div>
        )}

        {/* Stage 106 — shared Acceptance Map (all intake types) */}
        {acceptanceMap && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.acceptanceMapTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {acceptanceMap.confidence}
            </TechDetails>
            <p className="mt-2 text-sm text-gray-500">
              {ic.acceptanceMapIntro}
            </p>

            <p className="mt-4 text-sm font-medium text-gray-900">{ic.summaryLabel}</p>
            <p className="mt-1 text-sm text-gray-600">{acceptanceMap.summary}</p>

            <p className="mt-4 text-sm font-medium text-gray-900">{ic.areasLabel}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {acceptanceMap.areas.map((a) => (
                <span
                  key={a}
                  className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-600"
                >
                  {a.replace(/_/g, " ")}
                </span>
              ))}
            </div>

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.acceptanceItemsLabel}
            </p>
            <ul className="mt-1 space-y-1">
              {acceptanceMap.items.map((it) => (
                <li
                  key={it.title}
                  className="rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
                >
                  <span>{it.title}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    · {it.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>

            <PrdList title={ic.missingQuestions} items={acceptanceMap.missingQuestions} />

            <p className="mt-4 text-sm font-medium text-gray-900">
              {ic.recommendedNextStep}
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {NEXT_STEP_LABELS[acceptanceMap.recommendedNextStep]}
            </p>

            <p className="mt-4 text-xs text-gray-400">
              {ic.acceptanceMapNote}
            </p>
          </div>
        )}

        {/* Stage 107 — shared Stage Plan (all intake types) */}
        {stagePlan && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.stagePlanTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {stagePlan.confidence}
            </TechDetails>
            <p className="mt-2 text-sm text-gray-500">
              {ic.stagePlanIntro}
            </p>
            <p className="mt-3 text-sm text-gray-700">
              {ic.recommendedStartStage} {stagePlan.recommendedStartStage}
            </p>

            <div className="mt-3 space-y-2">
              {stagePlan.stages.map((s) => (
                <div
                  key={s.number}
                  className={`rounded-lg border p-3 ${
                    s.number === stagePlan.recommendedStartStage
                      ? "border-brand-300 bg-brand-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {ic.stageWord} {s.number}: {s.title}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {STAGE_KIND_LABELS[s.kind]}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {STAGE_STATUS_LABELS[s.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{s.goal}</p>
                  <StageDetail label={ic.candidateChecks} items={s.candidateChecks} />
                  <StageDetail label={ic.evidenceToCollect} items={s.evidenceToCollect} />
                  <StageDetail label={ic.exitCriteria} items={s.exitCriteria} />
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">
                {stagePlan.releaseGate.title}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                {stagePlan.releaseGate.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-xs text-gray-400">
              {ic.stagePlanNote}
            </p>
          </div>
        )}

        {/* Stage 110 — Agent Run Plan (all intake types) */}
        {agentRunPlan && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.agentRunPlanTitle}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {agentRunPlan.confidence}
            </TechDetails>
            <p className="mt-2 text-sm text-gray-500">
              {ic.agentRunPlanIntro}
            </p>
            <p className="mt-3 text-sm text-gray-700">
              {ic.primaryRole} {AGENT_ROLE_LABELS[agentRunPlan.primaryRole]} ·{" "}
              {ic.recommendedFirst} {agentRunPlan.recommendedFirstTaskId}
            </p>

            <div className="mt-3 space-y-2">
              {agentRunPlan.tasks.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-lg border p-3 ${
                    t.id === agentRunPlan.recommendedFirstTaskId
                      ? "border-brand-300 bg-brand-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {ic.stageWord} {t.stageNumber}: {t.stageTitle}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {AGENT_ROLE_LABELS[t.role]}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {AGENT_STATUS_LABELS[t.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{t.task}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {ic.recommendedTool} {AGENT_TOOL_LABELS[t.recommendedTool]} ·{" "}
                    {ic.nextDecision} {AGENT_DECISION_LABELS[t.nextDecision]}
                  </p>
                  <StageDetail label={ic.inputsLabel} items={t.inputs} />
                  <StageDetail label={ic.acceptanceItemsLabel} items={t.acceptanceItems} />
                  <StageDetail label={ic.expectedEvidence} items={t.expectedEvidence} />
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-gray-400">
              {ic.agentRunPlanNote}
            </p>
          </div>
        )}

        {/* Stage 111 — Evidence Plan (all intake types) */}
        {evidencePlan && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.evidencePlanTitle} · {ic.overallLabel}{" "}
              {EVIDENCE_STATUS_LABELS[evidencePlan.overallEvidenceStatus]}
            </p>
            <TechDetails summary={ic.techDetails}>
              {ic.techConfidence}: {evidencePlan.confidence}
            </TechDetails>
            <p className="mt-2 text-sm text-gray-500">
              {ic.evidencePlanIntro}
            </p>

            <div className="mt-3 space-y-2">
              {evidencePlan.expectations.map((e) => (
                <div key={e.id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {e.acceptanceItemTitle}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {EVIDENCE_STATUS_LABELS[e.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {ic.areaLabel}: {e.relatedArea.replace(/_/g, " ")}
                    {e.relatedStageNumbers.length > 0 &&
                      ` · ${ic.stagesLabel}: ${e.relatedStageNumbers.join(", ")}`}
                    {e.relatedTaskIds.length > 0 && ` · ${ic.tasksLabel}: ${e.relatedTaskIds.join(", ")}`}
                    {` · ${ic.decisionImpact}: ${AGENT_DECISION_LABELS[e.decisionImpact]}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.evidenceTypes.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
                      >
                        {EVIDENCE_TYPE_LABELS[t]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-sm text-gray-600">{e.whyNeeded}</p>
                </div>
              ))}
            </div>

            <StageDetail
              label={ic.missingEvidenceQuestions}
              items={evidencePlan.missingEvidenceQuestions}
            />

            <p className="mt-4 text-xs text-gray-400">
              {ic.evidencePlanNote}
            </p>
            {/* Stage 119 — preview-section feedback CTA */}
            <p className="mt-2">
              <FeedbackLink
                label={ic.feedbackPreview}
                context={{ intakeType: type ?? undefined, section: "Evidence Plan" }}
              />
            </p>
          </div>
        )}

        {/* Stage 112 — save the generated workflow snapshot (optional) */}
        {evidencePlan && (
          <div className="card mt-6 p-5">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.saveTitle}
            </p>
            <p className="mt-2 text-sm text-gray-500">
              {ic.saveIntro}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={saveWorkflow}
                disabled={saving}
                className="btn btn-primary btn-md inline-flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <SimsaStampThinking variant="compact" label={tr.loading.saving} />
                    <span>{tr.loading.saving}</span>
                  </>
                ) : (
                  <span>{ic.saveButton}</span>
                )}
              </button>
            </div>

            {saveError && (
              <p className="mt-3 text-sm text-red-600">{ic.couldNotSave} {saveError}</p>
            )}

            {savedRecord && (
              <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                <p className="text-sm font-medium text-gray-900">
                  {ic.savedHeading}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {ic.idLabel} {savedRecord.id} · {ic.statusLabel} {statusText(savedRecord.status)} · {ic.createdLabel}{" "}
                  {savedRecord.createdAt}
                </p>
                <button
                  type="button"
                  onClick={() => openSavedRecord(savedRecord.id)}
                  className="btn btn-secondary btn-sm mt-2"
                >
                  {ic.reopenButton}
                </button>
              </div>
            )}

            <p className="mt-4 text-xs text-gray-400">
              {ic.saveOptionalNote}
            </p>
          </div>
        )}

        {/* Stage 112 — saved workflow plans (list + reopen) */}
        <div className="card mt-6 p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {ic.savedListTitle}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={toggleShowArchived}
                />
                {ic.showArchived}
              </label>
              <button
                type="button"
                onClick={() => refreshSavedList()}
                disabled={listLoading}
                className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
              >
                {listLoading ? (
                  <>
                    <SimsaStampThinking variant="compact" label={tr.loading.refreshing} />
                    <span>{tr.loading.refreshing}</span>
                  </>
                ) : (
                  <span>{ic.refreshButton}</span>
                )}
              </button>
            </div>
          </div>

          {/* Stage 120/122 — beta tenant-scope + retention + usage-boundary notes */}
          <p className="mt-2 text-xs text-gray-400">{ub.savedWorkflowNote}</p>
          <p className="mt-1 text-xs text-gray-400">{ob.safetyNotes.savedScope}</p>
          <p className="mt-1 text-xs text-gray-400">{ob.safetyNotes.savedRetention}</p>

          {manageMsg && (
            <p className="mt-2 text-xs text-gray-500">{manageMsg}</p>
          )}

          {savedList === null && (
            <p className="mt-3 text-sm text-gray-500">
              {ic.refreshHint}
            </p>
          )}
          {savedList !== null && savedList.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">{ob.emptyStates.noSavedRecords}</p>
          )}
          {savedList !== null && savedList.length > 0 && !openRecord && !detailLoading && (
            <p className="mt-3 text-xs text-gray-400">{ob.emptyStates.noOpenedRecord}</p>
          )}
          {savedList !== null && savedList.length > 0 && (
            <ul className="mt-3 space-y-2">
              {savedList.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-gray-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {r.title}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {intakeTypeText(r.intakeType)}
                    </span>
                    <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                      {statusText(r.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{r.sourceSummary}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {r.id} · {ic.listCreated} {r.createdAt} · {ic.listUpdated} {r.updatedAt}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openSavedRecord(r.id)}
                      className="btn btn-secondary btn-sm"
                    >
                      {ic.openButton}
                    </button>
                    {r.status === "archived" ? (
                      <button
                        type="button"
                        onClick={() => setRecordStatus(r.id, "planned")}
                        disabled={manageBusyId === r.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {manageBusyId === r.id ? "…" : ic.restoreButton}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRecordStatus(r.id, "archived")}
                        disabled={manageBusyId === r.id}
                        className="btn btn-secondary btn-sm"
                      >
                        {manageBusyId === r.id ? "…" : ic.archiveButton}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRecord(r.id)}
                      disabled={manageBusyId === r.id}
                      className="btn btn-secondary btn-sm text-red-600"
                    >
                      {manageBusyId === r.id ? "…" : ic.deleteButton}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Stage 163 — real async wait (fetching a saved record): truthful thinking panel. */}
          {detailLoading && (
            <SimsaStampThinking
              variant="panel"
              stepLabels={loadingSteps}
              label={tr.loading.reviewingEvidence}
              className="mt-3"
            />
          )}

          {openRecord && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">
                  {openRecord.title}
                </p>
                <button
                  type="button"
                  onClick={() => setOpenRecord(null)}
                  className="btn btn-secondary btn-sm"
                >
                  {ic.closeButton}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {intakeTypeText(openRecord.intakeType)} · {statusText(openRecord.status)} ·{" "}
                {openRecord.id}
              </p>
              <p className="mt-2 text-sm text-gray-600">
                {openRecord.sourceSummary}
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-gray-500">
                  {ic.techDetails}
                </summary>
                <p className="mt-2 text-xs font-medium text-gray-500">
                  {ic.savedSnapshotLabel}
                </p>
                <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700">
                  {JSON.stringify(
                    {
                      acceptanceMap: openRecord.acceptanceMap,
                      stagePlan: openRecord.stagePlan,
                      agentRunPlan: openRecord.agentRunPlan,
                      evidencePlan: openRecord.evidencePlan,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <p className="mt-2 text-xs text-gray-400">
                {ic.savedSnapshotNote}
              </p>
              {/* Stage 119 — saved-workflow feedback CTA */}
              <p className="mt-2">
                <FeedbackLink
                  label={ic.feedbackSaved}
                  context={{
                    intakeType: openRecord.intakeType,
                    workflowRecordId: openRecord.id,
                    section: "Saved workflow detail",
                  }}
                />
              </p>

              {/* Stage 113 — benchmark handoff preview from the saved record */}
              {handoff && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.handoffTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {handoff.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{handoff.summary}</p>

                  <p className="mt-3 text-sm font-medium text-gray-900">
                    {ic.benchmarkGoal}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">{handoff.benchmarkGoal}</p>

                  <p className="mt-4 text-sm font-medium text-gray-900">
                    {ic.candidateAgents}
                  </p>
                  <div className="mt-1 space-y-2">
                    {handoff.agentCandidates.map((c) => (
                      <div
                        key={c.label}
                        className="rounded-md border border-gray-100 bg-gray-50 p-3"
                      >
                        <p className="text-sm font-medium text-gray-800">{c.label}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {c.stageNumbers.length > 0 &&
                            `${ic.stagesLabel}: ${c.stageNumbers.join(", ")}`}
                          {c.taskIds.length > 0 && ` · ${ic.tasksLabel}: ${c.taskIds.join(", ")}`}
                        </p>
                        {c.expectedEvidence.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {c.expectedEvidence.map((e) => (
                              <span
                                key={e}
                                className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-sm font-medium text-gray-900">
                    {ic.acceptanceTargets}
                  </p>
                  <div className="mt-1 space-y-2">
                    {handoff.acceptanceTargets.map((t) => (
                      <div
                        key={t.acceptanceItemTitle}
                        className="rounded-md border border-gray-100 bg-gray-50 p-3"
                      >
                        <p className="text-sm font-medium text-gray-800">
                          {t.acceptanceItemTitle}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {ic.areaLabel}: {t.area.replace(/_/g, " ")}
                          {t.stageNumbers.length > 0 &&
                            ` · ${ic.stagesLabel}: ${t.stageNumbers.join(", ")}`}
                        </p>
                        {t.evidenceTypes.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {t.evidenceTypes.map((e) => (
                              <span
                                key={e}
                                className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        )}
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                          {t.decisionCriteria.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <StageDetail
                    label={ic.comparisonQuestions}
                    items={handoff.comparisonQuestions}
                  />
                  <StageDetail label={ic.notIncludedYet} items={handoff.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.handoffNote}
                  </p>
                </div>
              )}

              {/* Stage 114 — decision / outcome link preview from the saved record */}
              {outcomeLink && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.outcomeTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {outcomeLink.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{outcomeLink.summary}</p>

                  <p className="mt-3 text-sm font-medium text-gray-900">
                    {ic.recommendedDecision}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {
                      outcomeLink.decisionCandidates.find(
                        (c) => c.type === outcomeLink.recommendedDecisionCandidate,
                      )?.label
                    }
                  </p>

                  <p className="mt-4 text-sm font-medium text-gray-900">
                    {ic.decisionCandidates}
                  </p>
                  <div className="mt-1 space-y-2">
                    {outcomeLink.decisionCandidates.map((c) => (
                      <div
                        key={c.type}
                        className={`rounded-md border p-3 ${
                          c.type === outcomeLink.recommendedDecisionCandidate
                            ? "border-brand-300 bg-brand-50"
                            : "border-gray-100 bg-gray-50"
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-800">{c.label}</p>
                        <p className="mt-0.5 text-sm text-gray-600">{c.rationale}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {c.relatedAcceptanceItems.length > 0 &&
                            `${ic.itemsLabel}: ${c.relatedAcceptanceItems.join("; ")}`}
                          {c.relatedStageNumbers.length > 0 &&
                            ` · ${ic.stagesLabel}: ${c.relatedStageNumbers.join(", ")}`}
                        </p>
                        {c.requiredEvidence.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {c.requiredEvidence.map((e) => (
                              <span
                                key={e}
                                className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.blockingQuestions.length > 0 && (
                          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
                            {c.blockingQuestions.map((q) => (
                              <li key={q}>{q}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="mt-4 text-sm font-medium text-gray-900">
                    {ic.outcomeScorecardSignals}
                  </p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                    {(
                      [
                        ["evidenceCompleteness", ic.evidenceCompleteness],
                        ["acceptanceCoverage", ic.acceptanceCoverage],
                        ["unresolvedRisk", ic.unresolvedRisk],
                        ["releaseReadiness", ic.releaseReadiness],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-xs text-gray-400">{label}</dt>
                        <dd className="text-sm text-gray-700">
                          {outcomeLink.outcomeScorecardSignals[key]}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <StageDetail
                    label={ic.futureOutcomeLinks}
                    items={outcomeLink.futureOutcomeLinks}
                  />
                  <StageDetail label={ic.notIncludedYet} items={outcomeLink.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.outcomeNote}
                  </p>
                </div>
              )}

              {/* Stage 115 — evolution action pack preview from the saved record */}
              {actionPack && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.actionPackTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {actionPack.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{actionPack.summary}</p>

                  <p className="mt-3 text-sm font-medium text-gray-900">
                    {ic.recommendedFocus}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {actionPack.recommendedFocus.replace(/_/g, " ")}
                  </p>

                  <p className="mt-4 text-sm font-medium text-gray-900">
                    {ic.suggestedActions}
                  </p>
                  <div className="mt-1 space-y-2">
                    {actionPack.actions.map((a) => (
                      <div
                        key={a.id}
                        className={`rounded-md border p-3 ${
                          a.type === actionPack.recommendedFocus
                            ? "border-brand-300 bg-brand-50"
                            : "border-gray-100 bg-gray-50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-800">
                            {a.title}
                          </span>
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                            {a.type.replace(/_/g, " ")}
                          </span>
                          <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                            {a.priority}
                          </span>
                          <span className="text-xs text-gray-400">{a.id}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{a.rationale}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {a.sourceSignals.length > 0 &&
                            `${ic.signalsLabel}: ${a.sourceSignals.join("; ")}`}
                          {a.relatedAcceptanceItems.length > 0 &&
                            ` · ${ic.itemsLabel}: ${a.relatedAcceptanceItems.join("; ")}`}
                          {a.relatedStageNumbers.length > 0 &&
                            ` · ${ic.stagesLabel}: ${a.relatedStageNumbers.join(", ")}`}
                        </p>
                        <p className="mt-1.5 text-sm text-gray-700">
                          {a.suggestedInstruction}
                        </p>
                        {a.expectedEvidence.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {a.expectedEvidence.map((e) => (
                              <span
                                key={e}
                                className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <StageDetail
                    label={ic.followUpQuestions}
                    items={actionPack.followUpQuestions}
                  />
                  <StageDetail label={ic.notIncludedYet} items={actionPack.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.actionPackNote}
                  </p>
                </div>
              )}

              {/* Stage 126 — derived Acceptance Graph view from the saved record */}
              {graphView && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.graphTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {graphView.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{graphView.summary}</p>

                  <p className="mt-3 text-sm font-medium text-gray-900">{ic.signalSummary}</p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                    {(
                      [
                        ["acceptanceItemCount", ic.graphCounts.acceptanceItemCount],
                        ["stageCount", ic.graphCounts.stageCount],
                        ["agentTaskCount", ic.graphCounts.agentTaskCount],
                        ["evidenceExpectationCount", ic.graphCounts.evidenceExpectationCount],
                        ["notVerifiedCount", ic.graphCounts.notVerifiedCount],
                        ["decisionCandidateCount", ic.graphCounts.decisionCandidateCount],
                        ["actionPreviewCount", ic.graphCounts.actionPreviewCount],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-xs text-gray-400">{label}</dt>
                        <dd className="text-sm text-gray-700">
                          {graphView.signalSummary[key]}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {graphView.signalSummary.topAcceptanceAreas.length > 0 && (
                    <>
                      <p className="mt-4 text-sm font-medium text-gray-900">
                        {ic.topAcceptanceAreas}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {graphView.signalSummary.topAcceptanceAreas.map((a) => (
                          <span
                            key={a.area}
                            className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {a.area.replace(/_/g, " ")} · {a.count}
                          </span>
                        ))}
                      </div>
                    </>
                  )}

                  {graphView.signalSummary.topEvidenceTypes.length > 0 && (
                    <>
                      <p className="mt-4 text-sm font-medium text-gray-900">
                        {ic.topEvidenceTypes}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {graphView.signalSummary.topEvidenceTypes.map((e) => (
                          <span
                            key={e.evidenceType}
                            className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {e.evidenceType.replace(/_/g, " ")} · {e.count}
                          </span>
                        ))}
                      </div>
                    </>
                  )}

                  <p className="mt-4 text-xs text-gray-500">
                    {ic.graphNodes}: {graphView.nodes.length} · {ic.graphEdges}:{" "}
                    {graphView.edges.length} — {ic.graphSampleBelow}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                    {graphView.nodes.slice(0, 6).map((n) => (
                      <li key={n.id}>
                        <span className="text-gray-400">{n.type.replace(/_/g, " ")}:</span>{" "}
                        {n.label}
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                    {graphView.edges.slice(0, 6).map((e) => (
                      <li key={e.id}>
                        {e.from} <span className="text-gray-400">{e.label} →</span> {e.to}
                      </li>
                    ))}
                  </ul>

                  <StageDetail label={ic.notIncludedYet} items={graphView.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.graphNote}
                  </p>
                </div>
              )}

              {/* Stage 127 — recurring blocker signals from the saved record */}
              {blockerView && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.blockersTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {blockerView.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{blockerView.summary}</p>

                  {blockerView.blockers.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      {ic.blockersEmpty}
                    </p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm text-gray-700">
                        {ic.topBlockerType}{" "}
                        {blockerView.topBlockerType?.replace(/_/g, " ")}
                      </p>
                      <div className="mt-3 space-y-2">
                        {blockerView.blockers.map((b) => (
                          <div
                            key={b.id}
                            className="rounded-md border border-gray-100 bg-gray-50 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {b.title}
                              </span>
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                                {b.type.replace(/_/g, " ")}
                              </span>
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                                {b.severity}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-gray-600">{b.summary}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {b.sourceSignals.length > 0 &&
                                `${ic.signalsLabel}: ${b.sourceSignals.join("; ")}`}
                              {b.relatedAcceptanceAreas.length > 0 &&
                                ` · ${ic.areasLabel}: ${b.relatedAcceptanceAreas
                                  .map((a) => a.replace(/_/g, " "))
                                  .join(", ")}`}
                              {b.relatedEvidenceTypes.length > 0 &&
                                ` · ${ic.evidenceLabel}: ${b.relatedEvidenceTypes
                                  .map((e) => e.replace(/_/g, " "))
                                  .join(", ")}`}
                              {b.relatedStageNumbers.length > 0 &&
                                ` · ${ic.stagesLabel}: ${b.relatedStageNumbers.join(", ")}`}
                            </p>
                            <p className="mt-1.5 text-sm text-gray-700">
                              {b.suggestedNextAction}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <StageDetail label={ic.notIncludedYet} items={blockerView.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.blockersNote}
                  </p>
                </div>
              )}

              {/* Stage 128 — agent/tool recommendation memory from the saved record */}
              {toolMemory && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.toolMemoryTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {toolMemory.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{toolMemory.summary}</p>

                  {toolMemory.items.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      {ic.toolMemoryEmpty}
                    </p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm text-gray-700">
                        {ic.topPairing}{" "}
                        {toolMemory.topRole}/{toolMemory.topTool?.replace(/_/g, " ")} ·{" "}
                        {ic.evidenceFit} — {ic.strongWord} {toolMemory.evidenceFitSummary.strong} ·{" "}
                        {ic.partialWord} {toolMemory.evidenceFitSummary.partial} · {ic.weakWord}{" "}
                        {toolMemory.evidenceFitSummary.weak} · {ic.unknownWord}{" "}
                        {toolMemory.evidenceFitSummary.unknown}
                      </p>
                      <div className="mt-3 space-y-2">
                        {toolMemory.items.map((it) => (
                          <div
                            key={it.id}
                            className="rounded-md border border-gray-100 bg-gray-50 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {it.role} / {it.recommendedTool.replace(/_/g, " ")}
                              </span>
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                                {ic.fitLabel}: {it.toolFit}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              {it.stageNumbers.length > 0 &&
                                `${ic.stagesLabel}: ${it.stageNumbers.join(", ")}`}
                              {it.taskIds.length > 0 && ` · ${ic.tasksLabel}: ${it.taskIds.join(", ")}`}
                              {it.blockerTypes.length > 0 &&
                                ` · ${ic.blockersLabel}: ${it.blockerTypes
                                  .map((b) => b.replace(/_/g, " "))
                                  .join(", ")}`}
                            </p>
                            {it.expectedEvidenceTypes.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {it.expectedEvidenceTypes.map((e) => (
                                  <span
                                    key={e}
                                    className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600"
                                  >
                                    {e.replace(/_/g, " ")}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="mt-1.5 text-sm text-gray-600">{it.memoryNote}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {it.suggestedFutureUse}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <StageDetail label={ic.notIncludedYet} items={toolMemory.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.toolMemoryNote}
                  </p>
                </div>
              )}

              {/* Stage 129 — template effectiveness signals from the saved record */}
              {templateSignals && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    {ic.templateSignalsTitle}
                  </p>
                  <TechDetails summary={ic.techDetails}>
                    {ic.techConfidence}: {templateSignals.confidence}
                  </TechDetails>
                  <p className="mt-2 text-sm text-gray-500">{templateSignals.summary}</p>

                  {templateSignals.signals.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      {ic.templateSignalsEmpty}
                    </p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm text-gray-700">
                        {ic.qualityLabel} — {ic.strongWord} {templateSignals.qualityCounts.strong_alignment} ·{" "}
                        {ic.partialWord} {templateSignals.qualityCounts.partial_alignment} ·{" "}
                        {ic.needsRefinementWord} {templateSignals.qualityCounts.needs_refinement} ·{" "}
                        {ic.underSpecifiedWord} {templateSignals.qualityCounts.under_specified} ·{" "}
                        {ic.unknownWord} {templateSignals.qualityCounts.unknown}
                      </p>
                      {templateSignals.topNeedsRefinement.length > 0 && (
                        <p className="mt-1 text-xs text-gray-500">
                          {ic.topNeedsRefinement}{" "}
                          {templateSignals.topNeedsRefinement.join("; ")}
                        </p>
                      )}
                      <div className="mt-3 space-y-2">
                        {templateSignals.signals.map((s) => (
                          <div
                            key={s.id}
                            className="rounded-md border border-gray-100 bg-gray-50 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {s.title}
                              </span>
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                                {s.type.replace(/_/g, " ")}
                              </span>
                              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500">
                                {s.quality.replace(/_/g, " ")}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-gray-600">{s.summary}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {s.supportingSignals.length > 0 &&
                                `${ic.signalsLabel}: ${s.supportingSignals.join("; ")}`}
                              {s.blockerTypes.length > 0 &&
                                ` · ${ic.blockersLabel}: ${s.blockerTypes
                                  .map((b) => b.replace(/_/g, " "))
                                  .join(", ")}`}
                              {s.relatedAcceptanceAreas.length > 0 &&
                                ` · ${ic.areasLabel}: ${s.relatedAcceptanceAreas
                                  .map((a) => a.replace(/_/g, " "))
                                  .join(", ")}`}
                              {s.relatedEvidenceTypes.length > 0 &&
                                ` · ${ic.evidenceLabel}: ${s.relatedEvidenceTypes
                                  .map((e) => e.replace(/_/g, " "))
                                  .join(", ")}`}
                              {s.relatedStageNumbers.length > 0 &&
                                ` · ${ic.stagesLabel}: ${s.relatedStageNumbers.join(", ")}`}
                            </p>
                            <p className="mt-1.5 text-sm text-gray-700">
                              {s.suggestedTemplateImprovement}
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <StageDetail label={ic.notIncludedYet} items={templateSignals.notIncludedYet} />

                  <p className="mt-4 text-xs text-gray-400">
                    {ic.templateSignalsNote}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stage 119 — beta feedback CTA. Opens a mailto with SAFE context only (no
// pasted content, workflow snapshots, or userKey are ever included).
function FeedbackLink({
  label,
  context,
  className,
}: {
  label: string;
  context?: {
    route?: string;
    intakeType?: string;
    workflowRecordId?: string;
    section?: string;
  };
  className?: string;
}) {
  return (
    <a
      href={buildBetaFeedbackMailto({ route: "/projects/new/intake", ...context })}
      className={className ?? "text-xs font-medium text-brand-600 hover:underline"}
    >
      {label}
    </a>
  );
}

// Non-developer copy pass — collapsed technical internals (confidence scores,
// raw JSON). Localized summary is passed in by the caller.
function TechDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-gray-400">{summary}</summary>
      <p className="mt-1 text-xs text-gray-400">{children}</p>
    </details>
  );
}

function StageDetail({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function FixRebuild({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm text-gray-700">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrdList({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <p className="mt-4 text-sm font-medium text-gray-900">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm text-gray-700"
          >
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}
