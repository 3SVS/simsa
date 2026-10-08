"use client";

/**
 * BuilderSelfReportPanel — "만든 AI에게 물어보기"(2026-10-09). 질문 복사 → 답 붙여 넣기 → 서버가 비밀을 지우고 구조로 정리.
 * 정리된 설명은 이 브라우저에만 두고 다음 확인에 실린다(검사 엔진 v2의 가설 — 증거가 아니다).
 * 핵심 흐름 후보는 **체크 해제로 시작**한다(2026-10-06 Bae 결정과 같은 규칙) — 체크한 것만 "꼭 되어야 하는 것"이 된다.
 */
import { useState } from "react";
import { CENTRAL_PLANE_URL } from "@/lib/workspace-sources-api";
import { BSR_COPY, BUILDER_SELF_REPORT_PROMPT, saveBuilderReport } from "@/lib/builder-self-report.mjs";

type Report = { intent: string; mustFlows: string[]; claims: Array<{ id: string; kind: string; text: string }>; access: { loginMethod: string; testAccountHow: string } };

export function BuilderSelfReportPanel({
  projectId,
  locale,
  checkedFlows,
  onCheckedFlowsChange,
}: {
  projectId: string;
  locale: "ko" | "en";
  checkedFlows: string[];
  onCheckedFlowsChange: (flows: string[]) => void;
}) {
  const c = BSR_COPY[locale];
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState<string>("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(BUILDER_SELF_REPORT_PROMPT[locale]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function parse() {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch(`${CENTRAL_PLANE_URL}/workspace/builder-self-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: answer, locale }),
        signal: AbortSignal.timeout(45000),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; report?: Report; removedSecrets?: number } | null;
      if (j?.ok && j.report) {
        setReport(j.report);
        saveBuilderReport(projectId, j.report);
        // 붙여 넣은 원문(비밀이 섞였을 수 있다)은 정리 뒤 화면에서도 지운다.
        setAnswer("");
        setNotice(j.removedSecrets ? c.removed(j.removedSecrets) : "");
      } else {
        setNotice(j?.error === "empty" ? c.empty : c.failed);
      }
    } catch {
      setNotice(c.failed);
    } finally {
      setBusy(false);
    }
  }

  function toggle(flow: string) {
    onCheckedFlowsChange(checkedFlows.includes(flow) ? checkedFlows.filter((f) => f !== flow) : [...checkedFlows, flow]);
  }

  return (
    <div className="mt-4 rounded-md border border-stone-200 p-3">
      <button type="button" onClick={() => setOpen(!open)} className="text-xs font-semibold text-gray-700" aria-expanded={open}>
        {open ? "▾" : "▸"} {c.title}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-500">{c.intro}</p>
          <pre className="whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs text-gray-700">{BUILDER_SELF_REPORT_PROMPT[locale]}</pre>
          <button type="button" onClick={copy} className="btn btn-secondary btn-sm">
            {copied ? c.copied : c.copy}
          </button>
          {!report && (
            <>
              <label htmlFor="bsr-answer" className="block text-xs font-semibold text-gray-600">{c.answerLabel}</label>
              <textarea id="bsr-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} className="input resize-y" />
              <button type="button" onClick={parse} disabled={busy || answer.trim().length < 20} className="btn btn-secondary btn-sm disabled:opacity-50">
                {busy ? c.parsing : c.parse}
              </button>
            </>
          )}
          {notice && <p className="text-xs text-gray-500">{notice}</p>}
          {report && (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                <span className="font-semibold">{c.understood}:</span> {report.intent}
              </p>
              <p className="text-xs text-gray-500">{c.claims(report.claims.length)}</p>
              {report.mustFlows.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">{c.flowsLabel}</p>
                  <ul className="space-y-1">
                    {report.mustFlows.map((f) => (
                      <li key={f}>
                        <label className="flex items-start gap-2 text-xs text-gray-700">
                          <input type="checkbox" checked={checkedFlows.includes(f)} onChange={() => toggle(f)} />
                          <span>{f}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
