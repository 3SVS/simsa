export type StepStatus = "done" | "current" | "todo" | "locked";
export type StepKey = "prepare" | "review" | "results";
export type StepLockReason = "need_items" | "need_code" | "need_build" | null;

export type ProjectStepFacts = {
  hasItems: boolean | null;
  hasRepo: boolean | null;
  hasReviewRun: boolean | null;
  hasDeployUrl?: boolean | null;
  entryPath?: "idea" | "code" | "spec" | null;
};

export function computeProjectSteps(
  facts: ProjectStepFacts,
): Array<{ key: StepKey; status: StepStatus; lockReason: StepLockReason; optional: boolean }>;

export function nextScreenSlug(slug: string): string | null;

export type NextProjectAction =
  | "create_items"
  | "connect_code"
  | "get_pack"
  | "run_review"
  | "view_results";
export function nextProjectAction(
  facts: ProjectStepFacts,
): { action: NextProjectAction; slug: string } | null;
