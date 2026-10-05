/**
 * agent 엔진 검수 요청 본문 (2026-10-05) — 동의 없이는 로그인 갈래를 보내지 않는다.
 * 화면(AgentRunOptions)은 이 함수만 쓴다. 서버도 같은 것을 다시 확인한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentRunBody, agentOptionsReady } from "../src/lib/agent-run-body.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = { loginMode: "none", username: "", password: "", loginUrl: "", consent: false };

describe("agentRunBody", () => {
  it("로그인 없음 → engine만", () => {
    assert.deepEqual(agentRunBody(base), { engine: "agent" });
    assert.equal(agentOptionsReady(base), true);
  });
  it("시험 계정: 동의 없으면 계정을 보내지 않고 버튼도 꺼진다", () => {
    const v = { ...base, loginMode: "credentials", username: "owner@salon.kr", password: "pw-1234" };
    assert.deepEqual(agentRunBody(v), { engine: "agent" });
    assert.equal(agentOptionsReady(v), false);
    const ok = agentRunBody({ ...v, consent: true, loginUrl: " https://salon.example/login " });
    assert.deepEqual(ok, {
      engine: "agent",
      loginMode: "credentials",
      testCredentials: { username: "owner@salon.kr", password: "pw-1234", loginUrl: "https://salon.example/login", consent: true },
    });
    assert.equal(agentOptionsReady({ ...v, consent: true, password: "123" }), false, "비밀번호 4자 미만");
  });
  it("직접 로그인: 동의가 있어야 handover", () => {
    assert.deepEqual(agentRunBody({ ...base, loginMode: "handover" }), { engine: "agent" });
    assert.deepEqual(agentRunBody({ ...base, loginMode: "handover", consent: true }), { engine: "agent", loginMode: "handover", handoverConsent: true });
  });
  it("동의 문구 KO/EN이 화면에 있고, 비밀번호 칸은 password 타입", () => {
    const src = readFileSync(path.join(here, "..", "src", "components", "AgentRunOptions.tsx"), "utf8");
    assert.match(src, /확인이 끝나면 바로 지워요/);
    assert.match(src, /deleted as soon as the check ends/);
    assert.match(src, /type="password"/);
  });
});
