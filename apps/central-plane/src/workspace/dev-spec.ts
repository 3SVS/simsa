/**
 * workspace/dev-spec.ts — T0 개발 지시서(DevSpec) 스키마 + 무결성 검사기.
 *
 * 설계: docs/simsa-si-tier-design-2026-09-24.md **D-2 [LOCKED]**.
 *
 * 왜 따로 있는가: 현행 ProductSpec(9필드)은 사업 브리프이지 지시서가 아니다 —
 * 화면·데이터·API·수용 기준·작업 분해·테스트 계획이 없어 SI 업체도, T1 빌드
 * 에이전트도 "다 됐다"를 판단할 수 없다. DevSpec은 그 판단의 자(尺)다.
 *
 * 규칙:
 *  - Zod at the boundary(CLAUDE.md). 모든 객체는 `.strict()` — 모르는 키는 거부.
 *    특히 숫자 점수 키(score/rating/grade…)는 스키마 밖에서도 한 번 더 결정론으로
 *    잡는다(PRD §5.1 "숫자 점수 절대 금지").
 *  - 무결성은 **결정론**이고 저장 전에 실패한다(D-2 무결성 규칙). LLM 산문이 아니라
 *    id 참조 그래프로 판단한다.
 *  - 현행 ProductSpec은 `brief`로 보존한다(하위호환, 마이그레이션 없음).
 */
import { z } from "zod";

// ─── id 규칙 ─────────────────────────────────────────────────────────────────

const idOf = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}-\\d{3,4}$`), `${prefix}-### 형식이어야 합니다`);

export const FeatureId = idOf("FR");
export const AcceptanceId = idOf("AC");
export const ScreenId = idOf("SCR");
export const ApiId = idOf("API");
export const WbsId = idOf("WBS");

const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(2000);

// ─── 섹션 스키마 ─────────────────────────────────────────────────────────────

export const FeatureSchema = z
  .object({
    id: FeatureId,
    title: shortText,
    description: longText,
    priority: z.enum(["must", "should", "could"]),
  })
  .strict();

export const AcceptanceSchema = z
  .object({
    id: AcceptanceId,
    featureId: FeatureId,
    given: longText,
    when: longText,
    then: longText,
    /** build=컴파일·기동 / test=자동 테스트 / browser=실브라우저 관찰 / human=사람만 판단 가능 */
    verifiedBy: z.enum(["build", "test", "browser", "human"]),
  })
  .strict();

export const ScreenSchema = z
  .object({
    id: ScreenId,
    route: z.string().trim().min(1).max(200),
    purpose: longText,
    components: z.array(shortText).max(40),
    states: z
      .object({
        empty: shortText.optional(),
        loading: shortText.optional(),
        error: shortText.optional(),
        success: shortText.optional(),
      })
      .strict(),
    entryFrom: z.array(shortText).max(20),
    exitTo: z.array(shortText).max(20),
    featureIds: z.array(FeatureId).max(40),
  })
  .strict();

/**
 * `default`: 실제 기본값이 있을 때만 문자열. 모델은 "없음"을 `null`로 자주 보낸다(라이브
 * 2026-09-24: 두 번 연속 null → 422). 스키마가 그걸 "없음"으로 받아들여야지, 재생성 사유가
 * 되면 안 된다 — 사실을 전달하는 방식의 차이일 뿐 내용의 결함이 아니다. "unknown" 문자열도
 * 기본값이 아니므로 같은 취급.
 */
const optionalDefault = z
  .union([z.string().max(200), z.boolean(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    // boolean/number 기본값(`isPublic: false`, `quantity: 1`)은 실제 기본값이다 — 문자열로 정규화해 보존한다
    // (라이브 2026-09-24 두 번째 실측: "Expected string, received boolean" ×2로 ko·en 모두 422).
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (v === null || v === undefined) return undefined;
    const t = v.trim();
    return t === "" || t.toLowerCase() === "unknown" ? undefined : v;
  });

export const EntityFieldSchema = z
  .object({
    name: shortText,
    type: shortText,
    required: z.boolean(),
    default: optionalDefault,
  })
  .strict();

export const EntitySchema = z
  .object({
    name: shortText,
    fields: z.array(EntityFieldSchema).min(1).max(60),
    relations: z
      .array(z.object({ to: shortText, kind: z.enum(["one", "many"]) }).strict())
      .max(30),
    /** RLS 힌트 — 누가 이 행을 소유/열람하는가. 모르면 "unknown". */
    ownership: z.string().trim().min(1).max(200),
  })
  .strict();

export const ApiSchema = z
  .object({
    id: ApiId,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().trim().min(1).max(200),
    request: z.string().max(2000).optional(),
    response: z.string().max(2000).optional(),
    errors: z.array(shortText).max(20),
    auth: z.enum(["none", "user", "admin"]),
    featureIds: z.array(FeatureId).max(40),
  })
  .strict();

export const NonFunctionalSchema = z
  .object({
    kind: z.enum(["performance", "security", "accessibility", "i18n", "cost", "other"]),
    /** 모르면 정확히 "unknown" — 지어내지 않는다. */
    requirement: z.string().trim().min(1).max(500),
  })
  .strict();

export const WorkBreakdownSchema = z
  .object({
    id: WbsId,
    title: shortText,
    order: z.number().int().min(1).max(999),
    dependsOn: z.array(WbsId).max(20),
    acceptanceIds: z.array(AcceptanceId).min(1).max(40),
  })
  .strict();

export const TestPlanEntrySchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("browser"),
        acceptanceId: AcceptanceId,
        steps: z.array(shortText).min(1).max(30),
      })
      .strict(),
    z
      .object({
        kind: z.literal("test"),
        acceptanceId: AcceptanceId,
        testName: shortText,
      })
      .strict(),
  ]);

