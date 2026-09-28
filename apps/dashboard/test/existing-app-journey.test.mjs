/**
 * existing-app-journey.test.mjs — 기존 앱 여정의 막다른 길 (2026-09-28 Bae 라이브 신고).
 *
 * 재현: GitHub 연결 → "이 기기로 가져오기"로 복원된 프로젝트(저장소 링크 있음, 앱 주소 없음)
 * → 개요 primary "첫 검수 실행하기 →"가 /github(PR 코드 리뷰)로 → "0개 열려 있는 코드 변경(PR)"
 * + "PR 만들기/푸시 후 새로고침" 한 줄 → 다음 버튼 0, 여정 정지.
 *
 * 근본 원인: nextProjectAction이 저장소 링크(hasRepo)만 보면 기본 확인을 PR 리뷰로 보냈고,
 * 주소가 없어도 add_url로 가지 않았으며, "확인했는가"를 PR 리뷰 이력만으로 셌다.
 *
 * 제품 원칙(재정렬 2026-09-27, D-17 amend): 기본 "확인"은 **실제 앱을 여는 검수**다.
 * PR 리뷰는 개발자 도구다. 비개발자 빌더는 PR을 거의 만들지 않으므로 0 PR은 정상이다.
 *
 * 이 파일의 테스트는 (행동 보존 가드로 표시한 것 외에는) 고치기 전 코드에서 실패한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const steps = await import("../src/lib/project-steps.mjs");
const { nextProjectAction, computeProjectSteps, nextScreenSlug, nextStepFromHere } = steps;

const byKey = (s) => Object.fromEntries(s.map((x) => [x.key, x]));

// ─── D1·D2·D3 — nextProjectAction ────────────────────────────────────────────

test("① 코드 갈래 + 저장소 링크 + 주소 확정 없음 → add_url (PR 리뷰 아님)", () => {
  const next = nextProjectAction({
    hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: false,
    hasReviewRun: false, hasVisualCheck: false, entryPath: "code",
  });
  assert.deepEqual(next, { action: "add_url", slug: "sources" });
});

test("② 같은 조건의 아이디어 갈래(복원 기본값) → add_url — 저장소가 있으니 앱이 있다 (빌더 팩 아님)", () => {
  // Bae 신고 케이스: project-restore는 entryPath가 없으면 "idea"로 채운다.
  const next = nextProjectAction({
    hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: false,
    hasReviewRun: false, hasVisualCheck: false, entryPath: "idea",
  });
  assert.deepEqual(next, { action: "add_url", slug: "sources" });
});

test("②-b 앱이 있으면 확인 항목이 없어도 create_items가 끼어들지 않는다 (실제 앱 확인엔 항목이 필요 없다)", () => {
  const next = nextProjectAction({
    hasItems: false, hasRepo: true, hasRepoSource: false, hasDeployUrl: false,
    hasReviewRun: false, hasVisualCheck: false, entryPath: "idea",
  });
  assert.deepEqual(next, { action: "add_url", slug: "sources" });
});

test("②-c 소스로 알려진 저장소(링크 없음)만 있는 아이디어 갈래도 앱이 있는 것으로 본다 → add_url", () => {
  const next = nextProjectAction({
    hasItems: true, hasRepo: false, hasRepoSource: true, hasDeployUrl: false,
    hasReviewRun: false, hasVisualCheck: false, entryPath: "spec",
  });
  assert.deepEqual(next, { action: "add_url", slug: "sources" });
});

test("③ 저장소 링크 + 주소 있음 + 확인 없음 → run_review는 실제 앱 확인(visual-checks)", () => {
  for (const entryPath of ["code", "idea", "spec", null]) {
    const next = nextProjectAction({
      hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true,
      hasReviewRun: false, hasVisualCheck: false, entryPath,
    });
    assert.deepEqual(next, { action: "run_review", slug: "visual-checks" }, `entryPath=${entryPath}`);
  }
});

test("④ 실제 앱 확인만 있음(PR 리뷰 0) → view_results는 visual-checks, 다시 '첫 검수'를 권하지 않는다", () => {
  const next = nextProjectAction({
    hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true,
    hasReviewRun: false, hasVisualCheck: true, entryPath: "code",
  });
  assert.deepEqual(next, { action: "view_results", slug: "visual-checks" });
});

test("⑤ [행동 보존 가드] PR 리뷰만 있음 → view_results는 checks(확인 결과)", () => {
  const next = nextProjectAction({
    hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true,
    hasReviewRun: true, hasVisualCheck: false, entryPath: "code",
  });
  assert.deepEqual(next, { action: "view_results", slug: "checks" });
});

test("⑥ [행동 보존 가드] PR 리뷰 이력 조회 실패(null)면 CTA를 내지 않는다", () => {
  const base = { hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true, entryPath: "code" };
  assert.equal(nextProjectAction({ ...base, hasReviewRun: null, hasVisualCheck: false }), null);
  assert.equal(nextProjectAction({ ...base, hasReviewRun: null, hasVisualCheck: null }), null);
});

test("⑥-a 실제 앱 확인 목록 조회 실패(null)도 같은 규칙 — '확인했음' 사실이 null이면 CTA 없음", () => {
  const base = { hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true, entryPath: "code" };
  assert.equal(nextProjectAction({ ...base, hasReviewRun: false, hasVisualCheck: null }), null);
});

test("⑥-b 주소 여부 미확인이면 잘못된 안내보다 침묵 (앱은 있지만 주소 사실이 null)", () => {
  assert.equal(
    nextProjectAction({
      hasItems: true, hasRepo: true, hasRepoSource: null, hasDeployUrl: null,
      hasReviewRun: false, hasVisualCheck: false, entryPath: "idea",
    }),
    null,
  );
});

test("⑥-c 아이디어 갈래에서 저장소 사실이 아직 없으면 항목 만들기를 먼저 내밀지 않는다(뒤집히는 CTA 방지)", () => {
  // 저장소가 있다고 밝혀지면 add_url로 뒤집힌다 — 사실이 정해질 때까지 침묵.
  assert.equal(
    nextProjectAction({
      hasItems: false, hasRepo: null, hasRepoSource: null, hasDeployUrl: null,
      hasReviewRun: null, hasVisualCheck: null, entryPath: "idea",
    }),
    null,
  );
});

test("⑥-d [행동 보존 가드] 앱이 없는 아이디어 갈래는 종전대로: 항목 없음 → create_items, 항목 있음 → get_pack", () => {
  const none = { hasRepo: false, hasRepoSource: false, hasDeployUrl: false, hasReviewRun: false, hasVisualCheck: false, entryPath: "idea" };
  assert.deepEqual(nextProjectAction({ ...none, hasItems: false }), { action: "create_items", slug: "items" });
  assert.deepEqual(nextProjectAction({ ...none, hasItems: true }), { action: "get_pack", slug: "export" });
});

// ─── D3 — computeProjectSteps: 실제 앱 확인도 "검수 끝"으로 센다 ─────────────────

test("⑦ computeProjectSteps: 실제 앱 확인 런만 있어도 2단계 done, 3단계 current", () => {
  const s = byKey(computeProjectSteps({
    hasItems: true, hasRepo: true, hasRepoSource: false, hasDeployUrl: true,
    hasReviewRun: false, hasVisualCheck: true, entryPath: "code",
  }));
  assert.equal(s.review.status, "done");
  assert.equal(s.results.status, "current");
});

test("⑦-b 사이드바처럼 주소 사실을 안 넘겨도 확인 런이 있으면 2단계 done", () => {
  const s = byKey(computeProjectSteps({
    hasItems: true, hasRepo: false, hasReviewRun: false, hasVisualCheck: true, entryPath: "idea",
  }));
  assert.equal(s.review.status, "done");
});

test("⑦-c 앱이 있는(저장소 링크) 아이디어 갈래는 항목이 없어도 2단계가 잠기지 않는다", () => {
  const s = byKey(computeProjectSteps({
    hasItems: false, hasRepo: true, hasReviewRun: false, hasVisualCheck: false, entryPath: "idea",
  }));
  assert.notEqual(s.review.status, "locked");
  assert.equal(s.review.status, "current");
});

test("⑦-d 코드 갈래에 주소만 있으면 3단계를 '코드를 먼저 연결하세요'로 잠그지 않는다 (코드 연결은 선택)", () => {
  const s = byKey(computeProjectSteps({
    hasItems: false, hasRepo: false, hasRepoSource: false, hasDeployUrl: true,
    hasReviewRun: false, hasVisualCheck: false, entryPath: "code",
  }));
  assert.notEqual(s.results.status, "locked");
});

// ─── D9 — nextScreenSlug / nextStepFromHere ──────────────────────────────────

test("⑧ nextScreenSlug: 코드 갈래 기본 순서에 github 없음 — 준비 다음은 실제 앱 확인", () => {
  assert.equal(nextScreenSlug("settings", "code"), "visual-checks");
  assert.equal(nextScreenSlug("visual-checks", "code"), "items");
  const walk = [];
  let s = "settings";
  while (s) { walk.push(s); s = nextScreenSlug(s, "code"); }
  assert.ok(!walk.includes("github"), `default code walk must not include github: ${walk.join(" → ")}`);
});

test("⑧-b nextScreenSlug: 개발자 모드면 코드 갈래 순서에 github가 들어간다 (실제 앱 확인 다음)", () => {
  const opts = { developerMode: true };
  assert.equal(nextScreenSlug("settings", "code", opts), "visual-checks");
  assert.equal(nextScreenSlug("visual-checks", "code", opts), "github");
  assert.equal(nextScreenSlug("github", "code", opts), "items");
});

test("⑧-c nextStepFromHere가 개발자 모드를 nextScreenSlug까지 전달한다", () => {
  assert.equal(nextStepFromHere("settings", { entryPath: "code" })?.slug, "visual-checks");
  assert.equal(nextStepFromHere("visual-checks", { entryPath: "code", developerMode: true, visual: { findingCount: 0 } })?.slug, "github");
  assert.equal(nextStepFromHere("visual-checks", { entryPath: "code", visual: { findingCount: 0 } })?.slug, "items");
  assert.equal(nextStepFromHere("github", { entryPath: "code", developerMode: true })?.slug, "items");
  // ★정정 (#559 검증 결함 4·13): 기본 모드에서도 PR 화면에 오는 사람이 있다 — PR 검토 이력이
  //  있는 비개발자(사이드바가 보여 준다)·확인 결과 화면의 PR 링크·북마크. 순서 밖이라고 null을
  //  주면 그들의 하단 "다음 →"이 사라진다. 개발자 순서의 다음 칸으로 잇는다.
  assert.equal(nextStepFromHere("github", { entryPath: "code" })?.slug, "items");
});

// ─── D6 — 앱 있음 판정 · 단계 라벨 · 사이드바 항목 ───────────────────────────────

test("projectHasApp: 코드 갈래 · 저장소 링크 · 소스 저장소 · 주소 중 하나라도 확정되면 앱이 있다", () => {
  const { projectHasApp } = steps;
  assert.equal(projectHasApp({ entryPath: "code" }), true);
  assert.equal(projectHasApp({ entryPath: "idea", hasRepo: true }), true);
  assert.equal(projectHasApp({ entryPath: "idea", hasRepoSource: true }), true);
  assert.equal(projectHasApp({ entryPath: "spec", hasDeployUrl: true }), true);
  assert.equal(projectHasApp({ entryPath: "idea", hasRepo: false, hasRepoSource: false, hasDeployUrl: false }), false);
  assert.equal(projectHasApp({ entryPath: "idea", hasRepo: null, hasDeployUrl: null }), false, "모르면 앱 없음(종전 라벨)");
  assert.equal(projectHasApp(null), false);
});

test("reviewStepLabelKey: 앱이 있으면 2단계는 '앱 확인', 아니면 종전 '만들기·검수'", () => {
  const { reviewStepLabelKey } = steps;
  assert.equal(reviewStepLabelKey({ entryPath: "code" }), "reviewApp");
  assert.equal(reviewStepLabelKey({ entryPath: "idea", hasRepo: true }), "reviewApp");
  assert.equal(reviewStepLabelKey({ entryPath: "idea", hasRepo: false, hasDeployUrl: false }), "review");
});

test("sidebarStepItems: 앱 있음 → 2단계 [앱 확인하기], PR 이력/개발자 모드일 때만 코드 변경(PR), 만들기 안내 없음", () => {
  const { sidebarStepItems } = steps;
  assert.deepEqual(
    sidebarStepItems({ hasApp: true, developerMode: false, hasPrReviewHistory: false }),
    { review: ["visual-checks"], results: ["checks"] },
  );
  assert.deepEqual(
    sidebarStepItems({ hasApp: true, developerMode: false, hasPrReviewHistory: true }),
    { review: ["visual-checks", "github"], results: ["checks"] },
  );
  assert.deepEqual(
    sidebarStepItems({ hasApp: true, developerMode: true, hasPrReviewHistory: false }),
    { review: ["visual-checks", "github", "export"], results: ["checks"] },
  );
});

test("sidebarStepItems: 앱 없음은 종전 항목 그대로 → 2단계 [만들기 안내], 3단계 [확인 결과, 앱 확인] — PR 탭 없음", () => {
  const { sidebarStepItems } = steps;
  for (const developerMode of [false, true]) {
    assert.deepEqual(
      sidebarStepItems({ hasApp: false, developerMode, hasPrReviewHistory: false }),
      { review: ["export"], results: ["checks", "visual-checks"] },
    );
  }
});

test("sidebarStepItems: 한 화면이 두 단계에 동시에 나오지 않는다", () => {
  const { sidebarStepItems } = steps;
  for (const hasApp of [true, false]) {
    for (const developerMode of [true, false]) {
      for (const hasPrReviewHistory of [true, false]) {
        const it = sidebarStepItems({ hasApp, developerMode, hasPrReviewHistory });
        const overlap = it.review.filter((s) => it.results.includes(s));
        assert.deepEqual(overlap, [], JSON.stringify({ hasApp, developerMode, hasPrReviewHistory }));
      }
    }
  }
});

test("prReviewVisible (회귀 전수 검색): PR 화면·섹션은 개발자 모드이거나 PR 검토 이력이 있을 때만", () => {
  const { prReviewVisible } = steps;
  assert.equal(prReviewVisible({ developerMode: false, hasPrReviewHistory: false }), false);
  assert.equal(prReviewVisible({ developerMode: false, hasPrReviewHistory: null }), false);
  assert.equal(prReviewVisible({ developerMode: true, hasPrReviewHistory: false }), true);
  assert.equal(prReviewVisible({ developerMode: false, hasPrReviewHistory: true }), true, "쓰고 있는 것은 숨기지 않는다");
  assert.equal(prReviewVisible(null), false);
});

test("explainerKind (D7): 아이디어 안내 목록은 앱이 없는 아이디어·스펙 갈래에서만", () => {
  const { explainerKind } = steps;
  assert.equal(explainerKind({ entryPath: "idea", hasRepo: false, hasDeployUrl: false }), "idea");
  assert.equal(explainerKind({ entryPath: "spec", hasRepo: false, hasDeployUrl: false }), "idea");
  // Bae 신고: 복원된 아이디어 갈래 + 저장소 링크 → "빌더 팩 받기" 목록이 "코드가 연결됐어요"와 함께 떴다.
  assert.equal(explainerKind({ entryPath: "idea", hasRepo: true, hasDeployUrl: false }), "app");
  assert.equal(explainerKind({ entryPath: "code" }), "app");
});

// ─── 사실 매핑 — 개요와 사이드바가 같은 규칙으로 읽는다 ─────────────────────────

test("visualCheckFact / reviewRunFact / sourceFacts: 성공·없음·실패를 구분한다", () => {
  const { visualCheckFact, reviewRunFact, sourceFacts } = steps;
  // 모크는 실제 API 모양(VisualCheckListItem, status 포함)으로 — #559 검증 결함 2 이후
  // 끝난 런(done·uploaded)만 센다(existing-app-journey-fixes.test.mjs).
  assert.equal(visualCheckFact({ ok: true, checks: [{ id: "a", status: "done" }] }), true);
  assert.equal(visualCheckFact({ ok: true, checks: [] }), false);
  assert.equal(visualCheckFact({ ok: false, error: "project_not_found" }), false, "서버에 아직 없는 프로젝트엔 런도 없다");
  assert.equal(visualCheckFact({ ok: false, error: "HTTP 500" }), null);
  assert.equal(visualCheckFact(null), null);

  assert.equal(reviewRunFact({ ok: true, runs: [{}] }), true);
  assert.equal(reviewRunFact({ ok: true, runs: [] }), false);
  assert.equal(reviewRunFact({ ok: false, error: "HTTP 404" }), false);
  assert.equal(reviewRunFact({ ok: false, error: "HTTP 500" }), null);

  assert.deepEqual(
    sourceFacts({ ok: true, sources: [{ type: "website" }, { type: "document" }] }),
    { hasDeployUrl: true, hasRepoSource: false },
  );
  assert.deepEqual(
    sourceFacts({ ok: true, sources: [{ type: "github_repo" }] }),
    { hasDeployUrl: false, hasRepoSource: true },
  );
  assert.deepEqual(sourceFacts({ ok: false, error: "project_not_found" }), { hasDeployUrl: false, hasRepoSource: false });
  assert.deepEqual(sourceFacts({ ok: false, error: "network" }), { hasDeployUrl: null, hasRepoSource: null });
});

// ─── D8 — /github 빈 상태의 목적지 ──────────────────────────────────────────

test("liveAppCheckHref: 주소가 있으면 실제 앱 확인, 없으면 개요의 주소 입력칸, 모르면 확인 화면(그 화면이 안내함)", () => {
  const { liveAppCheckHref, APP_ADDRESS_ANCHOR } = steps;
  assert.equal(APP_ADDRESS_ANCHOR, "app-address");
  assert.equal(liveAppCheckHref("p1", true), "/projects/p1/visual-checks");
  assert.equal(liveAppCheckHref("p1", false), "/projects/p1#app-address");
  assert.equal(liveAppCheckHref("p1", null), "/projects/p1/visual-checks");
  assert.equal(liveAppCheckHref("프로젝트 1", false), `/projects/${encodeURIComponent("프로젝트 1")}#app-address`);
});

// ─── D4 — 주소 입력 검증 · 오류 문구 선택 ────────────────────────────────────

test("normalizeAppAddress: http(s) + 호스트만 본다 (서버가 최종 판단)", async () => {
  const { normalizeAppAddress } = await import("../src/lib/app-address.mjs");
  assert.deepEqual(normalizeAppAddress("  https://my-app.lovable.app  "), { ok: true, url: "https://my-app.lovable.app" });
  assert.deepEqual(normalizeAppAddress("http://localhost:3000/"), { ok: true, url: "http://localhost:3000/" });
  // 스킴 없이 붙여넣는 경우가 흔하다 — 호스트처럼 보이면 https://를 붙인다.
  assert.deepEqual(normalizeAppAddress("my-app.vercel.app"), { ok: true, url: "https://my-app.vercel.app" });
  // 한글 도메인(IDN)도 주소다 (Rule 6: 한글 리얼 데이터).
  const idn = normalizeAppAddress("https://내앱.한국");
  assert.equal(idn.ok, true);
  assert.deepEqual(normalizeAppAddress(""), { ok: false, error: "empty" });
  assert.deepEqual(normalizeAppAddress("   "), { ok: false, error: "empty" });
  assert.deepEqual(normalizeAppAddress("내 앱 주소"), { ok: false, error: "invalid" });
  assert.deepEqual(normalizeAppAddress("ftp://files.example.com"), { ok: false, error: "invalid" });
  assert.deepEqual(normalizeAppAddress("https://"), { ok: false, error: "invalid" });
  assert.deepEqual(normalizeAppAddress("javascript:alert(1)"), { ok: false, error: "invalid" });
  assert.deepEqual(normalizeAppAddress("https://" + "a".repeat(600) + ".com"), { ok: false, error: "invalid" });
});

test("appAddressErrorKey: 서버 오류 코드 → 초보자 문구 키 (모르는 코드는 generic)", async () => {
  const { appAddressErrorKey } = await import("../src/lib/app-address.mjs");
  assert.equal(appAddressErrorKey("invalid_url"), "invalid");
  assert.equal(appAddressErrorKey("invalid_reference"), "invalid");
  assert.equal(appAddressErrorKey("invalid_target_url"), "invalid");
  assert.equal(appAddressErrorKey("source_limit_reached"), "limit");
  assert.equal(appAddressErrorKey("project_not_found"), "notSaved");
  assert.equal(appAddressErrorKey("HTTP 404"), "notSaved");
  assert.equal(appAddressErrorKey("forbidden"), "forbidden");
  assert.equal(appAddressErrorKey("HTTP 403"), "forbidden");
  assert.equal(appAddressErrorKey("rate_limited"), "busy");
  assert.equal(appAddressErrorKey("TypeError: Failed to fetch"), "generic");
  assert.equal(appAddressErrorKey(undefined), "generic");
});

// ─── 사전: 새 키 KO/EN 파리티 + 초보자 금칙어 ───────────────────────────────

const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

/** 이 PR이 추가·변경한 문구의 경로. */
const NEW_KEYS = [
  "nav.checkApp",
  "nav.githubDev",
  "stepsNav.reviewApp",
  "commandCenter.addUrlDesc",
  "commandCenter.addUrlLabel",
  "commandCenter.addUrlPlaceholder",
  "commandCenter.addUrlStart",
  "commandCenter.addUrlStarting",
  "commandCenter.addUrlHelpToggle",
  "commandCenter.addUrlHelpLovable",
  "commandCenter.addUrlHelpBoltV0",
  "commandCenter.addUrlHelpReplit",
  "commandCenter.addUrlHelpSelf",
  "commandCenter.addUrlHelpNotLive",
  "commandCenter.addUrlErrors.empty",
  "commandCenter.addUrlErrors.invalid",
  "commandCenter.addUrlErrors.limit",
  "commandCenter.addUrlErrors.notSaved",
  "commandCenter.addUrlErrors.forbidden",
  "commandCenter.addUrlErrors.busy",
  "commandCenter.addUrlErrors.generic",
  "commandCenter.runReview",
  "commandCenter.runReviewDesc",
  "overview.gsStep1",
  "overview.gsStep2",
  "overview.gsStep3",
  "github.noPulls",
  "github.checkLiveApp",
  "github.noPullsDevNote",
  "github.devScreenNote",
];

