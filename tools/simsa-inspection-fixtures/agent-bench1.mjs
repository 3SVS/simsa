#!/usr/bin/env node
/**
 * agent-bench1.mjs — 벤치마크 #1(동네 미용실 6앱)을 **프로덕션 API**로 잰다(머지·마이그레이션 0075·배포·컨테이너 이미지 뒤).
 * 로컬 브랜치 실측은 agent-bench1-local.mjs. 이 파일은 실제 사용자가 대시보드에서 하는 흐름을 API로 그대로 밟는다:
 *
 *   새 프로젝트(주소 문) → 주소 연결 → infer-intent(의도 추론) → "맞나요?"(사전 등록 프롬프트 원문만 아는 사용자 흉내)
 *   → 확인 항목 미러 → dev-spec/generate(역추론 지시서, 확인 id 동봉) → visual-checks/run {engine:"agent"} → 완료까지 대기
 *
 * 로그인 정보는 주지 않는다(Lovable /admin은 "로그인 필요"로 끝나야 정답). 동시 실행 ≤2(컨테이너 용량).
 * 필요: SIMSA_STAFF_USER_KEY(장비 키 — tools/simsa-completion-loop-spike/.env.staff.local, 출력·기록 금지),
 *       "맞나요?" 흉내용 LLM 키(OPENAI_API_KEY 또는 ANTHROPIC_API_KEY — 없으면 멈춘다).
 * 사용: node tools/simsa-inspection-fixtures/agent-bench1.mjs [--only=claude] [--base=https://…]
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPS, REGISTERED_PROMPT, confirmFromPrompt, score } from "./agent-bench1-local.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const BASE = arg("base", process.env.SIMSA_API_BASE || "https://conclave-ai.seunghunbae.workers.dev").replace(/\/$/, "");
const USER_KEY = process.env.SIMSA_STAFF_USER_KEY;

async function api(path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(180_000) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });

async function benchProd(app) {
  const t0 = Date.now();
  const id = `proj_bench1_${app.id}_${Date.now().toString(36)}`;
  const out = { app: app.id, url: app.url, project: id, startedKst: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16), expected: app.expected };
  const created = await post("/workspace/projects", { id, userKey: USER_KEY, title: `벤치마크1 ${app.id}`, idea: "", understood: {}, productSpec: {}, items: [], entryPath: "code" });
  if (created.status >= 300) return { ...out, error: `project ${created.status} ${created.body.error ?? ""}` };
  await post(`/workspace/projects/${id}/sources`, { userKey: USER_KEY, type: "website", reference: app.url, label: "앱" });
  const inf = await post(`/workspace/projects/${id}/infer-intent`, { userKey: USER_KEY, locale: "ko" });
  const draft = inf.body.inferred;
  out.inference = { reason: inf.body.reason ?? null, items: draft?.items?.length ?? 0, summary: draft?.understood?.summary };
  if (!draft?.items?.length) return { ...out, error: `infer_intent:${inf.body.reason ?? inf.status}` };
  // 카드가 저장하는 그대로: 한 줄 = 사용자가 쓴 문장, 항목 = 체크 유지 + "빠진 것"으로 직접 적은 항목(user_N).
  const card = await confirmFromPrompt(draft.items, []);
  out.confirm = card;
  const items = [...draft.items, ...card.added.map(({ why: _w, ...rest }) => ({ ...rest, status: "not_started" }))];
  const productSpec = { ...(draft.productSpec ?? {}), ...(card.oneLine ? { oneLine: card.oneLine } : {}) };
  await post("/workspace/projects", { id, userKey: USER_KEY, title: `벤치마크1 ${app.id}`, idea: "", understood: draft.understood ?? {}, productSpec, items, entryPath: "code" });
  const confirmedItemIds = [...card.items.filter((a) => a.confirmed).map((a) => a.id), ...card.added.map((a) => a.id)];
  const spec = await post(`/workspace/projects/${id}/dev-spec/generate`, { userKey: USER_KEY, locale: "ko", confirmedItemIds });
  out.devSpec = { status: spec.status, ok: spec.body.ok === true, error: spec.body.error ?? null };
  const run = await post(`/workspace/projects/${id}/visual-checks/run`, { userKey: USER_KEY, engine: "agent", locale: "ko" });
  if (run.status !== 202) return { ...out, error: `run ${run.status} ${run.body.error ?? ""}` };
  out.run = { id: run.body.check.id, acSource: run.body.acSource, acCount: run.body.acCount };
  let detail = null;
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 15_000));
    const g = await api(`/workspace/projects/${id}/visual-checks/${run.body.check.id}?userKey=${encodeURIComponent(USER_KEY)}`);
    const st = g.body.check?.status;
    if (st === "done" || st === "failed") {
      detail = g.body.check;
      break;
    }
  }
  if (!detail) return { ...out, error: "timeout" };
  const report = detail.report ?? {};
  out.decision = detail.decision;
  out.status = detail.status;
  out.verdict = report.verdict;
  out.oneLine = report.oneLine;
  out.acTable = report.acTable ?? [];
  out.sweep = report.sweep ?? null;
  out.durationSec = Math.round((Date.now() - t0) / 1000);
  // (G4) 런 비용 — 서버가 원장(llm_usage)에서 합산해 리포트에 실은 값.
  out.costUsd = report.agent?.costUsd ?? null;
  out.llmCallsByModel = report.agent?.callsByModel ?? null;
  return score(app, out);
}

async function main() {
  if (!USER_KEY) throw new Error("SIMSA_STAFF_USER_KEY 없음 — 장비 키를 셸에 불러와 주세요(값은 출력하지 않는다).");
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error("'맞나요?' 흉내용 LLM 키가 없습니다.");
  const only = arg("only", "").split(",").filter(Boolean);
  const apps = APPS.filter((a) => !only.length || only.includes(a.id));
  const results = [];
  let i = 0;
  await Promise.all(
    [0, 1].map(async () => {
      while (i < apps.length) {
        const a = apps[i++];
        const r = await benchProd(a).catch((e) => ({ app: a.id, error: String(e?.message ?? e).slice(0, 200) }));
        results.push(r);
        console.log(`${a.id}: ${r.decision ?? r.error} side=${r.side} match=${r.match} opposite=${r.opposite} must=${(r.mustIdentified ?? []).join(",")} cost=$${r.costUsd ?? "?"}`);
      }
    }),
  );
  writeFileSync(join(here, "agent-bench1-prod-result.json"), JSON.stringify({ base: BASE, prompt: REGISTERED_PROMPT, results }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
