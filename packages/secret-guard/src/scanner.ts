import { DEFAULT_RULES } from "./rules.js";
import type { ScanOptions, ScanResult, SecretFinding, SecretRule } from "./types.js";

/**
 * Redact a match so the finding can be logged / stored safely. Keeps the
 * first 4 characters (usually a prefix like `sk-` / `AKIA` / `ghp_` that
 * is helpful for triage) and the last 4 of tokens 12 chars or longer.
 * For shorter matches, returns `[redacted]`.
 */
export function redact(match: string): string {
  if (match.length < 12) return "[redacted]";
  return `${match.slice(0, 4)}…${match.slice(-4)}`;
}

function shouldSurface(rule: SecretRule, opts: ScanOptions): boolean {
  if (rule.confidence === "high") return true;
  if (rule.confidence === "medium") return Boolean(opts.includeLowConfidence);
  return Boolean(opts.includeLowConfidence);
}

/**
 * Scan an arbitrary text blob. Returns every finding (ordered by line)
 * and a `blocked` flag that is true iff any high-confidence rule matched.
 */
export function scanText(text: string, opts: ScanOptions = {}): ScanResult {
  const rules = opts.rules ?? DEFAULT_RULES;
  const allow = new Set(opts.allow ?? []);
  const findings: SecretFinding[] = [];

  // Line/column tracking: we walk the text line by line so each finding's
  // line number is stable even if the file contains multiline content.
  const lines = text.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx]!;
    for (const rule of rules) {
      if (allow.has(rule.id)) continue;
      if (!shouldSurface(rule, opts)) continue;
      const m = line.match(rule.pattern);
      if (!m || m.index === undefined) continue;
      // Full match is index 0; labeled-rules capture group 1 is the actual
      // secret, so prefer it for redaction when present.
      const secret = m[1] ?? m[0];
      const finding: SecretFinding = {
        ruleId: rule.id,
        ruleName: rule.name,
        confidence: rule.confidence,
        line: lineIdx + 1,
        column: m.index,
        preview: redact(secret),
      };
      if (opts.file) finding.file = opts.file;
      findings.push(finding);
    }
  }

  const blocked = findings.some((f) => f.confidence === "high");
  return { findings, blocked };
}

/**
 * Scan a unified-diff patch. Only "added" lines (lines starting with `+`
 * but not `+++` headers) are considered — context lines and deletions
 * can't introduce new secrets, so flagging them would spam false positives
 * on PRs that merely touched a file containing an existing token.
 *
 * Line numbers are relative to the *patch*, not the post-apply file —
 * that's accurate for the context where this scanner runs (pre-apply).
 * The `file` field is populated from the `+++ b/<path>` header so
 * consumers can attribute findings back to the right file in a multi-file
 * patch without doing the parsing themselves.
 */
export function scanPatch(patch: string, opts: ScanOptions = {}): ScanResult {
  const rules = opts.rules ?? DEFAULT_RULES;
  const allow = new Set(opts.allow ?? []);
  const findings: SecretFinding[] = [];

  const lines = patch.split(/\r?\n/);
  let currentFile: string | undefined = opts.file;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith("+++ ")) {
      // `+++ b/path/to/file` — strip the `b/` prefix if present. Git uses
      // `/dev/null` to indicate a deleted file.
      const raw = line.slice(4).trim();
      if (raw === "/dev/null") {
        currentFile = opts.file;
      } else {
        currentFile = raw.startsWith("b/") ? raw.slice(2) : raw;
      }
      continue;
    }
    if (line.startsWith("---") || line.startsWith("diff ") || line.startsWith("@@") || line.startsWith("index ")) continue;
    if (!line.startsWith("+")) continue;
    const added = line.slice(1);
    for (const rule of rules) {
      if (allow.has(rule.id)) continue;
      if (!shouldSurface(rule, opts)) continue;
      const m = added.match(rule.pattern);
      if (!m || m.index === undefined) continue;
      const secret = m[1] ?? m[0];
      const finding: SecretFinding = {
        ruleId: rule.id,
        ruleName: rule.name,
        confidence: rule.confidence,
        line: i + 1,
        column: m.index + 1, // account for the leading `+`
        preview: redact(secret),
      };
      if (currentFile) finding.file = currentFile;
      findings.push(finding);
    }
  }

  const blocked = findings.some((f) => f.confidence === "high");
  return { findings, blocked };
}

/**
 * One-line summary of a finding, safe to log. Mirrors the format used by
 * the conclave CLI when a pre-apply scan blocks a rework commit.
 */
export function formatFinding(f: SecretFinding): string {
  const loc = f.file ? `${f.file}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
  return `[${f.confidence}] ${f.ruleName} (${f.ruleId}) @ ${loc} → ${f.preview}`;
}

/**
 * Return `text` with every matched secret replaced by its redacted preview,
 * plus the findings. Unlike `scanText`/`scanPatch` (which only report),
 * this rewrites the content so it is safe to persist — the raw secret never
 * survives in the output.
 *
 * Scans ALL lines (not just diff `+` lines): callers persisting arbitrary
 * content — a training record's diff body, a pasted product spec — need every
 * occurrence gone, not only additions. When a rule captures group 1 (the
 * secret inside a larger `key=...` match), only that group is redacted so the
 * surrounding context (the key name) stays intact and legible.
 *
 * By default all confidences are redacted (includeLowConfidence defaults true
 * here) — when scrubbing for storage, over-redaction is the safe error.
 */
export function redactSecrets(
  text: string,
  opts: ScanOptions = {},
): { text: string; findings: SecretFinding[] } {
  const rules = opts.rules ?? DEFAULT_RULES;
  const allow = new Set(opts.allow ?? []);
  const scrubOpts: ScanOptions = { includeLowConfidence: true, ...opts };
  const findings: SecretFinding[] = [];

  const lines = text.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    let line = lines[lineIdx]!;
    for (const rule of rules) {
      if (allow.has(rule.id)) continue;
      if (!shouldSurface(rule, scrubOpts)) continue;
      const flags = rule.pattern.flags.includes("g")
        ? rule.pattern.flags
        : `${rule.pattern.flags}g`;
      const g = new RegExp(rule.pattern.source, flags);
      line = line.replace(g, (full: string, ...rest: unknown[]) => {
        // rest = [group1, group2, ..., offset, wholeString(, groups)]; group 1
        // is the labeled secret when the rule uses a capture group.
        const group1 = typeof rest[0] === "string" ? rest[0] : undefined;
        const secret = group1 ?? full;
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          confidence: rule.confidence,
          line: lineIdx + 1,
          column: 0,
          preview: redact(secret),
          ...(opts.file ? { file: opts.file } : {}),
        });
        // Redact only the secret substring, preserving surrounding context.
        return group1 && full.includes(group1)
          ? full.replace(group1, redact(secret))
          : redact(secret);
      });
    }
    lines[lineIdx] = line;
  }

  return { text: lines.join("\n"), findings };
}
