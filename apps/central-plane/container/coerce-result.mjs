/**
 * v0.14.4 — pure helpers extracted from server.mjs runJob() so the
 * verdict-coercion + payload-validation + header→env mapping logic is
 * testable without spinning up the HTTP server.
 *
 * runAutofix has FOUR distinct success-shape variants depending on which
 * branch it took:
 *   1. dry-run (review-only): { status: "dry-run", finalVerdict, remainingBlockers, totalCostUsd, ... }
 *   2. autofix approved early: { status: "approved", ... }
 *   3. autofix completed normally: { verdict, reviews, blockers?, ... }
 *   4. autofix bailed: { status: "bailed-no-patches" | "bailed-max-iter" | "errored", reason?, ... }
 *
 * The Worker's /internal/job-done handler expects ONE consistent
 * { verdict, blockers, blockerSummaries, error } envelope. coerceResult
 * normalizes all four variants into that envelope and produces a
 * diagnostic line when verdict can't be determined.
 *
 * No imports — keep this file dependency-free so the container's Node
 * runtime can load it without resolving any paths.
 */

const REQUIRED_RUN_FIELDS = [
  "jobId",
  "repo",
  "prNumber",
  "installationToken",
  "callbackUrl",
  "callbackToken",
];

/**
 * Validate the POST /run payload. Returns { ok: true } when every
 * required field is present, or { ok: false, missing: [...] } so the
 * caller can render a 400 with the specific list.
 */
export function validateRunPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, missing: REQUIRED_RUN_FIELDS };
  }
  const missing = REQUIRED_RUN_FIELDS.filter(
    (k) => payload[k] === undefined || payload[k] === null,
  );
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

/**
 * Map x-* headers to process.env names. Worker forwards LLM keys + the
 * Telegram bot token via headers (instead of the body) so the payload
 * stays small and keys don't end up in any access log that captures
 * bodies. Pure — returns the (env-name, value) pairs the caller should
 * write into process.env.
 */
const HEADER_ENV_MAP = Object.freeze({
  "x-anthropic-key": "ANTHROPIC_API_KEY",
  "x-openai-key": "OPENAI_API_KEY",
  "x-gemini-key": "GEMINI_API_KEY",
  "x-telegram-bot-token": "TELEGRAM_BOT_TOKEN",
});

export function extractHeaderEnv(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [h, e] of Object.entries(HEADER_ENV_MAP)) {
    const v = headers[h];
    if (typeof v === "string" && v.length > 0) out[e] = v;
  }
  return out;
}

/**
 * Stage 268 — simsa_repair job payload validation. A repair job carries the
 * user's OAuth token + the visual check's deterministic agent fix prompt; the
 * container creates a repair branch + draft PR on the user's repo.
 */
const REQUIRED_REPAIR_FIELDS = [
  "jobId",
  "repo",
  "githubToken",
  "branch",
  "agentPrompt",
  "callbackUrl",
  "callbackToken",
];

export function validateRepairPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, missing: REQUIRED_REPAIR_FIELDS };
  }
  const missing = REQUIRED_REPAIR_FIELDS.filter(
    (k) => payload[k] === undefined || payload[k] === null || payload[k] === "",
  );
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

/**
 * auto_fix 성숙 (2026-07-20) — classify a `git clone` failure as an ACCESS
 * problem (private repo the token can't see / token lacking write) vs any
 * other failure. Access-shaped failures get the stable `repo_access_denied:`
 * error prefix so the Worker stores it verbatim and the dashboard can render
 * the non-dev guidance card ("저장소가 비공개예요") instead of a raw git dump.
 *
 * Pure string classification — git over https answers a private repo the
 * token cannot see with 403/404-shaped auth errors, never a clean "private".
 */
