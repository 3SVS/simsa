/**
 * nondev-report.ts — Stage 260A (Simsa 비개발자용 한국어 검수 리포트).
 *
 * Pure, deterministic. Turns the visual completion-check evidence (facts a real browser observed)
 * into a plain-Korean report a non-developer can read: 무엇이 / 왜 / 어떻게 고치나. Developer-only
 * technical strings (e.g. ERR_NAME_NOT_RESOLVED) are kept in a separate `evidence` field, never in
 * the human-facing 무엇/왜/어떻게 text. NO numeric score (Simsa policy §20). Absent evidence → "확인 못 함".
 *
 * NO network / DB / env / LLM — same input always yields the same report.
 */

/** Normalized, tool-agnostic input for one visual completion check. */
export interface VisualCheckInput {
  targetUrl: string;
  intentAnchor: string;
  loadStatus: number | null;
  primaryActionFound: boolean;
  /** Did the flow actually interact (click/type)? */
  interacted: boolean;
  routeAfterClick: string | null;
  routeChanged: boolean;
  consoleErrors: string[];
  networkFailures: string[];
  /** One of the spike's decision states, e.g. "Needs Fix" / "Needs Clarification". */
  decision: string;
  /** Optional per-step flow outcomes (label + whether the step visibly succeeded). */
  steps?: Array<{ label: string; ok: boolean; note?: string }>;
  /** Set by the inspector when the app gates everything behind a login/signup
   *  wall it can't pass. When true (or when the URL clearly lands on a login
   *  page), the check reports "확인 못 함 (로그인 필요)" instead of a false
   *  failure — a login-first app is not a broken app. */
  loginWall?: boolean;
}

/**
 * A login/signup wall blocks the check when the inspector flags it OR the page it
 * lands on is clearly a login screen. Login-first apps (most real apps) must NOT
 * be reported as "failed" just because the checker can't sign in (Bae's report).
 */
export function isLoginBlocked(input: VisualCheckInput): boolean {
  if (input.loginWall === true) return true;
  const LOGIN_URL = /\/(log-?in|sign-?in|sign-?up|auth|account\/login|users\/sign_in)(\b|\/|\?|$)/i;
  return LOGIN_URL.test(input.routeAfterClick ?? "") || LOGIN_URL.test(input.targetUrl ?? "");
}

function loginBlockedFinding(input: VisualCheckInput): NonDevFinding {
  return {
    severity: "info",
    what: "이 앱은 로그인이 필요해서, 로그인 뒤 화면은 확인하지 못했어요.",
    why: "앱을 열자마자 로그인(또는 회원가입) 화면이 나와서, 심사가 로그인 뒤의 실제 기능까지는 들어가지 못했어요. 이건 '앱이 고장났다'는 뜻이 아니에요.",
    how: "로그인 뒤 화면까지 확인하려면 테스트용 계정(아이디·비밀번호)을 알려주세요. 또는 로그인 없이 볼 수 있는 페이지 주소를 알려주시면 그 부분을 확인해드릴게요.",
    evidence: input.routeAfterClick ?? input.targetUrl ?? null,
  };
}

/** One finding, written for a non-developer. `evidence` is the raw developer-only detail. */
export interface NonDevFinding {
  severity: "high" | "medium" | "low" | "info";
  what: string; // 무엇이 문제인가요
  why: string; // 왜 그런가요
  how: string; // 어떻게 고치나요
  evidence: string | null; // 개발자용 기술 정보 (사람 말 아님)
}

export interface NonDevReport {
  title: string;
  target: string;
  intent: string;
  verdict: string; // 한국어 판정
  oneLine: string; // 한 줄 요약
  works: boolean | null; // 작동하나요? (true/false/null=확인못함)
  findings: NonDevFinding[];
  nextSteps: string[];
  notes: string[]; // 한계 안내 (한국어)
}

