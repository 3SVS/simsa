// app-presence.mjs — one answer to "does this project's app already exist?"
// for the screens that don't fetch it themselves (#559 검증 결함 5).
//
// The sidebar (always mounted, root layout) already reads the repo and sources
// for the open project and settles the answer with project-steps.mjs
// (appPresenceKnown / projectHasApp). The bottom "다음 →" bar needs the same
// answer to pick its walk — a restored project defaults to the idea branch, and
// walking an app that already exists to the builder pack contradicts the
// sidebar. Fetching again would cost requests and could disagree with the
// sidebar (#498: two readers drift); so the sidebar publishes, others read.
//
// Only confirmed answers are published. Unknown (null) never erases a known
// answer — the next confirmed one replaces it.
//
// Module state + one window event; no storage, no network.

/** Window event fired when a project's answer changes. detail: { projectId, hasApp }. */
export const APP_PRESENCE_EVENT = "simsa:app-presence";

/** @type {Map<string, boolean>} */
const known = new Map();

/**
 * @param {string} projectId
 * @param {boolean | null | undefined} hasApp null/undefined = not known yet (ignored)
 * @param {{ dispatchEvent?: (e: Event) => unknown } | null | undefined} [target] defaults to window
 */
export function publishAppPresence(projectId, hasApp, target) {
  if (!projectId || typeof hasApp !== "boolean") return;
  if (known.get(projectId) === hasApp) return;
  known.set(projectId, hasApp);
  const t = target ?? (typeof window !== "undefined" ? window : null);
  if (t && typeof t.dispatchEvent === "function" && typeof CustomEvent === "function") {
    t.dispatchEvent(new CustomEvent(APP_PRESENCE_EVENT, { detail: { projectId, hasApp } }));
  }
}

/**
 * @param {string | null | undefined} projectId
 * @returns {boolean | null} null = not known yet
 */
export function readAppPresence(projectId) {
  if (!projectId) return null;
  const v = known.get(projectId);
  return typeof v === "boolean" ? v : null;
}
