/**
 * en-report-smoke.mjs — live proof that an inspection report renders in English.
 *
 * Closes the T1 carryover ("리포트 EN 라이브 렌더"), which was recorded as needing
 * an authenticated account. It never did: every workspace route gates on the
 * browser-local `userKey` string, not on a login — so this runs anonymously.
 * What actually blocked T1 was a code gap (locale was never plumbed into the
 * inspector; the container defaulted to "ko"), fixed in #335.
 *
 * Flow:  create project → register a website source → run inspection (locale=en)
 *        → poll → assert the report PROSE is English → delete → verify gone.
 *
 * The delete at the end also exercises the R2 prefix sweep from #336.
 *
 * Usage:  node tools/simsa-completion-loop-spike/en-report-smoke.mjs
 *         node tools/simsa-completion-loop-spike/en-report-smoke.mjs --keep
 *
 * Uses fetch (never inline curl -d): Git Bash on Windows mangles non-ASCII
 * bodies into mojibake, which has cost us a wasted debugging round before.
 */

const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";
const TARGET = process.env.SIMSA_SMOKE_TARGET ?? "https://app.trysimsa.com";
const KEEP = process.argv.includes("--keep");
const USER_KEY = `uk_smoke_en_${Date.now().toString(36)}`;
const POLL_MS = 10_000;
const MAX_WAIT_MS = 6 * 60_000;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const hangul = (s) => (String(s).match(/[가-힣]/g) ?? []).length;

console.log(`EN report smoke — base=${BASE} target=${TARGET}\nuserKey=${USER_KEY}\n`);

// 1. Create the project (server mirror — same endpoint the dashboard uses).
const created = await api("POST", "/workspace/projects", {
  userKey: USER_KEY,
  title: "EN report smoke",
  idea: "A smoke project that verifies the inspection report renders in English.",
  understood: null, productSpec: null, items: [],
  entryPath: "code",
});
const projectId = created.json?.project?.id ?? created.json?.id;
ok("project created", created.status < 300 && !!projectId, `status=${created.status} body=${JSON.stringify(created.json).slice(0, 200)}`);
if (!projectId) { console.log("\nAborting — no project id."); process.exit(1); }
console.log(`  projectId=${projectId}`);

// 2. Register the inspection target as a website source. The Worker refuses to
//    inspect any URL that doesn't origin-match a registered source.
const src = await api("POST", `/workspace/projects/${projectId}/sources`, {
  userKey: USER_KEY, type: "website", reference: TARGET, label: "smoke target",
});
ok("website source registered", src.status < 300, `status=${src.status} ${JSON.stringify(src.json).slice(0, 160)}`);

// 3. Run the inspection asking for an ENGLISH report — the field #335 added.
const run = await api("POST", `/workspace/projects/${projectId}/visual-checks/run`, {
  userKey: USER_KEY, locale: "en", targetUrl: TARGET,
  intent: "A visitor should be able to see what this product does and start using it",
});
const runId = run.json?.check?.id;
ok("inspection queued", run.status < 300 && !!runId, `status=${run.status} ${JSON.stringify(run.json).slice(0, 200)}`);
ok("dispatched to the cloud runner", run.json?.dispatched === true, `note=${run.json?.note ?? "(none)"}`);
if (!runId) {
  console.log("\nAborting — no run id.");
  if (!KEEP) await api("DELETE", `/workspace/projects/${projectId}?userKey=${encodeURIComponent(USER_KEY)}`);
  process.exit(1);
}

// 4. Poll to completion.
const started = Date.now();
let detail = null;
while (Date.now() - started < MAX_WAIT_MS) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  const got = await api("GET", `/workspace/projects/${projectId}/visual-checks/${runId}?userKey=${encodeURIComponent(USER_KEY)}`);
  const st = got.json?.check?.status;
  process.stdout.write(`  …${st} (${Math.round((Date.now() - started) / 1000)}s)\n`);
  if (st === "done" || st === "failed") { detail = got.json.check; break; }
}
ok("inspection finished", !!detail && detail.status === "done", detail ? `status=${detail.status}` : "timed out");

