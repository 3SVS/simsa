/**
 * agent-inspection.ts — 수용 기준(AC) 실행기 "agent" 엔진의 순수 로직 (2026-10-05).
 *
 * 왜: 종전 검수(visual-flow-plan + decideFromEvidence)는 결정론 플래너라 **의도에서 나온 AC를 실제로 수행하지
 * 못했다**(벤치마크 #1: 미용실 예약 앱에서 이름 칸에 "서울"을 넣고 가격 버튼을 누른 뒤 "화면이 바뀌었나"만 봤다).
 * 의도 추론 → "맞나요?" 확인 → 확인된 must AC(dev-spec source:"inferred")까지는 이미 있다. 빠진 것은
 * **그 AC를 브라우저에서 실제로 해 보고 AC마다 통과/실패/확인 못 함을 증거와 함께 내는 실행기**다.
 *
 * 이 파일은 Worker와 컨테이너가 **같이** 쓴다(Dockerfile이 nondev-report.ts처럼 dist로 컴파일).
 * 브라우저·네트워크·LLM 없음 — 행동 검증, 증거 접지(grounding), 판정 사다리, 리포트, 고침 지시, 비밀 가림.
 *
 * 정직 규칙(테스트 고정):
 *   - pass/fail은 **관찰한 글자 그대로의 증거**가 있어야 한다(LLM 판정의 evidenceQuote가 관찰 기록 안에 없으면
 *     not_verified). 지어낸 통과·지어낸 고장 둘 다 막는다.
 *   - 로그인 벽에서 막힌 AC는 fail이 아니라 not_verified("로그인 필요 — 시험 계정을 주시면 들어가서 확인해요").
 *     카카오·구글 로그인과 문자 인증은 이번 단계 범위 밖 → not_verified + 그 이유.
 *   - 판정 사다리: must 실패 하나라도 → Needs Fix. 화면 고장·버튼 오류(사이트 점검) → Needs Fix.
 *     must 전부 통과 → works(사용자가 확인한 must면 Ready, 추정 기준이면 Conditionally Ready).
 *     그 밖 → Not Verified. **must 통과 없이 "문제를 찾지 못했어요"를 말하지 않는다.**
 *   - 고침 지시(agentPrompt·builderPrompt의 재료인 findings)는 **실제로 관찰된 실패에서만** 만든다.
 */
import { classifyFindings, type NonDevFinding, type NonDevReport, type ReportLocale, type VisualCheckInput } from "./nondev-report.js";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type AcPriority = "must" | "should" | "could";

/** 실행기가 받는 AC 하나. 출처가 지시서면 id는 AC-xxx, 런에서 추정했으면 R-n. */
export interface AgentAc {
  id: string;
  title: string;
  given: string;
  when: string;
  then: string;
  priority: AcPriority;
  /** 사용자가 "맞나요?"에서 확인한 기준인가(지시서 source generated/정본이면 true). */
  confirmed: boolean;
  /** 지시서 테스트 계획의 단계(있으면 참고용). */
  steps?: string[];
}

/**
 * 기준의 출처(리포트 "이렇게 이해하고 검사했어요"에 그대로 보인다):
 *   interview — 아이디어 문(인터뷰 → 지시서) · document — 기획서/PRD 문 · confirmed_inferred — 주소/저장소 문에서
 *   추론 + "맞나요?" 확인 · source_run — 재검수(원 런의 기준 그대로) · inferred_at_run — 지시서 없이 런에서 추정(미확인).
 */
export const AC_SOURCES = ["interview", "document", "confirmed_inferred", "source_run", "inferred_at_run"] as const;
export type AcSource = (typeof AC_SOURCES)[number];

export function acSourceLabel(source: AcSource, locale: ReportLocale = "ko"): string {
  const ko: Record<AcSource, string> = {
    interview: "아이디어 인터뷰로 만든 지시서의 기준",
    document: "올려 주신 기획서(문서)의 기준",
    confirmed_inferred: "앱을 보고 추론한 뒤 '맞나요?'에서 확인받은 기준",
    source_run: "지난 확인과 같은 기준",
    inferred_at_run: "앱 첫 화면을 보고 추정한 기준(아직 확인받지 않음)",
  };
  const en: Record<AcSource, string> = {
    interview: "criteria from the spec built in the idea interview",
    document: "criteria from the plan/PRD document you uploaded",
    confirmed_inferred: "criteria inferred from the app and confirmed by you ('Is this right?')",
    source_run: "the same criteria as the previous check",
    inferred_at_run: "criteria guessed from the app's first screen (not yet confirmed)",
  };
  return (locale === "en" ? en : ko)[source];
}

export type AcStatus = "pass" | "fail" | "not_verified";

export const AC_REASON_CODES = [
  "login_required",
  "login_failed",
  "oauth_unsupported",
  "sms_unsupported",
  "api_key_required",
  "unsafe_action",
  "budget",
  "evidence_missing",
  "app_missing",
  "not_reached",
  "agent_error",
  "guessed_address",
  "judge_disagreed",
] as const;
export type AcReasonCode = (typeof AC_REASON_CODES)[number];

export interface AcResult {
  id: string;
  status: AcStatus;
  /** 사람이 읽는 한 줄(관찰한 것). 비밀은 가려진 뒤의 문장이다. */
  reason: string;
  reasonCode?: AcReasonCode;
  /** 관찰 기록에서 그대로 인용한 근거(접지 확인됨). */
  evidence: string[];
  /** 수행한 행동 수. */
  steps: number;
  /** 사람이 따라 할 수 있는 행동 요약(리포트·고침 지시용). */
  actions?: string[];
  /** 마지막 화면 스크린샷 증거 이름(screenshots/*.png). */
  screenshot?: string;
  /**
   * 이 기준을 확인하며 **앱의 상태를 실제로 바꿨는가**(입력 뒤 제출 같은 클릭) · 그 뒤 **결과가 남는지/다른 곳에서
   * 보이는지 확인했는가**(새로고침·새 방문자·다른 화면·다른 역할 로그인). 실행기가 행동 기록에서 잰다(LLM 말이 아님).
   */
  exercised?: { stateChange: boolean; verified: boolean };
}

export interface SweepScreen {
  url: string;
  status: number | null;
  ok: boolean;
  problem?: "http_error" | "blank" | "error_text" | "crash";
  detail?: string;
  screenshot?: string;
}

export interface SweepButton {
  screen: string;
  label: string;
  outcome: "ok" | "no_reaction" | "error" | "skipped_unsafe";
  detail?: string;
}

export interface SweepResult {
  screens: SweepScreen[];
  buttons: SweepButton[];
  truncated: { screens: boolean; buttons: boolean; time: boolean };
}

export const SWEEP_MAX_SCREENS = 25;
export const SWEEP_MAX_BUTTONS = 60;
export const SWEEP_MAX_BUTTONS_PER_SCREEN = 8;
export const AGENT_MAX_ACS = 10;
export const AGENT_MAX_STEPS_PER_AC = 14;

// ─── 행동(LLM 출력) 검증 ──────────────────────────────────────────────────────

export interface ActionTarget {
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
}

export type AgentAction =
  | { type: "click"; target: ActionTarget; ownRecord?: boolean }
  | { type: "fill"; target: ActionTarget; value: string }
  | { type: "select"; target: ActionTarget; value: string }
  | { type: "press"; key: string }
  | { type: "goto"; path: string }
  | { type: "reload" }
  | { type: "back" }
  | { type: "new_session" }
  | { type: "set_clock"; iso: string }
  | { type: "wait"; ms: number }
  | { type: "login" }
  /** 탐침: 이 기준을 시작한 뒤 앱이 **서버에 쓰기 요청**을 보냈는지 vs 브라우저 저장소(localStorage·sessionStorage)만 바뀌었는지. */
  | { type: "probe_storage" }
  | { type: "judge"; verdict: AcStatus; reason: string; evidenceQuote: string; reasonCode?: AcReasonCode };

