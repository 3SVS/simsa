/**
 * training-store.ts
 *
 * Durable capture of raw review triplets for a FUTURE fine-tune / distillation.
 *
 * Why this exists: the self-evolve substrate distils merges/rejects into RAG
 * rules (answer-keys / failure-catalog) and the episodic raw log ages out at 90
 * days. Rules train nobody — a fine-tune needs the ORIGINAL {input, label,
 * outcome} triplet. On the SaaS path the server already holds the PR diff and
 * the council verdict at review time, so — and only with explicit, versioned
 * consent — we persist that triplet verbatim to R2 under `training/`.
 *
 * The council's per-item verdict IS the high-value supervised label: three
 * frontier models' judgement, captured at a few cents per PR. That is the raw
 * material a small distilled reviewer/triage model would learn from.
 *
 * Design guarantees:
 *  - Default OFF. No consent (or stale consent) → no-op. No EVIDENCE bucket → no-op.
 *  - Never throws. Capture is best-effort telemetry; a failure must not affect
 *    the review response.
 *  - No raw identity in the payload. The subject is keyed by sha256(userKey);
 *    the raw handle and any email never enter the record.
 *
 * Known gap (documented, not silent): the merge/reject reward signal is not
 * known at review time on the acceptance flow. v1 captures input + label +
 * final review status; a later PR-state poll can append the human outcome. See
 * `outcome: "pending"`.
 */
import type { Env } from "../env.js";
import { redactSecrets } from "@simsa/secret-guard";
import { sha256Hex } from "../util.js";
import { TRAINING_CONSENT_VERSION, hasActiveTrainingConsent } from "./training-consent-db.js";

// 2.0 — the P1 envelope (region/locale/entry_path/built_with/topic_tags/
// acquisition/user_context/commercial + reserved P2/P3 slots). All new fields
// are nullable; schema_version tracks when each began to be filled.
export const TRAINING_SCHEMA_VERSION = "2.0";

/** builtWith tag — which AI tool(s) produced the code (per-agent moat axis). */
export type BuiltWithTag = {
  tools?: string[];
  primary?: string | null;
  other?: string | null;
  modelNote?: string | null; // P2
  tool_versions?: unknown; // P3 slot
} | null;

/** LLM-classified topic tags (market map). */
export type TopicTags = {
  domain?: string | null;
  pattern?: string | null;
  integrations?: string[];
  ai_feature?: string | null;
} | null;

/** Where the user came from + how (P1 source; campaign/referrer are P2). */
export type AcquisitionTag = {
  source?: string | null;
  campaign?: string | null; // P2
  referrer_hash?: string | null; // P2
} | null;

/**
 * User-context signals for retention/skill analysis + longitudinal growth.
 * skill_level / level_at_capture are P1 slots (no leveling feature yet → null,
 * but the slot must exist so future captures can stamp the level AT CAPTURE —
 * same never-join rule as plan_tier). concepts_unlocked / growth_events are P3.
 */
export type UserContextTag = {
  skill_signal?: string | null; // "first_project" | "returning"
  session_seq?: number | null;
  project_seq?: number | null;
  skill_level?: number | null; // P1 slot — current level (null until leveling ships)
  level_at_capture?: number | null; // P1 slot — level stamped at this event
  concepts_unlocked?: string[] | null; // P3 slot
  growth_events?: unknown[] | null; // P3 slot
} | null;

/**
 * Guided vs wild. Separates data that came from Simsa's steering (guided) from
 * pure user-origin data (wild) — mixing them corrupts the moat's pure failure
 * patterns. Slot only for now: no guided feature exists, so mode is always
 * "wild"; guided_at / guided_scope stay null until a guided feature ships.
 */
export type AssistanceTag = {
  mode?: "wild" | "guided";
  guided_at?: "before_build" | "after_review" | null;
  guided_scope?: unknown; // P3 slot
} | null;

/**
 * Usage MEASUREMENT (not billing). Enables a future count→token pricing decision
 * to be made from data. No debit / cap / enforcement is added — measure only.
 */
export type CostMeta = {
  review_count_in_session?: number | null;
  tokens_consumed?: number | null;
  model_used?: string | null;
} | null;

/** Envelope tags captured at review time. All optional — null slot if no source yet. */
export type EnvelopeInput = {
  /** sha256(workspaceId) — team/personal split. */
  workspaceHash?: string | null;
  region?: string | null; // ISO-3166, IP-based
  locale?: string | null; // BCP-47 UI language
  contentLang?: string | null; // detected input language
  entryPath?: "idea" | "code" | "spec" | null;
  builtWith?: BuiltWithTag;
  topicTags?: TopicTags;
  acquisition?: AcquisitionTag;
  userContext?: UserContextTag;
  /** Tier AT CAPTURE — never join the current tier (would corrupt past rows). */
  planTier?: string | null;
  /** Guided vs wild (STEP 3). Always "wild" today — slot for future guided feature. */
  assistance?: AssistanceTag;
  /** Usage measurement (STEP 3) — tokens/model/session count. Not billing. */
  costMeta?: CostMeta;
  /** Channel this review came through. "web" today; MCP is a future channel (P3 slot). */
  channel?: "web" | "mcp" | null;
  /** MCP client when channel="mcp" (e.g. "cursor"). P3 slot — null on web. */
  mcpClient?: string | null;
};

