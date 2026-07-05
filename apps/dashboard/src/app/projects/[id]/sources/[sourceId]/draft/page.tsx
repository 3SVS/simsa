"use client";

// Stage 267 — document intake → spec draft review + confirm.
//
// Entry: the "Draft spec from this document" CTA on /projects/[id]/sources.
// On mount this POSTs the Stage 265 spec-draft endpoint for the uploaded
// document, shows the generated DRAFT (understood + open questions +
// productSpec + acceptance items — the exact idea-to-spec-draft shape, reusing
// the same renderers as /projects/new), and on confirm persists the spec and
// items onto THIS project via the existing save path (localStorage +
// POST /workspace/projects upsert), then continues on /projects/[id]/spec.
// Confirming over an existing non-empty spec requires an explicit checkbox.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { SimsaStampThinking } from "@/components/SimsaStampThinking";
import { getDefaultStampThinkingSteps } from "@/lib/stamp-thinking.mjs";
import { UnderstoodCard, SpecDraftBody } from "@/components/SpecDraftView";
import {
  generateDocumentSpecDraft,
  type DocumentSpecDraft,
} from "@/lib/workspace-sources-api";
import {
  canConfirmDraft,
  draftOverwriteRisk,
  mapDraftError,
  formatRateLimitedMessage,
} from "@/lib/document-draft.mjs";
import type { DraftErrorKey } from "@/lib/document-draft.mjs";
import {
  getLocalProject,
  getUserKey,
  loadExtendedProjectData,
  saveProject,
  saveExtendedProjectData,
  markProjectSyncFailed,
} from "@/lib/workflow-store";
import { saveProjectToDb } from "@/lib/workspace-check-api";

type Phase = "loading" | "ready" | "error";

