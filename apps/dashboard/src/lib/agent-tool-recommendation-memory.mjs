// Stage 128 — deterministic Agent/Tool Recommendation Memory (per-workflow).
//
// Derives a per-workflow "memory" of which role/tool pairings appear, what
// evidence each tool is expected to produce, where tool↔evidence align or
// mismatch, and which pairings are associated with blocker signals. This is NOT
// ML training and NOT cross-project memory — it is a derived, per-workflow
// preview. Pure + deterministic; snapshot inputs are `unknown`, so every accessor
// is defensive (malformed → conservative fallback, never throws). Memory items
// are NOT fabricated when there are no tasks.

const MAX_ITEMS = 8;
const MAX_LIST = 8;
const CONFIDENCE = ["low", "medium", "high"];
const ROLES = ["builder", "reviewer", "fixer", "verifier", "operator"];

// Tool → evidence types it is expected to produce.
const TOOL_EVIDENCE = {
  github_pr_review: ["pr_link", "review_note", "commit_link"],
  claude_code: ["commit_link", "fix_summary", "build_result", "test_result"],
  codex: ["commit_link", "fix_summary", "build_result", "test_result"],
  browser_check: ["screenshot", "walkthrough"],
  test_run: ["test_result", "build_result"],
  human_review: ["clarification_note", "review_note", "acceptance_checklist", "release_decision_note"],
  none: [],
};

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

/**
 * Tool fit from expected-evidence alignment (conservative; never claims quality).
 * strong: overlaps with the actual expected evidence types
 * partial: tool has known evidence, item expects evidence, but no overlap-yet AND
 *          some of the tool's evidence is plausibly still needed
 * weak: tool has known evidence but none aligns and item has evidence needs
 * unknown: tool or evidence data missing
 */
function toolFit(tool, expectedEvidenceTypes) {
  const toolEvidence = TOOL_EVIDENCE[tool];
  if (toolEvidence === undefined) return "unknown";
  if (tool === "none") return "unknown";
  if (expectedEvidenceTypes.length === 0) return "unknown";
  const overlap = expectedEvidenceTypes.filter((e) => toolEvidence.includes(e));
  if (overlap.length === 0) return "weak";
  if (overlap.length >= expectedEvidenceTypes.length) return "strong";
  return "partial";
}

/**
 * @param {{
 *   workflowRecordId?: string, title: string, sourceSummary: string,
 *   agentRunPlan?: unknown, evidencePlan?: unknown,
 *   recurringBlockerDetectionView?: unknown,
 * }} input
 * @returns {import("./agent-tool-recommendation-memory.d.mts").AgentToolRecommendationMemoryView}
 */
