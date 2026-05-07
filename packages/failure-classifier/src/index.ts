/**
 * @conclave-ai/failure-classifier — pattern-match runtime regressions
 * to actionable user guidance.
 *
 * When `@conclave-ai/smoke-verifier` reports a step failure, we have:
 *   - HTTP status code (or null on connection-level failure)
 *   - response body text (or stderr from a failed page render)
 *   - the step that triggered (goto / expect-text / etc.)
 *   - repo context (which deps are in package.json)
 *
 * This module maps that signal to a concrete diagnosis + user actions.
 * Most known patterns are pure regex (deterministic, free). For
 * unknown shapes we expose a `classifyWithLlm` hook that callers can
 * wire to Claude/GPT for a one-off classification call (~$0.01).
 *
 * Privacy: classifiers operate on response bodies only. No code, no
 * env vars, no diff content needed.
 */

export interface FailureSignal {
  /** Step kind that failed (goto / expect-status / etc.). */
  stepKind: string;
  /** HTTP response status if the step produced one. */
  responseStatus?: number;
  /** Response body text (truncated to first 4KB for LLM safety). */
  responseBody?: string;
  /** Raw error message from Playwright / fetch. */
  errorMessage: string;
  /** Repo metadata used for cause-pattern correlation. */
  repoContext?: {
    packageJsonDeps?: string[];
    deployPlatform?: "vercel" | "netlify" | "cloudflare-pages" | "render" | "railway" | "unknown";
  };
}

export interface UserAction {
  /** Human-friendly label, e.g. "Restore Supabase project". */
  step: string;
  /** Optional URL the user should visit. */
  url?: string;
  /** Extra detail / sub-instructions. */
  detail?: string;
}

export interface FailureDiagnosis {
  /** Broad bucket. */
  category:
    | "backend-unreachable"
    | "credentials-expired"
    | "credentials-missing"
    | "db-migration-needed"
    | "api-quota-hit"
    | "service-not-running"
    | "missing-dep"
    | "build-config-error"
    | "asset-404"
    | "auth-misconfig"
    | "cors-blocked"
    | "unknown";
  /** Specific likely cause within the category, e.g. "supabase-paused". */
  likelyCause: string;
  /** Confidence 0..1 — pattern-match hits give 0.7+, LLM gives 0.5+. */
  confidence: number;
  /** Why we picked this — short evidence list. */
  evidence: string[];
  /** Plain-English summary the user reads first. */
  summary: string;
  /** Actions the user should take, in order. */
  userActions: UserAction[];
  /** What to do once resolved. */
  retryHint: string;
  /** Source of the diagnosis. */
  source: "pattern" | "llm" | "fallback";
}

// --- Pattern library ----------------------------------------------------

interface Pattern {
  id: string;
  match: (s: FailureSignal) => boolean;
  diagnose: (s: FailureSignal) => Omit<FailureDiagnosis, "source">;
}

const SUPABASE_PAUSED: Pattern = {
  id: "supabase-paused",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    if (!/fetch failed|TypeError: fetch failed|ENOTFOUND|ECONNREFUSED/i.test(body)) return false;
    const usesSupabase = (s.repoContext?.packageJsonDeps ?? []).some((d) => d.startsWith("@supabase/"));
    return usesSupabase || /supabase/i.test(body);
  },
  diagnose: () => ({
    category: "backend-unreachable",
    likelyCause: "supabase-paused",
    confidence: 0.85,
    evidence: ["TypeError: fetch failed in response", "Supabase deps detected"],
    summary:
      "The deployed app calls Supabase, but the call failed with `fetch failed`. The Supabase project is most likely paused (free tier auto-pauses after ~1 week of inactivity).",
    userActions: [
      {
        step: "Restore the Supabase project",
        url: "https://supabase.com/dashboard",
        detail:
          "Open the dashboard, find this project, and click \"Restore\" / \"Resume\". Wait 1–2 minutes for it to come back online.",
      },
      {
        step: "Verify env vars on the deploy platform",
        detail:
          "If restoring didn't fix it, check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set on Vercel/Netlify/etc. in the Production environment.",
      },
    ],
    retryHint: "After resolving, push any commit (or empty commit) to re-trigger Conclave review.",
  }),
};

