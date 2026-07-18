"use client";

/**
 * /s/[id] — G11 읽기전용 공유 페이지 (docs/simsa-gap-backlog-2026-07-18.md).
 *
 * 비개발자가 개발자/팀에게 "링크 하나"로 넘기는 검수 리포트. 공유 시점의
 * 스냅샷만 보여준다(살아있는 프로젝트 아님) — 회수되면 404와 동일하게 보인다.
 * 받는 사람은 로그인 없이 읽기만 한다.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { callGetShareApi, type SharePayload } from "@/lib/workspace-check-api";
import { StatusBadge } from "@/components/StatusBadge";
import type { ItemStatus } from "@/lib/labels";
import { useI18n } from "@/i18n/I18nProvider";

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [phase, setPhase] = useState<"loading" | "done" | "missing">("loading");
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [createdAt, setCreatedAt] = useState("");

  useEffect(() => {
    let cancelled = false;
    callGetShareApi(id).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setPayload(r.payload);
        setCreatedAt(r.createdAt);
        setPhase("done");
      } else {
        setPhase("missing");
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="h-28 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
      </main>
    );
  }

  if (phase === "missing" || !payload) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-base font-semibold text-gray-900">{t.sharePage.missingTitle}</p>
        <p className="mt-2 text-sm text-gray-500">{t.sharePage.missingBody}</p>
      </main>
    );
  }

  const s = payload.summary;
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t.sharePage.eyebrow}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{payload.title}</h1>
      {payload.oneLine && <p className="mt-1 text-sm text-gray-500">{payload.oneLine}</p>}
      {createdAt && (
        <p className="mt-2 text-xs text-gray-400">
          {t.sharePage.snapshotNote.replace("{date}", createdAt.slice(0, 10))}
        </p>
      )}

      {payload.problem && (
        <section className="mt-8">
          <h2 className="section-title mb-2">{t.sharePage.problem}</h2>
          <p className="card p-4 text-sm text-gray-700">{payload.problem}</p>
        </section>
      )}

      {(payload.included?.length || payload.excluded?.length) ? (
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          {payload.included && payload.included.length > 0 && (
            <div className="card p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.sharePage.included}</h3>
              <ul className="space-y-1 text-sm text-gray-700">
                {payload.included.map((x, i) => <li key={i}>- {x}</li>)}
              </ul>
            </div>
          )}
          {payload.excluded && payload.excluded.length > 0 && (
            <div className="card p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.sharePage.excluded}</h3>
              <ul className="space-y-1 text-sm text-gray-700">
                {payload.excluded.map((x, i) => <li key={i}>- {x}</li>)}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      {payload.items && payload.items.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title mb-2">{t.sharePage.results}</h2>
          {s && (
            <p className="mb-3 text-xs text-gray-500">
              {t.sharePage.summaryLine
                .replace("{passed}", String(s.passed))
                .replace("{failed}", String(s.failed))
                .replace("{inconclusive}", String(s.inconclusive))
                .replace("{needsDecision}", String(s.needsDecision))}
            </p>
          )}
          <div className="space-y-2">
            {payload.items.map((item, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm font-medium text-gray-800">{item.title}</span>
                  <StatusBadge status={item.status as ItemStatus} />
                </div>
                {item.reason && <p className="mt-1.5 text-xs text-gray-500">{item.reason}</p>}
                {item.criteria && item.criteria.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                    {item.criteria.map((c, j) => <li key={j}>· {c}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {payload.openQuestions && payload.openQuestions.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title mb-2">{t.sharePage.openQuestions}</h2>
          <ul className="card space-y-1 p-4 text-sm text-gray-700">
            {payload.openQuestions.map((q, i) => <li key={i}>- {q}</li>)}
          </ul>
        </section>
      )}

      <footer className="mt-10 border-t border-gray-100 pt-4 text-xs text-gray-400">
        {t.sharePage.footer}{" "}
        <a href="https://simsa.dev" className="text-brand-700 hover:underline" target="_blank" rel="noreferrer">
          simsa.dev
        </a>
      </footer>
    </main>
  );
}
