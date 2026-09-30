/**
 * train-c-a7-intent-mismatch.test.mjs — Train C · C-A7 ③ 의도 불일치 픽스처 10변형 + 정답지 + 대조 러너.
 *
 * **라이브 실행이 아니다.** 픽스처 워커는 이 PR에서 배포하지 않는다(`deploy simsa-inspection-fixtures approved.`
 * 뒤에 러너를 돌린다). 여기서는 정적으로 고정한다:
 *   ① [문서 lint] 정답지 두 판(md·json)이 같은 변형·AC를 말한다, 예측 합계가 맞다
 *      — 코드(src)와 무관하게 통과한다. 테스트 수에서 "문서 lint"로 따로 세고 회귀 증거로 세지 않는다.
 *   ② 픽스처 HTML이 정답지의 불일치를 **실제로 담고 있다** — 변형별(10개):
 *      표식(있어야/없어야 할 글·순서) · 기대 화면 글이 페이지 소스에서 나온다 · 검수와 같은 판정 휴리스틱
 *      (observeThen)으로 mismatch는 안 보이고 control은 보인다 · 검수와 같은 플래너(planVisualFlow)가
 *      정답지가 가정한 버튼을 누른다(삭제는 절대 안 누른다)
 *   ③ 러너의 지시서가 D-2 amend 무결성을 통과하고, 검수 시나리오(정답지의 모든 AC가 must)가 된다
 *   ④ 러너 대조 로직(가짜 검수 응답): TP·FN·FP·TN·no_call·안전 레일·핵심 흐름 판정, 정답지 예측과 일관
 *
 * 정정 A1(2026-10-01, 러너 실행 전 — 정답지 커밋 43a9233이 이 테스트·픽스처보다 앞선다):
 *   IM07 무효(저장을 안 하는 문 (b) 고장 → 문 (b) 대조군) · IM11 추가 · control 정보성(동작 전 화면에서
 *   then이 이미 보이면 TN·FP에서 빼고 따로 센다) · core_flow는 지속성 확인 실패일 때만 detected.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

const { INTENT_MISMATCH_ROUTES, INTENT_MISMATCH_INDEX } = await import("../../../tools/simsa-inspection-fixtures/src/intent-mismatch.mjs");
const worker = (await import("../../../tools/simsa-inspection-fixtures/src/index.mjs")).default;
const { devSpecForVariant, classifyAc, compareToAnswerKey, tallyRows, loadAnswerKey, PERSISTENCE_FAILED_NOTES } = await import("../../../tools/simsa-inspection-fixtures/intent-mismatch-run.mjs");
const { observeThen } = await import("../inspector-container/acceptance-observe.mjs");
const { classifyActionSafety } = await import("../inspector-container/safety.mjs");
const { planVisualFlow } = await import("../dist/visual-flow-plan.js");
const { validateDevSpec } = await import("../dist/workspace/dev-spec.js");
const { acceptancePlanFromDevSpec } = await import("../dist/acceptance-plan.js");

const KEY = loadAnswerKey();
const MD = readFileSync(path.join(REPO, "docs/pilot-2026-10/intent-mismatch-answer-key.md"), "utf8");
const RUNNER_SRC = readFileSync(path.join(REPO, "apps/central-plane/inspector-container/inspector-run.mjs"), "utf8");

/** 검수 컨테이너의 금지 동작 목록 — 소스에서 읽는다(표류 방지). */
const FORBIDDEN = (() => {
  const m = /export const FORBIDDEN_ACTIONS = \[([\s\S]*?)\];/.exec(RUNNER_SRC);
  assert.ok(m, "FORBIDDEN_ACTIONS in inspector-run.mjs");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();
const RUNNER_REV = /export const RUNNER_REV = "([^"]+)"/.exec(RUNNER_SRC)?.[1];

