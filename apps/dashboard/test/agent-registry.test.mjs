import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEV_AGENTS,
  agentById,
  agentLabel,
  primaryAgentForTarget,
  buildClaudeMcpAddCommand,
  resolveMcpConnect,
} from "../src/lib/agent-registry.mjs";

describe("agent-registry", () => {
  it("has claude_code (command style) and codex (settings style)", () => {
    const cc = agentById("claude_code");
    const cx = agentById("codex");
    assert.equal(cc?.mcpStyle, "command");
    assert.equal(cx?.mcpStyle, "settings");
    assert.equal(agentLabel("claude_code"), "Claude Code");
    assert.equal(agentLabel("codex"), "Codex");
  });

  it("agentLabel falls back to the id for an unknown agent", () => {
    assert.equal(agentLabel("nope"), "nope");
    assert.equal(agentById("nope"), null);
  });

  it("primaryAgentForTarget: codex→codex, claude_code/both→claude_code", () => {
    assert.equal(primaryAgentForTarget("codex"), "codex");
    assert.equal(primaryAgentForTarget("claude_code"), "claude_code");
    assert.equal(primaryAgentForTarget("both"), "claude_code");
  });

  it("buildClaudeMcpAddCommand produces the verified command shape", () => {
    assert.equal(
      buildClaudeMcpAddCommand("vercel", "https://mcp.vercel.com"),
      "claude mcp add --transport http vercel https://mcp.vercel.com",
    );
  });

  it("resolveMcpConnect: Claude Code → a copy-paste command", () => {
    const r = resolveMcpConnect("claude_code", { mcpName: "github", serverUrl: "https://api.githubcopilot.com/mcp/" });
    assert.equal(r.style, "command");
    assert.equal(r.agentLabel, "Claude Code");
    assert.ok(r.command.startsWith("claude mcp add "));
    assert.ok(r.command.includes("https://api.githubcopilot.com/mcp/"));
    assert.equal(r.serverUrl, undefined);
  });

  it("resolveMcpConnect: Codex → the server URL to add in settings (no wrong command)", () => {
    const r = resolveMcpConnect("codex", { mcpName: "vercel", serverUrl: "https://mcp.vercel.com" });
    assert.equal(r.style, "settings");
    assert.equal(r.agentLabel, "Codex");
    assert.equal(r.serverUrl, "https://mcp.vercel.com");
    assert.equal(r.command, undefined);
    // never a Claude Code command for a non-Claude agent
    assert.ok(!("command" in r) || r.command === undefined);
  });

  it("neither the command nor the settings path embeds a secret", () => {
    for (const style of ["claude_code", "codex"]) {
      const r = resolveMcpConnect(style, { mcpName: "github", serverUrl: "https://api.githubcopilot.com/mcp/" });
      const text = `${r.command ?? ""} ${r.serverUrl ?? ""}`;
      assert.ok(!/ghp_|sk-|Bearer /.test(text));
    }
  });
});
