// Live probe for #358: D17 adaptive question count, A bulk-accept, B-1 idea
// explainer, B-2 map language, B-3 popup suppression, B-4 stage label.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
let fails = 0;
const ok = (name, cond, detail = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails++; };

// Complex idea → expect 7~8 questions (D17)
await p.goto("https://app.trysimsa.com/projects/new?path=idea", { waitUntil: "networkidle", timeout: 45000 });
await p.locator("textarea").first().fill(
  "동네 필라테스 스튜디오용 웹앱. 강사 여러 명이 회원별 수강권을 관리하고, 회원은 직접 조회·예약하고, 수강권 구매 결제도 받고, 예약 확정 알림도 보내고 싶어요."
);
await p.getByRole("button", { name: /제품 설명서 만들기/ }).click();

// Walk to the question step
let questionCount = 0;
for (let round = 0; round < 20; round++) {
  await p.waitForTimeout(6000);
  // B-3: popup must never be visible on the wizard
  const popup = await p.getByText("Simsa 개선에 참여하기").count();
  if (popup > 0) { ok("B-3 참여 팝업 위저드 억제", false, "팝업 표시됨"); break; }
  const bulk = p.getByRole("button", { name: /전부 추천대로/ });
  if ((await bulk.count()) > 0) {
    questionCount = await p.getByText(/이 질문은 제 경우엔 안 맞아요/).count();
    ok(`D17 질문 수 (복잡 아이디어 → 7~8 기대)`, questionCount >= 7 && questionCount <= 8, `${questionCount}개`);
    // A: one click answers everything
    await bulk.click();
    await p.waitForTimeout(800);
    const done = await p.getByText(/답변 완료/).count();
    ok("A 일괄 수락 (전 질문 답변 완료)", done >= questionCount, `답변완료 ${done}/${questionCount}`);
    ok("B-3 참여 팝업 위저드 억제", true);
    break;
  }
  const next = p.getByRole("button", { name: /맞습니다|질문에 답하기/ }).last();
  if ((await next.count()) > 0) await next.click();
}
if (questionCount === 0) { ok("질문 단계 도달", false); }

// Continue to project creation
for (let round = 0; round < 8; round++) {
  if (/proj_(?!mjx1)/.test(p.url())) break;
  const cc = p.getByRole("button", { name: "Claude Code", exact: true });
  if ((await cc.count()) > 0) { await cc.first().click(); await p.waitForTimeout(400); }
  const next = p.getByRole("button", { name: /완성|만들기|시작하기|다음|계속/ }).last();
  if ((await next.count()) > 0) await next.click();
  await Promise.race([
    p.waitForURL(/\/projects\/proj_(?!mjx1)/, { timeout: 60000 }).catch(() => {}),
    p.waitForTimeout(12000),
  ]);
}
const pid = p.url().match(/proj_[a-z0-9]+/)?.[0];
ok("프로젝트 생성", !!pid, p.url());

if (pid) {
  await p.waitForTimeout(2000);
  const body = await p.evaluate(() => document.body.innerText);
  // B-1: idea explainer, no GitHub to-do
  ok("B-1 개요 할 일: '빌더 팩 받기' 존재", /빌더 팩 받기/.test(body));
  ok("B-1 개요 할 일: 'GitHub 저장소를 연결' 부재", !/GitHub 저장소를 연결/.test(body));
  // B-4: stage label
  ok("B-4 스테이지 '만들기·검수'", /만들기·검수/.test(body));
  // B-7: sidebar label
  ok("B-7 사이드바 '준비·설정'", /준비·설정/.test(body));
  await p.screenshot({ path: "flow-audit-shots/40-fixed-landing.png" });

  // B-2: map language
  await p.goto(`https://app.trysimsa.com/projects/${pid}/map`, { waitUntil: "networkidle", timeout: 30000 });
  await p.waitForTimeout(1500);
  const mapBody = await p.evaluate(() => document.body.innerText);
  ok("B-2 심사 지도: 내부 용어 0 (인테이크/머지/릴리스 체크포인트/제품 브리프)", !/인테이크|머지|릴리스 체크포인트|제품 브리프/.test(mapBody));
  ok("B-2 심사 지도: 일반어 존재 (아이디어 접수/변경 반영/인터넷에 공개)", /아이디어 접수|변경 반영|인터넷에 공개/.test(mapBody));
  await p.screenshot({ path: "flow-audit-shots/41-fixed-map.png" });
}

await b.close();
console.log(fails === 0 ? "\n라이브 재프로브 통과" : `\n실패 ${fails}건`);
process.exit(fails === 0 ? 0 : 1);
