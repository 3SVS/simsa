/**
 * workspace/generate-dev-spec.ts — T0 개발 지시서 다단계 생성기 (SI 티어 D-3 [LOCKED]).
 *
 * 왜 다단계인가: 지시서는 브리프의 5~10배 분량이고, 섹션 간 id 참조(FR↔AC↔SCR↔API↔WBS↔
 * 테스트)가 무결성의 전부다. 단일 호출은 (a) 출력 상한에 걸리고 (b) 어디가 틀렸는지 알 수
 * 없어 통째로 다시 만들어야 한다. 세 패스로 나누고, 무결성 위반은 **해당 패스부터만**
 * 한 번 재생성한다(D-3 "위반 시 해당 섹션만 재생성").
 *
 *   P1 requirements : features[] + acceptance[]                 (브리프·항목에서)
 *   P2 surfaces     : screens[] + dataModel[] + apis[] + nonFunctional[]   (P1 위에서)
 *   P3 plan         : workBreakdown[] + testPlan[] + assumptions[] + openQuestions[] (P1+P2 위에서)
 *
 * 규칙:
 *  - 모든 LLM 호출은 `anthropicMessages`(벤더 폴백·회로차단기·킬스위치 포함) 경유 — 직접 SDK 금지.
 *    호출은 `LlmCaller` 심(seam)으로 주입해 테스트가 네트워크를 안 탄다.
 *  - **예시 폴백 없음.** 모델이 못 만들면 `llm_unavailable`, 무결성을 끝내 못 맞추면
 *    `dev_spec_invalid`로 정직하게 실패한다(D-3, 증거 규칙).
 *  - 결과는 반드시 `validateDevSpec`을 통과한 것만 돌려준다 — 여기가 유일한 출구.
 */
import { z } from "zod";
import {
  AcceptanceSchema,
  ApiSchema,
  BriefSchema,
  DevSpecSchema,
  EntitySchema,
  FeatureSchema,
  NonFunctionalSchema,
  ScreenSchema,
  TestPlanEntrySchema,
  WorkBreakdownSchema,
  validateDevSpec,
  type DevSpec,
  type IntegrityViolation,
} from "./dev-spec.js";
import { anthropicMessages, anthropicEndpoint, type VendorFallback } from "./anthropic-fetch.js";
import type { LlmCallUsage } from "./generate.js";

// ─── 입출력 타입 ─────────────────────────────────────────────────────────────

export type DevSpecLocale = "ko" | "en";

export type DevSpecGenInput = {
  /** 현행 ProductSpec(브리프). 느슨하게 받아 BriefSchema로 정규화한다. */
  brief: unknown;
  /** 현행 items(제목 + 완성 기준). 없으면 빈 배열. */
  items: unknown;
  /** 유저의 원문 아이디어/기획서(있으면 문맥으로 준다). */
  idea?: string;
  locale: DevSpecLocale;
  /** generated=앞에서 생성 / inferred=기존 앱에서 역추론 */
  source: "generated" | "inferred";
};

export type PassName = "requirements" | "surfaces" | "plan";

export type PassRecord = {
  pass: PassName;
  attempt: number;
  outcome: "ok" | "schema_retry" | "shape_failure" | "llm_error";
  latencyMs: number;
};

export type LlmCaller = (prompt: string, maxTokens: number) => Promise<{ text: string; usage: LlmCallUsage }>;

export type DevSpecGenResult =
  | { ok: true; devSpec: DevSpec; passes: PassRecord[]; llmUsage: LlmCallUsage[]; repaired: boolean }
  | { ok: false; error: "llm_unavailable"; passes: PassRecord[]; llmUsage: LlmCallUsage[] }
  | {
      ok: false;
      error: "dev_spec_invalid";
      stage: "schema" | "integrity";
      issues: string[] | IntegrityViolation[];
      passes: PassRecord[];
      llmUsage: LlmCallUsage[];
    };

// ─── 패스별 스키마 (부분 검증 — 전체 무결성은 마지막에) ─────────────────────

const P1Schema = z.object({ features: z.array(FeatureSchema).min(1), acceptance: z.array(AcceptanceSchema).min(1) }).strict();
const P2Schema = z
  .object({
    screens: z.array(ScreenSchema),
    dataModel: z.array(EntitySchema),
    apis: z.array(ApiSchema),
    nonFunctional: z.array(NonFunctionalSchema),
  })
  .strict();
