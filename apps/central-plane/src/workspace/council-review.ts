/**
 * workspace/council-review.ts — RC-3 협의체 검수 (B 티어, 유료 선택).
 *
 * Worker-native lean council. packages/core의 Mastra council은 Node 전제라
 * 재사용하지 않는다(2026-07-08 CEO 결정: 7층=Worker≠Node) — 개념(독립 소견 →
 * 반박 라운드 → 종합)만 가져온다.
 *
 * 구조 (호출 상한 = 벤더 3 × 라운드 2 = 6, RC-5):
 *   1라운드 — 가용 벤더(Anthropic/OpenAI/Gemini)가 동일 증거로 **독립** 판정
 *             (서로의 답을 보지 않음, 전 항목 한 번에).
 *   합의    — 항목별 다수결. 과반 일치 → council_agreed.
 *   2라운드 — 불일치 항목만: 각 벤더가 타 소견을 보고 최종 판정 재제출.
 *   미합의  — status를 "확인 부족"으로 두고 council_split + 각 관점 병기
 *             (단정 금지 — 갈린 판정을 한쪽 손 들어주지 않는다).
 *
 * 벤더 2개 미만 가용/응답 → council_unavailable (조용한 대체 금지 — 라우트가
 * 정직하게 안내하고 사용자가 기본 검수를 고르게 한다).
 */
import type {
  CheckItemStatus,
  CheckResultItem,
  WorkspaceCheckDraftRequest,
  WorkspaceCheckDraftResponse,
} from "./check.js";
import { buildCheckPrompt } from "./check.js";
import { anthropicEndpoint } from "./anthropic-fetch.js";

export type CouncilEnv = {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CF_AI_GATEWAY_ANTHROPIC_URL?: string;
  CF_AI_GATEWAY_OPENAI_URL?: string;
  CF_AI_GATEWAY_GOOGLE_URL?: string;
};

export type CouncilOpts = {
  timeoutMs?: number;
  anthropicModel?: string;
  openaiModel?: string;
  geminiModel?: string;
  fetchImpl?: typeof fetch;
};

type VendorId = "anthropic" | "openai" | "gemini";
type VendorVerdicts = Map<string, { status: CheckItemStatus; reason: string; evidence: string[]; nextAction: string }>;

const USER_LABEL: Record<CheckItemStatus, CheckResultItem["userLabel"]> = {
  passed: "통과",
  failed: "안 맞음",
  inconclusive: "확인 부족",
  needs_decision: "결정 필요",
};

const VALID_STATUS = new Set<string>(["passed", "failed", "inconclusive", "needs_decision"]);

function parseVerdicts(text: string): VendorVerdicts | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const results = (parsed as Record<string, unknown>)?.["results"];
  if (!Array.isArray(results)) return null;
  const map: VendorVerdicts = new Map();
  for (const r of results) {
    const i = r as Record<string, unknown>;
    if (typeof i["itemId"] !== "string" || !VALID_STATUS.has(String(i["status"]))) continue;
    map.set(i["itemId"], {
      status: i["status"] as CheckItemStatus,
      reason: typeof i["reason"] === "string" ? i["reason"] : "",
      evidence: Array.isArray(i["evidence"]) ? (i["evidence"] as unknown[]).filter((e): e is string => typeof e === "string") : [],
      nextAction: typeof i["nextAction"] === "string" ? i["nextAction"] : "",
    });
  }
  return map.size > 0 ? map : null;
}

// ─── Vendor callers (모두 실패 시 null — 협의는 남은 벤더로) ──────────────────