const ENV_VAR_MISSING: Pattern = {
  id: "env-var-missing",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /Missing\s+(env|environment)|process\.env\.[A-Z_]+\s+(is undefined|is not defined|is required)|MISSING_[A-Z_]+|undefined is not an object \(evaluating 'process\.env\./i.test(
      body,
    );
  },
  diagnose: (s) => {
    // Try to extract the env var name.
    const m = ((s.responseBody ?? "") + " " + s.errorMessage).match(
      /(?:Missing\s+(?:env\s+vars?\s+|environment variable\s+))?(?:process\.env\.)?([A-Z][A-Z0-9_]{2,})/,
    );
    const varName = m?.[1] ?? "<unknown>";
    return {
      category: "credentials-missing",
      likelyCause: "env-var-missing",
      confidence: 0.8,
      evidence: [`error mentions undefined env var ${varName}`],
      summary: `Server-side code expected env var \`${varName}\` but it was unset on the deploy platform.`,
      userActions: [
        {
          step: `Add ${varName} to your deploy platform's environment variables`,
          detail: `On Vercel: Project → Settings → Environment Variables → add ${varName} with the right value for Production. Same path on Netlify / Render / Cloudflare Pages.`,
        },
      ],
      retryHint: "After adding the env var, redeploy or push any commit.",
    };
  },
};

const DB_MIGRATION_NEEDED: Pattern = {
  id: "db-migration-needed",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /relation\s+"[^"]+"\s+does not exist|column\s+"[^"]+"\s+does not exist|no such table:|UndefinedTable/i.test(
      body,
    );
  },
  diagnose: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    const m =
      body.match(/relation\s+"([^"]+)"\s+does not exist/i) ??
      body.match(/column\s+"([^"]+)"\s+does not exist/i) ??
      body.match(/no such table:\s*([\w_]+)/i);
    const objName = m?.[1] ?? "<unknown>";
    return {
      category: "db-migration-needed",
      likelyCause: "schema-out-of-sync",
      confidence: 0.85,
      evidence: [`DB error references missing table/column ${objName}`],
      summary: `The DB on production is missing the table/column \`${objName}\` that the deployed code expects. A migration that ran locally has not been applied to the remote DB.`,
      userActions: [
        {
          step: `Apply pending migrations to the production DB`,
          detail:
            "Examples: `wrangler d1 migrations apply --remote <db-name>` (Cloudflare D1), `supabase db push` (Supabase), `prisma migrate deploy` (Prisma), `npx drizzle-kit push` (Drizzle).",
        },
      ],
      retryHint: "After migrating, push any commit (or trigger a redeploy) to re-run the smoke check.",
    };
  },
};

const API_QUOTA_HIT: Pattern = {
  id: "api-quota-hit",
  match: (s) => {
    if (s.responseStatus === 429) return true;
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /rate\s*limit|too\s*many\s*requests|quota\s*(exceeded|exhausted)/i.test(body);
  },
  diagnose: () => ({
    category: "api-quota-hit",
    likelyCause: "rate-limited",
    confidence: 0.8,
    evidence: ["HTTP 429 or rate-limit phrase in body"],
    summary:
      "An upstream API returned 429 (rate-limited) or the deployed code surfaced a quota-exceeded error. This is usually transient unless the service plan is exhausted.",
    userActions: [
      {
        step: "Check the upstream service's quota / billing dashboard",
        detail:
          "Anthropic / OpenAI / Stripe / Google / Supabase all expose usage dashboards. Look for current period exhaustion or hard rate ceilings.",
      },
      {
        step: "If the quota is exhausted, upgrade the plan or wait for the period to reset",
      },
    ],
    retryHint: "Once the quota resets / you upgrade, push any commit to re-trigger.",
  }),
};

const CONNECTION_REFUSED: Pattern = {
  id: "connection-refused",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /ECONNREFUSED|connect\s+ECONNREFUSED|EAI_AGAIN|ENOTFOUND/i.test(body);
  },
  diagnose: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    const isLocalhost = /127\.0\.0\.1|localhost|0\.0\.0\.0/i.test(body);
    return {
      category: "service-not-running",
      likelyCause: isLocalhost ? "localhost-target-in-prod" : "downstream-service-down",
      confidence: 0.75,
      evidence: [isLocalhost ? "ECONNREFUSED to localhost from prod" : "ECONNREFUSED / ENOTFOUND in error"],
      summary: isLocalhost
        ? "Production code is trying to reach `localhost` — almost certainly a debug URL that wasn't replaced with a production endpoint."
        : "A downstream service connection was refused / DNS lookup failed — the service is down or the URL is wrong.",
      userActions: isLocalhost
        ? [
            {
              step: "Replace the localhost reference with a production URL",
              detail:
                "Search the codebase for `localhost`, `127.0.0.1`, `0.0.0.0`. Replace with the deployed equivalent (env var or hard-coded prod URL).",
            },
          ]
        : [
            {
              step: "Verify the downstream service is up + reachable",
              detail:
                "Check the service's status page. Confirm the URL hardcoded in the deploy is correct (typo? subdomain change? deprecated endpoint?).",
            },
          ],
      retryHint: "After fixing, push any commit to re-trigger smoke.",
    };
  },
};

