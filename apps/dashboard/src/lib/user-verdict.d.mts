// Type declarations for user-verdict.mjs (Train C — C2b).

export type UserVerdict = "as_intended" | "works_but_different" | "still_broken" | "unsure";
export type FixPromptTarget = "web_builder" | "cli";

export const USER_VERDICT_OPTIONS: readonly UserVerdict[];
export const WEB_BUILDER_TOOLS: readonly string[];
export const CLI_AGENT_TOOLS: readonly string[];

export function normalizeUserVerdict(raw: unknown): UserVerdict | null;

export function userVerdictLabel(
  verdict: UserVerdict,
  t: { visualChecks: { userVerdict: { options: Record<UserVerdict, string> } } },
): string;

export function pickDefaultPromptTarget(
  builtWith: unknown,
  hasBuilderPrompt: boolean,
  opts?: { addressOnly?: boolean },
): FixPromptTarget;

type PromptSource = { agentPrompt?: unknown; report?: { builderPrompt?: unknown } | null } | null | undefined;

export function fixPromptFor(check: PromptSource, target: FixPromptTarget): string | null;

export function availablePromptTargets(check: PromptSource): FixPromptTarget[];