/** 페이지 소스에서 검수가 볼 버튼·링크 글과 입력칸(컨테이너 collectCtas/collectInputs의 정적 근사). */
function staticSurface(html) {
  const ctas = [
    ...[...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1].trim()),
    ...[...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim()),
    // 스크립트가 만드는 버튼(IM09의 '삭제')
    ...[...html.matchAll(/createElement\("button"\);\s*\n\s*\w+\.textContent = "([^"]+)"/g)].map((m) => m[1]),
  ].map((text) => ({ text, selector: `text=${text}` }));
  const inputs = [...html.matchAll(/<input[^>]*placeholder="([^"]+)"[^>]*>/g)].map((m) => ({
    placeholder: m[1],
    type: /type="([^"]+)"/.exec(m[0])?.[1] ?? "text",
    selector: `[placeholder="${m[1]}"]`,
  }));
  return { ctas, inputs };
}

/** steps 안의 '따옴표 버튼 이름'. */
const namedButton = (steps) => {
  for (const s of steps) {
    const m = /'([^']+)' 누르기/.exec(s);
    if (m) return m[1];
  }
  return null;
};

const withTyped = (t) => t.replaceAll("{typed}", KEY.typedValue);
const A1 = (KEY.amendments ?? []).find((a) => a.id === "A1");
const isInformative = (a) => a.role === "control" && a.informative !== false;

// ─── ① 정답지 (문서 lint — 코드 회귀 증거 아님) ──────────────────────────────

describe("① [문서 lint] 정답지 — md·json 같은 내용, 예측 합계(코드 회귀 증거 아님)", () => {
  it("원래 10변형 IM01~IM10 + 정정 A1의 IM11, 변형마다 mismatch 1개가 먼저이고 나머지는 control, 휴리스틱 버전이 검수 러너와 같다", () => {
    assert.deepEqual(KEY.variants.map((v) => v.id), ["IM01", "IM02", "IM03", "IM04", "IM05", "IM06", "IM07", "IM08", "IM09", "IM10", "IM11"]);
    for (const v of KEY.variants) {
      const roles = v.acceptance.map((a) => a.role);
      assert.equal(roles[0], "mismatch", v.id);
      assert.ok(roles.length >= 2 && roles.slice(1).every((r) => r === "control"), `${v.id}: ${roles}`);
      assert.match(v.intent, /[가-힣]/, `${v.id} 의도 문장은 한국어`);
    }
    assert.equal(KEY.heuristicRev, RUNNER_REV, "정답지가 가정한 판정 휴리스틱 = 지금 검수 러너");
  });

  it("정정 A1: 무효 IM07(문 (b) 대조군)·추가 IM11·정보 없는 control 목록이 변형 표시와 같다", () => {
    assert.ok(A1, "amendments[A1]");
    assert.equal(A1.beforeRun, true);
    assert.deepEqual(KEY.variants.filter((v) => v.void).map((v) => v.id), A1.voidVariants);
    assert.deepEqual(A1.voidVariants, ["IM07"]);
    assert.equal(KEY.variants.find((v) => v.id === "IM07").void.reclassifiedAs, "door_b_control");
    assert.deepEqual(KEY.variants.filter((v) => v.amendment === "A1").map((v) => v.id), A1.addVariants);
    const marked = KEY.variants.flatMap((v) =>
      v.void ? [] : v.acceptance.filter((a) => a.informative === false).map((a) => ({ variant: v.id, acceptanceId: a.id, replacedBy: a.uninformative.replacedBy })),
    );
    assert.deepEqual(marked, A1.uninformativeControls);
    for (const u of A1.uninformativeControls) {
      if (!u.replacedBy) continue;
      const repl = KEY.variants.find((v) => v.id === u.variant).acceptance.find((a) => a.id === u.replacedBy);
      assert.ok(repl && isInformative(repl) && repl.amendment === "A1", `${u.variant}: ${u.replacedBy}는 정정 A1의 정보 있는 control`);
    }
  });

  it("md에 모든 변형 id·경로·의도·Then(정정 A1 포함)이 있다(두 판이 다른 말을 하지 않는다)", () => {
    for (const v of KEY.variants) {
      for (const s of [v.id, v.path, v.intent, v.differentNow]) assert.ok(MD.includes(s), `${v.id}: md에 "${s}" 없음`);
      for (const a of v.acceptance) assert.ok(MD.includes(a.then), `${v.id}/${a.id}: md에 Then "${a.then}" 없음`);
    }
    assert.ok(MD.includes("## 정정 A1"), "md에 정정 A1 절");
  });

  it("원래 예측 합계 = 원래 10변형의 예측 칸 합(정정 뒤에도 그대로)", () => {
    const sum = { TP: 0, FN: 0, no_call: 0, FP: 0, TN: 0 };
    for (const v of KEY.variants.filter((x) => !x.amendment)) {
      sum[v.predicted.outcome] += 1;
      sum[v.predicted.control] += 1;
    }
    assert.deepEqual(sum, KEY.predictedTally);
    assert.deepEqual(KEY.predictedTally, { TP: 7, FN: 2, no_call: 1, FP: 0, TN: 10 }, "선기록한 줄은 고치지 않는다");
  });

  it("정정 A1 예측 합계 = 유효 변형·정보 있는/없는 control·문 (b) 대조군의 합", () => {
    const sum = { TP: 0, FN: 0, no_call: 0, FP: 0, TN: 0, noInformativeControl: 0, uninformative: { TN: 0, FP: 0 }, doorB: { caught: 0 } };
    for (const v of KEY.variants) {
      if (v.void) {
        sum.doorB.caught += 1; // 저장하지 않는 앱 — 지속성 확인이 잡는다고 예측
        continue;
      }
      sum[v.predicted.outcome] += 1;
      const informative = v.acceptance.filter(isInformative);
      if (informative.length === 0) sum.noInformativeControl += 1;
      else sum[informative[0].expectedStatus === "no_problem" ? "TN" : "FP"] += 1;
      for (const a of v.acceptance.filter((x) => x.role === "control" && x.informative === false)) sum.uninformative[v.predicted.control] += 1;
    }
    assert.deepEqual(sum, A1.predictedTally);
    assert.ok(sum.TP >= 1, "목표: 참양성 최초 1건");
  });
});

