/**
 * Dashboard-side API client for the central-plane workspace endpoint.
 *
 * Failure modes handled:
 *   - 429 rate limit      → { ok: false, error: "rate_limited", retryAfterSeconds }
 *                           NO mock fallback (intentional — rate limit is a billing control)
 *   - Network / timeout   → local mock fallback
 *   - LLM 5xx from server → local mock fallback (server already fell back)
 *   - ok: false from API  → local mock fallback
 */

import type { IdeaToSpecDraftResponse } from "./workspace-types";
import {
  generateUnderstanding,
  generateQuestions,
  generateSpec,
  generateRequirements,
} from "./mock-generators";

export type { IdeaToSpecDraftResponse };

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

export type WorkspaceApiInput = {
  idea: string;
  answers?: Array<{ questionId: string; answer: string }>;
  /** "Anything else Simsa should know" — extra context beyond the one-line idea. */
  context?: string;
  /** Questions the user marked "not right for my case", with the reason, so the
   *  next generation steers away instead of the user rewriting the whole idea. */
  rejectedQuestions?: Array<{ question: string; reason: string }>;
  /** #296 Phase 2: the onboarding interview's platform answer — explicit user
   *  intent that seeds the server's feasibility verdict. */
  platform?: "web" | "mobile" | "unknown";
};

/** Rate limit hit — no fallback, show gentle notice to user */
export type RateLimitedResult = {
  ok: false;
  error: "rate_limited";
  message: string;
  retryAfterSeconds?: number;
};

/** Network / LLM error — fallback to local mock */
export type FallbackResult = {
  ok: false;
  error: "network" | "server";
  fallback: IdeaToSpecDraftResponse;
};

export type WorkspaceApiResult =
  | { ok: true; data: IdeaToSpecDraftResponse }
  | RateLimitedResult
  | FallbackResult;

export async function callWorkspaceApi(
  input: WorkspaceApiInput,
): Promise<WorkspaceApiResult> {
  const url = `${CENTRAL_PLANE_URL}/workspace/idea-to-spec-draft`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: input.idea,
        answers: input.answers ?? [],
        locale: "ko",
        mode: "standard",
        ...(input.context?.trim() ? { context: input.context.trim() } : {}),
        ...(input.rejectedQuestions?.length ? { rejectedQuestions: input.rejectedQuestions } : {}),
      }),
      signal: AbortSignal.timeout(150000), // document-scale drafts (up to 80k chars) take a while
    });
  } catch (err) {
    console.warn("[workspace-api] network error, using mock fallback:", err);
    return { ok: false, error: "network", fallback: buildLocalFallback(input) };
  }

  // ── 429 rate limited — do NOT fall back to mock ───────────────────────────
  if (resp.status === 429) {
    let retryAfterSeconds: number | undefined;
    let message = "잠시 후 다시 시도해주세요. 짧은 시간에 제품 설명서 만들기 요청이 많이 발생했어요.";
    try {
      const body = (await resp.json()) as {
        message?: string;
        retryAfterSeconds?: number;
      };
      if (body.message) message = body.message;
      if (body.retryAfterSeconds) retryAfterSeconds = body.retryAfterSeconds;
    } catch {
      // ignore parse errors, use default message
    }
    return { ok: false, error: "rate_limited", message, retryAfterSeconds };
  }

  // ── Other non-2xx ─────────────────────────────────────────────────────────
  if (!resp.ok) {
    console.warn("[workspace-api] server error", resp.status, "using mock fallback");
    return { ok: false, error: "server", fallback: buildLocalFallback(input) };
  }

  // ── Parse success response ────────────────────────────────────────────────
  let data: IdeaToSpecDraftResponse;
  try {
    data = (await resp.json()) as IdeaToSpecDraftResponse;
  } catch {
    console.warn("[workspace-api] JSON parse failed, using mock fallback");
    return { ok: false, error: "server", fallback: buildLocalFallback(input) };
  }

  if (!data.ok) {
    console.warn("[workspace-api] server returned ok:false, using mock fallback");
    return { ok: false, error: "server", fallback: buildLocalFallback(input) };
  }

  return { ok: true, data };
}

