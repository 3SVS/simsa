/**
 * export-route-stack-profile.test.mjs — 스택 불가지 P2의 **라우트 경유** 계약.
 *
 * 2026-08-21 라이브 QA에서 잡힌 결함: 유저가 호스팅/데이터를 답했는데 빌더팩이
 * 중립 안내로 나왔다. 진범은 `/workspace/export-builder-pack` 라우트의
 * userProfile 정규화가 **닫힌 enum 화이트리스트**(platform/githubLevel/aiToolLevel)라
 * hosting·data 축을 조용히 버린 것.
 *
 * P2의 기존 테스트(workspace-export-stack.test.mjs)는 generateBuilderPack을 직접
 * 호출해 라우트를 우회했기 때문에 이 갭을 못 봤다. 이 파일은 **HTTP 요청부터**
 * 검증한다 — 수정 이전 코드에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const ORIGIN = "https://app.trysimsa.com";

const SPEC = {
  productName: "사내 회의실 예약",
  oneLine: "직원이 회의실을 예약하고 관리자가 현황을 봅니다",
  targetUsers: ["직원"],
  problem: "예약이 메신저로 흩어져 중복됩니다.",
  included: ["회의실 예약 만들기", "직원 로그인"],
  excluded: ["결제"],
  userFlow: ["로그인", "예약"],
  decisions: [],
  openQuestions: [],
};
const ITEMS = [
  { id: "r1", title: "직원이 회의실 예약을 만들 수 있다", status: "not_started", criteria: ["시간 선택", "중복 방지"] },
];

/** D1/R2가 필요 없는 결정론 라우트 — 사용량 기록만 best-effort로 흘려보낸다. */
function makeEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async run() { return { success: true, meta: { changes: 1 } }; },
          async first() { return null; },
          async all() { return { results: [] }; },
        };
      },
    },
  };
}

async function packViaRoute(userProfile) {
  const res = await createApp().request(
    "/workspace/export-builder-pack",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        project: { title: SPEC.productName, productSpec: SPEC, items: ITEMS },
        target: "claude_code",
        format: "json",
        locale: "ko",
        ...(userProfile ? { userProfile } : {}),
      }),
    },
    makeEnv(),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  const prompt = (body.bundle?.files ?? []).find((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md"))?.content ?? "";
  assert.ok(prompt.length > 0, "CLAUDE_CODE_PROMPT.md must exist");
  return prompt;
}

const NEUTRAL_DATA = "먼저 사용자에게 이미 쓰는 데이터 서비스가 있는지 물어라";

describe("export 라우트 — 답한 조합이 팩까지 도달한다 (P2 라우트 계약)", () => {
  it("userProfile 없음 → 중립(물음-먼저), 특정 벤더 단정 없음 (D-2)", async () => {
    const p = await packViaRoute(undefined);
    assert.match(p, new RegExp(NEUTRAL_DATA));
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
  });

  it("data=supabase → Supabase 워크스루가 라우트를 통과해 팩에 실린다", async () => {
    const p = await packViaRoute({ data: "supabase" });
    assert.match(p, /https:\/\/supabase\.com/);
    assert.doesNotMatch(p, new RegExp(NEUTRAL_DATA));
  });

  it("data=firebase → Firebase 안내, Supabase 기본값 없음", async () => {
    const p = await packViaRoute({ data: "firebase" });
    assert.match(p, /console\.firebase\.google\.com/);
    assert.doesNotMatch(p, /https:\/\/supabase\.com/);
  });

  it("hosting=netlify → Netlify 기준 배포 안내 (Vercel 경로 아님)", async () => {
    const p = await packViaRoute({ hosting: "netlify" });
    assert.match(p, /Netlify를 쓴다/);
    assert.doesNotMatch(p, /https:\/\/vercel\.com/);
  });

  it("hosting=builder_hosted → Publish 버튼 안내로 대체", async () => {
    const p = await packViaRoute({ hosting: "builder_hosted" });
    assert.match(p, /Publish\/Deploy 버튼/);
  });

  it('기타 자유입력(한글)이 이름 그대로 전달된다 — 치환 금지 (D-3, Rule 6)', async () => {
    const p = await packViaRoute({ data: "other", dataOther: "우리회사 사내 포스그레스" });
    assert.match(p, /우리회사 사내 포스그레스/);
    assert.match(p, /다른 서비스로 바꾸지 말고/);
  });

  it("hosting=other 자유입력도 그대로 전달된다", async () => {
    const p = await packViaRoute({ hosting: "other", hostingOther: "회사 자체 서버" });
    assert.match(p, /회사 자체 서버/);
  });

  it("구 필드(githubLevel)는 종전대로 동작한다 — 무회귀", async () => {
    const p = await packViaRoute({ githubLevel: "new" });
    assert.match(p, /GitHub이 처음이거나 계정이 없다/);
  });

  it("빈 문자열·비문자열 축은 무시된다 (정규화 유지)", async () => {
    const p = await packViaRoute({ hosting: "   ", data: 42, dataOther: null });
    assert.match(p, new RegExp(NEUTRAL_DATA));
  });
});
