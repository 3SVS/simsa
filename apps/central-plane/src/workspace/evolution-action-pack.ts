/**
 * workspace/evolution-action-pack.ts — Stage 77
 *
 * CANONICAL deterministic Evolution Action Pack logic. The dashboard keeps a
 * mirror in `apps/dashboard/src/lib/evolution-action-pack.mjs` for on-demand
 * client-side preview only. The two implementations are kept in lock-step by a
 * shared golden fixture (apps/central-plane/test/fixtures/evolution-action-pack-golden.json)
 * asserted by both test suites — change one, change the other, or the fixture
 * test fails.
 *
 * NO LLM, NO network, NO randomness. The strings bundle is injected (matching
 * the dashboard `buildCandidatePrompt` convention); the route handler uses
 * `DEFAULT_EVOLUTION_STRINGS` so saved packs are canonical English.
 *
 * Never includes a userKey or token in the pack snapshot.
 */
import type {
  AgentBenchmarkResult,
  BenchmarkCandidateItemOutcome,
  BenchmarkItemBlocker,
} from "./agent-benchmark.js";
import type { ExperimentOutcomeScorecard } from "./experiment-outcome-scorecard.js";
import { BRAND } from "./brand.js";

export type EvolutionAction =
  | "accept"
  | "fix_selected"
  | "rerun_experiment"
  | "clarify_acceptance_items"
  | "create_benchmark";

export const EVOLUTION_ACTIONS: EvolutionAction[] = [
  "accept",
  "fix_selected",
  "rerun_experiment",
  "clarify_acceptance_items",
  "create_benchmark",
];

export type EvolutionActionPackSection = { title: string; body: string };

export type EvolutionActionPack = {
  projectId: string;
  experimentId: string;
  recommendedAction: EvolutionAction;
  title: string;
  summary: string;
  targetCandidateId?: string;
  focusItemIds: string[];
  sections: EvolutionActionPackSection[];
};

export type ResolvedFocusItem = { itemId: string; title: string; status: string | null };

export type AcceptanceItemRef = { id: string; title: string };

export type EvolutionStrings = {
  packHeading: string;
  experimentLabel: string;
  recommendedAction: string;
  targetCandidate: string;
  focusItems: string;
  noFocus: string;
  actAccept: string;
  actFixSelected: string;
  actRerun: string;
  actClarify: string;
  actCreateBenchmark: string;
  summaryAccept: string;
  summaryFixSelected: string;
  summaryRerun: string;
  summaryClarify: string;
  summaryCreateBenchmark: string;
  statusIssue: string;
  statusDecision: string;
  statusNotVerified: string;
  evidenceTemplate: string;
  evidenceNoData: string;
  secDecision: string;
  secDecisionBody: string;
  secEvidence: string;
  secPreMerge: string;
  secPreMergeBody: string;
  secNextReview: string;
  secNextReviewBody: string;
  secGoal: string;
  secGoalBody: string;
  secConstraints: string;
  cIntent: string;
  cScope: string;
  cPreserve: string;
  secExpectedOutput: string;
  oUpdate: string;
  oPr: string;
  oReport: string;
  oRerun: string;
  secAfterCompletion: string;
  secAfterCompletionBody: string;
  secWhyRerun: string;
  secWhyRerunBody: string;
  secSetup: string;
  secSetupBody: string;
  secRoles: string;
  secRolesBody: string;
  secCompare: string;
  secCompareBody: string;
  secWhyClarify: string;
  secWhyClarifyBody: string;
  secItemsClarify: string;
  secQuestions: string;
  secQuestionsBody: string;
  secAfterClarify: string;
  secAfterClarifyBody: string;
  secWhyBenchmark: string;
  secWhyBenchmarkBody: string;
  secRequiredInputs: string;
  secRequiredInputsBody: string;
  secSteps: string;
  secStepsBody: string;
  secWhatExpect: string;
  secWhatExpectBody: string;
};

export type BuildEvolutionActionPackInput = {
  projectId: string;
  experiment?: { id?: string; title?: string } | null;
  scorecard: ExperimentOutcomeScorecard;
  benchmark?: AgentBenchmarkResult | null;
  acceptanceItems?: AcceptanceItemRef[];
};

