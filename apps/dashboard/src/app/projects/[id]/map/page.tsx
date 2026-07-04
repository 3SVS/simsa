"use client";

// Stage 183 — Simsa Plan Map ("심사 지도") read-only preview. Generated from the project's
// current local context (getLocalProject ?? getProject). NO server access, NO persistence,
// NO write actions, NO real multi-user approval. The whole acceptance journey is shown so
// the user can see where they are, what's done/next/later, what's blocked, what needs
// approval, what's not verified, and what happens if they approve.
import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getProject } from "@/lib/mock-data";
import { getLocalProject } from "@/lib/workflow-store";
import { useI18n } from "@/i18n/I18nProvider";
import { buildPlanMapPreview } from "@/lib/plan-map.mjs";
import type { PlanMapStage, PlanMapStatus, PlanMapGate } from "@/lib/plan-map.d.mts";
import type { Dictionary } from "@/i18n/dictionary.mjs";

function statusTone(status: PlanMapStatus): string {
  switch (status) {
    case "completed":
    case "merged":
    case "deployed":
      return "bg-green-50 text-green-700 border-green-200";
    case "in_progress":
    case "verifying":
      return "bg-brand-50 text-brand-700 border-brand-200";
    case "needs_approval":
      return "bg-gold-100 text-gold-700 border-gold-200";
    case "not_verified":
    case "deferred":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "blocked":
    case "failed_check":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-gray-50 text-gray-600 border-gray-200";
  }
}

function riskTone(risk: PlanMapGate["risk"]): string {
  return risk === "high"
    ? "text-red-700"
    : risk === "medium"
      ? "text-amber-700"
      : "text-gray-500";
}

