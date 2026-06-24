// Stage 101 — unified intake model.
//
// One intake system with multiple starting points. Every intake type produces
// the SAME downstream outputs, so the product has one acceptance pipeline rather
// than six separate products. This module is pure + deterministic — no backend,
// no external fetch, no Anthropic call. Future stages (102+) replace the mock
// draft with real per-type analysis.

/** @type {import("./intake.d.mts").WorkspaceIntakeType[]} */
export const WORKSPACE_INTAKE_TYPES = [
  "idea",
  "prd",
  "product_url",
  "github_repo",
  "pull_request",
  "ai_built_app",
];

/** @type {import("./intake.d.mts").WorkspaceIntakeOutput[]} */
export const INTAKE_OUTPUTS = [
  "product_understanding",
  "acceptance_items",
  "stage_plan",
  "review_evidence",
  "decision",
  "release_readiness",
];

export const INTAKE_OUTPUT_LABELS = {
  product_understanding: "Product understanding",
  acceptance_items: "Acceptance items",
  stage_plan: "Stage plan",
  review_evidence: "Review evidence",
  decision: "Accept / fix / rerun decisions",
  release_readiness: "Release readiness",
};

export const INTAKE_META = {
  idea: {
    type: "idea",
    label: "Idea",
    description: "Start from a raw product idea.",
    placeholder: "A tool that helps founders review AI-built apps before launch.",
    inputHint: "Describe the product idea in a sentence or two.",
  },
  prd: {
    type: "prd",
    label: "PRD / spec",
    description: "Turn an existing product document into acceptance items.",
    placeholder: "Paste your PRD or requirements.",
    inputHint: "Paste the PRD or spec text.",
  },
  product_url: {
    type: "product_url",
    label: "Product URL",
    description: "Review an existing product surface.",
    placeholder: "https://example.com",
    inputHint: "Paste the product URL.",
  },
  github_repo: {
    type: "github_repo",
    label: "GitHub repo",
    description: "Understand an existing codebase.",
    placeholder: "owner/repo or GitHub URL",
    inputHint: "Paste owner/repo or a GitHub URL.",
  },
  pull_request: {
    type: "pull_request",
    label: "Pull request",
    description: "Review a proposed change.",
    placeholder: "https://github.com/owner/repo/pull/123",
    inputHint: "Paste a GitHub pull request URL.",
  },
  ai_built_app: {
    type: "ai_built_app",
    label: "AI-built app",
    description: "Recover and structure a vibe-coded draft.",
    placeholder: "Describe what the AI-built app currently does and what feels uncertain.",
    inputHint: "Describe the current app and what feels uncertain.",
  },
};

/** @returns {value is import("./intake.d.mts").WorkspaceIntakeType} */
export function isWorkspaceIntakeType(value) {
  return typeof value === "string" && WORKSPACE_INTAKE_TYPES.includes(value);
}

/**
 * Deterministic local draft. No network, no model call. Every type yields the
 * full set of expected outputs — the unified acceptance promise.
 * @param {import("./intake.d.mts").WorkspaceIntakeType} type
 * @param {string} rawInput
 * @returns {import("./intake.d.mts").WorkspaceIntakeDraft}
 */
export function buildIntakeDraft(type, rawInput) {
  if (!isWorkspaceIntakeType(type)) {
    throw new Error(`unknown intake type: ${String(type)}`);
  }
  const meta = INTAKE_META[type];
  const trimmed = typeof rawInput === "string" ? rawInput.trim() : "";
  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  return {
    type,
    title: snippet ? `${meta.label}: ${snippet}` : `${meta.label} intake`,
    sourceSummary: snippet
      ? `${meta.label} — ${snippet}`
      : `${meta.label} — no input provided yet`,
    rawInput: trimmed,
    expectedOutputs: [...INTAKE_OUTPUTS],
  };
}