export const ALLOWED_KEYS = ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Space", "Backspace"] as const;
const ROLE_RE = /^[a-z]{2,20}$/;
const MAX_VALUE = 200;
const MAX_TARGET_TEXT = 120;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function parseTarget(v: unknown): ActionTarget | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const t: ActionTarget = {};
  const role = str(o["role"], 20);
  if (role && ROLE_RE.test(role)) t.role = role;
  for (const k of ["name", "text", "label", "placeholder"] as const) {
    const s = str(o[k], MAX_TARGET_TEXT);
    if (s) t[k] = s;
  }
  // 무엇을 가리키는지 사람 말이 하나는 있어야 한다(역할만으로는 첫 번째 아무거나가 된다).
  return t.name || t.text || t.label || t.placeholder ? t : null;
}

/** LLM 답에서 첫 JSON 객체를 꺼낸다(앞뒤 설명·코드펜스 허용). */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * LLM 출력 → 검증된 행동. 모르는 type·빠진 필드·범위 밖 값은 거절(이유와 함께) — 실행기는 거절을 다음 턴
 * 기록에 넣어 모델이 고치게 한다. 같은 출처(goto)·키 허용 목록·대기 상한은 여기서 강제한다.
 */
export function parseAgentAction(raw: unknown, origin: string): { ok: true; action: AgentAction } | { ok: false; error: string } {
  const obj = typeof raw === "string" ? extractJsonObject(raw) : raw;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { ok: false, error: "no_json_object" };
  const o = obj as Record<string, unknown>;
  const a = (typeof o["action"] === "object" && o["action"] !== null ? o["action"] : o) as Record<string, unknown>;
  const type = a["type"];
  switch (type) {
    case "click": {
      const target = parseTarget(a["target"]);
      if (!target) return { ok: false, error: "click_needs_target" };
      return { ok: true, action: { type, target, ...(a["ownRecord"] === true ? { ownRecord: true } : {}) } };
    }
    case "fill":
    case "select": {
      const target = parseTarget(a["target"]);
      const value = typeof a["value"] === "string" && a["value"].length <= MAX_VALUE ? a["value"] : null;
      if (!target || value === null) return { ok: false, error: `${type}_needs_target_and_value` };
      return { ok: true, action: { type, target, value } };
    }
    case "press": {
      const key = typeof a["key"] === "string" ? a["key"] : "";
      if (!(ALLOWED_KEYS as readonly string[]).includes(key)) return { ok: false, error: "key_not_allowed" };
      return { ok: true, action: { type, key } };
    }
    case "goto": {
      const path = typeof a["path"] === "string" ? a["path"].trim() : "";
      const resolved = resolveSameOrigin(path, origin);
      if (!resolved) return { ok: false, error: "goto_must_be_same_origin" };
      return { ok: true, action: { type, path: resolved } };
    }
    case "reload":
    case "back":
    case "new_session":
    case "login":
    case "probe_storage":
      return { ok: true, action: { type } };
    case "set_clock": {
      const iso = typeof a["iso"] === "string" ? a["iso"].trim() : "";
      const ms = Date.parse(iso);
      if (!iso || !Number.isFinite(ms)) return { ok: false, error: "set_clock_needs_iso" };
      return { ok: true, action: { type, iso: new Date(ms).toISOString() } };
    }
    case "wait": {
      const ms = typeof a["ms"] === "number" && Number.isFinite(a["ms"]) ? Math.round(a["ms"]) : NaN;
      if (!(ms >= 100 && ms <= 5000)) return { ok: false, error: "wait_ms_100_to_5000" };
      return { ok: true, action: { type, ms } };
    }
    case "judge": {
      const verdict = a["verdict"];
      if (verdict !== "pass" && verdict !== "fail" && verdict !== "not_verified") return { ok: false, error: "judge_verdict_invalid" };
      const reason = str(a["reason"], 400);
      if (!reason) return { ok: false, error: "judge_needs_reason" };
      const evidenceQuote = typeof a["evidenceQuote"] === "string" ? a["evidenceQuote"].trim().slice(0, 300) : "";
      const rc = a["reasonCode"];
      const reasonCode = typeof rc === "string" && (AC_REASON_CODES as readonly string[]).includes(rc) ? (rc as AcReasonCode) : undefined;
      return { ok: true, action: { type, verdict, reason, evidenceQuote, ...(reasonCode ? { reasonCode } : {}) } };
    }
    default:
      return { ok: false, error: "unknown_action_type" };
  }
}

