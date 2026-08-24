/**
 * github-repo-ref.test.mjs — 사용자가 실제로 붙여넣는 형태들 (2026-08-23).
 *
 * Bae 실사용 지적: *"깃헙 계정이 많아서 연결이 잘 안 되더라. 그냥 깃헙 주소 넣는 건 안 돼?"*
 * 종전엔 안 됐다 — 입력구가 bare `owner/repo`만 받아 브라우저에서 복사한 주소를
 * `invalid_repo`로 거절했다. 정작 소비처는 이미 주소를 정규화하고 있었는데도.
 *
 * 그래서 이 테스트는 **사람이 실제로 복사해 오는 문자열**로 쓴다 — 깨끗한
 * `owner/repo` 하나로 통과시키면 그 버그를 그대로 놓친다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { normalizeGithubRepoRef } = await import("../dist/workspace/github-repo-ref.js");

describe("붙여넣는 형태 — 브라우저에서 복사해 온 것들", () => {
  const cases = [
    ["3SVS/simsa", "bare owner/repo (종전 유일 허용 형태)"],
    ["https://github.com/3SVS/simsa", "★주소창에서 그대로 복사"],
    ["https://github.com/3SVS/simsa/", "트레일링 슬래시"],
    ["http://github.com/3SVS/simsa", "http"],
    ["https://www.github.com/3SVS/simsa", "www"],
    ["https://github.com/3SVS/simsa.git", "★Code 버튼의 클론 URL"],
    ["git@github.com:3SVS/simsa.git", "SSH 클론 URL"],
    ["  https://github.com/3SVS/simsa  ", "앞뒤 공백(붙여넣기에서 흔함)"],
    ["https://github.com/3SVS/simsa/tree/main/apps", "★저장소 안쪽 경로를 복사"],
    ["https://github.com/3SVS/simsa/blob/main/README.md", "파일 보기 URL"],
    ["https://github.com/3SVS/simsa/pull/496", "PR 페이지 URL"],
    ["https://github.com/3SVS/simsa?tab=readme", "쿼리 스트링"],
    ["https://github.com/3SVS/simsa#readme", "프래그먼트"],
  ];
  for (const [input, why] of cases) {
    it(`${why}: ${input.trim()}`, () => {
      assert.equal(normalizeGithubRepoRef(input), "3SVS/simsa");
    });
  }
});

describe("주소에서 온 경로만 자른다 — 손으로 친 오타는 거절", () => {
  it("★손으로 친 a/b/c는 오타로 보고 거절한다 — 조용히 a/b로 고쳐 받지 않는다", () => {
    assert.equal(normalizeGithubRepoRef("3SVS/simsa/extra"), null);
  });
});

describe("소유자·저장소 이름의 실제 문자들", () => {
  it("점·밑줄·하이픈이 든 저장소 이름", () => {
    assert.equal(normalizeGithubRepoRef("https://github.com/some-org/my_app.v2"), "some-org/my_app.v2");
  });
  it("대소문자를 보존한다 — GitHub 경로는 표시상 대소문자를 유지한다", () => {
    assert.equal(normalizeGithubRepoRef("3SVS/Simsa"), "3SVS/Simsa");
  });
});

describe("거절해야 하는 것 — 관대하게 받되 검증은 유지", () => {
  const bad = [
    ["", "빈 문자열"],
    ["   ", "공백뿐"],
    ["simsa", "소유자 없음"],
    ["https://github.com/3SVS", "저장소 없음"],
    ["https://gitlab.com/3SVS/simsa", "★GitHub가 아닌 호스트 — 조용히 GitHub로 취급하면 안 된다"],
    ["https://example.com/3SVS/simsa", "임의 호스트"],
    ["-bad/repo", "소유자가 하이픈으로 시작"],
    ["한글조직/앱", "★비ASCII — GitHub 소유자·저장소 이름에 허용되지 않는다"],
    ["3SVS/시므사", "★저장소 이름이 한글"],
    ["3SVS/simsa space", "공백 포함"],
  ];
  for (const [input, why] of bad) {
    it(`${why}: ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeGithubRepoRef(input), null);
    });
  }
  it("null/undefined에도 던지지 않는다", () => {
    assert.equal(normalizeGithubRepoRef(undefined), null);
    assert.equal(normalizeGithubRepoRef(null), null);
  });
});

describe("소비처와 같은 값을 낸다 — 중복 정규화가 갈리지 않도록", () => {
  it("수리 작업의 normalizeRepoReference와 동일 결과", async () => {
    const { normalizeRepoReference } = await import("../dist/routes/workspace-repair-jobs.js");
    for (const input of ["3SVS/simsa", "https://github.com/3SVS/simsa.git", "https://gitlab.com/a/b"]) {
      assert.equal(normalizeRepoReference(input), normalizeGithubRepoRef(input), input);
    }
  });
});
