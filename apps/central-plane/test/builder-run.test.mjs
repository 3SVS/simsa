/**
 * SI 티어 Train B — B1: builder-run.mjs 순수 로직 + summarizeSelfCheck(Worker 쪽 정규화).
 * exec·fs를 주입해 프로세스·네트워크 없이 돈다(seam).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  BUILD_STAGES, REQUIRED_FIELDS, RUNNER_REV, TOOLCHAIN, FORBIDDEN_DEPLOY_CLIS,
  validateJobPayload, parseVersion, checkWorkRoot, selfCheck, runBuildJob,
} = await import("../builder-container/builder-run.mjs");
const { summarizeSelfCheck } = await import("../dist/routes/builder-probe.js");

const okExec = (versions = {}) => async (cmd) => {
  if (FORBIDDEN_DEPLOY_CLIS.includes(cmd)) return { ok: false, code: 127, stdout: "", stderr: "not found", error: "ENOENT" };
  return { ok: true, code: 0, stdout: versions[cmd] ?? `${cmd} 1.2.3\n`, stderr: "", error: null };
};
const fakeFs = (fail = false) => ({
  mkdtemp: async (p) => { if (fail) throw new Error("EROFS"); return `${p}x`; },
  writeFile: async () => {},
  rm: async () => {},
});

describe("payload · constants", () => {
  it("D-4 상태 머신 순서", () => {
    assert.deepEqual([...BUILD_STAGES], ["queued", "scaffolding", "implementing", "building", "testing", "pushed", "done", "failed"]);
  });
  it("validateJobPayload: 필수 7필드 전부 비어 있지 않은 문자열", () => {
    const full = Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, "x"]));
    assert.deepEqual(validateJobPayload(full), { ok: true });
    const r = validateJobPayload({ ...full, callbackToken: "", kind: 3 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["kind", "callbackToken"]);
    assert.equal(validateJobPayload(null).ok, false);
  });
  it("parseVersion: v접두·산문·이모지 출력에서 숫자만", () => {
    assert.equal(parseVersion("v22.1.0\n"), "22.1.0");
    assert.equal(parseVersion("git version 2.43.0"), "2.43.0");
    assert.equal(parseVersion("⛅️ wrangler 4.12.0"), "4.12.0");
    assert.equal(parseVersion("gh version 2.55.0 (2024-08-20)\nhttps://..."), "2.55.0");
  });
});

describe("selfCheck", () => {
  it("툴체인 5종 + 금지 CLI 부재 + 작업 디렉터리 쓰기 가능 → ok", async () => {
    const r = await selfCheck({ exec: okExec({ pnpm: "10.4.1\n", node: "v22.1.0\n" }), workRoot: "/tmp/w", fsImpl: fakeFs() });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.runnerRev, RUNNER_REV);
    assert.deepEqual(r.tools.map((t) => t.name), TOOLCHAIN.map((t) => t.name));
    assert.equal(r.tools.find((t) => t.name === "pnpm").version, "10.4.1");
    assert.deepEqual(r.forbiddenPresent, []);
    assert.equal(r.workRoot.ok, true);
    assert.ok(typeof r.totalMs === "number");
  });
  it("도구 하나가 없으면 ok=false, 어느 것인지 이름·오류가 남는다", async () => {
    const exec = async (cmd, args, o) => (cmd === "gh" ? { ok: false, code: 127, stdout: "", stderr: "", error: "spawn gh ENOENT" } : okExec()(cmd, args, o));
    const r = await selfCheck({ exec, workRoot: "/tmp/w", fsImpl: fakeFs() });
    assert.equal(r.ok, false);
    const gh = r.tools.find((t) => t.name === "gh");
    assert.equal(gh.ok, false);
    assert.match(gh.error, /ENOENT/);
    assert.equal(gh.version, null);
  });
  it("D-6: vercel/netlify가 이미지에 있으면 ok=false + forbiddenPresent에 이름", async () => {
    const exec = async (cmd, args, o) => (cmd === "vercel" ? { ok: true, code: 0, stdout: "Vercel CLI 39.0.0", stderr: "", error: null } : okExec()(cmd, args, o));
    const r = await selfCheck({ exec, workRoot: "/tmp/w", fsImpl: fakeFs() });
    assert.equal(r.ok, false);
    assert.deepEqual(r.forbiddenPresent, ["vercel"]);
  });
  it("작업 디렉터리가 읽기 전용이면 ok=false + workRoot.error", async () => {
    const r = await selfCheck({ exec: okExec(), workRoot: "/ro", fsImpl: fakeFs(true) });
    assert.equal(r.ok, false);
    assert.equal(r.workRoot.ok, false);
    assert.match(r.workRoot.error, /EROFS/);
  });
  it("checkWorkRoot 단독", async () => {
    assert.equal((await checkWorkRoot("/x", fakeFs())).ok, true);
    assert.equal((await checkWorkRoot("/x", fakeFs(true))).ok, false);
  });
});

describe("runBuildJob", () => {
  const base = { jobId: "bj_1", projectId: "p", userKey: "u", baseUrl: "http://w", callbackUrl: "http://w/cb", callbackToken: "t" };
  it("kind=selfcheck → 콜백 본문(jobId·ok·stage=done·result)", async () => {
    const r = await runBuildJob({ ...base, kind: "selfcheck" }, { exec: okExec(), workRoot: "/w", fsImpl: fakeFs() });
    assert.equal(r.jobId, "bj_1");
    assert.equal(r.ok, true);
    assert.equal(r.stage, "done");
    assert.equal(r.result.runnerRev, RUNNER_REV);
  });
  it("selfcheck 실패는 stage=failed", async () => {
    const r = await runBuildJob({ ...base, kind: "selfcheck" }, { exec: okExec(), workRoot: "/w", fsImpl: fakeFs(true) });
    assert.equal(r.ok, false);
    assert.equal(r.stage, "failed");
  });
  it("미구현 kind는 정직하게 builder_stage_not_implemented (예시 성공 없음)", async () => {
    await assert.rejects(runBuildJob({ ...base, kind: "scaffold" }, {}), /builder_stage_not_implemented:scaffold/);
  });
});

describe("summarizeSelfCheck (Worker 쪽 정규화)", () => {
  it("컨테이너 JSON에서 필요한 필드만, 타입을 검사해서 뽑는다", () => {
    const s = summarizeSelfCheck({
      ok: true, runnerRev: "b1-builder-1", totalMs: 1234,
      tools: [{ name: "pnpm", ok: true, version: "10.4.1", ms: 80 }, { name: 42, ok: "yes" }, "garbage"],
      forbiddenPresent: ["vercel", 7], workRoot: { ok: true, ms: 3 },
    }, 2000);
    assert.equal(s.ok, true);
    assert.equal(s.runnerRev, "b1-builder-1");
    assert.equal(s.containerMs, 1234);
    assert.equal(s.elapsedMs, 2000);
    assert.deepEqual(s.tools, [{ name: "pnpm", ok: true, version: "10.4.1", ms: 80 }, { name: "42", ok: false, version: null, ms: -1 }]);
    assert.deepEqual(s.forbiddenPresent, ["vercel"]);
    assert.equal(s.workRootOk, true);
  });
  it("본문이 null/문자열이어도 안전하게 ok=false", () => {
    assert.equal(summarizeSelfCheck(null, 1).ok, false);
    assert.equal(summarizeSelfCheck("<html>", 1).workRootOk, null);
  });
});
