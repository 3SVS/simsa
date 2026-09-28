import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RUN_POLL_INTERVAL_MS,
  isActiveStatus,
  nextPollDelayMs,
  runButtonState,
  mapRunError,
} from "../src/lib/visual-check-run-state.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

describe("visual-check-run-state: isActiveStatus", () => {
  it("queued and running are active", () => {
    assert.equal(isActiveStatus("queued"), true);
    assert.equal(isActiveStatus("running"), true);
  });

  it("done and failed are terminal", () => {
    assert.equal(isActiveStatus("done"), false);
    assert.equal(isActiveStatus("failed"), false);
  });

  it("unknown/legacy/absent statuses are treated terminal (never poll forever)", () => {
    assert.equal(isActiveStatus("uploaded"), false);
    assert.equal(isActiveStatus(""), false);
    assert.equal(isActiveStatus(null), false);
    assert.equal(isActiveStatus(undefined), false);
    assert.equal(isActiveStatus(42), false);
  });
});

describe("visual-check-run-state: nextPollDelayMs", () => {
  it("active statuses poll on the shared 5s cadence", () => {
    assert.equal(RUN_POLL_INTERVAL_MS, 5000);
    assert.equal(nextPollDelayMs("queued"), RUN_POLL_INTERVAL_MS);
    assert.equal(nextPollDelayMs("running"), RUN_POLL_INTERVAL_MS);
  });

  it("terminal statuses return null (stop polling)", () => {
    assert.equal(nextPollDelayMs("done"), null);
    assert.equal(nextPollDelayMs("failed"), null);
  });

  it("unknown statuses return null (treated terminal)", () => {
    assert.equal(nextPollDelayMs("weird_status"), null);
    assert.equal(nextPollDelayMs(undefined), null);
  });
});

describe("visual-check-run-state: runButtonState", () => {
  it("enabled when a website source exists and nothing is running", () => {
    assert.deepEqual(runButtonState({ hasWebsiteSource: true, hasActiveRun: false }), {
      disabled: false,
      reasonKey: null,
    });
  });

  it("disabled while a run is active", () => {
    assert.deepEqual(runButtonState({ hasWebsiteSource: true, hasActiveRun: true }), {
      disabled: true,
      reasonKey: "runAlreadyActive",
    });
  });

  it("disabled without a website source", () => {
    assert.deepEqual(runButtonState({ hasWebsiteSource: false, hasActiveRun: false }), {
      disabled: true,
      reasonKey: "websiteSourceRequired",
    });
  });

  it("an active run wins over a missing website source; empty input is defensive-disabled", () => {
    assert.equal(
      runButtonState({ hasWebsiteSource: false, hasActiveRun: true }).reasonKey,
      "runAlreadyActive",
    );
    assert.deepEqual(runButtonState(), { disabled: true, reasonKey: "websiteSourceRequired" });
    assert.deepEqual(runButtonState({}), { disabled: true, reasonKey: "websiteSourceRequired" });
  });
});

describe("visual-check-run-state: mapRunError", () => {
  it("maps the backend 400 website_source_required code", () => {
    assert.equal(mapRunError("website_source_required"), "websiteSourceRequired");
  });

  it("maps run_already_active and the bare 409 status alike", () => {
    assert.equal(mapRunError("run_already_active"), "runAlreadyActive");
    assert.equal(mapRunError(409), "runAlreadyActive");
    assert.equal(mapRunError("HTTP 409"), "runAlreadyActive");
  });

  it("maps ownership errors (404/403) by code and by status", () => {
    assert.equal(mapRunError("project_not_found"), "projectNotFound");
    assert.equal(mapRunError(404), "projectNotFound");
    assert.equal(mapRunError("forbidden"), "forbidden");
    assert.equal(mapRunError(403), "forbidden");
    assert.equal(mapRunError("HTTP 404"), "projectNotFound");
  });

  it("maps invalid_intent; a bare 400 without a code falls back to generic", () => {
    assert.equal(mapRunError("invalid_intent"), "invalidIntent");
    assert.equal(mapRunError(400), "generic");
    assert.equal(mapRunError("HTTP 400"), "generic");
  });

  it("unknown codes / statuses / garbage all fall back to generic", () => {
    assert.equal(mapRunError("save_failed"), "generic");
    assert.equal(mapRunError(500), "generic");
    assert.equal(mapRunError("HTTP 500"), "generic");
    assert.equal(mapRunError(null), "generic");
    assert.equal(mapRunError(undefined), "generic");
    assert.equal(mapRunError("TypeError: fetch failed"), "generic");
  });

  it("every mapped key resolves to non-empty copy in both locales", () => {
    const keys = [
      mapRunError("website_source_required"),
      mapRunError("run_already_active"),
      mapRunError("project_not_found"),
      mapRunError("forbidden"),
      mapRunError("invalid_intent"),
      mapRunError("anything_else"),
    ];
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const key of keys) {
        assert.ok(
          typeof d.visualChecks.runErrors[key] === "string" && d.visualChecks.runErrors[key].length > 0,
          `${loc}.visualChecks.runErrors.${key} missing`,
        );
      }
    }
  });
});

describe("visual-check-run-state: run/status dictionary copy", () => {
  it("run button, status and progress keys exist in both locales", () => {
    for (const loc of ["en", "ko"]) {
      const d = getDictionary(loc);
      for (const k of [
        "runTitle", "runHint", "intentLabel", "intentPlaceholder", "runButton", "runSubmitting",
        // ★의도된 변경 (#559 여정 렌즈 결함 5): "goToSources"(웹사이트 연결하기 → /sources) 은퇴 —
        //  주소가 없으면 이 화면 안의 주소 칸(AppAddressStart)이 받는다.
        "runQueuedOnly", "runActiveNotice", "runNeedWebsite",
        "statusQueued", "statusRunning", "statusDone", "statusFailed",
        "progressTitle", "progressBody", "failedTitle", "failedBody",
      ]) {
        assert.ok(
          typeof d.visualChecks[k] === "string" && d.visualChecks[k].length > 0,
          `${loc}.visualChecks.${k} missing`,
        );
      }
    }
  });
});
