/**
 * check-compare.mjs — G3 검수 이력 비교 (pure).
 *
 * "지난번엔 통과였는데 이번에 깨졌다"를 시스템이 말해주는 회귀 감지. 수정→재검수
 * 루프의 핵심 가치인데 지금까지는 매 실행이 스냅샷이었다.
 *
 *  - regression: 직전 통과(passed) → 이번 비통과. 가장 아픈 신호라 앰버 경고.
 *  - recovered:  직전 비통과 → 이번 통과. 고치기가 실제로 먹혔다는 확인.
 *
 * 어느 한쪽에만 있는 항목(추가/삭제)은 비교 대상이 아니다 — 존재 변화를 회귀로
 * 오인하면 항목을 늘릴 때마다 겁을 주게 된다. 순수·결정론(테스트 고정).
 */

/**
 * @param {Array<{ itemId: string, status: string, title?: string }> | null | undefined} prevResults
 * @param {Array<{ itemId: string, status: string, title?: string }> | null | undefined} nextResults
 * @returns {{
 *   regressions: Array<{ itemId: string, title: string, from: string, to: string }>,
 *   recovered: Array<{ itemId: string, title: string }>,
 *   comparedCount: number,
 * }}
 */
export function computeCheckComparison(prevResults, nextResults) {
  const prev = Array.isArray(prevResults) ? prevResults : [];
  const next = Array.isArray(nextResults) ? nextResults : [];
  const prevById = new Map(prev.filter((r) => r && r.itemId).map((r) => [r.itemId, r]));

  const regressions = [];
  const recovered = [];
  let comparedCount = 0;

  for (const n of next) {
    if (!n || !n.itemId) continue;
    const p = prevById.get(n.itemId);
    if (!p) continue;
    comparedCount += 1;
    const was = p.status === "passed";
    const is = n.status === "passed";
    if (was && !is) {
      regressions.push({ itemId: n.itemId, title: n.title ?? p.title ?? n.itemId, from: p.status, to: n.status });
    } else if (!was && is) {
      recovered.push({ itemId: n.itemId, title: n.title ?? p.title ?? n.itemId });
    }
  }

  return { regressions, recovered, comparedCount };
}
