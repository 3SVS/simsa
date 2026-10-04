/**
 * nondev-report.ts — Simsa 비개발자용 검수 리포트 (EN/KO).
 *
 * Pure, deterministic. Turns the visual completion-check evidence (facts a real browser observed)
 * into a plain-language report a non-developer can read: what / why / how to fix. Developer-only
 * technical strings (e.g. ERR_NAME_NOT_RESOLVED) are kept in a separate `evidence` field, never in
 * the human-facing text. NO numeric score (Simsa policy §20). Absent evidence → "Not Verified".
 *
 * i18n (PRD §2 / audit B6): every user-facing string is localized EN + KO via a `locale` param
 * (default "ko" for backward compatibility). English users previously had no explanation layer.
 *
 * NO network / DB / env / LLM — same input always yields the same report.
 */

export type ReportLocale = "ko" | "en";

function loc(locale: ReportLocale | undefined): ReportLocale {
  return locale === "en" ? "en" : "ko";
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Normalized, tool-agnostic input for one visual completion check. */
export interface VisualCheckInput {
  targetUrl: string;
  intentAnchor: string;
  loadStatus: number | null;
  primaryActionFound: boolean;
  /** Did the flow actually interact (click/type)? */
  interacted: boolean;
  routeAfterClick: string | null;
  routeChanged: boolean;
  consoleErrors: string[];
  /** Network failures that matter — the app's own domain + its backend (Supabase,
   *  Firebase, any API it calls). Drives the "data didn't load" finding. */
  networkFailures: string[];
  /** Analytics/ads/fonts/telemetry failures — noise, shown only as an info note.
   *  Optional: old callers that don't split still work (no noise finding). */
  noiseFailures?: string[];
  /**
   * 검수를 막은 것들(계정 준비 단계 등). `app_gap`만 "고칠 것"으로 리포트에 오르고,
   * `app_choice`(캡차·유료 가입)·`our_limit`은 오르지 않는다 — signup-plan.ts가 분류한다.
   * 경계를 흐리면 남의 앱을 잘못 비난하게 된다.
   */
  blockerFindings?: Array<{
    kind: "app_gap" | "app_choice" | "our_limit";
    what?: string; why?: string; how?: string; unlocks?: string;
  }>;
  /** One of the spike's decision states, e.g. "Needs Fix" / "Needs Clarification". */
  decision: string;
  /** Optional per-step flow outcomes (label + whether the step visibly succeeded). */
  steps?: Array<{ label: string; ok: boolean; note?: string }>;
  /**
   * SI 티어 A5: 지시서의 수용 기준(AC)별 시나리오 결과. 없으면 종전(핵심 흐름 하나).
   * 어휘는 판정 사다리와 같은 입장 — `broken`은 실패 신호(네트워크·크래시)가 있을 때만,
   * 단계가 끝까지 못 간 것은 `not_confirmed`(확인 못 함)이지 고장이 아니다.
   */
  acceptanceResults?: AcceptanceResult[];
  /**
   * 2026-10-04 파일럿 사전 실측(H1): 첫 화면이 앱이 아니라 호스트의 "없음" 페이지였다(4xx 상태 또는 알려진
   * 배포 없음 문구). 로그인 벽(401/403/407)은 여기 들지 않는다.
   */
  pageNotFound?: boolean;
  /**
   * H2: 입력을 바꿔 두 번 돌렸는데 결과가 (거의) 같고 앱이 처리 요청을 하나도 보내지 않았다 — 껍데기 결과.
   * intentMentionsReview: 의도가 "검토/검사/진단" 같은 일을 하라고 적었는가(문구를 의도에 맞춘다, H3).
   */
  cannedResult?: { intentMentionsReview: boolean } | null;
  /** H4: 흐름 뒤 앱이 낸 결과가 화면 언어와 다른 언어로 나왔다(예: 한국어 앱에 중국어 결과). */
  outputLanguageMismatch?: { found: string; sample: string } | null;
  /** H5: 핵심 동작을 누르자 "API 키를 넣어 주세요"처럼 사용자 자격 증명을 요구하는 안내가 떴다. */
  needsUserCredential?: { sample: string } | null;
}

/** 수용 기준 하나의 시나리오 결과(컨테이너가 만들고 리포트가 그대로 싣는다). */
export interface AcceptanceResult {
  acceptanceId: string;
  featureTitle: string;
  then: string;
  status: "no_problem" | "not_confirmed" | "broken" | "not_run";
  /** 개발자용 원문(실패 단계·네트워크 원문). 사람 문장 아님. */
  note?: string;
}

/** One finding, written for a non-developer. `evidence` is the raw developer-only detail. */
export interface NonDevFinding {
  severity: "high" | "medium" | "low" | "info";
  what: string;
  why: string;
  how: string;
  evidence: string | null; // developer-only technical detail (not human prose)
  /**
   * 이걸 고치면 **다음 검수에서 무엇까지 확인해 드릴 수 있는지**(순환의 고리).
   * 고칠 이유가 우리 편의가 아니라 사용자의 이익이어야 실제로 고친다.
   */
  unlocks?: string;
  /**
   * C4a (재정렬 D-8 amend): 안정된 기계 코드 — 문장이 아니라 **분기의 이름**이다. 나라·도구·
   * 유형별 실패 지도는 이 코드로 집계한다(문장은 locale마다 다르고 바뀐다). 리포트 텍스트에는
   * 절대 노출하지 않는다. 옛 컨테이너 이미지가 만든 리포트에는 없다(optional).
   */
  code?: FindingCode;
}

/**
 * classifyFindings의 분기 이름. 추가는 되고, 이름 변경은 집계를 깨므로 하지 않는다.
 * 런타임 목록이 있어야 집계(/admin/moat-stats, C-4b)가 **닫힌 어휘**로만 내보낼 수 있다 — 콜백이 보낸
 * 모르는 문자열은 "other"로 접힌다(자유 텍스트가 집계 출력으로 새지 않게).
 */
export const FINDING_CODES = [
  "dns_unresolved",
  "network_5xx",
  "broken_route",
  "network_failed",
  "console_error",
  "noise_third_party",
  "no_primary_action",
  "step_failed",
  "ac_broken",
  "ac_not_confirmed",
  "signup_blocker",
  // 2026-10-04 파일럿 사전 실측(H1·H2·H4·H5)
  "page_not_found",
  "canned_result",
  "output_language_mismatch",
  "needs_user_credential",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

export interface NonDevReport {
  title: string;
  target: string;
  intent: string;
  verdict: string;
  oneLine: string;
  works: boolean | null; // true / false / null = not verified
  findings: NonDevFinding[];
  nextSteps: string[];
  notes: string[];
  /** SI 티어 A5: 수용 기준별 결과 요약(있을 때만). 개수이지 점수가 아니다. */
  acceptance?: {
    total: number;
    noProblem: number;
    notConfirmed: number;
    broken: number;
    notRun: number;
    items: AcceptanceResult[];
  };
  /**
   * C2b (재정렬 D-17 amend): Lovable/Bolt/v0/Replit 같은 **채팅형 빌더의 대화창에 그대로
   * 붙여넣는 한 덩어리** 고침 지시. 개발자 어휘 0(테스트로 고정). 서버 콜백이 리포트 locale로
   * 생성해 넣는다 — 컨테이너 이미지 재빌드 없이 배포되기 때문. 고칠 것이 없으면 없다.
   * (`agentPrompt`는 CLI 에이전트용으로 그대로 — 별도 저장 컬럼.)
   */
  builderPrompt?: string;
}

// ─── Decision labels ────────────────────────────────────────────────────────────

/** decision state → user-facing label, per locale. */
const DECISION_LABEL: Record<ReportLocale, Record<string, string>> = {
  ko: {
    Ready: "정상 작동해요",
    "Conditionally Ready": "문제를 찾지 못했어요",
    "Needs Fix": "작동 안 해요 — 고쳐야 해요",
    "Not Verified": "확인 못 했어요",
    "Needs Clarification": "무엇을 확인해야 할지 애매해요",
    "Needs Evidence": "판단할 근거가 부족해요",
    "Needs Expert Review": "전문가 확인이 필요해요",
    "User Acceptance Required": "직접 눈으로 확인이 필요해요",
    "Do Not Build Yet": "아직 만들 때가 아니에요",
    "Not Applicable": "해당 없음",
    "Not Judged": "판단하지 않았어요",
  },
  en: {
    Ready: "It works",
    "Conditionally Ready": "We could not find a problem",
    "Needs Fix": "It doesn't work — needs a fix",
    "Not Verified": "Couldn't verify",
    "Needs Clarification": "Unclear what to verify",
    "Needs Evidence": "Not enough evidence to judge",
    "Needs Expert Review": "Needs an expert's review",
    "User Acceptance Required": "You need to confirm it with your own eyes",
    "Do Not Build Yet": "Not ready to build yet",
    "Not Applicable": "Not applicable",
    "Not Judged": "Not judged",
  },
};

export function decisionLabel(decision: string, locale: ReportLocale = "ko"): string {
  const table = DECISION_LABEL[loc(locale)];
  return table[decision] ?? (loc(locale) === "en" ? "Couldn't verify" : "확인 못 했어요");
}

/** Backward-compatible Korean label helper (existing callers). */
export function decisionToKorean(decision: string): string {
  return decisionLabel(decision, "ko");
}

/** true=works, false=broken, null=not verified. */
export function decisionToWorks(decision: string): boolean | null {
  if (decision === "Ready") return true;
  if (decision === "Needs Fix") return false;
  return null;
}

// ─── Finding text (per locale) ───────────────────────────────────────────────────

type WWH = { what: string; why: string; how: string };

/**
 * Known analytics / ads / fonts / telemetry / social hosts — NOISE, not the
 * app's own data plane. A failure here (e.g. vercel-scripts.com 403 when a
 * headless browser is bot-blocked) says nothing about whether the app works, so
 * it must NOT drive the verdict. Live 2026-07-16: vercel.com was falsely called
 * "broken" because its analytics 403 + console noise were counted as defects.
 *
 * Crucially, the app's REAL backend (its own domain, or Supabase/Firebase/an
 * unknown API it fetches from) is NOT on this list and still counts — that's the
 * Potemkin signal we must keep catching.
 */
const NOISE_HOSTS =
  /(?:^|\.)(?:google-analytics|googletagmanager|googlesyndication|doubleclick|adservice|adsystem|segment|sentry|hotjar|mixpanel|amplitude|fullstory|logrocket|smartlook|mouseflow|intercom|drift|zendesk|cloudflareinsights|vercel-scripts|vercel-insights|newrelic|nr-data|datadoghq|bugsnag|clarity|facebook|fbcdn|twitter|linkedin|tiktok|snapchat|pinterest|hs-scripts|hsubspot|recaptcha|gstatic|fontawesome)\b|fonts\.(?:googleapis|gstatic)|\.(?:analytics|vitals)\b/i;

/**
 * Framework PREFETCH noise (2026-07-17 real-app eval R3): a Next.js RSC
 * prefetch (`?_rsc=…`) that fails — e.g. cross-origin redirect + CORS on the
 * `rsc` header — degrades to a normal full navigation for a real user; it
 * never breaks the flow. trysimsa.com (a working landing) was called
 * "작동 안 해요" on exactly this. Narrow class only: the `_rsc` marker.
 * A Potemkin backend call carries no `_rsc` and is still caught.
 */
const NOISE_PATHS = /[?&]_rsc=/i;

/** True when `url` is a known analytics/ads/fonts/telemetry host, or a
 *  framework prefetch request (i.e. noise). */
export function isNoiseResource(url: string | null | undefined): boolean {
  if (!url) return false;
  if (NOISE_PATHS.test(url)) return true;
  try {
    return NOISE_HOSTS.test(new URL(url).hostname);
  } catch {
    return NOISE_HOSTS.test(url);
  }
}

/** First http(s) URL in a raw network-failure log line, or null. */
export function extractUrl(s: string | null | undefined): string | null {
  const m = /(https?:\/\/[^\s)"']+)/i.exec(s ?? "");
  return m ? m[1]! : null;
}

const FIND: Record<ReportLocale, {
  dns: WWH;
  server5xx: WWH;
  brokenRoute: WWH;
  genericNet: WWH;
  consoleErr: WWH;
  noiseInfo: WWH;
  noPrimary: WWH;
  stepFailed: (label: string, note?: string) => WWH;
  acBroken: (featureTitle: string, then: string) => WWH;
  acNotConfirmed: (featureTitle: string, then: string) => WWH;
  pageNotFound: (status: number | null) => WWH;
  cannedResult: (intentMentionsReview: boolean) => WWH;
  outputLanguage: (found: string) => WWH;
  needsCredential: WWH;
}> = {
  ko: {
    dns: {
      what: "앱이 데이터를 가져오는 서버 주소를 찾지 못했어요.",
      why: "앱이 연결하려는 백엔드(데이터베이스/API) 주소가 살아있지 않거나 잘못 적혀 있어요. 그래서 목록·검색 결과 같은 실제 내용이 안 떠요.",
      how: "백엔드 주소(예: 데이터베이스 URL 환경변수)가 올바른지, 그 서비스가 켜져 있는지 확인하세요. 서비스가 꺼졌거나 삭제됐다면 다시 켜거나 새 주소로 바꿔야 해요.",
    },
    server5xx: {
      what: "서버가 오류를 돌려줬어요.",
      why: "백엔드 코드나 설정에 문제가 있어 요청을 제대로 처리하지 못했어요.",
      how: "서버 로그에서 어떤 요청이 500번대 오류를 냈는지 확인하고, 그 부분의 코드/설정을 고치세요.",
    },
    brokenRoute: {
      what: "버튼을 눌렀더니 깨진 화면으로 갔어요.",
      why: "그 버튼이 가리키는 이동 주소가 잘못됐어요.",
      how: "버튼의 링크(이동 주소)가 실제로 존재하는 화면을 가리키도록 고치세요.",
    },
    genericNet: {
      what: "필요한 데이터를 불러오지 못했어요.",
      why: "화면에 내용을 채우려는 데이터 요청이 실패했어요.",
      how: "실패한 요청의 주소·권한(키)·서버 상태를 확인하세요.",
    },
    consoleErr: {
      what: "화면에서 코드 오류가 났어요.",
      why: "자바스크립트 실행 중 문제가 생겼어요. 일부 기능이 안 될 수 있어요.",
      how: "브라우저 콘솔의 오류 메시지를 그대로 복사해 개발 도구(또는 이 리포트의 '개발자용' 칸)를 참고해 고치세요.",
    },
    noiseInfo: {
      what: "외부 스크립트 일부가 불러와지지 않았어요 (앱 자체 문제는 아니에요).",
      why: "광고·통계·폰트 같은 외부 서비스 요청이 실패했지만, 앱의 핵심 동작과는 무관해요. (자동 검수가 봇으로 차단됐을 때도 이렇게 보여요.)",
      how: "특별히 고칠 필요는 없어요. 신경 쓰이면 안 쓰는 외부 스크립트를 정리하세요.",
    },
    noPrimary: {
      what: "처음 화면에서 무엇을 눌러 시작해야 할지 못 찾았어요.",
      why: "의도한 핵심 동작(예: 시작하기, 검색)으로 이어지는 버튼이나 입력창이 눈에 띄지 않았어요.",
      how: "사용자가 가장 먼저 해야 할 행동(버튼·검색창)을 첫 화면에 크고 분명하게 배치하세요.",
    },
    stepFailed: (label, note) => ({
      what: `'${label}' 단계가 끝까지 되지 않았어요.`,
      why: note ? `이유: ${note}` : "그 단계에서 기대한 다음 화면/결과가 나타나지 않았어요.",
      how: "그 단계에서 무엇이 나와야 하는지 정하고, 눌렀을 때 그 결과가 실제로 뜨는지 확인하세요.",
    }),
    acBroken: (featureTitle, then) => ({
      what: `'${featureTitle}'이(가) 지시서대로 작동하지 않았어요.`,
      why: `기대한 결과("${then}")를 확인하는 동안 앱이 실패 신호(데이터 못 가져옴·오류)를 냈어요.`,
      how: "이 항목의 흐름을 직접 따라가 보고, 실패한 요청이나 오류부터 고친 뒤 다시 검수하세요.",
    }),
    acNotConfirmed: (featureTitle, then) => ({
      what: `'${featureTitle}'은(는) 이번 검수에서 끝까지 확인하지 못했어요.`,
      why: `기대한 결과("${then}")까지 가는 단계를 Simsa가 끝까지 밟지 못했어요. 고장이라는 뜻은 아니에요.`,
      how: "이 항목은 직접 눈으로 확인하시거나, 시작 버튼·입력창을 더 분명히 만든 뒤 다시 검수하세요.",
    }),
    pageNotFound: (status) => ({
      what: status ? `주소가 열리지 않아요(HTTP ${status}). 이 주소에는 지금 앱이 없어요.` : "주소가 열리지 않아요. 이 주소에는 지금 앱이 없어요.",
      why: "앱 대신 호스팅 서비스의 '없음' 안내 페이지가 떴어요. 배포가 지워졌거나, 아직 공개되지 않았거나, 주소가 잘못됐을 때 이렇게 돼요.",
      how: "앱을 만든 도구에서 '공개(Publish)'나 '배포'를 다시 하고, 새로 나온 주소가 브라우저에서 열리는지 확인한 뒤 그 주소로 다시 검수하세요.",
    }),
    cannedResult: (intentMentionsReview) => ({
      what: intentMentionsReview
        ? "결과가 입력과 무관해요 — 넣은 내용을 실제로 검토하지 않고, 정해 둔 결과를 보여주는 것 같아요."
        : "결과가 입력과 무관해요 — 넣은 내용을 실제로 처리하지 않고, 정해 둔 결과를 보여주는 것 같아요.",
      why: "서로 다른 내용을 넣고 두 번 해 봤는데 같은 결과가 나왔고, 그동안 앱이 처리를 위한 요청을 하나도 보내지 않았어요. 화면만 있고 실제 기능은 아직 연결되지 않은 상태로 보여요.",
      how: "결과를 만드는 부분이 실제 처리(서버·AI 호출 등)에 연결돼 있는지 확인하세요. 화면에 예시/데모 결과를 넣어 뒀다면 실제 결과로 바꿔야 해요.",
    }),
    outputLanguage: (found) => ({
      what: `결과가 화면과 다른 언어(${found})로 나왔어요.`,
      why: "화면은 한국어인데, 앱이 만든 결과 글은 다른 언어로 나왔어요. 사용자가 결과를 읽지 못할 수 있어요.",
      how: "결과를 만드는 부분(AI에게 주는 지시 등)에 '항상 한국어로 답하기'를 넣고, 여러 입력으로 다시 확인하세요.",
    }),
    needsCredential: {
      what: "이 앱은 시작하려면 사용자가 직접 API 키를 넣어야 해요 — 비개발자에게는 첫 단계에서 막혀요.",
      why: "핵심 버튼을 누르자 'API 키를 넣어 주세요' 같은 안내가 떴어요. 키를 만들고 넣는 방법을 모르는 사용자는 여기서 더 나아가지 못해요.",
      how: "운영하는 쪽 서버에 키를 두고 사용자는 키 없이 쓰게 하거나, 키가 꼭 필요하다면 키 받는 방법을 단계별로 안내하세요.",
    },
  },
  en: {
    dns: {
      what: "The app couldn't find the server address it fetches data from.",
      why: "The backend (database/API) address the app tries to reach is not live or is wrong, so real content like lists and search results never loads.",
      how: "Check that the backend address (e.g. the database URL environment variable) is correct and that the service is running. If the service was stopped or deleted, restart it or point to a new address.",
    },
    server5xx: {
      what: "The server returned an error.",
      why: "Something in the backend code or configuration failed to handle the request.",
      how: "Check the server logs to see which request returned a 500-range error, and fix that code or configuration.",
    },
    brokenRoute: {
      what: "Pressing the button led to a broken screen.",
      why: "The destination address that button points to is wrong.",
      how: "Fix the button's link so it points to a screen that actually exists.",
    },
    genericNet: {
      what: "The app couldn't load the data it needs.",
      why: "A data request meant to fill the screen with content failed.",
      how: "Check the failed request's address, permissions (keys), and the server's status.",
    },
    consoleErr: {
      what: "A code error occurred on the screen.",
      why: "Something went wrong while JavaScript was running. Some features may not work.",
      how: "Copy the error message from the browser console and fix it using your dev tool (or the 'for developers' section in this report).",
    },
    noiseInfo: {
      what: "Some external scripts didn't load (not a problem with your app).",
      why: "Requests to third-party services like ads, analytics, or fonts failed, but they're unrelated to your app's core behavior. (This also shows up when the automated review is bot-blocked.)",
      how: "No action needed. If it bothers you, remove third-party scripts you don't use.",
    },
    noPrimary: {
      what: "On the first screen, it wasn't clear what to press to get started.",
      why: "No obvious button or input led to the intended core action (e.g. start, search).",
      how: "Place the first action the user should take (a button or search box) large and clear on the first screen.",
    },
    stepFailed: (label, note) => ({
      what: `The '${label}' step didn't complete.`,
      why: note ? `Reason: ${note}` : "The expected next screen/result didn't appear at that step.",
      how: "Decide what should appear at that step, and confirm the result actually shows when pressed.",
    }),
    acBroken: (featureTitle, then) => ({
      what: `'${featureTitle}' did not work as the spec describes.`,
      why: `While checking the expected result ("${then}") the app produced failure signals (data not loading or errors).`,
      how: "Walk this item's flow yourself, fix the failed request or error first, then run the review again.",
    }),
    acNotConfirmed: (featureTitle, then) => ({
      what: `'${featureTitle}' could not be fully confirmed in this review.`,
      why: `Simsa could not complete the steps leading to the expected result ("${then}"). That does not mean it is broken.`,
      how: "Confirm this item with your own eyes, or make the starting button/input clearer and run the review again.",
    }),
    pageNotFound: (status) => ({
      what: status ? `The address doesn't open (HTTP ${status}). There is no app at this address right now.` : "The address doesn't open. There is no app at this address right now.",
      why: "Instead of the app, the hosting service's 'not found' page appeared. This happens when the deployment was removed, isn't public yet, or the address is wrong.",
      how: "Publish or deploy again from the tool you built the app with, check that the new address opens in a browser, then run the review with that address.",
    }),
    cannedResult: (intentMentionsReview) => ({
      what: intentMentionsReview
        ? "The result doesn't depend on what you enter — it seems to show a preset result instead of actually reviewing anything."
        : "The result doesn't depend on what you enter — it seems to show a preset result instead of actually processing the input.",
      why: "We tried twice with different inputs and got the same result, and the app sent no processing request in between. The screen exists but the real function doesn't seem to be connected yet.",
      how: "Check that the part producing the result is connected to real processing (a server or AI call). If a sample/demo result was put on the screen, replace it with the real one.",
    }),
    outputLanguage: (found) => ({
      what: `The result came out in a different language (${found}) than the screen.`,
      why: "The screen is in one language but the result text the app produced is in another, so users may not be able to read it.",
      how: "Tell the part that produces the result (e.g. the AI instructions) to always answer in the screen's language, then check again with several inputs.",
    }),
    needsCredential: {
      what: "To start, this app asks users to paste their own API key — non-developers get stuck at the first step.",
      why: "Pressing the main button showed a message like 'enter your API key'. Users who don't know how to get and paste a key can't go any further.",
      how: "Keep the key on your own server so users don't need one, or, if a key is truly required, walk users through getting it step by step.",
    },
  },
};

// ─── 2026-10-04 파일럿 사전 실측 — 결정론 신호(컨테이너가 쓰고, 여기서 단위 테스트) ─────────────

/** 401/403/407 = 로그인·권한 벽일 수 있다(앱은 있다). 나머지 4xx는 "앱이 없다". */
export function isLoginWallStatus(status: number | null | undefined): boolean {
  return status === 401 || status === 403 || status === 407;
}

/** 호스트가 앱 대신 내보내는 "배포 없음" 페이지 문구(200으로 오는 경우 대비). 짧은 페이지에서만 본다. */
const HOST_NOT_FOUND_RE =
  /DEPLOYMENT_NOT_FOUND|NOT_FOUND\s*Code:|There isn['’]t a GitHub Pages site here|Page not found\s*[·|-]?\s*Netlify|Looks like you['’]ve followed a broken link or entered a URL that doesn['’]t exist on this site|This deployment (?:is|was) (?:paused|deleted|not found)|Site Not Found\s+Why am I seeing this page/i;
export function looksLikeHostNotFoundPage(bodyText: string | null | undefined): boolean {
  const t = (bodyText ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 1200) return false; // 긴 페이지(진짜 앱)가 문서에서 이 문구를 언급하는 경우를 피한다
  return HOST_NOT_FOUND_RE.test(t);
}

/** 비교용 토큰(한글 덩어리·영숫자 2자 이상). 소문자. */
export function textTokens(s: string | null | undefined): string[] {
  return (s ?? "").toLowerCase().match(/[가-힣]+|[\p{L}\p{N}]{2,}/gu) ?? [];
}

/** 동작 뒤 화면에 새로 나타난 토큰 — 처음 화면에 있던 것과 내가 넣은 값의 토큰은 뺀다. */
export function addedTokens(before: string, after: string, typed: string): Set<string> {
  const b = new Set(textTokens(before));
  const v = new Set(textTokens(typed));
  return new Set(textTokens(after).filter((x) => !b.has(x) && !v.has(x)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 고정 결과로 볼 최소 결과 크기 — 할 일 앱처럼 "삭제" 한 단어만 붙는 흐름을 껍데기로 오판하지 않게. */
export const CANNED_MIN_TOKENS = 8;
export const CANNED_MIN_SIMILARITY = 0.9;

/**
 * H2: 두 입력의 결과가 (거의) 같고, 두 번 모두 처리 요청이 0이면 껍데기다.
 * 요청이 하나라도 있었다면(저장·API) 판단하지 않는다 — 진짜 처리일 수 있다(F11·Bolt는 이 이유로 못 잡는다).
 */
export function isCannedResult(i: { added1: Set<string>; added2: Set<string>; requests1: number; requests2: number }): boolean {
  if (i.requests1 > 0 || i.requests2 > 0) return false;
  if (i.added1.size < CANNED_MIN_TOKENS || i.added2.size < CANNED_MIN_TOKENS) return false;
  return jaccard(i.added1, i.added2) >= CANNED_MIN_SIMILARITY;
}

/** 두 번째 시도에 넣을 다른 값 — 같은 종류(주소·숫자·글)로, 결과가 달라질 만큼 다르게. */
export function variantTypedValue(v: string): string {
  const t = (v ?? "").trim();
  if (/^https?:\/\//i.test(t)) return /example\.org/i.test(t) ? "https://example.com/" : "https://example.org/";
  if (/^-?\d+(\.\d+)?$/.test(t)) return String(Number(t) + 7);
  if (t === "서울") return "부산";
  if (t === "Seoul") return "Busan";
  return `${t} 두번째`;
}

/** 의도가 "검토·검사·진단·분석·점검" 같은 일을 하라고 하는가(H3 — 껍데기 문구를 의도에 맞춘다). */
export function intentMentionsReview(intent: string | null | undefined): boolean {
  return /검토|검사|진단|분석|점검|심사|review|inspect|audit|diagnos|analy[sz]|check/i.test(intent ?? "");
}

/**
 * H4: 화면이 한국어인데 결과(동작 뒤 새로 나온 글)가 주로 한자(중국어)나 가나(일본어)면 언어 불일치.
 * 한국어 글에 섞인 한자 몇 개로는 걸리지 않는다(결과 쪽 한자+가나 ≥ 20 그리고 한글보다 많을 때만).
 */
export function detectOutputLanguageMismatch(uiText: string, resultText: string): { found: string; sample: string } | null {
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  const uiHangul = count(uiText ?? "", /[가-힣]/g);
  const uiLatin = count(uiText ?? "", /[A-Za-z]/g);
  if (uiHangul < 20 || uiHangul < uiLatin) return null; // 한국어 화면에서만 판단
  const r = resultText ?? "";
  const hangul = count(r, /[가-힣]/g);
  const kana = count(r, /[\u3040-\u30ff]/g);
  const han = count(r, /[\u4e00-\u9fff]/g);
  if (han + kana < 20 || han + kana <= hangul) return null;
  const found = kana > han / 3 ? "일본어" : "중국어";
  const m = /[\u3040-\u30ff\u4e00-\u9fff][^\n]{0,80}/.exec(r);
  return { found, sample: (m ? m[0] : r).slice(0, 120) };
}

/**
 * H5: 동작 뒤 새로 나온 글이 사용자에게 API 키·토큰·시크릿을 넣으라고 요구하는가. 키 이름과 요구 동사가 함께 있어야 한다
 * (설명 문구에 "API 키는 저장되지 않아요"만 있는 경우와 가른다).
 */
const CREDENTIAL_NOUN_RE = /(API\s*키|API\s*key|액세스\s*토큰|access\s*token|토큰|시크릿\s*키|secret\s*key|개인\s*키|sk-[a-z]{2,})/i;
const CREDENTIAL_ASK_RE = /(넣어\s*주세요|입력해\s*주세요|입력하세요|넣으세요|등록해\s*주세요|필요합니다|필요해요|먼저\s|please\s+(?:enter|add|provide|paste)|enter\s+your|add\s+your|is\s+required|required\s+to)/i;
export function detectCredentialGate(addedText: string | null | undefined): { sample: string } | null {
  const t = (addedText ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // 같은 문장 안(마침표·줄 사이 160자 안쪽)에 키 이름과 요구 동사가 함께 있어야 한다.
  for (const sentence of t.split(/(?<=[.!?。])\s+|(?<=요\.)\s*/)) {
    if (CREDENTIAL_NOUN_RE.test(sentence) && CREDENTIAL_ASK_RE.test(sentence)) return { sample: sentence.slice(0, 160) };
  }
  return null;
}

/** Evidence the decision ladder reads (a subset of what the inspector gathers). */
export interface DecisionEvidence {
  loadStatus: number | null;
  /** NOISE-FILTERED network failures — app domain + backend only (never analytics). */
  networkFailures: string[];
  interacted: boolean;
  routeAfterClick: string | null;
  primaryActionFound: boolean;
  /** D9 (2026-07-17): did the driven action visibly change anything (body text
   *  or route)? null/undefined = not measured (older callers stay valid). */
  visibleChangeAfterAction?: boolean | null;
  /**
   * 어느 깊이까지 봤는가 (2026-09-01). "L1"=공개 화면만, "L3"=로그인 뒤까지.
   * 확언("작동해요")은 L3 + 재로그인 왕복이 함께 확인됐을 때만 나온다.
   */
  loginDepth?: "L1" | "L3" | null;
  /** D9: console error count — NEVER a verdict driver alone (noise lesson);
   *  only its CONJUNCTION with a dead action is a crash signal. */
  consoleErrorCount?: number;
  /** G4-① (2026-07-18): 입력으로 만든 내용이 새로고침 후에도 남았는가.
   *  null/undefined = 측정 불가·비적용(판정 무영향). false = 낙관적 UI만 있고
   *  저장이 없는 앱 — 측정된 false만 신호다. */
  persistedAfterReload?: boolean | null;
  /** H1 (2026-10-04): 알려진 호스트 "배포 없음" 페이지(상태가 200이어도). */
  pageNotFound?: boolean | null;
  /** H2 (2026-10-04): 입력 무관 고정 결과 + 처리 요청 0. 측정된 true만 신호. */
  cannedResult?: boolean | null;
  /** H4 (2026-10-04): 결과 언어가 화면 언어와 다르다 — 고장 판정이 아니라 "사람 확인"으로 낮춘다. */
  outputLanguageMismatch?: boolean | null;
  /** H5 (2026-10-04): 시작하려면 사용자가 직접 API 키 등을 넣어야 한다 — 고장이 아니라 "사람 확인"(비개발자 막힘). */
  needsUserCredential?: boolean | null;
}

/**
 * Deterministic verdict from the deep-flow evidence. Lives here (not in the
 * container's inspector-run.mjs) so it's unit-testable and can't drift from the
 * finding logic it must agree with.
 *
 * P0-B (2026-07-16): driven by REAL failure signals only. `networkFailures` is
 * already noise-filtered, so a remaining failure is the app's own domain or its
 * backend (Supabase/Firebase/an API) — the Potemkin signal, which still fails.
 * Console errors do NOT force a fail (they fire constantly on healthy sites from
 * third-party scripts). A step that couldn't complete WITH no backend failure is
 * "couldn't confirm", not "broken" — a complex SPA's click timeout is an
 * inspector limitation, so we ask a human rather than false-fail (the vercel.com
 * false-negative).
 */
export function decideFromEvidence(
  e: DecisionEvidence,
  steps: Array<{ ok: boolean }>,
): string {
  if (e.loadStatus && e.loadStatus >= 500) return "Needs Fix";
  // H1 (2026-10-04 파일럿 v0): 401/403/407만 "로그인 벽일 수 있다"로 판단을 보류한다. 404·410 등 나머지 4xx는
  // **앱이 없다**는 뜻이다 — 종전엔 전부 Not Verified("확인 못 했어요")였고, 러너는 그 오류 안내 페이지의
  // 문서 버튼을 앱처럼 눌렀다.
  if (e.loadStatus && e.loadStatus >= 400) return isLoginWallStatus(e.loadStatus) ? "Not Verified" : "Needs Fix";
  if (e.pageNotFound === true) return "Needs Fix";
  if (e.networkFailures.length) return "Needs Fix";
  // H2 (2026-10-04 파일럿 ChatGPT 앱): 입력을 바꿔도 같은 결과 + 처리 요청 0 = 껍데기. 흐름은 "끝까지 됐다"로
  // 보이고 실패 신호도 없어서 종전엔 "문제를 찾지 못했어요"(정반대 오판)였다.
  if (e.interacted && e.cannedResult === true) return "Needs Fix";
  if (e.interacted && e.routeAfterClick && /\/undefined|\/null|\/404|not-found|error/i.test(e.routeAfterClick)) return "Needs Fix";
  // D9 (2026-07-17 accuracy eval): an action that visibly changed NOTHING plus a
  // console error is a crashed app (the handler never bound — dead button), not
  // an inspector limitation. The CONJUNCTION is the signal: a console error
  // alone stays non-fatal (healthy sites are noisy — the vercel.com lesson), and
  // a no-change action alone stays "couldn't confirm" (subtle UIs exist).
  if (e.interacted && e.visibleChangeAfterAction === false && (e.consoleErrorCount ?? 0) > 0) return "Needs Fix";
  // G4-① (2026-07-18): 화면은 바뀌었는데(항목이 추가된 것처럼 보였는데) 새로고침
  // 후 입력한 내용이 사라졌다 — 낙관적 UI만 있고 저장이 없는 앱(Potemkin의 마지막
  // 형태). 측정된 false만 신호: null/undefined(비적용·측정 실패)는 판정 무영향,
  // localStorage 저장 앱은 새로고침을 살아남으므로 여기 걸리지 않는다.
  if (e.interacted && e.visibleChangeAfterAction === true && e.persistedAfterReload === false) return "Needs Fix";
  if (steps.some((s) => !s.ok)) return e.interacted ? "User Acceptance Required" : "Needs Clarification";
  if (!e.primaryActionFound) return "Needs Clarification";
  // H4 (2026-10-04 파일럿 Lovable): 결과가 화면과 다른 언어로 나왔다 — 고장이라 단정하지 않되(입력에 따라
  // 간헐), "문제를 찾지 못했어요"라고 침묵하지도 않는다.
  if (e.interacted && e.outputLanguageMismatch === true) return "User Acceptance Required";
  // H5 (2026-10-04 파일럿 Claude 앱): 시작 버튼이 "API 키를 넣어 주세요"를 띄웠다 — 앱이 고장 난 것은 아니지만
  // 비개발자는 첫 단계에서 막힌다. "문제를 찾지 못했어요"로 넘기지 않는다.
  if (e.interacted && e.needsUserCredential === true) return "User Acceptance Required";
  // ★2026-08-26 (Bae 결정 ②) — 여기가 **성공 경로**다: 모든 스텝이 끝까지 갔고,
  //  주요 동작을 찾았고, 실제로 눌러봤고, 위의 어떤 결함 신호에도 걸리지 않았다.
  //
  //  그런데 종전엔 이 자리도 "직접 눈으로 확인이 필요해요"(UAR)였다. 즉 **이 시스템은
  //  구조적으로 어떤 긍정 판정도 내리지 못했다** — `"Ready"`를 반환하는 코드가 최초
  //  버전(#347)부터 아예 없었고, `works=true`의 유일한 조건이 그것이었다. 7월 정확도
  //  평가에서 작동 픽스처가 계속 "판단보류"로 나온 원인이 이것인데, 그동안 모델과
  //  프롬프트를 의심했다.
  //
  //  근거를 다 모아놓고 아무 말도 하지 않는 것은 정직이 아니라 회피에 가깝다.
  //  그렇다고 "작동해요"를 확언할 수는 없다 — 우리는 **로그인 뒤를 보지 못하고**,
  //  본 것도 한 흐름뿐이다. 그래서 확언과 침묵 사이의 정직한 자리를 쓴다:
  //  **"문제를 찾지 못했어요"**(Conditionally Ready). `works`는 여전히 null이다
  //  — 우리가 확인한 범위를 넘어서는 주장을 하지 않는다.
  //
  //  ★그리고 그 "더 강한 판정"이 아래다 (2026-09-01).
  //
  //  **로그인 뒤 왕복까지 확인했으면 확언한다.** 만들고 → 로그아웃하고 → 다시
  //  로그인해서 → 그게 아직 있었다면, 그건 추측이 아니라 **증명**이다. 낙관적 UI로는
  //  절대 통과할 수 없는 검사이기 때문이다(화면만 바뀌는 앱은 재로그인에서 사라진다).
  //
  //  이 조합에서만 works=true가 된다: 위의 모든 결함 신호에 걸리지 않았고 · 모든 스텝을
  //  완주했고 · 주요 동작을 찾았고 · 실제로 눌렀고 · **로그인 뒤까지 들어갔고** ·
  //  **재로그인 후에도 데이터가 남았다.**
  //
  //  하나라도 빠지면 확언하지 않는다 — 우리가 확인한 범위를 넘어서는 주장은 하지 않는다.
  if (e.interacted && e.loginDepth === "L3" && e.persistedAfterReload === true) return "Ready";
  if (e.interacted) return "Conditionally Ready";
  return "Not Verified";
}

/**
 * 원시 증거(콘솔/네트워크 문자열, 상태코드, 라우트)를 비개발자용 finding 들로 번역.
 * 각 finding 은 what/why/how 를 평범한 언어로 담고, 원본 기술 문자열은 evidence 에만 둔다.
 */
export function classifyFindings(input: VisualCheckInput, locale: ReportLocale = "ko"): NonDevFinding[] {
  const t = FIND[loc(locale)];
  const findings: NonDevFinding[] = [];
  const netText = input.networkFailures.join(" ");
  const conText = input.consoleErrors.join(" ");

  // H1 (2026-10-04): 앱 대신 호스트의 "없음" 페이지가 떴다 — 다른 무엇보다 먼저, 가장 높게.
  const notFoundStatus =
    input.loadStatus && input.loadStatus >= 400 && input.loadStatus < 500 && !isLoginWallStatus(input.loadStatus)
      ? input.loadStatus
      : null;
  if (notFoundStatus !== null || input.pageNotFound === true) {
    findings.push({
      severity: "high",
      code: "page_not_found",
      ...t.pageNotFound(notFoundStatus),
      evidence: notFoundStatus ? `HTTP ${notFoundStatus}` : "host not-found page",
    });
  }
  if (input.cannedResult) {
    findings.push({
      severity: "high",
      code: "canned_result",
      ...t.cannedResult(input.cannedResult.intentMentionsReview),
      evidence: "same result for two different inputs; 0 processing requests",
    });
  }
  if (input.needsUserCredential) {
    findings.push({
      severity: "medium",
      code: "needs_user_credential",
      ...t.needsCredential,
      evidence: input.needsUserCredential.sample,
    });
  }
  if (input.outputLanguageMismatch) {
    findings.push({
      severity: "medium",
      code: "output_language_mismatch",
      ...t.outputLanguage(input.outputLanguageMismatch.found),
      evidence: input.outputLanguageMismatch.sample,
    });
  }

  // C4a: 각 분기는 안정 코드(`code`)를 함께 싣는다 — 문장은 바뀌어도 코드는 남아 집계 축이 된다.
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(netText + " " + conText)) {
    findings.push({
      severity: "high",
      code: "dns_unresolved",
      ...t.dns,
      evidence: firstMatch(input.networkFailures, /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i) ?? firstMatch(input.consoleErrors, /ERR_NAME_NOT_RESOLVED/i),
    });
  }

  if (/\bHTTP 5\d\d\b|status 5\d\d/i.test(netText)) {
    findings.push({ severity: "high", code: "network_5xx", ...t.server5xx, evidence: firstMatch(input.networkFailures, /5\d\d/) });
  }

  if (input.interacted && input.routeAfterClick && /\/undefined|\/null|\/404|not-found|error/i.test(input.routeAfterClick)) {
    findings.push({ severity: "high", code: "broken_route", ...t.brokenRoute, evidence: input.routeAfterClick });
  }

  if (input.networkFailures.length > 0 && !/ERR_NAME_NOT_RESOLVED|5\d\d/i.test(netText)) {
    findings.push({ severity: "high", code: "network_failed", ...t.genericNet, evidence: input.networkFailures[0] ?? null });
  }

  // Console errors are noisy and hard to attribute (third-party scripts throw
  // constantly on healthy sites), so they're INFORMATIONAL only — they never
  // drive the verdict (see decideFromEvidence) and are low severity here.
  // H1: 앱이 없는 주소의 "없음" 페이지에서 난 콘솔 오류(리소스 404 등)와 "무엇을 눌러야 할지"는 앱의 문제가 아니다 —
  // page_not_found 하나로 말한다.
  const appMissing = notFoundStatus !== null || input.pageNotFound === true;
  if (!appMissing && input.consoleErrors.length > 0 && !/ERR_NAME_NOT_RESOLVED/i.test(conText)) {
    findings.push({ severity: "low", code: "console_error", ...t.consoleErr, evidence: input.consoleErrors[0] ?? null });
  }

  // Noise (analytics/ads/fonts) failed — say so honestly, but as info, so the
  // user isn't alarmed by a "broken" reading that's really a blocked tracker.
  if ((input.noiseFailures?.length ?? 0) > 0) {
    findings.push({ severity: "info", code: "noise_third_party", ...t.noiseInfo, evidence: input.noiseFailures![0] ?? null });
  }

  if (!appMissing && !input.primaryActionFound && !input.interacted) {
    findings.push({ severity: "medium", code: "no_primary_action", ...t.noPrimary, evidence: null });
  }

  for (const s of input.steps ?? []) {
    if (!s.ok) {
      findings.push({ severity: "medium", code: "step_failed", ...t.stepFailed(s.label, s.note), evidence: s.note ?? null });
    }
  }

  // SI 티어 A5: 수용 기준별 결과. broken은 high(실패 신호가 있었다), not_confirmed는
  // medium(확인 못 함 — 고장 아님). no_problem/not_run은 finding이 아니라 요약에만 오른다.
  for (const a of input.acceptanceResults ?? []) {
    if (a.status === "broken") {
      findings.push({ severity: "high", code: "ac_broken", ...t.acBroken(a.featureTitle, a.then), evidence: a.note ?? null });
    } else if (a.status === "not_confirmed") {
      findings.push({ severity: "medium", code: "ac_not_confirmed", ...t.acNotConfirmed(a.featureTitle, a.then), evidence: a.note ?? null });
    }
  }

  return findings;
}

function firstMatch(arr: string[], re: RegExp): string | null {
  for (const s of arr) if (re.test(s)) return s;
  return null;
}

// ─── Report assembly (per locale) ────────────────────────────────────────────────

const REPORT_STR: Record<ReportLocale, {
  title: string;
  oneLineWorks: string;
  /** ② 성공 경로 — 확언하지도, 침묵하지도 않는 자리. */
  oneLineNoProblems: string;
  oneLineBroken: (firstWhat: string) => string;
  oneLineUnverified: (firstWhat: string) => string;
  nextTop: (how: string) => string;
  nextNoPrimary: string;
  nextRerun: string;
  /** 고칠 것이 없을 때(정상 작동·문제 못 찾음 + 정보 항목만)의 다음 할 일. '고친 뒤 다시'를 말하지 않는다. */
  nextNothingToFix: string;
  notes: string[];
  /** SI 티어 A5: 수용 기준 요약 한 줄(개수만). */
  acceptanceLine: (c: { total: number; noProblem: number; notConfirmed: number; broken: number; notRun: number }) => string;
}> = {
  ko: {
    title: "Simsa 검수 리포트",
    acceptanceLine: (c) =>
      `지시서의 확인 항목 ${c.total}개 중 문제 없음 ${c.noProblem} · 확인 못 함 ${c.notConfirmed} · 작동 안 함 ${c.broken}` +
      (c.notRun ? ` · 시간 부족으로 못 본 것 ${c.notRun}` : "") + ".",
    oneLineWorks: "핵심 흐름이 눈으로 확인한 범위에서 정상 동작했어요.",
    oneLineNoProblems:
      "핵심 흐름을 따라가 봤는데 문제를 찾지 못했어요. 다만 로그인 뒤 화면은 확인하지 않았습니다.",
    oneLineBroken: (w) => `핵심 흐름이 지금은 작동하지 않아요. ${w}`.trim(),
    oneLineUnverified: (w) => `아직 '작동한다'고 확정하기엔 확인이 더 필요해요. ${w}`.trim(),
    nextTop: (how) => `가장 급한 것부터: ${how}`,
    nextNoPrimary: "사용자가 처음에 눌러야 할 버튼/검색창을 분명히 만든 뒤 다시 검수하세요.",
    nextRerun: "고친 뒤 이 검수를 한 번 더 돌려서, 아래 스크린샷이 정상 화면으로 바뀌는지 눈으로 확인하세요.",
    nextNothingToFix:
      "지금 고칠 것은 없어요. 앱이 생각과 다르게 움직이는 부분이 있다면 알려 주세요 — 그 부분을 기준으로 다시 확인해 드려요.",
    notes: [
      "이 검수는 실제 브라우저로 앱을 열어 눈에 보이는 것을 확인한 결과예요. 모든 버그를 찾았다는 뜻은 아니에요.",
      "'무엇이/왜/어떻게'는 사람이 읽기 쉬운 설명이고, 정확한 기술 원인은 각 항목의 '개발자용' 정보에 있어요.",
      "화면 스크린샷을 함께 보면 어디서 막혔는지 눈으로 바로 알 수 있어요.",
    ],
  },
  en: {
    title: "Simsa Review Report",
    acceptanceLine: (c) =>
      `Of ${c.total} spec items: ${c.noProblem} no problem · ${c.notConfirmed} not confirmed · ${c.broken} not working` +
      (c.notRun ? ` · ${c.notRun} not reached in time` : "") + ".",
    oneLineWorks: "The core flow worked correctly within what we could observe.",
    oneLineNoProblems:
      "We followed the core flow and could not find a problem. Anything behind a login was not checked.",
    oneLineBroken: (w) => `The core flow doesn't work right now. ${w}`.trim(),
    oneLineUnverified: (w) => `More checking is needed before we can confirm it "works". ${w}`.trim(),
    nextTop: (how) => `Most urgent first: ${how}`,
    nextNoPrimary: "Make the first button/search box the user should press clear, then run the review again.",
    nextRerun: "After fixing, run this review once more and confirm with your own eyes that the screenshots below turn into a working screen.",
    nextNothingToFix:
      "Nothing needs fixing right now. If the app behaves differently from what you expected, tell us — we'll check again against that.",
    notes: [
      "This review opened the app in a real browser and checked what was visible. It does not mean every bug was found.",
      "The what/why/how is a plain-language explanation; the exact technical cause is in each item's 'for developers' detail.",
      "Looking at the screenshots makes it immediately obvious where things got stuck.",
    ],
  },
};

/** 비개발자용 리포트 조립. 결정론적, 절대 throw 안 함. 숫자 점수 없음. */
export function buildNonDevReport(input: VisualCheckInput, locale: ReportLocale = "ko"): NonDevReport {
  const L = loc(locale);
  const s = REPORT_STR[L];
  const findings = classifyFindings(input, L);

  // ★검수를 막은 것이 앱의 누락이면 **고칠 것**으로 올린다 (2026-09-01, Bae 제안).
  //
  //  검수를 막는 것 대부분은 실사용자도 겪는 문제다 — 가입이 안 되면 우리만 못
  //  들어가는 게 아니라 손님도 못 들어간다. 다만 **캡차·유료 가입은 결함이 아니므로**
  //  여기 올라오지 않는다(분류는 signup-plan.ts가 한다). 그 경계를 흐리면 남의 앱을
  //  잘못 비난하게 된다.
  for (const b of input.blockerFindings ?? []) {
    if (b.kind !== "app_gap" || !b.what) continue;
    findings.push({
      severity: "medium",
      code: "signup_blocker",
      what: b.what,
      why: b.why ?? "",
      how: b.how ?? "",
      evidence: null,
      // 순환의 고리 — 고치면 다음 검수에서 무엇까지 확인되는지.
      ...(b.unlocks ? { unlocks: b.unlocks } : {}),
    });
  }
  const works = decisionToWorks(input.decision);
  const verdict = decisionLabel(input.decision, L);

  const firstWhat = findings[0]?.what ?? "";
  // ② "문제를 찾지 못했어요"는 실패가 아니다 — 종전 문구("확인이 더 필요해요")를
  //    그대로 쓰면 성공 경로가 실패처럼 읽힌다. 판정과 문구를 같이 옮긴다.
  const noProblems = input.decision === "Conditionally Ready";
  const oneLine =
    works === true
      ? s.oneLineWorks
      : works === false
        ? s.oneLineBroken(firstWhat)
        : noProblems
          ? s.oneLineNoProblems
          : s.oneLineUnverified(firstWhat);

  // 다음 할 일 (2026-09-28 실측 수정): '가장 급한 것'과 '고친 뒤 다시'는 **고칠 것**이 있을 때만.
  //  정보 항목(외부 스크립트 잡음 등, severity "info")은 고칠 것이 아니다 — 종전엔 "문제를 찾지 못했어요"
  //  판정 아래에 "가장 급한 것부터: 특별히 고칠 필요는 없어요"와 "고친 뒤 다시 돌려서…"가 함께 떴다.
  const actionable = findings.filter((f) => f.severity !== "info");
  const nextSteps: string[] = [];
  if (actionable[0]) nextSteps.push(s.nextTop(actionable[0].how));
  if (works === null && !noProblems && input.primaryActionFound === false) nextSteps.push(s.nextNoPrimary);
  const somethingToFix = actionable.length > 0 || works === false || (works === null && !noProblems);
  nextSteps.push(somethingToFix ? s.nextRerun : s.nextNothingToFix);

  // SI 티어 A5: 수용 기준 요약 — 있을 때만. 개수뿐이고 점수가 아니다.
  const ar = input.acceptanceResults ?? [];
  const acceptance =
    ar.length > 0
      ? {
          total: ar.length,
          noProblem: ar.filter((a) => a.status === "no_problem").length,
          notConfirmed: ar.filter((a) => a.status === "not_confirmed").length,
          broken: ar.filter((a) => a.status === "broken").length,
          notRun: ar.filter((a) => a.status === "not_run").length,
          items: ar,
        }
      : undefined;
  const notes = acceptance ? [s.acceptanceLine(acceptance), ...s.notes] : s.notes;

  return {
    title: s.title,
    target: input.targetUrl,
    intent: input.intentAnchor,
    verdict,
    oneLine,
    works,
    findings,
    nextSteps,
    notes,
    ...(acceptance ? { acceptance } : {}),
  };
}

// ─── Agent fix prompt (per locale) ───────────────────────────────────────────────

const SEVERITY_LABEL: Record<ReportLocale, Record<NonDevFinding["severity"], string>> = {
  ko: { high: "높음", medium: "중간", low: "낮음", info: "참고" },
  en: { high: "High", medium: "Medium", low: "Low", info: "Info" },
};

const PROMPT_STR: Record<ReportLocale, {
  intro: string[];
  target: string;
  urlL: string; flowL: string; verdictL: string;
  observed: string;
  statusL: string; primaryL: string; interactedL: string; routeL: (changed: string) => string;
  yes: string; no: string; notObserved: string; none: string;
  netN: (n: number) => string; netNone: string; conN: (n: number) => string; conNone: string;
  stepsHead: string; stepOk: string; stepBad: string;
  problems: string; noProblems: string;
  causeL: string; fixL: string; evidenceL: string;
  rules: string[];
}> = {
  ko: {
    intro: [
      "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다.",
      "아래는 Simsa가 실제 브라우저로 이 앱을 열어 관찰한 사실입니다. 여기 적힌 증거만 근거로 진단하고 수정하세요.",
      "증거에 없는 문제를 추측으로 만들어내지 마세요.",
    ],
    target: "[대상]",
    urlL: "URL", flowL: "검수한 사용자 플로우", verdictL: "판정",
    observed: "[브라우저 관찰 사실]",
    statusL: "첫 화면 HTTP 상태", primaryL: "핵심 동작 요소(버튼/입력) 발견", interactedL: "실제 상호작용(클릭/입력) 수행",
    routeL: (c) => `상호작용 후 주소: {ROUTE} (주소 변경: ${c})`,
    yes: "예", no: "아니오", notObserved: "관찰 안 됨", none: "없음",
    netN: (n) => `네트워크 실패 ${n}건:`, netNone: "네트워크 실패: 없음",
    conN: (n) => `콘솔 오류 ${n}건:`, conNone: "콘솔 오류: 없음",
    stepsHead: "플로우 단계 결과:", stepOk: "성공", stepBad: "실패",
    problems: "[고칠 문제 — 우선순위순]",
    noProblems: "- 고칠 문제가 관찰되지 않았습니다. 아래 규칙의 검증 절차만 수행해 결과를 보고하세요.",
    causeL: "원인 설명", fixL: "수정 방향", evidenceL: "증거",
    rules: [
      "[작업 규칙]",
      "- 재현 먼저: 앱을 로컬에서 실행해 위 플로우를 그대로 밟아 같은 실패를 확인한 뒤 수정하세요.",
      "- 최소 수정: 증거가 가리키는 원인만 고치고, 무관한 리팩터링은 하지 마세요.",
      "- 비밀값 금지: API 키·백엔드 주소 같은 환경값을 코드에 하드코딩하지 마세요.",
      "- 검증: 수정 후 같은 플로우에서 네트워크 실패 0건, 콘솔 오류 0건인지 확인하세요.",
      "- 보고: 무엇을/왜/어떻게 바꿨는지와 검증 결과를 5줄 이내로 보고하세요.",
    ],
  },
  en: {
    intro: [
      "You are a development agent editing this project's code.",
      "Below are facts Simsa observed by opening this app in a real browser. Diagnose and fix using only the evidence stated here.",
      "Do not invent problems that aren't in the evidence.",
    ],
    target: "[Target]",
    urlL: "URL", flowL: "Reviewed user flow", verdictL: "Verdict",
    observed: "[Observed in the browser]",
    statusL: "First-screen HTTP status", primaryL: "Core action element (button/input) found", interactedL: "Actual interaction (click/type) performed",
    routeL: (c) => `Address after interaction: {ROUTE} (address changed: ${c})`,
    yes: "yes", no: "no", notObserved: "not observed", none: "none",
    netN: (n) => `${n} network failure(s):`, netNone: "Network failures: none",
    conN: (n) => `${n} console error(s):`, conNone: "Console errors: none",
    stepsHead: "Flow step results:", stepOk: "ok", stepBad: "failed",
    problems: "[Problems to fix — by priority]",
    noProblems: "- No problems were observed. Only run the verification procedure in the rules below and report the result.",
    causeL: "Cause", fixL: "Fix direction", evidenceL: "Evidence",
    rules: [
      "[Working rules]",
      "- Reproduce first: run the app locally, walk the flow above, and confirm the same failure before fixing.",
      "- Minimal fix: fix only the cause the evidence points to; do no unrelated refactoring.",
      "- No secrets: do not hardcode env values like API keys or backend addresses into the code.",
      "- Verify: after the fix, confirm 0 network failures and 0 console errors on the same flow.",
      "- Report: in 5 lines or fewer, state what/why/how you changed and the verification result.",
    ],
  },
};

/**
 * 검수 증거를 개발 에이전트(Claude Code, Cursor 등)에 그대로 붙여넣을 수 있는 수정 지시문으로 조립.
 * 결정론적. 원본 기술 문자열(네트워크/콘솔 원문)이 그대로 들어간다 — 받는 쪽이 에이전트이므로.
 */
export function buildAgentFixPrompt(input: VisualCheckInput, locale: ReportLocale = "ko"): string {
  const L = loc(locale);
  const p = PROMPT_STR[L];
  const findings = classifyFindings(input, L);
  const yn = (b: boolean) => (b ? p.yes : p.no);
  const lines: string[] = [
    ...p.intro,
    "",
    p.target,
    `- ${p.urlL}: ${input.targetUrl}`,
    `- ${p.flowL}: ${input.intentAnchor}`,
    `- ${p.verdictL}: ${input.decision} (${decisionLabel(input.decision, L)})`,
    "",
    p.observed,
    `- ${p.statusL}: ${input.loadStatus ?? p.notObserved}`,
    `- ${p.primaryL}: ${yn(input.primaryActionFound)}`,
    `- ${p.interactedL}: ${yn(input.interacted)}`,
    `- ${p.routeL(yn(input.routeChanged)).replace("{ROUTE}", input.routeAfterClick ?? p.none)}`,
  ];

  if (input.networkFailures.length) {
    lines.push(`- ${p.netN(input.networkFailures.length)}`);
    input.networkFailures.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  } else {
    lines.push(`- ${p.netNone}`);
  }
  if (input.consoleErrors.length) {
    lines.push(`- ${p.conN(input.consoleErrors.length)}`);
    input.consoleErrors.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  } else {
    lines.push(`- ${p.conNone}`);
  }
  const steps = input.steps ?? [];
  if (steps.length) {
    lines.push(`- ${p.stepsHead}`);
    for (const s of steps) lines.push(`  - ${s.label}: ${s.ok ? p.stepOk : p.stepBad}${s.note ? ` — ${s.note}` : ""}`);
  }

  lines.push("", p.problems);
  if (findings.length) {
    findings.forEach((f, i) => {
      lines.push(
        `${i + 1}. [${SEVERITY_LABEL[L][f.severity]}] ${f.what}`,
        `   - ${p.causeL}: ${f.why}`,
        `   - ${p.fixL}: ${f.how}`,
        `   - ${p.evidenceL}: ${f.evidence ?? p.none}`,
      );
    });
  } else {
    lines.push(p.noProblems);
  }

  lines.push("", ...p.rules);
  return lines.join("\n");
}

// ─── Builder-chat fix prompt (C2b, per locale) ───────────────────────────────────

/**
 * 채팅형 빌더(Lovable·Bolt·v0·Replit·Base44) 대화창용 문구. **개발자 어휘 금지** — 이 사용자는
 * 코드를 보지 않는다. 금칙어(테스트로 고정): branch·terminal·PR·commit·git·repo /
 * 저장소·브랜치·터미널·커밋·깃. 대신 "앱", "고쳐 주세요", "다시 확인"으로 말한다.
 */
const BUILDER_STR: Record<ReportLocale, {
  intro: string[];
  appL: string; shouldL: string; nowL: string;
  problems: string;
  whyL: string; howL: string; detailL: string;
  /** Heading for items the report itself says are NOT defects (ac_not_confirmed). */
  confirmOnly: string;
  /** Builder-chat `how` for codes whose reader-facing `how` points at things a chat has no access to. */
  howOverride: Partial<Record<FindingCode, string>>;
  rules: string[];
}> = {
  ko: {
    intro: [
      "이 앱에서 아래 문제들을 고쳐 주세요.",
      "아래 내용은 실제 브라우저로 이 앱을 열어 눈으로 확인한 사실입니다. 여기 적힌 문제만 고치고, 적히지 않은 문제를 새로 만들어내지 마세요.",
    ],
    appL: "앱 주소", shouldL: "이 앱이 해야 하는 것", nowL: "지금 상태",
    problems: "고칠 문제 (급한 것부터)",
    whyL: "왜 그런가", howL: "어떻게 고치나", detailL: "기술 정보",
    confirmOnly: "확인만 해 주세요 (고장은 아니에요 — 검수가 끝까지 보지 못한 항목)",
    howOverride: {
      console_error: "아래 기술 정보의 오류 메시지를 보고 그 원인을 고쳐 주세요.",
    },
    rules: [
      "지켜 주세요:",
      "- 위에 적힌 원인만 고치고, 관계없는 부분은 바꾸지 마세요.",
      "- API 키나 서버 주소 같은 비밀값을 코드 안에 직접 적지 마세요.",
      "- 고친 뒤 같은 흐름을 처음부터 다시 따라가서 기대한 화면이 오류 없이 나오는지 확인해 주세요.",
      "- 무엇을 왜 바꿨는지 3~5문장으로 알려 주세요.",
    ],
  },
  en: {
    intro: [
      "Please fix the following problems in this app.",
      "Everything below was observed by opening the live app in a real browser. Fix only what is described here and do not invent problems that are not listed.",
    ],
    appL: "App address", shouldL: "What this app should do", nowL: "Current state",
    problems: "Problems to fix (most urgent first)",
    whyL: "Why", howL: "How to fix", detailL: "Technical detail",
    confirmOnly: "Please just confirm (not broken — the review could not see these through to the end)",
    howOverride: {
      console_error: "Use the error message in the technical detail below to find and fix its cause.",
    },
    rules: [
      "Please follow these rules:",
      "- Fix only the causes listed above; leave unrelated parts as they are.",
      "- Never put secret values such as API keys or server addresses directly into the code.",
      "- After the fix, walk through the same flow from the start and make sure the expected screen appears with no errors.",
      "- Tell me in 3–5 sentences what you changed and why.",
    ],
  },
};

/** The slice of a report the builder prompt reads — accepts a stored report_json too. */
export type BuilderPromptSource = Pick<NonDevReport, "findings"> &
  Partial<Pick<NonDevReport, "target" | "intent" | "verdict" | "oneLine" | "works">>;

/**
 * Codes the report itself defines as "not a defect": classifyFindings files
 * `ac_not_confirmed` as "확인 못 함 — 고장 아님" and `noise_third_party` as info.
 * A builder ordered to "fix" one of these will invent a change — the exact thing
 * the prompt's own rule forbids (PR #553 review P2). They are listed under a
 * "confirm only" heading instead. Legacy findings without a `code` keep the
 * severity-only rule (we cannot know, so we do not guess).
 */
const BUILDER_NOT_A_FIX: ReadonlySet<FindingCode> = new Set<FindingCode>(["ac_not_confirmed", "noise_third_party"]);

/**
 * C2b — 리포트에서 **한 덩어리** 빌더용 고침 지시를 만든다. 결정론적, throw 안 함.
 * 고칠 것(info가 아닌 finding · 리포트가 "고장 아님"으로 정의한 코드 제외)이 없으면 null —
 * 대시보드는 종전 UI로 돌아간다. 기술 원문(evidence)은 실린다: 받는 쪽이 빌더의 모델이라
 * 진단에 필요하다. `ac_not_confirmed`는 "확인만" 절에 what/why만 싣는다(how 없음 — 지시가 아니다).
 */
export function buildBuilderFixPrompt(report: BuilderPromptSource, locale: ReportLocale = "ko"): string | null {
  const L = loc(locale);
  const s = BUILDER_STR[L];
  const all = (Array.isArray(report.findings) ? report.findings : []).filter((f): f is NonDevFinding => Boolean(f));
  const notAFix = (f: NonDevFinding): boolean => f.code !== undefined && BUILDER_NOT_A_FIX.has(f.code);
  const fixable = all.filter((f) => f.severity !== "info" && !notAFix(f));
  if (fixable.length === 0) return null;
  const confirmOnly = all.filter((f) => f.code === "ac_not_confirmed");

  const lines: string[] = [...s.intro, ""];
  if (report.target) lines.push(`${s.appL}: ${report.target}`);
  if (report.intent) lines.push(`${s.shouldL}: ${report.intent}`);
  const now = [report.verdict, report.oneLine].filter((x): x is string => typeof x === "string" && x.trim().length > 0).join(" — ");
  if (now) lines.push(`${s.nowL}: ${now}`);
  lines.push("", `${s.problems}:`);
  fixable.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.what}`);
    if (f.why) lines.push(`   ${s.whyL}: ${f.why}`);
    const how = (f.code !== undefined ? s.howOverride[f.code] : undefined) ?? f.how;
    if (how) lines.push(`   ${s.howL}: ${how}`);
    if (f.evidence) lines.push(`   ${s.detailL}: ${f.evidence}`);
  });
  if (confirmOnly.length > 0) {
    lines.push("", `${s.confirmOnly}:`);
    for (const f of confirmOnly) {
      lines.push(`- ${f.what}`);
      if (f.why) lines.push(`  ${f.why}`);
    }
  }
  lines.push("", ...s.rules);
  return lines.join("\n");
}

function esc(s: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(s ?? "").replace(/[&<>"]/g, (c) => map[c] ?? c);
}

/** A screenshot to embed in the visual report (src is relative to the HTML file). */
export interface ReportShot {
  label: string;
  src: string;
}

// ─── HTML chrome (per locale) ────────────────────────────────────────────────────

const HTML_STR: Record<ReportLocale, {
  subtitle: string;
  chipOk: string; chipBad: string; chipWarn: string;
  metaTarget: string; metaIntent: string;
  rowWhat: string; rowWhy: string; rowHow: string; devDetail: string;
  hFindings: string; empty: string; hShots: string; hVideo: string;
  hFix: string; fixDesc: string; copyBtn: string; copiedBtn: string;
  hNext: string; hNotes: string; foot: string;
}> = {
  ko: {
    subtitle: "검수 리포트",
    chipOk: "작동해요", chipBad: "작동 안 해요", chipWarn: "확인 필요",
    metaTarget: "대상", metaIntent: "확인하려던 것",
    rowWhat: "무엇이 문제인가요", rowWhy: "왜 그런가요", rowHow: "어떻게 고치나요", devDetail: "개발자용 기술 정보",
    hFindings: "무엇을 발견했나요", empty: "특별히 막히는 지점을 찾지 못했어요.",
    hShots: "화면으로 보기", hVideo: "진행 영상",
    hFix: "바로 고치게 하기",
    fixDesc: "개발자가 없어도 됩니다. 아래 지시문을 복사해 AI 개발 도구(Claude Code, Cursor 등)에 붙여넣으면, 이 리포트의 증거를 근거로 수정 작업을 바로 시작합니다.",
    copyBtn: "지시문 복사", copiedBtn: "복사됨",
    hNext: "다음에 해볼 것", hNotes: "안내",
    foot: "Simsa 검수 · 실제 브라우저 관찰 기반 · 점수 없음 · 모든 버그를 찾았다는 뜻은 아닙니다.",
  },
  en: {
    subtitle: "Review Report",
    chipOk: "Works", chipBad: "Doesn't work", chipWarn: "Needs a check",
    metaTarget: "Target", metaIntent: "What we checked for",
    rowWhat: "What's the problem", rowWhy: "Why it happens", rowHow: "How to fix it", devDetail: "For developers (technical detail)",
    hFindings: "What we found", empty: "We didn't find any particular blocker.",
    hShots: "See the screens", hVideo: "Flow video",
    hFix: "Get it fixed right away",
    fixDesc: "No developer needed. Copy the prompt below and paste it into an AI dev tool (Claude Code, Cursor, etc.) — it will start fixing based on the evidence in this report.",
    copyBtn: "Copy prompt", copiedBtn: "Copied",
    hNext: "What to try next", hNotes: "Notes",
    foot: "Simsa review · based on real browser observation · no score · does not mean every bug was found.",
  },
};

/**
 * Render a SELF-CONTAINED HTML report a non-developer can double-click and read: verdict at the top,
 * each finding as what/why/how cards (with a collapsible developer detail), screenshots inline, an
 * optional flow video, and (when provided) a copy-ready agent fix prompt. Locale-aware (EN/KO); the
 * report's own strings (verdict/findings/notes) are already localized by buildNonDevReport — this
 * only localizes the surrounding chrome + the <html lang> attribute.
 *
 * Visual language mirrors the dashboard brand system (parchment surface, stone neutrals, deep oxblood
 * accent, antique gold, hairline borders, no emoji). No numeric score.
 */
export function renderNonDevReportHtml(
  report: NonDevReport,
  shots: ReportShot[] = [],
  videoSrc?: string | null,
  agentPrompt?: string | null,
  locale: ReportLocale = "ko",
): string {
  const L = loc(locale);
  const h = HTML_STR[L];
  const chip =
    report.works === true
      ? `<span class="chip chip-ok">${h.chipOk}</span>`
      : report.works === false
        ? `<span class="chip chip-bad">${h.chipBad}</span>`
        : `<span class="chip chip-warn">${h.chipWarn}</span>`;

  const findingCards = report.findings
    .map(
      (f) => `
    <article class="card finding">
      <header class="finding-head">
        <span class="chip chip-sev-${esc(f.severity)}">${esc(SEVERITY_LABEL[L][f.severity])}</span>
      </header>
      <div class="row"><span class="lbl">${h.rowWhat}</span><span class="val what">${esc(f.what)}</span></div>
      <div class="row"><span class="lbl">${h.rowWhy}</span><span class="val">${esc(f.why)}</span></div>
      <div class="row"><span class="lbl">${h.rowHow}</span><span class="val">${esc(f.how)}</span></div>
      ${f.evidence ? `<details><summary>${h.devDetail}</summary><code>${esc(f.evidence)}</code></details>` : ""}
    </article>`,
    )
    .join("\n");

  const shotEls = shots
    .map((s) => `<figure><figcaption>${esc(s.label)}</figcaption><img src="${esc(s.src)}" alt="${esc(s.label)}" loading="lazy"/></figure>`)
    .join("\n");

  const nextEls = report.nextSteps.map((n) => `<li>${esc(n)}</li>`).join("");
  const noteEls = report.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  const promptSection = agentPrompt
    ? `
  <h2>${h.hFix}</h2>
  <section class="card prompt-card">
    <p class="prompt-desc">${h.fixDesc}</p>
    <div class="prompt-actions"><button type="button" class="btn-copy" data-copy="${esc(h.copyBtn)}" data-copied="${esc(h.copiedBtn)}" onclick="simsaCopyPrompt(this)">${h.copyBtn}</button></div>
    <pre id="agent-prompt">${esc(agentPrompt)}</pre>
  </section>
  <script>
  function simsaCopyPrompt(btn){
    var pre=document.getElementById("agent-prompt");var txt=pre.textContent;
    var idle=btn.getAttribute("data-copy");var ok=btn.getAttribute("data-copied");
    function done(){btn.textContent=ok;btn.classList.add("copied");setTimeout(function(){btn.textContent=idle;btn.classList.remove("copied");},2000);}
    function fallback(){var r=document.createRange();r.selectNodeContents(pre);var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand("copy");done();}catch(e){}s.removeAllRanges();}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,fallback);}else{fallback();}
  }
  </script>`
    : "";

  const bodyFont =
    L === "en"
      ? `ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif`
      : `"Pretendard","Apple SD Gothic Neo",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif`;

  return `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(report.title)}</title>
<style>
  :root{
    --bg:#faf8f3; --surface:#ffffff;
    --ink:#1c1917; --ink-2:#57534e; --ink-3:#78716c; --ink-4:#a8a29e;
    --line:#e7e5e4; --line-soft:#f5f5f4;
    --brand:#5c111c; --brand-hover:#4b0e17; --brand-soft:#faf2f2; --gold:#a9883b;
    --ok-bg:#f0fdf4; --ok-tx:#15803d; --ok-bd:#bbf7d0;
    --bad-bg:#fef2f2; --bad-tx:#b91c1c; --bad-bd:#fecaca;
    --warn-bg:#fffbeb; --warn-tx:#b45309; --warn-bd:#fde68a;
    --info-bg:#f8fafc; --info-tx:#475569; --info-bd:#e2e8f0;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:${bodyFont};
    font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .wrap{max-width:820px;margin:0 auto;padding:48px 24px 72px}
  .eyebrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line)}
  .wordmark{font-size:12px;font-weight:700;letter-spacing:.16em;color:var(--brand)}
  .wordmark span{color:var(--ink-3);font-weight:500;letter-spacing:.02em;margin-left:8px}
  h1{font-size:24px;font-weight:650;letter-spacing:-.011em;line-height:1.35;margin:22px 0 8px}
  .lead{font-size:15px;color:var(--ink-2);margin:0 0 26px;max-width:62ch}
  .meta{display:grid;grid-template-columns:118px 1fr;row-gap:8px;column-gap:16px;
    background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;font-size:13.5px}
  .meta dt{color:var(--ink-3);margin:0}
  .meta dd{margin:0;word-break:break-all;color:var(--ink)}
  h2{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;letter-spacing:-.011em;color:var(--ink);margin:40px 0 12px}
  h2::after{content:"";flex:1;height:1px;background:var(--line)}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:10px 0}
  .finding-head{display:flex;justify-content:flex-end;margin:-2px 0 6px}
  .chip{display:inline-flex;align-items:center;padding:1px 8px;border-radius:6px;border:1px solid;font-size:12px;font-weight:600;line-height:1.6;white-space:nowrap}
  .chip-ok{background:var(--ok-bg);color:var(--ok-tx);border-color:var(--ok-bd)}
  .chip-bad{background:var(--bad-bg);color:var(--bad-tx);border-color:var(--bad-bd)}
  .chip-warn{background:var(--warn-bg);color:var(--warn-tx);border-color:var(--warn-bd)}
  .chip-sev-high{background:var(--bad-bg);color:var(--bad-tx);border-color:var(--bad-bd)}
  .chip-sev-medium{background:var(--warn-bg);color:var(--warn-tx);border-color:var(--warn-bd)}
  .chip-sev-low,.chip-sev-info{background:var(--info-bg);color:var(--info-tx);border-color:var(--info-bd)}
  .row{display:flex;gap:14px;padding:5px 0}
  .row+.row{border-top:1px solid var(--line-soft)}
  .lbl{flex:0 0 112px;color:var(--ink-3);font-size:12.5px;padding-top:2px}
  .val{flex:1;font-size:14px}
  .val.what{font-weight:600;font-size:14.5px}
  details{margin-top:10px}
  summary{cursor:pointer;color:var(--ink-3);font-size:12.5px}
  summary:hover{color:var(--ink-2)}
  code{display:block;background:#fafaf9;border:1px solid var(--line);padding:9px 11px;border-radius:6px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;margin-top:7px;color:var(--ink-2)}
  figure{margin:14px 0}
  figcaption{font-size:12.5px;color:var(--ink-3);margin-bottom:6px}
  img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  video{width:100%;border-radius:8px;border:1px solid var(--line);display:block}
  ul{padding-left:18px;margin:8px 0}
  li{margin:5px 0;color:var(--ink-2);font-size:14px}
  li::marker{color:var(--gold)}
  .prompt-card{padding:16px 18px 14px}
  .prompt-desc{margin:0 0 12px;font-size:13.5px;color:var(--ink-2)}
  .prompt-actions{margin-bottom:10px}
  .btn-copy{appearance:none;border:0;cursor:pointer;background:var(--brand);color:#fff;
    font:inherit;font-size:13px;font-weight:500;padding:7px 14px;border-radius:6px;transition:background-color .15s}
  .btn-copy:hover{background:var(--brand-hover)}
  .btn-copy.copied{background:var(--ok-tx)}
  pre{margin:0;background:#fafaf9;border:1px solid var(--line);border-radius:6px;padding:12px 14px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;color:var(--ink-2);
    white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
  .empty{color:var(--ink-3);font-size:14px;background:var(--surface);border:1px dashed var(--line);border-radius:8px;padding:18px;text-align:center}
  .foot{color:var(--ink-4);font-size:12px;margin-top:44px;padding-top:14px;border-top:1px solid var(--line)}
</style></head>
<body><div class="wrap">
  <div class="eyebrow"><div class="wordmark">SIMSA<span>${h.subtitle}</span></div>${chip}</div>
  <h1>${esc(report.verdict)}</h1>
  <p class="lead">${esc(report.oneLine)}</p>
  <dl class="meta">
    <dt>${h.metaTarget}</dt><dd>${esc(report.target)}</dd>
    <dt>${h.metaIntent}</dt><dd>${esc(report.intent)}</dd>
  </dl>

  <h2>${h.hFindings}</h2>
  ${report.findings.length ? findingCards : `<p class="empty">${h.empty}</p>`}

  ${shots.length ? `<h2>${h.hShots}</h2>${shotEls}` : ""}
  ${videoSrc ? `<h2>${h.hVideo}</h2><video controls src="${esc(videoSrc)}"></video>` : ""}
  ${promptSection}

  <h2>${h.hNext}</h2>
  <ul>${nextEls}</ul>

  <h2>${h.hNotes}</h2>
  <ul>${noteEls}</ul>

  <p class="foot">${h.foot}</p>
</div></body></html>`;
}
