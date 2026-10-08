/**
 * "만든 AI에게 물어보기"(2026-10-09): 화면의 질문 원문 = 서버의 원문(한 글자도 다르면 안 된다) · 쉬운 말 · EN에 한글 없음 ·
 * 핵심 흐름 후보는 체크 해제로 시작(카드가 checkedFlows=[]로 시작) · 런 요청에 정리본이 실린다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lib = await import("../src/lib/builder-self-report.mjs");
const server = readFileSync(new URL("../../central-plane/src/workspace/builder-self-report.ts", import.meta.url), "utf8");
const card = readFileSync(new URL("../src/components/IntentConfirmCard.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/lib/workspace-visual-checks-api.ts", import.meta.url), "utf8");

describe("만든 AI에게 물어보기", () => {
  it("질문 원문이 서버와 같다(KO/EN 줄마다)", () => {
    for (const loc of ["ko", "en"]) for (const line of lib.BUILDER_SELF_REPORT_PROMPT[loc].split("\n")) assert.ok(server.includes(JSON.stringify(line)), `${loc}: ${line}`);
  });
  it("EN 화면 문구에 한글·개발 용어 없음", () => {
    const en = lib.BSR_COPY.en;
    const all = Object.values(en).map((v) => (typeof v === "function" ? v(2) : v)).join(" ");
    assert.ok(!/[가-힣]/.test(all), "EN에 한글");
    assert.ok(!/\b(API|JSON|LLM|regex|endpoint|token)\b/.test(all), "개발 용어");
    assert.ok(!/(API|JSON|LLM|엔드포인트|토큰)/.test(Object.values(lib.BSR_COPY.ko).map((v) => (typeof v === "function" ? v(2) : v)).join(" ")));
  });
  it("카드: 핵심 흐름 후보는 체크 해제로 시작, 체크한 것만 확인 기준(빠진 것과 같은 경로)", () => {
    assert.match(card, /useState<string\[\]>\(\[\]\)/);
    assert.match(card, /missingItemsFromText\(builderFlows\.join/);
    assert.match(card, /kept\.push\(\.\.\.fromBuilder\)/);
  });
  it("런 요청에 정리본(builderReport)이 실린다", () => {
    assert.match(api, /withBuilderReport\(projectId, input\)/);
    assert.match(api, /builderReport: report/);
  });
});