/** 같은 출처일 때만 절대 주소로. 다른 출처·javascript:·mailto: 등은 null. */
export function resolveSameOrigin(pathOrUrl: string, origin: string): string | null {
  if (!pathOrUrl) return null;
  try {
    const base = new URL(origin);
    const u = new URL(pathOrUrl, base.origin + "/");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin === base.origin ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 행동을 사람이 읽는 한 줄로(리포트·기록). 값은 그대로 보이므로 호출 전에 비밀을 가린다. */
export function describeAction(a: AgentAction, locale: ReportLocale = "ko"): string {
  const en = locale === "en";
  const tgt = (t: ActionTarget) => t.name ?? t.label ?? t.text ?? t.placeholder ?? "?";
  switch (a.type) {
    case "click": return en ? `click "${tgt(a.target)}"` : `"${tgt(a.target)}" 누르기`;
    case "fill": return en ? `type "${a.value}" into "${tgt(a.target)}"` : `"${tgt(a.target)}"에 "${a.value}" 입력`;
    case "select": return en ? `choose "${a.value}" in "${tgt(a.target)}"` : `"${tgt(a.target)}"에서 "${a.value}" 고르기`;
    case "press": return en ? `press ${a.key}` : `${a.key} 키 누르기`;
    case "goto": return en ? `open ${a.path}` : `${a.path} 열기`;
    case "reload": return en ? "reload the page" : "새로고침";
    case "back": return en ? "go back" : "뒤로 가기";
    case "new_session": return en ? "open the site as a different visitor (new browser)" : "다른 손님처럼 새 브라우저로 열기";
    case "set_clock": return en ? `set the clock to ${a.iso}` : `시계를 ${a.iso}로 맞추기`;
    case "wait": return en ? `wait ${a.ms}ms` : `${a.ms}ms 기다리기`;
    case "login": return en ? "sign in with the test account" : "시험 계정으로 로그인";
    case "probe_storage": return en ? "check where the data was saved (server vs this browser only)" : "저장된 곳 확인(서버인지 이 브라우저에만인지)";
    case "judge": return en ? `judge: ${a.verdict}` : `판정: ${a.verdict}`;
  }
}

// ─── 증거 접지 ──────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 인용이 관찰 기록 안에 (공백·대소문자 무시) 그대로 있는가. 2자 미만 인용은 근거가 아니다. */
export function isGrounded(quote: string, corpus: string): boolean {
  const q = norm(quote ?? "");
  if (q.length < 2) return false;
  return norm(corpus ?? "").includes(q);
}

export type LoginGate = "password" | "oauth" | "sms" | null;

/**
 * 판정 최종화 — LLM의 judge를 그대로 믿지 않는다:
 *   1) pass·fail은 인용이 관찰 기록에 있어야 한다. 없으면 not_verified(evidence_missing).
 *   2) 로그인 벽 앞에서의 fail은 앱 고장이 아니라 "못 들어감"이다 → not_verified(사유별).
 */
export function finalizeJudge(
  judge: Extract<AgentAction, { type: "judge" }>,
  ctx: { corpus: string; loginGate: LoginGate; hasCredentials: boolean; locale: ReportLocale; onGuessedAddress?: boolean },
): { status: AcStatus; reason: string; reasonCode?: AcReasonCode; evidence: string[] } {
  const en = ctx.locale === "en";
  const gateReason = gateNotVerified(ctx.loginGate, ctx.hasCredentials, ctx.locale);
  if (judge.verdict === "fail" && gateReason) return { status: "not_verified", ...gateReason, evidence: [] };
  // 앱에 링크가 없는 주소를 짐작해 열었는데 "없음"이 나온 것은 앱의 고장이 아니다(벤치마크 #1 로컬 실측에서 발견:
  // 지어낸 /result 주소의 404를 근거로 '안 됨'이라 했다).
  if (judge.verdict === "fail" && ctx.onGuessedAddress) {
    return { status: "not_verified", reason: reasonText("guessed_address", ctx.locale), reasonCode: "guessed_address", evidence: [] };
  }
  if (judge.verdict === "not_verified") {
    const code = judge.reasonCode ?? (gateReason?.reasonCode);
    return {
      status: "not_verified",
      reason: code ? reasonText(code, ctx.locale) : judge.reason,
      ...(code ? { reasonCode: code } : {}),
      evidence: [],
    };
  }
  if (!isGrounded(judge.evidenceQuote, ctx.corpus)) {
    return {
      status: "not_verified",
      reason: en
        ? "The checker's conclusion could not be tied to anything actually seen on the screen, so it is not counted."
        : "판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요.",
      reasonCode: "evidence_missing",
      evidence: [],
    };
  }
  return { status: judge.verdict, reason: judge.reason, evidence: [judge.evidenceQuote] };
}

function gateNotVerified(gate: LoginGate, hasCredentials: boolean, locale: ReportLocale): { reason: string; reasonCode: AcReasonCode } | null {
  if (gate === "oauth") return { reasonCode: "oauth_unsupported", reason: reasonText("oauth_unsupported", locale) };
  if (gate === "sms") return { reasonCode: "sms_unsupported", reason: reasonText("sms_unsupported", locale) };
  if (gate === "password" && !hasCredentials) return { reasonCode: "login_required", reason: reasonText("login_required", locale) };
  return null;
}

const REASON_TEXT: Record<ReportLocale, Record<AcReasonCode, string>> = {
  ko: {
    login_required: "로그인 필요 — 시험 계정을 주시면 들어가서 확인해요",
    login_failed: "주신 시험 계정으로 로그인하지 못했어요 — 아이디·비밀번호를 확인해 주세요",
    oauth_unsupported: "카카오·구글 로그인은 아직 직접 들어갈 수 없어요 — 다음 단계에서 직접 로그인한 화면을 넘겨받는 방식으로 열어요",
    sms_unsupported: "문자 인증이 필요한 로그인은 아직 들어갈 수 없어요",
    api_key_required: "이 기능은 사용자의 API 키를 넣어야 동작해서, 키 없이 확인할 수 없었어요",
    unsafe_action: "결제·삭제·발송처럼 되돌릴 수 없는 동작이 필요해서 누르지 않았어요",
    budget: "시간·횟수 한도 안에 확인을 끝내지 못했어요",
    evidence_missing: "판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요",
    app_missing: "앱 첫 화면이 열리지 않아 확인할 수 없었어요",
    not_reached: "정해진 단계 안에 이 기준을 확인할 화면까지 가지 못했어요",
    agent_error: "확인 도중 오류가 나서 끝까지 보지 못했어요",
    guessed_address: "앱에 연결되지 않은 주소를 짐작해 열어 본 결과라 고장으로 치지 않았어요",
    judge_disagreed: "두 번 따져 본 판단이 서로 달라서 결과로 치지 않았어요",
  },
  en: {
    login_required: "Sign-in needed — give us a test account and we'll check behind the login",
    login_failed: "We couldn't sign in with the test account you gave — please check the ID and password",
    oauth_unsupported: "We can't sign in through Kakao/Google yet — next phase: you sign in yourself and hand the session over",
    sms_unsupported: "Sign-ins that need a text-message code are not supported yet",
    api_key_required: "This feature needs the user's own API key, so it couldn't be checked without one",
    unsafe_action: "It needed an action that can't be undone (payment, delete, send), so we didn't press it",
    budget: "We ran out of time/attempts before finishing this check",
    evidence_missing: "The conclusion couldn't be tied to anything actually seen on screen, so it isn't counted",
    app_missing: "The app's first screen didn't open, so this couldn't be checked",
    not_reached: "We couldn't reach the screen needed for this check within the step limit",
    agent_error: "An error interrupted the check before it finished",
    guessed_address: "That result came from an address we guessed (not linked from the app), so it isn't counted as a defect",
    judge_disagreed: "A second, independent review disagreed with the result, so it isn't counted",
  },
};

export function reasonText(code: AcReasonCode, locale: ReportLocale = "ko"): string {
  return REASON_TEXT[locale === "en" ? "en" : "ko"][code];
}

/** 화면에서 보이는 단서로 로그인 벽의 종류를 고른다(비밀번호 칸 > 문자 인증 > 소셜 로그인만). */
export function detectLoginGate(o: { hasPasswordField: boolean; text: string }): LoginGate {
  const t = o.text ?? "";
  if (/인증\s*번호|인증\s*코드|verification code|sms code|one[- ]time code/i.test(t) && !o.hasPasswordField) return "sms";
  if (o.hasPasswordField) return "password";
  if (/(카카오|kakao|구글|google|네이버|naver|apple|github)\s*(로|으로)?\s*(로그인|계속|시작|sign in|log in|continue)/i.test(t)
    || /(sign in|log in|continue) with (google|kakao|apple|github|naver)/i.test(t)) return "oauth";
  return null;
}

// ─── 비밀 가림 ──────────────────────────────────────────────────────────────────

export const REDACTED = "[REDACTED]";
/** 이보다 짧은 값은 가림 대상으로 쓰지 않는다(한 글자 비밀번호가 본문 전체를 지우는 일을 막는다 — 라우트가 최소 길이를 강제). */
export const MIN_SECRET_LENGTH = 3;

/** 문자열 안의 비밀(원문·URL 인코딩)을 모두 가린다. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const s of secrets) {
    if (typeof s !== "string" || s.length < MIN_SECRET_LENGTH) continue;
    for (const variant of new Set([s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)])) {
      if (variant) out = out.split(variant).join(REDACTED);
    }
  }
  return out;
}

/** 객체 전체(리포트·콜백 본문)를 깊이 가린다. 키는 건드리지 않는다. */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (!secrets.some((s) => typeof s === "string" && s.length >= MIN_SECRET_LENGTH)) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactSecrets(v, secrets);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

// ─── 사이트 점검(화면·버튼) ────────────────────────────────────────────────────

const SKIP_LINK = /^(mailto:|tel:|javascript:|data:|blob:)/i;
const FILE_EXT = /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|csv|xlsx?|docx?|hwp)$/i;

/**
 * 점검할 화면 목록 — 같은 출처 링크만, 해시 무시·중복 제거, 파일 다운로드 제외, 위험한 이름(로그아웃·삭제…) 제외,
 * 시작 화면 포함 상한 `cap`.
 */
export function discoverSweepTargets(
  start: string,
  links: ReadonlyArray<{ href: string; text?: string }>,
  cap: number = SWEEP_MAX_SCREENS,
  isSafeText: (t: string) => boolean = () => true,
): { targets: string[]; truncated: boolean } {
  const seen = new Set<string>();
  const out: string[] = [];
  const key = (u: string) => {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  };
  const startAbs = resolveSameOrigin(start, start);
  if (startAbs) {
    seen.add(key(startAbs));
    out.push(key(startAbs));
  }
  let truncated = false;
  for (const l of links) {
    if (!l || typeof l.href !== "string" || SKIP_LINK.test(l.href.trim())) continue;
    const abs = resolveSameOrigin(l.href.trim(), start);
    if (!abs) continue;
    const k = key(abs);
    if (seen.has(k) || FILE_EXT.test(new URL(k).pathname)) continue;
    const label = (l.text ?? "").trim();
    if (label && !isSafeText(label)) continue;
    if (/logout|signout|sign-out|log-out|delete|remove/i.test(new URL(k).pathname)) continue;
    seen.add(k);
    if (out.length >= cap) {
      truncated = true;
      continue;
    }
    out.push(k);
  }
  return { targets: out, truncated };
}

/** 한 화면에서 누를 버튼 — 안전한 것만, 점검 전체에서 같은 이름은 한 번, 화면당·전체 상한. */
export function selectSweepButtons(
  labels: readonly string[],
  opts: { alreadyClicked: ReadonlySet<string>; remaining: number; perScreen?: number; isSafeText: (t: string) => boolean },
): { click: string[]; skippedUnsafe: string[] } {
  const per = Math.min(opts.perScreen ?? SWEEP_MAX_BUTTONS_PER_SCREEN, Math.max(0, opts.remaining));
  const click: string[] = [];
  const skippedUnsafe: string[] = [];
  const local = new Set<string>();
  for (const raw of labels) {
    const label = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label || local.has(label) || opts.alreadyClicked.has(label)) continue;
    local.add(label);
    if (!opts.isSafeText(label)) {
      skippedUnsafe.push(label);
      continue;
    }
    if (click.length < per) click.push(label);
  }
  return { click, skippedUnsafe };
}

