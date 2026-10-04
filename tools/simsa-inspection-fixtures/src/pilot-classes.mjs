/**
 * pilot-classes.mjs — 2026-10-04 파일럿 사전 실측에서 Simsa가 틀린 고장 유형 4가지의 픽스처.
 * 근거: docs/pilot-2026-10/simsa-accuracy-run-2026-10-04.md (실제 앱 4개 중 정답 0).
 * 정답지: docs/pilot-2026-10/pilot-classes-answer-key.md + ../pilot-classes-answer-key.json
 * (엔진 수정보다 **먼저** 커밋 — 같은 PR의 첫 커밋).
 *
 *   F9  /http-404            — 호스트의 "배포 없음" 404 페이지(v0 결과물이 이랬다). 상태 404.
 *   F10 /canned-result       — 주소를 넣으면 늘 **같은 결과**(78점)를 그린다. 요청 0(ChatGPT 앱).
 *   F11 /self-checklist      — 주소를 넣으면 저장 요청만 하고, "검토"는 사용자가 직접 체크하는 표(Bolt 앱).
 *   F12 /real-echo-checker   — 대조군: 주소를 넣으면 서버가 그 주소를 실제로 열어 보고 결과가 입력마다 다르다.
 */

const SHELL = (title, body) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; min-height: 100vh; background: #f6f7fb;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border-radius: 16px; padding: 36px; max-width: 560px; width: 100%;
          box-shadow: 0 12px 40px rgba(0,0,0,.12); }
  h1 { font-size: 24px; margin-bottom: 8px; } p.sub { color: #666; margin-bottom: 20px; font-size: 14px; }
  label { display: block; font-size: 13px; color: #444; margin: 10px 0 6px; }
  input, textarea { width: 100%; padding: 12px 14px; border: 2px solid #e2e2f0; border-radius: 10px; font-size: 15px; }
  button { margin-top: 14px; padding: 12px 20px; border: 0; border-radius: 10px; font-size: 15px; font-weight: 600;
           color: #fff; background: #4f46e5; cursor: pointer; }
  .result { margin-top: 20px; padding: 16px; background: #f5f5fb; border-radius: 10px; font-size: 14px; line-height: 1.6; }
  .item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .opts span { margin-left: 6px; padding: 2px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;

// F9 — Vercel류 호스트의 "배포 없음" 페이지. 상태 404, 문서 링크 버튼 하나(v0 결과물 그대로의 모양).
export const HTTP_404_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>404: NOT_FOUND</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{max-width:420px;text-align:center}code{display:block;margin:12px 0;color:#666}a{display:inline-block;margin-top:16px;padding:10px 16px;border:1px solid #ddd;border-radius:8px;color:#111;text-decoration:none}</style></head>
<body><div class="box"><h1>404</h1><p>This page doesn’t exist</p><p>It may have been moved, removed, or never existed.</p>
<code>404: NOT_FOUND<br>Code: DEPLOYMENT_NOT_FOUND</code>
<a href="https://vercel.com/docs/errors/DEPLOYMENT_NOT_FOUND">VIEW DOCUMENTATION</a></div></body></html>`;

// F10 — 껍데기 검사기: 어떤 주소를 넣어도 같은 결과. 요청을 보내지 않는다.
const CANNED_RESULT = SHELL(
  "작동해? AI 서비스 검증",
  `<h1>✓ 작동해? AI 서비스 검증</h1>
<p class="sub">AI로 만든 서비스, 진짜 작동하나요? URL 하나만 넣어주세요. 실제 사용자처럼 써 보고 어디가 왜 고장났는지 찾아드립니다.</p>
<label for="u">서비스 주소</label><input id="u" type="url" placeholder="https://내서비스.com">
<label for="d">서비스 설명 (선택)</label><textarea id="d" rows="2" placeholder="예: 회원가입 후 상품을 구매하는 쇼핑몰입니다."></textarea>
<button id="go">내 서비스 검사하기 →</button>
<div id="out"></div>
<script>
  document.getElementById("go").addEventListener("click", () => {
    const u = document.getElementById("u").value.trim() || "https://내서비스.com";
    const out = document.getElementById("out");
    out.innerHTML = '<div class="result">검사 중… 서비스를 열어 보고 있어요</div>';
    setTimeout(() => {
      out.innerHTML = '<div class="result"><b>✓ 검사 완료 · 서비스 건강도 78/100</b><br>' + u +
        ' · 주요 사용자 흐름을 기준으로 검사했습니다.<br>사용할 수 있지만 수정이 필요한 부분이 있습니다. 2개의 문제를 발견했습니다.<br>' +
        '✓ 8 정상 △ 1 주의 × 1 오류<br><br><b>× 기능 오류</b> 로그인 기능이 작동하지 않습니다 — 로그인 요청이 서버에서 401 인증 오류를 반환하고 있습니다.<br>' +
        '<b>△ UI 문제</b> 모바일 화면에서 버튼이 잘립니다 — 390px 폭에서 주요 버튼이 화면 오른쪽 영역을 넘어갑니다.<br><br>' +
        '다른 AI에게 바로 맡기세요: 발견된 문제와 재현 방법, 수정 방향을 하나의 개발지시서로 정리했습니다. <button>개발지시서 복사</button></div>';
    }, 1500);
  });
</script>`,
);

// F11 — 자가 점검표: 저장 요청은 보내지만 주소를 검토하지 않는다. 검토는 사용자가 직접 체크.
const SELF_CHECKLIST = SHELL(
  "진단오딧 - AI 제품 검토",
  `<h1>진단오딧</h1>
<p class="sub">AI로 만든 제품을 등록하고 검토를 시작해보세요.</p>
<label for="n">프로젝트 이름</label><input id="n" placeholder="예: AI 블로그 플랫폼">
<label for="u">프로젝트 URL</label><input id="u" type="url" placeholder="https://my-project.example.com">
<button id="go">검토 시작하기</button>
<div id="out"></div>
<script>
  const ITEMS = ["핵심 기능이 정상적으로 작동하는가?", "데이터 저장/불러오기가 정상 작동하는가?", "사용자 입력이 올바르게 처리되는가?",
    "에러 발생 시 적절한 예외 처리가 있는가?", "페이지 새로고침 후에도 상태가 유지되는가?", "반응형 디자인이 적용되어 있는가?",
    "버튼/링크 클릭 시 명확한 피드백이 있는가?", "로딩 상태가 표시되는가?", "초기 로딩 속도가 적절한가?", "콘솔 에러/경고가 없는가?"];
  document.getElementById("go").addEventListener("click", async () => {
    const name = document.getElementById("n").value.trim() || "내 프로젝트";
    const url = document.getElementById("u").value.trim();
    await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url }) }).catch(() => {});
    document.getElementById("out").innerHTML = '<div class="result"><b>' + name + '</b> · ' + url +
      '<br>프로젝트 상태: 검토중 · 진단 0/' + ITEMS.length + ' — 각 항목을 직접 확인해 표시하세요.<br>' +
      ITEMS.map((t) => '<div class="item">' + t + '<span class="opts"><span>통과</span><span>실패</span><span>확인불가</span><span>미검토</span></span></div>').join("") +
      '<br>개발 지시서: 먼저 진단 체크리스트를 완료하세요.</div>';
  });
</script>`,
);

// F12 — 대조군(작동): 서버가 넣은 주소를 실제로 열어 보고, 결과가 입력마다 다르다.
const REAL_ECHO_CHECKER = SHELL(
  "주소 점검기",
  `<h1>🔎 주소 점검기</h1>
<p class="sub">앱 주소를 넣으면 실제로 열어 보고 응답 상태를 알려드려요.</p>
<label for="u">앱 주소</label><input id="u" type="url" placeholder="https://내앱.com">
<button id="go">점검하기</button>
<div id="out"></div>
<script>
  document.getElementById("go").addEventListener("click", async () => {
    const u = document.getElementById("u").value.trim();
    const out = document.getElementById("out");
    out.innerHTML = '<div class="result">점검 중…</div>';
    const r = await fetch("/api/check?url=" + encodeURIComponent(u)).then((x) => x.json()).catch(() => ({ ok: false, error: "network" }));
    out.innerHTML = r.ok
      ? '<div class="result"><b>점검 결과</b><br>주소: ' + r.host + r.path + '<br>응답 상태: ' + r.status + ' (' + r.verdict + ')<br>응답 크기: ' + r.bytes + '바이트 · 걸린 시간: ' + r.ms + 'ms</div>'
      : '<div class="result">주소를 확인할 수 없어요: ' + (r.error || "알 수 없음") + '</div>';
  });
</script>`,
);

export const PILOT_CLASS_ROUTES = {
  "/canned-result": CANNED_RESULT,
  "/self-checklist": SELF_CHECKLIST,
  "/real-echo-checker": REAL_ECHO_CHECKER,
};

/**
 * HTML이 아닌 응답(상태 코드·API)을 만드는 경로. 처리했으면 Response, 아니면 null.
 * @param {Request} request
 * @returns {Promise<Response | null>}
 */
export async function handlePilotClassRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/http-404") {
    return new Response(HTTP_404_HTML, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (url.pathname === "/api/projects" && request.method === "POST") {
    // F11: 저장했다고 답할 뿐 — 주소를 열어 보지 않는다(Bolt 앱의 Supabase insert와 같은 모양).
    return Response.json({ ok: true, id: crypto.randomUUID() });
  }
  if (url.pathname === "/api/check") {
    // F12: 넣은 주소를 실제로 연다 — 결과가 입력에 따라 달라지는 진짜 점검.
    const target = url.searchParams.get("url") ?? "";
    let parsed;
    try {
      parsed = new URL(target);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("scheme");
    } catch {
      return Response.json({ ok: false, error: "주소 형식이 아니에요" });
    }
    const t0 = Date.now();
    try {
      const r = await fetch(parsed.toString(), { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
      const body = await r.arrayBuffer();
      return Response.json({
        ok: true,
        host: parsed.host,
        path: parsed.pathname,
        status: r.status,
        verdict: r.status < 400 ? "열림" : "오류",
        bytes: body.byteLength,
        ms: Date.now() - t0,
      });
    } catch (e) {
      return Response.json({ ok: false, error: `열지 못했어요(${String(e?.name ?? "error")})` });
    }
  }
  return null;
}
