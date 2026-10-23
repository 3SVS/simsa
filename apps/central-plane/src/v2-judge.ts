/**
 * v2-judge.ts — 검사 엔진 v2 S5c·d: 판정 후처리(결정론, LLM 없음) (2026-10-22).
 *
 * ① 첫 지점 규칙(라벨링 설계 §3.1): 같은 원인의 실패는 결함 하나로 센다. 벤치 #1에서 브라우저 전용 저장(A6) 하나가
 *    A5(사장님 화면)·A7(다른 방문자)로도 실패해 7칸이 중복 계수됐다. 같은 가설이 덮고 같은 결함 분류면 묶는다.
 * ② 마감 시각 해석: "10~19시, 30분 단위"에서 마지막 시작이 18:30인 것은 실패가 아니다(벤치 #1 gemini·claude A1 거짓 실패 6칸).
 *    판정을 뒤집지 않고 확인 못 함으로만 내린다 — 반대 판정을 만들 수 없는 방향.
 */
import { classifyDefect, type DefectClass } from "./agent-inspection.js";

export interface JudgedVerdict {
  acId: string;
  verdict: string;
  claim: string;
  quotes: string[];
}

export interface HypothesisRef {
  id: string;
  cls: string;
  coversAcIds: string[];
}

export interface DefectGroup {
  /** 묶음 열쇠 — 가설이 있으면 "H1:client_only_storage", 없으면 "A7:runtime_error" */
  key: string;
  cls: DefectClass;
  hypothesisId: string | null;
  /** 이 결함으로 실패한 기준(기준 순서대로) */
  acIds: string[];
  /** 첫 지점 — 기준 순서상 첫 기준(표시용) */
  rootAcId: string;
}

/**
 * 실패 판정을 결함 단위로 묶는다. acOrder = 사용자 기준 순서(표시·첫 지점 결정용).
 * classify를 주면 그 분류(S6a 증거 기반)로, 없으면 판정 문장 분류(classifyDefect)로 묶는다.
 */
export function groupFailures(
  verdicts: readonly JudgedVerdict[],
  hypotheses: readonly HypothesisRef[],
  acOrder: readonly string[],
  classify?: (v: JudgedVerdict) => DefectClass,
): DefectGroup[] {
  const rank = (id: string) => {
    const i = acOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const groups = new Map<string, DefectGroup>();
  const fails = verdicts.filter((v) => v.verdict === "fail").slice().sort((a, b) => rank(a.acId) - rank(b.acId));
  for (const v of fails) {
    const cls = classify ? classify(v) : classifyDefect({ status: "fail", reason: v.claim, evidence: v.quotes });
    const h = cls === "other" ? undefined : hypotheses.find((x) => x.cls === cls && x.coversAcIds.includes(v.acId));
    const key = h ? `${h.id}:${cls}` : `${v.acId}:${cls}`;
    const g = groups.get(key);
    if (g) g.acIds.push(v.acId);
    else groups.set(key, { key, cls, hypothesisId: h?.id ?? null, acIds: [v.acId], rootAcId: v.acId });
  }
  return [...groups.values()];
}

/** "오후 6시 30분" · "18:30" · "오후 6:30" · "7시 반" → 분(0~1439). 오전/오후 표시가 없으면 적힌 그대로. */
function toMinutes(ampm: string | undefined, h: number, m: number): number {
  let hour = h;
  if (ampm === "오후" && hour < 12) hour += 12;
  if (ampm === "오전" && hour === 12) hour = 0;
  return hour * 60 + m;
}

const TIME_RE = /(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분|\s*(반))?)/g;

function timesIn(text: string): { at: number; end: number; minutes: number }[] {
  const out: { at: number; end: number; minutes: number }[] = [];
  for (const m of text.matchAll(TIME_RE)) {
    const h = Number(m[2]);
    const min = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? Number(m[4]) : m[5] ? 30 : 0;
    if (h > 23 || min > 59) continue;
    out.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, minutes: toMinutes(m[1], h, min) });
  }
  return out;
}