const P3Schema = z
  .object({
    workBreakdown: z.array(WorkBreakdownSchema).min(1),
    testPlan: z.array(TestPlanEntrySchema),
    assumptions: z.array(z.string().trim().min(1).max(2000)),
    openQuestions: z.array(z.string().trim().min(1).max(2000)),
  })
  .strict();

type P1 = z.infer<typeof P1Schema>;
type P2 = z.infer<typeof P2Schema>;
type P3 = z.infer<typeof P3Schema>;

const PASS_MAX_TOKENS: Record<PassName, number> = { requirements: 6000, surfaces: 8000, plan: 6000 };

// ─── 모델 / 호출자 ───────────────────────────────────────────────────────────

/** D-3 [PILOT]: Anthropic 도달 시 프론티어. 킬스위치가 켜져 있으면 폴백(gpt-5.4)이 실제 모델. */
export const DEFAULT_DEV_SPEC_MODEL = "claude-opus-5";
const CALL_TIMEOUT_MS = 120_000;

/** 프로덕션 호출자 — anthropicMessages 경유(폴백·차단기 포함). prefill "{"를 되붙인다. */
export function makeDevSpecLlmCaller(
  apiKey: string,
  baseUrl: string | undefined,
  fallback: VendorFallback | undefined,
  model: string = DEFAULT_DEV_SPEC_MODEL,
): LlmCaller {
  return async (prompt, maxTokens) => {
    const startedAt = Date.now();
    const data = await anthropicMessages(
      apiKey,
      {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: "{" },
        ],
      },
      CALL_TIMEOUT_MS,
      undefined,
      anthropicEndpoint(baseUrl),
      "dev-spec",
      { fallback },
    );
    const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
    return {
      text: "{" + text,
      usage: {
        model,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheCreationInputTokens: data.usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: data.usage?.cache_read_input_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  };
}

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

type Brief = z.infer<typeof BriefSchema>;
type Item = { title: string; criteria: string[] };

function normalizeItems(items: unknown): Item[] {
  if (!Array.isArray(items)) return [];
  const out: Item[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const title = typeof r["title"] === "string" ? r["title"].trim() : "";
    if (!title) continue;
    const criteria = Array.isArray(r["criteria"]) ? r["criteria"].filter((c): c is string => typeof c === "string") : [];
    out.push({ title: title.slice(0, 200), criteria: criteria.slice(0, 8).map((c) => c.slice(0, 300)) });
  }
  return out.slice(0, 30);
}

const COMMON_RULES = {
  ko: `공통 규칙:
- 마크다운 코드블록·설명문 없이 **JSON만** 반환한다.
- id 형식: FR-001 / AC-001 / SCR-001 / API-001 / WBS-001 (세 자리 이상, 중복 금지).
- 모르는 것은 지어내지 말고 "unknown"이라고 쓴다. 숫자 점수(score/rating/grade) 필드를 만들지 않는다.
- 이 문서는 개발자(또는 개발 AI)가 읽는 **개발 지시서**다. 기술 용어는 써도 되지만, 특정 상용 서비스 이름(Firebase, Supabase, Vercel 등)은 사용자가 직접 언급한 경우가 아니면 쓰지 않는다.
- 이번 버전에서 제외된 것(excluded)은 어떤 섹션에도 넣지 않는다.`,
  en: `Common rules:
- Return **JSON only** — no markdown fences, no prose.
- Id format: FR-001 / AC-001 / SCR-001 / API-001 / WBS-001 (3+ digits, unique).
- Never invent facts: write "unknown" when you do not know. Never add numeric score/rating/grade fields.
- This is a **development spec** read by a developer (or a coding AI). Technical terms are fine, but do not name specific commercial services (Firebase, Supabase, Vercel, …) unless the user named them.
- Anything listed under excluded must not appear in any section.`,
} as const;