const ERROR_TEXT_RE =
  /(application error|something went wrong|unhandled (runtime )?error|internal server error|cannot (get|post) \/|this page could not be found|page not found|404 not found|오류가 발생했|문제가 발생했|페이지를 찾을 수 없)/i;

/** 화면 하나의 판정(상태 코드·빈 화면·오류 문구·새 크래시). */
export function classifyScreen(o: { status: number | null; bodyText: string; newCrashes: number }): Pick<SweepScreen, "ok" | "problem" | "detail"> {
  if (o.status !== null && o.status >= 400 && o.status !== 401 && o.status !== 403 && o.status !== 407) {
    return { ok: false, problem: "http_error", detail: `HTTP ${o.status}` };
  }
  if (o.newCrashes > 0) return { ok: false, problem: "crash", detail: `${o.newCrashes} uncaught error(s)` };
  const m = ERROR_TEXT_RE.exec(o.bodyText ?? "");
  if (m) return { ok: false, problem: "error_text", detail: m[0] };
  if ((o.bodyText ?? "").replace(/\s+/g, "").length < 5) return { ok: false, problem: "blank" };
  return { ok: true };
}

// ─── 판정 사다리 ────────────────────────────────────────────────────────────────

export interface AgentSignals {
  pageNotFound?: boolean;
  missingIndexFile?: boolean;
  loadStatus?: number | null;
  outputLanguageMismatch?: { found: string; sample: string } | null;
  needsUserCredential?: { sample: string } | null;
  /** 첫 화면 로드에서 관찰한 앱/백엔드 실패(잡음 제외). */
  networkFailures?: string[];
}

export function sweepBreakage(s: SweepResult | null | undefined): { screens: SweepScreen[]; buttonErrors: SweepButton[]; noReaction: SweepButton[] } {
  return {
    screens: (s?.screens ?? []).filter((x) => !x.ok),
    buttonErrors: (s?.buttons ?? []).filter((b) => b.outcome === "error"),
    noReaction: (s?.buttons ?? []).filter((b) => b.outcome === "no_reaction"),
  };
}

export function decideAgentVerdict(input: {
  acs: readonly AgentAc[];
  results: readonly AcResult[];
  sweep?: SweepResult | null;
  signals?: AgentSignals;
}): { decision: "Ready" | "Conditionally Ready" | "Needs Fix" | "Not Verified"; works: boolean | null; basis: string } {
  if (input.signals?.pageNotFound) return { decision: "Needs Fix", works: false, basis: "app_missing" };
  const byId = new Map(input.results.map((r) => [r.id, r]));
  const must = input.acs.filter((a) => a.priority === "must");
  if (must.some((a) => byId.get(a.id)?.status === "fail")) return { decision: "Needs Fix", works: false, basis: "must_failed" };
  const br = sweepBreakage(input.sweep);
  if (br.screens.length > 0 || br.buttonErrors.length > 0) return { decision: "Needs Fix", works: false, basis: "sweep_broken" };
  if (must.length > 0 && must.every((a) => byId.get(a.id)?.status === "pass")) {
    // "작동한다"는 화면에 무엇이 **보인다**로는 말할 수 없다: 적어도 하나의 must가 핵심 일을 실제로 해서 앱 상태를
    // 바꾸고(입력→제출), 그 결과가 남는지·보여야 할 곳에 보이는지까지 확인했어야 한다(벤치마크 #1 run-1 반대 판정).
    const coreExercised = must.some((a) => {
      const e = byId.get(a.id)?.exercised;
      return e?.stateChange === true && e.verified === true;
    });
    if (!coreExercised) return { decision: "Not Verified", works: null, basis: "core_goal_not_exercised" };
    return must.every((a) => a.confirmed)
      ? { decision: "Ready", works: true, basis: "all_must_passed_confirmed" }
      : { decision: "Conditionally Ready", works: true, basis: "all_must_passed_inferred" };
  }
  return { decision: "Not Verified", works: null, basis: must.length === 0 ? "no_must_criteria" : "must_not_verified" };
}

// ─── 리포트 ─────────────────────────────────────────────────────────────────────

export interface AgentAcRow {
  id: string;
  title: string;
  priority: AcPriority;
  confirmed: boolean;
  then: string;
  status: AcStatus;
  reason: string;
  reasonCode?: AcReasonCode;
  evidence: string[];
  actions?: string[];
  screenshot?: string;
  exercised?: { stateChange: boolean; verified: boolean };
}

export interface AgentReportExtras {
  engine: "agent";
  acTable: AgentAcRow[];
  acSummary: { total: number; pass: number; fail: number; notVerified: number; mustTotal: number; mustPass: number };
  sweep: {
    screensChecked: number;
    screensBroken: number;
    buttonsChecked: number;
    buttonsNoReaction: number;
    buttonErrors: number;
    buttonsSkippedUnsafe: number;
    truncated: SweepResult["truncated"];
    problems: Array<{ kind: "screen" | "button"; where: string; label?: string; problem: string; detail?: string }>;
  } | null;
  /** 재검수가 **같은 기준**으로 돌도록 AC 정의를 함께 남긴다. */
  agent: { acs: AgentAc[]; acSource: AcSource; acSourceLabel: string; loginDepth: "L1" | "L3"; loginMethod: LoginMethod; basis: string };
}

export type LoginMethod = "none" | "signup" | "credentials" | "handover";

export type AgentReport = NonDevReport & AgentReportExtras;

export interface AgentReportInput {
  targetUrl: string;
  intent: string;
  acs: AgentAc[];
  acSource: AcSource;
  results: AcResult[];
  sweep: SweepResult | null;
  signals: AgentSignals;
  loginDepth: "L1" | "L3";
  loginMethod: LoginMethod;
  partial?: boolean;
}

