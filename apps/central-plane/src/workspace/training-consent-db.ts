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
 *
 * Train K · K-2 (가격·동의 계획 §4, 0071):
 *   - 거절도 **결정**으로 저장한다 — consent_version = 지금 조항 버전 + consented 0 + decided_at.
 *     예전에는 거절이 consent_version을 NULL로 지워 "아직 안 정함"과 구분되지 않았고, 그래서 거절한
 *     사람이 다시 초대됐다.
 *   - 거절(철회 포함)은 같은 D1 배치에서 그 사람의 학습 사본 삭제를 **요청**한다(training-records-index.ts):
 *     0071 이전 검수 사본을 색인으로 옮기고(요청 표시와 함께), 색인된 사본 전부에 요청을 찍는다.
 *     실제 R2 삭제는 라우트가 응답 뒤(waitUntil)에, 실패분은 6시간 크론이 한다.
 */
import type { Env } from "../env.js";
import {
  TRAINING_INDEX_BACKFILL_LEGACY_FOR_USER_SQL,
  TRAINING_INDEX_REQUEST_DELETE_FOR_USER_SQL,
} from "./training-records-index.js";

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
  /** 0071: 허용·거절을 고른 시각. null = 0071 이전 행(언제 정했는지 모른다). */
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * 대시보드가 쓰는 세 상태.
 *   consented  — 지금 조항에 동의(캡처 게이트가 열린 상태와 같다)
 *   declined   — 거절했다. **버전과 무관**: 옛 코드의 거절(버전 NULL)도 거절이다 — 거절한 사람을 다시 묻지 않는다
 *   undecided  — 행이 없거나, 옛 조항에만 동의했다(새 조항에는 아직 답하지 않았다 → 한 번 다시 묻는다)
 */
export type TrainingConsentState = "consented" | "declined" | "undecided";

export function trainingConsentState(
  c: Pick<TrainingConsent, "consented" | "consentVersion"> | null,
): TrainingConsentState {
  if (!c) return "undecided";
  if (!c.consented) return "declined";
  return c.consentVersion === TRAINING_CONSENT_VERSION ? "consented" : "undecided";
}

type DbRow = {
  user_key: string;
  consented: number;
  consent_version: string | null;
  decided_at?: string | null;
  created_at: string;
  updated_at: string;
};

function rowToConsent(row: DbRow): TrainingConsent {
  return {
    userKey: row.user_key,
    consented: row.consented === 1,
    consentVersion: row.consent_version,
    decidedAt: typeof row.decided_at === "string" && row.decided_at ? row.decided_at : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTrainingConsent(
  env: Pick<Env, "DB">,
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
 * Binds: (user_key, consented, consent_version, decided_at, created_at, updated_at).
 * 허용·거절 모두 지금 조항 버전과 결정 시각을 찍는다. created_at은 처음 한 번만.
 */
export const TRAINING_CONSENT_UPSERT_SQL = `INSERT INTO workspace_training_consent
   (user_key, consented, consent_version, decided_at, created_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?)
 ON CONFLICT(user_key) DO UPDATE SET
   consented = excluded.consented,
   consent_version = excluded.consent_version,
   decided_at = excluded.decided_at,
   updated_at = excluded.updated_at`;

export type SetTrainingConsentResult = TrainingConsent & {
  /** 이 호출 직전에 동의 상태였는가(consented = 1, 조항 버전 무관) — 철회 판정. */
  wasConsented: boolean;
  /** 이번 거절로 삭제 요청이 새로 찍힌 사본 행 수(0071 이전 검수 사본 옮김 + 색인 행). 허용이면 0. */
  deletionRequested: number;
};

/**
 * 허용·거절 저장. 둘 다 지금 조항 버전 + decided_at을 찍는다(거절이 NULL로 지워지던 결함 ①).
 * 거절이면 같은 배치에서 그 사람의 학습 사본 삭제를 요청한다 — 동의 행과 요청이 함께 커밋되거나 함께 실패한다.
 */
export async function setTrainingConsent(
  env: Pick<Env, "DB">,
  userKey: string,
  consented: boolean,
  opts: { now?: string } = {},
): Promise<SetTrainingConsentResult> {
  const now = opts.now ?? new Date().toISOString();
  const existing = await getTrainingConsent(env, userKey);
  const createdAt = existing?.createdAt ?? now;
  const upsert = env.DB.prepare(TRAINING_CONSENT_UPSERT_SQL).bind(
    userKey,
    consented ? 1 : 0,
    TRAINING_CONSENT_VERSION,
    now,
    createdAt,
    now,
  );

  let deletionRequested = 0;
  if (consented) {
    await upsert.run();
  } else {
    const results = await env.DB.batch([
      upsert,
      env.DB.prepare(TRAINING_INDEX_BACKFILL_LEGACY_FOR_USER_SQL).bind(now, userKey),
      env.DB.prepare(TRAINING_INDEX_REQUEST_DELETE_FOR_USER_SQL).bind(now, userKey),
    ]);
    for (const r of results.slice(1)) {
      const n = (r as { meta?: { changes?: unknown } } | undefined)?.meta?.changes;
      if (typeof n === "number") deletionRequested += n;
    }
  }

  return {
    userKey,
    consented,
    consentVersion: TRAINING_CONSENT_VERSION,
    decidedAt: now,
    createdAt,
    updatedAt: now,
    wasConsented: existing?.consented ?? false,
    deletionRequested,
  };
}

/**
 * The capture gate. True only when the user has opted in AND against the current
 * clause version. Any DB error resolves to false (fail-closed).
 */
export async function hasActiveTrainingConsent(
  env: Pick<Env, "DB">,
  userKey: string,
): Promise<boolean> {
  try {
    const c = await getTrainingConsent(env, userKey);
    return !!c && c.consented && c.consentVersion === TRAINING_CONSENT_VERSION;
  } catch {
    return false;
  }
}