const MISSING_DEP: Pattern = {
  id: "missing-dep",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /Cannot find module|MODULE_NOT_FOUND|module not found:/i.test(body);
  },
  diagnose: (s) => {
    const m = ((s.responseBody ?? "") + " " + s.errorMessage).match(
      /Cannot find module ['"`]([^'"`]+)['"`]/,
    );
    const modName = m?.[1] ?? "<unknown>";
    return {
      category: "missing-dep",
      likelyCause: "package-not-installed-or-typoed",
      confidence: 0.8,
      evidence: [`Cannot find module: ${modName}`],
      summary: `Production runtime can't find the module \`${modName}\`. Either it's not in package.json's "dependencies" (only in "devDependencies"), or it's a typo, or the install step skipped it.`,
      userActions: [
        {
          step: `Verify ${modName} is in dependencies`,
          detail:
            "Open package.json and confirm the module is in `dependencies` (NOT just `devDependencies`). Run `pnpm install` and commit the lockfile change.",
        },
      ],
      retryHint: "After fix, push any commit.",
    };
  },
};

const ASSET_404: Pattern = {
  id: "asset-404",
  match: (s) => {
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /No Output Directory named ['"`]public['"`] found|404 — page not found at root|index\.html not found/i.test(
      body,
    );
  },
  diagnose: () => ({
    category: "build-config-error",
    likelyCause: "wrong-output-directory",
    confidence: 0.85,
    evidence: ["deploy reports missing public/ or index.html"],
    summary:
      "The deploy platform expected a built output directory but didn't find it. Common cause: framework preset is set to \"Other\" instead of the actual framework (Next.js / Vite / etc.).",
    userActions: [
      {
        step: "Check the deploy platform's framework preset",
        detail:
          "Vercel: Project → Settings → General → Framework Preset (set to your actual framework). Netlify: Site settings → Build & deploy → Environment.",
      },
      {
        step: "Check the build command + output directory",
        detail:
          "For Next.js: build = `next build`, output = `.next`. For Vite: build = `vite build`, output = `dist`. For static: output = `public` or `dist`.",
      },
    ],
    retryHint: "After updating settings, redeploy or push any commit.",
  }),
};

const AUTH_MISCONFIG: Pattern = {
  id: "auth-misconfig",
  match: (s) => {
    if (s.responseStatus === 401 || s.responseStatus === 403) return true;
    const body = (s.responseBody ?? "") + " " + s.errorMessage;
    return /JWT (?:expired|invalid|malformed)|invalid token|unauthorized/i.test(body);
  },
  diagnose: (s) => ({
    category: "auth-misconfig",
    likelyCause: s.responseStatus === 401 ? "credentials-rejected" : "permission-denied",
    confidence: 0.7,
    evidence: [`HTTP ${s.responseStatus ?? "?"} or auth-related error in body`],
    summary:
      s.responseStatus === 401
        ? "An auth-protected endpoint rejected the request. The user-facing flow probably expects a logged-in user that smoke-verifier wasn't logged in as."
        : "An auth-protected endpoint returned 403 — the request reached the server but the credentials don't have permission.",
    userActions: [
      {
        step: "Mark this step as auth-required in smoke.yaml",
        detail:
          "Add a `login:` step before the protected goto, OR if the flow legitimately requires login, document this in `.conclave/smoke.yaml` so future runs know to skip / use a test account.",
      },
    ],
    retryHint: "Either provide test-user credentials in smoke.yaml or skip this step in production checks.",
  }),
};

const PATTERNS: ReadonlyArray<Pattern> = Object.freeze([
  SUPABASE_PAUSED,
  ENV_VAR_MISSING,
  DB_MIGRATION_NEEDED,
  API_QUOTA_HIT,
  CONNECTION_REFUSED,
  MISSING_DEP,
  ASSET_404,
  AUTH_MISCONFIG,
]);