const RSTR = {
  ko: {
    title: "앱 확인 결과 (수용 기준별)",
    oneLine: {
      Ready: (n: number) => `확인하신 핵심 기준 ${n}개를 실제로 해 봤고 모두 통과했어요.`,
      "Conditionally Ready": (n: number) => `핵심 기준 ${n}개를 실제로 해 봤고 모두 통과했어요. 다만 기준을 아직 확인받지 않았어요.`,
      mustFailed: (n: number) => `핵심 기준 ${n}개가 실제로 해 보니 되지 않았어요.`,
      sweep: "기준은 통과했거나 확인 전이지만, 열리지 않는 화면이나 오류가 나는 버튼이 있어요.",
      appMissing: "앱 첫 화면이 열리지 않아요.",
      notVerified: (n: number) => `핵심 기준 중 ${n}개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.`,
      noMust: "확인할 핵심 기준이 없어 판단하지 않았어요.",
      notExercised: "보이는 것은 기준대로였지만, 핵심 일을 실제로 끝까지 해 보고 결과가 남는지까지는 확인하지 못해 아직 '작동한다'고 말할 수 없어요.",
    },
    acFailWhat: (t: string) => `기준이 지켜지지 않아요: ${t}`,
    acFailWhy: (r: string) => `실제로 해 보니: ${r}`,
    acFailHow: (then: string) => `이렇게 되어야 해요: ${then}`,
    screenWhat: (u: string) => `열리지 않거나 오류가 나는 화면이 있어요 (${u})`,
    screenWhy: (p: string) => `화면 점검에서 관찰: ${p}`,
    screenHow: "이 화면이 정상적으로 열리고 내용이 보이게 고쳐 주세요.",
    buttonWhat: (l: string) => `누르면 오류가 나는 버튼이 있어요 ("${l}")`,
    buttonWhy: (d: string) => `버튼 점검에서 관찰: ${d}`,
    buttonHow: "이 버튼을 눌렀을 때 오류 없이 원래 하려던 일이 되게 고쳐 주세요.",
    noReactionNote: (n: number) => `눌러도 반응이 없는 버튼 ${n}개가 있었어요(장식용일 수도 있어 판정에는 넣지 않았어요).`,
    notVerifiedNote: (id: string, r: string) => `${id} 확인 못 함 — ${r}`,
    unconfirmedFailNote: (t: string, r: string) => `확인받지 않은 기준 "${t}"에서 본 것(고칠 것에 넣지 않음): ${r}`,
    inferredNote: "이번 기준은 앱을 보고 추정한 것이에요. 기준을 확인해 주시면 다음 확인부터 그 기준으로 봐요.",
    partialNote: "시간 안에 다 확인하지 못해 여기까지 본 내용만 담았어요.",
    loginNote: {
      none: "로그인 뒤 화면은 보지 않았어요.",
      signup: "일회용 계정으로 가입해 로그인 뒤까지 확인했어요.",
      credentials: "주신 시험 계정으로 로그인해 확인했어요.",
      handover: "직접 로그인해 넘겨주신 화면으로 로그인 뒤까지 확인했어요.",
    },
    documentDiff: "기획서(문서)에 적힌 대로 동작하지 않는 곳이 있어요 — 생각하신 것과 달라요.",
    basis: (label: string) => `이렇게 이해하고 검사했어요: ${label}`,
    next: {
      fix: "아래 '고칠 것'을 만든 도구(빌더)에 그대로 붙여 넣어 고친 뒤, 다시 확인을 눌러 주세요. 같은 기준으로 다시 봐요.",
      verify: "확인 못 한 기준의 이유를 해결하면(예: 시험 계정 제공) 다음 확인에서 볼 수 있어요.",
      ok: "직접 한 번 써 보시고 생각한 대로인지 알려 주세요.",
    },
  },
  en: {
    title: "App check result (by acceptance criterion)",
    oneLine: {
      Ready: (n: number) => `We actually performed all ${n} core criteria you confirmed, and every one passed.`,
      "Conditionally Ready": (n: number) => `We actually performed ${n} core criteria and all passed — but the criteria haven't been confirmed by you yet.`,
      mustFailed: (n: number) => `${n} core criteria did not work when we actually tried them.`,
      sweep: "The criteria passed or weren't verified, but some screens don't open or some buttons throw errors.",
      appMissing: "The app's first screen does not open.",
      notVerified: (n: number) => `We couldn't verify ${n} core criteria, so we can't say it works yet.`,
      noMust: "There were no core criteria to check, so no judgement was made.",
      notExercised: "What's on screen matched, but we couldn't complete the app's main job end to end and confirm the result stays — so we can't say it works yet.",
    },
    acFailWhat: (t: string) => `Criterion not met: ${t}`,
    acFailWhy: (r: string) => `When we tried it: ${r}`,
    acFailHow: (then: string) => `It should: ${then}`,
    screenWhat: (u: string) => `A screen doesn't open or shows an error (${u})`,
    screenWhy: (p: string) => `Screen check observed: ${p}`,
    screenHow: "Make this screen open normally and show its content.",
    buttonWhat: (l: string) => `A button throws an error when pressed ("${l}")`,
    buttonWhy: (d: string) => `Button check observed: ${d}`,
    buttonHow: "Make this button do what it's meant to without an error.",
    noReactionNote: (n: number) => `${n} button(s) did nothing when pressed (they may be decorative, so they don't affect the verdict).`,
    notVerifiedNote: (id: string, r: string) => `${id} not verified — ${r}`,
    unconfirmedFailNote: (t: string, r: string) => `Seen under the unconfirmed criterion "${t}" (not added to fixes): ${r}`,
    inferredNote: "These criteria were inferred from the app. Confirm them and the next check will use them as the standard.",
    partialNote: "We ran out of time, so this covers only what was checked so far.",
    loginNote: {
      none: "Screens behind sign-in were not checked.",
      signup: "We signed up with a disposable account and checked behind the login.",
      credentials: "We signed in with the test account you gave and checked.",
      handover: "You signed in yourself and handed the session over; we checked behind the login with it.",
    },
    documentDiff: "Some things don't behave the way your plan document says — it differs from what you had in mind.",
    basis: (label: string) => `How we understood and checked it: ${label}`,
    next: {
      fix: "Paste the 'what to fix' below into the builder you used, then press check again — we'll re-check against the same criteria.",
      verify: "Resolve the reason for each unverified criterion (e.g. give a test account) and the next check can cover it.",
      ok: "Try it once yourself and tell us whether it's what you had in mind.",
    },
  },
} as const;

/** #594 신호 → 기존 classifyFindings 그대로(같은 문구·같은 코드). 에이전트 엔진은 신호만 빌려 쓴다. */
const SIGNAL_CODES = new Set(["page_not_found", "missing_index_file", "output_language_mismatch", "needs_user_credential", "dns_unresolved", "network_5xx"]);

function signalFindings(input: AgentReportInput, decision: string, locale: ReportLocale): NonDevFinding[] {
  const v: VisualCheckInput = {
    targetUrl: input.targetUrl,
    intentAnchor: input.intent,
    loadStatus: input.signals.loadStatus ?? null,
    primaryActionFound: true,
    interacted: true,
    routeAfterClick: null,
    routeChanged: false,
    consoleErrors: [],
    networkFailures: input.signals.networkFailures ?? [],
    decision,
    ...(input.signals.pageNotFound ? { pageNotFound: true } : {}),
    ...(input.signals.missingIndexFile ? { missingIndexFile: true } : {}),
    ...(input.signals.outputLanguageMismatch ? { outputLanguageMismatch: input.signals.outputLanguageMismatch } : {}),
    ...(input.signals.needsUserCredential ? { needsUserCredential: input.signals.needsUserCredential } : {}),
  };
  return classifyFindings(v, locale).filter((f) => f.code !== undefined && SIGNAL_CODES.has(f.code));
}

