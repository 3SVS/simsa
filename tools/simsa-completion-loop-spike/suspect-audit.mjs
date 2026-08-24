/**
 * suspect-audit.mjs — "망가졌을 것 같은데 안 재본 것" 전수 측정 (증거 규칙 R2).
 * 상태 코드가 아니라 **내용**으로 판정한다(R3).
 */
const B = "https://conclave-ai.seunghunbae.workers.dev";
const H = { "content-type": "application/json", origin: "https://app.trysimsa.com" };
const uk = "uk_suspect_" + Math.random().toString(36).slice(2);

async function call(method, path, body) {
  const t = Date.now();
  try {
    const r = await fetch(B + path, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, ms: Date.now() - t, json: j, raw: txt.slice(0, 200) };
  } catch (e) { return { status: "ERR", ms: Date.now() - t, err: String(e).slice(0, 120) }; }
}
const line = (name, verdict, detail) => console.log(`${verdict} ${name}\n     ${detail}`);

console.log("=== 1. 플랜 게이팅 (무료가 유료 기능을 부르면?) ===");
{
  const pid = "proj_s1_" + Math.random().toString(36).slice(2);
  await call("POST", "/workspace/projects", { userKey: uk, id: pid, title: "게이팅 확인", entryPath: "code" });
  const r = await call("POST", `/workspace/projects/${pid}/council-review`, {
    userKey: uk,
    productSpec: { productName: "t", oneLine: "t" },
    items: [{ id: "r1", title: "로그인이 된다", criteria: ["로그인 버튼이 있다"] }],
    locale: "ko",
  });
  const e = r.json?.error ?? "";
  line("협의체 호출",
    r.status === 404 ? "❓ 경로없음" : /plan|upgrade|paid|forbidden|council_unavailable/i.test(e) ? "✅" : "⚠️",
    `${r.status} (${(r.ms/1000).toFixed(1)}s) error=${e || "(없음)"} ${r.json?.ok === true ? "→ ok:true (게이팅 안 됨?)" : ""}`);
}

console.log("\n=== 2. 검수 결과 → 고쳐보기 (fix-suggestion) ===");
{
  const r = await call("POST", "/workspace/fix-suggestion", {
    productSpec: { productName: "빵집 예약", oneLine: "빵을 예약하고 픽업 시간을 고른다" },
    item: { id: "r1", title: "예약 버튼을 누르면 예약이 저장된다", criteria: ["예약 목록에 뜬다"] },
    finding: "예약 버튼을 눌러도 아무 일이 일어나지 않습니다.",
    locale: "ko",
  });
  const s = r.json;
  const usable = s?.ok !== false && (s?.whatToTell || s?.agentPrompt || s?.summary);
  line("고쳐보기 제안", usable ? "✅" : "❌",
    `${r.status} (${(r.ms/1000).toFixed(1)}s) ${usable ? String(usable).slice(0,90) : "error=" + (s?.error ?? r.raw)}`);
}

console.log("\n=== 3. 막힘 도우미 (unstick) ===");
{
  const r = await call("POST", "/workspace/unstick", {
    problemText: "npm run build 했더니 Module not found: Can't resolve './components/Button' 이라고 떠요",
    buildTool: "claude_code", locale: "ko",
  });
  const s = r.json;
  const usable = s?.ok === true && s?.whatHappened && Array.isArray(s?.nextSteps) && s.nextSteps.length > 0;
  line("막힘 도우미", usable ? "✅" : "❌",
    `${r.status} (${(r.ms/1000).toFixed(1)}s) ${usable ? s.whatHappened.slice(0,90) : "error=" + (s?.error ?? r.raw)}`);
}

console.log("\n=== 4. 추천 답안 (recommend) ===");
{
  const r = await call("POST", "/workspace/recommend-answer", {
    question: "예약 기록을 며칠 동안 보관할까요?", productName: "빵집 예약", locale: "ko",
  });
  const s = r.json;
  const usable = s?.ok === true && s?.recommendation;
  line("추천 답안", usable ? "✅" : "❌",
    `${r.status} (${(r.ms/1000).toFixed(1)}s) ${usable ? s.recommendation + " / " + (s.reason??"").slice(0,50) : "error=" + (s?.error ?? r.raw)}`);
}
