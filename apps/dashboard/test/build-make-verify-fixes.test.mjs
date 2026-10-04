/**
 * PR #578 검증 결함 (B-8 만들기) — 결함마다 재현 테스트.
 *
 * 각 테스트는 **고치기 전 코드에서 실패한다**. 이 파일은 네임스페이스 import만 쓰므로(없는 export는 undefined),
 * 옛 모듈에서도 파일이 통째로 죽지 않고 **테스트마다 제 이유로** 실패한다 — "import 실패에 가려진 옛 코드 실패"
 * (결함 7)를 되풀이하지 않는다.
 *
 *  결함 1·8  개요 '지금 할 일'이 만들기 전·중·후 모두 "만들기 안내 받아 AI 도구로 만드세요"(A 경로)였다
 *  결함 2    [만들기]를 "라우트가 있다"만 보고 내밀었다 — 서버가 "끝까지 된다"고 알려 줄 때만
 *  결함 3    다시 시도가 막다른 길(hosting_d1_failed)인데 "잠시 뒤 다시 시도"를 약속했다
 *  결함 4    '지시서 받아가기'가 개발 AI 도구 고르는 화면(export)으로 갔다
 *  결함 5    done 주장이 거절된 빌드를 "올리지 않았어요"라고 단정했다
 *  결함 6    EN "1 kinds of data"
 *  결함 9    폴링 중단·재개가 소스 정규식으로만 고정돼 있었다 → 동작으로 고정
 *
 * Rule 6: 프로젝트 "(주)트루픽셀 예약 앱", 한국어 문장.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const view = await import("../src/lib/build-job-view.mjs");
const steps = await import("../src/lib/project-steps.mjs");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits, accountCtaLabels } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const LOCALES = ["ko", "en"];

// ─── 결함 1·8 — 개요 '지금 할 일'이 만들기 사실을 본다 ───────────────────────────

describe("결함 1·8: 개요의 다음 행동 — 아이디어·기획서 문(앱 없음·주소 없음·항목 있음)", () => {
  const base = { hasItems: true, hasRepo: false, hasRepoSource: false, hasDeployUrl: false, hasReviewRun: false, hasVisualCheck: false, entryPath: "idea" };
  const act = (x) => steps.nextProjectAction({ ...base, ...x });

  it("★만들기가 열렸고 지시서가 있고 잡이 없으면 → 내 앱(만들기) — 종전: 만들기 안내(팩·외부 AI 도구)", () => {
    assert.deepEqual(act({ makeOpen: true, hasDevSpec: true, buildState: "none" }), { action: "make_app", slug: "my-app" });
  });

  it("★만드는 중 → 내 앱(진행 상황 보기)", () => {
    assert.deepEqual(act({ makeOpen: true, hasDevSpec: true, buildState: "active" }), { action: "view_build", slug: "my-app" });
  });

  it("★다 만들었으면 → 내 앱(내 앱 보기) — '앱을 만드세요'라고 하지 않는다", () => {
    assert.deepEqual(act({ makeOpen: true, hasDevSpec: true, buildState: "done" }), { action: "view_app", slug: "my-app" });
  });

  it("★멈췄으면 → 내 앱(멈춘 이유 보기)", () => {
    assert.deepEqual(act({ makeOpen: true, hasDevSpec: true, buildState: "failed" }), { action: "build_stopped", slug: "my-app" });
  });

  it("★열렸는데 지시서가 아직 없으면 → 지시서 만들기(만들기는 지시서에서 시작한다)", () => {
    assert.deepEqual(act({ makeOpen: true, hasDevSpec: false, buildState: "none" }), { action: "make_spec", slug: "dev-spec" });
  });

  it("Simsa가 이미 시작한 빌드는 만들기가 닫혀도 그 결과가 답이다(쓰는 것은 숨기지 않는다)", () => {
    assert.deepEqual(act({ makeOpen: false, hasDevSpec: true, buildState: "done" }), { action: "view_app", slug: "my-app" });
    assert.deepEqual(act({ makeOpen: false, hasDevSpec: true, buildState: "failed" }), { action: "build_stopped", slug: "my-app" });
  });

  it("[행동 보존 가드] 만들기가 닫혀 있으면(또는 확인 못 하면 — 닫힘으로 본다) 종전대로 만들기 안내(팩)", () => {
    assert.deepEqual(act({ makeOpen: false, hasDevSpec: true, buildState: "none" }), { action: "get_pack", slug: "export" });
    // 만들기 사실을 넘기지 않는 호출자(종전 계약)도 그대로.
    assert.deepEqual(act({}), { action: "get_pack", slug: "export" });
  });

  it("모르는 동안은 CTA를 내지 않는다(뒤집히는 CTA 방지) — 가용성·빌드 목록·지시서 중 하나라도 아직이면", () => {
    assert.equal(act({ makeOpen: null, hasDevSpec: true, buildState: "none" }), null);
    assert.equal(act({ makeOpen: true, hasDevSpec: true, buildState: null }), null);
    assert.equal(act({ makeOpen: true, hasDevSpec: null, buildState: "none" }), null);
  });

  it("앱이 있는 프로젝트·항목 없는 프로젝트는 만들기 사실과 무관하게 종전 그대로", () => {
    assert.deepEqual(act({ hasItems: false, makeOpen: true, hasDevSpec: true, buildState: "none" }), { action: "create_items", slug: "items" });
    assert.deepEqual(
      steps.nextProjectAction({ ...base, entryPath: "code", makeOpen: true, hasDevSpec: true, buildState: "done" }),
      { action: "add_url", slug: "sources" },
    );
  });

  it("hostedBuildState: 목록 응답 → 개요의 빌드 사실(묻는 중 null · 잡 없음/라우트 없음/실패 none · 최근 잡 기준)", () => {
    assert.equal(view.hostedBuildState?.(null), null);
    assert.equal(view.hostedBuildState?.({ ok: true, jobs: [] }), "none");
    const jobs = [
      { id: "bj_old", status: "done", createdAt: "2026-09-29T00:00:00.000Z" },
      { id: "bj_new", status: "implementing", createdAt: "2026-09-30T00:00:00.000Z" },
    ];
    assert.equal(view.hostedBuildState?.({ ok: true, jobs }), "active");
    assert.equal(view.hostedBuildState?.({ ok: true, jobs: [{ id: "a", status: "failed", createdAt: "x" }] }), "failed");
    assert.equal(view.hostedBuildState?.({ ok: true, jobs: [{ id: "a", status: "done", createdAt: "x" }] }), "done");
    // 실패는 "없음"으로 — 만들기 행동은 모두 같은 화면(내 앱)으로 가고, 그 화면이 다시 읽어 사실대로 말한다.
    assert.equal(view.hostedBuildState?.({ ok: false, status: 503, routeMissing: false }), "none");
    assert.equal(view.hostedBuildState?.({ ok: false, status: 404, routeMissing: true }), "none");
  });
});

describe("결함 1·8: 개요 문구 — 만들기 경로는 외부 도구를 말하지 않는다", () => {
  const cc = (loc) => DICTIONARIES[loc].commandCenter;
  const pairs = [["makeApp", "makeAppDesc"], ["makeSpec", "makeSpecDesc"], ["viewBuild", "viewBuildDesc"], ["viewApp", "viewAppDesc"], ["buildStopped", "buildStoppedDesc"]];

  for (const loc of LOCALES) {
    it(`[${loc}] 새 행동 5개의 버튼·설명이 있고 개발 용어·계정 버튼 0`, () => {
      for (const [label, desc] of pairs) {
        assert.ok(cc(loc)[label]?.length > 0, `${label}`);
        assert.ok(cc(loc)[desc]?.length > 0, `${desc}`);
        assert.deepEqual(devTermHits(`${cc(loc)[label]} ${cc(loc)[desc]}`), [], `${label}/${desc}`);
      }
      assert.deepEqual(accountCtaLabels(pairs.map(([l]) => cc(loc)[l])), []);
    });
  }

  it("[ko] 만들기 경로 설명에 A 경로 말(만들기 안내·쓰시는 AI 도구)이 없다 — 종전 getPackDesc와 다른 답", () => {
    for (const [, desc] of pairs) {
      assert.equal(typeof cc("ko")[desc], "string", desc);
      assert.ok(!/만들기 안내|AI 도구/.test(cc("ko")[desc]), `${desc}: ${cc("ko")[desc]}`);
    }
    assert.ok(!/(build guide|AI tool)/i.test(pairs.map(([, d]) => cc("en")[d]).join(" ")));
  });

  it("★'어떻게 진행되나요' 목록도 만들기가 열리면 만들기 경로로 말한다(한 화면 두 답 금지)", () => {
    assert.deepEqual(steps.ideaExplainerKeys?.({ developerMode: false, makeOpen: true }), { step2: "gsIdeaStep2Make", step3: "gsIdeaStep3Make" });
    assert.deepEqual(steps.ideaExplainerKeys?.({ developerMode: false, makeOpen: false }), { step2: "gsIdeaStep2Guide", step3: "gsIdeaStep3" });
    assert.deepEqual(steps.ideaExplainerKeys?.({ developerMode: true, makeOpen: null }), { step2: "gsIdeaStep2", step3: "gsIdeaStep3" });
    for (const loc of LOCALES) {
      for (const k of ["gsIdeaStep2Make", "gsIdeaStep3Make"]) {
        const s = DICTIONARIES[loc].overview[k];
        assert.ok(s?.length > 0, `${loc} ${k}`);
        assert.deepEqual(devTermHits(s), [], `${loc} ${k}`);
      }
    }
  });

  it("★사이드바 3단계 잠김 안내도 만들기가 열리면 만들기 경로로(종전: 빌더 팩을 받아 앱을 만들고)", () => {
    assert.equal(steps.lockHintKey?.("need_build", { makeOpen: true }), "lockNeedBuildMake");
    assert.equal(steps.lockHintKey?.("need_build", { makeOpen: false }), "lockNeedBuild");
    assert.equal(steps.lockHintKey?.("need_url", { makeOpen: true }), "lockNeedUrl");
    assert.equal(steps.lockHintKey?.(null, {}), null);
    for (const loc of LOCALES) {
      assert.ok(DICTIONARIES[loc].stepsNav.lockNeedBuildMake?.length > 0);
      assert.deepEqual(devTermHits(DICTIONARIES[loc].stepsNav.lockNeedBuildMake ?? "x"), []);
    }
  });

  it("배선: 개요가 만들기 사실 셋을 모아 nextProjectAction에 넘기고, 새 행동의 문구를 그린다", () => {
    const overview = read("app/projects/[id]/page.tsx");
    assert.match(overview, /useBuildOpen\(\)/);
    assert.match(overview, /hostedBuildState\(res\)/);
    assert.match(overview, /getDevSpecApi\(id, uk\)/);
    assert.match(overview, /const facts = \{[^}]*makeOpen[^}]*buildState[^}]*hasDevSpec[^}]*\}/);
    for (const a of ["make_app", "make_spec", "view_build", "view_app", "build_stopped"]) assert.match(overview, new RegExp(`${a}: \\{ label:`), a);
    assert.match(overview, /ideaExplainerKeys\(\{ developerMode, makeOpen \}\)/);
    const sidebar = read("components/AppSidebar.tsx");
    assert.match(sidebar, /lockHintKey\(reason, \{ makeOpen \}\)/);
  });
});

// ─── 결함 2 — 서버가 "열렸다"고 할 때만 [만들기] ─────────────────────────────────

describe("결함 2: 만들기는 서버가 열렸다고 확인할 때만", () => {
  it("buildOpenFact: 묻는 중 null · 서버가 열림을 확인 true · 그 밖(옛 서버·오류·닫힘) false", () => {
    assert.equal(view.buildOpenFact?.(null), null);
    assert.equal(view.buildOpenFact?.({ ok: true, open: true }), true);
    assert.equal(view.buildOpenFact?.({ ok: true, open: false }), false);
    assert.equal(view.buildOpenFact?.({ ok: false, status: 404, routeMissing: true }), false);
    assert.equal(view.buildOpenFact?.({ ok: false, status: 0, routeMissing: false }), false);
  });

  it("★makePanelVisible: 라우트가 있어도 닫혀 있으면 숨김(종전: 라우트만 보고 보임) · 열림 확인 전엔 보류", () => {
    const v = (x) => view.makePanelVisible({ entryPath: "idea", presence: false, specSource: "generated", availability: "available", ...x });
    assert.equal(v({ open: false }), false);
    assert.equal(v({ open: null }), null);
    assert.equal(v({ open: true }), true);
    assert.equal(v({ open: true, availability: "missing" }), false);
  });

  it("★사이드바: 앱이 없는 문의 '내 앱'은 만들기가 열렸거나 이미 만든 빌드가 있을 때만 — 닫히면 종전 [만들기 안내]", () => {
    assert.deepEqual(steps.sidebarStepItems({ hasApp: false, makeOpen: false, hasHostedBuild: false }).review, ["export"]);
    assert.deepEqual(steps.sidebarStepItems({ hasApp: false, makeOpen: null, hasHostedBuild: null }).review, ["export"]);
    assert.deepEqual(steps.sidebarStepItems({ hasApp: false, makeOpen: true, hasHostedBuild: false }).review, ["my-app", "export"]);
    assert.deepEqual(steps.sidebarStepItems({ hasApp: false, makeOpen: false, hasHostedBuild: true }).review, ["my-app", "export"]);
  });

  it("★다음 걸음: 지시서 다음은 열렸을 때만 내 앱 · 닫히면 종전 팩 · 모르면 말하지 않는다(뒤집히는 '다음' 금지)", () => {
    assert.equal(steps.nextScreenSlug("dev-spec", "idea", { makeOpen: true }), "my-app");
    assert.equal(steps.nextScreenSlug("dev-spec", "idea", { makeOpen: false }), "export");
    assert.equal(steps.nextScreenSlug("dev-spec", "idea", { makeOpen: null }), null);
    assert.equal(steps.nextScreenSlug("dev-spec", "spec", { makeOpen: true }), "my-app");
    assert.deepEqual(steps.nextStepFromHere("dev-spec", { entryPath: "idea", makeOpen: true }), { slug: "my-app", reason: "continue" });
    assert.deepEqual(steps.nextStepFromHere("dev-spec", { entryPath: "idea", makeOpen: false }), { slug: "export", reason: "continue" });
  });

  it("배선: 지시서 화면·내 앱·사이드바·다음 바가 같은 가용성(useBuildOpen)을 쓴다", () => {
    const devSpec = read("app/projects/[id]/dev-spec/page.tsx");
    assert.match(devSpec, /const makeOpen = useBuildOpen\(\)/);
    assert.match(devSpec, /makePanelVisible\(\{[\s\S]*?open: makeOpen/);
    const myApp = read("app/projects/[id]/my-app/page.tsx");
    assert.match(myApp, /const makeOpen = useBuildOpen\(\)/);
    const sidebar = read("components/AppSidebar.tsx");
    assert.match(sidebar, /const makeOpen = useBuildOpen\(\)/);
    assert.match(sidebar, /sidebarStepItems\(\{[\s\S]*?makeOpen,[\s\S]*?\}\)/);
    const bar = read("components/StepNextButton.tsx");
    assert.match(bar, /const makeOpen = useBuildOpen\(\)/);
    assert.match(bar, /makeOpen,/);
    const api = read("lib/build-job-api.ts");
    assert.match(api, /\/workspace\/build-availability/);
  });
});

// ─── 결함 3 — 다시 시도가 막다른 길일 때 약속하지 않는다 ───────────────────────────

describe("결함 3: 호스팅 자리 실패는 '잠시 뒤 다시 시도'를 약속하지 않고 지시서를 함께 준다", () => {
  it("★문구: hostingFailed에 '잠시 뒤 다시 시도' · 'try again in a bit'이 없다", () => {
    assert.ok(!/잠시 뒤 다시 시도/.test(DICTIONARIES.ko.makeApp.startErrors.hostingFailed), DICTIONARIES.ko.makeApp.startErrors.hostingFailed);
    assert.ok(!/try again in a bit/i.test(DICTIONARIES.en.makeApp.startErrors.hostingFailed), DICTIONARIES.en.makeApp.startErrors.hostingFailed);
    assert.match(DICTIONARIES.ko.makeApp.startErrors.hostingFailed, /비용은 받지 않았어요/);
  });

  it("★시작이 막히면(다시 해도 같은 곳에서 막힐 것) 알림 안에 [지시서 받아가기]", () => {
    for (const k of ["unavailable", "hostingFailed", "notReady", "paused"]) assert.equal(view.startNoticeOffersTakeSpec?.(k), true, k);
    for (const k of ["alreadyActive", "network", "generic", "needSpec", "notSynced", "noWorkItems", "dailyLimitReached"]) assert.equal(view.startNoticeOffersTakeSpec?.(k), false, k);
    const panel = read("components/MakeAppPanel.tsx");
    assert.match(panel, /startNoticeOffersTakeSpec\(notice\.errorKey\)/);
  });

  it("★만들기가 닫혀 있으면 멈춤 화면에 [다시 시도]를 내밀지 않는다(누르면 막힐 버튼)", () => {
    assert.deepEqual(view.failureActions("generic", { canRetry: false }), { primary: "takeSpec", secondary: null });
    assert.deepEqual(view.failureActions("notImplemented", { canRetry: false }), { primary: "takeSpec", secondary: null });
    assert.deepEqual(view.failureActions("generic", { canRetry: true }), { primary: "retry", secondary: "takeSpec" });
    const myApp = read("app/projects/[id]/my-app/page.tsx");
    assert.match(myApp, /failureActions\(failKind, \{ canRetry: makeOpen === true \}\)/);
  });
});

// ─── 결함 4 — '지시서 받아가기'는 지시서를 준다 ───────────────────────────────────

describe("결함 4: '지시서 받아가기'는 그 자리에서 지시서 문서를 받는다(개발 도구 고르는 화면이 아니다)", () => {
  const files = [
    { path: "simsa-build-pack/CLAUDE_CODE_PROMPT.md", content: "# prompt" },
    { path: "simsa-build-pack/dev-spec/02-screens.md", content: "# 화면" },
    { path: "simsa-build-pack/dev-spec/README.md", content: "# (주)트루픽셀 예약 앱 — 개발 지시서" },
    { path: "simsa-build-pack/dev-spec/01-requirements.md", content: "# 요구사항" },
    { path: "simsa-build-pack/.env.local", content: "SECRET=1" },
  ];

  it("★devSpecDocument: 지시서 파일만, 쉬운 요약(README) 먼저, 한 문서로 · 한글 제목이 파일 이름에 남는다(Rule 6)", () => {
    const doc = view.devSpecDocument?.(files, { title: "(주)트루픽셀 예약 앱", locale: "ko" });
    assert.ok(doc, "document");
    assert.equal(doc.filename, "개발지시서-주-트루픽셀-예약-앱.md");
    const order = ["README.md", "01-requirements.md", "02-screens.md"].map((n) => doc.content.indexOf(`dev-spec/${n}`));
    assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
    assert.ok(!doc.content.includes("CLAUDE_CODE_PROMPT"), "개발 도구용 프롬프트는 넣지 않는다");
    assert.ok(!doc.content.includes("SECRET"), "비밀 파일은 넣지 않는다");
    assert.equal(view.devSpecDocument?.(files, { title: "TruePixel booking", locale: "en" })?.filename, "dev-spec-TruePixel-booking.md");
    assert.equal(view.devSpecDocument?.([{ path: "simsa-build-pack/README.md", content: "x" }], { title: "t", locale: "ko" }), null);
  });

  it("★배선: 내 앱의 '지시서 받아가기'는 export 화면 링크가 아니라 받기 버튼(TakeSpecButton)", () => {
    const myApp = read("app/projects/[id]/my-app/page.tsx");
    assert.ok(!/href=\{`\$\{base\}\/export`\}/.test(myApp), "지시서 받아가기가 개발 도구 고르는 화면으로 가면 안 된다");
    assert.match(myApp, /<TakeSpecButton/);
    const panel = read("components/MakeAppPanel.tsx");
    assert.ok(!/\/export`\} className="underline">\{mk\.takeSpec\}/.test(panel));
    const btn = read("components/TakeSpecButton.tsx");
    assert.match(btn, /target: "handoff"/);
    assert.match(btn, /devSpecDocument\(/);
  });

  it("문구: 받은 뒤 한 줄·실패 한 줄(KO/EN) — 개발 용어 0", () => {
    for (const loc of LOCALES) {
      const mk = DICTIONARIES[loc].makeApp;
      for (const k of ["takeSpecWorking", "takeSpecDone", "takeSpecError", "takeSpecErrorLink"]) {
        assert.ok(mk[k]?.length > 0, `${loc} ${k}`);
        assert.deepEqual(devTermHits(mk[k]), [], `${loc} ${k}`);
      }
    }
  });
});

// ─── 결함 5 — 확인되지 않은 것을 단정하지 않는다 ─────────────────────────────────

describe("결함 5: done 주장이 거절된 빌드", () => {
  it("★'done claimed with build exit N'은 buildFailed가 아니라 buildUnverified", () => {
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "building", error: "done claimed with build exit 1" }), "buildUnverified");
    // 빌드 단계에서 그냥 실패한 것은 종전대로 buildFailed.
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "building", error: "tsc exited 2" }), "buildFailed");
    assert.ok(view.BUILD_FAILURE_KINDS.includes("buildUnverified"));
  });

  it("★문구: '올리지 않았어요'라고 단정하지 않고 서버가 아는 것만 — 완성으로 치지 않았다", () => {
    const ko = DICTIONARIES.ko.makeApp.failures.buildUnverified ?? "";
    const en = DICTIONARIES.en.makeApp.failures.buildUnverified ?? "";
    assert.ok(ko.length > 0 && en.length > 0);
    assert.ok(!/올리지 않았어요/.test(ko), ko);
    assert.ok(!/wasn't put online/.test(en), en);
    assert.match(ko, /완성으로 치지 않았어요/);
    assert.deepEqual(view.failureActions("buildUnverified"), { primary: "retry", secondary: "takeSpec" });
  });
});

// ─── 결함 6 — EN 단수·복수 ────────────────────────────────────────────────────

describe("결함 6: EN 개수 문구가 1에서 틀리지 않는다", () => {
  const fill = (s, n) => s.replace(/\{(screens|entities|n)\}/g, String(n)).replace("{what}", "x");
  it("★makeApp.what · devSpec.countScreens·countEntities — '1 kinds'·'1 screens'가 나오지 않는다", () => {
    const en = DICTIONARIES.en;
    for (const s of [en.makeApp.what, en.devSpec.countScreens, en.devSpec.countEntities]) {
      assert.ok(!/\b1 (kinds|screens)\b/.test(fill(s, 1)), fill(s, 1));
    }
  });
});

// ─── 결함 9 — 폴링 중단·재개를 동작으로 ────────────────────────────────────────

describe("결함 9: 폴링 루프(startBuildPolling) — 가짜 타이머로 동작 고정", () => {
  function fakeTimers() {
    let seq = 0;
    const pending = new Map();
    return {
      pending,
      schedule: (fn, ms) => { seq += 1; pending.set(seq, { fn, ms }); return seq; },
      cancel: (h) => { pending.delete(h); },
      async fire() {
        const [h, t] = [...pending.entries()][0] ?? [];
        if (!h) return false;
        pending.delete(h);
        await t.fn();
        return true;
      },
    };
  }

  it("★진행 중이면 다음 지연으로 다시 예약, 끝나면(null) 멈춘다", async () => {
    assert.equal(typeof view.startBuildPolling, "function");
    const timers = fakeTimers();
    const seen = ["implementing", "building", "done"];
    let calls = 0;
    view.startBuildPolling({ firstDelayMs: 5000, schedule: timers.schedule, cancel: timers.cancel, tick: async () => view.nextBuildPollDelayMs(seen[calls++]) });
    assert.deepEqual([...timers.pending.values()].map((t) => t.ms), [5000]);
    await timers.fire();
    await timers.fire();
    await timers.fire();
    assert.equal(calls, 3);
    assert.equal(timers.pending.size, 0, "끝난 상태 뒤에는 더 두드리지 않는다");
  });

  it("★stop(탭 숨김·화면 떠남)은 예약을 지우고, 이미 떠난 조회가 돌아와도 다시 예약하지 않는다", async () => {
    const timers = fakeTimers();
    let release;
    const stop = view.startBuildPolling({ firstDelayMs: 0, schedule: timers.schedule, cancel: timers.cancel, tick: () => new Promise((r) => { release = () => r(5000); }) });
    const firing = timers.fire();
    stop();
    release();
    await firing;
    assert.equal(timers.pending.size, 0);
    const timers2 = fakeTimers();
    const stop2 = view.startBuildPolling({ firstDelayMs: 5000, schedule: timers2.schedule, cancel: timers2.cancel, tick: async () => 5000 });
    stop2();
    assert.equal(timers2.pending.size, 0);
  });

  it("★buildPollStart: 숨김·끝남이면 시작하지 않음 · 돌아온 직후엔 바로(0) · 처음엔 5초", () => {
    assert.equal(view.buildPollStart?.({ visible: false, active: true, resumed: false, status: "implementing", elapsedMs: 0 }), null);
    assert.equal(view.buildPollStart?.({ visible: true, active: false, resumed: true, status: "done", elapsedMs: 0 }), null);
    assert.equal(view.buildPollStart?.({ visible: true, active: true, resumed: true, status: "implementing", elapsedMs: 0 }), 0);
    assert.equal(view.buildPollStart?.({ visible: true, active: true, resumed: false, status: "implementing", elapsedMs: 0 }), 5000);
  });

  it("배선: 내 앱 화면의 폴링 effect는 가시성에 따라 켜고 끈다(cleanup = stop)", () => {
    const myApp = read("app/projects/[id]/my-app/page.tsx");
    assert.match(myApp, /return startBuildPolling\(\{/);
    assert.match(myApp, /buildPollStart\(\{ visible, active: Boolean\(jobId\) && active, resumed: wasHidden\.current,/);
    assert.match(myApp, /\}, \[id, jobId, active, visible\]\);/);
  });
});
