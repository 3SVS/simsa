/**
 * Workspace generation — calls Anthropic to produce a structured
 * idea-to-spec draft. Falls back to inline mock data on any failure
 * so the user-facing flow never breaks.
 */
import { anthropicMessages, anthropicEndpoint } from "./anthropic-fetch.js";
import { verifySpecAgainstUserWords, type SpecVerification } from "./verify-spec.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IdeaToSpecDraftRequest = {
  idea: string;
  mode?: "quick" | "standard" | "thorough";
  answers?: Array<{ questionId: string; answer: string }>;
  locale?: "ko" | "en";
  /**
   * Free-text extra context beyond the one-line idea ("anything else Simsa
   * should know"). Kept in a separate channel from `idea` so it doesn't muddy
   * the idea, but folded into the prompt and the user-words gate all the same.
   */
  context?: string;
  /**
   * Questions the user marked "this doesn't fit my case", with their reason.
   * Fed back into the next generation so it steers AWAY from that direction
   * and offers a replacement, instead of the user having to rewrite the idea.
   */
  rejectedQuestions?: Array<{ question: string; reason: string }>;
};

export type Question = {
  id: string;
  question: string;
  recommendation: string;
  reason: string;
  options: string[];
  allowCustom: boolean;
  allowLater: boolean;
};

export type ProductSpec = {
  productName: string;
  oneLine: string;
  targetUsers: string[];
  problem: string;
  included: string[];
  excluded: string[];
  userFlow: string[];
  decisions: string[];
  openQuestions: string[];
};

export type RequirementItem = {
  id: string;
  title: string;
  status: "not_started";
  criteria: string[];
};

export type IdeaToSpecDraftResponse = {
  ok: true;
  source: "llm" | "mock-fallback";
  understood: {
    summary: string;
    targetUsers: string[];
    mainFlow: string[];
  };
  questions: Question[];
  productSpec: ProductSpec;
  items: RequirementItem[];
  warnings?: string[];
  /** Deterministic verify-against-user-words result (audit v2 P0-honesty).
   *  Present on every successful draft; ok:false means the draft did not
   *  reflect enough of the user's own words and a loud warning was attached. */
  specVerification?: SpecVerification;
  /** 2026-07-09 Langfuse wiring — token/latency record of the LLM call that
   *  produced this draft (absent on the mock path). Additive and safe to
   *  expose; the route forwards it to Langfuse via waitUntil. */
  llmUsage?: LlmCallUsage;
};

export type LlmCallUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  latencyMs: number;
};

/** The draft as it goes to the (non-developer) client — without operator-only fields. */
export type ClientIdeaToSpecDraft = Omit<IdeaToSpecDraftResponse, "llmUsage">;

/**
 * Strip operator-only observability from a draft before it reaches the client.
 * `llmUsage` (token counts + latency) belongs in Langfuse and logs only — a
 * non-developer user must never see it, and the per-token cost structure must
 * not leak in the API response body. This is the single boundary where the
 * field is removed; the route must serialize the result of this function, not
 * the raw draft. (2026-07-09, per Bae — audit "결과부터 평이하게".)
 */
