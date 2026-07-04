"use client";

// Stage 267 — shared renderers for an idea/document → spec draft
// (IdeaToSpecDraftResponse shape). Extracted from src/app/projects/new/page.tsx
// so the document-intake draft page (/projects/[id]/sources/[sourceId]/draft)
// reuses the exact same understood / productSpec / items presentation instead
// of duplicating it. Pure presentation — no fetch, no storage.

import { ACCEPTANCE_CRITERIA } from "@/lib/mock-generators";
import type {
  IdeaToSpecDraftResponse,
  WorkspaceRequirementItem,
} from "@/lib/workspace-types";
import { StatusBadge } from "@/components/StatusBadge";
import type { Dictionary } from "@/i18n/dictionary.mjs";

/** "What Simsa understood" card: summary + main users + main flow. */
export function UnderstoodCard({
  t,
  understood,
}: {
  t: Dictionary;
  understood: IdeaToSpecDraftResponse["understood"];
}) {
  return (
    <div className="card mb-6 p-6">
      <p className="mb-5 text-sm leading-relaxed text-gray-800">{understood.summary}</p>
      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.np.mainUsers}</p>
        <ul className="space-y-1">
          {understood.targetUsers.map((u, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="mt-0.5 text-brand-400">•</span>{u}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.np.mainFlow}</p>
        <ol className="space-y-1">
          {understood.mainFlow.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700">
              <span className="w-4 flex-shrink-0 font-mono text-gray-300">{i + 1}.</span>{f}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Product spec card + must-have items list (draft body, no actions). */
export function SpecDraftBody({
  t,
  data,
}: {
  t: Dictionary;
  data: Pick<IdeaToSpecDraftResponse, "productSpec" | "items">;
}) {
  const { productSpec, items } = data;
  return (
    <>
      <div className="card mb-6 p-6">
        <h3 className="mb-0.5 text-lg font-semibold text-gray-900">{productSpec.productName}</h3>
        <p className="mb-5 text-sm text-gray-500">{productSpec.oneLine}</p>

        <SpecRow label={t.np.whoFor} value={productSpec.targetUsers.join(", ")} />
        <SpecRow label={t.np.problem} value={productSpec.problem} />

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.np.included}</p>
          <ul className="space-y-1">
            {productSpec.included.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="mt-0.5 text-green-500">•</span> {item}
              </li>
            ))}
          </ul>
        </div>

        {productSpec.excluded.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.np.excluded}</p>
            <ul className="space-y-1">
              {productSpec.excluded.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-500">
                  <span className="mt-0.5">×</span> {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {productSpec.openQuestions.length > 0 && (
          <div className="mt-4 rounded-lg bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{t.np.openDecisions}</p>
            <ul className="space-y-1">
              {productSpec.openQuestions.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-0.5">!</span> {d}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mb-8">
        <p className="mb-3 text-sm font-semibold text-gray-700">{t.np.mustHaves} ({items.length})</p>
        <div className="space-y-2">
          {items.map((item) => (
            <RequirementRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </>
  );
}

export function RequirementRow({ item }: { item: WorkspaceRequirementItem }) {
  const criteriaList = item.criteria.length > 0 ? item.criteria : (ACCEPTANCE_CRITERIA[item.id] ?? []);
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-start gap-3">
        <p className="flex-1 text-sm font-medium text-gray-800">{item.title}</p>
        <StatusBadge status={item.status} />
      </div>
      {criteriaList.length > 0 && (
        <ul className="space-y-1 pl-1">
          {criteriaList.map((c, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-500">
              <span className="text-gray-300">-</span> {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  );
}
