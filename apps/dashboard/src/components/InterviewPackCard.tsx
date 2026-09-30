"use client";

/**
 * InterviewPackCard — C-A7 (재정렬 2026-09-27 §3 문 (c)): **"내 AI에게 물어보기"**.
 *
 * 문 (c) "만들었는데 생각과 달라요"는 앱이 **작동한다.** 그래서 앱에서 읽어낸 것만으로는 무엇이
 * 다른지 모른다 — 다른지는 유저의 머릿속에 있다. 이 카드는 그걸 꺼내는 가장 싼 길이다:
 *   1) 질문 묶음을 복사해 유저가 이미 쓰는 AI 채팅에 붙여넣는다(우리 비용 0, 유저 언어 그대로)
 *   2) AI가 하나씩 묻고 마지막에 고정 양식으로 정리한다
 *   3) 그 답을 여기 붙여넣으면 서버가 양식을 읽고(저장 안 함), 우리는 "맞나요?" 카드와 **같은 경로**로
 *      반영한다: 로컬 저장(정본) → 미러 → 역추론 지시서(확인된 must) → 다음 검수에 들어간다.
 *
 * 인라인 카드다(모달·오버레이 금지). 처음엔 접혀 있다 — 기존 앱 문의 모든 유저에게 펼쳐 보이면
 * 소음이다. 못 읽은 부분은 **지어내지 않고** "이 부분은 읽지 못했어요"로 말한다.
 */
import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import {
  getUserKey,
  getLocalProject,
  loadExtendedProjectData,
  saveExtendedProjectData,
  saveProject,
} from "@/lib/workflow-store";
import { fetchInterviewPack, parseInterviewAnswerApi, type InterviewAnswerOk, type InterviewApiError } from "@/lib/interview-pack-api";
import { applyInterviewAnswer } from "@/lib/interview-apply.mjs";
import { mirrorThenBuildIntentRuler } from "@/lib/intent-ruler";

type PackState = "idle" | "loading" | "ready" | "error";
type ApplyState = "idle" | "reading" | "done" | "error";
type RulerState = "building" | "built" | "skipped" | "failed" | null;

