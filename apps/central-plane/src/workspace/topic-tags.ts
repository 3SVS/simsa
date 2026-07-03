/**
 * topic-tags.ts — classify a project's idea/spec into structured topic tags
 * (domain / integrations / ai_feature / pattern) for the market-map axis.
 *
 * Deterministic, dictionary-based (KR + EN keywords) — NOT an LLM call, so it's
 * free, hallucination-proof, and unit-testable. An LLM enrichment pass can be
 * layered later (P2) without changing the tag shape. Raw free text is never
 * stored here; only the structured tags come out.
 */

export type TopicTagsResult = {
  domain: string | null;
  pattern: string | null;
  integrations: string[];
  ai_feature: string | null;
};

/** domain → keyword signals (lowercased match against idea+spec text). */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  productivity: ["productivity", "todo", "task", "note", "meeting", "생산성", "할일", "업무", "노트", "회의", "일정"],
  commerce: ["shop", "store", "commerce", "ecommerce", "checkout", "payment", "커머스", "쇼핑", "상점", "결제", "판매", "주문"],
  social: ["social", "community", "chat", "feed", "follow", "소셜", "커뮤니티", "채팅", "피드", "친구"],
  finance: ["finance", "invest", "budget", "expense", "accounting", "금융", "투자", "예산", "가계부", "회계", "송금"],
  health: ["health", "fitness", "workout", "diet", "medical", "헬스", "건강", "운동", "다이어트", "의료", "병원"],
  education: ["education", "learn", "course", "quiz", "study", "교육", "학습", "강의", "퀴즈", "공부"],
  content: ["blog", "content", "video", "podcast", "newsletter", "블로그", "콘텐츠", "영상", "뉴스레터"],
  travel: ["travel", "trip", "booking", "hotel", "flight", "여행", "예약", "호텔", "항공"],
};

/** Known external tools/integrations to detect by name. */
const INTEGRATION_NAMES = [
  "Linear", "Stripe", "Notion", "Slack", "GitHub", "Discord", "Telegram", "Supabase",
  "Vercel", "Figma", "Airtable", "Zapier", "Twilio", "Sendgrid", "Resend", "OpenAI",
  "Anthropic", "Google", "Gmail", "Calendar", "Shopify", "Kakao", "Toss", "Naver",
];

/** ai_feature → keyword signals. */
const AI_FEATURE_KEYWORDS: Record<string, string[]> = {
  summarization: ["summar", "요약", "정리"],
  recommendation: ["recommend", "suggest", "추천"],
  generation: ["generate", "write", "draft", "create content", "생성", "작성", "만들어"],
  classification: ["classif", "categor", "tag", "분류", "카테고리", "태그"],
  extraction: ["extract", "parse", "추출", "파싱"],
  search: ["search", "semantic", "검색"],
  translation: ["translat", "번역"],
  transcription: ["transcri", "speech", "stt", "받아쓰", "음성"],
};

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}

/** Detect the input content language. Hangul → ko; otherwise en (coarse, extend later). */
export function detectContentLang(text: string): string | null {
  if (!text || !text.trim()) return null;
  if (/[가-힣]/.test(text)) return "ko"; // Hangul syllables
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}

/**
 * Classify idea + spec text into topic tags. Never throws; returns nulls/empties
 * when nothing matches (no invention).
 */
export function classifyTopics(text: string): TopicTagsResult {
  const lower = (text ?? "").toLowerCase();

  let domain: string | null = null;
  for (const [d, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    if (includesAny(lower, kws)) {
      domain = d;
      break;
    }
  }

  const integrations = INTEGRATION_NAMES.filter((name) => lower.includes(name.toLowerCase()));

  let ai_feature: string | null = null;
  for (const [f, kws] of Object.entries(AI_FEATURE_KEYWORDS)) {
    if (includesAny(lower, kws)) {
      ai_feature = f;
      break;
    }
  }

  // pattern: a light heuristic — "upload → AI → export" style flows.
  let pattern: string | null = null;
  const hasUpload = includesAny(lower, ["upload", "파일", "이미지", "import"]);
  const hasExport = includesAny(lower, ["export", "send", "내보내", "전송", "다운로드"]);
  if (hasUpload && ai_feature && hasExport) pattern = "upload->ai->export";
  else if (includesAny(lower, ["dashboard", "crud", "manage", "대시보드", "관리"])) pattern = "crud-dashboard";

  return { domain, pattern, integrations, ai_feature };
}
