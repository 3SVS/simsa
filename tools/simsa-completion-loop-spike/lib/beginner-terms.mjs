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
 *
 * A Hangul letter AFTER the term is a boundary: Korean particles attach
 * directly to a Latin word ("PR이", "PR로", "repo를"), and treating them as
 * part of the word made every KO sentence with a particle slip past the check
 * (PR #558 검증 P2-9). Hangul BEFORE the term still counts as inside a word.
 */
function termRegex(term) {
  const e = escapeRe(term);
  const needsBoundary = /^[A-Za-z0-9/]+$/.test(term) && term.length <= 5;
  // `(?!\.\d)` keeps "v0.13.2" (a version string) from firing for "v0".
  return needsBoundary ? new RegExp(`(^|[^A-Za-z0-9가-힣])(${e})(?=$|[^A-Za-z0-9])(?!\\.\\d)`, "g") : new RegExp(`(${e})`, "gi");
}

/**
 * @param {string} bodyText visible page text (whitespace-collapsed)
 * @param {{ terms?: string[], max?: number, context?: number }} [opts]
 * @returns {Array<{ term: string, snippet: string }>} one entry per distinct term, with ±context chars
 */
export function devTermHits(bodyText, opts = {}) {
  const text = String(bodyText ?? "");
  // 주소 안의 단어는 사용자가 넣은 자기 앱 주소다(my-app.vercel.app) — 화면 문구가 아니다.
  // 같은 길이의 공백으로 가려 위치를 유지한 채 매칭만 건너뛴다(스니펫은 원문에서 자른다).
  const scan = text.replace(/https?:\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:app|dev|com|page|io|net|org|site)\b\S*/gi, (m) => " ".repeat(m.length));
  const terms = opts.terms ?? DEV_TERMS;
  const max = opts.max ?? 8;
  const ctx = opts.context ?? 40;
  const out = [];
  for (const term of terms) {
    const re = termRegex(term);
    const m = re.exec(scan);
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

/**
 * Journeys where the beginner standard applies at P0 severity.
 *
 *   J0 idea entry · J2 plan paste · J7 first visit (Train N6)
 *   J1 existing app — doors (b) "만든 앱이 안 돼요" and (c) "생각과 달라요"
 *      (C-J1, D-17 amend 2026-09-27: until now J1 was P2 only, so the beginner
 *      standard was invisible on two of the three doors)
 *   J6 build — door (a)'s delivery path (B-8); registered ahead so the journey
 *      is P0 from its first run
 *
 * A letter suffix is a variant of the same journey (J1b = repo only, J2e = EN
 * plan entry). The old `^J2\b` found no word boundary inside "J2e", so the EN
 * plan entry silently fell out of the default flow. J10 is not J1.
 */
export function isDefaultFlowJourney(journeyName) {
  return /^J(?:0|1|2|6|7)[a-z]?(?![A-Za-z0-9])/.test(String(journeyName ?? ""));
}

/**
 * D-17 amend (2026-09-27): only in the existing-app door is "connect your code
 * (GitHub)" an allowed OPTIONAL step — the user may well have pasted a GitHub
 * link themselves. There the word and a GitHub connect button drop to P2
 * (still recorded — signal kept, severity lowered); every other developer term
 * stays P0. Other journeys allow nothing.
 * @param {string} journeyName
 * @returns {{ terms: string[], providers: string[] }}
 */
export function beginnerAllowance(journeyName) {
  const name = String(journeyName ?? "");
  const existingAppDoor = /^J1[a-z]?(?![A-Za-z0-9])/.test(name);
  // 2026-10-04: J3 = 저장소 연결 여정 — 저장소(GitHub)를 잇는 것이 그 화면의 목적이다.
  const repoConnect = /^J3[a-z]?(?![A-Za-z0-9])/.test(name);
  return existingAppDoor || repoConnect ? { terms: ["GitHub"], providers: ["GitHub"] } : { terms: [], providers: [] };
}

function formatTermList(hits) {
  return hits.map((h) => `[${h.where ?? "본문"}] ${h.term}: "${h.snippet}"`).join(" ⟂ ");
}

function termFinding(sev, hits, note = "") {
  const mainCount = hits.filter((h) => (h.where ?? "본문") === "본문").length;
  return { sev, what: `개발 용어 노출 ${hits.length}건(본문 ${mainCount}${note}) — ${formatTermList(hits)}` };
}

function ctaFinding(sev, labels, note = "") {
  return { sev, what: `외부 계정 CTA ${labels.length}개${note} — ${labels.join(" / ")}` };
}

/**
 * The beginner-standard findings for one audited step (C-J1 — moved out of the
 * audit script so the severity rule is testable without a browser; the J1-is-P2
 * gap hid for exactly that reason). Messages always carry the matched text.
 *
 * @param {{ journeyName: string, devTerms?: Array<{ term: string, snippet: string, where?: string }>, accountCtas?: string[] }} input
 * @returns {Array<{ sev: "P0" | "P2" | "ALLOWED", what: string }>}
 */
export function beginnerFindings(input) {
  const { journeyName, devTerms = [], accountCtas = [] } = input ?? {};
  const out = [];
  if (!isDefaultFlowJourney(journeyName)) {
    // Developer / seeded screens: P2 only. In the repo-connect journey (J3) GitHub itself is
    // the subject of the screen → recorded as ALLOWED (2026-10-04); every other term stays P2.
    const allowNd = beginnerAllowance(journeyName);
    const okTerm = (h) => allowNd.terms.includes(h.term);
    const okCta = (l) => allowNd.providers.length > 0 && ACCOUNT_PROVIDERS.filter((p) => new RegExp(escapeRe(p), "i").test(l)).every((p) => allowNd.providers.includes(p));
    const p2Terms = devTerms.filter((h) => !okTerm(h));
    const okTerms = devTerms.filter(okTerm);
    const p2Ctas = accountCtas.filter((l) => !okCta(l));
    const okCtas = accountCtas.filter(okCta);
    if (p2Terms.length > 0) out.push(termFinding("P2", p2Terms));
    if (p2Ctas.length > 0) out.push(ctaFinding("P2", p2Ctas));
    if (okTerms.length > 0) out.push(termFinding("ALLOWED", okTerms, " · 저장소 연결 여정"));
    if (okCtas.length > 0) out.push(ctaFinding("ALLOWED", okCtas, " · 저장소 연결 여정"));
    return out;
  }
  const allow = beginnerAllowance(journeyName);
  const allowedTerm = (h) => allow.terms.includes(h.term);
  const blockedTerms = devTerms.filter((h) => !allowedTerm(h));
  const allowedTerms = devTerms.filter(allowedTerm);
  // A label is allowed only when every provider it names is allowed.
  const providersIn = (label) => ACCOUNT_PROVIDERS.filter((p) => new RegExp(escapeRe(p), "i").test(label));
  const allowedCta = (label) => {
    const named = providersIn(label);
    return named.length > 0 && named.every((p) => allow.providers.includes(p));
  };
  const blockedCtas = accountCtas.filter((l) => !allowedCta(l));
  const allowedCtas = accountCtas.filter(allowedCta);
  const note = " · 기존 앱 문의 선택 단계로 허용(D-17)";
  if (blockedTerms.length > 0) out.push(termFinding("P0", blockedTerms));
  if (blockedCtas.length > 0) out.push(ctaFinding("P0", blockedCtas));
  // 2026-10-04 (Bae "P2 확인하고 고쳐"): 잠긴 결정으로 허용된 노출은 결함이 아니다 — 문구와 함께
  // ALLOWED로 기록한다(버리지 않는다). 결함 수(P0~P2)에는 넣지 않는다.
  if (allowedTerms.length > 0) out.push(termFinding("ALLOWED", allowedTerms, note));
  if (allowedCtas.length > 0) out.push(ctaFinding("ALLOWED", allowedCtas, note));
  return out;
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
