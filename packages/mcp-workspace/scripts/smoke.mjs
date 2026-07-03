#!/usr/bin/env node
/**
 * Local smoke for @simsa/mcp-workspace. Verifies the server can reach
 * central-plane and that the audit log never leaks the userKey.
 *
 *   pnpm --filter @simsa/mcp-workspace build
 *   CONCLAVE_USER_KEY=uk_... node packages/mcp-workspace/scripts/smoke.mjs
 *
 * Never prints the userKey or any secret.
 */
import { WorkspaceClient } from "../dist/client.js";

const userKey = process.env.CONCLAVE_USER_KEY?.trim();
if (!userKey) {
  process.stderr.write("smoke: CONCLAVE_USER_KEY is required.\n");
  process.exit(1);
}
const baseUrl =
  process.env.CONCLAVE_API_BASE_URL?.trim() ||
  process.env.CONCLAVE_CENTRAL_PLANE_URL?.trim() ||
  "https://conclave-ai.seunghunbae.workers.dev";

const audit = [];
const client = new WorkspaceClient({ baseUrl, userKey, audit: (e) => audit.push(e) });

let failed = false;
const check = (name, ok, detail = "") => {
  process.stdout.write(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}\n`);
  if (!ok) failed = true;
};

const res = await client.listProjects();
check("server reaches central-plane", res.status === 200, `status ${res.status}`);
check("list_projects returns ok", res.ok === true);
check("response is a project list", Array.isArray(res.projects), `${(res.projects || []).length} project(s)`);
check("audit recorded the call", audit.length >= 1);
check(
  "audit does not leak the userKey",
  !JSON.stringify(audit).includes(userKey),
);

process.stdout.write(failed ? "\nsmoke: FAIL\n" : "\nsmoke: OK\n");
process.exit(failed ? 1 : 0);
