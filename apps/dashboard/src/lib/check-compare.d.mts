export type CheckComparison = {
  regressions: Array<{ itemId: string; title: string; from: string; to: string }>;
  recovered: Array<{ itemId: string; title: string }>;
  comparedCount: number;
};

export function computeCheckComparison(
  prevResults: Array<{ itemId: string; status: string; title?: string }> | null | undefined,
  nextResults: Array<{ itemId: string; status: string; title?: string }> | null | undefined,
): CheckComparison;
