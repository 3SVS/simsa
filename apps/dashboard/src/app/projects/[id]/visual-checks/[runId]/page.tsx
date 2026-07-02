"use client";

// Stage 262 — Visual check report detail. Renders the persisted Korean
// non-dev report (Stage 260B layout): verdict heading + works chip, one-line
// lead, meta, findings cards, screenshots, flow video, copy-ready agent fix
// prompt, next steps and notes. Client component (localStorage userKey).

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject } from "@/lib/mock-data";
import { getLocalProject, getUserKey } from "@/lib/workflow-store";
import {
  getVisualCheck,
  CENTRAL_PLANE_URL,
  type VisualCheckDetail,
  type NonDevFinding,
} from "@/lib/workspace-visual-checks-api";
import {
  verdictLabel,
  severityLabel,
  severityTone,
  splitEvidenceKeys,
  buildEvidenceUrl,
} from "@/lib/visual-check-view.mjs";
import type { VerdictTone, SeverityTone } from "@/lib/visual-check-view.mjs";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary, Locale } from "@/i18n/dictionary.mjs";

const TONE_CLASS: Record<VerdictTone, string> = {
  passed: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
};

const SEVERITY_CLASS: Record<SeverityTone, string> = {
  failed: "bg-red-50 text-red-700 border-red-200",
  inconclusive: "bg-amber-50 text-amber-700 border-amber-200",
  decision: "bg-slate-50 text-slate-600 border-slate-200",
};