/** 판정(영문 decision state) → 비개발자용 한국어 라벨. */
const DECISION_KO: Record<string, string> = {
  Ready: "정상 작동해요",
  "Conditionally Ready": "대체로 되지만 확인이 필요해요",
  "Needs Fix": "작동 안 해요 — 고쳐야 해요",
  "Not Verified": "확인 못 했어요",
  "Needs Clarification": "무엇을 확인해야 할지 애매해요",
  "Needs Evidence": "판단할 근거가 부족해요",
  "Needs Expert Review": "전문가 확인이 필요해요",
  "User Acceptance Required": "직접 눈으로 확인이 필요해요",
  "Do Not Build Yet": "아직 만들 때가 아니에요",
  "Not Applicable": "해당 없음",
  "Not Judged": "판단하지 않았어요",
};

export function decisionToKorean(decision: string): string {
  return DECISION_KO[decision] ?? "확인 못 했어요";
}

/** true=작동, false=작동 안 함, null=확인 못 함. */
export function decisionToWorks(decision: string): boolean | null {
  if (decision === "Ready") return true;
  if (decision === "Needs Fix") return false;
  return null;
}

/**
 * 원시 증거(콘솔/네트워크 문자열, 상태코드, 라우트)를 비개발자용 finding 들로 번역.
 * 각 finding 은 무엇/왜/어떻게 를 평범한 한국어로 담고, 원본 기술 문자열은 evidence 에만 둔다.
 */
