// Episodic TTL enforcement (decision #17): 90-day prune of the raw episodic
// log. Answer-keys / failure-catalog are ∞ TTL and must never be touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSystemMemoryStore, OutcomeWriter } from "../dist/index.js";

function freshFs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aic-prune-"));
  return { store: new FileSystemMemoryStore({ root, skipBundledSeeds: true }), root };
}
function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

const NOW = new Date("2026-07-03T12:00:00.000Z");

function entryAt(isoDay, id) {
  return {
    id,
    createdAt: `${isoDay}T08:00:00.000Z`,
    repo: "acme/app",
    pullNumber: 7,
    sha: "abc123",
    diffSha256: "a".repeat(64),
    reviews: [],
    councilVerdict: "approve",
    outcome: "pending",
    costUsd: 0,
    cycleNumber: 1,
    solutionPatches: [],
  };
}

test("pruneEpisodic removes day buckets older than the 90d cutoff and keeps the rest", async () => {
  const { store, root } = freshFs();
  try {
    await store.writeEpisodic(entryAt("2026-01-01", "ep_old1")); // ~183d old → pruned
    await store.writeEpisodic(entryAt("2026-04-03", "ep_edge")); // < cutoff (2026-04-04) → pruned
    await store.writeEpisodic(entryAt("2026-04-04", "ep_cutoff")); // exactly cutoff day → kept
    await store.writeEpisodic(entryAt("2026-07-01", "ep_new")); // recent → kept

    const res = await store.pruneEpisodic({ now: NOW });
    assert.equal(res.cutoffDay, "2026-04-04");
    assert.equal(res.removedDays, 2);
    assert.equal(res.removedEntries, 2);

    const remaining = await store.listEpisodic();
    const ids = remaining.map((e) => e.id).sort();
    assert.deepEqual(ids, ["ep_cutoff", "ep_new"]);
    assert.equal(await store.findEpisodic("ep_old1"), null);
  } finally {
    cleanup(root);
  }
});

test("pruneEpisodic honors a custom ttlDays", async () => {
  const { store, root } = freshFs();
  try {
    await store.writeEpisodic(entryAt("2026-06-25", "ep_a")); // 8d old
    await store.writeEpisodic(entryAt("2026-07-02", "ep_b")); // 1d old
    const res = await store.pruneEpisodic({ ttlDays: 7, now: NOW });
    assert.equal(res.removedDays, 1);
    const ids = (await store.listEpisodic()).map((e) => e.id);
    assert.deepEqual(ids, ["ep_b"]);
  } finally {
    cleanup(root);
  }
});

test("pruneEpisodic never touches answer-keys, failure-catalog, or non-date dirs", async () => {
  const { store, root } = freshFs();
  try {
    await store.writeEpisodic(entryAt("2026-01-01", "ep_old"));
    await store.writeAnswerKey({
      id: "ak_1",
      createdAt: "2025-01-01T00:00:00.000Z", // ancient — must survive anyway
      domain: "code",
      pattern: "auth",
      lesson: "always bind userKey",
      tags: ["auth"],
    });
    await store.writeFailure({
      id: "fl_1",
      createdAt: "2025-01-01T00:00:00.000Z",
      domain: "code",
      category: "security",
      severity: "blocker",
      title: "IDOR",
      body: "ownership check missing",
      tags: ["security"],
    });
    // A stray non-date directory inside episodic/ must be left alone.
    const strayDir = path.join(root, "episodic", "not-a-date");
    fs.mkdirSync(strayDir, { recursive: true });
    fs.writeFileSync(path.join(strayDir, "keep.json"), "{}", "utf8");

    const res = await store.pruneEpisodic({ now: NOW });
    assert.equal(res.removedDays, 1);
    assert.equal((await store.listAnswerKeys("code")).length, 1);
    assert.equal((await store.listFailures("code")).length, 1);
    assert.ok(fs.existsSync(path.join(strayDir, "keep.json")));
  } finally {
    cleanup(root);
  }
});

test("pruneEpisodic on an empty store is a no-op", async () => {
  const { store, root } = freshFs();
  try {
    const res = await store.pruneEpisodic({ now: NOW });
    assert.equal(res.removedDays, 0);
    assert.equal(res.removedEntries, 0);
  } finally {
    cleanup(root);
  }
});

test("OutcomeWriter.writeReview survives a throwing pruneEpisodic (best-effort)", async () => {
  const { store, root } = freshFs();
  try {
    const wrapped = Object.create(store);
    wrapped.pruneEpisodic = async () => {
      throw new Error("disk hiccup");
    };
    const writer = new OutcomeWriter({ store: wrapped });
    const entry = await writer.writeReview({
      ctx: { repo: "acme/app", pullNumber: 1, newSha: "s1", diff: "diff" },
      reviews: [],
      councilVerdict: "approve",
      costUsd: 0,
    });
    assert.ok(entry.id);
    assert.equal((await store.listEpisodic()).length, 1);
  } finally {
    cleanup(root);
  }
});

test("OutcomeWriter.writeReview opportunistically prunes stale episodic entries", async () => {
  const { store, root } = freshFs();
  try {
    await store.writeEpisodic(entryAt("2026-01-01", "ep_stale"));
    const writer = new OutcomeWriter({ store });
    await writer.writeReview({
      ctx: { repo: "acme/app", pullNumber: 2, newSha: "s2", diff: "diff" },
      reviews: [],
      councilVerdict: "approve",
      costUsd: 0,
    });
    // The stale bucket (well past 90d relative to the real clock) is gone;
    // the just-written entry remains.
    assert.equal(await store.findEpisodic("ep_stale"), null);
    assert.equal((await store.listEpisodic()).length, 1);
  } finally {
    cleanup(root);
  }
});
