/**
 * interview-pack-api.ts — C-A7 인터뷰 프롬프트 팩 클라이언트.
 *
 *   POST /workspace/projects/:id/interview-pack   → 유저가 자기 AI 채팅에 붙여넣을 텍스트
 *   POST /workspace/projects/:id/interview-answer → 붙여넣은 답을 고정 양식으로 회수(저장 안 함)
 *
 * 실패는 종류를 살려 돌려준다 — 화면이 "다시 시도"와 "이 부분은 읽지 못했어요"를 구분해 말한다.
 */
import { CENTRAL_PLANE_URL } from "./workspace-sources-api";
import type { InterviewAnswer } from "./interview-apply.mjs";

export type InterviewPackOk = { ok: true; prompt: string; featureCount: number; unconfirmedCount: number };
export type InterviewAnswerUnreadable = "empty" | "prompt_pasted" | "no_format" | "no_content";
export type InterviewApiError =
  | { ok: false; error: "not_found" }
  | { ok: false; error: "answer_too_long" }
  | { ok: false; error: "answer_unreadable"; reason: InterviewAnswerUnreadable }
  | { ok: false; error: "server"; status: number }
  | { ok: false; error: "network" };

export type InterviewAnswerOk = {
  ok: true;
  answer: Omit<InterviewAnswer, "unread"> & { unread: Array<"intent" | "must" | "notNeeded" | "differentNow">; ignoredLines: number };
};

const UNREADABLE = new Set<InterviewAnswerUnreadable>(["empty", "prompt_pasted", "no_format", "no_content"]);

export async function fetchInterviewPack(
  projectId: string,
  userKey: string,
  locale: "ko" | "en",
  confirmedItemIds: readonly string[] = [],
): Promise<InterviewPackOk | InterviewApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/interview-pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, locale, confirmedItemIds: [...confirmedItemIds].slice(0, 60) }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body["ok"] === true && typeof body["prompt"] === "string") {
      return {
        ok: true,
        prompt: body["prompt"],
        featureCount: Number(body["featureCount"] ?? 0),
        unconfirmedCount: Number(body["unconfirmedCount"] ?? 0),
      };
    }
    if (resp.status === 404) return { ok: false, error: "not_found" };
    return { ok: false, error: "server", status: resp.status };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function parseInterviewAnswerApi(
  projectId: string,
  userKey: string,
  answer: string,
): Promise<InterviewAnswerOk | InterviewApiError> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/interview-answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey, answer }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body["ok"] === true && body["answer"] && typeof body["answer"] === "object") {
      return { ok: true, answer: body["answer"] as InterviewAnswerOk["answer"] };
    }
    if (resp.status === 404) return { ok: false, error: "not_found" };
    if (resp.status === 400 && body["error"] === "answer_too_long") return { ok: false, error: "answer_too_long" };
    if (resp.status === 422) {
      const reason = body["reason"] as InterviewAnswerUnreadable;
      return { ok: false, error: "answer_unreadable", reason: UNREADABLE.has(reason) ? reason : "no_format" };
    }
    return { ok: false, error: "server", status: resp.status };
  } catch {
    return { ok: false, error: "network" };
  }
}
