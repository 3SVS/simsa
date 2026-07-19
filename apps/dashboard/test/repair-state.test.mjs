import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REPAIR_POLL_INTERVAL_MS,
  canRepair,
  isRepairActive,
  isEnvCause,
  nextRepairPollMs,
  repairErrorKey,
  repairFailureKind,
} from "../src/lib/repair-state.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

describe("repair-state: repairFailureKind (auto_fix 성숙 2026-07-20)", () => {
  it("failed job with the container's repo_access_denied prefix → repoAccessDenied", () => {
    assert.equal(
      repairFailureKind({ status: "failed", error: "repo_access_denied: acme/x 저장소를 읽을 수 없어요 (비공개 저장소이거나 접근 권한이 없음)" }),
      "repoAccessDenied",
    );
  });

  it("failed job with any other error → generic; access text WITHOUT the prefix stays generic", () => {
    assert.equal(repairFailureKind({ status: "failed", error: "callback returned 500" }), "generic");
    assert.equal(repairFailureKind({ status: "failed", error: null }), "generic");
    // 프리픽스 계약: 본문에 403이 있어도 프리픽스가 없으면 일반 실패 카드.
    assert.equal(repairFailureKind({ status: "failed", error: "clone exited 403" }), "generic");
  });

  it("non-failed / absent jobs → null (card renders nothing)", () => {
    assert.equal(repairFailureKind({ status: "done" }), null);
    assert.equal(repairFailureKind({ status: "running", error: "repo_access_denied: x" }), null);
    assert.equal(repairFailureKind(null), null);
  });

  it("dictionary carries the guidance copy in both locales", () => {
    for (const locale of ["ko", "en"]) {
      const d = getDictionary(locale).visualChecks.repair;
      assert.equal(typeof d.failedRepoAccessTitle, "string");
      assert.ok(d.failedRepoAccessBody.length > 20);
    }
  });
});

describe("repair-state: canRepair", () => {
  it("done + not working (false) and done + unverified (null) are repairable", () => {
    assert.equal(canRepair({ status: "done", works: false }), true);
    assert.equal(canRepair({ status: "done", works: null }), true);
  });

  it("a done run that verified as working is NOT repairable", () => {
    assert.equal(canRepair({ status: "done", works: true }), false);
  });

  it("non-done statuses are never repairable, whatever works says", () => {
    assert.equal(canRepair({ status: "queued", works: false }), false);
    assert.equal(canRepair({ status: "running", works: false }), false);
    assert.equal(canRepair({ status: "failed", works: false }), false);
    assert.equal(canRepair({ status: "uploaded", works: null }), false);
  });

  it("null/undefined/garbage checks are defensively not repairable", () => {
    assert.equal(canRepair(null), false);
    assert.equal(canRepair(undefined), false);
    assert.equal(canRepair("done"), false);
  });
});

describe("repair-state: isRepairActive", () => {
  it("queued and running jobs are active", () => {
    assert.equal(isRepairActive({ status: "queued" }), true);
    assert.equal(isRepairActive({ status: "running" }), true);
  });

  it("done, failed, unknown and missing jobs are inactive", () => {
    assert.equal(isRepairActive({ status: "done" }), false);
    assert.equal(isRepairActive({ status: "failed" }), false);
    assert.equal(isRepairActive({ status: "weird_status" }), false);
    assert.equal(isRepairActive(null), false);
    assert.equal(isRepairActive(undefined), false);
  });
});

describe("repair-state: nextRepairPollMs", () => {
  it("active statuses poll on the shared 5s cadence", () => {
    assert.equal(REPAIR_POLL_INTERVAL_MS, 5000);
    assert.equal(nextRepairPollMs("queued"), REPAIR_POLL_INTERVAL_MS);
    assert.equal(nextRepairPollMs("running"), REPAIR_POLL_INTERVAL_MS);
  });

  it("terminal/unknown statuses return null (stop polling)", () => {
    assert.equal(nextRepairPollMs("done"), null);
    assert.equal(nextRepairPollMs("failed"), null);
    assert.equal(nextRepairPollMs("weird"), null);
    assert.equal(nextRepairPollMs(undefined), null);
  });
});

