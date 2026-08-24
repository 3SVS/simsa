import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateSourceInput,
  validateDocumentFile,
  sourceTypeLabel,
  formatBytes,
  MAX_DOCUMENT_BYTES,
} from "../src/lib/project-sources.mjs";
import { getDictionary } from "../src/i18n/dictionary.mjs";

const en = getDictionary("en");
const ko = getDictionary("ko");

describe("project-sources: validateSourceInput", () => {
  it("accepts http/https website URLs (trimmed)", () => {
    assert.deepEqual(validateSourceInput("website", "https://app.trysimsa.com"), { ok: true });
    assert.deepEqual(validateSourceInput("website", "  http://localhost:3000/path?q=1  "), { ok: true });
  });

  it("rejects invalid website URLs with the server's invalid_url code", () => {
    for (const bad of ["", "not a url", "example.com", "ftp://x.com", "javascript:alert(1)"]) {
      assert.deepEqual(validateSourceInput("website", bad), { ok: false, error: "invalid_url" }, bad);
    }
  });

  it("accepts owner/repo GitHub references", () => {
    assert.deepEqual(validateSourceInput("github_repo", "3SVS/My-first-product"), { ok: true });
    assert.deepEqual(validateSourceInput("github_repo", "a/b"), { ok: true });
    assert.deepEqual(validateSourceInput("github_repo", "seunghunbae-3svs/conclave.ai_v2"), { ok: true });
  });

  // 2026-08-23 동작 변경 (Bae 지시): GitHub **주소를 그대로 붙여넣는 것**이 실제
  // 사용 패턴이므로 이제 받는다. 종전엔 "https://github.com/o/r"가 거절 목록에
  // 있었는데, 그게 바로 사용자를 막던 규칙이었다 — 아래 별도 테스트로 이동.
  it("accepts a pasted GitHub address (2026-08-23)", () => {
    for (const pasted of [
      "https://github.com/o/r",
      "https://github.com/o/r.git",
      "https://github.com/o/r/tree/main/src",
      "git@github.com:o/r.git",
    ]) {
      assert.deepEqual(validateSourceInput("github_repo", pasted), { ok: true }, pasted);
    }
  });

  it("rejects malformed GitHub references with invalid_repo", () => {
    // "owner/repo/extra"는 여전히 거절한다 — 주소가 아니라 손으로 친 세 조각이면
    // 오타이고, 조용히 owner/repo로 고쳐 받으면 의도하지 않은 저장소에 연결된다.
    for (const bad of ["", "owner", "owner/", "/repo", "-owner/repo", "owner/repo/extra", "https://gitlab.com/o/r"]) {
      assert.deepEqual(validateSourceInput("github_repo", bad), { ok: false, error: "invalid_repo" }, bad);
    }
    // owner longer than 39 chars is rejected
    assert.deepEqual(
      validateSourceInput("github_repo", `${"a".repeat(40)}/repo`),
      { ok: false, error: "invalid_repo" },
    );
  });

  it("rejects unknown source types with invalid_type (documents use the upload route)", () => {
    assert.deepEqual(validateSourceInput("document", "x"), { ok: false, error: "invalid_type" });
    assert.deepEqual(validateSourceInput("mystery", "x"), { ok: false, error: "invalid_type" });
  });
});

describe("project-sources: validateDocumentFile", () => {
  it("accepts md / txt / pdf up to 10MB (extension case-insensitive)", () => {
    assert.deepEqual(validateDocumentFile("prd.md", 1024), { ok: true });
    assert.deepEqual(validateDocumentFile("notes.TXT", 10), { ok: true });
    assert.deepEqual(validateDocumentFile("spec.pdf", MAX_DOCUMENT_BYTES), { ok: true });
  });

  it("rejects unsupported extensions and oversized / empty files", () => {
    assert.deepEqual(validateDocumentFile("image.png", 10), { ok: false, error: "unsupported_file_type" });
    assert.deepEqual(validateDocumentFile("noext", 10), { ok: false, error: "unsupported_file_type" });
    assert.deepEqual(validateDocumentFile("big.pdf", MAX_DOCUMENT_BYTES + 1), { ok: false, error: "file_too_large" });
    assert.deepEqual(validateDocumentFile("empty.md", 0), { ok: false, error: "file_too_large" });
  });
});

describe("project-sources: labels + formatting", () => {
  it("sourceTypeLabel is localized in both locales and falls through raw", () => {
    assert.equal(sourceTypeLabel("website", en), en.sources.typeWebsite);
    assert.equal(sourceTypeLabel("github_repo", en), en.sources.typeGithub);
    assert.equal(sourceTypeLabel("document", ko), "문서");
    assert.equal(sourceTypeLabel("other", en), "other");
  });

  it("formatBytes renders B / KB / MB and empty string for invalid input", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
    assert.equal(formatBytes(-1), "");
    assert.equal(formatBytes(Number.NaN), "");
  });

  it("sources + visualChecks namespaces exist with en/ko parity for the new keys", () => {
    for (const d of [en, ko]) {
      assert.ok(d.sources.errors.invalid_url.length > 0);
      assert.ok(d.sources.errors.invalid_repo.length > 0);
      assert.ok(d.visualChecks.worksYes.length > 0);
      assert.ok(d.visualChecks.fixTitle.length > 0);
      assert.ok(d.nav.visualChecks.length > 0);
      assert.ok(d.nav.sources.length > 0);
    }
    assert.equal(ko.visualChecks.fixTitle, "바로 고치게 하기");
  });
});
