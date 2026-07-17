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
    typeField: (q: string) => `입력창에 '${q}' 입력하기`,
    observeResults: "검색 결과 화면 확인",
    observeFirstScreen: "첫 화면 확인 (안전하게 실행할 동작을 못 찾음)",
  },
  en: {
    clickCta: (text: string) => `Press the main button '${text}'`,
    observeAfterClick: "Check the screen after pressing the button",
    typeQuery: (q: string) => `Type '${q}' into the search box`,
    typeField: (q: string) => `Type '${q}' into the input field`,
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
  // D5② (2026-07-17 accuracy eval): the common single-purpose vibe-app verbs.
  // Before this tier, "추가/저장/계산하기…" scored 0 and the app's ONE button was
  // never clicked — every input+button app collapsed into "확인 필요".
  /추가|저장|기록|계산|변환|만들|생성|올리기|업로드|입력|조회|add|save|create|submit|calculate|convert|upload|record/i,
];

/** D5③: with at most this many safe CTAs, the page is single-purpose-shaped
 *  and the first safe CTA is the flow even when no vocabulary tier matches.
 *  A parameter, not a principle. */
const FEW_CTA_MAX = 4;

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

/**
 * Pick the best safe CTA, or null. Pure & deterministic. Three tiers (D5,
 * 2026-07-17 accuracy eval — docs/simsa-inspection-accuracy-eval-2026-07-17.md):
 *   ① a CTA the intent NAMES verbatim ("추가 버튼을 누르면…" → the '추가' button)
 *   ② the action-vocabulary priority match (existing behavior, vocab broadened)
 *   ③ few-CTA fallback: on a single-purpose-shaped page (≤ FEW_CTA_MAX safe
 *      CTAs) the first safe CTA is the flow.
 * The forbidden filter applies to every tier.
 */
export function pickSafeCta(
  ctas: DetectedCta[],
  forbidden: string[],
  intentAnchor = "",
): DetectedCta | null {
  const safe = ctas.filter((c) => (c.text || "").trim().length > 0 && !isForbidden(c.text, forbidden));

  // ① intent-named CTA — the user's own words pick the button (longest match wins).
  let named: DetectedCta | null = null;
  for (const c of safe) {
    const t = c.text.trim();
    if (t.length >= 2 && intentAnchor.includes(t) && (!named || t.length > named.text.trim().length)) {
      named = c;
    }
  }
  if (named) return named;

  // ② vocabulary tiers.
  let best: DetectedCta | null = null;
  let bestScore = 0;
  for (const c of safe) {
    const score = ctaScore(c.text);
    if (score <= 0) continue;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best) return best;

  // ③ single-purpose-shaped page.
  if (safe.length > 0 && safe.length <= FEW_CTA_MAX) return safe[0]!;
  return null;
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
 * Build the deep flow plan (D6, 2026-07-17 accuracy eval):
 *   - Input AND a safe CTA → type, then CLICK the CTA (the form journey — this
 *     is what actually fires a button-submitted app's action, e.g. a Potemkin
 *     app's backend call), then observe.
 *     Exception: a search-oriented intent with a non-search, un-named CTA keeps
 *     the type→Enter path (golf-now case: don't click "보험 가입하기" after
 *     typing a search).
 *   - Only a CTA → click it, then observe.
 *   - Only an input → type (Enter submits), then observe.
 * If neither exists, the plan is just a single observe (nothing safe to drive).
 */
export function planVisualFlow(input: FlowPlanInput): FlowStep[] {
  const forbidden = input.forbidden && input.forbidden.length ? input.forbidden : DEFAULT_FORBIDDEN;
  const locale = input.locale === "en" ? "en" : "ko";
  const L = FLOW_LABELS[locale];
  const sampleQuery =
    input.sampleQuery && input.sampleQuery.trim() ? input.sampleQuery.trim() : DEFAULT_SAMPLE_QUERY[locale];
  const steps: FlowStep[] = [];

  const cta = pickSafeCta(input.ctas ?? [], forbidden, input.intentAnchor ?? "");
  const input0 = pickPrimaryInput(input.inputs ?? []);
  const searchOriented = intentIsSearchOriented(input.intentAnchor);

  // Intent alignment: when the goal is to CHECK/SEARCH something and a search box exists, prefer
  // typing into it over clicking a non-search CTA (e.g. don't click "보험 가입하기" for a
  // "check course conditions" intent). A CTA that is itself a search/check action still wins.
  const ctaNamedByIntent = !!cta && (input.intentAnchor ?? "").includes(cta.text.trim());
  const preferInput = searchOriented && input0 && (!cta || !(ctaIsSearchLike(cta.text) || ctaNamedByIntent));

  // D8: a benign value the input actually accepts — "서울" in a number field
  // throws at fill time and poisoned the whole run as "couldn't interact".
  const typeValue = input0 && input0.type === "number" ? "5" : sampleQuery;
  const typeLabel =
    input0 && (input0.type === "search" || /search|검색|찾기/i.test(input0.placeholder))
      ? L.typeQuery(typeValue)
      : L.typeField(typeValue);

  const pushType = (i: DetectedInput) =>
    steps.push({ action: "type", label: typeLabel, selector: i.selector, value: typeValue, placeholder: i.placeholder });
  const pushClick = (c: DetectedCta) =>
    steps.push({ action: "click", label: L.clickCta(c.text), selector: c.selector, targetText: c.text });

  if (input0 && cta && !preferInput) {
    pushType(input0);
    pushClick(cta);
    steps.push({ action: "observe", label: L.observeAfterClick });
    return steps;
  }

  if (cta && !preferInput) {
    pushClick(cta);
    steps.push({ action: "observe", label: L.observeAfterClick });
    return steps;
  }

  if (input0) {
    pushType(input0);
    steps.push({ action: "observe", label: L.observeResults });
    return steps;
  }

  steps.push({ action: "observe", label: L.observeFirstScreen });
  return steps;
}
