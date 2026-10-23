/**
 * dataset/labels.ts — 실패 데이터 라벨 스키마 v1 (train L1, 2026-10-24).
 *
 * 규약 정본: docs/simsa-labeling-design-2026-10-20.md (2026-10-21 `design lock approved`) — 이 파일은 그 §1~§3·§7·§9를
 * 코드로 옮긴 것이다. 어휘를 바꾸려면 설계 문서를 먼저 고친다(§3.3 승격 규칙, 버전을 올리고 이전 행은 그대로).
 *   - 다섯 층(L-D1): 앱 카드 · 여정 · 기준 · 판정(H) · 실패 사건(F)
 *   - 출처 분리(L-D9·§7): machine(검수 엔진 후보) · labeler_agent(라벨링 에이전트 패스) · user(사용자 마이크로 라벨) — 서로 덮어쓰지 않는다
 *   - 버전 4개(L-D7): 스키마 · 택소노미 · 축 · 루브릭 — 모든 행에
 *   - append-only: 고치면 새 행 + supersedes
 * 외부 경계(저장·내보내기)는 이 Zod로만 통과시킨다(CLAUDE.md "Zod at every external boundary").
 */
import { z } from "zod";
import { DEFECT_CLASSES } from "../agent-inspection.js";

export const LABEL_VERSIONS = Object.freeze({
  labelSchema: "1",
  taxonomy: "defect-v1",
  axes: "index-design-2026-10-18",
  rubric: "labeling-v1-2026-10-21",
});

export const LABEL_SOURCES = ["machine", "labeler_agent", "user"] as const;

// §2 판정(H)
export const H1_VERDICTS = ["pass", "fail", "cannot_verify", "not_applicable"] as const;
export const H2_CANNOT_VERIFY = [
  "login_wall", "payment_wall", "sms_or_oauth", "needs_own_api_key", "precondition_unbuildable",
  "app_down", "criterion_ambiguous", "time_window", "labeler_limit",
] as const;
export const H3_CONFIDENCE = ["sure", "mostly", "unsure"] as const;
export const H4_SCOPE = ["full", "public_only"] as const;

// §3 실패 사건(F)
export const W1_STAGES = ["entry", "navigate", "select", "input", "submit", "result", "persist", "share", "admin", "modify", "notify", "integration"] as const;
export const W3_ACTIONS = ["click", "fill", "select", "reload", "new_browser", "time_change", "role_switch", "none"] as const;
export const Y_SYMPTOMS = [
  "no_response", "error_message", "blank_screen", "wrong_result", "not_saved", "not_visible_to_others", "wrong_date_time",
  "broken_text", "integration_failed", "fake_result", "setup_required_message", "secret_exposed", "rule_violated", "other",
] as const;
export const C_CAUSE_LAYERS = [
  "ui", "client_state", "backend_missing", "browser_only_storage", "auth", "external_integration", "timezone",
  "encoding_locale", "routing_deploy", "spec_not_implemented", "unknown",
] as const;
export const S_SEVERITY = ["S1", "S2", "S3", "S4"] as const;
export const R_REPRO = ["always", "sometimes", "once", "conditional"] as const;
export const A_ATTRIBUTION = ["builder", "spec_ambiguous", "prompt_gap", "external", "equipment_suspect"] as const;
export const X_FIX_SCOPE = ["config_only", "small_code", "structural", "unknown"] as const;

const versions = z.object({
  labelSchema: z.literal(LABEL_VERSIONS.labelSchema),
  taxonomy: z.string().min(1).max(40),
  axes: z.string().min(1).max(40),
  rubric: z.string().min(1).max(40),
});

const rowBase = {
  source: z.enum(LABEL_SOURCES),
  /** 라벨을 단 것의 정체 — machine: 엔진 rev(예 agent-v2-1) · labeler_agent: 패스 id + 모델 · user: 가명 사용자 키 해시 */
  producer: z.string().min(1).max(120),
  /** 모델 id(기계·에이전트 패스). 사용자 라벨은 없음 */
  model: z.string().max(80).optional(),
  createdAt: z.string().min(10).max(40),
  supersedes: z.string().max(80).optional(),
  versions,
};

/** 근거 한 조각 — 증거물 id(런 범위) + 화면 글자 인용(개인정보는 저장 전에 가린다). */
export const EvidenceRef = z.object({
  artifactId: z.string().regex(/^E[1-9]\d{0,4}$/).optional(),
  kind: z.string().max(20).optional(),
  quote: z.string().max(300),
});

