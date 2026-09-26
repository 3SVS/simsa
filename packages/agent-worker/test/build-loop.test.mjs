/**
 * B4 — 빌드 루프. 가짜 클라이언트(대본대로 tool_use 응답)와 가짜 실행기로, 네트워크·파일시스템 0.
 * 핵심 고정: 거부된 호출은 실행기에 절대 도달하지 않는다 · finish로 끝난다 · 상한이 정직하게 끝낸다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runBuildLoop } = await import("../dist/build-loop.js");

const usage = { input_tokens: 100, output_tokens: 50 };
/** 턴마다 하나의 응답을 순서대로 돌려주는 클라이언트. 받은 params를 기록한다. */
function scriptedClient(script) {
  const seen = [];
  let i = 0;
  return {
    seen,
    messages: {
      create: async (params) => {
        seen.push(JSON.parse(JSON.stringify(params))); // messages 배열은 루프가 제자리에서 키운다 — 턴 시점 스냅샷
        const blocks = script[Math.min(i, script.length - 1)];
        i += 1;
        return { id: `msg_${i}`, model: params.model, content: blocks, stop_reason: "tool_use", usage };
      },
    },
  };
}
const tu = (name, input, id = `tu_${name}_${Math.random().toString(36).slice(2, 6)}`) => ({ type: "tool_use", id, name, input });

function fakeExecutor(files = {}) {
  const store = new Map(Object.entries(files));
  const commands = [];
  return {
    store, commands,
    readFile: async (p) => (store.has(p) ? store.get(p) : null),
    listFiles: async () => [...store.keys()],
    createFile: async (p, c) => { store.set(p, c); },
    runCommand: async (cmd, args) => { commands.push([cmd, ...args].join(" ")); return { ok: true, code: 0, stdout: "ok", stderr: "" }; },
  };
}

const TASK = { specMarkdown: "# 빵집\nAC-001 오늘의 빵 목록", wbsId: "WBS-001", wbsTitle: "빵 목록 API", acceptanceIds: ["AC-001"], locale: "ko", fileList: ["src/worker.ts", "package.json"] };
const gate = { run: async (_input, execute) => { const r = await execute({ model: "test-model" }); return { result: r.result, metric: { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs } }; } };

