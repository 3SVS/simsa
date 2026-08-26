/**
 * signup-run.mjs — 일회용 계정으로 로그인 뒤까지 들어가기 (2026-08-26).
 *
 * 판단은 전부 `dist/signup-plan.js`(순수 함수, 단위 테스트됨)에 있고, 여기서는
 * **실행만** 한다 — `inspector-run.mjs`가 `planVisualFlow`를 쓰는 것과 같은 구조다.
 *
 * ## 왜
 *
 * 로그인 뒤를 못 보면 검수가 절반에서 멈춘다. 그런데 **남의 비밀번호는 받지 않는다**
 * (probe-mailbox.ts 헤더 참조). 그래서 우리가 일회용 계정을 만들고, 앱이 보내는 확인
 * 메일을 우리 메일함에서 꺼내 가입을 완주한다.
 *
 * ## 실패는 실패가 아니다
 *
 * 캡차·결제 요구·메일 미도착에서 멈추면 **"로그인 뒤는 못 봤습니다"로 돌아갈 뿐**이다.
 * 그건 지금도 하는 말이라 나빠지지 않는다. 그래서 이 모듈은 **절대 던지지 않는다** —
 * 계정 준비 실패가 검수 전체를 깨뜨리면, 있던 기능까지 잃는다.
 */
import { planSignup, rankVerificationLinks, blockerMessage } from "./dist/signup-plan.js";
import { classifyActionSafety } from "./safety.mjs";

/** 가입 화면으로 가는 흔한 입구. 앱마다 문구가 다르므로 넓게 잡는다. */
const SIGNUP_LINK = /회원가입|가입하기|가입|sign\s?up|signup|register|create account|시작하기/i;
/** 흔한 가입 경로 — 링크를 못 찾았을 때만 시도한다. */
const SIGNUP_PATHS = ["/signup", "/sign-up", "/register", "/join", "/auth/signup"];

const MAIL_POLL_MS = 5000;
const MAIL_MAX_WAIT_MS = 90_000;

/** 로그인 상태로 보이는가. 확실한 신호만 쓴다 — 애매하면 아니라고 본다. */
async function looksLoggedIn(page) {
  return page
    .evaluate(() => {
      const t = (document.body.innerText || "").toLowerCase();
      const hasLogout = /로그아웃|sign out|log out|logout/.test(t);
      const stillAsking = /로그인|sign in|log in/.test(t) && !hasLogout;
      return hasLogout || (!stillAsking && !/회원가입|sign up/.test(t));
    })
    .catch(() => false);
}

async function collectSignupFields(page) {
  return page
    .$$eval("input, textarea, select", (els) =>
      els
        .filter((e) => e.offsetParent !== null && e.type !== "hidden")
        .slice(0, 20)
        .map((e) => {
          const id = e.getAttribute("id");
          const name = e.getAttribute("name");
          const ph = e.getAttribute("placeholder") ?? "";
          const labelText =
            (id && document.querySelector(`label[for="${id}"]`)?.textContent) ||
            e.closest("label")?.textContent ||
            "";
          return {
            selectorHint: name ? `[name="${name}"]` : id ? `#${id}` : ph ? `[placeholder="${ph}"]` : "",
            type: e.getAttribute("type") ?? e.tagName.toLowerCase(),
            label: `${labelText} ${ph} ${name ?? ""}`.replace(/\s+/g, " ").trim(),
          };
        })
        .filter((f) => f.selectorHint),
    )
    .catch(() => []);
}

async function collectSubmitTexts(page) {
  return page
    .$$eval("button, input[type=submit], [role=button]", (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => (e.innerText || e.value || "").trim())
        .filter(Boolean)
        .slice(0, 12),
    )
    .catch(() => []);
}

/** 우리 메일함을 폴링한다. 안 오면 그냥 없는 것 — 던지지 않는다. */
async function waitForMail({ runId, callbackBaseUrl, internalToken, plog }) {
  const started = Date.now();
  while (Date.now() - started < MAIL_MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, MAIL_POLL_MS));
    try {
      const res = await fetch(`${callbackBaseUrl}/internal/probe-mail?runId=${encodeURIComponent(runId)}`, {
        headers: { authorization: `Bearer ${internalToken}` },
      });
      if (!res.ok) continue;
      const body = await res.json();
      const emails = body?.emails ?? [];
      if (emails.length > 0) {
        plog(`signup:mail arrived n=${emails.length} after=${Math.round((Date.now() - started) / 1000)}s`);
        return emails;
      }
    } catch {
      /* 폴링 실패는 그냥 다음 회차 */
    }
  }
  plog("signup:mail timeout");
  return [];
}

