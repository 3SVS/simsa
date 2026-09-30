/**
 * B-8 — 문 (a) "만들기"의 문구·사이드바 규칙.
 *
 *  - 사전 파리티: 순수 로직이 고르는 **모든 키**(단계·실패 종류·시작 오류)에 KO·EN 문구가 있다
 *  - 초보자 금칙어 0 · 계정 요구 CTA 0 (D-17) — 감사 장비(beginner-terms.mjs)와 같은 규칙으로 사전 자체를 검사
 *  - 개발자 모드 아닐 때 A 경로 문장 0 (makeIntroKeys가 고른 키만 그린다)
 *  - 사이드바 '내 앱' 노출 조건 · 라벨 · 다음 걸음 (project-steps.mjs)
 * 옛 코드: makeApp 사전·myApp·build 걸음이 없어 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const view = await import("../src/lib/build-job-view.mjs");
const steps = await import("../src/lib/project-steps.mjs");
const { devTermHits, accountCtaLabels } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const LOCALES = ["en", "ko"];
const m = (loc) => DICTIONARIES[loc].makeApp;

/** 기본 흐름에 나오는 모든 문구(개발자 모드 전용 devPath·devPathLink 제외). */
function defaultFlowStrings(loc) {
  const d = m(loc);
  const out = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === "devPath" || k === "devPathLink") continue;
    if (typeof v === "string") out.push([k, v]);
    else for (const [k2, v2] of Object.entries(v)) out.push([`${k}.${k2}`, v2]);
  }
  out.push(["nav.myApp", DICTIONARIES[loc].nav.myApp]);
  return out;
}

describe("B-8 사전 — 로직이 고르는 모든 키에 KO·EN 문구", () => {
  for (const loc of LOCALES) {
    it(`[${loc}] 단계 7개 이름·현재 단계 안내`, () => {
      for (const s of view.BUILD_STAGES) {
        assert.ok(m(loc).stages[s]?.length > 0, `stages.${s}`);
        assert.ok(m(loc).stageHints[s]?.length > 0, `stageHints.${s}`);
      }
    });

    it(`[${loc}] 실패 종류 전부`, () => {
      for (const k of view.BUILD_FAILURE_KINDS) assert.ok(m(loc).failures[k]?.length > 0, `failures.${k}`);
    });

    it(`[${loc}] 시작 오류 키 전부(서버 코드 표가 고르는 값 + network·unavailable) + 상한 3문장`, () => {
      const keys = new Set([...Object.values(view.START_ERROR_CODES), "network", "unavailable", "generic"]);
      for (const k of keys) assert.ok(m(loc).startErrors[k]?.length > 0, `startErrors.${k}`);
      assert.match(m(loc).startErrors.dailyLimitReachedAt, /\{when\}/);
      assert.ok(m(loc).startErrors.dailyLimitCleared.length > 0);
    });

    it(`[${loc}] 자리표시자는 두 언어가 같다`, () => {
      const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      for (const [k, v] of defaultFlowStrings(loc)) {
        const other = loc === "en" ? "ko" : "en";
        const [, ov] = defaultFlowStrings(other).find(([ok]) => ok === k) ?? [];
        assert.deepEqual(ph(v), ph(ov), k);
      }
    });
  }

  it("[ko] 준비 중 단계 실패는 그 말 그대로 — '아직 준비 중인 단계에서 멈췄어요'", () => {
    assert.match(m("ko").failures.notImplemented, /^아직 준비 중인 단계에서 멈췄어요/);
    assert.match(m("ko").noCharge, /비용은 받지 않았어요/);
  });

  it("D-6: 내 앱 카드에 'Simsa 주소에서 운영 중 · 프로덕션 아님'", () => {
    assert.match(m("ko").hostedNote, /Simsa 주소에서 운영 중/);
    assert.match(m("ko").hostedNote, /프로덕션/);
    assert.match(m("en").hostedNote, /not a production/);
  });

  it("D-7: 예산 줄은 서버 값 자리표시자만(숫자를 사전에 박지 않는다)", () => {
    for (const loc of LOCALES) {
      assert.match(m(loc).budget, /\{budget\}/);
      assert.match(m(loc).budget, /\{spent\}/);
      assert.ok(!/\$\d/.test(m(loc).budget), m(loc).budget);
    }
  });

  it("예상 소요는 [PILOT] 상수로 채운다(사전에 숫자 없음)", () => {
    for (const loc of LOCALES) {
      assert.match(m(loc).eta, /\{minutes\}/);
      assert.ok(!/\d/.test(m(loc).eta), m(loc).eta);
    }
  });
});

