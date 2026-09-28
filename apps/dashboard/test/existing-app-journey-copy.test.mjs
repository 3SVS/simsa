/**
 * existing-app-journey-copy.test.mjs — PR #559 초보자 여정·카피 렌즈 결함 수정 (2026-09-28).
 *
 * PR #559(기존 앱 여정 막다른 길)의 2차 검증 — 초보자가 실제로 걷는 길과 화면 문구를 본
 * 렌즈 — 에서 나온 결함 12건의 재현 테스트다. 이 파일의 테스트는 (행동 보존 가드로 표시한
 * 것 외에는) PR head(7f45ffd)에서 실패한다.
 *
 * 공통 원칙: 한 화면에 "다음에 뭘 누르지?"의 답은 하나, 같은 것은 같은 이름, 없는 것을
 * 있다고 말하지 않는다(도구 안내는 공식 문서와 같은 버튼 이름).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const steps = await import("../src/lib/project-steps.mjs");
const settle = await import("../src/lib/repo-settle.mjs");
const presenceMod = await import("../src/lib/app-presence.mjs");
const { checksPrimaryCta } = await import("../src/lib/checks-cta.mjs");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");

const fn = (mod, name) => {
  const f = mod[name];
  assert.equal(typeof f, "function", `${name} is not exported`);
  return f;
};
const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** A JSX block `{cond && (\n  …\n)}` at a given indent — the body only. */
function block(src, head) {
  const i = src.indexOf(head);
  assert.ok(i !== -1, `block not found: ${head}`);
  const rest = src.slice(i);
  const end = rest.search(/\n\s*\)\}\n/);
  assert.ok(end !== -1, `block end not found: ${head}`);
  return rest.slice(0, end);
}

// 실제 API 모양(workspace-visual-checks-api VisualCheckListItem).
const run = (id, status, createdAt, extra = {}) => ({
  id, status, targetUrl: "https://내앱.lovable.app", decision: status === "done" ? "Ready" : "", works: status === "done" ? false : null,
  executor: "container", evidenceCount: 0, createdAt, ...extra,
});

// ─── 결함 1 [P1] '주소 찾는 법'의 버튼 이름은 공식 문서와 같게 (Deploy → Publish) ──────

// 공식 문서(2026-09-28 확인): Bolt support.bolt.new/cloud/hosting/publish "top-right … Publish",
// …bolt.host · v0 v0.app/docs/deployments "Publish in the chat header", vercel.app ·
// Replit docs.replit.com "Publish at the top", <name>.replit.app · Lovable docs.lovable.dev
// "Publish button sits in the top right", [sub].lovable.app. 세 도구 모두 'Deploy' 버튼·탭이 없다.
const HELP = {
  "commandCenter.addUrlHelpLovable": "lovable.app",
  "commandCenter.addUrlHelpBolt": "bolt.host",
  "commandCenter.addUrlHelpV0": "vercel.app",
  "commandCenter.addUrlHelpReplit": "replit.app",
};

for (const loc of ["ko", "en"]) {
  test(`결함1 [${loc}]: 도구별 주소 안내 — 'Deploy' 없음, 모두 Publish, 주소 끝 모양을 함께 보여 준다`, () => {
    for (const [key, suffix] of Object.entries(HELP)) {
      const v = at(DICTIONARIES[loc], key);
      assert.equal(typeof v, "string", `${loc}.${key} missing`);
      assert.ok(!/deploy|배포 탭|Deploy\(배포\)/i.test(v), `${loc}.${key} still says Deploy: "${v}"`);
      assert.match(v, /Publish/, `${loc}.${key} must name the Publish button`);
      assert.ok(v.includes(suffix), `${loc}.${key} should show the address ending (${suffix}): "${v}"`);
    }
    // Bolt와 v0는 버튼 위치가 달라 한 줄로 묶지 않는다.
    assert.equal(at(DICTIONARIES[loc], "commandCenter.addUrlHelpBoltV0"), undefined, "merged Bolt·v0 line retired");
    assert.match(at(DICTIONARIES[loc], "commandCenter.addUrlHelpV0"), loc === "ko" ? /채팅/ : /chat/i);
  });
}

