/**
 * Stage 216 — Better Auth D1 runtime-binding package prep (COMPILE-LEVEL ONLY).
 *
 * Proves the `kysely-d1` D1 dialect resolves + type-checks under the central-plane
 * TypeScript / Cloudflare Workers build, and provides the smallest helper a later
 * (separately-approved) wiring stage will use to give Better Auth a D1-backed
 * `database` config.
 *
 * Stage 221 wires this helper into the gated local route runtime
 * (`createBetterAuthRuntime`), but it stays import-time-inert and production-dormant:
 *   - nothing runs at import time (the dialect is only constructed when called),
 *   - no DB access happens here (the D1 binding is only read lazily by Kysely
 *     inside a request, never at construction),
 *   - no secret / production env required,
 *   - the `/api/auth/*` route is built ONLY behind AUTH_ENABLED + secret + env.DB
 *     gates and stays disabled-by-default (503 auth_disabled) in production.
 *
 * Better Auth accepts a Kysely `Dialect` via its `database` option as
 * `{ dialect, type }`; for D1 the type is "sqlite" (D1 is SQLite-compatible).
 */
import { D1Dialect } from "kysely-d1";
import type { D1Database } from "@cloudflare/workers-types";

/** Import/availability proof: the kysely-d1 dialect resolved at build time. */
export function d1DialectAvailable(): boolean {
  return typeof D1Dialect === "function";
}

/**
 * Build the Better Auth `database` config for a Cloudflare D1 binding.
 *
 * Construct this lazily, per request (the `env.DB` binding only exists inside a
 * request handler in Workers). The dialect stores the binding; it does not touch
 * the database here. The returned object is the shape Better Auth's kysely
 * adapter expects: `{ dialect, type: "sqlite" }`.
 */
export function buildBetterAuthD1Database(db: D1Database) {
  return { dialect: new D1Dialect({ database: db }), type: "sqlite" as const };
}
