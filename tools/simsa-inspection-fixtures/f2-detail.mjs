/** 성공 분기에 왜 도달 못 하는지 — 리포트 전문과 스텝 결과를 본다. */
const B = "https://conclave-ai.seunghunbae.workers.dev";
const F = "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
const H = { "content-type": "application/json", origin: "https://app.trysimsa.com" };
const api = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: H, ...(b ? { body: JSON.stringify(b) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const uk = "uk_sd_" + Math.random().toString(36).slice(2);
const pid = "proj_sd_" + Math.random().toString(36).slice(2);
await api("POST", "/workspace/projects", { userKey: uk, id: pid, title: "step detail", entryPath: "code" });
await api("POST", `/workspace/projects/${pid}/sources`, { userKey: uk, type: "website", reference: F + "/noisy-working" });
const run = await api("POST", `/workspace/projects/${pid}/visual-checks/run`, {
  userKey: uk, locale: "ko", targetUrl: F + "/noisy-working",
  intent: "숫자를 입력하고 변환하기를 누르면 마일 결과가 보여야 한다",
});
const runId = run.json?.check?.id;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const g = await api("GET", `/workspace/projects/${pid}/visual-checks/${runId}?userKey=${encodeURIComponent(uk)}`);
  const c = g.json?.check;
  if (c?.status === "done" || c?.status === "failed") {
    console.log("decision:", c.decision, "| works:", c.works);
    const rep = typeof c.report === "string" ? JSON.parse(c.report) : c.report;
    console.log("verdict:", rep?.verdict);
    console.log("oneLine:", rep?.oneLine);
    console.log("findings:", JSON.stringify(rep?.findings ?? []).slice(0, 300));
    console.log("전체 리포트 키:", Object.keys(rep ?? {}).join(", "));
    console.log("nextSteps:", JSON.stringify(rep?.nextSteps ?? []).slice(0, 300));
    console.log("agentPrompt(앞 600):", String(c.agentPrompt ?? "").slice(0, 600));
    for (const k of ["steps", "stepOutcomes", "flow", "plan", "evidence"]) {
      if (rep?.[k]) console.log(`${k}:`, JSON.stringify(rep[k]).slice(0, 600));
    }
    break;
  }
}