/**
 * "PR"(과 "코드 변경")은 **개발자용이라고 스스로 밝히는** 문구에서만 허용한다.
 * 빌더 도구 이름(Lovable·Bolt·v0·Replit)은 사용자가 직접 쓰는 도구라 주소 찾기 도움말과
 * PR 빈 상태 설명에서만 허용한다(D4·D8이 그 문장을 명시). 그 밖의 새 문구는 전부 0.
 */
const PR_ALLOWED = new Set(["nav.githubDev", "github.noPulls", "github.noPullsDevNote", "github.devScreenNote"]);
const TOOL_NAMES_ALLOWED = new Set([
  "commandCenter.addUrlPlaceholder",
  "commandCenter.addUrlHelpLovable",
  "commandCenter.addUrlHelpBoltV0",
  "commandCenter.addUrlHelpReplit",
  "github.noPulls",
]);
const TOOL_NAMES = new Set(["Lovable", "Bolt", "v0"]);

/** 초보자 기본 흐름 금칙어 (지시서 목록 — 브랜치·PR·터미널·저장소·커밋·diff·토큰·푸시·새로고침). */
const FORBIDDEN_KO_EN = [
  /브랜치/, /터미널/, /저장소/, /커밋/, /토큰/, /푸시/, /새로고침/,
  /\bbranch/i, /\bterminal/i, /\brepositor/i, /\bcommit/i, /\bdiff\b/i, /\btoken/i, /\bpush/i, /\brefresh/i, /\breload/i,
];

