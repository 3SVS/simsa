/**
 * corpus-run.mjs — 실유저(Bae 포트폴리오) 앱 코퍼스 검수 (2026-07-19).
 *
 * 백로그 "실유저 코퍼스 검수 재실증": 픽스처가 아니라 실제로 만들어 배포된
 * 앱들에 프로덕션 Simsa 검수를 돌려, 작동하는 실앱을 false(작동 안 함)로
 * 오판하지 않는지 실측한다. 채점은 eval-run과 동일 — 실앱은 not-false면 통과
 * (자동 검수 상한=UAR). API 계약은 en-report-smoke.mjs와 동일 경로.
 *
 * Usage: node corpus-run.mjs C1 C2 ...   (무인자 = 전체)
 */
const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";
const POLL_MS = 10_000;
const MAX_WAIT_MS = 5 * 60_000;

const TARGETS = [
  { id: "C1", url: "https://golf-now.vercel.app", label: "golf-now (개인 유틸)",
    intent: "골퍼가 지금 코스가 플레이 가능한지 확인하는 흐름을 시작할 수 있어야 한다" },
  { id: "C2", url: "https://ssf2026.com", label: "ssf2026 (행사 플랫폼)",
    intent: "방문자가 행사가 무엇인지 이해하고 참가 정보를 찾을 수 있어야 한다" },
  { id: "C3", url: "https://www.kisf.kr", label: "kisf (행사 플랫폼)",
    intent: "방문자가 행사 소개를 보고 다음 행동(참가/문의)을 찾을 수 있어야 한다" },
  { id: "C4", url: "https://www.3svs.com", label: "3svs (회사 사이트)",
    intent: "방문자가 회사가 무엇을 하는지 이해하고 연락 방법을 찾을 수 있어야 한다" },
];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

const args = process.argv.slice(2);
const targets = args.length ? TARGETS.filter((t) => args.includes(t.id)) : TARGETS;
const results = [];

for (const t of targets) {
  const ukey = `corpus_${t.id}_${Date.now().toString(36)}`;
  process.stdout.write(`\n▶ ${t.id} ${t.label} ${t.url}\n`);

  const created = await api("POST", "/workspace/projects", {
    userKey: ukey, title: t.label, idea: t.intent,
    understood: null, productSpec: null, items: [], entryPath: "code",
  });
  const pid = created.json?.project?.id ?? created.json?.id;
  if (!pid) { results.push({ ...t, outcome: "setup_failed", detail: JSON.stringify(created.json).slice(0, 160) }); continue; }

  const src = await api("POST", `/workspace/projects/${pid}/sources`, {
    userKey: ukey, type: "website", reference: t.url, label: t.label,
  });
  if (src.status >= 300) { results.push({ ...t, outcome: "source_failed", detail: JSON.stringify(src.json).slice(0, 160) }); continue; }

  const run = await api("POST", `/workspace/projects/${pid}/visual-checks/run`, {
    userKey: ukey, locale: "ko", targetUrl: t.url, intent: t.intent,
  });
  const runId = run.json?.check?.id;
  if (!runId || run.json?.dispatched !== true) {
    results.push({ ...t, outcome: "dispatch_failed", detail: `${run.status} ${JSON.stringify(run.json).slice(0, 160)}` });
    continue;
  }

  const started = Date.now();
  let detail = null;
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const got = await api("GET", `/workspace/projects/${pid}/visual-checks/${runId}?userKey=${encodeURIComponent(ukey)}`);
    const st = got.json?.check?.status;
    process.stdout.write(`    …${st} (${Math.round((Date.now() - started) / 1000)}s)\n`);
    if (st === "done" || st === "failed") { detail = got.json.check; break; }
  }
  if (!detail) { results.push({ ...t, outcome: "timeout" }); continue; }

  const r = detail.report ?? {};
  const works = detail.works ?? r.works ?? null;
  const decision = detail.decision ?? r.decision ?? r.verdict ?? "?";
  const oneLine = (r.oneLine ?? "").slice(0, 140);
  const outcome = detail.status === "failed" ? "run_error" : works === false ? "FALSE(오판?)" : "ok(not-false)";
  console.log(`    status=${detail.status} works=${works} decision=${decision} → ${outcome}`);
  if (oneLine) console.log(`    "${oneLine}"`);
  results.push({ ...t, outcome, works, decision, oneLine });

  await api("DELETE", `/workspace/projects/${pid}?userKey=${encodeURIComponent(ukey)}`).catch(() => {});
}

console.log("\n── 코퍼스 결과 ──");
for (const r of results) {
  console.log(`${r.id} ${r.label}: ${r.outcome} (decision=${r.decision ?? "-"})${r.detail ? ` [${r.detail}]` : ""}`);
}
const bad = results.filter((r) => !r.outcome.startsWith("ok"));
console.log(`\n${results.length - bad.length}/${results.length} not-false`);