function formatDateTime(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function FindingCard({ finding, t }: { finding: NonDevFinding; t: Dictionary }) {
  return (
    <div className="card p-4">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CLASS[severityTone(finding.severity)]}`}>
        {severityLabel(finding.severity, t)}
      </span>
      <dl className="mt-3 space-y-2.5">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t.visualChecks.findingWhat}</dt>
          <dd className="mt-0.5 text-sm font-medium text-gray-800">{finding.what}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t.visualChecks.findingWhy}</dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-gray-600">{finding.why}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t.visualChecks.findingHow}</dt>
          <dd className="mt-0.5 text-sm leading-relaxed text-gray-600">{finding.how}</dd>
        </div>
      </dl>
      {finding.evidence && (
        <details className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">{t.visualChecks.findingTech}</summary>
          <code className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-gray-600">{finding.evidence}</code>
        </details>
      )}
    </div>
  );
}

export default function VisualCheckDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { t, locale } = useI18n();
  const project = getLocalProject(id) ?? getProject(id);
  const userKey = getUserKey();

  const [phase, setPhase] = useState<"loading" | "done" | "notfound" | "error">("loading");
  const [check, setCheck] = useState<VisualCheckDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      const res = await getVisualCheck(id, runId, userKey);
      if (cancelled) return;
      if (res.ok) {
        setCheck(res.check);
        setPhase("done");
      } else if (res.error === "not_found" || res.error === "forbidden") {
        setPhase("notfound");
      } else {
        setPhase("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, runId, userKey]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  if (!project) return <p className="text-sm text-gray-400">{t.common.notFound}</p>;

  async function handleCopyPrompt() {
    if (!check?.agentPrompt) return;
    try {
      await navigator.clipboard.writeText(check.agentPrompt);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — leave the button as-is.
    }
  }

  const report = check?.report ?? null;
  const verdict = check ? verdictLabel(check.works, check.decision, t) : null;
  const evidence = splitEvidenceKeys(check?.evidenceKeys ?? []);
  const findings = report?.findings ?? [];
  const nextSteps = report?.nextSteps ?? [];
  const notes = report?.notes ?? [];

  return (
    <div className="space-y-6">
      <Link href={`/projects/${id}/visual-checks`} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
        ← {t.visualChecks.backToList}
      </Link>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
          {t.visualChecks.loading}
        </div>
      )}

      {phase === "notfound" && (
        <div className="callout callout-info">{t.visualChecks.notFound}</div>
      )}

      {phase === "error" && (
        <div className="callout callout-error">{t.visualChecks.loadError}</div>
      )}

      {phase === "done" && check && verdict && (
        <>
          {/* Verdict heading + works chip */}
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="page-title">{report?.verdict || verdict.label}</h2>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[verdict.tone]}`}>
                {verdict.label}
              </span>
            </div>
            {report?.oneLine && <p className="page-subtitle">{report.oneLine}</p>}
          </div>

          {/* Meta: target / intent / date */}
          <section className="card p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-400">{t.visualChecks.metaTarget}</dt>
                <dd className="min-w-0 break-all text-gray-700">
                  <a href={check.targetUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    {check.targetUrl}
                  </a>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-400">{t.visualChecks.metaIntent}</dt>
                <dd className="min-w-0 leading-relaxed text-gray-700">{report?.intent || check.intent}</dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="w-40 flex-shrink-0 text-xs font-medium text-gray-400">
                  {check.executor === "container" ? t.visualChecks.executorContainer : t.visualChecks.executorLocal}
                </dt>
                <dd className="text-gray-500">{formatDateTime(check.createdAt, locale)}</dd>
              </div>
            </dl>
          </section>

          {/* Findings */}
          <section className="space-y-3">
            <h3 className="section-title">{t.visualChecks.findingsTitle}</h3>
            {findings.length === 0 ? (
              <p className="text-xs text-gray-400">{t.visualChecks.noFindings}</p>
            ) : (
              findings.map((f, i) => <FindingCard key={i} finding={f} t={t} />)
            )}
          </section>

          {/* Screenshots */}
          {evidence.screenshots.length > 0 && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.screenshotsTitle}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.screenshots.map((name) => (
                  <figure key={name} className="card overflow-hidden">
                    {/* Evidence is served by the central plane behind the userKey — a
                        plain <img> keeps the private query URL out of Next's optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={buildEvidenceUrl(CENTRAL_PLANE_URL, id, runId, name, userKey)}
                      alt={name}
                      loading="lazy"
                      className="w-full bg-gray-50"
                    />
                    <figcaption className="border-t border-gray-100 px-3 py-1.5 font-mono text-[10px] text-gray-400">
                      {name.replace(/^screenshots\//, "")}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}

          {/* Flow video */}
          {evidence.video && (
            <section className="space-y-3">
              <h3 className="section-title">{t.visualChecks.videoTitle}</h3>
              <video
                controls
                preload="metadata"
                src={buildEvidenceUrl(CENTRAL_PLANE_URL, id, runId, evidence.video, userKey)}
                className="card w-full"
              />
            </section>
          )}

          {/* Copy-ready agent fix prompt */}
          <section className="card p-5">
            <h3 className="section-title">{t.visualChecks.fixTitle}</h3>
            {check.agentPrompt ? (
              <>
                <p className="section-desc leading-relaxed">{t.visualChecks.fixBody}</p>
                <button
                  onClick={handleCopyPrompt}
                  className="btn btn-primary btn-sm mt-3"
                >
                  {copied ? t.visualChecks.copied : t.visualChecks.copyPrompt}
                </button>
              </>
            ) : (
              <p className="section-desc">{t.visualChecks.noPrompt}</p>
            )}
          </section>

          {/* Next steps */}
          {nextSteps.length > 0 && (
            <section className="card p-5">
              <h3 className="section-title">{t.visualChecks.nextStepsTitle}</h3>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                {nextSteps.map((step, i) => (
                  <li key={i} className="text-sm leading-relaxed text-gray-600">{step}</li>
                ))}
              </ol>
            </section>
          )}

          {/* Notes */}
          {notes.length > 0 && (
            <section className="card p-5">
              <h3 className="section-title">{t.visualChecks.notesTitle}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                {notes.map((note, i) => (
                  <li key={i} className="text-xs leading-relaxed text-gray-500">{note}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
