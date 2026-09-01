export type CheckComparison = {
  regressions: Array<{ itemId: string; title: string; from: string; to: string }>;
  recovered: Array<{ itemId: string; title: string }>;
  /** 통과 → 확인 부족. **회귀가 아니다** — 못 잰 것이지 망가진 것이 아니다. */
  uncertain: Array<{ itemId: string; title: string; to: string }>;
  comparedCount: number;
};

export function computeCheckComparison(
  prevResults: Array<{ itemId: string; status: string; title?: string }> | null | undefined,
  nextResults: Array<{ itemId: string; status: string; title?: string }> | null | undefined,
): CheckComparison;
