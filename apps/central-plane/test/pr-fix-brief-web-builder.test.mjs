/**
 * pr-fix-brief-web-builder.test.mjs — 스택 불가지 P3 (§3-5).
 *
 * 수리팩의 web_builder 타깃: 채팅형 빌더 대화창에 붙여넣는 단일 프롬프트.
 * CLI 전용 2종(claude_code/codex)만 있던 공백을 닫는다 — 이 테스트들은
 * P3 이전 코드에서 실패한다(web_builder가 both로 강등돼 CLI 파일이 나감).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { generatePRFixBrief } = await import("../dist/workspace/pr-fix-brief.js");

const REQ = {
  projectId: "p1",
  productSpec: { productName: "빵집 예약", oneLine: "당일 빵 예약", included: ["예약"], excluded: ["결제"] },
  allItems: [
    { id: "r1", title: "예약 버튼이 동작해야 함", status: "failed", criteria: ["클릭 시 예약 완료 표시"] },
    { id: "r2", title: "예약 목록이 보여야 함", status: "inconclusive", criteria: [] },
  ],
  selectedItemIds: ["r1", "r2"],
  reviewResults: [
    { itemId: "r1", title: "예약 버튼이 동작해야 함", status: "failed", userLabel: "안 맞음", reason: "버튼 핸들러가 비어 있음", evidence: ["app/page.tsx"], nextAction: "핸들러 연결" },
    { itemId: "r2", title: "예약 목록이 보여야 함", status: "inconclusive", userLabel: "확인 부족", reason: "목록 렌더 확인 불가", evidence: [], nextAction: "직접 확인" },
  ],
  prMeta: { number: 7, title: "예약 기능", state: "open", headBranch: "feature/reserve", baseBranch: "main", headSha: "", additions: 0, deletions: 0, changedFiles: 0 },
  repoFullName: "acme/bakery",
  runId: "run_1",
};

describe("PR fix pack — web_builder 타깃 (P3 §3-5)", () => {
  it("web_builder → 채팅 프롬프트 1장, CLI 파일 없음", () => {
    const res = generatePRFixBrief({ ...REQ, target: "web_builder" });
    const paths = res.brief.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith("WEB_BUILDER_FIX_PROMPT.md")), "web builder prompt file");
    assert.ok(!paths.some((p) => p.includes("CLAUDE_CODE_FIX_PROMPT")), "no Claude Code file");
    assert.ok(!paths.some((p) => p.includes("CODEX_FIX_PROMPT")), "no Codex file");
    assert.ok(res.brief.webBuilderPrompt, "webBuilderPrompt in response");
    assert.equal(res.brief.claudeCodePrompt, undefined);
    assert.equal(res.brief.codexPrompt, undefined);
  });

  it("web_builder 프롬프트에 CLI/저장소 조작 지시가 없다 (빌더 규약)", () => {
    const res = generatePRFixBrief({ ...REQ, target: "web_builder" });
    const p = res.brief.webBuilderPrompt;
    assert.doesNotMatch(p, /브랜치|터미널|커밋|git |저장소:/);
    // 항목 내용은 그대로 전달된다
    assert.match(p, /예약 버튼이 동작해야 함/);
    assert.match(p, /버튼 핸들러가 비어 있음/);
    assert.match(p, /만들기 전에 나에게 질문|질문한다/);
  });

  it("README가 빌더 사용법을 안내하고 CLI 섹션은 없다", () => {
    const res = generatePRFixBrief({ ...REQ, target: "web_builder" });
    const readme = res.brief.files.find((f) => f.path.endsWith("README.md")).content;
    assert.match(readme, /웹 빌더/);
    assert.match(readme, /예: Lovable, v0, Bolt 등/); // D-4 열린 목록
    assert.doesNotMatch(readme, /### Claude Code 사용 시|### Codex 사용 시/);
  });

  it("기본(both)은 종전 그대로 — CLI 2종 파일, web builder 파일 없음 (무회귀)", () => {
    const res = generatePRFixBrief({ ...REQ, target: "both" });
    const paths = res.brief.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.includes("CLAUDE_CODE_FIX_PROMPT")));
    assert.ok(paths.some((p) => p.includes("CODEX_FIX_PROMPT")));
    assert.ok(!paths.some((p) => p.includes("WEB_BUILDER_FIX_PROMPT")));
  });
});
