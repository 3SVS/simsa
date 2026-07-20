/**
 * workspace/repair-brief.ts — Stage 270
 *
 * Pure, dependency-free helpers that turn a Simsa fix brief (the
 * deterministic agent fix prompt built by nondev-report.ts
 * `buildAgentFixPrompt`) into input for the Conclave worker agent
 * (@simsa/agent-worker `ClaudeWorker.work(WorkerContext)`), plus the
 * safety rails around applying the worker's full-file rewrites inside the
 * repair container.
 *
 * CANONICAL SOURCE — the sandbox container compiles THIS file in-image
 * (container/Dockerfile, inspector-container Stage 263 pattern) so the
 * Worker build (dist/workspace/repair-brief.js) and the container runtime
 * always execute the same logic. Keep it free of imports: it must compile
 * standalone with `tsc --module es2022`.
 *
 * Brief format being parsed (buildAgentFixPrompt output, lock-stepped by
 * test/repair-brief.test.mjs):
 *
 *   [대상]
 *   - URL: <url>
 *   - 검수한 사용자 플로우: <flow>
 *   - 판정: <decision> (<korean>)
 *   [브라우저 관찰 사실]
 *   - ... free-form observation lines
 *   [고칠 문제 — 우선순위순]
 *   1. [높음] <what>
 *      - 원인 설명: <why>
 *      - 수정 방향: <how>
 *      - 증거: <evidence | 없음>
 *   [작업 규칙]
 *   - ...
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Severity enum matches @simsa/core BlockerSchema. */
export type RepairSeverity = "blocker" | "major" | "minor" | "nit";

export interface RepairFinding {
  /** Mapped to the core Blocker severity enum. */
  severity: RepairSeverity;
  /** Original Korean label from the brief (높음/중간/낮음/참고). */
  severityLabel: string;
  what: string;
  why?: string;
  how?: string;
  evidence?: string;
}

export interface ParsedRepairBrief {
  targetUrl?: string;
  flow?: string;
  decision?: string;
  observations: string[];
  findings: RepairFinding[];
  /** True when the [고칠 문제] section was present in the brief. */
  hasFindingsSection: boolean;
}

/** Structurally compatible with @simsa/core ReviewResult. */
export interface RepairReview {
  agent: string;
  verdict: "rework";
  summary: string;
  blockers: Array<{
    severity: RepairSeverity;
    category: string;
    message: string;
  }>;
}

export type RepairMode = "auto_fix" | "brief_only";

// ─── Brief parsing ────────────────────────────────────────────────────────────

const SEVERITY_FROM_KO: Record<string, RepairSeverity> = {
  높음: "blocker",
  중간: "major",
  낮음: "minor",
  참고: "nit",
};

export function mapFindingSeverity(koLabel: string): RepairSeverity {
  return SEVERITY_FROM_KO[koLabel.trim()] ?? "major";
}

const NO_FINDINGS_LINE = "고칠 문제가 관찰되지 않았습니다";

type Section = "none" | "target" | "observations" | "findings" | "rules";

/**
 * Parse a Simsa fix brief into structured parts. Tolerant of malformed
 * input: missing sections yield empty arrays / undefined fields, never a
 * throw — the caller falls back to brief-only mode when findings are empty.
 */
