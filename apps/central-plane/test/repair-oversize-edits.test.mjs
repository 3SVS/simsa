/**
 * repair-oversize-edits.test.mjs — the oversize excerpt + exact-edit rails
 * (src/workspace/repair-brief.ts, same source the container compiles).
 *
 *   - buildOversizeExcerpts: token windows, merge, caps, head fallback,
 *     verbatim text (line numbers never mixed in)
 *   - applyExactEdits: exactly-once rule (not-found / ambiguous), deny-list,
 *     traversal, secret introduction, noop, partial application
 *   - buildAutoFixPrContent: editedOversizeFiles honesty note
 *
 * No network, no LLM, no filesystem beyond imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOversizeExcerpts,
  applyExactEdits,
  buildAutoFixPrContent,
} from "../dist/workspace/repair-brief.js";

// ─── buildOversizeExcerpts ──────────────────────────────────────────────────

function numberedLines(n, fill = (i) => `line ${i}`) {
  return Array.from({ length: n }, (_, i) => fill(i + 1)).join("\n");
}

test("excerpts: a window opens around each token hit, merged when overlapping", () => {
  const lines = Array.from({ length: 200 }, (_, i) => {
    const n = i + 1;
    if (n === 100) return "  fetch('/rest/v1/todos')";
    if (n === 110) return "  const todos = [];"; // within the same merged window
    return `line ${n}`;
  }).join("\n");

  const regions = buildOversizeExcerpts(lines, ["todos"], { windowLines: 10 });
  assert.equal(regions.length, 1, "overlapping windows merge into one region");
  assert.equal(regions[0].startLine, 90);
  assert.equal(regions[0].endLine, 120);
  assert.ok(regions[0].text.includes("fetch('/rest/v1/todos')"));
  // Verbatim: the region text is exactly the file's lines joined by \n.
  assert.ok(!/^\s*\d+:/.test(regions[0].text), "no line numbers inside region text");
});

test("excerpts: no token hits → head-of-file fallback window", () => {
  const content = numberedLines(500);
  const regions = buildOversizeExcerpts(content, ["nomatch-token"], { windowLines: 20 });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].startLine, 1);
  assert.ok(regions[0].endLine <= 21);
  assert.ok(regions[0].text.startsWith("line 1"));
});

test("excerpts: region count and byte budget are enforced", () => {
  // Hits far apart → distinct regions; cap at 2.
  const lines = Array.from({ length: 1000 }, (_, i) => {
    const n = i + 1;
    return n % 100 === 0 ? `hit marker ${n}` : `line ${n}`;
  }).join("\n");
  const regions = buildOversizeExcerpts(lines, ["marker"], { windowLines: 3, maxRegions: 2 });
  assert.equal(regions.length, 2);

  // Tiny budget → at least one (trimmed) region still comes back.
  const one = buildOversizeExcerpts(lines, ["marker"], { windowLines: 50, budgetBytes: 100 });
  assert.equal(one.length, 1);
  assert.ok(one[0].text.length <= 100);
});

// ─── applyExactEdits ────────────────────────────────────────────────────────

const FILE = "index.html";
const ORIGINAL = [
  "<html>",
  "<script>",
  "const API = 'http://localhost:3000';",
  "fetch(API + '/items');",
  "</script>",
  "</html>",
].join("\n");

test("applyExactEdits: unique match applies, content updated", () => {
  const { contents, applied, rejected } = applyExactEdits(
    { [FILE]: ORIGINAL },
    [
      {
        path: FILE,
        search: "const API = 'http://localhost:3000';",
        replace: "const API = 'https://api.example.com';",
      },
    ],
  );
  assert.equal(rejected.length, 0);
  assert.equal(applied.length, 1);
  assert.ok(contents[FILE].includes("https://api.example.com"));
  assert.ok(!contents[FILE].includes("localhost:3000"));
});

test("applyExactEdits: zero hits → search_not_found; 2+ hits → search_ambiguous", () => {
  const dup = "a\nrepeat me\nb\nrepeat me\nc";
  const r1 = applyExactEdits({ [FILE]: ORIGINAL }, [
    { path: FILE, search: "not in the file", replace: "x" },
  ]);
  assert.equal(r1.rejected[0].reason, "search_not_found");
  assert.equal(r1.contents[FILE], ORIGINAL, "rejected edit must not touch content");

  const r2 = applyExactEdits({ [FILE]: dup }, [
    { path: FILE, search: "repeat me", replace: "x" },
  ]);
  assert.equal(r2.rejected[0].reason, "search_ambiguous");
  assert.equal(r2.contents[FILE], dup);
});

test("applyExactEdits: sequential edits see earlier accepted edits", () => {
  const { contents, applied } = applyExactEdits({ [FILE]: ORIGINAL }, [
    { path: FILE, search: "'http://localhost:3000'", replace: "'https://api.example.com'" },
    // This search only exists AFTER the first edit applied.
    { path: FILE, search: "const API = 'https://api.example.com';", replace: "const API = 'https://api.example.com'; // prod" },
  ]);
  assert.equal(applied.length, 2);
  assert.ok(contents[FILE].includes("// prod"));
});

test("applyExactEdits: deny-list, traversal, unknown file, noop, empty search", () => {
  const files = { [FILE]: ORIGINAL, ".env": "SECRET=1" };
  const { applied, rejected } = applyExactEdits(files, [
    { path: ".env", search: "SECRET=1", replace: "SECRET=2" },
    { path: "../outside.txt", search: "a", replace: "b" },
    { path: "missing.js", search: "a", replace: "b" },
    { path: FILE, search: "fetch(API + '/items');", replace: "fetch(API + '/items');" },
    { path: FILE, search: "", replace: "b" },
  ]);
  assert.equal(applied.length, 0);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ["denied_file", "unsafe_path", "not_excerpted_file", "noop_edit", "empty_search"],
  );
});

test("applyExactEdits: replace may not introduce credential-shaped strings", () => {
  const { applied, rejected } = applyExactEdits({ [FILE]: ORIGINAL }, [
    {
      path: FILE,
      search: "const API = 'http://localhost:3000';",
      replace: "const API = 'x'; const KEY = 'sk-abcdefghijklmnopqrstuvwx';",
    },
  ]);
  assert.equal(applied.length, 0);
  assert.equal(rejected[0].reason, "introduces_secret");
});

test("applyExactEdits: partial application — good edit lands, bad edit reports", () => {
  const { contents, applied, rejected } = applyExactEdits({ [FILE]: ORIGINAL }, [
    { path: FILE, search: "nope, not here", replace: "x" },
    { path: FILE, search: "fetch(API + '/items');", replace: "fetch(API + '/v2/items');" },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(contents[FILE].includes("/v2/items"));
});

// ─── PR honesty note ────────────────────────────────────────────────────────

test("buildAutoFixPrContent: editedOversizeFiles adds the excerpt honesty note", () => {
  const { body } = buildAutoFixPrContent({
    runId: "wvc_x",
    intent: "핵심 기능 점검",
    findings: [],
    changedFiles: ["index.html"],
    editedOversizeFiles: ["index.html"],
  });
  assert.ok(body.includes("큰 파일은 필요한 부분만 고쳤어요"));
  assert.ok(body.includes("`index.html`"));

  const { body: without } = buildAutoFixPrContent({
    runId: "wvc_x",
    findings: [],
    changedFiles: ["a.js"],
  });
  assert.ok(!without.includes("큰 파일은 필요한 부분만"));
});
