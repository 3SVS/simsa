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

import { detectServices, catalogServiceById } from "./service-catalog.mjs";

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

/**
 * The single seed used by BOTH the prep (settings) panel and the builder-pack
 * export: reuse the user's stored values when present, otherwise fall back to
 * fresh keyword detection from the product spec. Shared so moving the panel
 * (A2b) can't drop the two things that break in a move:
 *   1. values entered in prep survive to export (stored wins),
 *   2. spec detection (email→Resend, error→Sentry, …) still reaches the panel
 *      on its new screen (detection fallback).
 *
 * i18n (2026-07-21): the stored blob wins on WHICH services + their values, but
 * the copy (labels/steps/descriptions) is re-resolved from the catalog in the
 * CURRENT locale — otherwise a user who saved under KO keeps seeing KO after
 * switching to EN (journey-audit v2 P1의 같은 클래스).
 *
 * @param {string} projectId
 * @param {Parameters<typeof detectServices>[0]} spec
 * @param {"en"|"ko"} [locale]
 * @returns {unknown[]}
 */
export function seedServiceSetup(projectId, spec, locale) {
  const stored = loadServiceValues(projectId);
  if (!Array.isArray(stored) || stored.length === 0) return detectServices(spec, locale);
  return stored.map((s) => {
    const fresh = catalogServiceById(s?.id, locale);
    if (!fresh) return s; // unknown/legacy id — pass through untouched
    const valueByKey = new Map(
      (Array.isArray(s?.envVars) ? s.envVars : [])
        .filter((v) => v && typeof v.key === "string")
        .map((v) => [v.key, v.value]),
    );
    return {
      ...fresh,
      envVars: fresh.envVars.map((v) => {
        const value = valueByKey.get(v.key);
        return typeof value === "string" && value.length > 0 ? { ...v, value } : v;
      }),
    };
  });
}
