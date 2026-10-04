/**
 * 2026-10-04 — 빌드 단계적 열기(BUILD_ENABLED="staff"). 서버는 장비 티어 키에만 새 빌드를 연다.
 *
 * 고정하는 계약:
 *  - 대시보드는 가능 여부를 **자기 userKey와 함께** 묻는다(staff 단계에서 서버가 티어로 답할 수 있게)
 *  - 장비가 아닌 사람이 시작을 눌러 받는 503 build_staff_only는 '아직 열리지 않음'(unavailable) 문구 — 지시서 받아가기 제공
 *
 * 옛 코드에서: 가능 여부 요청에 userKey가 없었고, build_staff_only는 표에 없어 일반 오류("다시 시도")로 읽혔다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const view = await import("../src/lib/build-job-view.mjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, "src", rel), "utf8");

describe("빌드 단계적 열기 — 대시보드", () => {
  it("build_staff_only → unavailable(지시서 받아가기를 함께 준다)", () => {
    assert.equal(view.START_ERROR_CODES.build_staff_only, "unavailable");
    assert.equal(view.startErrorNotice(503, { ok: false, error: "build_staff_only" }).errorKey, "unavailable");
    assert.equal(view.startNoticeOffersTakeSpec("unavailable"), true);
  });

  it("가능 여부는 userKey와 함께 묻는다", () => {
    assert.match(read("lib/use-build-open.ts"), /getBuildAvailability\(getUserKey\(\)\)/);
    assert.match(read("lib/build-job-api.ts"), /build-availability\$\{q\}/);
    assert.match(read("lib/build-job-api.ts"), /\?userKey=\$\{encodeURIComponent\(userKey\)\}/);
  });
});
