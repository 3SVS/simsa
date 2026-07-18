/**
 * share-page-probe.mjs — G11 공개 공유 페이지 라이브 프로브.
 * API로 스냅샷 생성 → /s/{id}를 새 브라우저 컨텍스트(무상태)로 열어 렌더 확인
 * → 회수 후 같은 페이지가 "볼 수 없어요"로 바뀌는지까지.
 */
import { chromium } from "playwright";

const APP = process.argv[2] ?? "https://app.trysimsa.com";
const API = "https://conclave-ai.seunghunbae.workers.dev";
const UKEY = "probe_g11_page";

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${n}`); };

const created = await (await fetch(`${API}/workspace/shares`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    userKey: UKEY,
    payload: {
      title: "동네 빵집 예약 앱",
      oneLine: "예약하고 찾아가는 웹앱",
      problem: "인기 빵은 금방 매진됩니다.",
      included: ["빵 목록", "픽업 예약"],
      excluded: ["온라인 결제"],
      summary: { passed: 1, failed: 1, inconclusive: 0, needsDecision: 0 },
      items: [
        { title: "빵 목록 보기", status: "passed", reason: "기준 충족", criteria: ["오늘 빵만 표시"] },
        { title: "카드 결제", status: "failed", reason: "제외 범위 충돌" },
      ],
      openQuestions: ["취소 허용 기한"],
    },
  }),
})).json();
check("share created", created.ok === true);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext(); // 무상태 — 수신자 시점
  const page = await ctx.newPage();
  await page.goto(`${APP}/s/${created.shareId}`, { waitUntil: "networkidle" });
  const body = (await page.textContent("body")) ?? "";
  check("title rendered", body.includes("동네 빵집 예약 앱"));
  check("eyebrow shown", body.includes("공유된 리포트"));
  check("items + statuses rendered", body.includes("카드 결제") && body.includes("빵 목록 보기"));
  check("snapshot note shown", body.includes("스냅샷"));
  check("simsa footer", body.includes("simsa.dev"));

  // 회수 → 같은 링크가 missing으로
  await fetch(`${API}/workspace/shares/${created.shareId}?userKey=${UKEY}`, { method: "DELETE" });
  await page.goto(`${APP}/s/${created.shareId}`, { waitUntil: "networkidle" });
  const after = (await page.textContent("body")) ?? "";
  check("revoked → missing page", after.includes("더 이상 볼 수 없어요"));
  await ctx.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
