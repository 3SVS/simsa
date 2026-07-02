/**
 * workspace/pr-review-compare.ts
 *
 * Deterministic (no LLM) before/after comparison between two PR review runs.
 * Compares item-level status changes to identify:
 *   - improved items (좋아진 항목)
 *   - still-open items (아직 남은 항목)
 *   - newly problematic items (새로 생긴 문제)
 *   - unchanged items (변화 없음)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Language for generated change-description strings. Defaults to "ko". */
export type ReviewCompareLocale = "en" | "ko";

export type ReviewResultItem = {
  itemId: string;
  title: string;
  status: "passed" | "failed" | "inconclusive" | "needs_decision";
  reason: string;
  // Stage 49: the stored run results carry these; declared optional so the
  // comment formatter can surface "다음 조치" without changing parse behavior.
  nextAction?: string;
};

export type RunSummary = {
  id: string;
  status: string;
  updatedAt: string;
  summary: {
    passed: number;
    failed: number;
    inconclusive: number;
    needsDecision: number;
  };
};

export type ImprovedItem = {
  itemId: string;
  title: string;
  from: string;
  to: string;
  reason: string;
};

export type StillOpenItem = {
  itemId: string;
  title: string;
  status: string;
  reason: string;
  // Stage 49: source status for the transition label. Undefined when the item
  // only exists in the current run (새 항목). For both-runs still-open items
  // the source status equals `status` (same score → same status).
  from?: string;
  nextAction?: string;
};

export type NewlyProblematicItem = {
  itemId: string;
  title: string;
  from: string;
  to: string;
  reason: string;
  nextAction?: string; // Stage 49
};

export type UnchangedItem = {
  itemId: string;
  title: string;
  status: string;
  from?: string; // Stage 49: undefined when current-only (새 항목)
};

export type ComparisonResult = {
  improved: ImprovedItem[];
  stillOpen: StillOpenItem[];
  newlyProblematic: NewlyProblematicItem[];
  unchanged: UnchangedItem[];
  summaryText: string;
};

export type PrReviewComparisonResponse =
  | {
      ok: true;
      comparable: false;
      reason: "not_enough_runs";
    }
  | {
      ok: true;
      comparable: true;
      previousRun: RunSummary;
      latestRun: RunSummary;
      comparison: ComparisonResult;
    };

// ─── Status score ─────────────────────────────────────────────────────────────

const STATUS_SCORE: Record<string, number> = {
  passed: 4,
  needs_decision: 2,
  inconclusive: 1,
  failed: 0,
};

// Status labels per locale. EN terms align with the dashboard:
// passed = "Passed", failed = "Issue found", inconclusive = "Not verified",
// needs_decision = "Needs decision".
const STATUS_LABELS: Record<ReviewCompareLocale, Record<string, string>> = {
  ko: {
    passed: "통과",
    failed: "안 맞음",
    inconclusive: "확인 부족",
    needs_decision: "결정 필요",
  },
  en: {
    passed: "Passed",
    failed: "Issue found",
    inconclusive: "Not verified",
    needs_decision: "Needs decision",
  },
};

function scoreOf(status: string): number {
  return STATUS_SCORE[status] ?? 0;
}

function label(status: string, locale: ReviewCompareLocale): string {
  return STATUS_LABELS[locale][status] ?? status;
}

// ─── Change description ───────────────────────────────────────────────────────