export function parseRepairBrief(brief: string): ParsedRepairBrief {
  const out: ParsedRepairBrief = {
    observations: [],
    findings: [],
    hasFindingsSection: false,
  };
  if (typeof brief !== "string" || brief.trim().length === 0) return out;

  let section: Section = "none";
  let current: RepairFinding | null = null;

  const flush = () => {
    if (current) out.findings.push(current);
    current = null;
  };

  for (const raw of brief.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[대상]")) {
      flush();
      section = "target";
      continue;
    }
    if (line.startsWith("[브라우저 관찰 사실]")) {
      flush();
      section = "observations";
      continue;
    }
    if (line.startsWith("[고칠 문제")) {
      flush();
      section = "findings";
      out.hasFindingsSection = true;
      continue;
    }
    if (line.startsWith("[작업 규칙]")) {
      flush();
      section = "rules";
      continue;
    }
    if (line.length === 0) continue;

    if (section === "target") {
      if (line.startsWith("- URL:")) {
        out.targetUrl = line.slice("- URL:".length).trim() || undefined;
      } else if (line.startsWith("- 검수한 사용자 플로우:")) {
        out.flow = line.slice("- 검수한 사용자 플로우:".length).trim() || undefined;
      } else if (line.startsWith("- 판정:")) {
        const rest = line.slice("- 판정:".length).trim();
        // "Needs Fix (수정 필요)" → keep the machine value before " ("
        const parenAt = rest.indexOf(" (");
        out.decision = (parenAt > 0 ? rest.slice(0, parenAt) : rest) || undefined;
      }
      continue;
    }

    if (section === "observations") {
      out.observations.push(line);
      continue;
    }

    if (section === "findings") {
      if (line.includes(NO_FINDINGS_LINE)) continue;
      const head = /^(\d+)\.\s*\[([^\]]+)\]\s*(.+)$/.exec(line);
      if (head) {
        flush();
        const label = head[2] ?? "";
        current = {
          severity: mapFindingSeverity(label),
          severityLabel: label,
          what: (head[3] ?? "").trim(),
        };
        continue;
      }
      if (!current) continue;
      const why = /^-\s*원인 설명:\s*(.*)$/.exec(line);
      if (why) {
        current.why = (why[1] ?? "").trim() || undefined;
        continue;
      }
      const how = /^-\s*수정 방향:\s*(.*)$/.exec(line);
      if (how) {
        current.how = (how[1] ?? "").trim() || undefined;
        continue;
      }
      const evidence = /^-\s*증거:\s*(.*)$/.exec(line);
      if (evidence) {
        const v = (evidence[1] ?? "").trim();
        current.evidence = v && v !== "없음" ? v : undefined;
        continue;
      }
      continue;
    }
  }
  flush();
  return out;
}

// ─── Mode decision ────────────────────────────────────────────────────────────

/**
 * Decide whether the repair job may attempt an actual worker-agent fix.
 * Honest boundary: no key → brief-only (Stage 268 semantics unchanged);
 * a brief with zero actionable findings gives the worker nothing to fix.
 */
export function decideRepairMode(input: {
  hasAnthropicKey: boolean;
  findingsCount: number;
}): { mode: RepairMode; reason: string } {
  if (!input.hasAnthropicKey) return { mode: "brief_only", reason: "no_anthropic_key" };
  if (input.findingsCount <= 0) return { mode: "brief_only", reason: "no_findings" };
  return { mode: "auto_fix", reason: "ready" };
}

// ─── Worker review input ──────────────────────────────────────────────────────

const MAX_FILE_LIST_IN_SUMMARY = 400;

/**
 * Build the ReviewResult-shaped input the worker prompt consumes
 * (buildWorkerPrompt renders reviews[i].summary + one line per blocker).
 * Simsa findings carry NO file attribution (they're browser observations),
 * so the summary carries the repo file list — the worker locates the cause
 * inside the provided snapshots.
 */
