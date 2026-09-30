/**
 * existing-app-journey-fixes.test.mjs — PR #559 검증 결함 수정 (2026-09-28).
 *
 * PR #559(기존 앱 여정 막다른 길)를 검증하면서 나온 결함 14건 중 코드로 고친 것의
 * 재현 테스트다. 이 파일의 테스트는 (행동 보존 가드로 표시한 것 외에는) PR #559의
 * head(82e9bf3)에서 실패한다 — 결함마다 "그 코드에서 무엇이 틀렸는가"를 단언한다.
 *
 * 공통 원칙(project-steps.mjs 머리 주석): 모르는 사실(null)로는 CTA·잠금·라벨을 만들지
 * 않는다. 한 번 그려진 것이 fetch가 끝난 뒤 바뀌면 그게 곧 잘못된 안내였다는 뜻이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const steps = await import("../src/lib/project-steps.mjs");
const settle = await import("../src/lib/repo-settle.mjs");
const address = await import("../src/lib/app-address.mjs");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

const byKey = (s) => Object.fromEntries(s.map((x) => [x.key, x]));
const fn = (name) => {
  const f = steps[name];
  assert.equal(typeof f, "function", `project-steps.${name} is not exported`);
  return f;
};

// 실제 API 모양(workspace-visual-checks-api VisualCheckListItem) — 모크는 프로덕션 모양과 같아야 한다.
const run = (id, status, extra = {}) => ({
  id, status, targetUrl: "https://내앱.lovable.app", decision: status === "done" ? "Ready" : "", works: status === "done" ? true : null,
  executor: "container", evidenceCount: 0, createdAt: "2026-09-28T10:00:00Z", ...extra,
});

// ─── 결함 1 [P1] 주소 사실이 null이면 view_results도 내지 않는다 ─────────────────

test("결함1: PR 리뷰 이력은 있고 주소 사실이 아직 null → CTA 없음 (view_results가 먼저 뜨고 add_url로 뒤집히지 않게)", () => {
  const facts = {
    entryPath: "code", hasItems: true, hasRepo: true, hasRepoSource: null, hasDeployUrl: null,
    hasReviewRun: true, hasVisualCheck: false,
  };
  assert.equal(steps.nextProjectAction(facts), null);
  // 소스가 도착하면 그때 처음으로 CTA가 정해진다 — add_url.
  assert.deepEqual(steps.nextProjectAction({ ...facts, hasRepoSource: false, hasDeployUrl: false }), { action: "add_url", slug: "sources" });
});

test("결함1: 실제 앱 확인만 있고 주소 사실이 null(아이디어 갈래 복원) → CTA 없음", () => {
  assert.equal(
    steps.nextProjectAction({
      entryPath: "idea", hasItems: true, hasRepo: true, hasRepoSource: null, hasDeployUrl: null,
      hasReviewRun: false, hasVisualCheck: true,
    }),
    null,
  );
});

// ─── 결함 2 [P2] 진행 중·실패 런은 "확인했음"이 아니다 ─────────────────────────

test("결함2: visualCheckFact는 끝난 런(done·uploaded)만 센다 — 대기·실행 중·실패만 있으면 false", () => {
  const { visualCheckFact } = steps;
  assert.equal(visualCheckFact({ ok: true, checks: [run("a", "queued")] }), false);
  assert.equal(visualCheckFact({ ok: true, checks: [run("a", "running")] }), false);
  assert.equal(visualCheckFact({ ok: true, checks: [run("a", "failed")] }), false);
  assert.equal(visualCheckFact({ ok: true, checks: [run("a", "failed"), run("b", "done")] }), true);
  assert.equal(visualCheckFact({ ok: true, checks: [run("a", "uploaded")] }), true, "로컬 도구가 올린 런(uploaded)도 결과가 있다");
});

test("결함2: visualCheckActiveFact — 대기·실행 중인 런이 있는가 (없음·실패는 구분)", () => {
  const visualCheckActiveFact = fn("visualCheckActiveFact");
  assert.equal(visualCheckActiveFact({ ok: true, checks: [run("a", "queued")] }), true);
  assert.equal(visualCheckActiveFact({ ok: true, checks: [run("a", "running"), run("b", "done")] }), true);
  assert.equal(visualCheckActiveFact({ ok: true, checks: [run("a", "done"), run("b", "failed")] }), false);
  assert.equal(visualCheckActiveFact({ ok: true, checks: [] }), false);
  assert.equal(visualCheckActiveFact({ ok: false, error: "project_not_found" }), false);
  assert.equal(visualCheckActiveFact({ ok: false, error: "HTTP 500" }), null);
  assert.equal(visualCheckActiveFact(null), null);
});

/** 개요가 하는 그대로: 같은 응답에서 두 사실을 읽는다. */
function overviewFacts(listRes, extra = {}) {
  return {
    entryPath: "code", hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true, hasReviewRun: false,
    hasVisualCheck: steps.visualCheckFact(listRes),
    visualCheckActive: typeof steps.visualCheckActiveFact === "function" ? steps.visualCheckActiveFact(listRes) : undefined,
    ...extra,
  };
}

