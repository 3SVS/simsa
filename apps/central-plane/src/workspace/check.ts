/**
 * workspace/check.ts
 *
 * Checks a product spec + items for completeness and internal consistency.
 * This is NOT a code review — it checks the spec document only.
 * LLM failure → deterministic mock fallback via heuristics.
 */
import { anthropicMessages, anthropicEndpoint, type VendorFallback } from "./anthropic-fetch.js";

export type CheckableItem = {
  id: string;
  title: string;
  status: string;
  criteria: string[];
};

export type ProductSpecForCheck = {
  productName: string;
  oneLine: string;
  targetUsers: string[];
  problem: string;
  included: string[];
  excluded: string[];
  userFlow: string[];
  decisions: string[];
  openQuestions: string[];
};

/**
 * Coerce an untrusted/partial product spec (from an HTTP body or a D1 row that may
 * predate the current shape) into a complete ProductSpecForCheck. The review/check
 * heuristics call `.some()` / `.length` on the array fields, so a missing field would
 * throw an opaque "Cannot read properties of undefined (reading 'some')". Default every
 * field instead of trusting an `as` cast at the boundary.
 */
export function normalizeProductSpec(raw: unknown): ProductSpecForCheck {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    productName: str(s["productName"]),
    oneLine: str(s["oneLine"]),
    targetUsers: strArr(s["targetUsers"]),
    problem: str(s["problem"]),
    included: strArr(s["included"]),
    excluded: strArr(s["excluded"]),
    userFlow: strArr(s["userFlow"]),
    decisions: strArr(s["decisions"]),
    openQuestions: strArr(s["openQuestions"]),
  };
}

/**
 * Coerce an untrusted/partial items array into CheckableItem[]. `criteria` is read with
 * `.length` by the heuristics, so it must always be an array; drop entries without an id.
 */
export function normalizeCheckableItems(raw: unknown): CheckableItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: typeof x["id"] === "string" ? x["id"] : "",
      title: typeof x["title"] === "string" ? x["title"] : "",
      status: typeof x["status"] === "string" ? x["status"] : "not_started",
      criteria: Array.isArray(x["criteria"])
        ? x["criteria"].filter((c): c is string => typeof c === "string")
        : [],
    }))
    .filter((x) => x.id.length > 0);
}

export type CheckItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

export type CheckResultItem = {
  itemId: string;
  status: CheckItemStatus;
  title: string;
  userLabel: "통과" | "안 맞음" | "확인 부족" | "결정 필요";
  reason: string;
  evidence: string[];
  nextAction: string;
  /** RC-2 검증 패널 / RC-3 협의체: 판정의 확인 방식. 미실행 판정에는 없음. */
  verification?: "dual_confirmed" | "downgraded" | "single" | "council_agreed" | "council_split";
};

export type WorkspaceCheckDraftRequest = {
  projectId?: string;
  productSpec: ProductSpecForCheck;
  items: CheckableItem[];
  locale?: "ko" | "en";
};

export type WorkspaceCheckDraftResponse = {
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
  /** RC-3/RC-4: 이 결과를 만든 검수 방식. 생략 = panel(기본). */
  reviewMode?: "panel" | "council";
  /** RC-3 협의체 메타 — 어떤 벤더 몇 명이 몇 라운드를 거쳤는지 투명하게. */
  council?: { vendors: string[]; rounds: number; disagreements: number };
};

const USER_LABEL: Record<CheckItemStatus, CheckResultItem["userLabel"]> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

