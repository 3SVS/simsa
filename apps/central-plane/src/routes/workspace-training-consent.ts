/**
 * workspace-training-consent.ts
 *
 * Opt-in/out for retaining raw review triplets in the training store.
 *
 * GET  /workspace/training-consent?userKey=...
 *   → { ok, consented, consentVersion, currentVersion, active, storageConfigured, state, decidedAt }
 * POST /workspace/training-consent   { userKey, consented }
 *   → { ok, consented, consentVersion, currentVersion, active, state, decidedAt, deletionStarted }
 *
 * `active` = consented against the CURRENT clause version — the exact condition
 * the capture path gates on. `storageConfigured` tells the dashboard whether the
 * server can actually retain data (EVIDENCE bucket present); without it, opting
 * in is harmless but stores nothing.
 *
 * Train K · K-2/K-3 (0071):
 *   - `state` = consented | declined | undecided (training-consent-db.ts trainingConsentState). A "no" is
 *     stored (current clause version + decided_at) — the dashboard invites only `undecided`.
 *   - consented=false requests deletion of that person's training copies in the same D1 batch, then runs
 *     the R2 deletes after the response (waitUntil; inline where there is no ExecutionContext). Failures
 *     stay requested for the 6-hour cron. `deletionStarted` = a deletion sweep was started for this call.
 *   - Body/query are parsed with Zod at the edge (same error codes as before).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS, CORS_ALLOW_METHODS } from "./cors.js";
import {
  TRAINING_CONSENT_VERSION,
  getTrainingConsent,
  setTrainingConsent,
  trainingConsentState,
} from "../workspace/training-consent-db.js";
import { sweepTrainingDeletions } from "../workspace/training-records-index.js";
import { runAfterResponse } from "../workspace/llm-usage.js";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Simsa-User-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

/** userKey — the SaaS identity handle, compared verbatim (never trimmed). */
const UserKeySchema = z.string().min(1).max(256);
const PostBodySchema = z.object({ userKey: UserKeySchema, consented: z.boolean() });

export function createWorkspaceTrainingConsentRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.options("/workspace/training-consent", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  app.get("/workspace/training-consent", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const parsedKey = UserKeySchema.safeParse(c.req.query("userKey") ?? "");
    if (!parsedKey.success) return json({ ok: false, error: "userKey_required" }, 400, origin);
    const userKey = parsedKey.data;
    try {
      const consent = await getTrainingConsent(c.env, userKey);
      const consented = consent?.consented ?? false;
      const consentVersion = consent?.consentVersion ?? null;
      const active = consented && consentVersion === TRAINING_CONSENT_VERSION;
      return json(
        {
          ok: true,
          consented,
          consentVersion,
          currentVersion: TRAINING_CONSENT_VERSION,
          active,
          storageConfigured: Boolean(c.env.EVIDENCE),
          state: trainingConsentState(consent),
          decidedAt: consent?.decidedAt ?? null,
        },
        200,
        origin,
      );
    } catch (err) {
      console.error("[training-consent GET] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  app.post("/workspace/training-consent", async (c) => {
    const origin = c.req.header("origin") ?? null;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const parsed = PostBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      const badKey = parsed.error.issues.some((i) => i.path[0] === "userKey");
      return json({ ok: false, error: badKey ? "userKey_required" : "consented_boolean_required" }, 400, origin);
    }
    const { userKey, consented } = parsed.data;
    try {
      const consent = await setTrainingConsent(c.env, userKey, consented);
      const active = consent.consented && consent.consentVersion === TRAINING_CONSENT_VERSION;
      // A "no" (withdrawal included) deletes that person's training copies. Always sweep on a "no": an
      // earlier withdrawal's failed deletes are retried here too (idempotent — nothing pending = one SELECT).
      const deletionStarted = !consented;
      if (deletionStarted) {
        await runAfterResponse(
          c,
          sweepTrainingDeletions(c.env, { kind: "user", userKey }, { site: "withdrawal", maxPages: 5 }),
        );
      }
      return json(
        {
          ok: true,
          consented: consent.consented,
          consentVersion: consent.consentVersion,
          currentVersion: TRAINING_CONSENT_VERSION,
          active,
          state: trainingConsentState(consent),
          decidedAt: consent.decidedAt,
          deletionStarted,
        },
        200,
        origin,
      );
    } catch (err) {
      console.error("[training-consent POST] error:", err);
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  return app;
}
