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
import {
  buildAgentReport,
  failReasonIsOutcome,
  reasonText,
  type AcReasonCode,
  type AcResult,
  type AcSource,
  type AgentAc,
  type AgentReport,
  type AgentSignals,
  type LoginMethod,
  type SweepResult,
} from "./agent-inspection.js";

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

// ─── S2 정찰: 접속 불가는 LLM 없이 곧바로 · 소스·번들의 정적 사실 ──────────────

export type LandingCause = "unreachable" | "http_error" | "host_not_found" | "missing_index";

/** 첫 화면이 열리는가 — 열리지 않음·404·호스트 "없음"·index 없음이면 곧바로 고장(원인 포함, LLM 0회). 401·403·407은 로그인 벽(고장 아님). */
export function v2LandingBroken(o: { status: number | null; bodyText: string; hostNotFound: boolean; missingIndexFile: boolean }): { broken: boolean; cause?: LandingCause } {
  if (o.status === null && !(o.bodyText ?? "").trim()) return { broken: true, cause: "unreachable" };
  if (o.missingIndexFile) return { broken: true, cause: "missing_index" };
  if (o.hostNotFound) return { broken: true, cause: "host_not_found" };
  if (o.status !== null && o.status >= 400 && o.status !== 401 && o.status !== 403 && o.status !== 407) return { broken: true, cause: "http_error" };
  return { broken: false };
}

/** 비개발자 말(KO/EN) — "무엇이 안 되고 왜", 개발 용어 없이(X-2). */
export function v2LandingCauseText(cause: LandingCause, status: number | null, locale: "ko" | "en"): string {
  const en = locale === "en";
  switch (cause) {
    case "unreachable":
      return en ? "The address doesn't open at all — nothing answers there." : "주소가 아예 열리지 않아요 — 그 주소에서 아무것도 답하지 않아요.";
    case "missing_index":
      return en ? "The site is there but its first page is missing from what was published." : "사이트는 있지만 올린 파일에 첫 화면이 빠져 있어요.";
    case "host_not_found":
      return en ? "The hosting service says there is no app at this address — it was deleted or never published." : "호스팅 회사가 이 주소에 앱이 없다고 해요 — 지워졌거나 아직 올리지 않았어요.";
    default:
      return en ? `The first screen shows an error page (code ${status ?? "?"}).` : `첫 화면이 오류 화면으로 열려요(코드 ${status ?? "?"}).`;
  }
}

export function v2LandingHow(cause: LandingCause, locale: "ko" | "en"): string {
  const en = locale === "en";
  if (cause === "missing_index") return en ? "Publish again from your builder and make sure the main page (index.html) is included." : "만든 도구에서 다시 올려 주세요. 첫 화면 파일(index.html)이 함께 올라갔는지 확인해 주세요.";
  if (cause === "unreachable") return en ? "Check the address, or publish the app again from your builder and use the new address." : "주소가 맞는지 확인하거나, 만든 도구에서 다시 올린 뒤 새 주소로 확인해 주세요.";
  return en ? "Publish the app again from your builder (Deploy/Publish) and check the address it gives you." : "만든 도구에서 다시 올려(배포·게시) 주시고, 그때 나온 주소로 다시 확인해 주세요.";
}

export type StaticFactKind = "external_endpoint" | "backend_client" | "local_storage_key" | "indexed_db" | "placeholder_config" | "utc_date" | "random_result" | "route";

export interface StaticFact {
  kind: StaticFactKind;
  /** 소스 주소. */
  file: string;
  /** 그대로 복사한 코드 조각(증거물 원문 — 원인 인용의 근거). */
  snippet: string;
  /** 사람이 읽는 값(엔드포인트 주소·키 이름·경로). */
  value: string;
}

