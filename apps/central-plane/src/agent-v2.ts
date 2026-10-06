/**
 * agent-v2.ts — 검사 엔진 v2(engine "agent_v2")의 순수 로직. 설계 정본: docs/simsa-inspector-v2-design-2026-10-07.md.
 *
 * 원칙 #0: 어떤 모델도 한 번에 맞히지 못한다 → 판정은 *가설 → 실행 → 관찰 → 수정* 고리에서 나온 **관찰된 증거물**로만.
 * 이 파일은 그 고리의 규칙을 **기계로 강제**하는 부분이다(LLM 없음). 모델이 무엇이라고 말하든 판정은 증거물 id에 묶이고,
 * 증거물 원문에 판정의 핵심 값이 실제로 있어야 한다.
 *
 *   S1 증거물 저장소(EvidenceStore) · 판정 스키마 · 기계 검증기(validateV2Verdict) · 인용률
 *
 * 컨테이너 이미지 안에서도 같은 파일을 컴파일해 쓴다(Dockerfile — agent-inspection.ts와 함께).
 */
import { failReasonIsOutcome, type AcReasonCode, type AgentAc } from "./agent-inspection.js";

export const AGENT_V2_RUNNER_REV = "agent-v2-1";

// ─── S1 증거물 저장소 ─────────────────────────────────────────────────────────

/**
 * 증거물 종류(설계 §2.1):
 *   request  — 네트워크 요청·응답 기록        storage — 브라우저 저장소 내용
 *   source   — 소스·번들 코드 조각            console — 콘솔 오류·잡히지 않은 예외
 *   diff     — 조작 전후 화면 차이(행동 결과)  context — 다른 브라우저·기기·역할에서 본 화면
 *   screen   — 지금 화면(접근성·글자)          plan    — 가설·계획(재검사 때 재사용, 판정 근거는 아님)
 */
export const ARTIFACT_KINDS = ["request", "storage", "source", "console", "diff", "context", "screen", "plan"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  /** 기록 순서(런 안에서 단조 증가). */
  at: number;
  tool: string;
  /** 몇 번째 브라우저(0 = 처음, 새 브라우저마다 +1). */
  context: number;
  /** 이 브라우저에서 사용자처럼 행동(클릭·입력·선택·키·이동·시계·화면 폭)한 뒤인가. */
  interacted: boolean;
  /** 이 런에서 입력 뒤 제출(클릭·엔터)이 한 번이라도 있은 뒤인가 = 앱 상태를 실제로 바꾸려 한 뒤. */
  afterSubmit: boolean;
  /** 처음 제출이 일어난 브라우저 번호(없으면 null). */
  firstSubmitContext: number | null;
  /**
   * 상태 변화 종류의 증거물인가(V-2): 쓰기 요청 2xx · 저장소 변화 · 조작 전후 화면 차이 · 다른 브라우저에서 본 화면(제출 뒤).
   * 실행기가 잰다(모델 말이 아님).
   */
  stateChange: boolean;
  /** 사람이 읽는 요약(리포트 근거 줄). */
  summary: string;
  /** 원문(잘라서 보관) — 기계 검증기가 판정의 핵심 값을 여기서 찾는다. */
  raw: string;
}

export const ARTIFACT_RAW_MAX = 24_000;

export type V2ActionKind = "click" | "fill" | "select" | "press" | "navigate" | "back" | "reload" | "wait" | "clock" | "viewport";

/**
 * 런 하나의 증거물 저장소 + 브라우저 상태 기계. 실행기(컨테이너)가 도구 결과마다 add()하고, 판정은 이 저장소의 id로만 인용한다.
 * 제출 판정: 입력(fill·select) 뒤의 클릭·엔터 = 제출. 새 브라우저는 상호작용·입력 대기를 지운다(제출 이력은 런 전체에 남는다).
 */
export class EvidenceStore {
  private seq = 0;
  private readonly map = new Map<string, Artifact>();
  context = 0;
  interacted = false;
  pendingInput = false;
  submittedEver = false;
  firstSubmitContext: number | null = null;

  /** 행동 하나를 반영. 반환: 이 행동이 제출이었는가. */
  noteAction(kind: V2ActionKind): { submitted: boolean } {
    if (kind === "wait") return { submitted: false };
    this.interacted = true;
    if (kind === "fill" || kind === "select") {
      this.pendingInput = true;
      return { submitted: false };
    }
    if ((kind === "click" || kind === "press") && this.pendingInput) {
      this.pendingInput = false;
      this.submittedEver = true;
      if (this.firstSubmitContext === null) this.firstSubmitContext = this.context;
      return { submitted: true };
    }
    return { submitted: false };
  }

