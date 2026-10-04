// C-J1 (Train C, 계획 2026-09-27 §5 · 2026-09-30) — screen-structure checks for
// the journey audit. Pure: takes what the browser step already collected and
// returns verdict material WITH the text it was based on (never a bare count —
// 2026-09-01 lesson: an unreadable measurement is no measurement).
//
// ① Dead end (P0). 2026-09-28 Bae live report: repo linked, no app address →
//    "첫 검수 실행하기" → /github → "0 개 열려 있는 코드 변경(PR)" + "…새로고침해주세요"
//    → no next button, journey stopped. The old audit's `deadEnd` was "zero
//    buttons on the page" — sidebar included, so it could never be true, and no
//    findings rule read it anyway.
// ② Same label, different destination (P1): two links with the same words on
//    one screen that go to different places.

/** Labels that go back or leave — not a way forward. */
const BACK_RE = /←|‹|뒤로|돌아가|처음 선택|모든 프로젝트|^back\b|\bback to\b|\ball projects\b/i;

/**
 * A reload is never a next step — "refresh after you push" was exactly the
 * dead end Bae hit.
 */
const RELOAD_RE = /새로고침|\brefresh\b|\breload\b|다시 불러오|목록 불러오|\bload (?:code changes|the list|more)\b/i;

/** Screen chrome: language toggle (inside <main> in the root layout), dismiss, sign-out. */
const CHROME_RE = /^(?:EN|KO|English|한국어)$|나중에|^later$|닫기|^close$|\bdismiss\b|숨기기|^hide\b|로그아웃|\bsign out\b|\blog out\b/i;

/**
 * Copy buttons and external links move the journey only when the screen puts
 * them forward as THE action (primary): "고침 지시 복사" is door (b)'s next step
 * (paste into the builder chat). A secondary copy / outbound link is not.
 * (Live baseline 2026-09-30: counting every copy as a dead-end utility gave a
 * false P0 on the run-detail screen.)
 */
const COPY_RE = /복사|\bcopy\b/i;

/** Planned mid-flight snapshots — same exception as the primary-CTA-0 rule. */
const IN_PROGRESS_LABEL_RE = /변환 중/;

/**
 * [PILOT] "Only an empty state on screen": at most this many forward actions
 * and this much text in <main>. The Bae screen had 1 forward link and ~330
 * chars; a report with a sub-section "아직 … 없어요" and four verdict buttons
 * is not an empty screen. Tune from audit results, not by feel.
 */
const EMPTY_SCREEN_MAX_FORWARD = 2;
const EMPTY_SCREEN_MAX_CHARS = 1200;

function normalizeText(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * @typedef {{ text: string, href?: string | null, external?: boolean, disabled?: boolean, primary?: boolean }} MainAction
 * @param {MainAction} a
 * @returns {"forward" | "back" | "reload" | "chrome" | "copy" | "external" | "disabled" | "unlabeled"}
 */
export function classifyAction(a) {
  const text = normalizeText(a?.text);
  if (!text) return "unlabeled";
  if (BACK_RE.test(text)) return "back";
  if (RELOAD_RE.test(text)) return "reload";
  if (CHROME_RE.test(text)) return "chrome";
  const href = typeof a?.href === "string" ? a.href : null;
  if (href !== null) {
    if (href === "#" || /^javascript:/i.test(href)) return "chrome";
    if (a?.external === true || /^(?:mailto|tel):/i.test(href)) return "external";
  }
  if (a?.disabled === true) return "disabled";
  if (COPY_RE.test(text)) return "copy";
  return "forward";
}

/** Does this action move the journey on? Copy / outbound only when put forward as primary. */
function movesForward(kind, a) {
  if (kind === "forward") return true;
  return (kind === "copy" || kind === "external") && a?.primary === true;
}

/**
 * Nouns that make "No … found" a GOOD result, not an empty list: "No problems
 * found" (visualChecks.worksNoProblems) · "No problem found" · "No issues were
 * found". The KO equivalents ("문제 없음" · "문제를 찾지 못했어요") never matched,
 * so the same clean-result screen was a P0 dead end in EN only (PR #571 검증 결함 6).
 */
const GOOD_RESULT_NOUN = String.raw`(?:problems?|issues?|blockers?|errors?|bugs?|defects?|failures?)\b`;

const EMPTY_STATE_PATTERNS = [
  /(?<![\d.,])0\s?(?:개|건)/,
  /아직\s[^.!?。]{0,24}?(?:없어요|없습니다|없네요|없음)/,
  // "No <list noun…> yet|found" — no word in between may be a good-result noun.
  new RegExp(String.raw`\bno\s(?:(?!${GOOD_RESULT_NOUN})[a-z()]+\s){0,4}?(?:yet|found)\b`, "i"),
  /\bnothing (?:here|yet)\b/i,
  /(?<![\d.,])0 (?:open|items?|results?|runs?|checks?|projects?)\b/i,
];

/**
 * The empty-state sentence ("0개", "아직 … 없어요", "No … yet", "Nothing here")
 * with ±40 chars of context, or "" when the screen shows none.
 * @param {string} mainText
 */
export function emptyStateSnippet(mainText) {
  const text = normalizeText(mainText);
  if (!text) return "";
  for (const re of EMPTY_STATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    return text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + m[0].length + 40)).trim();
  }
  return "";
}

