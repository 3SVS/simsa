// Type declarations for visual-check-view.mjs (Stage 262; Stage 272 adds the
// project-overview next-action + relative-time helpers).
import type { Dictionary } from "../i18n/dictionary.mjs";

export type VerdictTone = "passed" | "failed" | "inconclusive";
export type SeverityTone = "failed" | "inconclusive" | "decision";
export type FindingSeverity = "high" | "medium" | "low" | "info";

export type OverviewNextAction =
  | { kind: "runFirst" }
  | { kind: "inProgress" | "viewReport" | "viewLatest"; runId: string };

export function overviewNextAction(checks: unknown): OverviewNextAction;

export function inspectionEmptyStateDoor(facts: {
  entryPath?: "idea" | "code" | "spec" | null;
  hasRepo?: boolean | null;
  hasDeployUrl?: boolean | null;
}): "connect" | "run" | "wait";

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
