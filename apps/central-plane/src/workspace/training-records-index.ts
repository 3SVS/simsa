/**
 * workspace/training-records-index.ts — Train K · K-3 학습 사본 색인·삭제 (가격·동의 계획 §4 "철회·삭제", 0071).
 *
 * 왜: 학습 사본(R2 `events/{region}/…` = training-store, `journey/…` = journey-store)은 키에 사람이 없다
 * (사본 안에도 sha256(userKey)뿐). 그래서 동의를 철회하거나 프로젝트를 지워도 어느 객체가 그 사람 것인지 찾을
 * 방법이 없었다. 이 색인은 **캡처할 때** R2 키를 사람(원문 user_key — 동의 행과 같은 방식)·프로젝트와 함께 적는다.
 *
 * 순서 원칙 (지울 수 없는 사본을 만들지 않는다):
 *   캡처  = 색인 먼저(동의가 지금 유효할 때만 — 한 문장으로) → R2 put → 색인 재확인(그 사이 삭제가 요청됐으면 바로 지움)
 *           색인이 실패하면 그 사본은 저장하지 않는다(요청 자체는 영향 없음 — 캡처는 원래 best-effort).
 *   삭제  = D1에 요청 먼저(delete_requested_at, 철회·프로젝트 삭제와 같은 배치) → R2 delete → 성공한 것만 deleted_at
 *           R2가 실패하면 요청이 남아 있으므로 6시간 크론이 다시 시도한다.
 *
 * ★한계(정직하게): 이 색인이 생기기 전(0071 이전)에 저장된 사본은 색인에 없다 → 여기로는 지울 수 없다.
 *   개수는 scripts/count-unindexed-training-copies.mjs(R2 list)로 셀 수 있다. 문의가 오면 사람이 처리한다.
 *
 * 모든 함수는 던지지 않는다(삭제 스윕) 또는 호출자가 잡는다(색인 쓰기). 로그는 한 줄 JSON.
 */
import type { Env } from "../env.js";
import { sha256Hex } from "../util.js";

export type TrainingRecordKind = "training" | "journey";

/** 같은 R2 키 = 같은 행(멱등). */
export async function trainingIndexId(r2Key: string): Promise<string> {
  return `tri_${(await sha256Hex(r2Key)).slice(0, 32)}`;
}

/**
 * 동의가 **지금** 유효할 때만 색인 행을 쓴다(한 문장 — 동의 확인과 색인 사이에 철회가 끼면 행이 생기지 않는다).
 * 같은 키를 다시 쓰면(outcome 갱신이 아니라 재캡처) 새 사본이므로 삭제 표시를 지운다 — 옛 내용은 덮어써져 없다.
 * Binds: (id, user_key, project_id, r2_key, kind, captured_at, consent_user_key, consent_version).
 */
export const TRAINING_INDEX_INSERT_SQL = `INSERT INTO training_records_index
   (id, user_key, project_id, r2_key, kind, captured_at, delete_requested_at, deleted_at)
 SELECT ?, ?, ?, ?, ?, ?, NULL, NULL
  WHERE EXISTS (
    SELECT 1 FROM workspace_training_consent
     WHERE user_key = ? AND consented = 1 AND consent_version = ?)
 ON CONFLICT(id) DO UPDATE SET
   user_key = excluded.user_key,
   project_id = excluded.project_id,
   kind = excluded.kind,
   captured_at = excluded.captured_at,
   delete_requested_at = NULL,
   deleted_at = NULL`;

/** Binds: (id). put 뒤 재확인 — 그 사이 철회·프로젝트 삭제로 요청이 찍혔는가. */
export const TRAINING_INDEX_STATE_SQL = `SELECT delete_requested_at, deleted_at FROM training_records_index WHERE id = ? LIMIT 1`;

/** 철회: 이 사람의 아직 안 지운 사본 전부. Binds: (requested_at, user_key). */
export const TRAINING_INDEX_REQUEST_DELETE_FOR_USER_SQL = `UPDATE training_records_index
    SET delete_requested_at = ?
  WHERE user_key = ? AND deleted_at IS NULL AND delete_requested_at IS NULL`;