export type EvolutionActionPackMeta = {
  experimentTitle?: string;
  targetCandidateLabel?: string;
};

/**
 * Canonical English strings bundle. The route handler passes this; tests can
 * inject their own. Keep in sync with `apps/dashboard/src/i18n/dictionary.mjs`
 * `evolution.*` (EN) — the parity test asserts behavior, this constant keeps
 * server-saved packs deterministic regardless of caller locale.
 */
export const DEFAULT_EVOLUTION_STRINGS: EvolutionStrings = {
  // Heading sourced from BRAND (Stage 84) so a future rebrand touches one
  // file; saved pack_json rows from before this change keep their own
  // baked-in heading (immutable artifact policy).
  packHeading: BRAND.actionPackHeading,
  experimentLabel: "Experiment",
  recommendedAction: "Recommended action",
  targetCandidate: "Target candidate",
  focusItems: "Focus acceptance items",
  noFocus: "No specific focus items.",
  actAccept: "Accept this candidate",
  actFixSelected: "Fix the selected candidate",
  actRerun: "Run another experiment",
  actClarify: "Clarify acceptance items",
  actCreateBenchmark: "Create a benchmark first",
  summaryAccept: "Accept the selected candidate and confirm acceptance before merge.",
  summaryFixSelected: "Improve the selected candidate against the focus acceptance items.",
  summaryRerun: "Run another experiment with adjusted roles to get a clearer comparison.",
  summaryClarify: "Clarify the weak acceptance items before the next loop.",
  summaryCreateBenchmark: "Link review runs and create a benchmark to compare candidates.",
  statusIssue: "Issue found",
  statusDecision: "Needs decision",
  statusNotVerified: "Not verified",
  evidenceTemplate: "Acceptance pass rate {rate}; critical issues {crit}; not verified {nv}.",
  evidenceNoData: "No benchmark evidence is available yet.",
  secDecision: "Decision",
  secDecisionBody:
    "Accept the selected candidate as the current implementation. Before merge or release, review any remaining non-blocking items and confirm acceptance manually.",
  secEvidence: "Evidence summary",
  secPreMerge: "Pre-merge checklist",
  secPreMergeBody:
    "- Confirm remaining non-blocking items are acceptable.\n- Verify nothing already-passing regressed.\n- Confirm the PR is up to date.",
  secNextReview: "Next review",
  secNextReviewBody: "Re-run Conclave PR review after merge to capture the final state.",
  secGoal: "Goal",
  secGoalBody:
    "Improve the selected implementation. Do not rewrite the product intent. Focus only on the listed acceptance items and preserve already-passing behavior.",
  secConstraints: "Constraints",
  cIntent: "Do not rewrite the product intent.",
  cScope: "Do not change unrelated scope.",
  cPreserve: "Preserve behavior that already passed acceptance review.",
  secExpectedOutput: "Expected output",
  oUpdate: "Update the implementation.",
  oPr: "Open or update the PR.",
  oReport: "Report the PR number back to Conclave.",
  oRerun: "Re-run Conclave PR review after changes.",
  secAfterCompletion: "After completion",
  secAfterCompletionBody:
    "Record the outcome in the experiment decision so Conclave can score the next loop.",
  secWhyRerun: "Why rerun",
  secWhyRerunBody:
    "The current candidates did not produce a clearly acceptable outcome. Run another experiment with adjusted roles to get a better comparison.",
  secSetup: "Suggested experiment setup",
  secSetupBody: "Reuse the same product brief and acceptance items. Adjust the agent roles or the split of work.",
  secRoles: "Candidate roles",
  secRolesBody: "Keep at least two candidates so the benchmark can compare them.",
  secCompare: "How to compare results",
  secCompareBody: "Link each candidate's PR review run, then create a benchmark from the experiment.",
  secWhyClarify: "Why clarify",
  secWhyClarifyBody:
    "Several acceptance items could not be verified, which makes the outcome ambiguous. Clarify them before the next loop.",
  secItemsClarify: "Items needing clarification",
  secQuestions: "Questions to answer",
  secQuestionsBody: "For each item: what exactly must be true to pass, and what evidence proves it?",
  secAfterClarify: "After clarification",
  secAfterClarifyBody: "Update the acceptance items in the product spec, then re-run the experiment or PR review.",
  secWhyBenchmark: "Why benchmark first",
  secWhyBenchmarkBody: "No benchmark exists yet, so there is no evidence to compare candidates. Create one first.",
  secRequiredInputs: "Required inputs",
  secRequiredInputsBody: "At least two candidates, each linked to a completed PR review run.",
  secSteps: "Steps",
  secStepsBody: "Link each candidate's PR review run, then create a benchmark from the experiment.",
  secWhatExpect: "What to expect",
  secWhatExpectBody: "Conclave will compare acceptance results and recommend the next action.",
};

