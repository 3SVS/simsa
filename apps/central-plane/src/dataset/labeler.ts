/**
 * dataset/labeler.ts — 라벨링 에이전트 패스 → 라벨 행 (train L2, 2026-10-27).
 *
 * 설계 §0.0(2026-10-21 잠금): 라벨러 = Simsa 라벨링 에이전트. 검수 엔진과 **분리된 모드**로 돌린다 —
 *   - 실행: 같은 v2 실행기를 `profile:"labeler"`로(블라인드: 엔진의 정적 사실·가설·이전 계획을 보지 않는다 · 고치기 없음 ·
 *     확정된 실패는 새 브라우저에서 3번 다시 해 재현성 R을 센다) — inspector-container/agent-v2-run.mjs
 *   - 두 패스는 **서로 다른 벤더**(같은 모델 두 번은 이중 라벨이 아니다) — 패스마다 passId·vendor·model을 행에 단다
 *   - 정확도는 **사전 등록 정답지로만** 잰다(gold.ts) — 검수 엔진과의 일치율은 정확도가 아니다
 * 행 모양은 기계 후보와 같은 변환(machine-candidates.ts)에서 출발하고, 라벨러만 가진 것(재현성 R · H2 사유 · 확신도 ·
 * 실패 사건 칸을 같은 벤더 모델이 증거에서 다시 고른 값)을 얹는다. 출처는 labeler_agent — 기계 행을 덮어쓰지 않는다(L-D9).
 */
import { z } from "zod";
import { DEFECT_CLASSES } from "../agent-inspection.js";
import { machineCandidatesFromV2Report } from "./machine-candidates.js";
import {
  A_ATTRIBUTION, C_CAUSE_LAYERS, S_SEVERITY, W1_STAGES, W3_ACTIONS, X_FIX_SCOPE, Y_SYMPTOMS,
  type AcLabel, type FailureEvent,
} from "./labels.js";

export const LABELER_REV = "labeler-v1";

export interface LabelerPass {
  /** 패스 표지 — 예 "A"(OpenAI) · "B"(Anthropic). 같은 런의 두 패스를 가른다 */
  passId: string;
  vendor: string;
  model: string;
}

interface VerdictLike {
  acId: string;
  verdict: string;
  confirmed?: boolean;
  reasons?: string[];
  claim?: string;
  quotes?: string[];
  repro?: { k: number; n: number };
  evidence?: Array<{ id?: string; kind?: string; summary?: string; excerpt?: string }>;
}
interface ReportLike {
  engineVersion?: string;
  acTable?: Array<{ id: string; priority?: string; status?: string; actions?: string[] }>;
  v2?: { profile?: string; runnerRev?: string | null; verdicts?: VerdictLike[]; entry?: { cause: string; status?: number | null } | null; defectGroups?: Array<{ key: string; acIds: string[] }>; fix?: { validated?: string[]; cannotFix?: string[] } | null };
}
interface AcLike {
  id: string;
  title?: string;
  given?: string;
  when?: string;
  then?: string;
  priority?: string;
}

/** 재현성(§3 R): 3번 이상 다 나면 always, 일부만 나면 sometimes. 횟수가 모자라면 단정하지 않는다(null — reproduced에 남는다). */
export function reproClass(repro: { k: number; n: number } | undefined): FailureEvent["r"] {
  if (!repro || repro.n < 1) return null;
  if (repro.k >= repro.n && repro.n >= 3) return "always";
  if (repro.k >= 1 && repro.k < repro.n) return "sometimes";
  return null;
}

/**
 * 확인 못 한 기준의 사유(§2 H2). 라벨러가 막힌 곳을 판정 문장에서 고르고, 실행 쪽 사유(시간·모델 오류·재현 안 됨)는
 * labeler_limit(라벨러가 못 함)로 둔다 — 앱 탓으로 적지 않는다.
 */
export function h2For(claim: string, reasons: string[]): NonNullable<AcLabel["h2"]> {
  const t = claim ?? "";
  if (reasons.includes("closing_slot_interpretation")) return "criterion_ambiguous";
  if (/결제|카드 (번호|정보)|payment|checkout/i.test(t)) return "payment_wall";
  if (/카카오|네이버|구글|문자|인증번호|sms|oauth|otp/i.test(t)) return "sms_or_oauth";
  if (/api ?키|api key|openai|키를 (넣|입력)/i.test(t)) return "needs_own_api_key";
  if (/로그인|회원가입|sign ?in|log ?in/i.test(t)) return "login_wall";
  if (/모호|애매|ambiguous|unclear criterion/i.test(t)) return "criterion_ambiguous";
  if (/(만들|준비할) 수 없|전제|precondition/i.test(t)) return "precondition_unbuildable";
  return "labeler_limit";
}

/**
 * 라벨러 실행 결과(buildV2Report로 만든 리포트, report.v2.profile === "labeler") → 라벨 행.
 * 라벨러 모드가 아닌 리포트는 받지 않는다 — 검수 엔진 결과를 라벨러 라벨로 바꿔 적는 사고를 막는다.
 */
