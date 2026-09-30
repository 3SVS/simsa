/**
 * 비용 권고 ③ (2026-09-30, D-7 amend [PILOT]) — 생성·지시서 서비스 전체 일일 상한의 대시보드 쪽.
 *
 * 서버 계약: 가득 차면 LLM 0회 +
 *   503 { ok:false, error:"generation_capacity", reason:"daily_capacity", resetAt }  (의도 추론은
 *   200 { ok:true, inferred:null, reason:"generation_capacity", resetAt })
 *
 * 전에는 이 503이 화면마다 "AI 연결이 원활하지 않아요 — 잠시 후 다시"(llmUnavailable)로 보였다 — 잠시 뒤에
 * 다시 눌러도 오늘은 안 되는데 그렇게 말했다(아이디어 초안은 가짜 초안으로 떨어질 뻔한 경로까지 있었다).
 * 이제 한 헬퍼(lib/generation-capacity.mjs)가 본문을 읽고, 한 문장(KO/EN, 리셋 시각은 읽는 사람의 시계)을
 * 모든 생성 화면이 같이 쓴다. 숫자 점수·개발 용어 없음, 없는 기능 약속 없음.
 *
 * 각 검사는 고치기 전 코드·사전에서 실패한다(마지막 두 개의 행동 보존 가드 제외).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");
const docDraft = await import("../src/lib/document-draft.mjs");
const devSpecView = await import("../src/lib/dev-spec-view.mjs");

async function capacityLib() {
  const mod = await import("../src/lib/generation-capacity.mjs").catch(() => null);
  assert.ok(mod, "src/lib/generation-capacity.mjs must exist");
  return mod;
}

const RESET_AT = "2026-10-01T00:00:00.000Z"; // next UTC midnight = 09:00 KST
const NOW = new Date("2026-09-30T13:00:00.000Z"); // 22:00 KST — reset is "tomorrow 9 AM" in Seoul

test("readGenerationCapacity: 503 본문·의도 추론 reason 모두 읽고, 다른 실패는 null", async () => {
  const { readGenerationCapacity } = await capacityLib();
  assert.deepEqual(readGenerationCapacity({ ok: false, error: "generation_capacity", reason: "daily_capacity", resetAt: RESET_AT }), { resetAt: RESET_AT });
  assert.deepEqual(readGenerationCapacity({ ok: true, inferred: null, reason: "generation_capacity", resetAt: RESET_AT }), { resetAt: RESET_AT });
  assert.deepEqual(readGenerationCapacity({ ok: false, error: "generation_capacity" }), { resetAt: null }, "the fact survives a missing time");
  assert.equal(readGenerationCapacity({ ok: false, error: "llm_unavailable" }), null);
  assert.equal(readGenerationCapacity({ ok: false, error: "inspection_disabled", reason: "daily_capacity" }), null, "other paused services are not this");
  assert.equal(readGenerationCapacity(null), null);
  assert.equal(readGenerationCapacity("generation_capacity"), null);
});

test("capacityFromResponse: 503 + 그 본문일 때만, 본문을 소비하지 않는다(뒤에서 다시 읽을 수 있다)", async () => {
  const { capacityFromResponse } = await capacityLib();
  const body = JSON.stringify({ ok: false, error: "generation_capacity", reason: "daily_capacity", resetAt: RESET_AT });
  const r = new Response(body, { status: 503 });
  assert.deepEqual(await capacityFromResponse(r), { resetAt: RESET_AT });
  assert.equal((await r.json()).error, "generation_capacity", "the original body is still readable");
  assert.equal(await capacityFromResponse(new Response(JSON.stringify({ ok: false, error: "llm_unavailable" }), { status: 503 })), null);
  assert.equal(await capacityFromResponse(new Response(body, { status: 429 })), null);
  assert.equal(await capacityFromResponse(new Response("upstream down", { status: 503 })), null, "non-JSON 503 is not capacity");
});

test("generationCapacityText: 리셋 시각은 읽는 사람의 시계로(서울 = 내일 오전 9시) · 시각을 모르면 일반 문장", async () => {
  const { generationCapacityText } = await capacityLib();
  const ko = generationCapacityText(DICTIONARIES.ko, RESET_AT, { now: NOW, timeZone: "Asia/Seoul" });
  assert.match(ko, /내일 오전 9시 이후/);
  assert.match(ko, /요청이 많아/);
  const en = generationCapacityText(DICTIONARIES.en, RESET_AT, { now: NOW, timeZone: "America/New_York" });
  assert.match(en, /after 8 PM today/, "New York: the same instant is 8 PM TODAY — never a hard-coded 'tomorrow'");
  assert.ok(!/[가-힣]/.test(en));
  const noTime = generationCapacityText(DICTIONARIES.ko, null, { now: NOW });
  assert.equal(noTime, DICTIONARIES.ko.errors.generationCapacity);
  const junk = generationCapacityText(DICTIONARIES.en, "Sep 29", { now: NOW });
  assert.equal(junk, DICTIONARIES.en.errors.generationCapacity);
});

test("사전: errors.generationCapacity(At) — KO/EN, {when} 하나, 초보자 금칙어 0, 숫자 점수 없음", () => {
  for (const loc of ["ko", "en"]) {
    const e = DICTIONARIES[loc].errors;
    for (const key of ["generationCapacity", "generationCapacityAt"]) {
      assert.equal(typeof e[key], "string", `${loc}.errors.${key}`);
      assert.deepEqual(devTermHits(e[key]), [], `${loc}.${key}: ${e[key]}`);
    }
    assert.equal(e.generationCapacityAt.split("{when}").length - 1, 1);
    assert.ok(!e.generationCapacity.includes("{when}"));
    assert.notEqual(e.generationCapacity, e.llmUnavailable, "capacity is not 'the AI connection is having trouble'");
  }
  // 문서 초안 화면의 키 목록 계약(모든 코드에 사전 문장)도 같은 문장으로.
  for (const loc of ["ko", "en"]) {
    assert.equal(DICTIONARIES[loc].sources.draft.errors.generation_capacity, DICTIONARIES[loc].errors.generationCapacity);
  }
});

test("문서 초안·지시서의 오류 키 매핑이 새 코드를 안다", () => {
  assert.ok(docDraft.DRAFT_ERROR_CODES.includes("generation_capacity"));
  assert.equal(docDraft.mapDraftError("generation_capacity"), "generation_capacity");
  assert.equal(devSpecView.generateErrorKey({ error: "generation_capacity" }), "errCapacity");
});

test("[소스 불변식·약함] API 클라이언트: 503 본문을 capacityFromResponse로 먼저 읽는다 (가짜 초안·'연결 문제'로 뭉개지 않게)", () => {
  const wsApi = read("lib/workspace-api.ts");
  assert.equal((wsApi.match(/await capacityFromResponse\(resp\)/g) ?? []).length, 2, "idea-to-spec-draft + recommend-answer");
  assert.ok(wsApi.indexOf("capacityFromResponse(resp)") < wsApi.indexOf("buildLocalFallback(input) };\n  }\n\n  // ── Parse success"), "before the mock fallback");
  const checkApi = read("lib/workspace-check-api.ts");
  assert.equal((checkApi.match(/await capacityFromResponse\(resp\)/g) ?? []).length, 3, "check-draft + unstick + fix-suggestion");
  assert.match(read("lib/dev-spec-api.ts"), /await capacityFromResponse\(resp\)/);
  assert.match(read("lib/workspace-sources-api.ts"), /resetAt/);
});

test("[소스 불변식·약함] 화면: 생성 화면마다 generationCapacityText로 그린다", () => {
  const surfaces = {
    "app/projects/new/page.tsx": 4,
    "app/projects/[id]/github/page.tsx": 1,
    "app/projects/[id]/items/page.tsx": 1,
    "app/projects/[id]/checks/page.tsx": 1,
    "app/projects/[id]/fixes/page.tsx": 1,
    "app/projects/[id]/dev-spec/page.tsx": 1,
    "app/projects/[id]/sources/[sourceId]/draft/page.tsx": 1,
    "components/OpenQuestionCard.tsx": 1,
    "components/StuckHelper.tsx": 1,
    "components/IntentConfirmCard.tsx": 1,
  };
  for (const [file, n] of Object.entries(surfaces)) {
    const src = read(file);
    assert.ok((src.match(/generationCapacityText\(/g) ?? []).length >= n, `${file}: generationCapacityText ×${n}`);
  }
});

test("행동 보존: 지시서의 다른 실패 키는 그대로", () => {
  assert.equal(devSpecView.generateErrorKey({ error: "llm_unavailable" }), "errLlm");
  assert.equal(devSpecView.generateErrorKey({ error: "rate_limited", retryAfterSeconds: 60 }), "errRateLimited");
});

test("행동 보존: 문서 초안 503(본문 없음)은 여전히 저장소 미설정 키", () => {
  assert.equal(docDraft.mapDraftError(503), "evidence_storage_unconfigured");
});
