"use client";

// Checking-items page — create, EDIT, delete, and annotate items.
//
// Items are the core object a non-developer owns; a read-only list (the state
// before 2026-07-05) meant users couldn't correct a generated item, add their
// own, or leave a note. Edits persist local-first (workflow-store) and sync to
// the server via the sticky upsert (capture-once fields survive).
import { useState } from "react";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  getUserKey,
  saveProject,
  saveExtendedProjectData,
  loadExtendedProjectData,
  markProjectSyncFailed,
} from "@/lib/workflow-store";
import type { Project } from "@/lib/mock-data";
import { callWorkspaceApi } from "@/lib/workspace-api";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import { ACCEPTANCE_CRITERIA } from "@/lib/mock-generators";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";
import { ProjectNotFound } from "@/components/ProjectNotFound";

type EditDraft = { title: string; criteriaText: string; note: string };

export default function ItemsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [quickIdea, setQuickIdea] = useState("");
  const [genPhase, setGenPhase] = useState<"idle" | "loading">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ title: "", criteriaText: "", note: "" });
  const [adding, setAdding] = useState(false);
  const [, forceRefresh] = useState(0);

  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <ProjectNotFound />;

  const ext = loadExtendedProjectData(id);
  const criteriaFor = (reqId: string): string[] =>
    ext?.itemCriteria?.[reqId] ?? ACCEPTANCE_CRITERIA[reqId] ?? [];
  const noteFor = (reqId: string): string => ext?.itemNotes?.[reqId] ?? "";
  const hasItems = project.requirements.length > 0;

  /** Persist requirements locally + best-effort server sync (sticky-safe). */
  function persist(nextProject: Project, patch?: { criteria?: Record<string, string[]>; notes?: Record<string, string> }) {
    saveProject(nextProject);
    const nextCriteria = { ...(ext?.itemCriteria ?? {}), ...(patch?.criteria ?? {}) };
    const nextNotes = { ...(ext?.itemNotes ?? {}), ...(patch?.notes ?? {}) };
    saveExtendedProjectData(id, { itemCriteria: nextCriteria, itemNotes: nextNotes });
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: nextProject.name,
      idea: nextProject.description ?? "",
      understood: {},
      productSpec: ext?.productSpec ?? {},
      items: nextProject.requirements.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        criteria: nextCriteria[r.id] ?? [],
        note: nextNotes[r.id] || undefined,
      })),
    })
      .then((res) => {
        if (!res || res.ok !== true) markProjectSyncFailed(id);
      })
      .catch(() => markProjectSyncFailed(id));
    forceRefresh((v) => v + 1);
  }

  function startEdit(reqId: string) {
    const req = project!.requirements.find((r) => r.id === reqId);
    if (!req) return;
    setEditingId(reqId);
    setAdding(false);
    setDraft({ title: req.title, criteriaText: criteriaFor(reqId).join("\n"), note: noteFor(reqId) });
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft({ title: "", criteriaText: "", note: "" });
  }

  function commitDraft() {
    const title = draft.title.trim();
    if (!title || !project) return;
    const criteria = draft.criteriaText
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    const note = draft.note.trim();
    if (adding) {
      const newId = `item_${Date.now().toString(36)}`;
      persist(
        {
          ...project,
          requirements: [
            ...project.requirements,
            { id: newId, title, status: "not_started" as const, category: "feature", priority: "must" as const },
          ],
        },
        { criteria: { [newId]: criteria }, notes: { [newId]: note } },
      );
    } else if (editingId) {
      persist(
        {
          ...project,
          requirements: project.requirements.map((r) => (r.id === editingId ? { ...r, title } : r)),
        },
        { criteria: { [editingId]: criteria }, notes: { [editingId]: note } },
      );
    }
    setAdding(false);
    setEditingId(null);
  }

  function deleteItem(reqId: string) {
    if (!project) return;
    if (!window.confirm(t.items.deleteConfirm)) return;
    persist({ ...project, requirements: project.requirements.filter((r) => r.id !== reqId) });
    if (editingId === reqId) setEditingId(null);
  }

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
    if (!res.ok) {
      setGenError(t.errors.llmUnavailable);
      setGenPhase("idle");
      return;
    }
    const generated = res.data;
    if (!generated?.items?.length) {
      setGenError(t.github.generateItemsError);
      setGenPhase("idle");
      return;
    }
    const criteria = Object.fromEntries(generated.items.map((i) => [i.id, i.criteria ?? []]));
    saveExtendedProjectData(id, { productSpec: generated.productSpec });
    persist(
      {
        ...project,
        requirements: generated.items.map((item) => ({
          id: item.id,
          title: item.title,
          status: "not_started" as const,
          category: "feature",
          priority: "must" as const,
        })),
      },
      { criteria },
    );
    setGenPhase("idle");
  }

  const editorCard = (
    <div className="card mt-3 space-y-3 border-brand-200 p-5">
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{t.items.titleLabel}</span>
        <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="input mt-1" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{t.items.criteriaLabel}</span>
        <textarea
          value={draft.criteriaText}
          onChange={(e) => setDraft((d) => ({ ...d, criteriaText: e.target.value }))}
          rows={3}
          className="input mt-1"
          placeholder={t.items.criteriaPlaceholder}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{t.items.noteLabel}</span>
        <textarea
          value={draft.note}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          rows={2}
          className="input mt-1"
          placeholder={t.items.notePlaceholder}
        />
      </label>
      <div className="flex items-center gap-3">
        <button onClick={commitDraft} disabled={!draft.title.trim()} className="btn btn-md btn-primary">
          {t.items.saveItem}
        </button>
        <button onClick={() => { setAdding(false); setEditingId(null); }} className="btn btn-md btn-ghost">
          {t.common.cancel}
        </button>
        {!draft.title.trim() && <span className="text-xs text-gray-500">{t.items.titleRequired}</span>}
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t.items.title}</h1>
          <p className="page-subtitle mb-8">{t.items.subtitle}</p>
        </div>
        {hasItems && !adding && (
          <button onClick={startAdd} className="btn btn-md btn-secondary mt-1 flex-shrink-0">
            ＋ {t.items.addItem}
          </button>
        )}
      </div>

      {adding && editorCard}

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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={handleGenerateItems}
              disabled={!quickIdea.trim() || genPhase === "loading"}
              className="btn btn-md btn-primary"
            >
              {genPhase === "loading" ? t.github.generatingItems : t.github.generateItems}
            </button>
            {!adding && (
              <button onClick={startAdd} className="btn btn-md btn-secondary">
                ＋ {t.items.addItem}
              </button>
            )}
            {genError && <span className="text-sm text-red-500">{genError}</span>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {project.requirements.map((req) =>
          editingId === req.id ? (
            <div key={req.id}>{editorCard}</div>
          ) : (
            <div key={req.id} className="card p-5">
              <div className="mb-3 flex items-start gap-3">
                <span className="mt-0.5 w-14 flex-shrink-0 font-mono text-xs text-gray-400">{req.id}</span>
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-sm font-medium text-gray-800">{req.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={req.status} />
                    <span className="text-xs text-gray-500">{t.priority[req.priority]}</span>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button onClick={() => startEdit(req.id)} className="btn btn-sm btn-ghost">
                    {t.items.editItem}
                  </button>
                  <button onClick={() => deleteItem(req.id)} className="btn btn-sm btn-ghost text-red-500 hover:text-red-600">
                    {t.items.deleteItem}
                  </button>
                </div>
              </div>

              {criteriaFor(req.id).length > 0 && (
                <div className="pl-14">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t.items.criteria}
                  </p>
                  <ul className="space-y-1">
                    {criteriaFor(req.id).map((c, i) => (
                      <li key={i} className="flex gap-2 text-xs text-gray-500">
                        <span className="mt-0.5 text-gray-400">-</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {noteFor(req.id) && (
                <p className="ml-14 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {t.items.noteLabel}: {noteFor(req.id)}
                </p>
              )}

              {req.evidence && (
                <p className="ml-14 mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
                  {t.items.evidence}: {req.evidence}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      {/* Next step comes from the flow (StepNextButton) — the old builder-pack
          shortcut jumped from prepare straight to export and confused the map. */}
      <StepNextButton />
    </div>
  );
}