export function labelerRowsFromV2Report(
  report: ReportLike,
  ctx: { runId: string; appId: string; createdAt: string; acs?: AcLike[] },
  pass: LabelerPass,
): { acLabels: AcLabel[]; failureEvents: FailureEvent[] } {
  if (report?.engineVersion !== "v2" || report.v2?.profile !== "labeler") return { acLabels: [], failureEvents: [] };
  const m = machineCandidatesFromV2Report(report, ctx);
  const verdicts = new Map((report.v2.verdicts ?? []).map((v) => [v.acId, v]));
  const producer = `${LABELER_REV}:${pass.passId}`;
  const own = { source: "labeler_agent" as const, producer, model: pass.model.slice(0, 80) };
  const labelId = (acId: string) => `${ctx.runId}:${acId}:${pass.passId}`;

  const acLabels: AcLabel[] = m.acLabels.map((l) => {
    const { machineReasons: _m, ...rest } = l;
    const v = verdicts.get(l.acId);
    const reasons = v?.reasons ?? [];
    const h2 = l.h1 === "cannot_verify" ? (l.h2 ?? h2For(v?.claim ?? "", reasons)) : null;
    // 확신도(H3): 재실행으로 확정 못 했으면 unsure(→ 이중 라벨 대상), 실패는 3번 다 나야 sure.
    const h3: AcLabel["h3"] =
      l.h1 === "cannot_verify" ? "mostly"
      : v?.confirmed !== true ? "unsure"
      : l.h1 === "fail" ? (reproClass(v.repro) === "always" ? "sure" : "mostly")
      : "sure";
    return { ...rest, ...own, labelId: labelId(l.acId), h2, h3 };
  });
  const failureEvents: FailureEvent[] = m.failureEvents.map((e) => {
    const v = verdicts.get(e.acId);
    const repro = v?.repro;
    return {
      ...e,
      ...own,
      failureId: `${e.failureId.replace(/:F(\d+)$/, "")}:${pass.passId}:F${/:F(\d+)$/.exec(e.failureId)?.[1] ?? "1"}`,
      labelId: labelId(e.acId),
      r: reproClass(repro),
      ...(repro ? { reproduced: { k: Math.min(repro.k, 10), n: Math.min(Math.max(repro.n, 1), 10) } } : {}),
    };
  });
  return { acLabels, failureEvents };
}

// ── 실패 사건 칸을 라벨러가 다시 고르기 ─────────────────────────────────────────────
// 기계 변환은 결정론 규칙(정규식)으로 단계·증상을 고른다. 라벨러는 같은 패스의 모델이 자기 증거(판정 문장·인용·행동·화면)를
// 보고 닫힌 어휘에서 다시 고른다 — 답이 어휘 밖이거나 깨지면 그 칸은 규칙 값 그대로 둔다(칸마다 따로).

export const LabelerEventChoice = z
  .object({
    w1: z.enum(W1_STAGES),
    w3: z.enum(W3_ACTIONS),
    y: z.enum(Y_SYMPTOMS),
    c: z.enum(C_CAUSE_LAYERS),
    k: z.enum(DEFECT_CLASSES),
    s: z.enum(S_SEVERITY),
    a: z.enum(A_ATTRIBUTION),
    p: z.boolean(),
    x: z.enum(X_FIX_SCOPE),
    memo: z.string().max(400),
  })
  .partial();
export type LabelerEventChoice = z.infer<typeof LabelerEventChoice>;

const list = (xs: readonly string[]) => xs.join(" | ");

