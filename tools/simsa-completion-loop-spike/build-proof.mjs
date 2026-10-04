#!/usr/bin/env node
/**
 * build-proof.mjs — 문 (a) 빌드 라이브 실증 3종 러너 (2026-10-04).
 *
 * 전제(운영 절차 — PR 본문 런북):
 *   1) central-plane 배포(이 PR 포함)  2) wrangler.toml BUILD_ENABLED = "staff" + deploy(별도 승인)
 *   3) SIMSA_STAFF_USER_KEY = plan-grant 워크플로로 staff 부여한 키(로컬 .env.staff.local)
 *   → node build-proof.mjs [--only ABC] [--keep] [--budget 0.5] [--timeout-min 50] [--base <central>] [--out file]
 *   4) 3/3 통과 → BUILD_ENABLED = "on"(별도 승인)
 *
 * 실증(docs/simsa-door-done-definitions-2026-09-30.md 문 (a) ②, HANDOFF-2026-10-01 §5-2):
 *   A 깨진 기획 → failed(building) · 배포 없음
 *   B 정상 기획 → done · https://<slug>.simsa.page 200(/api/health ok + 페이지 <script src>)
 *   C 예산 $0.5 → failed(budget) (예산 재정의는 서버가 장비 티어만 받는다)
 *
 * 비용: 빌드마다 LLM(잡 예산 상한 $10 · C는 $0.5)·컨테이너·D1·저장소. 장비 키 하루 빌드 상한 50.
 * 끝나면 만든 프로젝트를 지운다(--keep이면 남김) — 프로젝트 삭제가 호스팅 자원(공개 Worker·D1·저장소)도 정리한다.
 * 결과: --out JSON(증거) + 한 줄 요약. 키는 찍지 않는다.
 */
import { writeFileSync } from "node:fs";
import { staffUserKey } from "./lib/staff-key.mjs";
import { brokenSpec, evaluateProof, goodSpec, isTerminal, parseArgs, summaryLine } from "./lib/build-proof.mjs";

const args = parseArgs(process.argv.slice(2));
const USER_KEY = staffUserKey();
if (!USER_KEY) {
  console.error("SIMSA_STAFF_USER_KEY가 필요합니다(plan-grant 워크플로로 staff 부여한 키).");
  process.exit(2);
}
const B = args.base;
const STAMP = Date.now().toString(36);

async function api(method, path, body, timeoutMs = 60000) {
  const res = await fetch(`${B}${path}`, {
    method,
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkSite(url) {
  const base = url.replace(/\/+$/, "");
  const out = { healthOk: false, pageStatus: 0, pageHasScript: false };
  try {
    const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(20000) });
    const hj = await h.json().catch(() => null);
    out.healthOk = h.status === 200 && hj?.ok === true;
    const p = await fetch(`${base}/`, { signal: AbortSignal.timeout(20000) });
    out.pageStatus = p.status;
    out.pageHasScript = /<script\b[^>]*\bsrc\s*=/i.test(await p.text());
  } catch (err) {
    out.error = String(err).slice(0, 200);
  }
  return out;
}

async function runOne(kind) {
  const title = kind === "A" ? `(주)테스트 깨진 기획 ${STAMP}` : kind === "B" ? `(주)테스트 동네빵집 예약 ${STAMP}` : `(주)테스트 예산 정지 ${STAMP}`;
  const spec = kind === "A" ? brokenSpec(title) : goodSpec(title);
  const rec = { kind, title, projectId: null, jobId: null, job: null, site: null, steps: [] };
  const created = await api("POST", "/workspace/projects", { userKey: USER_KEY, title, idea: spec.brief.oneLine, understood: {}, productSpec: {}, items: [], entryPath: "idea" });
  rec.steps.push({ step: "create_project", status: created.status });
  if (created.status !== 200 || !created.json?.id) return { ...rec, ...evaluateProofSafe(kind, null), detail: created.text };
  rec.projectId = created.json.id;
  const put = await api("PUT", `/workspace/projects/${encodeURIComponent(rec.projectId)}/dev-spec`, { userKey: USER_KEY, devSpec: spec });
  rec.steps.push({ step: "put_dev_spec", status: put.status, error: put.json?.error ?? null });
  if (put.status !== 200) return { ...rec, ...evaluateProofSafe(kind, null), detail: put.text };
  const start = await api("POST", `/workspace/projects/${encodeURIComponent(rec.projectId)}/build`, {
    userKey: USER_KEY,
    locale: "ko",
    ...(kind === "C" ? { budgetUsd: args.budgetC } : {}),
  });
  rec.steps.push({ step: "start_build", status: start.status, error: start.json?.error ?? null, budgetUsd: start.json?.job?.budgetUsd ?? null });
  if (!start.json?.job?.id) return { ...rec, ...evaluateProofSafe(kind, null), detail: start.text };
  rec.jobId = start.json.job.id;
  if (kind === "C" && start.json.job.budgetUsd !== args.budgetC) {
    return { ...rec, pass: false, reason: `budget_override_not_applied:${start.json.job.budgetUsd}` };
  }
  const deadline = Date.now() + args.timeoutMin * 60_000;
  let job = null;
  while (Date.now() < deadline) {
    const g = await api("GET", `/workspace/projects/${encodeURIComponent(rec.projectId)}/build-jobs/${encodeURIComponent(rec.jobId)}?userKey=${encodeURIComponent(USER_KEY)}`).catch(() => null);
    job = g?.json?.job ?? job;
    if (isTerminal(job)) break;
    await sleep(15_000);
  }
  rec.job = job ? { status: job.status, failedStage: job.failedStage, error: String(job.error ?? "").slice(0, 300), deployedUrl: job.deployedUrl, spentUsd: job.spentUsd, budgetUsd: job.budgetUsd, slug: job.slug } : null;
  if (kind === "B" && job?.status === "done" && job.deployedUrl) rec.site = await checkSite(job.deployedUrl);
  return { ...rec, ...evaluateProofSafe(kind, rec.job, rec.site) };
}

function evaluateProofSafe(kind, job, site) {
  return evaluateProof(kind, job, site);
}

const results = [];
for (const kind of args.only) {
  console.log(`▶ ${kind} 시작`);
  const r = await runOne(kind).catch((err) => ({ kind, pass: false, reason: `runner_error:${String(err).slice(0, 160)}` }));
  console.log(`  ${kind} ${r.pass ? "✅" : "❌"} ${r.reason}`);
  results.push(r);
}

if (!args.keep) {
  for (const r of results) {
    if (!r.projectId) continue;
    const d = await api("DELETE", `/workspace/projects/${encodeURIComponent(r.projectId)}?userKey=${encodeURIComponent(USER_KEY)}`).catch(() => null);
    r.deleted = d?.status ?? 0;
  }
}

writeFileSync(new URL(args.out, import.meta.url), JSON.stringify({ at: new Date().toISOString(), base: B, results }, null, 2));
console.log(summaryLine(results));
process.exit(results.every((r) => r.pass) ? 0 : 1);
