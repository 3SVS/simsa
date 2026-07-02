// Type declarations for project-sources.mjs (Stage 262).
import type { Dictionary } from "../i18n/dictionary.mjs";

export type SourceType = "website" | "github_repo" | "document";

export type SourceValidation =
  | { ok: true }
  | { ok: false; error: "invalid_url" | "invalid_repo" | "invalid_type" };

export type DocumentValidation =
  | { ok: true }
  | { ok: false; error: "unsupported_file_type" | "file_too_large" };

export const GITHUB_REPO_RE: RegExp;
export const MAX_DOCUMENT_BYTES: number;
export const DOCUMENT_EXTENSIONS: string[];

export function validateSourceInput(type: string, reference: string): SourceValidation;

export function validateDocumentFile(name: string, sizeBytes: number): DocumentValidation;

export function sourceTypeLabel(type: string, t: Dictionary): string;

export function formatBytes(n: number): string;
