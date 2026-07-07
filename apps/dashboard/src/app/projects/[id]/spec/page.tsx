"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProject } from "@/lib/mock-data";
import type { Project } from "@/lib/mock-data";
import {
  getLocalProject,
  getUserKey,
  saveProject,
  loadExtendedProjectData,
  saveExtendedProjectData,
  markProjectSyncFailed,
} from "@/lib/workflow-store";
import type { WorkspaceProductSpec } from "@/lib/workspace-types";
import { saveProjectToDb } from "@/lib/workspace-check-api";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { OpenQuestionCard } from "@/components/OpenQuestionCard";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import { StepNextButton } from "@/components/StepNextButton";

export default function SpecPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const project = getLocalProject(id) ?? getProject(id);
  const [, forceRefresh] = useState(0);

  // C2: answers the user settled for open decisions (kept in extended data, not
  // the core spec, so example projects aren't mutated). Hydrated client-side.
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    setResolved(loadExtendedProjectData(id)?.resolvedOpenDecisions ?? {});
  }, [id]);

  // Edit mode for the core spec (goal / included / excluded). Persists to BOTH
  // representations: project.spec (what these pages render) and the extended
  // productSpec (what checks/export read), so an edit actually reaches the
  // acceptance pipeline. openDecisions stays owned by the C2 cards below.
  const [editing, setEditing] = useState(false);
  const [dGoal, setDGoal] = useState("");
  const [dIncluded, setDIncluded] = useState<string[]>([]);
  const [dExcluded, setDExcluded] = useState<string[]>([]);

  function resolveOpenDecision(question: string, answer: string) {
    setResolved((prev) => {
      const next = { ...prev };
      if (answer) next[question] = answer;
      else delete next[question];
      saveExtendedProjectData(id, { resolvedOpenDecisions: next });
      return next;
    });
  }

  if (!project) return <ProjectNotFound />;

  const { spec } = project;

  function startEdit() {
    setDGoal(spec.goal);
    setDIncluded([...spec.included]);
    setDExcluded([...spec.excluded]);
    setEditing(true);
  }

  function saveSpec() {
    const included = dIncluded.map((s) => s.trim()).filter(Boolean);
    const excluded = dExcluded.map((s) => s.trim()).filter(Boolean);
    const goal = dGoal.trim();
    // 1) local project.spec — the source these pages render.
    const nextProject: Project = {
      ...project!,
      spec: { ...spec, goal, included, excluded },
    };
    saveProject(nextProject);
    // 2) extended productSpec — the source checks/export read. goal → oneLine
    //    (the one-line product description); included/excluded map 1:1.
    const ext = loadExtendedProjectData(id);
    const base = ext?.productSpec;
    const nextProductSpec: WorkspaceProductSpec = base
      ? { ...base, oneLine: goal, included, excluded }
      : {
          productName: project!.name,
          oneLine: goal,
          targetUsers: [],
          problem: "",
          included,
          excluded,
          userFlow: [],
          decisions: [],
          openQuestions: spec.openDecisions ?? [],
        };
    saveExtendedProjectData(id, { productSpec: nextProductSpec });
    // 3) best-effort server sync (sticky upsert preserves items/criteria).
    saveProjectToDb({
      id,
      userKey: getUserKey(),
      title: nextProject.name,
      idea: nextProject.description ?? "",
      understood: {},
      productSpec: nextProductSpec,
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
      <div className="mb-1 flex items-center justify-between">
        <h1 className="page-title">{t.spec.title}</h1>
        <span className="text-sm text-gray-500">{t.spec.completeness}</span>
      </div>
      <p className="page-subtitle mb-6">{t.spec.reviewNote}</p>
      <div className="mb-8">
        <SpecCompleteness value={spec.completeness} />
      </div>

      {!spec.goal && spec.included.length === 0 ? (
        <div className="empty-state">
          <p className="text-sm text-gray-600">{t.spec.emptyBody}</p>
          <a href={`/projects/${id}`} className="btn btn-md btn-secondary mt-4">
            {t.common.goOverview}
          </a>
        </div>
      ) : editing ? (
      <div className="space-y-5">
        <Section title={t.spec.goal}>
          <textarea
            autoFocus
            value={dGoal}
            onChange={(e) => setDGoal(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </Section>
        <Section title={t.spec.included}>
          <ListEditor items={dIncluded} onChange={setDIncluded} addLabel={t.common.addLine} removeLabel={t.common.removeLine} />
        </Section>
        <Section title={t.spec.excluded}>
          <ListEditor items={dExcluded} onChange={setDExcluded} addLabel={t.common.addLine} removeLabel={t.common.removeLine} />
        </Section>
        <div className="flex items-center gap-2">
          <button onClick={saveSpec} className="btn btn-md btn-primary">{t.common.save}</button>
          <button onClick={() => setEditing(false)} className="btn btn-md btn-ghost">{t.common.cancel}</button>
        </div>
      </div>
      ) : (
      <div className="space-y-5">
        <div className="flex justify-end">
          <button onClick={startEdit} className="text-xs font-medium text-brand-600 hover:text-brand-700">
            {t.common.edit}
          </button>
        </div>
        <Section title={t.spec.goal}>
          <p className="text-sm leading-relaxed text-gray-700">{spec.goal}</p>
        </Section>

        <Section title={t.spec.included}>
          <ul className="space-y-1.5">
            {spec.included.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="mt-0.5 text-green-500">•</span> {item}
              </li>
            ))}
          </ul>
        </Section>

        {spec.excluded.length > 0 && (
          <Section title={t.spec.excluded}>
            <ul className="space-y-1.5">
              {spec.excluded.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-500">
                  <span className="mt-0.5">×</span> {item}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {spec.openDecisions.length > 0 && (
          <Section title={t.spec.openDecisions}>
            <p className="mb-3 text-xs text-gray-500">{t.np.openQIntro}</p>
            <div className="space-y-2">
              {spec.openDecisions.map((d, i) => (
                <OpenQuestionCard
                  key={i}
                  question={d}
                  productName={project.name}
                  oneLine={spec.goal}
                  projectId={id}
                  userKey={getUserKey()}
                  resolvedAnswer={resolved[d]}
                  onResolved={resolveOpenDecision}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
      )}
      <StepNextButton />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </div>
  );
}

/** Inline editor for a list of short strings (included / excluded lines). */
function ListEditor({
  items,
  onChange,
  addLabel,
  removeLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  removeLabel: string;
}) {
  function setAt(i: number, value: string) {
    onChange(items.map((it, idx) => (idx === i ? value : it)));
  }
  function removeAt(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={item}
            onChange={(e) => setAt(i, e.target.value)}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
          <button
            onClick={() => removeAt(i)}
            aria-label={removeLabel}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ""])}
        className="text-xs font-medium text-brand-600 hover:text-brand-700"
      >
        ＋ {addLabel}
      </button>
    </div>
  );
}
