// Stage 267: pure helpers for the document → spec draft flow (연결 문서 초안).
//
// PURE — no network, no storage, no LLM. The dashboard page that POSTs
// /workspace/projects/:id/sources/:sourceId/spec-draft (Stage 265) uses these
// to decide whether a returned draft is confirmable, whether confirming would
// overwrite existing project content, and which localized message to show for
// a backend error code or bare HTTP status.

/** Backend error codes the spec-draft endpoint can return (Stage 265). */
export const DRAFT_ERROR_CODES = [
  "source_not_document",
  "pdf_text_extraction_unsupported",
  "document_too_short",
  "document_too_long",
  "unsupported_content_type",
  "forbidden",
  "project_not_found",
  "source_not_found",
  "document_not_found",
  "rate_limited",
  "llm_unavailable",
  "evidence_storage_unconfigured",
];

/**
 * A draft can be confirmed onto the project only when it names the product and
 * carries at least one acceptance item — otherwise the /spec and /items pages
 * would be filled with an empty shell.
 */
export function canConfirmDraft(draft) {
  if (!draft || typeof draft !== "object") return false;
  const spec = draft.productSpec;
  const name = spec && typeof spec.productName === "string" ? spec.productName.trim() : "";
  if (!name) return false;
  return Array.isArray(draft.items) && draft.items.length >= 1;
}

function nonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function nonBlank(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * True when the project already carries a non-empty productSpec or check
 * items, i.e. confirming a document draft would REPLACE existing content and
 * the UI must require an explicit overwrite acknowledgement.
 *
 * Accepts the local Project shape ({ spec, requirements }) optionally merged
 * with extended data ({ productSpec }). Null/undefined → no risk.
 */
export function draftOverwriteRisk(project) {
  if (!project || typeof project !== "object") return false;
  if (nonEmptyArray(project.requirements)) return true;
  const spec = project.spec;
  if (spec && typeof spec === "object") {
    if (nonBlank(spec.goal)) return true;
    if (nonEmptyArray(spec.included) || nonEmptyArray(spec.excluded)) return true;
    if (nonEmptyArray(spec.openDecisions)) return true;
  }
  const ps = project.productSpec;
  if (ps && typeof ps === "object" && nonBlank(ps.productName)) return true;
  return false;
}

/**
 * Map a backend error code (string) or bare HTTP status (number, used when the
 * response body was unparseable) to a key under t.sources.draft.errors.
 * Unknown inputs fall back to "generic" — never throws.
 */
export function mapDraftError(codeOrStatus) {
  if (typeof codeOrStatus === "string" && DRAFT_ERROR_CODES.includes(codeOrStatus)) {
    return codeOrStatus;
  }
  if (typeof codeOrStatus === "number") {
    if (codeOrStatus === 403) return "forbidden";
    if (codeOrStatus === 404) return "source_not_found";
    if (codeOrStatus === 429) return "rate_limited";
    if (codeOrStatus === 503) return "evidence_storage_unconfigured";
  }
  return "generic";
}

/**
 * Render the localized rate-limit message with the retry wait in minutes
 * ("{minutes}" placeholder). Seconds round UP so we never promise too early.
 */
export function formatRateLimitedMessage(template, retryAfterSeconds) {
  const secs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 3600;
  const minutes = Math.max(1, Math.ceil(secs / 60));
  return String(template).replace("{minutes}", String(minutes));
}
