/**
 * v2-recheck.ts — 검사 엔진 v2 S8: 재검사 고리 비교 (2026-10-24).
 *
 * 설계 §2.2-8 "같은 계획을 다시 실행해 기준별 전후를 비교. 모든 must 통과 또는 N회까지."
 *   - 기준별: 고쳐짐(fail·mismatch → pass) · 여전히(→ fail·mismatch) · 새로 깨짐(pass → fail·mismatch) ·
 *     확인 못 함으로 바뀜(fail → not_verified — 고쳐졌다고 세지 않는다)
 *   - 결함별(S5c 묶음·S6 원인): 해결(그 결함의 기준이 모두 통과) · 남음(같은 원인으로 다시 실패) · 새 결함(원 런에 없던 원인)
 *   - 고친 파일(G4): 원 런이 검증 통과한 고친 파일을 준 기준이, 사용자가 반영한 뒤 실제 앱에서 통과하는가
 *   - 고리: 회차(원 런 0부터), 모든 must 통과 또는 최대 회차면 끝
 * Worker 완료 콜백이 원 런 리포트와 비교해 report.v2.comparison에 싣는다(결정론, LLM 없음).
 */

interface VerdictLike {
  acId: string;
  verdict: string;
  cause?: { cls?: string } | null;
}
interface ReportLike {
  engineVersion?: string;
  acTable?: Array<{ id: string; priority?: string }>;
  v2?: {
    verdicts?: VerdictLike[];
    defectGroups?: Array<{ key: string; cls: string; acIds: string[] }>;
    fix?: { validated?: string[] } | null;
    recheck?: { round?: number };
  };
}

export const RECHECK_MAX_ROUNDS = 3;

export interface DefectChange {
  cls: string;
  acIds: string[];
}

export interface V2Comparison {
  fixed: string[];
  stillBroken: string[];
  newlyBroken: string[];
  unverifiedNow: string[];
  defects: { resolved: DefectChange[]; persisting: DefectChange[]; introduced: DefectChange[] };
  fixLive: { delivered: string[]; passNow: string[]; stillFailing: string[]; notVerified: string[] } | null;
  loop: { round: number; allMustPass: boolean; done: boolean; reason: "all_must_pass" | "max_rounds" | "continue" };
}

const failed = (v: string | undefined) => v === "fail" || v === "mismatch";

/** 원 런의 결함 목록: 묶음이 있으면 묶음, 없으면 실패 기준 하나가 결함 하나(원인 분류로 이름). */
function defectsOf(r: ReportLike): DefectChange[] {
  const verdicts = r.v2?.verdicts ?? [];
  const grouped = new Set<string>();
  const out: DefectChange[] = [];
  for (const g of r.v2?.defectGroups ?? []) {
    out.push({ cls: g.cls, acIds: [...g.acIds] });
    g.acIds.forEach((id) => grouped.add(id));
  }
  for (const v of verdicts) {
    if (!failed(v.verdict) || grouped.has(v.acId)) continue;
    out.push({ cls: v.verdict === "mismatch" ? "intent_mismatch" : v.cause?.cls ?? "other", acIds: [v.acId] });
  }
  return out;
}

export function compareV2Reports(prev: ReportLike | null | undefined, next: ReportLike | null | undefined, opts: { maxRounds?: number } = {}): V2Comparison | null {
  if (prev?.engineVersion !== "v2" || next?.engineVersion !== "v2" || !prev.v2 || !next.v2) return null;
  const before = new Map((prev.v2.verdicts ?? []).map((v) => [v.acId, v]));
  const after = new Map((next.v2.verdicts ?? []).map((v) => [v.acId, v]));
  const out: V2Comparison = {
    fixed: [], stillBroken: [], newlyBroken: [], unverifiedNow: [],
    defects: { resolved: [], persisting: [], introduced: [] },
    fixLive: null,
    loop: { round: 0, allMustPass: false, done: false, reason: "continue" },
  };
  for (const [id, a] of after) {
    const b = before.get(id)?.verdict;
    if (failed(b) && a.verdict === "pass") out.fixed.push(id);
    else if (failed(b) && failed(a.verdict)) out.stillBroken.push(id);
    else if (b === "pass" && failed(a.verdict)) out.newlyBroken.push(id);
    else if (failed(b) && a.verdict === "not_verified") out.unverifiedNow.push(id);
  }

  // 결함별: 원 런의 결함마다 — 그 기준 중 하나라도 같은 원인으로 다시 실패면 남음, 모두 통과면 해결(일부 확인 못 함이면 어느 쪽도 아님).
  const prevDefects = defectsOf(prev);
  const nextDefects = defectsOf(next);
  const clsOfNext = (id: string) => {
    const v = after.get(id);
    return v?.verdict === "mismatch" ? "intent_mismatch" : v?.cause?.cls ?? "other";
  };
  for (const d of prevDefects) {
    if (d.acIds.some((id) => failed(after.get(id)?.verdict) && clsOfNext(id) === d.cls)) out.defects.persisting.push(d);
    else if (d.acIds.every((id) => after.get(id)?.verdict === "pass")) out.defects.resolved.push(d);
  }
  const prevCls = new Set(prevDefects.map((d) => d.cls));
  for (const d of nextDefects) if (!prevCls.has(d.cls)) out.defects.introduced.push(d);

  const delivered = prev.v2.fix?.validated ?? [];
  if (delivered.length > 0) {
    out.fixLive = { delivered: [...delivered], passNow: [], stillFailing: [], notVerified: [] };
    for (const id of delivered) {
      const a = after.get(id)?.verdict;
      (a === "pass" ? out.fixLive.passNow : failed(a) ? out.fixLive.stillFailing : out.fixLive.notVerified).push(id);
    }
  }

  const round = (prev.v2.recheck?.round ?? 0) + 1;
  const must = (next.acTable ?? []).filter((r) => r.priority === "must").map((r) => r.id);
  const allMustPass = must.length > 0 && must.every((id) => after.get(id)?.verdict === "pass");
  const max = opts.maxRounds ?? RECHECK_MAX_ROUNDS;
  out.loop = { round, allMustPass, done: allMustPass || round >= max, reason: allMustPass ? "all_must_pass" : round >= max ? "max_rounds" : "continue" };
  return out;
}
