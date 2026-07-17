/**
 * simsa-inspection-fixtures — vibe-app archetypes with KNOWN ground truth,
 * used to measure the production inspection verdict accuracy.
 * Design: docs/simsa-inspection-accuracy-eval-2026-07-17.md (F1~F5).
 *
 * Styled like typical v0/Lovable output (gradient hero, emoji, single page)
 * so the targets resemble what Simsa's real users actually inspect.
 */

const SHELL = (title, body, extraHead = "") => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${extraHead}
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; min-height: 100vh;
         background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 40px; max-width: 460px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,.25); }
  h1 { font-size: 26px; margin-bottom: 8px; }
  p.sub { color: #666; margin-bottom: 24px; font-size: 14px; }
  .row { display: flex; gap: 8px; margin-bottom: 16px; }
  input { flex: 1; padding: 12px 14px; border: 2px solid #e2e2f0; border-radius: 10px; font-size: 15px; }
  button { padding: 12px 20px; border: 0; border-radius: 10px; font-size: 15px; font-weight: 600;
           color: #fff; background: linear-gradient(135deg, #667eea, #764ba2); cursor: pointer; }
  ul { list-style: none; } li { padding: 10px 12px; background: #f5f5fb; border-radius: 8px; margin-bottom: 8px; }
  .result { padding: 14px; background: #f0fdf4; border-radius: 10px; font-size: 16px; min-height: 20px; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

// F1 — fully working todo. Clicking the CTA always produces a visible change
// (empty input falls back to a default item), and items persist in localStorage.
const WORKING_TODO = SHELL(
  "오늘 할 일 ✅",
  `<h1>✅ 오늘 할 일</h1>
<p class="sub">할 일을 적고 추가 버튼을 누르세요</p>
<div class="row"><input id="t" placeholder="예: 우유 사기"><button id="add">추가</button></div>
<ul id="list"></ul>
<script>
  const list = document.getElementById("list");
  const saved = JSON.parse(localStorage.getItem("todos") || "[]");
  const render = () => { list.innerHTML = saved.map(t => "<li>📝 " + t + "</li>").join(""); };
  document.getElementById("add").addEventListener("click", () => {
    const v = document.getElementById("t").value.trim() || "새 할 일";
    saved.push(v); localStorage.setItem("todos", JSON.stringify(saved));
    document.getElementById("t").value = ""; render();
  });
  render();
</script>`,
);

// F2 — WORKING but noisy: analytics + ad scripts from allowlisted-noise domains
// fail to load, and a legacy console.error fires — yet the core feature works.
// A correct verdict ignores the noise (#347) and says it works.
const NOISY_WORKING = SHELL(
  "단위 변환기 📏",
  `<h1>📏 단위 변환기</h1>
<p class="sub">킬로미터를 마일로 바꿔드려요</p>
<div class="row"><input id="km" type="number" placeholder="예: 5"><button id="go">변환하기</button></div>
<div class="result" id="out">결과가 여기에 표시됩니다</div>
<script>
  console.error("[legacy] deprecated config format — please migrate"); // harmless noise
  document.getElementById("go").addEventListener("click", () => {
    const km = parseFloat(document.getElementById("km").value) || 5;
    document.getElementById("out").textContent = km + " km = " + (km * 0.621371).toFixed(2) + " miles 🎉";
  });
</script>`,
  `<script async src="https://www.google-analytics.com/analytics.js"></script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>`,
);

// F3 — POTEMKIN: pretty UI, the save button POSTs to a nonexistent Supabase
// backend and silently does nothing. Looks finished, is not wired.
const POTEMKIN_CRM = SHELL(
  "고객 메모장 💼",
  `<h1>💼 고객 메모장</h1>
<p class="sub">고객 이름과 메모를 저장하고 관리하세요</p>
<div class="row"><input id="n" placeholder="고객 이름과 메모"><button id="save">저장</button></div>
<ul id="notes"><li>💬 (아직 저장된 메모가 없습니다)</li></ul>
<script>
  document.getElementById("save").addEventListener("click", async () => {
    try {
      await fetch("https://xyzzy-nonexistent-simsa-eval.supabase.co/rest/v1/notes", {
        method: "POST",
        headers: { "content-type": "application/json", apikey: "anon-key" },
        body: JSON.stringify({ note: document.getElementById("n").value }),
      });
      // (unreachable — and even on success nothing would re-render)
    } catch (e) { /* swallowed: the classic silent Potemkin */ }
  });
</script>`,
);

// F4 — JS crash at load: the handler is never attached, the button is dead.
const JS_CRASH = SHELL(
  "환율 계산기 💱",
  `<h1>💱 환율 계산기</h1>
<p class="sub">원화를 달러로 계산해드려요</p>
<div class="row"><input id="won" type="number" placeholder="예: 10000"><button id="calc">계산하기</button></div>
<div class="result" id="usd">결과가 여기에 표시됩니다</div>
<script>
  const rates = undefined;
  const base = rates.USD; // TypeError: crashes before the handler binds
  document.getElementById("calc").addEventListener("click", () => {
    document.getElementById("usd").textContent = (document.getElementById("won").value / base).toFixed(2) + " USD";
  });
</script>`,
);

// F5 — 200 OK, effectively empty body.
const BLANK = `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>`;

const INDEX = SHELL(
  "Simsa inspection fixtures",
  `<h1>Simsa inspection fixtures</h1>
<p class="sub">docs/simsa-inspection-accuracy-eval-2026-07-17.md</p>
<ul>
  <li><a href="/working-todo">F1 /working-todo — 작동</a></li>
  <li><a href="/noisy-working">F2 /noisy-working — 작동+노이즈</a></li>
  <li><a href="/potemkin-crm">F3 /potemkin-crm — Potemkin</a></li>
  <li><a href="/js-crash">F4 /js-crash — JS 크래시</a></li>
  <li><a href="/blank">F5 /blank — 빈 페이지</a></li>
</ul>`,
);

const ROUTES = {
  "/": INDEX,
  "/working-todo": WORKING_TODO,
  "/noisy-working": NOISY_WORKING,
  "/potemkin-crm": POTEMKIN_CRM,
  "/js-crash": JS_CRASH,
  "/blank": BLANK,
};

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const html = ROUTES[pathname];
    if (!html) return new Response("not found", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
