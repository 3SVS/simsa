/**
 * workspace/document-intake.ts — Stage 265
 *
 * Deterministic pre-processing for "document → spec draft" (Phase 3.5).
 * A user uploads a PRD/기획서 (Stage 261 document source, R2-stored md/txt/pdf)
 * and asks for a draft product spec. Before anything touches the LLM path,
 * the raw bytes are normalized and guarded here — pure functions, no I/O.
 *
 * v1 honest limitation: PDF text extraction is NOT supported (no pdf parsing
 * dependency). PDFs return `pdf_text_extraction_unsupported` so the client can
 * tell the user to upload md/txt instead.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MIN_DOCUMENT_TEXT_CHARS = 50;
export const MAX_DOCUMENT_TEXT_CHARS = 100_000;

/** Content types we can decode as plain UTF-8 text. */
const TEXT_CONTENT_TYPES = new Set(["text/markdown", "text/plain"]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtractDocumentTextError =
  | "pdf_text_extraction_unsupported"
  | "unsupported_content_type"
  | "document_too_short"
  | "document_too_long";

export type ExtractDocumentTextResult =
  | { ok: true; text: string }
  | { ok: false; error: ExtractDocumentTextError };

// ─── Normalization helpers (charCode-based; no control chars in source) ─────

const CODE_TAB = 0x09;
const CODE_LF = 0x0a;
const CODE_CR = 0x0d;
const CODE_DEL = 0x7f;
const CODE_BOM = 0xfeff;

/**
 * Strip C0 control characters (except LF and TAB) and DEL. CR is handled by
 * the CRLF normalization pass before this runs.
 */
function stripControlChars(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isControl = (code <= 0x1f && code !== CODE_LF && code !== CODE_TAB) || code === CODE_DEL;
    if (!isControl) out += s.charAt(i);
  }
  return out;
}

/** Normalize CRLF and lone CR to LF. */
function normalizeNewlines(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === CODE_CR) {
      out += "\n";
      if (i + 1 < s.length && s.charCodeAt(i + 1) === CODE_LF) i++; // swallow LF of CRLF
    } else {
      out += s.charAt(i);
    }
  }
  return out;
}

// ─── extractDocumentText ──────────────────────────────────────────────────────

/**
 * Decode uploaded document bytes into normalized text.
 *
 * - `application/pdf` → `pdf_text_extraction_unsupported` (v1 limitation)
 * - other non-text content types → `unsupported_content_type`
 * - md/txt → UTF-8 decode, BOM strip, CRLF→LF normalize, control-char strip
 *   (keeps LF and TAB), trim, then length guards (50..100_000 chars).
 */
export function extractDocumentText(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string | undefined,
): ExtractDocumentTextResult {
  const normalizedType = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedType === "application/pdf") {
    return { ok: false, error: "pdf_text_extraction_unsupported" };
  }
  if (!TEXT_CONTENT_TYPES.has(normalizedType)) {
    return { ok: false, error: "unsupported_content_type" };
  }

  let raw = new TextDecoder("utf-8").decode(bytes);
  if (raw.charCodeAt(0) === CODE_BOM) raw = raw.slice(1);

  const text = stripControlChars(normalizeNewlines(raw)).trim();

  if (text.length < MIN_DOCUMENT_TEXT_CHARS) {
    return { ok: false, error: "document_too_short" };
  }
  if (text.length > MAX_DOCUMENT_TEXT_CHARS) {
    return { ok: false, error: "document_too_long" };
  }
  return { ok: true, text };
}

// ─── buildDocumentDraftPrompt ────────────────────────────────────────────────

const MAX_TITLE_CONTEXT_CHARS = 120;
const MAX_IDEA_CONTEXT_CHARS = 500;

/**
 * Compose the input string handed to the existing idea-to-spec generation path
 * (`generateIdeaToSpecDraft` takes an `idea` string). Deterministic — no LLM.
 *
 * The project title leads the string so the generation path's degraded
 * mock-fallback (which derives a product name from the head of the input)
 * still produces something meaningful.
 */
export function buildDocumentDraftPrompt(
  text: string,
  project: { title?: string; idea?: string } | null | undefined,
): string {
  const parts: string[] = [];
  const title = project?.title?.trim().slice(0, MAX_TITLE_CONTEXT_CHARS);
  const idea = project?.idea?.trim().slice(0, MAX_IDEA_CONTEXT_CHARS);
  if (title) parts.push(`${title} — 업로드된 기획 문서 기반 제품`);
  if (idea) parts.push(`기존 아이디어 메모: ${idea}`);
  parts.push(
    "아래는 사용자가 업로드한 기획 문서(PRD) 전문입니다. 이 문서 내용을 아이디어의 원천으로 삼아 제품 설명서 초안을 작성하세요.\n\n--- 문서 시작 ---\n" +
      text +
      "\n--- 문서 끝 ---",
  );
  return parts.join("\n\n");
}
