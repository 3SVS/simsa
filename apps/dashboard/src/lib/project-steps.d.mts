export type StepStatus = "done" | "current" | "todo" | "locked";
export type StepKey = "prepare" | "review" | "results";
export type StepLockReason = "need_items" | "need_url" | "need_build" | null;

export type ProjectStepFacts = {
  hasItems: boolean | null;
  hasRepo: boolean | null;
  hasRepoSource?: boolean | null;
  hasReviewRun: boolean | null;
  /** At least one FINISHED real-app check (visual check) exists. Omit only for legacy callers. */
  hasVisualCheck?: boolean | null;
  /** A real-app check is queued or running (visualCheckActiveFact). Omit only for legacy callers. */
  visualCheckActive?: boolean | null;
  hasDeployUrl?: boolean | null;
  entryPath?: "idea" | "code" | "spec" | null;
};

export type AppFacts = {
  entryPath?: "idea" | "code" | "spec" | null;
  hasRepo?: boolean | null;
  hasRepoSource?: boolean | null;
  hasDeployUrl?: boolean | null;
};

export type ProjectStep = { key: StepKey; status: StepStatus; lockReason: StepLockReason; optional: boolean };

export function projectHasApp(facts: AppFacts | null | undefined): boolean;

export function computeProjectSteps(facts: ProjectStepFacts): ProjectStep[];

export function nextScreenSlug(
  slug: string,
  entryPath?: "idea" | "code" | "spec" | null,
  opts?: { developerMode?: boolean; hasApp?: boolean; hasDeployUrl?: boolean | null },
): string | null;

export type NextProjectAction =
  | "create_items"
  | "connect_code"
  | "add_url"
  | "get_pack"
  | "run_review"
  | "view_progress"
  | "view_results";
export function nextProjectAction(
  facts: ProjectStepFacts,
): { action: NextProjectAction; slug: string } | null;

export function reviewStepLabelKey(facts: AppFacts | null | undefined): "reviewApp" | "review";

export function appPresenceKnown(facts: AppFacts | null | undefined, settled: boolean): boolean;

export function stepMapView(
  facts: ProjectStepFacts,
  settled: boolean,
): { known: boolean; reviewLabelKey: "reviewApp" | "review" | null; steps: ProjectStep[] };

export function sidebarStepItems(input: {
  hasApp: boolean | null;
  developerMode?: boolean;
  hasPrReviewHistory?: boolean | null;
  /** B-8: Simsa built (or is building) an app for this project — keeps "내 앱" once an app exists. */
  hasHostedBuild?: boolean | null;
}): { review: string[]; results: string[] };

export type NavLabelKey =
  | "checkApp"
  | "visualChecks"
  | "export"
  | "buildGuide"
  | "githubDev"
  | "devSpec"
  | "myApp"
  | "idea"
  | "spec"
  | "items"
  | "settings"
  | "checks"
  | "fixes";
/** Key under t.nav for a flow screen's slug; null for any other slug. */
export function navLabelKey(
  slug: string,
  opts?: { hasApp?: boolean | null; developerMode?: boolean },
): NavLabelKey | null;

export function prReviewVisible(
  input: { developerMode?: boolean; hasPrReviewHistory?: boolean | null } | null | undefined,
): boolean;

export function explainerKind(facts: AppFacts | null | undefined): "idea" | "app";

export function howItWorksVisible(input: {
  hasReviewActivity: boolean;
  hasVisualCheck: boolean | null;
  hasReviewRun: boolean | null;
}): boolean;

export function resultsSummaryVisible(input: {
  hasReviewActivity: boolean;
  hasPrecheck: boolean;
  hasReviewRun: boolean | null;
}): boolean;

export function screenAppView(input: {
  entryPath?: "idea" | "code" | "spec" | null;
  presence: boolean | null;
  hasDeployUrl: boolean | null;
}): { known: boolean; hasApp: boolean };

export function packCopyKeys(
  developerMode: boolean,
): { label: "getGuide" | "getPack"; step2: "gsIdeaStep2Guide" | "gsIdeaStep2" };

export function visualCheckFact(
  res: { ok: boolean; checks?: Array<{ status?: string }>; error?: string } | null | undefined,
): boolean | null;
export function visualCheckActiveFact(
  res: { ok: boolean; checks?: Array<{ status?: string }>; error?: string } | null | undefined,
): boolean | null;
export function latestFinishedRunId(
  checks: Array<{ id?: string; status?: string; createdAt?: string }> | null | undefined,
): string | null;
export function reviewRunFact(
  res: { ok: boolean; runs?: unknown[]; error?: string } | null | undefined,
): boolean | null;
export function sourceFacts(
  res: { ok: boolean; sources?: Array<{ type: string }>; error?: string } | null | undefined,
): { hasDeployUrl: boolean | null; hasRepoSource: boolean | null };

export const APP_ADDRESS_ANCHOR: "app-address";
export function liveAppCheckHref(projectId: string, hasDeployUrl: boolean | null | undefined): string;

export function githubPullsView(input: {
  pullsPhase: "idle" | "loading" | "done" | "error";
  openCount: number;
  linkedCount: number;
}): { list: boolean; empty: "action" | "quiet" | null; devNote: boolean };

export type PackReadiness = {
  state: "no_review" | "fixes_missing" | "fixes_ready";
  failedCount: number;
  missingCount: number;
};
export function packReadiness(
  checkResults: { results?: Array<{ itemId: string; status: string }> } | null | undefined,
  fixSuggestions: Record<string, unknown> | null | undefined,
): PackReadiness;

export type NextStepReason = "seeProblems" | "afterFix" | "allClear" | "continue" | "checkLiveApp";
export function nextStepFromHere(
  slug: string,
  ctx?: {
    entryPath?: "idea" | "code" | "spec" | null;
    summary?: { failed?: number; needsDecision?: number } | null;
    hasCheckRun?: boolean;
    hasFixes?: boolean;
    visual?: { findingCount?: number } | null;
    developerMode?: boolean;
    hasApp?: boolean;
    hasDeployUrl?: boolean | null;
  },
): { slug: string; reason: NextStepReason } | null;

export function nextBarEmphasis(input: {
  reason: string;
  screenHasPrimary: boolean | null;
}): "primary" | "secondary";

export function fixesEntryView(input: {
  projectId: string;
  hasCheckResults: boolean;
  visualCheck: { findingCount?: number; runId?: string } | null | undefined;
}): { kind: "items" } | { kind: "live"; href: string } | { kind: "review_first" };
