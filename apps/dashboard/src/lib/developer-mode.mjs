// Train N (2026-09-24, 설계 D-17) — "개발자 모드" local preference.
//
// The default flow is for non-developers: no GitHub / Vercel / Supabase words,
// no external-account CTAs. Anything that assumes the user is a developer
// (code-change tab, builder pack wording, Telegram, "Star on GitHub", Advanced
// tools) is gated behind this switch. Stored LOCALLY in the browser only, default
// OFF. Pure helpers + storage access, React-free so `node --test` covers them.

export const DEVELOPER_MODE_KEY = "simsa:developerMode";
/** window event name fired after a write so other mounted components re-read. */
export const DEVELOPER_MODE_EVENT = "simsa:developer-mode-changed";

/** Coerce any stored value to a boolean. Only the literal "1" means ON. */
export function parseDeveloperMode(raw) {
  return raw === "1";
}

/** Read the local developer-mode flag (never throws; default false). */
export function readDeveloperMode(storage) {
  try {
    return parseDeveloperMode(storage?.getItem?.(DEVELOPER_MODE_KEY));
  } catch {
    return false;
  }
}

/** Persist the flag locally (never throws). */
export function writeDeveloperMode(storage, on) {
  try {
    storage?.setItem?.(DEVELOPER_MODE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Which sections of the project prep/settings page a user should see.
 *
 * - GitHub connect: developers, OR anyone who ENTERED through the code branch
 *   (they arrived holding a repo/URL — the section is their path, not jargon),
 *   OR anyone who already has a linked repo (never hide something in use).
 * - Telegram: developers only. Email stays for everyone.
 * - builtWith picker ("which tool made this app?"): only meaningful when there
 *   is an existing app — code branch or linked repo.
 *
 * @param {{ developerMode: boolean, entryPath?: string | null, hasLinkedRepo?: boolean }} input
 */
export function settingsSectionVisibility(input) {
  const dev = input?.developerMode === true;
  const code = input?.entryPath === "code";
  const linked = input?.hasLinkedRepo === true;
  return {
    github: dev || code || linked,
    telegram: dev,
    email: true,
    trainingConsent: true,
    developerModeToggle: true,
    builtWith: code || linked,
  };
}

/**
 * Sidebar: which developer-only affordances to render.
 * @param {{ developerMode: boolean }} input
 */
export function sidebarDeveloperItems(input) {
  const dev = input?.developerMode === true;
  return { starOnGithub: dev, advancedGroup: dev };
}
