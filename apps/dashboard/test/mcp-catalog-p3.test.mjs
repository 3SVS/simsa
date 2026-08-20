/**
 * mcp-catalog-p3.test.mjs — 스택 불가지 P3 (§3-3, D-2).
 * MCP 연결 패널이 호스팅 답변을 소비한다 — Netlify/기타/빌더 내장 유저에게
 * Vercel MCP를 권하지 않는다. P3 이전 코드(항상 GitHub+Vercel)에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectMcpTools } from "../src/lib/mcp-catalog.mjs";

const ids = (tools) => tools.map((t) => t.id);

describe("detectMcpTools — 호스팅 축 소비 (P3 §3-3)", () => {
  it("미응답/unknown/none_yet/vercel → 종전 그대로 GitHub+Vercel (무회귀)", () => {
    assert.deepEqual(ids(detectMcpTools("ko")), ["github", "vercel"]);
    assert.deepEqual(ids(detectMcpTools("ko", null)), ["github", "vercel"]);
    assert.deepEqual(ids(detectMcpTools("ko", { hosting: { id: "unknown" } })), ["github", "vercel"]);
    assert.deepEqual(ids(detectMcpTools("ko", { hosting: { id: "none_yet" } })), ["github", "vercel"]);
    assert.deepEqual(ids(detectMcpTools("en", { hosting: { id: "vercel" } })), ["github", "vercel"]);
  });

  it("netlify → Vercel MCP를 권하지 않는다", () => {
    assert.deepEqual(ids(detectMcpTools("ko", { hosting: { id: "netlify" } })), ["github"]);
  });

  it('other("회사 서버") → Vercel MCP를 권하지 않는다 (틀린 도구 안내 금지)', () => {
    assert.deepEqual(ids(detectMcpTools("en", { hosting: { id: "other", other: "회사 서버" } })), ["github"]);
  });

  it("builder_hosted → Vercel MCP 없음 (배포는 빌더의 Publish 버튼)", () => {
    assert.deepEqual(ids(detectMcpTools("ko", { hosting: { id: "builder_hosted" } })), ["github"]);
  });
});
