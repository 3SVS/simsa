"use client";

/**
 * StuckHelper — G2 막힘 도우미 (docs/simsa-gap-backlog-2026-07-18.md).
 *
 * 비개발자가 만들기 도중 막혔을 때의 유일한 입구: 에러/상황을 그대로 붙여넣으면
 * 무슨 일인지(쉬운 말)와 다음 행동 1~3개를 준다. 개발 AI가 고칠 문제면 그대로
 * 붙여넣을 지시문까지. 서버 계약상 실패 시 날조 없이 오류 — UI도 정직하게
 * "지금은 못 가져왔어요"로 보여주고 재시도만 권한다.
 */
import { useState } from "react";
import { callUnstickApi, type UnstickResponse } from "@/lib/workspace-check-api";
import { getUserKey } from "@/lib/workflow-store";
import { useI18n } from "@/i18n/I18nProvider";

export function StuckHelper({
  projectId,
  productName,
  buildTool,
}: {
  projectId: string;
  productName?: string;
  buildTool?: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [advice, setAdvice] = useState<UnstickResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!text.trim() || phase === "loading") return;
    setPhase("loading");
    setErrMsg(null);
    const res = await callUnstickApi({
      problemText: text.trim(),
      projectId,
      userKey: getUserKey(),
      productName,
      buildTool,
    });
    if (!res.ok) {
      setErrMsg(res.error === "rate_limited" ? res.message : t.stuckHelper.failed);
      setPhase("error");
      return;
    }
    setAdvice(res);
    setPhase("done");
  };

  const copyAgentMessage = async () => {
    if (!advice?.askAgentMessage) return;
    try {
      await navigator.clipboard.writeText(advice.askAgentMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — text stays selectable */ }
  };

  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-gray-800 mb-1">{t.stuckHelper.title}</p>
      <p className="text-xs text-gray-500 mb-3">{t.stuckHelper.desc}</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.stuckHelper.placeholder}
        rows={4}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none font-mono"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!text.trim() || phase === "loading"}
          className="btn btn-sm btn-primary disabled:opacity-50"
        >
          {phase === "loading" ? t.stuckHelper.loading : t.stuckHelper.submit}
        </button>
        {errMsg && <span className="text-xs text-amber-700">{errMsg}</span>}
      </div>

      {phase === "done" && advice && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3">
            <p className="text-xs font-semibold text-brand-900 mb-1">{t.stuckHelper.whatHappened}</p>
            <p className="text-sm text-brand-800">{advice.whatHappened}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.stuckHelper.nextSteps}</p>
            <ol className="space-y-1.5">
              {advice.nextSteps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                  <span className="text-brand-500 font-semibold flex-shrink-0">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
          {advice.askAgentMessage && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-gray-600">{t.stuckHelper.askAgentTitle}</p>
                <button onClick={copyAgentMessage} className="text-xs font-medium text-brand-700 hover:text-brand-900">
                  {copied ? t.stuckHelper.copied : t.stuckHelper.copy}
                </button>
              </div>
              <p className="text-xs text-gray-600 whitespace-pre-wrap select-all">{advice.askAgentMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
