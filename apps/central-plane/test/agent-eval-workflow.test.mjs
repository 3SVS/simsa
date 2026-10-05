import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// C12 agent-eval 워크플로 — 비용이 드는 실측이라 수동·확인 문구·키 가림·cron 꺼짐을 고정한다.
const here = dirname(fileURLToPath(import.meta.url));
const wf = readFileSync(join(here, "..", "..", "..", ".github", "workflows", "agent-eval.yml"), "utf8");

describe("agent-eval workflow", () => {
  it("수동 실행만, confirm=measure 없으면 돌지 않는다", () => {
    assert.match(wf, /workflow_dispatch:/);
    assert.match(wf, /if: \$\{\{ inputs\.confirm == 'measure' \}\}/);
    assert.doesNotMatch(wf, /^\s+schedule:/m, "cron은 주석으로만");
  });
  it("장비 키는 가리고, 입력은 env로만(셸 주입 경로 없음)", () => {
    assert.match(wf, /::add-mask::\$SIMSA_STAFF_USER_KEY/);
    assert.doesNotMatch(wf.split("steps:")[1] ?? "", /run:[\s\S]*\$\{\{ inputs\./);
  });
});
