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
 * 앱을 아예 읽지 못한 경우(error)에도 직접 적는 칸은 있다(PR #571 검증 결함 2).
 *
 * 그리고 초안은 **초안이라고 말한다.** 사용자가 고치지 않고 넘기더라도, 그것이
 * 자기 판단이었다는 것을 알아야 한다.
 *
 * ## 문 (c) "만들었는데 생각과 달라요" (C-N7 · PR #571 검증 결함 1·3·9)
 *
 * 이 문의 사용자에게 추론한 문장은 **지금 앱이 하는 일** — 바로 "생각과 다르다"는
 * 그것이다. 그래서 그 문장은 읽기 전용 참고로만 보이고, "원래 만들려던 것" 칸은
 * 비어서 시작하며, 비었거나 참고 문장과 같으면 확정할 수 없다(한 번 누르기로 지금 앱이
 * 기준이 되지 않게). 확정한 뒤에는 카드가 사라지지 않고 "이 기준으로 다시 확인"을
 * 권한다 — 첫 확인은 질문 전에 일반 기준으로 돌았기 때문이다. 자동으로 다시 돌리지는
 * 않는다(모든 확인은 하루 상한에 들어간다).
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import type { Dictionary } from "@/i18n/dictionary.mjs";
import {
  getUserKey,
  loadExtendedProjectData,
  saveExtendedProjectData,
  getLocalProject,
  saveProject,
} from "@/lib/workflow-store";
import { CENTRAL_PLANE_URL } from "@/lib/workspace-sources-api";
import { mirrorLocalProjectToDb } from "@/lib/project-mirror";
import {
  intentCardAfterConfirm,
  intentCardCanConfirm,
  intentCardCopyKeys,
  intentCardDraft,
} from "@/lib/entry-doors.mjs";
import type { EntryDoor, IntentCardCopyKeys } from "@/lib/entry-doors.mjs";
import { runVisualCheck } from "@/lib/workspace-visual-checks-api";
import { intentRecheckBody } from "@/lib/visual-check-recheck.mjs";
import { runErrorNotice, runErrorTone } from "@/lib/visual-check-run-state.mjs";
import type { RunErrorKey } from "@/lib/visual-check-run-state.mjs";
import { errorNoticeText } from "@/lib/daily-limit.mjs";

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

// "confirmed" — door (c) only: saved, and the card offers a check with that line.
type Phase = "loading" | "ready" | "empty" | "error" | "confirmed" | "done";

type RecheckNotice =
  | { kind: "queuedOnly" }
  | { kind: "error"; errorKey: RunErrorKey; resetAt: string | null; receivedAt: number };

export function IntentConfirmCard({ projectId }: { projectId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [oneLine, setOneLine] = useState("");
  // What the app was read as (door (c) shows it read-only; confirming it is refused).
  const [inferredOneLine, setInferredOneLine] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState<InferredItem[]>([]);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<string>("");
  const [raw, setRaw] = useState<InferResponse | null>(null);
  // C-N7: door (c) "만들었는데 생각과 달라요" — the same card and the same save, but
  // it asks for what the user MEANT: confirming what the app currently IS would
  // lock in the wrong yardstick for exactly these users.
  const [entryDoor, setEntryDoor] = useState<EntryDoor | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckNotice, setRecheckNotice] = useState<RecheckNotice | null>(null);

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
      // PR #571 검증 결함 1·9: 문 (c)는 칸을 비워 두고 지금 앱 문장은 참고로만 쓴다.
      // 문은 여기서 새로 읽는다(재시도 버튼도 같은 함수를 부르므로 상태에 기대지 않는다).
      const draft = intentCardDraft(loadExtendedProjectData(projectId)?.entryDoor ?? null, spec.oneLine);
      setName((spec.productName ?? data.detectedName ?? "").trim());
      setInferredOneLine((spec.oneLine ?? "").trim());
      // 읽기 실패 뒤 사용자가 이미 적어 둔 문장은 다시 읽기가 덮어쓰지 않는다.
      setOneLine((prev) => (prev.trim() ? prev : draft.initialOneLine));
      setItems((data.inferred.items ?? []).slice(0, 12));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [projectId, locale]);

  useEffect(() => {
    // 이미 확정된 프로젝트에는 나타나지 않는다 — 확인은 한 번이면 된다.
    const ext = loadExtendedProjectData(projectId);
    setEntryDoor(ext?.entryDoor ?? null);
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
    // Train C — C0 (재정렬 §1 끊김 #1 · W1-6): 확정한 의도를 **판정의 자**로 만든다.
    // 위 저장은 localStorage(+디바운스 ext 블롭)에만 닿았고, 검수·지시서가 읽는
    // D1 workspace_projects(idea/productSpec/items)에는 닿지 않았다 — 그래서
    // "맞나요?"에 답해도 검수 기준은 바뀌지 않았다. 로컬이 정본이므로 미러는
    // 뒤에, 그리고 실패해도 조용히(확정 자체를 막지 않는다).
    void mirrorLocalProjectToDb(projectId).catch(() => undefined);
    // PR #571 검증 결함 3: 문 (c)는 카드를 조용히 없애지 않고 "이 기준으로 다시 확인"을 권한다.
    setPhase(intentCardAfterConfirm(entryDoor) === "recheck" ? "confirmed" : "done");
  }

  // 사용자가 누를 때만 돈다 — 자동 재실행 없음(하루 상한). 확정한 문장을 명시 의도로
  // 싣는다: D1 미러가 아직 안 닿았어도 일반 문장으로 재지 않게.
  async function recheckWithIntent() {
    if (rechecking) return;
    setRechecking(true);
    setRecheckNotice(null);
    const res = await runVisualCheck(projectId, intentRecheckBody(oneLine, getUserKey(), locale));
    if (res.ok && res.dispatched) {
      // 버튼은 이동하는 동안 꺼진 채로 둔다.
      router.push(`/projects/${projectId}/visual-checks/${res.check.id}`);
      return;
    }
    if (res.ok) {
      setRecheckNotice({ kind: "queuedOnly" });
    } else {
      // 답 전체를 넘긴다 — 429는 resetAt을 싣고 온다(W-2).
      setRecheckNotice({ kind: "error", ...runErrorNotice(res), receivedAt: Date.now() });
    }
    setRechecking(false);
  }

  if (phase === "done") return null;

  const c = t.intentConfirm;
  const k = intentCardCopyKeys(entryDoor);
  const readNow = intentCardDraft(entryDoor, inferredOneLine).readNow;
  const canConfirm = intentCardCanConfirm({ entryDoor, oneLine, inferredOneLine });

  return (
    // 버튼은 **보조**다 (2026-09-01). 화면당 주 버튼은 하나여야 하고
    // (uiux-redesign-instructions #5, journey-audit가 P1으로 잰다), 그 하나는
    // **앞으로 가는 행동** — 지휘 센터의 "지금 할 일" — 이다. 이 카드는 우리가 한
    // 추론이 맞는지 **확인받는** 자리이고 "나중에"로 건너뛸 수 있다. 대신 카드
    // 자체를 브랜드 톤으로 띄워 눈에 걸리게 한다.
    <section className="mb-8">
      <div className="card border-brand-200 bg-brand-50/40 p-5">
        {phase === "loading" && <p className="text-sm text-gray-600">{c.loading}</p>}

        {phase === "error" && (
          <>
            <p className="text-sm text-gray-700">{c.errorLead}</p>
            {/* PR #571 검증 결함 2: 읽지 못해도 직접 적을 길은 있다 — 문 (c)의 첫 화면은
                "다음 화면에서 원래 만들려던 것을 여쭤볼게요"라고 약속했다. */}
            <ManualIntentInput c={c} oneLineLabelKey={k.oneLineLabel} value={oneLine} onChange={setOneLine} onSave={confirm}>
              <button onClick={() => void infer()} className="btn btn-secondary btn-sm">
                {c.retry}
              </button>
            </ManualIntentInput>
          </>
        )}

        {phase === "empty" && (
          <>
            <h2 className="section-title">{c[k.emptyTitle]}</h2>
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
            <ManualIntentInput c={c} oneLineLabelKey={k.oneLineLabel} value={oneLine} onChange={setOneLine} onSave={confirm} />
          </>
        )}

        {phase === "ready" && (
          <>
            <h2 className="section-title">{c[k.title]}</h2>
            <p className="section-desc">{c[k.subtitle]}</p>

            {/* 문 (c): 지금 앱에서 읽은 문장은 **참고**다 — 고칠 칸이 아니라 읽기 전용. */}
            {readNow && (
              <div className="mt-3 rounded-md border border-gray-200 bg-white/60 px-3 py-2">
                <p className="text-xs font-semibold text-gray-500">{c.differsReadNowLabel}</p>
                <p className="mt-0.5 text-sm text-gray-600">{readNow}</p>
              </div>
            )}

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{c.nameLabel}</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{c[k.oneLineLabel]}</label>
                <textarea
                  value={oneLine}
                  onChange={(e) => setOneLine(e.target.value)}
                  placeholder={c.oneLinePlaceholder}
                  rows={2}
                  className="input resize-none"
                />
              </div>
            </div>

            {items.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-semibold text-gray-600">{c.itemsLabel}</p>
                <p className="mb-2 text-xs text-gray-500">{c[k.itemsHint]}</p>
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
              <button onClick={confirm} disabled={!canConfirm} className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-50">
                {c[k.confirm]}
              </button>
              <button onClick={() => setPhase("done")} className="text-xs text-gray-500 underline hover:text-gray-700">
                {c.later}
              </button>
            </div>
          </>
        )}

        {phase === "confirmed" && (
          <>
            <p className="text-sm text-gray-700">{c.differsRecheckLead}</p>
            {recheckNotice?.kind !== "queuedOnly" && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => void recheckWithIntent()}
                  disabled={rechecking}
                  className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rechecking ? t.visualChecks.runSubmitting : c.differsRecheckButton}
                </button>
                <button onClick={() => setPhase("done")} className="text-xs text-gray-500 underline hover:text-gray-700">
                  {c.later}
                </button>
              </div>
            )}
            <RecheckNoticeView notice={recheckNotice} t={t} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The "write it yourself" field — empty phase (nothing to draft from) and error
 * phase (the app could not be read). Same field, same save, on every door.
 */
function ManualIntentInput({
  c,
  oneLineLabelKey,
  value,
  onChange,
  onSave,
  children,
}: {
  c: Dictionary["intentConfirm"];
  oneLineLabelKey: IntentCardCopyKeys["oneLineLabel"];
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  /** Extra actions beside "save" (the error phase's "try again"). */
  children?: ReactNode;
}) {
  return (
    <>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-gray-600">{c[oneLineLabelKey]}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={c.oneLinePlaceholder}
          className="input"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onSave} disabled={!value.trim()} className="btn btn-secondary btn-sm disabled:opacity-50">
          {c.saveMine}
        </button>
        {children}
      </div>
    </>
  );
}

function RecheckNoticeView({ notice, t }: { notice: RecheckNotice | null; t: Dictionary }) {
  if (!notice) return null;
  if (notice.kind === "queuedOnly") {
    return <div className="callout callout-info mt-3">{t.visualChecks.runQueuedOnly}</div>;
  }
  // 앞선 확인(보통 제출 직후의 첫 확인)이 아직 도는 중 — 이 카드의 말로 다음 행동을 알려준다.
  if (notice.errorKey === "runAlreadyActive") {
    return <div className="callout callout-info mt-3">{t.intentConfirm.differsRecheckBusy}</div>;
  }
  const soft = runErrorTone(notice.errorKey) === "info";
  return (
    <div className={`callout mt-3 ${soft ? "callout-info" : "callout-error"}`}>
      {errorNoticeText(t.visualChecks.runErrors, notice.errorKey, notice.resetAt, t.visualChecks.resetWhen, { receivedAt: notice.receivedAt })}
    </div>
  );
}