/** 프로젝트 삭제: 그 프로젝트(그 소유자)의 아직 안 지운 사본. Binds: (requested_at, project_id, user_key). */
export const TRAINING_INDEX_REQUEST_DELETE_FOR_PROJECT_SQL = `UPDATE training_records_index
    SET delete_requested_at = ?
  WHERE project_id = ? AND user_key = ? AND deleted_at IS NULL AND delete_requested_at IS NULL`;

/**
 * 0071 이전 검수 사본 옮기기(삭제 요청과 함께). 이 사본들은 색인이 없지만 0057부터 검수 런 행
 * (workspace_pr_review_runs.training_r2_key)에 키가 남아 있다 — 그 행의 user_key·project_id로 색인에 넣는다.
 * 이미 색인에 있는 키(0071 이후 캡처는 두 곳에 다 적힌다)는 건너뛴다. 행 id = 'trl_' + 검수 런 id(런당 사본 1개).
 * 0071 이전 **여정 사본(journey/…)은 어디에도 사람·프로젝트 기록이 없어 옮길 수 없다** — 자동 삭제 대상이 아니다.
 */
const LEGACY_BACKFILL_HEAD = `INSERT INTO training_records_index
   (id, user_key, project_id, r2_key, kind, captured_at, delete_requested_at, deleted_at)
 SELECT 'trl_' || r.id, r.user_key, r.project_id, r.training_r2_key, 'training', r.created_at, ?, NULL
   FROM workspace_pr_review_runs r
  WHERE r.training_r2_key IS NOT NULL AND r.training_r2_key <> ''
    AND NOT EXISTS (SELECT 1 FROM training_records_index i WHERE i.r2_key = r.training_r2_key)`;
const LEGACY_BACKFILL_TAIL = `
 ON CONFLICT(id) DO NOTHING`;

/** 철회: 이 사람의 옛 검수 사본. Binds: (requested_at, user_key). */
export const TRAINING_INDEX_BACKFILL_LEGACY_FOR_USER_SQL = `${LEGACY_BACKFILL_HEAD}
    AND r.user_key = ?${LEGACY_BACKFILL_TAIL}`;

/**
 * 프로젝트 삭제: 그 프로젝트의 옛 검수 사본. 삭제 배치에서 **DELETE FROM workspace_pr_review_runs보다 먼저**
 * 돌아야 한다(키가 그 행에만 있다). Binds: (requested_at, project_id, user_key).
 */
export const TRAINING_INDEX_BACKFILL_LEGACY_FOR_PROJECT_SQL = `${LEGACY_BACKFILL_HEAD}
    AND r.project_id = ? AND r.user_key = ?${LEGACY_BACKFILL_TAIL}`;

/**
 * 크론: 0071 이전에 거절(철회)한 사람들의 옛 검수 사본. 옛 코드의 철회는 새 캡처만 멈췄다 — 이제 저장분도 지운다.
 * 다시 동의한 사람(consented = 1)은 대상이 아니다. Binds: (requested_at, limit).
 */
export const TRAINING_INDEX_BACKFILL_LEGACY_DECLINED_SQL = `${LEGACY_BACKFILL_HEAD}
    AND r.user_key IN (SELECT user_key FROM workspace_training_consent WHERE consented = 0)
  LIMIT ?${LEGACY_BACKFILL_TAIL}`;

/** 지운 검수 사본을 가리키던 검수 런 행의 포인터를 비운다(outcome 갱신·재옮김이 없는 객체를 붙잡지 않게). Binds: (r2_key). */
export const REVIEW_RUN_CLEAR_TRAINING_KEY_SQL = `UPDATE workspace_pr_review_runs SET training_r2_key = NULL WHERE training_r2_key = ?`;

const PENDING_BASE = `SELECT id, r2_key, kind FROM training_records_index
  WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL`;
