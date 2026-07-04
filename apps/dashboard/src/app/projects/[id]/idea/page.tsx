"use client";

import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import { getLocalProject } from "@/lib/workflow-store";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";

export default function IdeaPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  // Read on the client so locally-created (localStorage) projects resolve,
  // not just the bundled mock demos.
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="page-title">{t.nav.idea}</h1>
      <p className="page-subtitle mb-8">{t.idea.subtitle}</p>

      <div className="card mb-6 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t.idea.yourInput}
        </h2>
        <p className="text-sm leading-relaxed text-gray-800">{project.description}</p>
      </div>

      <div className="card mb-6 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
      <StepNextButton />
    </div>
  );
}