async function callVendor(
  vendor: VendorId,
  env: CouncilEnv,
  prompt: string,
  opts: Required<Omit<CouncilOpts, "fetchImpl">>,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    if (vendor === "anthropic" && env.ANTHROPIC_API_KEY) {
      const r = await fetchImpl(anthropicEndpoint(env.CF_AI_GATEWAY_ANTHROPIC_URL), {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: opts.anthropicModel, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
      return (j.content ?? []).find((b) => b.type === "text")?.text ?? null;
    }
    if (vendor === "openai" && env.OPENAI_API_KEY) {
      const base = (env.CF_AI_GATEWAY_OPENAI_URL ?? "").trim().replace(/\/$/, "");
      const url = base ? `${base}/chat/completions` : "https://api.openai.com/v1/chat/completions";
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: opts.openaiModel, max_completion_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return j.choices?.[0]?.message?.content ?? null;
    }
    if (vendor === "gemini" && env.GEMINI_API_KEY) {
      const base = (env.CF_AI_GATEWAY_GOOGLE_URL ?? "").trim().replace(/\/$/, "");
      const url = base
        ? `${base}/v1beta/models/${opts.geminiModel}:generateContent`
        : `https://generativelanguage.googleapis.com/v1beta/models/${opts.geminiModel}:generateContent`;
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── Round 2 prompt: 타 소견을 보고 최종 판정 ────────────────────────────────

function rebuttalPrompt(
  req: WorkspaceCheckDraftRequest,
  itemIds: string[],
  opinions: Map<VendorId, VendorVerdicts>,
): string {
  const items = req.items.filter((i) => itemIds.includes(i.id));
  const lines: string[] = [
    "다음 항목들에 대해 검토자들의 1차 판정이 갈렸습니다. 각 검토자의 판단을 읽고, 스스로 최종 판정을 다시 내려주세요. 동의하면 그 판정으로, 여전히 다르게 보면 근거와 함께 자신의 판정을 유지하세요.",
    "",
    `[제품 설명서]`,
    JSON.stringify(req.productSpec),
    "",
  ];
  for (const item of items) {
    lines.push(`[항목 ${item.id}] ${item.title} (완성 기준: ${item.criteria.join(", ") || "없음"})`);
    for (const [vendor, verdicts] of opinions) {
      const v = verdicts.get(item.id);
      if (v) lines.push(`- 검토자 ${vendor}: ${v.status} — ${v.reason}`);
    }
    lines.push("");
  }
  lines.push(
    `해당 항목들만, 다음 JSON 형식으로만 응답 (마크다운·설명 없이):`,
    `{"results":[{"itemId":"...","status":"passed|failed|inconclusive|needs_decision","reason":"한국어 1~2문장","evidence":[],"nextAction":"한 줄"}]}`,
  );
  return lines.join("\n");
}

// ─── 다수결 ──────────────────────────────────────────────────────────────────

function majorityFor(
  itemId: string,
  opinions: Map<VendorId, VendorVerdicts>,
): { status: CheckItemStatus; from: VendorId } | null {
  const votes: Array<{ vendor: VendorId; status: CheckItemStatus }> = [];
  for (const [vendor, verdicts] of opinions) {
    const v = verdicts.get(itemId);
    if (v) votes.push({ vendor, status: v.status });
  }
  if (votes.length === 0) return null;
  const counts = new Map<CheckItemStatus, number>();
  for (const v of votes) counts.set(v.status, (counts.get(v.status) ?? 0) + 1);
  for (const [status, n] of counts) {
    if (n * 2 > votes.length) {
      const from = votes.find((v) => v.status === status);
      return from ? { status, from: from.vendor } : null;
    }
  }
  return null;
}

/** split 항목의 각 관점을 쉬운 말 한 줄로. */
function splitSummary(itemId: string, opinions: Map<VendorId, VendorVerdicts>): string {
  const parts: string[] = [];
  for (const [vendor, verdicts] of opinions) {
    const v = verdicts.get(itemId);
    if (v) parts.push(`${USER_LABEL[v.status]}(${vendor}: ${v.reason.slice(0, 80)})`);
  }
  return parts.join(" / ");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runCouncilCheck(
  req: WorkspaceCheckDraftRequest,
  env: CouncilEnv,
  opts: CouncilOpts = {},
): Promise<WorkspaceCheckDraftResponse | { ok: false; error: "council_unavailable" }> {
  const resolved = {
    timeoutMs: opts.timeoutMs ?? 30_000,
    anthropicModel: opts.anthropicModel ?? "claude-haiku-4-5-20251001",
    openaiModel: opts.openaiModel ?? "gpt-5.4",
    geminiModel: opts.geminiModel ?? "gemini-2.5-flash",
  };
  const fetchImpl = opts.fetchImpl ?? fetch;

  const vendors: VendorId[] = (["anthropic", "openai", "gemini"] as const).filter((v) =>
    v === "anthropic" ? !!env.ANTHROPIC_API_KEY : v === "openai" ? !!env.OPENAI_API_KEY : !!env.GEMINI_API_KEY,
  );
  if (vendors.length < 2) return { ok: false, error: "council_unavailable" };

  // ── Round 1: independent verdicts, all items in one call per vendor ────────
  const prompt = buildCheckPrompt(req);
  const round1 = await Promise.all(
    vendors.map(async (v) => {
      const text = await callVendor(v, env, prompt, resolved, fetchImpl);
      return { vendor: v, verdicts: text ? parseVerdicts(text) : null };
    }),
  );
  const opinions = new Map<VendorId, VendorVerdicts>();
  for (const r of round1) if (r.verdicts) opinions.set(r.vendor, r.verdicts);
  if (opinions.size < 2) return { ok: false, error: "council_unavailable" };

  // ── Consensus pass 1 ───────────────────────────────────────────────────────
  const disagreedIds = req.items
    .map((i) => i.id)
    .filter((id) => majorityFor(id, opinions) === null);

  // ── Round 2: rebuttal on disagreed items only ──────────────────────────────
  let rounds = 1;
  if (disagreedIds.length > 0) {
    rounds = 2;
    const rPrompt = rebuttalPrompt(req, disagreedIds, opinions);
    const round2 = await Promise.all(
      [...opinions.keys()].map(async (v) => {
        const text = await callVendor(v, env, rPrompt, resolved, fetchImpl);
        return { vendor: v, verdicts: text ? parseVerdicts(text) : null };
      }),
    );
    // 재제출된 판정으로 해당 항목만 덮어쓴다 (실패한 벤더는 1차 의견 유지).
    for (const r of round2) {
      if (!r.verdicts) continue;
      const base = opinions.get(r.vendor);
      if (!base) continue;
      for (const id of disagreedIds) {
        const v = r.verdicts.get(id);
        if (v) base.set(id, v);
      }
    }
  }

  // ── Final merge ────────────────────────────────────────────────────────────
  let stillSplit = 0;
  const results: CheckResultItem[] = req.items.map((item) => {
    const maj = majorityFor(item.id, opinions);
    if (maj) {
      // 다수 판정 벤더 중 anthropic 우선(한국어 사유 품질), 없으면 합의 벤더 아무나.
      const src =
        (opinions.get("anthropic")?.get(item.id)?.status === maj.status
          ? opinions.get("anthropic")?.get(item.id)
          : opinions.get(maj.from)?.get(item.id)) ?? null;
      return {
        itemId: item.id,
        title: item.title,
        status: maj.status,
        userLabel: USER_LABEL[maj.status],
        reason: src?.reason ?? "협의체가 합의한 판정입니다.",
        evidence: src?.evidence ?? [],
        nextAction: src?.nextAction ?? "",
        verification: "council_agreed",
      };
    }
    stillSplit += 1;
    return {
      itemId: item.id,
      title: item.title,
      status: "inconclusive",
      userLabel: "확인 부족",
      reason: `협의체 의견이 끝까지 갈렸습니다 — ${splitSummary(item.id, opinions)}. 이런 항목은 직접 확인해보는 것이 가장 정확합니다.`,
      evidence: [],
      nextAction: "항목 기준을 더 구체적으로 적거나, 실제 화면에서 직접 확인해보세요.",
      verification: "council_split",
    };
  });

  const summary = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    inconclusive: results.filter((r) => r.status === "inconclusive").length,
    needsDecision: results.filter((r) => r.status === "needs_decision").length,
  };

  return {
    ok: true,
    source: "llm",
    summary,
    results,
    reviewMode: "council",
    council: { vendors: [...opinions.keys()], rounds, disagreements: stillSplit },
  };
}