  newContext(): number {
    this.context += 1;
    this.interacted = false;
    this.pendingInput = false;
    return this.context;
  }

  add(kind: ArtifactKind, tool: string, o: { summary: string; raw?: string; stateChange?: boolean }): Artifact {
    this.seq += 1;
    const a: Artifact = {
      id: `ev-${this.seq}`,
      kind,
      at: this.seq,
      tool,
      context: this.context,
      interacted: this.interacted,
      afterSubmit: this.submittedEver,
      firstSubmitContext: this.firstSubmitContext,
      stateChange: o.stateChange === true,
      summary: String(o.summary ?? "").slice(0, 500),
      raw: String(o.raw ?? o.summary ?? "").slice(0, ARTIFACT_RAW_MAX),
    };
    this.map.set(a.id, a);
    return a;
  }

  get(id: string): Artifact | undefined {
    return this.map.get(id);
  }

  all(): Artifact[] {
    return [...this.map.values()];
  }

  get size(): number {
    return this.map.size;
  }
}

/** 단단한 증거물인가 — 앱이 실제로 한 일/가진 것을 보여 준다. 처음 열린 화면의 글자(소개 문구)·계획은 아니다. */
export function isHardArtifact(a: Artifact): boolean {
  if (a.kind === "plan") return false;
  if (a.kind === "screen") return a.interacted || a.context > 0;
  return true;
}

// ─── S1 판정 스키마 + 기계 검증기 ─────────────────────────────────────────────

export const V2_VERDICTS = ["pass", "fail", "not_verified", "mismatch"] as const;
export type V2Verdict = (typeof V2_VERDICTS)[number];

/** 판정 스키마(설계 §2.1). mismatch는 의도 판정(acId "INTENT") 전용. */
export interface V2Judgment {
  acId: string;
  verdict: V2Verdict;
  /** 무엇을 해서 무엇이 관찰됐는가(비개발자 말). */
  claim: string;
  artifactIds: string[];
  /** 판정의 핵심 값 — 인용한 증거물 원문에 글자 그대로 있어야 한다(예: 저장 키 이름, 오류 문구, "0 requests"). */
  quotes: string[];
  reasonCode?: string | null;
  /** fail일 때 소스 근거 원인(읽은 코드에서 그대로 복사한 조각). */
  cause?: { file: string; where: string; snippet: string; explanation: string } | null;
}

export const INTENT_AC_ID = "INTENT";

export type V2Problem =
  | "unknown_ac"
  | "no_artifacts"
  | "unknown_artifacts"
  | "no_hard_artifact"
  | "no_quotes"
  | "quote_not_found"
  | "description_only"
  | "no_state_change"
  | "not_exercised"
  | "not_reproduced"
  | "not_outcome"
  | "mismatch_on_criterion"
  | "verdict_on_intent";

export type V2Check =
  | { accept: true; verdict: V2Verdict; reasonCode?: AcReasonCode; cited: Artifact[]; exercised: { stateChange: boolean; verified: boolean } }
  | { accept: false; problem: V2Problem; feedback: string };

/** 화면의 소개·안내 문구를 근거로 든 문장 — 설명은 결과가 아니다(V-2). */
export const DESCRIPTION_CLAIM_RE =
  /(안내(되어|돼|하고|합니다|한다)|소개(되어|돼|하고)|설명(되어|돼|하고|합니다)|문구(가|로|에)|적혀 있|쓰여 있|라고 (나와|표시|적)|명시(되어|돼)|표시되어 있(다|습니다)고|(says|states|describes|mentions|claims|promises|explains) (that|it)|the (text|copy|description|headline) (says|states))/i;

const NV_CODES = new Set(["login_required", "oauth_unsupported", "sms_unsupported", "api_key_required", "unsafe_action", "write_not_allowed", "not_reached"]);

const squash = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** 이 인용이 증거물 원문에 있는가(공백·대소문자 무시). 너무 짧은 인용(2자 미만)은 무엇이든 맞으므로 인정하지 않는다. */
export function quoteFoundIn(quote: string, a: Artifact): boolean {
  const q = squash(quote);
  if (q.length < 2) return false;
  return squash(a.raw).includes(q) || squash(a.summary).includes(q);
}

/** 결과를 실제로 해 본 증거물: 제출 뒤의 상태 변화 종류(소스 코드는 결과가 아니다). */
export function isExercised(a: Artifact): boolean {
  return a.afterSubmit && a.stateChange && a.kind !== "source";
}

