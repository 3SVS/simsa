"use client";

/**
 * ClientErrorReporter — G12 (docs/simsa-gap-backlog-2026-07-18.md).
 *
 * 비개발자는 오류를 신고하지 않고 조용히 떠난다. 전역 error/unhandledrejection을
 * fire-and-forget으로 central에 흘려 보이게 만든다. 결정 로직(캡·중복·노이즈)은
 * lib/client-error-report.mjs(순수·테스트 고정), 이 컴포넌트는 배선만.
 * 어떤 실패도 사용자 화면에 새 오류를 만들지 않는다.
 */
import { useEffect } from "react";
import { shouldReportClientError } from "@/lib/client-error-report.mjs";
import { getUserKey } from "@/lib/workflow-store";

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

const state = { sentCount: 0, seenMessages: new Set<string>() };

function report(message: string, stack?: string) {
  if (!shouldReportClientError({ message }, state)) return;
  state.sentCount += 1;
  state.seenMessages.add(message.trim());
  try {
    void fetch(`${CENTRAL_PLANE_URL}/workspace/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        stack,
        path: window.location.pathname,
        userKey: getUserKey(),
        userAgent: navigator.userAgent,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never surface */
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      report(e.message ?? "unknown error", e.error instanceof Error ? e.error.stack : undefined);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(
        r instanceof Error ? r.message : `unhandledrejection: ${String(r).slice(0, 300)}`,
        r instanceof Error ? r.stack : undefined,
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
