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

export const TRAINING_SCHEMA_VERSION = 1;

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
  /** Which AI tool(s) built this app — the per-agent moat tag (from the project). */
  builtWith?: unknown;
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
  schema_version: number;
  captured_at: string;
  // identity + provenance (no raw handle)
  subject_hash: string;
  consent_version: string;
  project_id: string;
  review_run_id: string;
  rerun_of_review_run_id: string | null;
  repo_full_name: string;
  pr_number: number;
  head_sha: string;
  // provenance — which AI tool(s) produced this code (the per-agent moat tag)
  built_with: unknown;
  // INPUT
  product_spec: unknown;
  acceptance_items: unknown[];
  pr_files: TrainingPrFile[];
  // LABEL (council verdict)
  review_source: string;
  results: TrainingResultItem[];
  summary: { passed: number; failed: number; inconclusive: number; needsDecision: number };
  final_status: string;
  // OUTCOME (reward signal)
  outcome: "pending";
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
  return {
    schema_version: TRAINING_SCHEMA_VERSION,
    captured_at: capturedAt,
    subject_hash: subjectHash,
    consent_version: TRAINING_CONSENT_VERSION,
    project_id: input.projectId,
    review_run_id: input.reviewRunId,
    rerun_of_review_run_id: input.rerunOfReviewRunId ?? null,
    repo_full_name: input.repoFullName,
    pr_number: input.prNumber,
    head_sha: input.headSha ?? "",
    // Per-agent moat tag. Scrubbed too — the freetext "other" could contain anything.
    built_with: scrubJson(input.builtWith ?? null),
    // Secret-scrub every user-authored surface before it lands in R2. A
    // vibe-coder's diff or spec routinely contains live keys / .env values.
    product_spec: scrubJson(input.productSpec),
    acceptance_items: Array.isArray(input.items)
      ? (scrubJson(input.items) as unknown[])
      : input.items,
    pr_files: input.prFiles.map((f) => ({
      ...f,
      ...(f.patch ? { patch: scrubText(f.patch) } : {}),
    })),
    review_source: input.review.source,
    // The verdict text (reason) could quote a secret line from the diff.
    // Scrubbing only rewrites exact key-shaped matches, so the label is
    // otherwise untouched.
    results: scrubJson(input.review.results) as TrainingResultItem[],
    summary: input.review.summary,
    final_status: input.finalStatus,
    outcome: "pending",
  };
}

/** R2 object key. Day-bucketed so the store is browsable and cheap to sweep. */
export function trainingRecordKey(capturedAt: string, reviewRunId: string): string {
  // capturedAt is an ISO string; slice the date without constructing a Date
  // (keeps this pure and TZ-free).
  const day = capturedAt.slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = day.split("-");
  return `training/${y}/${m}/${d}/${reviewRunId}.json`;
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
    const key = trainingRecordKey(capturedAt, input.reviewRunId);
    await env.EVIDENCE.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
    return { stored: true, key };
  } catch (err) {
    console.warn("[training-store] capture failed (non-fatal):", err instanceof Error ? err.message : err);
    return { stored: false, reason: "error" };
  }
}