function briefBlock(locale: DevSpecLocale, brief: Brief, items: Item[], idea: string | undefined): string {
  const itemLines = items.map((it, i) => `${i + 1}. ${it.title}${it.criteria.length ? ` — ${it.criteria.join(" / ")}` : ""}`).join("\n");
  if (locale === "ko") {
    return `제품 브리프:
- 이름: ${brief.productName || "(미정)"}
- 한 줄: ${brief.oneLine}
- 대상: ${brief.targetUsers.join(", ") || "unknown"}
- 문제: ${brief.problem}
- 포함: ${brief.included.join(" · ") || "(없음)"}
- 제외: ${brief.excluded.join(" · ") || "(없음)"}
- 사용자 흐름: ${brief.userFlow.join(" → ") || "(없음)"}
- 결정된 것: ${brief.decisions.join(" · ") || "(없음)"}
${idea ? `\n사용자 원문:\n${idea.slice(0, 6000)}\n` : ""}
꼭 들어가야 할 항목(사용자가 확인한 것):
${itemLines || "(없음)"}`;
  }
  return `Product brief:
- Name: ${brief.productName || "(tbd)"}
- One line: ${brief.oneLine}
- Users: ${brief.targetUsers.join(", ") || "unknown"}
- Problem: ${brief.problem}
- Included: ${brief.included.join(" · ") || "(none)"}
- Excluded: ${brief.excluded.join(" · ") || "(none)"}
- User flow: ${brief.userFlow.join(" → ") || "(none)"}
- Decided: ${brief.decisions.join(" · ") || "(none)"}
${idea ? `\nUser's original text:\n${idea.slice(0, 6000)}\n` : ""}
Must-have items (confirmed by the user):
${itemLines || "(none)"}`;
}

function issuesBlock(locale: DevSpecLocale, issues: string[]): string {
  if (issues.length === 0) return "";
  const head = locale === "ko" ? "\n이전 시도의 문제 — 반드시 고쳐서 다시 만든다:\n" : "\nProblems in the previous attempt — fix ALL of them:\n";
  return head + issues.slice(0, 30).map((i) => `- ${i}`).join("\n") + "\n";
}

export function buildPassPrompt(
  pass: PassName,
  locale: DevSpecLocale,
  ctx: { brief: Brief; items: Item[]; idea?: string; p1?: P1; p2?: P2; issues?: string[] },
): string {
  const rules = COMMON_RULES[locale];
  const brief = briefBlock(locale, ctx.brief, ctx.items, ctx.idea);
  const fix = issuesBlock(locale, ctx.issues ?? []);

  if (pass === "requirements") {
    return locale === "ko"
      ? `아래 브리프를 개발 지시서의 **요구사항** 섹션으로 바꾼다.

${brief}

만들 것:
- features: 3~12개. 각 must-have 항목은 최소 1개 기능(FR)으로 옮긴다. priority는 must/should/could. 브리프의 "포함"이 must, 나머지는 should/could.
- acceptance: 기능마다 1~3개. **Given(전제) / When(행동) / Then(관찰되는 결과)** 세 문장. 항목의 "완성 기준"을 그대로 살린다.
  verifiedBy: 브라우저에서 눈으로 확인 가능하면 "browser", 자동 테스트로만 확인되면 "test", 컴파일·기동만으로 확인되면 "build", 사람 판단이 필요하면 "human".
- 모든 acceptance.featureId는 위 features의 id여야 하고, 기능마다 acceptance가 최소 1개 있어야 한다.
${rules}
${fix}
JSON 형식:
{"features":[{"id":"FR-001","title":"…","description":"…","priority":"must"}],
 "acceptance":[{"id":"AC-001","featureId":"FR-001","given":"…","when":"…","then":"…","verifiedBy":"browser"}]}`
      : `Turn the brief below into the **requirements** section of a development spec.

${brief}

Produce:
- features: 3–12. Every must-have item becomes at least one feature (FR). priority is must/should/could — "Included" items are must, the rest should/could.
- acceptance: 1–3 per feature. **Given / When / Then** as three sentences, preserving the items' done-criteria.
  verifiedBy: "browser" if visible in a real browser, "test" if only an automated test can tell, "build" if compile/boot suffices, "human" if it needs human judgment.
- Every acceptance.featureId must be one of the feature ids above, and every feature needs at least one acceptance.
${rules}
${fix}
JSON shape:
{"features":[{"id":"FR-001","title":"…","description":"…","priority":"must"}],
 "acceptance":[{"id":"AC-001","featureId":"FR-001","given":"…","when":"…","then":"…","verifiedBy":"browser"}]}`;
  }

  const p1 = JSON.stringify(ctx.p1 ?? {});
  if (pass === "surfaces") {
    return locale === "ko"
      ? `아래 요구사항(기능·수용 기준)에 맞는 **화면·데이터·API·비기능** 섹션을 만든다.

${brief}

요구사항(JSON):
${p1}

만들 것:
- screens: 1~8개. route(경로)·purpose·components(주요 구성요소)·states(empty/loading/error/success 중 해당하는 것의 문구)·entryFrom·exitTo·featureIds. **priority가 must인 기능은 반드시 어떤 화면 또는 API의 featureIds에 등장**해야 한다.
- dataModel: 저장할 엔티티. fields(name/type/required/default)·relations(to/kind)·ownership(누가 소유·열람하는지, 모르면 "unknown").
- apis: 화면이 필요로 하는 서버 동작. method·path·request/response(형태 설명)·errors·auth(none/user/admin)·featureIds.
- nonFunctional: performance/security/accessibility/i18n/cost/other 중 해당 항목. 모르면 requirement에 "unknown".
${rules}
${fix}
JSON 형식:
{"screens":[{"id":"SCR-001","route":"/","purpose":"…","components":["…"],"states":{"empty":"…"},"entryFrom":["…"],"exitTo":["…"],"featureIds":["FR-001"]}],
 "dataModel":[{"name":"…","fields":[{"name":"id","type":"text","required":true}],"relations":[],"ownership":"unknown"}],
 "apis":[{"id":"API-001","method":"POST","path":"/api/…","request":"…","response":"…","errors":["…"],"auth":"none","featureIds":["FR-001"]}],
 "nonFunctional":[{"kind":"performance","requirement":"unknown"}]}`
      : `Produce the **screens · data · APIs · non-functional** sections that satisfy the requirements below.

${brief}

Requirements (JSON):
${p1}

Produce:
- screens: 1–8. route, purpose, components, states (copy for empty/loading/error/success where applicable), entryFrom, exitTo, featureIds. **Every must feature must appear in the featureIds of at least one screen or API.**
- dataModel: entities to persist. fields (name/type/required/default), relations (to/kind), ownership (who owns/reads rows; "unknown" if unsure).
- apis: server actions the screens need. method, path, request/response (shape in words), errors, auth (none/user/admin), featureIds.
- nonFunctional: whichever of performance/security/accessibility/i18n/cost/other apply; requirement "unknown" when unsure.
${rules}
${fix}
JSON shape:
{"screens":[{"id":"SCR-001","route":"/","purpose":"…","components":["…"],"states":{"empty":"…"},"entryFrom":["…"],"exitTo":["…"],"featureIds":["FR-001"]}],
 "dataModel":[{"name":"…","fields":[{"name":"id","type":"text","required":true}],"relations":[],"ownership":"unknown"}],
 "apis":[{"id":"API-001","method":"POST","path":"/api/…","request":"…","response":"…","errors":["…"],"auth":"none","featureIds":["FR-001"]}],
 "nonFunctional":[{"kind":"performance","requirement":"unknown"}]}`;
  }

  const p2 = JSON.stringify(ctx.p2 ?? {});
  return locale === "ko"
    ? `아래 요구사항과 화면·데이터·API를 바탕으로 **작업 분해·테스트 계획·가정·미결** 섹션을 만든다.

요구사항(JSON):
${p1}

화면·데이터·API(JSON):
${p2}

만들 것:
- workBreakdown: 개발 순서대로 3~20개. order(1부터), dependsOn(앞선 WBS id만, 자기 자신·순환 금지), acceptanceIds(이 작업이 끝나면 통과해야 하는 AC — **존재하는 AC id만**, 최소 1개). 모든 AC는 어떤 WBS엔가 속해야 한다.
- testPlan: verifiedBy가 "browser" 또는 "test"인 **모든 AC**에 대해 1개씩. browser면 steps(사람이 따라 할 수 있는 단계, 첫 단계는 어느 화면을 여는지), test면 testName.
- assumptions: 우리가 가정한 것(사용자가 답하지 않았지만 진행을 위해 정한 것).
- openQuestions: 사용자가 답해야 하는 것(도구 이름 없이 일반인 언어로).
${COMMON_RULES.ko}
${fix}
JSON 형식:
{"workBreakdown":[{"id":"WBS-001","title":"…","order":1,"dependsOn":[],"acceptanceIds":["AC-001"]}],
 "testPlan":[{"kind":"browser","acceptanceId":"AC-001","steps":["/ 열기","…"]},{"kind":"test","acceptanceId":"AC-002","testName":"…"}],
 "assumptions":["…"],"openQuestions":["…"]}`
    : `Using the requirements and the screens/data/APIs below, produce the **work breakdown · test plan · assumptions · open questions** sections.

Requirements (JSON):
${p1}

Screens/data/APIs (JSON):
${p2}

Produce:
- workBreakdown: 3–20 items in build order. order (from 1), dependsOn (earlier WBS ids only — no self, no cycles), acceptanceIds (the ACs that must pass when this item is done — **existing AC ids only**, at least 1). Every AC must belong to some WBS.
- testPlan: exactly one entry for **every** AC whose verifiedBy is "browser" or "test". browser → steps a person can follow (first step names the screen to open); test → testName.
- assumptions: what we assumed to proceed (not answered by the user).
- openQuestions: what the user still has to decide (plain language, no tool names).
${COMMON_RULES.en}
${fix}
JSON shape:
{"workBreakdown":[{"id":"WBS-001","title":"…","order":1,"dependsOn":[],"acceptanceIds":["AC-001"]}],
 "testPlan":[{"kind":"browser","acceptanceId":"AC-001","steps":["Open /","…"]},{"kind":"test","acceptanceId":"AC-002","testName":"…"}],
 "assumptions":["…"],"openQuestions":["…"]}`;
}

// ─── JSON 추출 ───────────────────────────────────────────────────────────────

function extractJson(raw: string): unknown | null {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function zodIssues(err: z.ZodError): string[] {
  return err.issues.slice(0, 30).map((i) => `${i.path.join(".") || "$"}: ${i.message}`);
}

// ─── 위반 → 재생성 시작 패스 매핑 (D-3 "해당 섹션만") ────────────────────────

const P1_RULES = new Set<IntegrityViolation["rule"]>(["ac_unknown_feature", "feature_without_ac"]);
const P2_RULES = new Set<IntegrityViolation["rule"]>(["must_feature_without_surface", "screen_unknown_feature", "api_unknown_feature"]);

/** 어느 패스부터 다시 만들어야 하는가. 앞 패스를 다시 만들면 뒤 패스도 다시 만든다. */
export function repairStartPass(violations: IntegrityViolation[]): PassName {
  if (violations.some((v) => P1_RULES.has(v.rule) || (v.rule === "duplicate_id" && /^(FR|AC)-/.test(v.where)))) return "requirements";
  if (violations.some((v) => P2_RULES.has(v.rule) || (v.rule === "duplicate_id" && /^(SCR|API)-/.test(v.where)))) return "surfaces";
  return "plan";
}

function describeViolations(v: IntegrityViolation[]): string[] {
  return v.map((x) => `${x.rule} @ ${x.where}`);
}

// ─── 실행 ────────────────────────────────────────────────────────────────────

async function runPass<T>(
  pass: PassName,
  schema: z.ZodType<T>,
  build: (issues: string[]) => string,
  call: LlmCaller,
  passes: PassRecord[],
  usage: LlmCallUsage[],
): Promise<{ ok: true; data: T } | { ok: false; error: "llm_unavailable" | "schema"; issues: string[] }> {
  let issues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let text: string;
    try {
      const r = await call(build(issues), PASS_MAX_TOKENS[pass]);
      text = r.text;
      usage.push(r.usage);
    } catch (err) {
      console.error(`[workspace/dev-spec] pass=${pass} attempt=${attempt} llm error:`, err);
      passes.push({ pass, attempt, outcome: "llm_error", latencyMs: Date.now() - started });
      return { ok: false, error: "llm_unavailable", issues: [] };
    }
    const parsed = extractJson(text);
    if (parsed === null) {
      console.log(JSON.stringify({ event: "llm_shape_failure", call_site: "dev-spec", pass, attempt, text_chars: text.length, head: text.slice(0, 200) }));
      passes.push({ pass, attempt, outcome: "shape_failure", latencyMs: Date.now() - started });
      issues = ["previous reply was not valid JSON"];
      continue;
    }
    const v = schema.safeParse(parsed);
    if (v.success) {
      passes.push({ pass, attempt, outcome: "ok", latencyMs: Date.now() - started });
      return { ok: true, data: v.data };
    }
    issues = zodIssues(v.error);
    passes.push({ pass, attempt, outcome: "schema_retry", latencyMs: Date.now() - started });
  }
  return { ok: false, error: "schema", issues };
}

/**
 * 세 패스 → 조립 → 무결성. 위반 시 시작 패스부터 1회 재생성. 그래도 실패면 정직하게 실패.
 */
export async function generateDevSpec(
  input: DevSpecGenInput,
  call: LlmCaller,
  opts: { now?: () => Date } = {},
): Promise<DevSpecGenResult> {
  const passes: PassRecord[] = [];
  const llmUsage: LlmCallUsage[] = [];
  const briefParsed = BriefSchema.safeParse(input.brief && typeof input.brief === "object" ? input.brief : {});
  const brief: Brief = briefParsed.success ? briefParsed.data : BriefSchema.parse({});
  const items = normalizeItems(input.items);
  const idea = input.idea?.trim() || undefined;
  const locale = input.locale;

  let p1: P1 | undefined;
  let p2: P2 | undefined;
  let p3: P3 | undefined;
  let repaired = false;

  const runFrom = async (start: PassName, carried: string[]): Promise<DevSpecGenResult | null> => {
    const order: PassName[] = ["requirements", "surfaces", "plan"];
    for (const pass of order.slice(order.indexOf(start))) {
      const issues = pass === start ? carried : [];
      if (pass === "requirements") {
        const r = await runPass("requirements", P1Schema, (i) => buildPassPrompt("requirements", locale, { brief, items, idea, issues: [...issues, ...i] }), call, passes, llmUsage);
        if (!r.ok) return r.error === "llm_unavailable" ? { ok: false, error: "llm_unavailable", passes, llmUsage } : { ok: false, error: "dev_spec_invalid", stage: "schema", issues: r.issues, passes, llmUsage };
        p1 = r.data;
      } else if (pass === "surfaces") {
        const r = await runPass("surfaces", P2Schema, (i) => buildPassPrompt("surfaces", locale, { brief, items, idea, p1, issues: [...issues, ...i] }), call, passes, llmUsage);
        if (!r.ok) return r.error === "llm_unavailable" ? { ok: false, error: "llm_unavailable", passes, llmUsage } : { ok: false, error: "dev_spec_invalid", stage: "schema", issues: r.issues, passes, llmUsage };
        p2 = r.data;
      } else {
        const r = await runPass("plan", P3Schema, (i) => buildPassPrompt("plan", locale, { brief, items, idea, p1, p2, issues: [...issues, ...i] }), call, passes, llmUsage);
        if (!r.ok) return r.error === "llm_unavailable" ? { ok: false, error: "llm_unavailable", passes, llmUsage } : { ok: false, error: "dev_spec_invalid", stage: "schema", issues: r.issues, passes, llmUsage };
        p3 = r.data;
      }
    }
    return null;
  };

  const assemble = (): unknown => ({
    meta: { version: 1, source: input.source, locale, generatedAt: (opts.now ?? (() => new Date()))().toISOString() },
    brief,
    features: p1!.features,
    acceptance: p1!.acceptance,
    screens: p2!.screens,
    dataModel: p2!.dataModel,
    apis: p2!.apis,
    nonFunctional: p2!.nonFunctional,
    workBreakdown: p3!.workBreakdown,
    testPlan: p3!.testPlan,
    assumptions: p3!.assumptions,
    openQuestions: p3!.openQuestions,
  });

  const first = await runFrom("requirements", []);
  if (first) return first;

  let v = validateDevSpec(assemble());
  if (!v.ok && v.stage === "integrity") {
    // D-3: 위반이 난 섹션부터 한 번만 다시 만든다.
    repaired = true;
    const start = repairStartPass(v.issues);
    const again = await runFrom(start, describeViolations(v.issues));
    if (again) return again;
    v = validateDevSpec(assemble());
  }
  if (!v.ok) {
    return { ok: false, error: "dev_spec_invalid", stage: v.stage, issues: v.issues, passes, llmUsage };
  }
  // 출구는 하나 — 스키마·무결성을 통과한 것만.
  return { ok: true, devSpec: DevSpecSchema.parse(v.spec), passes, llmUsage, repaired };
}
