/**
 * repair-brief.test.mjs — Stage 270
 *
 * Pure helpers that turn a Simsa fix brief into worker-agent input
 * (src/workspace/repair-brief.ts — the SAME source the sandbox container
 * compiles in-image, see container/Dockerfile):
 *   - parseRepairBrief — incl. LOCK-STEP against buildAgentFixPrompt output
 *     (nondev-report.ts): if the brief format drifts, this file fails.
 *   - malformed-brief tolerance (no throws, safe fallbacks)
 *   - decideRepairMode — auto_fix vs brief_only decisions
 *   - buildRepairReview — ReviewResult-shaped worker input
 *   - snapshot candidate ranking + batching
 *   - sanitizeRewrites — path traversal / deny-list / new-file / secret rails
 *   - buildAutoFixPrContent — non-draft PR + commit content, honest notes
 *
 * No network, no LLM, no filesystem beyond imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  parseRepairBrief,
  mapFindingSeverity,
  decideRepairMode,
  buildRepairReview,
  extractEvidenceTokens,
  rankSnapshotCandidates,
  pickSnapshotBatch,
  REPAIR_SNAPSHOT_BATCH_SIZE,
  isSnapshotCandidate,
  isRepairFileDenied,
  sanitizeRewrites,
  buildAutoFixPrContent,
} = await import("../dist/workspace/repair-brief.js");
const { buildAgentFixPrompt } = await import("../dist/nondev-report.js");

/** Realistic check input — produces DNS-failure + console-error + failed-step findings. */
const CHECK_INPUT = {
  targetUrl: "https://golf-now.example.app/courses",
  intentAnchor: "골퍼가 코스 목록을 볼 수 있어야 한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: "/courses",
  routeChanged: false,
  consoleErrors: ["TypeError: Cannot read properties of undefined (reading 'map') at courses.js:41"],
  networkFailures: ["GET https://dead.supabase.co/rest/v1/courses net::ERR_NAME_NOT_RESOLVED"],
  decision: "Needs Fix",
  steps: [{ label: "코스 목록 확인", ok: false, note: "목록이 비어 있음" }],
};

// ─── parseRepairBrief: lock-step with buildAgentFixPrompt ─────────────────────

test("parseRepairBrief: parses a REAL buildAgentFixPrompt brief (lock-step)", () => {
  const brief = buildAgentFixPrompt(CHECK_INPUT);
  const parsed = parseRepairBrief(brief);

  assert.equal(parsed.targetUrl, CHECK_INPUT.targetUrl);
  assert.equal(parsed.flow, CHECK_INPUT.intentAnchor);
  assert.equal(parsed.decision, "Needs Fix");
  assert.equal(parsed.hasFindingsSection, true);
  assert.ok(parsed.observations.length >= 4, "observation lines captured");
  assert.ok(
    parsed.observations.some((o) => o.includes("ERR_NAME_NOT_RESOLVED")),
    "network failure evidence appears in observations",
  );

  // classifyFindings on this input: DNS(high) + console(medium) + failed step(medium)
  assert.equal(parsed.findings.length, 3);
  const dns = parsed.findings[0];
  assert.equal(dns.severity, "blocker", "높음 → blocker");
  assert.equal(dns.severityLabel, "높음");
  assert.match(dns.what, /서버 주소를 찾지 못했어요/);
  assert.ok(dns.why && dns.why.length > 0, "원인 설명 captured");
  assert.ok(dns.how && dns.how.length > 0, "수정 방향 captured");
  assert.match(dns.evidence ?? "", /ERR_NAME_NOT_RESOLVED/);

  const step = parsed.findings[2];
  assert.equal(step.severity, "major", "중간 → major");
  assert.match(step.what, /코스 목록 확인/);
});

