export type StepStatus = "done" | "current" | "todo" | "locked";
export type StepKey = "prepare" | "review" | "results";
export type StepLockReason = "need_items" | "need_code" | "need_build" | null;

export type ProjectStepFacts = {
  hasItems: boolean | null;
  hasRepo: boolean | null;
  hasRepoSource?: boolean | null;
  hasReviewRun: boolean | null;
  /** At least one real-app check (visual check) exists. Omit only for legacy callers. */
  hasVisualCheck?: boolean | null;
  hasDeployUrl?: boolean | null;
  entryPath?: "idea" | "code" | "spec" | null;
};

export type AppFacts = {
  entryPath?: "idea" | "code" | "spec" | null;
  hasRepo?: boolean | null;
  hasRepoSource?: boolean | null;
  hasDeployUrl?: boolean | null;
};

export function projectHasApp(facts: AppFacts | null | undefined): boolean;

export function computeProjectSteps(
  facts: ProjectStepFacts,
): Array<{ key: StepKey; status: StepStatus; lockReason: StepLockReason; optional: boolean }>;

export function nextScreenSlug(
  slug: string,
  entryPath?: "idea" | "code" | "spec" | null,
  opts?: { developerMode?: boolean },
): string | null;

export type NextProjectAction =
  | "create_items"
  | "connect_code"
  | "add_url"
  | "get_pack"
  | "run_review"
  | "view_results";
export function nextProjectAction(
  facts: ProjectStepFacts,
): { action: NextProjectAction; slug: string } | null;

export function reviewStepLabelKey(facts: AppFacts | null | undefined): "reviewApp" | "review";

export function sidebarStepItems(input: {
  hasApp: boolean;
  developerMode?: boolean;
  hasPrReviewHistory?: boolean | null;
}): { review: string[]; results: string[] };

export function prReviewVisible(
  input: { developerMode?: boolean; hasPrReviewHistory?: boolean | null } | null | undefined,
): boolean;

export function explainerKind(facts: AppFacts | null | undefined): "idea" | "app";

export function visualCheckFact(
  res: { ok: boolean; checks?: unknown[]; error?: string } | null | undefined,
): boolean | null;
export function reviewRunFact(
  res: { ok: boolean; runs?: unknown[]; error?: string } | null | undefined,
): boolean | null;
export function sourceFacts(
  res: { ok: boolean; sources?: Array<{ type: string }>; error?: string } | null | undefined,
): { hasDeployUrl: boolean | null; hasRepoSource: boolean | null };

export const APP_ADDRESS_ANCHOR: "app-address";
export function liveAppCheckHref(projectId: string, hasDeployUrl: boolean | null | undefined): string;

export type PackReadiness = {
  state: "no_review" | "fixes_missing" | "fixes_ready";
  failedCount: number;
  missingCount: number;
};
export function packReadiness(
  checkResults: { results?: Array<{ itemId: string; status: string }> } | null | undefined,
  fixSuggestions: Record<string, unknown> | null | undefined,
): PackReadiness;

export type NextStepReason = "seeProblems" | "afterFix" | "allClear" | "continue";
export function nextStepFromHere(
  slug: string,
  ctx?: {
    entryPath?: "idea" | "code" | "spec" | null;
    summary?: { failed?: number; needsDecision?: number } | null;
    hasCheckRun?: boolean;
    hasFixes?: boolean;
    visual?: { findingCount?: number } | null;
    developerMode?: boolean;
  },
): { slug: string; reason: NextStepReason } | null;
