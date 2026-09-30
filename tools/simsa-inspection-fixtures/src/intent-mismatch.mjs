/**
 * intent-mismatch.mjs — 문 (c) "만들었는데 생각과 달라요" 픽스처 10변형 (C-A7, 2026-10-01).
 *
 * 정답지(먼저 커밋됨): docs/pilot-2026-10/intent-mismatch-answer-key.md
 *                     tools/simsa-inspection-fixtures/intent-mismatch-answer-key.json
 *
 * 전부 **작동은 하는** 앱이다 — 버튼이 눌리고, 화면이 바뀌고, 오류가 없다. 다른 것은 의도다.
 * 그래서 이 픽스처들은 "고장"이 아니라 "기준과 다름"을 재는 자다.
 *
 * 지켜야 할 것(정답지 §설계상 주의 — 정적 테스트가 고정한다):
 *  - 핵심 흐름의 지속성 확인은 목록(li)이 자랄 때만 새로고침한다. IM07만 저장하지 않는다.
 *    목록이 자라는 IM06·IM09는 저장해 "사라짐"으로 잘못 걸리지 않게 하고, 나머지는 결과를
 *    목록이 아닌 칸에 쓴다.
 *  - 판정은 부분 문자열 일치다. mismatch 기준의 내용어가 화면(버튼 글 포함)에 나오지 않게 문구를
 *    골랐다 — 예: IM02 화면에는 그 화폐 단위 글자가 한 번도 없다. 문구를 바꾸면 정답지와 대조가 깨진다.
 */

