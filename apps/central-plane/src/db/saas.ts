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
    return { ...existing, githubLogin: input.githubLogin, email: input.email ?? null, lastActiveAt: now };
  }
  const id = newId("usr");
  await env.DB.prepare(
    `INSERT INTO saas_users (id, github_user_id, github_login, email, tier, byo_anthropic, data_share_opt_in, created_at, last_active_at)
     VALUES (?, ?, ?, ?, 'free', 0, 1, ?, ?)`,
  )
    .bind(id, input.githubUserId, input.githubLogin, input.email ?? null, now, now)
    .run();
  return {
    id,
    githubUserId: input.githubUserId,
    githubLogin: input.githubLogin,
    email: input.email ?? null,
    tier: "free",
    byoAnthropic: false,
    dataShareOptIn: true,
    trialUsed: false,
    paidCredits: 0,
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
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE jobs
        SET status = ?, verdict = ?, blockers = ?, cycles = ?, duration_ms = ?,
            smoke_outcome = ?, deploy_url = ?, error_message = ?, completed_at = ?
      WHERE id = ?`,
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
      now,
      input.jobId,
    )
    .run();
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