export function classifyFindings(input: VisualCheckInput): NonDevFinding[] {
  // Login wall: don't report the "no primary action found" / "step failed" false
  // defects — say honestly that the check couldn't get past login, and ask for a
  // test account. (A hard network/server error still surfaces below the wall.)
  if (isLoginBlocked(input)) {
    const findings: NonDevFinding[] = [loginBlockedFinding(input)];
    const netText = input.networkFailures.join(" ");
    const conText = input.consoleErrors.join(" ");
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo|\bHTTP 5\d\d\b|status 5\d\d/i.test(netText + " " + conText)) {
      findings.push({
        severity: "high",
        what: "로그인 화면 자체에서도 서버 오류가 보였어요.",
        why: "로그인 페이지가 뜨긴 했지만, 그 화면이 부르는 서버 요청이 실패했어요.",
        how: "백엔드 주소·상태를 먼저 확인하세요. 로그인 뒤 확인은 테스트 계정을 주시면 이어서 할게요.",
        evidence: firstMatch(input.networkFailures, /ERR_NAME_NOT_RESOLVED|5\d\d/) ?? input.networkFailures[0] ?? null,
      });
    }
    return findings;
  }

  const findings: NonDevFinding[] = [];
  const netText = input.networkFailures.join(" ");
  const conText = input.consoleErrors.join(" ");

  // 1) 백엔드 주소 미해결 (DNS) — golf-now 가 맞은 그 실패.
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(netText + " " + conText)) {
    findings.push({
      severity: "high",
      what: "앱이 데이터를 가져오는 서버 주소를 찾지 못했어요.",
      why: "앱이 연결하려는 백엔드(데이터베이스/API) 주소가 살아있지 않거나 잘못 적혀 있어요. 그래서 목록·검색 결과 같은 실제 내용이 안 떠요.",
      how: "백엔드 주소(예: 데이터베이스 URL 환경변수)가 올바른지, 그 서비스가 켜져 있는지 확인하세요. 서비스가 꺼졌거나 삭제됐다면 다시 켜거나 새 주소로 바꿔야 해요.",
      evidence: firstMatch(input.networkFailures, /ERR_NAME_NOT_RESOLVED|ENOTFOUND/i) ?? firstMatch(input.consoleErrors, /ERR_NAME_NOT_RESOLVED/i),
    });
  }

  // 2) 서버 5xx 오류.
  if (/\bHTTP 5\d\d\b|status 5\d\d/i.test(netText)) {
    findings.push({
      severity: "high",
      what: "서버가 오류를 돌려줬어요.",
      why: "백엔드 코드나 설정에 문제가 있어 요청을 제대로 처리하지 못했어요.",
      how: "서버 로그에서 어떤 요청이 500번대 오류를 냈는지 확인하고, 그 부분의 코드/설정을 고치세요.",
      evidence: firstMatch(input.networkFailures, /5\d\d/),
    });
  }

  // 3) 눌렀는데 깨진/없는 화면으로 이동.
  if (input.interacted && input.routeAfterClick && /\/undefined|\/null|\/404|not-found|error/i.test(input.routeAfterClick)) {
    findings.push({
      severity: "high",
      what: "버튼을 눌렀더니 깨진 화면으로 갔어요.",
      why: "그 버튼이 가리키는 이동 주소가 잘못됐어요.",
      how: "버튼의 링크(이동 주소)가 실제로 존재하는 화면을 가리키도록 고치세요.",
      evidence: input.routeAfterClick,
    });
  }

  // 4) 일반 네트워크 실패 (위 특수 케이스에 안 걸린 경우).
  if (input.networkFailures.length > 0 && findings.every((f) => f.severity !== "high" || !/서버 주소|서버가 오류/.test(f.what))) {
    if (!/ERR_NAME_NOT_RESOLVED|5\d\d/i.test(netText)) {
      findings.push({
        severity: "high",
        what: "필요한 데이터를 불러오지 못했어요.",
        why: "화면에 내용을 채우려는 데이터 요청이 실패했어요.",
        how: "실패한 요청의 주소·권한(키)·서버 상태를 확인하세요.",
        evidence: input.networkFailures[0] ?? null,
      });
    }
  }

  // 5) 콘솔 오류 (네트워크와 별개의 코드 오류).
  if (input.consoleErrors.length > 0 && !/ERR_NAME_NOT_RESOLVED/i.test(conText)) {
    findings.push({
      severity: "medium",
      what: "화면에서 코드 오류가 났어요.",
      why: "자바스크립트 실행 중 문제가 생겼어요. 일부 기능이 안 될 수 있어요.",
      how: "브라우저 콘솔의 오류 메시지를 그대로 복사해 개발 도구(또는 이 리포트의 '개발자용' 칸)를 참고해 고치세요.",
      evidence: input.consoleErrors[0] ?? null,
    });
  }

  // 6) 첫 화면에서 핵심 동작(시작 버튼/검색 등)을 못 찾음.
  if (!input.primaryActionFound && !input.interacted) {
    findings.push({
      severity: "medium",
      what: "처음 화면에서 무엇을 눌러 시작해야 할지 못 찾았어요.",
      why: "의도한 핵심 동작(예: 시작하기, 검색)으로 이어지는 버튼이나 입력창이 눈에 띄지 않았어요.",
      how: "사용자가 가장 먼저 해야 할 행동(버튼·검색창)을 첫 화면에 크고 분명하게 배치하세요.",
      evidence: null,
    });
  }

  // 7) 실패한 플로우 단계.
  for (const s of input.steps ?? []) {
    if (!s.ok) {
      findings.push({
        severity: "medium",
        what: `'${s.label}' 단계가 끝까지 되지 않았어요.`,
        why: s.note ? `이유: ${s.note}` : "그 단계에서 기대한 다음 화면/결과가 나타나지 않았어요.",
        how: "그 단계에서 무엇이 나와야 하는지 정하고, 눌렀을 때 그 결과가 실제로 뜨는지 확인하세요.",
        evidence: s.note ?? null,
      });
    }
  }

  return findings;
}

function firstMatch(arr: string[], re: RegExp): string | null {
  for (const s of arr) if (re.test(s)) return s;
  return null;
}

