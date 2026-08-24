// Stage 262: pure helpers for the project Sources (연결) panel.
//
// PURE — no network, no storage. Validation mirrors the central-plane rules
// (workspace-sources.ts) so users get instant feedback before any request,
// and the server stays authoritative.

/** owner/repo — the same shape GitHub (and the central plane) accepts. */
export const GITHUB_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/**
 * 사용자가 붙여넣는 GitHub 주소를 owner/repo로 정규화한다.
 * central-plane `workspace/github-repo-ref.ts`의 **거울**이며, 두 구현이 갈리지 않도록
 * 양쪽 테스트가 **동일한 입력 표**를 공유한다(github-repo-ref.test.mjs ↔ 이 파일의 테스트).
 *
 * 클라이언트 검증은 서버보다 **엄격하면 안 된다** — 엄격하면 서버가 받아주는 입력을
 * 화면이 먼저 거절해 기능이 통째로 무력화된다(2026-08-23 실제 사고: 서버는 주소를
 * 받도록 고쳤는데 이 파일이 여전히 owner/repo만 통과시켜 UI에서는 아무것도 달라지지 않았다).
 */
export function normalizeGithubRepoRef(input) {
  let ref = typeof input === "string" ? input.trim() : "";
  if (!ref) return null;
  const beforeHost = ref;
  ref = ref.replace(/^git@github\.com:/i, "");
  ref = ref.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  // 호스트를 떼어냈다 = 주소를 붙여넣은 것. 손으로 친 a/b/c는 오타이므로 자르지 않는다.
  const fromUrl = ref !== beforeHost;
  ref = ref.replace(/[?#].*$/, "");
  ref = ref.replace(/\.git$/i, "");
  ref = ref.replace(/\/+$/, "");
  if (fromUrl) {
    const parts = ref.split("/").filter(Boolean);
    if (parts.length > 2) ref = `${parts[0]}/${parts[1]}`;
  }
  return GITHUB_REPO_RE.test(ref) ? ref : null;
}

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
    // 주소를 그대로 붙여넣는 것이 실제 사용 패턴이다. 정규화해서 판단하되,
    // 서버가 최종 권위 — 여기서는 명백히 형태가 아닌 것만 즉시 되돌려준다.
    if (!ref || ref.length > MAX_REFERENCE_LEN || normalizeGithubRepoRef(ref) === null) {
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

/**
 * 연결 직후 보여줄 안내를 고른다 — **막는 문구가 아니라 알려주는 문구**.
 *
 * 세 상태를 뭉뜽그리지 않는 것이 핵심이다:
 *   readable      → 지금 이대로 된다(비공개인데 내 토큰으로 보이는 경우 포함)
 *   needs_access  → 우리 눈엔 안 보인다. **비공개일 수도, 주소 오타일 수도** 있으므로
 *                   두 갈래를 다 열어 둔 문구를 쓴다. 여기서만 App 설치를 권한다.
 *   unknown       → 재지 못했다. "안 된다"고 말하면 거짓말이 된다 — 연결은 됐다고만 한다.
 *
 * 반환: { tone, key, showInstall } — 문구는 사전에서, 색은 tone에서.
 */
export function reachabilityNotice(type, reachability) {
  const r = reachability ?? null;
  if (!r) return null;
  if (r.state === "readable") {
    if (type === "website") return { tone: "ok", key: "siteReadable", showInstall: false };
    return {
      tone: "ok",
      key: r.visibility === "private" ? "repoReadablePrivate" : "repoReadablePublic",
      showInstall: false,
    };
  }
  if (r.state === "needs_access") {
    return { tone: "warn", key: "repoNeedsAccess", showInstall: true };
  }
  return { tone: "info", key: type === "website" ? "siteUnknown" : "repoUnknown", showInstall: false };
}
