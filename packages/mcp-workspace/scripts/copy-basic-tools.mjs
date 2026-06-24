// Copies the MCP Basic preview wrapper modules (.mjs + .d.mts) into dist so the
// compiled server (dist/server.js) can import them at runtime. tsc does not emit
// .mjs files, so without this step `dist/server.js`'s
// `import ... from "./mcp-basic-preview-tools.mjs"` would 404 at runtime.
// Mirrors packages/core/scripts/copy-seeds.mjs.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

const FILES = [
  "mcp-basic-tools.mjs",
  "mcp-basic-tools.d.mts",
  "mcp-basic-preview-tools.mjs",
  "mcp-basic-preview-tools.d.mts",
];

let copied = 0;
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(dist, f));
  copied += 1;
}
process.stderr.write(`copy-basic-tools: copied ${copied} file(s) to dist\n`);
