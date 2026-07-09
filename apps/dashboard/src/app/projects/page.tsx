"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { MOCK_PROJECTS, getProjectStats, type Project } from "@/lib/mock-data";
import { loadLocalProjects, deleteProject, getUserKey } from "@/lib/workflow-store";
import { deleteProjectFromDb } from "@/lib/workspace-check-api";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import { StampMark } from "@/components/brand/StampMark";

export default function ProjectsPage() {
  const { t } = useI18n();
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  // Guard the one-frame empty-state flash: localProjects starts [] and only
  // fills after this effect runs, so a returning user would briefly see the
  // "no projects yet" card before their projects hydrate in.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLocalProjects(loadLocalProjects());
    setHydrated(true);
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.projects.homeTitle}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.projects.homeSubtitle}</p>
      </div>

      {!hydrated ? (
        <div className="grid gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
          ))}
        </div>
      ) : localProjects.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <StampMark size={40} className="mb-4 opacity-90" />
          <h2 className="text-base font-semibold text-gray-900">{t.projects.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{t.projects.emptyBody}</p>
          <Link href="/projects/new" className="btn btn-primary btn-md mt-5">
            + {t.projects.newProject}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {localProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              t={t}
              onDeleted={(id) => setLocalProjects((prev) => prev.filter((p) => p.id !== id))}
            />
          ))}
        </div>
      )}

      {MOCK_PROJECTS.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-gray-700">{t.projects.examplesTitle}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t.projects.examplesNote}</p>
          <div className="mt-3 grid gap-4">
            {MOCK_PROJECTS.map((project) => (
              <ProjectCard key={project.id} project={project} t={t} exampleBadge={t.projects.exampleBadge} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function ProjectCard({
  project,
  t,
  exampleBadge,
  onDeleted,
}: {
  project: Project;
  t: Dictionary;
  exampleBadge?: string;
  /** Present only for the user's own (deletable) projects — example projects are read-only. */
  onDeleted?: (id: string) => void;
}) {
  const stats = getProjectStats(project);
  const toast = useToast();
  const titleId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  function openConfirm() {
    setAcknowledged(false);
    setConfirmOpen(true);
  }
  function closeConfirm() {
    setConfirmOpen(false);
    setAcknowledged(false);
  }

  function confirmDelete() {
    if (!acknowledged) return;
    const { id, name } = project;
    // localStorage is authoritative for the list — remove it there first so the
    // card disappears immediately (optimistic), then mirror to D1/R2. A mirror
    // failure is surfaced (not swallowed): the local delete already succeeded, so
    // this only tells the user server-side cleanup didn't finish.
    deleteProject(id);
    onDeleted?.(id);
    deleteProjectFromDb(id, getUserKey())
      .then((res) => {
        if (!res.ok) toast.error(t.projects.deleteMirrorFailed.replace("{name}", name));
      })
      .catch(() => toast.error(t.projects.deleteMirrorFailed.replace("{name}", name)));
  }

  return (
    <div className="relative">
      <Link
        href={`/projects/${project.id}`}
        className="card card-select block p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              {project.name}
              {exampleBadge && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                  {exampleBadge}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">{project.description}</p>
          </div>
          <span className={`whitespace-nowrap text-xs text-gray-500 ${onDeleted ? "pr-7" : ""}`}>
            {project.createdAt}
          </span>
        </div>

        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>{t.nav.spec}</span>
          </div>
          <SpecCompleteness value={project.spec.completeness} />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="font-medium text-green-600">{statusLabel(t, "passed")} {stats.passed}</span>
          <span className="font-medium text-red-600">{statusLabel(t, "failed")} {stats.failed}</span>
          <span className="font-medium text-amber-600">{statusLabel(t, "inconclusive")} {stats.inconclusive}</span>
          <span className="font-medium text-slate-600">{statusLabel(t, "needs_decision")} {stats.needsDecision}</span>
          <span className="text-gray-500">{statusLabel(t, "not_started")} {stats.notStarted}</span>
        </div>
      </Link>

      {onDeleted && (
        <button
          type="button"
          onClick={openConfirm}
          aria-label={t.projects.deleteAria.replace("{name}", project.name)}
          title={t.projects.deleteLabel}
          className="absolute right-3 top-3 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-500"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      )}

      {onDeleted && confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={closeConfirm}
          onKeyDown={(e) => { if (e.key === "Escape") closeConfirm(); }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={titleId} className="text-base font-semibold text-gray-900">
              {t.projects.deleteModalTitle}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {t.projects.deleteModalBody.replace("{name}", project.name)}
            </p>
            <p className="mt-2 text-sm font-semibold text-red-600">
              {t.projects.deleteModalIrreversible}
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-red-600"
                autoFocus
              />
              <span>{t.projects.deleteAck}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeConfirm} className="btn btn-secondary btn-md">
                {t.projects.deleteCancel}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={!acknowledged}
                className="btn btn-md bg-red-600 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.projects.deleteConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