test("parseRepairBrief: '증거: 없음' → evidence undefined; no-findings brief → empty findings", () => {
  const clean = buildAgentFixPrompt({
    ...CHECK_INPUT,
    consoleErrors: [],
    networkFailures: [],
    steps: [],
    decision: "Ready",
  });
  const parsed = parseRepairBrief(clean);
  assert.equal(parsed.hasFindingsSection, true);
  assert.equal(parsed.findings.length, 0, "'고칠 문제가 관찰되지 않았습니다' line yields zero findings");

  const manual = [
    "[고칠 문제 — 우선순위순]",
    "1. [중간] 화면에서 코드 오류가 났어요.",
    "   - 원인 설명: 자바스크립트 실행 중 문제가 생겼어요.",
    "   - 수정 방향: 콘솔 오류를 참고해 고치세요.",
    "   - 증거: 없음",
  ].join("\n");
  const p2 = parseRepairBrief(manual);
  assert.equal(p2.findings.length, 1);
  assert.equal(p2.findings[0].evidence, undefined, "'없음' must not become evidence text");
});

test("parseRepairBrief: malformed briefs never throw — empty / non-brief text / headless bullets", () => {
  for (const bad of ["", "   \n  ", "그냥 아무 텍스트", "- 원인 설명: 고아 서브라인\n2. 번호만"]) {
    const parsed = parseRepairBrief(bad);
    assert.deepEqual(parsed.findings, [], `findings empty for ${JSON.stringify(bad.slice(0, 20))}`);
    assert.equal(parsed.hasFindingsSection, false);
  }
  // sub-lines before any numbered head are dropped, not attached to a ghost finding
  const orphan = parseRepairBrief("[고칠 문제 — 우선순위순]\n   - 수정 방향: 고아 라인\n1. [높음] 진짜 문제");
  assert.equal(orphan.findings.length, 1);
  assert.equal(orphan.findings[0].what, "진짜 문제");
  assert.equal(orphan.findings[0].how, undefined);
});

test("mapFindingSeverity: 높음/중간/낮음/참고 map to core enum; unknown → major", () => {
  assert.equal(mapFindingSeverity("높음"), "blocker");
  assert.equal(mapFindingSeverity("중간"), "major");
  assert.equal(mapFindingSeverity("낮음"), "minor");
  assert.equal(mapFindingSeverity("참고"), "nit");
  assert.equal(mapFindingSeverity("치명"), "major");
});

// ─── mode decision ────────────────────────────────────────────────────────────

test("decideRepairMode: no key → brief_only; key + findings → auto_fix; key + zero findings → brief_only", () => {
  assert.deepEqual(decideRepairMode({ hasAnthropicKey: false, findingsCount: 3 }), {
    mode: "brief_only",
    reason: "no_anthropic_key",
  });
  assert.deepEqual(decideRepairMode({ hasAnthropicKey: true, findingsCount: 0 }), {
    mode: "brief_only",
    reason: "no_findings",
  });
  assert.deepEqual(decideRepairMode({ hasAnthropicKey: true, findingsCount: 2 }), {
    mode: "auto_fix",
    reason: "ready",
  });
});

// ─── worker review input ──────────────────────────────────────────────────────

test("buildRepairReview: ReviewResult-shaped input — verdict rework, one blocker per finding, summary carries context + file list", () => {
  const parsed = parseRepairBrief(buildAgentFixPrompt(CHECK_INPUT));
  const review = buildRepairReview(parsed, { repoFiles: ["src/app.js", "src/courses.js"] });

  assert.equal(review.verdict, "rework");
  assert.equal(review.agent, "simsa-inspector");
  assert.equal(review.blockers.length, parsed.findings.length);
  for (const b of review.blockers) {
    assert.ok(["blocker", "major", "minor", "nit"].includes(b.severity));
    assert.equal(b.category, "simsa-visual");
    assert.ok(b.message.length > 0);
  }
  assert.match(review.blockers[0].message, /수정 방향:/, "blocker message carries the fix direction");
  assert.ok(review.summary.includes(CHECK_INPUT.targetUrl));
  assert.ok(review.summary.includes("src/courses.js"), "repo file list included for file location");
  assert.match(review.summary, /파일 경로가 없습니다/, "explains why blockers carry no file field");
});