const shell = (title, body, extraHead = "") => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${extraHead}
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; min-height: 100vh;
         background: linear-gradient(135deg, #f6d365 0%, #fda085 100%);
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 36px; max-width: 480px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,.2); }
  h1 { font-size: 24px; margin-bottom: 8px; }
  p.sub { color: #666; margin: 8px 0 16px; font-size: 14px; }
  .row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  input { flex: 1; padding: 12px 14px; border: 2px solid #eee; border-radius: 10px; font-size: 15px; }
  button, a.btn { padding: 12px 18px; border: 0; border-radius: 10px; font-size: 15px; font-weight: 600;
           color: #fff; background: #ef6c57; cursor: pointer; text-decoration: none; display: inline-block; }
  ul { list-style: none; padding: 0; } li { padding: 10px 12px; background: #fff7f2; border-radius: 8px; margin-bottom: 8px; }
  li button { padding: 4px 10px; font-size: 13px; margin-left: 8px; background: #999; }
  .result { padding: 12px; background: #f0fdf4; border-radius: 10px; font-size: 15px; min-height: 20px; }
  .result p { margin: 4px 0; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

// IM01 — 예약은 되는데 날짜를 고를 수 없다(항상 오늘).
const BOOKING_NO_DATE = shell(
  "동네 미용실 예약",
  `<h1>✂️ 동네 미용실 예약</h1>
<p class="sub">이름을 적고 예약하기를 누르면 바로 접수돼요</p>
<div class="row"><input id="n" placeholder="예약자 이름"><button id="go">예약하기</button></div>
<div class="result" id="out"></div>
<script>
  document.getElementById("go").addEventListener("click", () => {
    const n = document.getElementById("n").value.trim() || "손님";
    document.getElementById("out").textContent = "예약이 접수되었어요 — 예약자: " + n + " · 방문: 오늘";
  });
</script>`,
);

// IM02 — 주문은 되는데 가격·합계가 달러로 나온다.
const PRICE_IN_DOLLARS = shell(
  "동네 꽃집 주문",
  `<h1>💐 동네 꽃집 주문</h1>
<p class="sub">꽃다발을 고르고 담기를 누르세요</p>
<ul><li>장미 꽃다발 — $12.00</li><li>튤립 꽃다발 — $9.50</li></ul>
<div class="row"><input id="to" placeholder="받는 분 이름"><button id="add">담기</button></div>
<div class="result" id="cart"></div>
<script>
  document.getElementById("add").addEventListener("click", () => {
    const to = document.getElementById("to").value.trim() || "받는 분";
    document.getElementById("cart").textContent = "장바구니: 장미 꽃다발 1개 · 합계 $12.00 · 받는 분: " + to;
  });
</script>`,
);

// IM03 — 목록은 나오는데 오래된 공지부터(최신이 맨 아래).
const SORT_REVERSED = shell(
  "아파트 공지 게시판",
  `<h1>📢 아파트 공지 게시판</h1>
<p class="sub">공지 목록 보기를 누르면 공지가 나타나요</p>
<button id="show">공지 목록 보기</button>
<ul id="list"></ul>
<p class="sub" id="count"></p>
<script>
  const notices = ["9월 1일 · 분리수거 요일 변경", "9월 15일 · 엘리베이터 점검", "9월 30일 · 추석 연휴 관리사무소 휴무"];
  document.getElementById("show").addEventListener("click", () => {
    document.getElementById("list").innerHTML = notices.map((t) => "<li>" + t + "</li>").join("");
    document.getElementById("count").textContent = "총 3건";
  });
</script>`,
);

// IM04 — 신청은 되는데 꼭 받아야 할 칸이 없다(이름만 받는다).
const REQUIRED_FIELD_MISSING = shell(
  "무료 체험 신청",
  `<h1>🧪 무료 체험 신청</h1>
<p class="sub">이름을 적고 신청하기를 눌러 주세요</p>
<div class="row"><input id="n" placeholder="신청자 이름"><button id="go">신청하기</button></div>
<div class="result" id="out"></div>
<script>
  document.getElementById("go").addEventListener("click", () => {
    const n = document.getElementById("n").value.trim() || "신청자";
    document.getElementById("out").textContent = "신청이 완료되었어요: " + n + "님";
  });
</script>`,
);

// IM05 — '장바구니 보기'가 다른 화면(고객센터)으로 간다. '찜하기'는 제대로 된다.
const BUTTON_WRONG_PAGE = shell(
  "무선 이어폰 스토어",
  `<h1>🎧 무선 이어폰 스토어</h1>
<p class="sub">무선 이어폰 — 59,000원</p>
<div class="row"><a class="btn" href="/intent-mismatch/button-wrong-page/help">장바구니 보기</a><button id="like">찜하기</button></div>
<div class="result" id="out"></div>
<script>
  document.getElementById("like").addEventListener("click", () => {
    document.getElementById("out").textContent = "찜 목록에 담았어요: 무선 이어폰";
  });
</script>`,
);

const BUTTON_WRONG_PAGE_HELP = shell(
  "고객센터",
  `<h1>📞 고객센터</h1>
<p class="sub">자주 묻는 질문</p>
<ul><li>배송은 2~3일 걸려요</li><li>교환은 7일 안에 가능해요</li></ul>
<a class="btn" href="/intent-mismatch/button-wrong-page">처음으로</a>`,
);

// IM06 — 한국어 앱인데 완료 안내만 영어. 저장은 제대로 된다(새로고침해도 남는다).
const ENGLISH_COPY = shell(
  "동네 가게 메모",
  `<h1>🍜 동네 가게 메모</h1>
<p class="sub">가게 이름을 적고 저장을 누르세요</p>
<div class="row"><input id="n" placeholder="가게 이름"><button id="save">저장</button></div>
<div class="result" id="msg"></div>
<p class="sub">내 가게 목록</p>
<ul id="list"></ul>
<script>
  const KEY = "im06_places";
  const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
  const render = () => {
    document.getElementById("list").innerHTML = saved.map((p) => "<li>📍 " + p + "</li>").join("");
  };
  document.getElementById("save").addEventListener("click", () => {
    const v = document.getElementById("n").value.trim() || "가게";
    saved.push(v);
    localStorage.setItem(KEY, JSON.stringify(saved));
    document.getElementById("n").value = "";
    document.getElementById("msg").textContent = "Saved! Your place was added.";
    render();
  });
  render();
</script>`,
);

// IM07 — 추가하면 목록에 보이지만 어디에도 저장하지 않는다(새로고침하면 사라진다).
const NOT_PERSISTED = shell(
  "독서 기록장",
  `<h1>📚 독서 기록장</h1>
<p class="sub">읽은 책 제목을 적고 기록 추가를 누르세요</p>
<div class="row"><input id="t" placeholder="책 제목"><button id="add">기록 추가</button></div>
<p class="sub">내 책 목록</p>
<ul id="list"></ul>
<script>
  document.getElementById("add").addEventListener("click", () => {
    const v = document.getElementById("t").value.trim() || "책";
    document.getElementById("list").insertAdjacentHTML("beforeend", "<li>📖 " + v + "</li>");
    document.getElementById("t").value = "";
  });
</script>`,
);

// IM08 — 검색은 되는데 이름을 정확히 다 적어야만 나온다(부분 일치 없음).
const SEARCH_EXACT_ONLY = shell(
  "동네 카페 찾기",
  `<h1>☕ 동네 카페 찾기</h1>
<p class="sub">카페 이름으로 검색해 보세요</p>
<div class="row"><input id="q" placeholder="카페 이름 검색"><button id="find">검색</button><button id="all">전체 보기</button></div>
<div class="result" id="out"></div>
<script>
  const cafes = ["서울숲 로스터리", "성수 브루어스", "망원 베이커리"];
  document.getElementById("find").addEventListener("click", () => {
    const q = document.getElementById("q").value.trim();
    const hit = cafes.filter((n) => n === q);
    document.getElementById("out").innerHTML = hit.length
      ? hit.map((n) => "<p>" + n + "</p>").join("")
      : "검색 결과가 없어요";
  });
  document.getElementById("all").addEventListener("click", () => {
    document.getElementById("out").innerHTML = "<p>전체 목록 (3곳)</p>" + cafes.map((n) => "<p>" + n + "</p>").join("");
  });
</script>`,
);

// IM09 — 삭제 버튼이 묻지 않고 바로 지운다. 추가·저장은 제대로 된다.
const DELETE_NO_CONFIRM = shell(
  "팀 메모 보드",
  `<h1>🗒️ 팀 메모 보드</h1>
<p class="sub">메모를 추가하거나 지울 수 있어요</p>
<div class="row"><input id="m" placeholder="메모 내용"><button id="add">추가</button></div>
<ul id="list"></ul>
<script>
  const KEY = "im09_memos";
  const memos = JSON.parse(localStorage.getItem(KEY) || "null") || ["회의는 목요일 오후 3시", "간식은 금요일에"];
  const persist = () => localStorage.setItem(KEY, JSON.stringify(memos));
  const render = () => {
    const list = document.getElementById("list");
    list.innerHTML = "";
    memos.forEach((text, i) => {
      const li = document.createElement("li");
      li.textContent = text;
      const del = document.createElement("button");
      del.textContent = "삭제";
      del.addEventListener("click", () => { memos.splice(i, 1); persist(); render(); });
      li.appendChild(del);
      list.appendChild(li);
    });
  };
  document.getElementById("add").addEventListener("click", () => {
    const v = document.getElementById("m").value.trim() || "메모";
    memos.push(v);
    persist();
    document.getElementById("m").value = "";
    render();
  });
  render();
</script>`,
);

// IM10 — 넓은 화면에서는 되는데 좁은 화면(휴대폰)에서는 핵심 버튼이 사라진다.
const MOBILE_BUTTON_HIDDEN = shell(
  "배드민턴 코트 예약",
  `<h1>🏸 배드민턴 코트 예약</h1>
<p class="sub">원하는 시간을 적고 예약 요청을 누르세요</p>
<div class="row"><input id="t" placeholder="원하는 시간"><button id="req">예약 요청</button></div>
<div class="result" id="out"></div>
<script>
  document.getElementById("req").addEventListener("click", () => {
    const t = document.getElementById("t").value.trim() || "저녁 7시";
    document.getElementById("out").textContent = "예약 요청을 보냈어요: " + t;
  });
</script>`,
  `<style>
  @media (max-width: 480px) { #req { display: none; } }
</style>`,
);

/** 경로 → HTML. index.mjs의 ROUTES에 합쳐진다. */
export const INTENT_MISMATCH_ROUTES = {
  "/intent-mismatch/booking-no-date": BOOKING_NO_DATE,
  "/intent-mismatch/price-in-dollars": PRICE_IN_DOLLARS,
  "/intent-mismatch/sort-reversed": SORT_REVERSED,
  "/intent-mismatch/required-field-missing": REQUIRED_FIELD_MISSING,
  "/intent-mismatch/button-wrong-page": BUTTON_WRONG_PAGE,
  "/intent-mismatch/button-wrong-page/help": BUTTON_WRONG_PAGE_HELP,
  "/intent-mismatch/english-copy": ENGLISH_COPY,
  "/intent-mismatch/not-persisted": NOT_PERSISTED,
  "/intent-mismatch/search-exact-only": SEARCH_EXACT_ONLY,
  "/intent-mismatch/delete-no-confirm": DELETE_NO_CONFIRM,
  "/intent-mismatch/mobile-button-hidden": MOBILE_BUTTON_HIDDEN,
};

/** 인덱스 화면용 목록(id · 경로 · 한 줄). */
export const INTENT_MISMATCH_INDEX = [
  ["IM01", "/intent-mismatch/booking-no-date", "예약 — 날짜 선택 없음"],
  ["IM02", "/intent-mismatch/price-in-dollars", "꽃집 — 가격이 달러"],
  ["IM03", "/intent-mismatch/sort-reversed", "공지 — 오래된 순"],
  ["IM04", "/intent-mismatch/required-field-missing", "체험 신청 — 필수 칸 없음"],
  ["IM05", "/intent-mismatch/button-wrong-page", "스토어 — 버튼이 다른 화면으로"],
  ["IM06", "/intent-mismatch/english-copy", "가게 메모 — 안내가 영어"],
  ["IM07", "/intent-mismatch/not-persisted", "독서 기록 — 새로고침하면 사라짐"],
  ["IM08", "/intent-mismatch/search-exact-only", "카페 찾기 — 부분 검색 안 됨"],
  ["IM09", "/intent-mismatch/delete-no-confirm", "팀 메모 — 묻지 않고 삭제"],
  ["IM10", "/intent-mismatch/mobile-button-hidden", "코트 예약 — 휴대폰에서 버튼 사라짐"],
];