test("결함1: 주소 입력칸의 도움말이 도구별 네 줄을 그린다 (묶인 옛 줄 없음)", () => {
  const comp = read("components/AppAddressStart.tsx");
  for (const k of ["addUrlHelpLovable", "addUrlHelpBolt", "addUrlHelpV0", "addUrlHelpReplit"]) {
    assert.match(comp, new RegExp(`cc\\.${k}\\b`), k);
  }
  assert.ok(!/addUrlHelpBoltV0/.test(comp));
});

// ─── 결함 2 [P1] 실제 앱 확인 뒤 '다음: 남은 문제 →'가 빈 순환으로 보내지 않는다 ─────────

test("결함2: 실제 앱 확인에서 발견이 있어도 다음 걸음은 /fixes가 아니다 (발견·고칠 방법은 그 결과 화면에 있다)", () => {
  for (const ctx of [
    { visual: { findingCount: 2 }, hasApp: true, entryPath: "code" },
    { visual: { findingCount: 2 }, hasApp: true, entryPath: "idea" },
    { visual: { findingCount: 1 }, entryPath: "idea" },
  ]) {
    const next = steps.nextStepFromHere("visual-checks", ctx);
    assert.notEqual(next?.slug, "fixes", JSON.stringify(ctx));
    assert.equal(next, null, "no competing bottom bar on the result screen");
  }
});

test("결함2 [행동 보존 가드]: 확인 결과(checks)에서 실패가 있으면 여전히 남은 문제로", () => {
  assert.deepEqual(
    steps.nextStepFromHere("checks", { entryPath: "code", hasCheckRun: true, summary: { failed: 1, needsDecision: 0 } }),
    { slug: "fixes", reason: "seeProblems" },
  );
});

test("결함2: /fixes — 실제 앱 확인 결과만 있으면 '확인 결과로 이동'이 아니라 그 결과 화면으로 안내", () => {
  const fixesEntryView = fn(steps, "fixesEntryView");
  assert.deepEqual(fixesEntryView({ projectId: "p_1", hasCheckResults: true, visualCheck: null }), { kind: "items" });
  assert.deepEqual(
    fixesEntryView({ projectId: "p_1", hasCheckResults: false, visualCheck: { findingCount: 2, runId: "vc_1" } }),
    { kind: "live", href: "/projects/p_1/visual-checks/vc_1" },
  );
  assert.deepEqual(
    fixesEntryView({ projectId: "p_1", hasCheckResults: false, visualCheck: { findingCount: 2 } }),
    { kind: "live", href: "/projects/p_1/visual-checks" },
    "older saved result without a run id → the list",
  );
  assert.deepEqual(fixesEntryView({ projectId: "p_1", hasCheckResults: false, visualCheck: null }), { kind: "review_first" });
});

test("결함2: 하단 바는 화면에 이미 primary가 있으면 급해도 secondary로 물러난다", () => {
  const nextBarEmphasis = fn(steps, "nextBarEmphasis");
  assert.equal(nextBarEmphasis({ reason: "seeProblems", screenHasPrimary: true }), "secondary");
  assert.equal(nextBarEmphasis({ reason: "afterFix", screenHasPrimary: true }), "secondary");
  assert.equal(nextBarEmphasis({ reason: "seeProblems", screenHasPrimary: false }), "primary");
  assert.equal(nextBarEmphasis({ reason: "afterFix", screenHasPrimary: false }), "primary");
  assert.equal(nextBarEmphasis({ reason: "seeProblems", screenHasPrimary: null }), "secondary", "unknown → never a second primary");
  for (const reason of ["continue", "allClear", "checkLiveApp"]) {
    assert.equal(nextBarEmphasis({ reason, screenHasPrimary: false }), "secondary", reason);
  }
});