test("buildRepairReview: diagnosis ladder for ambiguous UX findings (auto_fix 성숙 2026-07-20)", () => {
  // 실측 격차(apply-walmart): '시작 버튼 못 찾음' 류 모호 판정에서 워커가 즉시
  // 포기 → brief_only. 지시에 발견성/무변화 두 축의 코드-가설 사다리와
  // '가설 확인 전 포기 금지 + 추측 수정 금지' 양쪽 레일이 모두 있어야 한다.
  const parsed = parseRepairBrief(buildAgentFixPrompt(CHECK_INPUT));
  const review = buildRepairReview(parsed, { repoFiles: ["src/app.js"] });
  assert.match(review.summary, /진단 규칙/, "diagnosis rules present");
  assert.match(review.summary, /못 찾음/, "discoverability branch present");
  assert.match(review.summary, /변화 없음|저장 안 됨/, "no-change branch present");
  assert.match(review.summary, /포기하지 마세요/, "no-early-give-up rail present");
  assert.match(review.summary, /빈 rewrites 배열을 반환/, "no-guess rail preserved");
});

// ─── snapshot ranking + batching ──────────────────────────────────────────────

test("rankSnapshotCandidates: evidence-token files rank first; vendor/lockfiles/secrets excluded", () => {
  const parsed = parseRepairBrief(buildAgentFixPrompt(CHECK_INPUT));
  const tokens = extractEvidenceTokens(parsed);
  assert.ok(tokens.includes("courses"), "URL path segment extracted");
  assert.ok(tokens.includes("courses.js"), "console-error file reference extracted");

  const ranked = rankSnapshotCandidates(parsed, [
    "README.md",
    "node_modules/react/index.js",
    "dist/bundle.js",
    "package-lock.json",
    ".env",
    "secrets.js",
    "src/utils/format.js",
    "src/courses.js",
    "src/main.js",
  ]);
  assert.equal(ranked[0], "src/courses.js", "token-matched file first");
  assert.ok(!ranked.includes("node_modules/react/index.js"), "vendor excluded");
  assert.ok(!ranked.includes("dist/bundle.js"), "build output excluded");
  assert.ok(!ranked.includes("package-lock.json"), "lockfile excluded");
  assert.ok(!ranked.includes(".env"), "deny-listed excluded");
  assert.ok(!ranked.includes("secrets.js"), "secret-named file excluded");
  assert.ok(!ranked.includes("README.md"), "non-code extension excluded");
  assert.ok(ranked.includes("src/utils/format.js"), "unmatched code files stay as later candidates");

  assert.equal(isSnapshotCandidate("src/app.ts"), true);
  assert.equal(isSnapshotCandidate("assets/logo.png"), false);
  assert.equal(isRepairFileDenied("config/service.credentials.json"), true);
});

test("pickSnapshotBatch: rotates non-overlapping windows per iteration", () => {
  const ranked = Array.from({ length: 20 }, (_, i) => `f${i}.js`);
  const b0 = pickSnapshotBatch(ranked, 0);
  const b1 = pickSnapshotBatch(ranked, 1);
  assert.equal(b0.length, REPAIR_SNAPSHOT_BATCH_SIZE);
  assert.equal(b0[0], "f0.js");
  assert.equal(b1[0], `f${REPAIR_SNAPSHOT_BATCH_SIZE}.js`);
  assert.ok(b0.every((f) => !b1.includes(f)), "batches must not overlap");
  assert.deepEqual(pickSnapshotBatch(ranked, 3), [], "past the end → empty (loop terminates)");
  assert.deepEqual(pickSnapshotBatch(ranked, -1), []);
});

// ─── rewrite application safety ───────────────────────────────────────────────

