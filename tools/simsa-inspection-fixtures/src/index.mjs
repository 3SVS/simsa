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

// F7 — HEAVY working site (E-corpus-1, 2026-07-19): thousands of DOM nodes +
// continuous CSS animations + artificially slow initial content, to reproduce
// the "heavy marketing site hits the wall-clock rail" class WITHOUT touching a
// real production site. The app itself works (localStorage todo like F1); the
// point is whether the inspector returns a PARTIAL report instead of an empty
// timeout when a page is this heavy. Ground truth: working (must not read false).
const HEAVY_SITE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>헤비 랜딩 🏔️</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:-apple-system,'Segoe UI',sans-serif;background:linear-gradient(135deg,#0f172a,#334155);color:#fff}
  .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px}
  h1{font-size:34px}
  .row{display:flex;gap:8px} input{padding:12px 14px;border-radius:10px;border:0;font-size:15px}
  button{padding:12px 20px;border:0;border-radius:10px;font-weight:700;color:#fff;background:#6366f1;cursor:pointer}
  ul{list-style:none;margin-top:12px;max-width:420px;width:100%} li{padding:8px 12px;background:rgba(255,255,255,.08);border-radius:8px;margin-bottom:6px}
  /* 수백 개의 애니메이션 요소 — collect/observe를 느리게 만든다 */
  .fx{position:absolute;width:8px;height:8px;border-radius:50%;background:rgba(129,140,248,.5);animation:float 6s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-40px)}}
  .grid{display:grid;grid-template-columns:repeat(20,1fr);gap:4px;margin-top:24px;max-width:900px}
  .cell{aspect-ratio:1;background:rgba(255,255,255,.05);border-radius:4px;animation:pulse 4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.3}50%{opacity:.8}}
</style></head>
<body>
<div class="hero">
  <h1>🏔️ 오늘의 기록장</h1>
  <p class="sub">무거운 랜딩 — 그래도 작동해야 합니다</p>
  <div class="row"><input id="m" placeholder="기록할 내용"><button id="add">추가</button></div>
  <ul id="list"><li>💬 (아직 기록이 없습니다)</li></ul>
  <div class="grid" id="grid"></div>
</div>
<script>
  // 큰 DOM: 400개 셀 + 200개 떠다니는 점 (collectCtas의 200개 slice·$$eval을 느리게)
  const grid=document.getElementById("grid");
  for(let i=0;i<400;i++){const d=document.createElement("div");d.className="cell";d.style.animationDelay=(i%40)/10+"s";grid.appendChild(d);}
  for(let i=0;i<200;i++){const d=document.createElement("div");d.className="fx";d.style.left=Math.random()*100+"vw";d.style.top=Math.random()*100+"vh";d.style.animationDelay=Math.random()*6+"s";document.body.appendChild(d);}
  // 실제 저장 있는 todo (F1과 동일 — 작동함이 정답)
  const saved=JSON.parse(localStorage.getItem("heavy_todos")||"[]");
  const list=document.getElementById("list");
  const render=()=>{list.innerHTML=saved.length?saved.map(t=>"<li>📝 "+t+"</li>").join(""):"<li>💬 (아직 기록이 없습니다)</li>";};
  render();
  document.getElementById("add").addEventListener("click",()=>{const v=document.getElementById("m").value||"기록";saved.push(v);localStorage.setItem("heavy_todos",JSON.stringify(saved));document.getElementById("m").value="";render();});
</script>
</body></html>`;

// F6 — OPTIMISTIC GHOST (G4-①, 2026-07-18): adds the item to the DOM on click
// so everything LOOKS working (visible change, no network call, no console
// error) — but stores nothing anywhere. Only the reload-persistence check can
// tell this apart from F1. The classic "메모리에만 있는 앱".
const OPTIMISTIC_GHOST = SHELL(
  "오늘의 기록장 📔",
  `<h1>📔 오늘의 기록장</h1>
<p class="sub">오늘 있었던 일을 기록해보세요</p>
<div class="row"><input id="m" placeholder="기록할 내용"><button id="add">추가</button></div>
<ul id="list"><li>💬 (아직 기록이 없습니다)</li></ul>
<script>
  document.getElementById("add").addEventListener("click", () => {
    const v = document.getElementById("m").value || "기록";
    const li = document.createElement("li");
    li.textContent = "📝 " + v;
    document.getElementById("list").appendChild(li);
    document.getElementById("m").value = "";
    // 저장은 어디에도 하지 않는다 — 새로고침하면 전부 사라진다.
  });
</script>`,
);

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
  <li><a href="/optimistic-ghost">F6 /optimistic-ghost — 화면만 추가, 저장 없음</a></li>
  <li><a href="/heavy-site">F7 /heavy-site — 무거운 랜딩(작동함, E-corpus-1)</a></li>
</ul>`,
);

const ROUTES = {
  "/": INDEX,
  "/working-todo": WORKING_TODO,
  "/noisy-working": NOISY_WORKING,
  "/potemkin-crm": POTEMKIN_CRM,
  "/js-crash": JS_CRASH,
  "/blank": BLANK,
  "/optimistic-ghost": OPTIMISTIC_GHOST,
  "/heavy-site": HEAVY_SITE,
};

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const html = ROUTES[pathname];
    if (!html) return new Response("not found", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
};
