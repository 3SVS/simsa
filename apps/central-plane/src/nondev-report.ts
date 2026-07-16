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
  /** One of the spike's decision states, e.g. "Needs Fix" / "Needs Clarification". */
  decision: string;
  /** Optional per-step flow outcomes (label + whether the step visibly succeeded). */
  steps?: Array<{ label: string; ok: boolean; note?: string }>;
}

/** One finding, written for a non-developer. `evidence` is the raw developer-only detail. */
export interface NonDevFinding {
  severity: "high" | "medium" | "low" | "info";
  what: string;
  why: string;
  how: string;
  evidence: string | null; // developer-only technical detail (not human prose)
}

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
}

// ─── Decision labels ────────────────────────────────────────────────────────────

/** decision state → user-facing label, per locale. */
const DECISION_LABEL: Record<ReportLocale, Record<string, string>> = {
  ko: {
    Ready: "정상 작동해요",
    "Conditionally Ready": "대체로 되지만 확인이 필요해요",
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
    "Conditionally Ready": "Mostly works, but needs a check",
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

/** True when `url` is a known analytics/ads/fonts/telemetry host (i.e. noise). */
export function isNoiseResource(url: string | null | undefined): boolean {
  if (!url) return false;
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
  },
};

/** Evidence the decision ladder reads (a subset of what the inspector gathers). */
export interface DecisionEvidence {
  loadStatus: number | null;
  /** NOISE-FILTERED network failures — app domain + backend only (never analytics). */
  networkFailures: string[];
  interacted: boolean;
  routeAfterClick: string | null;
  primaryActionFound: boolean;
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
  if (e.loadStatus && e.loadStatus >= 400) return "Not Verified";
  if (e.networkFailures.length) return "Needs Fix";
  if (e.interacted && e.routeAfterClick && /\/undefined|\/null|\/404|not-found|error/i.test(e.routeAfterClick)) return "Needs Fix";
  if (steps.some((s) => !s.ok)) return e.interacted ? "User Acceptance Required" : "Needs Clarification";
  if (!e.primaryActionFound) return "Needs Clarification";
  if (e.interacted) return "User Acceptance Required";
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

  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(netText + " " + conText)) {
    findings.push({
      severity: "high",
      ...t.dns,
      evidence: firstMatch(input.networkFailures, /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i) ?? firstMatch(input.consoleErrors, /ERR_NAME_NOT_RESOLVED/i),
    });
  }

  if (/\bHTTP 5\d\d\b|status 5\d\d/i.test(netText)) {
    findings.push({ severity: "high", ...t.server5xx, evidence: firstMatch(input.networkFailures, /5\d\d/) });
  }

  if (input.interacted && input.routeAfterClick && /\/undefined|\/null|\/404|not-found|error/i.test(input.routeAfterClick)) {
    findings.push({ severity: "high", ...t.brokenRoute, evidence: input.routeAfterClick });
  }

  if (input.networkFailures.length > 0 && !/ERR_NAME_NOT_RESOLVED|5\d\d/i.test(netText)) {
    findings.push({ severity: "high", ...t.genericNet, evidence: input.networkFailures[0] ?? null });
  }

  // Console errors are noisy and hard to attribute (third-party scripts throw
  // constantly on healthy sites), so they're INFORMATIONAL only — they never
  // drive the verdict (see decideFromEvidence) and are low severity here.
  if (input.consoleErrors.length > 0 && !/ERR_NAME_NOT_RESOLVED/i.test(conText)) {
    findings.push({ severity: "low", ...t.consoleErr, evidence: input.consoleErrors[0] ?? null });
  }

  // Noise (analytics/ads/fonts) failed — say so honestly, but as info, so the
  // user isn't alarmed by a "broken" reading that's really a blocked tracker.
  if ((input.noiseFailures?.length ?? 0) > 0) {
    findings.push({ severity: "info", ...t.noiseInfo, evidence: input.noiseFailures![0] ?? null });
  }

  if (!input.primaryActionFound && !input.interacted) {
    findings.push({ severity: "medium", ...t.noPrimary, evidence: null });
  }

  for (const s of input.steps ?? []) {
    if (!s.ok) {
      findings.push({ severity: "medium", ...t.stepFailed(s.label, s.note), evidence: s.note ?? null });
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
  oneLineBroken: (firstWhat: string) => string;
  oneLineUnverified: (firstWhat: string) => string;
  nextTop: (how: string) => string;
  nextNoPrimary: string;
  nextRerun: string;
  notes: string[];
}> = {
  ko: {
    title: "Simsa 검수 리포트",
    oneLineWorks: "핵심 흐름이 눈으로 확인한 범위에서 정상 동작했어요.",
    oneLineBroken: (w) => `핵심 흐름이 지금은 작동하지 않아요. ${w}`.trim(),
    oneLineUnverified: (w) => `아직 '작동한다'고 확정하기엔 확인이 더 필요해요. ${w}`.trim(),
    nextTop: (how) => `가장 급한 것부터: ${how}`,
    nextNoPrimary: "사용자가 처음에 눌러야 할 버튼/검색창을 분명히 만든 뒤 다시 검수하세요.",
    nextRerun: "고친 뒤 이 검수를 한 번 더 돌려서, 아래 스크린샷이 정상 화면으로 바뀌는지 눈으로 확인하세요.",
    notes: [
      "이 검수는 실제 브라우저로 앱을 열어 눈에 보이는 것을 확인한 결과예요. 모든 버그를 찾았다는 뜻은 아니에요.",
      "'무엇이/왜/어떻게'는 사람이 읽기 쉬운 설명이고, 정확한 기술 원인은 각 항목의 '개발자용' 정보에 있어요.",
      "화면 스크린샷을 함께 보면 어디서 막혔는지 눈으로 바로 알 수 있어요.",
    ],
  },
  en: {
    title: "Simsa Review Report",
    oneLineWorks: "The core flow worked correctly within what we could observe.",
    oneLineBroken: (w) => `The core flow doesn't work right now. ${w}`.trim(),
    oneLineUnverified: (w) => `More checking is needed before we can confirm it "works". ${w}`.trim(),
    nextTop: (how) => `Most urgent first: ${how}`,
    nextNoPrimary: "Make the first button/search box the user should press clear, then run the review again.",
    nextRerun: "After fixing, run this review once more and confirm with your own eyes that the screenshots below turn into a working screen.",
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
  const works = decisionToWorks(input.decision);
  const verdict = decisionLabel(input.decision, L);

  const firstWhat = findings[0]?.what ?? "";
  const oneLine =
    works === true ? s.oneLineWorks : works === false ? s.oneLineBroken(firstWhat) : s.oneLineUnverified(firstWhat);

  const nextSteps: string[] = [];
  if (findings[0]) nextSteps.push(s.nextTop(findings[0].how));
  if (works === null && input.primaryActionFound === false) nextSteps.push(s.nextNoPrimary);
  nextSteps.push(s.nextRerun);

  return {
    title: s.title,
    target: input.targetUrl,
    intent: input.intentAnchor,
    verdict,
    oneLine,
    works,
    findings,
    nextSteps,
    notes: s.notes,
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