function actionLabel(action: EvolutionAction, s: EvolutionStrings): string {
  const map: Record<EvolutionAction, string> = {
    accept: s.actAccept,
    fix_selected: s.actFixSelected,
    rerun_experiment: s.actRerun,
    clarify_acceptance_items: s.actClarify,
    create_benchmark: s.actCreateBenchmark,
  };
  return map[action] ?? action;
}

function actionSummary(action: EvolutionAction, s: EvolutionStrings): string {
  const map: Record<EvolutionAction, string> = {
    accept: s.summaryAccept,
    fix_selected: s.summaryFixSelected,
    rerun_experiment: s.summaryRerun,
    clarify_acceptance_items: s.summaryClarify,
    create_benchmark: s.summaryCreateBenchmark,
  };
  return map[action] ?? s.summaryCreateBenchmark;
}

export function statusLabelFor(status: string | null | undefined, s: EvolutionStrings): string | null {
  if (status === "failed") return s.statusIssue;
  if (status === "needs_decision") return s.statusDecision;
  if (status === "inconclusive") return s.statusNotVerified;
  return null;
}

/**
 * Resolve suggestedFocusItemIds → { itemId, title, status } using, in order:
 * basis candidate's benchmark item outcomes → remaining blockers → acceptance
 * items → itemId fallback. Never invents a missing title.
 */
export function resolveFocusItems(
  scorecard: ExperimentOutcomeScorecard,
  benchmark: AgentBenchmarkResult | null | undefined,
  acceptanceItems?: AcceptanceItemRef[],
): ResolvedFocusItem[] {
  const ids = scorecard?.nextEvolution?.suggestedFocusItemIds ?? [];
  const basisId =
    scorecard?.selectedCandidateId ??
    benchmark?.recommendation?.winnerCandidateId ??
    benchmark?.blockerBasisCandidateId ??
    benchmark?.candidates?.[0]?.id;
  const outcomes: BenchmarkCandidateItemOutcome[] = basisId
    ? benchmark?.itemOutcomesByCandidate?.[basisId] ?? []
    : [];
  const byId = new Map(outcomes.map((o) => [o.itemId, o]));
  const blockerById = new Map(
    ((benchmark?.remainingBlockers ?? []) as BenchmarkItemBlocker[]).map((b) => [b.itemId, b]),
  );
  const accById = new Map((acceptanceItems ?? []).map((a) => [a.id, a]));
  return ids.map((itemId) => {
    const o = byId.get(itemId);
    const b = blockerById.get(itemId);
    const a = accById.get(itemId);
    const title = (o && o.title) || (b && b.title) || (a && a.title) || itemId;
    const status = (o && o.status) || (b && b.status) || null;
    return { itemId, title, status };
  });
}

function focusBody(focusItems: ResolvedFocusItem[], s: EvolutionStrings): string {
  if (!focusItems.length) return s.noFocus;
  return focusItems
    .map((f, i) => {
      const label = statusLabelFor(f.status, s);
      return `${i + 1}. ${label ? `${label} — ${f.title}` : f.title}`;
    })
    .join("\n");
}