function describeImprovement(from: string, to: string, locale: ReviewCompareLocale): string {
  if (locale === "en") {
    if (to === "passed") {
      return `Improved from ${label(from, locale)} to Passed.`;
    }
    if (from === "failed" && to === "needs_decision") {
      return `Moved from Issue found to Needs decision. The technical review is done, but a decision is needed.`;
    }
    if (from === "inconclusive" && to === "needs_decision") {
      return `Clarified from Not verified to Needs decision.`;
    }
    if (from === "failed" && to === "inconclusive") {
      return `Partially improved from Issue found to Not verified.`;
    }
    return `Improved from ${label(from, locale)} to ${label(to, locale)}.`;
  }
  if (to === "passed") {
    return `${label(from, locale)}에서 통과로 개선됐어요.`;
  }
  if (from === "failed" && to === "needs_decision") {
    return `안 맞음에서 결정 필요로 전환됐어요. 기술 검토는 됐지만 결정이 필요해요.`;
  }
  if (from === "inconclusive" && to === "needs_decision") {
    return `확인 부족에서 결정 필요로 명확해졌어요.`;
  }
  if (from === "failed" && to === "inconclusive") {
    return `안 맞음에서 확인 부족으로 일부 개선됐어요.`;
  }
  return `${label(from, locale)}에서 ${label(to, locale)}으로 개선됐어요.`;
}

function describeRegression(from: string, to: string, locale: ReviewCompareLocale): string {
  if (locale === "en") {
    if (from === "passed") {
      return `Was Passed but changed to ${label(to, locale)}. This change introduced a problem.`;
    }
    if (from === "needs_decision" && to === "failed") {
      return `Worsened from Needs decision to Issue found.`;
    }
    return `Worsened from ${label(from, locale)} to ${label(to, locale)}.`;
  }
  if (from === "passed") {
    return `통과였지만 ${label(to, locale)}으로 바뀌었어요. 이번 변경에서 문제가 생겼어요.`;
  }
  if (from === "needs_decision" && to === "failed") {
    return `결정 필요에서 안 맞음으로 악화됐어요.`;
  }
  return `${label(from, locale)}에서 ${label(to, locale)}으로 악화됐어요.`;
}

// ─── Run summary helper ───────────────────────────────────────────────────────

export function buildRunSummary(run: {
  id: string;
  status: string;
  updatedAt: string;
  resultJson?: string;
}): RunSummary {
  let passed = 0, failed = 0, inconclusive = 0, needsDecision = 0;

  if (run.resultJson) {
    try {
      const parsed = JSON.parse(run.resultJson) as {
        summary?: { passed?: number; failed?: number; inconclusive?: number; needsDecision?: number };
        results?: Array<{ status: string }>;
      };
      if (parsed.summary) {
        passed = parsed.summary.passed ?? 0;
        failed = parsed.summary.failed ?? 0;
        inconclusive = parsed.summary.inconclusive ?? 0;
        needsDecision = parsed.summary.needsDecision ?? 0;
      } else if (Array.isArray(parsed.results)) {
        for (const r of parsed.results) {
          if (r.status === "passed") passed++;
          else if (r.status === "failed") failed++;
          else if (r.status === "inconclusive") inconclusive++;
          else if (r.status === "needs_decision") needsDecision++;
        }
      }
    } catch { /* ignored */ }
  }

  return {
    id: run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    summary: { passed, failed, inconclusive, needsDecision },
  };
}

// ─── Core comparison ──────────────────────────────────────────────────────────

