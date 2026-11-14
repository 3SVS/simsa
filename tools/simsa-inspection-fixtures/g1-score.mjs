/**
 * g1-score.mjs — G1 칸 단위 채점(설계 docs/simsa-inspector-v2-design-2026-10-07.md §4 G1). 순수 함수 — 빌드·네트워크 없이 테스트한다.
 *
 * 앱 하나: scoreG1App(app, mustIds, result, kstHour)
 *   짚음     정답 ❌ 칸을 fail/mismatch로 판정(재실행 확인을 거친 v2 판정). 인용 증거물(quotes)이 있으면 cited
 *   반대     정답 ❌ 칸을 pass로 판정(0이어야 한다)
 *   놓침     정답 ❌ 칸을 not_verified/missing으로 남김
 *   없는 결함 정답 ✅ 칸을 fail/mismatch로 판정 — 같은 결함 묶음에 짚음 칸이 있으면 '파생', unknown 칸이면 '미확인 칸'으로 따로
 *   첫 화면  entryBroken 앱은 칸 1개(ENTRY): v2가 entry.broken을 냈으면 짚음
 * 합계: summarizeG1(rows) — 설계 G1 합격선(80% 짚음 · 의도 불일치 80% · 반대 0 · 없는 결함 ≤1 · 인용 100%)을 함께 계산한다.
 */

const HIT = new Set(["fail", "mismatch"]);

export function expectedDecisionOk(expected, decision) {
  if (expected === "broken") return decision === "Needs Fix";
  if (expected === "broken_or_hold") return decision === "Needs Fix" || decision === "Not Verified";
  return decision === "Ready" || decision === "Not Verified";
}

export function scoreG1App(app, mustIds, r, kstHour = 12) {
  const out = { hits: [], misses: [], opposite: [], extra: [], derived: [], unknownFails: [], timeDependent: [], intermittentHits: [], keyCells: 0, mismatchKey: 0, mismatchHits: 0 };
  out.okDecision = expectedDecisionOk(app.expected, r?.decision);
  if (app.entryBroken) {
    out.keyCells = 1;
    if (r?.entry?.broken) out.hits.push({ acId: "ENTRY", cause: r.entry.broken.cause ?? null, cited: Boolean(r.entry.artifactId) });
    else if (r?.decision === "Ready") out.opposite.push("ENTRY");
    else out.misses.push({ acId: "ENTRY", verdict: r?.decision ?? "missing" });
    return out;
  }
  const nightOnly = app.timeDependent === true && (kstHour >= 9 || kstHour < 0);
  const byAc = new Map((r?.verdicts ?? []).map((v) => [v.acId, v]));
  const keyFail = new Set(app.mustFailed ?? []);
  const mismatchSet = new Set(app.mismatch ?? []);
  const unknown = new Set(app.unknown ?? []);
  const intermittent = new Set(app.intermittent ?? []);
  for (const id of mustIds) {
    const v = byAc.get(id);
    const said = v?.verdict ?? "missing";
    if (keyFail.has(id)) {
      if (nightOnly) {
        if (HIT.has(said)) out.hits.push({ acId: id, cause: v.cause?.cls ?? null, cited: (v.quotes ?? []).length > 0, nightOnly: true });
        else out.timeDependent.push({ acId: id, verdict: said });
        continue;
      }
      out.keyCells += 1;
      if (mismatchSet.has(id)) out.mismatchKey += 1;
      if (HIT.has(said)) {
        out.hits.push({ acId: id, verdict: said, cause: v.cause?.cls ?? null, cited: (v.quotes ?? []).length > 0 });
        if (mismatchSet.has(id)) out.mismatchHits += 1;
      } else if (said === "pass") out.opposite.push(id);
      else out.misses.push({ acId: id, verdict: said, reasons: v?.reasons ?? [] });
    } else if (HIT.has(said)) {
      if (intermittent.has(id)) {
        out.intermittentHits.push({ acId: id, claim: v.claim ?? null });
        continue;
      }
      if (unknown.has(id)) {
        out.unknownFails.push({ acId: id, claim: v.claim ?? null });
        continue;
      }
      const group = (r?.defectGroups ?? []).find((g) => (g.acIds ?? []).includes(id));
      const sharesWithHit = group && group.acIds.some((x) => keyFail.has(x));
      (sharesWithHit ? out.derived : out.extra).push({ acId: id, cause: v.cause?.cls ?? null, claim: v.claim ?? null });
    }
  }
  return out;
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** rows: [{ set, id, score?, error? }] 한 회차. */
export function summarizeG1(rows) {
  const scored = rows.filter((r) => r.score);
  const sum = (f) => scored.reduce((n, r) => n + f(r.score), 0);
  const keyCells = sum((s) => s.keyCells);
  const hitsDaytime = sum((s) => s.hits.filter((h) => !h.nightOnly).length);
  const mismatchKey = sum((s) => s.mismatchKey);
  const mismatchHits = sum((s) => s.mismatchHits);
  const allHits = scored.flatMap((r) => r.score.hits);
  const cited = allHits.filter((h) => h.cited).length;
  const opposite = sum((s) => s.opposite.length);
  const extra = sum((s) => s.extra.length);
  const summary = {
    apps: rows.length,
    errors: rows.filter((r) => r.error).length,
    keyCells,
    hits: hitsDaytime,
    hitPct: pct(hitsDaytime, keyCells),
    nightOnlyHits: allHits.filter((h) => h.nightOnly).length,
    timeDependentNotJudged: sum((s) => s.timeDependent.length),
    mismatchKey,
    mismatchHits,
    mismatchPct: pct(mismatchHits, mismatchKey),
    opposite,
    extra,
    derived: sum((s) => s.derived.length),
    unknownFails: sum((s) => s.unknownFails.length),
    citedPct: pct(cited, allHits.length),
    decisionsOk: scored.filter((r) => r.score.okDecision).length,
  };
  summary.gate = {
    hits80: summary.hitPct !== null && summary.hitPct >= 80,
    mismatch80: summary.mismatchPct === null || summary.mismatchPct >= 80,
    opposite0: opposite === 0,
    extraLe1: extra <= 1,
    cited100: summary.citedPct === null || summary.citedPct === 100,
    noErrors: summary.errors === 0,
  };
  summary.gate.pass = Object.values(summary.gate).every(Boolean);
  return summary;
}
