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

// ─── The app's address (#559 여정 렌즈 결함 4) ───────────────────────────────
//
// The PR screen's own way out is "실제 앱 확인하기" — to the real-app check when
// an address is connected, else to the overview's address box. The bottom bar
// must agree with it, so it needs the same address fact; the sidebar already
// holds it (sourceFacts) and publishes it here, same rules as above.

/** @type {Map<string, boolean>} */
const addressKnown = new Map();

/**
 * @param {string} projectId
 * @param {boolean | null | undefined} hasDeployUrl null/undefined = not known yet (ignored)
 * @param {{ dispatchEvent?: (e: Event) => unknown } | null | undefined} [target] defaults to window
 */
export function publishAppAddress(projectId, hasDeployUrl, target) {
  if (!projectId || typeof hasDeployUrl !== "boolean") return;
  if (addressKnown.get(projectId) === hasDeployUrl) return;
  addressKnown.set(projectId, hasDeployUrl);
  const t = target ?? (typeof window !== "undefined" ? window : null);
  if (t && typeof t.dispatchEvent === "function" && typeof CustomEvent === "function") {
    t.dispatchEvent(new CustomEvent(APP_PRESENCE_EVENT, { detail: { projectId, hasDeployUrl } }));
  }
}

/**
 * @param {string | null | undefined} projectId
 * @returns {boolean | null} null = not known yet
 */
export function readAppAddress(projectId) {
  if (!projectId) return null;
  const v = addressKnown.get(projectId);
  return typeof v === "boolean" ? v : null;
}