/** 결과가 남는지·다른 곳에서 보이는지 확인한 증거물: 제출 뒤의 요청·저장소, 또는 제출한 브라우저가 아닌 브라우저의 화면. */
export function isVerifiedOutcome(a: Artifact): boolean {
  if (!a.afterSubmit || a.kind === "source") return false;
  if ((a.kind === "request" || a.kind === "storage") && a.stateChange) return true;
  return (a.kind === "context" || a.kind === "screen" || a.kind === "diff") && a.firstSubmitContext !== null && a.context > a.firstSubmitContext;
}

/**
 * 기계 검증기(설계 §2.1 ①~④, LLM 없음). 통과하지 못한 판정은 리포트에 오르지 않는다 — 실행기는 피드백을 모델에 돌려줘
 * 증거를 더 모으게 하고(고리), 끝까지 통과 못 한 기준은 확인 못 함이 된다.
 *   ① 증거물 id가 비었거나 없는 id → 거절   ② 핵심 값(quotes)이 인용한 증거물 원문에 글자 그대로 있어야
 *   ③ pass = 상태 변화 증거물 ≥1(must는 제출 뒤 + 남는지/다른 곳 확인), 소개 문구 근거 금지
 *   ④ fail = 사용자가 얻을 수 없는 결과 + 새 브라우저에서 같은 값이 다시 나온 재현 쌍(must)
 */
export function validateV2Verdict(j: V2Judgment, ac: AgentAc | undefined, store: { get(id: string): Artifact | undefined }): V2Check {
  const isIntent = j.acId === INTENT_AC_ID;
  if (!isIntent && !ac) return { accept: false, problem: "unknown_ac", feedback: `Unknown criterion id "${j.acId}". Judge only the given criteria (or ${INTENT_AC_ID} for the intent comparison).` };
  if (isIntent && j.verdict !== "mismatch" && j.verdict !== "pass") {
    return { accept: false, problem: "verdict_on_intent", feedback: `${INTENT_AC_ID} takes verdict "mismatch" (the app does a different job) or "pass" (it does the intended job).` };
  }
  if (!isIntent && j.verdict === "mismatch") {
    return { accept: false, problem: "mismatch_on_criterion", feedback: `"mismatch" is only for ${INTENT_AC_ID}. For a criterion use pass, fail or not_verified.` };
  }
  const ids = [...new Set((j.artifactIds ?? []).filter((x) => typeof x === "string"))];
  const cited = ids.map((id) => store.get(id)).filter((x): x is Artifact => Boolean(x));
  const exercised = { stateChange: cited.some(isExercised), verified: cited.some(isVerifiedOutcome) };

  if (j.verdict === "not_verified") {
    const code = j.reasonCode && NV_CODES.has(j.reasonCode) && cited.length > 0 ? (j.reasonCode as AcReasonCode) : ("not_reached" as AcReasonCode);
    return { accept: true, verdict: "not_verified", reasonCode: code, cited, exercised };
  }
  if (ids.length === 0) return { accept: false, problem: "no_artifacts", feedback: "Refused: cite the evidence ids (ev-N) that prove this. A verdict without evidence is not a verdict." };
  if (cited.length !== ids.length) {
    const missing = ids.filter((id) => !store.get(id));
    return { accept: false, problem: "unknown_artifacts", feedback: `Refused: these evidence ids do not exist: ${missing.join(", ")}. Cite only ids you received.` };
  }
  if (!cited.some(isHardArtifact)) {
    return {
      accept: false,
      problem: "no_hard_artifact",
      feedback: "Refused: the cited evidence is only the first screen you were shown. Cite hard evidence — a request, storage contents, source code, a console error, a before/after change, or a screen in another browser.",
    };
  }
  const quotes = (j.quotes ?? []).filter((q) => typeof q === "string" && squash(q).length >= 2);
  if (quotes.length === 0) {
    return { accept: false, problem: "no_quotes", feedback: "Refused: give the key value(s) of your claim in quotes[], copied exactly from the cited evidence (e.g. a stored key, an error message, a response field, the text that appeared)." };
  }
  const notFound = quotes.filter((q) => !cited.some((a) => quoteFoundIn(q, a)));
  if (notFound.length > 0) {
    return { accept: false, problem: "quote_not_found", feedback: `Refused: these values are not in the cited evidence: ${notFound.map((q) => JSON.stringify(q.slice(0, 80))).join(", ")}. Quote exactly what the evidence contains, or gather the evidence.` };
  }

  if (isIntent) {
    // V-7: "생각과 달라요"는 앱 능력의 실제 증거로(소개 문구가 아니라 소스·요청·써 본 화면).
    if (j.verdict === "mismatch" && DESCRIPTION_CLAIM_RE.test(j.claim ?? "") && !cited.some((a) => a.kind !== "screen")) {
      return { accept: false, problem: "description_only", feedback: "Refused: show what the app actually does (source, requests, screens after using it), not what its text says." };
    }
    return { accept: true, verdict: j.verdict, cited, exercised };
  }

  if (j.verdict === "pass") {
    if (DESCRIPTION_CLAIM_RE.test(j.claim ?? "") && !exercised.stateChange) {
      return { accept: false, problem: "description_only", feedback: "Refused: description/marketing text is not evidence of a pass. Perform the action and observe the outcome." };
    }
    if (!cited.some((a) => a.stateChange && a.kind !== "source")) {
      return {
        accept: false,
        problem: "no_state_change",
        feedback: "Refused: a pass needs state-change evidence — a successful write request, a storage change, a before/after screen change caused by your action, or the result seen in another browser.",
      };
    }
    if (ac!.priority === "must" && (!exercised.stateChange || !exercised.verified)) {
      return {
        accept: false,
        problem: "not_exercised",
        feedback: "Refused: a must-criterion passes only when you used the feature (input + submit) AND confirmed the result stays / shows where it must (a write request or stored data, or the result seen in a new browser or the other role's screen).",
      };
    }
    return { accept: true, verdict: "pass", cited, exercised };
  }

  // fail
  if (!failReasonIsOutcome(j.claim ?? "")) {
    return {
      accept: false,
      problem: "not_outcome",
      feedback: "Refused: a fail must be an outcome the user cannot obtain (not saved, not shown where it must be, wrong/fixed result, error). Layout, order or wording is not a failure.",
    };
  }
  if (ac!.priority === "must") {
    // 재현 쌍: 같은 핵심 값이 서로 다른 두 브라우저의 증거물에서 나와야 한다(V-3).
    const reproduced = quotes.some((q) => new Set(cited.filter((a) => a.kind !== "source" && a.kind !== "plan" && quoteFoundIn(q, a)).map((a) => a.context)).size >= 2);
    if (!reproduced) {
      return {
        accept: false,
        problem: "not_reproduced",
        feedback: "Refused: reproduce the failure independently in a fresh browser (new_context) and cite evidence from both browsers that contains the same key value.",
      };
    }
  }
  return { accept: true, verdict: "fail", cited, exercised };
}

