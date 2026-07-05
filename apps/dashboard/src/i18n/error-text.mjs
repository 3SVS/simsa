/**
 * error-text.mjs — map a raw backend error code / message to a friendly,
 * localized string. Non-developers must never read "db_error", "HTTP 500",
 * "fetch_failed", or a raw exception. Call at the render site:
 *
 *   {creditsError && <p>{errorText(t, creditsError)}</p>}
 *
 * Unknown codes fall back to `t.errors.generic` (or an explicit fallback key),
 * so a new server code degrades gracefully instead of leaking.
 */

/**
 * Known backend error codes → t.errors.* key. Keep the codes lowercase; the
 * matcher lowercases the input. HTTP status shapes (HTTP 5xx / 4xx) and
 * timeouts are handled heuristically below.
 */
const CODE_TO_KEY = {
  rate_limited: "rateLimited",
  ratelimited: "rateLimited",
  insufficient_credits: "insufficientCredits",
  github_scope_required: "githubScopeRequired",
  pr_not_found: "prNotFound",
  not_found: "notFound",
  project_not_found: "notFound",
  unauthorized: "unauthorized",
  unauthenticated: "unauthorized",
  userkey_required: "unauthorized",
  db_error: "server",
  server_error: "server",
  internal_error: "server",
  fetch_failed: "network",
  network: "network",
  timeout: "timeout",
  timed_out: "timeout",
  invalid_email: "saveFailed",
};

/**
 * @param {import("./dictionary.d.mts").Dictionary} t
 * @param {string | null | undefined} codeOrMessage
 * @param {keyof import("./dictionary.d.mts").Dictionary["errors"]} [fallbackKey]
 * @returns {string}
 */
export function errorText(t, codeOrMessage, fallbackKey = "generic") {
  const errors = t?.errors ?? {};
  const fallback = errors[fallbackKey] ?? errors.generic ?? "Something went wrong.";
  if (!codeOrMessage || typeof codeOrMessage !== "string") return fallback;

  if (codeOrMessage === "llm_unavailable") return errors.llmUnavailable ?? fallback;
  const raw = codeOrMessage.trim();
  const lower = raw.toLowerCase();

  // Exact known code.
  if (CODE_TO_KEY[lower] && errors[CODE_TO_KEY[lower]]) return errors[CODE_TO_KEY[lower]];

  // HTTP status shapes: "HTTP 500", "500", "http_502".
  const httpMatch = lower.match(/\b(?:http[ _-]?)?(\d{3})\b/);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 403) return errors.unauthorized ?? fallback;
    if (status === 404) return errors.notFound ?? fallback;
    if (status === 408) return errors.timeout ?? fallback;
    if (status === 429) return errors.rateLimited ?? fallback;
    if (status >= 500) return errors.server ?? fallback;
    if (status >= 400) return fallback;
  }

  // Substring hints for free-form messages / AbortError.
  if (lower.includes("abort") || lower.includes("timeout")) return errors.timeout ?? fallback;
  if (lower.includes("failed to fetch") || lower.includes("network")) return errors.network ?? fallback;

  return fallback;
}
