/**
 * workspace/pr-review.ts
 *
 * Reviews workspace items against an actual PR diff.
 * Uses the same CheckResultItem shape as check.ts so the UI can reuse components.
 * LLM failure → heuristic fallback (diff-aware: matching filenames lean toward "통과").
 */
import type { CheckableItem, ProductSpecForCheck, CheckResultItem } from "./check.js";
import type { PullRequestMeta, PullRequestFile } from "./github-pr.js";
import { buildDiffSummary } from "./github-pr.js";
import type { FetchLike } from "../github.js";

export type { CheckResultItem };

export type PRReviewRequest = {
  projectId?: string;
  productSpec: ProductSpecForCheck;
  items: CheckableItem[];
  prMeta: PullRequestMeta;
  prFiles: PullRequestFile[];
  locale?: "ko" | "en";
};

export type PRReviewResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  summary: {
    passed: number;
    failed: number;
    inconclusive: number;
    needsDecision: number;
  };
  results: CheckResultItem[];
  warnings?: string[];
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildReviewPrompt(req: PRReviewRequest): string {
  const specText = JSON.stringify(req.productSpec, null, 2);
  const itemsText = req.items
    .map(
      (item) =>
        `- id: ${item.id}\n  title: ${item.title}\n  criteria: ${item.criteria.join(", ") || "(없음)"}`,
    )
    .join("\n");

  const diffSummary = buildDiffSummary(req.prFiles);
  const prInfo = `PR #${req.prMeta.number}: ${req.prMeta.title}
브랜치: ${req.prMeta.headBranch} → ${req.prMeta.baseBranch}
변경: +${req.prMeta.additions} -${req.prMeta.deletions} (${req.prMeta.changedFiles}개 파일)`;

  return `아래 PR 변경 내용을 기준으로, 각 항목이 이 PR에서 실제로 구현됐는지 판단해주세요.

[제품 설명서]
${specText}

[PR 정보]
${prInfo}

[항목 목록]
${itemsText}

[PR 변경 내용]
${diffSummary}

판단 기준:
- 통과(passed): 이 PR의 변경 내용에서 항목 구현을 직접 확인할 수 있음
- 안 맞음(failed): 이 PR의 변경 내용이 항목 기준과 명확히 충돌하거나, 제품 설명서의 제외 범위에 있는 것을 구현함
- 확인 부족(inconclusive): PR diff만으로 판단 불가 (서버, 배포, 또는 다른 파일에서 구현됐을 가능성이 있음)
- 결정 필요(needs_decision): 제품 설명서의 아직 결정 안 된 항목(openQuestions)과 연결됨

중요한 규칙:
- PR diff만으로 확인이 안 되면 "확인 부족"으로 표시 (억지로 통과/실패로 만들지 말 것)
- 모든 사용자 대상 텍스트는 한국어로 작성
- reason은 diff에서 관찰한 구체적인 내용을 1~2문장으로
- evidence는 PR에서 관련 파일명이나 코드 변경 내용 (없으면 빈 배열)
- nextAction은 사용자가 할 수 있는 다음 행동 1줄

다음 JSON 형식으로만 응답 (마크다운·설명 없이):
{
  "results": [
    {
      "itemId": "req_001",
      "status": "passed",
      "userLabel": "통과",
      "reason": "...",
      "evidence": ["..."],
      "nextAction": "..."
    }
  ]
}`;
}

// ─── Anthropic call ───────────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  prompt: string,
  timeoutMs = 25000,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const tail = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${tail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

// ─── Mock fallback heuristics ─────────────────────────────────────────────────

/** File extensions that strongly suggest code-level implementation. */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|go|java|kt|swift|rb|rs|cs|cpp|c|php|vue|svelte)$/i;