/** Binds: (limit). */
export const TRAINING_INDEX_PENDING_ALL_SQL = `${PENDING_BASE}
  ORDER BY delete_requested_at LIMIT ?`;
/** Binds: (user_key, limit). */
export const TRAINING_INDEX_PENDING_FOR_USER_SQL = `${PENDING_BASE} AND user_key = ?
  ORDER BY delete_requested_at LIMIT ?`;
/** Binds: (project_id, user_key, limit). */
export const TRAINING_INDEX_PENDING_FOR_PROJECT_SQL = `${PENDING_BASE} AND project_id = ? AND user_key = ?
  ORDER BY delete_requested_at LIMIT ?`;

/** R2에서 지운 뒤에만. Binds: (deleted_at, id). */
export const TRAINING_INDEX_MARK_DELETED_SQL = `UPDATE training_records_index
    SET deleted_at = ?
  WHERE id = ? AND deleted_at IS NULL`;

/**
 * 삭제 기록(묘비) 보관 기간. 지운 뒤에도 "언제 지웠는지"를 문의에 답할 만큼만 두고, 그 뒤에는 사람과 키의
 * 연결까지 지운다(6시간 크론).
 */
export const TRAINING_INDEX_TOMBSTONE_DAYS = 30;

/** Binds: (cutoff_iso, limit). */
export const TRAINING_INDEX_TOMBSTONE_PURGE_SQL = `DELETE FROM training_records_index
 WHERE rowid IN (
   SELECT rowid FROM training_records_index
    WHERE deleted_at IS NOT NULL AND deleted_at <= ?
    LIMIT ?)`;

export type IndexCaptureResult =
  | { indexed: true; id: string }
  | { indexed: false; reason: "no_consent" | "error"; error?: string };

/**
 * 캡처 직전 색인. 동의가 지금 유효하지 않으면 { indexed:false, reason:"no_consent" }(행 없음).
 * D1 오류는 { indexed:false, reason:"error" } — 호출자는 사본을 저장하지 않는다. 던지지 않는다.
 */
export async function indexTrainingRecord(
  env: Pick<Env, "DB">,
  input: {
    userKey: string;
    projectId: string | null;
    r2Key: string;
    kind: TrainingRecordKind;
    capturedAt: string;
    /** 지금 유효한 조항 버전(TRAINING_CONSENT_VERSION) — 이 버전에 동의한 행이 있어야 색인한다. */
    consentVersion: string;
  },
): Promise<IndexCaptureResult> {
  try {
    const id = await trainingIndexId(input.r2Key);
    const res = await env.DB.prepare(TRAINING_INDEX_INSERT_SQL)
      .bind(id, input.userKey, input.projectId, input.r2Key, input.kind, input.capturedAt, input.userKey, input.consentVersion)
      .run();
    const changes = (res as { meta?: { changes?: unknown } } | null)?.meta?.changes;
    // 변경 0 = 동의 조건이 맞지 않아 아무것도 쓰지 않았다. 숫자가 아니면(모르는 드라이버) 썼다고 보지 않는다.
    if (typeof changes !== "number" || changes < 1) return { indexed: false, reason: "no_consent" };
    return { indexed: true, id };
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    console.error(JSON.stringify({ at: "training-index", op: "insert", kind: input.kind, error }));
    return { indexed: false, reason: "error", error };
  }
}

/**
 * put 뒤 재확인: 캡처 도중 삭제가 요청됐으면 방금 쓴 객체를 바로 지우고 deleted_at을 찍는다.
 * 반환 true = 사본이 남아 있다(정상), false = 방금 지웠다. 던지지 않는다(확인 실패는 로그 — 요청은 남아 크론이 지운다).
 */
