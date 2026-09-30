/**
 * B-7 호스팅 사업자 의무 — 라우터가 직접 그리는 작은 안내 페이지들(KO/EN, 순수 함수).
 *
 *  - 정지(410): 앱 주소에서. 소유자 정보·신고 내용·운영 메모는 **싣지 않는다**(누가 만들었는지, 누가 신고했는지
 *    드러내지 않는다). 사유는 두 갈래만: 규칙 위반 신고(관리자) / 요청 상한 초과 반복(자동).
 *  - 요청 상한(429): 앱 주소에서.
 *  - 신고 사이트·이용 규칙: `report.<root>`에서(유저 앱 origin과 분리 — route.ts 헤더 참고).
 *
 * 스크립트 없음. 폼은 평범한 HTML POST(`<API>/hosting/report`) — 자바스크립트가 꺼져 있어도 신고된다.
 * 카피는 비개발자 기준(tools/simsa-completion-loop-spike/lib/beginner-terms.mjs의 금칙어 0, 테스트로 고정).
 */
import { hostingReportUrl, hostingRulesUrl, isValidSlug, type SuspensionSource } from "./route.js";

export type Lang = "ko" | "en";

/** `?lang=` 우선, 없으면 Accept-Language 첫 언어가 ko일 때만 한국어. */
export function pickLang(url: URL, acceptLanguage: string | null): Lang {
  const q = url.searchParams.get("lang");
  if (q === "ko" || q === "en") return q;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("ko") ? "ko" : "en";
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 신고 사유 — central-plane SUSPENSION_REASONS와 같은 값·같은 순서(테스트가 대조). */
export const REPORT_REASON_VALUES = ["phishing", "spam", "adult", "malware", "illegal", "abuse_other"] as const;

export type ReportStatus = "sent" | "limit" | "invalid" | "unavailable" | null;

export function parseReportStatus(url: URL): ReportStatus {
  if (url.searchParams.get("sent") === "1") return "sent";
  const e = url.searchParams.get("error");
  return e === "limit" || e === "invalid" || e === "unavailable" ? e : null;
}

type Copy = {
  htmlLang: string;
  otherLangLabel: string;
  suspendedTitle: string;
  suspendedByReport: string;
  suspendedByTraffic: string;
  suspendedOwner: string;
  rulesLink: string;
  limitedTitle: string;
  limitedBody: string;
  reportTitle: string;
  reportIntro: string;
  reportAppLabel: string;
  reportReasonLegend: string;
  reasons: Record<(typeof REPORT_REASON_VALUES)[number], string>;
  reportDescriptionLabel: string;
  reportContactLabel: string;
  reportSubmit: string;
  reportPrivacy: string;
  statusSent: string;
  statusLimit: string;
  statusInvalid: string;
  statusUnavailable: string;
  rulesTitle: string;
  rulesIntro: string;
  rulesBanned: string[];
  rulesReportHeading: string;
  rulesReportBody: string;
  rulesReportLink: string;
  rulesSuspendHeading: string;
  rulesSuspendBody: string;
  rulesAppealHeading: string;
  rulesAppealBody: string;
  rulesAppealLink: string;
};

/** 문의처는 이용약관 한 곳에만 둔다(주소를 여기 복제하지 않는다). */
export const TERMS_URL = "https://app.trysimsa.com/legal/terms";

export const COPY: Record<Lang, Copy> = {
  ko: {
    htmlLang: "ko",
    otherLangLabel: "English",
    suspendedTitle: "이 앱은 지금 열 수 없어요",
    suspendedByReport: "이용 규칙 위반 신고가 확인되어 Simsa가 이 주소를 정지했어요.",
    suspendedByTraffic: "요청이 허용량을 계속 넘어서 Simsa가 이 주소를 잠시 정지했어요.",
    suspendedOwner: "이 앱을 만든 분이라면 Simsa에 문의해 주세요. 확인 후 문제가 없으면 다시 열어요.",
    rulesLink: "호스팅 이용 규칙 보기",
    limitedTitle: "잠시 후 다시 시도해 주세요",
    limitedBody: "지금 이 앱에 요청이 너무 많이 몰렸어요. 1분쯤 뒤에 다시 열어 주세요.",
    reportTitle: "앱 신고하기",
    reportIntro: "Simsa가 대신 올려 드린 앱에서 피싱·스팸·성인 콘텐츠·악성 프로그램·불법 콘텐츠를 보셨다면 알려 주세요. Simsa 운영자가 확인하고, 규칙 위반이면 주소를 정지해요.",
    reportAppLabel: "앱 주소",
    reportReasonLegend: "무엇이 문제인가요?",
    reasons: {
      phishing: "피싱 — 가짜 로그인·결제 화면으로 정보를 빼내요",
      spam: "스팸 — 원치 않는 광고나 메시지",
      adult: "성인 콘텐츠",
      malware: "악성 프로그램 — 위험한 파일을 받게 하거나 기기를 해쳐요",
      illegal: "불법 콘텐츠 — 법에 어긋나는 내용이나 거래",
      abuse_other: "그 밖의 악용",
    },
    reportDescriptionLabel: "무엇을 보셨나요? (선택, 1000자까지)",
    reportContactLabel: "답장을 받을 연락처 (선택)",
    reportSubmit: "신고 보내기",
    reportPrivacy: "IP 주소 원문은 저장하지 않아요. 같은 곳에서 신고가 몰리는 것을 막으려고 비밀 키로 바꾼 값만 남겨요. 연락처는 답장할 때만 써요.",
    statusSent: "신고가 접수됐어요. 운영자가 확인할게요.",
    statusLimit: "오늘 보낼 수 있는 신고 수를 넘었어요. 내일 다시 보내 주세요.",
    statusInvalid: "앱 주소와 문제 종류를 확인해 주세요. Simsa가 올려 드린 앱 주소만 여기서 신고할 수 있어요.",
    statusUnavailable: "지금은 신고를 받을 수 없어요. 잠시 후 다시 시도해 주세요.",
    rulesTitle: "Simsa 호스팅 이용 규칙",
    rulesIntro: "Simsa가 대신 올려 드린 앱에는 아래 내용을 올릴 수 없어요.",
    rulesBanned: [
      "피싱 — 다른 서비스인 척 로그인·결제 정보를 받는 화면",
      "스팸 — 원치 않는 광고·메시지를 대량으로 보내거나 퍼뜨리는 것",
      "성인 콘텐츠",
      "악성 프로그램 — 위험한 파일 배포, 기기·계정 공격",
      "불법 콘텐츠 — 법에 어긋나는 내용이나 거래, 남의 권리를 침해하는 것",
      "서비스를 망가뜨리는 사용 — 지나치게 많은 요청, 다른 사람이나 시스템 공격",
    ],
    rulesReportHeading: "신고",
    rulesReportBody: "문제가 있는 앱을 보셨다면 누구나 신고할 수 있어요.",
    rulesReportLink: "앱 신고하기",
    rulesSuspendHeading: "정지",
    rulesSuspendBody: "운영자가 신고를 확인해 규칙 위반이면 주소를 정지해요. 정지된 주소는 ‘열 수 없어요’ 안내만 보여요. 요청이 허용량을 계속 넘는 앱은 자동으로 잠시 정지될 수 있어요. 정지와 해제는 모두 기록으로 남아요.",
    rulesAppealHeading: "이의 제기",
    rulesAppealBody: "정지가 잘못됐다고 생각하면 이용약관에 적힌 문의처로 앱 주소와 함께 알려 주세요. 확인 후 문제가 없으면 다시 열어요.",
    rulesAppealLink: "이용약관 보기",
  },
  en: {
    htmlLang: "en",
    otherLangLabel: "한국어",
    suspendedTitle: "This app isn't available right now",
    suspendedByReport: "Simsa suspended this address after a report of a rules violation was confirmed.",
    suspendedByTraffic: "Simsa paused this address because it kept getting more requests than allowed.",
    suspendedOwner: "If you made this app, contact Simsa. If nothing is wrong after a review, we reopen it.",
    rulesLink: "Read the hosting rules",
    limitedTitle: "Please try again in a moment",
    limitedBody: "This app is getting more requests than it can take right now. Try again in about a minute.",
    reportTitle: "Report an app",
    reportIntro: "If an app Simsa put online for someone shows phishing, spam, adult content, malware or illegal content, let us know. A Simsa operator reviews it and suspends the address if it breaks the rules.",
    reportAppLabel: "App address",
    reportReasonLegend: "What is wrong?",
    reasons: {
      phishing: "Phishing — a fake sign-in or payment page that steals information",
      spam: "Spam — unwanted ads or messages",
      adult: "Adult content",
      malware: "Malware — pushes harmful downloads or attacks devices",
      illegal: "Illegal content — content or trade that breaks the law",
      abuse_other: "Other abuse",
    },
    reportDescriptionLabel: "What did you see? (optional, up to 1000 characters)",
    reportContactLabel: "Contact for a reply (optional)",
    reportSubmit: "Send report",
    reportPrivacy: "We don't store your IP address. To stop floods of reports we keep only a value transformed with a secret key. Your contact is used only to reply.",
    statusSent: "Thanks — your report was received. An operator will review it.",
    statusLimit: "You've reached today's report limit. Please try again tomorrow.",
    statusInvalid: "Check the app address and the problem type. Only addresses of apps Simsa put online can be reported here.",
    statusUnavailable: "Reports can't be received right now. Please try again later.",
    rulesTitle: "Simsa hosting rules",
    rulesIntro: "Apps that Simsa puts online for you must not contain any of the following.",
    rulesBanned: [
      "Phishing — pages that pretend to be another service to collect sign-in or payment details",
      "Spam — sending or spreading unwanted ads or messages in bulk",
      "Adult content",
      "Malware — distributing harmful files, attacking devices or accounts",
      "Illegal content — content or trade that breaks the law or someone else's rights",
      "Abusing the service — excessive requests, attacking other people or systems",
    ],
    rulesReportHeading: "Reporting",
    rulesReportBody: "Anyone who sees a problem app can report it.",
    rulesReportLink: "Report an app",
    rulesSuspendHeading: "Suspension",
    rulesSuspendBody: "An operator reviews each report and suspends the address if it breaks the rules. A suspended address only shows a “not available” notice. Apps that keep getting more requests than allowed may be paused automatically. Every suspension and reopening is recorded.",
    rulesAppealHeading: "Appeals",
    rulesAppealBody: "If you think a suspension is a mistake, write to the contact listed in the Terms with the app address. If nothing is wrong after a review, we reopen it.",
    rulesAppealLink: "Read the Terms",
  },
};

const STYLE =
  "body{margin:0;background:#faf8f3;color:#292524;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif}" +
  "main{max-width:36rem;margin:0 auto;padding:3rem 1rem}h1{font-size:1.4rem;margin:0 0 1rem;color:#1c1917}h2{font-size:1.05rem;margin:1.5rem 0 .25rem}" +
  "a{color:#5C111C}p.note{font-size:.85rem;color:#57534e}.status{padding:.75rem 1rem;border:1px solid #d6d3d1;border-radius:.5rem;background:#fff}" +
  "label{display:block;margin-top:1rem;font-weight:600}input[type=text],textarea{box-sizing:border-box;width:100%;margin-top:.25rem;padding:.5rem;border:1px solid #a8a29e;border-radius:.375rem;font:inherit;background:#fff}" +
  "fieldset{margin-top:1rem;border:1px solid #d6d3d1;border-radius:.5rem}fieldset label{font-weight:400;margin-top:.35rem}" +
  "button{margin-top:1.25rem;padding:.6rem 1.2rem;border:0;border-radius:.375rem;background:#5C111C;color:#fff;font:inherit;cursor:pointer}nav{margin-top:2rem;font-size:.85rem}";

/** 스크립트 0. 폼 전송처는 신고 페이지만 API origin으로 연다. */
function csp(formAction: string | null): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    `form-action ${formAction ?? "'none'"}`,
  ].join("; ");
}

