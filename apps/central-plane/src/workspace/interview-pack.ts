/**
 * workspace/interview-pack.ts — C-A7 인터뷰 프롬프트 팩 (재정렬 2026-09-27 §3 W2~W3 문 (c)).
 *
 * 문 (c) "만들었는데 생각과 달라요"의 어려움: 앱은 **작동한다.** 그래서 앱에서 읽어낸 것(역추론)만으로는
 * 무엇이 "다른지" 알 수 없다 — 다른지는 유저의 머릿속에 있다. 그 머릿속을 꺼내는 가장 싼 방법은
 * 유저가 이미 쓰고 있는 AI 채팅에게 인터뷰를 맡기는 것이다(우리 LLM 비용 0, 유저 언어 그대로).
 *
 * 두 순수 함수가 **같은 양식**을 공유한다(양식은 여기 한 곳에만 있다):
 *   - buildInterviewPrompt: 유저가 자기 AI 채팅에 그대로 붙여넣는 한 덩어리 텍스트(KO/EN).
 *     AI에게 "한 번에 질문 하나씩, 끝나면 아래 고정 양식으로만"을 지시한다.
 *   - parseInterviewAnswer: 유저가 붙여넣은 AI의 답을 회수한다. **관대하게** 읽고(양식 앞뒤 잡담·
 *     마크다운·키 번역·코드블록), 못 읽은 것은 지어내지 않고 `unread`로 정직하게 돌려준다.
 *     결과 모양은 Zod로 한 번 더 고정한다(외부 경계 — 유저가 붙여넣은 텍스트).
 *
 * 고정 양식(줄 단위 키, 키 이름은 언어와 무관하게 영문):
 *   INTENT: 원래 하려던 일 한 문장
 *   MUST:
 *   - 반드시 되어야 하는 것 (한 줄에 하나)
 *   NOT_NEEDED:
 *   - 없어도 되는 것
 *   DIFFERENT_NOW:
 *   - 지금 앱이 생각과 다른 점
 *   END
 *
 * 금칙(초보자 기본 흐름): 이 텍스트는 유저가 읽고 복사한다 — 개발 용어·도구 이름을 쓰지 않는다.
 */
import { z } from "zod";

export type InterviewLocale = "ko" | "en";

export const INTERVIEW_SECTIONS = ["intent", "must", "notNeeded", "differentNow"] as const;
export type InterviewSection = (typeof INTERVIEW_SECTIONS)[number];

export const MAX_ANSWER_CHARS = 20_000;
const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 200;
const MAX_INTENT_CHARS = 300;
const MAX_FEATURES_IN_PROMPT = 15;

// ─── 프롬프트 ────────────────────────────────────────────────────────────────

