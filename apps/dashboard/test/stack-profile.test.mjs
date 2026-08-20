/**
 * stack-profile.test.mjs — 스택 불가지 Phase 1 (D-1~D-3) 패치 규칙 고정.
 * 이 테스트들은 stackProfilePatch 도입 이전 코드에는 존재하지 않던 표면이다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stackProfilePatch } from "../src/lib/stack-profile.mjs";

describe("stackProfilePatch", () => {
  it("미응답이면 빈 패치 — ext에 아무 키도 남기지 않는다 (D-2 전제)", () => {
    assert.deepEqual(stackProfilePatch(null, "", null, ""), {});
  });

  it("한 축만 답해도 그 축만 저장된다", () => {
    assert.deepEqual(stackProfilePatch("vercel", "", null, ""), {
      stackProfile: { hosting: { id: "vercel" } },
    });
    assert.deepEqual(stackProfilePatch(null, "", "firebase", ""), {
      stackProfile: { data: { id: "firebase" } },
    });
  });

  it('"other"는 자유텍스트를 보존한다 — 모르는 벤더도 버리지 않는다 (D-3)', () => {
    assert.deepEqual(stackProfilePatch("other", "  회사 자체 서버  ", "other", "구글 시트"), {
      stackProfile: {
        hosting: { id: "other", other: "회사 자체 서버" },
        data: { id: "other", other: "구글 시트" },
      },
    });
  });

  it('"other"인데 텍스트가 비면 other 키를 만들지 않는다', () => {
    assert.deepEqual(stackProfilePatch("other", "   ", null, ""), {
      stackProfile: { hosting: { id: "other" } },
    });
  });

  it('other가 아닌 칩의 자유텍스트는 무시한다 (칩이 진실)', () => {
    assert.deepEqual(stackProfilePatch("netlify", "잔여 텍스트", null, ""), {
      stackProfile: { hosting: { id: "netlify" } },
    });
  });

  it("미지의 id도 그대로 통과한다 — 칩 확장이 이 모듈 수정 없이 가능해야 한다", () => {
    assert.deepEqual(stackProfilePatch("railway", "", "planetscale", ""), {
      stackProfile: { hosting: { id: "railway" }, data: { id: "planetscale" } },
    });
  });
});
