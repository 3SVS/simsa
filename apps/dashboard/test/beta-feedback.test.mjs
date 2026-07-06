// Stage 119 — beta feedback mailto helper tests. Pure/deterministic; safe context
// only (no raw input / snapshot / userKey / secrets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBetaFeedbackMailto, FEEDBACK_EMAIL } from "../src/lib/beta-feedback.mjs";

function decoded(url) {
  // Return the full decoded mailto string for content assertions.
  return decodeURIComponent(url);
}

test("builds a mailto to the existing public contact email", () => {
  const url = buildBetaFeedbackMailto({});
  assert.ok(url.startsWith(`mailto:${FEEDBACK_EMAIL}?`));
  assert.equal(FEEDBACK_EMAIL, "seunghunbae@3svs.com");
});

test("subject carries the Simsa beta feedback prefix", () => {
  const url = buildBetaFeedbackMailto({});
  assert.match(decoded(url), /\[Simsa beta feedback\]/);
});

test("includes route / intake type / record id / section context", () => {
  const url = buildBetaFeedbackMailto({
    route: "/projects/new/intake",
    intakeType: "product_url",
    workflowRecordId: "wawr_abc123",
    section: "Evidence Plan",
  });
  const d = decoded(url);
  assert.match(d, /Route: \/projects\/new\/intake/);
  assert.match(d, /Intake type: product_url/);
  assert.match(d, /Saved workflow record: wawr_abc123/);
  assert.match(d, /Section: Evidence Plan/);
  // section drives the subject topic
  assert.match(d, /\[Simsa beta feedback\] Evidence Plan/);
});

test("default subject topic is Intake workflow when no section", () => {
  assert.match(decoded(buildBetaFeedbackMailto({})), /\[Simsa beta feedback\] Intake workflow/);
});

test("custom subjectPrefix is honored", () => {
  const url = buildBetaFeedbackMailto({ subjectPrefix: "[Simsa internal]" });
  assert.match(decoded(url), /\[Simsa internal\] Intake workflow/);
});

test("does NOT include raw input or userKey even if accidentally passed", () => {
  // The helper signature ignores unknown keys; the body is a fixed template.
  const url = buildBetaFeedbackMailto({
    route: "/projects/new/intake",
    // @ts-expect-error — these are not part of the input type, must be ignored
    rawInput: "SECRET pasted product spec",
    // @ts-expect-error
    userKey: "uk_should_not_leak",
    // @ts-expect-error
    acceptanceMap: { items: ["secret"] },
  });
  const d = decoded(url);
  assert.ok(!d.includes("SECRET pasted product spec"), "raw input must not leak");
  assert.ok(!d.includes("uk_should_not_leak"), "userKey must not leak");
  assert.ok(!d.toLowerCase().includes("acceptancemap"), "snapshot must not leak");
});

test("output is URL-encoded (no raw spaces or newlines in query)", () => {
  const url = buildBetaFeedbackMailto({ section: "Stage Plan" });
  const query = url.split("?")[1];
  assert.ok(!/ /.test(query), "no raw spaces in query");
  assert.ok(!/\n/.test(query), "no raw newlines in query");
  assert.match(query, /%20/, "spaces encoded as %20");
});

test("carries a safety note discouraging sensitive content", () => {
  assert.match(decoded(buildBetaFeedbackMailto({})), /do not include sensitive product details/i);
});

test("deterministic output for identical input", () => {
  const a = buildBetaFeedbackMailto({ route: "/x", section: "Agent Run Plan" });
  const b = buildBetaFeedbackMailto({ route: "/x", section: "Agent Run Plan" });
  assert.equal(a, b);
});
