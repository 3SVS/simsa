/**
 * blocker-feedback.test.mjs — 막힌 이유를 "고칠 것"으로 바꾸는 구분 (2026-09-01).
 *
 * Bae 제안: *"안 되면 그걸 피드백에 추가하면 되는 거야. '테스트 계정 생성은 가능하지만
 * 지우기 불가' 이런 식으로. 고치고 다시 돌려서 작동 여부까지 확인하는 순환 구조."*
 *
 * ★이 파일이 지키는 것은 **세 종류를 섞지 않는 것**이다:
 *   app_gap    앱의 누락 → 고칠 것으로 올린다
 *   app_choice 앱의 정당한 선택(캡차·유료) → **결함이 아니다**
 *   our_limit  우리 사정 → 사용자 탓이 아니다
 *
 * "캡차가 있는 건 문제입니다"라고 말하는 순간 우리가 틀린 쪽이 된다. 이 경계가
 * 무너지면 남의 앱을 잘못 비난하게 되고, 그건 오탐보다 오래 남는 손상이다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { blockerToFinding, cleanupFinding } = await import("../dist/signup-plan.js");

describe("★앱의 정당한 선택을 결함으로 만들지 않는다", () => {
  for (const b of ["captcha", "payment_required", "unsafe_action"]) {
    it(`${b} → app_choice, 고칠 것 목록에 올리지 않는다`, () => {
      const f = blockerToFinding(b, "ko");
      assert.equal(f.kind, "app_choice");
      assert.equal(f.what, undefined, "what이 있으면 리포트에 결함으로 올라간다");
    });
  }

  it("우리 사정은 our_limit — 사용자 탓으로 돌리지 않는다", () => {
    const f = blockerToFinding("no_mail_domain", "ko");
    assert.equal(f.kind, "our_limit");
    assert.equal(f.what, undefined);
  });
});

describe("앱의 누락은 고칠 것으로 올린다", () => {
  for (const b of ["no_signup_form", "verification_timeout"]) {
    it(`${b} → app_gap, what/why/how가 다 있다`, () => {
      for (const loc of ["ko", "en"]) {
        const f = blockerToFinding(b, loc);
        assert.equal(f.kind, "app_gap", `${b}/${loc}`);
        for (const k of ["what", "why", "how"]) {
          assert.ok(f[k] && f[k].length > 0, `${b}/${loc}.${k}`);
        }
      }
    });
  }

  it("★why가 '우리가 못 봐서'가 아니라 '손님이 못 써서'를 말한다", () => {
    // 사용자 입장에서 값어치가 있어야 고친다. 우리 편의를 이유로 대면 안 고친다.
    assert.match(blockerToFinding("no_signup_form", "ko").why, /손님|이탈|쓸 수 없/);
    assert.match(blockerToFinding("verification_timeout", "ko").why, /손님|이탈/);
  });

  it("★순환의 고리 — 고치면 무엇까지 확인되는지 말한다", () => {
    for (const b of ["no_signup_form", "verification_timeout"]) {
      const f = blockerToFinding(b, "ko");
      assert.ok(f.unlocks && f.unlocks.length > 0, b);
      assert.match(f.unlocks, /확인|판정/);
    }
  });

  it("개발자 용어를 쓰지 않는다", () => {
    const JARGON = [/\bAPI\b/, /엔드포인트/, /스키마/, /토큰/];
    for (const b of ["no_signup_form", "verification_timeout"]) {
      const f = blockerToFinding(b, "ko");
      for (const re of JARGON) {
        for (const k of ["what", "why", "how"]) assert.ok(!re.test(f[k]), `${b}.${k}: ${f[k]}`);
      }
    }
  });
});

describe("정리(탈퇴) 결과 — 실패를 숨기지 않는다", () => {
  it("잘 지웠으면 아무 말도 하지 않는다", () => {
    assert.equal(cleanupFinding("deleted", "ko"), null);
  });

  it("★탈퇴 기능이 없는 것은 앱의 누락이다 — 손님도 그만둘 수 없다", () => {
    const f = cleanupFinding("no_delete_feature", "ko");
    assert.equal(f.kind, "app_gap");
    assert.match(f.why, /손님|그만둘/);
    assert.match(f.how, /탈퇴/);
  });

  it("★우리가 못 치운 것은 숨기지 않고, 찾을 수 있게 이름을 알려준다", () => {
    const f = cleanupFinding("failed", "ko");
    assert.equal(f.kind, "our_limit", "우리 실패를 앱 결함으로 떠넘기지 않는다");
    assert.match(f.what, /지우지 못했/);
    assert.match(f.how, /Simsa 검수 테스트/);
  });

  it("EN도 같은 구분을 지킨다", () => {
    assert.equal(cleanupFinding("no_delete_feature", "en").kind, "app_gap");
    assert.equal(cleanupFinding("failed", "en").kind, "our_limit");
  });
});
