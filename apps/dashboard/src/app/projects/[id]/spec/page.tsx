"use client";

import { ProjectNotFound } from "@/components/ProjectNotFound";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProject } from "@/lib/mock-data";
import {
  getLocalProject,
  getUserKey,
  loadExtendedProjectData,
  saveExtendedProjectData,
} from "@/lib/workflow-store";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { OpenQuestionCard } from "@/components/OpenQuestionCard";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";

export default function SpecPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);

  // C2: answers the user settled for open decisions (kept in extended data, not
  // the core spec, so example projects aren't mutated). Hydrated client-side.
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    setResolved(loadExtendedProjectData(id)?.resolvedOpenDecisions ?? {});
  }, [id]);

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
      ) : (
      <div className="space-y-5">
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
