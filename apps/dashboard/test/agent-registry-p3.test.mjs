/**
 * agent-registry-p3.test.mjs — 스택 불가지 P3 (§3-4·§3-5).
 * 2종으로 닫혀 있던 에이전트 목록 확장 + builtWith→수리팩 타깃 매핑 고정.
 * P3 이전 코드에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEV_AGENTS,
  resolveMcpConnect,
  fixBriefTargetForBuiltWith,
} from "../src/lib/agent-registry.mjs";

describe("agent-registry — P3 확장 (§3-4)", () => {
  it("Cursor/Windsurf/Gemini CLI가 목록에 있고 전부 settings 스타일(안전 강등)", () => {
    for (const id of ["cursor", "windsurf", "gemini_cli"]) {
      const a = DEV_AGENTS.find((x) => x.id === id);
      assert.ok(a, `${id} in DEV_AGENTS`);
      assert.equal(a.mcpStyle, "settings", `${id}: 검증 안 된 CLI 명령을 지어내지 않는다`);
    }
  });

  it("settings 스타일 에이전트는 서버 URL만 받는다 — Claude 명령을 보여주지 않는다", () => {
    const r = resolveMcpConnect("cursor", { mcpName: "vercel", serverUrl: "https://mcp.example.com" });
    assert.equal(r.style, "settings");
    assert.equal(r.serverUrl, "https://mcp.example.com");
    assert.equal(r.command, undefined);
    assert.equal(r.agentLabel, "Cursor");
  });
});

describe("fixBriefTargetForBuiltWith — 수리팩 타깃 매핑 (§3-5)", () => {
  it("웹 빌더 도구 → web_builder", () => {
    assert.equal(fixBriefTargetForBuiltWith(["lovable"]), "web_builder");
    assert.equal(fixBriefTargetForBuiltWith(["v0"]), "web_builder");
    assert.equal(fixBriefTargetForBuiltWith(["bolt"]), "web_builder");
    assert.equal(fixBriefTargetForBuiltWith(["replit"]), "web_builder");
  });

  it("codex → codex, CLI 계열 → claude_code", () => {
    assert.equal(fixBriefTargetForBuiltWith(["codex"]), "codex");
    assert.equal(fixBriefTargetForBuiltWith(["claude-code"]), "claude_code");
    assert.equal(fixBriefTargetForBuiltWith(["cursor"]), "claude_code");
  });

  it("미응답/미지 도구 → undefined (서버 기본 both 유지 — 무회귀)", () => {
    assert.equal(fixBriefTargetForBuiltWith(undefined), undefined);
    assert.equal(fixBriefTargetForBuiltWith([]), undefined);
    assert.equal(fixBriefTargetForBuiltWith(["hand-coded"]), undefined);
    assert.equal(fixBriefTargetForBuiltWith(["other"]), undefined);
  });

  it("복수 선택은 첫 매치 우선", () => {
    assert.equal(fixBriefTargetForBuiltWith(["lovable", "claude-code"]), "web_builder");
  });
});
