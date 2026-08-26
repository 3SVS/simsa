/**
 * signup-plan.test.mjs — 일회용 계정 만들기 계획 (2026-08-26).
 *
 * 고정하는 계약:
 *   ① **멈춰야 할 곳에서 멈춘다** — 캡차·결제 요구는 우회하지 않는다
 *   ② 멈춘 이유를 **사용자 말로** 설명한다. 실패가 아니라 한계 보고다
 *   ③ 우리가 만든 계정임을 **앱 안에서 알아볼 수 있다**
 *   ④ 앱마다 다른 비밀번호 규칙에 우리 실수로 튕기지 않는다
 *   ⑤ 확인 링크를 고르되 **확신하지 않는다** — 후보를 순서대로 남긴다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  planSignup, hasCaptcha, requiresPayment, probeEmailFor, probePassword,
  probeDisplayName, rankVerificationLinks, blockerMessage,
} = await import("../dist/signup-plan.js");

const FIELDS = [
  { selectorHint: "[name=email]", type: "email", label: "이메일" },
  { selectorHint: "[name=password]", type: "password", label: "비밀번호" },
  { selectorHint: "[name=name]", type: "text", label: "이름" },
];
const base = { runId: "wvc_abc123", mailDomain: "probe.trysimsa.com", fields: FIELDS, submitTexts: ["가입하기"] };

describe("① 멈춰야 할 곳에서 멈춘다", () => {
  it("★캡차가 보이면 멈춘다 — 우회하지 않는다", () => {
    for (const markup of ['<div class="g-recaptcha">', "<div data-sitekey cf-turnstile>", "로봇이 아닙니다"]) {
      assert.equal(hasCaptcha(markup), true, markup);
      assert.deepEqual(planSignup({ ...base, pageMarkup: markup }), { ok: false, blocker: "captcha" });
    }
  });

  it("★결제 정보를 요구하면 멈춘다 — 무료 가입이 아니면 우리 일이 아니다", () => {
    assert.equal(requiresPayment("카드 번호를 입력하세요"), true);
    assert.deepEqual(planSignup({ ...base, pageText: "CVC" }), { ok: false, blocker: "payment_required" });
  });

  it("메일 받을 곳이 없으면 시작도 안 한다 — 중간에 멈춘 계정만 남는다", () => {
    assert.deepEqual(planSignup({ ...base, mailDomain: undefined }), { ok: false, blocker: "no_mail_domain" });
  });

  it("가입 화면이 아니면(이메일·비밀번호 칸 없음) 멈춘다", () => {
    assert.deepEqual(
      planSignup({ ...base, fields: [{ selectorHint: "[name=q]", type: "text", label: "검색" }] }),
      { ok: false, blocker: "no_signup_form" },
    );
    assert.equal(planSignup({ ...base, submitTexts: [] }).ok, false, "제출 버튼이 없어도 멈춘다");
  });
});

describe("② 멈춘 이유를 사용자 말로", () => {
  it("모든 사유에 KO/EN 문구가 있고, 실패가 아니라 한계로 말한다", () => {
    for (const b of ["captcha", "payment_required", "no_signup_form", "no_mail_domain", "verification_timeout", "unsafe_action"]) {
      for (const [loc, re] of [["ko", /확인하지 못했|멈췄어요/], ["en", /could not|stopped/i]]) {
        const msg = blockerMessage(b, loc);
        assert.ok(msg.length > 0, `${b}/${loc}`);
        assert.match(msg, re, `${b}/${loc}`);
      }
    }
  });

  it("★'고장났다'고 말하지 않는다 — 우리가 못 본 것이지 앱의 결함이 아니다", () => {
    for (const b of ["captcha", "payment_required", "no_signup_form"]) {
      assert.doesNotMatch(blockerMessage(b, "ko"), /고장|작동 안|오류/);
    }
  });
});

describe("③④ 계정 자체의 성질", () => {
  it("주소는 검수 실행마다 다르다", () => {
    assert.equal(probeEmailFor("wvc_1", "probe.x.com"), "probe-wvc_1@probe.x.com");
    assert.notEqual(probeEmailFor("wvc_1", "d"), probeEmailFor("wvc_2", "d"));
  });

  it("★비밀번호가 흔한 규칙을 모두 만족한다 — 우리 실수로 튕기지 않게", () => {
    const pw = probePassword("wvc_abc123");
    assert.ok(pw.length >= 12, pw);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[^A-Za-z0-9]/);
  });

  it("runId가 짧거나 기호뿐이어도 규칙을 만족한다", () => {
    for (const id of ["a", "___", ""]) {
      const pw = probePassword(id);
      assert.ok(pw.length >= 12 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw), id);
    }
  });

  it("★우리가 만든 계정임을 앱 안에서 알아볼 수 있다", () => {
    assert.match(probeDisplayName("ko"), /Simsa/);
    assert.match(probeDisplayName("en"), /Simsa/);
    const p = planSignup(base);
    assert.ok(p.steps.some((s) => s.action === "fill" && String(s.value).includes("Simsa")));
  });
});

describe("계획의 모양", () => {
  it("이메일·비밀번호·이름을 채우고 제출한 뒤 메일을 기다린다", () => {
    const p = planSignup(base);
    assert.equal(p.ok, true);
    assert.deepEqual(p.steps.map((s) => s.action), ["fill", "fill", "fill", "submit", "await_mail", "open_link"]);
  });

  it("비밀번호 확인칸에도 같은 값을 넣는다", () => {
    const p = planSignup({
      ...base,
      fields: [...FIELDS, { selectorHint: "[name=password2]", type: "password", label: "비밀번호 확인" }],
    });
    const pw = p.steps.filter((s) => s.action === "fill" && s.value === p.password);
    assert.equal(pw.length, 2);
  });
});

describe("⑤ 확인 링크를 고르되 확신하지 않는다", () => {
  const mails = [
    { subject: "도움말", links: ["https://app.com/help", "https://app.com/docs"] },
    { subject: "이메일을 인증해주세요", links: ["https://app.com/verify?token=x", "https://app.com/terms"] },
  ];

  it("인증 링크가 앞에 온다", () => {
    assert.equal(rankVerificationLinks(mails)[0], "https://app.com/verify?token=x");
  });

  it("★확신하지 않고 나머지도 남긴다 — 앱마다 문구가 다르다", () => {
    const ranked = rankVerificationLinks(mails);
    assert.ok(ranked.length >= 3, "후보를 버리지 않는다");
    assert.ok(ranked.includes("https://app.com/help"));
  });

  it("문서·약관은 뒤로 밀린다", () => {
    const ranked = rankVerificationLinks(mails);
    assert.ok(ranked.indexOf("https://app.com/verify?token=x") < ranked.indexOf("https://app.com/terms"));
  });

  it("중복은 한 번만", () => {
    const dup = [{ subject: "s", links: ["https://a.com/x", "https://a.com/x"] }];
    assert.equal(rankVerificationLinks(dup).length, 1);
  });
});