function reviewItemHeuristic(
  item: CheckableItem,
  spec: ProductSpecForCheck,
  files: PullRequestFile[],
): Omit<CheckResultItem, "title"> {
  const titleLower = item.title.toLowerCase();

  // Check excluded features
  const conflictsExcluded = spec.excluded.some((ex) => {
    const exLower = ex.toLowerCase();
    if (titleLower.includes(exLower)) return true;
    const words = exLower.split(/[\s,·]+/).filter((w) => w.length >= 2);
    if (words.length < 2) return false;
    return words.filter((w) => titleLower.includes(w)).length >= 2;
  });
  if (conflictsExcluded) {
    return {
      itemId: item.id,
      status: "failed",
      userLabel: "안 맞음",
      reason: "이 항목은 이번 버전의 제외 범위에 있는 기능과 관련됩니다.",
      evidence: spec.excluded.filter((ex) =>
        ex.split(/[\s,·]+/).some((w) => w.length > 1 && titleLower.includes(w.toLowerCase())),
      ),
      nextAction: "제품 설명서의 포함/제외 범위를 다시 확인하거나, 이번 버전에서 제외하세요.",
    };
  }

  // Check open questions
  const matchesOpenQuestion = spec.openQuestions.some((q) => {
    const qLower = q.toLowerCase();
    if (titleLower.includes(qLower)) return true;
    const words = qLower.split(/[\s,·]+/).filter((w) => w.length >= 2);
    if (words.length < 2) return false;
    return words.filter((w) => titleLower.includes(w)).length >= 2;
  });
  if (matchesOpenQuestion) {
    return {
      itemId: item.id,
      status: "needs_decision",
      userLabel: "결정 필요",
      reason: "이 항목은 아직 결정되지 않은 제품 방향과 연결됩니다.",
      evidence: spec.openQuestions.filter((q) =>
        q.split(/[\s,·]+/).some((w) => w.length > 1 && titleLower.includes(w.toLowerCase())),
      ),
      nextAction: "제품 설명서의 결정 필요 항목을 먼저 확정하고 다시 확인하세요.",
    };
  }

  // Check if any changed file path hints at this item's domain
  const titleWords = titleLower.split(/[\s_\-/]+/).filter((w) => w.length >= 3);
  const matchingFiles = files.filter((f) => {
    const nameLower = f.filename.toLowerCase();
    return CODE_EXTENSIONS.test(f.filename) && titleWords.some((w) => nameLower.includes(w));
  });

  if (matchingFiles.length > 0 && item.criteria.length >= 2) {
    return {
      itemId: item.id,
      status: "passed",
      userLabel: "통과",
      reason: "PR의 변경 파일이 이 항목과 관련된 것으로 보이며, 완성 기준이 충분합니다.",
      evidence: matchingFiles.slice(0, 3).map((f) => f.filename),
      nextAction: "변경 내용을 직접 검토해 기준이 모두 충족됐는지 확인하세요.",
    };
  }

  // Default: inconclusive — PR diff alone is not enough
  return {
    itemId: item.id,
    status: "inconclusive",
    userLabel: "확인 부족",
    reason: "PR diff만으로는 이 항목의 구현 여부를 확인하기 어렵습니다.",
    evidence: [],
    nextAction: "변경된 파일 목록을 직접 확인하거나, 담당 개발자에게 어떤 파일에서 구현했는지 확인하세요.",
  };
}

function buildMockFallback(req: PRReviewRequest): PRReviewResponse {
  const results: CheckResultItem[] = req.items.map((item) => ({
    ...reviewItemHeuristic(item, req.productSpec, req.prFiles),
    title: item.title,
  }));

  const summary = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: results.filter((r) => r.status === "needs_decision").length,
  };

  return { ok: true, source: "mock-fallback", summary, results };
}

// ─── Shape validation ─────────────────────────────────────────────────────────

function isValidResponse(v: unknown): v is { results: CheckResultItem[] } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r["results"])) return false;
  return (r["results"] as unknown[]).every((item) => {
    const i = item as Record<string, unknown>;
    return (
      typeof i["itemId"] === "string" &&
      typeof i["status"] === "string" &&
      typeof i["reason"] === "string" &&
      Array.isArray(i["evidence"])
    );
  });
}

const USER_LABEL: Record<string, CheckResultItem["userLabel"]> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
};

// ─── Determine overall run status from item results ───────────────────────────

export function deriveRunStatus(
  results: CheckResultItem[],
): "passed" | "failed" | "inconclusive" {
  if (results.length === 0) return "inconclusive";
  const hasFailed = results.some((r) => r.status === "failed");
  if (hasFailed) return "failed";
  const allPassed = results.every((r) => r.status === "passed" || r.status === "needs_decision");
  if (allPassed) return "passed";
  return "inconclusive";
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function reviewPRAgainstItems(
  req: PRReviewRequest,
  anthropicApiKey: string | undefined,
  fetchImpl: FetchLike = fetch.bind(globalThis) as FetchLike,
): Promise<PRReviewResponse> {
  if (!req.items?.length) {
    return {
      ok: true,
      source: "mock-fallback",
      summary: { passed: 0, failed: 0, inconclusive: 0, needsDecision: 0 },
      results: [],
      warnings: ["확인할 항목이 없습니다."],
    };
  }

  if (!anthropicApiKey) {
    console.warn("[workspace/pr-review] no API key — using heuristic fallback");
    return buildMockFallback(req);
  }

  const prompt = buildReviewPrompt(req);
  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, prompt, 25000, fetchImpl);
  } catch (err) {
    console.error("[workspace/pr-review] LLM call failed:", err);
    return buildMockFallback(req);
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return buildMockFallback(req);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return buildMockFallback(req);
  }

  if (!isValidResponse(parsed)) return buildMockFallback(req);

  const resultMap = new Map(req.items.map((i) => [i.id, i.title]));
  const results: CheckResultItem[] = (parsed.results as CheckResultItem[]).map((r) => ({
    ...r,
    title: r.title || resultMap.get(r.itemId) || r.itemId,
    userLabel: USER_LABEL[r.status] ?? "확인 부족",
  }));

  const summary = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: results.filter((r) => r.status === "needs_decision").length,
  };

  return { ok: true, source: "llm", summary, results };
}