test("sanitizeRewrites: accepts normalized existing-file rewrites; rejects traversal/absolute/denied/new/empty/duplicate", () => {
  const repoFiles = ["src/app.js", "src/courses.js", ".env"];
  const { accepted, rejected } = sanitizeRewrites(
    [
      { path: "./src/app.js", content: "console.log('fixed');\n" },
      { path: "../outside.js", content: "x" },
      { path: "/etc/passwd", content: "x" },
      { path: "C:/windows/x.js", content: "x" },
      { path: ".env", content: "API=1" },
      { path: "src/new-file.js", content: "x" },
      { path: "src/courses.js", content: "   \n  " },
      { path: "src/app.js", content: "duplicate" },
    ],
    repoFiles,
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].path, "src/app.js", "leading ./ normalized");
  const reasons = Object.fromEntries(rejected.map((r) => [r.path, r.reason]));
  assert.equal(reasons["../outside.js"], "unsafe_path");
  assert.equal(reasons["/etc/passwd"], "unsafe_path");
  assert.equal(reasons["C:/windows/x.js"], "unsafe_path");
  assert.equal(reasons[".env"], "denied_file");
  assert.equal(reasons["src/new-file.js"], "not_existing_file", "worker must not create files");
  assert.equal(reasons["src/courses.js"], "empty_content", "full-file rewrite to nothing is a deletion in disguise");
  assert.equal(reasons["src/app.js"], "duplicate_path");
});

test("sanitizeRewrites: rejects rewrites that INTRODUCE credential-shaped strings, allows pre-existing ones", () => {
  const repoFiles = ["src/config.js", "src/legacy.js"];
  const originals = {
    "src/legacy.js": "const key = 'ghp_abcdefghijklmnopqrstuv123456';\n",
  };
  const { accepted, rejected } = sanitizeRewrites(
    [
      { path: "src/config.js", content: "const key = 'sk-ant-abcdefghijklmnop1234';\n" },
      { path: "src/legacy.js", content: "// touched\nconst key = 'ghp_abcdefghijklmnopqrstuv123456';\n" },
    ],
    repoFiles,
    originals,
  );
  assert.deepEqual(rejected.map((r) => [r.path, r.reason]), [["src/config.js", "introduces_secret"]]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].path, "src/legacy.js", "secret already in the original snapshot → not the worker's doing");
});

// ─── auto-fix PR content ──────────────────────────────────────────────────────

test("buildAutoFixPrContent: non-draft repair PR content — per-finding list, changed files, honest review note, brief reference", () => {
  const parsed = parseRepairBrief(buildAgentFixPrompt(CHECK_INPUT));
  const out = buildAutoFixPrContent({
    runId: "wvc_fixme1",
    intent: CHECK_INPUT.intentAnchor,
    decision: "Needs Fix",
    targetUrl: CHECK_INPUT.targetUrl,
    visualCheckId: "wvc_fixme1",
    envCause: true,
    findings: parsed.findings,
    changedFiles: ["src/courses.js", "src/api.js"],
    workerCommitMessage: "fix: guard courses map against undefined payload",
  });

  assert.equal(out.title, `Simsa 자동 수리: ${CHECK_INPUT.intentAnchor}`);
  assert.equal(out.commitMessage, "fix(simsa): apply repair for wvc_fixme1");
  assert.match(out.commitBody, /SIMSA-FIX-BRIEF\.md/, "commit references the brief");
  assert.match(out.body, /변경 파일 2개/);
  assert.ok(out.body.includes("`src/courses.js`"));
  assert.match(out.body, /1\. \[높음\]/, "findings listed with severity labels");
  assert.match(out.body, /머지 전에 반드시 코드 리뷰/, "honest review-before-merge note");
  assert.match(out.body, /SIMSA-FIX-BRIEF\.md/);
  assert.match(out.body, /환경 원인 가능성/, "env-cause warning preserved");
  assert.ok(out.body.includes("fix: guard courses map against undefined payload"), "worker summary quoted");
  assert.ok(!/자동 적용된 코드 수정이 없습니다/.test(out.body), "must NOT carry the brief-only disclaimer");

  // long intent truncated in title; empty intent falls back
  const long = buildAutoFixPrContent({ runId: "r", intent: "긴".repeat(100), findings: [], changedFiles: [] });
  assert.ok(long.title.length < 80);
  const fallback = buildAutoFixPrContent({ runId: "r", findings: [], changedFiles: [] });
  assert.match(fallback.title, /핵심 기능 점검/);
  assert.ok(!/환경 원인/.test(fallback.body), "no env warning without envCause");
});
