/**
 * federated-baselines.ts — closes the decision #21 loop.
 *
 * The CLI's HttpFederatedSyncTransport speaks a deliberately thin contract:
 *   POST {endpoint}/baselines        { baselines: [FederatedBaseline] } → { accepted }
 *   GET  {endpoint}/baselines?since  → { baselines: [FederatedBaseline] }
 *
 * central-plane historically exposed the same aggregation under different
 * paths/shapes (/episodic/push {items}, /memory/pull) — so `conclave sync`
 * could never actually round-trip against our own server. These routes are
 * the missing adapter over the SAME episodic_aggregates store.
 *
 * Auth: install token (Bearer c_… — same as /episodic/push). Point the CLI at
 * `federated.endpoint = <central-plane origin>` with `apiToken` = the install
 * token from `conclave register`.
 *
 * Privacy unchanged (decision #21 / D4): only {version, kind, domain,
 * category, severity, normalized tags, dayBucket, sha256} cross this
 * boundary. GET conveys population counts by repeating each hash up to
 * REPEAT_CAP times — the CLI rebuilds its frequency map by counting
 * occurrences, and the rerank boost is logarithmic, so the cap only
 * flattens the extreme tail.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { requireInstallAuth, type AuthedVariables } from "../auth.js";
import { upsertAggregate, listAggregates } from "../db/aggregates.js";

export const federatedBaselinesRoutes = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const MAX_ITEMS_PER_REQUEST = 500;
/** Max repeats per hash on GET — saturates the log-boost without bloating payloads. */
const REPEAT_CAP = 20;
/** Total entry cap per GET response. */
const RESPONSE_ENTRY_CAP = 5000;

interface WireBaseline {
  version: 1;
  kind: "answer-key" | "failure";
  contentHash: string;
  domain: "code" | "design";
  category?: string;
  severity?: string;
  tags: string[];
  dayBucket: string;
}

function isValidBaseline(x: unknown): x is WireBaseline {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (o.kind !== "answer-key" && o.kind !== "failure") return false;
  if (typeof o.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(o.contentHash)) return false;
  if (o.domain !== "code" && o.domain !== "design") return false;
  if (o.category !== undefined && typeof o.category !== "string") return false;
  if (o.severity !== undefined && typeof o.severity !== "string") return false;
  if (!Array.isArray(o.tags) || !o.tags.every((t) => typeof t === "string")) return false;
  if (typeof o.dayBucket !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.dayBucket)) return false;
  return true;
}

federatedBaselinesRoutes.post("/baselines", requireInstallAuth, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { baselines?: unknown } | null;
  if (!body || !Array.isArray(body.baselines)) {
    return c.json({ error: "body must be { baselines: [...] }" }, 400);
  }
  if (body.baselines.length > MAX_ITEMS_PER_REQUEST) {
    return c.json(
      { error: `max ${MAX_ITEMS_PER_REQUEST} baselines per request; split larger batches` },
      413,
    );
  }

  const now = new Date().toISOString();
  let accepted = 0;
  for (const raw of body.baselines) {
    if (!isValidBaseline(raw)) continue; // tolerate partial garbage; valid entries still commit
    await upsertAggregate(c.env, {
      contentHash: raw.contentHash,
      // Wire kind "failure" ↔ store kind "failure-catalog".
      kind: raw.kind === "failure" ? "failure-catalog" : "answer-key",
      domain: raw.domain,
      category: raw.category ?? null,
      severity: raw.severity ?? null,
      tags: raw.tags,
      now,
    });
    accepted += 1;
  }
  return c.json({ accepted });
});

federatedBaselinesRoutes.get("/baselines", requireInstallAuth, async (c) => {
  const since = c.req.query("since") ?? null;
  const rows = await listAggregates(c.env, { limit: 1000, minCount: 1 });

  const baselines: WireBaseline[] = [];
  for (const row of rows) {
    if (since && row.lastSeenAt <= since) continue;
    const wire: WireBaseline = {
      version: 1,
      kind: row.kind === "failure-catalog" ? "failure" : "answer-key",
      contentHash: row.contentHash,
      domain: row.domain,
      ...(row.category ? { category: row.category } : {}),
      ...(row.severity ? { severity: row.severity } : {}),
      tags: row.tags,
      dayBucket: row.lastSeenAt.slice(0, 10),
    };
    const repeats = Math.min(Math.max(row.count, 1), REPEAT_CAP);
    for (let i = 0; i < repeats && baselines.length < RESPONSE_ENTRY_CAP; i++) {
      baselines.push(wire);
    }
    if (baselines.length >= RESPONSE_ENTRY_CAP) break;
  }
  return c.json({ baselines });
});