// 5. THE POINT: is the report prose actually English?
//
// Order matters. "contains no Korean" passes trivially on an empty report, so
// the report must be proven substantive FIRST — otherwise a failed inspection
// reads as a green locale result, which is the exact kind of vacuous pass that
// let the original bug ship.
const r = detail?.report;
const prose = r ? JSON.stringify({ verdict: r.verdict, oneLine: r.oneLine, findings: r.findings, nextSteps: r.nextSteps }) : "";
const substantive = !!r && !!r.verdict && !!r.oneLine && prose.length > 80;
ok("report is substantive (guards the assertion below from passing vacuously)", substantive,
  detail ? `status=${detail.status} error=${JSON.stringify(detail.error ?? detail.errorJson ?? null)?.slice(0, 200)} report=${prose.slice(0, 120)}` : "no run detail");

if (substantive) {
  console.log(`\n  verdict : ${r.verdict}`);
  console.log(`  oneLine : ${String(r.oneLine).slice(0, 120)}`);

  // Assert only on Simsa's OWN prose. Findings interpolate the target page's
  // real content — a button's label, a console message, the text Playwright was
  // waiting for — and when the inspected app is Korean, that content is
  // legitimately Korean. It's evidence quoted verbatim; translating it would be
  // a lie. So verdict / oneLine / nextSteps / notes must be pure English, while
  // findings are checked at the template level (see below), not char-by-char.
  const ownProse = JSON.stringify({ verdict: r.verdict, oneLine: r.oneLine, nextSteps: r.nextSteps, notes: r.notes });
  const koOwn = hangul(ownProse);
  console.log(`  hangul in Simsa's own prose (verdict/oneLine/nextSteps/notes): ${koOwn}`);
  ok("Simsa's own report prose is English (locale=en honoured)", koOwn === 0, `${koOwn} Hangul chars in own prose`);

  // Finding templates interpolate the target's own content (a CTA label, a
  // console message) inside quotes, and separating template from content with a
  // regex is defeated by nested quotes. So instead of char-counting, assert the
  // exact Korean TEMPLATE TOKENS this fix localized are gone — that proves the
  // planner/executor prose turned English without falsely flagging the target's
  // quoted Korean content. These are the strings that leaked before #340.
  const KO_TEMPLATE_TOKENS = [
    "누르기", "화면 확인", "입력하기", "검색 결과 화면", "첫 화면 확인",
    "동작 실패", "안전하지 않아 건너뜀", "검색 결과/내용이 확인되지 않음", "데이터 요청 실패가 관찰됨",
    "작동", "확인 못", "필요한 데이터를 불러오지 못",
  ];
  const leakedTokens = KO_TEMPLATE_TOKENS.filter((tok) => prose.includes(tok));
  console.log(`  Korean template tokens still present: ${leakedTokens.length ? leakedTokens.join(", ") : "none"}`);
  ok("no Korean template tokens leak (planner/executor/report prose all EN)", leakedTokens.length === 0, leakedTokens.join(", "));

  const koTotal = hangul(prose);
  console.log(`  (total hangul incl. legitimately-quoted target content: ${koTotal} — expected >0 for a Korean target app)`);
} else {
  console.log("\n  (locale assertion skipped — no substantive report to judge)");
}

// 6. Delete — also exercises the #336 R2 prefix sweep.
if (!KEEP) {
  const del = await api("DELETE", `/workspace/projects/${projectId}?userKey=${encodeURIComponent(USER_KEY)}`);
  ok("project deleted", del.status < 300, `status=${del.status}`);
  const after = await api("GET", `/workspace/projects/${projectId}/visual-checks/${runId}?userKey=${encodeURIComponent(USER_KEY)}`);
  ok("run is gone after delete", after.status === 404 || after.json?.ok === false, `status=${after.status}`);
} else {
  console.log(`\n  --keep: project ${projectId} left in place.`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