/** 기준 문장의 마감 시각과 시간 단위(분). 둘 다 있어야 한다. */
function closingOf(ac: { title?: string; given?: string; when?: string; then?: string }): { close: number; step: number } | null {
  const text = [ac.title, ac.given, ac.when, ac.then].filter(Boolean).join(" ");
  const step = /(\d{1,3})\s*분\s*단위/.exec(text);
  if (!step) return null;
  const range = /(\d{1,2}):(\d{2})\s*[~〜-]\s*(\d{1,2}):(\d{2})/.exec(text);
  let close: number | null = range ? Number(range[3]) * 60 + Number(range[4]) : null;
  if (close === null) {
    const until = /(오전|오후)?\s*(\d{1,2})시\s*까지/.exec(text);
    if (until) close = toMinutes(until[1], Number(until[2]), 0);
  }
  return close === null ? null : { close, step: Number(step[1]) };
}

const LAST_AVAILABLE_RE = /까지만|까지 밖에|까지밖에|마지막|only (?:up )?(?:to|until)|last (?:slot|time)/;

/**
 * fail 판정이 "마감 시각까지 시작 칸이 있어야 한다"로 잘못 읽은 것인가: 기준에 마감·단위가 있고, 판정이 "X까지만"이라 말한 X가
 * 정확히 마감 − 단위(마지막 시작 칸)면 true.
 */
export function closingSlotMisread(ac: { title?: string; given?: string; when?: string; then?: string }, v: JudgedVerdict): boolean {
  if (v.verdict !== "fail") return false;
  const c = closingOf(ac);
  if (!c) return false;
  const lastStart = c.close - c.step;
  for (const text of [v.claim, ...v.quotes]) {
    const anchor = LAST_AVAILABLE_RE.exec(text);
    if (!anchor) continue;
    const before = timesIn(text).filter((t) => t.end <= anchor.index && anchor.index - t.end <= 4);
    const after = /^(?:마지막|last|only)/.test(anchor[0]) ? timesIn(text.slice(anchor.index)).slice(0, 1) : [];
    const said = before.at(-1) ?? after[0];
    if (said) return said.minutes === lastStart;
  }
  return false;
}

/** 정적 사실 기록(recon.recordStaticFacts 결과와 같은 모양). */
export interface RecordedFactRef {
  fact: { rule: string; cls: string; file: string; excerpt: string };
  artifactId: string | null;
}

export interface FailureCause {
  cls: DefectClass;
  /** 무엇으로 정했나 — 의도 불일치 판정 · 정적 사실(+맞는 증거) · 콘솔 증거 · 판정 문장(마지막 수단) */
  basis: "verdict" | "static_fact" | "console" | "claim_text";
  /** 원인을 보여 주는 실행 증거물(콘솔 등) */
  evidenceIds: string[];
  /** 원인 코드 조각 증거물(source) */
  sourceIds: string[];
  /** 원인 위치 — 정적 사실의 파일, 또는 콘솔 오류 줄의 파일:줄. 모르면 null */
  location: { file: string; line: number | null } | null;
}

interface ArtifactLike {
  id: string;
  kind: string;
  summary: string;
  raw: string;
  meta?: Record<string, unknown>;
}

const NETWORK_FAIL_RE = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CERT|Failed to fetch|NetworkError/i;
const UNCAUGHT_RE = /Uncaught|TypeError|ReferenceError|SyntaxError|RangeError/;
const STACK_LOC_RE = /\(?((?:https?:\/\/|\/)[^\s()]+?):(\d+):\d+\)?/;
const API_KEY_RE = /api ?키|api key|키를 (넣|입력)|키가 (없|필요)/i;

