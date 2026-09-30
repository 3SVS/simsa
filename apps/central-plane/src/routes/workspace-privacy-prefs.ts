/**
 * workspace-privacy-prefs.ts — Train K · K-1 개인정보 설정 (가격·동의 계획 §4, 0071).
 *
 * GET  /workspace/privacy-prefs?userKey=
 * POST /workspace/privacy-prefs   { userKey, opsMeta: "on" | "off" }
 *   → { ok: true, opsMeta, opsMetaSource: "default" | "user", region,
 *       training: { state: "consented" | "declined" | "undecided", version, decidedAt, currentVersion } }
 *
 * - opsMeta = 통계용 운영 정보 기록(0069 region·envelope_json·finding_codes_json·region_at_create·수리 잡 region).
 *   선택이 없으면 접속 국가로 정한 기본값(EU/EEA·GB·CH 등은 off — workspace/privacy-prefs.ts).
 * - region = 이 요청의 접속 국가 코드(request.cf.country). 대시보드가 "기록하지 않고 있어요 · 켜기"처럼
 *   기본값의 이유를 보여 줄 때 쓴다. 저장하지 않는다. 모르면 null이고, 그때 기본값은 off다(#574-5).
 * - training = 학습 데이터 동의 상태(설정 화면이 두 토글을 한 번에 그리도록). version = 저장된 조항 버전
 *   (없으면 null), currentVersion = 지금 조항 버전.
 * - 소유권: userKey로만 — 자기 선택만 읽고 바꾼다(다른 라우트와 같은 SaaS 핸들). 입력은 Zod로 받는다.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS, CORS_ALLOW_METHODS } from "./cors.js";
import { regionFromRequest } from "../workspace/envelope.js";
import {
  PrivacyPrefsPostSchema,
  PrivacyPrefsUserKeySchema,
  resolveOpsMeta,
  setOpsMetaChoice,
} from "../workspace/privacy-prefs.js";
import {
  TRAINING_CONSENT_VERSION,
  getTrainingConsent,
  trainingConsentState,
} from "../workspace/training-consent-db.js";

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

async function prefsView(env: Env, userKey: string, region: string | null) {
  const ops = await resolveOpsMeta(env, userKey, region);
  const consent = await getTrainingConsent(env, userKey);
  return {
    ok: true as const,
    opsMeta: ops.opsMeta,
    opsMetaSource: ops.source,
    region,
    training: {
      state: trainingConsentState(consent),
      version: consent?.consentVersion ?? null,
      decidedAt: consent?.decidedAt ?? null,
      currentVersion: TRAINING_CONSENT_VERSION,
    },
  };
}

export function createWorkspacePrivacyPrefsRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.options("/workspace/privacy-prefs", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  app.get("/workspace/privacy-prefs", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const key = PrivacyPrefsUserKeySchema.safeParse(c.req.query("userKey") ?? "");
    if (!key.success) return json({ ok: false, error: "userKey_required" }, 400, origin);
    try {
      return json(await prefsView(c.env, key.data, regionFromRequest(c.req.raw)), 200, origin);
    } catch (err) {
      console.error(JSON.stringify({ at: "privacy-prefs", op: "get", error: String(err).slice(0, 200) }));
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  app.post("/workspace/privacy-prefs", async (c) => {
    const origin = c.req.header("origin") ?? null;
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400, origin);
    }
    const parsed = PrivacyPrefsPostSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const badKey = parsed.error.issues.some((i) => i.path[0] === "userKey");
      return json({ ok: false, error: badKey ? "userKey_required" : "opsMeta_invalid" }, 400, origin);
    }
    try {
      await setOpsMetaChoice(c.env, parsed.data.userKey, parsed.data.opsMeta);
      return json(await prefsView(c.env, parsed.data.userKey, regionFromRequest(c.req.raw)), 200, origin);
    } catch (err) {
      console.error(JSON.stringify({ at: "privacy-prefs", op: "post", error: String(err).slice(0, 200) }));
      return json({ ok: false, error: "db_error" }, 500, origin);
    }
  });

  return app;
}