function StatusPill({ status, pm }: { status: PlanMapStatus; pm: Dictionary["planMap"] }) {
  const label = pm.status[status as keyof typeof pm.status] ?? status;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusTone(status)}`}>
      {label}
    </span>
  );
}

function StageRow({ stage, pm }: { stage: PlanMapStage; pm: Dictionary["planMap"] }) {
  const label = pm.stages[stage.id as keyof typeof pm.stages] ?? stage.id;
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-gray-100 bg-white px-3 py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <StatusPill status={stage.status} pm={pm} />
    </li>
  );
}

export default function PlanMapPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const pm = t.planMap;

  const project = getLocalProject(id) ?? getProject(id);
  const plan = useMemo(
    () =>
      buildPlanMapPreview(
        project
          ? {
              title: project.name,
              goal: project.spec?.goal,
              specCompleteness: project.spec?.completeness,
              items: project.requirements?.map((r) => ({ id: r.id, title: r.title, status: r.status })),
            }
          : {},
      ),
    [project],
  );

  const title = plan.title || pm.titleFallback;
  const goal = plan.goal || pm.goalFallback;
  const currentStageLabel = pm.stages[plan.position.currentStageId as keyof typeof pm.stages] ?? plan.position.currentStageId;
  const trainLabel = pm.trains[plan.position.trainKey] ?? plan.position.trainKey;
  const checkpointLabel = pm.stages[plan.position.nextCheckpointId as keyof typeof pm.stages] ?? plan.position.nextCheckpointId;

  return (
    <div className="mx-auto max-w-3xl px-1 py-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{pm.title}</h1>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500">
          {pm.readOnlyPreview}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">{pm.subtitle}</p>
      <p className="mt-2 text-xs text-gray-500">{pm.generatedNote}</p>

      {/* You are here */}
      <section className="card mt-5 p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700">{pm.youAreHere}</p>
        <p className="mt-1 text-lg font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm text-gray-500">{goal}</p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
            <dt className="text-[11px] text-gray-500">{pm.currentStage}</dt>
            <dd className="mt-0.5 font-medium text-gray-800">{currentStageLabel}</dd>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
            <dt className="text-[11px] text-gray-500">{pm.currentTrain}</dt>
            <dd className="mt-0.5 font-medium text-gray-800">{trainLabel}</dd>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
            <dt className="text-[11px] text-gray-500">{pm.nextCheckpoint}</dt>
            <dd className="mt-0.5 font-medium text-gray-800">{checkpointLabel}</dd>
          </div>
        </dl>
      </section>

      {/* Journey: done / current / next / later */}
      <section className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {([
          ["done", plan.sections.done],
          ["next", plan.sections.next ? [plan.sections.next] : []],
          ["current", plan.sections.current ? [plan.sections.current] : []],
          ["later", plan.sections.later],
        ] as const).map(([key, stages]) => (
          <div key={key} className="card p-4">
            <p className="section-title mb-2">{pm.sections[key]}</p>
            {stages.length === 0 ? (
              <p className="text-xs text-gray-500">—</p>
            ) : (
              <ul className="space-y-1.5">
                {stages.map((s) => (
                  <StageRow key={s.id} stage={s} pm={pm} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      {/* Evidence */}
      <section className="card mt-5 p-5">
        <p className="section-title">{pm.evidenceLabel}</p>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-3">
            <p className="text-xl font-semibold text-gray-800">{plan.evidence.completed}</p>
            <p className="text-[11px] text-gray-500">{pm.status.completed}</p>
          </div>
          <div className="rounded-md border border-amber-100 bg-amber-50 px-2 py-3">
            <p className="text-xl font-semibold text-amber-700">{plan.evidence.notVerifiedCount}</p>
            <p className="text-[11px] text-amber-600">{pm.notVerifiedLabel}</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-3">
            <p className="text-xl font-semibold text-gray-800">{plan.evidence.total}</p>
            <p className="text-[11px] text-gray-500">{pm.evidenceLabel}</p>
          </div>
        </div>
        {plan.evidence.notVerifiedCount > 0 && (
          <p className="mt-3 text-xs text-amber-700">{pm.notVerifiedYet} · {pm.evidenceMissing}</p>
        )}
      </section>

      {/* Blockers */}
      <section className="card mt-5 p-5">
        <p className="section-title">{pm.blockersLabel}</p>
        {plan.blockers.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">{pm.noBlockers}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {plan.blockers.map((b) => (
              <li key={b.id} className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                <span className="mt-0.5 text-gray-300">•</span>
                <span className="flex-1 text-gray-700">
                  {pm.blockers[b.kind as keyof typeof pm.blockers] ?? b.kind}
                  {b.count > 0 && <span className="ml-1 font-mono text-xs text-gray-500">({b.count})</span>}
                </span>
                {b.kind === "identity" && (
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] text-gray-500">
                    {pm.blockedByIdentity}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Approval gates */}
      <section className="card mt-5 p-5">
        <p className="section-title">{pm.gatesLabel}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plan.gates.map((g) => {
            const gc = pm.gates[g.key as keyof typeof pm.gates];
            if (!gc) return null;
            return (
              <div key={g.key} className="rounded-lg border border-gray-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">{gc.label}</span>
                  <span className={`text-[10px] font-medium ${riskTone(g.risk)}`}>
                    {pm.riskLabel}: {pm.risk[g.risk]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">{gc.why}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="rounded-full border border-gold-200 bg-gold-100 px-2 py-0.5 text-[10px] font-medium text-gold-700">
                    {pm.approvalRequired}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-[11px]">
                  <div className="flex gap-1">
                    <dt className="text-gray-500">{pm.changesLabel}:</dt>
                    <dd className="text-gray-600">{gc.changes}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-gray-500">{pm.unchangedLabel}:</dt>
                    <dd className="text-gray-600">{gc.unchanged}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      {/* What happens if I approve? */}
      <section className="card mt-5 border-brand-100 bg-brand-50/40 p-5">
        <p className="section-title">{pm.whatIfApprove}</p>
        <p className="mt-2 text-sm text-gray-700">{pm.nextRecommended}: <span className="font-medium">{currentStageLabel}</span></p>
        <ul className="mt-2 space-y-1 text-xs text-gray-600">
          <li>• {pm.prepPlanOnly}</li>
          <li>• {pm.willNotDeploy}</li>
        </ul>
      </section>

      <p className="mt-5 text-[11px] leading-relaxed text-gray-500">{pm.collabNote}</p>

      <div className="mt-4">
        <Link href={`/projects/${id}`} className="text-xs text-brand-700 hover:underline">
          ← {t.common.project}
        </Link>
      </div>
    </div>
  );
}