test("결함2 재현①: 첫 확인이 실행 중일 때 개요는 '결과가 있어요'가 아니라 '진행 상황 보기'", () => {
  const facts = overviewFacts({ ok: true, checks: [run("r1", "running")] });
  assert.deepEqual(steps.nextProjectAction(facts), { action: "view_progress", slug: "visual-checks" });
  const s = byKey(steps.computeProjectSteps(facts));
  assert.notEqual(s.review.status, "done", "실행 중인 런만으로 2단계 ✓가 되면 안 된다");
  assert.notEqual(s.results.status, "current");
});

test("결함2 재현②: 디스패치 실패로 failed 런만 있으면 다시 확인하기(run_review), 2단계 ✓ 없음", () => {
  const facts = overviewFacts({ ok: true, checks: [run("r1", "failed")] });
  assert.deepEqual(steps.nextProjectAction(facts), { action: "run_review", slug: "visual-checks" });
  assert.notEqual(byKey(steps.computeProjectSteps(facts)).review.status, "done");
});

test("결함2 [행동 보존 가드]: 끝난 런이 있으면 새 런이 돌고 있어도 결과 보기", () => {
  const facts = overviewFacts({ ok: true, checks: [run("r2", "running"), run("r1", "done")] });
  assert.deepEqual(steps.nextProjectAction(facts), { action: "view_results", slug: "visual-checks" });
});

test("결함2: 사이드바도 같은 사실 함수를 쓴다 (진행 중 런으로 ✓ 금지는 두 화면 공통)", () => {
  const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  assert.match(sidebar, /visualCheckFact\(res\)/);
  const overview = readFileSync(path.join(SRC, "app/projects/[id]/page.tsx"), "utf8");
  assert.match(overview, /visualCheckActiveFact\(res\)/);
  assert.match(overview, /visualCheckActive=\{visualCheckActive\}/);
});

// ─── 결함 3 [P2] 앱 유무를 모르는 동안 2단계 라벨·항목을 그리지 않는다 ─────────────

test("결함3: stepMapView — 복원된 아이디어 갈래는 저장소·주소 조회가 끝날 때까지 라벨·상태를 보류", () => {
  const stepMapView = fn("stepMapView");
  const loading = { entryPath: "idea", hasItems: false, hasRepo: null, hasRepoSource: null, hasDeployUrl: null, hasReviewRun: null, hasVisualCheck: null };
  const v = stepMapView(loading, false);
  assert.equal(v.known, false);
  assert.equal(v.reviewLabelKey, null, "'만들기·검수'를 그렸다가 '앱 확인'으로 바꾸지 않는다");
  for (const s of v.steps) {
    assert.equal(s.status, "todo", `${s.key}: 모르는 동안 current/locked/done 표시 금지`);
    assert.equal(s.lockReason, null);
    assert.equal(s.optional, false);
  }
  // 저장소가 링크돼 있다고 밝혀지면 즉시 확정 (긍정 사실은 뒤집히지 않는다).
  const linked = stepMapView({ ...loading, hasRepo: true }, false);
  assert.equal(linked.known, true);
  assert.equal(linked.reviewLabelKey, "reviewApp");
  // 둘 다 끝났는데 앱이 없으면 종전 라벨.
  const none = stepMapView({ ...loading, hasRepo: false, hasRepoSource: false, hasDeployUrl: false }, true);
  assert.equal(none.known, true);
  assert.equal(none.reviewLabelKey, "review");
  // 조회가 실패해 사실이 null로 남아도, 끝났으면 종전 라벨로 그린다(영원히 보류하지 않는다).
  assert.equal(stepMapView(loading, true).reviewLabelKey, "review");
});

