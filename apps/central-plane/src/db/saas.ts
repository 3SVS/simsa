/**
 * v0.16 SaaS DB helpers — saas_users, saas_tokens, saas_device_codes,
 * gh_app_installations, usage_meters. Pure D1 query wrappers; signature
 * verification, token minting, and HTTP shape live in the routes.
 */
import type { Env } from "../env.js";
import { sha256Hex } from "../util.js";

export interface SaasUser {
  id: string;
  githubUserId: number;
  githubLogin: string;
  email: string | null;
  tier: "free" | "solo" | "pro";
  byoAnthropic: boolean;
  dataShareOptIn: boolean;
  trialUsed: boolean;
  paidCredits: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface SaasToken {
  id: string;
  userId: string;
  tokenHash: string;
  scope: string;
  issuedAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
}

export interface SaasDeviceCode {
  deviceCode: string;
  userCode: string;
  status: "pending" | "approved" | "denied" | "expired";
  approvedUserId: string | null;
  intervalSec: number;
  expiresAt: string;
  createdAt: string;
}

export interface GhAppInstallation {
  installationId: number;
  accountLogin: string;
  accountId: number;
  targetType: "User" | "Organization";
  repoSelection: "all" | "selected";
  selectedRepoIds: number[] | null;
  saasUserId: string | null;
  installedAt: string;
  suspendedAt: string | null;
  removedAt: string | null;
}

// --- saas_users -----------------------------------------------------------

export async function findUserByGithubId(
  env: Env,
  githubUserId: number,
): Promise<SaasUser | null> {
  const r = await env.DB.prepare(
    `SELECT id, github_user_id, github_login, email, tier,
            byo_anthropic, data_share_opt_in, trial_used, paid_credits,
            created_at, last_active_at
       FROM saas_users WHERE github_user_id = ?`,
  )
    .bind(githubUserId)
    .first();
  return r ? rowToUser(r) : null;
}

export async function findUserById(env: Env, id: string): Promise<SaasUser | null> {
  const r = await env.DB.prepare(
    `SELECT id, github_user_id, github_login, email, tier,
            byo_anthropic, data_share_opt_in, trial_used, paid_credits,
            created_at, last_active_at
       FROM saas_users WHERE id = ?`,
  )
    .bind(id)
    .first();
  return r ? rowToUser(r) : null;
}

export async function upsertUser(
  env: Env,
  input: { githubUserId: number; githubLogin: string; email?: string | null },
): Promise<SaasUser> {
  const now = new Date().toISOString();
  const existing = await findUserByGithubId(env, input.githubUserId);
  if (existing) {
    // Update GH login (renames happen) + last active.
    await env.DB.prepare(
      `UPDATE saas_users SET github_login = ?, email = ?, last_active_at = ? WHERE id = ?`,
    )
      .bind(input.githubLogin, input.email ?? null, now, existing.id)
      .run();
    // v0.14.5 — if email is now known and matches a pending billing
    // order, claim it. Catch is best-effort; never block sign-in.
    if (input.email) {
      try {
        await claimPendingBillingForUser(env, input.email, existing.id);
      } catch (e) {
        console.error("upsertUser: claim pending billing failed (existing):", e);
      }
    }
    return { ...existing, githubLogin: input.githubLogin, email: input.email ?? null, lastActiveAt: now };
  }
  const id = newId("usr");
  await env.DB.prepare(
    `INSERT INTO saas_users (id, github_user_id, github_login, email, tier, byo_anthropic, data_share_opt_in, created_at, last_active_at)
     VALUES (?, ?, ?, ?, 'free', 0, 1, ?, ?)`,
  )
    .bind(id, input.githubUserId, input.githubLogin, input.email ?? null, now, now)
    .run();
  let initialPaidCredits = 0;
  // v0.14.5 — if the new user's email matches a pending paid order,
  // claim it now so they see credits the first time they sign in.
  if (input.email) {
    try {
      const claim = await claimPendingBillingForUser(env, input.email, id);
      initialPaidCredits = claim.creditsGranted;
    } catch (e) {
      console.error("upsertUser: claim pending billing failed (new):", e);
    }
  }
  return {
    id,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    tier: "free",
    byoAnthropic: false,
    dataShareOptIn: true,
    trialUsed: false,
    paidCredits: initialPaidCredits,
    createdAt: now,
    lastActiveAt: now,
  };
}

// --- saas_tokens ---------------------------------------------------------

/**
 * Issue a new bearer token for `userId`. Returns the RAW token (must be
 * delivered exactly once to the CLI; we only store the sha256). Tokens
 * are 64 chars urlsafe-base64.
 */
export async function issueToken(
  env: Env,
  userId: string,
  scope: string = "cli",
): Promise<{ token: string; record: SaasToken }> {
  const raw = randomToken(48);
  const tokenHash = await sha256Hex(raw);
  const id = newId("tok");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO saas_tokens (id, user_id, token_hash, scope, issued_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, userId, tokenHash, scope, now, now)
    .run();
  return {
    token: raw,
    record: { id, userId, tokenHash, scope, issuedAt: now, lastUsedAt: now, revokedAt: null },
  };
}

/** Validate a raw bearer token; returns the linked user when valid + active. */
export async function findUserByToken(
  env: Env,
  rawToken: string,
): Promise<{ user: SaasUser; tokenId: string } | null> {
  const tokenHash = await sha256Hex(rawToken);
  const r = await env.DB.prepare(
    `SELECT t.id AS token_id, t.revoked_at, u.id, u.github_user_id, u.github_login,
            u.email, u.tier, u.byo_anthropic, u.data_share_opt_in,
            u.trial_used, u.paid_credits, u.created_at, u.last_active_at
       FROM saas_tokens t JOIN saas_users u ON u.id = t.user_id
      WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      token_id: string;
      revoked_at: string | null;
      id: string;
      github_user_id: number;
      github_login: string;
      email: string | null;
      tier: string;
      byo_anthropic: number;
      data_share_opt_in: number;
      trial_used: number;
      paid_credits: number;
      created_at: string;
      last_active_at: string;
    }>();
  if (!r) return null;
  if (r.revoked_at !== null) return null;
  // Touch last_used_at + last_active_at — best-effort, do not block.
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE saas_tokens SET last_used_at = ? WHERE id = ?`)
    .bind(now, r.token_id)
    .run()
    .catch(() => undefined);
  return {
    tokenId: r.token_id,
    user: {
      id: r.id,
      githubUserId: r.github_user_id,
      githubLogin: r.github_login,
      email: r.email,
      tier: (r.tier === "solo" || r.tier === "pro") ? r.tier : "free",
      byoAnthropic: r.byo_anthropic === 1,
      dataShareOptIn: r.data_share_opt_in === 1,
      trialUsed: (r.trial_used ?? 0) === 1,
      paidCredits: Number(r.paid_credits ?? 0),
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
    },
  };
}

// --- credit gate ---------------------------------------------------------

/**
 * Try to consume a review credit for `userId`. Returns the source
 * the credit was billed to so callers can include it in usage_meters
 * + tell the user.
 *
 * Order:
 *   1. byo_anthropic=1 → "byo" (no charge — they bring their own key)
 *   2. trial_used=0 → mark trial used, return "trial"
 *   3. paid_credits > 0 → decrement, return "paid"
 *   4. otherwise → null (caller should refuse with 402)
 *
 * Atomicity: D1 doesn't expose serializable transactions inside a
 * Worker, but each branch is a single UPDATE that decrements a column,
 * so concurrent requests for the same user race only on the count
 * rather than corrupting state. Worst case: two parallel reviews both
 * read paid_credits=1 and both succeed (i.e., we eat one review). Real
 * fix when usage scales: move to a dedicated balance ledger.
 */
export async function consumeReviewCredit(
  env: Env,
  userId: string,
): Promise<"byo" | "trial" | "paid" | null> {
  const u = await findUserById(env, userId);
  if (!u) return null;
  if (u.byoAnthropic) return "byo";
  if (!u.trialUsed) {
    await env.DB.prepare(`UPDATE saas_users SET trial_used = 1, last_active_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), userId)
      .run();
    return "trial";
  }
  if (u.paidCredits > 0) {
    const r = await env.DB.prepare(
      `UPDATE saas_users SET paid_credits = paid_credits - 1, last_active_at = ?
        WHERE id = ? AND paid_credits > 0`,
    )
      .bind(new Date().toISOString(), userId)
      .run();
    if (r.success && (r.meta?.changes ?? 0) > 0) return "paid";
    return null;
  }
  return null;
}

/** Look up a user by their GitHub login (case-insensitive). Used by the
 *  webhook auto-trigger to map `installation.account.login` → saas_users. */
export async function findUserByGithubLogin(
  env: Env,
  githubLogin: string,
): Promise<SaasUser | null> {
  const r = await env.DB.prepare(
    `SELECT id, github_user_id, github_login, email, tier,
            byo_anthropic, data_share_opt_in, trial_used, paid_credits,
            created_at, last_active_at
       FROM saas_users WHERE github_login = ? COLLATE NOCASE`,
  )
    .bind(githubLogin)
    .first();
  return r ? rowToUser(r) : null;
}

export async function revokeToken(env: Env, tokenId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE saas_tokens SET revoked_at = ? WHERE id = ?`)
    .bind(now, tokenId)
    .run();
}

// --- saas_device_codes ---------------------------------------------------

export async function createDeviceCode(env: Env): Promise<SaasDeviceCode> {
  const deviceCode = "dvc_" + randomToken(24);
  const userCode = randomUserCode();
  const intervalSec = 5;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO saas_device_codes (device_code, user_code, status, interval_sec, expires_at, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(deviceCode, userCode, intervalSec, expiresAt, createdAt)
    .run();
  return {
    deviceCode,
    userCode,
    status: "pending",
    approvedUserId: null,
    intervalSec,
    expiresAt,
    createdAt,
  };
}

export async function findDeviceCodeByUserCode(
  env: Env,
  userCode: string,
): Promise<SaasDeviceCode | null> {
  const r = await env.DB.prepare(
    `SELECT device_code, user_code, status, approved_user_id, interval_sec, expires_at, created_at
       FROM saas_device_codes WHERE user_code = ?`,
  )
    .bind(userCode)
    .first();
  return r ? rowToDeviceCode(r) : null;
}

export async function findDeviceCode(
  env: Env,
  deviceCode: string,
): Promise<SaasDeviceCode | null> {
  const r = await env.DB.prepare(
    `SELECT device_code, user_code, status, approved_user_id, interval_sec, expires_at, created_at
       FROM saas_device_codes WHERE device_code = ?`,
  )
    .bind(deviceCode)
    .first();
  return r ? rowToDeviceCode(r) : null;
}

export async function approveDeviceCode(
  env: Env,
  userCode: string,
  userId: string,
): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE saas_device_codes
        SET status = 'approved', approved_user_id = ?
      WHERE user_code = ? AND status = 'pending'`,
  )
    .bind(userId, userCode)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// --- gh_app_installations ------------------------------------------------

export async function upsertInstallation(
  env: Env,
  input: {
    installationId: number;
    accountLogin: string;
    accountId: number;
    targetType: "User" | "Organization";
    repoSelection: "all" | "selected";
    selectedRepoIds: number[] | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const selected = input.selectedRepoIds ? JSON.stringify(input.selectedRepoIds) : null;
  await env.DB.prepare(
    `INSERT INTO gh_app_installations
       (installation_id, account_login, account_id, target_type, repo_selection, selected_repo_ids, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (installation_id) DO UPDATE SET
       account_login = excluded.account_login,
       repo_selection = excluded.repo_selection,
       selected_repo_ids = excluded.selected_repo_ids,
       suspended_at = NULL,
       removed_at = NULL`,
  )
    .bind(
      input.installationId,
      input.accountLogin,
      input.accountId,
      input.targetType,
      input.repoSelection,
      selected,
      now,
    )
    .run();
}

/** Apply an `installation_repositories` webhook (repos added/removed on an
 *  existing installation) to gh_app_installations. GitHub sends only the
 *  delta plus the new repository_selection, so we merge with the stored
 *  list. `repository_selection === "all"` normalizes the list to NULL
 *  (= no filter). Returns false when the installation row is missing
 *  (install webhook missed) so the caller can rebuild from the payload.
 *
 *  2026-07-20 실측: 이 이벤트를 무시해 selected_repo_ids가 설치 시점에
 *  고정돼 있었다(추가된 repo가 D1에 안 보임). 게이팅에는 아직 안 쓰는
 *  컬럼이지만, stale 데이터는 다음 소비자가 생기는 순간 버그가 된다. */
export async function applyInstallationRepoChange(
  env: Env,
  input: {
    installationId: number;
    repoSelection: "all" | "selected";
    addedRepoIds: number[];
    removedRepoIds: number[];
  },
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT selected_repo_ids FROM gh_app_installations
      WHERE installation_id = ? AND removed_at IS NULL`,
  )
    .bind(input.installationId)
    .first<{ selected_repo_ids: string | null }>();
  if (!row) return false;

  let selected: string | null;
  if (input.repoSelection === "all") {
    selected = null;
  } else {
    let current: number[] = [];
    if (row.selected_repo_ids) {
      try {
        const parsed: unknown = JSON.parse(row.selected_repo_ids);
        if (Array.isArray(parsed)) {
          current = parsed.filter((n): n is number => typeof n === "number");
        }
      } catch {
        // corrupt stored list → rebuild from this delta alone
      }
    }
    const removed = new Set(input.removedRepoIds);
    const merged = new Set(current.filter((id) => !removed.has(id)));
    for (const id of input.addedRepoIds) merged.add(id);
    selected = JSON.stringify([...merged]);
  }

  await env.DB.prepare(
    `UPDATE gh_app_installations SET repo_selection = ?, selected_repo_ids = ? WHERE installation_id = ?`,
  )
    .bind(input.repoSelection, selected, input.installationId)
    .run();
  return true;
}

export async function suspendInstallation(env: Env, installationId: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE gh_app_installations SET suspended_at = ? WHERE installation_id = ?`)
    .bind(now, installationId)
    .run();
}

export async function unsuspendInstallation(env: Env, installationId: number): Promise<void> {
  await env.DB.prepare(`UPDATE gh_app_installations SET suspended_at = NULL WHERE installation_id = ?`)
    .bind(installationId)
    .run();
}

export async function removeInstallation(env: Env, installationId: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE gh_app_installations SET removed_at = ? WHERE installation_id = ?`)
    .bind(now, installationId)
    .run();
}

/** Look up an installation by its installation_id. Used by the
 *  pull_request webhook to find the linked saas_user before spawning
 *  the auto-review job. */
export async function findInstallationById(
  env: Env,
  installationId: number,
): Promise<GhAppInstallation | null> {
  const r = await env.DB.prepare(
    `SELECT installation_id, account_login, account_id, target_type,
            repo_selection, selected_repo_ids, saas_user_id,
            installed_at, suspended_at, removed_at
       FROM gh_app_installations
      WHERE installation_id = ? AND removed_at IS NULL`,
  )
    .bind(installationId)
    .first();
  return r ? rowToInstallation(r) : null;
}

/** Link an installation row to a saas_users row. Called after
 *  upsertUser during the `installation: created` webhook so PR-event
 *  triggers (which only have installation_id) can find the user. */
export async function linkInstallationUser(
  env: Env,
  installationId: number,
  saasUserId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE gh_app_installations SET saas_user_id = ? WHERE installation_id = ?`,
  )
    .bind(saasUserId, installationId)
    .run();
}

export async function findInstallationByAccountLogin(
  env: Env,
  accountLogin: string,
): Promise<GhAppInstallation | null> {
  const r = await env.DB.prepare(
    `SELECT installation_id, account_login, account_id, target_type,
            repo_selection, selected_repo_ids, saas_user_id,
            installed_at, suspended_at, removed_at
       FROM gh_app_installations
      WHERE account_login = ? AND removed_at IS NULL
      ORDER BY installed_at DESC LIMIT 1`,
  )
    .bind(accountLogin)
    .first();
  return r ? rowToInstallation(r) : null;
}

export async function findInstallationByRepoSlug(
  env: Env,
  repoSlug: string,
): Promise<GhAppInstallation | null> {
  const owner = repoSlug.split("/")[0];
  if (!owner) return null;
  return findInstallationByAccountLogin(env, owner);
}

// --- usage_meters -------------------------------------------------------

export async function recordMeter(
  env: Env,
  input: {
    userId: string;
    meterName: string;
    quantity?: number;
    costUsd?: number;
    episodicId?: string;
    repoSlug?: string;
  },
): Promise<void> {
  const id = newId("um");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO usage_meters (id, user_id, meter_name, quantity, cost_usd, occurred_at, episodic_id, repo_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.userId,
      input.meterName,
      input.quantity ?? 1,
      input.costUsd ?? null,
      now,
      input.episodicId ?? null,
      input.repoSlug ?? null,
    )
    .run();
}

// --- jobs ---------------------------------------------------------------

export interface SaasJob {
  id: string;
  userId: string;
  repoSlug: string;
  prNumber: number;
  kind: "review" | "autofix";
  status: "accepted" | "running" | "done" | "failed" | "timeout";
  verdict: string | null;
  blockers: number | null;
  cycles: number | null;
  durationMs: number | null;
  smokeOutcome: string | null;
  deployUrl: string | null;
  errorMessage: string | null;
  prdPresent: boolean;
  createdAt: string;
  completedAt: string | null;
}

export async function createJob(
  env: Env,
  input: {
    jobId: string;
    userId: string;
    repoSlug: string;
    prNumber: number;
    kind: "review" | "autofix";
    prdPresent: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO jobs (id, user_id, repo_slug, pr_number, kind, status, prd_present, created_at)
     VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)`,
  )
    .bind(
      input.jobId,
      input.userId,
      input.repoSlug,
      input.prNumber,
      input.kind,
      input.prdPresent ? 1 : 0,
      now,
    )
    .run();
}

