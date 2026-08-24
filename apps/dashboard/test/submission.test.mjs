/**
 * submission.test.mjs — AF-1 제출물 한 칸 파서 (설계 D-1).
 *
 * 사람이 실제로 넣는 문자열로 쓴다. 깨끗한 예시로만 통과시키면, 정작 붙여넣기·
 * 스킴 누락·한글 도메인에서 막히는 것을 놓친다(Rule 6).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { parseSubmission, projectNameFor } = await import("../src/lib/submission.mjs");

describe("★저장소 판정이 URL 판정보다 먼저다", () => {
  // GitHub 주소는 URL이기도 하다. 순서가 뒤바뀌면 저장소가 '웹사이트'로 분류돼
  // 코드 열람(L2)을 통째로 못 쓴다.
  for (const input of [
    "3SVS/simsa",
    "https://github.com/3SVS/simsa",
    "https://github.com/3SVS/simsa.git",
    "https://github.com/3SVS/simsa/tree/main/apps",
    "git@github.com:3SVS/simsa.git",
  ]) {
    it(`저장소로 본다: ${input}`, () => {
      const r = parseSubmission(input);
      assert.equal(r.ok, true);
      assert.equal(r.type, "github_repo");
      assert.equal(r.reference, "3SVS/simsa");
    });
  }
});

describe("앱 주소", () => {
  it("https 주소를 그대로 받는다", () => {
    const r = parseSubmission("https://my-app.vercel.app/");
    assert.equal(r.type, "website");
    assert.equal(r.reference, "https://my-app.vercel.app/");
  });

  it("★스킴을 빼고 쳐도 받는다 — 사람은 보통 그렇게 친다", () => {
    const r = parseSubmission("my-app.vercel.app");
    assert.equal(r.ok, true);
    assert.equal(r.type, "website");
    assert.equal(r.reference, "https://my-app.vercel.app/");
  });

  it("경로·쿼리를 보존한다 — 사용자가 준 화면이 시작점일 수 있다", () => {
    const r = parseSubmission("https://my-app.vercel.app/dashboard?tab=1");
    assert.equal(r.reference, "https://my-app.vercel.app/dashboard?tab=1");
  });

  it("★한글이 든 주소도 받는다 (Rule 6)", () => {
    const r = parseSubmission("https://내앱.example.com/검수");
    assert.equal(r.ok, true);
    assert.equal(r.type, "website");
  });

  it("gitlab 주소는 저장소가 아니라 웹사이트로 받는다 — 거절하지 않는다", () => {
    const r = parseSubmission("https://gitlab.com/me/app");
    assert.equal(r.ok, true);
    assert.equal(r.type, "website", "GitHub만 저장소로 다룬다(D-6 범위)");
  });
});

describe("거절 — 검수할 수 없는 것만", () => {
  it("빈 입력", () => {
    assert.deepEqual(parseSubmission(""), { ok: false, error: "empty" });
    assert.deepEqual(parseSubmission("   "), { ok: false, error: "empty" });
    assert.deepEqual(parseSubmission(null), { ok: false, error: "empty" });
  });

  it("너무 긴 입력", () => {
    assert.deepEqual(parseSubmission("a".repeat(501)), { ok: false, error: "too_long" });
  });

  it("점 없는 호스트(localhost·오타)는 검수 대상이 아니다", () => {
    assert.equal(parseSubmission("localhost:3000").ok, false);
    assert.equal(parseSubmission("myapp").ok, false);
  });

  it("http(s)가 아닌 스킴", () => {
    assert.equal(parseSubmission("ftp://files.example.com").ok, false);
    assert.equal(parseSubmission("mailto:a@b.com").ok, false);
  });
});

describe("이름은 짓지 않고 제출물에서 가져온다 (D-1)", () => {
  it("저장소는 repo 이름을 쓴다", () => {
    assert.equal(projectNameFor("github_repo", "3SVS/simsa"), "simsa");
    assert.equal(parseSubmission("https://github.com/3SVS/golf-now").name, "golf-now");
  });

  it("주소는 서브도메인을 쓴다", () => {
    assert.equal(projectNameFor("website", "https://my-app.vercel.app/"), "my-app");
    assert.equal(projectNameFor("website", "https://www.my-app.vercel.app/"), "my-app");
  });

  it("★앞 조각이 일반 단어면 다음 조각을 쓴다 — 'app'은 이름이 아니다", () => {
    assert.equal(projectNameFor("website", "https://app.golfnow.com/"), "golfnow");
  });

  it("정규 도메인은 앞 조각을 쓴다", () => {
    assert.equal(projectNameFor("website", "https://golfnow.com/"), "golfnow");
  });

  it("이름이 비지 않는다 — 어떤 유효 입력이든 무언가는 나온다", () => {
    for (const input of ["3SVS/simsa", "https://my-app.vercel.app", "example.org", "https://내앱.example.com"]) {
      const r = parseSubmission(input);
      assert.equal(r.ok, true, input);
      assert.ok(r.name && r.name.trim().length > 0, `이름 비었음: ${input}`);
    }
  });
});
