/**
 * login-prompt.mjs — the value-moment login promotion (pure logic).
 *
 * Plan B: anonymous entry is friction-zero; the login ask appears exactly ONCE
 * value is felt — right after the first review result. Earlier (at entry) it
 * kills users who haven't seen value; later, anonymous data stays browser-bound
 * and is lost on device/browser change. The prompt is soft: dismissible, never
 * a gate — it protects the user's data, it doesn't ransom it.
 */

export const LOGIN_PROMPT_DISMISS_KEY = "simsa:login-prompt-dismissed";

/**
 * Should the "save your results — sign in" prompt show?
 * Pure + deterministic:
 *  - never while signed in (nothing to promote),
 *  - never before a review result exists (no value felt yet — too early),
 *  - never after an explicit dismissal (soft prompt, not a nag),
 *  - never while the session state is still unknown (null → don't flash a
 *    prompt that vanishes once the session fetch resolves).
 * @param {{ signedIn: boolean | null, hasResult: boolean, dismissed: boolean }} input
 * @returns {boolean}
 */
export function shouldPromptLogin(input) {
  const { signedIn, hasResult, dismissed } = input ?? {};
  if (signedIn !== false) return false; // signed in, or still unknown
  if (hasResult !== true) return false; // value moment not reached yet
  if (dismissed === true) return false;
  return true;
}

/**
 * Read the dismissal flag. Storage injected for tests; never throws.
 * @param {{ getItem(k: string): string | null } | null} [storage]
 */
export function isLoginPromptDismissed(storage) {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    return s ? s.getItem(LOGIN_PROMPT_DISMISS_KEY) === "1" : false;
  } catch {
    return false;
  }
}

/**
 * Persist the dismissal. Never throws.
 * @param {{ setItem(k: string, v: string): void } | null} [storage]
 */
export function dismissLoginPrompt(storage) {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) s.setItem(LOGIN_PROMPT_DISMISS_KEY, "1");
  } catch {}
}
