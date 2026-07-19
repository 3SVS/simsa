"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { MOCK_PROJECTS, getProjectStats, type Project } from "@/lib/mock-data";
import { loadLocalProjects, deleteProject, getUserKey, saveProject, saveExtendedProjectData } from "@/lib/workflow-store";
import { buildSampleProject } from "@/lib/sample-project.mjs";
import { buildLocalProjectFromServer } from "@/lib/project-restore.mjs";
import {
  deleteProjectFromDb,
  listProjectsFromDb,
  loadProjectFromDb,
  loadExtFromDb,
  type RemoteProjectSummary,
} from "@/lib/workspace-check-api";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import { StampMark } from "@/components/brand/StampMark";

export default function ProjectsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [localProjects, setLocalProjects] = useState<Project[]>([]);

  // G10: 입력·대기 없이 전체 루프가 채워진 예시를 로컬 생성 → 바로 개요로.
  const startSample = () => {
    const { project, ext } = buildSampleProject();
    saveProject(project);
    saveExtendedProjectData(project.id, ext);
    router.push(`/projects/${project.id}`);
  };
  // Guard the one-frame empty-state flash: localProjects starts [] and only
  // fills after this effect runs, so a returning user would briefly see the
  // "no projects yet" card before their projects hydrate in.
  const [hydrated, setHydrated] = useState(false);

  // G8 D-2 (DR-3): 서버에는 있는데 이 기기에 없는 프로젝트 — 명시적 가져오기만.
  const [restorable, setRestorable] = useState<RemoteProjectSummary[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    const locals = loadLocalProjects();
    setLocalProjects(locals);
    setHydrated(true);
    const localIds = new Set(locals.map((p) => p.id));
    let cancelled = false;
    listProjectsFromDb(getUserKey()).then((remote) => {
      if (cancelled) return;
      setRestorable(remote.filter((r) => !localIds.has(r.id) && !r.id.startsWith("sample_") && !r.id.startsWith("probe_")));
    });
    return () => { cancelled = true; };
  }, []);

  const restoreOne = async (summary: RemoteProjectSummary) => {
    if (restoring) return;
    setRestoring(summary.id);
    try {
      const userKey = getUserKey();
      const full = await loadProjectFromDb(summary.id, userKey);
      if (!full.ok) return;
      const extRes = await loadExtFromDb(summary.id, userKey);
      const { project, ext } = buildLocalProjectFromServer(
        full.project,
        extRes.ok ? (extRes.ext as Parameters<typeof buildLocalProjectFromServer>[1]) : null,
      );
      saveProject(project);
      saveExtendedProjectData(project.id, ext);
      setLocalProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      setRestorable((prev) => prev.filter((r) => r.id !== summary.id));
    } finally {
      setRestoring(null);
    }
  };

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
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link href="/projects/new" className="btn btn-primary btn-md">
              + {t.projects.newProject}
            </Link>
            <button type="button" onClick={startSample} className="btn btn-secondary btn-md">
              {t.projects.trySample}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">{t.projects.trySampleHint}</p>
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

      {/* G8 D-2: 복원 카드 — 조용한 자동 병합 금지, 명시 클릭으로만 가져온다 */}
      {restorable.length > 0 && (
        <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50 p-5">
          <p className="text-sm font-semibold text-brand-900">{t.projects.restoreTitle.replace("{n}", String(restorable.length))}</p>
          <p className="mt-0.5 text-xs text-brand-700">{t.projects.restoreDesc}</p>
          <ul className="mt-3 space-y-2">
            {restorable.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{r.title || r.id}</p>
                  <p className="truncate text-xs text-gray-400">{r.updatedAt?.slice(0, 10)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => restoreOne(r)}
                  disabled={restoring !== null}
                  className="btn btn-sm btn-primary flex-shrink-0 disabled:opacity-50"
                >
                  {restoring === r.id ? t.projects.restoring : t.projects.restoreCta}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {MOCK_PROJECTS.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">{t.projects.examplesTitle}</h2>
              <p className="mt-0.5 text-xs text-gray-500">{t.projects.examplesNote}</p>
            </div>
            {/* G10: 읽기전용 예시와 달리, 직접 만져볼 수 있는 내 복사본을 만든다 */}
            <button type="button" onClick={startSample} className="btn btn-secondary btn-sm flex-shrink-0">
              {t.projects.trySample}
            </button>
          </div>
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
