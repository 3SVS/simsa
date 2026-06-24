// Stage 170 — local-only account preferences (no auth, no server).
// Pure helpers + localStorage access, React-free so they run under the dashboard
// `node --test test/*.test.mjs` runner. Display name is stored LOCALLY in the
// browser only — never sent to a server, never an identity.

export const ACCOUNT_DISPLAY_NAME_KEY = "conclave:account:displayName";
export const DISPLAY_NAME_MAX = 80;
export const DEFAULT_DISPLAY_NAME = "Simsa user";

/** Trim, cap at 80 chars, fall back to a default when empty. Never throws. */
export function normalizeDisplayName(raw, fallback = DEFAULT_DISPLAY_NAME) {
  const s = typeof raw === "string" ? raw : "";
  const trimmed = s.trim().slice(0, DISPLAY_NAME_MAX);
  return trimmed || (typeof fallback === "string" && fallback.trim() ? fallback : DEFAULT_DISPLAY_NAME);
}

/** First letter of a display name (uppercase), for the avatar initial. */
export function displayInitial(name, fallback = "S") {
  const n = normalizeDisplayName(name, "");
  return (n[0] ?? fallback).toUpperCase();
}

/** Read the locally-stored display name (never throws). */
export function readDisplayName(storage, fallback = DEFAULT_DISPLAY_NAME) {
  try {
    return normalizeDisplayName(storage?.getItem?.(ACCOUNT_DISPLAY_NAME_KEY), fallback);
  } catch {
    return normalizeDisplayName("", fallback);
  }
}

/** Persist the display name locally (never throws). Empty clears to default. */
export function writeDisplayName(storage, value) {
  try {
    storage?.setItem?.(ACCOUNT_DISPLAY_NAME_KEY, normalizeDisplayName(value));
  } catch {
    /* ignore */
  }
}
