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

// ─── Auto-fix PR content ──────────────────────────────────────────────────────

const SEVERITY_KO_LABEL: Record<RepairSeverity, string> = {
  blocker: "높음",
  major: "중간",
  minor: "낮음",
  nit: "참고",
};

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
}): { title: string; commitMessage: string; commitBody: string; body: string } {
  const intent = (input.intent ?? "").trim() || "핵심 기능 점검";
  const shortIntent = intent.length > 60 ? `${intent.slice(0, 57)}...` : intent;
  const title = `Simsa 자동 수리: ${shortIntent}`;
  const commitMessage = `fix(simsa): apply repair for ${input.runId}`;
  const commitBody = [
    "Simsa 시각 검수에서 발견된 문제를 워커 에이전트가 자동 수정한 커밋입니다.",
    "수리 근거: 같은 브랜치의 SIMSA-FIX-BRIEF.md 참고.",
    ...(input.workerCommitMessage ? [`워커 요약: ${input.workerCommitMessage}`] : []),
  ].join("\n");

  const lines: string[] = [
    "## Simsa 자동 수리 결과",
    "",
    "Simsa가 실제 브라우저로 앱을 검수해 발견한 문제를, 워커 에이전트가 이 브랜치의 코드에 직접 수정했습니다.",
    "",
    `- 검수 대상: ${input.targetUrl || "(기록 없음)"}`,
    `- 판정: ${input.decision || "Not Judged"}`,
    ...(input.visualCheckId ? [`- 검사 ID: \`${input.visualCheckId}\``] : []),
    `- 변경 파일 ${input.changedFiles.length}개:`,
    ...input.changedFiles.map((f) => `  - \`${f}\``),
    "",
    "### 발견된 문제와 조치",
  ];
  if (input.findings.length > 0) {
    input.findings.forEach((f, i) => {
      lines.push(`${i + 1}. [${SEVERITY_KO_LABEL[f.severity]}] ${f.what}`);
      if (f.how) lines.push(`   - 수정 방향: ${f.how}`);
    });
  } else {
    lines.push("- (브리프에 개별 문제 항목이 없습니다)");
  }
  if (input.workerCommitMessage) {
    lines.push("", `워커 커밋 요약: ${input.workerCommitMessage}`);
  }
  lines.push(
    "",
    "> **주의: 자동 생성된 수정입니다.** 머지 전에 반드시 코드 리뷰와 실제 동작 확인을 해주세요.",
    "> 수리 근거(검수 증거 + 지시서)는 이 브랜치의 `SIMSA-FIX-BRIEF.md`에 있습니다.",
    "",
  );
  if (input.envCause === true) {
    lines.push(
      "> **환경 원인 가능성:** 증거에 백엔드 주소가 응답하지 않는 패턴(DNS/연결 실패)이 포함되어 있습니다.",
      "> 코드 수정만으로 완전히 해결되지 않을 수 있어요 — 환경 변수(백엔드 주소 등) 설정도 함께 확인하세요.",
      "",
    );
  }

  return { title, commitMessage, commitBody, body: lines.join("\n") };
}