export async function settleAfterPut(
  env: Pick<Env, "DB" | "EVIDENCE">,
  id: string,
  r2Key: string,
  now: () => string = () => new Date().toISOString(),
): Promise<boolean> {
  try {
    const row = await env.DB.prepare(TRAINING_INDEX_STATE_SQL)
      .bind(id)
      .first<{ delete_requested_at?: unknown; deleted_at?: unknown }>();
    const requested = typeof row?.delete_requested_at === "string" && row.delete_requested_at !== "";
    const deleted = typeof row?.deleted_at === "string" && row.deleted_at !== "";
    if (!requested && !deleted) return true;
    if (env.EVIDENCE) {
      await env.EVIDENCE.delete(r2Key);
      if (!deleted) await env.DB.prepare(TRAINING_INDEX_MARK_DELETED_SQL).bind(now(), id).run();
    }
    console.log(JSON.stringify({ at: "training-index", op: "settle", note: "deletion requested during capture — removed" }));
    return false;
  } catch (err) {
    console.error(
      JSON.stringify({ at: "training-index", op: "settle", error: (err instanceof Error ? err.message : String(err)).slice(0, 200) }),
    );
    return true;
  }
}

export type TrainingDeletionScope =
  | { kind: "user"; userKey: string }
  | { kind: "project"; projectId: string; userKey: string }
  | { kind: "all" };

export type TrainingDeletionSweepResult = {
  /** 이번에 읽은 "요청됐지만 아직 안 지운" 행 수. */
  pending: number;
  deleted: number;
  failed: number;
  /** 한 번에 다 못 봤다(한도에 닿음) — 다음 크론이 이어간다. */
  more: boolean;
  /** EVIDENCE 버킷이 없으면 지울 수 없다 — 요청은 그대로 남는다(지운 척하지 않는다). */
  skipped?: "no_bucket";
  error?: string;
};

const SWEEP_PAGE = 200;

function pendingQuery(env: Pick<Env, "DB">, scope: TrainingDeletionScope, limit: number) {
  if (scope.kind === "user") return env.DB.prepare(TRAINING_INDEX_PENDING_FOR_USER_SQL).bind(scope.userKey, limit);
  if (scope.kind === "project") {
    return env.DB.prepare(TRAINING_INDEX_PENDING_FOR_PROJECT_SQL).bind(scope.projectId, scope.userKey, limit);
  }
  return env.DB.prepare(TRAINING_INDEX_PENDING_ALL_SQL).bind(limit);
}

/**
 * 요청된 삭제를 실행한다: R2 delete → 성공한 행만 deleted_at. 한 페이지(기본 200)씩 maxPages까지.
 * 던지지 않는다. 결과는 한 줄 JSON으로 남긴다(할 일이 있었거나 오류일 때).
 */
export async function sweepTrainingDeletions(
  env: Pick<Env, "DB" | "EVIDENCE">,
  scope: TrainingDeletionScope,
  opts: { site: string; pageSize?: number; maxPages?: number; now?: () => string } = { site: "unknown" },
): Promise<TrainingDeletionSweepResult> {
  const pageSize = opts.pageSize ?? SWEEP_PAGE;
  const maxPages = opts.maxPages ?? 1;
  const now = opts.now ?? (() => new Date().toISOString());
  const result: TrainingDeletionSweepResult = { pending: 0, deleted: 0, failed: 0, more: false };
  try {
    if (!env.EVIDENCE) {
      const probe = await pendingQuery(env, scope, 1).all<{ id: string }>();
      result.pending = probe.results?.length ?? 0;
      if (result.pending > 0) result.skipped = "no_bucket";
    } else {
      const bucket = env.EVIDENCE;
      for (let page = 0; page < maxPages; page++) {
        const rows =
          (await pendingQuery(env, scope, pageSize).all<{ id: string; r2_key: string; kind: string }>()).results ?? [];
        result.pending += rows.length;
        let failedThisPage = 0;
        for (const row of rows) {
          try {
            // R2 delete of a missing key resolves — an object that never landed counts as gone.
            await bucket.delete(row.r2_key);
            await env.DB.prepare(TRAINING_INDEX_MARK_DELETED_SQL).bind(now(), row.id).run();
            if (row.kind === "training") {
              await env.DB.prepare(REVIEW_RUN_CLEAR_TRAINING_KEY_SQL).bind(row.r2_key).run();
            }
            result.deleted++;
          } catch (err) {
            result.failed++;
            failedThisPage++;
            if (!result.error) result.error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
          }
        }
        if (rows.length < pageSize) break;
        // 이 페이지가 전부 실패했으면 다음 페이지도 같은 행이다 — 멈추고 다음 틱에 맡긴다.
        if (failedThisPage === rows.length) {
          result.more = true;
          break;
        }
        if (page === maxPages - 1) result.more = true;
      }
    }
  } catch (err) {
    result.error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  }
  if (result.pending > 0 || result.error) {
    const line = JSON.stringify({ at: "training-deletion", site: opts.site, scope: scope.kind, ...result });
    if (result.error || result.failed > 0 || result.skipped) console.error(line);
    else console.log(line);
  }
  return result;
}