export function buildRepairReview(
  parsed: ParsedRepairBrief,
  opts: { agent?: string; repoFiles?: readonly string[] } = {},
): RepairReview {
  const summaryLines: string[] = [
    "Simsa가 실제 브라우저로 배포된 앱을 열어 관찰한 실패입니다. 아래 블로커는 브라우저 관찰 기반이라 파일 경로가 없습니다 — 제공된 파일 스냅샷 안에서 원인 코드를 찾아 수정하세요. 스냅샷에 원인 파일이 없으면 빈 rewrites 배열을 반환하세요.",
    "",
    // auto_fix 성숙 (2026-07-20): 모호한 UX 판정("버튼을 못 찾음")에서 워커가
    // 곧바로 포기해 brief_only로 떨어지던 실측 격차(apply-walmart) — 포기 전에
    // 관찰을 코드 가설로 번역해 스냅샷에서 확인하는 진단 사다리를 지시한다.
    // 반대쪽 레일(추측 수정 금지·빈 rewrites 허용)은 그대로 유지.
    "진단 규칙 — 관찰이 모호할수록 이 순서를 따르세요:",
    "1) 관찰이 '시작/입구/버튼을 못 찾음' 류(발견성 문제)라면: 첫 화면을 그리는 코드(index/main/App/초기 라우트)에서 (a) 핵심 동작 버튼이 실제로 렌더되는지, (b) 렌더 조건(로그인/데이터 유무/상태 분기)이 첫 방문자를 막고 있지 않은지, (c) 버튼 라벨이 위 사용자 플로우의 표현과 이어지는지를 차례로 확인하세요.",
    "2) 관찰이 '동작 후 변화 없음/저장 안 됨' 류라면: 해당 액션 핸들러에서 상태 갱신·재렌더·저장 호출(예: setState/render/localStorage/fetch)의 누락을 먼저 의심하세요.",
    "3) 코드 가설을 2~3개 세워 스냅샷에서 각각 확인하기 전에는 포기하지 마세요. 단, 어떤 가설도 코드에서 확인되지 않으면 추측으로 고치지 말고 빈 rewrites 배열을 반환하세요.",
  ];
  if (parsed.targetUrl) summaryLines.push(`- 검수 대상 URL: ${parsed.targetUrl}`);
  if (parsed.flow) summaryLines.push(`- 검수한 사용자 플로우: ${parsed.flow}`);
  if (parsed.decision) summaryLines.push(`- 판정: ${parsed.decision}`);
  if (parsed.observations.length > 0) {
    summaryLines.push("", "브라우저 관찰 사실:");
    for (const o of parsed.observations) summaryLines.push(`- ${o}`);
  }
  const files = (opts.repoFiles ?? []).slice(0, MAX_FILE_LIST_IN_SUMMARY);
  if (files.length > 0) {
    summaryLines.push("", `저장소 파일 목록 (${files.length}개${(opts.repoFiles?.length ?? 0) > files.length ? ", 일부" : ""}):`);
    for (const f of files) summaryLines.push(f);
  }

  return {
    agent: opts.agent ?? "simsa-inspector",
    verdict: "rework",
    summary: summaryLines.join("\n"),
    blockers: parsed.findings.map((f) => {
      const parts = [f.what];
      if (f.why) parts.push(`원인 설명: ${f.why}`);
      if (f.how) parts.push(`수정 방향: ${f.how}`);
      if (f.evidence) parts.push(`증거: ${f.evidence}`);
      return {
        severity: f.severity,
        category: "simsa-visual",
        message: parts.join(" — "),
      };
    }),
  };
}

// ─── Snapshot candidate ranking ───────────────────────────────────────────────

export const REPAIR_SNAPSHOT_BATCH_SIZE = 8;

const SNAPSHOT_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte",
  "html", "css", "scss", "json", "py", "go", "rb", "php", "java",
]);

const VENDOR_DIR_PATTERN =
  /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.git|\.svelte-kit|\.turbo)(\/|$)/;

const LOCKFILE_PATTERN = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

