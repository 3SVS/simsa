import { promises as fs } from "node:fs";
import path from "node:path";
import type { Blocker, BlockerFix } from "@simsa/core";
import type { HandlerResult, BinaryEncodingHandlerDeps } from "./binary-encoding.js";

/**
 * AF-10 — numeric input validator.
 *
 * Council emits "correctness" / "input-validation" / "type-safety" /
 * "bug-risk" blockers when a numeric function parameter isn't guarded
 * against `undefined`/`null`/`NaN` before being used in math. The fix
 * is mechanical: insert a `Number.isFinite` guard at the top of the
 * function body. Conservative: only acts when:
 *   1. blocker.message names a parameter in backticks (e.g. `ratio`)
 *      OR matches a clear naming pattern;
 *   2. blocker.file ends in .js/.ts/.jsx/.tsx;
 *   3. the function is found at or near blocker.line;
 *   4. the parameter exists in the function signature;
 *   5. no `Number.isFinite(<paramName>)` guard already exists in the body.
 *
 * Live evidence (eventbadge#59 cycle 4): MAJOR/correctness on
 * `lightenChannel` ratio not validating finite. Worker patches for
 * this kept conflicting; AF-10 deterministically inserts the guard.
 */

export interface NumericValidatorHandlerDeps extends BinaryEncodingHandlerDeps {}

const VALIDATOR_CATEGORIES = [
  "correctness",
  "input-validation",
  "validation",
  "type-safety",
  "bug-risk",
  "robustness",
];

const NAN_KEYWORDS = [
  "nan",
  "non-finite",
  "isfinite",
  "is finite",
  "invalid number",
  "invalid input",
  "validate",
  "guard",
  "clamp without",
  "without checking",
];

function looksLikeNumericValidatorBlocker(b: Blocker): boolean {
  if (!b.file) return false;
  if (!/\.(js|jsx|ts|tsx|mjs)$/i.test(b.file)) return false;
  const cat = (b.category ?? "").toLowerCase();
  if (!VALIDATOR_CATEGORIES.some((c) => cat.includes(c))) return false;
  const msg = (b.message ?? "").toLowerCase();
  return NAN_KEYWORDS.some((k) => msg.includes(k));
}

/**
 * Try to extract the parameter name the council is talking about.
 * Look for backticked identifiers in the message; prefer ones that
 * look like a numeric param (single short word, lowercase, no dots).
 */
