/**
 * check-compare.mjs — G3 검수 이력 비교 (pure).
 *
 * "지난번엔 통과였는데 이번에 깨졌다"를 시스템이 말해주는 회귀 감지. 수정→재검수
 * 루프의 핵심 가치인데 지금까지는 매 실행이 스냅샷이었다.
 *
 *  - regression: 직전 통과(passed) → 이번 **안 맞음(failed)**. 가장 아픈 신호라 앰버 경고.
 *  - recovered:  직전 안 맞음 → 이번 통과. 고치기가 실제로 먹혔다는 확인.
 *  - uncertain:  직전 통과 → 이번 **확인 부족**. ★회귀가 아니다.
 *
 * ★2026-09-01 규칙 정정: 종전엔 `통과 → 비통과` 전부를 회귀로 셌다. 그런데
 * "확인 부족"은 **이번에 확인을 못 했다**는 뜻이지 망가졌다는 뜻이 아니다. 그걸
 * 회귀로 세면 사용자가 **멀쩡한 수정을 되돌리게** 된다. 모르는 것을 나쁘다고 하지
 * 않는다 — 서버 쪽 `run-comparison.ts`와 같은 규칙이며, 두 구현이 갈리지 않도록
 * 양쪽 테스트가 **같은 입력 표**를 공유한다(증거 규칙 R5).
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
 *   uncertain: Array<{ itemId: string, title: string, to: string }>,
 *   comparedCount: number,
 * }}
 */
export function computeCheckComparison(prevResults, nextResults) {
  const prev = Array.isArray(prevResults) ? prevResults : [];
  const next = Array.isArray(nextResults) ? nextResults : [];
  const prevById = new Map(prev.filter((r) => r && r.itemId).map((r) => [r.itemId, r]));

  const regressions = [];
  const recovered = [];
  const uncertain = [];
  let comparedCount = 0;

  for (const n of next) {
    if (!n || !n.itemId) continue;
    const p = prevById.get(n.itemId);
    if (!p) continue;
    comparedCount += 1;
    const wasOk = p.status === "passed";
    const isOk = n.status === "passed";
    const isBad = n.status === "failed";
    const title = n.title ?? p.title ?? n.itemId;
    if (wasOk && isBad) {
      regressions.push({ itemId: n.itemId, title, from: p.status, to: n.status });
    } else if (wasOk && !isOk) {
      // 통과 → 확인 부족/결정 필요: 못 잰 것이지 망가진 것이 아니다.
      uncertain.push({ itemId: n.itemId, title, to: n.status });
    } else if (p.status === "failed" && isOk) {
      recovered.push({ itemId: n.itemId, title });
    }
  }

  return { regressions, recovered, uncertain, comparedCount };
}
