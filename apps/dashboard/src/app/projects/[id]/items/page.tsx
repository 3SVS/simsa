"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  getUserKey,
  saveProject,
  saveExtendedProjectData,
  markProjectSyncFailed,
} from "@/lib/workflow-store";
import { callWorkspaceApi } from "@/lib/workspace-api";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import { ACCEPTANCE_CRITERIA } from "@/lib/mock-generators";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";

export default function ItemsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  // Code-branch rescue (same pattern as the github-page PR panel): a project
  // created without the optional one-liner has zero items, and this page used
  // to be read-only — the overview's "확인 항목 만들기" CTA landed on a page
  // that couldn't create items. The inline generator below closes that.
  const [quickIdea, setQuickIdea] = useState("");
  const [genPhase, setGenPhase] = useState<"idle" | "loading">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [, forceRefresh] = useState(0);

  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <ProjectNotFound />;

  const hasItems = project.requirements.length > 0;

  async function handleGenerateItems() {
    if (!project || !quickIdea.trim() || genPhase === "loading") return;
    setGenPhase("loading");
    setGenError(null);
    const res = await callWorkspaceApi({ idea: quickIdea.trim() });
    if (!res.ok && res.error === "rate_limited") {
      setGenError(t.common.rateLimited);
      setGenPhase("idle");
      return;
    }
    const generated = res.ok ? res.data : res.fallback;
    if (!generated?.items?.length) {
      setGenError(t.github.generateItemsError);
      setGenPhase("idle");
      return;
    }
    saveProject({
      ...project,
      requirements: generated.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    });
    saveExtendedProjectData(id, {
      productSpec: generated.productSpec,
      itemCriteria: Object.fromEntries(generated.items.map((i) => [i.id, i.criteria ?? []])),
    });
    // builtWith / entryPath omitted on purpose — the server upsert keeps the
    // stored capture-once values (sticky).
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: project.name,
      idea: quickIdea.trim(),
      understood: generated.understood ?? {},
      productSpec: generated.productSpec,
      items: generated.items,
    }).then((res) => { if (!res || res.ok !== true) markProjectSyncFailed(id); }).catch(() => markProjectSyncFailed(id));
    setGenPhase("idle");
    forceRefresh((v) => v + 1);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="page-title">{t.items.title}</h1>
      <p className="page-subtitle mb-8">{t.items.subtitle}</p>

      {!hasItems && (
        <div className="card p-6">
          <p className="text-sm font-medium text-gray-700">{t.github.noItemsYet}</p>
          <p className="mt-1 text-xs text-gray-500">{t.github.noItemsHint}</p>
          <textarea
            value={quickIdea}
            onChange={(e) => setQuickIdea(e.target.value)}
            rows={2}
            placeholder={t.github.noItemsIdeaPlaceholder}
            className="input mt-3"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleGenerateItems}
              disabled={!quickIdea.trim() || genPhase === "loading"}
              className="btn btn-md btn-primary"
            >
              {genPhase === "loading" ? t.github.generatingItems : t.github.generateItems}
            </button>
            {genError && <span className="text-sm text-red-500">{genError}</span>}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {project.requirements.map((req) => (
          <div key={req.id} className="card p-5">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 w-14 flex-shrink-0 font-mono text-xs text-gray-300">
                {req.id}
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-sm font-medium text-gray-800">{req.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={req.status} />
                  <span className="text-xs text-gray-500">{t.priority[req.priority]}</span>
                </div>
              </div>
            </div>

            {ACCEPTANCE_CRITERIA[req.id] && (
              <div className="ml-17 pl-14">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t.items.criteria}
                </p>
                <ul className="space-y-1">
                  {ACCEPTANCE_CRITERIA[req.id].map((c, i) => (
                    <li key={i} className="flex gap-2 text-xs text-gray-500">
                      <span className="mt-0.5 text-gray-300">-</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {req.evidence && (
              <p className="ml-14 mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                {t.items.evidence}: {req.evidence}
              </p>
            )}
          </div>
        ))}
      </div>

      {hasItems && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-5 py-4">
          <p className="text-sm text-brand-800">{t.items.ctaQuestion}</p>
          <a href={`/projects/${id}/export`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            {t.items.ctaButton} →
          </a>
        </div>
      )}
      <StepNextButton />
    </div>
  );
}