export async function findJob(env: Env, jobId: string): Promise<SaasJob | null> {
  const r = await env.DB.prepare(
    `SELECT id, user_id, repo_slug, pr_number, kind, status, verdict, blockers, cycles,
            duration_ms, smoke_outcome, deploy_url, error_message, prd_present,
            created_at, completed_at
       FROM jobs WHERE id = ?`,
  )
    .bind(jobId)
    .first();
  return r ? rowToJob(r) : null;
}

export async function completeJob(
  env: Env,
  input: {
    jobId: string;
    status: "done" | "failed" | "timeout";
    verdict?: string;
    blockers?: number;
    cycles?: number;
    durationMs?: number;
    smokeOutcome?: string;
    deployUrl?: string;
    errorMessage?: string;
    headSha?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE jobs
        SET status = ?, verdict = ?, blockers = ?, cycles = ?, duration_ms = ?,
            smoke_outcome = ?, deploy_url = ?, error_message = ?,
            head_sha = COALESCE(?, head_sha), completed_at = ?
      WHERE id = ? AND status NOT IN ('done', 'failed', 'timeout')`,
  )
    .bind(
      input.status,
      input.verdict ?? null,
      input.blockers ?? null,
      input.cycles ?? null,
      input.durationMs ?? null,
      input.smokeOutcome ?? null,
      input.deployUrl ?? null,
      input.errorMessage ?? null,
      input.headSha ?? null,
      now,
      input.jobId,
    )
    .run();
}

/**
 * Find the most recent review/autofix job for a repo + head SHA.
 * Used by Sprint 2's check_run webhook handler when Vercel/Netlify/CF
 * post a deploy result late — we need to map back to the council
 * verdict for that exact commit so we can amend the PR comment +
 * check-run conclusion.
 */
export async function findJobByHeadSha(
  env: Env,
  repoSlug: string,
  headSha: string,
): Promise<SaasJob | null> {
  const r = await env.DB.prepare(
    `SELECT id, user_id, repo_slug, pr_number, kind, status, verdict,
            blockers, cycles, duration_ms, smoke_outcome, deploy_url,
            error_message, prd_present, created_at, completed_at, head_sha
       FROM jobs
      WHERE repo_slug = ? AND head_sha = ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(repoSlug, headSha)
    .first();
  return r ? rowToJob(r) : null;
}

function rowToJob(r: any): SaasJob {
  return {
    id: r.id,
    userId: r.user_id,
    repoSlug: r.repo_slug,
    prNumber: r.pr_number,
    kind: r.kind === "autofix" ? "autofix" : "review",
    status: ["accepted", "running", "done", "failed", "timeout"].includes(r.status) ? r.status : "accepted",
    verdict: r.verdict,
    blockers: r.blockers,
    cycles: r.cycles,
    durationMs: r.duration_ms,
    smokeOutcome: r.smoke_outcome,
    deployUrl: r.deploy_url,
    errorMessage: r.error_message,
    prdPresent: r.prd_present === 1,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

// --- helpers ------------------------------------------------------------

function rowToUser(r: any): SaasUser {
  return {
    id: r.id,
    githubUserId: r.github_user_id,
    githubLogin: r.github_login,
    email: r.email,
    tier: (r.tier === "solo" || r.tier === "pro") ? r.tier : "free",
    byoAnthropic: r.byo_anthropic === 1,
    dataShareOptIn: r.data_share_opt_in === 1,
    trialUsed: (r.trial_used ?? 0) === 1,
    paidCredits: Number(r.paid_credits ?? 0),
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
  };
}

function rowToDeviceCode(r: any): SaasDeviceCode {
  const status = r.status;
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    status: (status === "approved" || status === "denied" || status === "expired")
      ? status
      : "pending",
    approvedUserId: r.approved_user_id,
    intervalSec: r.interval_sec,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

function rowToInstallation(r: any): GhAppInstallation {
  let selectedRepoIds: number[] | null = null;
  if (r.selected_repo_ids) {
    try { selectedRepoIds = JSON.parse(r.selected_repo_ids); } catch { selectedRepoIds = null; }
  }
  return {
    installationId: r.installation_id,
    accountLogin: r.account_login,
    accountId: r.account_id,
    targetType: r.target_type === "Organization" ? "Organization" : "User",
    repoSelection: r.repo_selection === "selected" ? "selected" : "all",
    selectedRepoIds,
    saasUserId: r.saas_user_id,
    installedAt: r.installed_at,
    suspendedAt: r.suspended_at,
    removedAt: r.removed_at,
  };
}

const NEW_ID_RAND_BYTES = 12;

function newId(prefix: string): string {
  const time = Math.floor(Date.now()).toString(36);
  const rand = randomToken(NEW_ID_RAND_BYTES);
  return `${prefix}_${time}_${rand}`;
}

function randomToken(numBytes: number): string {
  const buf = new Uint8Array(numBytes);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

function base64UrlEncode(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate user-friendly device code: 8 chars, dashed at 4. */
function randomUserCode(): string {
  // Avoid ambiguous chars (0, O, I, 1).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < 8; i += 1) {
    s += alphabet[buf[i]! % alphabet.length];
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// --- billing_orders (v0.14.5 / migration 0023) --------------------------

export interface BillingOrderInput {
  id: string;
  userId: string | null;
  provider: "lemonsqueezy" | "stripe" | "toss";
  providerOrderId: string;
  productVariantId: string | null;
  productLabel: string;
  amountCents: number;
  currency: string;
  status: "paid" | "paid_unlinked" | "refunded" | "pending";
  creditsGranted: number;
  customerEmail: string | null;
  pendingEmail: string | null;
  createdAt: string;
  paidAt: string | null;
  rawPayload: string | null;
}

export async function findUserByEmail(env: Env, email: string): Promise<SaasUser | null> {
  if (!email) return null;
  const r = await env.DB.prepare(
    `SELECT id, github_user_id, github_login, email, tier,
            byo_anthropic, data_share_opt_in, trial_used, paid_credits,
            created_at, last_active_at
       FROM saas_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
  )
    .bind(email)
    .first();
  return r ? rowToUser(r) : null;
}

export async function grantPaidCredits(env: Env, userId: string, n: number): Promise<void> {
  if (n <= 0) return;
  await env.DB.prepare(
    `UPDATE saas_users SET paid_credits = paid_credits + ?, last_active_at = ? WHERE id = ?`,
  )
    .bind(n, new Date().toISOString(), userId)
    .run();
}

export async function findBillingOrderByProvider(
  env: Env,
  provider: string,
  providerOrderId: string,
): Promise<{ id: string; status: string; user_id: string | null } | null> {
  const r = await env.DB.prepare(
    `SELECT id, status, user_id FROM billing_orders
      WHERE provider = ? AND provider_order_id = ? LIMIT 1`,
  )
    .bind(provider, providerOrderId)
    .first<{ id: string; status: string; user_id: string | null }>();
  return r ?? null;
}

export async function createBillingOrderPaid(
  env: Env,
  input: BillingOrderInput,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO billing_orders
       (id, user_id, provider, provider_order_id, product_variant_id, product_label,
        amount_cents, currency, status, credits_granted, pending_email,
        customer_email, created_at, paid_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.userId,
      input.provider,
      input.providerOrderId,
      input.productVariantId,
      input.productLabel,
      input.amountCents,
      input.currency,
      input.status,
      input.creditsGranted,
      input.pendingEmail,
      input.customerEmail,
      input.createdAt,
      input.paidAt,
      input.rawPayload,
    )
    .run();
}

/**
 * Claim pending billing_orders for an email that just signed up. Called
 * from upsertUser. Returns counts so the caller can log/audit.
 *
 * Behavior:
 *   - Selects billing_orders WHERE pending_email = ? AND status =
 *     'paid_unlinked' AND user_id IS NULL.
 *   - For each: UPDATE user_id, set linked_at, flip status to 'paid'.
 *   - Sums credits_granted and increments saas_users.paid_credits.
 *   - Pure-additive; failures don't roll back saas_user creation.
 */
export async function claimPendingBillingForUser(
  env: Env,
  email: string,
  userId: string,
): Promise<{ claimed: number; creditsGranted: number }> {
  if (!email) return { claimed: 0, creditsGranted: 0 };
  const pending = await env.DB.prepare(
    `SELECT id, credits_granted FROM billing_orders
      WHERE LOWER(pending_email) = LOWER(?) AND status = 'paid_unlinked' AND user_id IS NULL`,
  )
    .bind(email)
    .all<{ id: string; credits_granted: number }>();
  const rows = pending.results ?? [];
  if (rows.length === 0) return { claimed: 0, creditsGranted: 0 };

  let totalCredits = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    await env.DB.prepare(
      `UPDATE billing_orders SET user_id = ?, status = 'paid', linked_at = ?
        WHERE id = ?`,
    )
      .bind(userId, now, row.id)
      .run();
    totalCredits += Number(row.credits_granted ?? 0);
  }
  if (totalCredits > 0) {
    await grantPaidCredits(env, userId, totalCredits);
  }
  return { claimed: rows.length, creditsGranted: totalCredits };
}

// ─────────────────────────────────────────────────────────────────────────
// GitHub Marketplace subscription tracking (migration 0025)
// ─────────────────────────────────────────────────────────────────────────

export interface MarketplaceSubscriptionInput {
  githubAccountId: number;
  githubAccountLogin: string;
  githubAccountType: "User" | "Organization";
  planId: number;
  planName: string;
  planMonthlyPriceCents?: number;
  unitCount: number;
  billingCycle?: string | null;
  onFreeTrial: boolean;
  freeTrialEndsOn?: string | null;
  nextBillingDate?: string | null;
  status: "active" | "pending_cancellation" | "cancelled";
  pendingChangePlanId?: number | null;
  effectiveDate: string;
}

/**
 * Upsert the latest known marketplace subscription state for a GH
 * account. Matches `saas_users` by github_user_id when the GH account
 * is a User; Org subscriptions are left unlinked until an admin
 * manually associates them.
 *
 * Returns whether the row was newly inserted vs updated, so the
 * webhook handler can decide whether to fire a "first install" alert.
 */
export async function upsertMarketplaceSubscription(
  env: Env,
  input: MarketplaceSubscriptionInput,
): Promise<{ id: string; isNew: boolean }> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT id FROM gh_marketplace_subscriptions WHERE github_account_id = ? LIMIT 1`,
  )
    .bind(input.githubAccountId)
    .first<{ id: string }>();

  // Match saas_users when subscription is owned by a User.
  let saasUserId: string | null = null;
  if (input.githubAccountType === "User") {
    const user = await env.DB.prepare(
      `SELECT id FROM saas_users WHERE github_user_id = ? LIMIT 1`,
    )
      .bind(input.githubAccountId)
      .first<{ id: string }>();
    saasUserId = user?.id ?? null;
  }

  const id = existing?.id ?? `mp_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO gh_marketplace_subscriptions (
      id, github_account_id, github_account_login, github_account_type,
      saas_user_id, plan_id, plan_name, plan_monthly_price_cents,
      unit_count, billing_cycle, on_free_trial, free_trial_ends_on,
      next_billing_date, status, pending_change_plan_id,
      effective_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(github_account_id) DO UPDATE SET
      github_account_login = excluded.github_account_login,
      github_account_type  = excluded.github_account_type,
      saas_user_id         = COALESCE(excluded.saas_user_id, gh_marketplace_subscriptions.saas_user_id),
      plan_id              = excluded.plan_id,
      plan_name            = excluded.plan_name,
      plan_monthly_price_cents = excluded.plan_monthly_price_cents,
      unit_count           = excluded.unit_count,
      billing_cycle        = excluded.billing_cycle,
      on_free_trial        = excluded.on_free_trial,
      free_trial_ends_on   = excluded.free_trial_ends_on,
      next_billing_date    = excluded.next_billing_date,
      status               = excluded.status,
      pending_change_plan_id = excluded.pending_change_plan_id,
      effective_date       = excluded.effective_date,
      updated_at           = excluded.updated_at`,
  )
    .bind(
      id,
      input.githubAccountId,
      input.githubAccountLogin,
      input.githubAccountType,
      saasUserId,
      input.planId,
      input.planName,
      input.planMonthlyPriceCents ?? 0,
      input.unitCount,
      input.billingCycle ?? null,
      input.onFreeTrial ? 1 : 0,
      input.freeTrialEndsOn ?? null,
      input.nextBillingDate ?? null,
      input.status,
      input.pendingChangePlanId ?? null,
      input.effectiveDate,
      now,
      now,
    )
    .run();
  return { id, isNew: !existing };
}

/**
 * Mark a subscription cancelled (`cancelled` action). Idempotent.
 */
export async function cancelMarketplaceSubscription(
  env: Env,
  githubAccountId: number,
  effectiveDate: string,
): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `UPDATE gh_marketplace_subscriptions
        SET status = 'cancelled',
            effective_date = ?,
            updated_at = ?
      WHERE github_account_id = ?`,
  )
    .bind(effectiveDate, now, githubAccountId)
    .run();
  return { ok: (r.meta?.changes ?? 0) > 0 };
}

/**
 * Record a pending plan change (`pending_change` action). The actual
 * status flip lands on the effective_date — a cron or a follow-up
 * `changed` event reconciles. Idempotent.
 */
export async function notePendingMarketplaceChange(
  env: Env,
  githubAccountId: number,
  pendingPlanId: number,
  effectiveDate: string,
): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `UPDATE gh_marketplace_subscriptions
        SET pending_change_plan_id = ?,
            status = 'pending_cancellation',
            effective_date = ?,
            updated_at = ?
      WHERE github_account_id = ?`,
  )
    .bind(pendingPlanId, effectiveDate, now, githubAccountId)
    .run();
  return { ok: (r.meta?.changes ?? 0) > 0 };
}

/**
 * Clear a pending change that the user reverted before its effective
 * date (`pending_change_cancelled` action). Idempotent.
 */
export async function clearPendingMarketplaceChange(
  env: Env,
  githubAccountId: number,
): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `UPDATE gh_marketplace_subscriptions
        SET pending_change_plan_id = NULL,
            status = 'active',
            updated_at = ?
      WHERE github_account_id = ?`,
  )
    .bind(now, githubAccountId)
    .run();
  return { ok: (r.meta?.changes ?? 0) > 0 };
}