export default function DocumentDraftPage() {
  const { id, sourceId } = useParams<{ id: string; sourceId: string }>();
  const router = useRouter();
  const { t, locale } = useI18n();
  const loadingSteps = getDefaultStampThinkingSteps(t.loading);

  const [phase, setPhase] = useState<Phase>("loading");
  const [draft, setDraft] = useState<DocumentSpecDraft | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<DraftErrorKey>("generic");
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | undefined>(undefined);

  // Overwrite guard — computed after mount (localStorage is client-only).
  const [overwriteRisk, setOverwriteRisk] = useState(false);
  const [overwriteAck, setOverwriteAck] = useState(false);
  const [saving, setSaving] = useState(false);

  const requestedRef = useRef(false);

  const generate = useCallback(async () => {
    setPhase("loading");
    const res = await generateDocumentSpecDraft(id, sourceId, getUserKey(), locale);
    if (res.ok) {
      setDraft(res.draft);
      setSourceLabel(res.source.label ?? res.source.id);
      setPhase("ready");
    } else {
      // Prefer the server's error code; fall back to the bare HTTP status when
      // the body carried no known code (e.g. unparseable response).
      const byCode = mapDraftError(res.error);
      setErrorKey(byCode !== "generic" ? byCode : mapDraftError(res.status));
      setRetryAfterSeconds(res.retryAfterSeconds);
      setPhase("error");
    }
  }, [id, sourceId, locale]);

  useEffect(() => {
    if (requestedRef.current) return; // guard StrictMode double-mount — one POST per visit
    requestedRef.current = true;
    void generate();
  }, [generate]);

  useEffect(() => {
    const project = getLocalProject(id);
    const ext = loadExtendedProjectData(id);
    setOverwriteRisk(draftOverwriteRisk({ ...(project ?? {}), productSpec: ext?.productSpec }));
  }, [id]);

  async function handleConfirm() {
    if (!draft || !canConfirmDraft(draft) || saving) return;
    if (overwriteRisk && !overwriteAck) return;
    setSaving(true);
    const existing = getLocalProject(id);
    const name = existing?.name?.trim() ? existing.name : draft.productSpec.productName;
    const description = existing?.description?.trim()
      ? existing.description
      : draft.productSpec.oneLine;
    // Same persistence path as the /projects/new intake confirm: local project
    // + extended data, then best-effort server upsert (POST /workspace/projects).
    saveProject({
      id,
      name,
      description,
      createdAt: existing?.createdAt ?? new Date().toISOString().slice(0, 10),
      spec: {
        completeness: 60,
        goal: draft.productSpec.problem,
        included: draft.productSpec.included,
        excluded: draft.productSpec.excluded,
        openDecisions: draft.productSpec.openQuestions,
      },
      requirements: draft.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    });
    saveExtendedProjectData(id, {
      productSpec: draft.productSpec,
      itemCriteria: Object.fromEntries(draft.items.map((i) => [i.id, i.criteria ?? []])),
    });
    await saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: name,
      idea: draft.understood.summary,
      understood: draft.understood,
      productSpec: draft.productSpec,
      items: draft.items,
    }).then((res) => { if (!res || res.ok !== true) markProjectSyncFailed(id); })
      .catch(() => markProjectSyncFailed(id));
    router.push(`/projects/${id}/spec`);
  }

  const errorMessage =
    errorKey === "rate_limited"
      ? formatRateLimitedMessage(t.sources.draft.errors.rate_limited, retryAfterSeconds)
      : t.sources.draft.errors[errorKey] ?? t.sources.draft.errors.generic;

  const confirmDisabled =
    !draft || !canConfirmDraft(draft) || saving || (overwriteRisk && !overwriteAck);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="page-title">{t.sources.draft.title}</h2>
        <p className="page-subtitle">{t.sources.draft.subtitle}</p>
        {sourceLabel && (
          <p className="mt-2 text-xs text-gray-500">
            {t.sources.draft.sourceLabel}: <span className="text-gray-600">{sourceLabel}</span>
          </p>
        )}
      </div>

      {phase === "loading" && (
        <SimsaStampThinking
          variant="panel"
          stepLabels={loadingSteps}
          label={t.sources.draft.generating}
        />
      )}

      {phase === "error" && (
        <div className="space-y-3">
          <div className="callout callout-error">{errorMessage}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void generate()} className="btn btn-primary btn-md">
              {t.sources.draft.retry}
            </button>
            <Link href={`/projects/${id}/sources`} className="btn btn-secondary btn-md">
              {t.sources.draft.backToSources}
            </Link>
          </div>
        </div>
      )}

      {phase === "ready" && draft && (
        <div>
          {draft.source === "mock-fallback" && (
            <div className="callout mb-5 border-amber-200 bg-amber-50 text-xs text-amber-700">
              {t.sources.draft.mockFallbackNotice}
            </div>
          )}

          {(draft.warnings?.length ?? 0) > 0 && (
            <div className="callout mb-5 border-gray-200 bg-gray-50">
              <p className="mb-1 text-xs font-semibold text-gray-600">{t.sources.draft.warningsTitle}</p>
              <ul className="space-y-0.5">
                {draft.warnings?.map((w, i) => (
                  <li key={i} className="text-xs text-gray-600">{w}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-3 text-sm font-semibold text-gray-700">{t.sources.draft.understoodTitle}</p>
          <UnderstoodCard t={t} understood={draft.understood} />

          {draft.questions.length > 0 && (
            <div className="mb-6">
              <p className="mb-1 text-sm font-semibold text-gray-700">{t.sources.draft.questionsTitle}</p>
              <p className="mb-3 text-xs text-gray-500">{t.sources.draft.questionsNote}</p>
              <div className="space-y-2">
                {draft.questions.map((q) => (
                  <div key={q.id} className="card p-4">
                    <p className="text-sm font-medium leading-snug text-gray-900">{q.question}</p>
                    <div className="mt-2 rounded-lg bg-brand-50 px-3 py-2">
                      <p className="text-xs font-semibold text-brand-700">
                        {t.sources.draft.recommendedLabel}: {q.recommendation}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-brand-600">{q.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SpecDraftBody t={t} data={draft} />

          <div className="card p-5">
            {overwriteRisk && (
              <div className="callout mb-4 border-amber-200 bg-amber-50 text-xs text-amber-800">
                <p>{t.sources.draft.overwriteWarning}</p>
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={overwriteAck}
                    onChange={(e) => setOverwriteAck(e.target.checked)}
                  />
                  {t.sources.draft.overwriteConfirmLabel}
                </label>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmDisabled}
              className="btn btn-primary w-full py-3"
            >
              {saving ? t.sources.draft.confirming : t.sources.draft.confirm}
            </button>
            <p className="mt-2 text-center text-xs text-gray-500">{t.sources.draft.confirmHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