/** §2 기준 하나의 판정(H). */
export const AcLabel = z
  .object({
    labelId: z.string().min(1).max(80),
    runId: z.string().min(1).max(80),
    appId: z.string().min(1).max(80),
    acId: z.string().min(1).max(40),
    acHash: z.string().max(80).optional(),
    priority: z.enum(["must", "should", "could"]).optional(),
    h1: z.enum(H1_VERDICTS),
    h2: z.enum(H2_CANNOT_VERIFY).nullable(),
    h3: z.enum(H3_CONFIDENCE),
    h4: z.enum(H4_SCOPE),
    h5: z.array(EvidenceRef).max(10),
    h6: z.array(z.string().max(200)).max(30),
    h8: z.string().max(400).optional(),
    /** 기계 후보 전용 — 기계가 못 본 이유(대응표 밖 사유, §7). 사람·에이전트 라벨에는 없다 */
    machineReasons: z.array(z.string().max(60)).max(10).optional(),
    ...rowBase,
  })
  .superRefine((v, ctx) => {
    if (v.h1 === "cannot_verify" && v.h2 === null && v.source !== "machine") ctx.addIssue({ code: "custom", message: "h2_required_for_cannot_verify" });
    if (v.h1 !== "cannot_verify" && v.h2 !== null) ctx.addIssue({ code: "custom", message: "h2_only_for_cannot_verify" });
    // §2 H5: pass·fail 모두 증거 필수 — 증거 없는 라벨은 데이터셋에 넣지 않는다.
    if ((v.h1 === "pass" || v.h1 === "fail") && v.h5.length === 0) ctx.addIssue({ code: "custom", message: "evidence_required" });
  });
export type AcLabel = z.infer<typeof AcLabel>;

/** §3 실패 사건(F) — 사용자가 결과를 못 얻는 한 지점. */
export const FailureEvent = z.object({
  failureId: z.string().min(1).max(80),
  labelId: z.string().min(1).max(80),
  runId: z.string().min(1).max(80),
  appId: z.string().min(1).max(80),
  acId: z.string().min(1).max(40),
  w1: z.enum(W1_STAGES),
  w2: z.string().max(120),
  w3: z.enum(W3_ACTIONS),
  y: z.enum(Y_SYMPTOMS),
  c: z.enum(C_CAUSE_LAYERS),
  k: z.enum(DEFECT_CLASSES),
  s: z.enum(S_SEVERITY),
  /** 사람·에이전트는 3회 재현으로 정한다. 기계는 재실행 횟수만 안다 — 값을 단정하지 않고 reproduced에 적는다 */
  r: z.enum(R_REPRO).nullable(),
  reproduced: z.object({ k: z.number().int().min(0).max(10), n: z.number().int().min(1).max(10) }).optional(),
  a: z.enum(A_ATTRIBUTION),
  p: z.boolean(),
  x: z.enum(X_FIX_SCOPE).optional(),
  /** 원인 위치(파일·줄) — 기계 원인 근거(S6b) */
  location: z.object({ file: z.string().max(200), line: z.number().int().nullable() }).nullable().optional(),
  /** 기계 결함 묶음 열쇠(S5c 첫 지점 규칙) — 같은 열쇠 = 같은 결함, 실패율 분자에는 묶음당 1 */
  defectGroup: z.string().max(80).optional(),
  memo: z.string().max(400).optional(),
  ...rowBase,
});
export type FailureEvent = z.infer<typeof FailureEvent>;

/** §1.1 앱 카드(라벨 행이 가리키는 앱 하나). 축 X1~X9는 index-design §5.1, 아는 것만. */
export const AppCard = z.object({
  appId: z.string().min(1).max(80),
  hostingHost: z.string().max(120).optional(),
  builder: z.string().max(40).optional(),
  locale: z.string().max(10).optional(),
  region: z.string().max(10).optional(),
  buildDate: z.string().max(40).optional(),
  builderVersion: z.string().max(80).optional(),
  editRounds: z.number().int().min(0).max(100).optional(),
  stack: z
    .object({
      hosting: z.string().max(40).optional(),
      dataStore: z.enum(["supabase", "firebase", "browser_only", "none", "unknown"]).optional(),
      auth: z.string().max(40).optional(),
    })
    .optional(),
  snapshotAt: z.string().max(40),
  ...rowBase,
});
export type AppCard = z.infer<typeof AppCard>;