export function toClientDraft(result: IdeaToSpecDraftResponse): ClientIdeaToSpecDraft {
  const { llmUsage: _internal, ...clientResult } = result;
  return clientResult;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SCHEMA_DESCRIPTION = `{
  "understood": {
    "summary": "한 문장 요약 (일반 유저용 언어)",
    "targetUsers": ["주요 사용자 유형 1", "..."],
    "mainFlow": ["1. 첫 번째 단계", "2. 두 번째 단계", "..."]
  },
  "questions": [
    {
      "id": "q1",
      "question": "아이디어에 맞는 구체적 질문",
      "recommendation": "추천 답변 (짧게)",
      "reason": "추천 이유 (1~2문장, 일반 유저용 언어)",
      "options": ["선택지 1", "선택지 2", "선택지 3"],
      "allowCustom": true,
      "allowLater": true
    }
  ],
  "productSpec": {
    "productName": "제품 이름",
    "oneLine": "한 줄 설명",
    "targetUsers": ["누가 쓰는지"],
    "problem": "해결하려는 문제 (1~2문장)",
    "included": ["이번 버전에 포함할 기능"],
    "excluded": ["이번 버전에서 제외할 것"],
    "userFlow": ["1. 사용자 흐름 단계"],
    "decisions": ["질문 답변에 따라 결정된 사항"],
    "openQuestions": ["아직 결정이 필요한 것 (도구 이름 없이 일반인 언어로)"]
  },
  "items": [
    {
      "id": "req_001",
      "title": "꼭 들어가야 할 것 (주어+서술어 형태)",
      "status": "not_started",
      "criteria": ["완성 기준 1", "완성 기준 2"]
    }
  ]
}`;

const SCHEMA_DESCRIPTION_EN = `{
  "understood": {
    "summary": "one-sentence summary (plain language)",
    "targetUsers": ["primary user type 1", "..."],
    "mainFlow": ["1. first step", "2. second step", "..."]
  },
  "questions": [
    {
      "id": "q1",
      "question": "a concrete question tailored to the idea",
      "recommendation": "recommended answer (short)",
      "reason": "why recommended (1-2 sentences, plain language)",
      "options": ["option 1", "option 2", "option 3"],
      "allowCustom": true,
      "allowLater": true
    }
  ],
  "productSpec": {
    "productName": "product name",
    "oneLine": "one-line description",
    "targetUsers": ["who uses it"],
    "problem": "the problem it solves (1-2 sentences)",
    "included": ["features in this version"],
    "excluded": ["out of scope for this version"],
    "userFlow": ["1. user flow step"],
    "decisions": ["decisions made from the answers"],
    "openQuestions": ["things still to decide (plain language, no tool names)"]
  },
  "items": [
    {
      "id": "req_001",
      "title": "a must-have item (subject + verb form)",
      "status": "not_started",
      "criteria": ["acceptance criterion 1", "acceptance criterion 2"]
    }
  ]
}`;

/**
 * Deterministic solo-use detector. When a non-dev says an app is just for
 * themselves, asking "who do you grant access to / is this multi-user" is
 * nonsense — Bae's live complaint. We decide this WITHOUT the LLM (a matcher,
 * not a judgement) so the guard is predictable and testable. Markers are a
 * parameter, not a principle (D1): tune freely.
 *
 * Scans idea + extra context + the user's own answers. A multi-user marker
 * ("팀"/"team"/"고객"/"직원"…) VETOES the solo verdict — "혼자 관리하지만 팀이
 * 쓰는" is not solo. Requires an explicit solo phrase; silence ≠ solo.
 */
const SOLO_MARKERS =
  /혼자|나\s*혼자|나만|내가?\s*쓰|개인용|개인\s*용도|본인만|자기만|로그인\s*(?:은)?\s*(?:필요\s*없|안\s*)|just\s+for\s+me|only\s+me|for\s+myself|personal\s+use|single[-\s]?user|no\s+(?:login|sign[-\s]?up|account)/i;
const MULTIUSER_MARKERS =
  /여러\s*(?:사람|명|사용자)|팀|조직|회사|직원|고객|손님|회원|가입자|멀티|multi[-\s]?user|team|organization|customers?|clients?|members?|employees?|users\s+(?:sign|log)/i;

export function detectSoloUse(req: IdeaToSpecDraftRequest): boolean {
  const text = [
    req.idea,
    req.context ?? "",
    ...(req.answers ?? []).map((a) => a.answer),
  ].join(" ");
  if (MULTIUSER_MARKERS.test(text)) return false;
  return SOLO_MARKERS.test(text);
}

/**
 * Deterministic feasibility detector (D1, P0-A). A non-developer's coding agent
 * builds a WEB app; when the idea is a native mobile app, a 3D/engine game, a
 * desktop binary, hardware, or a browser extension, generating a confident web
 * spec is dishonest — it's exactly the PISTA failure (Kotlin app → "Next.js on
 * Vercel" shell). A matcher, not an LLM judgement, so it's predictable/testable.
 *
 * A plain "웹앱/website" marker VETOES — "모바일에서도 잘 보이는 웹앱" is web, not
 * a native app. Returns the kind so the honesty message can be specific.
 */
const WEB_MARKERS =
  /웹앱|웹\s*사이트|웹사이트|홈페이지|웹\s*서비스|반응형|웹\s*게임|브라우저\s*게임|브라우저에서|web\s*app|website|web\s*site|web\s*service|responsive|browser[-\s]?based|browser\s*game|in\s*the\s*browser/i;
// "게임" alone is NOT native — browser/puzzle games are web-buildable. Only a
// genuine native-game signal (3D / a game engine) counts; "아이폰 게임" is caught
// by the mobile marker instead.
const NATIVE_KIND: Array<{ kind: "mobile" | "desktop" | "game" | "hardware" | "extension"; re: RegExp }> = [
  { kind: "game", re: /\b3d\b|3\s*d\s*게임|언리얼|유니티|unreal|unity|godot|게임\s*엔진|game\s*engine|3d\s*game/i },
  { kind: "mobile", re: /아이폰|아이패드|안드로이드|네이티브\s*앱|모바일\s*앱|앱스토어|플레이\s*스토어|iphone|ipad|android\s*app|ios\s*app|native\s*app|mobile\s*app|app\s*store|play\s*store|swift|kotlin|react\s*native|flutter/i },
  { kind: "desktop", re: /데스크톱\s*(?:앱|프로그램|프로그램)|윈도우\s*(?:앱|프로그램)|맥\s*앱|\.exe|설치\s*(?:형|파일)|native\s*desktop|electron\s*app|windows\s*app|mac\s*app|desktop\s*(?:app|program|application)/i },
  { kind: "hardware", re: /아두이노|라즈베리\s*파이|펌웨어|하드웨어|IoT|사물인터넷|임베디드|arduino|raspberry\s*pi|firmware|embedded|robot|드론|drone/i },
  { kind: "extension", re: /크롬\s*확장|브라우저\s*확장|익스텐션|chrome\s*extension|browser\s*extension|플러그인|plugin/i },
];

export function detectNonWebBuildable(
  req: IdeaToSpecDraftRequest,
): { hit: false } | { hit: true; kind: "mobile" | "desktop" | "game" | "hardware" | "extension" } {
  const text = [req.idea, req.context ?? ""].join(" ");
  // An explicit "web app / website" statement wins — the user wants web.
  if (WEB_MARKERS.test(text)) return { hit: false };
  for (const { kind, re } of NATIVE_KIND) {
    if (re.test(text)) return { hit: true, kind };
  }
  return { hit: false };
}

/** The solo-use rule injected into the prompt (D1). Empty when not solo. */
function soloGuard(locale: "ko" | "en" | undefined, solo: boolean): string {
  if (!solo) return "";
  return locale === "ko"
    ? `\n- 이 앱은 **혼자(개인용)** 쓰는 앱이다. 권한·역할·멀티유저·사용자 구분/격리·"누구에게 접근을 허용하나" 류의 질문이나 항목은 만들지 마라 — 이 사용자에겐 무의미하다. **스펙 본문(included·userFlow·항목)에도 회원가입·로그인·계정 항목을 넣지 마라** — 이 앱은 열면 바로 시작한다(사용자가 직접 로그인·잠금을 원한 경우만 예외).`
    : `\n- This app is for **solo/personal use**. Do NOT create any question or item about permissions, roles, multi-user, user separation/isolation, or "who to grant access to" — it is meaningless for this user. **Do not put sign-up/login/account items in the spec body (included, userFlow, items) either** — the app starts right away when opened (unless the user themselves asked for a login/lock).`;
}

/**
 * D15 (2026-07-17, Bae): the 7/16 assessment found a solo app's SPEC BODY still
 * carried "회원가입/로그인" even though the solo guard cleaned the questions.
 * The prompt rule above reduces it; this deterministic strip guarantees it.
 * Veto: the user explicitly ASKING for a login/lock keeps it — but a negated
 * mention ("로그인 필요 없어요") must not count as asking (lookahead).
 * Matchers are parameters; the principle (a solo spec ships auth-free unless
 * asked) is not. Items keep a floor of 3 (the response validity minimum).
 */
const AUTH_ARTIFACT_RE =
  /로그인|회원\s*가입|계정|비밀번호\s*(?:설정|만들|입력)|인증\s*(?:절차|단계)|sign[\s-]?up|log[\s-]?in|account\s*(?:creation|setup)|authentication/i;
const WANTS_AUTH_RE =
  /(?:로그인|비밀번호|암호|계정|잠금)[^.\n]{0,12}(?:필요(?!\s*없)|넣|원해|있으면|있었으면|하고\s*싶)|want[^.\n]{0,16}(?:login|password|lock)|with\s+(?:a\s+)?(?:login|password|pin)/i;

export function applySoloSpecGuard<
  T extends {
    productSpec: { included: string[]; userFlow: string[] };
    items: Array<{ title: string }>;
  },
>(res: T, userWords: string): T {
  if (WANTS_AUTH_RE.test(userWords)) return res;
  const keptItems = res.items.filter((i) => !AUTH_ARTIFACT_RE.test(i.title));
  return {
    ...res,
    productSpec: {
      ...res.productSpec,
      included: res.productSpec.included.filter((s) => !AUTH_ARTIFACT_RE.test(s)),
      userFlow: res.productSpec.userFlow.filter((s) => !AUTH_ARTIFACT_RE.test(s)),
    },
    items: keptItems.length >= 3 ? keptItems : res.items,
  };
}

/** Human-readable name of a non-web-buildable kind, per locale. */
const FEASIBILITY_KIND_LABEL = {
  ko: { mobile: "휴대폰 네이티브 앱", desktop: "데스크톱 설치형 프로그램", game: "3D·게임엔진 게임", hardware: "하드웨어·기기", extension: "브라우저 확장 프로그램" },
  en: { mobile: "a native mobile app", desktop: "an installed desktop program", game: "a 3D / game-engine game", hardware: "hardware / a device", extension: "a browser extension" },
} as const;

/**
 * Feasibility honesty rule (D1, P0-A). When the idea needs a non-web build, the
 * coding agent (which produces a WEB app) cannot ship the real thing — say so,
 * and scope the spec to the honest web slice + a handoff, never a confident
 * native spec. Empty when the idea is web-buildable.
 */
function feasibilityGuard(
  locale: "ko" | "en" | undefined,
  feas: ReturnType<typeof detectNonWebBuildable>,
): string {
  if (!feas.hit) return "";
  const label = FEASIBILITY_KIND_LABEL[locale === "en" ? "en" : "ko"][feas.kind];
  return locale === "ko"
    ? `\n- **실현가능성 정직성 (매우 중요):** 이 아이디어는 ${label}이 필요하다. 사용자가 쓰는 개발 AI(v0·Lovable·Cursor 등)는 **웹앱만** 만든다. 따라서: (1) 웹으로 되는 부분(예: 웹 프로토타입, 관리/설정 화면, 랜딩)만 included에 넣고, (2) ${label} 자체(네이티브 빌드·앱스토어 출시·3D 엔진 등)는 excluded에 넣되 "웹으로는 만들 수 없고 전문 개발이 필요"함을 openQuestions에 정직히 적어라. **네이티브 기능을 웹앱처럼 included에 넣어 '다 된다'고 하지 마라.**`
    : `\n- **Feasibility honesty (very important):** this idea needs ${label}. The user's coding AI (v0, Lovable, Cursor…) builds **web apps only**. So: (1) put only the web-buildable slice (a web prototype, admin/config screens, a landing page) in "included", and (2) put ${label} itself (native build, app-store release, 3D engine…) in "excluded", and state honestly in openQuestions that it **cannot be built on the web and needs specialist development**. Do NOT list native features as if a web app delivers them.`;
}

/** Deterministic honesty warning surfaced to the user (D1). Empty when web-buildable. */
export function feasibilityWarning(
  req: IdeaToSpecDraftRequest,
): string | null {
  const feas = detectNonWebBuildable(req);
  if (!feas.hit) return null;
  const label = FEASIBILITY_KIND_LABEL[req.locale === "en" ? "en" : "ko"][feas.kind];
  return req.locale === "en"
    ? `Heads up: this looks like ${label}. The coding tools Simsa hands off to build web apps, so the web-buildable parts can be made now, but ${label} itself needs specialist development — the spec marks that honestly rather than pretending a web app covers it.`
    : `참고: 이건 ${label}이 필요해 보여요. 심사가 연결하는 개발 도구는 웹앱을 만들기 때문에, 웹으로 되는 부분은 지금 만들 수 있지만 ${label} 자체는 전문 개발이 필요해요 — 설명서에는 그 점을 '다 된다'고 하지 않고 정직하게 표시했어요.`;
}

// ─── Non-developer language (P1, 2026-07-17) ─────────────────────────────────

/**
 * openQuestions is where developer tool names leaked in live measurement
 * (2026-07-17 assessment: 3/6 drafts named Firebase/AWS/Chart.js/API). The
 * target user cannot decide "Firebase vs AWS" — the decision they CAN make is
 * "where should my data live". Each category maps a jargon marker to the plain
 * decision it stands for. A matcher, not a judgement: markers are parameters,
 * the principle (no tool names in a non-developer's open decisions) is not.
 */
const JARGON_CATEGORIES: Array<{ re: RegExp; ko: string; en: string }> = [
  {
    re: /firebase|supabase|amazon\s*s3|\bs3\b|\baws\b|dynamodb|mongodb|postgres(?:ql)?|mysql|redis|데이터베이스|\bdb\b/i,
    ko: "자료를 어디에 어떻게 보관할지 정하기",
    en: "Decide where and how your data is kept",
  },
  {
    re: /chart\.js|\bd3(?:\.js)?\b|recharts|highcharts/i,
    ko: "차트·그래프를 어떤 모습으로 보여줄지 정하기",
    en: "Decide how charts and graphs should look",
  },
  {
    re: /\bstt\b|speech[-\s]?to[-\s]?text|\btts\b/i,
    ko: "음성 인식을 어느 수준까지 지원할지 정하기",
    en: "Decide how far speech recognition should go",
  },
  {
    re: /oauth|\bjwt\b|\bsso\b/i,
    ko: "로그인 방식을 어떻게 할지 정하기",
    en: "Decide how sign-in works",
  },
  {
    re: /\bapi\b|\bsdk\b|webhook|웹훅|graphql|엔드포인트|endpoint/i,
    ko: "외부 서비스와 무엇을 주고받을지 정하기",
    en: "Decide what to exchange with external services",
  },
  {
    re: /vercel|netlify|cloudflare|heroku|호스팅|hosting|docker|kubernetes/i,
    ko: "서비스를 인터넷에 올리는 방식 정하기",
    en: "Decide how the service goes live",
  },
];

/**
 * Deterministic rewrite of open questions into non-developer language. A
 * question naming a developer tool/service is replaced by the plain decision
 * for its category; duplicates collapsing onto the same canonical question are
 * deduped. A term the user typed THEMSELVES is exempt — their own words are
 * their language, not a leak (and removing them would also hurt the
 * user-words coverage gate).
 */
export function sanitizeOpenQuestions(
  questions: string[],
  locale: "ko" | "en" | undefined,
  userWords: string,
): string[] {
  const lang = locale === "en" ? "en" : "ko";
  const lowerUserWords = userWords.toLowerCase();
  const out: string[] = [];
  for (const q of questions) {
    let rewritten = q;
    for (const cat of JARGON_CATEGORIES) {
      const m = cat.re.exec(q);
      if (!m) continue;
      if (!lowerUserWords.includes(m[0].toLowerCase())) rewritten = cat[lang];
      break;
    }
    if (!out.includes(rewritten)) out.push(rewritten);
  }
  return out;
}

/**
 * D13 (P2, 2026-07-17 target-fit eval): deterministic question filter. The live
 * eval caught the LLM asking things the target user cannot decide — "모바일
 * 앱(iOS/Android)으로도 만들지" (the coding AI can't build one), "데이터를
 * 어디에 저장할지" (a storage decision), and tool-name questions. The prompt
 * rule reduces these; this filter guarantees them. A question mentioning a term
 * the user typed THEMSELVES is exempt (their words, their language). Never
 * drops below 3 questions — the wizard needs something to ask.
 */
const NATIVE_OPTION_RE =
  /모바일\s*앱|네이티브|앱\s*스토어|안드로이드|아이폰|아이패드|\bios\b|\bandroid\b|app\s*store|native\s*app/i;
const STORAGE_DECISION_RE =
  /어디에\s*(?:저장|보관)|저장\s*(?:위치|장소|방식을\s*직접)|where\s+(?:to\s+)?store/i;

function questionDropMatch(text: string): RegExpExecArray | null {
  for (const re of [NATIVE_OPTION_RE, STORAGE_DECISION_RE]) {
    const m = re.exec(text);
    if (m) return m;
  }
  for (const cat of JARGON_CATEGORIES) {
    const m = cat.re.exec(text);
    if (m) return m;
  }
  return null;
}

export function filterQuestionsForNonDev<T extends { question: string }>(
  questions: T[],
  userWords: string,
): T[] {
  const lower = userWords.toLowerCase();
  const maxDrop = Math.max(0, questions.length - 3);
  const out: T[] = [];
  let dropped = 0;
  for (const q of questions) {
    const m = dropped < maxDrop ? questionDropMatch(q.question) : null;
    if (m && !lower.includes(m[0].toLowerCase())) {
      dropped++;
      continue;
    }
    out.push(q);
  }
  return out;
}

/** Extra-context block (D2). Empty when the user gave none. */
function contextBlock(locale: "ko" | "en" | undefined, context: string | undefined): string {
  const c = (context ?? "").trim();
  if (!c) return "";
  return locale === "ko"
    ? `\n사용자가 추가로 알려준 내용(반드시 반영):\n${c.slice(0, 4000)}`
    : `\nExtra context the user provided (must be reflected):\n${c.slice(0, 4000)}`;
}

/** Rejected-question steer (D3). Empty when nothing was rejected. */
function rejectedBlock(
  locale: "ko" | "en" | undefined,
  rejected: IdeaToSpecDraftRequest["rejectedQuestions"],
): string {
  if (!rejected || rejected.length === 0) return "";
  const list = rejected
    .slice(0, 6)
    .map((r) => `- "${r.question.slice(0, 200)}" — ${(r.reason || "").slice(0, 200)}`)
    .join("\n");
  return locale === "ko"
    ? `\n사용자가 아래 질문들을 "내 경우엔 맞지 않는다"고 했다(사유 포함). 같은 방향의 질문은 피하고, 대신 이 아이디어에 실제로 맞는 다른 질문으로 대체하라:\n${list}`
    : `\nThe user marked these questions as "not right for my case" (reason included). Avoid questions in the same direction; replace them with ones that actually fit this idea:\n${list}`;
}

export function buildPrompt(req: IdeaToSpecDraftRequest): string {
  const solo = detectSoloUse(req);
  const feas = detectNonWebBuildable(req);
  // English-first product: generate in English unless the caller asks for Korean.
  if (req.locale === "ko") {
    const answersText =
      req.answers && req.answers.length > 0
        ? `\n사용자 답변:\n${req.answers.map((a) => `- ${a.questionId}: ${a.answer}`).join("\n")}`
        : "";
    return `사용자가 만들고 싶은 제품 아이디어가 있습니다. 이 아이디어를 바탕으로 구조화된 제품 설명서를 한국어로 만들어주세요.

아이디어: ${req.idea}${contextBlock("ko", req.context)}${answersText}${rejectedBlock("ko", req.rejectedQuestions)}

다음 규칙을 반드시 따르세요:
- 모든 사용자 대상 텍스트는 자연스러운 한국어로 작성
- PRD, Requirement, Acceptance Criteria, FAIL, INCONCLUSIVE 같은 개발자 용어 사용 금지
- openQuestions·decisions에도 개발 도구·서비스 이름(Firebase, AWS, Chart.js, API 등)을 쓰지 마라. "STT 서비스 선택"이 아니라 "음성 인식을 어느 수준까지 지원할지 정하기"처럼, 사용자가 실제로 내릴 수 있는 결정을 일반인 언어로 적어라. 단, 사용자가 직접 언급한 도구 이름은 그대로 써도 된다.
- 사용자의 개발 AI는 **웹앱만** 만든다. 질문에서 "모바일 앱(iOS/Android)으로도 만들지" 같은 네이티브 앱 선택지를 제시하지 마라(사용자가 직접 꺼낸 경우 예외). "데이터를 어디에 저장할지" 같은 기술 결정도 묻지 마라 — 사용자가 실제로 내릴 수 있는 결정만 물어라.
- 질문은 이 아이디어에 맞춤형으로 4~6개 생성 (단순 템플릿 반복 금지). 그중 **최소 1개는 화면·디자인(UIUX)** 에 관한 것.
- 좋은 질문 = 답에 따라 제품이 실제로 달라지는 구체적 질문. 아래 축을 폭넓게 살펴 이 아이디어에 맞는 것을 고른다:
  구현 범위 · 사용자 흐름 · 데이터 보관 · 로그인/권한 · 외부 연동 · 대상 사용자 숙련도 · 성공 기준 ·
  **화면·디자인(UIUX)**: 참고하는 앱이나 느낌(예: Linear처럼 미니멀 / Notion처럼 정돈 / 밝고 친근하게), 핵심 화면이 몇 개이고 무엇이 먼저 보여야 하는지, 주로 모바일인지 데스크톱인지
- 나쁜 질문 = 답이 제품을 바꾸지 않는 추상적 질문("장기 비전은?", "전반적으로 어떤 느낌?"). 단, 위처럼 **구체적인 UIUX 질문은 좋은 질문**이다.${soloGuard("ko", solo)}${feasibilityGuard("ko", feas)}
- 꼭 들어가야 할 항목은 8~10개, 각 항목마다 완성 기준 2~4개
- 완성 기준은 확인 가능한 구체적 동작으로 작성

다음 JSON 형식으로만 응답하세요. 마크다운 코드블록, 설명문 없이 JSON만 반환:

${SCHEMA_DESCRIPTION}`;
  }

  const answersText =
    req.answers && req.answers.length > 0
      ? `\nUser answers:\n${req.answers.map((a) => `- ${a.questionId}: ${a.answer}`).join("\n")}`
      : "";
  return `A user has a product idea they want to build. Based on this idea, create a structured product brief in English.

Idea: ${req.idea}${contextBlock("en", req.context)}${answersText}${rejectedBlock("en", req.rejectedQuestions)}

Follow these rules strictly:
- Write all user-facing text in natural, plain English
- Do NOT use developer jargon like PRD, Requirement, Acceptance Criteria, FAIL, INCONCLUSIVE
- Do NOT name developer tools or services (Firebase, AWS, Chart.js, API, …) in openQuestions/decisions either. Write the decision the user can actually make in plain words — "Decide where and how your data is kept", not "Choose Firebase vs AWS". Tools the user themselves mentioned are fine to keep.
- The user's coding AI builds **web apps only**. Never offer a native mobile app (iOS/Android) as a question option (unless the user brought it up themselves). Don't ask technical decisions like "where should the data be stored" — ask only decisions the user can actually make.
- Generate 4-6 questions tailored to this idea (no repetitive templates). At least ONE must be about screens/design (UI/UX).
- Good questions = concrete questions whose answers actually change the product. Draw broadly from these axes, picking what fits this idea:
  scope · user flow · data retention · login/permissions · integrations · target-user skill level · success criteria ·
  **screens/design (UI/UX)**: a reference app or feel (e.g. minimal like Linear / tidy like Notion / bright & friendly), how many key screens there are and what should appear first, mainly mobile or desktop
- Bad questions = abstract ones whose answers don't change the product ("what's the long-term vision?", "overall feel?"). But concrete UI/UX questions like the above ARE good.${soloGuard("en", solo)}${feasibilityGuard("en", feas)}
- Include 8-10 must-have items, each with 2-4 acceptance criteria
- Acceptance criteria must be concrete, verifiable behaviors

Respond ONLY in the following JSON format. No markdown code block, no prose — JSON only:

${SCHEMA_DESCRIPTION_EN}`;
}

// ─── Anthropic fetch ──────────────────────────────────────────────────────────

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

async function callAnthropic(
  apiKey: string,
  prompt: string,
  baseUrl: string | undefined,
  timeoutMs = 120000, // document-scale prompts (up to 80k chars) need generous time
): Promise<{ text: string; usage: LlmCallUsage }> {
  const startedAt = Date.now();
  const data = (await anthropicMessages(
    apiKey,
    {
      model: GENERATE_MODEL,
      max_tokens: 8000,
      // Assistant prefill: the reply MUST continue from "{" — a refusal or a
      // prose preamble becomes impossible. (Live 2026-07-05: the KO prompt
      // consistently got a 222-char text answer instead of JSON.)
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    },
    timeoutMs,
    undefined,
    anthropicEndpoint(baseUrl),
    "generate",
  )) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  const text = (data.content ?? []).find((b) => b.type === "text")?.text ?? "";
  // Operational diagnostics (no user content): production fell back with
  // "non-JSON" and this is the only way to see WHY from a tail.
  console.log(
    `[workspace/generate] blocks=${(data.content ?? []).map((b) => b.type).join(",") || "none"}` +
      ` textLen=${text.length} stop=${data.stop_reason ?? "?"}`,
  );
  return {
    text: "{" + text,
    usage: {
      model: GENERATE_MODEL,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: data.usage?.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: data.usage?.cache_read_input_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    },
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidResponse(v: unknown): v is Omit<IdeaToSpecDraftResponse, "ok" | "source"> {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["understood"] === "object" &&
    Array.isArray((r["understood"] as Record<string, unknown>)["mainFlow"]) &&
    Array.isArray(r["questions"]) &&
    typeof r["productSpec"] === "object" &&
    Array.isArray(r["items"]) &&
    (r["items"] as unknown[]).length >= 3
  );
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

/**
 * Extract intent flags from answers array.
 * Looks for Korean keyword signals in answer text so the fallback
 * output changes meaningfully when the user answers differently.
 */
function extractAnswerFlags(answers: IdeaToSpecDraftRequest["answers"]): {
  confirmBeforeSend: boolean;
  autoSend: boolean;
  editable: boolean;
  deleteAfterProcess: boolean;
} {
  const allText = (answers ?? []).map((a) => a.answer).join(" ").toLowerCase();
  // "확인 없이 자동" / "자동으로 보내도" → autoSend
  // "확인해야" / "확인 후" / "확인하고" → confirmBeforeSend
  // Explicit confirm phrases take precedence; auto phrases dominate when confirm is absent or negated
  const hasExplicitAuto = /자동으로|확인 없이|자동 전송|자동으로 보내/.test(allText);
  const hasExplicitConfirm = /확인해야|확인 후|확인하고|사용자가 확인|검토 후/.test(allText);
  return {
    // Confirm wins over auto only when explicitly stated
    confirmBeforeSend: hasExplicitConfirm || (!hasExplicitAuto && /확인|검토|선택|승인/.test(allText)),
    autoSend: hasExplicitAuto && !hasExplicitConfirm,
    editable: !/수정 불가|읽기 전용|readonly/.test(allText),
    deleteAfterProcess: /삭제|제거/.test(allText) || (!/보관|저장/.test(allText)),
  };
}

/** Everything the user actually typed — the reference text for the gate. */
function userWordsOf(req: IdeaToSpecDraftRequest): string {
  return [req.idea, req.context ?? "", ...(req.answers ?? []).map((a) => a.answer)].join(" ");
}

/** The draft surfaces the gate inspects (title/spec/flow/items — what the user reads). */
function gateDraftOf(res: IdeaToSpecDraftResponse): unknown {
  return { understood: res.understood, productSpec: res.productSpec, items: res.items };
}

function buildMockFallback(req: IdeaToSpecDraftRequest): IdeaToSpecDraftResponse {
  // Honesty guard: this LLM-unavailable fallback must NOT fabricate a specific,
  // unrelated product from a single common word. The old trigger
  // (/회의|녹음|요약|linear|미팅/) fired on "요약" or "linear" ALONE, so "리뷰를
  // 요약하는 앱" or "회의실 예약 앱" got a canned "회의록 → Linear 전송" spec that
  // had nothing to do with the user's idea. Now it only fires for a genuine
  // meeting-NOTES idea: a meeting-context word (회의/미팅/녹음) AND a
  // summarize/tasks word. Everything else gets the generic, idea-echoing draft.
  const isMeeting =
    /회의|미팅|녹음/i.test(req.idea) && /요약|할\s*일|정리|linear/i.test(req.idea);
  const flags = extractAnswerFlags(req.answers);
  // D1: a solo/personal app has no multi-user story, so the generic mock must
  // drop its "multi-user vs personal" question and its "other users' data must
  // not be visible" item — both nonsense for one user (Bae's live complaint).
  const solo = detectSoloUse(req);

  if (isMeeting) {
    const hasAnswers = (req.answers ?? []).length > 0;
    // If answers explicitly say "auto send" → no confirm step; otherwise default to confirm
    const confirmSend = hasAnswers ? flags.confirmBeforeSend || !flags.autoSend : true;
    const editable = flags.editable;

    const sendDecision = confirmSend
      ? "사용자가 확인한 할 일만 Linear로 전송"
      : "처리 완료 후 Linear로 자동 전송 (확인 단계 없음)";
    const sendRisk = confirmSend
      ? undefined
      : "자동 전송 시 잘못 추출된 할 일이 팀 시스템에 바로 들어갈 수 있으므로, 전송 실패 복구 및 되돌리기 기능이 필요합니다.";

    const sendItem: RequirementItem = confirmSend
      ? {
          id: "req_006",
          title: "사용자가 확인하고 선택한 할 일만 Linear로 보내야 함",
          status: "not_started",
          criteria: ["체크한 항목만 전송됨", "전송 후 Linear 이슈 링크 표시", "전송 취소 가능"],
        }
      : {
          id: "req_006",
          title: "처리 완료 후 할 일이 자동으로 Linear로 전송되어야 함",
          status: "not_started",
          criteria: [
            "처리 완료 시 자동 전송됨",
            "전송 실패 시 재시도 또는 수동 전송으로 전환",
            "전송 내역을 사용자가 확인할 수 있음",
          ],
        };

    const meetingDraft: IdeaToSpecDraftResponse = {
      ok: true,
      source: "mock-fallback",
      understood: {
        summary:
          "이 제품은 회의 녹음 파일을 업로드하면 자동으로 요약하고 할 일을 업무 도구로 보내는 앱입니다.",
        targetUsers: ["회의가 많은 팀", "PM·운영자", "Linear를 쓰는 스타트업 팀"],
        mainFlow: ["녹음 파일 업로드", "텍스트 변환", "요약 생성", "할 일 추출", "Linear로 전송"],
      },
      questions: [
        {
          id: "q1",
          question: "Linear로 보내기 전에 사용자가 확인하는 단계가 필요할까요?",
          recommendation: "확인 후 보내기",
          reason: "잘못 추출된 할 일이 팀 시스템에 들어가는 것을 막을 수 있습니다.",
          options: ["확인 후 보내기", "자동으로 보내기"],
          allowCustom: true,
          allowLater: true,
        },
        {
          id: "q2",
          question: "회의 녹음 원본은 저장해야 하나요, 요약 후 삭제해야 하나요?",
          recommendation: "요약 후 삭제",
          reason: "불필요한 민감 데이터를 줄이면 보안 위험과 비용이 감소합니다.",
          options: ["요약 후 삭제", "일정 기간 보관", "영구 보관"],
          allowCustom: false,
          allowLater: true,
        },
        {
          id: "q3",
          question: "잘못 추출된 할 일을 사용자가 수정할 수 있어야 하나요?",
          recommendation: "수정 가능하게",
          reason: "수정 기능이 있으면 오탐에 대한 부담이 줄고 신뢰도가 높아집니다.",
          options: ["수정 가능", "삭제만 가능", "수정 불가"],
          allowCustom: false,
          allowLater: true,
        },
      ],
      productSpec: {
        productName: "회의록 자동 요약 앱",
        oneLine: "회의를 녹음하면 요약과 할 일이 자동으로 정리됩니다",
        targetUsers: ["회의가 많은 팀", "Linear를 쓰는 스타트업"],
        problem: "회의 후 내용 정리와 할 일 분배에 시간이 많이 걸립니다.",
        included: [
          "녹음 파일 업로드",
          "음성을 텍스트로 변환",
          "요약 생성 (결정사항·할 일 구분)",
          "할 일 추출",
          confirmSend ? "사용자 확인 후 Linear 전송" : "처리 완료 후 Linear 자동 전송",
          editable ? "추출된 할 일 수정·삭제" : "추출된 할 일 확인",
        ],
        excluded: ["실시간 녹음", "화상 회의 연동", "번역"],
        userFlow: [
          "파일 업로드",
          "변환·요약 처리",
          editable ? "할 일 확인 및 수정" : "할 일 확인",
          confirmSend ? "보낼 항목 선택 후 Linear 전송" : "자동 Linear 전송",
        ],
        decisions: [
          sendDecision,
          editable ? "할 일 수정·삭제 가능" : "할 일 읽기 전용",
        ],
        openQuestions: [
          "파일 크기 상한선 (예: 500MB)",
          "STT 서비스 선택",
          ...(sendRisk ? [sendRisk] : []),
        ],
      },
      items: [
        { id: "req_001", title: "녹음 파일을 올릴 수 있어야 함", status: "not_started", criteria: ["mp3, m4a, wav 파일 지원", "지원 안 되는 형식은 이유를 알려줌"] },
        { id: "req_002", title: "업로드된 녹음을 텍스트로 바꿔야 함", status: "not_started", criteria: ["변환 중 진행 상태 표시", "변환 실패 시 재시도 가능"] },
        { id: "req_003", title: "회의 내용을 요약해야 함", status: "not_started", criteria: ["결정사항과 할 일이 구분되어 보임", "원문 근거 확인 가능"] },
        { id: "req_004", title: "할 일을 자동으로 추출해야 함", status: "not_started", criteria: ["추출된 할 일이 목록으로 보임"] },
        ...(editable ? [{ id: "req_005", title: "추출된 할 일을 수정하거나 지울 수 있어야 함", status: "not_started" as const, criteria: ["텍스트 수정 가능", "항목 삭제 가능"] }] : []),
        sendItem,
        { id: "req_007", title: "다른 사용자의 회의록은 볼 수 없어야 함", status: "not_started", criteria: ["본인 회의록만 접근 가능"] },
        { id: "req_008", title: "처리 실패 시 다시 시도할 수 있어야 함", status: "not_started", criteria: ["오류 메시지와 재시도 버튼 표시"] },
      ],
      warnings: hasAnswers ? undefined : ["임시 초안입니다. 다시 시도하면 더 맞춤형 결과를 받을 수 있습니다."],
    };

    // Verify-against-user-words gate (P0-honesty): the canned meeting draft is
    // only allowed out when it actually reflects the user's own words. A common
    // word alone ("요약" in "리뷰를 요약해줘") must NOT produce an unrelated
    // meeting-notes product — fall through to the generic draft, which quotes
    // the user's idea verbatim and fabricates nothing.
    const meetingGate = verifySpecAgainstUserWords(userWordsOf(req), gateDraftOf(meetingDraft));
    if (meetingGate.ok) {
      return { ...meetingDraft, specVerification: meetingGate };
    }
  }

  const shortIdea = req.idea.slice(0, 30).trim();
  // Default to Korean (the route defaults locale to "ko"). English only when the
  // caller explicitly asked for it. This branch is the generic non-meeting draft
  // that a first-time non-dev user hits when the LLM is unavailable.
  if (req.locale === "en") {
    return {
      ok: true,
      source: "mock-fallback",
      understood: {
        summary: `An app that handles ${shortIdea}.`,
        targetUsers: ["General users", "Teams that want to work more efficiently"],
        mainFlow: ["Enter data", "Process automatically", "Review the result", "Send to an external tool"],
      },
      questions: [
        {
          id: "q1",
          question: "Should the user review and confirm the result before it proceeds?",
          recommendation: "Confirm before proceeding",
          reason: "Reviewing an automated result once reduces problems caused by errors.",
          options: ["Confirm before proceeding", "Proceed automatically"],
          allowCustom: true,
          allowLater: true,
        },
        {
          id: "q2",
          question: "How long should processed data be kept?",
          recommendation: "Delete after processing",
          reason: "Keeping less unnecessary data lowers security risk.",
          options: ["Delete after processing", "Keep for a period", "Keep forever"],
          allowCustom: false,
          allowLater: true,
        },
        ...(solo
          ? []
          : [
              {
                id: "q3",
                question: "Is this a multi-user service or for personal use?",
                recommendation: "Multi-user",
                reason: "How users are separated changes data isolation, permissions, and billing.",
                options: ["Multi-user (team/org)", "Personal, single user"],
                allowCustom: false,
                allowLater: true,
              },
            ]),
      ],
      productSpec: {
        productName: shortIdea,
        oneLine: req.idea.slice(0, 60),
        targetUsers: ["General users"],
        problem: "Solves the problem the user described.",
        included: ["Core feature", "Result view", "Status display", "Error handling"],
        excluded: ["Secondary features deferred from the first version"],
        userFlow: ["1. Input or register", "2. Process or request", "3. Review the result", "4. Connect an external service"],
        decisions: [],
        openQuestions: ["Decide the concrete feature scope", "Choose the integration service"],
      },
      items: [
        { id: "req_001", title: "The core feature works end to end", status: "not_started", criteria: ["The main action works correctly", "The expected result appears on screen"] },
        { id: "req_002", title: "Processing status is visible", status: "not_started", criteria: ["A loading or progress indicator shows while processing", "A notification or screen change on completion"] },
        { id: "req_003", title: "The result can be reviewed", status: "not_started", criteria: ["A result list or detail view is shown", "Basic info like date and status is displayed"] },
        { id: "req_004", title: "Results can be exported or shared to an external tool", status: "not_started", criteria: ["An export or integration button is provided", "Success/failure of the send is shown"] },
        ...(solo
          ? []
          : [{ id: "req_005", title: "Other users' data is not visible", status: "not_started" as const, criteria: ["Only the signed-in user's data is shown", "Entering a URL directly cannot access another user's data"] }]),
        { id: "req_006", title: "Invalid input explains why", status: "not_started", criteria: ["Unsupported formats show a clear message", "Missing required fields show what is missing"] },
        { id: "req_007", title: "Failures can be retried", status: "not_started", criteria: ["An error message and retry button are shown", "The retry result is reflected on the same screen"] },
        { id: "req_008", title: "Past activity can be reviewed", status: "not_started", criteria: ["A history list is provided in date order", "Each record shows its status (done/failed, etc.)"] },
      ],
      warnings: ["This is a quick draft. Try again for a more tailored result."],
    };
  }

  return {
    ok: true,
    source: "mock-fallback",
    understood: {
      summary: `${shortIdea}을(를) 다루는 앱입니다.`,
      targetUsers: ["일반 사용자", "더 효율적으로 일하고 싶은 팀"],
      mainFlow: ["데이터 입력", "자동 처리", "결과 확인", "외부 도구로 전송"],
    },
    questions: [
      {
        id: "q1",
        question: "진행하기 전에 사용자가 결과를 확인하고 승인해야 하나요?",
        recommendation: "진행 전 확인",
        reason: "자동으로 만든 결과를 한 번 확인하면 오류로 인한 문제를 줄일 수 있어요.",
        options: ["진행 전 확인", "자동으로 진행"],
        allowCustom: true,
        allowLater: true,
      },
      {
        id: "q2",
        question: "처리한 데이터는 얼마나 보관해야 하나요?",
        recommendation: "처리 후 삭제",
        reason: "불필요한 데이터를 적게 보관할수록 보안 위험이 낮아져요.",
        options: ["처리 후 삭제", "일정 기간 보관", "계속 보관"],
        allowCustom: false,
        allowLater: true,
      },
      ...(solo
        ? []
        : [
            {
              id: "q3",
              question: "여러 사용자가 쓰는 서비스인가요, 개인용인가요?",
              recommendation: "여러 사용자",
              reason: "사용자를 어떻게 구분하느냐에 따라 데이터 분리, 권한, 요금 방식이 달라져요.",
              options: ["여러 사용자(팀/조직)", "개인, 단일 사용자"],
              allowCustom: false,
              allowLater: true,
            },
          ]),
    ],
    productSpec: {
      productName: shortIdea,
      oneLine: req.idea.slice(0, 60),
      targetUsers: ["일반 사용자"],
      problem: "사용자가 설명한 문제를 해결합니다.",
      included: ["핵심 기능", "결과 보기", "상태 표시", "오류 처리"],
      excluded: ["첫 버전에서는 미루는 부가 기능"],
      userFlow: ["1. 입력 또는 등록", "2. 처리 또는 요청", "3. 결과 확인", "4. 외부 서비스 연결"],
      decisions: [],
      openQuestions: ["구체적인 기능 범위 정하기", "연동할 서비스 선택하기"],
    },
    items: [
      { id: "req_001", title: "핵심 기능이 처음부터 끝까지 동작해야 함", status: "not_started", criteria: ["주요 동작이 정상적으로 작동함", "예상한 결과가 화면에 나타남"] },
      { id: "req_002", title: "처리 상태가 보여야 함", status: "not_started", criteria: ["처리 중에는 로딩/진행 표시가 나타남", "완료 시 알림 또는 화면 전환이 있음"] },
      { id: "req_003", title: "결과를 확인할 수 있어야 함", status: "not_started", criteria: ["결과 목록 또는 상세 화면이 보임", "날짜·상태 같은 기본 정보가 표시됨"] },
      { id: "req_004", title: "결과를 내보내거나 외부 도구로 공유할 수 있어야 함", status: "not_started", criteria: ["내보내기 또는 연동 버튼이 제공됨", "전송 성공/실패가 표시됨"] },
      ...(solo
        ? []
        : [{ id: "req_005", title: "다른 사용자의 데이터가 보이면 안 됨", status: "not_started" as const, criteria: ["로그인한 사용자의 데이터만 보임", "URL을 직접 입력해도 다른 사용자 데이터에 접근할 수 없음"] }]),
      { id: "req_006", title: "잘못된 입력은 이유를 알려줘야 함", status: "not_started", criteria: ["지원하지 않는 형식은 명확한 안내가 나옴", "필수 항목이 빠지면 무엇이 빠졌는지 표시됨"] },
      { id: "req_007", title: "실패한 작업은 다시 시도할 수 있어야 함", status: "not_started", criteria: ["오류 메시지와 다시 시도 버튼이 표시됨", "다시 시도 결과가 같은 화면에 반영됨"] },
      { id: "req_008", title: "지난 활동을 다시 볼 수 있어야 함", status: "not_started", criteria: ["날짜순 기록 목록이 제공됨", "각 기록의 상태(완료/실패 등)가 표시됨"] },
    ],
    warnings: ["임시 초안입니다. 다시 시도하면 더 맞춤형 결과를 받을 수 있습니다."],
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/** Loud, non-silent notice attached whenever a draft fails the user-words gate. */
function coverageWarning(v: SpecVerification, locale?: "ko" | "en"): string {
  const pct = Math.round(v.coverage * 100);
  const missing = v.missingWords.slice(0, 8).join(", ");
  return locale === "en"
    ? `This draft may not reflect what you typed — only ${pct}% of your words appear in it. Not reflected: ${missing}. Please review the draft carefully or try again.`
    : `초안이 입력하신 내용을 충분히 반영하지 못했을 수 있어요 (입력하신 단어의 ${pct}%만 반영됨). 반영되지 않은 단어: ${missing}. 초안을 그대로 믿지 마시고 내용을 확인하거나 다시 시도해주세요.`;
}

/** Attach the gate result (and a loud warning on failure) to a finished draft. */
function withVerification(
  req: IdeaToSpecDraftRequest,
  res: IdeaToSpecDraftResponse,
): IdeaToSpecDraftResponse {
  // P1 non-developer language: openQuestions is the field that leaked tool
  // names in live measurement. Sanitized here — the single choke point every
  // successful draft (LLM and mock alike) passes through. D13 extends the same
  // guarantee to the interactive questions (un-decidable native/storage/tool
  // questions are dropped, floor 3).
  res = {
    ...res,
    questions: filterQuestionsForNonDev(res.questions, userWordsOf(req)),
    productSpec: {
      ...res.productSpec,
      openQuestions: sanitizeOpenQuestions(
        res.productSpec.openQuestions,
        req.locale,
        userWordsOf(req),
      ),
    },
  };
  // D15: a solo app's spec body ships auth-free unless the user asked for it.
  if (detectSoloUse(req)) res = applySoloSpecGuard(res, userWordsOf(req));
  // P0-A: the deterministic feasibility warning rides on EVERY draft (LLM or
  // mock) — it's the honest "this needs a native build" heads-up, independent of
  // the coverage gate. Prepended so it's the first thing the user sees.
  const feas = feasibilityWarning(req);
  const base = feas ? [feas] : [];

  const v = res.specVerification ?? verifySpecAgainstUserWords(userWordsOf(req), gateDraftOf(res));
  if (v.ok) return { ...res, specVerification: v, warnings: [...base, ...(res.warnings ?? [])] };
  console.warn(
    `[workspace/generate] user-words gate failed: source=${res.source} coverage=${v.coverage.toFixed(2)} missing=${v.missingWords.slice(0, 8).join("|")}`,
  );
  return {
    ...res,
    specVerification: v,
    warnings: [...base, ...(res.warnings ?? []), coverageWarning(v, req.locale)],
  };
}

export async function generateIdeaToSpecDraft(
  req: IdeaToSpecDraftRequest,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
): Promise<IdeaToSpecDraftResponse | { ok: false; error: "llm_unavailable" }> {
  if (!req.idea?.trim()) {
    return { ...buildMockFallback(req), warnings: ["아이디어를 입력해주세요."] };
  }
  if (!anthropicApiKey) {
    console.warn("[workspace/generate] ANTHROPIC_API_KEY not set — using mock fallback");
    return withVerification(req, buildMockFallback(req));
  }

  const prompt = buildPrompt(req);
  let rawText = "";
  let llmUsage: LlmCallUsage | undefined;
  try {
    const call = await callAnthropic(anthropicApiKey, prompt, anthropicBaseUrl);
    rawText = call.text;
    llmUsage = call.usage;
  } catch (err) {
    console.error("[workspace/generate] LLM call failed:", err);
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  // Extract JSON — LLM sometimes wraps in code fences despite instructions
  const cleaned = rawText.replace(/```(?:json)?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Head of the model text (ops diagnostic — this only fires on failure).
    console.warn("[workspace/generate] LLM returned non-JSON. head:", cleaned.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("[workspace/generate] JSON parse failed. head:", cleaned.slice(0, 200));
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  if (!isValidResponse(parsed)) {
    console.warn("[workspace/generate] Response failed shape validation");
    return { ok: false as const, error: "llm_unavailable" as const };
  }

  // Ensure all items have status: "not_started"
  const data = parsed as Omit<IdeaToSpecDraftResponse, "ok" | "source">;
  data.items = data.items.map((item) => ({ ...item, status: "not_started" as const }));

  // The LLM can fabricate too — same deterministic gate as the mock path.
  // On failure the draft still ships, but with a loud "not reflected: …"
  // warning (never a silent rejection, never silent fabrication).
  return withVerification(req, { ok: true, source: "llm", ...data, llmUsage });
}
