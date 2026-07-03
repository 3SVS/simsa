import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Council,
  TieredCouncil,
  compactPriorReviews,
  DEFAULT_PRIOR_SUMMARY_TARGET_TOKENS,
} from "../dist/index.js";

// ---------------------------------------------------------------------
// Decision #22 wiring — round-to-round prior compaction.
// compactPriorReviews unit behavior + the Council / TieredCouncil seams.
// ---------------------------------------------------------------------

const ctx = { diff: "", repo: "acme/x", pullNumber: 1, newSha: "HEAD" };

function prior(agent, verdict, summary, blockers = []) {
  const p = { agent, verdict, blockers };
  if (summary !== undefined) p.summary = summary;
  return p;
}

/** Agent with a fixed verdict + a controllable summary; records every ctx. */
function recordingAgent(id, verdict, summary, blockers = []) {
  const seen = [];
  const agent = {
    id,
    displayName: id,
    review: async (reviewCtx) => {
      seen.push(reviewCtx);
      return { agent: id, verdict, blockers, summary };
    },
  };
  agent.seen = seen;
  return agent;
}

// ---------------------------------------------------------------------
// compactPriorReviews (pure)
// ---------------------------------------------------------------------

test("compactPriorReviews: under budget → priors pass through untouched", async () => {
  const priors = [
    prior("a", "approve", "short summary"),
    prior("b", "rework", "another short one"),
  ];
  const out = await compactPriorReviews(priors);
  assert.deepEqual(out, priors);
  // Same objects — zero-copy pass-through when nothing to compact.
  assert.equal(out[0], priors[0]);
});

test("compactPriorReviews: over budget → oldest summaries dropped, structure intact", async () => {
  const huge = "x".repeat(30_000); // ~7500 tokens > default 2000 budget
  const small = "y".repeat(100);
  const blockers = [{ severity: "major", category: "bug", message: "boom" }];
  const priors = [prior("a", "rework", huge, blockers), prior("b", "approve", small)];
  const out = await compactPriorReviews(priors);
  assert.equal(out.length, 2);
  // Structured debate signal is never touched.
  assert.equal(out[0].agent, "a");
  assert.equal(out[0].verdict, "rework");
  assert.deepEqual(out[0].blockers, blockers);
  // The huge (older-positioned) summary is dropped; the small tail fits.
  assert.equal(out[0].summary, undefined);
  assert.equal(out[1].summary, small);
  // Size reduction: remaining summary text is under the token budget.
  const remaining = out.reduce((n, p) => n + (p.summary?.length ?? 0), 0);
  assert.ok(remaining <= DEFAULT_PRIOR_SUMMARY_TARGET_TOKENS * 4);
  assert.ok(remaining < huge.length + small.length);
});

test("compactPriorReviews: explicit targetTokens is honored", async () => {
  const priors = [prior("a", "approve", "z".repeat(400)), prior("b", "approve", "w".repeat(400))];
  // 200 total tokens vs target 150 → only the newest 100-token summary fits.
  const out = await compactPriorReviews(priors, { targetTokens: 150 });
  assert.equal(out[0].summary, undefined);
  assert.equal(out[1].summary, "w".repeat(400));
});

// ---------------------------------------------------------------------
// Council seam — round 2 sees compacted priors (default ON)
// ---------------------------------------------------------------------

test("Council: round-2 priors are compacted by default when summaries exceed budget", async () => {
  const huge = "h".repeat(30_000);
  const a = recordingAgent("a", "approve", huge);
  const b = recordingAgent("b", "rework", "b stays short", [
    { severity: "minor", category: "style", message: "nit" },
  ]);
  const council = new Council({ agents: [a, b], maxRounds: 2, retry: { maxRetries: 0 } });
  const out = await council.deliberate(ctx);
  assert.equal(out.rounds, 2); // approve+rework → no consensus → round 2 ran
  const round2Ctx = a.seen[1];
  assert.ok(round2Ctx.priors, "round 2 must carry priors");
  const pa = round2Ctx.priors.find((p) => p.agent === "a");
  const pb = round2Ctx.priors.find((p) => p.agent === "b");
  // Huge summary dropped, short one kept, verdicts + blockers intact.
  assert.equal(pa.summary, undefined);
  assert.equal(pa.verdict, "approve");
  assert.equal(pb.summary, "b stays short");
  assert.equal(pb.blockers.length, 1);
  const totalSummaryChars = round2Ctx.priors.reduce((n, p) => n + (p.summary?.length ?? 0), 0);
  assert.ok(totalSummaryChars < huge.length, "round-2 priors must be smaller than the raw text");
});

test("Council: priorCompaction.enabled=false preserves full prior text (no behavior change)", async () => {
  const huge = "h".repeat(30_000);
  const a = recordingAgent("a", "approve", huge);
  const b = recordingAgent("b", "rework", "short");
  const council = new Council({
    agents: [a, b],
    maxRounds: 2,
    retry: { maxRetries: 0 },
    priorCompaction: { enabled: false },
  });
  await council.deliberate(ctx);
  const round2Ctx = a.seen[1];
  const pa = round2Ctx.priors.find((p) => p.agent === "a");
  assert.equal(pa.summary, huge);
});

test("Council: small summaries are untouched even with compaction on", async () => {
  const a = recordingAgent("a", "approve", "tiny a");
  const b = recordingAgent("b", "rework", "tiny b");
  const council = new Council({ agents: [a, b], maxRounds: 2, retry: { maxRetries: 0 } });
  await council.deliberate(ctx);
  const round2Ctx = b.seen[1];
  assert.equal(round2Ctx.priors.find((p) => p.agent === "a").summary, "tiny a");
  assert.equal(round2Ctx.priors.find((p) => p.agent === "b").summary, "tiny b");
});

// ---------------------------------------------------------------------
// TieredCouncil seam — tier-1 → tier-2 handoff priors are compacted
// ---------------------------------------------------------------------

test("TieredCouncil: tier-2 receives compacted tier-1 priors by default", async () => {
  const huge = "t".repeat(30_000);
  const t1 = recordingAgent("draft", "rework", huge, [
    { severity: "major", category: "bug", message: "found it" },
  ]);
  const t2 = recordingAgent("opus", "approve", "fine");
  const council = new TieredCouncil({ tier1Agents: [t1], tier2Agents: [t2] });
  const out = await council.deliberate({ ...ctx, domain: "code" });
  assert.equal(out.escalated, true);
  const tier2Ctx = t2.seen[0];
  const p = tier2Ctx.priors.find((x) => x.agent === "draft");
  assert.equal(p.summary, undefined, "huge tier-1 summary must be compacted away");
  assert.equal(p.verdict, "rework");
  assert.equal(p.blockers.length, 1, "blockers survive compaction");
});

test("TieredCouncil: priorCompaction.enabled=false hands tier-2 the full tier-1 text", async () => {
  const huge = "t".repeat(30_000);
  const t1 = recordingAgent("draft", "rework", huge);
  const t2 = recordingAgent("opus", "approve", "fine");
  const council = new TieredCouncil({
    tier1Agents: [t1],
    tier2Agents: [t2],
    priorCompaction: { enabled: false },
  });
  await council.deliberate({ ...ctx, domain: "code" });
  const p = t2.seen[0].priors.find((x) => x.agent === "draft");
  assert.equal(p.summary, huge);
});
