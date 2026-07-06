import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// KEY NO-STORE — same grade of irreversible surface as the secret scrub (#201).
//
// The export route receives the user's real service keys in the request body
// (req.services[].envVars[].value) so it can bake them into the pack's local,
// gitignored .env.local. Those values must NEVER be recorded server-side:
//   ① never written to D1 / R2 / a usage-event's metadata,
//   ② never logged — including on the error path (console.* must not carry the
//      raw body/req or the services array).
// This is a source-level guard so a future edit can't silently reintroduce a
// leak. The value-only-in-.env.local guarantee is asserted separately in
// workspace-export.test.mjs.

const src = readFileSync(
  fileURLToPath(new URL("../src/routes/workspace.ts", import.meta.url)),
  "utf8",
);
const lines = src.split("\n");

const consoleLines = lines.filter((l) => /console\.(log|warn|error|info|debug)\(/.test(l));

describe("export route never records service keys server-side", () => {
  it("no console.* statement references the services payload", () => {
    for (const l of consoleLines) {
      assert.ok(
        !l.includes("services"),
        `a log statement references the services payload (potential key leak): ${l.trim()}`,
      );
    }
  });

  it("no console.* logs the raw request body/req object wholesale", () => {
    // Logging req.projectId etc. is fine; logging the whole `body`/`req` (which
    // carries services[].value) is not.
    for (const l of consoleLines) {
      assert.ok(
        !/[(,]\s*(body|req)\s*[,)]/.test(l),
        `a log statement dumps the raw request object (carries keys): ${l.trim()}`,
      );
    }
  });

  it("no insertUsageEvent(...) call carries services in its metadata", () => {
    // Grab each insertUsageEvent(...) call region (up to its closing "});") and
    // assert the recorded payload never includes the services array.
    let idx = src.indexOf("insertUsageEvent(");
    let found = 0;
    while (idx !== -1) {
      const end = src.indexOf("});", idx);
      const region = src.slice(idx, end === -1 ? idx + 400 : end);
      assert.ok(!region.includes("services"), `insertUsageEvent records services: ...${region.slice(0, 120)}...`);
      found++;
      idx = src.indexOf("insertUsageEvent(", idx + 1);
    }
    assert.ok(found > 0, "expected at least one insertUsageEvent call to guard");
  });

  it("the export usage event records only the target (no user data)", () => {
    // Positive assertion: the builder-pack export's usage event is target-only.
    assert.ok(
      src.includes("metadata: { target: req.target }"),
      "export usage event should record metadata: { target: req.target } only",
    );
  });

  it("no D1/R2 write in the file binds or stores the services payload", () => {
    const writeLines = lines.filter(
      (l) => /\.bind\(|INSERT\s+INTO|EVIDENCE\.put|\.put\(/.test(l),
    );
    for (const l of writeLines) {
      assert.ok(!l.includes("services"), `a persistence call references services: ${l.trim()}`);
    }
  });
});
