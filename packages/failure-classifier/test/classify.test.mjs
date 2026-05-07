import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyByPattern,
  classifyFailure,
  fallbackDiagnosis,
  renderDiagnosisKorean,
  renderDiagnosisEnglish,
} from "../dist/index.js";

// --- Pattern: Supabase paused ----------------------------------------------

test("classifyByPattern: TypeError fetch failed + supabase deps → supabase-paused", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 500,
    responseBody: "TypeError: fetch failed at fetch (lib/supabase.js:14)",
    errorMessage: "fetch failed",
    repoContext: { packageJsonDeps: ["@supabase/supabase-js", "next"] },
  });
  assert.ok(diag);
  assert.equal(diag.category, "backend-unreachable");
  assert.equal(diag.likelyCause, "supabase-paused");
  assert.ok(diag.confidence >= 0.7);
  assert.ok(diag.userActions.length >= 1);
  assert.match(diag.userActions[0].url ?? "", /supabase\.com/);
});

test("classifyByPattern: fetch failed without supabase deps + 'supabase' in body still matches", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 500,
    responseBody: "TypeError: fetch failed (Supabase Auth)",
    errorMessage: "fetch failed",
  });
  assert.ok(diag);
  assert.equal(diag.likelyCause, "supabase-paused");
});

// --- Pattern: env var missing ----------------------------------------------

test("classifyByPattern: extracts env var name from error", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 500,
    responseBody: "Error: process.env.STRIPE_SECRET_KEY is undefined",
    errorMessage: "process.env.STRIPE_SECRET_KEY is undefined",
  });
  assert.ok(diag);
  assert.equal(diag.category, "credentials-missing");
  assert.match(diag.summary, /STRIPE_SECRET_KEY/);
});

// --- Pattern: db migration -------------------------------------------------

test("classifyByPattern: relation does not exist → db-migration-needed", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 500,
    responseBody: 'PostgresError: relation "events" does not exist',
    errorMessage: "Postgres error",
  });
  assert.ok(diag);
  assert.equal(diag.category, "db-migration-needed");
  assert.match(diag.summary, /events/);
});

// --- Pattern: rate limit ---------------------------------------------------

test("classifyByPattern: HTTP 429 → api-quota-hit regardless of body", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 429,
    responseBody: "",
    errorMessage: "got 429",
  });
  assert.ok(diag);
  assert.equal(diag.category, "api-quota-hit");
});

test("classifyByPattern: 'rate limit' in body → api-quota-hit", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 500,
    responseBody: "Anthropic rate limit exceeded",
    errorMessage: "rate limit",
  });
  assert.ok(diag);
  assert.equal(diag.category, "api-quota-hit");
});

// --- Pattern: connection refused -------------------------------------------

test("classifyByPattern: ECONNREFUSED to localhost → localhost-target-in-prod", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    errorMessage: "connect ECONNREFUSED 127.0.0.1:3000",
  });
  assert.ok(diag);
  assert.equal(diag.category, "service-not-running");
  assert.equal(diag.likelyCause, "localhost-target-in-prod");
});

// --- Pattern: missing dep --------------------------------------------------

test("classifyByPattern: Cannot find module → missing-dep", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseBody: "Error: Cannot find module 'sharp'",
    errorMessage: "Cannot find module 'sharp'",
  });
  assert.ok(diag);
  assert.equal(diag.category, "missing-dep");
  assert.match(diag.summary, /sharp/);
});

// --- Pattern: asset 404 / build config -------------------------------------

test("classifyByPattern: missing public dir → build-config-error", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    errorMessage: 'No Output Directory named "public" found after the Build completed.',
  });
  assert.ok(diag);
  assert.equal(diag.category, "build-config-error");
  assert.equal(diag.likelyCause, "wrong-output-directory");
});

// --- Pattern: auth misconfig -----------------------------------------------

test("classifyByPattern: HTTP 401 → auth-misconfig", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 401,
    errorMessage: "got 401",
  });
  assert.ok(diag);
  assert.equal(diag.category, "auth-misconfig");
});

// --- Fallback / classifyFailure ------------------------------------------

test("classifyByPattern: unrecognized error returns null", () => {
  const diag = classifyByPattern({
    stepKind: "goto",
    responseStatus: 200,
    errorMessage: "expected 'Welcome' but got 'Hello'",
  });
  assert.equal(diag, null);
});

test("classifyFailure: falls back when no pattern + no LLM", async () => {
  const diag = await classifyFailure({
    stepKind: "expect-text",
    errorMessage: "weird thing nobody anticipated",
  });
  assert.equal(diag.source, "fallback");
  assert.equal(diag.category, "unknown");
});

test("classifyFailure: uses LLM hook when patterns miss", async () => {
  const diag = await classifyFailure(
    { stepKind: "expect-text", errorMessage: "obscure" },
    {
      llmClassify: async () => ({
        category: "auth-misconfig",
        likelyCause: "claude-said-so",
        confidence: 0.6,
        evidence: ["LLM judgment"],
        summary: "LLM-classified",
        userActions: [{ step: "do thing" }],
        retryHint: "retry",
        source: "llm",
      }),
    },
  );
  assert.equal(diag.source, "llm");
  assert.equal(diag.likelyCause, "claude-said-so");
});

test("classifyFailure: pattern wins over LLM", async () => {
  const diag = await classifyFailure(
    { stepKind: "goto", responseStatus: 429, errorMessage: "got 429" },
    {
      llmClassify: async () => ({
        category: "unknown",
        likelyCause: "shouldnt-be-called",
        confidence: 0.99,
        evidence: [],
        summary: "",
        userActions: [],
        retryHint: "",
        source: "llm",
      }),
    },
  );
  assert.equal(diag.source, "pattern");
  assert.equal(diag.category, "api-quota-hit");
});

// --- Renderers ----------------------------------------------------------

test("renderDiagnosisKorean: includes summary + actions + retry hint", () => {
  const diag = fallbackDiagnosis({ stepKind: "goto", errorMessage: "x" });
  const out = renderDiagnosisKorean(diag);
  assert.match(out, /진단:/);
  assert.match(out, /필요한 조치:/);
  assert.match(out, /이후:/);
});

test("renderDiagnosisEnglish: includes summary + actions + retry hint", () => {
  const diag = fallbackDiagnosis({ stepKind: "goto", errorMessage: "x" });
  const out = renderDiagnosisEnglish(diag);
  assert.match(out, /Diagnosis:/);
  assert.match(out, /What to do:/);
  assert.match(out, /After fixing:/);
});
