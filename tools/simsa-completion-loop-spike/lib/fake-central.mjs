// fake-central.mjs — journey-audit `--local` 모드의 가짜 central-plane (B-8 J6).
//
// 왜: J6(아이디어 → 지시서 → 만들기 → 진행 화면)은 **라이브에서 돌리면 안 된다** — [만들기]가 실제
// 빌드 잡을 시작한다(호스팅 D1 생성·컨테이너 디스패치·LLM 비용). 그래서 로컬 next build+start 위에서
// 브라우저의 API 요청을 Playwright route로 가로채 이 가짜가 답한다. 브라우저 밖으로 나가는 요청이
// 없게, 라이브 central 주소와 가짜 주소 **둘 다** 가로챈다.
//
// 순수: 네트워크·타이머 없음. handle(method, url, body) → { status, json }. 모르는 경로는 404로 답하고
// unhandled에 적는다(조용히 삼키지 않는다 — 결과 JSON에 남겨 사람이 읽는다).
//
// 서버 계약은 apps/central-plane/src/routes/workspace-build-jobs.ts와 같은 모양(응답 필드·오류 코드).
// 시나리오의 실패 문장은 실제 서버가 내는 문장 그대로다(builder-run.mjs builder_stage_not_implemented).
//
// #578 검증 결함 반영:
//  - 2: GET /workspace/build-availability — `open`(기본 true). false면 실서버의 닫힘(BUILD_OPEN 없음)과 같은 답.
//  - 3: `retryConflict: true` = **이 PR의 서버 수정 전** 실서버: 같은 프로젝트의 두 번째 POST /build는 D1 이름 충돌로
//       502 hosting_d1_failed(createProjectD1이 "이미 있음"을 성공으로 치지 않았다). 기본(false)은 수정 뒤 서버 —
//       전 잡의 D1을 다시 써서 202. 예전 가짜는 늘 202라 [다시 시도] 막다른 길을 구조적으로 못 봤다.
//  - 4: POST /workspace/export-builder-pack — 실서버처럼 빌더 팩 파일 묶음(dev-spec/ 포함, 개발 도구 프롬프트·비밀 파일 섞임)을
//       돌려준다. 화면은 그중 dev-spec/만 골라 한 문서로 받는다.

export const LIVE_CENTRAL_ORIGIN = "https://conclave-ai.seunghunbae.workers.dev";
/** `.invalid`는 절대 해석되지 않는 TLD — 로컬 빌드를 이 주소로 구우면 가로채기를 놓쳐도 라이브에 닿지 않는다. */
export const FAKE_CENTRAL_ORIGIN = "https://central.fake.invalid";
export const HOST_ROOT = "simsa.page";

/**
 * 서버 상태 흐름. 잡 상세 조회(GET …/build-jobs/:jobId) 한 번에 한 칸 나아간다(목록 조회는 나아가지 않는다
 * — 새로고침 복원이 같은 상태를 보여야 한다).
 */
export const SCENARIOS = Object.freeze({
  // 지금 실제 서버의 정직한 실패: 컨테이너가 kind=build를 아직 모른다(failedStage 없이 failedAt을 보냄 → "unknown").
  not_implemented: [
    { status: "queued" },
    { status: "queued" },
    { status: "failed", failedStage: "unknown", error: "builder_stage_not_implemented:build" },
  ],
  done: [
    { status: "queued" },
    { status: "scaffolding" },
    { status: "implementing", wbsDone: 1 },
    { status: "implementing", wbsDone: 2 },
    { status: "building", wbsDone: 3 },
    { status: "testing", wbsDone: 3 },
    { status: "deploying", wbsDone: 3 },
    { status: "done", wbsDone: 3, deployed: true },
  ],
});

