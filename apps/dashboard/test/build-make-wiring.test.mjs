/**
 * B-8 — 화면 배선 정적 검사 (train-w-wiring.test.mjs 방식: 소스를 grep 한다).
 *
 * 순수 함수가 맞아도 화면이 그 함수를 부르지 않으면 소용없다. 각 검사는 고치기 전 코드에서 실패한다
 * (파일·import·호출이 없다).
 *
 *  W1 지시서 화면: 만들기 패널(makePanelVisible·buildAvailability) · 팩은 만들기가 보이면 보조 · 시작 뒤 /my-app(내 앱)으로
 *  W2 만들기 패널: 안내 줄은 makeIntroKeys가 고른 것만 · 예상 소요는 [PILOT] 상수 · 알림은 본문 전체(resetAt·receivedAt)
 *  W3 시작 훅: startErrorNotice(상태, 본문) · 409 이미 진행 중은 그 잡을 잇는다 · 두 번 누름 방지
 *  W4 진행 화면: 최근 잡 복원 · nextBuildPollDelayMs 폴링 · 탭 숨김 중단 · 단계 줄 · 실패 종류·행동 · 내 앱 카드 · 옛 서버 안내
 *  W5 사이드바: '내 앱' 노출 사실(hostedBuildFact) → sidebarStepItems
 *  W6 금지: 퍼센트 진행률 · 모달/오버레이 · window.confirm
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

const devSpecPage = read("app/projects/[id]/dev-spec/page.tsx");
const buildPage = read("app/projects/[id]/my-app/page.tsx");
const panel = read("components/MakeAppPanel.tsx");
const startHook = read("lib/use-start-build.ts");
const visibleHook = read("lib/use-page-visible.ts");
const api = read("lib/build-job-api.ts");
const sidebar = read("components/AppSidebar.tsx");

test("W1: 지시서 화면 — 만들기 패널은 makePanelVisible로만, 팩은 만들기가 보이면 보조, 시작 뒤 내 앱으로", () => {
  assert.match(devSpecPage, /import \{ MakeAppPanel \} from "@\/components\/MakeAppPanel"/);
  assert.match(devSpecPage, /listBuildJobs\(id, getUserKey\(\)\)/);
  assert.match(devSpecPage, /makePanelVisible\(\{[\s\S]*?availability: buildAvailability\(buildList\)/);
  assert.match(devSpecPage, /specSource: view\.source/);
  assert.match(devSpecPage, /showMake === false \? "btn-primary" : "btn-secondary"/);
  assert.match(devSpecPage, /showMake === true && \(\s*<MakeAppPanel/);
  assert.match(devSpecPage, /router\.push\(`\/projects\/\$\{encodeURIComponent\(id\)\}\/my-app`\)/);
  assert.match(panel, /href=\{`\$\{base\}\/my-app`\}/);
  assert.match(devSpecPage, /latestJob=\{latestJob\}/);
});

test("W2: 만들기 패널 — 안내 줄은 makeIntroKeys가 고른 것만, 예상 소요는 [PILOT] 상수, 알림은 resetAt·receivedAt까지", () => {
  assert.match(panel, /makeIntroKeys\(\{ developerMode, hasExcluded: view\.excluded\.length > 0 \}\)/);
  assert.match(panel, /keys\.map\(\(k\) =>/);
  assert.match(panel, /mk\.eta\.replace\("\{minutes\}", String\(BUILD_EXPECTED_MAX_MINUTES\)\)/);
  assert.match(panel, /makePanelState\(latestJob\)/);
  assert.match(
    panel,
    /errorNoticeText\(mk\.startErrors, notice\.errorKey, notice\.resetAt, t\.visualChecks\.resetWhen, \{ receivedAt: notice\.receivedAt \}\)/,
  );
  assert.match(panel, /startErrorTone\(notice\.errorKey\)/);
  // 예산 숫자를 패널에서 말하지 않는다(D-7: 서버가 잡을 만들 때 정한 값만, 진행 화면에서).
  assert.ok(!/budget/i.test(panel.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "panel must not render a budget number");
});

test("W3: 시작 훅 — 본문 전체로 매핑, 이미 진행 중이면 그 잡을 잇는다, 두 번 누름 방지", () => {
  assert.match(startHook, /startErrorNotice\(res\.status, res\.body\)/);
  assert.match(startHook, /n\.errorKey === "alreadyActive" && n\.activeJobId/);
  assert.match(startHook, /receivedAt: Date\.now\(\)/);
  assert.match(startHook, /inFlight\.current/);
  assert.match(api, /body: JSON\.stringify\(\{ userKey, locale \}\)/);
  assert.match(api, /parseBuildJob/);
  assert.match(api, /routeMissing: isRouteMissing\(status, body\)/);
});

test("W4: 진행 화면 — 복원·폴링·탭 숨김·단계 줄·실패·내 앱 카드·옛 서버", () => {
  assert.match(buildPage, /latestBuildJob\(res\.jobs\)/, "restore the latest job on reload/revisit");
  assert.match(buildPage, /nextBuildPollDelayMs\(status, \{/);
  assert.match(buildPage, /usePageVisible\(\)/);
  assert.match(buildPage, /if \(!visible\) \{/);
  assert.match(buildPage, /buildStageRow\(job, events\)/);
  assert.match(buildPage, /buildFailureKind\(job\)/);
  assert.match(buildPage, /failureActions\(failKind\)/);
  assert.match(buildPage, /mk\.failures\[failKind\]/);
  assert.match(buildPage, /mk\.noCharge/);
  assert.match(buildPage, /appCardView\(job, checks\)/);
  assert.match(buildPage, /mk\.hostedNote/);
  assert.match(buildPage, /card\.reportUrl/);
  assert.match(buildPage, /budgetLine\(job\)/);
  assert.match(buildPage, /availability === "missing"/);
  assert.match(buildPage, /mk\.startErrors\.unavailable/);
  // D-17: 주소로 들어온 '이미 앱이 있는' 프로젝트에는 만들기를 내밀지 않는다 — 지시서 화면과 같은 규칙.
  assert.match(buildPage, /makePanelVisible\(\{ entryPath: loadExtendedProjectData\(id\)\?\.entryPath \?\? null, presence, specSource: view\?\.source \?\? null, availability \}\)/);
  assert.match(buildPage, /makeHere === false && \(/);
  assert.match(buildPage, /mk\.notForThisProject/);
  assert.match(buildPage, /makeHere === true &&/);
  assert.match(visibleHook, /addEventListener\("visibilitychange"/);
  assert.match(visibleHook, /document\.visibilityState !== "hidden"/);
});

test("W5: 사이드바 — '내 앱' 사실(hostedBuildFact)을 sidebarStepItems에 넘긴다", () => {
  assert.match(sidebar, /hostedBuildFact\(res\)/);
  assert.match(sidebar, /sidebarStepItems\(\{[\s\S]*?hasHostedBuild,[\s\S]*?\}\)/);
});

test("W6: 금지 — 퍼센트 진행률 · 모달/오버레이 · window.confirm", () => {
  for (const [name, src] of [["build page", buildPage], ["panel", panel]]) {
    assert.ok(!/\*\s*100|%\}|progress%|percent/i.test(src), `${name}: no percentage progress`);
    assert.ok(!/fixed inset-0|role="dialog"|Modal/.test(src), `${name}: no modal/overlay`);
    assert.ok(!/window\.confirm/.test(src), `${name}: no window.confirm`);
  }
});