export function buildAgentReport(input: AgentReportInput, locale: ReportLocale = "ko"): AgentReport {
  const L: ReportLocale = locale === "en" ? "en" : "ko";
  const s = RSTR[L];
  const v = decideAgentVerdict({ acs: input.acs, results: input.results, sweep: input.sweep, signals: input.signals });
  const byId = new Map(input.results.map((r) => [r.id, r]));
  const acTable: AgentAcRow[] = input.acs.map((a) => {
    const r = byId.get(a.id);
    const row: AgentAcRow = {
      id: a.id,
      title: a.title,
      priority: a.priority,
      confirmed: a.confirmed,
      then: a.then,
      status: r?.status ?? "not_verified",
      reason: r?.reason ?? reasonText(input.signals.pageNotFound ? "app_missing" : "budget", L),
      evidence: r?.evidence ?? [],
    };
    const code = r?.reasonCode ?? (r ? undefined : input.signals.pageNotFound ? "app_missing" : "budget");
    if (code) row.reasonCode = code;
    if (r?.actions?.length) row.actions = r.actions.slice(0, 20);
    if (r?.screenshot) row.screenshot = r.screenshot;
    if (r?.exercised) row.exercised = r.exercised;
    return row;
  });
  const must = acTable.filter((r) => r.priority === "must");
  const acSummary = {
    total: acTable.length,
    pass: acTable.filter((r) => r.status === "pass").length,
    fail: acTable.filter((r) => r.status === "fail").length,
    notVerified: acTable.filter((r) => r.status === "not_verified").length,
    mustTotal: must.length,
    mustPass: must.filter((r) => r.status === "pass").length,
  };

  // 고칠 것 = 실제로 관찰된 실패만: 실패한 AC(must high · 나머지 medium) + 화면/버튼 고장 + #594 신호.
  // 확인받지 않은 should/could 기준의 실패는 "고칠 것"이 아니라 노트다 — 사용자가 원한다고 말한 적 없는 기준으로 일감을
  // 만들지 않는다(벤치마크 #1 로컬 실측: 추정 기준 "처리 상태 표시"가 고침 지시에 들어갔다).
  const actionable = (r: AgentAcRow) => r.confirmed || r.priority === "must";
  const findings: NonDevFinding[] = [];
  for (const r of acTable) {
    if (r.status !== "fail" || !actionable(r)) continue;
    findings.push({
      severity: r.priority === "must" ? "high" : "medium",
      code: "ac_broken",
      what: s.acFailWhat(r.title),
      why: s.acFailWhy(r.reason),
      how: s.acFailHow(r.then),
      evidence: [r.id, ...r.evidence].join(" | ").slice(0, 600),
    });
  }
  const br = sweepBreakage(input.sweep);
  for (const sc of br.screens.slice(0, 10)) {
    findings.push({ severity: "high", code: "broken_route", what: s.screenWhat(sc.url), why: s.screenWhy(sc.detail ?? sc.problem ?? ""), how: s.screenHow, evidence: `${sc.url} ${sc.problem ?? ""} ${sc.detail ?? ""}`.trim() });
  }
  for (const b of br.buttonErrors.slice(0, 10)) {
    findings.push({ severity: "high", code: "step_failed", what: s.buttonWhat(b.label), why: s.buttonWhy(b.detail ?? ""), how: s.buttonHow, evidence: `${b.screen} "${b.label}" ${b.detail ?? ""}`.trim() });
  }
  findings.push(...signalFindings(input, v.decision, L));

  const notes: string[] = [s.basis(acSourceLabel(input.acSource, L)), s.loginNote[input.loginMethod]];
  if (input.acSource === "document" && acTable.some((r) => r.status === "fail")) notes.push(s.documentDiff);
  for (const r of acTable) if (r.status === "not_verified") notes.push(s.notVerifiedNote(r.id, r.reason));
  for (const r of acTable) if (r.status === "fail" && !actionable(r)) notes.push(s.unconfirmedFailNote(r.title, r.reason));
  if (br.noReaction.length > 0) notes.push(s.noReactionNote(br.noReaction.length));
  if (input.acSource === "inferred_at_run" || input.acs.some((a) => a.priority === "must" && !a.confirmed)) notes.push(s.inferredNote);
  if (input.partial) notes.push(s.partialNote);

  const mustFailed = must.filter((r) => r.status === "fail").length;
  const mustNotVerified = must.filter((r) => r.status === "not_verified").length;
  const oneLine =
    v.basis === "app_missing" ? s.oneLine.appMissing
    : v.basis === "must_failed" ? s.oneLine.mustFailed(mustFailed)
    : v.basis === "sweep_broken" ? s.oneLine.sweep
    : v.decision === "Ready" ? s.oneLine.Ready(must.length)
    : v.decision === "Conditionally Ready" ? s.oneLine["Conditionally Ready"](must.length)
    : v.basis === "no_must_criteria" ? s.oneLine.noMust
    : v.basis === "core_goal_not_exercised" ? s.oneLine.notExercised
    : s.oneLine.notVerified(mustNotVerified);

  const sweep = input.sweep
    ? {
        screensChecked: input.sweep.screens.length,
        screensBroken: br.screens.length,
        buttonsChecked: input.sweep.buttons.filter((b) => b.outcome !== "skipped_unsafe").length,
        buttonsNoReaction: br.noReaction.length,
        buttonErrors: br.buttonErrors.length,
        buttonsSkippedUnsafe: input.sweep.buttons.filter((b) => b.outcome === "skipped_unsafe").length,
        truncated: input.sweep.truncated,
        problems: [
          ...br.screens.map((x) => ({ kind: "screen" as const, where: x.url, problem: x.problem ?? "unknown", ...(x.detail ? { detail: x.detail } : {}) })),
          ...br.buttonErrors.map((b) => ({ kind: "button" as const, where: b.screen, label: b.label, problem: "error", ...(b.detail ? { detail: b.detail } : {}) })),
          ...br.noReaction.map((b) => ({ kind: "button" as const, where: b.screen, label: b.label, problem: "no_reaction" })),
        ].slice(0, 60),
      }
    : null;

  return {
    title: s.title,
    target: input.targetUrl,
    intent: input.intent,
    verdict: decisionLabelFor(v.decision, L),
    oneLine,
    works: v.works,
    findings,
    nextSteps: [findings.length > 0 ? s.next.fix : v.works ? s.next.ok : s.next.verify],
    notes,
    engine: "agent",
    acTable,
    acSummary,
    sweep,
    agent: {
      acs: input.acs,
      acSource: input.acSource,
      acSourceLabel: acSourceLabel(input.acSource, L),
      loginDepth: input.loginDepth,
      loginMethod: input.loginMethod,
      basis: v.basis,
    },
  };
}

function decisionLabelFor(decision: string, L: ReportLocale): string {
  const ko: Record<string, string> = { Ready: "정상 작동해요", "Conditionally Ready": "문제를 찾지 못했어요", "Needs Fix": "작동 안 해요 — 고쳐야 해요", "Not Verified": "확인 못 했어요" };
  const en: Record<string, string> = { Ready: "It works", "Conditionally Ready": "We could not find a problem", "Needs Fix": "It doesn't work — needs a fix", "Not Verified": "Couldn't verify" };
  return (L === "en" ? en : ko)[decision] ?? (L === "en" ? "Couldn't verify" : "확인 못 했어요");
}

/**
 * 에이전트용 고침 지시(CLI·코딩 에이전트에 넘기는 덩어리). **실제로 실패한 AC와 고장 난 화면·버튼에서만** 만든다.
 * 실패가 하나도 없으면 빈 문자열 — 고칠 것이 없는데 일감을 지어내지 않는다.
 */
export function buildAgentAcFixPrompt(report: Pick<AgentReport, "target" | "intent" | "acTable" | "sweep" | "findings">, locale: ReportLocale = "ko"): string {
  const en = locale === "en";
  const failed = report.acTable.filter((r) => r.status === "fail" && (r.confirmed || r.priority === "must"));
  const brokenScreens = (report.sweep?.problems ?? []).filter((p) => p.kind === "screen" || p.problem === "error");
  const signals = report.findings.filter((f) => f.code && SIGNAL_CODES.has(f.code));
  if (failed.length === 0 && brokenScreens.length === 0 && signals.length === 0) return "";
  const lines: string[] = [
    en
      ? "You are fixing a web app. Each item below was actually performed in a real browser and FAILED. Fix only these; do not change unrelated behaviour. After fixing, each criterion must pass exactly as written."
      : "웹 앱을 고치는 작업입니다. 아래 항목은 실제 브라우저에서 직접 해 보고 **실패한 것**입니다. 이것만 고치고 관련 없는 동작은 바꾸지 마세요. 고친 뒤 각 기준이 적힌 그대로 통과해야 합니다.",
    "",
    `${en ? "App" : "앱 주소"}: ${report.target}`,
    `${en ? "Intent" : "의도"}: ${report.intent}`,
    "",
  ];
  failed.forEach((r, i) => {
    lines.push(`${i + 1}. [${r.id} · ${r.priority}] ${r.title}`);
    lines.push(`   ${en ? "Expected" : "기대"}: ${r.then}`);
    if (r.actions?.length) lines.push(`   ${en ? "Steps to reproduce" : "재현 순서"}: ${r.actions.join(" → ")}`);
    lines.push(`   ${en ? "What happened" : "실제 결과"}: ${r.reason}`);
    if (r.evidence.length) lines.push(`   ${en ? "Evidence" : "근거"}: "${r.evidence.join('" / "')}"`);
    const cause = probableCause(`${r.reason} ${r.evidence.join(" ")}`, locale);
    if (cause) lines.push(`   ${en ? "Probable cause" : "추정 원인"}: ${cause}`);
  });
  if (brokenScreens.length) {
    lines.push("", en ? "Broken screens / buttons found while visiting every screen:" : "모든 화면을 돌아보다 발견한 고장 난 화면·버튼:");
    for (const p of brokenScreens.slice(0, 15)) lines.push(`- ${p.where}${p.label ? ` "${p.label}"` : ""}: ${p.problem}${p.detail ? ` (${p.detail})` : ""}`);
  }
  if (signals.length) {
    lines.push("", en ? "Other observed problems:" : "그 밖에 관찰된 문제:");
    for (const f of signals) lines.push(`- ${f.what} — ${f.how}`);
  }
  lines.push("", en ? "Simsa will re-run the same criteria after your fix." : "고친 뒤 Simsa가 같은 기준으로 다시 확인합니다.");
  return lines.join("\n");
}

/**
 * B4: 탐침이 남긴 고정 문구에서만 원인을 짚는다(주제별 규칙 없음). 근거가 없으면 null — 지어내지 않는다.
 */