/** 비개발자용 한국어 리포트 조립. 결정론적, 절대 throw 안 함. 숫자 점수 없음. */
export function buildNonDevReport(input: VisualCheckInput): NonDevReport {
  const findings = classifyFindings(input);
  const loginBlocked = isLoginBlocked(input);
  // Login wall → honest "확인 못 함" (works=null), never a failure verdict, even
  // if the upstream decision said "Needs Fix". A login-first app isn't broken.
  const works = loginBlocked ? null : decisionToWorks(input.decision);
  const verdict = loginBlocked ? "확인 못 했어요 — 로그인이 필요해요" : decisionToKorean(input.decision);

  const oneLine = loginBlocked
    ? "앱을 열자 로그인 화면이 나와서, 로그인 뒤 기능은 아직 확인하지 못했어요. 테스트 계정을 주시면 이어서 확인할게요."
    : works === true
      ? "핵심 흐름이 눈으로 확인한 범위에서 정상 동작했어요."
      : works === false
        ? `핵심 흐름이 지금은 작동하지 않아요. ${findings[0]?.what ?? ""}`.trim()
        : `아직 '작동한다'고 확정하기엔 확인이 더 필요해요. ${findings[0]?.what ?? ""}`.trim();

  const nextSteps: string[] = [];
  if (loginBlocked) {
    nextSteps.push("로그인 뒤 화면까지 확인하려면 테스트용 계정(아이디·비밀번호)을 알려주세요.");
    nextSteps.push("또는 로그인 없이 볼 수 있는 페이지 주소가 있으면 그 주소로 다시 검수해보세요.");
  } else {
    const topFinding = findings[0];
    if (topFinding) {
      nextSteps.push(`가장 급한 것부터: ${topFinding.how}`);
    }
    if (works === null && input.primaryActionFound === false) {
      nextSteps.push("사용자가 처음에 눌러야 할 버튼/검색창을 분명히 만든 뒤 다시 검수하세요.");
    }
    nextSteps.push("고친 뒤 이 검수를 한 번 더 돌려서, 아래 스크린샷이 정상 화면으로 바뀌는지 눈으로 확인하세요.");
  }

  return {
    title: "Simsa 검수 리포트",
    target: input.targetUrl,
    intent: input.intentAnchor,
    verdict,
    oneLine,
    works,
    findings,
    nextSteps,
    notes: [
      "이 검수는 실제 브라우저로 앱을 열어 눈에 보이는 것을 확인한 결과예요. 모든 버그를 찾았다는 뜻은 아니에요.",
      "'무엇이/왜/어떻게'는 사람이 읽기 쉬운 설명이고, 정확한 기술 원인은 각 항목의 '개발자용' 정보에 있어요.",
      "화면 스크린샷을 함께 보면 어디서 막혔는지 눈으로 바로 알 수 있어요.",
    ],
  };
}

/** severity → 비개발자용 한국어 라벨. */
const SEVERITY_KO: Record<NonDevFinding["severity"], string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
  info: "참고",
};

/**
 * 검수 증거를 개발 에이전트(Claude Code, Cursor 등)에 그대로 붙여넣을 수 있는 수정 지시문으로 조립.
 * 결정론적: 같은 입력 → 같은 지시문, LLM 호출 없음. 비개발자용 본문과 달리 원본 기술 문자열
 * (네트워크/콘솔 원문)이 그대로 들어간다 — 받는 쪽이 에이전트이므로. 관찰된 사실만 담고,
 * 증거 밖 추측을 금지하는 작업 규칙을 함께 명시한다.
 */
