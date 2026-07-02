// Stage 262: pure helpers for the project Sources (연결) panel.
//
// PURE — no network, no storage. Validation mirrors the central-plane rules
// (workspace-sources.ts) so users get instant feedback before any request,
// and the server stays authoritative.

/** owner/repo — the same shape GitHub (and the central plane) accepts. */
export const GITHUB_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Upload cap mirrored from the central plane (10MB). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Allowed document extensions (PRD-style files). */
export const DOCUMENT_EXTENSIONS = ["md", "txt", "pdf"];

const MAX_REFERENCE_LEN = 500;

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Client-side mirror of the central-plane connect validation.
 * Returns { ok: true } or { ok: false, error } where error is one of the
 * server's error codes (invalid_url | invalid_repo | invalid_type) so the
 * same localized message map handles both local and server failures.
 */
export function validateSourceInput(type, reference) {
  const ref = typeof reference === "string" ? reference.trim() : "";
  if (type === "website") {
    if (!ref || ref.length > MAX_REFERENCE_LEN || !isValidHttpUrl(ref)) {
      return { ok: false, error: "invalid_url" };
    }
    return { ok: true };
  }
  if (type === "github_repo") {
    if (!ref || ref.length > MAX_REFERENCE_LEN || !GITHUB_REPO_RE.test(ref)) {
      return { ok: false, error: "invalid_repo" };
    }
    return { ok: true };
  }
  return { ok: false, error: "invalid_type" };
}

/**
 * Client-side pre-check for a document upload (extension allowlist + size cap).
 * The server re-validates; this only saves the user a round trip.
 */
export function validateDocumentFile(name, sizeBytes) {
  const base = typeof name === "string" ? name.split(/[\\/]/).pop() ?? "" : "";
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  if (!DOCUMENT_EXTENSIONS.includes(ext)) {
    return { ok: false, error: "unsupported_file_type" };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "file_too_large" };
  }
  return { ok: true };
}

/** Localized label for a source type badge. Unknown types fall through raw. */
export function sourceTypeLabel(type, t) {
  if (type === "website") return t.sources.typeWebsite;
  if (type === "github_repo") return t.sources.typeGithub;
  if (type === "document") return t.sources.typeDocument;
  return String(type ?? "");
}

/** Human-readable size for a document source ("" when size is unknown). */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
