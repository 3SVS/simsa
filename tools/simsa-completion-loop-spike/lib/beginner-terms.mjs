// Train N6 (2026-09-24, 설계 D-17 · §8) — beginner-standard checks for the
// journey audit. Pure: takes text the browser step already collected, returns
// findings WITH the matched text (never counts alone — 2026-09-01 lesson).
//
// Default flow = idea / plan-paste / first visit. There, any developer term or
// external-account CTA is a P0: the audience was defined as non-developers and
// those words read as "you should already know this". On the existing-app and
// developer screens the same hits are informational (P2) — GitHub is the
// user's own word there.

/** Words a non-developer should never meet in the default flow. */
export const DEV_TERMS = [
  "GitHub", "repo", "PR", "diff", "Vercel", "Netlify", "Supabase", "Firebase",
  "Cursor", "Codex", "Windsurf", "Lovable", "Bolt", "v0", "클라우드", "증거 파일",
  "워크스페이스", "owner/repo",
];

/** Providers whose sign-in / connect buttons count as an external-account CTA. */
export const ACCOUNT_PROVIDERS = ["GitHub", "Google", "Vercel", "Netlify", "Supabase", "Firebase"];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Whole-token match for short/ambiguous terms (PR, v0, repo, diff) so "PRD",
 * "v0.13", "report" or "difference" do not fire; substring match otherwise.
 */
function termRegex(term) {
  const e = escapeRe(term);
  const needsBoundary = /^[A-Za-z0-9/]+$/.test(term) && term.length <= 5;
  // `(?!\.\d)` keeps "v0.13.2" (a version string) from firing for "v0".
  return needsBoundary ? new RegExp(`(^|[^A-Za-z0-9가-힣])(${e})(?=$|[^A-Za-z0-9가-힣])(?!\\.\\d)`, "g") : new RegExp(`(${e})`, "gi");
}

/**
 * @param {string} bodyText visible page text (whitespace-collapsed)
 * @param {{ terms?: string[], max?: number, context?: number }} [opts]
 * @returns {Array<{ term: string, snippet: string }>} one entry per distinct term, with ±context chars
 */
export function devTermHits(bodyText, opts = {}) {
  const text = String(bodyText ?? "");
  const terms = opts.terms ?? DEV_TERMS;
  const max = opts.max ?? 8;
  const ctx = opts.context ?? 40;
  const out = [];
  for (const term of terms) {
    const re = termRegex(term);
    const m = re.exec(text);
    if (!m) continue;
    const at = m.index + (m[1] && m[2] ? m[1].length : 0);
    const snippet = text.slice(Math.max(0, at - ctx), Math.min(text.length, at + term.length + ctx)).trim();
    out.push({ term, snippet });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * @param {string[]} actionTexts visible button/link labels
 * @returns {string[]} labels that read as "sign in with / connect <provider>"
 */
export function accountCtaLabels(actionTexts) {
  const re = new RegExp(`(${ACCOUNT_PROVIDERS.map(escapeRe).join("|")})`, "i");
  const seen = new Set();
  const out = [];
  for (const raw of actionTexts ?? []) {
    const t = String(raw ?? "").trim();
    if (!t || !re.test(t)) continue;
    // A link whose label IS a URL is the user's own app address (e.g.
    // my-app.vercel.app in a report) — not an account CTA. Signal, not noise.
    if (/^https?:\/\//i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, 60));
  }
  return out;
}

/** Journeys where the beginner standard applies at P0 severity. */
export function isDefaultFlowJourney(journeyName) {
  return /^J0\b|^J2\b|^J7\b/.test(String(journeyName ?? ""));
}

/**
 * First-visit locale check: a ko-KR browser with no stored preference must see
 * Korean; an en-US browser must not see a Korean headline.
 * @param {"ko-KR"|"en-US"} browserLocale
 * @param {string[]} h1s
 */
export function firstVisitLocaleMismatch(browserLocale, h1s) {
  const h1 = (h1s ?? []).join(" ");
  const hangul = (h1.match(/[가-힣]/g) ?? []).length;
  if (!h1.trim()) return { mismatch: true, reason: "h1 없음" };
  if (browserLocale === "ko-KR" && hangul === 0) return { mismatch: true, reason: `ko-KR 브라우저인데 한글 0자: "${h1.slice(0, 80)}"` };
  if (browserLocale === "en-US" && hangul > 0) return { mismatch: true, reason: `en-US 브라우저인데 한글 ${hangul}자: "${h1.slice(0, 80)}"` };
  return { mismatch: false, reason: "" };
}
