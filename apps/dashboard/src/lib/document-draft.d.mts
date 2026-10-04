// Type declarations for document-draft.mjs (Stage 267).

/** Keys under t.sources.draft.errors (plus "generic" fallback). */
export type DraftErrorKey =
  | "source_not_document"
  | "pdf_text_extraction_unsupported"
  | "document_too_short"
  | "document_too_long"
  | "unsupported_content_type"
  | "forbidden"
  | "project_not_found"
  | "source_not_found"
  | "document_not_found"
  | "rate_limited"
  | "evidence_storage_unconfigured"
  | "generation_capacity"
  | "generic";

export const DRAFT_ERROR_CODES: string[];

export function canConfirmDraft(draft: unknown): boolean;

export function draftOverwriteRisk(project: unknown): boolean;

export function mapDraftError(codeOrStatus: string | number | null | undefined): DraftErrorKey;

export function formatRateLimitedMessage(
  template: string,
  retryAfterSeconds: number | undefined,
): string;
