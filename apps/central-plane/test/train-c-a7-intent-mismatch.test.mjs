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
 *   ③ 러너의 지시서가 D-2 amend 무결성을 통과하고, 검수 시나리오(must 2개)가 된다
 *   ④ 러너 대조 로직(가짜 검수 응답): TP·FN·FP·TN·no_call·안전 레일·핵심 흐름 판정, 정답지 예측과 일관
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
const { devSpecForVariant, classifyAc, compareToAnswerKey, tallyRows, loadAnswerKey } = await import("../../../tools/simsa-inspection-fixtures/intent-mismatch-run.mjs");
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

// ─── ① 정답지 (문서 lint — 코드 회귀 증거 아님) ──────────────────────────────

describe("① [문서 lint] 정답지 — md·json 같은 내용, 예측 합계(코드 회귀 증거 아님)", () => {
  it("10변형 IM01~IM10, 변형마다 mismatch 1 + control 1, 휴리스틱 버전이 검수 러너와 같다", () => {
    assert.deepEqual(KEY.variants.map((v) => v.id), ["IM01", "IM02", "IM03", "IM04", "IM05", "IM06", "IM07", "IM08", "IM09", "IM10"]);
    for (const v of KEY.variants) {
      assert.deepEqual(v.acceptance.map((a) => a.role), ["mismatch", "control"], v.id);
      assert.match(v.intent, /[가-힣]/, `${v.id} 의도 문장은 한국어`);
    }
    assert.equal(KEY.heuristicRev, RUNNER_REV, "정답지가 가정한 판정 휴리스틱 = 지금 검수 러너");
  });

  it("md에 모든 변형 id·경로·의도·Then이 있다(두 판이 다른 말을 하지 않는다)", () => {
    for (const v of KEY.variants) {
      for (const s of [v.id, v.path, v.intent, v.differentNow]) assert.ok(MD.includes(s), `${v.id}: md에 "${s}" 없음`);
      for (const a of v.acceptance) assert.ok(MD.includes(a.then), `${v.id}/${a.id}: md에 Then "${a.then}" 없음`);
    }
  });

  it("예측 합계 = 변형별 예측의 합", () => {
    const sum = { TP: 0, FN: 0, no_call: 0, FP: 0, TN: 0 };
    for (const v of KEY.variants) {
      sum[v.predicted.outcome] += 1;
      sum[v.predicted.control] += 1;
    }
    assert.deepEqual(sum, KEY.predictedTally);
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

describe("③ 러너 지시서 — D-2 amend 무결성 통과 · 검수 시나리오 must 2개", () => {
  for (const v of KEY.variants) {
    it(`${v.id}: inferred + userConfirmedAcIds → 저장 가능, acceptancePlan = AC-001·AC-002 must`, () => {
      const spec = devSpecForVariant(v, { now: () => new Date("2026-10-01T00:00:00Z") });
      const r = validateDevSpec(spec);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(spec.meta.provenance.userConfirmedAcIds, ["AC-001", "AC-002"]);
      const plan = acceptancePlanFromDevSpec(spec);
      assert.deepEqual(plan.map((s) => `${s.acceptanceId}:${s.priority}`), ["AC-001:must", "AC-002:must"]);
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

  it("acceptance 변형(IM01): mismatch 잡음 → TP, control 통과 → TN, 예측 적중", () => {
    const r = compareToAnswerKey(byId("IM01"), doneCheck({
      works: null,
      items: [item("AC-001", "not_confirmed", "then_not_observed: 고른, 날짜, 내역, 함께"), item("AC-002", "no_problem", "then_observed: 예약")],
      findings: [{ code: "ac_not_confirmed" }, { severity: "info" }],
    }));
    assert.equal(r.outcome, "TP");
    assert.equal(r.controlOutcome, "TN");
    assert.equal(r.predictionHit, true);
    assert.deepEqual(r.findingCodes, ["ac_not_confirmed"]);
  });

  it("미탐·오탐: mismatch no_problem → FN, control then_not_observed → FP (예측과 다르면 predictionHit=false)", () => {
    const r = compareToAnswerKey(byId("IM02"), doneCheck({
      items: [item("AC-001", "no_problem"), item("AC-002", "not_confirmed", "then_not_observed: 담긴")],
    }));
    assert.equal(r.outcome, "FN");
    assert.equal(r.controlOutcome, "FP");
    assert.equal(r.predictionHit, false);
    assert.equal(r.controlPredictionHit, false);
  });

  it("안전 레일(IM09): mismatch가 then_not_observed여도 no_call — 삭제를 누르지 않았으므로 증거가 아니다", () => {
    const r = compareToAnswerKey(byId("IM09"), doneCheck({
      items: [item("AC-001", "not_confirmed", "then_not_observed: 정말"), item("AC-002", "no_problem")],
    }));
    assert.equal(r.mismatch.class, "no_call");
    assert.equal(r.outcome, "no_call");
    assert.equal(r.predictionHit, true);
  });

  it("핵심 흐름 변형(IM07): works false → TP(AC가 no_problem이어도), true → FN, null → no_call", () => {
    const v = byId("IM07");
    const items = [item("AC-001", "no_problem"), item("AC-002", "no_problem")];
    assert.equal(compareToAnswerKey(v, doneCheck({ works: false, items })).outcome, "TP");
    assert.equal(compareToAnswerKey(v, doneCheck({ works: true, items })).outcome, "FN");
    assert.equal(compareToAnswerKey(v, doneCheck({ works: null, items })).outcome, "no_call");
  });

  it("측정 실패(검수 failed·결과 없음·AC 결과 누락)는 결과가 아니다 → no_call", () => {
    const v = byId("IM04");
    for (const check of [null, { status: "failed", works: null, report: {} }, doneCheck({ items: [] })]) {
      const r = compareToAnswerKey(v, check);
      assert.equal(r.outcome, "no_call", JSON.stringify(check));
      assert.equal(r.controlOutcome, "no_call");
    }
  });

  it("정답지 예측대로 나온 가짜 전체 실행 → 집계 = predictedTally, 예측 적중 10/10·10/10", () => {
    const rows = KEY.variants.map((v) => {
      const items = v.acceptance.map((a) =>
        a.expectedStatus === "no_problem" ? item(a.id, "no_problem", "then_observed") : item(a.id, "not_confirmed", "then_not_observed: x"),
      );
      const works = v.predicted.works === "false" ? false : v.predicted.works === "true_or_null" ? true : null;
      return compareToAnswerKey(v, doneCheck({ works, items }));
    });
    const t = tallyRows(rows);
    assert.equal(t.total, 10);
    assert.deepEqual(
      { TP: t.TP, FN: t.FN, no_call: t.no_call.mismatch, FP: t.FP, TN: t.TN },
      KEY.predictedTally,
    );
    assert.deepEqual(t.predictionHits, { variant: 10, control: 10 });
  });
});
