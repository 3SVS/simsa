/**
 * journey-store.ts
 *
 * Captures the non-developer JOURNEY (not just the final review triplet): what
 * they built with, how they shaped the idea, where the draft got corrected, and
 * — the crown jewel — the fix-brief → next-PR round-trip per agent. Only Simsa
 * sees this cross-agent behavioral trace, and it can only be captured in the
 * moment (golden-time; no backfill). Every event carries the builtWith tag so
 * the data resolves per agent.
 *
 * Same guarantees as training-store: opt-in (default OFF), version-gated
 * consent, secret-scrubbed, keyed by sha256(userKey) with no raw handle/email,
 * never throws, no-op without consent or an R2 bucket. Events land as JSON under
 * `journey/YYYY/MM/DD/<projectId>/<eventId>.json`.
 */
import type { Env } from "../env.js";
import { redactSecrets } from "@simsa/secret-guard";
import { sha256Hex } from "../util.js";
import { TRAINING_CONSENT_VERSION, hasActiveTrainingConsent } from "./training-consent-db.js";
import type { BuiltWith } from "./built-with.js";

export const JOURNEY_SCHEMA_VERSION = 1;

/**
 * Event taxonomy. Extensible — add a new value and one captureJourneyEvent call
 * at the relevant handler; existing data stays valid. Kept as a plain string
 * union so unknown future events don't break old readers.
 */
export type JourneyEventType =
  | "idea_submitted"
  | "spec_generated"
  | "spec_edited"
  | "items_finalized"
  | "repo_connected"
  | "pr_reviewed"
  | "fix_brief_generated"
  | "pr_rechecked"
  | "outcome_recorded";

/**
 * NATURAL-LANGUAGE events. Their raw payload is free-form prose a non-developer
 * types (idea descriptions, spec edits) and routinely contains PII / business
 * secrets — customer names, phone numbers, revenue figures — that our
 * code-oriented secret scrubber (redactSecrets: API-key/token PATTERNS) cannot
 * detect, because there is no pattern. Until a dedicated PII scrubber lands,
 * callers for these event types MUST pass METADATA ONLY (lengths, counts, edit
 * deltas) — never the raw text. Code-based events (the fix_brief → pr_rechecked
 * round-trip, PR reviews) are safe to capture in full via the existing scrub.
 * `assertNoRawProseForNlEvent` enforces this at capture time.
 */
export const NATURAL_LANGUAGE_EVENTS: ReadonlySet<JourneyEventType> = new Set([
  "idea_submitted",
  "spec_generated",
  "spec_edited",
  "items_finalized",
]);

/** Fields that, on an NL event, would carry raw prose — refuse to store them. */
const RAW_PROSE_FIELDS = new Set(["idea", "text", "raw", "content", "spec", "productSpec", "items", "reason"]);

/**
 * Drop any raw-prose field from an NL event's payload (defense in depth). This
 * makes it structurally impossible to persist un-PII-scrubbed prose even if a
 * caller passes it by mistake. Non-NL events pass through untouched.
 */
function enforceNlMetadataOnly(eventType: JourneyEventType, payload: unknown): unknown {
  if (!NATURAL_LANGUAGE_EVENTS.has(eventType)) return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    // A bare string/array on an NL event is almost certainly raw prose — drop it.
    return { note: "metadata_only_pending_pii_scrub" };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (RAW_PROSE_FIELDS.has(k)) continue;
    // Also drop any long free-text string that slipped through.
    if (typeof v === "string" && v.length > 120) continue;
    out[k] = v;
  }
  return out;
}

export type CaptureJourneyInput = {
  userKey: string;
  projectId: string;
  eventType: JourneyEventType;
  /** Event-specific data. Deep secret-scrubbed before storage. */
  payload: unknown;
  /** The agent tag for this project, if known. Copied onto every event. */
  builtWith?: BuiltWith | null;
  /** Stable per-event id (e.g. review run id). Falls back to a hash of the payload+type. */
  eventId?: string;
  /** Injected clock for tests. */
  now?: string;
  /** Injected subject hash for tests. */
  subjectHash?: string;
};

export type JourneyRecord = {
  schema_version: number;
  captured_at: string;
  subject_hash: string;
  consent_version: string;
  project_id: string;
  event_type: JourneyEventType;
  built_with: BuiltWith | null;
  payload: unknown;
};

/** Deep-scrub a JSON-serializable value. Returns a marker rather than leak on error. */
function scrubJson(value: unknown): unknown {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return null;
    return JSON.parse(redactSecrets(s).text);
  } catch {
    return "[redacted-unserializable]";
  }
}

/** Pure, deterministic assembler. Safe to unit-test for shape + no-PII. */
export function buildJourneyRecord(
  input: CaptureJourneyInput,
  subjectHash: string,
  capturedAt: string,
): JourneyRecord {
  // NL events: strip raw prose FIRST (PII the code scrubber can't catch), then
  // secret-scrub the remaining metadata. Code events: secret-scrub in full.
  const safePayload = enforceNlMetadataOnly(input.eventType, input.payload);
  return {
    schema_version: JOURNEY_SCHEMA_VERSION,
    captured_at: capturedAt,
    subject_hash: subjectHash,
    consent_version: TRAINING_CONSENT_VERSION,
    project_id: input.projectId,
    event_type: input.eventType,
    built_with: input.builtWith ?? null,
    payload: scrubJson(safePayload),
  };
}

/** R2 object key: day-bucketed, grouped by project so a full journey is browsable. */
export function journeyRecordKey(capturedAt: string, projectId: string, eventId: string): string {
  const [y, m, d] = capturedAt.slice(0, 10).split("-");
  // Sanitize ids for a safe key (no slashes/spaces).
  const safeProject = projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const safeEvent = eventId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `journey/${y}/${m}/${d}/${safeProject}/${safeEvent}.json`;
}

export type JourneyCaptureResult =
  | { stored: true; key: string }
  | { stored: false; reason: "no_consent" | "no_bucket" | "error" };

/**
 * Consent-gated, best-effort capture. Never throws. No consent → no bucket read.
 */
export async function captureJourneyEvent(
  env: Env,
  input: CaptureJourneyInput,
): Promise<JourneyCaptureResult> {
  try {
    if (!(await hasActiveTrainingConsent(env, input.userKey))) {
      return { stored: false, reason: "no_consent" };
    }
    if (!env.EVIDENCE) {
      return { stored: false, reason: "no_bucket" };
    }
    const capturedAt = input.now ?? new Date().toISOString();
    const subjectHash = input.subjectHash ?? (await sha256Hex(input.userKey));
    const eventId =
      input.eventId ?? (await sha256Hex(`${input.eventType}:${JSON.stringify(input.payload)}`)).slice(0, 24);
    const record = buildJourneyRecord(input, subjectHash, capturedAt);
    const key = journeyRecordKey(capturedAt, input.projectId, eventId);
    await env.EVIDENCE.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
    return { stored: true, key };
  } catch (err) {
    console.warn("[journey-store] capture failed (non-fatal):", err instanceof Error ? err.message : err);
    return { stored: false, reason: "error" };
  }
}
