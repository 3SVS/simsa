import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_CATALOG, mcpToolById, detectMcpTools } from "../src/lib/mcp-catalog.mjs";

describe("mcp-catalog", () => {
  it("every tool has id, label, purpose, connectHint, authNote, connectCommand, authStep", () => {
    assert.ok(MCP_CATALOG.length > 0);
    for (const t of MCP_CATALOG) {
      for (const field of ["id", "label", "purpose", "connectHint", "authNote", "connectCommand", "authStep"]) {
        assert.ok(typeof t[field] === "string" && t[field].length > 0, `${t.id} missing ${field}`);
      }
    }
  });

  it("connectCommand is a real 'claude mcp add' command and authStep points to /mcp", () => {
    for (const t of MCP_CATALOG) {
      assert.ok(
        t.connectCommand.startsWith("claude mcp add "),
        `${t.id} connectCommand should be a claude mcp add command`,
      );
      // the command carries a public https server URL, never a secret
      assert.match(t.connectCommand, /https:\/\/\S+/);
      assert.ok(!/ghp_|sk-|Bearer /.test(t.connectCommand), `${t.id} command must not embed a secret`);
      assert.ok(t.authStep.includes("/mcp"), `${t.id} authStep should tell the user to run /mcp`);
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