export function InterviewPackCard({ projectId }: { projectId: string }) {
  const { t, locale } = useI18n();
  const c = t.interviewPack;
  const loc: "ko" | "en" = locale === "en" ? "en" : "ko";
  const [open, setOpen] = useState(false);
  const [packState, setPackState] = useState<PackState>("idle");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [answerText, setAnswerText] = useState("");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [applyError, setApplyError] = useState<InterviewApiError | null>(null);
  const [read, setRead] = useState<InterviewAnswerOk["answer"] | null>(null);
  const [ruler, setRuler] = useState<RulerState>(null);

  async function loadPack() {
    setPackState("loading");
    const ext = loadExtendedProjectData(projectId);
    const r = await fetchInterviewPack(projectId, getUserKey(), loc, ext?.intentConfirmedItemIds ?? []);
    if (r.ok) {
      setPrompt(r.prompt);
      setPackState("ready");
    } else {
      setPackState("error");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && packState === "idle") void loadPack();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  }

  async function handleApply() {
    setApplyError(null);
    setApplyState("reading");
    const r = await parseInterviewAnswerApi(projectId, getUserKey(), answerText);
    if (!r.ok) {
      setApplyError(r);
      setApplyState("error");
      return;
    }
    const proj = getLocalProject(projectId);
    if (!proj) {
      setApplyError({ ok: false, error: "not_found" });
      setApplyState("error");
      return;
    }
    const ext = loadExtendedProjectData(projectId);
    const applied = applyInterviewAnswer({
      answer: r.answer,
      current: {
        oneLine: ext?.productSpec?.oneLine ?? proj.description ?? "",
        requirements: proj.requirements.map((q) => ({ id: q.id, title: q.title })),
        productSpec: (ext?.productSpec ?? {}) as Record<string, unknown>,
        confirmedItemIds: ext?.intentConfirmedItemIds ?? [],
      },
      locale: loc,
    });
    // 로컬이 정본 — "맞나요?" 카드와 같은 자리에 쓴다(C0: 확정 oneLine이 다음 검수 intent).
    saveProject({
      ...proj,
      description: applied.oneLine || proj.description,
      requirements: [
        ...proj.requirements,
        ...applied.newRequirements.map((n) => ({
          id: n.id,
          title: n.title,
          status: "not_started" as const,
          category: "feature",
          priority: "must" as const,
        })),
      ],
    } as Parameters<typeof saveProject>[0]);
    saveExtendedProjectData(projectId, {
      productSpec: applied.productSpec,
      itemCriteria: {
        ...(ext?.itemCriteria ?? {}),
        ...Object.fromEntries(applied.newRequirements.map((n) => [n.id, [] as string[]])),
      },
      intentConfirmedItemIds: applied.confirmedItemIds,
      intentConfirmedAt: ext?.intentConfirmedAt ?? new Date().toISOString(),
    } as Parameters<typeof saveExtendedProjectData>[1]);
    setRead(r.answer);
    setApplyState("done");
    setRuler("building");
    // 미러 → 역추론 지시서(확인된 must) — 실패는 조용히 알리되 반영 자체는 되돌리지 않는다.
    const outcome = await mirrorThenBuildIntentRuler(projectId, loc, applied.confirmedItemIds).catch(() => "generate_failed" as const);
    setRuler(outcome === "built" ? "built" : outcome === "skipped_no_confirmed" ? "skipped" : "failed");
  }

  function errorText(e: InterviewApiError): string {
    if (e.error === "answer_unreadable") {
      if (e.reason === "empty") return c.errEmpty;
      if (e.reason === "prompt_pasted") return c.errPromptPasted;
      if (e.reason === "no_content") return c.errNoContent;
      return c.errNoFormat;
    }
    if (e.error === "answer_too_long") return c.errTooLong;
    return c.errServer;
  }

  return (
    <section className="mb-8">
      <div className="card p-5">
        <h2 className="section-title">{c.title}</h2>
        <p className="section-desc">{c.lead}</p>
        <button onClick={toggle} className="btn btn-secondary btn-sm mt-3" aria-expanded={open}>
          {open ? c.close : c.open}
        </button>

        {open && (
          <div className="mt-4 space-y-5">
            {/* 1) 질문 묶음 — 복사 버튼 + 직접 선택할 수 있는 읽기 전용 글 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-700">{c.step1}</p>
              {packState === "loading" && <p className="text-sm text-gray-500">{c.loadingPack}</p>}
              {packState === "error" && (
                <div className="text-sm text-gray-700">
                  {c.packFailed}{" "}
                  <button onClick={() => void loadPack()} className="text-brand-700 underline">
                    {c.retry}
                  </button>
                </div>
              )}
              {packState === "ready" && (
                <>
                  <textarea readOnly value={prompt} rows={8} className="input resize-y font-mono text-xs" />
                  <div className="mt-2 flex items-center gap-3">
                    <button onClick={() => void handleCopy()} className="btn btn-secondary btn-sm">
                      {c.copy}
                    </button>
                    {copied === "ok" && <span className="text-xs text-green-700">{c.copied}</span>}
                    {copied === "failed" && <span className="text-xs text-amber-700">{c.copyFailed}</span>}
                  </div>
                </>
              )}
            </div>

            {/* 2) AI의 마지막 답 붙여넣기 → 반영 */}
            <div>
              <p className="mb-2 text-sm font-semibold text-gray-700">{c.step2}</p>
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={6}
                placeholder={c.answerPlaceholder}
                className="input resize-y text-sm"
              />
              <button
                onClick={() => void handleApply()}
                disabled={!answerText.trim() || applyState === "reading"}
                className="btn btn-secondary btn-sm mt-2 disabled:opacity-50"
              >
                {applyState === "reading" ? c.applying : c.apply}
              </button>
              {applyState === "error" && applyError && <p className="mt-2 text-sm text-red-600">{errorText(applyError)}</p>}
            </div>

            {/* 3) 무엇을 읽었는지 — 못 읽은 부분은 그대로 말한다 */}
            {applyState === "done" && read && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                <p className="mb-2 font-semibold text-gray-800">{c.resultTitle}</p>
                <dl className="grid gap-2">
                  {read.intent && (
                    <div>
                      <dt className="text-xs text-gray-500">{c.intentLabel}</dt>
                      <dd className="text-gray-900">{read.intent}</dd>
                    </div>
                  )}
                  {read.must.length > 0 && (
                    <div>
                      <dt className="text-xs text-gray-500">{c.mustLabel}</dt>
                      <dd className="text-gray-900">{read.must.join(" · ")}</dd>
                    </div>
                  )}
                  {read.notNeeded.length > 0 && (
                    <div>
                      <dt className="text-xs text-gray-500">{c.notNeededLabel}</dt>
                      <dd className="text-gray-900">{read.notNeeded.join(" · ")}</dd>
                    </div>
                  )}
                  {read.differentNow.length > 0 && (
                    <div>
                      <dt className="text-xs text-gray-500">{c.differentLabel}</dt>
                      <dd className="text-gray-900">{read.differentNow.join(" · ")}</dd>
                    </div>
                  )}
                </dl>
                {read.unread.length > 0 && (
                  <p className="mt-3 text-xs text-amber-700">
                    {c.unreadLead} {read.unread.map((u) => c.unreadNames[u]).join(", ")}
                  </p>
                )}
                <p className="mt-3 text-xs text-gray-600">
                  {ruler === "building"
                    ? c.appliedBuilding
                    : ruler === "built"
                      ? c.appliedBuilt
                      : ruler === "skipped"
                        ? c.appliedNoMust
                        : ruler === "failed"
                          ? c.appliedFailed
                          : null}
                </p>
                {ruler === "built" && (
                  <Link href={`/projects/${projectId}/visual-checks`} className="mt-2 inline-block text-sm text-brand-700 underline">
                    {c.checkNow}
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
