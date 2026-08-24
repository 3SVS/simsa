/** 정확한 페이로드로 재측정 (증거 규칙 R3 — 내용으로 판정). */
const B = "https://conclave-ai.seunghunbae.workers.dev";
const H = { "content-type": "application/json", origin: "https://app.trysimsa.com" };
const uk = "uk_s2_" + Math.random().toString(36).slice(2);
const call = async (m, p, b) => {
  const t = Date.now();
  const r = await fetch(B + p, { method: m, headers: H, ...(b ? { body: JSON.stringify(b) } : {}) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, ms: Date.now() - t, json: j, raw: txt.slice(0, 240) };
};

const SPEC = { productName: "빵집 예약", oneLine: "빵을 예약하고 픽업 시간을 고른다", problem: "줄 서기 싫다", included: ["예약"], excluded: [], userFlow: ["예약"], decisions: [], openQuestions: [] };
const ITEM = { id: "r1", title: "예약 버튼을 누르면 예약이 저장된다", criteria: ["예약 목록에 뜬다"], status: "not_started" };

console.log("=== 1. 플랜 게이팅 — 무료 사용자가 협의체를 부르면 ===");
{
  const r = await call("POST", "/workspace/check-draft", { userKey: uk, productSpec: SPEC, items: [ITEM], locale: "ko", reviewMode: "council" });
  const ok = r.status === 402 && r.json?.error === "plan_required";
  console.log(`${ok ? "✅ 게이팅 작동" : "⚠️"} ${r.status} error=${r.json?.error} :: ${(r.json?.message ?? r.raw).slice(0, 90)}`);
}

console.log("\n=== 2. 기본 검수(무료 패널)가 실제로 판정을 내는가 ===");
{
  const r = await call("POST", "/workspace/check-draft", { userKey: uk, productSpec: SPEC, items: [ITEM], locale: "ko" });
  const res = r.json?.results?.[0];
  console.log(`${res?.status ? "✅" : "❌"} ${r.status} (${(r.ms/1000).toFixed(1)}s) source=${r.json?.source} 판정=${res?.status ?? "없음"} :: ${(res?.reason ?? r.raw).slice(0, 80)}`);
}

console.log("\n=== 3. 고쳐보기 제안 (올바른 페이로드) ===");
{
  const r = await call("POST", "/workspace/fix-suggestion", {
    item: ITEM,
    checkResult: { reason: "예약 버튼을 눌러도 아무 반응이 없습니다.", evidence: ["버튼 클릭 후 목록 변화 없음"], nextAction: "예약 저장 로직 확인" },
    productSpec: SPEC, locale: "ko",
  });
  const s = r.json;
  const usable = s?.ok !== false && (s?.agentPrompt || s?.whatToTell || s?.summary || s?.suggestion);
  console.log(`${usable ? "✅" : "❌"} ${r.status} (${(r.ms/1000).toFixed(1)}s) ${usable ? String(usable).slice(0, 110) : "error=" + (s?.error ?? r.raw)}`);
}