/** 라벨러에게 실패 사건 하나의 칸을 묻는 프롬프트. 기계 판정·다른 패스 라벨은 넣지 않는다(블라인드). */
export function labelerEventPrompt(args: {
  ac: AcLike;
  claim: string;
  quotes: string[];
  actions: string[];
  evidence: string[];
  repro?: { k: number; n: number };
  locale?: "ko" | "en";
}): { system: string; user: string } {
  const system = [
    "You label ONE failure event for a dataset of where AI-built apps fail. You observed it yourself in a real browser.",
    "Pick each field from its closed list only. Reply with one JSON object, no prose.",
    "Rules (labeling rubric v1):",
    "- w1 = the journey step where the user could not get the result (the FIRST point; later steps you could not reach are not separate events).",
    "- y = what the user SAW. c = cause layer ONLY if your evidence shows it (a console/network error, a setup message, storage behaviour); otherwise \"unknown\".",
    "- s: S1 = the core job is impossible for every user · S2 = impossible only for some condition/role (other visitor, owner screen, after reload, a specific time) · S3 = works but wrong/inconvenient (workaround exists) · S4 = cosmetic/wording.",
    "- a: builder unless the criterion text itself is ambiguous (spec_ambiguous), the request never asked for it (prompt_gap), an external service is down (external), or you suspect your own tooling (equipment_suspect).",
    "- p (potemkin) = true when the app LOOKS done (success message, item shown briefly) but the result is not really there.",
    "- x = fix scope guess: config_only | small_code | structural | unknown.",
    "- memo = one short sentence in the user's language: what failed, where.",
    `Fields: w1: ${list(W1_STAGES)} · w3: ${list(W3_ACTIONS)} · y: ${list(Y_SYMPTOMS)} · c: ${list(C_CAUSE_LAYERS)} · k: ${list(DEFECT_CLASSES)} · s: ${list(S_SEVERITY)} · a: ${list(A_ATTRIBUTION)} · p: true|false · x: ${list(X_FIX_SCOPE)}`,
  ].join("\n");
  const ac = args.ac;
  const user = [
    `Criterion ${ac.id}: ${ac.title ?? ""}`,
    ac.given ? `Given: ${ac.given}` : "",
    ac.when ? `When: ${ac.when}` : "",
    ac.then ? `Then: ${ac.then}` : "",
    `What you concluded: ${args.claim}`,
    args.quotes.length ? `Screen text you quoted: ${args.quotes.slice(0, 6).map((q) => JSON.stringify(q.slice(0, 200))).join(" · ")}` : "",
    args.actions.length ? `Your steps: ${args.actions.slice(0, 20).join(" → ")}` : "",
    args.evidence.length ? `Evidence:\n${args.evidence.slice(0, 8).map((e) => `- ${e.slice(0, 300)}`).join("\n")}` : "",
    args.repro ? `Replayed in a fresh browser: failed ${args.repro.k} of ${args.repro.n} times.` : "",
    'JSON: {"w1":"…","w3":"…","y":"…","c":"…","k":"…","s":"…","a":"…","p":false,"x":"…","memo":"…"}',
  ].filter(Boolean).join("\n");
  return { system, user };
}

/** 모델 답 → 칸별 선택. 어휘 밖 칸은 버린다(나머지 칸은 쓴다). JSON이 없으면 빈 선택. */
export function parseLabelerEventChoice(text: string): LabelerEventChoice {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ""));
  if (!m) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  const shape = LabelerEventChoice.shape;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = (shape as Record<string, z.ZodTypeAny>)[k];
    if (!field) continue;
    const r = field.safeParse(v);
    if (r.success && r.data !== undefined) out[k] = r.data;
  }
  return out as LabelerEventChoice;
}

/**
 * 실패 사건마다 라벨러 모델에게 칸을 다시 묻는다(호출 실패·깨진 답이면 규칙 값 그대로). 원인 층 c는 근거 규칙을 지킨다 —
 * 모델이 근거 없이 원인을 댔는지는 여기서 알 수 없으니, 규칙 값이 unknown이고 증거에 콘솔·네트워크·설정 문구가 없으면 unknown 유지.
 */
export async function refineEventsWithLabeler(
  events: FailureEvent[],
  report: ReportLike,
  acs: AcLike[],
  llm: (a: { system: string; user: string; maxTokens?: number }) => Promise<string>,
): Promise<{ events: FailureEvent[]; calls: number; failed: number }> {
  const verdicts = new Map((report.v2?.verdicts ?? []).map((v) => [v.acId, v]));
  const rows = new Map((report.acTable ?? []).map((r) => [r.id, r]));
  const acMap = new Map(acs.map((a) => [a.id, a]));
  let calls = 0;
  let failed = 0;
  const out: FailureEvent[] = [];
  for (const e of events) {
    const v = verdicts.get(e.acId);
    const ac = acMap.get(e.acId) ?? { id: e.acId };
    if (!v || e.acId === "entry") {
      out.push(e);
      continue;
    }
    const evidence = (v.evidence ?? []).map((x) => `${x.kind ?? ""} ${x.summary ?? ""}${x.excerpt ? ` — ${x.excerpt}` : ""}`.trim());
    const { system, user } = labelerEventPrompt({ ac, claim: v.claim ?? "", quotes: v.quotes ?? [], actions: rows.get(e.acId)?.actions ?? [], evidence, ...(v.repro ? { repro: v.repro } : {}) });
    calls += 1;
    let choice: LabelerEventChoice = {};
    try {
      choice = parseLabelerEventChoice(await llm({ system, user, maxTokens: 600 }));
    } catch {
      failed += 1;
    }
    const observed = evidence.some((x) => /^console|ERR_|failed to (load|fetch)|\b[45]\d\d\b|설정|연결|config/i.test(x));
    out.push({
      ...e,
      ...(choice.w1 ? { w1: choice.w1 } : {}),
      ...(choice.w3 ? { w3: choice.w3 } : {}),
      ...(choice.y ? { y: choice.y } : {}),
      ...(choice.c && (choice.c === "unknown" || observed || e.c !== "unknown") ? { c: choice.c } : {}),
      ...(choice.k ? { k: choice.k } : {}),
      ...(choice.s ? { s: choice.s } : {}),
      ...(choice.a ? { a: choice.a } : {}),
      ...(choice.p !== undefined ? { p: choice.p } : {}),
      ...(choice.x ? { x: choice.x } : {}),
      ...(choice.memo ? { memo: choice.memo.slice(0, 400) } : {}),
    });
  }
  return { events: out, calls, failed };
}
