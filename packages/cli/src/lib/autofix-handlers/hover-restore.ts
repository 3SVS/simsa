import { promises as fs } from "node:fs";
import path from "node:path";
import type { Blocker, BlockerFix } from "@simsa/core";
import type { HandlerResult, BinaryEncodingHandlerDeps } from "./binary-encoding.js";

/**
 * AF-11 — hover:opacity-N → hover:bg-COLOR-darker restore.
 *
 * Council emits "missing-state" / "style-drift" / "regression" blockers when
 * a button has `bg-COLOR-N` (e.g. `bg-blue-600`) but the only hover state is
 * `hover:opacity-X`. The opacity hover fades the label along with the bg, so
 * label contrast on hover drops. The repo convention is `hover:bg-COLOR-(N+100)`
 * (one shade darker). This handler:
 *   - Detects `hover:opacity-N` on an element with `bg-COLOR-N`
 *   - Replaces `hover:opacity-N` with `hover:bg-COLOR-(N+100)`
 *   - Skips if `hover:bg-*` already present.
 *
 * Idempotent: a second run finds no `hover:opacity-N` paired with bg, declines.
 *
 * Live evidence (eventbadge#59): cycle 4 council flagged the unrestored
 * hover:opacity-80 as MAJOR/MINOR; AF-6 stripped the inline style but didn't
 * fold the hover state back into Tailwind. AF-11 closes that gap.
 */

export interface HoverRestoreHandlerDeps extends BinaryEncodingHandlerDeps {}

const HOVER_DRIFT_CATEGORIES = [
  "missing-state",
  "regression",
  "style-drift",
  "design-drift",
  "accessibility",
  "a11y",
  "interaction",
];

function looksLikeHoverDriftBlocker(b: Blocker): boolean {
  if (!b.file) return false;
  if (!/\.(jsx|tsx)$/i.test(b.file)) return false;
  const cat = (b.category ?? "").toLowerCase();
  if (!HOVER_DRIFT_CATEGORIES.some((c) => cat.includes(c))) return false;
  const msg = (b.message ?? "").toLowerCase();
  return (
    /hover[:-]opacity/i.test(msg) ||
    /no.*hover/i.test(msg) ||
    /hover.*affordance/i.test(msg) ||
    /hover.*restore/i.test(msg) ||
    /hover.*convention/i.test(msg) ||
    /hover:bg-/i.test(msg)
  );
}

const CLASSNAME_RE = /className="([^"]*)"/;
const HOVER_OPACITY_RE = /\bhover:opacity-\d+\b/;
const BG_TAILWIND_RE = /\bbg-([a-z]+)-(\d{2,3})\b/;
const HOVER_BG_TAILWIND_RE = /\bhover:bg-[a-z]+-\d{2,3}\b/;

interface HoverSite {
  lineIndex: number;
  rewritten: string;
}

function darkerShade(shade: number): number {
  // Tailwind's color scale moves in increments of 100 (50, 100, 200, ..., 950).
  // A "darker" hover is conventionally +100 (e.g. blue-600 → blue-700).
  // Cap at 900 so we never produce blue-1000 which doesn't exist.
  return Math.min(900, shade + 100);
}

function findHoverSites(content: string): HoverSite[] {
  const lines = content.split(/\r?\n/);
  const out: HoverSite[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = CLASSNAME_RE.exec(line);
    if (!m) continue;
    const classes = m[1] ?? "";
    if (!HOVER_OPACITY_RE.test(classes)) continue;
    if (HOVER_BG_TAILWIND_RE.test(classes)) continue; // already has a real hover bg
    const bgMatch = BG_TAILWIND_RE.exec(classes);
    if (!bgMatch) continue;
    const color = bgMatch[1]!;
    const shade = parseInt(bgMatch[2]!, 10);
    if (!Number.isFinite(shade)) continue;
    const newHover = `hover:bg-${color}-${darkerShade(shade)}`;
    const newClasses = classes.replace(HOVER_OPACITY_RE, newHover).trim();
    if (newClasses === classes) continue;
    const rewritten = line.replace(CLASSNAME_RE, `className="${newClasses}"`);
    out.push({ lineIndex: i, rewritten });
  }
  return out;
}

export async function tryHoverRestoreFix(
  agent: string,
  blocker: Blocker,
  deps: HoverRestoreHandlerDeps,
): Promise<HandlerResult> {
  if (!looksLikeHoverDriftBlocker(blocker)) return { claimed: false };
  const log = deps.log ?? (() => {});
  const file = blocker.file!;
  const abs = path.isAbsolute(file) ? file : path.join(deps.cwd, file);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf8");
  } catch {
    return { claimed: false };
  }
  const sites = findHoverSites(content);
  if (sites.length === 0) {
    log(`AF-11 hover-restore: ${file} — no hover:opacity-N + bg-COLOR pairs found, declining\n`);
    return { claimed: false };
  }
  const lines = content.split(/\r?\n/);
  for (const s of sites) lines[s.lineIndex] = s.rewritten;
  const next = lines.join("\n");
  if (next === content) return { claimed: false };
  const writeText = deps.writeBytes
    ? async (p: string, data: Buffer) => deps.writeBytes!(p, data)
    : async (p: string, data: Buffer) => fs.writeFile(p, data);
  await writeText(abs, Buffer.from(next, "utf8"));
  try {
    await deps.git("git", ["add", file], { cwd: deps.cwd });
  } catch (err) {
    log(`AF-11 hover-restore: git add failed — ${err instanceof Error ? err.message : String(err)}\n`);
    return { claimed: false };
  }
  log(`AF-11 hover-restore: replaced hover:opacity-N with hover:bg-COLOR in ${sites.length} element(s) in ${file}\n`);
  return {
    claimed: true,
    fix: {
      agent,
      blocker,
      status: "ready",
      patch: `# AF-11 mechanical hover-restore on ${file}\n`,
      commitMessage: `fix(a11y): restore hover:bg-* convention in ${file} (AF-11)`,
      appliedFiles: [file],
      costUsd: 0,
      tokensUsed: 0,
    },
  };
}
