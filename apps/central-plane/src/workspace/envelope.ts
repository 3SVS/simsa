/**
 * workspace/envelope.ts — C4a 데이터 봉투 (재정렬 D-8·D-20·D-21 amend, W1 §3 항목 4).
 *
 * 검수 런·수리 잡·프로젝트 행에 **맥락 봉투**를 찍는 두 도구:
 *   - regionFromRequest: Cloudflare 엣지가 붙이는 request.cf.country(ISO-3166, 거친 값·PII 아님).
 *     workspace-github.ts의 캡처 패턴을 한 곳으로 모았다. 로컬/테스트(cf 없음)는 null.
 *   - buildRunEnvelope: 런 시점의 프로젝트 스냅샷 { builtWith, entryPath, topicTags, locale, contentLang }.
 *     모양은 training-store.ts EnvelopeInput 의 부분집합 그대로(D-8 amend: "봉투 스키마는 그대로").
 *     **없는 값은 null** — 지어내지 않는다(D-3 정직성 계약).
 *
 * 순수 함수. DB·네트워크 없음.
 */
import type { DbProject } from "./db.js";
import { detectContentLang } from "./topic-tags.js";

/** ISO-3166 alpha-2 (+ Cloudflare의 "T1"=Tor, "XX"=미상). 그 외는 기록하지 않는다. */
const REGION_RE = /^[A-Z0-9]{2}$/;

/**
 * request.cf.country → 국가 코드 또는 null. `raw`는 Hono의 `c.req.raw`(Request). 런타임 가드만 —
 * @cloudflare/workers-types 의 `cf`는 optional이고 Node 테스트의 Request에는 없다.
 */
export function regionFromRequest(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const cf = (raw as { cf?: unknown }).cf;
  if (typeof cf !== "object" || cf === null) return null;
  const country = (cf as { country?: unknown }).country;
  if (typeof country !== "string") return null;
  const code = country.trim().toUpperCase();
  return REGION_RE.test(code) ? code : null;
}

/** 런 행 envelope_json 의 모양. EnvelopeInput(training-store.ts)의 부분집합. */
export type RunEnvelope = {
  builtWith: unknown;
  entryPath: "idea" | "code" | "spec" | null;
  topicTags: unknown;
  locale: "ko" | "en";
  contentLang: string | null;
};

/** 프로젝트 행 + 요청 locale + 의도 문장 → 봉투. `null`은 "기록되지 않음"이다. */
export function buildRunEnvelope(
  project: Pick<DbProject, "builtWith" | "entryPath" | "topicTags"> | null,
  locale: "ko" | "en",
  intent: string,
): RunEnvelope {
  const entryPath =
    project?.entryPath === "idea" || project?.entryPath === "code" || project?.entryPath === "spec" ? project.entryPath : null;
  const builtWith = project?.builtWith;
  const topicTags = project?.topicTags;
  return {
    builtWith: isRecorded(builtWith) ? builtWith : null,
    entryPath,
    topicTags: isRecorded(topicTags) ? topicTags : null,
    locale,
    contentLang: detectContentLang(intent),
  };
}

/** D1의 JSON 컬럼은 "null"/"{}"로도 비어 있을 수 있다 — 비어 있으면 기록 안 된 것으로 본다. */
function isRecorded(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "object" && Object.keys(v as Record<string, unknown>).length === 0) return false;
  return true;
}
