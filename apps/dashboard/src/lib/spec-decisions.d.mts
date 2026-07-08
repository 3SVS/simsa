import type { WorkspaceProductSpec } from "./workspace-types";

export function decisionLine(question: string, answer: string): string;
export function applyResolvedDecision(
  productSpec: WorkspaceProductSpec,
  question: string,
  answer: string,
): WorkspaceProductSpec;
export function applyAllResolvedDecisions(
  productSpec: WorkspaceProductSpec,
  resolved: Record<string, string> | undefined,
): WorkspaceProductSpec;