export const DevSpecMetaSchema = z
  .object({
    version: z.literal(1),
    /** generated=앞에서 생성 / inferred=기존 앱에서 역추론 / manual=사람이 편집 */
    source: z.enum(["generated", "inferred", "manual"]),
    locale: z.enum(["ko", "en"]),
    generatedAt: z.string().datetime(),
  })
  .strict();

/** 현행 ProductSpec(9필드)을 그대로 보존 — 느슨하게 받되 객체여야 한다. */
export const BriefSchema = z
  .object({
    productName: z.string().default(""),
    oneLine: z.string().default(""),
    targetUsers: z.array(z.string()).default([]),
    problem: z.string().default(""),
    included: z.array(z.string()).default([]),
    excluded: z.array(z.string()).default([]),
    userFlow: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    openQuestions: z.array(z.string()).default([]),
  })
  .strict();

export const DevSpecSchema = z
  .object({
    meta: DevSpecMetaSchema,
    brief: BriefSchema,
    features: z.array(FeatureSchema).min(1).max(60),
    acceptance: z.array(AcceptanceSchema).min(1).max(200),
    screens: z.array(ScreenSchema).max(60),
    dataModel: z.array(EntitySchema).max(60),
    apis: z.array(ApiSchema).max(120),
    nonFunctional: z.array(NonFunctionalSchema).max(30),
    workBreakdown: z.array(WorkBreakdownSchema).min(1).max(120),
    testPlan: z.array(TestPlanEntrySchema).max(200),
    assumptions: z.array(longText).max(40),
    openQuestions: z.array(longText).max(40),
  })
  .strict();

export type DevSpec = z.infer<typeof DevSpecSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Acceptance = z.infer<typeof AcceptanceSchema>;

// ─── 숫자 점수 금지(PRD §5.1) — 스키마와 별개로 결정론 스캔 ──────────────────

const SCORE_KEY = /^(score|scores|rating|ratings|grade|grades|points|percent|percentage)$/i;

/** 객체 트리에서 점수류 키를 찾는다. 경로를 돌려준다(빈 배열 = 없음). */
export function findScoreLikeKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findScoreLikeKeys(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SCORE_KEY.test(k)) out.push(`${path}.${k}`);
      out.push(...findScoreLikeKeys(v, `${path}.${k}`));
    }
    return out;
  }
  return [];
}

// ─── 무결성(D-2) ─────────────────────────────────────────────────────────────

export type IntegrityViolation = {
  rule:
    | "duplicate_id"
    | "ac_unknown_feature"
    | "feature_without_ac"
    | "must_feature_without_surface"
    | "screen_unknown_feature"
    | "api_unknown_feature"
    | "wbs_unknown_acceptance"
    | "wbs_unknown_dependency"
    | "wbs_self_dependency"
    | "wbs_dependency_cycle"
    | "acceptance_without_test_plan"
    | "test_plan_unknown_acceptance"
    | "score_like_key";
  /** 기계가 만든 위치 표식(id 또는 경로). 사람이 읽는 문장은 렌더러 몫. */
  where: string;
};

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) out.add(id);
    seen.add(id);
  }
  return [...out];
}

/**
 * 결정론 무결성 검사. 위반이 하나라도 있으면 저장하지 않는다(D-2).
 * 순수 함수 — 테스트 픽스처로 고정.
 */
