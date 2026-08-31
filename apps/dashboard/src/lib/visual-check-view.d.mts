// Type declarations for visual-check-view.mjs (Stage 262; Stage 272 adds the
// project-overview next-action + relative-time helpers).
import type { Dictionary } from "../i18n/dictionary.mjs";

/**
 * "clear" = 문제를 찾지 못했어요 — 확인한 것(passed)도, 못 본 것(inconclusive)도
 * 아닌 자리. 8/26 중간 판정을 넣으면서 필요해졌다.
 */
export type VerdictTone = "passed" | "failed" | "clear" | "inconclusive";
export type SeverityTone = "failed" | "inconclusive" | "decision";
export type FindingSeverity = "high" | "medium" | "low" | "info";

export type OverviewNextAction =
  | { kind: "runFirst" }
  | { kind: "inProgress" | "viewReport" | "viewLatest"; runId: string };

export function overviewNextAction(checks: unknown): OverviewNextAction;

export function inspectionEmptyStateDoor(facts: {
  entryPath?: "idea" | "code" | "spec" | null;
  hasRepo?: boolean | null;
  hasRepoSource?: boolean | null;
  hasDeployUrl?: boolean | null;
}): "connect" | "run" | "wait" | "need_url";

export function relativeTimeLabel(iso: string, locale: string, now?: number): string;

export function verdictLabel(
  works: boolean | null | undefined,
  decision: string | null | undefined,
  t: Dictionary,
): { label: string; tone: VerdictTone };

export function severityLabel(severity: string, t: Dictionary): string;

export function severityTone(severity: string): SeverityTone;

export function splitEvidenceKeys(keys: unknown): {
  screenshots: string[];
  video: string | null;
};

export function buildEvidenceUrl(
  base: string,
  projectId: string,
  runId: string,
  name: string,
  userKey: string,
): string;

/** AF-5 — 검수 깊이와 다음 한 걸음 (설계 D-4). */
export function inspectionDepth(facts: {
  hasRepo?: boolean | null;
  hasRepoSource?: boolean | null;
  hasDeployUrl?: boolean | null;
}): { level: 1 | 2; hasUrl: boolean; hasRepo: boolean; nextStep: "add_url" | "add_repo" | null };
