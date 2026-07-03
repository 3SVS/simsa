/**
 * workspace-training-consent.ts
 *
 * Opt-in/out for retaining raw review triplets in the training store.
 *
 * GET  /workspace/training-consent?userKey=...
 *   → { ok, consented, consentVersion, currentVersion, active, storageConfigured }
 * POST /workspace/training-consent   { userKey, consented }
 *   → { ok, consented, consentVersion, currentVersion, active }
 *
 * `active` = consented against the CURRENT clause version — the exact condition
 * the capture path gates on. `storageConfigured` tells the dashboard whether the
 * server can actually retain data (EVIDENCE bucket present); without it, opting
 * in is harmless but stores nothing.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS } from "./cors.js";
import {
  TRAINING_CONSENT_VERSION,
  getTrainingConsent,
  setTrainingConsent,
} from "../workspace/training-consent-db.js";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

export function createWorkspaceTrainingConsentRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.options("/workspace/training-consent", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  app.get("/workspace/training-consent", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
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
    const b = (body ?? {}) as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!userKey) return json({ ok: false, error: "userKey_required" }, 400, origin);
    if (typeof b["consented"] !== "boolean") {
      return json({ ok: false, error: "consented_boolean_required" }, 400, origin);
    }
    try {
      const consent = await setTrainingConsent(c.env, userKey, b["consented"]);
      const active = consent.consented && consent.consentVersion === TRAINING_CONSENT_VERSION;
      return json(
        {
          ok: true,
          consented: consent.consented,
          consentVersion: consent.consentVersion,
          currentVersion: TRAINING_CONSENT_VERSION,
          active,
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
