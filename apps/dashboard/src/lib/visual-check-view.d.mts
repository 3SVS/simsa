// Type declarations for visual-check-view.mjs (Stage 262).
import type { Dictionary } from "../i18n/dictionary.mjs";

export type VerdictTone = "passed" | "failed" | "inconclusive";
export type SeverityTone = "failed" | "inconclusive" | "decision";
export type FindingSeverity = "high" | "medium" | "low" | "info";

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
