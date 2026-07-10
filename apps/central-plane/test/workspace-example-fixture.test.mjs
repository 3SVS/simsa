import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { createApp } = await import("../dist/router.js");
const { EXAMPLE_PROJECT_IDS } = await import("../dist/workspace/db.js");

// Example-fixture trap (2026-07-10 live incident): the dashboard ships demo
// projects with a FIXED shared id to every browser. If any client writes that
// id to D1, the first-writer-owns guard hands that user global ownership and
// 404s everyone else's repo-link on the example forever. These tests pin the
// server-side door: writes on example ids are rejected before touching D1.

function makeEnv() {
  // The guards under test fire BEFORE any DB access — an empty mock proves it.
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { return { success: true }; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { DB: db, ENVIRONMENT: "test", CONCLAVE_TOKEN_KEK: null };
}

function jsonReq(url, body) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("example-fixture write rejection", () => {
  it("POST /workspace/projects with an example id → 400 example_project_readonly", async () => {
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects", { id: "proj_mjx1", userKey: "uk_x", title: "sneaky claim" }),
      makeEnv(),
    );
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "example_project_readonly");
  });

  it("POST /workspace/projects/proj_mjx1/repo → 400 example_project_readonly (clear, not an ownership 404)", async () => {
    const app = createApp();
    const resp = await app.fetch(
      jsonReq("/workspace/projects/proj_mjx1/repo", { userKey: "uk_x", repo: { fullName: "o/r" } }),
      makeEnv(),
    );
    assert.equal(resp.status, 400);
    const body = await resp.json();
    assert.equal(body.error, "example_project_readonly");
  });

  it("EXAMPLE_PROJECT_IDS stays in sync with the dashboard MOCK_PROJECTS fixtures", () => {
    // Cross-package pin: adding a new example project to the dashboard without
    // blocklisting its id server-side re-opens the global-claim trap.
    const here = dirname(fileURLToPath(import.meta.url));
    const mockData = readFileSync(
      join(here, "../../dashboard/src/lib/mock-data.ts"),
      "utf8",
    );
    const fixtureIds = [...mockData.matchAll(/id: "(proj_[a-z0-9_]+)"/g)].map((m) => m[1]);
    assert.ok(fixtureIds.length >= 1, "expected at least one dashboard example project id");
    for (const id of fixtureIds) {
      assert.ok(EXAMPLE_PROJECT_IDS.has(id), `dashboard fixture ${id} missing from EXAMPLE_PROJECT_IDS`);
    }
  });
});