const CLONE_ACCESS_PATTERN =
  /(403|404 not found|access denied|write access to repository not granted|authentication failed|repository (?:'[^']*' )?not found|could not read username|permission denied)/i;

export function classifyCloneError(stderrText) {
  return CLONE_ACCESS_PATTERN.test(String(stderrText ?? "")) ? "access_denied" : "other";
}

/**
 * auto_fix 정직성 (2026-07-20) — turn the attemptAutoFix diagnosis object into
 * (a) `modeReason` for the repair-done callback (in-band observability: WHY
 * did this fall back to brief_only — container stdout is unreachable) and
 * (b) an optional honest note appended to the brief-only DRAFT PR body when
 * code files were skipped for size (the single-big-index.html vibe-app class:
 * apply-walmart 실측 — index.html 389KB > 200KB 상한 → 워커가 앱의 유일한
 * 실코드를 본 적도 없는데 사용자에겐 그냥 "지시서 PR"로만 보였다).
 *
 * Pure. diag: { skippedOversize: [{path, bytes}], reason: string|null }.
 */
export function buildBriefOnlyDiagnosis(diag) {
  const skipped = Array.isArray(diag?.skippedOversize) ? diag.skippedOversize : [];
  const reason =
    typeof diag?.reason === "string" && diag.reason ? diag.reason : "worker_no_applicable_fix";
  const kb = (b) => `${Math.round(b / 1024)}KB`;
  const list = skipped.map((s) => `${s.path}(${kb(s.bytes)})`).join(", ");
  const modeReason = skipped.length ? `${reason}; oversize_skipped: ${list}` : reason;
  const prNote = skipped.length
    ? [
        "> **자동수정을 시도하지 못한 파일이 있어요.**",
        `> ${skipped.map((s) => `\`${s.path}\`(${kb(s.bytes)})`).join(", ")} — 자동수정 크기 한도(200KB)를 넘는 파일이라 워커가 열어보지 못했어요.`,
        "> 이 지시서(`SIMSA-FIX-BRIEF.md`)를 쓰시는 코딩 에이전트에게 그대로 전달하면 고칠 수 있어요.",
      ].join("\n")
    : null;
  return { modeReason, prNote };
}

/**
 * Stage 268 — strip a secret from a message before it travels anywhere
 * (callback body, logs). Pure; no-op when the secret is empty.
 */
export function redactSecret(message, secret) {
  const text = String(message ?? "");
  if (typeof secret !== "string" || secret.length === 0) return text;
  return text.split(secret).join("[REDACTED]");
}

/**
 * Stage 268 — deterministic repair-PR content (no LLM). The v1 repair job
 * does NOT auto-apply code changes: it commits the agent fix prompt as
 * SIMSA-FIX-BRIEF.md on a repair branch and opens a DRAFT PR so any agent or
 * human can execute the brief. The PR body says so explicitly — honest
 * boundaries over pretended fixes.
 *
 * Returns { title, body, briefFileName, briefContent } — all strings, all
 * derived only from the payload (never from env/secrets).
 */
export function buildRepairPrContent(payload) {
  const intent = typeof payload?.intent === "string" && payload.intent.trim()
    ? payload.intent.trim()
    : "핵심 기능 점검";
  const shortIntent = intent.length > 60 ? `${intent.slice(0, 57)}...` : intent;
  const decision = typeof payload?.decision === "string" && payload.decision ? payload.decision : "Not Judged";
  const targetUrl = typeof payload?.targetUrl === "string" ? payload.targetUrl : "";
  const visualCheckId = typeof payload?.visualCheckId === "string" ? payload.visualCheckId : "";
  const agentPrompt = String(payload?.agentPrompt ?? "");
  const envCause = payload?.envCause === true;

  const title = `Simsa 수리 시작점: ${shortIntent}`;

  const bodyLines = [
    "## Simsa 시각 검수 수리 브리프",
    "",
    "Simsa가 실제 브라우저로 앱을 열어 확인한 결과 문제가 발견되어, 수리 시작점 브랜치를 만들었습니다.",
    "",
    `- 검수 대상: ${targetUrl || "(기록 없음)"}`,
    `- 판정: ${decision}`,
    ...(visualCheckId ? [`- 검사 ID: \`${visualCheckId}\``] : []),
    "",
    "> **주의: 이 PR에는 자동 적용된 코드 수정이 없습니다.**",
    "> 아래 수리 지시서(SIMSA-FIX-BRIEF.md와 동일)를 개발 에이전트나 개발자가 이 브랜치에서 실행해 주세요.",
    "",
  ];
  if (envCause) {
    bodyLines.push(
      "> **환경 원인 가능성:** 증거에 백엔드 주소가 응답하지 않는 패턴(DNS/연결 실패)이 포함되어 있습니다.",
      "> 코드 수정만으로 완전히 해결되지 않을 수 있어요 — 환경 변수(백엔드 주소 등) 설정도 함께 확인하세요.",
      "",
    );
  }
  bodyLines.push("### 수리 지시서", "", "```", agentPrompt, "```", "");

  const briefContent = [
    "# SIMSA-FIX-BRIEF",
    "",
    "이 파일은 Simsa 시각 검수가 생성한 수리 지시서입니다.",
    "이 브랜치에서 아래 지시서를 그대로 실행한 뒤, 이 파일은 삭제해도 됩니다.",
    "",
    ...(envCause
      ? [
          "> 환경 원인 가능성: 코드 수정만으로 완전히 해결되지 않을 수 있어요 — 환경 변수 설정도 확인하세요.",
          "",
        ]
      : []),
    "---",
    "",
    agentPrompt,
    "",
  ].join("\n");

  return {
    title,
    body: bodyLines.join("\n"),
    briefFileName: "SIMSA-FIX-BRIEF.md",
    briefContent,
  };
}