export type InterviewPackInput = {
  locale: InterviewLocale;
  /** 앱 이름(프로젝트 제목). 없으면 생략. */
  appName?: string | null;
  /** 앱 주소(등록된 웹사이트 소스). 없으면 생략. */
  appUrl?: string | null;
  /** 역추론 지시서 요약 — 앱에서 읽어낸 기능과, 유저가 확인했는지. */
  features: ReadonlyArray<{ title: string; confirmed: boolean }>;
};

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export function buildInterviewPrompt(input: InterviewPackInput): string {
  const ko = input.locale !== "en";
  const feats = input.features
    .map((f) => ({ title: clean(String(f.title ?? ""), 120), confirmed: f.confirmed === true }))
    .filter((f) => f.title.length > 0)
    .slice(0, MAX_FEATURES_IN_PROMPT);
  const confirmed = feats.filter((f) => f.confirmed).map((f) => `- ${f.title}`);
  const unconfirmed = feats.filter((f) => !f.confirmed).map((f) => `- ${f.title}`);
  const name = input.appName ? clean(input.appName, 80) : "";
  const url = input.appUrl ? clean(input.appUrl, 300) : "";

  if (ko) {
    const appLine = name && url ? `제 앱: ${name} (${url})` : name ? `제 앱: ${name}` : url ? `제 앱 주소: ${url}` : "제 앱";
    return [
      "당신은 제가 만든 앱의 \"원래 의도\"를 함께 정리해 주는 인터뷰 도우미입니다.",
      "",
      appLine,
      "이 앱은 작동은 하지만, 제가 처음 생각한 것과 다른 부분이 있습니다.",
      "아래는 앱에서 읽어낸 기능 목록입니다.",
      "",
      "[제가 맞다고 확인한 기능]",
      ...(confirmed.length ? confirmed : ["- (아직 없음)"]),
      "[아직 확인하지 않은 기능 — 정말 필요한지 모릅니다]",
      ...(unconfirmed.length ? unconfirmed : ["- (없음)"]),
      "",
      "진행 방법:",
      "1. 저에게 한 번에 질문 하나만 하세요. 제 답을 들은 뒤 다음 질문을 하세요.",
      "2. 알아내야 할 것은 네 가지입니다: 원래 하려던 일(한 문장), 반드시 되어야 하는 것, 없어도 되는 것, 지금 앱이 제 생각과 다른 점.",
      "3. 쉬운 말로 물어보고, 질문은 8개 안에서 끝내세요. 어려운 기술 용어는 쓰지 마세요.",
      "4. 다 물어봤으면 아래 양식으로만 답하세요. 양식 앞뒤에 다른 말을 붙이지 마세요.",
      "   키 이름(INTENT, MUST, NOT_NEEDED, DIFFERENT_NOW, END)은 영어 그대로 두고, 내용은 한국어로 쓰세요.",
      "",
      "INTENT: (원래 하려던 일 한 문장)",
      "MUST:",
      "- (반드시 되어야 하는 것 — 한 줄에 하나, 8개까지)",
      "NOT_NEEDED:",
      "- (없어도 되는 것 — 없으면 \"- 없음\")",
      "DIFFERENT_NOW:",
      "- (지금 앱이 제 생각과 다른 점 — 한 줄에 하나)",
      "END",
      "",
      "그럼 첫 질문부터 시작해 주세요.",
    ].join("\n");
  }

  const appLine = name && url ? `My app: ${name} (${url})` : name ? `My app: ${name}` : url ? `My app's address: ${url}` : "My app";
  return [
    "You are an interview helper. Help me pin down what I originally meant my app to do.",
    "",
    appLine,
    "The app works, but some parts are not what I had in mind.",
    "Here is what was read from the app:",
    "",
    "[Things I confirmed are right]",
    ...(confirmed.length ? confirmed : ["- (none yet)"]),
    "[Things I have not confirmed — I am not sure they are needed]",
    ...(unconfirmed.length ? unconfirmed : ["- (none)"]),
    "",
    "How to do it:",
    "1. Ask me one question at a time. Wait for my answer before the next one.",
    "2. Find out four things: what I originally wanted to do (one sentence), what must work, what is not needed, and how the app is different from what I meant.",
    "3. Use plain words and finish within 8 questions. Avoid technical terms.",
    "4. When you are done, reply ONLY in the format below — nothing before or after it.",
    "   Keep the key names (INTENT, MUST, NOT_NEEDED, DIFFERENT_NOW, END) exactly as written.",
    "",
    "INTENT: (what I originally wanted to do, in one sentence)",
    "MUST:",
    "- (something that must work — one per line, up to 8)",
    "NOT_NEEDED:",
    "- (something that is not needed — write \"- none\" if nothing)",
    "DIFFERENT_NOW:",
    "- (how the app is different from what I meant — one per line)",
    "END",
    "",
    "Please start with your first question.",
  ].join("\n");
}

// ─── 파서 ────────────────────────────────────────────────────────────────────

/** 키 별칭 — AI가 키를 번역하거나 띄어 쓰는 경우까지(관대하게). 비교는 대문자·공백/밑줄 무시. */
const KEY_ALIASES: Record<InterviewSection, string[]> = {
  intent: ["INTENT", "GOAL", "PURPOSE", "ORIGINAL INTENT", "의도", "원래 의도", "원래 하려던 일", "목적"],
  must: ["MUST", "MUST HAVE", "MUST WORK", "MUSTS", "반드시", "반드시 되어야 하는 것", "꼭 되어야 하는 것", "필수"],
  notNeeded: ["NOT NEEDED", "NOTNEEDED", "NOT REQUIRED", "없어도 되는 것", "없어도 됨", "필요 없음", "불필요"],
  differentNow: ["DIFFERENT NOW", "DIFFERENTNOW", "DIFFERENCES", "DIFFERENT", "지금 다른 점", "다른 점", "지금과 다른 점"],
};

const normKey = (s: string) => s.normalize("NFC").toUpperCase().replace(/[\s_]+/g, " ").trim();
const KEY_INDEX: Array<[string, InterviewSection]> = INTERVIEW_SECTIONS.flatMap((sec) =>
  KEY_ALIASES[sec].map((a) => [normKey(a), sec] as [string, InterviewSection]),
);

