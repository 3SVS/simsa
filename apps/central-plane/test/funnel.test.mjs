import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G7 퍼널 (docs/simsa-gap-backlog-2026-07-18.md): distinct 유저 기준 단계 전환율.
// 순수 요약 함수만 고정 — SQL은 라이브 실측으로 검증.

const { computeFunnelSummary } = await import("../dist/routes/workspace-admin-stats.js");

const stages = (a, b, c2, d) => [
  { key: "workspace_idea_to_spec_generated", label: "생성", users: a },
  { key: "workspace_check_draft_run", label: "검수", users: b },
  { key: "workspace_fix_suggestion_generated", label: "고쳐보기", users: c2 },
  { key: "workspace_builder_pack_exported", label: "팩", users: d },
];

describe("computeFunnelSummary — G7", () => {
  it("percentages vs first and vs previous stage", () => {
    const out = computeFunnelSummary(stages(100, 60, 30, 24), 12);
    assert.equal(out.stages[0].pctOfFirst, 100);
    assert.equal(out.stages[0].pctOfPrev, null);
    assert.equal(out.stages[1].pctOfFirst, 60);
    assert.equal(out.stages[1].pctOfPrev, 60);
    assert.equal(out.stages[3].pctOfFirst, 24);
    assert.equal(out.stages[3].pctOfPrev, 80); // 24/30
    assert.deepEqual(out.returnedAfterPack, { users: 12, pctOfPack: 50 });
  });

  it("zero traffic → null percentages (no divide-by-zero lies)", () => {
    const out = computeFunnelSummary(stages(0, 0, 0, 0), 0);
    assert.equal(out.stages[0].pctOfFirst, null);
    assert.equal(out.stages[1].pctOfPrev, null);
    assert.equal(out.returnedAfterPack.pctOfPack, null);
  });

  it("a later stage can exceed an earlier one (returning users) — reported as-is, >100%", () => {
    const out = computeFunnelSummary(stages(10, 15, 5, 5), 2);
    assert.equal(out.stages[1].pctOfFirst, 150);
  });
});
