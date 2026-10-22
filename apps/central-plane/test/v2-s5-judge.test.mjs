// v2 S5c·d (2026-10-22) — 판정 후처리: ① 첫 지점 규칙(같은 원인의 실패는 결함 하나로 묶는다, 라벨링 설계 §3.1)
// ② 마감 시각 해석(30분 단위 19시 마감의 마지막 시작 18:30은 실패가 아니다 — 벤치 #1 gemini·claude A1 거짓 실패 6칸).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const J = await import("../dist/v2-judge.js");

const H1 = { id: "H1", cls: "client_only_storage", coversAcIds: ["A5", "A6", "A7"] };
const fail = (acId, claim, quotes = ["x"]) => ({ acId, verdict: "fail", claim, artifactIds: ["E1"], quotes, reasons: [] });

describe("첫 지점 규칙 — 같은 원인 실패 묶기", () => {
  it("같은 가설이 덮고 같은 결함 분류인 실패 셋 → 결함 하나(영향 기준 3개) — 벤치 #1 A5·A7 중복 계수 7칸", () => {
    const vs = [
      fail("A5", "사장님 화면에 다른 손님 예약이 보이지 않아 취소할 수 없다 — 이 기기 브라우저에만 저장된다"),
      fail("A6", "다른 손님(새 브라우저)에게 이미 예약된 시간이 열려 있다 — 브라우저에만 저장"),
      fail("A7", "다른 방문자에게 내 예약이 보이지 않는다 — localStorage"),
    ];
    const g = J.groupFailures(vs, [H1], ["A5", "A6", "A7"]);
    assert.equal(g.length, 1);
    assert.deepEqual(g[0], { key: "H1:client_only_storage", cls: "client_only_storage", hypothesisId: "H1", acIds: ["A5", "A6", "A7"], rootAcId: "A5" });
  });
  it("분류가 다르면 같은 가설 아래여도 따로 센다 · 가설 밖 실패는 하나씩", () => {
    const vs = [fail("A6", "브라우저에만 저장돼 다른 손님에게 안 보인다"), fail("A7", "Uncaught TypeError: x is undefined"), fail("A9", "버튼을 눌러도 반응이 없다")];
    const g = J.groupFailures(vs, [H1], ["A6", "A7", "A9"]);
    assert.deepEqual(g.map((x) => x.acIds), [["A6"], ["A7"], ["A9"]]);
  });
  it("fail이 아닌 판정(pass·확인 못 함·불일치)은 묶지 않는다", () => {
    const vs = [{ ...fail("A6", "브라우저에만 저장"), verdict: "not_verified" }, { ...fail("A5", "브라우저에만 저장"), verdict: "mismatch" }];
    assert.deepEqual(J.groupFailures(vs, [H1], ["A5", "A6"]), []);
  });
});

const A1 = { id: "A1", title: "10:00~19:00, 30분 단위로 시간 선택", given: "예약 화면에서 날짜를 골랐다", when: "시간 목록을 본다", then: "오전 10시부터 오후 7시까지 30분 단위 시간을 고를 수 있다" };

describe("마감 시각 해석", () => {
  it("'오후 6시 30분까지만' = 마감(19시) − 단위(30분) → 실패 아님(강등) — 옛 엔진은 fail", () => {
    assert.equal(J.closingSlotMisread(A1, fail("A1", "시간 목록이 오후 6시 30분까지만 있고 오후 7시는 고를 수 없다", ["오후 6:30"])), true);
    assert.equal(J.closingSlotMisread(A1, fail("A1", "18:30까지만 보이고 19:00 칸이 없다", ["18:30"])), true);
  });
  it("진짜 빠진 시간(마감 1시간 전까지만 등)은 그대로 실패", () => {
    assert.equal(J.closingSlotMisread(A1, fail("A1", "오후 6시까지만 있고 6시 30분부터는 고를 수 없다", ["18:00"])), false);
    assert.equal(J.closingSlotMisread(A1, fail("A1", "오전 10시 칸이 없다", ["10:30"])), false);
  });
  it("기준에 마감·단위가 없으면 적용하지 않는다 · fail이 아니면 적용하지 않는다", () => {
    assert.equal(J.closingSlotMisread({ ...A1, title: "시간 선택", then: "시간을 고를 수 있다" }, fail("A1", "18:30까지만 있다", ["18:30"])), false);
    assert.equal(J.closingSlotMisread(A1, { ...fail("A1", "18:30까지만 있다", ["18:30"]), verdict: "pass" }), false);
  });
});