// ─── ② 픽스처 정적 검사(변형별) ──────────────────────────────────────────────

describe("② 픽스처가 정답지의 불일치를 실제로 담고 있다", () => {
  it("워커가 10변형(+도움 화면)을 200 HTML로 내주고, 인덱스에 모두 있다", async () => {
    for (const v of KEY.variants) {
      const r = await worker.fetch(new Request(`https://fixtures.example${v.path}`));
      assert.equal(r.status, 200, v.path);
      assert.match(r.headers.get("content-type") ?? "", /text\/html/);
    }
    const help = await worker.fetch(new Request("https://fixtures.example/intent-mismatch/button-wrong-page/help"));
    assert.equal(help.status, 200);
    const idx = await (await worker.fetch(new Request("https://fixtures.example/"))).text();
    for (const [id, p] of INTENT_MISMATCH_INDEX) assert.ok(idx.includes(p) && idx.includes(id), id);
    assert.equal((await worker.fetch(new Request("https://fixtures.example/intent-mismatch/nope"))).status, 404);
  });

  for (const v of KEY.variants) {
    it(`${v.id} ${v.title}`, () => {
      const html = INTENT_MISMATCH_ROUTES[v.path];
      assert.equal(typeof html, "string", `${v.path} 라우트`);

      // 표식: 불일치가 소스에 있다/없다
      for (const s of v.markers.mustContain) assert.ok(html.includes(s), `${v.id}: "${s}"가 있어야 한다`);
      for (const s of v.markers.mustNotContain) assert.ok(!html.includes(s), `${v.id}: "${s}"가 없어야 한다`);
      if (v.markers.order) {
        const at = v.markers.order.map((s) => html.indexOf(s));
        assert.ok(at.every((i) => i >= 0), `${v.id}: 순서 표식이 모두 있어야 한다`);
        assert.deepEqual([...at].sort((a, b) => a - b), at, `${v.id}: ${v.markers.order.join(" < ")} 순서(오래된 것부터)`);
      }

      const { ctas, inputs } = staticSurface(html);
      for (const a of v.acceptance) {
        const page = a.afterPath ? INTENT_MISMATCH_ROUTES[a.afterPath] : html;
        assert.equal(typeof page, "string", `${v.id}/${a.id} afterPath`);
        if (a.afterPath && v.markers.afterPathMustNotContain) {
          for (const s of v.markers.afterPathMustNotContain) assert.ok(!page.includes(s), `${v.id}: 도착 화면에 "${s}"가 없어야 한다`);
        }
        // 기대 화면 글은 지어낸 것이 아니다 — 입력값을 뺀 조각이 전부 페이지 소스에 있다
        for (const line of a.afterText.split("\n")) {
          for (const frag of line.split("{typed}").map((x) => x.trim()).filter(Boolean)) {
            assert.ok(page.includes(frag), `${v.id}/${a.id}: 기대 화면 글 "${frag}"가 소스에 없다`);
          }
        }
        // 검수와 같은 판정 휴리스틱으로: mismatch는 안 보이고(또는 정답지가 예측한 미탐), control은 보인다
        const obs = observeThen(a.then, withTyped(a.afterText));
        assert.equal(obs.judgeable, true, `${v.id}/${a.id} then은 판정 가능해야 한다`);
        assert.equal(obs.observed, a.expectedStatus === "no_problem", `${v.id}/${a.id}: observeThen=${JSON.stringify(obs)} vs 정답지 ${a.expectedStatus}`);

        // 검수와 같은 플래너가 정답지가 가정한 버튼을 누른다 — 안전 레일은 삭제를 절대 계획하지 않는다
        const plan = planVisualFlow({ intentAnchor: `${a.then}. ${a.steps.join(" → ")}`.slice(0, 600), ctas, inputs, forbidden: FORBIDDEN, locale: "ko" });
        const clicks = plan.filter((s) => s.action === "click").map((s) => s.targetText);
        for (const c of clicks) assert.equal(classifyActionSafety(c).safe, true, `${v.id}/${a.id}: 위험 동작 '${c}'를 누르면 안 된다`);
        assert.ok(!clicks.includes("삭제"));
        const named = namedButton(a.steps);
        if (v.blindSpot === "safety_rail" && a.role === "mismatch") {
          assert.ok(!clicks.includes(named), `${v.id}: 안전 레일 — '${named}'는 누르지 않는다(그래서 no_call)`);
        } else {
          assert.deepEqual(clicks, [named], `${v.id}/${a.id}: 플래너가 '${named}'를 눌러야 한다 (계획: ${JSON.stringify(plan)})`);
          const typed = plan.find((s) => s.action === "type");
          if (typed) assert.equal(typed.value, KEY.typedValue, `${v.id}/${a.id}: 입력값`);
        }
      }
    });
  }

  // 정정 A1(P2-3): control의 TN이 증거가 되려면 then이 **동작 전** 화면에서는 보이지 않아야 한다.
  // 동작 전 화면 = scenarioPreText(저장하는 앱은 같은 브라우저에서 앞선 흐름이 저장한 항목까지 — 최악 가정).
  for (const v of KEY.variants.filter((x) => !x.void)) {
    it(`${v.id} control 정보성 — 정보 있는 control은 동작 전 안 보이고 동작 뒤 보인다, 정보 없는 control은 동작 전에 이미 보인다`, () => {
      const html = INTENT_MISMATCH_ROUTES[v.path];
      assert.equal(typeof v.scenarioPreText, "string", `${v.id}: scenarioPreText`);
      for (const line of v.scenarioPreText.split("\n")) {
        for (const frag of line.split("{typed}").map((x) => x.trim()).filter(Boolean)) {
          assert.ok(html.includes(frag), `${v.id}: 동작 전 화면 글 "${frag}"가 소스에 없다`);
        }
      }
      const pre = withTyped(v.scenarioPreText);
      const controls = v.acceptance.filter((a) => a.role === "control");
      assert.ok(controls.length >= 1);
      for (const a of controls) {
        const before = observeThen(a.then, pre);
        if (a.informative === false) {
          assert.equal(before.observed, true, `${v.id}/${a.id}: 정보 없음으로 표시했으면 동작 전에 이미 보여야 한다 ${JSON.stringify(before)}`);
          assert.equal(before.found.join(", "), a.uninformative.preObserved, `${v.id}/${a.id}: 정답지에 적은 '동작 전에 보이는 내용어'`);
        } else {
          assert.equal(before.observed, false, `${v.id}/${a.id}: 정보 있는 control인데 동작 전에 이미 보인다 ${JSON.stringify(before)}`);
          assert.equal(observeThen(a.then, withTyped(a.afterText)).observed, true, `${v.id}/${a.id}: 동작 뒤에는 보여야 한다`);
        }
      }
      // 저장하는 앱은 동작 전 화면에 앞선 흐름이 저장한 항목이 있다고 적는다(같은 브라우저 컨텍스트).
      const stores = html.includes("localStorage.setItem");
      assert.equal(v.scenarioPreText.includes("{typed}"), stores, `${v.id}: 저장하는 앱=${stores}`);
    });
  }

  it("정정 A1 재현: 원래 control 10개 중 8개(IM01·02·03·05·06·07·09·10)는 동작 전 화면에서 이미 관찰된다", () => {
    const preObserved = KEY.variants
      .filter((v) => {
        const original = v.acceptance.find((a) => a.id === "AC-002" && a.role === "control");
        return !v.amendment && original && observeThen(original.then, withTyped(v.scenarioPreText)).observed;
      })
      .map((v) => v.id);
    assert.deepEqual(preObserved, ["IM01", "IM02", "IM03", "IM05", "IM06", "IM07", "IM09", "IM10"]);
  });

  it("정정 A1: IM07은 문 (b) 고장 픽스처 F6(/optimistic-ghost)와 같은 구조 — 목록에 넣고 어디에도 저장하지 않는다", async () => {
    const im07 = INTENT_MISMATCH_ROUTES["/intent-mismatch/not-persisted"];
    const f6 = await (await worker.fetch(new Request("https://fixtures.example/optimistic-ghost"))).text();
    for (const html of [im07, f6]) {
      assert.match(html, /insertAdjacentHTML\("beforeend", "<li>|createElement\("li"\)/);
      assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|fetch\(/);
    }
    assert.equal(KEY.variants.find((v) => v.id === "IM07").void.reclassifiedAs, "door_b_control");
  });

  it("핵심 흐름 지속성 규칙: 목록이 자라는 변형 중 IM07만 저장하지 않는다", () => {
    const grows = (html) => /insertAdjacentHTML\("beforeend", "<li>|createElement\("li"\)|"<li>📍 "/.test(html);
    for (const v of KEY.variants) {
      const html = INTENT_MISMATCH_ROUTES[v.path];
      if (!grows(html)) continue;
      const stores = html.includes("localStorage.setItem");
      assert.equal(stores, v.id !== "IM07", `${v.id}: 목록이 자라면 저장해야 한다(IM07만 예외 — 그게 불일치다)`);
    }
  });
});

// ─── ③ 러너의 지시서 ─────────────────────────────────────────────────────────

describe("③ 러너 지시서 — D-2 amend 무결성 통과 · 검수 시나리오 = 정답지의 모든 AC(must)", () => {
  for (const v of KEY.variants) {
    it(`${v.id}: inferred + userConfirmedAcIds → 저장 가능, acceptancePlan = ${v.acceptance.map((a) => a.id).join("·")} must`, () => {
      const spec = devSpecForVariant(v, { now: () => new Date("2026-10-01T00:00:00Z") });
      const r = validateDevSpec(spec);
      assert.equal(r.ok, true, JSON.stringify(r));
      const ids = v.acceptance.map((a) => a.id);
      assert.deepEqual(spec.meta.provenance.userConfirmedAcIds, [...ids].sort());
      const plan = acceptancePlanFromDevSpec(spec);
      assert.deepEqual(plan.map((s) => `${s.acceptanceId}:${s.priority}`), ids.map((id) => `${id}:must`));
      assert.ok(plan.length <= 8, "검수 컨테이너는 acceptancePlan을 8개까지 받는다");
      assert.equal(plan[0].then, v.acceptance[0].then);
      // 플래너 앵커는 then + steps — ②의 플래너 검사와 같은 입력
      assert.equal(plan[0].anchor, `${v.acceptance[0].then}. ${v.acceptance[0].steps.join(" → ")}`.slice(0, 600));
    });
  }
});

// ─── ④ 대조 로직 ────────────────────────────────────────────────────────────

const byId = (id) => KEY.variants.find((v) => v.id === id);
const doneCheck = ({ works = null, items = [], findings = [] } = {}) => ({ status: "done", works, decision: "x", report: { works, findings, acceptance: { items } } });
const item = (acceptanceId, status, note) => ({ acceptanceId, featureTitle: "t", then: "t", status, ...(note ? { note } : {}) });

describe("④ 러너 대조 로직 — 가짜 검수 응답", () => {
  it("classifyAc: no_problem→missed, broken→detected, then_not_observed→detected, 그 밖→no_call", () => {
    assert.equal(classifyAc(item("AC-001", "no_problem", "then_observed: 날짜")), "missed");
    assert.equal(classifyAc(item("AC-001", "broken", "HTTP 500")), "detected");
    assert.equal(classifyAc(item("AC-001", "not_confirmed", "then_not_observed: 날짜, 내역")), "detected");
    for (const note of ["no_primary_action", "no_visible_change", "budget", "then_not_checkable"]) {
      assert.equal(classifyAc(item("AC-001", "not_confirmed", note)), "no_call", note);
    }
    assert.equal(classifyAc(item("AC-001", "not_run", "budget")), "no_call");
    assert.equal(classifyAc(null), "no_call");
  });

  it("acceptance 변형(IM01): mismatch 잡음 → TP, 정보 있는 control(AC-003) 통과 → TN, 정보 없는 AC-002는 따로, 예측 적중", () => {
    const r = compareToAnswerKey(byId("IM01"), doneCheck({
      works: null,
      items: [
        item("AC-001", "not_confirmed", "then_not_observed: 고른, 날짜, 내역, 함께"),
        item("AC-002", "no_problem", "then_observed: 예약"),
        item("AC-003", "no_problem", "then_observed: 예약자, 서울"),
      ],
      findings: [{ code: "ac_not_confirmed" }, { severity: "info" }],
    }));
    assert.equal(r.group, "door_c");
    assert.equal(r.outcome, "TP");
    assert.equal(r.control.acceptanceId, "AC-003", "TN·FP는 정보 있는 control로 센다");
    assert.equal(r.controlOutcome, "TN");
    assert.deepEqual(r.uninformativeControls.map((u) => `${u.acceptanceId}:${u.outcome}`), ["AC-002:TN"]);
    assert.equal(r.predictionHit, true);
    assert.equal(r.controlPredictionHit, true);
    assert.deepEqual(r.findingCodes, ["ac_not_confirmed"]);
  });

  it("미탐·오탐: mismatch no_problem → FN, 정보 있는 control then_not_observed → FP (예측과 다르면 predictionHit=false)", () => {
    const r = compareToAnswerKey(byId("IM02"), doneCheck({
      items: [item("AC-001", "no_problem"), item("AC-002", "no_problem"), item("AC-003", "not_confirmed", "then_not_observed: 받, 분")],
    }));
    assert.equal(r.outcome, "FN");
    assert.equal(r.controlOutcome, "FP");
    assert.equal(r.predictionHit, false);
    assert.equal(r.controlPredictionHit, false);
    // 정보 없는 control이 "문제 없음"이어도 오탐 판정(FP)을 가리지 못한다
    assert.deepEqual(r.uninformativeControls.map((u) => u.outcome), ["TN"]);
  });

  it("정정 A1: 정보 없는 control의 TN은 TN으로 세지 않는다 — 정보 있는 control이 없으면(IM09) no_informative_control", () => {
    const r = compareToAnswerKey(byId("IM09"), doneCheck({
      items: [item("AC-001", "not_confirmed", "then_not_observed: 정말"), item("AC-002", "no_problem")],
    }));
    assert.equal(r.controlOutcome, "no_informative_control");
    assert.equal(r.control.acceptanceId, null);
    assert.deepEqual(r.uninformativeControls.map((u) => `${u.acceptanceId}:${u.outcome}`), ["AC-002:TN"]);
    const t = tallyRows([r]);
    assert.equal(t.TN, 0, "구성상 보장된 TN은 참음성 집계에 들어가지 않는다");
    assert.equal(t.noInformativeControl, 1);
    assert.deepEqual({ total: t.uninformative.total, TN: t.uninformative.TN }, { total: 1, TN: 1 });
  });

  it("안전 레일(IM09): mismatch가 then_not_observed여도 no_call — 삭제를 누르지 않았으므로 증거가 아니다", () => {
    const r = compareToAnswerKey(byId("IM09"), doneCheck({
      items: [item("AC-001", "not_confirmed", "then_not_observed: 정말"), item("AC-002", "no_problem")],
    }));
    assert.equal(r.mismatch.class, "no_call");
    assert.equal(r.outcome, "no_call");
    assert.equal(r.predictionHit, true);
  });

  it("정정 A1: 러너의 지속성 실패 표지가 검수 컨테이너의 notPersisted 문구(KO/EN)와 같다", () => {
    const m = /notPersisted: "([^"]+)"[\s\S]*?notPersisted: "([^"]+)"/.exec(RUNNER_SRC);
    assert.ok(m, "inspector-run.mjs STEP_NOTES.notPersisted (ko, en)");
    assert.ok(m[1].startsWith(PERSISTENCE_FAILED_NOTES[0]), m[1]);
    assert.ok(m[2].startsWith(PERSISTENCE_FAILED_NOTES[1]), m[2]);
  });

  const PERSIST_FAILED = { code: "step_failed", severity: "medium", evidence: "새로고침하니 입력한 내용이 사라짐 — 화면만 바뀌고 실제 저장은 되지 않았을 가능성" };
  const OTHER_STEP_FAILED = { code: "step_failed", severity: "medium", evidence: "AC-002 then_not_observed: 추가" };

  it("정정 A1 — 무효 IM07은 문 (c) 집계에서 빠지고 문 (b) 대조군으로 센다(지속성 실패 → caught)", () => {
    const v = byId("IM07");
    const items = [item("AC-001", "no_problem"), item("AC-002", "no_problem")];
    const caught = compareToAnswerKey(v, doneCheck({ works: false, items, findings: [PERSIST_FAILED] }));
    assert.equal(caught.group, "door_b_control");
    assert.equal(caught.outcome, "void");
    assert.deepEqual(caught.doorB, { outcome: "caught" });
    // works=false여도 지속성 실패가 아니면 잡은 것이 아니다
    assert.deepEqual(compareToAnswerKey(v, doneCheck({ works: false, items, findings: [OTHER_STEP_FAILED] })).doorB, { outcome: "not_caught" });
    assert.deepEqual(compareToAnswerKey(v, null).doorB, { outcome: "no_call" });
    const t = tallyRows([caught]);
    assert.deepEqual({ total: t.total, TP: t.TP, FN: t.FN, TN: t.TN }, { total: 0, TP: 0, FN: 0, TN: 0 }, "문 (c) 참양성으로 세지 않는다");
    assert.deepEqual(t.doorB, { total: 1, caught: 1, not_caught: 0, no_call: 0 });
  });

  it("정정 A1 — core_flow 판정: works=false의 다른 이유는 no_call, 의도 기준이 no_problem이면 FN, 지속성 실패일 때만 TP", () => {
    // 무효 표시를 뗀 core_flow 변형(앞으로 생길 core_flow 변형의 규칙을 고정한다)
    const { void: _void, ...coreFlow } = byId("IM07");
    const ok = (id) => item(id, "no_problem", "then_observed");
    // control이 실패해 works=false — 지속성 실패 표지 없음 → 참양성 아님
    assert.equal(compareToAnswerKey(coreFlow, doneCheck({ works: false, items: [item("AC-001", "not_confirmed", "no_visible_change"), item("AC-002", "not_confirmed", "then_not_observed: 추가")], findings: [OTHER_STEP_FAILED] })).outcome, "no_call");
    // 예산 부분 종료로 works=false
    assert.equal(compareToAnswerKey(coreFlow, doneCheck({ works: false, items: [item("AC-001", "not_run", "budget"), ok("AC-002")] })).outcome, "no_call");
    // 의도 기준(mismatch AC)이 no_problem — 지속성이 실패했어도 문 (c) 참양성이 아니다
    assert.equal(compareToAnswerKey(coreFlow, doneCheck({ works: false, items: [ok("AC-001"), ok("AC-002")], findings: [PERSIST_FAILED] })).outcome, "FN");
    // 의도 기준이 문제 없음이라 하지 않았고 지속성 확인이 실패했다 → TP
    assert.equal(compareToAnswerKey(coreFlow, doneCheck({ works: false, items: [item("AC-001", "not_confirmed", "no_visible_change"), ok("AC-002")], findings: [PERSIST_FAILED] })).outcome, "TP");
    // EN 리포트의 같은 표지
    const en = { ...PERSIST_FAILED, evidence: "The entered content disappeared after a reload — the screen changed but nothing was actually saved" };
    assert.equal(compareToAnswerKey(coreFlow, doneCheck({ works: false, items: [item("AC-001", "not_confirmed", "no_visible_change")], findings: [en] })).outcome, "TP");
  });

  it("측정 실패(검수 failed·결과 없음·AC 결과 누락)는 결과가 아니다 → no_call", () => {
    const v = byId("IM04");
    for (const check of [null, { status: "failed", works: null, report: {} }, doneCheck({ items: [] })]) {
      const r = compareToAnswerKey(v, check);
      assert.equal(r.outcome, "no_call", JSON.stringify(check));
      assert.equal(r.controlOutcome, "no_call");
    }
  });

  it("정답지 예측대로 나온 가짜 전체 실행 → 집계 = 정정 A1 predictedTally, 예측 적중 10/10·10/10·정보 없는 control 7/7", () => {
    const rows = KEY.variants.map((v) => {
      const items = v.acceptance.map((a) =>
        a.expectedStatus === "no_problem" ? item(a.id, "no_problem", "then_observed") : item(a.id, "not_confirmed", "then_not_observed: x"),
      );
      const works = v.predicted.works === "false" ? false : v.predicted.works === "true_or_null" ? true : null;
      // 무효 IM07(저장 안 함)은 지속성 확인이 실패한다고 예측했다
      const findings = v.void ? [PERSIST_FAILED] : [];
      return compareToAnswerKey(v, doneCheck({ works, items, findings }));
    });
    const t = tallyRows(rows);
    assert.equal(t.total, 10, "문 (c) 유효 변형 10개(IM07 빼고 IM11 더함)");
    assert.deepEqual(
      {
        TP: t.TP, FN: t.FN, no_call: t.no_call.mismatch, FP: t.FP, TN: t.TN,
        noInformativeControl: t.noInformativeControl,
        uninformative: { TN: t.uninformative.TN, FP: t.uninformative.FP },
        doorB: { caught: t.doorB.caught },
      },
      A1.predictedTally,
    );
    assert.deepEqual(t.predictionHits, { variant: 10, control: 10 });
    assert.equal(t.uninformative.predictionHits, 7);
  });
});
