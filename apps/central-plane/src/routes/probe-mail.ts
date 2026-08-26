/**
 * probe-mail.ts — 검수 컨테이너가 일회용 메일함을 읽는 내부 경로 (2026-08-26).
 *
 *   GET    /internal/probe-mail?runId=…   — 그 검수 실행 앞으로 온 메일(제목·링크)
 *   DELETE /internal/probe-mail?runId=…   — 검수가 끝나면 비운다
 *
 * 보호: `INTERNAL_CALLBACK_TOKEN`. 이 경로는 **남의 앱이 보낸 메일의 링크**를 담고
 * 있으므로 공개되면 안 된다 — 확인 링크는 그 자체가 계정 접근권이다.
 * 토큰이 설정돼 있지 않으면 503으로 닫는다(무보호로 열리지 않는다).
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { deleteProbeEmails, listProbeEmails } from "../probe-mailbox.js";

function requireInternalToken(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "probe_mail_disabled" };
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m || m[1] !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

export function createProbeMailRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/internal/probe-mail", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const runId = c.req.query("runId") ?? "";
    if (!runId) return c.json({ ok: false, error: "runId_required" }, 400);
    try {
      const emails = await listProbeEmails(c.env, runId);
      return c.json({ ok: true, emails });
    } catch (err) {
      console.error("[internal/probe-mail] list failed:", err);
      return c.json({ ok: false, error: "db_error" }, 500);
    }
  });

  app.delete("/internal/probe-mail", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, auth.status);
    const runId = c.req.query("runId") ?? "";
    if (!runId) return c.json({ ok: false, error: "runId_required" }, 400);
    try {
      await deleteProbeEmails(c.env, runId);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[internal/probe-mail] delete failed:", err);
      return c.json({ ok: false, error: "db_error" }, 500);
    }
  });

  return app;
}