/** Rule 6: 한국어 리얼 기획 — "(주)트루픽셀 예약 앱". EN 주행은 같은 기획의 영어판. */
export function devSpecFixture(locale = "ko") {
  const ko = locale !== "en";
  return {
    version: 1,
    meta: { source: "generated", locale: ko ? "ko" : "en" },
    brief: {
      productName: ko ? "(주)트루픽셀 예약 앱" : "TruePixel booking app",
      oneLine: ko ? "(주)트루픽셀 사진관의 촬영 예약을 손님이 직접 잡는 웹앱" : "A web app where TruePixel studio customers book their own photo sessions",
      targetUser: ko ? "동네 사진관 손님" : "Neighborhood photo studio customers",
      problem: ko ? "전화 예약이 겹치고 놓친다" : "Phone bookings overlap and get missed",
      included: [],
      excluded: ko ? ["온라인 결제", "앱 안 로그인"] : ["Online payment", "In-app sign-in"],
      userFlows: [],
      decisions: [],
      openDecisions: [],
    },
    features: [
      { id: "FR-1", title: ko ? "빈 시간 보고 예약하기" : "Book an open slot", description: ko ? "손님이 날짜·시간을 골라 예약한다" : "Customers pick a date and time", priority: "must" },
      { id: "FR-2", title: ko ? "예약 확인 화면" : "Booking confirmation", description: ko ? "예약 내용을 다시 보여 준다" : "Shows the booking back", priority: "must" },
      { id: "FR-3", title: ko ? "사장님 예약 목록" : "Owner's booking list", description: ko ? "사진관이 오늘 예약을 본다" : "The studio sees today's bookings", priority: "should" },
    ],
    acceptance: [
      { id: "AC-1", featureId: "FR-1", given: ko ? "빈 시간이 있다" : "a slot is open", when: ko ? "손님이 예약한다" : "a customer books it", then: ko ? "그 시간이 막힌다" : "the slot is taken", verifiedBy: "browser" },
      { id: "AC-2", featureId: "FR-2", given: ko ? "예약을 마쳤다" : "a booking was made", when: ko ? "확인 화면을 연다" : "the confirmation opens", then: ko ? "이름·시간이 보인다" : "name and time are shown", verifiedBy: "browser" },
      { id: "AC-3", featureId: "FR-3", given: ko ? "오늘 예약이 있다" : "there are bookings today", when: ko ? "사장님이 목록을 연다" : "the owner opens the list", then: ko ? "시간순으로 보인다" : "they are listed by time", verifiedBy: "browser" },
    ],
    screens: [
      { id: "SCR-1", route: "/", purpose: ko ? "예약" : "Booking", components: ["calendar"], featureIds: ["FR-1"] },
      { id: "SCR-2", route: "/done", purpose: ko ? "확인" : "Confirmation", components: ["summary"], featureIds: ["FR-2"] },
      { id: "SCR-3", route: "/admin", purpose: ko ? "사장님 목록" : "Owner list", components: ["table"], featureIds: ["FR-3"] },
    ],
    dataModel: [{ name: "Booking", fields: [{ name: "name", type: "string", required: true }, { name: "slot", type: "datetime", required: true }], ownership: "public" }],
    apis: [{ id: "API-1", method: "POST", path: "/api/bookings", auth: "none", featureIds: ["FR-1"] }],
    workBreakdown: [
      { id: "WBS-1", title: ko ? "예약 화면" : "Booking screen", order: 1, dependsOn: [], acceptanceIds: ["AC-1"] },
      { id: "WBS-2", title: ko ? "확인 화면" : "Confirmation screen", order: 2, dependsOn: ["WBS-1"], acceptanceIds: ["AC-2"] },
      { id: "WBS-3", title: ko ? "사장님 목록" : "Owner list", order: 3, dependsOn: ["WBS-1"], acceptanceIds: ["AC-3"] },
    ],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-1", steps: ["/ 열기", "빈 시간 누르기"] },
      { kind: "browser", acceptanceId: "AC-2", steps: ["예약 마치기"] },
      { kind: "browser", acceptanceId: "AC-3", steps: ["/admin 열기"] },
    ],
    assumptions: [],
    openQuestions: [],
  };
}

/** 가로챈 응답에 붙일 CORS 헤더 — 대시보드(로컬 origin)가 교차 출처 응답을 읽을 수 있게. */
export function fakeCorsHeaders(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Idempotency-Key, X-Simsa-User-Key",
    vary: "Origin",
  };
}

/**
 * 실서버 export-builder-pack(handoff)의 모양 — `simsa-build-pack/` 아래 팩 파일들 + `dev-spec/` 10개 중 일부.
 * 개발 도구용 프롬프트와 비밀 파일을 일부러 섞는다(화면이 dev-spec/만 고르는지 보려고).
 */
export function builderPackFixture(locale = "ko") {
  const d = devSpecFixture(locale);
  const ko = locale !== "en";
  const req = d.features.map((f) => `- ${f.id} ${f.title} — ${f.description}`).join("\n");
  const scr = d.screens.map((s) => `- ${s.id} ${s.route} — ${s.purpose}`).join("\n");
  return [
    { path: "simsa-build-pack/CLAUDE_CODE_PROMPT.md", content: "# Claude Code prompt (developer tool)" },
    { path: "simsa-build-pack/.env.local", content: "FAKE_ONLY=not-a-secret" },
    { path: "simsa-build-pack/dev-spec/README.md", content: `# ${d.brief.productName} — ${ko ? "개발 지시서" : "Development spec"}\n\n${d.brief.oneLine}` },
    { path: "simsa-build-pack/dev-spec/01-requirements.md", content: `# ${ko ? "요구사항" : "Requirements"}\n\n${req}` },
    { path: "simsa-build-pack/dev-spec/02-screens.md", content: `# ${ko ? "화면" : "Screens"}\n\n${scr}` },
  ];
}

/**
 * @param {{ projectId: string, scenario: keyof typeof SCENARIOS, locale?: "ko" | "en", slug?: string, open?: boolean, retryConflict?: boolean }} opts
 */