function extractParamName(b: Blocker): string | null {
  const msg = b.message ?? "";
  const ticks = [...msg.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter(Boolean);
  // Pick first identifier-shaped, lowercase, no dots / spaces.
  for (const t of ticks) {
    if (/^[a-z][a-z0-9_]{0,30}$/.test(t)) return t;
  }
  return null;
}

interface FunctionSite {
  /** Line index of `function NAME(...)` or arrow-fn-with-block opening line. */
  startLineIndex: number;
  /** Line index of the line AFTER the `{` opening the body. */
  bodyStartLineIndex: number;
  /** Indentation string of the body (spaces). */
  bodyIndent: string;
  /** Parameters list (raw). */
  paramsRaw: string;
}

function findEnclosingFunction(content: string, blockerLine: number | undefined, paramName: string): FunctionSite | null {
  const lines = content.split(/\r?\n/);
  // Search outward from blocker.line (1-based) up to 30 lines back for a
  // function declaration that includes paramName.
  const targetIdx = Math.max(0, (blockerLine ?? 1) - 1);
  // We accept three function shapes:
  //   function NAME(p1, p2)               { ... }
  //   export function NAME(...)           { ... }
  //   const NAME = (p1, p2)               => { ... }
  //   export function NAME(...): T        { ... }
  const fnRe = /\b(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(([^)]*)\)\s*(?::[^{]*)?\{/;
  const arrowRe = /\b(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=>]*)?=>\s*\{/;
  for (let i = targetIdx; i >= Math.max(0, targetIdx - 30); i--) {
    const line = lines[i]!;
    let m = fnRe.exec(line);
    if (!m) m = arrowRe.exec(line);
    if (!m) continue;
    const paramsRaw = m[1] ?? "";
    if (!new RegExp(`\\b${paramName}\\b`).test(paramsRaw)) continue;
    // Confirm the body opens on this same line (`{` present); if it
    // wraps to next line with multi-line signature, find the `{`.
    let openLineIdx = i;
    while (openLineIdx < lines.length && !lines[openLineIdx]!.includes("{")) openLineIdx++;
    if (openLineIdx >= lines.length) continue;
    const bodyStartLineIndex = openLineIdx + 1;
    if (bodyStartLineIndex >= lines.length) continue;
    // Use the FIRST body line's indentation. Fallback: 2 spaces.
    const firstBody = lines[bodyStartLineIndex] ?? "";
    const indentMatch = /^(\s*)\S/.exec(firstBody);
    const bodyIndent = indentMatch ? indentMatch[1]! : "  ";
    return { startLineIndex: i, bodyStartLineIndex, bodyIndent, paramsRaw };
  }
  return null;
}

function alreadyGuarded(content: string, fnSite: FunctionSite, paramName: string): boolean {
  const lines = content.split(/\r?\n/);
  // Look at next 6 lines after function body start for an existing guard.
  const tail = lines
    .slice(fnSite.bodyStartLineIndex, Math.min(lines.length, fnSite.bodyStartLineIndex + 6))
    .join("\n");
  if (new RegExp(`Number\\.isFinite\\s*\\(\\s*${paramName}\\s*\\)`).test(tail)) return true;
  if (new RegExp(`isNaN\\s*\\(\\s*${paramName}\\s*\\)`).test(tail)) return true;
  if (new RegExp(`typeof\\s+${paramName}\\s*[!=]==?\\s*['"]number['"]`).test(tail)) return true;
  return false;
}

export async function tryNumericValidatorFix(
  agent: string,
  blocker: Blocker,
  deps: NumericValidatorHandlerDeps,
): Promise<HandlerResult> {
  if (!looksLikeNumericValidatorBlocker(blocker)) return { claimed: false };
  const paramName = extractParamName(blocker);
  if (!paramName) return { claimed: false };
  const log = deps.log ?? (() => {});
  const file = blocker.file!;
  const abs = path.isAbsolute(file) ? file : path.join(deps.cwd, file);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return { claimed: false };
  }
  const fnSite = findEnclosingFunction(content, blocker.line, paramName);
  if (!fnSite) {
    log(`AF-10 numeric-validator: ${file} — no enclosing function with parameter '${paramName}' near line ${blocker.line ?? "?"}, declining\n`);
    return { claimed: false };
  }
  if (alreadyGuarded(content, fnSite, paramName)) {
    log(`AF-10 numeric-validator: ${file} — '${paramName}' already guarded, declining\n`);
    return { claimed: false };
  }
  const lines = content.split(/\r?\n/);
  const guard = `${fnSite.bodyIndent}if (!Number.isFinite(${paramName})) ${paramName} = 0;`;
  lines.splice(fnSite.bodyStartLineIndex, 0, guard);
  const next = lines.join("\n");
  if (next === content) return { claimed: false };
  const writeText = deps.writeBytes
    ? async (p: string, data: Buffer) => deps.writeBytes!(p, data)
    : async (p: string, data: Buffer) => fs.writeFile(p, data);
  await writeText(abs, Buffer.from(next, "utf8"));
  try {
    await deps.git("git", ["add", file], { cwd: deps.cwd });
  } catch (err) {
    log(`AF-10 numeric-validator: git add failed — ${err instanceof Error ? err.message : String(err)}\n`);
    return { claimed: false };
  }
  log(`AF-10 numeric-validator: inserted Number.isFinite guard for '${paramName}' in ${file}\n`);
  return {
    claimed: true,
    fix: {
      agent,
      blocker,
      status: "ready",
      patch: `# AF-10 mechanical numeric-validator inject on ${file} for parameter '${paramName}'\n`,
      commitMessage: `fix(safety): guard '${paramName}' against non-finite input in ${file} (AF-10)`,
      appliedFiles: [file],
      costUsd: 0,
      tokensUsed: 0,
    },
  };
}
