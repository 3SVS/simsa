// Stage 113 — deterministic Benchmark Handoff Preview.
//
// Converts a SAVED agent workflow record (Stage 112/112B snapshots: agent run
// plan + evidence plan + acceptance map + stage plan) into a comparison-ready
// benchmark handoff PLAN. This does NOT execute a benchmark, compare any agent
// output, persist anything, pick a winner, or call any model/GitHub. It only
// shows how the saved workflow could be handed off to a benchmark.
//
// Pure + deterministic. Snapshot inputs are `unknown` (they come back from the
// central-plane record as parsed JSON), so every accessor is defensive — a
// malformed snapshot yields conservative fallbacks instead of throwing.
import {
  AGENT_ROLE_LABELS,
  AGENT_TOOL_LABELS,
} from "./intake-agent-run-plan.mjs";
import { EVIDENCE_TYPE_LABELS } from "./intake-evidence-plan.mjs";

const ROLES = ["builder", "reviewer", "fixer", "verifier", "operator"];
const TOOLS = [
  "human_review",
  "claude_code",
  "codex",
  "github_pr_review",
  "browser_check",
  "test_run",
  "none",
];
const CONFIDENCE = ["low", "medium", "high"];

const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 6;
const MIN_TARGETS = 3;
const MAX_TARGETS = 8;
const MAX_EVIDENCE_PER_ITEM = 6;

function asArray(x) {
  return Array.isArray(x) ? x : [];
}
function asObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function str(x) {
  return typeof x === "string" ? x : "";
}
function strArr(x) {
  return asArray(x).filter((s) => typeof s === "string" && s.length > 0);
}
function numArr(x) {
  return asArray(x).filter((n) => typeof n === "number" && Number.isFinite(n));
}
function unique(arr) {
  return [...new Set(arr)];
}
function clampRole(role) {
  return ROLES.includes(role) ? role : "operator";
}
function clampTool(tool) {
  return TOOLS.includes(tool) ? tool : "none";
}

/** Decision criteria for an acceptance target, by the evidence decision impact. */
function decisionCriteria(decisionImpact) {
  const base = [
    "Evidence is attached for the relevant stage.",
    "The output addresses the acceptance item directly.",
    "Remaining uncertainty is marked not_verified instead of assumed complete.",
  ];
  if (decisionImpact === "fix")
    base.push("A fix recommendation is explicit if the item is not satisfied.");
  else if (decisionImpact === "rerun")
    base.push("A rerun recommendation is explicit if the result is inconclusive.");
  else if (decisionImpact === "defer")
    base.push("A defer recommendation is explicit if the decision is blocked.");
  else if (decisionImpact === "accept")
    base.push("An accept recommendation requires the supporting evidence to be present.");
  else base.push("Fix/rerun/defer recommendation is explicit.");
  return base;
}

