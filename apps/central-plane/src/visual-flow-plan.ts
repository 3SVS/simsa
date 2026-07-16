/**
 * visual-flow-plan.ts — Stage 260A. Pure, deterministic planner for a DEEP user flow.
 *
 * Stage 258A's spike only clicked at most one homepage CTA. A non-developer's "does it actually
 * work?" needs the real journey exercised — including TYPING into the primary search/input and
 * observing the result, not just detecting a button. This module turns detected elements + the
 * intent into an ordered, safe FlowStep list. No browser here; the tool executes the plan.
 *
 * Safety: forbidden/destructive actions are never planned (they're filtered out). Typing uses a
 * benign sample query only.
 */

export interface DetectedCta {
  text: string;
  selector: string;
}
export interface DetectedInput {
  placeholder: string;
  type: string;
  selector: string;
}

export type FlowStep =
  | { action: "click"; label: string; selector: string; targetText: string }
  | { action: "type"; label: string; selector: string; value: string; placeholder: string }
  | { action: "observe"; label: string };

export interface FlowPlanInput {
  intentAnchor: string;
  ctas: DetectedCta[];
  inputs: DetectedInput[];
  /** Forbidden action words; any CTA whose text matches is never planned. */
  forbidden?: string[];
  /** Benign value typed into a search/text input. Deterministic; default a common region term. */
  sampleQuery?: string;
  /**
   * Language for the step LABELS. These are Simsa's own prose and they are
   * quoted verbatim into the report ("The '…' step didn't complete"), so a
   * Korean label lands untranslated in the middle of an English sentence.
   * Default "ko" — the report builder's default, kept in step.
   */
  locale?: "ko" | "en";
}

/** Step labels. Keep every entry in both locales — see FlowPlanInput.locale. */
const FLOW_LABELS = {
  ko: {
    clickCta: (text: string) => `핵심 버튼 '${text}' 누르기`,
    observeAfterClick: "버튼을 누른 뒤 화면 확인",
    typeQuery: (q: string) => `검색창에 '${q}' 입력하기`,
    observeResults: "검색 결과 화면 확인",
    observeFirstScreen: "첫 화면 확인 (안전하게 실행할 동작을 못 찾음)",
  },
  en: {
    clickCta: (text: string) => `Press the main button '${text}'`,
    observeAfterClick: "Check the screen after pressing the button",
    typeQuery: (q: string) => `Type '${q}' into the search box`,
    observeResults: "Check the search results screen",
    observeFirstScreen: "Check the first screen (no action was safe to run)",
  },
} as const;

/**
 * The query typed into a search box. It goes into the TARGET app, so it has to
 * suit the app's audience rather than the report's reader — but with nothing
 * better to go on, the reader's language is the best available signal, and a
 * Korean term in an English app returns nothing (making the flow look broken
 * when it isn't).
 */
const DEFAULT_SAMPLE_QUERY = { ko: "서울", en: "Seoul" } as const;

const DEFAULT_FORBIDDEN = [
  "pay",
  "payment",
  "checkout",
  "subscribe",
  "buy",
  "purchase",
  "delete",
  "remove",
  "destroy",
  "send",
  "invite",
  "publish",
  "deploy",
  "logout",
  "sign out",
  "로그아웃",
  "삭제",
  "결제",
  "구매",
  "발행",
  "배포",
];

const INTENT_CTA_PRIORITY = [
  /get started|getting started/i,
  /check|conditions|playab|플레이|컨디션|확인/i,
  /find|search|browse|explore|검색|찾기|둘러보기/i,
  /start|시작/i,
  /sign ?up|signup|register|가입|등록/i,
  /begin|try|continue|join|다음|계속/i,
];

function isForbidden(text: string, forbidden: string[]): boolean {
  const t = (text || "").toLowerCase();
  return forbidden.some((f) => t.includes(f.toLowerCase()));
}

function ctaScore(text: string): number {
  for (let i = 0; i < INTENT_CTA_PRIORITY.length; i++) {
    const re = INTENT_CTA_PRIORITY[i];
    if (re && re.test(text)) return INTENT_CTA_PRIORITY.length - i;
  }
  return 0;
}

/** Pick the best safe CTA that matches the intent, or null. Pure & deterministic. */
export function pickSafeCta(ctas: DetectedCta[], forbidden: string[]): DetectedCta | null {
  let best: DetectedCta | null = null;
  let bestScore = 0;
  for (const c of ctas) {
    const score = ctaScore(c.text);
    if (score <= 0) continue;
    if (isForbidden(c.text, forbidden)) continue;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Pick the primary search/text input (prefers a search-like placeholder). */
export function pickPrimaryInput(inputs: DetectedInput[]): DetectedInput | null {
  const searchy = inputs.find((i) => /search|검색|찾기|이름|지역|course|course|q\b/i.test(i.placeholder) || i.type === "search");
  return searchy ?? inputs[0] ?? null;
}

/** True when the INTENT itself is about checking/searching/finding (not signing up / onboarding). */
export function intentIsSearchOriented(intent: string): boolean {
  return /확인|검색|찾|조건|컨디션|둘러|playab|conditions?|check|find|search|browse|explore/i.test(intent || "");
}

/** True when a CTA's own text is a search/check/find action (so clicking it *is* the intent action). */
export function ctaIsSearchLike(text: string): boolean {
  return /검색|찾|확인|조건|컨디션|둘러|check|find|search|browse|explore|conditions?/i.test(text || "");
}

/**
 * Build the deep flow plan:
 *   - If a safe intent CTA exists → click it, then observe.
 *   - Else if a search/text input exists → type a benign query into it, then observe.
 *   - Always ends by observing the result screen.
 * If neither exists, the plan is just a single observe (nothing safe to drive).
 */
export function planVisualFlow(input: FlowPlanInput): FlowStep[] {
  const forbidden = input.forbidden && input.forbidden.length ? input.forbidden : DEFAULT_FORBIDDEN;
  const locale = input.locale === "en" ? "en" : "ko";
  const L = FLOW_LABELS[locale];
  const sampleQuery =
    input.sampleQuery && input.sampleQuery.trim() ? input.sampleQuery.trim() : DEFAULT_SAMPLE_QUERY[locale];
  const steps: FlowStep[] = [];

  const cta = pickSafeCta(input.ctas ?? [], forbidden);
  const input0 = pickPrimaryInput(input.inputs ?? []);
  const searchOriented = intentIsSearchOriented(input.intentAnchor);

  // Intent alignment: when the goal is to CHECK/SEARCH something and a search box exists, prefer
  // typing into it over clicking a non-search CTA (e.g. don't click "보험 가입하기" for a
  // "check course conditions" intent). A CTA that is itself a search/check action still wins.
  const preferInput = searchOriented && input0 && (!cta || !ctaIsSearchLike(cta.text));

  if (cta && !preferInput) {
    steps.push({ action: "click", label: L.clickCta(cta.text), selector: cta.selector, targetText: cta.text });
    steps.push({ action: "observe", label: L.observeAfterClick });
    return steps;
  }

  if (input0) {
    steps.push({
      action: "type",
      label: L.typeQuery(sampleQuery),
      selector: input0.selector,
      value: sampleQuery,
      placeholder: input0.placeholder,
    });
    steps.push({ action: "observe", label: L.observeResults });
    return steps;
  }

  steps.push({ action: "observe", label: L.observeFirstScreen });
  return steps;
}
