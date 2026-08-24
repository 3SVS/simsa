/** infer-intent 라이브 응답을 직접 본다 — 브라우저 오류의 원인 확인. */
const B = "https://conclave-ai.seunghunbae.workers.dev";
const H = { "content-type": "application/json", origin: "https://app.trysimsa.com" };
const userKey = "uk_infer_" + Math.floor(Math.random() * 1e9).toString(36);
const projectId = "proj_infer_" + Math.floor(Math.random() * 1e9).toString(36);

async function j(method, path, body) {
  const r = await fetch(B + path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, cors: r.headers.get("access-control-allow-origin"), body: parsed ?? text.slice(0, 300) };
}

console.log("생성:", (await j("POST", "/workspace/projects", { userKey, id: projectId, title: "infer probe", entryPath: "code" })).status);
console.log("소스:", (await j("POST", `/workspace/projects/${projectId}/sources`, { userKey, type: "website", reference: "https://app.trysimsa.com/" })).status);

// 프리플라이트도 확인 — 새 경로가 CORS에서 막히는지.
const pre = await fetch(`${B}/workspace/projects/${projectId}/infer-intent`, {
  method: "OPTIONS",
  headers: { origin: "https://app.trysimsa.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
});
console.log("preflight:", pre.status, "allow-origin:", pre.headers.get("access-control-allow-origin"), "allow-methods:", pre.headers.get("access-control-allow-methods"));

const t = Date.now();
const res = await j("POST", `/workspace/projects/${projectId}/infer-intent`, { userKey, locale: "ko" });
console.log(`infer-intent: ${res.status} (${Date.now() - t}ms) cors=${res.cors}`);
console.log(JSON.stringify(res.body, null, 2).slice(0, 1200));