export function checkDevSpecIntegrity(spec: DevSpec): IntegrityViolation[] {
  const v: IntegrityViolation[] = [];

  const frIds = spec.features.map((f) => f.id);
  const acIds = spec.acceptance.map((a) => a.id);
  const scrIds = spec.screens.map((s) => s.id);
  const apiIds = spec.apis.map((a) => a.id);
  const wbsIds = spec.workBreakdown.map((w) => w.id);
  for (const id of dupes([...frIds, ...acIds, ...scrIds, ...apiIds, ...wbsIds])) {
    v.push({ rule: "duplicate_id", where: id });
  }

  const frSet = new Set(frIds);
  const acSet = new Set(acIds);
  const wbsSet = new Set(wbsIds);

  // 모든 AC는 정확히 1개 FR에 연결(스키마가 단일 featureId를 강제하므로 존재만 확인)
  for (const a of spec.acceptance) {
    if (!frSet.has(a.featureId)) v.push({ rule: "ac_unknown_feature", where: `${a.id}→${a.featureId}` });
  }

  // 모든 FR은 ≥1 AC
  const acByFeature = new Map<string, number>();
  for (const a of spec.acceptance) acByFeature.set(a.featureId, (acByFeature.get(a.featureId) ?? 0) + 1);
  for (const f of spec.features) {
    if (!acByFeature.get(f.id)) v.push({ rule: "feature_without_ac", where: f.id });
  }

  // 화면·API의 featureIds는 존재해야 하고, must FR은 ≥1 SCR 또는 API에 등장
  const surfaced = new Set<string>();
  for (const s of spec.screens) {
    for (const fid of s.featureIds) {
      if (!frSet.has(fid)) v.push({ rule: "screen_unknown_feature", where: `${s.id}→${fid}` });
      else surfaced.add(fid);
    }
  }
  for (const a of spec.apis) {
    for (const fid of a.featureIds) {
      if (!frSet.has(fid)) v.push({ rule: "api_unknown_feature", where: `${a.id}→${fid}` });
      else surfaced.add(fid);
    }
  }
  for (const f of spec.features) {
    if (f.priority === "must" && !surfaced.has(f.id)) v.push({ rule: "must_feature_without_surface", where: f.id });
  }

  // WBS: 고아 없음 — AC 참조 존재, 의존 존재, 자기의존 없음, 순환 없음
  for (const w of spec.workBreakdown) {
    for (const aid of w.acceptanceIds) {
      if (!acSet.has(aid)) v.push({ rule: "wbs_unknown_acceptance", where: `${w.id}→${aid}` });
    }
    for (const d of w.dependsOn) {
      if (d === w.id) v.push({ rule: "wbs_self_dependency", where: w.id });
      else if (!wbsSet.has(d)) v.push({ rule: "wbs_unknown_dependency", where: `${w.id}→${d}` });
    }
  }
  for (const id of findWbsCycle(spec.workBreakdown)) v.push({ rule: "wbs_dependency_cycle", where: id });

  // 테스트 계획: 기계 검증 AC(browser|test)는 계획이 있어야 한다. human은 면제.
  const planned = new Set(spec.testPlan.map((t) => t.acceptanceId));
  for (const a of spec.acceptance) {
    if ((a.verifiedBy === "browser" || a.verifiedBy === "test") && !planned.has(a.id)) {
      v.push({ rule: "acceptance_without_test_plan", where: a.id });
    }
  }
  for (const t of spec.testPlan) {
    if (!acSet.has(t.acceptanceId)) v.push({ rule: "test_plan_unknown_acceptance", where: t.acceptanceId });
  }

  for (const p of findScoreLikeKeys(spec)) v.push({ rule: "score_like_key", where: p });

  return v;
}

/** 의존 그래프의 순환에 속한 WBS id(정렬). 순환 없으면 빈 배열. */
function findWbsCycle(items: DevSpec["workBreakdown"]): string[] {
  const deps = new Map(items.map((w) => [w.id, w.dependsOn.filter((d) => d !== w.id)]));
  const state = new Map<string, 0 | 1 | 2>();
  const inCycle = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      const at = stack.indexOf(id);
      for (const x of stack.slice(at === -1 ? 0 : at)) inCycle.add(x);
      return;
    }
    if (st === 2) return;
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d);
    stack.pop();
    state.set(id, 2);
  };
  for (const id of deps.keys()) visit(id);
  return [...inCycle].sort();
}

// ─── 경계 함수 ───────────────────────────────────────────────────────────────

export type DevSpecValidation =
  | { ok: true; spec: DevSpec }
  | { ok: false; stage: "schema"; issues: string[] }
  | { ok: false; stage: "integrity"; issues: IntegrityViolation[] };

/** 스키마 → 무결성 순서로 검사. 어느 한쪽이라도 실패하면 저장 금지. */
export function validateDevSpec(input: unknown): DevSpecValidation {
  const parsed = DevSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 40)
      .map((i) => `${i.path.join(".") || "$"}: ${i.message}`);
    return { ok: false, stage: "schema", issues };
  }
  const violations = checkDevSpecIntegrity(parsed.data);
  if (violations.length > 0) return { ok: false, stage: "integrity", issues: violations };
  return { ok: true, spec: parsed.data };
}

/**
 * 초보자 화면용 4줄 요약(D-17): 무엇을 만들지 · 화면 N개 · 저장하는 것 N가지 ·
 * 이번엔 안 만드는 것. 숫자는 개수이지 점수가 아니다.
 */
export function summarizeForBeginner(spec: DevSpec): {
  what: string;
  screenCount: number;
  entityCount: number;
  excluded: string[];
  mustFeatureTitles: string[];
} {
  return {
    what: spec.brief.oneLine || spec.brief.productName,
    screenCount: spec.screens.length,
    entityCount: spec.dataModel.length,
    excluded: spec.brief.excluded,
    mustFeatureTitles: spec.features.filter((f) => f.priority === "must").map((f) => f.title),
  };
}
