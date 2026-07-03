/**
 * training-consent-db.ts
 *
 * Per-userKey opt-in to retaining raw review triplets (diff + council verdict +
 * outcome) in the durable training store. Default is OFF in every dimension:
 * no row → not consented; consented=0 → not consented; consent recorded against
 * an OLDER clause version → not "active" (re-consent required).
 *
 * `hasActiveTrainingConsent` is the single gate the training-store capture path
 * calls. Version-gating means changing TRAINING_CONSENT_VERSION silently pauses
 * all capture until each user re-agrees — legally the safe default.
 */
import type { Env } from "../env.js";

/**
 * Current training-clause version. Bump when the ToS training language changes.
 * Format is a plain date string so it reads in the DB and in logs. A user's
 * consent only counts while their stored consent_version === this value.
 */
export const TRAINING_CONSENT_VERSION = "2026-07-03";

export type TrainingConsent = {
  userKey: string;
  consented: boolean;
  consentVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  user_key: string;
  consented: number;
  consent_version: string | null;
  created_at: string;
  updated_at: string;
};

function rowToConsent(row: DbRow): TrainingConsent {
  return {
    userKey: row.user_key,
    consented: row.consented === 1,
    consentVersion: row.consent_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTrainingConsent(
  env: Env,
  userKey: string,
): Promise<TrainingConsent | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM workspace_training_consent WHERE user_key = ? LIMIT 1`,
  )
    .bind(userKey)
    .first<DbRow>();
  return row ? rowToConsent(row) : null;
}

/**
 * Upsert consent. On opt-in the current TRAINING_CONSENT_VERSION is stamped;
 * on opt-out the version is cleared so a later opt-in re-stamps the then-current
 * version (never silently reuses a stale agreement).
 */
export async function setTrainingConsent(
  env: Env,
  userKey: string,
  consented: boolean,
): Promise<TrainingConsent> {
  const now = new Date().toISOString();
  const version = consented ? TRAINING_CONSENT_VERSION : null;
  const existing = await getTrainingConsent(env, userKey);

  if (existing) {
    await env.DB.prepare(
      `UPDATE workspace_training_consent
         SET consented = ?, consent_version = ?, updated_at = ?
       WHERE user_key = ?`,
    )
      .bind(consented ? 1 : 0, version, now, userKey)
      .run();
    return {
      userKey,
      consented,
      consentVersion: version,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  await env.DB.prepare(
    `INSERT INTO workspace_training_consent
       (user_key, consented, consent_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(userKey, consented ? 1 : 0, version, now, now)
    .run();
  return { userKey, consented, consentVersion: version, createdAt: now, updatedAt: now };
}

/**
 * The capture gate. True only when the user has opted in AND against the current
 * clause version. Any DB error resolves to false (fail-closed).
 */
export async function hasActiveTrainingConsent(
  env: Env,
  userKey: string,
): Promise<boolean> {
  try {
    const c = await getTrainingConsent(env, userKey);
    return !!c && c.consented && c.consentVersion === TRAINING_CONSENT_VERSION;
  } catch {
    return false;
  }
}