export function buildAgentToolRecommendationMemoryView(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  const tasks = asArray(asObj(input?.agentRunPlan).tasks).map((raw, i) => {
    const t = asObj(raw);
    return {
      id: str(t.id) || `task-${i + 1}`,
      role: clampRole(str(t.role)),
      recommendedTool: str(t.recommendedTool) || "none",
      stageNumber: typeof t.stageNumber === "number" ? t.stageNumber : null,
      expectedEvidence: strArr(t.expectedEvidence),
    };
  });

  // Evidence type expectations from the Evidence Plan, keyed by stage number, so
  // a task's expected evidence can be enriched beyond what the task itself lists.
  const expectations = asArray(asObj(input?.evidencePlan).expectations).map(asObj);
  const evidenceByStage = new Map();
  for (const e of expectations) {
    for (const n of numArr(e.relatedStageNumbers)) {
      if (!evidenceByStage.has(n)) evidenceByStage.set(n, []);
      evidenceByStage.get(n).push(...strArr(e.evidenceTypes));
    }
  }

  const blockers = asArray(asObj(input?.recurringBlockerDetectionView).blockers).map(asObj);

  // Group tasks by role + recommendedTool.
  const groups = new Map();
  for (const t of tasks) {
    const key = `${t.role}|${t.recommendedTool}`;
    const g = groups.get(key) ?? {
      role: t.role,
      recommendedTool: t.recommendedTool,
      taskIds: [],
      stageNumbers: [],
      expectedEvidence: [],
    };
    g.taskIds.push(t.id);
    if (t.stageNumber !== null) g.stageNumbers.push(t.stageNumber);
    g.expectedEvidence.push(...t.expectedEvidence);
    groups.set(key, g);
  }

  const items = [...groups.values()].slice(0, MAX_ITEMS).map((g, i) => {
    const stageNumbers = unique(g.stageNumbers).sort((a, b) => a - b);
    // Enrich expected evidence with the Evidence Plan's per-stage types.
    const stageEvidence = stageNumbers.flatMap((n) => evidenceByStage.get(n) ?? []);
    const expectedEvidenceTypes = unique([...g.expectedEvidence, ...stageEvidence]).slice(0, MAX_LIST);
    const fit = toolFit(g.recommendedTool, expectedEvidenceTypes);

    // Blocker association: overlap on task id or stage number.
    const blockerTypes = unique(
      blockers
        .filter((b) => {
          const bTasks = strArr(b.relatedTaskIds);
          const bStages = numArr(b.relatedStageNumbers);
          return (
            bTasks.some((id) => g.taskIds.includes(id)) ||
            bStages.some((n) => stageNumbers.includes(n))
          );
        })
        .map((b) => str(b.type))
        .filter(Boolean),
    ).slice(0, MAX_LIST);

    const toolLabel = g.recommendedTool.replace(/_/g, " ");
    const memoryNote =
      fit === "strong"
        ? `${toolLabel} aligns with the evidence expected for ${g.role} tasks here.`
        : fit === "partial"
          ? `${toolLabel} is partially aligned — some expected evidence is not covered by this tool.`
          : fit === "weak"
            ? `${toolLabel} does not align with the evidence expected for these tasks.`
            : `${toolLabel} has no clear evidence alignment to remember yet.`;

    const suggestedFutureUse =
      blockerTypes.length > 0
        ? "Pair this role/tool with additional evidence collection before a decision in similar workflows."
        : fit === "strong"
          ? "Reuse this role/tool pairing for similar workflows with the same evidence needs."
          : fit === "unknown"
            ? "Clarify acceptance scope and expected evidence before relying on this pairing."
            : "Pair this tool with the missing expected evidence before a decision.";

    return {
      id: `mem-${i + 1}`,
      role: g.role,
      recommendedTool: g.recommendedTool,
      toolFit: fit,
      taskIds: unique(g.taskIds).slice(0, MAX_LIST),
      stageNumbers,
      expectedEvidenceTypes,
      blockerTypes,
      memoryNote,
      suggestedFutureUse,
    };
  });

  const evidenceFitSummary = { strong: 0, partial: 0, weak: 0, unknown: 0 };
  for (const it of items) evidenceFitSummary[it.toolFit] += 1;

  // topTool/topRole: most taskIds → strongest fit → lowest lexical label.
  const FIT_RANK = { strong: 0, partial: 1, weak: 2, unknown: 3 };
  let topTool;
  let topRole;
  if (items.length > 0) {
    const ranked = [...items].sort(
      (a, b) =>
        b.taskIds.length - a.taskIds.length ||
        FIT_RANK[a.toolFit] - FIT_RANK[b.toolFit] ||
        (a.recommendedTool < b.recommendedTool ? -1 : a.recommendedTool > b.recommendedTool ? 1 : 0),
    );
    topTool = ranked[0].recommendedTool;
    topRole = ranked[0].role;
  }

  const confidence =
    items.length === 0
      ? "low"
      : items.some((it) => it.toolFit === "strong")
        ? "medium"
        : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa derives which agent roles and tools appear in this saved workflow and how well each tool aligns with the evidence the work expects — to remember for similar workflows.",
    items,
    topTool,
    topRole,
    evidenceFitSummary,
    notIncludedYet: [
      "This memory is derived from this saved workflow only.",
      "No cross-project learning or model training is used yet.",
      "Tool fit is based on expected evidence alignment, not actual execution quality.",
      "No agent/tool is executed or benchmarked in this view.",
    ],
    confidence,
  };
}