/** 정적 사실의 분류가 실행 증거와 맞는가 — 사실만으로 단정하지 않는다(사실은 "위험", 증거가 "발생"). */
function factConsistent(cls: string, v: JudgedVerdict, arts: readonly ArtifactLike[]): boolean {
  const text = `${v.claim} ${v.quotes.join(" ")}`;
  switch (cls) {
    case "client_only_storage":
      return arts.some((a) => (a.kind === "screen" && (a.meta?.["session"] === "fresh" || a.meta?.["session"] === "role")) || (a.kind === "storage" && a.meta?.["changed"] === true));
    case "timezone_date":
    case "server_rendered_dates":
      return arts.some((a) => a.kind === "context" && /시계 변형|clock/.test(a.summary)) || /날짜|date|어제|내일/i.test(text);
    case "needs_api_key":
      return API_KEY_RE.test(text) || arts.some((a) => a.kind === "screen" && API_KEY_RE.test(a.raw));
    case "missing_backend_config":
      return arts.some((a) => a.kind === "console" && NETWORK_FAIL_RE.test(a.raw)) || arts.some((a) => a.kind === "request" && Number(a.meta?.["status"]) >= 400);
    default:
      return false;
  }
}

const FACT_TO_DEFECT: Record<string, DefectClass> = {
  missing_backend_config: "missing_backend_config",
  client_only_storage: "client_only_storage",
  timezone_date: "timezone_date",
  server_rendered_dates: "timezone_date",
  needs_api_key: "needs_api_key",
};

/**
 * S6a·b: 실패(또는 불일치) 하나의 원인 분류 + 원인 위치. 우선순위:
 *   ① 의도 불일치 판정 → intent_mismatch
 *   ② 이 기준을 덮는 가설의 정적 사실 + 실행 증거가 맞음 → 그 분류(소스 증거물·파일)
 *   ③ 이 기준 실행 중 콘솔: 네트워크 실패 → missing_backend_config, 잡히지 않은 오류 → runtime_error(스택의 파일:줄)
 *   ④ 마지막 수단: 판정 문장(classifyDefect)
 * acArtifacts = 그 기준을 실행하는 동안 생긴 증거물(재실행 포함).
 */
export function classifyFailure(
  v: JudgedVerdict,
  ctx: { acArtifacts: readonly ArtifactLike[]; facts: readonly RecordedFactRef[]; hypotheses: readonly HypothesisRef[] },
): FailureCause {
  if (v.verdict === "mismatch") return { cls: "intent_mismatch", basis: "verdict", evidenceIds: [], sourceIds: [], location: null };
  for (const h of ctx.hypotheses) {
    if (!h.coversAcIds.includes(v.acId)) continue;
    const cls = FACT_TO_DEFECT[h.cls];
    if (!cls) continue;
    const facts = ctx.facts.filter((f) => FACT_TO_DEFECT[f.fact.cls] === cls);
    if (facts.length === 0 || !factConsistent(h.cls, v, ctx.acArtifacts)) continue;
    const first = facts[0];
    return {
      cls,
      basis: "static_fact",
      evidenceIds: [],
      sourceIds: facts.map((f) => f.artifactId).filter((x): x is string => Boolean(x)),
      location: first ? { file: first.fact.file, line: null } : null,
    };
  }
  const consoles = ctx.acArtifacts.filter((a) => a.kind === "console");
  const net = consoles.filter((a) => NETWORK_FAIL_RE.test(a.raw));
  if (net.length > 0) return { cls: "missing_backend_config", basis: "console", evidenceIds: net.map((a) => a.id), sourceIds: [], location: null };
  const crash = consoles.filter((a) => UNCAUGHT_RE.test(a.raw));
  if (crash.length > 0) {
    const m = crash.map((a) => STACK_LOC_RE.exec(a.raw)).find(Boolean);
    return { cls: "runtime_error", basis: "console", evidenceIds: crash.map((a) => a.id), sourceIds: [], location: m ? { file: m[1] ?? "", line: Number(m[2]) } : null };
  }
  return { cls: classifyDefect({ status: "fail", reason: v.claim, evidence: v.quotes }), basis: "claim_text", evidenceIds: [], sourceIds: [], location: null };
}
