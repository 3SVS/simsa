/**
 * token-encrypt-sweep.ts — finishes what migration 0004 started.
 *
 * 0004 introduced encrypted-at-rest GitHub tokens with a LAZY upgrade path
 * (plaintext rows get encrypted on their next Telegram dispatch). "Phase 2:
 * drop the plaintext column" never ran because rows that are never touched
 * again would keep plaintext forever. This sweep proactively upgrades the
 * stragglers in small daily batches, using the SAME idempotent helper the
 * lazy path uses, so the plaintext column drains to all-NULL and a future
 * migration can drop it safely.
 *
 * Fail-safe: without CONCLAVE_TOKEN_KEK the sweep is a no-op (never
 * destroys the only copy of a token). Per-row failures are counted, not
 * thrown — the cron logs the tally and tries again tomorrow.
 */
import type { Env } from "../env.js";
import { upgradeInstallTokenEncryption } from "./telegram.js";

const BATCH_SIZE = 50;

export interface TokenSweepResult {
  scanned: number;
  upgraded: number;
  failed: number;
  skipped: "no_kek" | "no_db" | null;
}

export async function sweepPlaintextGithubTokens(env: Env): Promise<TokenSweepResult> {
  if (!env.CONCLAVE_TOKEN_KEK) return { scanned: 0, upgraded: 0, failed: 0, skipped: "no_kek" };
  if (!env.DB) return { scanned: 0, upgraded: 0, failed: 0, skipped: "no_db" };

  const rows = await env.DB.prepare(
    "SELECT id, github_access_token FROM installs WHERE github_access_token IS NOT NULL LIMIT ?",
  )
    .bind(BATCH_SIZE)
    .all<{ id: string; github_access_token: string }>();

  const results = rows?.results ?? [];
  let upgraded = 0;
  let failed = 0;
  for (const row of results) {
    try {
      await upgradeInstallTokenEncryption(env, row.id, row.github_access_token);
      upgraded += 1;
    } catch (err) {
      failed += 1;
      console.error(
        "[token-encrypt-sweep] upgrade failed for install",
        row.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { scanned: results.length, upgraded, failed, skipped: null };
}