/**
 * 가입을 시도한다.
 *
 * @returns {{ok: true, email: string, depth: "L3"} | {ok: false, blocker: string, message: string}}
 *   ok=false여도 검수는 계속된다 — 로그인 전 화면 기준으로 정직하게 판정한다.
 */
export async function attemptSignup({
  page,
  runId,
  mailDomain,
  callbackBaseUrl,
  internalToken,
  locale = "ko",
  plog = () => {},
}) {
  const fail = (blocker) => ({ ok: false, blocker, message: blockerMessage(blocker, locale) });
  if (!mailDomain) return fail("no_mail_domain");

  try {
    // 1) 가입 화면으로. 링크가 있으면 그것을, 없으면 흔한 경로를 시도한다.
    const origin = new URL(page.url()).origin;
    let onSignup = false;
    const links = await page
      .$$eval("a, button", (els) =>
        els.filter((e) => e.offsetParent !== null).map((e) => ({ text: (e.innerText || "").trim(), href: e.getAttribute("href") ?? "" })),
      )
      .catch(() => []);
    const entry = links.find((l) => SIGNUP_LINK.test(l.text) || SIGNUP_LINK.test(l.href));
    if (entry?.text) {
      const safety = classifyActionSafety(entry.text);
      if (!safety.safe) return fail("unsafe_action");
      plog(`signup:entry click "${entry.text.slice(0, 30)}"`);
      await page.getByText(entry.text, { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      onSignup = true;
    }
    if (!onSignup) {
      for (const p of SIGNUP_PATHS) {
        const r = await page.goto(origin + p, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null);
        if (r && r.status() < 400) {
          plog(`signup:entry path ${p}`);
          onSignup = true;
          break;
        }
      }
    }
    if (!onSignup) return fail("no_signup_form");
    await page.waitForTimeout(1200);

    // 2) 계획 — 캡차·결제 판단이 여기서 일어난다(순수 함수).
    const [fields, submitTexts, markup, text] = await Promise.all([
      collectSignupFields(page),
      collectSubmitTexts(page),
      page.content().catch(() => ""),
      page.evaluate(() => document.body.innerText || "").catch(() => ""),
    ]);
    const plan = planSignup({ runId, mailDomain, fields, submitTexts, pageMarkup: markup, pageText: text, locale });
    if (!plan.ok) {
      plog(`signup:blocked ${plan.blocker}`);
      return fail(plan.blocker);
    }

    // 3) 실행. 제출 버튼은 안전 분류를 한 번 더 통과해야 한다.
    for (const step of plan.steps) {
      if (step.action === "fill") {
        await page.locator(step.selectorHint).first().fill(step.value, { timeout: 8000 }).catch(() => {});
      } else if (step.action === "submit") {
        const safety = classifyActionSafety(step.targetText);
        if (!safety.safe) return fail("unsafe_action");
        plog(`signup:submit "${step.targetText.slice(0, 30)}"`);
        await page.getByText(step.targetText, { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
      }
    }

    // 4) 이미 로그인됐으면(메일 확인이 없는 앱) 여기서 끝.
    if (await looksLoggedIn(page)) {
      plog("signup:logged-in without mail");
      return { ok: true, email: plan.email, depth: "L3" };
    }

    // 5) 확인 메일을 기다렸다가 링크를 순서대로 열어본다.
    const emails = await waitForMail({ runId, callbackBaseUrl, internalToken, plog });
    if (emails.length === 0) return fail("verification_timeout");

    for (const url of rankVerificationLinks(emails).slice(0, 6)) {
      plog(`signup:open-link ${url.slice(0, 60)}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (await looksLoggedIn(page)) {
        plog("signup:logged-in after link");
        return { ok: true, email: plan.email, depth: "L3" };
      }
    }
    return fail("verification_timeout");
  } catch (err) {
    // ★절대 던지지 않는다 — 계정 준비 실패가 검수 전체를 깨뜨리면 있던 기능까지 잃는다.
    plog(`signup:error ${String(err?.message ?? err).slice(0, 120)}`);
    return fail("no_signup_form");
  }
}
