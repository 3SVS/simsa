/**
 * train-c-a7-interview-pack.test.mjs — Train C · C-A7 ② 인터뷰 프롬프트 팩(재정렬 2026-09-27 §3 문 (c)).
 *
 * 고정하는 계약:
 *   ① buildInterviewPrompt: KO/EN 스냅샷(한 덩어리, 한 번에 질문 하나, 고정 양식) + 초보자 금칙어 0
 *   ② parseInterviewAnswer: 망가진 답(잡담·마크다운·키 번역·다른 언어·양식 누락·양식 그대로·프롬프트 붙여넣기)에
 *      관대하게, 모르면 버리고 unread로 정직하게. 결과 모양은 Zod(InterviewAnswerSchema)
 *   ③ 라우트: interview-pack(소유권·역추론 지시서 요약 기반) / interview-answer(저장 안 함·계측은 개수만)
 *   ④ 회수 결과가 **다음 검수의 intent·acceptancePlan**으로 들어간다 — 답 회수 → (대시보드 반영 함수) →
 *      미러 → 역추론 지시서(확인 must) → 검수 디스패치까지 실제 라우트로 관통
 *
 * 네트워크 0(fetch 교체·가짜 D1). 한글 리얼 데이터(Rule 6).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFakeD1, projectRow, websiteSource, makeDoStub } from "./_train-c-fake-d1.mjs";

const { buildInterviewPrompt, parseInterviewAnswer, InterviewAnswerSchema, MAX_ANSWER_CHARS } = await import("../dist/workspace/interview-pack.js");
const { interviewFeaturesFor } = await import("../dist/routes/workspace-dev-spec.js");
const { createApp } = await import("../dist/router.js");
const { __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");
// 대시보드의 순수 반영 함수 — "기존 의도 확정 경로"에 태우는 쪽. 관통 테스트가 같은 함수를 쓴다.
const { applyInterviewAnswer } = await import("../../dashboard/src/lib/interview-apply.mjs");

const USER = "uk_트루픽셀_대표";
const PROJECT = "wsp_truepixel_iv";
const APP_URL = "https://truepixel-yeyak.example.app/";

// ─── ① 프롬프트 ─────────────────────────────────────────────────────────────

const KO_SNAPSHOT = [
  "당신은 제가 만든 앱의 \"원래 의도\"를 함께 정리해 주는 인터뷰 도우미입니다.",
  "",
  "제 앱: (주)트루픽셀 예약 앱 (https://truepixel-yeyak.example.app/)",
  "이 앱은 작동은 하지만, 제가 처음 생각한 것과 다른 부분이 있습니다.",
  "아래는 앱에서 읽어낸 기능 목록입니다.",
  "",
  "[제가 맞다고 확인한 기능]",
  "- 원하는 날짜를 골라 예약할 수 있다",
  "[아직 확인하지 않은 기능 — 정말 필요한지 모릅니다]",
  "- 후기를 남길 수 있다",
  "",
  "진행 방법:",
  "1. 저에게 한 번에 질문 하나만 하세요. 제 답을 들은 뒤 다음 질문을 하세요.",
  "2. 알아내야 할 것은 네 가지입니다: 원래 하려던 일(한 문장), 반드시 되어야 하는 것, 없어도 되는 것, 지금 앱이 제 생각과 다른 점.",
  "3. 쉬운 말로 물어보고, 질문은 8개 안에서 끝내세요. 어려운 기술 용어는 쓰지 마세요.",
  "4. 다 물어봤으면 아래 양식으로만 답하세요. 양식 앞뒤에 다른 말을 붙이지 마세요.",
  "   키 이름(INTENT, MUST, NOT_NEEDED, DIFFERENT_NOW, END)은 영어 그대로 두고, 내용은 한국어로 쓰세요.",
  "",
  "INTENT: (원래 하려던 일 한 문장)",
  "MUST:",
  "- (반드시 되어야 하는 것 — 한 줄에 하나, 8개까지)",
  "NOT_NEEDED:",
  "- (없어도 되는 것 — 없으면 \"- 없음\")",
  "DIFFERENT_NOW:",
  "- (지금 앱이 제 생각과 다른 점 — 한 줄에 하나)",
  "END",
  "",
  "그럼 첫 질문부터 시작해 주세요.",
].join("\n");

const EN_SNAPSHOT = [
  "You are an interview helper. Help me pin down what I originally meant my app to do.",
  "",
  "My app: TruePixel Booking (https://truepixel-yeyak.example.app/)",
  "The app works, but some parts are not what I had in mind.",
  "Here is what was read from the app:",
  "",
  "[Things I confirmed are right]",
  "- Pick a date and book",
  "[Things I have not confirmed — I am not sure they are needed]",
  "- Leave a review",
  "",
  "How to do it:",
  "1. Ask me one question at a time. Wait for my answer before the next one.",
  "2. Find out four things: what I originally wanted to do (one sentence), what must work, what is not needed, and how the app is different from what I meant.",
  "3. Use plain words and finish within 8 questions. Avoid technical terms.",
  "4. When you are done, reply ONLY in the format below — nothing before or after it.",
  "   Keep the key names (INTENT, MUST, NOT_NEEDED, DIFFERENT_NOW, END) exactly as written.",
  "",
  "INTENT: (what I originally wanted to do, in one sentence)",
  "MUST:",
  "- (something that must work — one per line, up to 8)",
  "NOT_NEEDED:",
  "- (something that is not needed — write \"- none\" if nothing)",
  "DIFFERENT_NOW:",
  "- (how the app is different from what I meant — one per line)",
  "END",
  "",
  "Please start with your first question.",
].join("\n");

const KO_FEATURES = [
  { title: "원하는 날짜를 골라 예약할 수 있다", confirmed: true },
  { title: "후기를 남길 수 있다", confirmed: false },
];

describe("① buildInterviewPrompt — KO/EN 스냅샷·금칙어", () => {
  it("KO 스냅샷", () => {
    assert.equal(buildInterviewPrompt({ locale: "ko", appName: "(주)트루픽셀 예약 앱", appUrl: APP_URL, features: KO_FEATURES }), KO_SNAPSHOT);
  });
  it("EN 스냅샷(한글 0자)", () => {
    const en = buildInterviewPrompt({
      locale: "en", appName: "TruePixel Booking", appUrl: APP_URL,
      features: [{ title: "Pick a date and book", confirmed: true }, { title: "Leave a review", confirmed: false }],
    });
    assert.equal(en, EN_SNAPSHOT);
    assert.doesNotMatch(en, /[가-힣]/);
  });
  it("우리가 쓴 문장에 초보자 금칙어 0(GitHub·repo·PR·Vercel·Supabase·Lovable·워크스페이스 …)", () => {
    for (const locale of ["ko", "en"]) {
      const p = buildInterviewPrompt({ locale, appName: null, appUrl: null, features: [] });
      assert.deepEqual(devTermHits(p), [], `${locale}: ${JSON.stringify(devTermHits(p))}`);
      assert.doesNotMatch(p, /워크스페이스|workspace/i);
    }
  });
  it("확인 여부로 나눠 싣고, 이름·주소 없으면 생략, 기능은 15개까지", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `기능 ${i + 1}`, confirmed: i % 2 === 0 }));
    const p = buildInterviewPrompt({ locale: "ko", appName: "", appUrl: null, features: many });
    assert.match(p, /^당신은/);
    assert.match(p, /\n제 앱\n/);
    assert.equal((p.match(/^- 기능 \d+$/gm) ?? []).length, 15);
    assert.doesNotMatch(p, /기능 16/);
    const none = buildInterviewPrompt({ locale: "ko", features: [] });
    assert.match(none, /\[제가 맞다고 확인한 기능\]\n- \(아직 없음\)/);
  });
});

// ─── ② 파서 ─────────────────────────────────────────────────────────────────

const GOOD_KO = [
  "INTENT: 손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것",
  "MUST:",
  "- 원하는 날짜를 골라 예약할 수 있다",
  "- 예약 확인 화면에 고른 날짜가 보인다",
  "NOT_NEEDED:",
  "- 후기 기능",
  "DIFFERENT_NOW:",
  "- 날짜를 고르는 칸이 없고 항상 오늘로 예약된다",
  "END",
].join("\n");

function ok(text) {
  const r = parseInterviewAnswer(text);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(InterviewAnswerSchema.safeParse(r.answer).success, true);
  return r.answer;
}

describe("② parseInterviewAnswer — 정상·망가진 답(한글)", () => {
  it("1. 정상 양식", () => {
    const a = ok(GOOD_KO);
    assert.equal(a.intent, "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것");
    assert.deepEqual(a.must, ["원하는 날짜를 골라 예약할 수 있다", "예약 확인 화면에 고른 날짜가 보인다"]);
    assert.deepEqual(a.notNeeded, ["후기 기능"]);
    assert.deepEqual(a.differentNow, ["날짜를 고르는 칸이 없고 항상 오늘로 예약된다"]);
    assert.deepEqual(a.unread, []);
    assert.equal(a.ignoredLines, 0);
  });

  it("2. 앞뒤 잡담 + 코드블록 울타리 + END 뒤 문장은 버린다(버린 줄 수는 센다)", () => {
    const a = ok(`좋아요! 인터뷰 결과를 정리했어요.\n\n\`\`\`\n${GOOD_KO}\n\`\`\`\n더 궁금한 게 있으면 말씀해 주세요.\nMUST:\n- END 뒤에 온 가짜 항목`);
    assert.equal(a.must.length, 2);
    assert.ok(!a.must.includes("END 뒤에 온 가짜 항목"));
    assert.equal(a.ignoredLines, 1);
  });

  it("3. 마크다운 강조·제목 키(**INTENT:** / ## MUST:) + 전각 콜론", () => {
    const a = ok("**INTENT:** 동네 꽃집 주문을 원화로 받는 앱\n## MUST:\n* 가격이 원화로 보인다\nNOT_NEEDED：\n- 없음\n**DIFFERENT_NOW**: 가격이 달러로 나온다");
    assert.equal(a.intent, "동네 꽃집 주문을 원화로 받는 앱");
    assert.deepEqual(a.must, ["가격이 원화로 보인다"]);
    assert.deepEqual(a.notNeeded, []);
    assert.deepEqual(a.differentNow, ["가격이 달러로 나온다"]);
    assert.deepEqual(a.unread, [], "'없음'은 읽은 것이다 — unread가 아니다");
  });

  it("4. AI가 키를 한국어로 번역한 경우(의도·반드시·없어도 되는 것·지금 다른 점)", () => {
    const a = ok("의도: 체험 신청을 받을 때 연락처를 꼭 받는다\n반드시:\n- 전화번호 칸이 있다\n없어도 되는 것:\n- 없음\n지금 다른 점:\n- 전화번호를 적는 칸이 없다");
    assert.equal(a.intent, "체험 신청을 받을 때 연락처를 꼭 받는다");
    assert.deepEqual(a.must, ["전화번호 칸이 있다"]);
    assert.deepEqual(a.differentNow, ["전화번호를 적는 칸이 없다"]);
  });

  it("5. 한 줄에 여러 개(; 또는 |) — 쉼표는 문장 안이라 나누지 않는다", () => {
    const a = ok("INTENT: 공지 게시판\nMUST: 최신 공지가 맨 위; 공지 3건이 보인다 | 제목, 날짜가 함께 보인다");
    assert.deepEqual(a.must, ["최신 공지가 맨 위", "공지 3건이 보인다", "제목, 날짜가 함께 보인다"]);
  });

  it("6. 양식 칸 누락 → unread로 정직하게(지어내지 않는다)", () => {
    const a = ok("INTENT: 장바구니 버튼을 누르면 장바구니 화면이 나온다\nMUST:\n- 담은 상품이 보인다");
    assert.deepEqual(a.unread, ["notNeeded", "differentNow"]);
    assert.deepEqual(a.notNeeded, []);
    assert.deepEqual(a.differentNow, []);
  });

  it("7. 다른 언어로 답해도(한국어 사용자의 AI가 영어로) 내용은 그대로 받는다", () => {
    const a = ok("INTENT: Customers book a haircut on the date they pick\nMUST:\n- The booking shows the chosen date\nNOT_NEEDED:\n- none\nDIFFERENT_NOW:\n- There is no date picker");
    assert.equal(a.intent, "Customers book a haircut on the date they pick");
    assert.deepEqual(a.notNeeded, []);
  });

  it("8. 번호 목록·글머리(•)·글머리 없는 줄도 항목으로, 중복 제거·12개·200자 상한", () => {
    const long = "가".repeat(260);
    const lines = ["INTENT: 검색이 이름 일부로도 되는 카페 찾기", "MUST:", "1. 이름 일부로 검색된다", "2) 이름 일부로 검색된다", "• 검색 결과에 가게 이름이 보인다", "검색어를 지우면 전체 목록이 보인다", `- ${long}`];
    for (let i = 0; i < 15; i++) lines.push(`- 추가 항목 ${i}`);
    const a = ok(lines.join("\n"));
    assert.equal(a.must.length, 12);
    assert.deepEqual(a.must.slice(0, 3), ["이름 일부로 검색된다", "검색 결과에 가게 이름이 보인다", "검색어를 지우면 전체 목록이 보인다"]);
    assert.equal(a.must[3].length, 200);
  });

  it("9. 의도는 한 문장 — 둘째 줄은 버린다, 따옴표는 벗긴다", () => {
    const a = ok("INTENT:\n\"메모를 저장하면 새로고침해도 남아 있어야 한다\"\n그리고 예쁘면 좋겠다\nMUST:\n- 새로고침해도 메모가 남는다");
    assert.equal(a.intent, "메모를 저장하면 새로고침해도 남아 있어야 한다");
    assert.equal(a.ignoredLines, 1);
  });

  it("10. 양식이 채워지지 않고 되돌아옴(괄호 안내문 그대로) → no_content", () => {
    const echo = "INTENT: (원래 하려던 일 한 문장)\nMUST:\n- (반드시 되어야 하는 것 — 한 줄에 하나, 8개까지)\nNOT_NEEDED:\n- (없어도 되는 것 — 없으면 \"- 없음\")\nDIFFERENT_NOW:\n- (지금 앱이 제 생각과 다른 점 — 한 줄에 하나)\nEND";
    assert.deepEqual(parseInterviewAnswer(echo), { ok: false, reason: "no_content" });
  });

  it("11. 질문 묶음(프롬프트)을 답 칸에 붙여넣음 → prompt_pasted", () => {
    assert.deepEqual(parseInterviewAnswer(KO_SNAPSHOT), { ok: false, reason: "prompt_pasted" });
    assert.deepEqual(parseInterviewAnswer(EN_SNAPSHOT), { ok: false, reason: "prompt_pasted" });
  });

  it("12. 양식 없는 자유 대화 → no_format / 빈 칸 → empty", () => {
    assert.deepEqual(parseInterviewAnswer("네, 날짜 선택이 꼭 필요해요. 지금은 오늘로만 예약돼요."), { ok: false, reason: "no_format" });
    assert.deepEqual(parseInterviewAnswer("   \n "), { ok: false, reason: "empty" });
    assert.deepEqual(parseInterviewAnswer(undefined), { ok: false, reason: "empty" });
  });

  it("13. 목록 안의 '키처럼 보이는' 줄(예약 시간: 오전 10시)은 키가 아니다", () => {
    const a = ok("INTENT: 예약 앱\nMUST:\n- 예약 시간: 오전 10시가 보인다");
    assert.deepEqual(a.must, ["예약 시간: 오전 10시가 보인다"]);
  });

  it("14. 상한 밖의 긴 입력은 잘라서 읽는다(MAX_ANSWER_CHARS)", () => {
    const r = parseInterviewAnswer(`${GOOD_KO}\n${"잡담 ".repeat(MAX_ANSWER_CHARS)}`);
    assert.equal(r.ok, true);
  });
});

// ─── ③ 라우트 ────────────────────────────────────────────────────────────────

const brief = {
  productName: "(주)트루픽셀 예약 앱",
  oneLine: "미용실 예약 앱",
  targetUsers: ["동네 미용실 손님"], problem: "전화 예약이 번거롭다",
  included: [], excluded: [], userFlow: [], decisions: [], openQuestions: [],
};
const ITEMS = [
  { id: "req_001", title: "원하는 날짜를 골라 예약할 수 있다", status: "not_started", criteria: [] },
  { id: "req_002", title: "후기를 남길 수 있다", status: "not_started", criteria: [] },
];

function inferredDevSpec() {
  return {
    meta: { version: 1, source: "inferred", locale: "ko", generatedAt: "2026-09-30T01:00:00.000Z", provenance: { entryPath: "code", userConfirmedAcIds: ["AC-001"] } },
    brief,
    features: [
      { id: "FR-001", title: "날짜 선택 예약", description: "d", priority: "must" },
      { id: "FR-101", title: "후기 작성", description: "d", priority: "should" },
    ],
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "날짜를 고르고 예약하면", then: "예약 확인에 고른 날짜가 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-101", given: "방문 후", when: "후기를 등록하면", then: "후기 목록에 새 글이 보인다", verifiedBy: "browser" },
    ],
    screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: [], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001"] }],
    dataModel: [], apis: [], nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "예약", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002"] }],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "'예약하기' 누르기"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["/ 열기", "'등록' 누르기"] },
    ],
    assumptions: [], openQuestions: [],
  };
}

/** train-c 가짜 D1 + 지시서 저장 UPDATE를 프로젝트 행에 반영(관통 테스트가 다음 요청에서 읽는다). */
function makeDb({ devSpec = null, items = ITEMS, entryPath = "code" } = {}) {
  const projects = new Map([
    [PROJECT, projectRow(PROJECT, USER, {
      title: "(주)트루픽셀 예약 앱",
      product_spec_json: JSON.stringify(brief),
      items_json: JSON.stringify(items),
      entry_path: entryPath,
      dev_spec_json: devSpec ? JSON.stringify(devSpec) : null,
    })],
    ["wsp_other", projectRow("wsp_other", "uk_남의것")],
  ]);
  const db = makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER, { reference: APP_URL })] });
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = prepare(sql);
    if (!sql.includes("SET dev_spec_json")) return stmt;
    return {
      ...stmt,
      bind(...args) {
        const inner = stmt.bind(...args);
        return {
          ...inner,
          async run() {
            const [json, at, id] = args;
            const row = projects.get(id);
            if (row) Object.assign(row, { dev_spec_json: json, dev_spec_updated_at: at });
            return inner.run();
          },
        };
      },
    };
  };
  return db;
}