export function buildAgentFixPrompt(input: VisualCheckInput): string {
  const findings = classifyFindings(input);
  const yn = (b: boolean) => (b ? "예" : "아니오");
  const lines: string[] = [
    "당신은 이 프로젝트의 코드를 수정하는 개발 에이전트입니다.",
    "아래는 Simsa가 실제 브라우저로 이 앱을 열어 관찰한 사실입니다. 여기 적힌 증거만 근거로 진단하고 수정하세요.",
    "증거에 없는 문제를 추측으로 만들어내지 마세요.",
    "",
    "[대상]",
    `- URL: ${input.targetUrl}`,
    `- 검수한 사용자 플로우: ${input.intentAnchor}`,
    `- 판정: ${input.decision} (${decisionToKorean(input.decision)})`,
    "",
    "[브라우저 관찰 사실]",
    `- 첫 화면 HTTP 상태: ${input.loadStatus ?? "관찰 안 됨"}`,
    `- 핵심 동작 요소(버튼/입력) 발견: ${yn(input.primaryActionFound)}`,
    `- 실제 상호작용(클릭/입력) 수행: ${yn(input.interacted)}`,
    `- 상호작용 후 주소: ${input.routeAfterClick ?? "없음"} (주소 변경: ${yn(input.routeChanged)})`,
  ];

  if (input.networkFailures.length) {
    lines.push(`- 네트워크 실패 ${input.networkFailures.length}건:`);
    input.networkFailures.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  } else {
    lines.push("- 네트워크 실패: 없음");
  }
  if (input.consoleErrors.length) {
    lines.push(`- 콘솔 오류 ${input.consoleErrors.length}건:`);
    input.consoleErrors.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  } else {
    lines.push("- 콘솔 오류: 없음");
  }
  const steps = input.steps ?? [];
  if (steps.length) {
    lines.push("- 플로우 단계 결과:");
    for (const s of steps) lines.push(`  - ${s.label}: ${s.ok ? "성공" : "실패"}${s.note ? ` — ${s.note}` : ""}`);
  }

  lines.push("", "[고칠 문제 — 우선순위순]");
  if (findings.length) {
    findings.forEach((f, i) => {
      lines.push(
        `${i + 1}. [${SEVERITY_KO[f.severity]}] ${f.what}`,
        `   - 원인 설명: ${f.why}`,
        `   - 수정 방향: ${f.how}`,
        `   - 증거: ${f.evidence ?? "없음"}`,
      );
    });
  } else {
    lines.push("- 고칠 문제가 관찰되지 않았습니다. 아래 규칙의 검증 절차만 수행해 결과를 보고하세요.");
  }

  lines.push(
    "",
    "[작업 규칙]",
    "- 재현 먼저: 앱을 로컬에서 실행해 위 플로우를 그대로 밟아 같은 실패를 확인한 뒤 수정하세요.",
    "- 최소 수정: 증거가 가리키는 원인만 고치고, 무관한 리팩터링은 하지 마세요.",
    "- 비밀값 금지: API 키·백엔드 주소 같은 환경값을 코드에 하드코딩하지 마세요.",
    "- 검증: 수정 후 같은 플로우에서 네트워크 실패 0건, 콘솔 오류 0건인지 확인하세요.",
    "- 보고: 무엇을/왜/어떻게 바꿨는지와 검증 결과를 5줄 이내로 보고하세요.",
  );

  return lines.join("\n");
}

