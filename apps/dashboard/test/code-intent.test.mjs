// F-5 — composeCodeIntent: the code branch's lightweight intent composer.
// Pins: both-empty → "" (caller skips the LLM call, pre-F-5 behavior kept),
// newline/comma splitting, locale label, desc-only passthrough.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeCodeIntent } from "../src/lib/code-intent.mjs";

describe("composeCodeIntent", () => {
  it("both fields empty → empty string (no generation call)", () => {
    assert.equal(composeCodeIntent({}), "");
    assert.equal(composeCodeIntent({ desc: "  ", mustWork: " \n , " }), "");
    assert.equal(composeCodeIntent(null), "");
  });

  it("desc only → passthrough, trimmed", () => {
    assert.equal(composeCodeIntent({ desc: " 동네 빵집 예약 앱 " }), "동네 빵집 예약 앱");
  });

  it("mustWork splits on newlines AND commas, drops blanks", () => {
    const out = composeCodeIntent({ mustWork: "로그인, 예약 만들기\n결제,, \n", locale: "ko" });
    assert.equal(out, "꼭 작동해야 하는 것:\n- 로그인\n- 예약 만들기\n- 결제");
  });

  it("desc + mustWork compose with a blank line between", () => {
    const out = composeCodeIntent({ desc: "빵집 예약 앱", mustWork: "로그인", locale: "ko" });
    assert.equal(out, "빵집 예약 앱\n\n꼭 작동해야 하는 것:\n- 로그인");
  });

  it("en locale uses the English label (and is the default)", () => {
    assert.equal(
      composeCodeIntent({ mustWork: "sign-in", locale: "en" }),
      "Must work:\n- sign-in",
    );
    assert.equal(composeCodeIntent({ mustWork: "sign-in" }), "Must work:\n- sign-in");
  });
});