const VERDICT_FROM_STATUS = Object.freeze({
  approved: "approve",
  merged: "approve",
  // dry-run with no finalVerdict means the council reached no consensus —
  // surface as rework so the user knows to push fixes.
  "dry-run": "rework",
  "bailed-no-patches": "rework",
  "bailed-max-iter": "rework",
  errored: "rework",
});

/**
 * Pull a normalized verdict + blocker count + top-N summaries + a
 * diagnostic line out of whatever shape runAutofix returned.
 *
 * Inputs:
 *   result    — the object runAutofix returned (any of the 4 shapes)
 *   exitCode  — the runAutofix return code (0 = clean run)
 *
 * Output:
 *   {
 *     verdict:           "approve" | "rework" | "reject" | undefined,
 *     blockers:          number   | undefined,
 *     blockerSummaries:  Array<{category,severity,message,file,line}> | undefined,
 *     diagnosticError:   string   | undefined,   // populated when verdict === undefined
 *     debugLine:         string                    // structured one-line summary for logs
 *   }
 *
 * `verdict === undefined` is treated as a real error condition: the
 * caller posts the diagnosticError back to the Worker so the row's
 * error_message captures what cli actually returned (instead of a
 * silent "done + null verdict").
 */
export function coerceResult(result, exitCode) {
  const safe = result && typeof result === "object" ? result : {};
  const rawVerdict =
    "verdict" in safe ? safe.verdict :
    "finalVerdict" in safe ? safe.finalVerdict :
    undefined;
  const rawStatus = "status" in safe ? safe.status : undefined;

  const verdict =
    typeof rawVerdict === "string" && (rawVerdict === "approve" || rawVerdict === "rework" || rawVerdict === "reject")
      ? rawVerdict
      : (typeof rawStatus === "string" && rawStatus in VERDICT_FROM_STATUS)
        ? VERDICT_FROM_STATUS[rawStatus]
        : undefined;

  const blockerArray = Array.isArray(safe.remainingBlockers)
    ? safe.remainingBlockers
    : Array.isArray(safe.blockers)
      ? safe.blockers
      : null;
  const blockers = blockerArray ? blockerArray.length : undefined;

  const blockerSummaries = blockerArray
    ? blockerArray.slice(0, 8).map((b) => ({
        category: typeof b?.category === "string" ? b.category : "uncategorized",
        severity: typeof b?.severity === "string" ? b.severity : "minor",
        message: typeof b?.message === "string" ? b.message.slice(0, 240) : "",
        file:
          typeof b?.filePath === "string"
            ? b.filePath
            : typeof b?.path === "string"
              ? b.path
              : "",
        line: typeof b?.line === "number" ? b.line : undefined,
      }))
    : undefined;

  const reasonSnippet =
    typeof safe.reason === "string" ? safe.reason.slice(0, 200) : "";
  const itersCount = Array.isArray(safe.iterations) ? safe.iterations.length : 0;
  const totalCost = typeof safe.totalCostUsd === "number" ? safe.totalCostUsd : 0;
  const keyList = Object.keys(safe).join(",");

  const debugLine =
    `result keys=[${keyList}] status=${rawStatus} verdict=${rawVerdict} ` +
    `reason=${reasonSnippet.slice(0, 80)} iters=${itersCount} cost=$${totalCost}`;

  // Pack the diagnostic only when we couldn't produce a real verdict —
  // otherwise we leak noise into the success row's error_message.
  const diagnosticError =
    verdict === undefined
      ? `cli result: status=${rawStatus} reason=${reasonSnippet || "(none)"} iters=${itersCount} cost=$${totalCost} keys=[${keyList}] exitCode=${exitCode}`
      : undefined;

  return {
    verdict,
    blockers,
    blockerSummaries,
    diagnosticError,
    debugLine,
  };
}
