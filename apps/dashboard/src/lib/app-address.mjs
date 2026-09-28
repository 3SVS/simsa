// 2026-09-28 (D4) — the overview's inline "app address" start: pure helpers.
//
// A non-developer who already built an app types (or pastes) the address it
// opens at, presses one button, and lands on the real-app check. These helpers
// only do what the client can know: shape (http/https + a host) and which
// beginner sentence to show for a server error code. The server stays the
// final judge of the address (reachability, registration, limits).
//
// PURE — no network, no storage, no DOM.

/** Same cap the sources screen mirrors from the server (MAX_REFERENCE_LEN). */
const MAX_ADDRESS_LEN = 500;

/**
 * Normalize what the user typed into an app address.
 *
 * - Trims whitespace.
 * - A bare host ("my-app.lovable.app") gets "https://" — pasting without the
 *   scheme is the common case, and refusing it would be a pointless dead end.
 * - Accepts only http/https with a non-empty host. Anything else is "invalid";
 *   an empty box is "empty" (different sentence).
 *
 * @param {unknown} input
 * @returns {{ ok: true, url: string } | { ok: false, error: "empty" | "invalid" }}
 */
export function normalizeAppAddress(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, error: "empty" };
  if (raw.length > MAX_ADDRESS_LEN) return { ok: false, error: "invalid" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  // A bare host: no scheme, no spaces, at least one dot before any path.
  const candidate = hasScheme ? raw : /^[^\s/]+\.[^\s/]+/.test(raw) ? `https://${raw}` : raw;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "invalid" };
  if (!parsed.hostname) return { ok: false, error: "invalid" };
  // Keep what the user gave (minus whitespace / plus the scheme we added) —
  // the server normalizes for itself; rewriting here would surprise the user.
  return { ok: true, url: candidate };
}

/**
 * Map a server error code (connect-source or run) to a key under
 * t.commandCenter.addUrlErrors. Unknown codes → "generic" (never crash, never
 * show a raw code to a beginner).
 *
 * @param {unknown} code
 * @returns {"invalid" | "limit" | "notSaved" | "forbidden" | "busy" | "generic"}
 */
export function appAddressErrorKey(code) {
  switch (code) {
    case "invalid_url":
    case "invalid_reference":
    case "invalid_target_url":
    case "invalid_source":
    case "target_url_not_registered":
      return "invalid";
    case "source_limit_reached":
      return "limit";
    case "project_not_found":
    case "HTTP 404":
      return "notSaved";
    case "forbidden":
    case "HTTP 403":
      return "forbidden";
    case "rate_limited":
    case "HTTP 429":
      return "busy";
    default:
      return "generic";
  }
}

/**
 * What a press of "확인 시작" does with the address THIS box already saved
 * (#559 검증 결함 9). The box registers the address, then starts the check; if
 * the start fails (busy, network) the address stays registered.
 *
 *  - Same address pressed again → reuse that source (never register it twice).
 *  - The user corrected the address → the one saved a moment ago was a typo or
 *    the wrong app; remove it, then register the new one. Otherwise every
 *    corrected retry leaves a stray address behind, taking one of the
 *    project's limited slots and showing up in the Sources list. Removing it
 *    FIRST keeps a stray from being the reason the new one hits that limit.
 *
 * Only an address saved by this box in this visit is ever removed — nothing
 * the user added elsewhere, nothing a check already ran against.
 *
 * @param {{ url: string, sourceId: string } | null | undefined} saved
 * @param {string} url the normalized address being submitted now
 * @returns {{ reuseSourceId: string | null, removeSourceId: string | null }}
 */
export function addressSubmitPlan(saved, url) {
  if (!saved) return { reuseSourceId: null, removeSourceId: null };
  if (saved.url === url) return { reuseSourceId: saved.sourceId, removeSourceId: null };
  return { reuseSourceId: null, removeSourceId: saved.sourceId };
}
