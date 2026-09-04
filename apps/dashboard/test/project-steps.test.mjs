/**
 * project-steps.test.mjs — fixes the progress map's two load-bearing invariants:
 *  1. LOCKING: steps with a CONFIRMED-unmet precondition are locked (with the
 *     right hint); unknown facts NEVER lock (fail-open — a wrong lock blocks a
 *     user, a missing lock just shows plain nav).
 *  2. AUTO-CHECK: done is derived from data — already-connected/already-run work
 *     is auto-checked, so revisiting never demands rework.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProjectSteps, nextScreenSlug } from "../src/lib/project-steps.mjs";

const byKey = (steps) => Object.fromEntries(steps.map((s) => [s.key, s]));

test("fresh builder project (no items, no repo, no deploy URL): step1 current, step2+3 locked", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }));
  assert.equal(s.prepare.status, "current");
  assert.equal(s.review.status, "locked");
  assert.equal(s.review.lockReason, "need_items");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_build"); // "팩 받아 만들고 URL 연결" — NOT a GitHub dead end
});

test("items done, no repo, no deploy URL: step2 current, step3 locked on need_build (not GitHub)", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }));
  assert.equal(s.prepare.status, "done"); // auto-checked — no rework
  assert.equal(s.review.status, "current");
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_build");
});

test("builder path: a deploy URL unlocks results (no GitHub) — the dead-end fix", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: true }));
  assert.equal(s.results.status, "todo"); // reachable via the deploy URL
  assert.equal(s.results.lockReason, null);
});

test("builder path: deploy URL + a visual-check run → review done, results current", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: true, hasDeployUrl: true }));
  assert.equal(s.review.status, "done"); // connected via URL + run happened
  assert.equal(s.results.status, "current");
});

test("CODE branch keeps the GitHub gate: no repo → results locked need_code", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false, entryPath: "code" }));
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code");
});

test("items + repo, no run yet: step3 unlocked (todo), step2 still current", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: false }));
  assert.equal(s.review.status, "current"); // connected but not yet run
  assert.equal(s.results.status, "todo"); // reachable, not current yet
  assert.equal(s.results.lockReason, null);
});

test("AUTO-CHECK: items + repo + run → step1/2 done, step3 current (no rework demanded)", () => {
  const s = byKey(computeProjectSteps({ hasItems: true, hasRepo: true, hasReviewRun: true }));
  assert.equal(s.prepare.status, "done");
  assert.equal(s.review.status, "done"); // repo already connected + review already run → checked
  assert.equal(s.results.status, "current");
});

test("FAIL-OPEN: unknown facts (null) never lock anything", () => {
  const s = byKey(computeProjectSteps({ hasItems: null, hasRepo: null, hasReviewRun: null }));
  assert.notEqual(s.review.status, "locked");
  assert.notEqual(s.results.status, "locked");
  // and nothing is falsely checked either
  assert.notEqual(s.review.status, "done");
});

test("null input tolerated (never throws)", () => {
  const s = computeProjectSteps(undefined);
  assert.equal(s.length, 3);
});

// ─── STEP 3: skipped-user normal path (code branch) ─────────────────────────

test("CODE branch: no items is NORMAL — review never locks, prepare is optional (not red)", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath: "code" }));
  assert.notEqual(s.review.status, "locked", "review must NOT lock on missing items for code entry");
  assert.equal(s.review.status, "current"); // the code branch starts here
  assert.equal(s.prepare.optional, true); // "이 갈래는 원래 그럼" — optional, not incomplete
  assert.equal(s.prepare.status, "todo"); // neutral, never a red/current demand
  // results still locks on no code — that gate is branch-independent
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_code");
});

test("CODE branch: repo connected + run → review done, results current (full path w/o idea step)", () => {
  const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: true, hasReviewRun: true, entryPath: "code" }));
  assert.equal(s.review.status, "done");
  assert.equal(s.results.status, "current"); // skipping idea never blocked steps 2·3
});

test("IDEA/SPEC branches unchanged: no items still locks review", () => {
  for (const entryPath of ["idea", "spec", null, undefined]) {
    const s = byKey(computeProjectSteps({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath }));
    assert.equal(s.review.status, "locked", `entryPath=${entryPath} must keep the items gate`);
    assert.equal(s.prepare.optional, false);
  }
});

// ─── STEP 4: command center — shortest path to the activation moment ────────

test("activation path (builder): items ready, no repo/URL → get_pack (not the GitHub dead end)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: false }),
    { action: "get_pack", slug: "export" },
  );
});

test("activation path (builder): deploy URL connected, no run → run_review via visual-checks", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: false, hasDeployUrl: true }),
    { action: "run_review", slug: "visual-checks" },
  );
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: false, hasReviewRun: true, hasDeployUrl: true }),
    { action: "view_results", slug: "checks" },
  );
});

test("activation path (code branch): items ready + no repo → connect_code (GitHub stays for devs)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    // AF-1 이후 코드 갈래는 앱 주소로도 시작하므로, "연결된 것이 없다"는
    // 저장소와 주소 **둘 다 없음**이 확인돼야 성립한다.
    nextProjectAction({ hasItems: true, hasRepo: false, hasDeployUrl: false, hasReviewRun: false, entryPath: "code" }),
    { action: "connect_code", slug: "settings" },
  );
});

test("activation path: CODE branch with no items skips create_items entirely", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  // Missing items must NOT interpose on the code branch — connect → run is the whole path.
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasDeployUrl: false, hasReviewRun: false, entryPath: "code" }),
    { action: "connect_code", slug: "settings" },
  );
});

test("activation path: repo connected, no run → run_review; after run → view_results", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: true, hasReviewRun: false }),
    { action: "run_review", slug: "github" },
  );
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: true, hasReviewRun: true }),
    { action: "view_results", slug: "checks" },
  );
});

test("unknown facts → null CTA (never mislead, never flip after fetch)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.equal(nextProjectAction({ hasItems: null, hasRepo: null, hasReviewRun: null }), null);
  assert.equal(nextProjectAction(undefined), null);
});

test("idea branch with confirmed-no items → create_items first", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasReviewRun: false, entryPath: "idea" }),
    { action: "create_items", slug: "items" },
  );
});

test("nextScreenSlug: idea/spec entries walk to the builder pack and STOP (no code yet)", () => {
  // Pre-build users must never be marched into repo-connect/PR screens —
  // that funnel only exists after the app does (2026-07-10 live walkthrough).
  assert.equal(nextScreenSlug("idea"), "spec");
  assert.equal(nextScreenSlug("spec"), "items");
  assert.equal(nextScreenSlug("items"), "export");
  assert.equal(nextScreenSlug("export"), null); // go build — return path is explicit, not a forced walk
  assert.equal(nextScreenSlug("settings"), null); // repo screens are outside the pre-build walk
  assert.equal(nextScreenSlug("github"), null);
  assert.equal(nextScreenSlug("benchmark"), null); // advanced screens stay out of the walk
});

test("nextScreenSlug: the CODE branch walks repo-connect FIRST (이미 만든 앱 직행)", () => {
  // Someone who said "이미 만든 앱이 있어요" connects code before curating
  // items — marching them through 준비 first read as an abrupt jump (Bae).
  assert.equal(nextScreenSlug("settings", "code"), "github");
  assert.equal(nextScreenSlug("github", "code"), "items");
  assert.equal(nextScreenSlug("items", "code"), "checks");
  assert.equal(nextScreenSlug("checks", "code"), "fixes");
  assert.equal(nextScreenSlug("fixes", "code"), null);
  // idea/spec are not on the code walk at all
  assert.equal(nextScreenSlug("idea", "code"), null);
  // other entries walk to the builder pack (pre-build — no repo screens)
  assert.equal(nextScreenSlug("items", "idea"), "export");
  assert.equal(nextScreenSlug("items", null), "export");
});

// ── Fix-first routing (Bae 2026-07-17): 확인 결과 → 고쳐보기 → 빌더팩 ─────────

test("post-review walk (builder branches): checks → fixes → export", () => {
  assert.equal(nextScreenSlug("checks", "idea"), "fixes");
  assert.equal(nextScreenSlug("fixes", "idea"), "export");
  assert.equal(nextScreenSlug("checks", "spec"), "fixes");
  assert.equal(nextScreenSlug("fixes", "spec"), "export");
  // pre-review walk unchanged: items → export is still the idea-branch end
  assert.equal(nextScreenSlug("items", "idea"), "export");
  assert.equal(nextScreenSlug("export", "idea"), null);
  // code branch unchanged: its own order still ends at fixes (PR flow, not pack)
  assert.equal(nextScreenSlug("fixes", "code"), null);
  assert.equal(nextScreenSlug("checks", "code"), "fixes");
});

test("packReadiness: no review / nothing failed → no_review (no notice)", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  assert.equal(packReadiness(undefined, undefined).state, "no_review");
  assert.equal(packReadiness({ results: [] }, {}).state, "no_review");
  assert.equal(
    packReadiness({ results: [{ itemId: "a", status: "passed" }] }, {}).state,
    "no_review",
  );
});

test("packReadiness: failed items without fix plans → fixes_missing with counts", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  const r = packReadiness(
    { results: [
      { itemId: "a", status: "failed" },
      { itemId: "b", status: "failed" },
      { itemId: "c", status: "inconclusive" },
    ] },
    { a: { itemId: "a" } }, // only one of two failures has a plan
  );
  assert.equal(r.state, "fixes_missing");
  assert.equal(r.failedCount, 2);
  assert.equal(r.missingCount, 1);
});

test("packReadiness: every failed item has a fix plan → fixes_ready", async () => {
  const { packReadiness } = await import("../src/lib/project-steps.mjs");
  const r = packReadiness(
    { results: [{ itemId: "a", status: "failed" }] },
    { a: { itemId: "a" } },
  );
  assert.equal(r.state, "fixes_ready");
  assert.equal(r.failedCount, 1);
  assert.equal(r.missingCount, 0);
});

test("★AF-1: 코드 갈래에 앱 주소만 있어도 연결된 것으로 본다", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  // 2026-08-24 journey-audit 실측: 주소를 넣어 **검수까지 끝난 프로젝트**에도
  // "GitHub 저장소를 연결하세요"가 계속 떴다. 제품이 자기 상태를 모르는 안내다.
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasDeployUrl: true, hasReviewRun: false, entryPath: "code" }),
    { action: "run_review", slug: "visual-checks" },
    "주소만 있으면 화면 검수를 가리킨다",
  );
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasDeployUrl: true, hasReviewRun: true, entryPath: "code" }),
    { action: "view_results", slug: "checks" },
    "검수가 끝났으면 결과로 보낸다 — 연결을 다시 요구하지 않는다",
  );
});

test("저장소가 있으면 코드 갈래는 여전히 코드 리뷰를 가리킨다 (무회귀)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: true, hasRepo: true, hasDeployUrl: true, hasReviewRun: false, entryPath: "code" }),
    { action: "run_review", slug: "github" },
  );
});

test("사실을 모르면 CTA를 내지 않는다 (기존 원칙)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.equal(
    nextProjectAction({ hasItems: true, hasRepo: false, hasDeployUrl: null, hasReviewRun: false, entryPath: "code" }),
    null,
    "주소 여부가 미확인이면 잘못된 안내보다 침묵이 낫다",
  );
});

test("★AF-1: 소스로 붙인 저장소도 '연결됨'으로 센다 (링크와는 다른 사실)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  // 2026-08-24 실측: AF-1은 제출한 저장소를 project_sources에 저장하는데 hasRepo는
  // GitHub 링크만 봐서, 저장소를 넣은 사용자가 "아무것도 연결 안 함"으로 보였다.
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasRepoSource: true, hasDeployUrl: false, hasReviewRun: false, entryPath: "code" }),
    { action: "add_url", slug: "sources" },
    "첫 결과까지 가장 짧은 길은 주소 추가다 — 코드 리뷰는 GitHub 링크가 더 필요해 더 먼 길",
  );
});

test("소스 저장소 + 주소가 둘 다 있으면 화면 검수로", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasRepoSource: true, hasDeployUrl: true, hasReviewRun: false, entryPath: "code" }),
    { action: "run_review", slug: "visual-checks" },
  );
});

test("GitHub 링크가 있으면 코드 리뷰를 가리킨다 (소스보다 우선)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: true, hasRepoSource: true, hasDeployUrl: false, hasReviewRun: false, entryPath: "code" }),
    { action: "run_review", slug: "github" },
  );
});

test("아무것도 없으면 종전대로 연결을 요구한다 (무회귀)", async () => {
  const { nextProjectAction } = await import("../src/lib/project-steps.mjs");
  assert.deepEqual(
    nextProjectAction({ hasItems: false, hasRepo: false, hasRepoSource: false, hasDeployUrl: false, hasReviewRun: false, entryPath: "code" }),
    { action: "connect_code", slug: "settings" },
  );
});

// ─── nextStepFromHere — 결과를 아는 다음 한 걸음 (2026-09-01) ──────────────────
//
// 이 함수가 존재하는 이유는 순환을 닫기 위해서다: 검수 → (문제 있으면) 고칠 것 →
// 재검수. 정적 순서(nextScreenSlug)로는 "문제가 있었는가"를 구분할 수 없다.

import { nextStepFromHere } from "../src/lib/project-steps.mjs";

test("검수 결과에 문제가 있으면 다음은 고칠 것", () => {
  // ★checks(코드 리뷰) 화면. `summary`는 코드 리뷰 결과의 모양이므로 화면 검수
  //  화면에 그대로 대입하지 않는다 — 두 결과는 사는 곳이 다르다(아래 출처 분리 참조).
  const next = nextStepFromHere("checks", {
    entryPath: "code",
    hasCheckRun: true,
    summary: { failed: 2, needsDecision: 0 },
  });
  assert.deepEqual(next, { slug: "fixes", reason: "seeProblems" });
});

test("needs_decision도 문제로 센다 — 사용자가 판단해야 할 것이 남아 있다", () => {
  const next = nextStepFromHere("checks", {
    entryPath: "code",
    hasCheckRun: true,
    summary: { failed: 0, needsDecision: 1 },
  });
  assert.equal(next?.slug, "fixes");
});

test("★순환을 닫는다 — 고칠 것을 받았으면 다음은 재검수", () => {
  const next = nextStepFromHere("fixes", { entryPath: "code", hasFixes: true });
  assert.deepEqual(next, { slug: "visual-checks", reason: "afterFix" });
  // 정적 순서에서는 fixes가 끝이라 순환이 닫히지 않았다 — 이 함수가 필요한 이유.
  assert.equal(nextScreenSlug("fixes", "code"), null);
});

test("고칠 것이 아직 없으면 재검수로 밀지 않는다", () => {
  const next = nextStepFromHere("fixes", { entryPath: "code", hasFixes: false });
  assert.notEqual(next?.reason, "afterFix");
});

test("검수 결과가 아직 없으면 다음을 말하지 않는다", () => {
  assert.equal(nextStepFromHere("visual-checks", { entryPath: "code", hasCheckRun: false }), null);
});

test("문제가 없으면 억지로 다음 화면으로 밀지 않는다(할 일 없는 행진 금지)", () => {
  // code 갈래에서 checks 다음은 fixes지만, 고칠 게 없으면 그 이유는 "이어서"다.
  const next = nextStepFromHere("checks", {
    entryPath: "code",
    hasCheckRun: true,
    summary: { failed: 0, needsDecision: 0 },
  });
  assert.notEqual(next?.reason, "seeProblems");
});

test("검수 화면이 아니면 기존 정적 순서를 그대로 따른다", () => {
  for (const slug of ["idea", "spec", "items", "settings", "github"]) {
    for (const entryPath of ["code", "idea"]) {
      const next = nextStepFromHere(slug, { entryPath });
      assert.equal(next?.slug ?? null, nextScreenSlug(slug, entryPath), `${slug}/${entryPath}`);
    }
  }
});

test("ctx를 안 줘도 터지지 않는다(상태 로딩 실패 시 fail-open)", () => {
  assert.doesNotThrow(() => nextStepFromHere("items"));
  assert.doesNotThrow(() => nextStepFromHere("visual-checks"));
});

// ★화면 검수는 코드 리뷰와 **결과가 사는 곳이 다르다**. 처음 구현은 `checkResults`
//  하나만 봐서, 정작 순환의 중심 화면(visual-checks)에서 바가 통째로 비었다.
//  아래 두 테스트는 그 시절 코드에서 실패한다(null이 돌아왔다).

test("화면 검수에서 문제가 나오면 코드 리뷰 결과가 없어도 고칠 것을 가리킨다", () => {
  const next = nextStepFromHere("visual-checks", {
    entryPath: "code",
    hasCheckRun: false, // 코드 리뷰는 돌린 적 없다 — 앱 주소만 낸 사용자
    summary: null,
    visual: { findingCount: 3 },
  });
  assert.deepEqual(next, { slug: "fixes", reason: "seeProblems" });
});

test("화면 검수에서 문제가 없으면 고칠 것으로 밀지 않는다", () => {
  const next = nextStepFromHere("visual-checks", {
    entryPath: "code",
    visual: { findingCount: 0 },
  });
  assert.notEqual(next?.reason, "seeProblems");
});

test("화면 검수 기록이 없으면 코드 리뷰 결과로 대신 말하지 않는다", () => {
  // 출처를 섞으면 "이 검수에서 나온 것"이 아닌 것을 이 화면의 결과처럼 말하게 된다.
  const next = nextStepFromHere("visual-checks", {
    entryPath: "code",
    hasCheckRun: true,
    summary: { failed: 5 },
    visual: null,
  });
  assert.equal(next, null);
});

test("코드 리뷰 화면은 화면 검수 결과를 쓰지 않는다(반대 방향도 섞이지 않는다)", () => {
  const next = nextStepFromHere("checks", {
    entryPath: "code",
    hasCheckRun: false,
    visual: { findingCount: 9 },
  });
  assert.equal(next, null);
});
