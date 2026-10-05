/**
 * inspector-server-local.test.mjs — C9: 검사 컨테이너의 **실제 진입점(server.mjs)** 을 로컬 프로세스로 띄워 agent 런을
 * 끝까지 돈다(실 Chromium). 직접 로그인 넘겨주기 경로 포함: /run → /live/state=awaiting_login → /live/frame(JPEG) →
 * /live/input(글자) → /live/done → 완료 콜백(loginMethod handover · 사람이 친 글자는 콜백 어디에도 없음).
 *
 * Docker 이미지 자체는 CI container-images 워크플로가 빌드한다(이 테스트는 이미지가 아니라 같은 코드의 로컬 실행).
 * inspector-container/node_modules에 playwright가 없으면 skip(= 미측정): `cd apps/central-plane/inspector-container && npm install --no-save`.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONTAINER = join(here, "..", "inspector-container");
const skip = existsSync(join(CONTAINER, "node_modules", "playwright")) ? false : "inspector-container/node_modules/playwright 없음 — 미측정";
const TYPED = "직접친비밀번호-777";

function listen(handler) {
  const s = createServer(handler);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}
const readBody = async (req) => {
  let b = "";
  for await (const c of req) b += c;
  return b;
};

describe("C9 검사 컨테이너 진입점 로컬 실행 — 직접 로그인 넘겨주기", { skip }, () => {
  let app;
  let worker;
  let proc;
  let work;
  const callbacks = [];
  const logs = [];
  let port;

  before(async () => {
    // 검사 대상 앱: 카카오 로그인만 있는 화면
    app = await listen((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><body><h1>동네 가게</h1><button>카카오로 로그인</button><input aria-label="아이디"></body>`);
    });
    // Worker 흉내: LLM 프록시(항상 '확인 못 함'으로 빨리 끝냄) + 콜백 수신 + 증거 업로드 200
    worker = await listen(async (req, res) => {
      const body = await readBody(req);
      if (req.url.startsWith("/internal/inspect-llm")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, text: JSON.stringify({ action: { type: "judge", verdict: "not_verified", reason: "테스트", evidenceQuote: "" } }) }));
        return;
      }
      if (req.url.startsWith("/internal/visual-check")) callbacks.push({ url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    work = mkdtempSync(join(tmpdir(), "insp-"));
    port = 18000 + Math.floor(Math.random() * 2000);
    proc = spawn(process.execPath, [join(CONTAINER, "server.mjs")], { env: { ...process.env, PORT: String(port), WORK_ROOT: work }, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => logs.push(String(d)));
    proc.stderr.on("data", (d) => logs.push(String(d)));
    for (let i = 0; i < 50; i += 1) {
      const ok = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  after(() => {
    proc?.kill();
    app?.close();
    worker?.close();
    rmSync(work, { recursive: true, force: true });
  });

  it("넘겨주기 대기 → 화면 → 입력 → 끝 → 완료 콜백(handover · 친 글자 없음)", async () => {
    const wb = `http://127.0.0.1:${worker.address().port}`;
    const target = `http://127.0.0.1:${app.address().port}/`;
    const runId = "vc_local_c9";
    const r = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId, projectId: "p", userKey: "uk", targetUrl: target, intent: "가게 예약", baseUrl: wb,
        callbackUrl: `${wb}/internal/visual-check-done`, runningUrl: `${wb}/internal/visual-check-running`, callbackToken: "t",
        locale: "ko", engine: "agent",
        agent: { acs: [{ id: "AC-1", title: "로그인 뒤 내 예약", given: "g", when: "w", then: "내 예약이 보인다", priority: "must", confirmed: true }], acSource: "interview", loginMode: "handover", llmUrl: `${wb}/internal/inspect-llm/v1/messages`, llmToken: "irt1.x.y" },
      }),
    });
    assert.equal(r.status, 202);
    let state = "";
    for (let i = 0; i < 100 && state !== "awaiting_login"; i += 1) {
      await new Promise((res) => setTimeout(res, 200));
      state = (await fetch(`http://127.0.0.1:${port}/live/state?runId=${runId}`).then((x) => x.json()).catch(() => ({}))).state ?? "";
    }
    assert.equal(state, "awaiting_login", logs.join("").slice(-1500));
    const frame = await fetch(`http://127.0.0.1:${port}/live/frame?runId=${runId}`);
    assert.equal(frame.headers.get("content-type"), "image/jpeg");
    assert.ok((await frame.arrayBuffer()).byteLength > 1000);
    const click = await fetch(`http://127.0.0.1:${port}/live/input`, { method: "POST", body: JSON.stringify({ runId, kind: "click", x: 100, y: 120 }) });
    assert.equal(click.status, 200);
    const typed = await fetch(`http://127.0.0.1:${port}/live/input`, { method: "POST", body: JSON.stringify({ runId, kind: "type", text: TYPED }) });
    assert.equal(typed.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/live/done`, { method: "POST", body: JSON.stringify({ runId }) })).status, 200);
    for (let i = 0; i < 300 && !callbacks.some((c) => c.url.endsWith("visual-check-done")); i += 1) await new Promise((res) => setTimeout(res, 200));
    const done = callbacks.find((c) => c.url.endsWith("visual-check-done"));
    assert.ok(done, "완료 콜백");
    const body = JSON.parse(done.body);
    assert.equal(body.ok, true, body.error);
    assert.equal(body.report.engine, "agent");
    assert.equal(body.report.agent.loginMethod, "handover");
    assert.ok(!done.body.includes(TYPED), "사람이 친 글자는 콜백 어디에도 없다");
  });
});
