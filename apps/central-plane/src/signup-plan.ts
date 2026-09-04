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


// ─── 막힌 이유를 "고칠 것"으로 바꾼다 (2026-09-01, Bae 제안) ──────────────────
//
// Bae: *"안 되면 그걸 우리가 피드백에 추가하면 되는 거야. '테스트 계정 생성은
// 가능하지만 지우기 불가' 이런 식으로. 한번 이걸로 고치고 나서 다시 돌려서 이제는
// 작동 여부까지 확인하는 순환 구조가 필요해."*
//
// 맞는 방향이고, 실제로 **검수를 막는 것 대부분은 실사용자도 겪는 문제**다.
// 가입이 안 되면 우리만 못 들어가는 게 아니라 손님도 못 들어간다.
//
// ★그런데 셋을 반드시 구분해야 한다. 섞으면 거짓말이 된다:
//
//   app_gap    앱의 누락 — **고칠 것**. 리포트에 결함으로 올린다.
//   app_choice 앱의 정당한 선택(캡차·유료 가입) — 결함이 아니다. 한계로만 말한다.
//   our_limit  우리 사정(메일 수신 미설정·시간 초과) — 사용자 탓이 아니다.
//
// "캡차가 있는 건 문제입니다"라고 말하는 순간 우리가 틀린 쪽이 된다.

export type BlockerKind = "app_gap" | "app_choice" | "our_limit";

export type BlockerFinding = {
  kind: BlockerKind;
  /** app_gap일 때만 채운다 — 리포트의 "고칠 것" 목록에 올라간다. */
  what?: string;
  why?: string;
  how?: string;
  /** 이걸 고치면 다음 검수에서 **무엇까지 확인할 수 있게 되는가**(순환의 고리). */
  unlocks?: string;
};

const BLOCKER_KIND: Record<SignupBlocker, BlockerKind> = {
  no_signup_form: "app_gap",
  verification_timeout: "app_gap",
  captcha: "app_choice",
  payment_required: "app_choice",
  unsafe_action: "app_choice",
  no_mail_domain: "our_limit",
};

/**
 * 막힌 이유를 사용자 언어의 결함(또는 한계)으로 옮긴다.
 *
 * `app_gap`만 "고칠 것"이 되고, 나머지는 `what`이 비어 리포트에 결함으로 올라가지
 * 않는다 — 호출부가 `kind`만 보고 판단하면 된다.
 */
export function blockerToFinding(b: SignupBlocker, locale: "ko" | "en" = "ko"): BlockerFinding {
  const kind = BLOCKER_KIND[b];
  if (kind !== "app_gap") return { kind };

  const ko: Partial<Record<SignupBlocker, Omit<BlockerFinding, "kind">>> = {
    no_signup_form: {
      what: "회원가입 화면을 찾지 못했어요.",
      why: "새로 온 손님이 계정을 만들 수 없으면 앱의 나머지를 아예 쓸 수 없어요. 저희도 로그인 뒤를 확인하지 못했습니다.",
      how: "첫 화면에서 눈에 보이는 곳에 '회원가입' 버튼을 두고, 이메일·비밀번호로 가입할 수 있게 해주세요.",
      unlocks: "가입이 되면 로그인 뒤 화면까지 확인해서 '정상 작동해요'까지 판정해 드릴 수 있어요.",
    },
    verification_timeout: {
      what: "가입은 됐는데 확인 메일이 오지 않았어요.",
      why: "확인 메일이 안 가면 손님이 가입을 끝내지 못하고 그대로 이탈해요. 실제로 가장 많이 놓치는 부분입니다.",
      how: "메일 발송 설정(보내는 주소 인증, 발송 서비스 키)이 실제로 동작하는지 확인해 주세요. 스팸함으로 갔을 수도 있어요.",
      unlocks: "메일이 오면 저희가 가입을 끝내고 로그인 뒤 기능까지 확인할 수 있어요.",
    },
  };
  const en: Partial<Record<SignupBlocker, Omit<BlockerFinding, "kind">>> = {
    no_signup_form: {
      what: "We could not find a sign-up screen.",
      why: "If a new visitor cannot create an account, they cannot use the rest of the app at all. We also could not check anything behind the login.",
      how: "Put a visible 'Sign up' button on the first screen and let people register with an email and password.",
      unlocks: "Once sign-up works we can check what is behind the login and give a definite 'it works' verdict.",
    },
    verification_timeout: {
      what: "Sign-up went through, but the confirmation email never arrived.",
      why: "If the confirmation email does not arrive, visitors cannot finish signing up and simply leave. This is one of the most commonly missed pieces.",
      how: "Check that your email sending is actually working (sender domain verified, API key set). It may also be landing in spam.",
      unlocks: "Once the email arrives we can finish sign-up and check the features behind the login.",
    },
  };
  return { kind, ...((locale === "en" ? en : ko)[b] ?? {}) };
}

/**
 * 정리(우리가 만든 계정 치우기) 결과를 사용자 언어로.
 *
 * **탈퇴 기능이 없는 것도 앱의 누락이다.** 우리만 불편한 게 아니라, 손님이 그만두고
 * 싶을 때 그만둘 수 없다는 뜻이다(국내 서비스에서는 사실상 필수 기능이기도 하다).
 * 다만 **정리 실패를 숨기지 않는다** — 우리가 남긴 것이 있으면 그대로 말한다.
 */
export function cleanupFinding(
  result: "deleted" | "no_delete_feature" | "failed",
  locale: "ko" | "en" = "ko",
): BlockerFinding | null {
  if (result === "deleted") return null;
  if (locale === "en") {
    return result === "no_delete_feature"
      ? {
          kind: "app_gap",
          what: "There is no way to delete an account.",
          why: "We created a test account and could not remove it — it is still in your app. More importantly, your own users cannot leave when they want to.",
          how: "Add a 'Delete account' action in settings that removes the account and its data.",
          unlocks: "With deletion available we can clean up after every review and leave nothing behind.",
        }
      : {
          kind: "our_limit",
          what: "We could not remove the test account we created.",
          why: "The delete step did not complete, so a test account may still be in your app.",
          how: "You can remove it manually — it is named \"Simsa 검수 테스트\".",
        };
  }
  return result === "no_delete_feature"
    ? {
        kind: "app_gap",
        what: "회원 탈퇴 기능이 없어요.",
        why: "저희가 만든 테스트 계정을 지우지 못해 앱에 그대로 남았어요. 더 중요한 건, 손님이 그만두고 싶을 때 그만둘 수 없다는 점이에요.",
        how: "설정 화면에 '회원 탈퇴'를 만들어 계정과 데이터를 지울 수 있게 해주세요.",
        unlocks: "탈퇴가 되면 검수할 때마다 저희가 만든 것을 스스로 치우고 아무것도 남기지 않아요.",
      }
    : {
        kind: "our_limit",
        what: "저희가 만든 테스트 계정을 지우지 못했어요.",
        why: "정리 단계가 끝까지 되지 않아 테스트 계정이 앱에 남아 있을 수 있어요.",
        how: "직접 지우실 수 있어요 — 이름이 \"Simsa 검수 테스트\"입니다.",
      };
}