// ─── C2: recommend an answer for one open decision ────────────────────────────

export type RecommendAnswerInput = {
  question: string;
  productName?: string;
  oneLine?: string;
  targetUsers?: string[];
  projectId?: string;
  userKey?: string;
};

/**
 * Honest by contract (Bae ②): there is NO mock fallback. A rate limit surfaces
 * its own notice; every other failure (503 llm_unavailable, network, bad body)
 * collapses to { ok:false, error:"llm_unavailable" } so the card shows
 * "추천을 못 가져왔어요, 다시 시도" — never a fabricated default.
 */
export type RecommendAnswerResult =
  | { ok: true; recommendation: string; reason: string; options: string[] }
  | { ok: false; error: "rate_limited"; message: string; retryAfterSeconds?: number }
  | { ok: false; error: "llm_unavailable" };

export async function recommendAnswer(
  input: RecommendAnswerInput,
): Promise<RecommendAnswerResult> {
  const url = `${CENTRAL_PLANE_URL}/workspace/recommend-answer`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: input.question,
        productName: input.productName,
        oneLine: input.oneLine,
        targetUsers: input.targetUsers,
        projectId: input.projectId,
        userKey: input.userKey,
        locale: "ko",
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    console.warn("[workspace-api] recommend-answer network error:", err);
    return { ok: false, error: "llm_unavailable" };
  }

  if (resp.status === 429) {
    let retryAfterSeconds: number | undefined;
    let message = "잠시 후 다시 시도해주세요. 요청이 많이 발생했어요.";
    try {
      const body = (await resp.json()) as { message?: string; retryAfterSeconds?: number };
      if (body.message) message = body.message;
      if (body.retryAfterSeconds) retryAfterSeconds = body.retryAfterSeconds;
    } catch { /* use default */ }
    return { ok: false, error: "rate_limited", message, retryAfterSeconds };
  }

  if (!resp.ok) {
    // 503 llm_unavailable or any other server error → honest, no fabrication.
    return { ok: false, error: "llm_unavailable" };
  }

  try {
    const data = (await resp.json()) as {
      ok?: boolean;
      recommendation?: string;
      reason?: string;
      options?: string[];
    };
    if (!data.ok || typeof data.recommendation !== "string" || data.recommendation.trim().length === 0) {
      return { ok: false, error: "llm_unavailable" };
    }
    return {
      ok: true,
      recommendation: data.recommendation,
      reason: typeof data.reason === "string" ? data.reason : "",
      options: Array.isArray(data.options) ? data.options.filter((o): o is string => typeof o === "string") : [],
    };
  } catch {
    return { ok: false, error: "llm_unavailable" };
  }
}

// ─── Local mock fallback ──────────────────────────────────────────────────────

function buildLocalFallback(input: WorkspaceApiInput): IdeaToSpecDraftResponse {
  const answersMap: Record<string, string> = Object.fromEntries(
    (input.answers ?? []).map((a) => [a.questionId, a.answer]),
  );

  const understood = generateUnderstanding(input.idea);
  const questions = generateQuestions(input.idea);
  const spec = generateSpec(input.idea, answersMap);
  const reqs = generateRequirements(input.idea, answersMap);

  return {
    ok: true,
    source: "mock-fallback",
    understood,
    questions: questions.map((q) => ({
      id: q.id,
      question: q.question,
      recommendation: q.recommendation,
      reason: q.recommendationReason,
      options: q.options.map((o) => o.label),
      allowCustom: true,
      allowLater: true,
    })),
    productSpec: {
      productName: spec.productName,
      oneLine: spec.tagline,
      targetUsers: [spec.targetUser],
      problem: spec.problem,
      included: spec.included,
      excluded: spec.excluded,
      userFlow: spec.userFlows,
      decisions: spec.decisions,
      openQuestions: spec.openDecisions,
    },
    items: reqs.map((r) => ({
      id: r.id,
      title: r.title,
      status: "not_started",
      criteria: [],
    })),
    warnings: ["임시 초안으로 보여드리고 있어요. 다시 시도하면 더 맞춤형으로 만들 수 있습니다."],
  };
}
