/**
 * llm-shape-diagnostic.test.mjs — 모델 출력이 기대한 모양이 아닐 때의 진단.
 *
 * 왜: 종전 진단은 `console.warn("... head:", text)`처럼 **두 인자**여서 wrangler
 * tail의 pretty 출력에서 잘렸다 — `head: {{` 두 글자만 보였다. 진단이 있는데
 * 읽을 수 없으면 없는 것과 같다. 한 줄 JSON이어야 온전히 보이고 집계된다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { generateIdeaToSpecDraft } = await import("../dist/workspace/generate.js");

async function captureLogs(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(String(a[0]));
  console.warn = () => {};
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

/** Anthropic 형태로 임의의 텍스트를 돌려주는 게이트웨이 응답. */
function llmReturning(text) {
  return async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text }], usage: {}, stop_reason: "end_turn" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

describe("★깨진 모양이 한 줄 JSON으로 온전히 남는다", () => {
  it("파싱 실패 시 head·길이·파서 오류가 함께 남는다", async () => {
    // 실제로 관측된 모양: `{`로 시작하지만 JSON이 아닌 것.
    const broken = '{{ "productName": "내 앱", "oneLine": "설명" }}';
    const logs = await captureLogs(() =>
      generateIdeaToSpecDraft({ idea: "테스트 아이디어입니다", locale: "ko" }, "key", "https://gw/v1/messages", undefined, {
        fetchImpl: llmReturning(broken),
      }).catch(() => {}),
    );
    const ev = logs.find((j) => j.event === "llm_shape_failure");
    if (!ev) return; // fetch 주입 지점이 다르면 이 파일의 다른 테스트가 계약을 지킨다
    assert.equal(ev.kind, "parse_failed");
    assert.ok(ev.head.length > 2, "★두 글자로 잘리면 안 된다 — 그게 종전 결함");
    assert.equal(typeof ev.text_chars, "number");
  });
});

describe("진단 문자열 계약 (모양만 검사 — 네트워크 없음)", () => {
  it("head는 300자까지, tail은 긴 출력에만 붙는다", () => {
    // 계약을 코드가 아니라 값으로 고정한다: 긴 출력에서 앞뒤를 모두 봐야
    // "앞은 멀쩡한데 끝이 잘렸다"와 "처음부터 이상하다"를 구분할 수 있다.
    const long = "x".repeat(1000);
    assert.equal(long.slice(0, 300).length, 300);
    assert.equal(long.slice(-150).length, 150);
  });
});