describe("B-8 초보자 기준 (D-17) — 기본 흐름 문구에 개발 용어 0 · 계정 버튼 0", () => {
  for (const loc of LOCALES) {
    it(`[${loc}] 개발 용어 사전 매칭 0 (GitHub·repo·PR·Vercel·Supabase·워크스페이스 …)`, () => {
      for (const [k, v] of defaultFlowStrings(loc)) {
        assert.deepEqual(devTermHits(v), [], `${k}: "${v}"`);
        assert.ok(!/워크스페이스|workspace/i.test(v), `${k}: "${v}"`);
      }
    });

    it(`[${loc}] 버튼·링크 라벨에 외부 계정 CTA 0`, () => {
      const labels = ["make", "starting", "viewProgress", "viewApp", "needDevSpecLink", "retry", "takeSpec", "openApp", "lastCheck", "report", "download"].map((k) => m(loc)[k]);
      assert.deepEqual(accountCtaLabels(labels), []);
    });

    it(`[${loc}] 개발자 모드가 아니면 A 경로 문장이 화면에 없다`, () => {
      const keys = view.makeIntroKeys({ developerMode: false, hasExcluded: true });
      const rendered = keys.map((k) => m(loc)[k]);
      assert.ok(!rendered.includes(m(loc).devPath));
      // A 경로 문장은 개발자용이다 — 기본 흐름에 새지 않게 여기서만 쓴다.
      assert.ok(view.makeIntroKeys({ developerMode: true, hasExcluded: false }).includes("devPath"));
    });
  }
});

describe("B-8 사이드바 '내 앱' — project-steps.mjs 규칙", () => {
  it("앱이 없는 문(아이디어·기획서): 2단계 맨 앞에 내 앱, 그다음 만들기 안내 — 개발자 모드와 무관", () => {
    for (const developerMode of [false, true]) {
      const it = steps.sidebarStepItems({ hasApp: false, developerMode, hasPrReviewHistory: false });
      assert.deepEqual(it.review, ["my-app", "export"]);
    }
  });

  it("앱이 있으면 Simsa가 만든 앱이 있을 때만 내 앱(쓰는 것은 숨기지 않는다)", () => {
    assert.deepEqual(steps.sidebarStepItems({ hasApp: true, hasHostedBuild: true }).review, ["my-app", "visual-checks"]);
    for (const hasHostedBuild of [false, null, undefined]) {
      assert.ok(!steps.sidebarStepItems({ hasApp: true, hasHostedBuild }).review.includes("my-app"), String(hasHostedBuild));
    }
  });

  it("앱 유무를 모르면 보류(항목이 단계 사이를 옮겨 다니지 않는다)", () => {
    assert.deepEqual(steps.sidebarStepItems({ hasApp: null, hasHostedBuild: true }), { review: [], results: ["checks"] });
  });

  it("[가드] 한 화면이 두 단계에 동시에 나오지 않는다(내 앱 포함)", () => {
    for (const hasApp of [true, false]) {
      for (const hasHostedBuild of [true, false, null]) {
        const it = steps.sidebarStepItems({ hasApp, developerMode: true, hasPrReviewHistory: true, hasHostedBuild });
        assert.deepEqual(it.review.filter((s) => it.results.includes(s)), []);
      }
    }
  });

  it("라벨: 사이드바와 다음 버튼이 같은 이름 — '내 앱'", () => {
    assert.equal(steps.navLabelKey("my-app", {}), "myApp");
    assert.equal(DICTIONARIES.ko.nav.myApp, "내 앱");
    assert.equal(DICTIONARIES.en.nav.myApp, "My app");
  });

  it("다음 걸음: 지시서 → 내 앱(이유 '이어서') · 내 앱 다음은 없음 · 코드 갈래는 내 앱으로 걷지 않는다", () => {
    assert.deepEqual(steps.nextStepFromHere("dev-spec", { entryPath: "idea" }), { slug: "my-app", reason: "continue" });
    assert.deepEqual(steps.nextStepFromHere("dev-spec", { entryPath: "spec" }), { slug: "my-app", reason: "continue" });
    assert.equal(steps.nextStepFromHere("my-app", { entryPath: "idea" }), null);
    assert.notEqual(steps.nextScreenSlug("dev-spec", "code"), "my-app");
    assert.notEqual(steps.nextScreenSlug("dev-spec", "idea", { hasApp: true }), "my-app");
  });

  it("[가드] 내 앱 라우트는 git이 무시하는 `build/` 폴더가 아니다(.gitignore의 build/ = 빌드 산출물)", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    assert.ok(existsSync(path.resolve(here, "../src/app/projects/[id]/my-app/page.tsx")));
    const gitignore = readFileSync(path.resolve(here, "../../../.gitignore"), "utf8");
    for (const slug of ["my-app"]) assert.ok(!new RegExp(`^${slug}/?$`, "m").test(gitignore), slug);
  });
});
