/**
 * 오픈 베타 S2-min · S5-min (2026-10-05) — 화면 문장이 서버 문장과 같고, 동의는 기본 꺼짐이며, 일반 사용자에게 보인다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(here, "..", ...p), "utf8");

describe("시험 데이터 동의", () => {
  it("문장이 서버(WRITE_CONSENT_COPY)와 글자 그대로 같다", () => {
    const ui = read("src", "components", "WriteConsentCheckbox.tsx");
    const server = read("..", "central-plane", "src", "routes", "workspace-visual-check-runs.ts");
    for (const s of ["이 앱은 제 것이고, 확인을 위해 시험 데이터(이름 '심사테스트')를 만들어도 괜찮아요", "This app is mine, and it's OK to create test data (name '심사테스트') to check it"]) {
      assert.ok(ui.includes(s), `UI: ${s}`);
      assert.ok(server.includes(s), `server: ${s}`);
    }
  });
  it("기본 꺼짐, 스태프가 아닐 때 보이고, 켰을 때만 writeConsent를 보낸다", () => {
    const page = read("src", "app", "projects", "[id]", "visual-checks", "page.tsx");
    assert.match(page, /useState\(false\);\n  const \[engineNotice/);
    assert.match(page, /\{!isStaff && <WriteConsentCheckbox/);
    assert.match(page, /!isStaff && writeConsent \? \{ writeConsent: true as const \}/);
    assert.match(page, /setEngineNotice\(res\.engineFallbackNote/);
  });
});

describe("실패 패턴 익명 수집 안내", () => {
  it("운영 정보 기록 선택 아래에 KO/EN 문장", () => {
    const dict = read("src", "i18n", "dictionary.mjs");
    assert.match(dict, /실패 패턴을 익명으로 모아 다른 사용자에게 도움이 되도록 써도 괜찮아요/);
    assert.match(dict, /collect non-identifying failure patterns/);
    assert.match(read("src", "components", "PrivacySettingsSection.tsx"), /p\.opsFailurePatterns/);
  });
});

describe("첫 자동 검사에도 동의 · 읽기 전용 결과에서 한 번 누르기", () => {
  it("주소 입력(새 프로젝트 · 주소 상자) 둘 다 체크박스(기본 꺼짐)를 두고 첫 런에 넘긴다", () => {
    const np = read("src", "app", "projects", "new", "page.tsx");
    assert.match(np, /const \[writeConsent, setWriteConsent\] = useState\(false\);/);
    assert.ok(np.includes("runVisualCheck(id, { userKey, locale, ...(writeConsent ? { writeConsent: true as const } : {}) })"));
    assert.ok(np.includes("<WriteConsentCheckbox checked={writeConsent}"));
    const box = read("src", "components", "AppAddressStart.tsx");
    assert.match(box, /const \[writeConsent, setWriteConsent\] = useState\(false\);/);
    assert.ok(box.includes("runVisualCheck(projectId, { userKey, locale, sourceId, ...(writeConsent ? { writeConsent: true as const } : {}) })"));
  });
  it("읽기 전용 결과를 알아보고, 같은 기준으로 동의해서 다시", async () => {
    const { reportNeedsWriteConsent, RECHECK_WITH_CONSENT } = await import("../src/lib/write-consent.mjs");
    assert.equal(reportNeedsWriteConsent({ engine: "agent", acTable: [{ status: "not_verified", reasonCode: "write_not_allowed" }] }), true);
    assert.equal(reportNeedsWriteConsent({ engine: "agent", acTable: [{ status: "fail" }] }), false);
    assert.equal(reportNeedsWriteConsent({ engine: "classic" }), false);
    assert.equal(RECHECK_WITH_CONSENT.ko.button, "시험 데이터 허용하고 다시 확인");
    const detail = read("src", "app", "projects", "[id]", "visual-checks", "[runId]", "page.tsx");
    assert.ok(detail.includes("recheck.run({ writeConsent: true })"));
    assert.ok(detail.includes("...buildRecheckBody(check, userKey, locale"));
  });
});