export function buildCheckPrompt(req: WorkspaceCheckDraftRequest): string {
  const specText = JSON.stringify(req.productSpec, null, 2);
  const none = req.locale === "en" ? "(none)" : "(없음)";
  const itemsText = req.items
    .map(
      (item) =>
        `- id: ${item.id}\n  title: ${item.title}\n  criteria: ${item.criteria.join(", ") || none}`,
    )
    .join("\n");

  // G14-b: the prompt follows the user's UI language — an EN user must never
  // receive Korean verdict prose. locale is absent on legacy callers → ko.
  if (req.locale === "en") {
    return `Review the product spec and the must-have items below, and judge each item's status.

[Product spec]
${specText}

[Items]
${itemsText}

Judgment criteria:
- passed: the item is specific, has 2 or more done-criteria, and matches the spec's included scope
- failed: the item falls in the spec's excluded scope, or conflicts with a decided direction
- inconclusive: the item looks important but its done-criteria are missing or vague (also when "permissions", "data", or "failure handling" is not covered)
- needs_decision: the item is directly tied to one of the spec's undecided questions (openQuestions)

Rules:
- Write ALL user-facing text in English
- reason: 1–2 sentences, specific
- evidence: sentences quoted from the product spec (empty array if none)
- nextAction: one line the user can act on

Respond ONLY with JSON in this shape (no markdown, no prose):
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

  return `제품 설명서와 꼭 들어가야 할 항목들을 검토해서 각 항목의 상태를 판단해주세요.

[제품 설명서]
${specText}

[항목 목록]
${itemsText}

판단 기준:
- 통과(passed): 항목이 구체적이고, 완성 기준이 2개 이상이며, 제품 설명서의 포함 범위와 일치함
- 안 맞음(failed): 항목이 제품 설명서의 제외 범위에 있거나, 결정된 내용과 충돌함
- 확인 부족(inconclusive): 항목은 중요해 보이나 완성 기준이 없거나 추상적임 (단, "권한", "데이터", "실패 처리"가 빠진 경우도 포함)
- 결정 필요(needs_decision): 제품 설명서의 아직 결정 안 된 항목(openQuestions)과 직접 연결되는 항목임

규칙:
- 모든 사용자 대상 텍스트는 한국어로 작성
- reason은 1~2문장, 구체적으로
- evidence는 근거가 되는 제품 설명서 내 문장 (없으면 빈 배열)
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

async function callAnthropic(apiKey: string, prompt: string, baseUrl: string | undefined, timeoutMs = 20000, fallback?: VendorFallback): Promise<string> {
  const data = (await anthropicMessages(
    apiKey,
    { model: "claude-haiku-4-5-20251001", max_tokens: 4000, messages: [{ role: "user", content: prompt }] },
    timeoutMs,
    undefined,
    anthropicEndpoint(baseUrl),
    "check",
    { fallback },
  )) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
}

// ─── Mock fallback heuristics ─────────────────────────────────────────────────

/** G14-b: heuristic fallback prose per locale — the fallback path must match the
 *  user's language just like the LLM path (userLabel stays the KO wire literal;
 *  the dashboard localizes its display via statusLabel). */
const HEURISTIC_COPY = {
  ko: {
    excludedReason: "이 항목은 이번 버전의 제외 범위에 있는 기능과 관련됩니다.",
    excludedNext: "제품 설명서의 포함/제외 범위를 다시 확인하거나, 이번 버전에서 제외하세요.",
    openQReason: "이 항목은 아직 결정되지 않은 제품 방향과 연결됩니다.",
    openQNext: "제품 설명서의 결정 필요 항목을 먼저 확정하고 다시 확인하세요.",
    noCriteriaReason: "완성 기준이 없어서 실제로 구현이 됐는지 확인하기 어렵습니다.",
    noCriteriaNext: "완성 기준을 2개 이상 구체적으로 추가하세요.",
    oneCriterionReason: "완성 기준이 1개뿐입니다. 확인 가능한 기준이 더 필요합니다.",
    oneCriterionNext: "완성 기준을 최소 2개로 늘리고, 권한·데이터·실패 상황도 포함해 주세요.",
    securityReason: "권한이나 데이터 보안과 관련된 항목인데 완성 기준이 부족합니다.",
    securityNext: "접근 제어 조건과 비정상 접근 시 동작을 완성 기준에 추가하세요.",
    passedReason: "항목이 구체적이고 완성 기준이 충분합니다.",
    passedNext: "다음 단계에서 실제 구현 후 검증하세요.",
    noItemsWarning: "확인할 항목이 없습니다.",
  },
  en: {
    excludedReason: "This item relates to a feature that is in this version's excluded scope.",
    excludedNext: "Re-check the spec's included/excluded scope, or drop this item from this version.",
    openQReason: "This item is tied to a product direction that has not been decided yet.",
    openQNext: "Settle the spec's open decisions first, then run the check again.",
    noCriteriaReason: "There are no done-criteria, so it is hard to confirm this was actually built.",
    noCriteriaNext: "Add at least 2 specific done-criteria.",
    oneCriterionReason: "There is only one done-criterion. More checkable criteria are needed.",
    oneCriterionNext: "Grow the done-criteria to at least 2, covering permissions, data, and failure cases.",
    securityReason: "This item involves permissions or data safety, but its done-criteria are too thin.",
    securityNext: "Add access-control conditions and what happens on unauthorized access to the criteria.",
    passedReason: "The item is specific and its done-criteria are sufficient.",
    passedNext: "Verify it against the real build in the next step.",
    noItemsWarning: "There are no items to check.",
  },
} as const;

function checkItemHeuristic(
  item: CheckableItem,
  spec: ProductSpecForCheck,
  locale: "ko" | "en",
): Omit<CheckResultItem, "title"> {
  const copy = HEURISTIC_COPY[locale];
  const titleLower = item.title.toLowerCase();

  // Check excluded features — require full phrase OR ≥2 content words to match
  // to avoid false positives from common nouns appearing in unrelated items.
  // Partial client specs ({} from the QA/code-branch path) crashed here with
  // "Cannot read properties of undefined (reading 'some')" — normalize first.
  const specExcluded = Array.isArray(spec.excluded) ? spec.excluded : [];
  const specOpenQuestions = Array.isArray(spec.openQuestions) ? spec.openQuestions : [];
  const conflictsExcluded = specExcluded.some((ex) => {
    const exLower = ex.toLowerCase();
    if (titleLower.includes(exLower)) return true; // full phrase match
    const words = exLower.split(/[\s,·]+/).filter((w) => w.length >= 2);
    if (words.length < 2) return false; // too short to risk single-word match
    const matchCount = words.filter((w) => titleLower.includes(w)).length;
    return matchCount >= 2;
  });
  if (conflictsExcluded) {
    return {
      itemId: item.id,
      status: "failed",
      userLabel: "안 맞음",
      reason: copy.excludedReason,
      evidence: spec.excluded.filter((ex) =>
        ex.split(/[\s,·]+/).some((w) => w.length > 1 && titleLower.includes(w.toLowerCase())),
      ),
      nextAction: copy.excludedNext,
    };
  }

  // Check open questions — same 2-word minimum to avoid generic word false positives
  const matchesOpenQuestion = specOpenQuestions.some((q) => {
    const qLower = q.toLowerCase();
    if (titleLower.includes(qLower)) return true;
    const words = qLower.split(/[\s,·]+/).filter((w) => w.length >= 2);
    if (words.length < 2) return false;
    const matchCount = words.filter((w) => titleLower.includes(w)).length;
    return matchCount >= 2;
  });
  if (matchesOpenQuestion) {
    return {
      itemId: item.id,
      status: "needs_decision",
      userLabel: "결정 필요",
      reason: copy.openQReason,
      evidence: spec.openQuestions.filter((q) =>
        q.split(/[\s,·]+/).some((w) => w.length > 1 && titleLower.includes(w.toLowerCase())),
      ),
      nextAction: copy.openQNext,
    };
  }

  // Check criteria completeness
  if (item.criteria.length === 0) {
    return {
      itemId: item.id,
      status: "inconclusive",
      userLabel: "확인 부족",
      reason: copy.noCriteriaReason,
      evidence: [],
      nextAction: copy.noCriteriaNext,
    };
  }
  if (item.criteria.length === 1) {
    return {
      itemId: item.id,
      status: "inconclusive",
      userLabel: "확인 부족",
      reason: copy.oneCriterionReason,
      evidence: [],
      nextAction: copy.oneCriterionNext,
    };
  }

  // Check if permissions/data/failure are covered for critical items
  // (EN titles need EN keywords — the KO-only regex silently skipped this rule
  //  for English items.)
  const needsSecurityCheck =
    /사용자|권한|접근|개인|로그인|user|permission|access|login|account|privacy|private/.test(titleLower) &&
    item.criteria.length < 3;
  if (needsSecurityCheck) {
    return {
      itemId: item.id,
      status: "inconclusive",
      userLabel: "확인 부족",
      reason: copy.securityReason,
      evidence: [],
      nextAction: copy.securityNext,
    };
  }

  // Passed
  const relatedDecision = spec.decisions.find((d) => {
    const dLower = d.toLowerCase();
    return titleLower.split(/\s+/).some((w) => w.length > 1 && dLower.includes(w));
  });
  return {
    itemId: item.id,
    status: "passed",
    userLabel: "통과",
    reason: copy.passedReason,
    evidence: relatedDecision ? [relatedDecision] : [],
    nextAction: copy.passedNext,
  };
}

function buildMockCheckFallback(req: WorkspaceCheckDraftRequest): WorkspaceCheckDraftResponse {
  const results: CheckResultItem[] = req.items.map((item) => ({
    ...checkItemHeuristic(item, req.productSpec, req.locale === "en" ? "en" : "ko"),
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

function isValidCheckResponse(v: unknown): v is { results: CheckResultItem[] } {
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

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function generateCheckDraft(
  req: WorkspaceCheckDraftRequest,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
  /** 벤더 폴백(Anthropic 차단 시 OpenAI) — 라우트가 env에서 전달. */
  fallback?: VendorFallback,
): Promise<WorkspaceCheckDraftResponse | { ok: false; error: "llm_unavailable" }> {
  if (!req.items?.length) {
    return {
      ok: true,
      source: "mock-fallback",
      summary: { passed: 0, failed: 0, inconclusive: 0, needsDecision: 0 },
      results: [],
      warnings: [HEURISTIC_COPY[req.locale === "en" ? "en" : "ko"].noItemsWarning],
    };
  }

  if (!anthropicApiKey) {
    console.warn("[workspace/check] no API key — using heuristic fallback");
    return buildMockCheckFallback(req);
  }

  const prompt = buildCheckPrompt(req);
  let rawText = "";
  try {
    rawText = await callAnthropic(anthropicApiKey, prompt, anthropicBaseUrl, undefined, fallback);
  } catch (err) {
    console.error("[workspace/check] LLM call failed:", err);
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[workspace/check] LLM returned non-JSON. head:", rawText.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  if (!isValidCheckResponse(parsed)) {
    console.warn("[workspace/check] response failed shape validation");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  const resultMap = new Map(req.items.map((i) => [i.id, i.title]));
  const results: CheckResultItem[] = (parsed.results as CheckResultItem[]).map((r) => ({
    ...r,
    title: r.title || resultMap.get(r.itemId) || r.itemId,
    userLabel: USER_LABEL[r.status as CheckItemStatus] ?? "확인 부족",
  }));

  const summary = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: results.filter((r) => r.status === "needs_decision").length,
  };

  return { ok: true, source: "llm", summary, results };
}
