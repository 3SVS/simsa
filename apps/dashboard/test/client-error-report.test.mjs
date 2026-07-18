/**
 * client-error-report.test.mjs — G12 신고 게이트 (pure).
 * 세션당 캡·중복 제거·노이즈 필터 — 오류 루프가 신고 폭주가 되지 않게.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldReportClientError, SESSION_CAP } from "../src/lib/client-error-report.mjs";

const fresh = () => ({ sentCount: 0, seenMessages: new Set() });

test("first occurrence of a real error → report", () => {
  assert.equal(shouldReportClientError({ message: "TypeError: boom" }, fresh()), true);
});

test("duplicate message in the same session → skip", () => {
  const state = fresh();
  state.seenMessages.add("TypeError: boom");
  assert.equal(shouldReportClientError({ message: "TypeError: boom" }, state), false);
});

test("session cap reached → skip everything", () => {
  const state = fresh();
  state.sentCount = SESSION_CAP;
  assert.equal(shouldReportClientError({ message: "fresh error" }, state), false);
});

test("noise (Script error / ResizeObserver / extension) → never reported", () => {
  const state = fresh();
  assert.equal(shouldReportClientError({ message: "Script error." }, state), false);
  assert.equal(shouldReportClientError({ message: "ResizeObserver loop completed with undelivered notifications" }, state), false);
  assert.equal(shouldReportClientError({ message: "Extension context invalidated" }, state), false);
});

test("empty message → skip", () => {
  assert.equal(shouldReportClientError({ message: "  " }, fresh()), false);
});
