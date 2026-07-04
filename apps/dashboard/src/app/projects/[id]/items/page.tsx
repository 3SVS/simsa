"use client";

import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import { getLocalProject } from "@/lib/workflow-store";
import { ACCEPTANCE_CRITERIA } from "@/lib/mock-generators";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";

export default function ItemsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="page-title">{t.items.title}</h1>
      <p className="page-subtitle mb-8">{t.items.subtitle}</p>

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
                  <span className="text-xs text-gray-400">{t.priority[req.priority]}</span>
                </div>
              </div>
            </div>

            {ACCEPTANCE_CRITERIA[req.id] && (
              <div className="ml-17 pl-14">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
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

      <div className="mt-6 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-5 py-4">
        <p className="text-sm text-brand-800">{t.items.ctaQuestion}</p>
        <a href={`/projects/${id}/export`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
          {t.items.ctaButton} →
        </a>
      </div>
      <StepNextButton />
    </div>
  );
}
