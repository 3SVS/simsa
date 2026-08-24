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

/** 붙여넣은 GitHub 주소를 owner/repo로 정규화. 형태가 아니면 null. */
export function normalizeGithubRepoRef(input: string | null | undefined): string | null;

/** 연결 시점 도달성 (central-plane workspace/source-reachability.ts와 동형). */
export type Reachability =
  | { state: "readable"; visibility: "public" | "private"; via: "anonymous" | "user_token" }
  | { state: "needs_access"; via: "anonymous" | "user_token" }
  | { state: "unknown"; reason: "rate_limited" | "network" | "timeout" };

export type ReachabilityNotice = {
  tone: "ok" | "warn" | "info";
  key: "siteReadable" | "repoReadablePublic" | "repoReadablePrivate" | "repoNeedsAccess" | "repoUnknown" | "siteUnknown";
  showInstall: boolean;
};

/** 연결 직후 보여줄 안내 선택. 막는 문구가 아니라 알려주는 문구. */
export function reachabilityNotice(
  type: "website" | "github_repo",
  reachability: Reachability | null | undefined,
): ReachabilityNotice | null;
export const MAX_DOCUMENT_BYTES: number;
export const DOCUMENT_EXTENSIONS: string[];

export function validateSourceInput(type: string, reference: string): SourceValidation;

export function validateDocumentFile(name: string, sizeBytes: number): DocumentValidation;

export function sourceTypeLabel(type: string, t: Dictionary): string;

export function formatBytes(n: number): string;