/** 거절이 반복된 기준의 마지막 처리: 확인 못 함 + 이유 코드(리포트에 정직하게). */
export function downgradeReason(problem: V2Problem): AcReasonCode {
  if (problem === "not_reproduced") return "fail_not_reproduced";
  if (problem === "not_outcome") return "ui_interpretation";
  return "evidence_missing";
}

export interface V2JudgmentRecord {
  acId: string;
  verdict: V2Verdict;
  claim: string;
  artifactIds: string[];
  quotes: string[];
  reasonCode?: AcReasonCode;
  exercised: { stateChange: boolean; verified: boolean };
  cause?: { file: string; where: string; snippet: string; explanation: string };
  /** 기계 검증기가 이 기준의 판정을 거절한 횟수 — 고리가 실제로 돌았다는 기록. */
  refusals: number;
}

/** 인용률(G1 지표): 판정(pass·fail·mismatch) 중 단단한 증거물을 인용한 비율. 확인 못 함은 판정이 아니므로 분모에서 뺀다. */
export function citationRate(records: readonly V2JudgmentRecord[], store: { get(id: string): Artifact | undefined }): { decided: number; cited: number; pct: number } {
  const decided = records.filter((r) => r.verdict !== "not_verified");
  const cited = decided.filter((r) => r.artifactIds.some((id) => {
    const a = store.get(id);
    return a ? isHardArtifact(a) : false;
  }));
  return { decided: decided.length, cited: cited.length, pct: decided.length ? Math.round((cited.length / decided.length) * 100) : 100 };
}

/** 원인 인용 검사(F 단계 전제): 코드 조각이 실제로 읽은 소스에 있어야 싣는다 — 지어낸 코드 금지. */
export function causeIsGrounded(cause: V2Judgment["cause"], readSources: ReadonlyMap<string, string>): boolean {
  if (!cause || typeof cause.snippet !== "string") return false;
  const snip = cause.snippet.replace(/\s+/g, " ").trim();
  if (snip.length < 8) return false;
  for (const text of readSources.values()) if (text.replace(/\s+/g, " ").includes(snip)) return true;
  return false;
}