export function probableCause(text: string, locale: ReportLocale = "ko"): string | null {
  const en = locale === "en";
  if (/saved only in this browser|server write requests since this check started = 0/i.test(text)) {
    return en
      ? "Data is stored only in the visitor's browser (localStorage/sessionStorage); nothing is saved on a server, so other users and devices can't see it. Store it in a shared database/back end."
      : "데이터가 방문자 브라우저 저장소(localStorage 등)에만 저장되고 서버에는 저장되지 않아요. 다른 사람·다른 기기에서 보이지 않으니 공용 데이터베이스(백엔드)에 저장하게 바꿔야 해요.";
  }
  if (/UTC|timezone|time zone|시간대/i.test(text)) {
    return en
      ? "'Today' or times seem computed in UTC instead of the user's time zone (Asia/Seoul)."
      : "'오늘'이나 시간이 사용자 시간대(한국 시간)가 아니라 UTC로 계산되는 것 같아요.";
  }
  return null;
}

// ─── LLM 프롬프트 ───────────────────────────────────────────────────────────────

/** 한국어 시험 데이터(실사용자 모양 — Rule 6). seed로 런마다 다르게(다른 손님과 섞이지 않게). */
export function koreanTestData(seed: number): { name: string; altName: string; phone: string; email: string; memo: string } {
  const names = ["김서연", "이도윤", "박지우", "최하준", "정수아", "강민준", "윤서윤", "장예준"];
  const n = Math.abs(Math.floor(seed)) || 1;
  const p1 = String(1000 + (n % 9000)).padStart(4, "0");
  const p2 = String(1000 + ((n * 7) % 9000)).padStart(4, "0");
  return {
    name: names[n % names.length]!,
    altName: names[(n + 3) % names.length]!,
    phone: `010-${p1}-${p2}`,
    email: `simsa.check+${n}@example.com`,
    memo: "심사 자동 확인용 예약입니다(테스트)",
  };
}

export function agentSystemPrompt(locale: ReportLocale = "ko"): string {
  return [
    "You are Simsa's acceptance tester. You operate a real browser on a web app built by a non-developer and decide, for ONE acceptance criterion at a time, whether the app actually does what the criterion says.",
    "Reply with exactly one JSON object and nothing else: {\"thought\": \"<short>\", \"action\": {...}}.",
    "Actions:",
    '- {"type":"click","target":{"role":"button","name":"예약하기"}}  (target keys: role, name, text, label, placeholder — use what the observation shows)',
    '- {"type":"fill","target":{"label":"이름"},"value":"김서연"}',
    '- {"type":"select","target":{"label":"시간"},"value":"10:30"}',
    '- {"type":"press","key":"Enter"}   (Enter, Tab, Escape, Arrow*, Space, Backspace only)',
    '- {"type":"goto","path":"/admin"}   (same site only)',
    '- {"type":"reload"} | {"type":"back"} | {"type":"wait","ms":1000}',
    '- {"type":"new_session"}   (fresh browser, no cookies/localStorage — a DIFFERENT customer or the owner on another device)',
    '- {"type":"set_clock","iso":"2026-10-06T01:00:00+09:00"}   (fake the device clock, then the page reloads)',
    '- {"type":"login"}   (sign in with the test account the user gave; you never see the password)',
    '- {"type":"probe_storage"}   (tool: reports whether, since this criterion started, the app sent write requests to a server or only changed this browser\'s localStorage/sessionStorage — quote its result as evidence)',
    '- {"type":"judge","verdict":"pass"|"fail"|"not_verified","reason":"<one plain sentence>","evidenceQuote":"<exact text copied from an observation>","reasonCode":"<optional>"}',
    "Rules:",
    "1. Actually perform the criterion end to end like a real user (fill every required field with the test data, submit, then look at the result). Do not judge from labels or prices alone.",
    "2. pass = you SAW the expected outcome. fail = you completed the steps and SAW the outcome is wrong or an error. Otherwise not_verified. evidenceQuote MUST be copied verbatim from an observation (screen text, network line or console line); a judgement without a real quote is discarded.",
    "2b. A criterion is NOT passed by seeing labels, inputs or buttons on screen. If the criterion is about an outcome, you must actually create the result (fill + submit) before judging pass.",
    "3. Persistence/sharing claims need proof: reload for 'survives refresh'; new_session for 'other customers can't pick it' or 'owner sees it on the admin screen' (data kept only in one browser's localStorage FAILS those).",
    "4. Time-dependent claims (today's list, time slots, 'today' dates) — use set_clock to probe edge hours (e.g. 00:30 and 23:30 Korea time) when relevant; note a server may compute 'today' in UTC, so compare the date shown with the Korea date.",
    "4b. When data must be shared between people or devices, run probe_storage after creating it: data that never reached a server cannot be seen by another customer or the owner.",
    "4c. If a result might be canned (same output whatever the input), submit twice with clearly different inputs and compare.",
    "5. Never pay, delete other people's data, send messages or publish. You may cancel/delete ONLY a record you created in this run (set ownRecord:true on that click).",
    "6. If a login wall blocks you: use login if a test account is available; if not, judge not_verified with reasonCode login_required. Kakao/Google/social-only login → oauth_unsupported; text-message code → sms_unsupported. If the feature asks for the user's own API key → api_key_required.",
    "7. Be efficient: at most 14 actions per criterion. Do not give up early: if a submit did nothing, read the visible messages (e.g. '시간을 골라 주세요', required-field errors), fix the inputs (choose a service/date/time first) and try again.",
    "8. Never invent addresses. Use goto only for an address you saw as a link on screen or that the criterion itself names. A 'not found' page at a guessed address is NOT a defect of the app.",
    "9. Selecting a time/date/service means clicking that option on the page (buttons, chips, radio) — check the observation that it became selected before submitting.",
    locale === "en" ? "Write `reason` in English." : "Write `reason` in Korean (한국어, 쉬운 말).",
  ].join("\n");
}

export interface AgentObservation {
  url: string;
  title: string;
  aria: string;
  text: string;
  networkErrors: string[];
  consoleErrors: string[];
  hasPasswordField: boolean;
}

/** 한 턴의 사용자 메시지. 관찰은 상한을 둬 토큰을 묶는다. 비밀은 호출 전에 가려져 있어야 한다. */
export function agentTurnPrompt(args: {
  ac: AgentAc;
  intent: string;
  observation: AgentObservation;
  history: readonly string[];
  testData: ReturnType<typeof koreanTestData>;
  hasCredentials: boolean;
  loginGate: LoginGate;
  stepsLeft: number;
  nowIso: string;
}): string {
  const o = args.observation;
  return [
    `App intent: ${args.intent}`,
    `Criterion ${args.ac.id} (${args.ac.priority}): ${args.ac.title}`,
    `Given: ${args.ac.given}`,
    `When: ${args.ac.when}`,
    `Then: ${args.ac.then}`,
    ...(args.ac.steps?.length ? [`Suggested steps: ${args.ac.steps.join(" → ")}`] : []),
    `Test data (Korean, use these): name=${args.testData.name}, second customer=${args.testData.altName}, phone=${args.testData.phone}, email=${args.testData.email}, memo=${args.testData.memo}`,
    `Test account available: ${args.hasCredentials ? "yes (use the login action)" : "no"}. Login wall detected on this screen: ${args.loginGate ?? "none"}.`,
    `Device clock now: ${args.nowIso}. Actions left for this criterion: ${args.stepsLeft}.`,
    "",
    "History (oldest first):",
    ...(args.history.length ? args.history.slice(-14).map((h, i) => `${i + 1}. ${h}`) : ["(none)"]),
    "",
    `Current URL: ${o.url}`,
    `Title: ${o.title}`,
    "Accessibility snapshot:",
    o.aria.slice(0, 7000),
    "",
    "Visible text:",
    o.text.slice(0, 3000),
    "",
    `Failed network requests: ${o.networkErrors.length ? o.networkErrors.slice(-6).join(" | ") : "none"}`,
    `Console errors: ${o.consoleErrors.length ? o.consoleErrors.slice(-6).join(" | ") : "none"}`,
  ].join("\n");
}

