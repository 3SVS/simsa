// F-5 (2026-07-20) — the CODE branch's lightweight intent interview.
//
// The code branch ("이미 만든 앱이 있어요") deliberately skips the full idea
// interview — that is its normal path, not a deficit. But a project created
// with zero intent gives the review nothing app-specific to check (Bae,
// journey-audit follow-up: "기존-앱 갈래 스킵이 맞나"). The lightweight answer
// is ONE extra optional question — "꼭 작동해야 하는 것" — composed with the
// one-line description into the spec-generation input. No hard gate: both
// fields stay optional, an empty interview still creates the project.
//
// PURE — no LLM, no network, no storage. The server generates in the user's
// saved locale; this only shapes the input text.

/**
 * Compose the spec-generation input from the code branch's two optional
 * fields. Returns "" when there is nothing to generate from (caller skips
 * the LLM call — the project simply starts without draft items, exactly
 * the pre-F-5 behavior).
 *
 * mustWork is split on newlines and commas so "로그인, 예약" and one-per-line
 * both work; blank fragments are dropped.
 *
 * @param {{ desc?: string | null, mustWork?: string | null, locale?: "en" | "ko" }} input
 * @returns {string}
 */
export function composeCodeIntent(input) {
  const f = input ?? {};
  const desc = String(f.desc ?? "").trim();
  const items = String(f.mustWork ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!desc && items.length === 0) return "";
  if (items.length === 0) return desc;

  const label = f.locale === "ko" ? "꼭 작동해야 하는 것" : "Must work";
  const bullets = items.map((s) => `- ${s}`).join("\n");
  return desc ? `${desc}\n\n${label}:\n${bullets}` : `${label}:\n${bullets}`;
}
