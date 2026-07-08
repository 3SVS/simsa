import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSecretFile, filesForTextBundle, hasSecretFiles } from "../src/lib/pack-bundle.mjs";

// P0-security: the pack's .env.local holds the user's REAL keys. It belongs in
// the ZIP (their project's gitignored env file) but must NEVER be folded into
// "copy all → clipboard" or "download as one .md". This pins that so a future
// change can't silently reintroduce the leak (meta-review: same-commit regression).

const SECRET = "SUPABASE_SERVICE_ROLE_KEY=eyJZQX-REAL-SECRET-do-not-leak-42";

const PACK = [
  { path: "simsa-build-pack/README.md", content: "readme" },
  { path: "simsa-build-pack/.env.example", content: "SUPABASE_SERVICE_ROLE_KEY=" }, // placeholder → safe
  { path: "simsa-build-pack/.env.local", content: `# secrets\n${SECRET}\n` },
  { path: "simsa-build-pack/CLAUDE_CODE_PROMPT.md", content: "prompt" },
];

describe("pack text bundles never contain the real .env.local secret", () => {
  it("isSecretFile matches .env.local, not .env.example", () => {
    assert.equal(isSecretFile("x/.env.local"), true);
    assert.equal(isSecretFile(".env.local"), true);
    assert.equal(isSecretFile("x/.env.example"), false);
    assert.equal(isSecretFile("x/README.md"), false);
  });

  it("filesForTextBundle drops .env.local — no real secret survives", () => {
    const kept = filesForTextBundle(PACK);
    assert.ok(!kept.some((f) => f.path.endsWith(".env.local")), ".env.local must be excluded");
    const blob = kept.map((f) => f.content).join("\n---\n");
    assert.ok(!blob.includes(SECRET), "the real secret value must not appear in the text bundle");
    assert.ok(!blob.includes("eyJZQX-REAL-SECRET"), "no fragment of the secret survives");
    // The safe placeholder file is still included.
    assert.ok(kept.some((f) => f.path.endsWith(".env.example")), ".env.example (placeholders) stays");
  });

  it("hasSecretFiles flags the pack so the UI can warn", () => {
    assert.equal(hasSecretFiles(PACK), true);
    assert.equal(hasSecretFiles(PACK.filter((f) => !f.path.endsWith(".env.local"))), false);
  });
});
