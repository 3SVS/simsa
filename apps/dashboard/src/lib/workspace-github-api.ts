"use client";

/**
 * Dashboard API client for workspace GitHub OAuth + project-repo connections.
 * GitHub tokens are NEVER handled here — central-plane manages them.
 */

const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

const DASHBOARD_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : "https://dashboard.conclave-ai.dev";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitHubUser = { login: string; name?: string; avatarUrl?: string };

export type GitHubStatusResponse =
  | { ok: true; connected: false }
  | { ok: true; connected: true; user: GitHubUser }
  | { ok: false; error: string };

export type GitHubRepo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  // Additive (Stage 56): viewer permission bits, when GitHub provides them.
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
};

export type LookupRepoResponse =
  | { ok: true; repo: GitHubRepo }
  // appInstallUrl: additive — set when a private repo needs the GitHub App
  // installed (error "app_not_installed", sometimes "not_found").
  | { ok: false; error: string; appInstallUrl?: string };

export type GitHubReposResponse =
  | { ok: true; repos: GitHubRepo[] }
  | { ok: false; error: string };

export type LinkedRepo = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch?: string;
  private: boolean;
  htmlUrl?: string;
};

export type ProjectRepoResponse =
  | { ok: true; repo: LinkedRepo | null }
  | { ok: false; error: string };

export type LinkProjectRepoResponse =
  | { ok: true; repo: LinkedRepo }
  | { ok: false; error: string };

// ─── OAuth start ──────────────────────────────────────────────────────────────

/** Navigate the browser to GitHub OAuth. Returns the URL (caller does the redirect). */
export function buildOAuthStartUrl(userKey: string, returnTo: string): string {
  const params = new URLSearchParams({ userKey, returnTo });
  return `${CENTRAL_PLANE_URL}/workspace/github/oauth/start?${params.toString()}`;
}

/** Start the GitHub OAuth flow — navigates the current page to GitHub. */
export function startGitHubOAuth(userKey: string, returnTo?: string): void {
  const rt = returnTo ?? window.location.href;
  window.location.href = buildOAuthStartUrl(userKey, rt);
}

// ─── Connection status ────────────────────────────────────────────────────────

export async function fetchGitHubStatus(userKey: string): Promise<GitHubStatusResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/github/status?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as GitHubStatusResponse;
  } catch {
    // Honest failure: an error is not "disconnected" — callers show a retry.
    return { ok: false, error: "network" };
  }
}

// ─── Disconnect (Stage 273) ───────────────────────────────────────────────────

export type DisconnectGitHubResponse =
  | { ok: true; disconnected: boolean }
  | { ok: false; error: string };

/**
 * Delete the user's GitHub connection (including the server-side encrypted
 * token). Needed to switch accounts: GitHub OAuth silently re-authorizes an
 * existing grant, so the user must disconnect here, then log out or switch
 * accounts at github.com, then connect again.
 */
export async function disconnectGitHub(userKey: string): Promise<DisconnectGitHubResponse> {
  try {
    const resp = await fetch(`${CENTRAL_PLANE_URL}/workspace/github/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userKey }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as DisconnectGitHubResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Repo list ────────────────────────────────────────────────────────────────

/**
 * Resolve a repo by "owner/repo" full name (Stage 56 direct-entry fallback). Lets the
 * user connect an org/collaborator repo that never shows up in the listing.
 */
export async function lookupGitHubRepo(
  userKey: string,
  fullName: string,
): Promise<LookupRepoResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/github/repos/lookup?userKey=${encodeURIComponent(userKey)}&fullName=${encodeURIComponent(fullName)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as LookupRepoResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function fetchGitHubRepos(userKey: string): Promise<GitHubReposResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/github/repos?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      return { ok: false, error: err.error ?? `HTTP ${resp.status}` };
    }
    return (await resp.json()) as GitHubReposResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Project-repo link ────────────────────────────────────────────────────────

export async function linkProjectRepo(
  projectId: string,
  userKey: string,
  repo: GitHubRepo,
): Promise<LinkProjectRepoResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/repo`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, repo }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as LinkProjectRepoResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function fetchProjectRepo(projectId: string, userKey: string): Promise<ProjectRepoResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/repo?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as ProjectRepoResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Pull Requests ────────────────────────────────────────────────────────────

export type GitHubPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  headBranch: string;
  baseBranch: string;
  updatedAt?: string;
};

export type LinkedPull = {
  id: string;
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  htmlUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  selectedItemIds: string[];
  updatedAt: string;
};

export type PullListResponse =
  | { ok: true; repo: { fullName: string; owner: string; name: string; defaultBranch?: string }; pulls: GitHubPull[] }
  | { ok: false; error: string };

export type LinkedPullsResponse =
  | { ok: true; pulls: LinkedPull[] }
  | { ok: false; error: string };

export type LinkPullResponse =
  | { ok: true; pull: LinkedPull }
  | { ok: false; error: string };

export async function fetchProjectPulls(
  projectId: string,
  userKey: string,
): Promise<PullListResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      return { ok: false, error: err.error ?? `HTTP ${resp.status}` };
    }
    return (await resp.json()) as PullListResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function fetchLinkedPulls(projectId: string, userKey: string): Promise<LinkedPullsResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/linked-pulls?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as LinkedPullsResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function linkPullRequest(
  projectId: string,
  prNumber: number,
  input: { userKey: string; pullRequest: Omit<GitHubPull, "updatedAt">; selectedItemIds: string[] },
): Promise<LinkPullResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/link`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` })) as { error?: string };
      return { ok: false, error: err.error ?? `HTTP ${resp.status}` };
    }
    return (await resp.json()) as LinkPullResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── PR Review ────────────────────────────────────────────────────────────────

