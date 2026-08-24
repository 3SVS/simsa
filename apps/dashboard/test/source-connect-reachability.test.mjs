/**
 * source-connect-reachability.test.mjs — 연결 시점 안내 + 주소 붙여넣기 (2026-08-23).
 *
 * ## 이 파일이 막는 사고
 *
 * 서버(#498)는 GitHub **주소**를 받도록 고쳤는데 이 패키지의 클라이언트 검증이
 * 여전히 `owner/repo`만 통과시켜, **UI에서는 아무것도 달라지지 않았다.** 화면이
 * 서버보다 엄격하면 기능이 통째로 무력화된다 — 그런데 서버 테스트는 전부 통과하므로
 * 그린이 나온다. 그래서 클라이언트 쪽에도 **같은 입력 표**로 테스트를 둔다.
 *
 * 아래 PASTED/REJECTED 표는 central-plane `test/github-repo-ref.test.mjs`와 **같은
 * 목록**이다. 한쪽만 고치면 다른 쪽 스위트가 깨진다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { normalizeGithubRepoRef, validateSourceInput, reachabilityNotice } = await import(
  "../src/lib/project-sources.mjs"
);

/** central-plane github-repo-ref.test.mjs와 공유하는 입력 표. */
const PASTED = [
  "3SVS/simsa",
  "https://github.com/3SVS/simsa",
  "https://github.com/3SVS/simsa/",
  "http://github.com/3SVS/simsa",
  "https://www.github.com/3SVS/simsa",
  "https://github.com/3SVS/simsa.git",
  "git@github.com:3SVS/simsa.git",
  "  https://github.com/3SVS/simsa  ",
  "https://github.com/3SVS/simsa/tree/main/apps",
  "https://github.com/3SVS/simsa/blob/main/README.md",
  "https://github.com/3SVS/simsa/pull/496",
  "https://github.com/3SVS/simsa?tab=readme",
  "https://github.com/3SVS/simsa#readme",
];

const REJECTED = [
  ["", "빈 문자열"],
  ["simsa", "소유자 없음"],
  ["https://github.com/3SVS", "저장소 없음"],
  ["https://gitlab.com/3SVS/simsa", "GitHub가 아닌 호스트"],
  ["-bad/repo", "소유자가 하이픈으로 시작"],
  ["한글조직/앱", "비ASCII 소유자·저장소명"],
  ["3SVS/시므사", "저장소 이름이 한글"],
  ["3SVS/simsa space", "공백 포함"],
  // 주소가 아닌데 조각이 셋 = 오타다. 조용히 3SVS/simsa로 고쳐 받으면
  // 사용자가 의도하지 않은 저장소에 연결된다.
  ["3SVS/simsa/extra", "★손으로 친 세 조각 — 주소가 아니므로 자르지 않는다"],
];

describe("★클라이언트가 서버보다 엄격하면 안 된다 — 붙여넣은 주소를 통과시킨다", () => {
  for (const input of PASTED) {
    it(`정규화: ${input.trim()}`, () => {
      assert.equal(normalizeGithubRepoRef(input), "3SVS/simsa");
    });
    it(`화면 검증 통과: ${input.trim()}`, () => {
      assert.deepEqual(validateSourceInput("github_repo", input), { ok: true });
    });
  }
});

describe("그래도 검증은 유지한다", () => {
  for (const [input, why] of REJECTED) {
    it(`${why}: ${JSON.stringify(input)}`, () => {
      assert.equal(normalizeGithubRepoRef(input), null);
      assert.deepEqual(validateSourceInput("github_repo", input), { ok: false, error: "invalid_repo" });
    });
  }
});

describe("연결 시점 안내 — 막지 않고 알려준다", () => {
  it("공개 저장소: 계정이 필요 없다고 말한다", () => {
    const n = reachabilityNotice("github_repo", { state: "readable", visibility: "public", via: "anonymous" });
    assert.equal(n.tone, "ok");
    assert.equal(n.key, "repoReadablePublic");
    assert.equal(n.showInstall, false, "되는 사람에게 설치 링크는 노이즈다");
  });

  it("비공개인데 내 계정으로 읽히면 그렇게 말한다", () => {
    const n = reachabilityNotice("github_repo", { state: "readable", visibility: "private", via: "user_token" });
    assert.equal(n.key, "repoReadablePrivate");
    assert.equal(n.showInstall, false);
  });

  it("★못 읽을 때만 App 설치를 권한다 — 여기가 종전에 침묵하던 자리", () => {
    const n = reachabilityNotice("github_repo", { state: "needs_access", via: "anonymous" });
    assert.equal(n.tone, "warn");
    assert.equal(n.key, "repoNeedsAccess");
    assert.equal(n.showInstall, true);
  });

  it("★재지 못한 것을 '안 된다'고 말하지 않는다 — 레이트리밋 오진 방지", () => {
    for (const reason of ["rate_limited", "network", "timeout"]) {
      const n = reachabilityNotice("github_repo", { state: "unknown", reason });
      assert.equal(n.key, "repoUnknown", reason);
      assert.equal(n.showInstall, false, "모르는 상태에서 설치를 권하면 오해를 만든다");
      assert.notEqual(n.tone, "warn", "모름은 경고가 아니다");
    }
  });

  it("앱 주소는 저장소와 다른 문구를 쓴다", () => {
    assert.equal(
      reachabilityNotice("website", { state: "readable", visibility: "public", via: "anonymous" }).key,
      "siteReadable",
    );
    assert.equal(reachabilityNotice("website", { state: "unknown", reason: "timeout" }).key, "siteUnknown");
  });

  it("도달성이 없으면(계측 실패) 아무것도 보여주지 않는다 — 연결은 이미 성공", () => {
    assert.equal(reachabilityNotice("github_repo", null), null);
    assert.equal(reachabilityNotice("website", undefined), null);
  });
});

describe("문구가 실제로 존재한다 (KO/EN 양쪽)", () => {
  it("모든 notice key가 두 사전에 있다", async () => {
    const { DICTIONARIES: dictionaries } = await import("../src/i18n/dictionary.mjs");
    const keys = [
      "siteReadable",
      "repoReadablePublic",
      "repoReadablePrivate",
      "repoNeedsAccess",
      "repoUnknown",
      "siteUnknown",
      "loginWallNote",
    ];
    for (const locale of ["ko", "en"]) {
      const reach = dictionaries[locale].sources.reach;
      for (const k of keys) {
        assert.equal(typeof reach[k], "string", `${locale}.${k}`);
        assert.ok(reach[k].trim().length > 0, `${locale}.${k} 비어 있음`);
      }
    }
  });

  it("★needs_access 문구는 비공개와 오타 두 갈래를 다 열어 둔다", async () => {
    const { DICTIONARIES: dictionaries } = await import("../src/i18n/dictionary.mjs");
    // 우리는 비공개와 '주소가 틀림'을 구분할 수 없다(둘 다 404). 한쪽으로 단정하면
    // 오타를 낸 사람에게 App을 설치하라고 시키게 된다.
    assert.match(dictionaries.ko.sources.reach.repoNeedsAccess, /비공개/);
    assert.match(dictionaries.ko.sources.reach.repoNeedsAccess, /오타|확인/);
    assert.match(dictionaries.en.sources.reach.repoNeedsAccess, /private/i);
    assert.match(dictionaries.en.sources.reach.repoNeedsAccess, /typo|check/i);
  });
});
