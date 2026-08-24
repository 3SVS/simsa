/** 아이디어·스펙 갈래가 #504 이후 정상인지 — 같은 생성기를 쓰므로 확인이 필요하다. */
const B = "https://conclave-ai.seunghunbae.workers.dev";
const H = { "content-type": "application/json", origin: "https://app.trysimsa.com" };

const cases = [
  ["아이디어 갈래 (한국어)", { idea: "동네 빵집에서 빵을 예약하고 픽업 시간을 고르는 앱을 만들고 싶어요", locale: "ko" }],
  ["아이디어 갈래 (영어)", { idea: "An app to reserve bread at a local bakery and pick a pickup time", locale: "en" }],
  ["스펙 갈래 (붙여넣은 기획서)", {
    idea: "제품: 반려견 산책 기록 앱\n기능: 산책 시작/종료 기록, 주간 거리 통계, 기록 공유\n대상: 반려견 보호자",
    locale: "ko",
  }],
];

for (const [label, body] of cases) {
  const t = Date.now();
  const r = await fetch(`${B}/workspace/idea-to-spec-draft`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  const ms = Date.now() - t;
  if (d?.ok === false) {
    console.log(`❌ ${label}: ${r.status} (${ms}ms) → ${d.error}`);
    continue;
  }
  const items = d?.items?.length ?? 0;
  const qs = d?.productSpec?.openQuestions?.length ?? d?.questions?.length ?? 0;
  console.log(`✅ ${label}: ${r.status} (${(ms / 1000).toFixed(1)}s)`);
  console.log(`   제품명: ${d?.productSpec?.productName ?? "-"}`);
  console.log(`   한 줄: ${(d?.productSpec?.oneLine ?? "-").slice(0, 70)}`);
  console.log(`   항목 ${items}개 · 열린질문 ${qs}개 · source=${d?.source ?? "-"}`);
}