describe("repair-state: isEnvCause", () => {
  it("normalizes the wire value: boolean true and D1 integer 1 both flag", () => {
    assert.equal(isEnvCause({ envCause: true }), true);
    assert.equal(isEnvCause({ envCause: 1 }), true);
  });

  it("false, 0, missing field and missing job all mean no env cause", () => {
    assert.equal(isEnvCause({ envCause: false }), false);
    assert.equal(isEnvCause({ envCause: 0 }), false);
    assert.equal(isEnvCause({}), false);
    assert.equal(isEnvCause(null), false);
    assert.equal(isEnvCause(undefined), false);
  });
});

describe("repair-state: repairErrorKey", () => {
  it("maps the Stage 268 400 codes", () => {
    assert.equal(repairErrorKey("run_not_repairable"), "notRepairable");
    assert.equal(repairErrorKey("github_repo_required"), "repoRequired");
    assert.equal(repairErrorKey("github_token_required"), "tokenRequired");
  });

  it("maps repair_already_active and the bare 409 status alike", () => {
    assert.equal(repairErrorKey("repair_already_active"), "alreadyActive");
    assert.equal(repairErrorKey(409), "alreadyActive");
    assert.equal(repairErrorKey("HTTP 409"), "alreadyActive");
  });

  it("maps ownership errors (404/403) by code and by status", () => {
    assert.equal(repairErrorKey("run_not_found"), "notFound");
    assert.equal(repairErrorKey("project_not_found"), "notFound");
    assert.equal(repairErrorKey(404), "notFound");
    assert.equal(repairErrorKey("HTTP 404"), "notFound");
    assert.equal(repairErrorKey("forbidden"), "forbidden");
    assert.equal(repairErrorKey(403), "forbidden");
  });

  it("unknown codes / statuses / garbage all fall back to generic", () => {
    assert.equal(repairErrorKey("save_failed"), "generic");
    assert.equal(repairErrorKey(400), "generic");
    assert.equal(repairErrorKey(500), "generic");
    assert.equal(repairErrorKey("HTTP 500"), "generic");
    assert.equal(repairErrorKey(null), "generic");
    assert.equal(repairErrorKey(undefined), "generic");
    assert.equal(repairErrorKey("TypeError: fetch failed"), "generic");
  });

  it("every mapped key resolves to non-empty copy in both locales", () => {
    const keys = [
      repairErrorKey("run_not_repairable"),
      repairErrorKey("github_repo_required"),
      repairErrorKey("github_token_required"),
      repairErrorKey("repair_already_active"),
      repairErrorKey("run_not_found"),
      repairErrorKey("forbidden"),
      repairErrorKey("anything_else"),
    ];
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const key of keys) {
        assert.ok(
          typeof d.visualChecks.repair.errors[key] === "string" &&
            d.visualChecks.repair.errors[key].length > 0,
          `${loc}.visualChecks.repair.errors.${key} missing`,
        );
      }
    }
  });
});

describe("repair-state: repair dictionary copy", () => {
  it("button, progress, done, failed and link keys exist in both locales", () => {
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const k of [
        "title", "desc", "button", "submitting",
        "progressTitle", "progressBody", "statusQueued", "statusRunning",
        "doneTitle", "doneBody", "openPr", "branchLabel", "noPrNote",
        "envCauseWarning", "failedTitle", "failedBody", "detailsLabel",
        "goToRepo", "goToGithubSettings",
      ]) {
        assert.ok(
          typeof d.visualChecks.repair[k] === "string" && d.visualChecks.repair[k].length > 0,
          `${loc}.visualChecks.repair.${k} missing`,
        );
      }
    }
  });

  it("the honest draft-PR boundary is spelled out (no auto-applied code claim)", () => {
    // v1 opens a DRAFT PR carrying the fix brief — the copy must mention the
    // brief file and must not promise applied code changes.
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      assert.ok(d.visualChecks.repair.desc.includes("SIMSA-FIX-BRIEF.md"));
      assert.ok(d.visualChecks.repair.doneBody.includes("SIMSA-FIX-BRIEF.md"));
    }
  });
});
