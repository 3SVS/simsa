// 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]) — the service-wide daily ceiling of the
// AI generation paths (idea draft · spec check · recommend · unstick · fix suggestion ·
// document draft · intent inference · dev spec).
//
// PURE except capacityFromResponse (reads a cloned fetch Response). The server answers a
// full bucket WITHOUT calling the AI:
//   503 { ok:false, error:"generation_capacity", reason:"daily_capacity", scope:"service", resetAt:"<ISO>" }
//   429 { ok:false, error:"generation_capacity", reason:"network_daily_limit", scope:"network", resetAt }
//       — one network's share of the day (PR #576 review), so one client cannot lock everyone out
// (infer-intent keeps its own 200 { ok:true, inferred:null, reason:"generation_capacity", scope, resetAt }).
// Both get the same sentence: "paused for today, try again {when}" is true for either. The API
// clients read this BEFORE their hourly-429 branch — the network share is a daily limit, and
// the hourly copy ("try again in about N min") would be false for it.
//
// Before this the screens showed that 503 as "the AI connection is having trouble — try
// again in a moment" (llmUnavailable) — false: trying again in a moment does not help
// today. One sentence for every generation screen, from the dictionary (t.errors.
// generationCapacity / generationCapacityAt), with the reset time in the READER's clock
// (daily-limit.mjs formatResetAt: UTC midnight is 9 AM tomorrow in Seoul but 8 PM today
// in New York — never a hard-coded "tomorrow").

import { formatResetAt } from "./daily-limit.mjs";

export const GENERATION_CAPACITY = "generation_capacity";

/**
 * The capacity answer inside a parsed body, or null. The body crosses a wire, so the
 * time is only passed on when it is a string (formatResetAt validates it strictly).
 *
 * @param {unknown} body
 * @returns {{ resetAt: string | null } | null}
 */
export function readGenerationCapacity(body) {
  if (!body || typeof body !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  if (b.error !== GENERATION_CAPACITY && b.reason !== GENERATION_CAPACITY) return null;
  return { resetAt: typeof b.resetAt === "string" ? b.resetAt : null };
}

/**
 * Read the capacity answer from a fetch Response — 503 (service) or 429 (network share),
 * with the generation_capacity body — WITHOUT consuming it (a clone is read), so the
 * caller's own parsing still works when it is something else (e.g. the hourly 429).
 *
 * @param {Response} resp
 * @returns {Promise<{ resetAt: string | null } | null>}
 */
export async function capacityFromResponse(resp) {
  if (!resp || (resp.status !== 503 && resp.status !== 429)) return null;
  try {
    return readGenerationCapacity(await resp.clone().json());
  } catch {
    return null;
  }
}

/**
 * The reader's sentence. A valid future resetAt → t.errors.generationCapacityAt with
 * "{when}" = t.visualChecks.resetWhen words in the reader's clock; otherwise the
 * general t.errors.generationCapacity.
 *
 * @param {{ errors?: Record<string, string>, visualChecks?: { resetWhen?: unknown } } | null | undefined} t
 * @param {string | null | undefined} resetAt
 * @param {{ now?: Date, timeZone?: string }} [opts] now/timeZone are for tests; omit in the UI
 * @returns {string}
 */
export function generationCapacityText(t, resetAt, opts) {
  const errors = t?.errors ?? {};
  const when = formatResetAt(resetAt, t?.visualChecks?.resetWhen, opts);
  const at = errors.generationCapacityAt;
  if (when && typeof at === "string" && at.includes("{when}")) return at.replace("{when}", when);
  return errors.generationCapacity ?? errors.generic ?? "";
}
