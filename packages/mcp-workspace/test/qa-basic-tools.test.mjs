// Stage 151 — tool-by-tool QA test. Real stdio spawn (stable per Stage 150); drives
// all 9 Basic tools + malformed + sensitive-omission checks.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBasicToolsQa } from "../scripts/qa-basic-tools.mjs";

describe("MCP Basic tool-by-tool QA", () => {
  it("passes for all 9 tools, malformed input, and sensitive omission", { timeout: 30000 }, async () => {
    const r = await runBasicToolsQa();
    assert.deepEqual(r.failures, [], `unexpected failures: ${r.failures.join(", ")}`);
    assert.equal(r.ok, true);
    assert.equal(r.toolsTested, 9);
    for (const [name, status] of Object.entries(r.results)) {
      assert.equal(status, "pass", `${name} should pass`);
    }
    assert.equal(Object.keys(r.results).length, 9);
    assert.equal(r.malformedPass, true);
    assert.equal(r.sensitiveOmitPass, true);
    assert.equal(r.networkRequired, false);
    assert.equal(r.credentialsRequired, false);
  });
});