// 선형 시간 규칙(C-A7 검증 P1, 2026-10-01): 이 파서는 인증 없이 누구나 부를 수 있는 라우트가 유저가 붙여넣은
// 긴 텍스트에 돌린다. 그래서 여기 정규식은 **겹치는 반복을 나란히 두지 않는다**(`(a+\s*)*`, `\s*(x)?\s*` 같은 것).
// 옛 키 줄 정규식 `^\s*(?:[#>*\-•·]+\s*)*…([^:：=]{1,30}?)…`은 '-'·'*'·'#'만 이어진 줄에서 지수적으로
// (대시 24개 ≈ 0.6초, 26개 ≈ 1초), 공백만 이어진 줄에서도 다항식으로(공백 1,000개 + 글자 > 30초) 되돌아가
// 줄 하나로 Worker CPU 한도를 다 썼다. 아래는 모두 구분자 탐색·앵커 붙은 단일 문자 클래스·짧은 머리로만 읽는다.

/** 키 머리(구분자 앞, 글머리를 벗긴 뒤)의 최대 길이 — 키(별칭 최대 12자 남짓) + 강조 기호 + 공백. 넘으면 키 줄이 아니다. */
const KEY_HEAD_MAX = 64;
/** 줄 앞의 글머리·제목·인용·강조 기호와 공백(한 번에 벗긴다 — 앵커 + 단일 클래스라 선형). */
const LEADING_DECOR = /^[\s#>*\-•·]+/;
/** 구분선 — 꾸밈 글자와 공백만 있는 줄(`---`·`***`·`===`·`───`). 빈 줄처럼 넘긴다(항목이 아니다). */
const DIVIDER_LINE = /^[\s\-*_=#~·•─━—–]+$/;

/** "INTENT: …" / "**MUST**:" / "## 의도：" / "- MUST:" → [section, 같은 줄의 나머지]. 키 줄이 아니면 null. */
function matchKeyLine(line: string): [InterviewSection, string] | null {
  const body = line.replace(LEADING_DECOR, "");
  // 키에는 구분자가 없으므로 줄의 첫 구분자가 곧 키의 끝이다(옛 정규식과 같은 규칙).
  const sep = body.search(/[:：=]/);
  if (sep < 1 || sep > KEY_HEAD_MAX) return null;
  const key = normKey(body.slice(0, sep).replace(/[*_`]/g, ""));
  if (!key) return null;
  const hit = KEY_INDEX.find(([k]) => k === key);
  if (!hit) return null;
  return [hit[1], stripLeadingEmphasis(body.slice(sep + 1)).trim()];
}

/** 값 앞의 `**`/`__`(키 강조가 콜론 뒤에서 닫힌 경우 — `**INTENT:** …`)와 공백. */
function stripLeadingEmphasis(s: string): string {
  const t = s.trimStart();
  return t.startsWith("**") || t.startsWith("__") ? t.slice(2) : t;
}

/** END 줄: `END` / `**END**` / `** END ** .` / `끝.` — 공백을 먼저 한 칸으로 줄여 겹치는 `\s*`를 없앴다. */
function isEndLine(line: string): boolean {
  const t = line.trim();
  if (t.length > 64) return false;
  return /^(?:\*\* ?)?(?:END|끝)(?: ?\*\*)?(?: ?\.)?$/i.test(t.replace(/\s+/g, " "));
}

const LIST_ITEM = /^\s*(?:[-*•·]|\d{1,2}[.)])\s+(.*)$/;
/** "없음"·"none"·"-" 같은 빈 값, 그리고 양식 안내문이 그대로 되돌아온 것(괄호로 감싼 설명). */
const EMPTY_VALUE = /^(?:없음|없습니다|해당 없음|none|nothing|n\/?a|-|—|\.\.\.|…)\.?$/i;
const TEMPLATE_ECHO = /^\(.*\)$/;
const QUOTE_CHARS = "\"'“”‘’";

/** 앞뒤 따옴표를 벗긴다 — 정규식 `["']+$`는 긴 따옴표 줄에서 자리마다 다시 훑어(제곱) 손으로 센다. */
function stripQuotes(v: string): string {
  let start = 0;
  let end = v.length;
  while (start < end && QUOTE_CHARS.includes(v.charAt(start))) start += 1;
  while (end > start && QUOTE_CHARS.includes(v.charAt(end - 1))) end -= 1;
  return v.slice(start, end);
}

function cleanValue(raw: string, max: number): string | null {
  let v = raw.normalize("NFC").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  v = stripQuotes(v).trim();
  if (!v || EMPTY_VALUE.test(v) || TEMPLATE_ECHO.test(v)) return null;
  return v.slice(0, max);
}

export const InterviewAnswerSchema = z
  .object({
    intent: z.string().min(1).max(MAX_INTENT_CHARS).nullable(),
    must: z.array(z.string().min(1).max(MAX_ITEM_CHARS)).max(MAX_ITEMS),
    notNeeded: z.array(z.string().min(1).max(MAX_ITEM_CHARS)).max(MAX_ITEMS),
    differentNow: z.array(z.string().min(1).max(MAX_ITEM_CHARS)).max(MAX_ITEMS),
    /** 양식에서 키 자체를 찾지 못한 칸 — 화면이 "이 부분은 읽지 못했어요"라고 말한다. */
    unread: z.array(z.enum(INTERVIEW_SECTIONS)),
    /** 양식 밖이라 버린 줄 수(잡담·인사말). 개수이지 점수가 아니다. */
    ignoredLines: z.number().int().min(0),
  })
  .strict();

export type InterviewAnswer = z.infer<typeof InterviewAnswerSchema>;

export type InterviewParseFailure =
  /** 빈 칸 */
  | "empty"
  /** 질문 묶음(프롬프트)을 답 대신 붙여넣었다 — AI에게 먼저 붙여넣어야 한다 */
  | "prompt_pasted"
  /** 양식 키를 하나도 못 찾았다 */
  | "no_format"
  /** 키는 있었지만 채워진 내용이 없었다(양식만 되돌아옴) */
  | "no_content";

export type InterviewParseResult = { ok: true; answer: InterviewAnswer } | { ok: false; reason: InterviewParseFailure };

/** 프롬프트 첫 문장(KO/EN) — 답 칸에 프롬프트를 붙여넣은 실수를 알아본다. */
const PROMPT_MARKERS = ["인터뷰 도우미입니다", "You are an interview helper"];

/**
 * 유저가 붙여넣은 AI의 답 → 의도·must·없어도 되는 것·지금 다른 점.
 * 모르는 줄은 버리고 센다. 키를 하나도 못 찾으면 `no_format`(지어내지 않는다).
 */
export function parseInterviewAnswer(text: unknown): InterviewParseResult {
  const raw = typeof text === "string" ? text.slice(0, MAX_ANSWER_CHARS) : "";
  if (!raw.trim()) return { ok: false, reason: "empty" };
  if (PROMPT_MARKERS.some((m) => raw.includes(m))) return { ok: false, reason: "prompt_pasted" };

  const lines = raw.normalize("NFC").replace(/\r\n?/g, "\n").split("\n");
  const seen = new Set<InterviewSection>();
  const intentParts: string[] = [];
  const lists: Record<Exclude<InterviewSection, "intent">, string[]> = { must: [], notNeeded: [], differentNow: [] };
  let current: InterviewSection | null = null;
  let ignored = 0;

  const push = (sec: InterviewSection, value: string) => {
    if (sec === "intent") {
      const v = cleanValue(value, MAX_INTENT_CHARS);
      if (v && intentParts.length === 0) intentParts.push(v);
      return;
    }
    // 같은 줄에 여러 개를 적은 경우(";" 또는 "|"로 구분) — 쉼표는 문장 안에서도 쓰이므로 나누지 않는다.
    // 앞뒤 공백은 cleanValue가 다듬는다(`\s*[;|]\s*`로 나누면 긴 공백에서 자리마다 다시 훑는다).
    for (const part of value.split(/[;|]/)) {
      const v = cleanValue(part, MAX_ITEM_CHARS);
      if (!v) continue;
      const list = lists[sec];
      if (list.length < MAX_ITEMS && !list.includes(v)) list.push(v);
    }
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) continue; // 코드블록 울타리
    if (isEndLine(line)) {
      if (seen.size > 0) break;
      continue;
    }
    if (!line.trim() || DIVIDER_LINE.test(line)) continue; // 빈 줄·구분선(---·***·===)은 내용이 아니다
    const key = matchKeyLine(line);
    if (key) {
      current = key[0];
      seen.add(current);
      if (key[1]) push(current, key[1]);
      continue;
    }
    if (!current) {
      ignored += 1; // 양식 앞의 인사말·설명
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) push(current, item[1] ?? "");
    else if (current === "intent" && intentParts.length === 0) push(current, line);
    else if (current !== "intent") push(current, line); // 글머리 없이 적은 목록 줄도 받는다
    else ignored += 1; // 의도는 한 문장 — 둘째 줄부터는 버린다
  }

  if (seen.size === 0) return { ok: false, reason: "no_format" };
  if (intentParts.length === 0 && lists.must.length === 0 && lists.notNeeded.length === 0 && lists.differentNow.length === 0) {
    return { ok: false, reason: "no_content" };
  }

  const answer = InterviewAnswerSchema.parse({
    intent: intentParts[0] ?? null,
    must: lists.must,
    notNeeded: lists.notNeeded,
    differentNow: lists.differentNow,
    unread: INTERVIEW_SECTIONS.filter((s) => !seen.has(s)),
    ignoredLines: ignored,
  });
  return { ok: true, answer };
}