function at(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

for (const loc of ["ko", "en"]) {
  test(`[${loc}] 새 문구가 모두 존재한다 (KO/EN 파리티)`, () => {
    for (const key of NEW_KEYS) {
      const v = at(DICTIONARIES[loc], key);
      assert.equal(typeof v, "string", `${loc}.${key} missing`);
      assert.ok(v.trim().length > 0, `${loc}.${key} empty`);
    }
  });

  test(`[${loc}] 새 문구에 초보자 금칙어 0 ("PR"은 개발자용 표기 키에서만)`, () => {
    for (const key of NEW_KEYS) {
      const v = at(DICTIONARIES[loc], key);
      for (const re of FORBIDDEN_KO_EN) assert.ok(!re.test(v), `${loc}.${key} has ${re}: "${v}"`);
      const hits = devTermHits(v).filter((h) => {
        if (h.term === "PR" && PR_ALLOWED.has(key)) return false;
        if (TOOL_NAMES.has(h.term) && TOOL_NAMES_ALLOWED.has(key)) return false;
        return true;
      });
      assert.deepEqual(hits, [], `${loc}.${key}: "${v}" → ${JSON.stringify(hits)}`);
    }
  });
}

// #559 검증 결함 14: 제목이 범위보다 넓었다. PR_ALLOWED 중 github.noPulls는 D8이 문장을
// 그대로 지정했고(빌더에겐 PR 0개가 "보통"이라는 설명), 스스로 개발자용이라고 밝히지 않는다 —
// 그 문장 바로 아래에 noPullsDevNote("PR 검토는 개발자용 기능이에요")가 붙는다. 그래서 여기선
// noPulls를 뺀 나머지 셋만 검사한다.
test("PR 허용 키 중 D8 지정 문장(noPulls)을 뺀 나머지는 스스로 개발자용이라고 밝힌다", () => {
  assert.deepEqual(
    [...PR_ALLOWED].filter((k) => k !== "github.noPulls").sort(),
    ["github.devScreenNote", "github.noPullsDevNote", "nav.githubDev"],
    "PR 허용 키가 늘면 이 테스트에 함께 넣는다",
  );
  for (const loc of ["ko", "en"]) {
    const label = at(DICTIONARIES[loc], "nav.githubDev");
    assert.match(label, loc === "ko" ? /개발자용/ : /developer/i);
    assert.match(at(DICTIONARIES[loc], "github.noPullsDevNote"), loc === "ko" ? /개발자용/ : /developer/i);
    assert.match(at(DICTIONARIES[loc], "github.devScreenNote"), loc === "ko" ? /개발자용/ : /developer/i);
  }
});

test("D8: 빈 PR 문구는 '보통'이라고 말하고, 새로고침·푸시를 지시하지 않는다", () => {
  assert.match(DICTIONARIES.ko.github.noPulls, /보통/);
  assert.match(DICTIONARIES.en.github.noPulls, /normal/i);
});

test("D6: 앱 있음 2단계 라벨 — KO '앱 확인' / EN 'Check your app', 종전 라벨은 그대로", () => {
  assert.equal(DICTIONARIES.ko.stepsNav.reviewApp, "앱 확인");
  assert.equal(DICTIONARIES.en.stepsNav.reviewApp, "Check your app");
  assert.equal(DICTIONARIES.ko.stepsNav.review, "만들기·검수");
  assert.equal(DICTIONARIES.ko.nav.checkApp, "앱 확인하기");
  assert.equal(DICTIONARIES.en.nav.checkApp, "Check the app");
});

// ─── 정적 배선 (hydration-guard.test.mjs 방식) ───────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const overview = readFileSync(path.join(SRC, "app/projects/[id]/page.tsx"), "utf8");
const githubPage = readFileSync(path.join(SRC, "app/projects/[id]/github/page.tsx"), "utf8");
const sidebar = readFileSync(path.join(SRC, "components/AppSidebar.tsx"), "utf8");
const nextBtn = readFileSync(path.join(SRC, "components/StepNextButton.tsx"), "utf8");
const notFound = readFileSync(path.join(SRC, "components/ProjectNotFound.tsx"), "utf8");

test("[행동 보존 가드] 개요: '첫 검수'류 버튼이 PR 화면(/github)을 직접 가리키지 않는다", () => {
  assert.ok(!/href=\{`\/projects\/\$\{\w+\}\/github`\}/.test(overview), "overview links straight to /github");
  assert.ok(!/"github"/.test(overview), "overview must not route a CTA to the github slug");
});

test("개요 (D5): 시각 검수 카드가 '첫 검수 실행하기'(runFirst)를 두 번째 버튼으로 내지 않는다", () => {
  assert.ok(!/visualChecks\.overview\.runFirst/.test(overview), "second 'run first' button still rendered");
});

test("개요 (D3): 실제 앱 확인 목록을 조회해 '확인했음'에 넣는다", () => {
  assert.match(overview, /visualCheckFact\(/);
  assert.match(overview, /hasVisualCheck=\{hasVisualCheck\}/);
});

test("개요 (D4): add_url은 링크가 아니라 인라인 주소 입력 → 소스 등록 → 실제 앱 확인 실행", () => {
  assert.match(overview, /<AppAddressStart/);
  const comp = readFileSync(path.join(SRC, "components/AppAddressStart.tsx"), "utf8");
  assert.match(comp, /connectProjectSource\(/);
  assert.match(comp, /runVisualCheck\(/);
  assert.match(comp, /type: "website"/);
  // 확정 의도는 서버 캐스케이드(재정렬 C0)에 맡긴다 — 여기서 intent를 지어내지 않는다.
  assert.ok(!/intent:/.test(comp), "inline start must not invent an intent");
  assert.match(comp, /router\.push\(`\/projects\/\$\{[^}]+\}\/visual-checks\/\$\{[^}]+\}`\)/);
  assert.match(comp, /id=\{APP_ADDRESS_ANCHOR\}/);
});

test("개요 (D7): 아이디어 안내 목록은 explainerKind로 고른다 (entryPath만 보지 않는다)", () => {
  assert.match(overview, /explainerKind\(/);
  assert.ok(!/entryPath === "idea" \?/.test(overview), "idea list still keyed on entryPath alone");
});

test("/github (D8): 빈 상태에 실제 앱 확인 primary가 있고, 옛 '0개 열려 있는' 막다른 줄만 남지 않는다", () => {
  assert.match(githubPage, /liveAppCheckHref\(/);
  assert.match(githubPage, /t\.github\.checkLiveApp/);
  assert.match(githubPage, /t\.github\.noPullsDevNote/);
  assert.match(githubPage, /t\.github\.devScreenNote/);
});

test("사이드바 (D6): 단계 라벨과 항목을 순수 헬퍼로 고르고, 실제 앱 확인 사실을 읽는다", () => {
  // 라벨은 stepMapView가 고른다(안에서 reviewStepLabelKey — #559 검증 결함 3의 보류 규칙 포함).
  assert.match(sidebar, /stepMapView\(/);
  assert.match(sidebar, /view\.reviewLabelKey \? t\.stepsNav\[view\.reviewLabelKey\]/);
  assert.match(sidebar, /sidebarStepItems\(/);
  assert.match(sidebar, /visualCheckFact\(/);
});

test("다음 버튼 (D9): 개발자 모드를 다음 걸음 계산에 넘긴다", () => {
  assert.match(nextBtn, /useDeveloperMode\(\)/);
  // #559 검증 결함 12: 식별자가 파일 어딘가에 있는지가 아니라, nextStepFromHere 호출 인자로 넘기는지.
  assert.match(nextBtn, /nextStepFromHere\(here, \{[\s\S]*?\n\s+developerMode,\n[\s\S]*?\}\)/);
});

test("확인 결과 화면 (회귀 전수 검색): 코드 갈래라는 이유만으로 PR 화면을 primary로 내밀지 않는다", () => {
  // 같은 막다른 길의 형제: checks 화면은 entryPath !== "idea"면 PR 섹션을 열고, PR 리뷰가
  // 없으면 "PR 연결"(/github)을 화면 primary로 골랐다(checksPrimaryCta → connect_pr).
  const checksPage = readFileSync(path.join(SRC, "app/projects/[id]/checks/page.tsx"), "utf8");
  assert.ok(!/entryPath !== "idea"/.test(checksPage), "PR section still gated on the entry branch alone");
  assert.match(checksPage, /prReviewVisible\(\{/);
  assert.match(checksPage, /\{prSectionVisible && \(/);
});

test("D10: '이 브라우저에서 찾을 수 없음'은 마운트(로컬 저장소 읽기) 전에는 그리지 않는다", () => {
  assert.match(notFound, /useEffect\(/);
  assert.match(notFound, /if \(!mounted\)/);
});
