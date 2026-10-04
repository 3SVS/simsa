/**
 * D-24 — 새 프로젝트 하루 상한 화면 문장 (docs/simsa-plan-tiers-design-2026-10-03.md).
 *
 * 고정하는 계약 (D-24.3 [LOCKED] 막힘은 막다른 길이 아니다):
 *  - 막히기 전에 "N개 중 M개 남았어요"를 보여준다(0개면 패널이 대신 말함)
 *  - 막힌 문장은 사전 단어로, 다시 만들 시각은 읽는 사람의 시계로(UTC 자정 = 서울 오전 9시)
 *  - 같은 네트워크의 다른 사람 때문에 막힌 경우 "이미 만들었어요" 본문 대신 네트워크 안내 + 로그인
 *  - 화면은 서버 거절 시 로컬 프로젝트를 되돌리고, 막힌 채 갈래 화면에 들어오면 선택 화면으로 보낸다
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { blockedFromQuota, projectLimitText, quotaRemainingText } from "../src/lib/project-quota.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ko = getDictionary("ko");
const en = getDictionary("en");
const NOW = new Date("2026-10-03T12:00:00Z");

describe("남은 개수 문장", () => {
  it("KO/EN — 1개 중 1개", () => {
    assert.equal(quotaRemainingText({ limit: 1, remaining: 1 }, ko.quota), "오늘 새 프로젝트 1개 중 1개 남았어요");
    assert.equal(quotaRemainingText({ limit: 1, remaining: 1 }, en.quota), "New projects today: 1 of 1 left");
  });

  it("0개·조회 실패·장비 수준 상한이면 줄을 그리지 않는다", () => {
    assert.equal(quotaRemainingText({ limit: 1, remaining: 0 }, ko.quota), null);
    assert.equal(quotaRemainingText(null, ko.quota), null);
    assert.equal(quotaRemainingText({ limit: 200, remaining: 199 }, ko.quota), null);
  });
});

describe("막힘 패널 문장", () => {
  const info = { tier: "free", limit: 1, resetAt: "2026-10-04T00:00:00.000Z", limitedBy: "user" };

  it("KO — 플랜 이름·개수·서울 시각(내일 오전 9시)", () => {
    const x = projectLimitText(info, ko.quota, ko.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.equal(x.title, "오늘 새 프로젝트를 이미 만들었어요");
    assert.match(x.body, /^무료 플랜은 새 프로젝트를 하루 1개까지/);
    assert.match(x.reset, /^내일 오전 9시 이후 다시 만들 수 있어요\.$/);
    assert.equal(x.showSignIn, false);
  });

  it("EN — 뉴욕에서는 같은 날 저녁(“tomorrow”라고 거짓말하지 않음)", () => {
    const x = projectLimitText(info, en.quota, en.visualChecks.resetWhen, { now: NOW, timeZone: "America/New_York" });
    assert.match(x.body, /^On the Free plan you can start 1 new project/);
    assert.equal(x.reset, "You can start a new one after 8 PM today.");
  });

  it("네트워크 때문에 막힘 → 네트워크 안내 + 로그인 버튼", () => {
    const x = projectLimitText({ ...info, limitedBy: "network" }, ko.quota, ko.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.match(x.body, /같은 네트워크/);
    assert.equal(x.showSignIn, true);
  });

  it("네트워크 때문에 막힌 사람에게 제목도 '이미 만들었어요'라고 하지 않는다(2026-10-03 라이브 발견) — KO/EN", () => {
    const k = projectLimitText({ ...info, limitedBy: "network" }, ko.quota, ko.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.equal(k.title, "오늘 이 네트워크의 새 프로젝트 몫을 다 썼어요");
    assert.doesNotMatch(k.title, /이미 만들었어요/);
    const e = projectLimitText({ ...info, limitedBy: "network" }, en.quota, en.visualChecks.resetWhen, { now: NOW, timeZone: "Asia/Seoul" });
    assert.equal(e.title, "Today's new-project allowance on this network is used up");
    // 본인 몫으로 막힌 경우는 그대로
    assert.equal(projectLimitText(info, ko.quota, ko.visualChecks.resetWhen, { now: NOW }).title, "오늘 새 프로젝트를 이미 만들었어요");
  });

  it("resetAt이 없거나 이상하면 일반 문장, 모르는 티어는 무료 이름", () => {
    const x = projectLimitText({ ...info, tier: "mystery", resetAt: "" }, ko.quota, ko.visualChecks.resetWhen, { now: NOW });
    assert.equal(x.reset, "내일 다시 만들 수 있어요.");
    assert.match(x.body, /^무료 플랜/);
  });

  it("조회 결과 → 패널 정보(남은 게 있으면 null)", () => {
    assert.equal(blockedFromQuota({ tier: "free", limit: 1, remaining: 1, resetAt: "x", limitedBy: null }), null);
    assert.deepEqual(blockedFromQuota({ tier: "basic", limit: 1, remaining: 0, resetAt: "r", limitedBy: "user" }), {
      tier: "basic", limit: 1, resetAt: "r", limitedBy: "user",
    });
    assert.equal(blockedFromQuota(null), null);
  });
});

describe("사전 — KO/EN 같은 키, EN에 한글 없음", () => {
  it("quota 키 대칭", () => {
    assert.deepEqual(Object.keys(en.quota).sort(), Object.keys(ko.quota).sort());
    assert.deepEqual(Object.keys(en.quota.tierNames).sort(), ["basic", "free", "pro", "staff"]);
  });
  it("EN quota 문장에 한글이 없다", () => {
    assert.doesNotMatch(JSON.stringify(en.quota), /[가-힣]/);
  });
});

describe("화면 배선 (소스 계약)", () => {
  const page = readFileSync(path.join(ROOT, "src/app/projects/new/page.tsx"), "utf8");
  const api = readFileSync(path.join(ROOT, "src/lib/workspace-check-api.ts"), "utf8");

  it("서버가 project_limit으로 거절하면 로컬 프로젝트를 지우고 패널로 — 두 생성 경로 모두", () => {
    assert.equal((page.match(/saveRes\.error === "project_limit"/g) ?? []).length, 2);
    assert.match(page, /function rollBackRefusedProject[\s\S]*?deleteProject\(id\)/);
  });

  it("막힌 채 갈래 화면에 들어오면 선택 화면으로 돌려보낸다(답을 다 하고 막히지 않게)", () => {
    assert.match(page, /if \(blockedNow && entryPath !== null\) router\.push\("\/projects\/new"\)/);
  });

  it("429 project_daily만 project_limit으로 — 다른 429는 종전 rate_limited", () => {
    assert.match(api, /body\["scope"\] !== "project_daily"\) return null/);
  });
});
