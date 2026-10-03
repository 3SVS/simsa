/**
 * workspace/provenance.ts — D-2 amend(재정렬 2026-09-27): 역추론 지시서의 **출처**.
 *
 * 새 감지기를 만들지 않는다. 이미 있는 결정론 감지 결과를 모양만 맞춘다:
 *   - builtWith     ← 빌더 호스트 감지(source-evidence.ts hostingFromHeaders의 lovable·bolt·replit·base44),
 *                     없으면 유저가 적은 도구(built-with.ts normalizeBuiltWith의 primary, 하나뿐이면 그것)
 *   - entryPath     ← 프로젝트의 입구 갈래(entry_path)
 *   - detectedStack ← SourceEvidence.stack(StackHint) 그대로
 *
 * 정직성(D-3): 모르는 값은 **키를 비운다** — "unknown" 같은 문자열로 채우지 않는다.
 * 순수 함수. 네트워크·DB 없음.
 */
import type { StackHint } from "./source-evidence.js";
import { normalizeBuiltWith } from "./built-with.js";
import type { DevSpecProvenance } from "./dev-spec.js";

/** 빌더가 자기 도메인으로 서빙하는 앱 → 그 호스팅 id가 곧 "만든 도구"다(C4a 어휘). */
const BUILDER_HOSTED = new Set(["lovable", "bolt", "replit", "base44"]);

const TOOL_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export type ProvenanceInput = {
  /** 증거 수집의 스택 감지 결과. 증거를 못 모았으면 null. */
  stack: StackHint | null;
  /** 프로젝트 entry_path(D1 원값 — 검증은 여기서). */
  entryPath: unknown;
  /** 프로젝트 built_with_json(유저가 적은 도구, 원값). */
  declaredBuiltWith: unknown;
};

/** 확인 목록(userConfirmedAcIds)을 뺀 출처 — 확인은 지시서가 만들어질 때 붙는다. */
export type BaseProvenance = Omit<DevSpecProvenance, "userConfirmedAcIds">;

/**
 * 주소(사이트)와 저장소 두 증거의 스택을 합친다. 호스팅은 주소가 더 정확하고(응답 헤더·빌더 도메인),
 * 데이터·도구는 저장소(package.json)가 더 정확하다. 둘 다 없으면 null.
 */
export function mergeStackHints(site: StackHint | null, repo: StackHint | null): StackHint | null {
  if (!site && !repo) return null;
  const hosting = site?.hosting ?? repo?.hosting;
  const data = repo?.data ?? site?.data;
  const tools = [...new Set([...(repo?.tools ?? []), ...(site?.tools ?? [])])];
  return { ...(hosting ? { hosting } : {}), ...(data ? { data } : {}), tools };
}

export function provenanceFrom(input: ProvenanceInput): BaseProvenance {
  const out: BaseProvenance = {};

  const hosting = input.stack?.hosting;
  if (hosting && BUILDER_HOSTED.has(hosting)) {
    out.builtWith = hosting;
  } else {
    const declared = normalizeBuiltWith(input.declaredBuiltWith);
    // 유저가 "주로 이것"이라고 고른 도구, 아니면 도구가 하나뿐일 때만 — 여럿 중 하나를 고르지 않는다.
    const pick = declared?.primary ?? (declared && declared.tools.length === 1 ? declared.tools[0] : undefined);
    if (pick && pick !== "other" && TOOL_ID.test(pick)) out.builtWith = pick;
  }

  const ep = input.entryPath;
  if (ep === "idea" || ep === "code" || ep === "spec") out.entryPath = ep;

  const s = input.stack;
  if (s) {
    const tools = (s.tools ?? [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 60))
      .slice(0, 20);
    const stack: NonNullable<DevSpecProvenance["detectedStack"]> = {};
    if (s.hosting) stack.hosting = s.hosting;
    if (s.data) stack.data = s.data;
    if (tools.length > 0) stack.tools = tools;
    if (Object.keys(stack).length > 0) out.detectedStack = stack;
  }
  return out;
}