/** dev-spec이 없을 때: 첫 화면을 보고 AC를 추정한다(런에서 추정 — confirmed:false). */
export function acInferencePrompt(intent: string, observation: AgentObservation, locale: ReportLocale = "ko"): string {
  return [
    "You write acceptance criteria for a web app so a tester can verify it actually works.",
    `Stated intent: ${intent}`,
    `Current URL: ${observation.url}`,
    "Accessibility snapshot:",
    observation.aria.slice(0, 6000),
    "",
    "Return ONLY JSON: {\"acs\":[{\"title\":\"...\",\"given\":\"...\",\"when\":\"...\",\"then\":\"...\",\"priority\":\"must|should\"}]}",
    "3 to 8 criteria. 'must' = OUTCOMES of the app's core job: perform the main task end to end with real data, then the result persists after reload, shows up where it should (another visitor, the owner/admin or other role's screen), and conflicts/duplicates are handled. Criteria that only check something is DISPLAYED are 'should', never the only musts. Each 'then' must be observable in a browser.",
    "Do not invent features that neither the intent nor the screen suggests.",
    locale === "en" ? "Write in English." : "한국어로 쓰세요.",
  ].join("\n");
}

export function parseInferredAcs(text: string): AgentAc[] {
  const obj = extractJsonObject(text);
  const list = obj && typeof obj === "object" && Array.isArray((obj as { acs?: unknown }).acs) ? ((obj as { acs: unknown[] }).acs) : [];
  const out: AgentAc[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = str(r["title"], 200);
    const then = str(r["then"], 600);
    if (!title || !then) continue;
    out.push({
      id: `R-${out.length + 1}`,
      title,
      given: str(r["given"], 600) ?? "",
      when: str(r["when"], 600) ?? "",
      then,
      priority: r["priority"] === "must" ? "must" : "should",
      confirmed: false,
    });
    if (out.length >= 8) break;
  }
  return out;
}

// ─── A2 탐침 · A3 판정 재확인 ───────────────────────────────────────────────────

export interface StorageProbe {
  /** 기준 시작 뒤 앱이 보낸 쓰기 요청(POST·PUT·PATCH·DELETE, 데이터 요청만, 잡음 제외). */
  serverWrites: string[];
  localChanged: boolean;
  sessionChanged: boolean;
}

/** 탐침 결과를 관찰 기록 한 줄로 — 판정 근거로 그대로 인용할 수 있게 고정된 문구. */
export function describeStorageProbe(p: StorageProbe): string {
  const writes = p.serverWrites.length;
  return [
    `storage probe: server write requests since this check started = ${writes}${writes ? ` (${p.serverWrites.slice(0, 3).join(" | ")})` : ""}`,
    `localStorage changed = ${p.localChanged ? "yes" : "no"}`,
    `sessionStorage changed = ${p.sessionChanged ? "yes" : "no"}`,
    writes === 0 && (p.localChanged || p.sessionChanged) ? "verdict hint: saved only in this browser" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * A3: 판정을 다른 눈으로 한 번 더 — 같은 관찰 기록만 보고 "이 근거로 이 판정이 맞나"를 묻는다. 동의하지 않으면
 * not_verified(judge_disagreed). 판정을 뒤집지 않는다(통과→실패로 바꾸지 않음) — 확신이 없을 때 말을 아낄 뿐이다.
 */
export function judgeReviewPrompt(args: {
  ac: AgentAc;
  verdict: "pass" | "fail";
  reason: string;
  evidence: string[];
  actions: string[];
  observationTail: string;
}): string {
  return [
    "You are a skeptical reviewer of a browser test. Decide whether the tester's verdict is justified by what was actually observed. Be strict:",
    "- 'pass' needs proof the outcome happened (the result was created AND verified as the criterion requires — e.g. reload / another visitor / owner screen). Seeing labels, inputs or buttons is not proof.",
    "- 'fail' needs proof the steps were really completed and the outcome is wrong — not that the tester got lost, typed into the wrong place, or opened an address the app never linked.",
    'Reply JSON only: {"agree": true|false, "why": "<one sentence>"}',
    "",
    `Criterion ${args.ac.id} (${args.ac.priority}): ${args.ac.title}`,
    `Then: ${args.ac.then}`,
    `Tester's verdict: ${args.verdict} — ${args.reason}`,
    `Quoted evidence: ${args.evidence.map((e) => `"${e}"`).join(" ")}`,
    `Actions taken: ${args.actions.join(" → ") || "(none)"}`,
    "",
    "Observation log (latest last):",
    args.observationTail.slice(-6000),
  ].join("\n");
}

export function parseJudgeReview(text: string): { agree: boolean; why: string } | null {
  const o = extractJsonObject(text);
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r["agree"] !== "boolean") return null;
  return { agree: r["agree"], why: typeof r["why"] === "string" ? r["why"].slice(0, 300) : "" };
}

export const CORE_OUTCOME_AC_ID = "CORE-1";

/**
 * Simsa 기본 기준 — "이 앱의 핵심 일이 실제로 되는가"(모든 앱 공통, 주제별 조정 없음).
 * 추론·지시서 항목은 화면에 **보이는 것**에 치우친다(벤치마크 #1 run-1). 그래서 실행기는 의도 문장에서 핵심 일을
 * 실제 데이터로 끝까지 해 보고, 결과가 남는지·보여야 할 곳(다른 방문자·다른 역할의 화면)에서 보이는지·겹치는
 * 요청이 바르게 처리되는지까지 재는 기준 하나를 늘 맨 앞에 둔다. confirmed는 의도 문장이 사용자가 확인한 것일 때만.
 */
export function coreOutcomeAc(intent: string, confirmed: boolean, locale: ReportLocale = "ko"): AgentAc {
  const en = locale === "en";
  return {
    id: CORE_OUTCOME_AC_ID,
    title: en ? "The app's main job actually works end to end" : "앱의 핵심 일이 처음부터 끝까지 실제로 된다",
    given: en ? `The app's stated purpose: ${intent}` : `앱의 목적: ${intent}`,
    when: en
      ? "A real user completes the main task with realistic data (fill every required field and submit)"
      : "실제 사용자가 그럴듯한 데이터로 핵심 일을 끝까지 한다(필요한 칸을 모두 채우고 제출)",
    then: en
      ? "The result is created; it is still there after a reload; it appears wherever the purpose says it should (another visitor in a fresh browser, the owner/admin or other role's screen); and a conflicting or duplicate request is handled correctly"
      : "결과가 만들어지고, 새로고침해도 남아 있으며, 목적상 보여야 할 곳(새 브라우저의 다른 방문자, 사장님·관리자 등 다른 역할의 화면)에서도 보이고, 겹치거나 중복된 요청은 올바르게 처리된다",
    priority: "must",
    confirmed,
  };
}

export function withCoreOutcomeAc(acs: readonly AgentAc[], intent: string, confirmed: boolean, locale: ReportLocale = "ko"): AgentAc[] {
  return acs.some((a) => a.id === CORE_OUTCOME_AC_ID) ? [...acs] : [coreOutcomeAc(intent, confirmed, locale), ...acs];
}

/** must 먼저, 상한. */
export function orderAcs(acs: readonly AgentAc[], max: number = AGENT_MAX_ACS): AgentAc[] {
  const rank = { must: 0, should: 1, could: 2 } as const;
  return [...acs].sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, Math.max(0, max));
}

/** 재검수: 원 런 리포트에 남은 AC 정의를 그대로 꺼낸다(같은 자로 다시 잰다). 없거나 깨졌으면 null. */
export function acsFromAgentReport(reportJson: string | null | undefined): AgentAc[] | null {
  if (!reportJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reportJson);
  } catch {
    return null;
  }
  const agent = parsed && typeof parsed === "object" ? (parsed as { engine?: unknown; agent?: { acs?: unknown } }) : null;
  if (!agent || agent.engine !== "agent" || !Array.isArray(agent.agent?.acs)) return null;
  const out: AgentAc[] = [];
  for (const raw of agent.agent.acs as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r["id"], 40);
    const title = str(r["title"], 200);
    const then = str(r["then"], 2000);
    const p = r["priority"];
    if (!id || !title || !then || (p !== "must" && p !== "should" && p !== "could")) continue;
    out.push({
      id, title, then, priority: p,
      given: typeof r["given"] === "string" ? r["given"] : "",
      when: typeof r["when"] === "string" ? r["when"] : "",
      confirmed: r["confirmed"] === true,
      ...(Array.isArray(r["steps"]) ? { steps: (r["steps"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 30) } : {}),
    });
  }
  return out.length > 0 ? out.slice(0, AGENT_MAX_ACS) : null;
}