async function post(env, path, body) {
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {}, props: {} };
  const res = await createApp().fetch(new Request(`https://cp.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
  await Promise.all(pending);
  return { status: res.status, json: await res.json() };
}

describe("③ interview-pack / interview-answer 라우트", () => {
  it("interviewFeaturesFor: 역추론 지시서면 must = 확인됨, 없으면 항목 + 클라이언트 확인 id", () => {
    assert.deepEqual(interviewFeaturesFor({ devSpec: inferredDevSpec(), items: ITEMS }, []), {
      basis: "dev_spec",
      features: [{ title: "날짜 선택 예약", confirmed: true }, { title: "후기 작성", confirmed: false }],
    });
    assert.deepEqual(interviewFeaturesFor({ devSpec: null, items: ITEMS }, ["req_002"]), {
      basis: "items",
      features: [{ title: "원하는 날짜를 골라 예약할 수 있다", confirmed: false }, { title: "후기를 남길 수 있다", confirmed: true }],
    });
    assert.deepEqual(interviewFeaturesFor({ devSpec: { broken: true }, items: [] }, []), { basis: "none", features: [] });
  });

  it("interview-pack: 지시서 요약 + 앱 주소로 조립, LLM 호출 없음", async () => {
    const env = { ENVIRONMENT: "test", DB: makeDb({ devSpec: inferredDevSpec() }) };
    const r = await post(env, `/workspace/projects/${PROJECT}/interview-pack`, { userKey: USER, locale: "ko" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.featureCount, 2);
    assert.equal(r.json.unconfirmedCount, 1);
    assert.match(r.json.prompt, /제 앱: \(주\)트루픽셀 예약 앱 \(https:\/\/truepixel-yeyak\.example\.app\/\)/);
    assert.match(r.json.prompt, /\[제가 맞다고 확인한 기능\]\n- 날짜 선택 예약\n\[아직 확인하지 않은 기능/);
  });

  it("interview-pack / interview-answer: 남의 프로젝트·없는 프로젝트 → 404, 확인 id 모양 틀림 → 400", async () => {
    const env = { ENVIRONMENT: "test", DB: makeDb() };
    for (const path of ["interview-pack", "interview-answer"]) {
      const r = await post(env, `/workspace/projects/wsp_other/${path}`, { userKey: USER, answer: GOOD_KO });
      assert.equal(r.status, 404, path);
    }
    const bad = await post(env, `/workspace/projects/${PROJECT}/interview-pack`, { userKey: USER, confirmedItemIds: "req_001" });
    assert.equal(bad.status, 400);
  });

  it("interview-answer: 회수 200 · 못 읽음 422(이유) · 너무 김 400 — 저장 안 하고 계측은 개수만", async () => {
    const env = { ENVIRONMENT: "test", DB: makeDb() };
    const r = await post(env, `/workspace/projects/${PROJECT}/interview-answer`, { userKey: USER, answer: GOOD_KO });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.answer.must, ["원하는 날짜를 골라 예약할 수 있다", "예약 확인 화면에 고른 날짜가 보인다"]);
    const bad = await post(env, `/workspace/projects/${PROJECT}/interview-answer`, { userKey: USER, answer: "그냥 잡담이에요" });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json, { ok: false, error: "answer_unreadable", reason: "no_format" });
    const long = await post(env, `/workspace/projects/${PROJECT}/interview-answer`, { userKey: USER, answer: "가".repeat(MAX_ANSWER_CHARS + 1) });
    assert.equal(long.status, 400);
    assert.equal(long.json.error, "answer_too_long");
    // 저장 안 함: 프로젝트 행 쓰기 0. 계측 이벤트에는 원문이 없다(개수·이유만).
    assert.ok(!env.DB.writes.some((w) => w.sql.includes("workspace_projects")));
    const events = env.DB._events.filter((e) => e.event_type === "workspace_interview_answer_parsed");
    assert.equal(events.length, 2);
    for (const e of events) assert.doesNotMatch(e.metadata_json, /날짜|예약|잡담/);
  });
});

// ─── ④ 관통: 회수 → 반영 → 미러 → 역추론 지시서 → 다음 검수 ──────────────────

const usage = { input_tokens: 5, output_tokens: 7 };
function passOf(prompt) {
  if (/작업 분해|work breakdown/i.test(prompt)) return "plan";
  if (/화면·데이터·API|screens · data/i.test(prompt)) return "surfaces";
  return "requirements";
}
/** 모델 응답: 확인된 두 항목 → FR-001·FR-002(must), 읽어낸 후기 → FR-101(모델은 must라 우긴다). */
const P1 = {
  features: [
    { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약", priority: "must" },
    { id: "FR-002", title: "예약 확인에 날짜 표시", description: "확인 화면에 고른 날짜", priority: "must" },
    { id: "FR-101", title: "후기 작성", description: "방문 후기", priority: "must" },
  ],
  acceptance: [
    { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "10월 3일을 고르고 '예약하기'를 누르면", then: "예약이 접수되고 10월 3일이 보인다", verifiedBy: "browser" },
    { id: "AC-002", featureId: "FR-002", given: "예약 접수 후", when: "확인 화면을 보면", then: "고른 날짜 10월 3일이 보인다", verifiedBy: "browser" },
    { id: "AC-003", featureId: "FR-101", given: "방문 후", when: "후기를 등록하면", then: "후기 목록에 새 글이 보인다", verifiedBy: "browser" },
  ],
};
const P2 = { screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: [], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001", "FR-002"] }], dataModel: [], apis: [], nonFunctional: [] };
const P3 = {
  workBreakdown: [{ id: "WBS-001", title: "예약", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002", "AC-003"] }],
  testPlan: [
    { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "'예약하기' 누르기"] },
    { kind: "browser", acceptanceId: "AC-002", steps: ["/ 열기", "'예약하기' 누르기", "확인 화면 보기"] },
    { kind: "browser", acceptanceId: "AC-003", steps: ["/ 열기", "'등록' 누르기"] },
  ],
  assumptions: [], openQuestions: [],
};
const llmStub = async (url, init) => {
  const u = String(url);
  if (u.startsWith(APP_URL)) return new Response("<html><body><h1>트루픽셀 예약</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  const prompt = JSON.parse(init.body).messages[0].content;
  const pass = passOf(prompt);
  const obj = pass === "requirements" ? P1 : pass === "surfaces" ? P2 : P3;
  return new Response(JSON.stringify({ model: "claude-opus-5", content: [{ type: "text", text: JSON.stringify(obj).slice(1) }], usage }), { status: 200, headers: { "content-type": "application/json" } });
};
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

describe("④ 관통 — 회수한 의도가 다음 검수의 intent·acceptancePlan이 된다", () => {
  it("답 회수 → 로컬 반영(대시보드 함수) → 미러 → 역추론 지시서(확인 must) → 검수 디스패치", async () => {
    __resetAnthropicBreaker();
    const recorder = { names: [], calls: [] };
    const env = { ENVIRONMENT: "test", ANTHROPIC_API_KEY: "test-anthropic-key", INTERNAL_CALLBACK_TOKEN: "tok", INSPECTOR: makeDoStub(recorder), DB: makeDb() };

    // 1) 유저가 붙여넣은 AI의 답 회수(서버, 저장 안 함)
    const parsed = await post(env, `/workspace/projects/${PROJECT}/interview-answer`, { userKey: USER, answer: `인터뷰를 마쳤어요.\n${GOOD_KO}` });
    assert.equal(parsed.status, 200);

    // 2) 대시보드가 로컬(정본)에 반영 — "맞나요?" 카드는 건너뛴 상태(확인 id 없음)
    const applied = applyInterviewAnswer({
      answer: parsed.json.answer,
      current: { oneLine: "미용실 예약 앱", requirements: ITEMS.map((i) => ({ id: i.id, title: i.title })), productSpec: brief, confirmedItemIds: [] },
      locale: "ko",
    });
    assert.deepEqual(applied.confirmedItemIds, ["req_001", "req_iv_001"]);

    // 3) 미러(mirrorLocalProjectToDb와 같은 페이로드) → D1 행이 회수 결과를 갖는다
    const requirements = [...ITEMS, ...applied.newRequirements.map((n) => ({ ...n, status: "not_started", criteria: [] }))];
    const mirrored = await post(env, "/workspace/projects", {
      id: PROJECT, userKey: USER, title: "(주)트루픽셀 예약 앱", idea: applied.oneLine, understood: {},
      productSpec: applied.productSpec, items: requirements, entryPath: "code",
    });
    assert.equal(mirrored.status, 200, JSON.stringify(mirrored.json));

    // 4) 확인 id를 동봉해 역추론 지시서 생성(intent-ruler.ts와 같은 요청)
    const gen = await withFetch(llmStub, () =>
      post(env, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko", confirmedItemIds: applied.confirmedItemIds }));
    assert.equal(gen.status, 200, JSON.stringify(gen.json).slice(0, 300));
    assert.deepEqual(gen.json.devSpec.meta.provenance.userConfirmedAcIds, ["AC-001", "AC-002"]);

    // 5) 다음 검수(보통 실행) — intent = 회수한 의도, acceptancePlan = 확인 must 먼저
    const run = await post(env, `/workspace/projects/${PROJECT}/visual-checks/run`, { userKey: USER, locale: "ko" });
    assert.equal(run.status, 202, JSON.stringify(run.json));
    assert.equal(run.json.check.intent, "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것");
    const payload = recorder.calls[0].body;
    assert.equal(payload.intent, "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 것");
    assert.deepEqual(payload.acceptancePlan.map((s) => `${s.acceptanceId}:${s.priority}`), ["AC-001:must", "AC-002:must", "AC-003:should"]);
    assert.equal(payload.acceptancePlan[1].then, "고른 날짜 10월 3일이 보인다");
  });
});
