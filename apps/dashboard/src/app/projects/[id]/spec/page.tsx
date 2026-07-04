"use client";

import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import { getLocalProject } from "@/lib/workflow-store";
import { SpecCompleteness } from "@/components/SpecCompleteness";
import { useI18n } from "@/i18n/I18nProvider";
import { StepNextButton } from "@/components/StepNextButton";

export default function SpecPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

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
            <ul className="space-y-2">
              {spec.openDecisions.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-slate-400">!</span> {d}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
      <StepNextButton />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {children}
    </div>
  );
}
