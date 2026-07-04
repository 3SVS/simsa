"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  loadExtendedProjectData,
  saveExtendedProjectData,
  getUserKey,
} from "@/lib/workflow-store";
import {
  callFixSuggestionApi,
  type CheckResultItem,
  type FixSuggestionResponse,
} from "@/lib/workspace-check-api";
import { StatusBadge } from "@/components/StatusBadge";
import type { ItemStatus } from "@/lib/labels";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";

type FixState = {
  phase: "idle" | "loading" | "done" | "error";
  result?: FixSuggestionResponse;
  expanded: boolean;
};

export default function FixesPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);

  const [checkItems, setCheckItems] = useState<CheckResultItem[] | null>(null);
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({});

  useEffect(() => {
    const ext = loadExtendedProjectData(id);
    if (ext?.checkResults) setCheckItems(ext.checkResults.results);
    if (ext?.fixSuggestions) {
      const initial: Record<string, FixState> = {};
      for (const [itemId, res] of Object.entries(ext.fixSuggestions)) {
        initial[itemId] = { phase: "done", result: res, expanded: false };
      }
      setFixStates(initial);
    }
  }, [id]);

  async function requestFix(item: CheckResultItem) {
    if (!project) return;
    setFixStates((prev) => ({ ...prev, [item.itemId]: { phase: "loading", expanded: false } }));

    const ext = loadExtendedProjectData(id);
    const productSpec = ext?.productSpec ?? {
      productName: project.name,
      oneLine: project.description,
      targetUsers: [] as string[],
      problem: project.spec.goal,
      included: project.spec.included,
      excluded: project.spec.excluded,
      userFlow: [] as string[],
      decisions: [] as string[],
      openQuestions: project.spec.openDecisions,
    };

    const res = await callFixSuggestionApi({
      projectId: id,
      userKey: getUserKey(),
      item: {
        id: item.itemId,
        title: item.title,
        status: item.status,
        criteria: ext?.itemCriteria?.[item.itemId] ?? [],
      },
      checkResult: { reason: item.reason, evidence: item.evidence, nextAction: item.nextAction },
      productSpec,
    });

    if (!res.ok) {
      setFixStates((prev) => ({ ...prev, [item.itemId]: { phase: "error", expanded: false } }));
      return;
    }

    setFixStates((prev) => ({ ...prev, [item.itemId]: { phase: "done", result: res, expanded: true } }));

    const currentExt = loadExtendedProjectData(id) ?? {};
    saveExtendedProjectData(id, {
      fixSuggestions: { ...(currentExt.fixSuggestions ?? {}), [item.itemId]: res },
    });
  }

  function toggleExpanded(itemId: string) {
    setFixStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, expanded: !prev[itemId]?.expanded },
    }));
  }

  if (!project) return <ProjectNotFound />;

  if (!checkItems) {
    return (
      <div className="max-w-3xl">
        <h1 className="page-title mb-8">{t.fixesScreen.title}</h1>
        <div className="card p-8 text-center">
          <p className="mb-4 text-sm text-gray-500">{t.fixesScreen.reviewFirst}</p>
          <Link href={`/projects/${id}/checks`} className="btn btn-md btn-primary">
            {t.fixesScreen.goToChecks}
          </Link>
        </div>
      </div>
    );
  }

  const needsFix = checkItems.filter(
    (r) => r.status === "failed" || r.status === "inconclusive" || r.status === "needs_decision",
  );

  return (
    <div className="max-w-3xl">
      <h1 className="page-title">{t.fixesScreen.title}</h1>
      <p className="page-subtitle mb-8">{needsFix.length} {t.fixesScreen.needsAction}</p>

      {needsFix.length === 0 ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
          <p className="font-medium text-green-700">{t.fixesScreen.allPassed}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {needsFix.map((item) => (
            <FixItemCard
              key={item.itemId}
              t={t}
              item={item}
              fixState={fixStates[item.itemId]}
              onFix={() => requestFix(item)}
              onToggle={() => toggleExpanded(item.itemId)}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-5 py-4">
        <p className="text-sm text-brand-800">{t.fixesScreen.exportQuestion}</p>
        <Link href={`/projects/${id}/export`} className="flex-shrink-0 text-sm font-medium text-brand-700 hover:text-brand-800">
          {t.items.ctaButton} →
        </Link>
      </div>
    </div>
  );
}

function FixItemCard({
  t,
  item,
  fixState,
  onFix,
  onToggle,
}: {
  t: Dictionary;
  item: CheckResultItem;
  fixState?: FixState;
  onFix: () => void;
  onToggle: () => void;
}) {
  const isLoading = fixState?.phase === "loading";
  const isDone = fixState?.phase === "done";
  const isExpanded = fixState?.expanded ?? false;

  return (
    <div className="card overflow-hidden">
      <div className="p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-gray-800">{item.title}</p>
          <StatusBadge status={item.status as ItemStatus} />
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">{item.reason}</p>

        <div className="flex flex-wrap items-center gap-2">
          {!isDone && (
            <button onClick={onFix} disabled={isLoading} className="btn btn-sm btn-primary">
              {isLoading
                ? t.fixesScreen.analyzing
                : item.status === "needs_decision"
                ? t.fixesScreen.getDecisionHelp
                : t.fixesScreen.createInstructions}
            </button>
          )}
          {isDone && (
            <button
              onClick={onToggle}
              className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
            >
              {isExpanded ? t.fixesScreen.collapse : t.fixesScreen.expand}
            </button>
          )}
          {isDone && (
            <button onClick={onFix} className="btn btn-sm btn-secondary">
              {t.fixesScreen.reanalyze}
            </button>
          )}
          {fixState?.phase === "error" && (
            <span className="flex items-center gap-2">
              <span className="text-xs text-red-600">{t.fixesScreen.generateError}</span>
              <button
                onClick={onFix}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                {t.common.retry}
              </button>
            </span>
          )}
        </div>
      </div>

      {isDone && isExpanded && fixState?.result && <FixSuggestionPanel t={t} suggestion={fixState.result} />}
    </div>
  );
}

function FixSuggestionPanel({ t, suggestion }: { t: Dictionary; suggestion: FixSuggestionResponse }) {
  const { plainSummary, builderBrief } = suggestion.suggestion;

  return (
    <div className="space-y-4 border-t border-gray-100 bg-gray-50 p-5">
      {suggestion.source === "mock-fallback" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
          {t.fixesScreen.draftNote}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.fixesScreen.summary}</p>
        <p className="text-sm leading-relaxed text-gray-700">{plainSummary}</p>
      </div>

      <div className="card space-y-4 p-4">
        <div>
          <p className="text-sm font-semibold text-gray-800">{builderBrief.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{builderBrief.goal}</p>
        </div>

        {builderBrief.tasks.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.fixesScreen.tasks}</p>
            <ul className="space-y-1">
              {builderBrief.tasks.map((task, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-700">
                  <span className="mt-px flex-shrink-0 text-brand-400">•</span> {task}
                </li>
              ))}
            </ul>
          </div>
        )}

        {builderBrief.doneWhen.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.fixesScreen.doneWhen}</p>
            <ul className="space-y-1">
              {builderBrief.doneWhen.map((d, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-700">
                  <span className="mt-px flex-shrink-0 text-green-500">✓</span> {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {builderBrief.doNotDo.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.fixesScreen.doNotDo}</p>
            <ul className="space-y-1">
              {builderBrief.doNotDo.map((d, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-500">
                  <span className="mt-px flex-shrink-0 text-red-400">✗</span> {d}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
