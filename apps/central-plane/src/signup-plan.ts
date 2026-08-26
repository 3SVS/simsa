/**
 * signup-plan.ts — 일회용 계정 만들기 계획 (2026-08-26).
 *
 * 순수 함수만 둔다(네트워크·브라우저 없음). 실행은 컨테이너가 하고, 여기서는
 * **무엇을 할지와 무엇을 하지 않을지**를 정한다. `visual-flow-plan.ts`와 같은 구조다.
 *
 * ## 왜 계정을 만드는가
 *
 * 로그인 뒤를 보지 못하면 검수가 절반에서 멈춘다. 그런데 남의 비밀번호를 받아
 * 보관하는 길은 쓰지 않기로 했다(probe-mailbox.ts 헤더 참조). 그래서 우리가
 * **일회용 계정을 만든다.**
 *
 * ## 안전 원칙 — 여기서 멈추는 것들
 *
 * 로그인 뒤는 공개 화면보다 **위험하다**. 관리자 권한이면 더욱 그렇다. 그래서
 * 계정 준비 단계는 공개 화면보다 **더 보수적으로** 움직인다:
 *
 *   - **캡차가 보이면 멈춘다.** 우회하지 않는다.
 *   - **결제 정보를 요구하면 멈춘다.** 무료 가입이 아니면 우리 일이 아니다.
 *   - **파괴적 문구가 붙은 버튼은 누르지 않는다**(기존 금지 목록과 같은 원칙).
 *   - 멈추면 **정직하게 남긴다** — "로그인 뒤는 못 봤습니다"는 지금도 하는 말이고,
 *     그 자리로 돌아가는 것뿐이라 나빠지지 않는다.
 */

/** 계정 준비가 멈춘 이유 — 사용자에게 그대로 설명할 수 있어야 한다. */
export type SignupBlocker =
  | "captcha"
  | "payment_required"
  | "no_signup_form"
  | "no_mail_domain"
  | "verification_timeout"
  | "unsafe_action";

export type SignupField = {
  /** 화면에서 찾은 입력칸. placeholder/label/name 중 있는 것. */
  selectorHint: string;
  type: string;
  label: string;
};

export type SignupStep =
  | { action: "fill"; selectorHint: string; value: string; label: string }
  | { action: "submit"; targetText: string; label: string }
  | { action: "await_mail"; label: string }
  | { action: "open_link"; label: string };

export type SignupPlan =
  | { ok: true; email: string; password: string; displayName: string; steps: SignupStep[] }
  | { ok: false; blocker: SignupBlocker };

/** 캡차의 흔한 흔적. 하나라도 보이면 멈춘다. */
const CAPTCHA_MARKERS = [
  "recaptcha",
  "g-recaptcha",
  "hcaptcha",
  "cf-turnstile",
  "turnstile",
  "captcha",
  "로봇이 아닙니다",
  "i'm not a robot",
];

/** 결제 정보를 요구하는 가입은 우리 일이 아니다. */
const PAYMENT_MARKERS = [
  "card number",
  "카드 번호",
  "카드번호",
  "cvc",
  "cvv",
  "expiry",
  "유효기간",
  "billing",
  "결제 정보",
];

export function hasCaptcha(pageMarkup: string): boolean {
  const t = (pageMarkup ?? "").toLowerCase();
  return CAPTCHA_MARKERS.some((m) => t.includes(m.toLowerCase()));
}

export function requiresPayment(pageText: string): boolean {
  const t = (pageText ?? "").toLowerCase();
  return PAYMENT_MARKERS.some((m) => t.includes(m.toLowerCase()));
}

/**
 * 이 검수 실행 전용 주소. `probe-<runId>@<도메인>`.
 * 메일함(probe-mailbox.ts)이 같은 규칙으로 되읽으므로 형식을 바꾸면 양쪽을 함께 바꾼다.
 */
export function probeEmailFor(runId: string, mailDomain: string): string {
  return `probe-${runId}@${mailDomain}`;
}

/**
 * 비밀번호를 만든다. 앱마다 규칙이 다르므로 **흔한 요구를 모두 만족**시킨다
 * (대문자·소문자·숫자·기호·12자 이상). 짧거나 단순하면 가입이 규칙 위반으로
 * 튕기는데, 그건 앱의 결함이 아니라 우리 실수다.
 */
export function probePassword(runId: string): string {
  const tail = runId.replace(/[^A-Za-z0-9]/g, "").slice(-6).padEnd(6, "x");
  return `Simsa!${tail}A9`;
}

/**
 * 우리가 만든 계정임을 **앱 안에서 알아볼 수 있어야 한다.** 앱 주인이 사용자 목록에서
 * 이게 뭔지 몰라 당황하면 안 되고, 나중에 골라 지울 수 있어야 한다.
 */
export function probeDisplayName(locale: "ko" | "en" = "ko"): string {
  return locale === "en" ? "Simsa review test" : "Simsa 검수 테스트";
}

const EMAIL_HINT = /e-?mail|이메일|메일|아이디/i;
const PASSWORD_HINT = /password|비밀번호|암호/i;
const NAME_HINT = /name|이름|닉네임|nickname|company|회사|상호/i;

