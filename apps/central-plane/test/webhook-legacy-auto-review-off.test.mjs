/**
 * webhook-legacy-auto-review-off.test.mjs — 2026-07-21 (Bae 결정)
 *
 * LEGACY_AUTO_REVIEW="off" kill switch: while Simsa is the product focus,
 * the legacy Conclave council must not auto-review PRs anywhere.
 *
 * Pins:
 *   - pull_request webhook with the switch off → acknowledged as
 *     skipped:"legacy_auto_review_disabled" BEFORE any DB read, credit
 *     consumption, job creation, or sandbox spawn (DB stub throws if touched).
 *   - switch absent → the handler proceeds past the gate (default-on:
 *     other deployments keep their behavior).
 *   - signature verification still runs first (unsigned → 401 either way).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const { createApp } = await import("../dist/router.js");

const SECRET = "whsec_test_1234";

/** DB stub that fails the test if ANY query runs (the skip must be free). */
function explodingDb() {
  return {
    prepare() {
      throw new Error("DB must not be touched when the kill switch is off");
    },
  };
}

/** DB stub that answers "no installation row" (default-on path probe). */
function nullDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true, meta: { changes: 0 } }),
          };
        },
      };
    },
  };
}

async function postWebhook(app, env, event, payload) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return app.request(
    "/webhook/github",
    {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": event,
        "x-github-delivery": "d_test",
        "content-type": "application/json",
      },
      body: raw,
    },
    env,
  );
}

const PR_PAYLOAD = {
  action: "opened",
  pull_request: { number: 7, title: "feat: x", body: "" },
  repository: { full_name: "acme/site" },
  installation: { id: 42 },
};

test("kill switch off: pull_request acked as disabled, DB never touched", async () => {
  const app = createApp();
  const env = {
    ENVIRONMENT: "test",
    GH_APP_WEBHOOK_SECRET: SECRET,
    LEGACY_AUTO_REVIEW: "off",
    DB: explodingDb(),
  };
  const res = await postWebhook(app, env, "pull_request", PR_PAYLOAD);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.skipped, "legacy_auto_review_disabled");
});

test("switch absent: handler proceeds past the gate (default-on)", async () => {
  const app = createApp();
  const env = {
    ENVIRONMENT: "test",
    GH_APP_WEBHOOK_SECRET: SECRET,
    DB: nullDb(),
  };
  const res = await postWebhook(app, env, "pull_request", PR_PAYLOAD);
  assert.equal(res.status, 200);
  const body = await res.json();
  // Reached the installation lookup (past the kill-switch gate) and skipped
  // there because our stub has no rows — proving the gate did not block.
  assert.equal(body.skipped, "user_not_linked");
});

test("signature verification still runs before the switch (unsigned → 401)", async () => {
  const app = createApp();
  const env = {
    ENVIRONMENT: "test",
    GH_APP_WEBHOOK_SECRET: SECRET,
    LEGACY_AUTO_REVIEW: "off",
    DB: explodingDb(),
  };
  const res = await app.request(
    "/webhook/github",
    {
      method: "POST",
      headers: { "x-github-event": "pull_request", "content-type": "application/json" },
      body: JSON.stringify(PR_PAYLOAD),
    },
    env,
  );
  assert.equal(res.status, 401);
});