describe("runBuildLoop", () => {
  it("read → create → build → finish(done): 파일 기록·명령 실행·빌드 코드·비용 집계", async () => {
    const client = scriptedClient([
      [tu("read_file", { path: "src/worker.ts" })],
      [tu("create_file", { path: "src/worker.ts", content: "export default { fetch() { return new Response('빵') } }" }), tu("run_command", { cmd: "pnpm", args: ["run", "build"] })],
      [tu("finish", { status: "done", summary: "AC-001 구현", commitMessage: "feat: 빵 목록 API" })],
    ]);
    const ex = fakeExecutor({ "src/worker.ts": "old" });
    const r = await runBuildLoop(TASK, { client, executor: ex, model: "test-model", gate, baseEnv: { PATH: "/bin", VERCEL_TOKEN: "x" } });
    assert.equal(r.status, "done");
    assert.equal(r.summary, "AC-001 구현");
    assert.equal(r.commitMessage, "feat: 빵 목록 API");
    assert.deepEqual(r.filesWritten, ["src/worker.ts"]);
    assert.ok(ex.store.get("src/worker.ts").includes("빵"));
    assert.deepEqual(ex.commands, ["pnpm run build"]);
    assert.equal(r.lastBuildExitCode, 0);
    assert.equal(r.turns, 3);
    assert.equal(r.toolCalls, 4);
    assert.equal(r.tokensUsed, 450);
    // 두 번째 턴 요청에는 첫 턴의 tool_result가 들어 있다(다중 턴 배선)
    const second = client.seen[1].messages;
    assert.equal(second.at(-1).role, "user");
    assert.equal(second.at(-1).content[0].type, "tool_result");
    assert.equal(second.at(-1).content[0].content, "old");
    assert.equal(client.seen[0].tool_choice.type, "any");
  });

  it("★D-6: vercel deploy·git push·wrangler·.env 쓰기는 실행기에 도달하지 않고 REFUSED가 모델에 돌아간다", async () => {
    const client = scriptedClient([
      [tu("run_command", { cmd: "vercel", args: ["--prod"] }), tu("run_command", { cmd: "git", args: ["push"] }), tu("run_command", { cmd: "npx", args: ["wrangler", "deploy"] }), tu("create_file", { path: ".env", content: "X=1" })],
      [tu("finish", { status: "gave_up", summary: "배포 못 함" })],
    ]);
    const ex = fakeExecutor();
    const r = await runBuildLoop(TASK, { client, executor: ex, model: "m", gate });
    assert.deepEqual(ex.commands, []);
    assert.equal(ex.store.size, 0);
    assert.equal(r.denied.length, 4);
    assert.deepEqual(r.denied.map((d) => d.reason), ["deploy_cli", "denied_subcommand", "deploy_cli", "denied_path"]);
    const results = client.seen[1].messages.at(-1).content;
    assert.ok(results.every((t) => t.type === "tool_result" && t.is_error === true && /REFUSED/.test(t.content)));
    assert.equal(r.status, "gave_up");
  });

  it("비밀이 든 파일은 introduces_secret으로 거부", async () => {
    const client = scriptedClient([
      [tu("create_file", { path: "src/config.ts", content: 'export const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";' })],
      [tu("finish", { status: "done", summary: "x" })],
    ]);
    const ex = fakeExecutor();
    const r = await runBuildLoop(TASK, { client, executor: ex, model: "m", gate });
    assert.equal(ex.store.size, 0);
    assert.equal(r.denied[0].reason, "introduces_secret");
  });

  it("거부가 maxDenied에 닿으면 limit_denied로 정직하게 끝난다(실행기 호출 0)", async () => {
    const client = scriptedClient([[tu("run_command", { cmd: "vercel", args: [] }), tu("run_command", { cmd: "netlify", args: [] })]]);
    const ex = fakeExecutor();
    const r = await runBuildLoop(TASK, { client, executor: ex, model: "m", gate, limits: { maxDenied: 2 } });
    assert.equal(r.status, "limit_denied");
    assert.equal(ex.commands.length, 0);
  });

  it("finish 없이 도구만 계속 부르면 turn 상한에서 limit_turns", async () => {
    const client = scriptedClient([[tu("list_files", { dir: "" })]]);
    const r = await runBuildLoop(TASK, { client, executor: fakeExecutor(), model: "m", gate, limits: { maxTurnsPerTask: 3 } });
    assert.equal(r.status, "limit_turns");
    assert.equal(r.turns, 3);
  });

  it("말만 하는 턴에는 도구를 요구하고 계속 간다", async () => {
    const client = scriptedClient([[{ type: "text", text: "생각 중…" }], [tu("finish", { status: "done", summary: "끝" })]]);
    const r = await runBuildLoop(TASK, { client, executor: fakeExecutor(), model: "m", gate });
    assert.equal(r.status, "done");
    assert.match(client.seen[1].messages.at(-1).content, /Use a tool/);
  });

  it("실행기 예외는 tool error로 회신하고 루프는 계속(모델이 복구 시도)", async () => {
    const client = scriptedClient([[tu("run_command", { cmd: "pnpm", args: ["test"] })], [tu("finish", { status: "gave_up", summary: "테스트 러너 없음" })]]);
    const ex = fakeExecutor();
    ex.runCommand = async () => { throw new Error("spawn ENOENT"); };
    const r = await runBuildLoop(TASK, { client, executor: ex, model: "m", gate });
    assert.equal(r.status, "gave_up");
    assert.match(client.seen[1].messages.at(-1).content[0].content, /ENOENT/);
  });

  it("LLM 예외 → llm_error (벤더 전멸 시 정직 실패 경로)", async () => {
    const client = { messages: { create: async () => { throw new Error("OpenAI 503: vendor unavailable"); } } };
    const r = await runBuildLoop(TASK, { client, executor: fakeExecutor(), model: "m", gate });
    assert.equal(r.status, "llm_error");
    assert.match(r.summary, /vendor unavailable/);
  });
});
