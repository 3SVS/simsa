/**
 * project-namespace.mjs — account-scoped local storage keys (pure logic).
 *
 * The bug this closes: local projects lived under ONE global localStorage key,
 * so signing out and signing up as a new account (or a second person on a shared
 * browser) still showed the previous account's projects. Here we compute a
 * per-account namespace so each identity reads/writes its own bucket, plus the
 * one-time migrations (legacy global blob → current bucket; anonymous bucket →
 * account bucket on sign-in "claim").
 *
 * Pure and deterministic — no localStorage, no window — so it is unit-testable
 * under the Node 20 CI (which cannot type-strip .ts). workflow-store.ts wires
 * these into the real storage. Types live in project-namespace.d.mts.
 */

export const PROJECTS_BASE = "conclave_wf_projects";
export const DRAFT_BASE = "conclave_wf_draft";
export const ACTIVE_NS_KEY = "conclave_active_ns";
export const ANON_NS = "anon";

/**
 * Stable, non-cryptographic hash of an account identifier → namespace token.
 * This only partitions localStorage buckets; it is not a security boundary.
 * @param {string} accountId
 * @returns {string}
 */
export function hashAccount(accountId) {
  const s = String(accountId ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return `a_${(h >>> 0).toString(36)}`;
}

/**
 * The namespace token for a given identity. Signed out / empty → the anonymous
 * bucket; signed in → a per-account bucket.
 * @param {string | null | undefined} accountId
 * @returns {string}
 */
export function namespaceFor(accountId) {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  return id ? hashAccount(id) : ANON_NS;
}

/**
 * localStorage key for the project list in a namespace.
 * @param {string} ns
 * @returns {string}
 */
export function projectsKeyFor(ns) {
  return `${PROJECTS_BASE}:${ns || ANON_NS}`;
}

/**
 * localStorage key for the in-progress draft in a namespace.
 * @param {string} ns
 * @returns {string}
 */
export function draftKeyFor(ns) {
  return `${DRAFT_BASE}:${ns || ANON_NS}`;
}

/**
 * Merge two project lists by id, preferring `incoming` and keeping it first.
 * Used to fold the anonymous bucket into an account bucket on claim without
 * losing either side or duplicating a shared id.
 * @template {{ id: string }} T
 * @param {readonly T[]} existing
 * @param {readonly T[]} incoming
 * @returns {T[]}
 */
export function mergeProjectsById(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const p of incoming ?? []) {
    if (!p || typeof p.id !== "string" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  for (const p of existing ?? []) {
    if (!p || typeof p.id !== "string" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Decide the namespace transition when the resolved identity changes. Returns
 * the next namespace and whether the anonymous bucket should be claimed
 * (migrated) into it. Claim happens only when moving FROM anonymous TO an
 * account — so projects built before signing in are not stranded, while a
 * second account on the same browser never inherits them.
 * @param {string} prevNs   the currently-stored active namespace
 * @param {string | null | undefined} accountId  the resolved signed-in identity (null = signed out)
 * @returns {{ nextNs: string, claimAnon: boolean }}
 */
export function planNamespaceTransition(prevNs, accountId) {
  const nextNs = namespaceFor(accountId);
  const claimAnon = Boolean(accountId) && (prevNs || ANON_NS) === ANON_NS && nextNs !== ANON_NS;
  return { nextNs, claimAnon };
}