function bullets(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

function evidenceBody(quality: ExperimentOutcomeScorecard["quality"] | undefined, s: EvolutionStrings): string {
  if (!quality || quality.acceptancePassRate == null) return s.evidenceNoData;
  return s.evidenceTemplate
    .replace("{rate}", `${Math.round(quality.acceptancePassRate * 100)}%`)
    .replace("{crit}", String(quality.criticalIssueCount ?? 0))
    .replace("{nv}", String(quality.notVerifiedCount ?? 0));
}

function sectionsFor(
  action: EvolutionAction,
  s: EvolutionStrings,
  focusItems: ResolvedFocusItem[],
  quality: ExperimentOutcomeScorecard["quality"] | undefined,
): EvolutionActionPackSection[] {
  switch (action) {
    case "accept":
      return [
        { title: s.secDecision, body: s.secDecisionBody },
        { title: s.secEvidence, body: evidenceBody(quality, s) },
        { title: s.secPreMerge, body: s.secPreMergeBody },
        { title: s.secNextReview, body: s.secNextReviewBody },
      ];
    case "fix_selected":
      return [
        { title: s.secGoal, body: s.secGoalBody },
        { title: s.focusItems, body: focusBody(focusItems, s) },
        { title: s.secConstraints, body: bullets([s.cIntent, s.cScope, s.cPreserve]) },
        { title: s.secExpectedOutput, body: bullets([s.oUpdate, s.oPr, s.oReport, s.oRerun]) },
        { title: s.secAfterCompletion, body: s.secAfterCompletionBody },
      ];
    case "rerun_experiment":
      return [
        { title: s.secWhyRerun, body: s.secWhyRerunBody },
        { title: s.secSetup, body: s.secSetupBody },
        { title: s.secRoles, body: s.secRolesBody },
        { title: s.secCompare, body: s.secCompareBody },
      ];
    case "clarify_acceptance_items":
      return [
        { title: s.secWhyClarify, body: s.secWhyClarifyBody },
        { title: s.secItemsClarify, body: focusBody(focusItems, s) },
        { title: s.secQuestions, body: s.secQuestionsBody },
        { title: s.secAfterClarify, body: s.secAfterClarifyBody },
      ];
    case "create_benchmark":
    default:
      return [
        { title: s.secWhyBenchmark, body: s.secWhyBenchmarkBody },
        { title: s.secRequiredInputs, body: s.secRequiredInputsBody },
        { title: s.secSteps, body: s.secStepsBody },
        { title: s.secWhatExpect, body: s.secWhatExpectBody },
      ];
  }
}

/** Build a deterministic EvolutionActionPack from a scorecard (+ optional benchmark). */
export function buildEvolutionActionPack(
  input: BuildEvolutionActionPackInput,
  s: EvolutionStrings = DEFAULT_EVOLUTION_STRINGS,
): EvolutionActionPack {
  const { projectId, experiment, scorecard, benchmark, acceptanceItems } = input;
  const action = (scorecard?.nextEvolution?.recommendedAction ?? "create_benchmark") as EvolutionAction;
  const focusItems = resolveFocusItems(scorecard, benchmark, acceptanceItems);
  const quality = scorecard?.quality;
  const targetCandidateId =
    action === "fix_selected" || action === "accept"
      ? scorecard?.selectedCandidateId ?? undefined
      : undefined;
  return {
    projectId,
    experimentId: experiment?.id ?? scorecard?.experimentId ?? "",
    recommendedAction: action,
    title: actionLabel(action, s),
    summary: actionSummary(action, s),
    targetCandidateId,
    focusItemIds: focusItems.map((f) => f.itemId),
    sections: sectionsFor(action, s, focusItems, quality),
  };
}

/**
 * Render a pack as deterministic, readable markdown for copy. `meta` carries the
 * already-localized experiment title + target candidate label for the header.
 * Never includes a userKey or token.
 */
export function buildEvolutionActionPackText(
  pack: EvolutionActionPack,
  s: EvolutionStrings = DEFAULT_EVOLUTION_STRINGS,
  meta: EvolutionActionPackMeta = {},
): string {
  const lines = [`# ${s.packHeading}`, "", `${s.recommendedAction}: ${pack.title}`];
  if (meta.experimentTitle) lines.push(`${s.experimentLabel}: ${meta.experimentTitle}`);
  if (pack.targetCandidateId && meta.targetCandidateLabel) {
    lines.push(`${s.targetCandidate}: ${meta.targetCandidateLabel}`);
  }
  for (const sec of pack.sections) {
    lines.push("", `## ${sec.title}`, "", sec.body);
  }
  return lines.join("\n");
}
