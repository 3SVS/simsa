/**
 * agent-driver-browser.test.mjs — 실제 Chromium으로 드라이버를 돈다(Playwright가 있을 때만; 없으면 skip = 미측정).
 * Playwright는 tools/simsa-completion-loop-spike(npm install --no-save) 또는 inspector-container에 있다.
 *
 * 고정: ① 숨은 사본이 먼저 있는 입력 칸에도 보이는 칸에 넣는다(v0 오판 원인) ② 재렌더로 값이 날아가면 다시 친다
 *       ③ 저장 탐침이 서버 쓰기 0 · localStorage 변화를 잰다 ④ 시계를 KST 새벽으로 옮긴다 ⑤ 모바일 가로 넘침을 잰다
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let chromium = null;
for (const base of [join(here, "..", "..", "..", "tools", "simsa-completion-loop-spike", "package.json"), join(here, "..", "inspector-container", "package.json")]) {
  try {
    chromium = createRequire(base)("playwright").chromium;
    break;
  } catch {
    /* 다음 후보 */
  }
}
const skip = chromium ? false : "playwright 없음 — 미측정";
const { createPlaywrightDriver } = await import("../inspector-container/agent-driver.mjs");

const PAGES = {
  "/": `<!doctype html><html><body>
    <div style="display:none"><label>이름<input id="hidden-name"></label></div>
    <label>이름<input id="name"></label>
    <label>메모<input id="memo"></label>
    <button id="save" onclick="localStorage.setItem('booking', document.getElementById('name').value); document.getElementById('out').textContent='저장됨 '+document.getElementById('name').value">저장</button>
    <p id="out"></p><p id="today"></p>
    <script>
      document.getElementById('today').textContent = 'KST시각 ' + new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' });
      // 재렌더 흉내: 메모 칸은 처음 입력 뒤 한 번 값을 지운다
      let wiped = false;
      document.getElementById('memo').addEventListener('input', (e) => { if (!wiped) { wiped = true; setTimeout(() => { e.target.value = ''; }, 0); } });
    </script></body></html>`,
  "/wide": `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div style="width:900px">넓은 표</div></body></html>`,
};

describe("agent 드라이버 — 실제 브라우저", { skip }, () => {
  let server;
  let base;
  let outDir;
  let driver;
  before(async () => {
    server = createServer((req, res) => {
      const html = PAGES[new URL(req.url, "http://x").pathname];
      res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
      res.end(html ?? "not found");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    outDir = mkdtempSync(join(tmpdir(), "drv-"));
    driver = await createPlaywrightDriver({ outDir, chromium });
    await driver.start(base);
  });
  after(async () => {
    await driver?.close();
    server?.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("숨은 사본이 앞에 있어도 보이는 칸에 넣고, 경위를 계측으로 남긴다", async () => {
    await driver.goto(base + "/");
    const r = await driver.act({ type: "fill", target: { label: "이름" }, value: "김서연" });
    assert.equal(r.ok, true, r.note);
    assert.match(r.note, /matched=2 visible=1 chosen=input/);
  });
  it("재렌더로 값이 지워지면 다시 쳐서 남긴다", async () => {
    const r = await driver.act({ type: "fill", target: { label: "메모" }, value: "확인용" });
    assert.equal(r.ok, true, r.note);
  });
  it("저장 탐침: 서버 쓰기 0 · localStorage 변화", async () => {
    await driver.goto(base + "/");
    await driver.markStorage();
    await driver.act({ type: "fill", target: { label: "이름" }, value: "박지우" });
    await driver.act({ type: "click", target: { role: "button", name: "저장" } });
    const p = await driver.storageProbe();
    assert.deepEqual(p.serverWrites, []);
    assert.equal(p.localChanged, true);
  });
  it("시계를 KST 새벽 0시대로 옮긴다", async () => {
    await driver.goto(base + "/");
    await driver.setClock("2026-10-06T00:30:00+09:00");
    assert.match(await driver.bodyText(), /KST시각 00/);
  });
  it("B5: 원본 HTML을 받고, 고친 파일을 그 주소에 끼워 넣었다가 되돌린다", async () => {
    const src = await driver.fetchSource(base + "/");
    assert.match(src, /hidden-name/);
    await driver.serveOverride(base + "/", "<!doctype html><body>고친 파일</body>");
    await driver.goto(base + "/");
    assert.match(await driver.bodyText(), /고친 파일/);
    await driver.serveOverride(base + "/", null);
    await driver.goto(base + "/");
    assert.doesNotMatch(await driver.bodyText(), /고친 파일/);
  });
  it("모바일 폭에서 가로 넘침을 잰다", async () => {
    const wide = await driver.mobileCheck(base + "/wide");
    assert.ok(wide.overflowPx > 100, JSON.stringify(wide));
    const ok = await driver.mobileCheck(base + "/");
    assert.equal(ok.overflowPx, 0);
  });
});
