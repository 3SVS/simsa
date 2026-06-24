// Stage 103 — Product URL intake preview tests. Pure/deterministic; no fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProductUrlIntakePreview,
  SAMPLE_PRODUCT_URL,
} from "../src/intake-url.mjs";

test("normalizes a bare domain", () => {
  const p = buildProductUrlIntakePreview("example.com");
  assert.equal(p.domain, "example.com");
  assert.equal(p.normalizedUrl, "https://example.com");
  assert.equal(p.pathType, "homepage");
});

test("detects homepage", () => {
  assert.equal(buildProductUrlIntakePreview("https://example.com/").pathType, "homepage");
  assert.equal(buildProductUrlIntakePreview("https://example.com").pathType, "homepage");
});

test("detects pricing path", () => {
  const p = buildProductUrlIntakePreview("https://example.com/pricing");
  assert.equal(p.pathType, "pricing");
  assert.ok(p.missingQuestions.some((q) => /billing terms/.test(q)));
});

test("detects docs/developer path", () => {
  assert.equal(buildProductUrlIntakePreview("https://example.com/docs").pathType, "docs");
  assert.equal(buildProductUrlIntakePreview("https://example.com/developers").pathType, "docs");
  const p = buildProductUrlIntakePreview("https://example.com/docs");
  assert.ok(p.missingQuestions.some((q) => /developer action/.test(q)));
});

test("detects app subdomain", () => {
  const p = buildProductUrlIntakePreview("https://app.example.com");
  assert.equal(p.pathType, "app");
  assert.ok(p.missingQuestions.some((q) => /new users with no data/.test(q)));
});

test("detects demo path", () => {
  assert.equal(buildProductUrlIntakePreview(SAMPLE_PRODUCT_URL).pathType, "demo");
});

test("handles invalid input without throwing", () => {
  for (const bad of ["", "   ", "not a url", "justtext", null]) {
    const p = buildProductUrlIntakePreview(bad);
    assert.equal(p.domain, "Unknown");
    assert.equal(p.pathType, "unknown");
    assert.equal(p.confidence, "low");
  }
});

test("every preview has focus areas, acceptance items, and 3-6 questions", () => {
  for (const u of [SAMPLE_PRODUCT_URL, "example.com/pricing", "bad input"]) {
    const p = buildProductUrlIntakePreview(u);
    assert.ok(p.reviewFocusAreas.length >= 3);
    assert.ok(p.candidateAcceptanceItems.length >= 4);
    assert.ok(p.missingQuestions.length >= 3 && p.missingQuestions.length <= 6);
  }
});

test("is deterministic", () => {
  assert.deepEqual(
    buildProductUrlIntakePreview(SAMPLE_PRODUCT_URL),
    buildProductUrlIntakePreview(SAMPLE_PRODUCT_URL),
  );
});
