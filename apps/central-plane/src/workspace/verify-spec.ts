/**
 * workspace/verify-spec.ts
 *
 * Deterministic verify-against-user-words gate (audit v2 P0-honesty).
 *
 * The generation pipeline (mock OR LLM — both can fabricate) must produce a
 * spec that actually reflects the user's own words. This is a pure, LLM-free
 * check: take the content words of the user's idea (+ answers) and measure
 * what fraction of them appear anywhere in the generated draft. A draft that
 * misses most of the user's words is an unrelated product, not their product.
 *
 * Korean is agglutinative, so tokens are stemmed by stripping common particle
 * and verb-ending suffixes (조사/어미) before matching. Matching is substring
 * over the JSON-serialised draft, so "요약" matches "요약해서 보여줌".
 */

export type SpecVerification = {
  /** true = the draft reflects enough of the user's words to trust. */
  ok: boolean;
  /** matched / total content words, 0..1. 1 when there are too few words to judge. */
  coverage: number;
  totalWords: number;
  matchedWords: string[];
  /** The user's words the draft never mentions — shown to the user on failure
   *  so a rejection is never silent. */
  missingWords: string[];
};

/** Minimum fraction of the user's content words the draft must contain. */
export const MIN_USER_WORD_COVERAGE = 0.6;

/** Generic words that carry no product meaning — never count them. */
const STOPWORDS = new Set([
  // Korean generic
  "앱", "어플", "애플리케이션", "서비스", "웹", "웹사이트", "사이트", "홈페이지",
  "프로그램", "플랫폼", "기능", "제품", "버전", "사용자", "유저",
  "만들", "만드", "제작", "개발", "필요", "원해", "원합니다", "싶", "주세요",
  "그리고", "그래서", "또는", "혹은", "같은", "위한", "통해", "있는", "없는",
  "하는", "되는", "수", "것", "거", "게", "때", "등", "더", "잘", "좀",
  "한다", "하다", "된다", "되다", "있다", "없다", "해준다", "해줘", "해요",
  // English generic
  "app", "apps", "application", "service", "web", "website", "site", "page",
  "program", "platform", "feature", "features", "product", "version", "user", "users",
  "make", "makes", "making", "build", "builds", "building", "create", "creating",
  "want", "wants", "need", "needs", "would", "like", "please",
  "a", "an", "the", "to", "for", "of", "in", "on", "with", "and", "or", "that",
  "this", "it", "is", "are", "be", "can", "i", "my", "me", "we", "our", "you",
]);

/** Korean particles / verb endings stripped (longest first) to get a stem. */
const KO_SUFFIXES = [
  "하고싶어요", "하고싶어", "해주세요", "했으면", "싶어요", "입니다", "이에요",
  "해주는", "해줘", "해요", "하는", "해서", "하기", "하면", "하고", "하며",
  "해도", "해야", "한다", "하다", "합니다", "해주", "해",
  "되는", "된다", "되다", "돼요", "면서", "다는", "주는", "아서", "어서",
  "들이", "들을", "들은", "들의", "에서", "에게", "으로", "라는", "이라는",
  "까지", "부터", "처럼", "마다", "이나", "든지",
  "을", "를", "이", "가", "은", "는", "에", "로", "와", "과", "랑", "도",
  "의", "만", "요", "들", "고", "서", "며", "면", "야", "지", "게", "다",
].sort((a, b) => b.length - a.length);

function stemToken(raw: string): string {
  let t = raw;
  let changed = true;
  while (changed && t.length > 2) {
    changed = false;
    for (const suf of KO_SUFFIXES) {
      if (t.length - suf.length >= 2 && t.endsWith(suf)) {
        t = t.slice(0, t.length - suf.length);
        changed = true;
        break;
      }
    }
  }
  // English plural: "reviews" should match a draft that says "review".
  if (/^[a-z]+s$/.test(t) && t.length > 3) t = t.slice(0, -1);
  return t;
}

/** Extract deduplicated, stemmed content words from user text. Pure. */
export function contentWords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[\s.,!?;:"'“”‘’()\[\]{}<>/\\|@#$%^&*+=~`_—–-]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const raw of tokens) {
    if (STOPWORDS.has(raw)) continue;
    const stem = stemToken(raw);
    if (stem.length < 2) continue;
    if (STOPWORDS.has(stem)) continue;
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

/**
 * Measure how much of the user's own words the generated draft reflects. Pure
 * and deterministic — applies equally to mock and LLM output.
 *
 * `draft` is anything JSON-serialisable (productSpec + understood + items).
 * With fewer than 2 content words there is not enough signal to judge, so the
 * gate passes (never block a one-word idea on a heuristic).
 */
export function verifySpecAgainstUserWords(userText: string, draft: unknown): SpecVerification {
  const words = contentWords(userText);
  if (words.length < 2) {
    return { ok: true, coverage: 1, totalWords: words.length, matchedWords: words, missingWords: [] };
  }
  const hay = JSON.stringify(draft).toLowerCase();
  const matchedWords = words.filter((w) => hay.includes(w));
  const missingWords = words.filter((w) => !hay.includes(w));
  const coverage = matchedWords.length / words.length;
  return {
    ok: coverage >= MIN_USER_WORD_COVERAGE,
    coverage,
    totalWords: words.length,
    matchedWords,
    missingWords,
  };
}
