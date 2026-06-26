/**
 * smoke-auth-route-d1.mjs
 *
 * Stage 221 — LOCAL route-level smoke for the gated Better Auth D1 wiring (ISOLATED).
 *
 * Unlike scripts/smoke-better-auth-d1.mjs (which exercises the helper + Better Auth
 * directly), this drives the REAL Hono router (`createApp` from ../dist/router.js) so
 * the actual `/api/auth/*` route wiring is proven end to end against a local D1 backed
 * by the 0047 schema:
 *   - default (no AUTH_ENABLED)            → 503 auth_disabled (no runtime built)
 *   - flag + secret, no DB binding         → 503 auth_db_unavailable
 *   - flag + secret + D1 binding           → sign-up 200 + user/credential/session rows
 *                                            persisted, sign-in 200
 *
 * Isolation / safety (same guarantees as the Stage 218 smoke):
 *   - Fresh in-memory D1 (persist:false) from a throwaway minimal D1-only config — the
 *     real wrangler.toml containers/Durable Objects are never loaded.
 *   - No production secret (throwaway labelled literal), no network, no .wrangler state.
 *   - dev-only / unpackaged; the deployed Worker bundles only src/index.ts.
 *
 * Run: pnpm --filter @conclave-ai/central-plane smoke:auth-route-d1  (build first)
 */
import { getPlatformProxy } from "wrangler";
import { createApp } from "../dist/router.js";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "..", "migrations", "0047_better_auth_identity_tables.sql");
const ORIGIN = "http://localhost";
const LOCAL_SMOKE_SECRET = "local-smoke-secret-not-a-real-credential-0123456789";

function splitSqlStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applySchema(db, sql) {
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) await db.prepare(stmt).run();
  return statements.length;
}

async function withIsolatedD1(fn) {
  const dir = await mkdtemp(join(tmpdir(), "simsa-auth-route-smoke-"));
  const configPath = join(dir, "wrangler.smoke.toml");
  await writeFile(
    configPath,
    [
      'name = "conclave-ai-auth-route-smoke"',
      'compatibility_date = "2026-04-20"',
      'compatibility_flags = ["nodejs_compat"]',
      "[[d1_databases]]",
      'binding = "DB"',
      'database_name = "conclave-ai"',
      'database_id = "local-smoke"',
      "",
    ].join("\n"),
  );
  const proxy = await getPlatformProxy({ configPath, persist: false });
  try {
    return await fn(proxy.env.DB);
  } finally {
    await proxy.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runAuthRouteD1Smoke() {
  const checks = [];
  const record = (name, ok, detail = "") => checks.push({ name, ok, detail });

  const email = `route-smoke-${Date.now()}@example.test`;
  const password = "Route-smoke-ABC-12345";

  const result = await withIsolatedD1(async (db) => {
    const applied = await applySchema(db, await readFile(MIGRATION, "utf8"));
    record("0047 schema applied to fresh local D1", applied >= 4, `${applied} statements`);

    const app = createApp();
    const gatedEnv = { ENVIRONMENT: "test", AUTH_ENABLED: "true", BETTER_AUTH_SECRET: LOCAL_SMOKE_SECRET, DB: db };

    // Gate 1 — default disabled (no AUTH_ENABLED): must NOT activate.
    const disabled = await app.fetch(new Request(`${ORIGIN}/api/auth/ok`), { ENVIRONMENT: "test", DB: db });
    const disabledBody = await disabled.json().catch(() => ({}));
    record("default (no flag) → 503 auth_disabled", disabled.status === 503 && disabledBody.error === "auth_disabled");

    // Gate 2 — flag + secret but no DB binding: safe explicit error.
    const noDb = await app.fetch(new Request(`${ORIGIN}/api/auth/ok`), {
      ENVIRONMENT: "test",
      AUTH_ENABLED: "true",
      BETTER_AUTH_SECRET: LOCAL_SMOKE_SECRET,
    });
    const noDbBody = await noDb.json().catch(() => ({}));
    record("flag+secret, no DB → 503 auth_db_unavailable", noDb.status === 503 && noDbBody.error === "auth_db_unavailable");

    // Gate 3 (ready) — sign-up through the wired route.
    const signUp = await app.fetch(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: "Route Smoke" }),
      }),
      gatedEnv,
    );
    record("route sign-up → 2xx", signUp.ok, `status ${signUp.status}`);
    if (!signUp.ok) {
      const body = await signUp.text();
      throw new Error(`route sign-up failed (${signUp.status}): ${body.slice(0, 200)}`);
    }

    const userRow = await db.prepare('SELECT "id" FROM "user" WHERE "email" = ?').bind(email).first();
    record("user row persisted in D1", !!userRow?.id);

    const accountRow = await db
      .prepare('SELECT "id", "providerId" FROM "account" WHERE "userId" = ?')
      .bind(userRow?.id ?? "")
      .first();
    record("credential account row persisted in D1", !!accountRow?.id, `provider ${accountRow?.providerId ?? "?"}`);

    const signIn = await app.fetch(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
      gatedEnv,
    );
    record("route sign-in → 2xx", signIn.ok, `status ${signIn.status}`);

    const sessionRow = await db.prepare('SELECT "id" FROM "session" WHERE "userId" = ?').bind(userRow?.id ?? "").first();
    record("session row persisted in D1", !!sessionRow?.id);

    return { userId: userRow?.id ?? null };
  });

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, passed, total: checks.length, checks, userIdPresent: !!result.userId };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runAuthRouteD1Smoke()
    .then((r) => {
      for (const c of r.checks) {
        console.log(`  [${c.ok ? "PASS" : "FAIL"}] ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
      }
      console.log(`\nAuth route D1 smoke: ${r.passed}/${r.total} checks passed.`);
      if (!r.ok) {
        console.error("SMOKE FAILED");
        process.exit(1);
      }
      console.log("SMOKE OK — gated /api/auth/* route verified locally (disabled-by-default preserved).");
      process.exit(0);
    })
    .catch((err) => {
      console.error("SMOKE ERROR:", err?.message ?? err);
      process.exit(1);
    });
}
