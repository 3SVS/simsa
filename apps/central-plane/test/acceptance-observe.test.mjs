/**
 * A5.2 — AC then 대조. 라이브 E2E(2026-09-25) 사례를 그대로 픽스처로:
 * 빵집 지시서로 Simsa 로그인 화면을 검수했더니 "빵 목록 표시"가 문제 없음으로 나왔다.
 * 규칙: 이 판정기는 그 경우 "관찰 안 됨"이어야 하고, 진짜 빵집 화면에서는 "관찰됨"이어야 한다(양방향).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { thenTerms, observeThen } = await import("../inspector-container/acceptance-observe.mjs");

const LOGIN_PAGE = `Simsa 로그인 Google로 계속하기 이메일 비밀번호 로그인 계정이 없나요? 개발자용 GitHub로 계속하기`;
const BAKERY_LIST = `밀과 소금 오늘의 빵 소금빵 3,500원 크루아상 4,000원 품절 바게트 담기 픽업 시간 선택`;
const BAKERY_DONE = `예약이 완료됐어요 픽업 시간 18:30 소금빵 2개 크루아상 1개 전화번호 010-****-1234`;

describe("thenTerms — 내용어 추출(한글 조사·어미·기능어 제거)", () => {
  it("빵집 AC then", () => {
    assert.deepEqual(thenTerms("오늘의 빵 목록이 화면에 표시된다."), ["오늘", "빵", "목록"]);
    assert.deepEqual(thenTerms("품절된 빵에 품절 표시가 보인다."), ["품절", "빵"]);
    const t = thenTerms("예약 완료 화면에 예약 시간과 예약한 빵이 보인다.");
    assert.ok(t.includes("예약") && t.includes("시간") && t.includes("빵"), JSON.stringify(t));
  });
  it("영어 then", () => {
    assert.deepEqual(thenTerms("The pickup time and the selected breads are shown on the confirmation screen."), ["pickup", "time", "breads"]);
  });
  it("기능어뿐이면 빈 배열(판정 불가)", () => {
    assert.deepEqual(thenTerms("화면에 표시된다."), []);
    assert.deepEqual(thenTerms(""), []);
  });
});

describe("observeThen — 양방향", () => {
  it("★라이브 오탐 재현: 로그인 화면에서 빵집 AC는 관찰 안 됨", () => {
    for (const then of ["오늘의 빵 목록이 화면에 표시된다.", "선택한 픽업 시간으로 예약할 수 있다.", "예약 완료 화면에 예약 시간과 예약한 빵이 보인다."]) {
      const r = observeThen(then, LOGIN_PAGE);
      assert.equal(r.judgeable, true, then);
      assert.equal(r.observed, false, `${then} → ${JSON.stringify(r)}`);
      assert.ok(r.missing.length > 0);
    }
  });
  it("진짜 빵집 화면에서는 관찰됨 (과교정 방지)", () => {
    assert.equal(observeThen("오늘의 빵 목록이 화면에 표시된다.", BAKERY_LIST).observed, true);
    assert.equal(observeThen("품절된 빵에 품절 표시가 보인다.", BAKERY_LIST).observed, true);
    assert.equal(observeThen("예약 완료 화면에 예약 시간과 예약한 빵이 보인다.", BAKERY_DONE).observed, true);
  });
  it("판정 불가 then은 observed=false · judgeable=false (문제 없음을 주지 않는다)", () => {
    assert.deepEqual(observeThen("화면에 표시된다.", BAKERY_LIST), { observed: false, judgeable: false, terms: [], found: [], missing: [] });
  });
});

describe("inspector-run 배선", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const run = readFileSync(path.resolve(HERE, "../inspector-container/inspector-run.mjs"), "utf8");
  const docker = readFileSync(path.resolve(HERE, "../inspector-container/Dockerfile"), "utf8");
  it("no_problem은 then 관찰 뒤에만, 로드 시 오류는 기준선으로 제외", () => {
    assert.match(run, /import \{ observeThen \} from "\.\/acceptance-observe\.mjs"/);
    const noProblemIdx = run.indexOf('status: "no_problem"');
    const obsIdx = run.indexOf("observeThen(sc.then, bodyAfter)");
    assert.ok(obsIdx > 0 && noProblemIdx > obsIdx, "no_problem must come after the then check");
    assert.match(run, /const errBase = consoleErrors\.length;/);
    assert.match(run, /consoleErrors\.slice\(errBase\)/);
  });
  it("Dockerfile이 acceptance-observe.mjs를 이미지에 넣는다", () => {
    assert.match(docker, /COPY\s+apps\/central-plane\/inspector-container\/acceptance-observe\.mjs \.\/acceptance-observe\.mjs/);
  });
});