function page(c: Copy, title: string, body: string): string {
  return `<!doctype html><html lang="${c.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function htmlResponse(status: number, html: string, extra: Record<string, string> = {}, formAction: string | null = null): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "content-security-policy": csp(formAction),
      "referrer-policy": "no-referrer",
      ...extra,
    },
  });
}

export function suspendedPage(lang: Lang, source: SuspensionSource, rootDomain: string): string {
  const c = COPY[lang];
  const reason = source === "auto" ? c.suspendedByTraffic : c.suspendedByReport;
  return page(
    c,
    c.suspendedTitle,
    `<h1>${escapeHtml(c.suspendedTitle)}</h1><p>${escapeHtml(reason)}</p><p>${escapeHtml(c.suspendedOwner)}</p>` +
      `<nav><a href="${escapeHtml(hostingRulesUrl(rootDomain))}?lang=${lang}">${escapeHtml(c.rulesLink)}</a></nav>`,
  );
}

export function rateLimitedPage(lang: Lang): string {
  const c = COPY[lang];
  return page(c, c.limitedTitle, `<h1>${escapeHtml(c.limitedTitle)}</h1><p>${escapeHtml(c.limitedBody)}</p>`);
}

function statusText(c: Copy, s: ReportStatus): string | null {
  switch (s) {
    case "sent":
      return c.statusSent;
    case "limit":
      return c.statusLimit;
    case "invalid":
      return c.statusInvalid;
    case "unavailable":
      return c.statusUnavailable;
    default:
      return null;
  }
}

/**
 * 신고 폼. `apiBase`가 없으면 폼 없이 "지금은 받을 수 없어요"만(503 — 받는 척하지 않는다).
 * `slug`는 isValidSlug를 통과한 것만 채운다(쿼리 값을 그대로 싣지 않는다).
 */
export function reportSitePage(args: { lang: Lang; slug: string | null; rootDomain: string; apiBase: string | null; status: ReportStatus }): string {
  const c = COPY[args.lang];
  const other: Lang = args.lang === "ko" ? "en" : "ko";
  const slug = args.slug && isValidSlug(args.slug) ? args.slug : null;
  const self = hostingReportUrl(slug ?? "", args.rootDomain);
  const sep = self.includes("?") ? "&" : "?";
  const msg = args.apiBase ? statusText(c, args.status) : c.statusUnavailable;
  let body = `<h1>${escapeHtml(c.reportTitle)}</h1><p>${escapeHtml(c.reportIntro)}</p>`;
  if (msg) body += `<p class="status" role="status">${escapeHtml(msg)}</p>`;
  if (args.apiBase) {
    const appValue = slug ? `https://${slug}.${args.rootDomain}` : "";
    const radios = REPORT_REASON_VALUES.map(
      (r, i) => `<label><input type="radio" name="reason" value="${r}"${i === 0 ? " required" : ""}> ${escapeHtml(c.reasons[r])}</label>`,
    ).join("");
    body +=
      `<form method="post" action="${escapeHtml(args.apiBase)}/hosting/report">` +
      `<input type="hidden" name="lang" value="${args.lang}">` +
      `<label>${escapeHtml(c.reportAppLabel)}<input type="text" name="app" required maxlength="300" value="${escapeHtml(appValue)}" placeholder="https://…"></label>` +
      `<fieldset><legend>${escapeHtml(c.reportReasonLegend)}</legend>${radios}</fieldset>` +
      `<label>${escapeHtml(c.reportDescriptionLabel)}<textarea name="description" rows="5" maxlength="1000"></textarea></label>` +
      `<label>${escapeHtml(c.reportContactLabel)}<input type="text" name="contact" maxlength="200" autocomplete="email"></label>` +
      `<button type="submit">${escapeHtml(c.reportSubmit)}</button></form>` +
      `<p class="note">${escapeHtml(c.reportPrivacy)}</p>`;
  }
  body +=
    `<nav><a href="${escapeHtml(hostingRulesUrl(args.rootDomain))}?lang=${args.lang}">${escapeHtml(c.rulesLink)}</a> · ` +
    `<a href="${escapeHtml(self)}${sep}lang=${other}">${escapeHtml(c.otherLangLabel)}</a></nav>`;
  return page(c, c.reportTitle, body);
}

export function rulesPage(lang: Lang, rootDomain: string): string {
  const c = COPY[lang];
  const other: Lang = lang === "ko" ? "en" : "ko";
  const report = hostingReportUrl("", rootDomain);
  return page(
    c,
    c.rulesTitle,
    `<h1>${escapeHtml(c.rulesTitle)}</h1><p>${escapeHtml(c.rulesIntro)}</p><ul>${c.rulesBanned.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` +
      `<h2>${escapeHtml(c.rulesReportHeading)}</h2><p>${escapeHtml(c.rulesReportBody)} <a href="${escapeHtml(report)}?lang=${lang}">${escapeHtml(c.rulesReportLink)}</a></p>` +
      `<h2>${escapeHtml(c.rulesSuspendHeading)}</h2><p>${escapeHtml(c.rulesSuspendBody)}</p>` +
      `<h2>${escapeHtml(c.rulesAppealHeading)}</h2><p>${escapeHtml(c.rulesAppealBody)} <a href="${TERMS_URL}">${escapeHtml(c.rulesAppealLink)}</a></p>` +
      `<nav><a href="${escapeHtml(hostingRulesUrl(rootDomain))}?lang=${other}">${escapeHtml(c.otherLangLabel)}</a></nav>`,
  );
}
