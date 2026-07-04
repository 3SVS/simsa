export type StepStatus = "done" | "current" | "todo" | "locked";
export type StepKey = "prepare" | "review" | "results";
export type StepLockReason = "need_items" | "need_code" | null;

export type ProjectStepFacts = {
  hasItems: boolean | null;
  hasRepo: boolean | null;
  hasReviewRun: boolean | null;
};

export function computeProjectSteps(
  facts: ProjectStepFacts,
): Array<{ key: StepKey; status: StepStatus; lockReason: StepLockReason }>;

export function nextScreenSlug(slug: string): string | null;