export function compareRunResults(
  previousResults: ReviewResultItem[],
  latestResults: ReviewResultItem[],
  locale: ReviewCompareLocale = "ko",
): ComparisonResult {
  const previousMap = new Map(previousResults.map((r) => [r.itemId, r]));
  const latestMap = new Map(latestResults.map((r) => [r.itemId, r]));

  // Union of all itemIds
  const allIds = new Set([...previousMap.keys(), ...latestMap.keys()]);

  const improved: ImprovedItem[] = [];
  const stillOpen: StillOpenItem[] = [];
  const newlyProblematic: NewlyProblematicItem[] = [];
  const unchanged: UnchangedItem[] = [];

  for (const itemId of allIds) {
    const prev = previousMap.get(itemId);
    const latest = latestMap.get(itemId);

    if (!prev || !latest) {
      // Item only in one run — treat as unchanged in the run that has it.
      // current-only → no source status (from undefined → "새 항목").
      if (latest) {
        if (latest.status === "passed") {
          unchanged.push({ itemId, title: latest.title, status: latest.status });
        } else {
          stillOpen.push({ itemId, title: latest.title, status: latest.status, reason: latest.reason, nextAction: latest.nextAction });
        }
      }
      continue;
    }

    const prevScore = scoreOf(prev.status);
    const latestScore = scoreOf(latest.status);

    if (latestScore > prevScore) {
      improved.push({
        itemId,
        title: latest.title,
        from: prev.status,
        to: latest.status,
        reason: describeImprovement(prev.status, latest.status, locale),
      });
    } else if (latestScore < prevScore) {
      newlyProblematic.push({
        itemId,
        title: latest.title,
        from: prev.status,
        to: latest.status,
        reason: describeRegression(prev.status, latest.status, locale),
        nextAction: latest.nextAction,
      });
    } else {
      // Same score → same status (scores are distinct). source status = prev.status.
      if (latest.status === "passed") {
        unchanged.push({ itemId, title: latest.title, status: latest.status, from: prev.status });
      } else {
        stillOpen.push({ itemId, title: latest.title, status: latest.status, reason: latest.reason, from: prev.status, nextAction: latest.nextAction });
      }
    }
  }

  // Build summary text
  const parts: string[] = [];
  if (locale === "en") {
    if (improved.length > 0) parts.push(`${improved.length} improved`);
    if (newlyProblematic.length > 0) parts.push(`${newlyProblematic.length} newly problematic`);
    if (stillOpen.length > 0) parts.push(`${stillOpen.length} still open`);
    if (unchanged.length > 0) parts.push(`${unchanged.length} unchanged`);
  } else {
    if (improved.length > 0) parts.push(`좋아진 항목 ${improved.length}개`);
    if (newlyProblematic.length > 0) parts.push(`새로 생긴 문제 ${newlyProblematic.length}개`);
    if (stillOpen.length > 0) parts.push(`아직 남은 항목 ${stillOpen.length}개`);
    if (unchanged.length > 0) parts.push(`변화 없음 ${unchanged.length}개`);
  }

  const summaryText = parts.length > 0
    ? parts.join(", ") + "."
    : locale === "en" ? "No items changed." : "모든 항목이 변화 없어요.";

  return { improved, stillOpen, newlyProblematic, unchanged, summaryText };
}

// ─── Source-vs-new run comparison ────────────────────────────────────────────

export type SpecificRunComparison = {
  comparable: boolean;
  sourceRunId: string;
  newRunId: string;
  improved: ImprovedItem[];
  stillOpen: StillOpenItem[];
  newlyProblematic: NewlyProblematicItem[];
  unchanged: UnchangedItem[];
  summaryText: string;
};

/**
 * Compare a specific source run against a newly completed run.
 * Wraps compareRunResults; returns comparable=false if either side has no results.
 */
export function compareSpecificReviewRuns(
  source: { id: string; results: ReviewResultItem[] },
  newRun: { id: string; results: ReviewResultItem[] },
  locale: ReviewCompareLocale = "ko",
): SpecificRunComparison {
  if (source.results.length === 0 || newRun.results.length === 0) {
    return {
      comparable: false,
      sourceRunId: source.id,
      newRunId: newRun.id,
      improved: [],
      stillOpen: [],
      newlyProblematic: [],
      unchanged: [],
      summaryText: locale === "en" ? "No results to compare." : "비교할 결과가 없어요.",
    };
  }
  const cmp = compareRunResults(source.results, newRun.results, locale);
  return { comparable: true, sourceRunId: source.id, newRunId: newRun.id, ...cmp };
}

// ─── Parse results from run ───────────────────────────────────────────────────

export function parseRunResults(resultJson: string | undefined): ReviewResultItem[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { results?: unknown[] };
    if (!Array.isArray(parsed.results)) return [];
    return parsed.results.filter(
      (r): r is ReviewResultItem =>
        typeof r === "object" && r !== null &&
        "itemId" in r && "title" in r && "status" in r && "reason" in r,
    );
  } catch {
    return [];
  }
}
