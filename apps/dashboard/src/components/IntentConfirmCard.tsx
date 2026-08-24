"use client";

/**
 * IntentConfirmCard — AF-4 (설계 D-3·D-4): **"이 앱은 ~로 보입니다. 맞나요?"**
 *
 * ## 왜 별도 화면이 아니라 카드인가
 *
 * 제출 직후 사용자는 프로젝트 화면에 도착하고, 거기서 1차 검수가 돌고 있다(AF-2).
 * 확인을 **그 자리에서** 받으면 이동이 없다. 가치를 먼저 보여주고 그 다음에 묻는
 * 순서가 이 설계의 핵심이므로, 확인 절차가 검수를 가로막아서는 안 된다.
 *
 * ## 정직성 (D-3)
 *
 * 추론이 비면 **지어내지 않는다.** 왜 비었는지(연결된 소스 없음 / 읽을 수 없음 /
 * 설명이 없음 / 생성 실패)를 그대로 말하고, 직접 적을 수 있는 길을 준다.
 * 지어낸 의도는 잘못된 기준을 만들고, 잘못된 기준은 잘못된 검수 결과를 만든다.
 *
 * 그리고 초안은 **초안이라고 말한다.** 사용자가 고치지 않고 넘기더라도, 그것이
 * 자기 판단이었다는 것을 알아야 한다.
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  getUserKey,
  loadExtendedProjectData,
  saveExtendedProjectData,
  getLocalProject,
  saveProject,
} from "@/lib/workflow-store";
import { CENTRAL_PLANE_URL } from "@/lib/workspace-sources-api";

type InferredItem = { id: string; title: string; criteria?: string[] };
type InferResponse = {
  ok: boolean;
  inferred?: {
    productSpec?: { productName?: string; oneLine?: string; problem?: string; included?: string[]; excluded?: string[]; openQuestions?: string[] };
    items?: InferredItem[];
    understood?: unknown;
  } | null;
  reason?: string;
  readSources?: string[];
  detectedName?: string;
  stack?: { hosting?: string; data?: string; tools?: string[] };
};

type Phase = "loading" | "ready" | "empty" | "error" | "done";

export function IntentConfirmCard({ projectId }: { projectId: string }) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [oneLine, setOneLine] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<InferredItem[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>("");
  const [raw, setRaw] = useState<InferResponse | null>(null);

  const infer = useCallback(async () => {
    setPhase("loading");
    try {
      const resp = await fetch(
        `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/infer-intent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userKey: getUserKey(), locale }),
          signal: AbortSignal.timeout(60000),
        },
      );
      const data = (await resp.json().catch(() => null)) as InferResponse | null;
      if (!data?.ok) {
        setPhase("error");
        return;
      }
      setRaw(data);
      if (!data.inferred) {
        setReason(data.reason ?? "no_evidence");
        setPhase("empty");
        return;
      }
      const spec = data.inferred.productSpec ?? {};
      setName((spec.productName ?? data.detectedName ?? "").trim());
      setOneLine((spec.oneLine ?? "").trim());
      setItems((data.inferred.items ?? []).slice(0, 12));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [projectId, locale]);

  useEffect(() => {
    // 이미 확정된 프로젝트에는 나타나지 않는다 — 확인은 한 번이면 된다.
    const ext = loadExtendedProjectData(projectId);
    if (ext?.productSpec?.oneLine || ext?.intentConfirmedAt) {
      setPhase("done");
      return;
    }
    void infer();
  }, [projectId, infer]);

  function confirm() {
    const kept = items.filter((i) => !dropped.has(i.id));
    const proj = getLocalProject(projectId);
    const finalName = name.trim() || proj?.name || "";
    saveProject({
      ...(proj ?? { id: projectId, createdAt: new Date().toISOString().slice(0, 10) }),
      id: projectId,
      name: finalName,
      description: oneLine.trim(),
      spec: {
        completeness: kept.length > 0 ? 60 : 30,
        goal: raw?.inferred?.productSpec?.problem ?? "",
        included: raw?.inferred?.productSpec?.included ?? [],
        excluded: raw?.inferred?.productSpec?.excluded ?? [],
        openDecisions: raw?.inferred?.productSpec?.openQuestions ?? [],
      },
      requirements: kept.map((i) => ({
        id: i.id,
        title: i.title,
        status: "not_started" as const,
        category: "feature",
        priority: "must" as const,
      })),
    } as Parameters<typeof saveProject>[0]);
    saveExtendedProjectData(projectId, {
      productSpec: {
        ...(raw?.inferred?.productSpec ?? {}),
        productName: finalName,
        oneLine: oneLine.trim(),
      },
      itemCriteria: Object.fromEntries(kept.map((i) => [i.id, i.criteria ?? []])),
      // 사용자가 확인했다는 사실 자체를 남긴다 — 카드가 다시 뜨지 않도록,
      // 그리고 "누가 이 기준을 정했나"의 답이 되도록.
      intentConfirmedAt: new Date().toISOString(),
    } as Parameters<typeof saveExtendedProjectData>[1]);
    setPhase("done");
  }

  if (phase === "done") return null;

  const c = t.intentConfirm;

  return (
    <section className="mb-8">
      <div className="card border-brand-200 bg-brand-50/40 p-5">
        {phase === "loading" && <p className="text-sm text-gray-600">{c.loading}</p>}

        {phase === "error" && (
          <>
            <p className="text-sm text-gray-700">{c.errorLead}</p>
            <button onClick={() => void infer()} className="btn btn-secondary btn-sm mt-3">
              {c.retry}
            </button>
          </>
        )}

        {phase === "empty" && (
          <>
            <h2 className="section-title">{c.emptyTitle}</h2>
            {/* 왜 비었는지 그대로 말한다 — 지어낸 초안보다 정직한 빈칸이 낫다. */}
            <p className="section-desc">
              {reason === "no_source"
                ? c.emptyNoSource
                : reason === "unreadable"
                  ? c.emptyUnreadable
                  : reason === "llm_unavailable"
                    ? c.emptyLlm
                    : c.emptyNoEvidence}
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">{c.oneLineLabel}</label>
              <input
                type="text"
                value={oneLine}
                onChange={(e) => setOneLine(e.target.value)}
                placeholder={c.oneLinePlaceholder}
                className="input"
              />
            </div>
            <button
              onClick={confirm}
              disabled={!oneLine.trim()}
              className="btn btn-primary btn-sm mt-3 disabled:opacity-50"
            >
              {c.saveMine}
            </button>
          </>
        )}

        {phase === "ready" && (
          <>
            <h2 className="section-title">{c.title}</h2>
            <p className="section-desc">{c.subtitle}</p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{c.nameLabel}</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{c.oneLineLabel}</label>
                <textarea
                  value={oneLine}
                  onChange={(e) => setOneLine(e.target.value)}
                  rows={2}
                  className="input resize-none"
                />
              </div>
            </div>

            {items.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold text-gray-600">{c.itemsLabel}</p>
                <p className="mb-2 text-xs text-gray-500">{c.itemsHint}</p>
                <ul className="space-y-1">
                  {items.map((i) => {
                    const off = dropped.has(i.id);
                    return (
                      <li key={i.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={() =>
                              setDropped((prev) => {
                                const next = new Set(prev);
                                if (off) next.delete(i.id);
                                else next.add(i.id);
                                return next;
                              })
                            }
                            className="mt-0.5"
                          />
                          <span className={off ? "text-gray-400 line-through" : "text-gray-700"}>{i.title}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* 무엇을 읽고 쓴 초안인지 밝힌다 — 근거를 숨기지 않는다. */}
            {raw?.readSources && raw.readSources.length > 0 && (
              <p className="mt-3 text-xs text-gray-400">
                {c.readFrom} {raw.readSources.join(", ")}
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button onClick={confirm} className="btn btn-primary btn-sm">
                {c.confirm}
              </button>
              <button onClick={() => setPhase("done")} className="text-xs text-gray-500 underline hover:text-gray-700">
                {c.later}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
