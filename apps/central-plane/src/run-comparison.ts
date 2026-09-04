/**
 * run-comparison.ts — 재검수가 **정말 나아졌는지** 항목별로 비교한다 (2026-09-01).
 *
 * ## 왜
 *
 * Bae: *"다시 요청할 때는 잘 작동하는지, **다른 부분은 문제없었을지** 검토하고
 * 작동하게 만들어주는 게 목표지. 근데 맨날 다 됐다고 하고 알아보면 오류투성이인데
 * 진짜로 한 번에 다 고쳐줄 수 있을지 모르겠다."*
 *
 * 한 번에 다 고쳐진다는 보장은 없다. **그리고 그렇게 말해서도 안 된다** — "다
 * 고쳤습니다"라고 하고 열어보니 아닌 것이 이 제품이 없애려는 바로 그 경험이다.
 *
 * 그래서 이 모듈의 목적은 고침을 잘하는 게 아니라 **"다 고쳤다"를 구조적으로 말할 수
 * 없게 만드는 것**이다. 모든 수정 주장은 항목별 재검증 결과를 달고 나와야 한다.
 *
 * ## 특히 회귀
 *
 * 되던 것이 안 되게 되는 것 — 이게 AI 수정에서 가장 흔하고 가장 늦게 발견된다.
 * 고친 자리만 보면 성공처럼 보이기 때문이다. 그래서 **고쳐진 것보다 회귀를 먼저**
 * 보여준다.
 *
 * ## 모르는 것을 나쁘다고 하지 않는다
 *
 * 통과 → **확인 부족**은 회귀가 아니다. 이번에 확인을 못 했을 뿐이고, 그걸 "망가졌다"로
 * 세면 멀쩡한 수정을 되돌리게 만든다. 별도 칸(`uncertain`)으로 뺀다.
 */

/** check.ts의 CheckItemStatus와 같은 어휘(의존 없이 재선언 — 이 모듈은 순수). */
export type ItemStatus = "passed" | "failed" | "inconclusive" | "needs_decision";

export type ComparableResult = { itemId: string; status: ItemStatus; title?: string };

export type ItemChange =
  /** 안 맞던 것이 통과가 됐다 — 실제로 고쳐진 것. */
  | "fixed"
  /** 여전히 안 맞는다. */
  | "still_broken"
  /** ★되던 것이 안 되게 됐다. 가장 먼저 보여줘야 하는 것. */
  | "regressed"
  /** 계속 통과. */
  | "still_ok"
  /** 통과였는데 이번엔 확인을 못 했다 — 회귀가 아니라 불확실. */
  | "uncertain"
  /** 이번에 처음 확인한 항목. */
  | "new";

export type RunComparison = {
  items: Array<{ itemId: string; title?: string; from: ItemStatus | null; to: ItemStatus; change: ItemChange }>;
  counts: Record<ItemChange, number>;
  /** ★"다 고쳐졌다"고 말할 수 있는 유일한 조건. */
  allResolved: boolean;
  /** 회귀가 하나라도 있으면 참 — 리포트가 이걸 맨 위에 놓는다. */
  hasRegression: boolean;
};

const isOk = (s: ItemStatus) => s === "passed";
const isBad = (s: ItemStatus) => s === "failed";

function classify(from: ItemStatus | null, to: ItemStatus): ItemChange {
  if (from === null) return "new";
  if (isBad(from) && isOk(to)) return "fixed";
  if (isBad(from) && !isOk(to)) return "still_broken";
  if (isOk(from) && isBad(to)) return "regressed";
  if (isOk(from) && isOk(to)) return "still_ok";
  // 통과 → 확인 부족/결정 필요: 모르는 것을 나쁘다고 하지 않는다.
  if (isOk(from)) return "uncertain";
  // 확인 부족 → 통과도 고쳐진 것으로 세지 않는다(원래 나쁘다고 판정한 적이 없다).
  return isOk(to) ? "still_ok" : "still_broken";
}

/**
 * 이전 검수와 이번 검수를 항목별로 비교한다.
 *
 * 이전 검수가 없으면(첫 검수) 전부 `new` — 그때는 "고쳐졌다"는 말 자체가 성립하지 않는다.
 */
export function compareCheckRuns(
  previous: ComparableResult[] | null | undefined,
  current: ComparableResult[],
): RunComparison {
  const prev = new Map((previous ?? []).map((r) => [r.itemId, r.status]));
  const counts: Record<ItemChange, number> = {
    fixed: 0, still_broken: 0, regressed: 0, still_ok: 0, uncertain: 0, new: 0,
  };
  const items = current.map((r) => {
    const from = prev.has(r.itemId) ? (prev.get(r.itemId) as ItemStatus) : null;
    const change = classify(from, r.status);
    counts[change] += 1;
    return { itemId: r.itemId, ...(r.title ? { title: r.title } : {}), from, to: r.status, change };
  });

  return {
    items,
    counts,
    // ★"다 해결됐다"는 **안 맞는 것도 없고 회귀도 없고 불확실도 없을 때만**이다.
    //  확인 부족을 성공으로 세면 "다 고쳤습니다"가 다시 거짓말이 된다.
    allResolved:
      items.length > 0 && counts.still_broken === 0 && counts.regressed === 0 && counts.uncertain === 0,
    hasRegression: counts.regressed > 0,
  };
}

/**
 * 비교 결과를 사용자 문장으로. **회귀를 맨 앞에 놓는다.**
 *
 * 숫자를 먼저 말하는 이유: "다 고쳤어요"는 못 쓰는 말이고, "3개 중 2개"는 쓸 수 있는
 * 말이다. 사용자가 남은 하나를 알고 넘어가야 다음에 배신당하지 않는다.
 */
export function comparisonSummary(c: RunComparison, locale: "ko" | "en" = "ko"): string {
  const { counts } = c;
  if (locale === "en") {
    if (counts.regressed > 0) {
      return `${counts.regressed} item(s) that used to work are now broken. ${counts.fixed} fixed, ${counts.still_broken} still not working.`;
    }
    if (c.allResolved) return `All ${counts.fixed + counts.still_ok} items check out. ${counts.fixed} were fixed this time.`;
    if (counts.uncertain > 0) {
      return `${counts.fixed} fixed, ${counts.still_broken} still not working, ${counts.uncertain} we could not confirm this time.`;
    }
    return `${counts.fixed} fixed, ${counts.still_broken} still not working.`;
  }
  if (counts.regressed > 0) {
    return `되던 것 ${counts.regressed}개가 이번에 안 돼요. ${counts.fixed}개는 고쳐졌고, ${counts.still_broken}개는 아직입니다.`;
  }
  if (c.allResolved) return `${counts.fixed + counts.still_ok}개 항목이 모두 확인됐어요. 이번에 ${counts.fixed}개가 고쳐졌습니다.`;
  if (counts.uncertain > 0) {
    return `${counts.fixed}개 고쳐졌고, ${counts.still_broken}개는 아직이며, ${counts.uncertain}개는 이번에 확인하지 못했어요.`;
  }
  return `${counts.fixed}개 고쳐졌고, ${counts.still_broken}개는 아직입니다.`;
}