/**
 * Is this screen a dead end?
 *   - no_forward_action: nothing in <main> moves the journey (back, language,
 *     reload, dismiss, secondary copy / external links and disabled buttons
 *     don't count — a disabled button counts only while there is a field that
 *     can enable it).
 *   - empty_state_without_action: the screen is essentially an empty state
 *     ("0 개 …", ≤ EMPTY_SCREEN_MAX_FORWARD forward actions, ≤ EMPTY_SCREEN_MAX_CHARS
 *     of text) and has no PRIMARY forward action — a secondary link like
 *     "이력 보기" is not "what to do next".
 *
 * @param {{ mainActions?: MainAction[], mainText?: string, hasEditableField?: boolean }} input
 * @returns {{ deadEnd: boolean, kind: "no_forward_action" | "empty_state_without_action" | null, forward: string[], primaryForward: string[], emptyState: string }}
 */
export function deadEndCheck(input) {
  const actions = Array.isArray(input?.mainActions) ? input.mainActions : [];
  const canEnable = input?.hasEditableField === true;
  const classified = actions.map((a) => ({ a, kind: classifyAction(a), text: normalizeText(a?.text) }));
  const forward = classified.filter((c) => movesForward(c.kind, c.a));
  // Disabled next step next to an input: fill the field and it turns on.
  const pending = canEnable ? classified.filter((c) => c.kind === "disabled") : [];
  const primaryForward = forward.filter((c) => c.a?.primary === true);
  const pendingPrimary = pending.filter((c) => c.a?.primary === true);
  const emptyState = emptyStateSnippet(input?.mainText);
  const result = (deadEnd, kind) => ({
    deadEnd,
    kind,
    forward: forward.map((c) => c.text).slice(0, 8),
    primaryForward: primaryForward.map((c) => c.text).slice(0, 4),
    emptyState,
  });
  if (forward.length + pending.length === 0) return result(true, "no_forward_action");
  const emptyScreen =
    emptyState !== "" &&
    forward.length <= EMPTY_SCREEN_MAX_FORWARD &&
    normalizeText(input?.mainText).length <= EMPTY_SCREEN_MAX_CHARS;
  if (emptyScreen && primaryForward.length + pendingPrimary.length === 0) return result(true, "empty_state_without_action");
  return result(false, null);
}

/** Query parameters that never change the destination (one-off nonces, tracking). */
const VOLATILE_PARAMS = new Set(["fresh", "nonce", "_rsc", "t", "ts"]);

function normalizeLabel(s) {
  return normalizeText(String(s ?? "").replace(/[→←↗↘›‹»«]/g, " "));
}

/** Destination identity: origin + path (no trailing slash) + sorted, non-volatile query. Hash ignored. */
function destination(href) {
  if (typeof href !== "string" || !href) return null;
  let u;
  try {
    u = new URL(href, "https://relative.invalid");
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !VOLATILE_PARAMS.has(k) && !k.startsWith("utm_"))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const qs = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
  const origin = u.origin === "https://relative.invalid" ? "" : u.origin;
  return { key: `${origin}${path}${qs}`, origin, local: `${path}${qs}` };
}

/**
 * Links on one screen whose words are the same but whose destinations differ.
 * @param {Array<{ text: string, href: string }>} links every visible <a href> on the page
 * @returns {Array<{ label: string, hrefs: string[] }>} hrefs are paths when the group shares an origin
 */
export function sameLabelDifferentHref(links) {
  /** @type {Map<string, { label: string, dests: Map<string, { origin: string, local: string }> }>} */
  const groups = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    const label = normalizeLabel(l?.text);
    if (!label) continue;
    const dest = destination(l?.href);
    if (!dest) continue;
    const key = label.toLowerCase();
    const g = groups.get(key) ?? { label, dests: new Map() };
    g.dests.set(dest.key, dest);
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.dests.size < 2) continue;
    const dests = [...g.dests.values()];
    const oneOrigin = new Set(dests.map((d) => d.origin)).size === 1;
    const hrefs = dests.map((d) => (oneOrigin ? d.local : `${d.origin}${d.local}`)).slice(0, 4);
    out.push({ label: g.label, hrefs });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Everything the structure checks need from one step, computed once and kept
 * on the result row (so a reader of journey-audit-result.json sees WHY).
 * @param {{ mainActions?: MainAction[], mainText?: string, hasEditableField?: boolean, links?: Array<{ text: string, href: string }> }} facts
 */
export function stepStructure(facts) {
  return {
    deadEnd: deadEndCheck(facts),
    sameLabel: sameLabelDifferentHref(facts?.links),
  };
}

/**
 * Findings from a step's structure: dead end → P0 (every journey — a dead end
 * is a dead end for anyone), same label/different destination → P1.
 * @param {{ label: string, structure?: ReturnType<typeof stepStructure> }} step
 * @returns {Array<{ sev: "P0" | "P1", what: string }>}
 */
export function structureFindings(step) {
  const structure = step?.structure;
  if (!structure) return [];
  const out = [];
  const de = structure.deadEnd;
  if (de?.deadEnd && !IN_PROGRESS_LABEL_RE.test(String(step?.label ?? ""))) {
    const why = de.kind === "empty_state_without_action"
      ? "빈 상태만 있고 다음 행동(주 버튼)이 없음"
      : "앞으로 가는 버튼·링크 0개";
    const empty = de.emptyState ? ` — 빈 상태: "${de.emptyState}"` : "";
    const seen = de.forward.length > 0 ? ` · 보이는 링크/버튼: ${de.forward.join(" / ")}` : "";
    out.push({ sev: "P0", what: `막다른 길 — ${why}${empty}${seen}` });
  }
  for (const g of structure.sameLabel ?? []) {
    out.push({ sev: "P1", what: `같은 라벨·다른 목적지 — "${g.label}": ${g.hrefs.join(" ⟂ ")}` });
  }
  return out;
}
