import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBuiltWith, KNOWN_BUILT_WITH_TOOLS } from "../dist/workspace/built-with.js";

test("known tools normalize + dedupe", () => {
  const b = normalizeBuiltWith({ tools: ["v0", "cursor", "v0"] });
  assert.deepEqual(b.tools, ["v0", "cursor"]);
});

test("aliases fold to canonical", () => {
  const b = normalizeBuiltWith({ tools: ["v0.dev", "Claude Code", "bolt.new"] });
  assert.ok(b.tools.includes("v0"));
  assert.ok(b.tools.includes("claude-code"));
  assert.ok(b.tools.includes("bolt"));
});

test("unknown tool folds into `other` (market radar), not dropped", () => {
  const b = normalizeBuiltWith({ tools: ["cursor", "SomeNewTool"] });
  assert.ok(b.tools.includes("cursor"));
  assert.ok(b.tools.includes("other"));
  assert.match(b.other, /SomeNewTool/);
});

test("explicit other free text is kept and adds the `other` sentinel", () => {
  const b = normalizeBuiltWith({ tools: ["v0"], other: "MyTool 2.0" });
  assert.ok(b.tools.includes("other"));
  assert.equal(b.other, "MyTool 2.0");
});

test("primary is honored only if in tools", () => {
  assert.equal(normalizeBuiltWith({ tools: ["v0", "cursor"], primary: "cursor" }).primary, "cursor");
  assert.equal(normalizeBuiltWith({ tools: ["v0"], primary: "cursor" }).primary, undefined);
});

test("modelNote passthrough (clamped)", () => {
  const b = normalizeBuiltWith({ tools: ["cursor"], modelNote: "Cursor (Claude Sonnet)" });
  assert.equal(b.modelNote, "Cursor (Claude Sonnet)");
});

test("empty / junk input → null", () => {
  assert.equal(normalizeBuiltWith(null), null);
  assert.equal(normalizeBuiltWith({}), null);
  assert.equal(normalizeBuiltWith({ tools: [] }), null);
  assert.equal(normalizeBuiltWith("v0"), null);
});

test("clamps: at most 10 tools, other/modelNote length-bounded", () => {
  const many = Array.from({ length: 30 }, (_, i) => `tool${i}`);
  const b = normalizeBuiltWith({ tools: many, other: "x".repeat(500), modelNote: "y".repeat(500) });
  assert.ok(b.tools.length <= 10);
  assert.ok((b.other ?? "").length <= 200);
  assert.ok((b.modelNote ?? "").length <= 200);
});

test("canonical list is stable + includes other sentinel", () => {
  assert.ok(KNOWN_BUILT_WITH_TOOLS.includes("other"));
  assert.ok(KNOWN_BUILT_WITH_TOOLS.includes("v0"));
  assert.ok(KNOWN_BUILT_WITH_TOOLS.includes("claude-code"));
});