/**
 * Scrub secrets out of arbitrary free text before it is persisted. Non-dev
 * users routinely paste live API keys / .env values into code and specs, so
 * every string that reaches the training store is run through the same
 * secret-guard rules the CLI uses. Over-redaction is the safe error.
 */
function scrubText(text: string): string {
  if (!text) return text;
  return redactSecrets(text).text;
}

/**
 * Deep-scrub a JSON-serializable value (product spec, acceptance items). The
 * value came from a JSON request body, so it round-trips; if anything goes
 * wrong we return a marker rather than risk leaking the raw value.
 */
function scrubJson(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return null;
    return JSON.parse(scrubText(s));
  } catch {
    return "[redacted-unserializable]";
  }
}

/** A single PR file as fetched from GitHub (the diff). */
export type TrainingPrFile = {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

/** Per-item council verdict (the label). */
export type TrainingResultItem = {
  itemId?: string;
  status: string;
  reason?: string;
  [k: string]: unknown;
};

export type CaptureTrainingInput = {
  userKey: string;
  projectId: string;
  reviewRunId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
  productSpec: unknown;
  items: unknown[];
  prFiles: TrainingPrFile[];
  review: {
    source: string;
    summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
    results: TrainingResultItem[];
  };
  finalStatus: string;
  rerunOfReviewRunId?: string;
  /** P1 envelope tags (all optional; unsourced ones stored as null). */
  envelope?: EnvelopeInput;
  /** Injected clock for tests; defaults to real time. */
  now?: string;
  /** Injected subject hash for tests; defaults to sha256(userKey). */
  subjectHash?: string;
};

/**
 * The on-disk (R2) training record. One JSON object per review run. Field
 * groups: identity/consent, INPUT (the crude oil), LABEL (council output),
 * OUTCOME (reward — pending until a later poll fills it).
 */
export type TrainingRecord = {
  // ── identity ──
  event_id: string;
  captured_at: string;
  schema_version: string;
  subject_hash: string; // sha256(userKey) — no raw handle
  workspace_hash: string | null; // sha256(workspaceId) — P1, null until sourced
  consent_version: string;
  project_id: string;
  review_run_id: string;
  rerun_of_review_run_id: string | null;
  repo_full_name: string;
  pr_number: number;
  head_sha: string;
  // ── global dimension (P1; timezone P2) ──
  region: string | null;
  locale: string | null;
  content_lang: string | null;
  timezone: string | null;
  // ── entry / tool dimension (P1) ──
  entry_path: "idea" | "code" | "spec" | null;
  built_with: BuiltWithTag;
  // ── topic dimension (P1) ──
  topic_tags: TopicTags;
  // ── acquisition dimension (P1 source) ──
  acquisition: AcquisitionTag;
  // ── user-context dimension (P1) ──
  user_context: UserContextTag;
  // ── commercial dimension (P1 — tier at capture, never joined) ──
  commercial: { plan_tier: string | null; plan_at_capture: unknown };
  // ── assistance (guided vs wild — separate-storage tag; "wild" today) ──
  assistance: { mode: "wild" | "guided"; guided_at: "before_build" | "after_review" | null; guided_scope: unknown };
  // ── cost_meta (usage measurement, NOT billing) ──
  cost_meta: CostMeta;
  // ── channel dimension (web today; MCP is a future channel) ──
  channel: "web" | "mcp" | null;
  mcp_client: string | null;
  // ── event body ──
  event_type: "pr_reviewed" | "pr_rechecked";
  payload_scrub_state: "clean" | "metadata_only" | "raw_pending";
  // ── INPUT (the crude oil, scrubbed) ──
  product_spec: unknown;
  acceptance_items: unknown[];
  pr_files: TrainingPrFile[];
  // ── LABEL (council verdict) ──
  review_source: string;
  results: TrainingResultItem[];
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  final_status: string;
  // ── OUTCOME (reward — pending until the STEP-4 poll fills it) ──
  outcome: "pending" | "resolved" | "unresolved" | "merged" | "rejected";
  // ── reserved future slots (P3; null now) ──
  device_context: unknown;
  experiment_arm: string | null;
  quality_signals: unknown;
};

/**
 * Pure, deterministic assembler. No I/O, no consent check — safe to unit-test
 * for shape and for the no-PII invariant.
 */
export function buildTrainingRecord(
  input: CaptureTrainingInput,
  subjectHash: string,
  capturedAt: string,
): TrainingRecord {
  const env = input.envelope ?? {};
  return {
    // identity
    event_id: input.reviewRunId,
    captured_at: capturedAt,
    schema_version: TRAINING_SCHEMA_VERSION,
    subject_hash: subjectHash,
    workspace_hash: env.workspaceHash ?? null,
    consent_version: TRAINING_CONSENT_VERSION,
    project_id: input.projectId,
    review_run_id: input.reviewRunId,
    rerun_of_review_run_id: input.rerunOfReviewRunId ?? null,
    repo_full_name: input.repoFullName,
    pr_number: input.prNumber,
    head_sha: input.headSha ?? "",
    // global
    region: env.region ?? null,
    locale: env.locale ?? null,
    content_lang: env.contentLang ?? null,
    timezone: null,
    // entry / tool — built_with freetext scrubbed (the "other" field is arbitrary)
    entry_path: env.entryPath ?? null,
    built_with: (env.builtWith ? scrubJson(env.builtWith) : null) as BuiltWithTag,
    // topic
    topic_tags: env.topicTags ?? null,
    // acquisition
    acquisition: env.acquisition ?? null,
    // user context — all slots always present (skill_level/level_at_capture are
    // P1 slots, null until a leveling feature stamps the level AT CAPTURE).
    user_context: {
      skill_signal: env.userContext?.skill_signal ?? null,
      session_seq: env.userContext?.session_seq ?? null,
      project_seq: env.userContext?.project_seq ?? null,
      skill_level: env.userContext?.skill_level ?? null,
      level_at_capture: env.userContext?.level_at_capture ?? null,
      concepts_unlocked: env.userContext?.concepts_unlocked ?? null,
      growth_events: env.userContext?.growth_events ?? null,
    },
    // commercial — plan_tier is the value AT CAPTURE (never re-joined)
    commercial: { plan_tier: env.planTier ?? null, plan_at_capture: null },
    // assistance — guided vs wild. Always "wild" today (no guided feature yet).
    assistance: {
      mode: env.assistance?.mode ?? "wild",
      guided_at: env.assistance?.guided_at ?? null,
      guided_scope: env.assistance?.guided_scope ?? null,
    },
    // cost_meta — usage measurement (tokens/model/session count), NOT billing.
    cost_meta: env.costMeta ?? null,
    // channel — web today; MCP is a future channel (slot only).
    channel: env.channel ?? null,
    mcp_client: env.mcpClient ?? null,
    // event body
    event_type: input.rerunOfReviewRunId ? "pr_rechecked" : "pr_reviewed",
    payload_scrub_state: "clean", // code-based review payload → redactSecrets applied
    // INPUT — secret-scrub every user-authored surface before it lands in R2.
    product_spec: scrubJson(input.productSpec),
    acceptance_items: Array.isArray(input.items)
      ? (scrubJson(input.items) as unknown[])
      : input.items,
    pr_files: input.prFiles.map((f) => ({
      ...f,
      ...(f.patch ? { patch: scrubText(f.patch) } : {}),
    })),
    // LABEL — the verdict reason could quote a secret line from the diff.
    review_source: input.review.source,
    results: scrubJson(input.review.results) as TrainingResultItem[],
    summary: input.review.summary,
    final_status: input.finalStatus,
    outcome: "pending",
    // reserved P3 slots
    device_context: null,
    experiment_arm: null,
    quality_signals: null,
  };
}

/**
 * R2 object key. Region-partitioned then day-bucketed:
 * `events/{region}/YYYY/MM/DD/<eventId>.json`. Region enables per-country
 * analysis (the moat's global axis) without scanning; unknown region → "unknown".
 */
export function trainingRecordKey(capturedAt: string, eventId: string, region?: string | null): string {
  const day = capturedAt.slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = day.split("-");
  const safeRegion = (region ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "unknown";
  const safeEvent = eventId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `events/${safeRegion}/${y}/${m}/${d}/${safeEvent}.json`;
}

export type CaptureResult =
  | { stored: true; key: string }
  | { stored: false; reason: "no_consent" | "no_bucket" | "error" };

/**
 * Consent-gated, best-effort capture. Returns a result for observability but
 * never throws. No consent → no bucket read. No bucket → no-op.
 */
export async function captureTrainingRecord(
  env: Env,
  input: CaptureTrainingInput,
): Promise<CaptureResult> {
  try {
    if (!(await hasActiveTrainingConsent(env, input.userKey))) {
      return { stored: false, reason: "no_consent" };
    }
    if (!env.EVIDENCE) {
      return { stored: false, reason: "no_bucket" };
    }
    const capturedAt = input.now ?? new Date().toISOString();
    const subjectHash = input.subjectHash ?? (await sha256Hex(input.userKey));
    const record = buildTrainingRecord(input, subjectHash, capturedAt);
    const key = trainingRecordKey(capturedAt, input.reviewRunId, input.envelope?.region);
    await env.EVIDENCE.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
    return { stored: true, key };
  } catch (err) {
    console.warn("[training-store] capture failed (non-fatal):", err instanceof Error ? err.message : err);
    return { stored: false, reason: "error" };
  }
}
