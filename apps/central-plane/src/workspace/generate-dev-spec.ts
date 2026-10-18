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
  applyInferredConfirmation,
  validateDevSpec,
  type DevSpec,
  type IntegrityViolation,
} from "./dev-spec.js";
import { anthropicMessages, anthropicEndpoint, type LlmUsageSink, type VendorFallback } from "./anthropic-fetch.js";
import type { LlmCallUsage } from "./generate.js";
import type { BaseProvenance } from "./provenance.js";

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
  /**
   * D-2 amend(inferred 전용): 유저가 "맞나요?" 카드·인터뷰 회수에서 **확인한** 항목의 items[].id.
   * 없으면 빈 배열 — 확인된 must가 0개(옛 클라이언트). 목록에 없는 id는 무시한다.
   */
  confirmedItemIds?: readonly string[];
  /** D-2 amend(inferred 전용): 출처(builtWith·entryPath·detectedStack). meta.provenance로 들어간다. */
  provenance?: BaseProvenance;
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
  /** L-3: 패스마다 사용량 싱크(라우트가 원장에 dev_spec으로 기록). */
  onUsage?: LlmUsageSink,
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
      { fallback, onUsage },
    );
    const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
    return {
      text: "{" + text,
      usage: {
        // L-2: 실응답 모델(킬스위치 off면 gpt-5.4…). 요청 모델(claude-opus-5)은 modelRequested로.
        model: data.modelActual ?? model,
        modelRequested: model,
        vendor: data.vendor ?? "anthropic",
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
type Item = { id?: string; title: string; criteria: string[] };

function normalizeItems(items: unknown): Item[] {
  if (!Array.isArray(items)) return [];
  const out: Item[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const title = typeof r["title"] === "string" ? r["title"].trim() : "";
    if (!title) continue;
    const criteria = Array.isArray(r["criteria"]) ? r["criteria"].filter((c): c is string => typeof c === "string") : [];
    const id = typeof r["id"] === "string" && r["id"].trim() ? r["id"].trim().slice(0, 64) : undefined;
    out.push({ ...(id ? { id } : {}), title: title.slice(0, 200), criteria: criteria.slice(0, 8).map((c) => c.slice(0, 300)) });
  }
  return out.slice(0, 30);
}

/**
 * D-2 amend — 역추론의 확인 계획. 확인된 항목 k(1부터)는 **고정 id FR-00k**로 must가 되고,
 * 나머지(앱에서 읽었지만 유저가 확인하지 않은 것)는 FR-101부터 should/could다.
 * 순수 — 프롬프트와 사후 강제가 같은 계획을 본다.
 */
export type InferredPlan = {
  confirmed: Array<{ featureId: string; item: Item }>;
  unconfirmed: Item[];
};

/** 사용자가 직접 적은 항목(id `user_…`, intent-missing.mjs)에서 나온 기능의 AC id. */
export function userTextAcIdsOf(acceptance: ReadonlyArray<{ id: string; featureId: string }>, plan: InferredPlan): string[] {
  const features = new Set(plan.confirmed.filter((c) => (c.item.id ?? "").startsWith("user_")).map((c) => c.featureId));
  return acceptance.filter((a) => features.has(a.featureId)).map((a) => a.id).sort();
}

export function planInferredConfirmation(items: readonly Item[], confirmedItemIds: readonly string[] | undefined): InferredPlan {
  const wanted = new Set((confirmedItemIds ?? []).filter((x) => typeof x === "string"));
  const confirmed: InferredPlan["confirmed"] = [];
  const unconfirmed: Item[] = [];
  for (const it of items) {
    if (it.id && wanted.has(it.id)) {
      confirmed.push({ featureId: `FR-${String(confirmed.length + 1).padStart(3, "0")}`, item: it });
    } else {
      unconfirmed.push(it);
    }
  }
  return { confirmed, unconfirmed };
}

const COMMON_RULES = {
  ko: `공통 규칙:
- 마크다운 코드블록·설명문 없이 **JSON만** 반환한다.
- id 형식: FR-001 / AC-001 / SCR-001 / API-001 / WBS-001 (세 자리 이상, 중복 금지).
- 모르는 것은 지어내지 말고 "unknown"이라고 쓴다. 숫자 점수(score/rating/grade) 필드를 만들지 않는다.
- 데이터 필드의 default는 **실제 기본값이 있을 때만** 문자열로 쓰고(true/false·숫자도 "false"·"0"처럼 따옴표 안에), 없으면 그 키를 아예 생략한다(null·"unknown" 금지).
- 선택지가 정해진 필드(priority·verifiedBy·method·auth·kind)는 **목록에 있는 값만** 쓴다. auth를 정할 수 없으면 "unknown".
- 모든 자유 텍스트는 **한국어**로 쓴다(id·경로·필드명·타입은 영문 그대로).
- 이 문서는 개발자(또는 개발 AI)가 읽는 **개발 지시서**다. 기술 용어는 써도 되지만, 특정 상용 서비스 이름(Firebase, Supabase, Vercel 등)은 사용자가 직접 언급한 경우가 아니면 쓰지 않는다.
- 이번 버전에서 제외된 것(excluded)은 어떤 섹션에도 넣지 않는다.`,
  en: `Common rules:
- Return **JSON only** — no markdown fences, no prose.
- Id format: FR-001 / AC-001 / SCR-001 / API-001 / WBS-001 (3+ digits, unique).
- Never invent facts: write "unknown" when you do not know. Never add numeric score/rating/grade fields.
- A data field's default is a string **only when a real default exists** (quote booleans and numbers too: "false", "0"); otherwise omit the key entirely (never null or "unknown").
- Fields with a fixed set of values (priority, verifiedBy, method, auth, kind) must use **only listed values**. If auth cannot be decided, use "unknown".
- Write ALL free text in **English** — translate the brief and the items if they are in another language. Keep ids, routes, field names and types as they are.
- This is a **development spec** read by a developer (or a coding AI). Technical terms are fine, but do not name specific commercial services (Firebase, Supabase, Vercel, …) unless the user named them.
- Anything listed under excluded must not appear in any section.`,
} as const;

const itemLine = (it: Item) => `${it.title}${it.criteria.length ? ` — ${it.criteria.join(" / ")}` : ""}`;

/** 역추론: 확인된 항목(고정 FR id)과 확인 안 된 항목을 **나눠서** 보여준다 — 섞으면 전부 must가 된다. */
function inferredItemsBlock(locale: DevSpecLocale, plan: InferredPlan): string {
  const conf = plan.confirmed.map((c) => `${c.featureId} = ${itemLine(c.item)}`).join("\n");
  const rest = plan.unconfirmed.map((it, i) => `${i + 1}. ${itemLine(it)}`).join("\n");
  return locale === "ko"
    ? `사용자가 확인한 항목(반드시 되어야 할 것 — 표시된 기능 id를 그대로 쓴다):
${conf || "(아직 없음)"}

앱에서 읽어냈지만 사용자가 확인하지 않은 항목:
${rest || "(없음)"}`
    : `Items the user confirmed (must work — use the feature id shown, verbatim):
${conf || "(none yet)"}

Items read from the app that the user has NOT confirmed:
${rest || "(none)"}`;
}

const INFERRED_RULES = {
  ko: `역추론 규칙(위의 priority 규칙보다 우선한다):
- 이 지시서는 이미 만들어진 앱에서 역추론한 것이다. priority "must"는 **사용자가 확인한 항목에만** 쓴다.
- 사용자가 확인한 항목은 표시된 기능 id(FR-001…)를 **그대로** 쓰고 priority는 must.
- 그 밖의 기능은 FR-101부터 번호를 매기고 priority는 should 또는 could다(must 금지).`,
  en: `Inferred-spec rules (these override the priority rule above):
- This spec was inferred from an app that already exists. Use priority "must" **only for items the user confirmed**.
- Each confirmed item uses the feature id shown (FR-001…) **verbatim**, with priority must.
- Any other feature is numbered from FR-101 with priority should or could (never must).`,
} as const;

function briefBlock(locale: DevSpecLocale, brief: Brief, items: Item[], idea: string | undefined, inferred?: InferredPlan): string {
  const itemLines = inferred ? inferredItemsBlock(locale, inferred) : items.map((it, i) => `${i + 1}. ${itemLine(it)}`).join("\n");
  if (inferred) {
    const head = locale === "ko" ? "제품 브리프(기존 앱에서 역추론):" : "Product brief (inferred from an existing app):";
    return `${head}
- ${locale === "ko" ? "이름" : "Name"}: ${brief.productName || (locale === "ko" ? "(미정)" : "(tbd)")}
- ${locale === "ko" ? "한 줄" : "One line"}: ${brief.oneLine}
- ${locale === "ko" ? "대상" : "Users"}: ${brief.targetUsers.join(", ") || "unknown"}
- ${locale === "ko" ? "문제" : "Problem"}: ${brief.problem}
- ${locale === "ko" ? "제외" : "Excluded"}: ${brief.excluded.join(" · ") || (locale === "ko" ? "(없음)" : "(none)")}
- ${locale === "ko" ? "결정된 것" : "Decided"}: ${brief.decisions.join(" · ") || (locale === "ko" ? "(없음)" : "(none)")}
${idea ? `\n${locale === "ko" ? "사용자 원문" : "User's original text"}:\n${idea.slice(0, 6000)}\n` : ""}
${itemLines}`;
  }
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
  ctx: { brief: Brief; items: Item[]; idea?: string; p1?: P1; p2?: P2; issues?: string[]; inferred?: InferredPlan },
): string {
  // 역추론이면 공통 규칙 끝에 우선 규칙을 붙인다(세 패스 모두 — must 기능의 표면 규칙이 걸려 있다).
  const rules = ctx.inferred ? `${COMMON_RULES[locale]}\n${INFERRED_RULES[locale]}` : COMMON_RULES[locale];
  const brief = briefBlock(locale, ctx.brief, ctx.items, ctx.idea, ctx.inferred);
  const fix = issuesBlock(locale, ctx.issues ?? []);

  if (pass === "requirements") {
    return locale === "ko"
      ? `아래 브리프를 개발 지시서의 **요구사항** 섹션으로 바꾼다.

${brief}

만들 것:
- features: 3~12개. 각 must-have 항목은 최소 1개 기능(FR)으로 옮긴다. priority는 must/should/could. 브리프의 "포함"이 must, 나머지는 should/could.
- acceptance: 기능마다 1~3개. **Given(전제) / When(행동) / Then(관찰되는 결과)** 세 문장. 항목의 "완성 기준"을 그대로 살린다.
  verifiedBy: 브라우저에서 눈으로 확인 가능하면 "browser", 자동 테스트로만 확인되면 "test", 컴파일·기동만으로 확인되면 "build", 사람 판단이 필요하면 "human".
  must 기능의 AC는 **결과(outcome)** 여야 한다: 핵심 일을 실제 데이터로 끝까지 해 낸 뒤 결과가 새로고침 뒤에도 남는지, 보여야 할 곳(다른 사용자·다른 역할의 화면)에서 보이는지, 겹치는·중복 요청이 바르게 처리되는지. "~가 보인다"만 확인하는 AC는 must 기능의 유일한 AC가 될 수 없다.
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
  ACs of a must feature must be OUTCOMES: perform the core task with real data end to end, then the result persists after reload, appears where it should (another user / another role's screen), and conflicting or duplicate requests are handled. An AC that only checks that something is displayed can never be a must feature's only AC.
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
- screens: 1~8개. route(경로)·purpose·components(주요 구성요소)·states(empty/loading/error/success 중 해당하는 것의 문구 — 화면 고유 상태(locked·submitted 등)도 영문 소문자 키로 추가 가능, 12개 이하)·entryFrom·exitTo·featureIds. **priority가 must인 기능은 반드시 어떤 화면 또는 API의 featureIds에 등장**해야 한다.
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
- screens: 1–8. route, purpose, components, states (copy for empty/loading/error/success where applicable; screen-specific states such as locked/submitted are welcome as lowercase keys, max 12), entryFrom, exitTo, featureIds. **Every must feature must appear in the featureIds of at least one screen or API.**
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

const P1_RULES = new Set<IntegrityViolation["rule"]>([
  "ac_unknown_feature",
  "feature_without_ac",
  // D-2 amend: 확인 목록·must는 요구사항(P1)의 일이다.
  "inferred_must_unconfirmed",
  "confirmed_unknown_acceptance",
]);

/**
 * 역추론 P1 스키마: 확인된 항목의 고정 FR id가 **전부** 있어야 한다. 빠지면 스키마 재시도로
 * 돌려보낸다 — 유저가 "반드시"라고 한 것이 지시서에서 조용히 사라지는 것이 가장 나쁜 실패다.
 */
function p1SchemaFor(requiredFeatureIds: readonly string[]) {
  if (requiredFeatureIds.length === 0) return P1Schema;
  return P1Schema.superRefine((d, ctx) => {
    const have = new Set(d.features.map((f) => f.id));
    for (const id of requiredFeatureIds) {
      if (!have.has(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: `${id} (user-confirmed item) is missing — use this feature id verbatim` });
      }
    }
  });
}
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
  // 입력 타입은 unknown — transform이 있는 스키마(default 정규화)도 받는다.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
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
  // D-2 amend: 역추론이면 확인 계획(확인된 항목 → 고정 FR id). generated는 종전 그대로.
  const inferred = input.source === "inferred" ? planInferredConfirmation(items, input.confirmedItemIds) : undefined;
  const confirmedFeatureIds = new Set((inferred?.confirmed ?? []).map((c) => c.featureId));
  const p1Schema = p1SchemaFor([...confirmedFeatureIds]);

  let p1: P1 | undefined;
  let p2: P2 | undefined;
  let p3: P3 | undefined;
  let repaired = false;

  const runFrom = async (start: PassName, carried: string[]): Promise<DevSpecGenResult | null> => {
    const order: PassName[] = ["requirements", "surfaces", "plan"];
    for (const pass of order.slice(order.indexOf(start))) {
      const issues = pass === start ? carried : [];
      if (pass === "requirements") {
        const r = await runPass("requirements", p1Schema, (i) => buildPassPrompt("requirements", locale, { brief, items, idea, inferred, issues: [...issues, ...i] }), call, passes, llmUsage);
        if (!r.ok) return r.error === "llm_unavailable" ? { ok: false, error: "llm_unavailable", passes, llmUsage } : { ok: false, error: "dev_spec_invalid", stage: "schema", issues: r.issues, passes, llmUsage };
        // D-2 amend: 모델이 무엇을 must라고 했든 — 확인된 것만 must(나머지 must는 should로 강등).
        // P2(표면) **전에** 맞춘다: must 기능은 화면·API에 나와야 하는 규칙이 P2에 걸려 있다.
        p1 = inferred ? { ...r.data, features: applyInferredConfirmation(r.data, confirmedFeatureIds).features } : r.data;
      } else if (pass === "surfaces") {
        const r = await runPass("surfaces", P2Schema, (i) => buildPassPrompt("surfaces", locale, { brief, items, idea, inferred, p1, issues: [...issues, ...i] }), call, passes, llmUsage);
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
    meta: {
      version: 1,
      source: input.source,
      locale,
      generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
      // D-2 amend: 역추론은 출처 + 확인 목록(확인된 기능에 딸린 AC 전부)을 함께 싣는다.
      ...(inferred
        ? {
            provenance: {
              ...(input.provenance ?? {}),
              userConfirmedAcIds: applyInferredConfirmation(p1!, confirmedFeatureIds).userConfirmedAcIds,
              userTextAcIds: userTextAcIdsOf(p1!.acceptance, inferred!),
            },
          }
        : {}),
    },
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
