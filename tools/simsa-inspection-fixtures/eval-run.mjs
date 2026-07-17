/**
 * eval-run.mjs — measure the PRODUCTION inspection verdict against fixtures
 * with known ground truth. Design + scoring rules (E1~E4):
 * docs/simsa-inspection-accuracy-eval-2026-07-17.md
 *
 * Per target: anonymous userKey → create project → register website source →
 * visual-checks/run → poll (≤6 min) → record verdict → delete project.
 * Sequential on purpose (one-active-run guard + container courtesy).
 *
 * Usage: node eval-run.mjs            (all targets)
 *        node eval-run.mjs F3 F4     (subset by id)
 * Writes eval-results-<date>.json next to this file.
 */

const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";
const FIXTURES = process.env.FIXTURES_BASE ?? "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
const POLL_MS = 10_000;
const MAX_WAIT_MS = 6 * 60_000;

// expected: "working" → works=true is correct; "broken" → works=false is correct.
// null is a PARTIAL either way (honest uncertainty, not a wrong call).
// nullOk: complex real-world reference where null is a full pass.
const TARGETS = [
  { id: "F1", url: `${FIXTURES}/working-todo`, expected: "working",
    intent: "할 일을 입력하고 추가 버튼을 누르면 목록에 나타나야 한다" },
  { id: "F2", url: `${FIXTURES}/noisy-working`, expected: "working",
    intent: "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다" },
  { id: "F3", url: `${FIXTURES}/potemkin-crm`, expected: "broken",
    intent: "고객 메모를 입력하고 저장을 누르면 저장된 메모가 목록에 나타나야 한다" },
  { id: "F4", url: `${FIXTURES}/js-crash`, expected: "broken",
    intent: "원화 금액을 입력하고 계산하기를 누르면 달러 금액이 보여야 한다" },
  { id: "F5", url: `${FIXTURES}/blank`, expected: "broken",
    intent: "방문자가 이 서비스가 무엇인지 화면에서 알 수 있어야 한다" },
  { id: "R1", url: "https://app.trysimsa.com", expected: "working", nullOk: true,
    intent: "방문자가 이 제품이 무엇인지 이해하고 시작할 수 있어야 한다" },
  // 실제-타겟 확장 (2026-07-17, Bae "실유저 vibe 앱 재확인"): 빠르게 만들어
  // 배포된 실제 작동 앱들 — false(작동 안 함)만 아니면 통과.
  { id: "R2", url: "https://golf-now.vercel.app", expected: "working", nullOk: true,
    intent: "골퍼가 지금 코스가 플레이 가능한지 확인하는 흐름을 시작할 수 있어야 한다" },
  { id: "R3", url: "https://trysimsa.com", expected: "working", nullOk: true,
    intent: "방문자가 이 서비스가 무엇인지 이해하고 시작 버튼을 찾을 수 있어야 한다" },
];

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

async function evalTarget(t) {
  const userKey = `uk_eval_${t.id.toLowerCase()}_${Date.now().toString(36)}`;
  const row = { ...t, works: undefined, decision: undefined, verdict: undefined, oneLine: undefined, runStatus: undefined };

  const created = await api("POST", "/workspace/projects", {
    userKey, title: `inspection eval ${t.id}`,
    idea: "검수 정확도 측정용 프로젝트", understood: null, productSpec: null, items: [], entryPath: "code",
  });
  const projectId = created.json?.project?.id ?? created.json?.id;
  if (!projectId) { row.runStatus = `project_create_failed(${created.status})`; return row; }

  try {
    const src = await api("POST", `/workspace/projects/${projectId}/sources`, {
      userKey, type: "website", reference: t.url, label: `eval ${t.id}`,
    });
    if (src.status >= 300) { row.runStatus = `source_failed(${src.status})`; return row; }

    const run = await api("POST", `/workspace/projects/${projectId}/visual-checks/run`, {
      userKey, locale: "ko", targetUrl: t.url, intent: t.intent,
    });
    const runId = run.json?.check?.id;
    if (!runId || run.json?.dispatched !== true) {
      row.runStatus = `dispatch_failed(${run.status} ${run.json?.note ?? ""})`; return row;
    }

    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const got = await api("GET", `/workspace/projects/${projectId}/visual-checks/${runId}?userKey=${encodeURIComponent(userKey)}`);
      const st = got.json?.check?.status;
      process.stdout.write(`    …${st} (${Math.round((Date.now() - started) / 1000)}s)\r`);
      if (st === "done" || st === "failed") {
        const chk = got.json.check;
        row.runStatus = st;
        row.works = chk.works ?? chk.report?.works ?? null;
        row.decision = chk.decision ?? null;
        row.verdict = chk.report?.verdict ?? null;
        row.oneLine = chk.report?.oneLine ?? null;
        break;
      }
    }
    if (row.runStatus === undefined) row.runStatus = "timeout";
    return row;
  } finally {
    await api("DELETE", `/workspace/projects/${projectId}?userKey=${encodeURIComponent(userKey)}`).catch(() => {});
  }
}

function score(row) {
  if (row.runStatus !== "done") return "no-result";
  const w = row.works;
  if (row.expected === "working") {
    if (w === true) return "correct";
    if (w === null || w === undefined) return row.nullOk ? "correct" : "partial(null)";
    return "FALSE-NEGATIVE"; // working app called broken — the P0-B axis
  }
  if (w === false) return "correct";
  if (w === null || w === undefined) return "partial(null)";
  return "FALSE-POSITIVE"; // broken app called working — Potemkin missed
}

const only = process.argv.slice(2);
const list = only.length ? TARGETS.filter((t) => only.includes(t.id)) : TARGETS;
console.log(`inspection accuracy eval — base=${BASE}\nfixtures=${FIXTURES}\ntargets=${list.map((t) => t.id).join(", ")}\n`);

const results = [];
for (const t of list) {
  console.log(`▶ ${t.id} ${t.url} (expected: ${t.expected})`);
  const row = await evalTarget(t);
  row.score = score(row);
  results.push(row);
  console.log(`    ${row.runStatus} works=${row.works} decision=${row.decision} → ${row.score}`);
  if (row.oneLine) console.log(`    "${String(row.oneLine).slice(0, 110)}"`);
}

const tally = results.reduce((m, r) => ((m[r.score] = (m[r.score] ?? 0) + 1), m), {});
console.log(`\n── 결과 ──`);
for (const r of results) console.log(`${r.id.padEnd(3)} expected=${r.expected.padEnd(7)} works=${String(r.works).padEnd(9)} ${r.score}`);
console.log(`\n집계: ${JSON.stringify(tally)}`);

const stamp = new Date().toISOString().slice(0, 10);
const suffix = only.length ? `-${only.join("-")}` : "";
const outPath = new URL(`./eval-results-${stamp}${suffix}.json`, import.meta.url);
const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify({ base: BASE, fixtures: FIXTURES, date: stamp, results }, null, 2));
console.log(`saved: ${outPath.pathname}`);

const bad = results.filter((r) => r.score.startsWith("FALSE") || r.score === "no-result").length;
process.exit(bad === 0 ? 0 : 1);
