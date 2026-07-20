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

// v2 (2026-07-21, journey-audit 재감사): EN 화면 잔여 한글 177자의 출처가 이
// 카탈로그였다 — EN 해석은 무한글 전수, 기본값은 KO(기존 호출자 무변경).
describe("mcp-catalog: locale resolution", () => {
  it('locale "en" resolves every user-facing string without Hangul', () => {
    for (const tool of detectMcpTools("en")) {
      for (const text of [tool.label, tool.purpose, tool.authNote]) {
        assert.ok(!/[가-힣]/.test(text), `Hangul leaked in EN copy of ${tool.id}: ${text}`);
      }
    }
  });

  it("locale omitted defaults to KO; ids/urls are locale-neutral", () => {
    assert.ok(/코드 저장소/.test(mcpToolById("github").label));
    assert.ok(/code storage/.test(mcpToolById("github", "en").label));
    assert.equal(mcpToolById("vercel").serverUrl, mcpToolById("vercel", "en").serverUrl);
    assert.deepEqual(detectMcpTools("ko").map((t) => t.id), detectMcpTools("en").map((t) => t.id));
  });
});
