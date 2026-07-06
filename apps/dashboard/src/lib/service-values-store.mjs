/**
 * service-values-store.mjs
 *
 * Prep layer A2: the service/MCP setup moves to the prep (settings) step, so the
 * keys a user enters there must survive the walk to the builder-pack (export)
 * screen. This is a BROWSER-ONLY store — the values never go to a server here
 * (they're sent only at export time, baked into the pack's .env.local).
 *
 * Uses sessionStorage, not localStorage, on purpose: these values include real
 * secrets (service_role, API keys). sessionStorage survives navigation within
 * the tab (settings → export) but is cleared when the tab closes, so a secret
 * never lingers on the device indefinitely. Keyed per project.
 */

const KEY_PREFIX = "conclave:service-values:";

function storage() {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Persist the collected services (with values) for a project, browser-only.
 * @param {string} projectId
 * @param {unknown[]} services
 */
export function saveServiceValues(projectId, services) {
  const s = storage();
  if (!s || !projectId) return;
  try {
    s.setItem(KEY_PREFIX + projectId, JSON.stringify(services ?? []));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/**
 * Load the collected services for a project, or null if none stored.
 * @param {string} projectId
 * @returns {unknown[] | null}
 */
export function loadServiceValues(projectId) {
  const s = storage();
  if (!s || !projectId) return null;
  try {
    const raw = s.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Remove a project's stored service values (e.g. after the user is done).
 * @param {string} projectId
 */
export function clearServiceValues(projectId) {
  const s = storage();
  if (!s || !projectId) return;
  try {
    s.removeItem(KEY_PREFIX + projectId);
  } catch {
    /* non-fatal */
  }
}
