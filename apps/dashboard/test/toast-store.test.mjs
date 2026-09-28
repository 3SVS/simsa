import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TOASTS,
  initialToastState,
  toastReducer,
  normalizeToast,
} from "../src/lib/toast-store.mjs";

describe("toast-store", () => {
  it("starts empty", () => {
    assert.deepEqual(initialToastState(), { toasts: [] });
  });

  it("push appends a normalized toast", () => {
    const s1 = toastReducer(initialToastState(), { type: "push", toast: { message: "Saved" } });
    assert.equal(s1.toasts.length, 1);
    assert.equal(s1.toasts[0].message, "Saved");
    assert.equal(s1.toasts[0].variant, "success");
    assert.ok(s1.toasts[0].id);
  });

  it("defaults variant to success and honours error", () => {
    assert.equal(normalizeToast({ message: "x" }).variant, "success");
    assert.equal(normalizeToast({ message: "x", variant: "error" }).variant, "error");
    assert.equal(normalizeToast({ message: "x", variant: "weird" }).variant, "success");
  });

  // #558 검증 P2-4·P2-14 — "사용자 잘못이 아닌" 안내(오늘 상한·일시 중지)는 빨간 error(role=alert)가
  // 아니라 info 톤이어야 한다. 종전 store는 info를 success로 바꿔 버렸다.
  it("honours an info variant (information, not a red error)", () => {
    assert.equal(normalizeToast({ message: "x", variant: "info" }).variant, "info");
    const s = toastReducer(initialToastState(), { type: "push", toast: { message: "Paused", variant: "info", duration: 10000 } });
    assert.equal(s.toasts[0].variant, "info");
    assert.equal(s.toasts[0].duration, 10000);
  });

  it("drops toasts without a message", () => {
    assert.equal(normalizeToast({ message: "" }), null);
    assert.equal(normalizeToast({}), null);
    assert.equal(normalizeToast(null), null);
    const s = toastReducer(initialToastState(), { type: "push", toast: { message: "" } });
    assert.equal(s.toasts.length, 0);
  });

  it("dismiss removes by id", () => {
    let s = toastReducer(initialToastState(), { type: "push", toast: { id: "a", message: "A" } });
    s = toastReducer(s, { type: "push", toast: { id: "b", message: "B" } });
    s = toastReducer(s, { type: "dismiss", id: "a" });
    assert.deepEqual(s.toasts.map((t) => t.id), ["b"]);
  });

  it("clear empties the queue", () => {
    let s = toastReducer(initialToastState(), { type: "push", toast: { message: "A" } });
    s = toastReducer(s, { type: "clear" });
    assert.deepEqual(s.toasts, []);
  });

  it("trims to MAX_TOASTS keeping the newest", () => {
    let s = initialToastState();
    for (let i = 0; i < MAX_TOASTS + 3; i++) {
      s = toastReducer(s, { type: "push", toast: { id: `t${i}`, message: `m${i}` } });
    }
    assert.equal(s.toasts.length, MAX_TOASTS);
    assert.equal(s.toasts[s.toasts.length - 1].id, `t${MAX_TOASTS + 2}`);
    assert.equal(s.toasts[0].id, `t3`);
  });

  it("preserves actionLabel for Undo affordances", () => {
    const t = normalizeToast({ message: "Archived", actionLabel: "Undo" });
    assert.equal(t.actionLabel, "Undo");
  });

  it("ignores unknown actions", () => {
    const s = initialToastState();
    assert.equal(toastReducer(s, { type: "nope" }), s);
  });
});