export function createFakeCentral(opts) {
  const steps = SCENARIOS[opts.scenario];
  if (!steps) throw new Error(`unknown scenario ${opts.scenario}`);
  const slug = opts.slug ?? "app-7x9k2m1q";
  const open = opts.open !== false;
  /** @type {Array<{ id: string, step: number, createdAt: string, events: Array<{ id: string, at: string, stage: string, message: string, meta: object }> }>} */
  const jobs = [];
  const unhandled = [];
  const calls = [];
  let seq = 0;

  const at = (n) => new Date(Date.UTC(2026, 8, 30, 5, 0, n)).toISOString();

  function jobView(j) {
    const s = steps[Math.min(j.step, steps.length - 1)];
    return {
      id: j.id,
      projectId: opts.projectId,
      slug,
      status: s.status,
      failedStage: s.failedStage ?? null,
      error: s.error ?? null,
      wbsDone: s.wbsDone ?? 0,
      wbsTotal: 3,
      budgetUsd: 10,
      spentUsd: Math.round((s.wbsDone ?? 0) * 0.37 * 100) / 100,
      d1Id: "d1_fake",
      repoFullName: null,
      commitSha: null,
      deployedUrl: s.deployed ? `https://${slug}.${HOST_ROOT}` : null,
      buildExitCode: s.deployed ? 0 : null,
      locale: opts.locale ?? "ko",
      createdAt: j.createdAt,
      updatedAt: at(j.step + 1),
    };
  }

  function isActive(j) {
    const st = jobView(j).status;
    return st !== "done" && st !== "failed";
  }

  function advance(j) {
    if (j.step < steps.length - 1) {
      j.step += 1;
      const s = steps[j.step];
      j.events.push({ id: `bje_${j.id}_${j.step}`, at: at(j.step), stage: s.status, message: s.error ?? s.status, meta: {} });
    }
  }

  /**
   * @param {string} method
   * @param {string} rawUrl
   * @returns {{ status: number, json: unknown }}
   */
  function handle(method, rawUrl) {
    const u = new URL(rawUrl);
    calls.push(`${method} ${u.pathname}`);
    if (method === "OPTIONS") return { status: 204, json: null };
    if (method === "GET" && u.pathname === "/workspace/build-availability") {
      return { status: 200, json: { ok: true, buildEnabled: open, reason: open ? "open" : "not_open" } };
    }
    if (method === "POST" && u.pathname === "/workspace/export-builder-pack") {
      const files = builderPackFixture(opts.locale);
      return { status: 200, json: { ok: true, source: "deterministic", bundle: { files }, summary: { fileCount: files.length, totalItems: 3, selectedItems: 3, recommendedNextStep: "handoff" } } };
    }
    const m = /^\/workspace\/projects\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (m && decodeURIComponent(m[1]) === opts.projectId) {
      const rest = m[2] ?? "";
      if (method === "GET" && rest === "/dev-spec") {
        return { status: 200, json: { ok: true, devSpec: devSpecFixture(opts.locale), updatedAt: at(0) } };
      }
      if (method === "GET" && rest === "/build-jobs") {
        return { status: 200, json: { ok: true, jobs: [...jobs].reverse().map(jobView), hostRoot: HOST_ROOT } };
      }
      const jm = /^\/build-jobs\/([^/]+)$/.exec(rest);
      if (method === "GET" && jm) {
        const j = jobs.find((x) => x.id === decodeURIComponent(jm[1]));
        if (!j) return { status: 404, json: { ok: false, error: "not_found" } };
        advance(j);
        return { status: 200, json: { ok: true, job: jobView(j), events: j.events } };
      }
      if (method === "POST" && rest === "/build") {
        const active = jobs.find(isActive);
        if (active) return { status: 409, json: { ok: false, error: "build_already_active", activeJobId: active.id, status: jobView(active).status } };
        // 수정 전 실서버: 같은 slug의 D1을 또 만들려다 이름 충돌 → 502(잡은 만들지 않는다).
        if (opts.retryConflict === true && jobs.length > 0) {
          return { status: 502, json: { ok: false, error: "hosting_d1_failed", detail: "cf_error", cf: [{ code: 7502, message: "A database with that name already exists" }] } };
        }
        seq += 1;
        const j = { id: `bj_fake${String(seq).padStart(5, "0")}`, step: 0, createdAt: at(seq), events: [{ id: `bje_q${seq}`, at: at(seq), stage: "queued", message: "repo_skipped:fake", meta: {} }] };
        jobs.push(j);
        const v = jobView(j);
        return {
          status: 202,
          json: { ok: true, job: { id: v.id, status: v.status, slug, wbsTotal: v.wbsTotal, budgetUsd: v.budgetUsd, repoFullName: null, hostUrl: `https://${slug}.${HOST_ROOT}` }, dispatched: true },
        };
      }
      if (method === "GET" && rest === "/repo") return { status: 200, json: { ok: true, repo: null } };
      if (method === "GET" && rest === "/sources") return { status: 200, json: { ok: true, sources: [] } };
      if (method === "GET" && rest === "/visual-checks") return { status: 200, json: { ok: true, checks: [] } };
      if (method === "GET" && rest === "/github/review-history") return { status: 200, json: { ok: true, runs: [] } };
    }
    unhandled.push(`${method} ${u.pathname}`);
    return { status: 404, json: { ok: false, error: "project_not_found" } };
  }

  return { handle, unhandled, calls, jobs, origins: [LIVE_CENTRAL_ORIGIN, FAKE_CENTRAL_ORIGIN] };
}
