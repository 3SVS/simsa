/**
 * smoke-better-auth-d1.mjs
 *
 * Stage 218 — Better Auth LOCAL runtime smoke (ISOLATED, throwaway harness).
 *
 * Proves that the committed, compile-level helper `buildBetterAuthD1Database`
 * (Stage 216) actually drives a working Better Auth email/password runtime over a
 * local Cloudflare D1 backed by the `0047_better_auth_identity_tables.sql` schema —
 * i.e. sign-up + sign-in succeed and write real rows.
 *
 * What this is NOT (the Stage 218 scope guard — keep the route UNWIRED):
 *   - It exercises the helper directly; it does NOT import the `/api/auth/*` route
 *     (the wired route is covered separately by smoke:auth-route-d1).
 *     The deployed Worker (src/index.ts → router) never references this file; wrangler
 *     bundles only `src/index.ts`, and `scripts/` is dev-only + unpackaged.
 *   - It does NOT mutate the real local D1 under `.wrangler/` or any shared state.
 *     A fresh in-memory D1 (persist:false) is created from a throwaway minimal config,
 *     so containers/Durable Objects from the real wrangler.toml are not loaded.
 *   - It does NOT use a production secret, real credential, network, or migration of
 *     production. The secret is a local throwaway literal; nothing is persisted.
 *
 * It exercises the REAL helper from the built output (../dist/better-auth-d1.js),
 * matching the repo's "tests import dist" convention, so this is a true runtime proof
 * of the same code path a later (separately-approved) wiring stage would use.
 *
 * Run: pnpm --filter @conclave-ai/central-plane smoke:better-auth-d1
 *      (build first; the harness imports ../dist)
 */
import { getPlatformProxy } from "wrangler";
import { betterAuth } from "better-auth";
import { buildBetterAuthD1Database } from "../dist/better-auth-d1.js";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "..", "migrations", "0047_better_auth_identity_tables.sql");
const BASE_URL = "http://localhost:8787";
const LOCAL_SMOKE_SECRET = "local-smoke-secret-not-a-real-credential-0123456789";

/** Split a SQL file into individual executable statements (strip `--` comments). */
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
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
  return statements.length;
}

/** Minimal D1-only config so getPlatformProxy never loads containers / Durable Objects. */
async function withIsolatedD1(fn) {
  const dir = await mkdtemp(join(tmpdir(), "simsa-auth-d1-smoke-"));
  const configPath = join(dir, "wrangler.smoke.toml");
  await writeFile(
    configPath,
    [
      'name = "conclave-ai-auth-smoke"',
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

/**
 * Run the isolated smoke. Returns a structured, secret-free result.
 * Throws on any hard failure so the CLI can exit non-zero.
 */
export async function runBetterAuthD1Smoke() {
  const checks = [];
  const record = (name, ok, detail = "") => checks.push({ name, ok, detail });

  const email = `smoke-user-${Date.now()}@example.test`;
  const password = "Smoke-pass-ABC-12345";

  const result = await withIsolatedD1(async (db) => {
    const sql = await readFile(MIGRATION, "utf8");
    const applied = await applySchema(db, sql);
    record("0047 schema applied to fresh local D1", applied >= 4, `${applied} statements`);

    // The actual code path under test: real helper → Better Auth database config.
    const auth = betterAuth({
      baseURL: BASE_URL,
      secret: LOCAL_SMOKE_SECRET,
      database: buildBetterAuthD1Database(db),
      emailAndPassword: { enabled: true },
    });
    record("Better Auth instance built via buildBetterAuthD1Database", typeof auth?.handler === "function");

    // Sign-up (email/password) through the Better Auth handler.
    const signUpRes = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: "Smoke User" }),
      }),
    );
    record("sign-up handler returned 2xx", signUpRes.ok, `status ${signUpRes.status}`);
    if (!signUpRes.ok) {
      const body = await signUpRes.text();
      throw new Error(`sign-up failed (${signUpRes.status}): ${body.slice(0, 200)}`);
    }

    // Verify a real user row was written to D1.
    const userRow = await db
      .prepare('SELECT "id", "email" FROM "user" WHERE "email" = ?')
      .bind(email)
      .first();
    record("user row persisted in D1", !!userRow?.id);

    // Verify a credential account row exists (email/password stores a hashed password here).
    const accountRow = await db
      .prepare('SELECT "id", "providerId" FROM "account" WHERE "userId" = ?')
      .bind(userRow?.id ?? "")
      .first();
    record("credential account row persisted in D1", !!accountRow?.id, `provider ${accountRow?.providerId ?? "?"}`);

    // Sign-in with the same credentials.
    const signInRes = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    );
    record("sign-in handler returned 2xx", signInRes.ok, `status ${signInRes.status}`);

    // Verify a session row was written for the user.
    const sessionRow = await db
      .prepare('SELECT "id" FROM "session" WHERE "userId" = ?')
      .bind(userRow?.id ?? "")
      .first();
    record("session row persisted in D1", !!sessionRow?.id);

    return { userId: userRow?.id ?? null };
  });

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, passed, total: checks.length, checks, userIdPresent: !!result.userId };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runBetterAuthD1Smoke()
    .then((r) => {
      for (const c of r.checks) {
        const mark = c.ok ? "PASS" : "FAIL";
        console.log(`  [${mark}] ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
      }
      console.log(`\nBetter Auth D1 smoke: ${r.passed}/${r.total} checks passed.`);
      if (!r.ok) {
        console.error("SMOKE FAILED");
        process.exit(1);
      }
      console.log("SMOKE OK — helper + better-auth + local D1 sign-up/sign-in verified (helper-level; route covered by smoke:auth-route-d1).");
      process.exit(0);
    })
    .catch((err) => {
      console.error("SMOKE ERROR:", err?.message ?? err);
      process.exit(1);
    });
}
