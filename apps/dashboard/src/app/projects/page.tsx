"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MOCK_PROJECTS, getProjectStats, type Project } from "@/lib/mock-data";
import { loadLocalProjects } from "@/lib/workflow-store";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { useI18n } from "@/i18n/I18nProvider";
import { statusLabel } from "@/i18n/dictionary.mjs";
import type { Dictionary } from "@/i18n/dictionary.mjs";

export default function ProjectsPage() {
  const { t } = useI18n();
  const [localProjects, setLocalProjects] = useState<Project[]>([]);

  useEffect(() => {
    setLocalProjects(loadLocalProjects());
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{t.projects.homeTitle}</h1>
        <p className="mt-1 text-sm text-gray-500">{t.projects.homeSubtitle}</p>
      </div>

      {localProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <h2 className="text-base font-semibold text-gray-900">{t.projects.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{t.projects.emptyBody}</p>
          <Link
            href="/projects/new"
            className="mt-5 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            + {t.projects.newProject}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {localProjects.map((project) => (
            <ProjectCard key={project.id} project={project} t={t} />
          ))}
        </div>
      )}

      {MOCK_PROJECTS.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-gray-700">{t.projects.examplesTitle}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{t.projects.examplesNote}</p>
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
}: {
  project: Project;
  t: Dictionary;
  exampleBadge?: string;
}) {
  const stats = getProjectStats(project);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-indigo-300 hover:shadow-sm"
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
        <span className="whitespace-nowrap text-xs text-gray-400">{project.createdAt}</span>
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
        <span className="text-gray-400">{statusLabel(t, "not_started")} {stats.notStarted}</span>
      </div>
    </Link>
  );
}
