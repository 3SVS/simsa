// Stage 126 — Acceptance Graph Derived View v1.
//
// Derives a lightweight Acceptance Graph (nodes + edges + signal summary) from a
// SAVED workflow record's snapshots (acceptance map + stage plan + agent run plan
// + evidence plan, plus optional decision/outcome + evolution-action previews).
// This is a DERIVED VIEW, not a persisted graph database and not a trained model.
// Pure + deterministic; snapshot inputs are `unknown`, so every accessor is
// defensive (malformed → conservative fallback, never throws). Relationships that
// cannot be determined are skipped, never invented.

const MAX_ITEMS = 12;
const MAX_STAGES = 8;
const MAX_TASKS = 10;
const MAX_EVIDENCE = 10;
const MAX_DECISIONS = 5;
const MAX_ACTIONS = 7;
const MAX_EDGES = 40;
const MAX_TOP = 5;
const CONFIDENCE = ["low", "medium", "high"];

// decision candidate type → evolution action type (clean semantic mapping).
const DECISION_TO_ACTION = {
  fix: ["create_fix_instructions"],
  rerun: ["rerun_agent"],
  defer: ["defer_scope"],
  not_verified: ["collect_evidence", "clarify"],
  accept: [],
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
function unique(arr) {
  return [...new Set(arr)];
}
function slug(s) {
  return str(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "x";
}
function topCounts(pairs) {
  const counts = {};
  for (const p of pairs) {
    if (!p) continue;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_TOP);
}

/**
 * @param {{
 *   workflowRecordId?: string,
 *   title: string,
 *   sourceSummary: string,
 *   acceptanceMap?: unknown,
 *   stagePlan?: unknown,
 *   agentRunPlan?: unknown,
 *   evidencePlan?: unknown,
 *   decisionOutcomePreview?: unknown,
 *   evolutionActionPreview?: unknown,
 * }} input
 * @returns {import("./acceptance-graph-derived.d.mts").AcceptanceGraphDerivedView}
 */
export function buildAcceptanceGraphDerivedView(input) {
  const title = str(input?.title).trim() || "Saved workflow";

  // ── Parse source snapshots defensively ──
  const items = asArray(asObj(input?.acceptanceMap).items)
    .map(asObj)
    .map((it) => ({ title: str(it.title).trim(), area: str(it.area), status: str(it.status) }))
    .filter((it) => it.title.length > 0);

  const stages = asArray(asObj(input?.stagePlan).stages)
    .map(asObj)
    .map((s) => ({
      number: typeof s.number === "number" ? s.number : null,
      title: str(s.title),
      kind: str(s.kind),
    }))
    .filter((s) => s.number !== null);

  const tasks = asArray(asObj(input?.agentRunPlan).tasks)
    .map(asObj)
    .map((t, i) => ({
      id: str(t.id) || `task-${i + 1}`,
      stageNumber: typeof t.stageNumber === "number" ? t.stageNumber : null,
      role: str(t.role),
      task: str(t.task),
    }));

  const expectations = asArray(asObj(input?.evidencePlan).expectations)
    .map(asObj)
    .map((e, i) => ({
      id: str(e.id) || `ev-${i + 1}`,
      acceptanceItemTitle: str(e.acceptanceItemTitle).trim(),
      relatedArea: str(e.relatedArea),
      evidenceTypes: strArr(e.evidenceTypes),
      status: str(e.status),
      decisionImpact: str(e.decisionImpact),
    }));

  const decisions = asArray(asObj(input?.decisionOutcomePreview).decisionCandidates)
    .map(asObj)
    .map((d) => ({ type: str(d.type), label: str(d.label) }))
    .filter((d) => d.type.length > 0);

  const actions = asArray(asObj(input?.evolutionActionPreview).actions)
    .map(asObj)
    .map((a, i) => ({ id: str(a.id) || `act-${i + 1}`, type: str(a.type), title: str(a.title) }))
    .filter((a) => a.type.length > 0);

  // ── Nodes ──
  /** @type {import("./acceptance-graph-derived.d.mts").AcceptanceGraphNode[]} */
  const nodes = [];
  const INTAKE_ID = "intake";
  nodes.push({ id: INTAKE_ID, type: "intake", label: title, summary: str(input?.sourceSummary).trim() || undefined });

  const itemNodeByTitle = new Map();
  items.slice(0, MAX_ITEMS).forEach((it, i) => {
    const id = `ai-${i + 1}`;
    itemNodeByTitle.set(it.title, id);
    nodes.push({ id, type: "acceptance_item", label: it.title, summary: it.status ? it.status.replace(/_/g, " ") : undefined });
  });

  const areaNodeByArea = new Map();
  for (const it of items.slice(0, MAX_ITEMS)) {
    if (!it.area || areaNodeByArea.has(it.area)) continue;
    const id = `area-${slug(it.area)}`;
    areaNodeByArea.set(it.area, id);
    nodes.push({ id, type: "acceptance_area", label: it.area.replace(/_/g, " ") });
  }

  const stageNodeByNumber = new Map();
  stages.slice(0, MAX_STAGES).forEach((s) => {
    const id = `stage-${s.number}`;
    stageNodeByNumber.set(s.number, { id, kind: s.kind });
    nodes.push({ id, type: "stage", label: `Stage ${s.number}${s.title ? `: ${s.title}` : ""}` });
  });

  tasks.slice(0, MAX_TASKS).forEach((t) => {
    nodes.push({
      id: `node-${t.id}`,
      type: "agent_task",
      label: t.task || t.role || t.id,
      summary: t.role || undefined,
    });
  });
  const taskNodesByStage = new Map();
  for (const t of tasks.slice(0, MAX_TASKS)) {
    if (t.stageNumber === null) continue;
    if (!taskNodesByStage.has(t.stageNumber)) taskNodesByStage.set(t.stageNumber, []);
    taskNodesByStage.get(t.stageNumber).push(`node-${t.id}`);
  }

  const evidenceNodeByItemTitle = new Map();
  expectations.slice(0, MAX_EVIDENCE).forEach((e) => {
    const id = `evx-${e.id}`;
    if (e.acceptanceItemTitle && !evidenceNodeByItemTitle.has(e.acceptanceItemTitle)) {
      evidenceNodeByItemTitle.set(e.acceptanceItemTitle, id);
    }
    nodes.push({
      id,
      type: "evidence_expectation",
      label: e.acceptanceItemTitle || e.id,
      summary: e.status ? e.status.replace(/_/g, " ") : undefined,
    });
  });

  const decisionNodeByType = new Map();
  decisions.slice(0, MAX_DECISIONS).forEach((d) => {
    const id = `dc-${slug(d.type)}`;
    decisionNodeByType.set(d.type, id);
    nodes.push({ id, type: "decision_candidate", label: d.label || d.type.replace(/_/g, " ") });
  });

  const actionNodesByType = new Map();
  actions.slice(0, MAX_ACTIONS).forEach((a) => {
    const id = `ap-${a.id}`;
    if (!actionNodesByType.has(a.type)) actionNodesByType.set(a.type, []);
    actionNodesByType.get(a.type).push(id);
    nodes.push({ id, type: "action_preview", label: a.title || a.type.replace(/_/g, " ") });
  });

  // ── Edges (deterministic; skip when relationship is unknown; cap MAX_EDGES) ──
  /** @type {import("./acceptance-graph-derived.d.mts").AcceptanceGraphEdge[]} */
  const edges = [];
  let edgeSeq = 0;
  const addEdge = (type, from, to, label) => {
    if (edges.length >= MAX_EDGES) return;
    if (!from || !to) return;
    edgeSeq += 1;
    edges.push({ id: `e-${edgeSeq}`, type, from, to, label });
  };

  for (const [itemTitle, itemId] of itemNodeByTitle) {
    addEdge("generated_from", INTAKE_ID, itemId, "generated from");
  }
  for (const it of items.slice(0, MAX_ITEMS)) {
    const itemId = itemNodeByTitle.get(it.title);
    const areaId = areaNodeByArea.get(it.area);
    if (itemId && areaId) addEdge("belongs_to", itemId, areaId, "belongs to");
  }
  for (const e of expectations.slice(0, MAX_EVIDENCE)) {
    const itemId = itemNodeByTitle.get(e.acceptanceItemTitle);
    const evId = `evx-${e.id}`;
    if (itemId) addEdge("requires_evidence", itemId, evId, "requires evidence");
  }
  for (const [stageNumber, taskIds] of taskNodesByStage) {
    const stage = stageNodeByNumber.get(stageNumber);
    if (!stage) continue;
    for (const taskId of taskIds) addEdge("assigned_to_role", stage.id, taskId, "assigned to role");
  }
  for (const e of expectations.slice(0, MAX_EVIDENCE)) {
    const evId = `evx-${e.id}`;
    const decId = decisionNodeByType.get(e.decisionImpact);
    if (decId) addEdge("suggests_decision", evId, decId, "suggests decision");
  }
  for (const [decType, decId] of decisionNodeByType) {
    for (const actType of DECISION_TO_ACTION[decType] ?? []) {
      for (const actId of actionNodesByType.get(actType) ?? []) {
        addEdge("creates_action", decId, actId, "creates action");
      }
    }
  }
  // blocks_release: release-readiness items → release stages.
  const releaseStageIds = stages
    .slice(0, MAX_STAGES)
    .filter((s) => s.kind === "release")
    .map((s) => stageNodeByNumber.get(s.number)?.id)
    .filter(Boolean);
  for (const it of items.slice(0, MAX_ITEMS)) {
    if (it.area !== "release_readiness") continue;
    const itemId = itemNodeByTitle.get(it.title);
    for (const sid of releaseStageIds) addEdge("blocks_release", itemId, sid, "blocks release");
  }

  // ── Signal summary (counts over full source arrays, not capped node counts) ──
  const signalSummary = {
    acceptanceItemCount: items.length,
    stageCount: stages.length,
    agentTaskCount: tasks.length,
    evidenceExpectationCount: expectations.length,
    notVerifiedCount: expectations.filter((e) => e.status === "not_verified").length,
    decisionCandidateCount: decisions.length,
    actionPreviewCount: actions.length,
    topAcceptanceAreas: topCounts(items.map((it) => it.area).filter(Boolean)).map(
      ([area, count]) => ({ area, count }),
    ),
    topEvidenceTypes: topCounts(expectations.flatMap((e) => e.evidenceTypes)).map(
      ([evidenceType, count]) => ({ evidenceType, count }),
    ),
  };

  const confidence =
    items.length > 0 && expectations.length > 0
      ? CONFIDENCE.includes(asObj(input?.acceptanceMap).confidence)
        ? asObj(input?.acceptanceMap).confidence
        : "medium"
      : "low";

  return {
    workflowRecordId: str(input?.workflowRecordId) || undefined,
    title,
    summary:
      "Simsa connects acceptance items, stages, agent tasks, evidence expectations, decisions, and next actions from this saved workflow into a derived graph view.",
    nodes,
    edges,
    signalSummary,
    notIncludedYet: [
      "This graph is derived from saved workflow snapshots.",
      "No graph database is created yet.",
      "No model is trained from this view.",
      "No private raw content is used for model training by default.",
    ],
    confidence,
  };
}
