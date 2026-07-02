import {
  extractChangedFilesFromDiff,
  touchesRiskyPath,
  triageReview,
  type TriageOutcome,
} from "@conclave-ai/core";

/**
 * Decision #22 — pre-council triage plan. Pure + exported (same
 * convention as `lib/tier-resolver.ts`) so the "triage decision →
 * council path selection" seam is unit-testable without running the
 * full `conclave review` command.
 *
 * The decision itself lives in core (`efficiency/triage.ts`); this
 * module only derives the triage inputs from the diff and applies the
 * CLI-layer gates:
 *
 *   - `enabled: false`            → never lite (flag off = no behavior change)
 *   - domain "design" / "mixed"   → never lite (design always escalates per
 *                                   decision #26 and needs the vision agent)
 *   - otherwise                   → `triageReview()` decides lite vs full
 */
export interface TriagePlanInput {
  diff: string;
  resolvedDomain: "code" | "design" | "mixed";
  enabled: boolean;
  liteLineThreshold: number;
  liteFileThreshold: number;
}

export interface TriagePlan {
  /** True when the review should run the single-agent lite path. */
  useLite: boolean;
  /** Core triage outcome. Null when triage was skipped (disabled / non-code domain). */
  outcome: TriageOutcome | null;
  /** Why triage was skipped, when it was. */
  skippedReason?: "disabled" | "non-code-domain";
}

/** Conventional test-file shapes: *.test.ts / *.spec.mjs / __tests__/ / test(s)/ dirs. */
const TEST_FILE_RE = /((\.|[-_])(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(__tests__|tests?)\/)/i;

export function isTestFilePath(p: string): boolean {
  return TEST_FILE_RE.test(p);
}

/**
 * Same counting rule as the H2 #9 diff-splitter gate in
 * commands/review.ts — +/- content lines, excluding file headers.
 */
export function countChangedLines(diff: string): number {
  let n = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-")) n += 1;
  }
  return n;
}

export function planTriage(input: TriagePlanInput): TriagePlan {
  if (!input.enabled) {
    return { useLite: false, outcome: null, skippedReason: "disabled" };
  }
  if (input.resolvedDomain !== "code") {
    return { useLite: false, outcome: null, skippedReason: "non-code-domain" };
  }
  const paths = extractChangedFilesFromDiff(input.diff).map((f) => f.path);
  const outcome = triageReview(
    {
      linesChanged: countChangedLines(input.diff),
      fileCount: paths.length,
      hasTests: paths.some(isTestFilePath),
      touchesRiskyPath: touchesRiskyPath(paths),
      sizeBytes: input.diff.length,
    },
    {
      liteLineThreshold: input.liteLineThreshold,
      liteFileThreshold: input.liteFileThreshold,
    },
  );
  return { useLite: outcome.path === "lite", outcome };
}
