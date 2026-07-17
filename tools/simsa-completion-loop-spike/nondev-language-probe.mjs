// Live probe: openQuestions must carry no developer tool names (P1, 2026-07-17).
// Direct POST to the production worker (no login — the endpoint is free-beta).
// Run from this directory: `node nondev-language-probe.mjs`
//
// The sanitize layer is deterministic server-side, so ANY draft that comes
// back is proof of the wiring — we pick ideas that leaked in the 2026-07-17
// assessment (charts / data storage / integrations) to stress the LLM side too.

const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";

const JARGON =
  /firebase|supabase|amazon\s*s3|\baws\b|dynamodb|mongodb|postgres(?:ql)?|mysql|redis|데이터베이스|\bdb\b|chart\.js|\bd3(?:\.js)?\b|recharts|highcharts|\bstt\b|speech[-\s]?to[-\s]?text|\btts\b|oauth|\bjwt\b|\bsso\b|\bapi\b|\bsdk\b|webhook|웹훅|graphql|엔드포인트|endpoint|vercel|netlify|cloudflare|heroku|호스팅|hosting|docker|kubernetes/i;

const CASES = [
  { locale: "ko", idea: "주식 포트폴리오를 차트로 보여주는 대시보드 웹앱" },
  { locale: "ko", idea: "출장 경비 영수증을 올리면 자동 분류하고 월별 리포트를 만들어주는 웹앱" },
  { locale: "ko", idea: "회의 녹음을 올리면 요약하고 할 일을 정리해주는 웹앱" },
  { locale: "en", idea: "a web dashboard that tracks my running stats and shows progress charts" },
];

let failed = 0;
for (const c of CASES) {
  const res = await fetch(`${BASE}/workspace/idea-to-spec-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(c),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    console.log(`❌ [${c.locale}] HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 200)} — ${c.idea}`);
    failed++;
    continue;
  }
  const qs = body.productSpec?.openQuestions ?? [];
  const leaks = qs.filter((q) => JARGON.test(q));
  const tag = `[${c.locale}] source=${body.source} openQuestions=${qs.length}`;
  if (leaks.length === 0) {
    console.log(`✅ ${tag} — 누수 0 — ${c.idea}`);
    for (const q of qs) console.log(`     · ${q}`);
  } else {
    console.log(`❌ ${tag} — 누수 ${leaks.length}: ${JSON.stringify(leaks)} — ${c.idea}`);
    failed++;
  }
}

console.log(failed === 0 ? "\n프로브 통과 (전 케이스 누수 0)" : `\n프로브 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