test("결함2: 배선 — 다음 바는 화면의 primary를 살피고, /fixes는 결과 화면 안내를, 결과 화면은 런 id를 남긴다", () => {
  const nextBtn = read("components/StepNextButton.tsx");
  assert.match(nextBtn, /nextBarEmphasis\(\{/);
  assert.match(nextBtn, /MutationObserver/);
  assert.ok(!/urgent \? "btn-primary"/.test(nextBtn), "urgency alone must not pick primary");
  const fixes = read("app/projects/[id]/fixes/page.tsx");
  assert.match(fixes, /fixesEntryView\(\{/);
  assert.match(fixes, /t\.fixesScreen\.liveResultNote/);
  const runPage = read("app/projects/[id]/visual-checks/[runId]/page.tsx");
  assert.match(runPage, /visualCheck: \{[\s\S]*?runId[\s\S]*?\}/);
});

// ─── 결함 3 [P1] 3단계 '확인 결과'에 실제 앱 확인 결과가 있다 ─────────────────────────

test("결함3: latestFinishedRunId — 가장 최근의 끝난 실제 앱 확인 (진행 중·실패 제외)", () => {
  const latestFinishedRunId = fn(steps, "latestFinishedRunId");
  assert.equal(latestFinishedRunId([]), null);
  assert.equal(latestFinishedRunId(null), null);
  assert.equal(
    latestFinishedRunId([
      run("vc_old", "done", "2026-09-27T10:00:00Z"),
      run("vc_new", "done", "2026-09-28T10:00:00Z"),
      run("vc_run", "running", "2026-09-28T11:00:00Z"),
      run("vc_fail", "failed", "2026-09-28T12:00:00Z"),
    ]),
    "vc_new",
  );
  assert.equal(latestFinishedRunId([run("vc_up", "uploaded", "2026-09-28T10:00:00Z")]), "vc_up");
  assert.equal(latestFinishedRunId([run("vc_q", "queued", "2026-09-28T10:00:00Z")]), null);
});

test("결함3: 확인 결과 화면의 primary — 끝난 실제 앱 확인이 있으면 그 결과 보기가 사전 확인보다 앞선다", () => {
  const base = { prSectionVisible: false, prReviewLoaded: true, hasPrReview: false, prNeedsAction: 0, draftNeedsAction: 0, draftHasResults: false };
  assert.equal(checksPrimaryCta({ ...base, liveResult: true }), "view_live");
  assert.equal(checksPrimaryCta({ ...base, liveResult: true, draftNeedsAction: 3, draftHasResults: true }), "view_live");
  // 개발자가 연결한 PR 리뷰에 실제 문제가 있으면 그게 먼저다(종전 순위 유지).
  assert.equal(checksPrimaryCta({ ...base, liveResult: true, prSectionVisible: true, hasPrReview: true, prNeedsAction: 2 }), "pr_fix");
});

test("결함3 [행동 보존 가드]: 실제 앱 확인 결과가 없으면 종전 규칙 그대로", () => {
  const base = { prSectionVisible: false, prReviewLoaded: true, hasPrReview: false, prNeedsAction: 0, draftNeedsAction: 0, draftHasResults: false };
  assert.equal(checksPrimaryCta(base), "run_precheck");
  assert.equal(checksPrimaryCta({ ...base, draftHasResults: true, draftNeedsAction: 1 }), "draft_fix");
  assert.equal(checksPrimaryCta({ ...base, prSectionVisible: true }), "connect_pr");
});

test("결함3: 사전 확인 설명이 저장소가 연결된 프로젝트와 모순되지 않는다 ('코드를 연결하기 전에' 없음)", () => {
  assert.ok(!/코드를 연결하기 전에/.test(DICTIONARIES.ko.checks.draftDesc), DICTIONARIES.ko.checks.draftDesc);
  assert.ok(!/before connecting code/i.test(DICTIONARIES.en.checks.draftDesc), DICTIONARIES.en.checks.draftDesc);
  // 사실만 말한다: 설명서·항목만 보고, 앱을 열어 보지는 않는다.
  assert.match(DICTIONARIES.ko.checks.draftDesc, /열어 보지는 않아요/);
  assert.match(DICTIONARIES.en.checks.draftDesc, /doesn't open your app/);
});

test("결함3: 개요의 '확인 결과 요약'(0/0/0/0)은 PR 리뷰·사전 확인 이력이 있을 때만", () => {
  const resultsSummaryVisible = fn(steps, "resultsSummaryVisible");
  assert.equal(resultsSummaryVisible({ hasReviewActivity: false, hasPrecheck: false, hasReviewRun: false }), false);
  assert.equal(resultsSummaryVisible({ hasReviewActivity: false, hasPrecheck: false, hasReviewRun: null }), false);
  assert.equal(resultsSummaryVisible({ hasReviewActivity: true, hasPrecheck: false, hasReviewRun: false }), true);
  assert.equal(resultsSummaryVisible({ hasReviewActivity: false, hasPrecheck: true, hasReviewRun: false }), true);
  assert.equal(resultsSummaryVisible({ hasReviewActivity: false, hasPrecheck: false, hasReviewRun: true }), true);
});

test("결함3: 배선 — 확인 결과 화면이 최근 실제 앱 확인을 보여 주고, 개요는 요약을 가린다", () => {
  const checks = read("app/projects/[id]/checks/page.tsx");
  assert.match(checks, /listVisualChecks\(/);
  assert.match(checks, /latestFinishedRunId\(/);
  assert.match(checks, /liveResult: /);
  const live = block(checks, "{liveRunId && (");
  assert.match(live, /t\.checks\.liveCta/);
  assert.match(live, /visual-checks\/\$\{liveRunId\}/);
  assert.match(live, /btnClass\(primaryCta === "view_live"\)/, "the live card's button takes the one primary slot");
  const overview = read("app/projects/[id]/page.tsx");
  assert.match(overview, /resultsSummaryVisible\(\{/);
});

// ─── 결함 4 [P2] /github의 하단 바는 그 화면의 CTA와 같은 곳으로 ────────────────────

test("결함4: 비개발자 /github의 다음 — 주소가 있으면 앱 확인, 모르면 없음 (확인 항목 아님)", () => {
  assert.equal(steps.nextScreenSlug("github", "code"), null);
  assert.equal(steps.nextScreenSlug("github", "code", { hasDeployUrl: false }), null);
  assert.equal(steps.nextScreenSlug("github", "code", { hasDeployUrl: true }), "visual-checks");
  assert.equal(steps.nextScreenSlug("github", "idea", { hasApp: true, hasDeployUrl: true }), "visual-checks");
  // 개발자 모드는 개발자 순서 그대로.
  assert.equal(steps.nextScreenSlug("github", "code", { developerMode: true, hasDeployUrl: true }), "items");
  assert.deepEqual(
    steps.nextStepFromHere("github", { entryPath: "code", hasDeployUrl: true }),
    { slug: "visual-checks", reason: "checkLiveApp" },
  );
  assert.equal(steps.nextStepFromHere("github", { entryPath: "code", hasDeployUrl: null }), null);
});

test("결함4: app-presence — 사이드바가 확정한 주소 유무도 같은 방식으로 읽는다", () => {
  const publishAppAddress = fn(presenceMod, "publishAppAddress");
  const readAppAddress = fn(presenceMod, "readAppAddress");
  const events = [];
  const target = { dispatchEvent: (e) => events.push(e.detail) };
  const id = `pa-${Date.now()}`;
  assert.equal(readAppAddress(id), null);
  publishAppAddress(id, false, target);
  assert.equal(readAppAddress(id), false);
  publishAppAddress(id, null, target);
  assert.equal(readAppAddress(id), false, "unknown never erases a known answer");
  publishAppAddress(id, true, target);
  assert.equal(readAppAddress(id), true);
  assert.equal(events.length, 2);
});

test("결함4: 배선 — 사이드바가 주소 유무를 발행하고 다음 바가 넘긴다", () => {
  const nextBtn = read("components/StepNextButton.tsx");
  const sidebar = read("components/AppSidebar.tsx");
  assert.match(sidebar, /publishAppAddress\(/);
  assert.match(nextBtn, /useAppAddress\(/);
  assert.match(nextBtn, /nextStepFromHere\(here, \{[\s\S]*?hasDeployUrl[\s\S]*?\}\)/);
  assert.match(nextBtn, /checkLiveApp: t\.stepsNav\.whyCheckLiveApp/);
});

// ─── 결함 5 [P2] 같은 화면 이름 하나 · 주소 없음은 그 자리에서 ──────────────────────

test("결함5: screenAppView — 앱 유무를 확정 사실로만 (코드 갈래·앱 있음·주소 있음 → 앱 있음, 모르면 보류)", () => {
  const screenAppView = fn(steps, "screenAppView");
  assert.deepEqual(screenAppView({ entryPath: "code", presence: null, hasDeployUrl: null }), { known: true, hasApp: true });
  assert.deepEqual(screenAppView({ entryPath: "idea", presence: true, hasDeployUrl: null }), { known: true, hasApp: true });
  assert.deepEqual(screenAppView({ entryPath: "idea", presence: null, hasDeployUrl: true }), { known: true, hasApp: true });
  assert.deepEqual(screenAppView({ entryPath: "idea", presence: false, hasDeployUrl: false }), { known: true, hasApp: false });
  assert.deepEqual(screenAppView({ entryPath: "idea", presence: null, hasDeployUrl: false }), { known: false, hasApp: false });
  assert.deepEqual(screenAppView({ entryPath: null, presence: null, hasDeployUrl: null }), { known: false, hasApp: false });
});

test("결함5: 실제 앱 확인 화면 — 제목은 사이드바와 같은 이름, 주소 없음은 그 자리 입력칸(/sources로 보내지 않음)", () => {
  const vc = read("app/projects/[id]/visual-checks/page.tsx");
  assert.match(vc, /navLabelKey\("visual-checks"/);
  assert.ok(!/<h2 className="page-title">\{t\.visualChecks\.title\}<\/h2>/.test(vc), "title still hard-coded to 'Visual checks'");
  assert.match(vc, /<AppAddressStart/);
  assert.ok(!/\/sources/.test(vc), "the default path must not send to the Sources screen");
});

for (const loc of ["ko", "en"]) {
  test(`결함5 [${loc}]: 주소 없음 안내는 '앱 주소' — '웹사이트 주소'로 갈리지 않는다`, () => {
    const d = DICTIONARIES[loc];
    for (const s of [d.visualChecks.runNeedWebsite, d.visualChecks.runErrors.websiteSourceRequired]) {
      assert.ok(!(loc === "ko" ? /웹사이트/ : /website/i).test(s), s);
      assert.match(s, loc === "ko" ? /앱 주소|앱이 열리는 주소/ : /app's address/);
    }
  });
}

test("결함5: 제목 아래 본문·결과 화면 뒤로가기·개요 카드가 세 번째 이름('시각 검수')을 꺼내지 않는다", () => {
  for (const key of ["loading", "loadError", "emptyTitle", "emptyBody", "backToList", "notFound"]) {
    assert.ok(!/시각 검수/.test(DICTIONARIES.ko.visualChecks[key]), `ko.${key}: ${DICTIONARIES.ko.visualChecks[key]}`);
    assert.ok(!/visual check/i.test(DICTIONARIES.en.visualChecks[key]), `en.${key}: ${DICTIONARIES.en.visualChecks[key]}`);
  }
  // 주소를 연결한 직후 화면들(재진입 연결·연결 화면 설명)도 같은 이름 가족으로.
  for (const s of [DICTIONARIES.ko.connectReentry.subtitle, DICTIONARIES.ko.connectReentry.success]) assert.ok(!/시각 검수/.test(s), s);
  for (const s of [DICTIONARIES.en.connectReentry.subtitle, DICTIONARIES.en.connectReentry.success]) assert.ok(!/visual check/i.test(s), s);
  const overview = read("app/projects/[id]/page.tsx");
  assert.ok(!/t\.visualChecks\.title/.test(overview), "overview card still titled 'Visual checks'");
});

test("결함11 (D10 잔존): 주소 칸이 도착하는 결과 화면도 첫 페인트에 영어 'Not found.'를 그리지 않는다", () => {
  const runPage = read("app/projects/[id]/visual-checks/[runId]/page.tsx");
  assert.match(runPage, /if \(!project\) return <ProjectNotFound \/>;/);
  assert.ok(!/t\.common\.notFound/.test(runPage));
});

// ─── 결함 6 [P2] PR 빈 상태 문구의 도구 목록은 사실대로 (v0는 PR을 만든다) ──────────────

test("결함6: '변경을 바로 저장하는 도구'에 v0를 넣지 않는다 (v0는 게시할 때 PR을 만들어 합친다)", () => {
  for (const loc of ["ko", "en"]) {
    const s = DICTIONARIES[loc].github.noPulls;
    assert.ok(devTermHits(s).every((h) => h.term !== "v0"), `${loc}: ${s}`);
    assert.match(s, /Lovable/);
    assert.match(s, /Bolt/);
    assert.match(s, loc === "ko" ? /보통/ : /normal/i);
  }
});

test("결함6 (회귀 전수 검색): 저장소 연결 안내도 '빌더의 변경은 PR로 도착한다'고 말하지 않는다", () => {
  // 결과 화면의 "코드 연결하기"가 이제 이 안내가 있는 준비·연결 화면으로 간다(결함 7).
  assert.ok(!/PR|pull request/i.test(DICTIONARIES.ko.github.firstTimePlatform), DICTIONARIES.ko.github.firstTimePlatform);
  assert.ok(!/PR|pull request/i.test(DICTIONARIES.en.github.firstTimePlatform), DICTIONARIES.en.github.firstTimePlatform);
});

// ─── 결함 7 [P2] /github 저장소 없음·불러오기 실패에도 출구와 '개발자용' 표기 ─────────────

test("결함7: /github 저장소 없음·불러오기 실패 카드에도 '개발자용 화면' 한 줄과 실제 앱 확인 링크", () => {
  const gh = read("app/projects/[id]/github/page.tsx");
  const noRepo = block(gh, `{!isExample && loadPhase === "no_repo" && (`);
  assert.match(noRepo, /t\.github\.devScreenNote/);
  assert.match(noRepo, /href=\{liveAppHref\}/);
  const loadErr = block(gh, `{!isExample && loadPhase === "load_error" && (`);
  assert.match(loadErr, /t\.github\.devScreenNote/);
  assert.match(loadErr, /href=\{liveAppHref\}/);
  // 앱이 있는(또는 아직 모르는) 프로젝트에 '빌더팩 받기'를 내밀지 않는다 — 확정된 '앱 없음'에서만.
  assert.match(noRepo, /\{appView\.known && !appView\.hasApp && \(/);
  assert.match(gh, /screenAppView\(\{/);
  // '왜 여기서 코드 저장소를…' 다리 설명도 앱이 없다고 확정된 경우에만.
  assert.match(gh, /loadPhase !== "ready" && appView\.known && !appView\.hasApp &&/);
});

test("결함7: 결과 화면의 '코드 연결하기'는 저장소 연결이 실제로 있는 준비·연결 화면으로", () => {
  const runPage = read("app/projects/[id]/visual-checks/[runId]/page.tsx");
  const paste = runPage.slice(runPage.indexOf("function BuilderPasteSection"), runPage.indexOf("function RepairSection"));
  assert.match(paste, /href=\{`\/projects\/\$\{projectId\}\/settings`\}/);
  assert.ok(!/\/github`/.test(paste));
});

// ─── 결함 8 [P2] 아이디어 갈래 '이미 만드셨나요?'는 같은 입력칸을 접어서 ──────────────────

test("결함8: 빌더 팩 카드의 '이미 만드셨나요?'는 /sources 링크가 아니라 접힌 주소 입력칸(보조 버튼)", () => {
  const overview = read("app/projects/[id]/page.tsx");
  const pack = block(overview, `{next?.action === "get_pack" && (`);
  assert.match(pack, /<AppAddressStart[^>]*emphasis="secondary"/);
  assert.ok(!/\/sources/.test(pack), "still sends to the Sources screen");
  assert.match(pack, /<details/);
  const comp = read("components/AppAddressStart.tsx");
  assert.match(comp, /emphasis\?: "primary" \| "secondary"/);
  assert.match(comp, /emphasis === "secondary" \? "btn-secondary" : "btn-primary"/);
});

// ─── 결함 9 [P2] 확인을 마치면 '처음 쓰는 법' 목록은 물러난다 ──────────────────────────

test("결함9: howItWorksVisible — 실제 앱 확인이나 PR 리뷰를 마쳤으면 안내 목록을 내리지 않는다", () => {
  const howItWorksVisible = fn(steps, "howItWorksVisible");
  assert.equal(howItWorksVisible({ hasReviewActivity: false, hasVisualCheck: false, hasReviewRun: false }), true);
  assert.equal(howItWorksVisible({ hasReviewActivity: false, hasVisualCheck: null, hasReviewRun: null }), true, "unknown keeps the list (fail-open)");
  assert.equal(howItWorksVisible({ hasReviewActivity: false, hasVisualCheck: true, hasReviewRun: false }), false);
  assert.equal(howItWorksVisible({ hasReviewActivity: false, hasVisualCheck: false, hasReviewRun: true }), false);
  assert.equal(howItWorksVisible({ hasReviewActivity: true, hasVisualCheck: false, hasReviewRun: false }), false);
});

test("결함9: 배선 — 개요는 확인 조회가 끝난 뒤에 목록을 그리고, 주소가 있으면 1번을 끝난 걸로 표시", () => {
  const overview = read("app/projects/[id]/page.tsx");
  assert.match(overview, /howItWorksVisible\(\{/);
  assert.match(overview, /checksSettled/);
  assert.match(overview, /hasDeployUrl === true \?/);
});

// ─── 결함 10 [P2] 빌더 팩 화면 이름은 사이드바와 같게 (기본 보기 '만들기 안내') ──────────

test("결함10: packCopyKeys — 기본 보기는 '만들기 안내', 개발자 모드는 '빌더 팩' (사이드바 navLabelKey와 같은 규칙)", () => {
  const packCopyKeys = fn(steps, "packCopyKeys");
  assert.deepEqual(packCopyKeys(false), { label: "getGuide", step2: "gsIdeaStep2Guide" });
  assert.deepEqual(packCopyKeys(true), { label: "getPack", step2: "gsIdeaStep2" });
  for (const loc of ["ko", "en"]) {
    const d = DICTIONARIES[loc];
    const guide = d.nav.buildGuide; // 사이드바 기본 보기 이름
    assert.ok(d.commandCenter.getGuide.includes(loc === "ko" ? guide : guide.toLowerCase()), `${loc}: ${d.commandCenter.getGuide}`);
    assert.ok(d.overview.gsIdeaStep2Guide.includes(loc === "ko" ? guide : guide.toLowerCase()) || d.overview.gsIdeaStep2Guide.includes(guide), `${loc}: ${d.overview.gsIdeaStep2Guide}`);
    for (const s of [d.commandCenter.getGuide, d.overview.gsIdeaStep2Guide]) {
      assert.ok(!(loc === "ko" ? /빌더/ : /builder pack/i).test(s), s);
    }
  }
  const overview = read("app/projects/[id]/page.tsx");
  assert.match(overview, /packCopyKeys\(developerMode\)/);
  assert.match(overview, /useDeveloperMode\(\)/);
});

// ─── 결함 11 [P2] 사이드바 첫 페인트에 영어·'프로젝트 없음'을 그리지 않는다 ─────────────

test("결함11: 사이드바는 마운트(저장소·언어 읽기) 전엔 문구 없는 자리표시만 그린다", () => {
  const sidebar = read("components/AppSidebar.tsx");
  assert.match(sidebar, /const \[mounted, setMounted\] = useState\(false\)/);
  const guard = sidebar.indexOf("if (!mounted)");
  assert.ok(guard !== -1, "no pre-mount branch");
  const tail = sidebar.slice(guard);
  const pre = tail.slice(0, tail.indexOf("\n  }\n"));
  assert.ok(pre.length > 0);
  assert.ok(!/t\.nav\.|t\.account\.|t\.pricing\./.test(pre), "the pre-mount placeholder must not print localized copy");
  assert.ok(guard < sidebar.indexOf("const expandedBody"), "guard must run before the full body is built into the tree");
});

// ─── 결함 12 [P2] 아이디어 갈래 보류 시간 — 저장소 첫 응답이 '없음'이면 기다리지 않는다 ────

test("결함12: fetchProjectRepoSettled — 첫 응답을 onFirst로 먼저 알린다 (재시도는 그대로)", async () => {
  const answers = [{ ok: true, repo: null }, { ok: true, repo: null }, { ok: true, repo: { fullName: "a/b" } }];
  let calls = 0;
  const fake = async () => answers[Math.min(calls++, answers.length - 1)];
  const firsts = [];
  const res = await settle.fetchProjectRepoSettled(fake, "p", "uk", { delayMs: 0, onFirst: (r) => firsts.push(r) });
  assert.deepEqual(firsts, [{ ok: true, repo: null }], "onFirst fires once with the first answer");
  assert.deepEqual(res, { ok: true, repo: { fullName: "a/b" } }, "the settled answer still comes from the retries");
});

test("결함12: 배선 — 개요·사이드바가 첫 응답으로 앱 유무를 먼저 정하고, 재시도 결과로 고친다", () => {
  for (const rel of ["app/projects/[id]/page.tsx", "components/AppSidebar.tsx"]) {
    const src = read(rel);
    assert.match(src, /onFirst: \(first\) =>/, rel);
    assert.match(src, /setHasRepo\(repoConnectedFact\(first\)\)/, rel);
  }
});

// ─── 사전: 새·바뀐 문구 KO/EN 파리티 + 초보자 금칙어 ─────────────────────────────

const NEW_KEYS = [
  "commandCenter.addUrlHelpLovable",
  "commandCenter.addUrlHelpBolt",
  "commandCenter.addUrlHelpV0",
  "commandCenter.addUrlHelpReplit",
  "commandCenter.addUrlFoldLink",
  "commandCenter.getGuide",
  "overview.gsIdeaStep2Guide",
  "stepsNav.whyCheckLiveApp",
  "fixesScreen.liveResultNote",
  "checks.liveTitle",
  "checks.liveDesc",
  "checks.liveCta",
  "checks.draftDesc",
  "visualChecks.runNeedWebsite",
  "visualChecks.runErrors.websiteSourceRequired",
  "visualChecks.loading",
  "visualChecks.loadError",
  "visualChecks.emptyTitle",
  "visualChecks.emptyBody",
  "visualChecks.backToList",
  "visualChecks.notFound",
  "connectReentry.subtitle",
  "connectReentry.success",
  "github.noPulls",
];
/** 사용자가 직접 쓰는 도구 이름·자기 앱 주소 끝 모양은 그 도구 안내 줄에서만. */
const TOOL_ALLOWED = {
  "commandCenter.addUrlHelpLovable": ["Lovable"],
  "commandCenter.addUrlHelpBolt": ["Bolt"],
  "commandCenter.addUrlHelpV0": ["v0", "Vercel"],
  "commandCenter.addUrlHelpReplit": [],
  "github.noPulls": ["Lovable", "Bolt", "PR"],
};
const FORBIDDEN = [/브랜치/, /터미널/, /저장소/, /커밋/, /토큰/, /푸시/, /새로고침/, /\bbranch/i, /\bterminal/i, /\brepositor/i, /\bcommit/i, /\bdiff\b/i, /\btoken/i, /\bpush/i, /\brefresh/i, /\breload/i];

for (const loc of ["ko", "en"]) {
  test(`[${loc}] 새·바뀐 문구 파리티 + 초보자 금칙어 0 (도구 이름은 그 도구 안내에서만)`, () => {
    for (const key of NEW_KEYS) {
      const v = at(DICTIONARIES[loc], key);
      assert.equal(typeof v, "string", `${loc}.${key} missing`);
      assert.ok(v.trim().length > 0, `${loc}.${key} empty`);
      for (const re of FORBIDDEN) assert.ok(!re.test(v), `${loc}.${key} has ${re}: "${v}"`);
      const allowed = TOOL_ALLOWED[key] ?? [];
      const hits = devTermHits(v).filter((h) => !allowed.includes(h.term));
      assert.deepEqual(hits, [], `${loc}.${key}: "${v}" → ${JSON.stringify(hits)}`);
    }
  });
}