function esc(s: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(s ?? "").replace(/[&<>"]/g, (c) => map[c] ?? c);
}

/** A screenshot to embed in the visual report (src is relative to the HTML file). */
export interface ReportShot {
  label: string;
  src: string;
}

/**
 * Render a SELF-CONTAINED Korean HTML report a non-developer can double-click and read: verdict at
 * the top, each finding as 무엇/왜/어떻게 cards (with a collapsible 개발자용 detail), the screenshots
 * inline so they can SEE where it broke, an optional flow video, and (when provided) a copy-ready
 * agent fix prompt so the reader can hand the repair to Claude Code/Cursor in one paste.
 *
 * Visual language mirrors the dashboard brand system (parchment surface, stone neutrals, deep
 * oxblood accent, antique gold, hairline borders, no emoji). No numeric score.
 */
export function renderNonDevReportHtml(
  report: NonDevReport,
  shots: ReportShot[] = [],
  videoSrc?: string | null,
  agentPrompt?: string | null,
): string {
  const chip =
    report.works === true
      ? '<span class="chip chip-ok">작동해요</span>'
      : report.works === false
        ? '<span class="chip chip-bad">작동 안 해요</span>'
        : '<span class="chip chip-warn">확인 필요</span>';

  const findingCards = report.findings
    .map(
      (f) => `
    <article class="card finding">
      <header class="finding-head">
        <span class="chip chip-sev-${esc(f.severity)}">${esc(SEVERITY_KO[f.severity])}</span>
      </header>
      <div class="row"><span class="lbl">무엇이 문제인가요</span><span class="val what">${esc(f.what)}</span></div>
      <div class="row"><span class="lbl">왜 그런가요</span><span class="val">${esc(f.why)}</span></div>
      <div class="row"><span class="lbl">어떻게 고치나요</span><span class="val">${esc(f.how)}</span></div>
      ${f.evidence ? `<details><summary>개발자용 기술 정보</summary><code>${esc(f.evidence)}</code></details>` : ""}
    </article>`,
    )
    .join("\n");

  const shotEls = shots
    .map((s) => `<figure><figcaption>${esc(s.label)}</figcaption><img src="${esc(s.src)}" alt="${esc(s.label)}" loading="lazy"/></figure>`)
    .join("\n");

  const nextEls = report.nextSteps.map((n) => `<li>${esc(n)}</li>`).join("");
  const noteEls = report.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  const promptSection = agentPrompt
    ? `
  <h2>바로 고치게 하기</h2>
  <section class="card prompt-card">
    <p class="prompt-desc">개발자가 없어도 됩니다. 아래 지시문을 복사해 AI 개발 도구(Claude Code, Cursor 등)에 붙여넣으면, 이 리포트의 증거를 근거로 수정 작업을 바로 시작합니다.</p>
    <div class="prompt-actions"><button type="button" class="btn-copy" onclick="simsaCopyPrompt(this)">지시문 복사</button></div>
    <pre id="agent-prompt">${esc(agentPrompt)}</pre>
  </section>
  <script>
  function simsaCopyPrompt(btn){
    var pre=document.getElementById("agent-prompt");var txt=pre.textContent;
    function done(){btn.textContent="복사됨";btn.classList.add("copied");setTimeout(function(){btn.textContent="지시문 복사";btn.classList.remove("copied");},2000);}
    function fallback(){var r=document.createRange();r.selectNodeContents(pre);var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand("copy");done();}catch(e){}s.removeAllRanges();}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,fallback);}else{fallback();}
  }
  </script>`
    : "";

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(report.title)}</title>
<style>
  :root{
    --bg:#faf8f3; --surface:#ffffff;
    --ink:#1c1917; --ink-2:#57534e; --ink-3:#78716c; --ink-4:#a8a29e;
    --line:#e7e5e4; --line-soft:#f5f5f4;
    --brand:#5c111c; --brand-hover:#4b0e17; --brand-soft:#faf2f2; --gold:#a9883b;
    --ok-bg:#f0fdf4; --ok-tx:#15803d; --ok-bd:#bbf7d0;
    --bad-bg:#fef2f2; --bad-tx:#b91c1c; --bad-bd:#fecaca;
    --warn-bg:#fffbeb; --warn-tx:#b45309; --warn-bd:#fde68a;
    --info-bg:#f8fafc; --info-tx:#475569; --info-bd:#e2e8f0;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:"Pretendard","Apple SD Gothic Neo",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .wrap{max-width:820px;margin:0 auto;padding:48px 24px 72px}
  .eyebrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line)}
  .wordmark{font-size:12px;font-weight:700;letter-spacing:.16em;color:var(--brand)}
  .wordmark span{color:var(--ink-3);font-weight:500;letter-spacing:.02em;margin-left:8px}
  h1{font-size:24px;font-weight:650;letter-spacing:-.011em;line-height:1.35;margin:22px 0 8px}
  .lead{font-size:15px;color:var(--ink-2);margin:0 0 26px;max-width:62ch}
  .meta{display:grid;grid-template-columns:118px 1fr;row-gap:8px;column-gap:16px;
    background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;font-size:13.5px}
  .meta dt{color:var(--ink-3);margin:0}
  .meta dd{margin:0;word-break:break-all;color:var(--ink)}
  h2{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;letter-spacing:-.011em;color:var(--ink);margin:40px 0 12px}
  h2::after{content:"";flex:1;height:1px;background:var(--line)}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:10px 0}
  .finding-head{display:flex;justify-content:flex-end;margin:-2px 0 6px}
  .chip{display:inline-flex;align-items:center;padding:1px 8px;border-radius:6px;border:1px solid;font-size:12px;font-weight:600;line-height:1.6;white-space:nowrap}
  .chip-ok{background:var(--ok-bg);color:var(--ok-tx);border-color:var(--ok-bd)}
  .chip-bad{background:var(--bad-bg);color:var(--bad-tx);border-color:var(--bad-bd)}
  .chip-warn{background:var(--warn-bg);color:var(--warn-tx);border-color:var(--warn-bd)}
  .chip-sev-high{background:var(--bad-bg);color:var(--bad-tx);border-color:var(--bad-bd)}
  .chip-sev-medium{background:var(--warn-bg);color:var(--warn-tx);border-color:var(--warn-bd)}
  .chip-sev-low,.chip-sev-info{background:var(--info-bg);color:var(--info-tx);border-color:var(--info-bd)}
  .row{display:flex;gap:14px;padding:5px 0}
  .row+.row{border-top:1px solid var(--line-soft)}
  .lbl{flex:0 0 112px;color:var(--ink-3);font-size:12.5px;padding-top:2px}
  .val{flex:1;font-size:14px}
  .val.what{font-weight:600;font-size:14.5px}
  details{margin-top:10px}
  summary{cursor:pointer;color:var(--ink-3);font-size:12.5px}
  summary:hover{color:var(--ink-2)}
  code{display:block;background:#fafaf9;border:1px solid var(--line);padding:9px 11px;border-radius:6px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;margin-top:7px;color:var(--ink-2)}
  figure{margin:14px 0}
  figcaption{font-size:12.5px;color:var(--ink-3);margin-bottom:6px}
  img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}
  video{width:100%;border-radius:8px;border:1px solid var(--line);display:block}
  ul{padding-left:18px;margin:8px 0}
  li{margin:5px 0;color:var(--ink-2);font-size:14px}
  li::marker{color:var(--gold)}
  .prompt-card{padding:16px 18px 14px}
  .prompt-desc{margin:0 0 12px;font-size:13.5px;color:var(--ink-2)}
  .prompt-actions{margin-bottom:10px}
  .btn-copy{appearance:none;border:0;cursor:pointer;background:var(--brand);color:#fff;
    font:inherit;font-size:13px;font-weight:500;padding:7px 14px;border-radius:6px;transition:background-color .15s}
  .btn-copy:hover{background:var(--brand-hover)}
  .btn-copy.copied{background:var(--ok-tx)}
  pre{margin:0;background:#fafaf9;border:1px solid var(--line);border-radius:6px;padding:12px 14px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;color:var(--ink-2);
    white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}
  .empty{color:var(--ink-3);font-size:14px;background:var(--surface);border:1px dashed var(--line);border-radius:8px;padding:18px;text-align:center}
  .foot{color:var(--ink-4);font-size:12px;margin-top:44px;padding-top:14px;border-top:1px solid var(--line)}
</style></head>
<body><div class="wrap">
  <div class="eyebrow"><div class="wordmark">SIMSA<span>검수 리포트</span></div>${chip}</div>
  <h1>${esc(report.verdict)}</h1>
  <p class="lead">${esc(report.oneLine)}</p>
  <dl class="meta">
    <dt>대상</dt><dd>${esc(report.target)}</dd>
    <dt>확인하려던 것</dt><dd>${esc(report.intent)}</dd>
  </dl>

  <h2>무엇을 발견했나요</h2>
  ${report.findings.length ? findingCards : '<p class="empty">특별히 막히는 지점을 찾지 못했어요.</p>'}

  ${shots.length ? `<h2>화면으로 보기</h2>${shotEls}` : ""}
  ${videoSrc ? `<h2>진행 영상</h2><video controls src="${esc(videoSrc)}"></video>` : ""}
  ${promptSection}

  <h2>다음에 해볼 것</h2>
  <ul>${nextEls}</ul>

  <h2>안내</h2>
  <ul>${noteEls}</ul>

  <p class="foot">Simsa 검수 · 실제 브라우저 관찰 기반 · 점수 없음 · 모든 버그를 찾았다는 뜻은 아닙니다.</p>
</div></body></html>`;
}