function extOf(p: string): string {
  const base = p.split("/").pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Is this repo file even a candidate for a worker snapshot? */
export function isSnapshotCandidate(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (VENDOR_DIR_PATTERN.test(norm)) return false;
  if (LOCKFILE_PATTERN.test(norm)) return false;
  if (/\.min\.(js|css)$/i.test(norm)) return false;
  if (isRepairFileDenied(norm)) return false;
  return SNAPSHOT_EXTENSIONS.has(extOf(norm));
}

/**
 * Extract search tokens from the brief's evidence/observations: URL path
 * segments (e.g. "/rest/v1/todos" → rest, v1, todos) and referenced file
 * names (e.g. "main.js:12" → main.js). Deterministic and lowercase.
 */
export function extractEvidenceTokens(parsed: ParsedRepairBrief): string[] {
  const texts: string[] = [];
  if (parsed.targetUrl) texts.push(parsed.targetUrl);
  for (const o of parsed.observations) texts.push(o);
  for (const f of parsed.findings) {
    texts.push(f.what);
    if (f.why) texts.push(f.why);
    if (f.how) texts.push(f.how);
    if (f.evidence) texts.push(f.evidence);
  }

  const tokens = new Set<string>();
  for (const text of texts) {
    // URL pathname segments
    for (const m of text.matchAll(/https?:\/\/[^\s'"<>)\]]+/g)) {
      const url = m[0];
      const afterHost = url.replace(/^https?:\/\/[^/]+/, "");
      const pathname = afterHost.split(/[?#]/)[0] ?? "";
      for (const seg of pathname.split("/")) {
        const s = seg.trim().toLowerCase();
        if (s.length >= 2 && !/^\d+$/.test(s)) tokens.add(s);
      }
    }
    // Explicit source-file references (console errors etc.)
    for (const m of text.matchAll(/[\w./-]*\b([\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|vue|svelte|css|html|json|py))\b/gi)) {
      const base = (m[1] ?? "").toLowerCase();
      if (base) tokens.add(base);
    }
  }
  return [...tokens];
}

/**
 * Rank repo files by likely relevance to the brief. Returns the FULL
 * ordered candidate list; the caller feeds batches of
 * REPAIR_SNAPSHOT_BATCH_SIZE per worker iteration (bounded retries with a
 * progressively different snapshot set instead of a file-request loop —
 * WorkerOutcome does not surface the model's free-text summary).
 */
export function rankSnapshotCandidates(
  parsed: ParsedRepairBrief,
  repoFiles: readonly string[],
): string[] {
  const tokens = extractEvidenceTokens(parsed);
  const scored: Array<{ path: string; score: number }> = [];

  for (const raw of repoFiles) {
    const p = raw.replace(/\\/g, "/");
    if (!isSnapshotCandidate(p)) continue;
    const lower = p.toLowerCase();
    const base = lower.split("/").pop() ?? lower;
    const baseNoExt = base.replace(/\.[^.]+$/, "");
    let score = 0;
    for (const t of tokens) {
      if (base === t || baseNoExt === t) score += 5;
      else if (base.includes(t)) score += 3;
      else if (lower.includes(t)) score += 1;
    }
    if (/^(index|main|app|server|api)\./.test(base)) score += 2;
    const top = lower.split("/")[0] ?? "";
    if (["src", "app", "pages", "api", "lib", "components"].includes(top)) score += 1;
    scored.push({ path: p, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return scored.map((s) => s.path);
}

/** Batch N of the ranked candidates for worker iteration `iteration` (0-based). */
export function pickSnapshotBatch(
  ranked: readonly string[],
  iteration: number,
  batchSize: number = REPAIR_SNAPSHOT_BATCH_SIZE,
): string[] {
  if (iteration < 0 || batchSize <= 0) return [];
  return ranked.slice(iteration * batchSize, (iteration + 1) * batchSize);
}

// ─── Rewrite application safety ───────────────────────────────────────────────

/** Mirror of @simsa/core DEFAULT_AUTOFIX_DENY_PATTERNS (kept dependency-free). */
const DENY_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env$/i,
  /^\.env\..*$/i,
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /secret/i,
  /\.credentials/i,
  /credentials\.json$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
];

export function isRepairFileDenied(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  const name = norm.split("/").pop() ?? norm;
  return DENY_NAME_PATTERNS.some((re) => re.test(name));
}

/** Obvious credential shapes the worker must never INTRODUCE into a repo. */
const SECRET_CONTENT_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export interface RejectedRewrite {
  path: string;
  reason:
    | "unsafe_path"
    | "denied_file"
    | "not_existing_file"
    | "empty_content"
    | "introduces_secret"
    | "duplicate_path";
}

/**
 * Validate worker rewrites before anything touches the working tree.
 *   - path must be repo-relative, no traversal, not deny-listed
 *   - must target an EXISTING repo file (the worker's own system prompt
 *     forbids creating files; enforce it here too)
 *   - content must be non-empty (a full-file rewrite to nothing is a
 *     deletion in disguise)
 *   - content must not introduce credential-shaped strings that were not
 *     already present in the original snapshot
 */
export function sanitizeRewrites(
  rewrites: ReadonlyArray<{ path: string; content: string }>,
  repoFiles: readonly string[],
  originals: Readonly<Record<string, string>> = {},
): { accepted: Array<{ path: string; content: string }>; rejected: RejectedRewrite[] } {
  const repoSet = new Set(repoFiles.map((f) => f.replace(/\\/g, "/")));
  const accepted: Array<{ path: string; content: string }> = [];
  const rejected: RejectedRewrite[] = [];
  const seen = new Set<string>();

  for (const rw of rewrites) {
    let p = String(rw.path ?? "").trim().replace(/\\/g, "/");
    while (p.startsWith("./")) p = p.slice(2);
    if (
      p.length === 0 ||
      p.startsWith("/") ||
      /^[A-Za-z]:/.test(p) ||
      p.split("/").includes("..")
    ) {
      rejected.push({ path: rw.path, reason: "unsafe_path" });
      continue;
    }
    if (seen.has(p)) {
      rejected.push({ path: p, reason: "duplicate_path" });
      continue;
    }
    if (isRepairFileDenied(p)) {
      rejected.push({ path: p, reason: "denied_file" });
      continue;
    }
    if (!repoSet.has(p)) {
      rejected.push({ path: p, reason: "not_existing_file" });
      continue;
    }
    const content = String(rw.content ?? "");
    if (content.trim().length === 0) {
      rejected.push({ path: p, reason: "empty_content" });
      continue;
    }
    if (SECRET_CONTENT_PATTERN.test(content) && !SECRET_CONTENT_PATTERN.test(originals[p] ?? "")) {
      rejected.push({ path: p, reason: "introduces_secret" });
      continue;
    }
    seen.add(p);
    accepted.push({ path: p, content });
  }
  return { accepted, rejected };
}

// ─── Oversize files: excerpt + exact-edit path ───────────────────────────────
// Files above the snapshot byte cap can't take the full-file rewrite contract
// (LLM output limits make wholesale reproduction truncation-prone, and HTML
// has no syntax gate to catch a truncated commit). Instead: deterministic
// EXCERPTS around the brief's evidence tokens go to the worker's edit mode,
// which returns exact search/replace pairs; applyExactEdits enforces the
// exactly-once match rule so a bad edit is rejected, never applied.
// (apply-walmart 실측: 389KB 단일 index.html — vibe 툴 전형 — 이 유일한
// 실코드가 스킵돼 auto_fix가 구조적으로 불가능한 클래스였다. 2026-07-20)

export interface OversizeExcerptRegion {
  startLine: number;
  endLine: number;
  text: string;
}

/** Tunables for buildOversizeExcerpts — exported for tests. */
export const OVERSIZE_EXCERPT_WINDOW_LINES = 40;
export const OVERSIZE_EXCERPT_MAX_REGIONS = 8;
export const OVERSIZE_EXCERPT_BUDGET_BYTES = 48 * 1024;

/**
 * Deterministically select regions of an oversize file worth showing the
 * edit-mode worker: a ±window around every line matching an evidence token,
 * merged when overlapping, capped by region count and total byte budget.
 * Regions keep the file's text VERBATIM (line numbers live in metadata only)
 * so the worker can copy exact search strings from them.
 *
 * Zero token matches → first window of the file (head) as a last resort:
 * single-file vibe apps concentrate wiring near the top, and an empty
 * excerpt list would silently skip the file entirely.
 */
export function buildOversizeExcerpts(
  content: string,
  tokens: readonly string[],
  opts: {
    windowLines?: number;
    maxRegions?: number;
    budgetBytes?: number;
  } = {},
): OversizeExcerptRegion[] {
  const windowLines = opts.windowLines ?? OVERSIZE_EXCERPT_WINDOW_LINES;
  const maxRegions = opts.maxRegions ?? OVERSIZE_EXCERPT_MAX_REGIONS;
  const budgetBytes = opts.budgetBytes ?? OVERSIZE_EXCERPT_BUDGET_BYTES;

  const lines = content.split("\n");
  const lowerTokens = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);

  // 1-based line hits, in file order.
  const hitLines: number[] = [];
  if (lowerTokens.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lower = line.toLowerCase();
      if (lowerTokens.some((t) => lower.includes(t))) hitLines.push(i + 1);
    }
  }
  if (hitLines.length === 0) hitLines.push(1); // head-of-file fallback

  // Expand each hit to a window, then merge overlaps (file order preserved).
  const windows: Array<{ start: number; end: number }> = [];
  for (const hit of hitLines) {
    const start = Math.max(1, hit - windowLines);
    const end = Math.min(lines.length, hit + windowLines);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }

  // Emit regions under the caps. (TextEncoder over Buffer — this module is
  // consumed by the container today, but stays runtime-neutral by design.)
  const utf8 = new TextEncoder();
  const regions: OversizeExcerptRegion[] = [];
  let spent = 0;
  for (const w of windows) {
    if (regions.length >= maxRegions) break;
    const text = lines.slice(w.start - 1, w.end).join("\n");
    const bytes = utf8.encode(text).length;
    if (spent + bytes > budgetBytes) {
      if (regions.length === 0) {
        // Always emit at least one region — trim to budget on a line boundary.
        const kept: string[] = [];
        let acc = 0;
        for (const line of lines.slice(w.start - 1, w.end)) {
          const b = utf8.encode(line).length + 1;
          if (acc + b > budgetBytes) break;
          kept.push(line);
          acc += b;
        }
        if (kept.length > 0) {
          regions.push({ startLine: w.start, endLine: w.start + kept.length - 1, text: kept.join("\n") });
        }
      }
      break;
    }
    regions.push({ startLine: w.start, endLine: w.end, text });
    spent += bytes;
  }
  return regions;
}

export interface RejectedEdit {
  path: string;
  reason:
    | "unsafe_path"
    | "denied_file"
    | "not_excerpted_file"
    | "empty_search"
    | "search_not_found"
    | "search_ambiguous"
    | "noop_edit"
    | "introduces_secret";
}

/**
 * Apply exact search/replace edits to in-memory file contents, enforcing the
 * exactly-once rule per edit:
 *   - search must occur EXACTLY ONCE in the file's CURRENT content (earlier
 *     accepted edits included) — 0 hits rejects as search_not_found, 2+ as
 *     search_ambiguous. No fuzzy matching, no line arithmetic.
 *   - path must be one of the provided files (the excerpt set), pass the
 *     deny-list, and contain no traversal.
 *   - replace must not introduce credential-shaped strings the original
 *     didn't already contain.
 * Returns updated contents plus per-edit accept/reject records. Rejected
 * edits never touch the content — partial application is intentional (apply
 * what verifies, report the rest).
 */
export function applyExactEdits(
  files: Readonly<Record<string, string>>,
  edits: ReadonlyArray<{ path: string; search: string; replace: string }>,
): {
  contents: Record<string, string>;
  applied: Array<{ path: string; search: string }>;
  rejected: RejectedEdit[];
} {
  const contents: Record<string, string> = { ...files };
  const applied: Array<{ path: string; search: string }> = [];
  const rejected: RejectedEdit[] = [];

  for (const edit of edits) {
    let p = String(edit.path ?? "").trim().replace(/\\/g, "/");
    while (p.startsWith("./")) p = p.slice(2);
    if (p.length === 0 || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) {
      rejected.push({ path: edit.path, reason: "unsafe_path" });
      continue;
    }
    if (isRepairFileDenied(p)) {
      rejected.push({ path: p, reason: "denied_file" });
      continue;
    }
    if (!(p in contents)) {
      rejected.push({ path: p, reason: "not_excerpted_file" });
      continue;
    }
    const search = String(edit.search ?? "");
    if (search.length === 0) {
      rejected.push({ path: p, reason: "empty_search" });
      continue;
    }
    const replace = String(edit.replace ?? "");
    if (search === replace) {
      rejected.push({ path: p, reason: "noop_edit" });
      continue;
    }
    const current = contents[p] ?? "";
    const first = current.indexOf(search);
    if (first === -1) {
      rejected.push({ path: p, reason: "search_not_found" });
      continue;
    }
    if (current.indexOf(search, first + 1) !== -1) {
      rejected.push({ path: p, reason: "search_ambiguous" });
      continue;
    }
    if (SECRET_CONTENT_PATTERN.test(replace) && !SECRET_CONTENT_PATTERN.test(files[p] ?? "")) {
      rejected.push({ path: p, reason: "introduces_secret" });
      continue;
    }
    contents[p] = current.slice(0, first) + replace + current.slice(first + search.length);
    applied.push({ path: p, search });
  }

  return { contents, applied, rejected };
}

// ─── Auto-fix PR content ──────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<"ko" | "en", Record<RepairSeverity, string>> = {
  ko: { blocker: "높음", major: "중간", minor: "낮음", nit: "참고" },
  en: { blocker: "high", major: "medium", minor: "low", nit: "note" },
};

/** Train E (2026-07-21) — repair PR 산문 로케일. 미지정 = ko(기존 동작). */
export type RepairPrLocale = "ko" | "en";

const PR_COPY = {
  ko: {
    titlePrefix: "Simsa 자동 수리: ",
    defaultIntent: "핵심 기능 점검",
    commitBody1: "Simsa 시각 검수에서 발견된 문제를 워커 에이전트가 자동 수정한 커밋입니다.",
    commitBody2: "수리 근거: 같은 브랜치의 SIMSA-FIX-BRIEF.md 참고.",
    workerSummaryPrefix: "워커 요약: ",
    heading: "## Simsa 자동 수리 결과",
    lead: "Simsa가 실제 브라우저로 앱을 검수해 발견한 문제를, 워커 에이전트가 이 브랜치의 코드에 직접 수정했습니다.",
    target: "검수 대상",
    verdict: "판정",
    noRecord: "(기록 없음)",
    runIdLabel: "검사 ID",
    findingsHeading: "### 발견된 문제와 조치",
    fixDirection: "수정 방향: ",
    noFindings: "- (브리프에 개별 문제 항목이 없습니다)",
    oversizeHeading: "### 큰 파일은 필요한 부분만 고쳤어요",
    oversizeBody1: "위 파일은 한 번에 다시 쓰기엔 커서, 문제와 관련된 부분만 발췌해 정확히 일치하는 곳만 바꿨어요.",
    oversizeBody2: "바꾼 곳 외의 내용은 그대로예요.",
    cautionLine1: "> **주의: 자동 생성된 수정입니다.** 머지 전에 반드시 코드 리뷰와 실제 동작 확인을 해주세요.",
    cautionLine2: "> 수리 근거(검수 증거 + 지시서)는 이 브랜치의 `SIMSA-FIX-BRIEF.md`에 있습니다.",
    envCause1: "> **환경 원인 가능성:** 증거에 백엔드 주소가 응답하지 않는 패턴(DNS/연결 실패)이 포함되어 있습니다.",
    envCause2: "> 코드 수정만으로 완전히 해결되지 않을 수 있어요 — 환경 변수(백엔드 주소 등) 설정도 함께 확인하세요.",
  },
  en: {
    titlePrefix: "Simsa auto-repair: ",
    defaultIntent: "core feature check",
    commitBody1: "This commit was written by Simsa's worker agent to fix problems found by the visual inspection.",
    commitBody2: "Rationale: see SIMSA-FIX-BRIEF.md on this branch.",
    workerSummaryPrefix: "Worker summary: ",
    heading: "## Simsa auto-repair result",
    lead: "Simsa inspected your app in a real browser, and the worker agent fixed the problems it found directly on this branch.",
    target: "Inspected",
    verdict: "Verdict",
    noRecord: "(not recorded)",
    runIdLabel: "Check ID",
    findingsHeading: "### Problems found & what was done",
    fixDirection: "Fix direction: ",
    noFindings: "- (the brief carried no individual findings)",
    oversizeHeading: "### Large files were edited in place",
    oversizeBody1: "The file(s) above are too large to rewrite wholesale, so only the excerpted regions relevant to the problems were changed — each edit applied only where it matched exactly.",
    oversizeBody2: "Everything outside those spots is untouched.",
    cautionLine1: "> **Caution: this is an auto-generated fix.** Review the code and verify the app actually works before merging.",
    cautionLine2: "> The evidence and instructions live in `SIMSA-FIX-BRIEF.md` on this branch.",
    envCause1: "> **Possible environment cause:** the evidence includes a backend address that never responded (DNS/connection failure).",
    envCause2: "> A code fix alone may not fully resolve this — also check your environment variables (backend URL, etc.).",
  },
} as const;

/**
 * Deterministic PR + commit content for the auto_fix path (no LLM output in
 * titles; the worker's own commit summary is quoted in the body). The PR is
 * NON-draft — real code changed — with an honest review-before-merge note.
 * Never receives tokens/keys; derived only from the parsed brief + git facts.
 */
export function buildAutoFixPrContent(input: {
  runId: string;
  intent?: string;
  decision?: string;
  targetUrl?: string;
  visualCheckId?: string;
  envCause?: boolean;
  findings: readonly RepairFinding[];
  changedFiles: readonly string[];
  workerCommitMessage?: string;
  /**
   * Files fixed via the oversize excerpt+edit path (too big for full-file
   * rewrites). Named in the PR body so a reviewer knows the worker saw
   * excerpts, not the whole file — honesty over silence.
   */
  editedOversizeFiles?: readonly string[];
  /** Reader's locale for the PR prose (Train E). Omitted = ko (기존 동작). */
  locale?: RepairPrLocale;
}): { title: string; commitMessage: string; commitBody: string; body: string } {
  const loc: RepairPrLocale = input.locale === "en" ? "en" : "ko";
  const C = PR_COPY[loc];
  const intent = (input.intent ?? "").trim() || C.defaultIntent;
  const shortIntent = intent.length > 60 ? `${intent.slice(0, 57)}...` : intent;
  const title = `${C.titlePrefix}${shortIntent}`;
  const commitMessage = `fix(simsa): apply repair for ${input.runId}`;
  const commitBody = [
    C.commitBody1,
    C.commitBody2,
    ...(input.workerCommitMessage ? [`${C.workerSummaryPrefix}${input.workerCommitMessage}`] : []),
  ].join("\n");

  const changedLabel =
    loc === "en"
      ? `- ${input.changedFiles.length} file(s) changed:`
      : `- 변경 파일 ${input.changedFiles.length}개:`;
  const lines: string[] = [
    C.heading,
    "",
    C.lead,
    "",
    `- ${C.target}: ${input.targetUrl || C.noRecord}`,
    `- ${C.verdict}: ${input.decision || "Not Judged"}`,
    ...(input.visualCheckId ? [`- ${C.runIdLabel}: \`${input.visualCheckId}\``] : []),
    changedLabel,
    ...input.changedFiles.map((f) => `  - \`${f}\``),
    "",
    C.findingsHeading,
  ];
  if (input.findings.length > 0) {
    input.findings.forEach((f, i) => {
      lines.push(`${i + 1}. [${SEVERITY_LABEL[loc][f.severity]}] ${f.what}`);
      if (f.how) lines.push(`   - ${C.fixDirection}${f.how}`);
    });
  } else {
    lines.push(C.noFindings);
  }
  if (input.workerCommitMessage) {
    lines.push("", `${C.workerSummaryPrefix}${input.workerCommitMessage}`);
  }
  if (input.editedOversizeFiles && input.editedOversizeFiles.length > 0) {
    lines.push(
      "",
      C.oversizeHeading,
      ...input.editedOversizeFiles.map((f) => `- \`${f}\``),
      "",
      C.oversizeBody1,
      C.oversizeBody2,
    );
  }
  lines.push(
    "",
    C.cautionLine1,
    C.cautionLine2,
    "",
    // Simsa repair PRs must NOT be re-reviewed by the legacy Conclave council
    // App (double review + double credit burn on repos where users installed
    // it — 2026-07-21 실측: simsa-autofix-test PR#1). The pull_request webhook
    // honors [skip conclave]; the HTML comment keeps it invisible in render.
    "<!-- [skip conclave] -->",
    "",
  );
  if (input.envCause === true) {
    lines.push(C.envCause1, C.envCause2, "");
  }

  return { title, commitMessage, commitBody, body: lines.join("\n") };
}
