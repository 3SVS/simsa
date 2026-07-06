import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_CATALOG, mcpToolById, detectMcpTools } from "../src/lib/mcp-catalog.mjs";

describe("mcp-catalog", () => {
  it("every tool has id, label, purpose, authNote, mcpName, serverUrl", () => {
    assert.ok(MCP_CATALOG.length > 0);
    for (const t of MCP_CATALOG) {
      for (const field of ["id", "label", "purpose", "authNote", "mcpName", "serverUrl"]) {
        assert.ok(typeof t[field] === "string" && t[field].length > 0, `${t.id} missing ${field}`);
      }
    }
  });

  it("serverUrl is a public https MCP endpoint, never a secret; no hardcoded agent command", () => {
    for (const t of MCP_CATALOG) {
      // The stable fact is the server URL — the connect command is derived
      // per-agent in agent-registry, not baked to Claude Code here.
      assert.match(t.serverUrl, /^https:\/\/\S+/, `${t.id} serverUrl should be an https URL`);
      assert.ok(!/ghp_|sk-|Bearer /.test(t.serverUrl), `${t.id} serverUrl must not embed a secret`);
      assert.ok(!("connectCommand" in t), `${t.id} must not hardcode a connectCommand`);
    }
  });

  it("collects NO tokens — no key/value/secret/env fields anywhere", () => {
    // Option A invariant: this catalog is pure guidance. If a token-input field
    // ever leaks in, that's a security regression (we'd be collecting secrets).
    for (const t of MCP_CATALOG) {
      for (const banned of ["value", "secret", "envVars", "key", "token"]) {
        assert.ok(!(banned in t), `${t.id} must not carry a "${banned}" field`);
      }
    }
  });

  it("every authNote reassures the token never goes to Simsa", () => {
    for (const t of MCP_CATALOG) {
      assert.ok(t.authNote.includes("Simsa"), `${t.id} authNote should mention Simsa`);
      assert.ok(
        t.authNote.includes("저장하지") || t.authNote.includes("받지"),
        `${t.id} authNote should say we don't receive/store it`,
      );
    }
  });

  it("detectMcpTools returns github then vercel (connect order)", () => {
    const tools = detectMcpTools();
    assert.deepEqual(
      tools.map((t) => t.id),
      ["github", "vercel"],
    );
  });

  it("detectMcpTools returns fresh clones (no shared mutation)", () => {
    const a = detectMcpTools();
    a[0].label = "mutated";
    const b = detectMcpTools();
    assert.notEqual(b[0].label, "mutated");
    assert.notEqual(MCP_CATALOG[0].label, "mutated");
  });

  it("mcpToolById returns a clone or null", () => {
    const gh = mcpToolById("github");
    assert.ok(gh && gh.id === "github");
    gh.label = "mutated";
    assert.notEqual(MCP_CATALOG.find((t) => t.id === "github").label, "mutated");
    assert.equal(mcpToolById("nope"), null);
  });
});
