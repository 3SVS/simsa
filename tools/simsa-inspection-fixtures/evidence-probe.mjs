// One-off: inspect a URL and print the FULL report findings + evidence strings,
// to diagnose a verdict before changing any code. Usage: node evidence-probe.mjs <url>
const BASE = "https://conclave-ai.seunghunbae.workers.dev";
const TARGET = process.argv[2] ?? "https://trysimsa.com";
const userKey = `uk_evid_${Date.now().toString(36)}`;

const api = async (method, path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const created = await api("POST", "/workspace/projects", {
  userKey, title: "evidence probe", idea: "검수 증거 확인", understood: null, productSpec: null, items: [], entryPath: "code",
});
const pid = created.json?.project?.id ?? created.json?.id;
if (!pid) { console.log("project create failed", created.status); process.exit(1); }
try {
  await api("POST", `/workspace/projects/${pid}/sources`, { userKey, type: "website", reference: TARGET, label: "evid" });
  const run = await api("POST", `/workspace/projects/${pid}/visual-checks/run`, {
    userKey, locale: "ko", targetUrl: TARGET,
    intent: "방문자가 이 서비스가 무엇인지 이해하고 시작 버튼을 찾을 수 있어야 한다",
  });
  const runId = run.json?.check?.id;
  console.log("run", runId, "dispatched:", run.json?.dispatched, run.json?.note ?? "");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const got = await api("GET", `/workspace/projects/${pid}/visual-checks/${runId}?userKey=${encodeURIComponent(userKey)}`);
    const st = got.json?.check?.status;
    process.stdout.write(`…${st} `);
    if (st === "done" || st === "failed") {
      const c = got.json.check;
      console.log(`\n\ndecision=${c.decision} works=${c.works}`);
      console.log("oneLine:", c.report?.verdict, "—", c.report?.oneLine);
      for (const f of c.report?.findings ?? []) {
        console.log(`\n[${f.severity}] ${f.what}`);
        if (f.evidence) console.log(`   evidence: ${f.evidence}`);
      }
      break;
    }
  }
} finally {
  await api("DELETE", `/workspace/projects/${pid}?userKey=${encodeURIComponent(userKey)}`).catch(() => {});
}