/** 삭제한 지 TRAINING_INDEX_TOMBSTONE_DAYS가 지난 묘비 행을 지운다. 던지지 않는다. */
export async function purgeTrainingIndexTombstones(
  env: Pick<Env, "DB">,
  now: Date = new Date(),
  limit = 5_000,
): Promise<{ cutoff: string; deleted: number; error?: string }> {
  const cutoff = new Date(now.getTime() - TRAINING_INDEX_TOMBSTONE_DAYS * 86_400_000).toISOString();
  try {
    const res = await env.DB.prepare(TRAINING_INDEX_TOMBSTONE_PURGE_SQL).bind(cutoff, limit).run();
    const changes = (res as { meta?: { changes?: unknown } } | null)?.meta?.changes;
    return { cutoff, deleted: typeof changes === "number" ? changes : 0 };
  } catch (err) {
    return { cutoff, deleted: 0, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

/** 크론 1회에 옮기는 옛 검수 사본(과거 철회자) 최대 수. 남으면 다음 틱이 이어간다. */
const LEGACY_DECLINED_BACKFILL_LIMIT = 1_000;
/** 크론 1회 삭제 스윕: 200 × 5 = 1,000건. */
const CRON_SWEEP_PAGES = 5;

export type TrainingPrivacyCronResult = {
  /** 과거 철회자의 옛 검수 사본을 색인으로 옮긴(삭제 요청과 함께) 수. */
  legacyDeclined: { requested: number; error?: string };
  sweep: TrainingDeletionSweepResult;
  tombstones: { cutoff: string; deleted: number; error?: string };
};

/**
 * 6시간 크론: ① 과거 철회자의 옛 검수 사본 요청 → ② 요청된 삭제 실행(철회·프로젝트 삭제 때 실패한 것 포함)
 * → ③ 30일 지난 묘비 청소. 각 단계는 따로 시도하고, 던지지 않는다.
 */
export async function runTrainingPrivacyCron(
  env: Pick<Env, "DB" | "EVIDENCE">,
  now: Date = new Date(),
): Promise<TrainingPrivacyCronResult> {
  const nowIso = now.toISOString();
  const legacyDeclined: TrainingPrivacyCronResult["legacyDeclined"] = { requested: 0 };
  try {
    const res = await env.DB.prepare(TRAINING_INDEX_BACKFILL_LEGACY_DECLINED_SQL).bind(nowIso, LEGACY_DECLINED_BACKFILL_LIMIT).run();
    const changes = (res as { meta?: { changes?: unknown } } | null)?.meta?.changes;
    legacyDeclined.requested = typeof changes === "number" ? changes : 0;
  } catch (err) {
    legacyDeclined.error = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  }
  const sweep = await sweepTrainingDeletions(env, { kind: "all" }, { site: "cron", maxPages: CRON_SWEEP_PAGES, now: () => nowIso });
  const tombstones = await purgeTrainingIndexTombstones(env, now);
  return { legacyDeclined, sweep, tombstones };
}
