/**
 * login-prompt.test.mjs — fixes the value-moment promotion timing:
 * show ONLY when (anonymous confirmed) AND (a result exists) AND (not dismissed).
 * Too early (entry) kills unconvinced users; unknown session must never flash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldPromptLogin,
  isLoginPromptDismissed,
  dismissLoginPrompt,
  LOGIN_PROMPT_DISMISS_KEY,
} from "../src/lib/login-prompt.mjs";

test("shows exactly at the value moment: anonymous + result + not dismissed", () => {
  assert.equal(shouldPromptLogin({ signedIn: false, hasResult: true, dismissed: false }), true);
});

test("never before value is felt (no result yet — entry-time prompts kill users)", () => {
  assert.equal(shouldPromptLogin({ signedIn: false, hasResult: false, dismissed: false }), false);
});

test("never while signed in", () => {
  assert.equal(shouldPromptLogin({ signedIn: true, hasResult: true, dismissed: false }), false);
});

test("never while the session is UNKNOWN (null) — no flash that vanishes", () => {
  assert.equal(shouldPromptLogin({ signedIn: null, hasResult: true, dismissed: false }), false);
});

test("soft prompt: dismissal is respected", () => {
  assert.equal(shouldPromptLogin({ signedIn: false, hasResult: true, dismissed: true }), false);
});

test("dismissal round-trips through storage and never throws on broken storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(isLoginPromptDismissed(storage), false);
  dismissLoginPrompt(storage);
  assert.equal(store.get(LOGIN_PROMPT_DISMISS_KEY), "1");
  assert.equal(isLoginPromptDismissed(storage), true);
  // broken storage → safe defaults, no throw
  const broken = { getItem() { throw new Error("boom"); }, setItem() { throw new Error("boom"); } };
  assert.equal(isLoginPromptDismissed(broken), false);
  dismissLoginPrompt(broken); // must not throw
});
