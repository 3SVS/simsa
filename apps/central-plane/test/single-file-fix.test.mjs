import { describe, it } from "node:test";
import assert from "node:assert/strict";

// B5 단일 파일 앱의 고친 파일 — 정확히 한 번 나오는 편집만 · 검증 통과분만 "고쳐짐" · 서버가 필요한 결함은 못 고침으로.
const sf = await import("../inspector-container/single-file-fix.mjs");
const { runAgentInspection } = await import("../inspector-container/agent-run.mjs");
const { makeFakeDriver, makeScriptedLlm } = await import("./_agent-fakes.mjs");

const ORIGIN = "https://one.netlify.app";
const SRC = `<!doctype html><html><body><input id="name"><button onclick="save()">저장</button><p id="out"></p>
<script>
function save() {
  var v = document.getElementById('name').value;
  // BUG: 결과를 표시하지 않는다
  document.getElementById('out').textContent = '';
}
// 넉넉한 인라인 스크립트(단일 파일 앱 판정용) ............................................................................
// ..........................................................................................................................
</script></body></html>`;

describe("single-file-fix 순수 함수", () => {
  it("단일 파일 앱 판정: 인라인 스크립트 O · 같은 출처 번들 X", () => {
    assert.equal(sf.isSingleFileApp(SRC, ORIGIN + "/"), true);
    assert.equal(sf.isSingleFileApp(`<script type="module" src="/assets/index-abc.js"></script>`, ORIGIN + "/"), false);
    assert.equal(sf.isSingleFileApp("<html>no script</html>", ORIGIN + "/"), false);
  });
  it("편집은 정확히 한 번 나와야 적용 — 없거나 둘이면 거절", () => {
    assert.equal(sf.applyExactEdits(SRC, [{ search: "textContent = ''", replace: "textContent = '저장됨 ' + v" }]).ok, true);
    assert.equal(sf.applyExactEdits(SRC, [{ search: "없는 문자열입니다", replace: "x" }]).error, "edit_0_not_found");
    assert.equal(sf.applyExactEdits(SRC, [{ search: "document.getElementById(", replace: "x" }]).error, "edit_0_ambiguous");
    assert.equal(sf.applyExactEdits(SRC, []).error, "no_edits");
  });
});

describe("B5 실행기: 고친 파일로 실패 기준을 다시 돌려 검증", () => {
  it("검증을 통과한 기준만 validated, 고친 파일·차이를 리포트에", async () => {
    const site = {
      "/": (s) => ({
        status: 200,
        text: s.override?.includes("'저장됨 ' + v") && s.saved ? `저장됨 ${s.saved}` : "이름 저장",
        links: ["/"],
        buttons: [],
      }),
    };
    const driver = makeFakeDriver(site, {
      origin: ORIGIN,
      onAct: (a, s) => {
        if (a.type === "fill") s.saved = a.value;
        return null;
      },
    });
    driver.fetchSource = async () => SRC;
    driver.serveOverride = async (_u, html) => {
      driver.state.override = html;
      driver.state.saved = undefined;
    };
    const ac = { id: "AC-1", title: "이름 저장", given: "g", when: "w", then: "저장하면 '저장됨 이름'이 보인다", priority: "must", confirmed: true };
    let round = 0;
    const { llm } = makeScriptedLlm(
      {
        "CORE-1": [{ type: "judge", verdict: "not_verified", reason: "생략", evidenceQuote: "" }],
        "AC-1": [
          { type: "fill", target: { label: "이름" }, value: "$NAME" },
          { type: "click", target: { role: "button", name: "저장" } },
          { type: "judge", verdict: "fail", reason: "저장해도 아무것도 안 보여요", evidenceQuote: "이름 저장" },
          // 고친 파일로 다시
          { type: "fill", target: { label: "이름" }, value: "$NAME" },
          { type: "click", target: { role: "button", name: "저장" } },
          { type: "judge", verdict: "pass", reason: "저장됨이 보여요", evidenceQuote: "저장됨 $NAME" },
        ],
      },
      { fix: { edits: [{ search: "textContent = ''", replace: "textContent = '저장됨 ' + v" }], cannotFix: [] } },
    );
    void round;
    const out = await runAgentInspection({ targetUrl: ORIGIN + "/", intent: "i", budgetMs: 600_000, acs: [ac], acSource: "interview", llm, driver });
    const fix = out.report.agent.singleFileFix;
    assert.deepEqual(fix.validated, ["AC-1"]);
    assert.match(fix.diff, /\+ textContent = '저장됨 ' \+ v/);
    assert.ok(fix.correctedHtml.includes("'저장됨 ' + v"));
    assert.equal(driver.state.override, null, "검증 뒤 원래 파일로 되돌린다");
    assert.equal(out.decision, "Needs Fix", "원래 앱의 판정은 그대로(고친 파일은 제안일 뿐)");
    assert.ok(out.report.notes.some((n) => n.includes("고친 index.html")));
  });
});
