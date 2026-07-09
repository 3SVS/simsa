import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchProjectRepoSettled, repoConnectedFact } from "../src/lib/repo-settle.mjs";

// Root-cause pin for the code-check "reverts to 2 코드변경 + drops the linked PR"
// bug: a just-linked repo transiently returns {ok:true, repo:null} (D1
// read-after-write). The sidebar + overview collapsed that to a hard `false`
// with no retry. The shared helper must retry transient nulls so a connected
// repo resolves, and a confirmed-no-repo (persistently null) still returns
// false — while unknown (fetch failed) stays null so the flow never falsely locks.

const REPO = { fullName: "owner/repo" };

function fakeFetch(sequence) {
  let i = 0;
  return async () => sequence[Math.min(i++, sequence.length - 1)];
}

describe("fetchProjectRepoSettled — retries transient read-after-write null", () => {
  it("resolves a repo that appears on a later attempt (just-linked)", async () => {
    const fetch = fakeFetch([
      { ok: true, repo: null }, // transient right after link
      { ok: true, repo: null },
      { ok: true, repo: REPO }, // D1 settled
    ]);
    const res = await fetchProjectRepoSettled(fetch, "p1", "uk", { delayMs: 0 });
    assert.deepEqual(res.repo, REPO);
    assert.equal(repoConnectedFact(res), true, "connected → true (no false revert)");
  });

  it("confirmed no repo after retries → false", async () => {
    const fetch = fakeFetch([{ ok: true, repo: null }]); // always null
    const res = await fetchProjectRepoSettled(fetch, "p1", "uk", { attempts: 3, delayMs: 0 });
    assert.equal(res.repo, null);
    assert.equal(repoConnectedFact(res), false, "genuinely no repo → false (step legitimately shows connect)");
  });

  it("no retry needed when the first fetch already has the repo", async () => {
    let calls = 0;
    const fetch = async () => { calls++; return { ok: true, repo: REPO }; };
    const res = await fetchProjectRepoSettled(fetch, "p1", "uk", { delayMs: 0 });
    assert.equal(calls, 1, "connected repo resolves on the first call — no delay");
    assert.equal(repoConnectedFact(res), true);
  });

  it("fetch failure stays unknown (null), never a hard false", async () => {
    const fetch = fakeFetch([{ ok: false, error: "HTTP 503" }]);
    const res = await fetchProjectRepoSettled(fetch, "p1", "uk", { delayMs: 0 });
    assert.equal(repoConnectedFact(res), null, "transient fetch error must not lock the flow");
  });

  it("does not retry on a fetch error (ok:false) — only on ok+null", async () => {
    let calls = 0;
    const fetch = async () => { calls++; return { ok: false }; };
    await fetchProjectRepoSettled(fetch, "p1", "uk", { attempts: 3, delayMs: 0 });
    assert.equal(calls, 1, "an error is not a transient-null → no extra attempts");
  });
});