// --- Entry point --------------------------------------------------------

/**
 * Classify a failure signal against the known-pattern library.
 * Returns null when no pattern matched (caller can fall back to LLM).
 */
export function classifyByPattern(signal: FailureSignal): FailureDiagnosis | null {
  for (const p of PATTERNS) {
    if (p.match(signal)) {
      const diag = p.diagnose(signal);
      return { ...diag, source: "pattern" };
    }
  }
  return null;
}

/**
 * Default fallback diagnosis when neither patterns nor LLM produce one.
 * The summary is generic but the actionable hint guides the user to
 * do the manual triage themselves.
 */
export function fallbackDiagnosis(signal: FailureSignal): FailureDiagnosis {
  return {
    category: "unknown",
    likelyCause: "unmatched-pattern",
    confidence: 0.3,
    evidence: ["no known pattern matched"],
    summary: `Smoke verification failed at the "${signal.stepKind}" step but Conclave couldn't auto-classify the cause. The error message is included for manual triage.`,
    userActions: [
      {
        step: "Open the failing URL in your browser + inspect the network panel",
        detail:
          "Look for the first failed request — its response status and body usually narrow down whether this is an auth issue, env var, downstream service, or build problem.",
      },
      {
        step: "Check the deploy platform's runtime logs",
        detail: "Vercel: Function Logs. Netlify: Functions tab. Cloudflare: wrangler tail.",
      },
    ],
    retryHint: "Once you've identified + fixed the root cause, push any commit to re-trigger Conclave.",
    source: "fallback",
  };
}

/**
 * Optional LLM-backed classifier — caller wires it to Claude / GPT for
 * unknown patterns. Free tier: don't use this (just fallback).
 *
 * Spec: returns the same FailureDiagnosis shape with confidence ≥ 0.5
 * when LLM produces a coherent answer, or null when LLM declines.
 */
export type LlmClassify = (signal: FailureSignal) => Promise<FailureDiagnosis | null>;

/**
 * Top-level classifier. Tries patterns first, then optional LLM, then
 * the deterministic fallback. Always returns a diagnosis (never null).
 */
export async function classifyFailure(
  signal: FailureSignal,
  opts: { llmClassify?: LlmClassify } = {},
): Promise<FailureDiagnosis> {
  const byPattern = classifyByPattern(signal);
  if (byPattern) return byPattern;
  if (opts.llmClassify) {
    try {
      const llm = await opts.llmClassify(signal);
      if (llm) return { ...llm, source: "llm" };
    } catch {
      // LLM fallback failed — fall through to deterministic fallback.
    }
  }
  return fallbackDiagnosis(signal);
}

/**
 * Render a diagnosis as plain-text Korean (matches Conclave's notifier
 * tone) — for the cycle-end report on PR comment + Telegram.
 */
export function renderDiagnosisKorean(diag: FailureDiagnosis): string {
  const lines: string[] = [];
  lines.push(`❌ Cycle 검증 실패 — ${diag.category} (${diag.likelyCause})`);
  lines.push("");
  lines.push("진단:");
  lines.push(`  ${diag.summary}`);
  lines.push("");
  lines.push("필요한 조치:");
  diag.userActions.forEach((a, i) => {
    lines.push(`  ${i + 1}. ${a.step}`);
    if (a.url) lines.push(`     → ${a.url}`);
    if (a.detail) lines.push(`     ${a.detail}`);
  });
  lines.push("");
  lines.push(`이후: ${diag.retryHint}`);
  return lines.join("\n");
}

/**
 * Same shape, English. Most repos default to English-language SaaS
 * voice; Conclave detects the user's preferred locale from
 * `.conclaverc.json plainSummary.locale` and routes accordingly.
 */
export function renderDiagnosisEnglish(diag: FailureDiagnosis): string {
  const lines: string[] = [];
  lines.push(`❌ Cycle verification failed — ${diag.category} (${diag.likelyCause})`);
  lines.push("");
  lines.push("Diagnosis:");
  lines.push(`  ${diag.summary}`);
  lines.push("");
  lines.push("What to do:");
  diag.userActions.forEach((a, i) => {
    lines.push(`  ${i + 1}. ${a.step}`);
    if (a.url) lines.push(`     → ${a.url}`);
    if (a.detail) lines.push(`     ${a.detail}`);
  });
  lines.push("");
  lines.push(`After fixing: ${diag.retryHint}`);
  return lines.join("\n");
}
