"use client";

// Stage 262 — Visual checks (시각 검수) list. Client component: reads the
// project from localStorage (server components 404'd on local projects before)
// and the runs from the central plane with the browser-persisted userKey.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  listVisualChecks,
  type VisualCheckListItem,
} from "@/lib/workspace-visual-checks-api";
import { verdictLabel } from "@/lib/visual-check-view.mjs";
import type { VerdictTone } from "@/lib/visual-check-view.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};

function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function executorLabel(t: Dictionary, executor: string): string {
  return executor === "container" ? t.visualChecks.executorContainer : t.visualChecks.executorLocal;
}

export default function VisualChecksPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "error">("loading");
  const [checks, setChecks] = useState<VisualCheckListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await listVisualChecks(id, userKey);
      if (cancelled) return;
      if (res.ok) {
        setChecks(res.checks);
        setPhase("done");
      } else {
        // A project that only exists in this browser has no server-side runs yet.
        if (res.error === "project_not_found") {
          setChecks([]);
          setPhase("done");
        } else {
          setPhase("error");
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, userKey]);

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t.visualChecks.title}</h2>
        <p className="page-subtitle">{t.visualChecks.subtitle}</p>
      </div>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.visualChecks.loading}
        </div>
      )}

      {phase === "error" && (
        <div className="callout callout-error">{t.visualChecks.loadError}</div>
      )}

      {phase === "done" && checks.length === 0 && (
        <div className="empty-state">
          <p className="text-sm font-medium text-gray-700">{t.visualChecks.emptyTitle}</p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-gray-500">{t.visualChecks.emptyBody}</p>
        </div>
      )}

      {phase === "done" && checks.length > 0 && (
        <ul className="space-y-2">
          {checks.map((check) => {
            const verdict = verdictLabel(check.works, check.decision, t);
            return (
              <li key={check.id}>
                <Link
                  href={`/projects/${id}/visual-checks/${check.id}`}
                  className="card block px-4 py-3 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[verdict.tone]}`}>
                        {verdict.label}
                      </span>
                      <span className="truncate text-sm font-medium text-gray-800">{check.targetUrl}</span>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-400">{formatDateTime(check.createdAt, locale)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5">
                      {executorLabel(t, check.executor)}
                    </span>
                    <span>{t.visualChecks.evidenceCount.replace("{count}", String(check.evidenceCount))}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