/**
 * 가입 화면에서 할 일을 정한다.
 *
 * 확인 링크를 여는 단계까지 계획에 넣는다 — 메일이 안 오는 앱도 많으므로
 * 실행 쪽에서 기다리다 없으면 그대로 진행한다(그것 자체는 실패가 아니다).
 */
export function planSignup(input: {
  runId: string;
  mailDomain?: string;
  fields: SignupField[];
  submitTexts: string[];
  pageMarkup?: string;
  pageText?: string;
  locale?: "ko" | "en";
}): SignupPlan {
  if (!input.mailDomain) return { ok: false, blocker: "no_mail_domain" };
  if (hasCaptcha(input.pageMarkup ?? "")) return { ok: false, blocker: "captcha" };
  if (requiresPayment(input.pageText ?? "")) return { ok: false, blocker: "payment_required" };

  const email = probeEmailFor(input.runId, input.mailDomain);
  const password = probePassword(input.runId);
  const displayName = probeDisplayName(input.locale ?? "ko");

  const steps: SignupStep[] = [];
  let sawEmail = false;
  let sawPassword = false;

  for (const f of input.fields) {
    const hay = `${f.label} ${f.selectorHint} ${f.type}`;
    if (!sawEmail && (f.type === "email" || EMAIL_HINT.test(hay))) {
      steps.push({ action: "fill", selectorHint: f.selectorHint, value: email, label: "이메일 입력" });
      sawEmail = true;
      continue;
    }
    if (f.type === "password" || PASSWORD_HINT.test(hay)) {
      // 비밀번호 확인칸이 따로 있는 앱이 많다 — 같은 값을 그대로 넣는다.
      steps.push({ action: "fill", selectorHint: f.selectorHint, value: password, label: "비밀번호 입력" });
      sawPassword = true;
      continue;
    }
    if (NAME_HINT.test(hay)) {
      steps.push({ action: "fill", selectorHint: f.selectorHint, value: displayName, label: "이름 입력" });
    }
  }

  // 이메일 칸이 없으면 가입 화면이 아니다(로그인 화면이거나 다른 폼).
  if (!sawEmail || !sawPassword) return { ok: false, blocker: "no_signup_form" };

  const submit = input.submitTexts.find((t) => t.trim().length > 0);
  if (!submit) return { ok: false, blocker: "no_signup_form" };
  steps.push({ action: "submit", targetText: submit.trim(), label: "가입 버튼 누르기" });
  steps.push({ action: "await_mail", label: "확인 메일 기다리기" });
  steps.push({ action: "open_link", label: "확인 링크 열기" });

  return { ok: true, email, password, displayName, steps };
}

/**
 * 받은 메일들에서 **열어볼 링크 후보**를 우선순위대로 고른다.
 *
 * 메일함은 후보를 거르지 않고 다 넘긴다(앱마다 문구가 달라서). 고르는 일은 여기서
 * 하되, **확신하지 않는다** — 확인/인증처럼 보이는 것을 앞에 두고 나머지도 남긴다.
 * 실행 쪽이 앞에서부터 열어보고 로그인 상태가 되면 멈춘다.
 */
export function rankVerificationLinks(emails: Array<{ subject: string; links: string[] }>): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  for (const mail of emails) {
    const subjectBoost = /verify|confirm|activate|인증|확인|가입|초대|invite/i.test(mail.subject) ? 2 : 0;
    for (const url of mail.links) {
      if (seen.has(url)) continue;
      seen.add(url);
      let score = subjectBoost;
      if (/verify|confirm|activate|validation|auth|token|invite|accept/i.test(url)) score += 3;
      if (/login|signin/i.test(url)) score += 1;
      if (/help|docs|support|privacy|terms|blog/i.test(url)) score -= 3;
      scored.push({ url, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}

/** 멈춘 이유를 사용자 말로. 실패가 아니라 **한계 보고**다. */
export function blockerMessage(b: SignupBlocker, locale: "ko" | "en" = "ko"): string {
  const ko: Record<SignupBlocker, string> = {
    captcha: "가입 화면에 로봇 확인(캡차)이 있어서 로그인 뒤 화면은 확인하지 못했어요.",
    payment_required: "가입에 결제 정보가 필요해서 로그인 뒤 화면은 확인하지 못했어요.",
    no_signup_form: "가입 화면을 찾지 못해서 로그인 뒤 화면은 확인하지 못했어요.",
    no_mail_domain: "확인 메일을 받을 준비가 되어 있지 않아 로그인 뒤 화면은 확인하지 못했어요.",
    verification_timeout: "가입은 했지만 확인 메일이 오지 않아 로그인 뒤 화면은 확인하지 못했어요.",
    unsafe_action: "가입 과정에 되돌리기 어려운 동작이 있어서 거기서 멈췄어요.",
  };
  const en: Record<SignupBlocker, string> = {
    captcha: "The sign-up screen has a robot check (CAPTCHA), so we could not check what is behind the login.",
    payment_required: "Sign-up requires payment details, so we could not check what is behind the login.",
    no_signup_form: "We could not find a sign-up screen, so we could not check what is behind the login.",
    no_mail_domain: "We are not set up to receive the confirmation email, so we could not check behind the login.",
    verification_timeout: "We signed up but the confirmation email never arrived, so we could not check behind the login.",
    unsafe_action: "Sign-up involved an action that is hard to undo, so we stopped there.",
  };
  return (locale === "en" ? en : ko)[b];
}