export type ReviewResultItem = {
  itemId: string;
  title: string;
  status: "passed" | "failed" | "inconclusive" | "needs_decision";
  userLabel: "통과" | "안 맞음" | "확인 부족" | "결정 필요";
  reason: string;
  evidence: string[];
  nextAction: string;
};

export type ReviewSummary = {
  passed: number;
  failed: number;
  inconclusive: number;
  needsDecision: number;
};

export type ReviewRun = {
  id: string;
  status: "queued" | "running" | "passed" | "failed" | "inconclusive" | "error";
  repoFullName?: string;
  prNumber?: number;
  selectedItemIds?: string[];
  summary?: ReviewSummary;
  results?: ReviewResultItem[];
  errorMessage?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreditEnforcementDryRun = {
  actualDebitsEnabled: false;
  wouldBlock: boolean;
  billingStatus: string;
  eventType: string;
  creditType?: string;
  requiredCredits: number;
  currentBalance: number;
  remainingAfter: number;
  message: string;
  allowance?: {
    enabled: true;
    period: "monthly";
    periodKey: string;
    includedRuns: number;
    usedThisPeriod: number;
    remainingIncludedRuns: number;
    coveredByAllowance: boolean;
    billableUnitsAfterAllowance: number;
  };
};

// Stage 24/26/27/31 — extends CreditEnforcementDryRun with actual debit + idempotency + rollout fields
export type CreditEnforcementResult = {
  actualDebitsEnabled: boolean;
  actualDebitAllowedForUser?: boolean;
  blocked: boolean;
  wouldBlock: boolean;
  billingStatus: string;
  eventType: string;
  creditType?: string;
  requiredCredits: number;
  currentBalance: number;
  remainingAfter: number;
  message: string;
  debit?: {
    attempted: boolean;
    applied: boolean;
    duplicate?: boolean;
    sourceEventId?: string;
    ledgerEntryId?: string;
    ledgerStatus?: "pending" | "applied" | "failed";
    newBalance?: number;
    error?: string;
  };
  idempotency?: {
    provided: boolean;
    keyAccepted: boolean;
    sourceEventId: string;
  };
  allowance?: {
    enabled: true;
    period: "monthly";
    periodKey: string;
    includedRuns: number;
    usedThisPeriod: number;
    remainingIncludedRuns: number;
    coveredByAllowance: boolean;
    billableUnitsAfterAllowance: number;
  };
  rollout?: {
    limitedRolloutEnabled: boolean;
    userAllowed: boolean;
    reason: "flag_off" | "allowlisted" | "not_allowlisted";
  };
};

export type SpecificRunComparison = {
  comparable: boolean;
  sourceRunId: string;
  newRunId: string;
  improved: Array<{ itemId: string; title: string; from: string; to: string; reason: string }>;
  stillOpen: Array<{ itemId: string; title: string; status: string; reason: string }>;
  newlyProblematic: Array<{ itemId: string; title: string; from: string; to: string; reason: string }>;
  unchanged: Array<{ itemId: string; title: string; status: string }>;
  summaryText: string;
};

export type PRReviewRerunMeta = {
  ofReviewRunId: string;
  reusedSelectedItemIds: string[];
};

export type StartReviewResponse =
  | {
      ok: true;
      run: ReviewRun;
      rerun?: PRReviewRerunMeta;
      comparisonToSourceRun?: SpecificRunComparison;
      creditEnforcement?: CreditEnforcementResult | CreditEnforcementDryRun;
      /** @deprecated use creditEnforcement */
      creditDryRun?: CreditEnforcementDryRun;
      warnings?: string[];
    }
  | { ok: false; error: string; creditEnforcement?: CreditEnforcementResult; message?: string };

export type GetReviewResponse =
  | { ok: true; run: ReviewRun | null }
  | { ok: false; error: string };

export type WorkspaceItem = { id: string; title: string; status?: string; criteria?: string[] };
export type ProductSpec = Record<string, unknown>;

export async function startPRReview(
  projectId: string,
  prNumber: number,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    items?: WorkspaceItem[];
    productSpec?: ProductSpec;
    idempotencyKey?: string;
    rerunOfReviewRunId?: string;
    locale?: "en" | "ko";
  },
): Promise<StartReviewResponse> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/review`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(180000), // council reviews can take minutes — 40s caused false failures
      },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as StartReviewResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getLatestPRReview(
  projectId: string,
  prNumber: number,
  userKey: string,
): Promise<GetReviewResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/review?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as GetReviewResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── PR Review Comparison ────────────────────────────────────────────────────

export type ReviewRunSummarySnapshot = {
  id: string;
  status: string;
  updatedAt: string;
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
};

export type ImprovedItem = { itemId: string; title: string; from: string; to: string; reason: string };
export type StillOpenItem = { itemId: string; title: string; status: string; reason: string };
export type NewlyProblematicItem = { itemId: string; title: string; from: string; to: string; reason: string };
export type UnchangedItem = { itemId: string; title: string; status: string };

export type ReviewComparison = {
  improved: ImprovedItem[];
  stillOpen: StillOpenItem[];
  newlyProblematic: NewlyProblematicItem[];
  unchanged: UnchangedItem[];
  summaryText: string;
};

export type PrReviewComparisonResponse =
  | { ok: true; comparable: false; reason: "not_enough_runs" }
  | {
      ok: true;
      comparable: true;
      previousRun: ReviewRunSummarySnapshot;
      latestRun: ReviewRunSummarySnapshot;
      comparison: ReviewComparison;
    }
  | { ok: false; error: string };

export async function getPRReviewComparison(
  projectId: string,
  prNumber: number,
  userKey: string,
): Promise<PrReviewComparisonResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/review/compare?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as PrReviewComparisonResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── PR Comment ───────────────────────────────────────────────────────────────

export type CommentSummary = {
  failed: number;
  inconclusive: number;
  needsDecision: number;
  passed: number;
};

export type PreviewCommentResponse =
  | {
      ok: true;
      comment: { body: string; selectedItemIds: string[]; summary: CommentSummary };
      warnings?: string[];
    }
  | { ok: false; error: string; message?: string };

export type PostedComment = {
  id: string;
  status: "posted";
  githubCommentId: string;
  githubCommentUrl: string;
  bodyPreview: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PostCommentResponse =
  | { ok: true; updated?: boolean; comment: PostedComment }
  | { ok: false; error: string; message?: string };

export type ListedComment = {
  id: string;
  status: string;
  githubCommentId?: string;
  githubCommentUrl?: string;
  bodyPreview: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt?: string;
};

export type LatestPostedCommentSummary = {
  id: string;
  githubCommentId?: string;
  githubCommentUrl?: string;
  bodyPreview: string;
  updatedAt: string;
};

export type ListCommentsResponse =
  | { ok: true; comments: ListedComment[]; latestPostedComment: LatestPostedCommentSummary | null }
  | { ok: false; error: string };

export type UpdateCommentResponse =
  | { ok: true; comment: PostedComment }
  | { ok: false; error: string; message?: string };

export async function previewPRComment(
  projectId: string,
  prNumber: number,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    includeFixBrief?: boolean;
    includeComparison?: boolean;
    includeRerunComparison?: boolean;
    reviewRunId?: string;
    locale?: "en" | "ko";
  },
): Promise<PreviewCommentResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/comment/preview`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as PreviewCommentResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function postPRComment(
  projectId: string,
  prNumber: number,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    body?: string;
    includeFixBrief?: boolean;
    includeComparison?: boolean;
    includeRerunComparison?: boolean;
    mode?: "new" | "update_latest";
    reviewRunId?: string;
    locale?: "en" | "ko";
  },
): Promise<PostCommentResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/comment`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as PostCommentResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function updatePRComment(
  projectId: string,
  prNumber: number,
  commentId: string,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    body?: string;
    includeFixBrief?: boolean;
    includeComparison?: boolean;
    locale?: "en" | "ko";
  },
): Promise<UpdateCommentResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/comment/${encodeURIComponent(commentId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(20000),
      },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as UpdateCommentResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listPRComments(
  projectId: string,
  prNumber: number,
  userKey: string,
): Promise<ListCommentsResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/comments?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as ListCommentsResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── PR Fix Brief ─────────────────────────────────────────────────────────────

export type FixBriefFile = {
  path: string;
  content: string;
};

export type FixBriefResult = {
  ok: true;
  source: "deterministic";
  projectId: string;
  repoFullName: string;
  prNumber: number;
  runId: string;
  selectedItemIds: string[];
  brief: {
    plainSummary: string;
    claudeCodePrompt?: string;
    codexPrompt?: string;
    files: FixBriefFile[];
  };
  warnings?: string[];
  sourceReviewRun?: {
    id: string;
    createdAt: string;
    status: string;
    summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  };
};

export type FixBriefResponse =
  | FixBriefResult
  | { ok: false; error: string };

export type FixBriefTarget = "claude_code" | "codex" | "both";

export async function generatePRFixBrief(
  projectId: string,
  prNumber: number,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    target?: FixBriefTarget;
    items?: WorkspaceItem[];
    productSpec?: ProductSpec;
    reviewRunId?: string;
  },
): Promise<FixBriefResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/fix-brief`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` })) as FixBriefResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── PR Review History ────────────────────────────────────────────────────────

export type ReviewRunHistoryItem = {
  id: string;
  status: "queued" | "running" | "passed" | "failed" | "inconclusive" | "error";
  repoFullName: string;
  prNumber: number;
  selectedItemIds?: string[];
  summary?: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  results?: ReviewResultItem[];
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type PRReviewRerunAction = {
  /** failed / inconclusive / needs_decision itemIds only — never full results. */
  recommendedItemIds: string[];
  recommendedItemCount: number;
  disabledReason?: "no_remaining_issues" | "results_unavailable";
};

export type ProjectReviewHistoryItem = Omit<ReviewRunHistoryItem, "selectedItemIds" | "results"> & {
  selectedItemCount: number;
  rerunAction?: PRReviewRerunAction;
};

export type PRReviewHistoryResponse =
  | { ok: true; runs: ReviewRunHistoryItem[] }
  | { ok: false; error: string };

export type ProjectReviewHistoryResponse =
  | { ok: true; runs: ProjectReviewHistoryItem[] }
  | { ok: false; error: string };

// ─── PR Review Run Detail ─────────────────────────────────────────────────────

export type PRReviewRunDetail = {
  id: string;
  status: "queued" | "running" | "passed" | "failed" | "inconclusive" | "error";
  createdAt: string;
  updatedAt: string;
  rerunOfReviewRunId?: string;
  selectedItemIds: string[];
  selectedItemCount: number;
  errorMessage?: string;
  summary: {
    passed: number;
    failed: number;
    inconclusive: number;
    needsDecision: number;
  };
  results: ReviewResultItem[];
};

export type PRReviewRunDetailResponse =
  | {
      ok: true;
      projectId: string;
      repoFullName: string;
      prNumber: number;
      run: PRReviewRunDetail;
    }
  | { ok: false; error: string };

export async function getReviewRunDetail(
  projectId: string,
  runId: string,
  userKey: string,
): Promise<PRReviewRunDetailResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/review/runs/${encodeURIComponent(runId)}?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as PRReviewRunDetailResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listPRReviewHistory(
  projectId: string,
  prNumber: number,
  userKey: string,
  opts: { limit?: number } = {},
): Promise<PRReviewHistoryResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    if (opts.limit) params.set("limit", String(opts.limit));
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/pulls/${prNumber}/review/history?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as PRReviewHistoryResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function listProjectReviewHistory(
  projectId: string,
  userKey: string,
  opts: { limit?: number } = {},
): Promise<ProjectReviewHistoryResponse> {
  try {
    const params = new URLSearchParams({ userKey });
    if (opts.limit) params.set("limit", String(opts.limit));
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/github/review-history?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as ProjectReviewHistoryResponse;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
