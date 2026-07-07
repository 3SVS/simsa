"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useState } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import type { Project } from "@/lib/mock-data";
import {
  getLocalProject,
  getUserKey,
  saveProject,
  loadExtendedProjectData,
  markProjectSyncFailed,
} from "@/lib/workflow-store";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import { StepNextButton } from "@/components/StepNextButton";

export default function IdeaPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const [, forceRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Read on the client so locally-created (localStorage) projects resolve,
  // not just the bundled mock demos.
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <ProjectNotFound />;

  // Code-branch projects legitimately start without a worked-up idea/spec —
  // show a guiding empty state instead of blank cards.
  const isEmpty = !project.spec.goal && project.spec.included.length === 0 && !project.description;

  function startEdit() {
    setDraft(project!.description ?? "");
    setEditing(true);
  }

  // Persist an edited idea text: local-first (what every page reads) + a
  // best-effort server sync that preserves items/criteria (sticky upsert), the
  // same payload shape items/page.tsx uses so nothing is wiped.
  function saveIdea() {
    const nextProject: Project = { ...project!, description: draft };
    saveProject(nextProject);
    const ext = loadExtendedProjectData(id);
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: nextProject.name,
      idea: draft,
      understood: {},
      productSpec: ext?.productSpec ?? {},
      items: nextProject.requirements.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        criteria: ext?.itemCriteria?.[r.id] ?? [],
        note: ext?.itemNotes?.[r.id] || undefined,
      })),
    })
      .then((res) => {
        if (!res || res.ok !== true) markProjectSyncFailed(id);
      })
      .catch(() => markProjectSyncFailed(id));
    setEditing(false);
    forceRefresh((v) => v + 1);
    toast.success(t.common.saved);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="page-title">{t.nav.idea}</h1>
      <p className="page-subtitle mb-8">{t.idea.subtitle}</p>

      {isEmpty && (
        <div className="empty-state mb-6">
          <p className="text-sm text-gray-600">{t.idea.emptyBody}</p>
          <a href={`/projects/${id}`} className="btn btn-md btn-secondary mt-4">
            {t.common.goOverview}
          </a>
        </div>
      )}

      {!isEmpty && (
      <>
      <div className="card mb-6 p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t.idea.yourInput}
          </h2>
          {!editing && (
            <button onClick={startEdit} className="text-xs font-medium text-brand-600 hover:text-brand-700">
              {t.common.edit}
            </button>
          )}
        </div>
        {editing ? (
          <div>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300"
            />
            <div className="mt-3 flex items-center gap-2">
              <button onClick={saveIdea} className="btn btn-sm btn-primary">{t.common.save}</button>
              <button onClick={() => setEditing(false)} className="btn btn-sm btn-ghost">{t.common.cancel}</button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{project.description}</p>
        )}
      </div>

      <div className="card mb-6 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t.idea.understood}
        </h2>
        <p className="text-sm font-medium text-gray-800 mb-3">{project.spec.goal}</p>
        <ul className="space-y-2">
          {project.spec.included.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-700">
          {t.idea.excluded}
        </h2>
        <ul className="space-y-2">
          {project.spec.excluded.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-amber-800">
              <span className="mt-0.5">×</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      </>
      )}
      <StepNextButton />
    </div>
  );
}