const FACT_PATTERNS: Array<{ kind: StaticFactKind; re: RegExp; value: (m: RegExpExecArray) => string }> = [
  { kind: "external_endpoint", re: /\bfetch\(\s*[`'"]((?:https?:)?\/\/[^`'"\s]{3,200}|\/api\/[^`'"\s]{0,200})[`'"]/g, value: (m) => m[1] ?? "" },
  { kind: "external_endpoint", re: /\baxios\.(?:get|post|put|patch|delete)\(\s*[`'"]([^`'"\s]{2,200})[`'"]/g, value: (m) => m[1] ?? "" },
  { kind: "backend_client", re: /https:\/\/[a-z0-9-]+\.(?:supabase\.co|firebaseio\.com|firebaseapp\.com)/g, value: (m) => m[0] },
  { kind: "backend_client", re: /\b(initializeApp|getFirestore)\(/g, value: (m) => m[1] ?? m[0] },
  { kind: "backend_client", re: /\.from\(\s*[`'"]([a-z_][a-z0-9_]{1,60})[`'"]\s*\)\s*\.(?:select|insert|upsert|update|delete)\b/g, value: (m) => `table:${m[1] ?? ""}` },
  { kind: "backend_client", re: /functions\.invoke\(\s*[`'"]([A-Za-z0-9_-]{1,60})[`'"]/g, value: (m) => `function:${m[1] ?? ""}` },
  { kind: "external_endpoint", re: /\bfetch\(\s*`([^`]{3,200})`/g, value: (m) => m[1] ?? "" },
  { kind: "local_storage_key", re: /localStorage\.(?:setItem|getItem)\(\s*[`'"]([^`'"]{1,80})[`'"]/g, value: (m) => m[1] ?? "" },
  { kind: "indexed_db", re: /indexedDB\.open\(\s*[`'"]([^`'"]{1,80})[`'"]/g, value: (m) => m[1] ?? "" },
  { kind: "placeholder_config", re: /(YOUR[_-][A-Z_]{3,40}|your-project(?:-ref)?\.supabase\.co|REPLACE[_-]?ME|<YOUR[_ ][A-Z_ ]{2,30}>|sk-xxxx+|INSERT[_-][A-Z_]{3,30})/g, value: (m) => m[1] ?? m[0] },
  { kind: "utc_date", re: /toISOString\(\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/g, value: (m) => m[0] },
  { kind: "random_result", re: /Math\.random\(\)\s*[*<>]/g, value: (m) => m[0] },
  { kind: "route", re: /\bpath\s*:\s*[`'"](\/[A-Za-z0-9_\-/:]{1,80})[`'"]|<Route[^>]{0,80}\bpath=[`'"](\/[A-Za-z0-9_\-/:]{1,80})[`'"]/g, value: (m) => m[1] ?? m[2] ?? "" },
];

/**
 * 소스·번들에서 정적 사실을 뽑는다(설계 §2.2 R): 외부로 나가는 요청 대상 · 백엔드 연결 · 저장소 사용 · 설정 자리표시자 ·
 * UTC 날짜 자르기 · 난수 결과 · 라우트. **가설의 근거일 뿐 판정 근거가 아니다**(판정은 실행 증거로, V-4).
 * 같은 (종류, 값)은 한 번만. 조각은 원문 그대로(앞뒤 문맥 포함) — 원인 인용 검사(causeIsGrounded)가 이 조각을 찾는다.
 */
export function extractStaticFacts(sources: ReadonlyArray<{ url: string; text: string }>, max = 80): StaticFact[] {
  const out: StaticFact[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    const text = src.text ?? "";
    for (const p of FACT_PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let perPattern = 0;
      while ((m = p.re.exec(text)) !== null && perPattern < 12) {
        if (m[0].length === 0) {
          p.re.lastIndex += 1;
          continue;
        }
        const value = p.value(m).slice(0, 200);
        if (!value) continue;
        const key = `${p.kind}|${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        perPattern += 1;
        const start = Math.max(0, m.index - 80);
        const end = Math.min(text.length, m.index + m[0].length + 80);
        out.push({ kind: p.kind, file: src.url, snippet: text.slice(start, end), value });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** 정적 사실 요약(모델에게 주는 가설 재료이자 source 증거물의 원문). */
export function describeStaticFacts(facts: readonly StaticFact[]): string {
  if (facts.length === 0) return "No notable static facts found in the same-origin sources read so far.";
  const by = new Map<StaticFactKind, StaticFact[]>();
  for (const f of facts) by.set(f.kind, [...(by.get(f.kind) ?? []), f]);
  const lines: string[] = [];
  for (const [k, list] of by) {
    lines.push(`## ${k} (${list.length})`);
    for (const f of list.slice(0, 12)) lines.push(`- ${f.value}  [${f.file.split("/").pop()}] …${f.snippet.replace(/\s+/g, " ").slice(0, 220)}…`);
  }
  return lines.join("\n");
}

// ─── 리포트(v1 리포트 모양 그대로 + v2 부분) ──────────────────────────────────

export interface V2ReportInput {
  targetUrl: string;
  intent: string;
  acs: AgentAc[];
  acSource: AcSource;
  records: V2JudgmentRecord[];
  store: EvidenceStore;
  signals: AgentSignals;
  sweep: SweepResult | null;
  loginDepth: "L1" | "L3";
  loginMethod: LoginMethod;
  landing?: { broken: boolean; cause?: LandingCause; status: number | null; artifactId?: string };
  partial?: boolean;
  firstHtml?: string;
  model?: string | null;
  staticFacts?: StaticFact[];
  plan?: unknown;
  toolCalls?: number;
}

/**
 * v2 결과를 v1 리포트(buildAgentReport) 모양으로 싣는다 — 대시보드·결함 기록·재검사 비교가 그대로 쓴다(engine "agent",
 * engineVersion "v2"). 판정 = 기계 검증기를 통과한 기록만. 증거물은 접어 두고 "무엇이 안 되고 왜"를 먼저(X-2).
 */
export function buildV2Report(input: V2ReportInput, locale: "ko" | "en" = "ko"): AgentReport & { engineVersion: "v2" } {
  const L = locale === "en" ? "en" : "ko";
  const byId = new Map(input.records.filter((r) => r.acId !== INTENT_AC_ID).map((r) => [r.acId, r]));
  const evidenceLine = (id: string) => input.store.get(id)?.summary ?? id;
  const results: AcResult[] = input.acs.map((a) => {
    const r = byId.get(a.id);
    if (!r) {
      const code: AcReasonCode = input.landing?.broken ? "app_missing" : input.partial ? "budget" : "not_reached";
      return { id: a.id, status: "not_verified", reason: reasonText(code, L), reasonCode: code, evidence: [], steps: 0 };
    }
    const status = r.verdict === "mismatch" ? "not_verified" : r.verdict;
    return {
      id: a.id,
      status,
      reason: r.verdict === "not_verified" && r.reasonCode && !r.claim ? reasonText(r.reasonCode, L) : r.claim.slice(0, 600),
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
      evidence: r.artifactIds.map(evidenceLine).slice(0, 6),
      steps: 0,
      exercised: r.exercised,
    };
  });
  const signals: AgentSignals = { ...input.signals, ...(input.landing?.broken ? { pageNotFound: true } : {}) };
  const report = buildAgentReport(
    {
      targetUrl: input.targetUrl,
      intent: input.intent,
      acs: input.acs,
      acSource: input.acSource,
      results,
      sweep: input.sweep,
      signals,
      loginDepth: input.loginDepth,
      loginMethod: input.loginMethod,
      ...(input.partial ? { partial: true } : {}),
      ...(input.firstHtml ? { firstHtml: input.firstHtml } : {}),
    },
    L,
  ) as AgentReport & { engineVersion: "v2" };
  report.engineVersion = "v2";
  if (input.landing?.broken && input.landing.cause) {
    const why = v2LandingCauseText(input.landing.cause, input.landing.status, L);
    report.oneLine = (L === "en" ? "The app doesn't open: " : "앱이 열리지 않아요: ") + why;
    report.findings = [
      {
        severity: "high",
        code: input.landing.cause === "missing_index" ? "missing_index_file" : "page_not_found",
        what: L === "en" ? "The app doesn't open" : "앱이 열리지 않아요",
        why,
        how: v2LandingHow(input.landing.cause, L),
        evidence: input.landing.artifactId ? evidenceLine(input.landing.artifactId) : null,
      },
      ...report.findings.filter((f) => f.code !== "page_not_found" && f.code !== "missing_index_file"),
    ];
  }
  (report.agent as unknown as Record<string, unknown>)["v2"] = {
    runnerRev: AGENT_V2_RUNNER_REV,
    model: input.model ?? null,
    landing: input.landing ?? null,
    staticFacts: (input.staticFacts ?? []).slice(0, 40).map((f) => ({ kind: f.kind, file: f.file, value: f.value })),
    plan: input.plan ?? null,
    judgments: input.records.map((r) => ({ acId: r.acId, verdict: r.verdict, artifactIds: r.artifactIds, quotes: r.quotes, refusals: r.refusals, ...(r.cause ? { cause: r.cause } : {}) })),
    artifacts: input.store.all().filter((a) => a.kind !== "plan").slice(-120).map((a) => ({ id: a.id, kind: a.kind, context: a.context, summary: a.summary })),
    citation: citationRate(input.records, input.store),
    toolCalls: input.toolCalls ?? 0,
  };
  return report;
}

/** 알려진 주소 비교용 정규화 — 해시 라우터(#/path)는 주소의 일부, 일반 해시·쿼리·끝 슬래시는 뗀다. */
export function normalizeKnownUrl(u: string): string {
  try {
    const x = new URL(u);
    if (!x.hash.startsWith("#/")) x.hash = "";
    x.search = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

// ─── S3 가설·계획 ─────────────────────────────────────────────────────────────

export interface V2Hypothesis {
  id: string;
  /** 위험(비개발자 말 아님 — 모델·기록용). */
  risk: string;
  /** 무엇을 하면 무엇이 관찰되어야 참/거짓인가. */
  test: string;
  /** 근거가 된 정적 사실(있으면). */
  basis?: string;
}

export interface V2PlanItem {
  acId: string;
  steps: string[];
  probes: string[];
}

export interface V2Plan {
  hypotheses: V2Hypothesis[];
  items: V2PlanItem[];
}

/**
 * 정적 사실 → 시작 가설(결정론, 일반 규칙 — 특정 앱·주제에 맞추지 않는다). 모델은 이것을 출발점으로 더하고 고친다.
 * 가설은 판정 근거가 아니다 — 각 가설은 실행으로 참/거짓을 가린다(V-4).
 */
export function seedHypotheses(facts: readonly StaticFact[]): V2Hypothesis[] {
  const has = (k: StaticFactKind) => facts.filter((f) => f.kind === k);
  const out: V2Hypothesis[] = [];
  const add = (risk: string, test: string, basis?: StaticFact) =>
    out.push({ id: `H${out.length + 1}`, risk, test, ...(basis ? { basis: `${basis.kind}:${basis.value}` } : {}) });
  const backend = has("backend_client").length > 0 || has("external_endpoint").some((f) => !/anthropic|openai|googleapis/i.test(f.value));
  const ls = has("local_storage_key").filter((f) => !/supabase|gotrue|theme|locale|lang/i.test(f.value));
  if (ls.length > 0 && !backend) {
    add(
      "Data the user creates may live only in this browser (localStorage) — other people/devices/roles would never see it.",
      "Create a record, then open the screen that must show it in a NEW browser (new_context) and as the other role; check storage_dump and network_log for a write request.",
      ls[0],
    );
  }
  const ph = has("placeholder_config")[0];
  if (ph) add("The backend connection may still contain a placeholder, so saving/loading would fail.", "Submit the core action and read network_log for failing requests to that backend; console_errors.", ph);
  const utc = has("utc_date")[0];
  if (utc) add("Dates are cut from UTC time; in Korea between 00:00 and 09:00 'today' would be yesterday.", "set_clock to today 00:30 KST and check which date the app treats as today / which slots it shows.", utc);
  const rnd = has("random_result")[0];
  if (rnd) add("Results may be random or fixed rather than computed from the input.", "Run the core action twice with clearly different inputs and compare the results; grep the source near the random call.", rnd);
  const llmDirect = has("external_endpoint").find((f) => /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis/i.test(f.value));
  if (llmDirect) add("The app calls an AI service directly from the browser; without a key in the page it cannot work for visitors.", "Use the core feature and read network_log for that call's status/response.", llmDirect);
  add(
    "The app may do a different job than the owner intended (e.g. a manual checklist instead of an automatic check, a brochure instead of a working service).",
    "Use the core feature with the input the intent implies; check in network_log whether anything is sent to the target / backend; read the source of the result screen.",
  );
  return out;
}

/** 모델이 낸 계획을 정리하고 빠진 must 기준을 알려 준다(빠지면 실행기가 돌려보낸다). */
export function normalizePlan(raw: unknown, acs: readonly AgentAc[]): { plan: V2Plan; missingMust: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown, n: number, len = 300) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.slice(0, len)).slice(0, n) : []);
  const ids = new Set(acs.map((a) => a.id));
  const items: V2PlanItem[] = [];
  for (const it of Array.isArray(r["items"]) ? (r["items"] as unknown[]) : []) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    const acId = typeof x["acId"] === "string" ? x["acId"] : "";
    if (!ids.has(acId) || items.some((i) => i.acId === acId)) continue;
    items.push({ acId, steps: strs(x["steps"], 15), probes: strs(x["probes"], 10) });
  }
  const hypotheses: V2Hypothesis[] = [];
  for (const h of Array.isArray(r["hypotheses"]) ? (r["hypotheses"] as unknown[]) : []) {
    if (!h || typeof h !== "object") continue;
    const x = h as Record<string, unknown>;
    if (typeof x["risk"] !== "string" || typeof x["test"] !== "string") continue;
    hypotheses.push({ id: `H${hypotheses.length + 1}`, risk: x["risk"].slice(0, 300), test: x["test"].slice(0, 400) });
    if (hypotheses.length >= 15) break;
  }
  const missingMust = acs.filter((a) => a.priority === "must" && !items.some((i) => i.acId === a.id && i.steps.length > 0)).map((a) => a.id);
  return { plan: { hypotheses, items }, missingMust };
}

/** 계획 → 증거물 원문(재검사 때 그대로 재사용 — L 단계). */
export function planText(plan: V2Plan): string {
  return JSON.stringify(plan);
}

/** 원 런 리포트에서 v2 계획을 꺼낸다(재검사 = 같은 계획, X-4). 없거나 v2가 아니면 null. */
export function v2PlanFromReport(reportJson: string | null | undefined): V2Plan | null {
  if (!reportJson) return null;
  try {
    const r = JSON.parse(reportJson) as { engineVersion?: unknown; agent?: { v2?: { plan?: unknown } } };
    if (r?.engineVersion !== "v2" || !r.agent?.v2?.plan || typeof r.agent.v2.plan !== "object") return null;
    const p = r.agent.v2.plan as Record<string, unknown>;
    const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 400)).slice(0, n) : []);
    const items = (Array.isArray(p["items"]) ? (p["items"] as unknown[]) : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>)["acId"] === "string")
      .slice(0, 15)
      .map((x) => ({ acId: String(x["acId"]).slice(0, 40), steps: strs(x["steps"], 15), probes: strs(x["probes"], 10) }));
    const hypotheses = (Array.isArray(p["hypotheses"]) ? (p["hypotheses"] as unknown[]) : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .slice(0, 15)
      .map((x, i) => ({ id: `H${i + 1}`, risk: String(x["risk"] ?? "").slice(0, 300), test: String(x["test"] ?? "").slice(0, 400) }));
    return items.length || hypotheses.length ? { hypotheses, items } : null;
  } catch {
    return null;
  }
}

/** 원 런이 v2였는가(재검사가 엔진을 물려받는다). */
export function wasAgentV2Report(reportJson: string | null | undefined): boolean {
  if (!reportJson) return false;
  try {
    const r = JSON.parse(reportJson) as { engine?: unknown; engineVersion?: unknown };
    return r?.engine === "agent" && r?.engineVersion === "v2";
  } catch {
    return false;
  }
}

// ─── S3 도구 정의 · 지시 ──────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;
export interface V2ToolDef {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
  strict: true;
}

const nullableStr: JsonSchema = { type: ["string", "null"] };
const TARGET: JsonSchema = {
  type: "object",
  description: "Element to act on: accessible role+name from observe, or a label / placeholder / visible text (others null).",
  properties: { role: nullableStr, name: nullableStr, label: nullableStr, placeholder: nullableStr, text: nullableStr },
  required: ["role", "name", "label", "placeholder", "text"],
  additionalProperties: false,
};
const STR_ARR: JsonSchema = { type: "array", items: { type: "string" } };

function tool(name: string, description: string, properties: Record<string, JsonSchema>): V2ToolDef {
  return { type: "function", name, description, parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false }, strict: true };
}

export const V2_TOOLS: readonly V2ToolDef[] = [
  tool("observe", "See the current screen: address, accessibility tree, visible text, links. screenshot:true adds an image.", { screenshot: { type: "boolean" } }),
  tool("click", "Click an element.", { target: TARGET }),
  tool("fill", "Type into an input (replaces its content).", { target: TARGET, value: { type: "string" } }),
  tool("select", "Choose an option of a <select>.", { target: TARGET, value: { type: "string" } }),
  tool("press", "Press a key (Enter, Tab, Escape, ArrowDown, Space…).", { key: { type: "string" } }),
  tool("navigate", "Open an address of this app — ONLY one you saw (links, requests, routes in the source) or that a criterion names. Guessed addresses are refused.", { url: { type: "string" } }),
  tool("back", "Browser back.", {}),
  tool("reload", "Reload (same browser, same storage).", {}),
  tool("wait", "Wait for the app (ms ≤ 8000).", { ms: { type: "integer" } }),
  tool("network_log", "Requests the app made in this browser: method, url, status, request/response body excerpts. filter = url substring or null.", { filter: nullableStr, last: { type: "integer" } }),
  tool("storage_dump", "localStorage/sessionStorage keys, sizes and value excerpts; IndexedDB names; cookie names.", {}),
  tool("list_sources", "Same-origin HTML/JS/CSS files this page loaded.", {}),
  tool("read_source", "Read a same-origin source file. offset/length in characters (length ≤ 12000).", { url: { type: "string" }, offset: { type: "integer" }, length: { type: "integer" } }),
  tool("grep_source", "Regex search over the same-origin sources (and page HTML). Returns file + surrounding code.", { pattern: { type: "string" } }),
  tool("console_errors", "Console errors and uncaught exceptions in this browser.", {}),
  tool("new_context", "Open a NEW browser with no cookies/storage (another customer, another device, the owner) at an address of this app. timezone = IANA name or null (Asia/Seoul).", { url: { type: "string" }, timezone: nullableStr }),
  tool("set_clock", "Set this browser's clock to an ISO time and reload (date/time behaviour).", { iso: { type: "string" } }),
  tool("set_viewport", "Resize the screen (e.g. 390x844 phone); reports sideways overflow.", { width: { type: "integer" }, height: { type: "integer" } }),
  tool("record_plan", "Record hypotheses (risks + how to test them) and the QA plan: per criterion the steps and adversarial probes. Required before verdicts; saved and reused on re-check.", {
    hypotheses: { type: "array", items: { type: "object", properties: { risk: { type: "string" }, test: { type: "string" } }, required: ["risk", "test"], additionalProperties: false } },
    items: { type: "array", items: { type: "object", properties: { acId: { type: "string" }, steps: STR_ARR, probes: STR_ARR }, required: ["acId", "steps", "probes"], additionalProperties: false } },
  }),
  tool("record_verdict", "Verdict for ONE criterion, or acId \"INTENT\" for the intent comparison. Cite evidence ids (ev-N) and quote the key values exactly as they appear in that evidence.", {
    acId: { type: "string" },
    verdict: { type: "string", enum: ["pass", "fail", "not_verified", "mismatch"] },
    claim: { type: "string" },
    artifactIds: STR_ARR,
    quotes: STR_ARR,
    reasonCode: { type: ["string", "null"], enum: ["login_required", "oauth_unsupported", "sms_unsupported", "api_key_required", "unsafe_action", "write_not_allowed", "not_reached", null] },
    cause: {
      type: ["object", "null"],
      description: "For fail/mismatch: the cause in the app's code — file url, function/area, an exact snippet copied from read_source/grep_source, and a plain explanation.",
      properties: { file: { type: "string" }, where: { type: "string" }, snippet: { type: "string" }, explanation: { type: "string" } },
      required: ["file", "where", "snippet", "explanation"],
      additionalProperties: false,
    },
  }),
  tool("finish", "End when every criterion and INTENT have a verdict, or you cannot get further.", { note: { type: "string" } }),
];

export const V2_ACTION_TOOLS: ReadonlySet<string> = new Set(["click", "fill", "select", "press", "navigate", "back", "reload", "wait", "set_clock", "set_viewport", "new_context"]);

export function v2Instructions(locale: "ko" | "en", o: { readOnly: boolean; testData: { name: string; phone: string } }): string {
  const lang = locale === "en" ? "English" : "Korean";
  return [
    "You are a senior QA engineer and an independent judge. A non-developer built this web app with an AI builder. Decide whether it ACTUALLY does what its owner wanted — against the owner's confirmed intent and criteria, not a generic bug list.",
    "",
    "Nobody gets it right in one pass. Work as an evidence loop: hypothesis → execute → observe hard evidence (requests and responses, storage contents, source code, screens in another browser/role, console errors, before/after changes) → revise. Repeat until confident.",
    "",
    "Order of work:",
    "1. RECON — use the app like its intended user; read its source (list_sources/read_source/grep_source) to learn what it really does: backend or browser-only, where submitted data goes, whether results are computed from input or fixed/random, which roles and screens exist. Static facts are hypotheses, never verdict evidence.",
    "2. HYPOTHESES + PLAN — record_plan: risks with how to test each, and per criterion the steps plus adversarial probes: vary inputs (fixed results?), a NEW browser (new_context) for persistence and other customers/devices, the other role's screen through links/routes you observed, the clock at 00:30 KST (set_clock) for anything date-related, empty/invalid input.",
    "3. EXECUTE the plan adaptively. If a screen does not change, don't repeat the action — find another way (a required choice, a validation message, a disabled button).",
    "4. CONFIRM — before a verdict, re-run independently in a fresh browser and get the same evidence again (required for must fails, strongly preferred for passes).",
    "5. VERDICTS — record_verdict for every criterion, and one for acId INTENT: \"mismatch\" if the app does a different job than intended (cite what it actually does: source, requests, screens after use), else \"pass\".",
    "",
    "Rules the executor enforces mechanically (verdicts that break them are refused and you must gather more evidence):",
    "- Cite evidence ids and copy the key values into quotes exactly as they appear in that evidence.",
    "- A screen's description/marketing/instruction text is never evidence. A pass needs a state change caused by you: a successful write request, a storage change, a before/after change, or the result seen in another browser. A must pass also needs the result confirmed where it must persist/appear.",
    "- A fail is an outcome the user cannot obtain (not a layout or wording preference), reproduced in a fresh browser with the same key value.",
    "- Guessed addresses are refused. Login you don't have, API keys, payment, SMS/OAuth → not_verified with the reasonCode. Never invent credentials.",
    `- Test data: name '${o.testData.name}', phone ${o.testData.phone}; Korean names/text, Korea time. Never real people's data.`,
    o.readOnly ? "- READ-ONLY run: do not submit anything that creates data; criteria that need it are not_verified with write_not_allowed." : "- You may create test records with the test data. Never delete or cancel records you did not create.",
    "- For each fail/mismatch give the cause in the code when you can (exact snippet from read_source/grep_source).",
    "",
    `Write claims and causes in ${lang} plain words a non-developer understands (what you did → what happened), no developer jargon. Call finish when done.`,
  ].join("\n");
}

export function v2Kickoff(o: {
  targetUrl: string;
  intent: string;
  acs: readonly AgentAc[];
  landing: { status: number | null; url?: string };
  loginNote: string;
  facts: readonly StaticFact[];
  hypotheses: readonly V2Hypothesis[];
  sourceArtifactId?: string;
  priorPlan?: V2Plan | null;
}): string {
  const acLines = o.acs.map((a) => `- [${a.id}] (${a.priority}${a.confirmed ? ", confirmed by the owner" : ", not confirmed"}) ${a.title}\n  given: ${a.given}\n  when: ${a.when}\n  then: ${a.then}`).join("\n");
  return [
    `App: ${o.targetUrl} (opened: HTTP ${o.landing.status ?? "?"})`,
    `Login: ${o.loginNote}`,
    "",
    `What the owner wanted (confirmed intent): ${o.intent || "(not given)"}`,
    "",
    "Criteria to judge (each needs record_verdict; plus one for INTENT):",
    acLines || "(none)",
    "",
    `Static facts from the source (evidence ${o.sourceArtifactId ?? "-"}; hypotheses only):`,
    describeStaticFacts(o.facts).slice(0, 6000),
    "",
    "Starting hypotheses (add, drop or refine them in record_plan):",
    ...o.hypotheses.map((h) => `- ${h.id}: ${h.risk} — test: ${h.test}`),
    ...(o.priorPlan
      ? ["", "RE-CHECK after the owner fixed the app: run the SAME plan as last time (below) and judge again. You may add probes but do not drop any.", JSON.stringify(o.priorPlan).slice(0, 8000)]
      : []),
    "",
    "Begin with RECON.",
  ].join("\n");
}
