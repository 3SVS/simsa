/**
 * connect-url.mjs — pure deploy-URL normaliser for the D1-b re-entry page.
 *
 * Soft validation: accepts a bare host ("myapp.vercel.app") by defaulting to
 * https://, rejects empty / scheme-less-non-http / host-less input. Kept as a
 * pure .mjs (+ .d.mts types) so Node 20 `node --test` can exercise it without
 * type-stripping. No network, no side effects.
 */

/**
 * @param {unknown} input
 * @returns {{ ok: true, url: string } | { ok: false, reason: "empty" | "invalid" | "scheme" | "host" }}
 */
export function normalizeDeployUrl(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, reason: "empty" };

  // A scheme other than http(s) (e.g. ftp:, javascript:) is rejected outright.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, reason: "scheme" };
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  // A deployed app needs a real host (a dotted domain). Bare "localhost" or a
  // single token has no dot — treat as not-yet-a-URL so the user fixes it.
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { ok: false, reason: "host" };
  }
  return { ok: true, url: parsed.href };
}