/** Map an evidence type key to its human label (fallback to the raw key). */
function evidenceLabel(type) {
  return EVIDENCE_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

/**
 * @param {{
 *   workflowRecordId?: string,
 *   title: string,
 *   sourceSummary: string,
 *   agentRunPlan: unknown,
 *   evidencePlan: unknown,
 *   acceptanceMap?: unknown,
 *   stagePlan?: unknown,
 * }} input
 * @returns {import("./intake-benchmark-handoff.d.mts").BenchmarkHandoffPreview}
 */
export function buildBenchmarkHandoffPreview(input) {
  const title = str(input?.title).trim() || "Saved workflow";
  const sourceSummary = str(input?.sourceSummary).trim();

  // ── Agent candidates from Agent Run Plan tasks, grouped by role + tool ──
  const tasks = asArray(asObj(input?.agentRunPlan).tasks);
  const groups = new Map();
  let derivedCandidates = false;
  for (const raw of tasks) {
    const t = asObj(raw);
    const id = str(t.id);
    if (!id) continue;
    const role = clampRole(str(t.role));
    const tool = clampTool(str(t.recommendedTool));
    const key = `${role}|${tool}`;
    const g = groups.get(key) ?? {
      role,
      recommendedTool: tool,
      taskIds: [],
      stageNumbers: [],
      expectedEvidence: [],
    };
    g.taskIds.push(id);
    if (typeof t.stageNumber === "number" && Number.isFinite(t.stageNumber)) {
      g.stageNumbers.push(t.stageNumber);
    }
    g.expectedEvidence.push(...strArr(t.expectedEvidence));
    groups.set(key, g);
    derivedCandidates = true;
  }

  let agentCandidates = [...groups.values()].map((g) => ({
    role: g.role,
    label: `${AGENT_ROLE_LABELS[g.role]} / ${AGENT_TOOL_LABELS[g.recommendedTool]}`,
    recommendedTool: g.recommendedTool,
    taskIds: unique(g.taskIds),
    stageNumbers: unique(g.stageNumbers).sort((a, b) => a - b),
    expectedEvidence: unique(g.expectedEvidence).slice(0, MAX_EVIDENCE_PER_ITEM),
  }));

  // Conservative fallback so a comparison always has ≥2 candidates.
  if (agentCandidates.length < MIN_CANDIDATES) {
    const fallbacks = [
      {
        role: "reviewer",
        label: `${AGENT_ROLE_LABELS.reviewer} / ${AGENT_TOOL_LABELS.human_review}`,
        recommendedTool: "human_review",
        taskIds: [],
        stageNumbers: [],
        expectedEvidence: ["Review note"],
      },
      {
        role: "verifier",
        label: `${AGENT_ROLE_LABELS.verifier} / ${AGENT_TOOL_LABELS.test_run}`,
        recommendedTool: "test_run",
        taskIds: [],
        stageNumbers: [],
        expectedEvidence: ["Test result"],
      },
    ];
    const seen = new Set(agentCandidates.map((c) => `${c.role}|${c.recommendedTool}`));
    for (const f of fallbacks) {
      if (agentCandidates.length >= MIN_CANDIDATES) break;
      if (seen.has(`${f.role}|${f.recommendedTool}`)) continue;
      seen.add(`${f.role}|${f.recommendedTool}`);
      agentCandidates.push(f);
    }
  }
  agentCandidates = agentCandidates.slice(0, MAX_CANDIDATES);

  // ── Acceptance targets from Evidence Plan expectations ──
  const expectations = asArray(asObj(input?.evidencePlan).expectations);
  let derivedTargets = false;
  let acceptanceTargets = expectations
    .map((raw) => {
      const e = asObj(raw);
      const acceptanceItemTitle = str(e.acceptanceItemTitle).trim();
      if (!acceptanceItemTitle) return null;
      derivedTargets = true;
      const area = str(e.relatedArea) || "product_intent";
      return {
        acceptanceItemTitle,
        area,
        stageNumbers: unique(numArr(e.relatedStageNumbers)).sort((a, b) => a - b),
        evidenceTypes: unique(strArr(e.evidenceTypes).map(evidenceLabel)),
        decisionCriteria: decisionCriteria(str(e.decisionImpact)),
      };
    })
    .filter(Boolean);

  if (acceptanceTargets.length < MIN_TARGETS) {
    const fillers = [
      {
        acceptanceItemTitle: "The primary flow can be completed without unclear states.",
        area: "primary_user_flow",
      },
      {
        acceptanceItemTitle: "Release readiness is checked before sharing with users.",
        area: "release_readiness",
      },
      {
        acceptanceItemTitle: "Private data is not exposed unintentionally.",
        area: "data_privacy",
      },
    ];
    const seen = new Set(acceptanceTargets.map((t) => t.acceptanceItemTitle));
    for (const f of fillers) {
      if (acceptanceTargets.length >= MIN_TARGETS) break;
      if (seen.has(f.acceptanceItemTitle)) continue;
      seen.add(f.acceptanceItemTitle);
      acceptanceTargets.push({
        acceptanceItemTitle: f.acceptanceItemTitle,
        area: f.area,
        stageNumbers: [],
        evidenceTypes: [],
        decisionCriteria: decisionCriteria("not_verified"),
      });
    }
  }
  acceptanceTargets = acceptanceTargets.slice(0, MAX_TARGETS);

  // ── Benchmark goal ──
  const benchmarkGoal = sourceSummary
    ? `Compare candidate outputs for: ${title}`
    : "Compare candidate agent outputs against the saved acceptance workflow and expected evidence.";

  // ── Confidence: reuse a snapshot's confidence when present, else conservative ──
  const snapshotConfidence = [
    asObj(input?.acceptanceMap).confidence,
    asObj(input?.evidencePlan).confidence,
    asObj(input?.agentRunPlan).confidence,
  ].find((c) => CONFIDENCE.includes(c));
  const confidence =
    derivedCandidates && derivedTargets
      ? snapshotConfidence ?? "medium"
      : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa prepares the saved workflow as a comparison-ready benchmark handoff: candidate agents, acceptance targets, and the questions a benchmark should answer.",
    benchmarkGoal,
    agentCandidates,
    acceptanceTargets,
    comparisonQuestions: [
      "Which output best addresses the primary acceptance items?",
      "Which output provides the clearest expected evidence?",
      "Which acceptance items remain not verified?",
      "Which output should be accepted, fixed, rerun, or deferred?",
      "What evidence is missing before a decision?",
    ],
    notIncludedYet: [
      "No benchmark is executed in this preview.",
      "No agent output is compared yet.",
      "No benchmark result is persisted yet.",
      "No winner or final decision is selected yet.",
    ],
    confidence,
  };
}