test("결함3: 코드 갈래는 조회를 기다리지 않는다 (종전처럼 즉시 그림)", () => {
  const stepMapView = fn("stepMapView");
  const v = stepMapView({ entryPath: "code", hasItems: false, hasRepo: null, hasReviewRun: null }, false);
  assert.equal(v.known, true);
  assert.equal(v.reviewLabelKey, "reviewApp");
  assert.deepEqual(v.steps, steps.computeProjectSteps({ entryPath: "code", hasItems: false, hasRepo: null, hasReviewRun: null }));
});

test("결함3: sidebarStepItems — 앱 유무를 모르면(null) 두 경우에 공통인 '확인 결과'만", () => {
  assert.deepEqual(steps.sidebarStepItems({ hasApp: null, developerMode: false, hasPrReviewHistory: null }), { review: [], results: ["checks"] });
  assert.deepEqual(steps.sidebarStepItems({ hasApp: null, developerMode: true, hasPrReviewHistory: true }), { review: [], results: ["checks"] });
});

test("결함3: 개요와 사이드바가 같은 보류 규칙(stepMapView)을 쓰고, 사이드바는 정착 플래그를 둔다", () => {
  const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  const overview = readFileSync(path.join(SRC, "app/projects/[id]/page.tsx"), "utf8");
  assert.match(overview, /stepMapView\(facts, factsSettled\)/);
  assert.match(sidebar, /stepMapView\(/);
  assert.match(sidebar, /appFactsSettled/);
  // 라벨은 뷰가 정한 키로만 — 보류 중엔 라벨 대신 자리표시.
  assert.ok(!/t\.stepsNav\[reviewStepLabelKey\(/.test(overview), "overview still picks the label without waiting");
  assert.ok(!/t\.stepsNav\[reviewStepLabelKey\(/.test(sidebar), "sidebar still picks the label without waiting");
});

// ─── 결함 4 [P2] 비개발자 모드의 /github에서도 '다음 →'이 이어진다 ───────────────

// ★의도된 변경 (#559 여정 렌즈 결함 4): 1차 정정은 "확인 항목"으로 이었는데, 그 화면의 primary
//  "실제 앱 확인하기"와 다른 두 번째 답이었다. 이제 바는 그 버튼과 같은 곳 — 주소가 있으면 실제
//  앱 확인 — 이고, 주소 사실을 모르면 바 없이 화면 버튼이 유일한 길이다(막다른 길 아님).
test("결함4: /github(개발자용 화면)에 비개발자가 와도 다음 걸음이 있다 — 화면 버튼과 같은 곳", () => {
  assert.equal(steps.nextScreenSlug("github", "code", { hasDeployUrl: true }), "visual-checks");
  assert.equal(steps.nextStepFromHere("github", { entryPath: "code", hasDeployUrl: true })?.slug, "visual-checks");
  // 기본 순서에는 여전히 넣지 않는다 (D9).
  assert.equal(steps.nextScreenSlug("visual-checks", "code"), "items");
});

// ─── 결함 5 [P2] 앱이 있는 아이디어 갈래의 '다음 →'은 만들기 안내로 보내지 않는다 ──

test("결함5: 앱이 있으면(복원된 아이디어 갈래) 코드 갈래 걸음을 쓴다", () => {
  const opts = { hasApp: true };
  assert.equal(steps.nextScreenSlug("settings", "idea", opts), "visual-checks");
  assert.equal(steps.nextScreenSlug("items", "idea", opts), "checks", "확인 항목 다음은 확인 결과 (dev-spec → 빌더 팩 아님)");
  assert.equal(steps.nextScreenSlug("dev-spec", "idea", opts), null, "만들기 안내로 보내지 않는다");
  assert.equal(steps.nextScreenSlug("fixes", "idea", opts), null, "결과 루프도 빌더 팩으로 끝나지 않는다");
  assert.equal(steps.nextStepFromHere("items", { entryPath: "idea", hasApp: true })?.slug, "checks");
});

test("결함5 [행동 보존 가드]: 앱이 없는 아이디어 갈래는 종전 걸음 그대로", () => {
  for (const hasApp of [false, undefined]) {
    assert.equal(steps.nextScreenSlug("dev-spec", "idea", { hasApp }), "export");
    assert.equal(steps.nextScreenSlug("fixes", "idea", { hasApp }), "export");
  }
});

test("결함5: app-presence — 사이드바가 확정한 앱 유무를 다른 화면이 같은 값으로 읽는다", async () => {
  const mod = await import("../src/lib/app-presence.mjs");
  const events = [];
  const target = { dispatchEvent: (e) => events.push(e.detail) };
  const id = `p-${Date.now()}`;
  assert.equal(mod.readAppPresence(id), null, "발행 전엔 모름");
  mod.publishAppPresence(id, true, target);
  assert.equal(mod.readAppPresence(id), true);
  assert.deepEqual(events, [{ projectId: id, hasApp: true }]);
  mod.publishAppPresence(id, true, target);
  assert.equal(events.length, 1, "같은 값은 다시 알리지 않는다");
  mod.publishAppPresence(id, null, target);
  assert.equal(mod.readAppPresence(id), true, "모름(null)은 확정값을 지우지 않는다");
  assert.equal(typeof mod.APP_PRESENCE_EVENT, "string");
});

test("결함5: 다음 버튼은 사이드바가 확정한 앱 유무를 넘기고, 아이디어 갈래에서 모르면 보류한다", () => {
  const nextBtn = readFileSync(path.join(SRC, "components/StepNextButton.tsx"), "utf8");
  const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  assert.match(nextBtn, /useAppPresence\(/);
  assert.match(nextBtn, /nextStepFromHere\(here, \{[\s\S]*?hasApp,[\s\S]*?\}\)/);
  assert.match(nextBtn, /presence === null/);
  assert.match(sidebar, /publishAppPresence\(/);
  // 프로젝트를 바꾼 첫 렌더엔 사실이 아직 이전 프로젝트 것이다 — 그걸 새 id로 발행하지 않는다.
  assert.match(sidebar, /factsProjectId === projectId && view\.known\) publishAppPresence\(projectId, hasApp\)/);
});

// ─── 결함 6 [P2] 코드 갈래 3단계 잠금은 주소 기준, 확정 사실만 ───────────────────

test("결함6: 코드 갈래에서 저장소·주소·확인 모두 확정 없음 → 잠금 사유는 '앱 주소' (코드 연결 아님)", () => {
  const s = byKey(steps.computeProjectSteps({
    entryPath: "code", hasItems: false, hasRepo: false, hasRepoSource: false, hasDeployUrl: false,
    hasReviewRun: false, hasVisualCheck: false,
  }));
  assert.equal(s.results.status, "locked");
  assert.equal(s.results.lockReason, "need_url");
});

test("결함6: 모르는 사실(null)로는 잠그지 않는다 — 주소·소스·확인 조회가 늦거나 실패해도", () => {
  const s = byKey(steps.computeProjectSteps({
    entryPath: "code", hasItems: false, hasRepo: false, hasRepoSource: null, hasDeployUrl: null,
    hasReviewRun: false, hasVisualCheck: null,
  }));
  assert.notEqual(s.results.status, "locked");
  assert.equal(s.results.lockReason, null);
});

test("결함6: 사이드바 잠금 안내가 개요의 '앱 주소' 요구와 같은 말을 한다", () => {
  assert.equal(DICTIONARIES.ko.stepsNav.lockNeedUrl, "앱 주소를 먼저 넣으세요.");
  assert.equal(typeof DICTIONARIES.en.stepsNav.lockNeedUrl, "string");
  const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  // ★의도된 변경 (PR #578 검증 결함 1·8): 잠김 안내 매핑은 순수 함수 lockHintKey 한 곳으로 옮겼다(만들기가 열리면
  //  need_build 안내가 [만들기] 경로를 말한다). need_url은 그대로 "앱 주소를 먼저" — 여기서 행동으로 고정한다.
  assert.equal(steps.lockHintKey("need_url", { makeOpen: true }), "lockNeedUrl");
  assert.equal(steps.lockHintKey("need_url", {}), "lockNeedUrl");
  assert.match(sidebar, /lockHintKey\(reason, \{ makeOpen \}\)/);
  assert.match(sidebar, /t\.stepsNav\[key\]/);
  assert.ok(!/need_code/.test(sidebar), "sidebar still maps the retired need_code reason");
  // 코드 갈래에서는 확정된 "주소 없음"을 넘긴다 (그래야 잠금이 개요와 같은 사실로 정해진다).
  assert.match(sidebar, /entryPath === "code" \? hasDeployUrl/);
});

// ─── 결함 7 [P2] /repo 404도 "서버에 없음 = 확정 없음" ───────────────────────────

test("결함7: repoConnectedFact — HTTP 404(서버에 없거나 이 키의 것이 아님)는 확정 없음(false)", () => {
  assert.equal(settle.repoConnectedFact({ ok: false, error: "HTTP 404" }), false);
  assert.equal(settle.repoConnectedFact({ ok: false, error: "not_found" }), false);
  assert.equal(settle.repoConnectedFact({ ok: false, error: "HTTP 503" }), null, "일시 오류는 여전히 모름");
});

test("결함7: 서버 미러가 실패한 아이디어 프로젝트(모든 조회 404)도 '확인 항목 만들기'가 뜬다", () => {
  const facts = {
    entryPath: "idea", hasItems: false,
    hasRepo: settle.repoConnectedFact({ ok: false, error: "HTTP 404" }),
    ...(() => { const f = steps.sourceFacts({ ok: false, error: "project_not_found" }); return { hasDeployUrl: f.hasDeployUrl, hasRepoSource: f.hasRepoSource }; })(),
    hasReviewRun: steps.reviewRunFact({ ok: false, error: "HTTP 404" }),
    hasVisualCheck: steps.visualCheckFact({ ok: false, error: "project_not_found" }),
  };
  assert.deepEqual(steps.nextProjectAction(facts), { action: "create_items", slug: "items" });
});

// ─── 결함 8·12 [P2] /github 빈 상태 — 순수 헬퍼 + primary 하나 ─────────────────

test("결함8·12: githubPullsView — 0개 & 연결된 PR 없음 → 빈 상태 카드(primary 하나), 머리글 없음", () => {
  const githubPullsView = fn("githubPullsView");
  assert.deepEqual(githubPullsView({ pullsPhase: "done", openCount: 0, linkedCount: 0 }), { list: false, empty: "action", devNote: false });
});

test("결함8: 0개인데 전에 연결한 PR이 있으면 빈 상태는 문구만(primary 없음) — 'PR이 없는 게 보통'과 모순 금지", () => {
  const githubPullsView = fn("githubPullsView");
  assert.deepEqual(githubPullsView({ pullsPhase: "done", openCount: 0, linkedCount: 2 }), { list: false, empty: "quiet", devNote: true });
});

test("결함12: 열린 PR이 있을 때만 'N개 열려 있는' 목록, 불러오기 전·오류엔 목록도 빈 상태도 없음", () => {
  const githubPullsView = fn("githubPullsView");
  assert.deepEqual(githubPullsView({ pullsPhase: "done", openCount: 3, linkedCount: 0 }), { list: true, empty: null, devNote: true });
  for (const pullsPhase of ["idle", "loading", "error"]) {
    assert.deepEqual(githubPullsView({ pullsPhase, openCount: 0, linkedCount: 0 }), { list: false, empty: null, devNote: true }, pullsPhase);
  }
});

test("결함12: /github 배선 — 빈 상태 primary는 실제 앱 확인, 머리글은 목록 블록 안에만", () => {
  const githubPage = readFileSync(path.join(SRC, "app/projects/[id]/github/page.tsx"), "utf8");
  assert.match(githubPage, /githubPullsView\(\{/);
  const action = /\{pullsView\.empty === "action" && \(([\s\S]*?)\n {10}\)\}/.exec(githubPage);
  assert.ok(action, "empty-state (action) block not found");
  assert.match(action[1], /href=\{liveAppHref\} className="btn btn-md btn-primary/);
  assert.match(action[1], /t\.github\.checkLiveApp/);
  assert.match(action[1], /t\.github\.noPulls\b/);
  const quiet = /\{pullsView\.empty === "quiet" && \(([\s\S]*?)\n {10}\)\}/.exec(githubPage);
  assert.ok(quiet, "empty-state (quiet) block not found");
  assert.ok(!/btn-primary/.test(quiet[1]), "quiet empty state must not add a second primary");
  const list = /\{pullsView\.list && \(([\s\S]*?)\n {10}\)\}/.exec(githubPage);
  assert.ok(list, "open-PR list block not found");
  assert.match(list[1], /\{pulls\.length\} \{t\.github\.openPulls\}/);
  // 머리글("N개 열려 있는")은 목록 블록 밖에 없다.
  assert.equal(githubPage.match(/t\.github\.openPulls/g)?.length, 1);
  assert.match(githubPage, /\{pullsView\.devNote && \(/);
});

// ─── 결함 9 [P2] 주소를 고쳐 다시 누르면 방금 넣은 주소를 바꾼다 (중복 등록 금지) ───

test("결함9: addressSubmitPlan — 같은 주소면 재사용, 고친 주소면 방금 넣은 것을 지우고 새로", () => {
  const plan = address.addressSubmitPlan;
  assert.equal(typeof plan, "function", "app-address.addressSubmitPlan is not exported");
  assert.deepEqual(plan(null, "https://a.lovable.app"), { reuseSourceId: null, removeSourceId: null });
  assert.deepEqual(plan({ url: "https://a.lovable.app", sourceId: "s1" }, "https://a.lovable.app"), { reuseSourceId: "s1", removeSourceId: null });
  assert.deepEqual(plan({ url: "https://a.lovable.app", sourceId: "s1" }, "https://b.lovable.app"), { reuseSourceId: null, removeSourceId: "s1" });
  // 한글 도메인도 같은 규칙 (Rule 6).
  assert.deepEqual(plan({ url: "https://내앱.한국", sourceId: "s2" }, "https://내앱.한국"), { reuseSourceId: "s2", removeSourceId: null });
});

test("결함9: AppAddressStart가 계획대로 이전 주소를 지운다", () => {
  const comp = readFileSync(path.join(SRC, "components/AppAddressStart.tsx"), "utf8");
  assert.match(comp, /addressSubmitPlan\(saved\.current, norm\.url\)/);
  assert.match(comp, /deleteProjectSource\(projectId, plan\.removeSourceId, userKey\)/);
});

// ─── 결함 10·11 — 의도된 규칙을 테스트로 고정 ────────────────────────────────

test("결함10 [행동 보존 가드]: 저장소 사실이 아직 모름(null)이면 아이디어 갈래도 CTA 보류 — 항목 만들기 → 주소 넣기로 뒤집히지 않게", () => {
  // 복원된 코드 갈래 프로젝트는 entryPath가 "idea"로 채워지고 항목이 없는 경우가 흔하다(Bae 신고 케이스).
  assert.equal(
    steps.nextProjectAction({ entryPath: "idea", hasItems: false, hasRepo: null, hasRepoSource: false, hasDeployUrl: false, hasReviewRun: false, hasVisualCheck: false }),
    null,
  );
});

test("결함11: PR 리뷰가 확정됐으면 실제 앱 확인 목록 조회가 실패(null)해도 '확인했음' — 결과 보기·2단계 ✓ 유지", () => {
  const facts = { entryPath: "code", hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true, hasReviewRun: true, hasVisualCheck: null };
  assert.deepEqual(steps.nextProjectAction(facts), { action: "view_results", slug: "checks" });
  assert.equal(byKey(steps.computeProjectSteps(facts)).review.status, "done");
  // 반대로 실제 앱 확인이 확정이면 PR 이력을 몰라도 결과 보기(목적지는 실제 앱 확인 결과).
  assert.deepEqual(
    steps.nextProjectAction({ ...facts, hasReviewRun: null, hasVisualCheck: true }),
    { action: "view_results", slug: "visual-checks" },
  );
});

// ─── 결함 13 [P2] 사이드바·다음 버튼 라벨은 앱 유무에 따라 ──────────────────────

test("결함13: navLabelKey — 앱이 없으면 '시각 검수'(종전), 있으면 '앱 확인하기'; 만들기 안내 이름도 사이드바와 같게", () => {
  const navLabelKey = fn("navLabelKey");
  assert.equal(navLabelKey("visual-checks", { hasApp: false }), "visualChecks");
  assert.equal(navLabelKey("visual-checks", { hasApp: true }), "checkApp");
  assert.equal(navLabelKey("github", {}), "githubDev");
  assert.equal(navLabelKey("export", { developerMode: false }), "buildGuide");
  assert.equal(navLabelKey("export", { developerMode: true }), "export");
  assert.equal(navLabelKey("checks", {}), "checks");
  assert.equal(navLabelKey("items", {}), "items");
  for (const slug of ["idea", "spec", "items", "settings", "fixes", "checks", "dev-spec"]) {
    assert.equal(typeof DICTIONARIES.ko.nav[navLabelKey(slug, {})], "string", slug);
  }
});

test("결함13: 사이드바와 다음 버튼이 같은 라벨 규칙(navLabelKey)을 쓴다", () => {
  const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
  const nextBtn = readFileSync(path.join(SRC, "components/StepNextButton.tsx"), "utf8");
  assert.match(sidebar, /navLabelKey\(/);
  assert.match(nextBtn, /navLabelKey\(/);
  assert.ok(!/"visual-checks": t\.nav\.checkApp/.test(sidebar), "sidebar still labels visual-checks 'check the app' without an app");
});

// ─── 새 문구: KO/EN 파리티 + 초보자 금칙어 ──────────────────────────────────

const NEW_KEYS = [
  "commandCenter.viewProgress",
  "commandCenter.viewProgressDesc",
  "stepsNav.lockNeedUrl",
  "github.noPullsLinked",
];
const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const FORBIDDEN = [
  /브랜치/, /터미널/, /저장소/, /커밋/, /토큰/, /푸시/, /새로고침/,
  /\bbranch/i, /\bterminal/i, /\brepositor/i, /\bcommit/i, /\bdiff\b/i, /\btoken/i, /\bpush/i, /\brefresh/i, /\breload/i,
];

for (const loc of ["ko", "en"]) {
  test(`[${loc}] 결함 수정 새 문구 — 존재 + 초보자 금칙어 0 (PR 표기 없음)`, () => {
    for (const key of NEW_KEYS) {
      const v = at(DICTIONARIES[loc], key);
      assert.equal(typeof v, "string", `${loc}.${key} missing`);
      assert.ok(v.trim().length > 0, `${loc}.${key} empty`);
      for (const re of FORBIDDEN) assert.ok(!re.test(v), `${loc}.${key} has ${re}: "${v}"`);
      assert.deepEqual(devTermHits(v), [], `${loc}.${key}: "${v}"`);
    }
  });
}

test("결함6: 은퇴한 '코드를 먼저 연결하세요' 문구는 사전에서 빠진다 (쓰는 곳이 없다)", () => {
  assert.equal(DICTIONARIES.ko.stepsNav.lockNeedCode, undefined);
  assert.equal(DICTIONARIES.en.stepsNav.lockNeedCode, undefined);
});
