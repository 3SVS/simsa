import { describe, it } from "node:test";
import assert from "node:assert/strict";

// G14-b (2026-08-20): 빌더팩 EN화 — export.ts의 locale 파라미터가 선언만 되고
// 미사용이던 갭을 고정한다. locale=en 팩의 모든 Simsa 작성 텍스트는 영어,
// 유저 콘텐츠(스펙·항목 제목 등)는 원문 그대로. locale 생략/ko는 종전과
// 바이트 동일. 이 테스트들은 locale 배선 이전 코드에서 실패한다(EN 요청에도
// 한국어 팩 반환).

const { generateBuilderPack } = await import("../dist/workspace/export.js");

const HANGUL = /[가-힣]/;

const EN_SPEC = {
  productName: "Bakery Reservations",
  oneLine: "Reserve today's bread for pickup",
  targetUsers: ["local bakery customers"],
  problem: "Popular bread sells out before customers arrive.",
  included: ["browse today's bread", "reserve a pickup time"],
  excluded: ["online payment"],
  userFlow: ["open the list", "pick a bread", "choose a time"],
  decisions: ["reservations capped at 5 per customer"],
  openQuestions: ["decide the cancellation window"],
};

const EN_ITEMS = [
  { id: "r1", title: "Customers can see today's bread list", status: "not_started", criteria: ["list loads", "sold-out marked"] },
  { id: "r2", title: "Customers can reserve with a pickup time", status: "failed", criteria: ["time slots shown"] },
];

const EN_CHECKS = {
  results: [
    { itemId: "r2", status: "failed", title: "Customers can reserve with a pickup time", reason: "Conflicts with excluded scope.", evidence: ["online payment"], nextAction: "Re-check the scope." },
  ],
  summary: { passed: 0, failed: 1, inconclusive: 0, needsDecision: 0 },
};

const EN_SERVICES = [
  {
    id: "supabase",
    label: "Supabase",
    setupUrl: "https://supabase.com",
    envVars: [
      { key: "SUPABASE_URL", description: "project URL", example: "https://x.supabase.co" },
      { key: "SUPABASE_SERVICE_ROLE", description: "admin key", secret: true, value: "real-secret-value" },
    ],
  },
];

function packFor(target, extra = {}) {
  return generateBuilderPack({
    project: { title: "Bakery Reservations", idea: "reserve bread", productSpec: EN_SPEC, items: EN_ITEMS, checkResults: EN_CHECKS },
    target,
    format: "json",
    locale: "en",
    ...extra,
  });
}

describe("builder pack — EN locale (G14-b)", () => {
  for (const target of ["claude_code", "codex", "both", "web_builder", "handoff"]) {
    it(`${target}: EN pack has no Hangul in any file (content or path)`, () => {
      const res = packFor(target, target === "handoff" ? {} : { services: EN_SERVICES, userProfile: { githubLevel: "new", aiToolLevel: "no" } });
      assert.equal(res.ok, true);
      assert.ok(res.bundle.files.length > 0);
      for (const f of res.bundle.files) {
        assert.doesNotMatch(f.path, HANGUL, `path leaked Korean: ${f.path}`);
        assert.doesNotMatch(f.content, HANGUL, `Korean leaked into ${f.path}:\n${(f.content.match(/^.*[가-힣].*$/m) ?? [""])[0]}`);
      }
      assert.doesNotMatch(res.summary.recommendedNextStep, HANGUL);
    });
  }

  it("EN pack keeps user content untouched (Korean user text passes through)", () => {
    const res = generateBuilderPack({
      project: {
        title: "빵집 예약",
        productSpec: { ...EN_SPEC, productName: "빵집 예약", included: ["오늘 빵 보기"] },
        items: [{ id: "r1", title: "오늘 나온 빵 목록", status: "not_started", criteria: ["목록이 보인다"] }],
      },
      target: "claude_code",
      format: "json",
      locale: "en",
    });
    const items = res.bundle.files.find((f) => f.path.endsWith("items.md"));
    // Simsa-authored heading is EN…
    assert.match(items.content, /# Must-have items/);
    // …while the user's own Korean title passes through untouched.
    assert.match(items.content, /오늘 나온 빵 목록/);
  });

  it("EN pack never leaks a real secret value into prompts (parity with KO guard)", () => {
    const res = packFor("claude_code", { services: EN_SERVICES });
    const prompt = res.bundle.files.find((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md"));
    assert.ok(prompt);
    assert.ok(!prompt.content.includes("real-secret-value"), "secret value must never enter the prompt");
  });

  it("KO pack unchanged when locale omitted (legacy callers) — known Korean heading intact", () => {
    const res = generateBuilderPack({
      project: { title: "빵집 예약", productSpec: EN_SPEC, items: EN_ITEMS },
      target: "claude_code",
      format: "json",
    });
    const readme = res.bundle.files.find((f) => f.path.endsWith("README.md"));
    assert.match(readme.content, /# 만들기 패키지 — /);
    const items = res.bundle.files.find((f) => f.path.endsWith("items.md"));
    assert.match(items.content, /# 꼭 들어가야 할 항목/);
  });

  it("file names are identical between KO and EN packs (contract)", () => {
    for (const target of ["claude_code", "codex", "both", "web_builder", "handoff"]) {
      const ko = generateBuilderPack({ project: { title: "t", productSpec: EN_SPEC, items: EN_ITEMS }, target, format: "json", locale: "ko" });
      const en = generateBuilderPack({ project: { title: "t", productSpec: EN_SPEC, items: EN_ITEMS }, target, format: "json", locale: "en" });
      assert.deepEqual(en.bundle.files.map((f) => f.path), ko.bundle.files.map((f) => f.path));
    }
  });
});
