"use client";

/**
 * TakeSpecButton — "지시서 받아가기" (B-8 · PR #578 검증 결함 4).
 *
 * 라벨이 "지시서 받아가기"면 받는 것은 **지시서**다. 종전엔 빌더 팩 화면(export)으로 보냈고, 그 화면의 첫 질문은
 * "어떤 개발 AI용으로 받으시겠어요?"(Claude Code·Codex·Lovable·v0·Bolt)였다 — 멈춘 만들기의 복구 동선에 개발 도구
 * 고르기가 들어왔다. 이제 **그 자리에서** 지시서 문서 하나(.md)를 받는다. 문서는 서버의 지시서 렌더러가 만든 것
 * 그대로(빌더 팩 응답의 dev-spec/ 파일 — handoff 대상, LLM 없음·결정론), 대시보드는 고르고 이어 붙이기만 한다
 * (devSpecDocument). 모달 없음 — 결과는 버튼 아래 한 줄.
 */
import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { callExportBuilderPackApi } from "@/lib/workspace-export-api";
import { devSpecDocument } from "@/lib/build-job-view.mjs";
import { getUserKey } from "@/lib/workflow-store";

type Phase = "idle" | "working" | "done" | "error";

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 바로 해제하면 일부 브라우저가 받기를 끊는다 — 잠시 뒤에.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TakeSpecButton({
  projectId,
  title,
  variant = "secondary",
}: {
  projectId: string;
  title: string;
  /** primary/secondary: a button in an action row · inline: an underlined link-style button inside a notice. */
  variant?: "primary" | "secondary" | "inline";
}) {
  const { t, locale } = useI18n();
  const mk = t.makeApp;
  const [phase, setPhase] = useState<Phase>("idle");

  async function take() {
    if (phase === "working") return;
    setPhase("working");
    const res = await callExportBuilderPackApi({ projectId, userKey: getUserKey(), target: "handoff" });
    const files = res.ok && Array.isArray(res.bundle?.files) ? res.bundle.files : null;
    const doc = files ? devSpecDocument(files, { title, locale: locale === "en" ? "en" : "ko" }) : null;
    if (!doc) {
      setPhase("error");
      return;
    }
    downloadText(doc.filename, doc.content);
    setPhase("done");
  }

  const label = phase === "working" ? mk.takeSpecWorking : mk.takeSpec;
  const button =
    variant === "inline" ? (
      <button type="button" onClick={take} disabled={phase === "working"} className="underline disabled:opacity-50">
        {label}
      </button>
    ) : (
      <button
        type="button"
        onClick={take}
        disabled={phase === "working"}
        className={`btn btn-md ${variant === "primary" ? "btn-primary" : "btn-secondary"} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {label}
      </button>
    );

  // 한 줄 안내는 행동 줄(flex)의 맨 끝 줄로(order-last) — 버튼 사이에 끼어 [다시 시도]를 아래로 밀지 않게.
  return (
    <>
      {button}
      {phase === "done" && (
        <p role="status" className="order-last basis-full text-xs text-gray-600">
          {mk.takeSpecDone}
        </p>
      )}
      {phase === "error" && (
        <p role="status" className="order-last basis-full text-xs text-red-700">
          {mk.takeSpecError}{" "}
          <Link href={`/projects/${encodeURIComponent(projectId)}/dev-spec`} className="underline">
            {mk.takeSpecErrorLink}
          </Link>
        </p>
      )}
    </>
  );
}
