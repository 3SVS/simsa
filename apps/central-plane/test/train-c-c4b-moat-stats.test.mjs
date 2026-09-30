/**
 * Train C · C-4b — GET /admin/moat-stats (재정렬 D-21 ⓪·D-8 amend: 나라 × 도구 × 서비스 유형 × 실패 코드 ×
 * 사람 판정 × 해결 교차 집계). 운영자 전용 JSON — 관리자 집계 UI는 범위 밖(재정렬 §5).
 *
 * 고정하는 계약:
 *   ① Bearer INTERNAL_CALLBACK_TOKEN — 없음·틀림·접두어 없음 → 401, 서버 토큰 미설정 → 503 admin_disabled.
 *      x-admin-key(Stage 18 키)로는 들어갈 수 없다.
 *   ② since/until ISO — 파싱 불가·역전 400, 기본 최근 7일, since 포함·until 제외
 *   ③ 교차 집계 region × built_with × topic × finding_code × user_verdict × resolved (개수만) + 6축 채움률
 *      + 한계 합계(marginals) + 수리 잡·프로젝트 절 — 값은 닫힌 어휘로만(모르는 값 → other/unrecorded)
 *   ④ ★식별·내용 컬럼(user_key·intent·target_url·report_json·title·idea·repo·pr·branch·error …)은 SQL
 *      출력 항목에 없고, 응답 JSON에 시드한 식별값·자유 텍스트(built_with.other·modelNote)·행 시각이 없다
 *   ⑤ 실제 마이그레이션 스키마(node:sqlite)에서 세 SQL이 돌고, 같은 집계가 나온다
 *   ⑥ 조회 실패는 500으로 숨기지 않고 503 stats_unavailable (0069 미적용 D1 등)
 *   ⑦ 50,000행 상한 — 잘리면 최신 구간 [coveredSince, until)의 정확한 집계(usage-stats와 같은 규칙)
 *
 * 네트워크 0: 가짜 D1(모든 Node) + node:sqlite(Node 22.13+; 없으면 건너뜀 = 미측정).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { createApp } = await import("../dist/router.js");
const moat = await import("../dist/routes/admin-moat-stats.js").catch(() => null);

const TOKEN = "tok_moat_admin_test";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const SINCE = "2026-09-27T00:00:00.000Z";
const UNTIL = "2026-09-29T00:00:00.000Z";
const RANGE = `?since=${SINCE}&until=${UNTIL}`;

// ─── 시드 — 한글·특수문자·자유 텍스트가 든 리얼 데이터(Rule 6) ─────────────────────

const SECRETS = [
  "uk_secret_owner", "wsp_빵집", "wsp_두번째", "wvc_secret", "wrj_secret",
  "https://secret-bakery.example.app", "몰래 확인할 의도 — 예약 버튼", "리포트비밀문장",
  "비밀도구메모", "GPT-비밀모델", "(주)트루픽셀 빵집 예약", "비밀 아이디어 문장", "acme/secret-repo",
  "fix/simsa-wvc_secret", "https://github.com/acme/secret-repo/pull/7", "weird_future_code",
  "T03:00", "T05:00", "T06:00", "T07:00", "T04:00", "T08:00", "T01:00", "T02:00",
];

const ENV_LOVABLE = JSON.stringify({
  builtWith: { tools: ["lovable"], primary: "lovable", other: "비밀도구메모", modelNote: "GPT-비밀모델" },
  entryPath: "code",
  topicTags: { domain: "commerce", pattern: null, integrations: ["Stripe"], ai_feature: null },
  locale: "ko",
  contentLang: "ko",
});
const ENV_IDEA_EMPTY = JSON.stringify({ builtWith: null, entryPath: "idea", topicTags: null, locale: "en", contentLang: "en" });

/**
 * Rows exactly as MOAT_CHECKS_SQL returns them (the join/subqueries are already applied).
 * PR #572 검증 [7]: repair_resolved = 그 런의 **가장 최근 완료(done) 수리**의 resolved(MAX 아님),
 * repair_done_count·repair_failed_count로 끝나지 못한 수리를 따로 접는다.
 */
const CHECK_ROWS = [
  // v1: KR · lovable · commerce · 두 코드 · still_broken · 완료 수리 1건 resolved=1
  { created_at: "2026-09-28T03:00:00.000Z", region: "KR", envelope_json: ENV_LOVABLE, finding_codes_json: '["network_5xx","console_error"]', user_verdict: "still_broken", is_recheck: 0, repair_count: 1, repair_done_count: 1, repair_failed_count: 0, repair_resolved: 1 },
  // v2: v1의 재검수 · 발견 0 · as_intended · 수리 없음
  { created_at: "2026-09-28T05:00:00.000Z", region: "KR", envelope_json: ENV_LOVABLE, finding_codes_json: "[]", user_verdict: "as_intended", is_recheck: 1, repair_count: 0, repair_done_count: 0, repair_failed_count: 0, repair_resolved: null },
  // v3: 레거시 런 — 봉투·코드·판정 없음 · 수리 1건(실패 — 고친 것이 없어 검증될 수 없다 → repair_failed)
  { created_at: "2026-09-28T06:00:00.000Z", region: null, envelope_json: null, finding_codes_json: null, user_verdict: null, is_recheck: 0, repair_count: 1, repair_done_count: 0, repair_failed_count: 1, repair_resolved: null },
  // v4: PH · 봉투는 있지만 도구·주제 미기록 · 모르는 코드 + 중복 코드 · 수리 2건(완료 resolved=0 + 실패) → 최근 완료 = 0
  { created_at: "2026-09-28T07:00:00.000Z", region: "PH", envelope_json: ENV_IDEA_EMPTY, finding_codes_json: '["ac_broken","weird_future_code","ac_broken"]', user_verdict: "works_but_different", is_recheck: 0, repair_count: 2, repair_done_count: 1, repair_failed_count: 1, repair_resolved: 0 },
  // 기간 밖
  { created_at: "2026-09-20T00:00:00.000Z", region: "JP", envelope_json: ENV_LOVABLE, finding_codes_json: "[]", user_verdict: "as_intended", is_recheck: 0, repair_count: 0, repair_done_count: 0, repair_failed_count: 0, repair_resolved: null },
];

const REPAIR_ROWS = [
  { created_at: "2026-09-28T04:00:00.000Z", region: "KR", status: "done", verify_linked: 1, resolved: 1 },
  { created_at: "2026-09-28T06:30:00.000Z", region: null, status: "failed", verify_linked: 0, resolved: null },
  { created_at: "2026-09-28T07:30:00.000Z", region: "PH", status: "done", verify_linked: 1, resolved: 0 },
  { created_at: "2026-09-28T08:00:00.000Z", region: "PH", status: "failed", verify_linked: 0, resolved: null },
  { created_at: "2026-09-10T00:00:00.000Z", region: "JP", status: "done", verify_linked: 1, resolved: 1 }, // 기간 밖
];

const PROJECT_ROWS = [
  { created_at: "2026-09-28T01:00:00.000Z", region_at_create: "KR", built_with_json: JSON.stringify({ tools: ["lovable"], primary: "lovable", other: "비밀도구메모" }), topic_tags_json: JSON.stringify({ domain: "commerce", pattern: null, integrations: [], ai_feature: null }) },
  { created_at: "2026-09-28T02:00:00.000Z", region_at_create: null, built_with_json: JSON.stringify({ tools: ["cursor", "claude-code"] }), topic_tags_json: JSON.stringify({ domain: null, pattern: null, integrations: [], ai_feature: null }) },
  { created_at: "2026-09-28T02:30:00.000Z", region_at_create: "PH", built_with_json: "null", topic_tags_json: "null" },
  { created_at: "2026-09-01T00:00:00.000Z", region_at_create: "JP", built_with_json: "null", topic_tags_json: "null" }, // 기간 밖
];

/** 가짜 D1 — 기간 필터, ORDER BY created_at DESC, 세 번째 바인딩 LIMIT. 바깥 FROM으로 표를 고른다. */
function makeDb({ checks = CHECK_ROWS, repairs = REPAIR_ROWS, projects = PROJECT_ROWS, fail = false } = {}) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return {
        bind(...args) {
          seen.push({ sql, args });
          return {
            async all() {
              if (fail) throw new Error("D1_ERROR: no such column: region");
              const table = /FROM workspace_visual_checks/.test(sql)
                ? checks
                : /FROM workspace_repair_jobs/.test(sql)
                  ? repairs
                  : /FROM workspace_projects/.test(sql)
                    ? projects
                    : [];
              const [since, until, limit] = args;
              let out = table.filter((r) => r.created_at >= since && r.created_at < until);
              if (/ORDER BY [\w.]*created_at DESC/i.test(sql)) out = [...out].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
              if (typeof limit === "number") out = out.slice(0, limit);
              return { results: out };
            },
          };
        },
      };
    },
  };
}

async function get(env, qs = RANGE, headers = AUTH) {
  const res = await createApp().fetch(new Request(`https://cp.example/admin/moat-stats${qs}`, { headers }), env);
  return { status: res.status, body: await res.json() };
}

const cellKey = (c) => [c.region, c.builtWith, c.topic, c.findingCode, c.userVerdict, c.resolved].join("|");

/** The aggregation the seed above must produce (hand-computed; see comments on each row). */
function assertSeedAggregation(body) {
  assert.equal(body.ok, true);
  assert.equal(body.since, SINCE);
  assert.equal(body.until, UNTIL);

  // ── 검수 런 교차표 ──
  const ch = body.checks;
  assert.equal(ch.rows, 4, "기간 밖 1행 제외");
  assert.equal(ch.truncated, false);
  assert.equal(ch.coveredSince, SINCE);
  const cells = Object.fromEntries(ch.cells.map((c) => [cellKey(c), c.count]));
  assert.deepEqual(cells, {
    "KR|lovable|commerce|network_5xx|still_broken|resolved": 1,
    "KR|lovable|commerce|console_error|still_broken|resolved": 1,
    "KR|lovable|commerce|none|as_intended|no_repair": 1,
    "unrecorded|unrecorded|unrecorded|unrecorded|unrecorded|repair_failed": 1,
    "PH|unrecorded|unrecorded|ac_broken|works_but_different|not_resolved": 1,
    "PH|unrecorded|unrecorded|other|works_but_different|not_resolved": 1,
  });
  for (const c of ch.cells) assert.equal(typeof c.count, "number");

  // ── 6축 채움률 (비어 있지 않은 비율, 분모 명시) ──
  assert.deepEqual(ch.fill.region, { filled: 3, total: 4, rate: 0.75 });
  assert.deepEqual(ch.fill.builtWith, { filled: 2, total: 4, rate: 0.5 });
  assert.deepEqual(ch.fill.topic, { filled: 2, total: 4, rate: 0.5 });
  assert.deepEqual(ch.fill.findingCodes, { filled: 3, total: 4, rate: 0.75 }, "[] = 측정된 '발견 0'은 채움");
  assert.deepEqual(ch.fill.userVerdict, { filled: 3, total: 4, rate: 0.75 });
  // PR #572 검증 [7]: 분모 = 완료된 수리가 있는 런(실패만 한 런은 검증될 수 없어 분모에 넣지 않는다).
  assert.deepEqual(ch.fill.resolved, { filled: 2, total: 2, rate: 1 }, "분모 = 완료된 수리가 있었던 런");

  // ── 한계 합계(런 단위; findingCode는 그 코드를 가진 런 수) ──
  assert.deepEqual(ch.marginals.region, { KR: 2, unrecorded: 1, PH: 1 });
  assert.deepEqual(ch.marginals.builtWith, { lovable: 2, unrecorded: 2 });
  assert.deepEqual(ch.marginals.topic, { commerce: 2, unrecorded: 2 });
  assert.deepEqual(ch.marginals.findingCode, { network_5xx: 1, console_error: 1, none: 1, unrecorded: 1, ac_broken: 1, other: 1 });
  assert.deepEqual(ch.marginals.userVerdict, { still_broken: 1, as_intended: 1, unrecorded: 1, works_but_different: 1 });
  assert.deepEqual(ch.marginals.resolved, { resolved: 1, no_repair: 1, repair_failed: 1, not_resolved: 1 });
  assert.deepEqual(ch.marginals.runKind, { first: 3, recheck: 1 });

  // ── 수리 잡 절 ──
  const rp = body.repairs;
  assert.equal(rp.rows, 4);
  assert.deepEqual(rp.fill.region, { filled: 3, total: 4, rate: 0.75 });
  // 재검수 연결·해결 채움률의 분모 = 완료된 수리 잡(실패·진행 중 잡은 재검수로 이어질 수 없다).
  assert.deepEqual(rp.fill.verifyLinked, { filled: 2, total: 2, rate: 1 });
  assert.deepEqual(rp.fill.resolved, { filled: 2, total: 2, rate: 1 });
  assert.deepEqual(Object.fromEntries(rp.cells.map((c) => [`${c.region}|${c.resolved}`, c.count])), {
    "KR|resolved": 1, "unrecorded|repair_failed": 1, "PH|not_resolved": 1, "PH|repair_failed": 1,
  });

  // ── 프로젝트 절 ──
  const pj = body.projects;
  assert.equal(pj.rows, 3);
  assert.deepEqual(pj.fill.region, { filled: 2, total: 3, rate: 0.6667 });
  assert.deepEqual(pj.fill.builtWith, { filled: 2, total: 3, rate: 0.6667 });
  assert.deepEqual(pj.fill.topic, { filled: 2, total: 3, rate: 0.6667 }, "domain 없음(unclassified)도 태그는 기록된 것");
  assert.deepEqual(Object.fromEntries(pj.cells.map((c) => [`${c.region}|${c.builtWith}|${c.topic}`, c.count])), {
    "KR|lovable|commerce": 1, "unrecorded|multiple|unclassified": 1, "PH|unrecorded|unrecorded": 1,
  });
}

function assertNoLeak(body) {
  const text = JSON.stringify(body);
  for (const s of SECRETS) assert.ok(!text.includes(s), `응답에 "${s}"가 있으면 안 된다: ${text.slice(0, 400)}`);
  // 출력 키에 id·*_id·식별 필드가 없다. (marginals의 키는 축 값 — console_error 같은 닫힌 코드 — 이므로
  // 이름 전체가 식별 필드와 같은지만 본다.)
  const IDENTIFYING_KEY = /^(userKey|user_key|intent|targetUrl|target_url|report|reportJson|report_json|agentPrompt|title|idea|repo|repoFullName|repo_full_name|prUrl|pr_url|prNumber|branch|branchName|branch_name|error|createdAt|created_at)$/;
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(k !== "id" && !/_id$|Id$/.test(k), `output key ${k}`);
        assert.ok(!IDENTIFYING_KEY.test(k), `identifying/content key ${k}`);
        walk(x);
      }
    }
  };
  walk(body);
}

// ─── ① 인증 ───────────────────────────────────────────────────────────────────

describe("① 인증 — Bearer INTERNAL_CALLBACK_TOKEN", () => {
  it("★없음·틀림·Bearer 접두어 없음 → 401 · x-admin-key로는 못 들어간다 · 서버 토큰 미설정 → 503", async () => {
    const env = { DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN, ADMIN_USAGE_STATS_KEY: "stage18-key" };
    const none = await get(env, RANGE, {});
    assert.equal(none.status, 401);
    assert.equal(none.body.error, "unauthorized");
    assert.equal((await get(env, RANGE, { authorization: "Bearer wrong-token" })).status, 401);
    assert.equal((await get(env, RANGE, { authorization: TOKEN })).status, 401, "Bearer 접두어 필수");
    assert.equal((await get(env, RANGE, { "x-admin-key": "stage18-key" })).status, 401, "Stage 18 키는 이 집계를 열지 못한다");
    assert.equal((await get(env, RANGE, { authorization: `Bearer ${TOKEN}x` })).status, 401, "접두어가 같아도 길이가 다르면 거부");
    const disabled = await get({ DB: makeDb() }, RANGE, AUTH);
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, "admin_disabled");
  });

  it("401·503일 때는 D1을 아예 건드리지 않는다", async () => {
    const db = makeDb();
    await get({ DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, RANGE, { authorization: "Bearer nope" });
    await get({ DB: db }, RANGE, AUTH);
    assert.equal(db.seen.length, 0);
  });
});

// ─── ② 기간 ───────────────────────────────────────────────────────────────────

describe("② 기간", () => {
  it("ISO 파싱 불가·역전 → 400 invalid_range, 기본 최근 7일, 세 질의 모두 같은 [since, until)", async () => {
    const env = { DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN };
    assert.equal((await get(env, "?since=어제")).status, 400);
    const rev = await get(env, `?since=${UNTIL}&until=${SINCE}`);
    assert.equal(rev.status, 400);
    assert.equal(rev.body.error, "invalid_range");
    const db = makeDb();
    const r = await get({ DB: db, INTERNAL_CALLBACK_TOKEN: TOKEN }, "");
    assert.equal(r.status, 200);
    assert.equal(Date.parse(r.body.until) - Date.parse(r.body.since), 7 * 24 * 60 * 60 * 1000);
    assert.equal(db.seen.length, 3, "검수 런·수리 잡·프로젝트 세 질의");
    for (const q of db.seen) {
      assert.equal(q.args[0], r.body.since);
      assert.equal(q.args[1], r.body.until);
    }
  });
});

// ─── ③ 집계 정확성 (가짜 D1 — 모든 Node) ──────────────────────────────────────────

describe("③ 교차 집계 — region × built_with × topic × finding_code × user_verdict × resolved", () => {
  it("★셀 개수·6축 채움률·한계 합계·수리·프로젝트 절이 손 계산과 일치한다", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assertSeedAggregation(r.body);
  });

  it("셀은 개수 큰 순 → 같은 개수는 키 사전순(결정적)", async () => {
    const twice = [...CHECK_ROWS.slice(0, 2), { ...CHECK_ROWS[1], created_at: "2026-09-28T05:30:00.000Z" }];
    const r = await get({ DB: makeDb({ checks: twice }), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.body.checks.cells[0].count, 2);
    assert.equal(r.body.checks.cells[0].findingCode, "none");
    const rest = r.body.checks.cells.slice(1).map(cellKey);
    assert.deepEqual(rest, [...rest].sort());
  });

  it("빈 기간 → rows 0 · cells [] · 채움률 rate null(0으로 나누지 않는다)", async () => {
    const r = await get({ DB: makeDb({ checks: [], repairs: [], projects: [] }), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.rows, 0);
    assert.deepEqual(r.body.checks.cells, []);
    assert.deepEqual(r.body.checks.fill.region, { filled: 0, total: 0, rate: null });
    assert.deepEqual(r.body.checks.fill.resolved, { filled: 0, total: 0, rate: null });
    assert.deepEqual(r.body.repairs.cells, []);
    assert.deepEqual(r.body.projects.cells, []);
  });

  it("값은 닫힌 어휘로만 — axes 범례가 응답에 실리고, 모든 셀 값이 범례 안에 있다", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN });
    const { axes } = r.body;
    for (const k of ["builtWith", "topic", "findingCode", "userVerdict", "resolved"]) assert.ok(Array.isArray(axes[k]) && axes[k].length > 0, k);
    assert.ok(axes.builtWith.includes("lovable") && axes.builtWith.includes("multiple") && axes.builtWith.includes("unrecorded"));
    assert.ok(axes.findingCode.includes("network_5xx") && axes.findingCode.includes("other") && axes.findingCode.includes("none"));
    assert.deepEqual(axes.resolved, ["resolved", "not_resolved", "unverified", "repair_failed", "repair_in_progress", "no_repair"]);
    for (const c of r.body.checks.cells) {
      assert.ok(/^[A-Z0-9]{2}$/.test(c.region) || c.region === "unrecorded", c.region);
      assert.ok(axes.builtWith.includes(c.builtWith), c.builtWith);
      assert.ok(axes.topic.includes(c.topic), c.topic);
      assert.ok(axes.findingCode.includes(c.findingCode), c.findingCode);
      assert.ok(axes.userVerdict.includes(c.userVerdict), c.userVerdict);
      assert.ok(axes.resolved.includes(c.resolved), c.resolved);
    }
  });

  it("국가 코드처럼 생기지 않은 region·깨진 봉투 JSON·배열 아닌 코드는 unrecorded로 — 원문을 내보내지 않는다", async () => {
    const odd = [
      { created_at: "2026-09-28T03:00:00.000Z", region: "서울<script>", envelope_json: "{not json", finding_codes_json: '{"a":1}', user_verdict: "완전좋음", is_recheck: 0, repair_count: 0, repair_resolved: null },
    ];
    const r = await get({ DB: makeDb({ checks: odd, repairs: [], projects: [] }), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.checks.cells.map(cellKey), ["unrecorded|unrecorded|unrecorded|unrecorded|unrecorded|no_repair"]);
    const text = JSON.stringify(r.body);
    for (const leak of ["서울", "script", "완전좋음", "not json"]) assert.ok(!text.includes(leak), leak);
  });
});

// ─── ③-b resolved 축 정의 (PR #572 검증 [7]) ─────────────────────────────────────

describe("③-b resolved 축 — 끝나지 못한 수리는 따로 접고, 분모는 완료된 수리만", () => {
  const row = (patch) => ({ created_at: "2026-09-28T03:00:00.000Z", region: "KR", envelope_json: null, finding_codes_json: "[]", user_verdict: null, is_recheck: 0, repair_resolved: null, ...patch });

  it("★실패만 한 수리 → repair_failed · 진행 중만 → repair_in_progress — 둘 다 해결 채움률 분모에 넣지 않는다", () => {
    assert.ok(moat, "dist/routes/admin-moat-stats.js must exist");
    const agg = moat.aggregateMoatChecks([
      row({ repair_count: 1, repair_done_count: 0, repair_failed_count: 1 }),
      row({ repair_count: 1, repair_done_count: 0, repair_failed_count: 0 }),
      row({ repair_count: 2, repair_done_count: 1, repair_failed_count: 1, repair_resolved: 1 }),
    ]);
    assert.deepEqual(agg.marginals.resolved, { repair_failed: 1, repair_in_progress: 1, resolved: 1 });
    assert.deepEqual(agg.fill.resolved, { filled: 1, total: 1, rate: 1 });
  });

  it("★수리 잡 절: 실패 잡 → repair_failed · 진행 중 → repair_in_progress · 재검수 연결·해결 채움률 분모 = 완료 잡", () => {
    const agg = moat.aggregateMoatRepairs([
      { created_at: "2026-09-28T04:00:00.000Z", region: "KR", status: "done", verify_linked: 1, resolved: 1 },
      { created_at: "2026-09-28T04:10:00.000Z", region: "KR", status: "done", verify_linked: 0, resolved: null },
      { created_at: "2026-09-28T04:20:00.000Z", region: "KR", status: "failed", verify_linked: 0, resolved: null },
      { created_at: "2026-09-28T04:30:00.000Z", region: "KR", status: "running", verify_linked: 0, resolved: null },
    ]);
    assert.deepEqual(Object.fromEntries(agg.cells.map((c) => [c.resolved, c.count])), {
      resolved: 1, unverified: 1, repair_failed: 1, repair_in_progress: 1,
    });
    assert.deepEqual(agg.fill.verifyLinked, { filled: 1, total: 2, rate: 0.5 });
    assert.deepEqual(agg.fill.resolved, { filled: 1, total: 2, rate: 0.5 });
    assert.deepEqual(agg.fill.region, { filled: 4, total: 4, rate: 1 }, "region 채움률은 모든 잡");
  });

  it("★MOAT_REPAIRS_SQL은 status를 읽는다(끝나지 못한 잡을 가르기 위해) · 검수 런 SQL은 최근 완료 수리의 resolved를 읽는다(MAX 아님)", () => {
    assert.match(moat.MOAT_REPAIRS_SQL, /\bstatus\b/);
    assert.doesNotMatch(moat.MOAT_CHECKS_SQL, /MAX\s*\(/i);
    assert.match(moat.MOAT_CHECKS_SQL, /status\s*=\s*'done'/);
  });
});

// ─── ④ 식별·내용 컬럼 미포함 ─────────────────────────────────────────────────────

const FORBIDDEN_COLUMNS = [
  "user_key", "intent", "target_url", "report_json", "agent_prompt", "evidence_keys_json", "decision",
  "repo_full_name", "branch_name", "pr_url", "pr_number", "error", "title", "idea", "understood_json",
  "product_spec_json", "items_json", "dev_spec_json", "acquisition_json", "user_verdict_at", "workspace_id",
];

/** The outer SELECT list (between the first SELECT and its matching top-level FROM). */
function outerSelectItems(sql) {
  const body = sql.replace(/^\s*SELECT\s+/i, "");
  let depth = 0;
  let cur = "";
  const items = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /^\s+FROM\s/i.test(body.slice(i, i + 7))) {
      items.push(cur.trim());
      return items;
    }
    if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  throw new Error("no top-level FROM");
}

describe("④ 식별·내용 컬럼은 나가지 않는다", () => {
  it("★세 SQL 모두 식별·내용 컬럼을 참조조차 하지 않는다 · 바깥 출력 항목에 id가 없다", () => {
    assert.ok(moat, "dist/routes/admin-moat-stats.js must exist");
    const sqls = { checks: moat.MOAT_CHECKS_SQL, repairs: moat.MOAT_REPAIRS_SQL, projects: moat.MOAT_PROJECTS_SQL };
    for (const [name, sql] of Object.entries(sqls)) {
      assert.equal(typeof sql, "string", name);
      assert.match(sql.trim(), /^SELECT\s/i, name);
      assert.ok(!/;\s*\S/.test(sql), `${name}: one statement`);
      assert.ok(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i.test(sql), `${name}: read-only`);
      for (const col of FORBIDDEN_COLUMNS) assert.ok(!new RegExp(`\\b${col}\\b`, "i").test(sql), `${name} must not reference ${col}`);
      for (const item of outerSelectItems(sql)) {
        const alias = (/\bAS\s+([a-z_]+)$/i.exec(item)?.[1] ?? item.split(".").pop() ?? "").trim();
        assert.ok(alias !== "id" && !/_id$/i.test(alias), `${name}: output column "${alias}" must not be an id`);
      }
    }
  });

  it("★응답 JSON에 시드한 사용자 키·의도·주소·리포트·자유 텍스트(built_with.other·modelNote)·행 시각이 없다", async () => {
    const r = await get({ DB: makeDb(), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200);
    assertNoLeak(r.body);
  });
});

// ─── ⑥ 조회 실패 ──────────────────────────────────────────────────────────────

describe("⑥ 조회 실패", () => {
  it("D1 오류(0069 미적용 등)는 500으로 숨기지 않고 503 stats_unavailable", async () => {
    const r = await get({ DB: makeDb({ fail: true }), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "stats_unavailable");
  });
});

// ─── ⑦ 상한 ───────────────────────────────────────────────────────────────────

describe("⑦ 50,000행 상한 — 최신 구간의 정확한 집계", () => {
  it("★truncated면 가장 최근 행부터, 경계 타임스탬프 행을 버린 [coveredSince, until)만 센다", async () => {
    const LIMIT = 50_000;
    assert.equal(moat?.MOAT_STATS_ROW_LIMIT, LIMIT);
    const base = Date.parse("2026-09-28T00:00:00.000Z");
    const iso = (ms) => new Date(ms).toISOString();
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push({ ...CHECK_ROWS[0], region: "JP", created_at: iso(base + i) });
    for (let i = 0; i < LIMIT; i++) rows.push({ ...CHECK_ROWS[1], created_at: iso(base + 1_000 + i) });
    const r = await get({ DB: makeDb({ checks: rows, repairs: [], projects: [] }), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.truncated, true);
    assert.equal(r.body.checks.coveredSince, iso(base + 1_001));
    assert.equal(r.body.checks.rows, LIMIT - 1);
    assert.ok(!("JP" in r.body.checks.marginals.region), "잘릴 때 오래된 행이 대신 남으면 안 된다");
    assert.equal(r.body.repairs.truncated, false);
  });
});

// ─── ⑤ 실제 SQLite + 실제 마이그레이션 ──────────────────────────────────────────

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite 없음(Node < 22.13) — 미측정";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  const mig = (f) => readFileSync(join(here, "..", "migrations", f), "utf8");
  for (const f of [
    "0027_workspace_stage5.sql", "0050_workspace_visual_checks.sql", "0051_workspace_repair_jobs.sql", "0052_repair_job_mode.sql",
    "0055_project_builtwith_entrypath.sql", "0056_project_topic_acquisition.sql", "0065_visual_check_locale.sql", "0069_moat_envelope.sql",
  ]) db.exec(mig(f));
  return db;
}

/** D1 모양의 얇은 어댑터 — prepare().bind().all() → { results }. node:sqlite 행은 null 프로토타입이라 펼친다. */
function d1Over(db) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return { async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; } };
        },
      };
    },
  };
}

function seedSqlite(db) {
  const P = `INSERT INTO workspace_projects (id, user_key, title, idea, built_with_json, topic_tags_json, region_at_create, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const ins = db.prepare(P);
  const pr = PROJECT_ROWS;
  ins.run("wsp_빵집", "uk_secret_owner", "(주)트루픽셀 빵집 예약", "비밀 아이디어 문장", pr[0].built_with_json, pr[0].topic_tags_json, "KR", pr[0].created_at, pr[0].created_at);
  ins.run("wsp_두번째", "uk_secret_owner", "(주)트루픽셀 빵집 예약 2", "비밀 아이디어 문장", pr[1].built_with_json, pr[1].topic_tags_json, null, pr[1].created_at, pr[1].created_at);
  ins.run("wsp_세번째", "uk_secret_owner", "세 번째", "비밀 아이디어 문장", "null", "null", "PH", pr[2].created_at, pr[2].created_at);
  ins.run("wsp_오래됨", "uk_secret_owner", "오래됨", "", "null", "null", "JP", pr[3].created_at, pr[3].created_at);

  const V = `INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, works, status, executor, report_json, agent_prompt, evidence_keys_json, created_at, updated_at, region, envelope_json, finding_codes_json, user_verdict, user_verdict_at, source_check_id)
             VALUES (?, ?, 'uk_secret_owner', 'https://secret-bakery.example.app', '몰래 확인할 의도 — 예약 버튼', 'Needs Fix', 0, 'done', 'container', '{"oneLine":"리포트비밀문장"}', '비밀 프롬프트', '[]', ?, ?, ?, ?, ?, ?, ?, ?)`;
  const iv = db.prepare(V);
  const c = CHECK_ROWS;
  iv.run("wvc_secret1", "wsp_빵집", c[0].created_at, c[0].created_at, "KR", c[0].envelope_json, c[0].finding_codes_json, "still_broken", "2026-09-28T03:10:00.000Z", null);
  iv.run("wvc_secret2", "wsp_빵집", c[1].created_at, c[1].created_at, "KR", c[1].envelope_json, c[1].finding_codes_json, "as_intended", "2026-09-28T05:10:00.000Z", "wvc_secret1");
  iv.run("wvc_secret3", "wsp_두번째", c[2].created_at, c[2].created_at, null, null, null, null, null, null);
  iv.run("wvc_secret4", "wsp_세번째", c[3].created_at, c[3].created_at, "PH", c[3].envelope_json, c[3].finding_codes_json, "works_but_different", "2026-09-28T07:10:00.000Z", null);
  iv.run("wvc_secret5", "wsp_오래됨", c[4].created_at, c[4].created_at, "JP", c[4].envelope_json, "[]", "as_intended", null, null);

  const R = `INSERT INTO workspace_repair_jobs (id, project_id, user_key, visual_check_id, repo_full_name, status, branch_name, pr_url, pr_number, env_cause, error, created_at, updated_at, mode, changed_files, region, verify_check_id, resolved)
             VALUES (?, ?, 'uk_secret_owner', ?, 'acme/secret-repo', ?, 'fix/simsa-wvc_secret1', 'https://github.com/acme/secret-repo/pull/7', 7, 0, ?, ?, ?, 'auto_fix', 2, ?, ?, ?)`;
  const ir = db.prepare(R);
  ir.run("wrj_secret1", "wsp_빵집", "wvc_secret1", "done", "build_check:verified", REPAIR_ROWS[0].created_at, REPAIR_ROWS[0].created_at, "KR", "wvc_secret2", 1);
  ir.run("wrj_secret2", "wsp_두번째", "wvc_secret3", "failed", "비밀 에러", REPAIR_ROWS[1].created_at, REPAIR_ROWS[1].created_at, null, null, null);
  ir.run("wrj_secret3", "wsp_세번째", "wvc_secret4", "done", null, REPAIR_ROWS[2].created_at, REPAIR_ROWS[2].created_at, "PH", "wvc_secretX", 0);
  ir.run("wrj_secret4", "wsp_세번째", "wvc_secret4", "failed", null, REPAIR_ROWS[3].created_at, REPAIR_ROWS[3].created_at, "PH", null, null);
  ir.run("wrj_secret5", "wsp_오래됨", "wvc_secret5", "done", null, REPAIR_ROWS[4].created_at, REPAIR_ROWS[4].created_at, "JP", "wvc_secret5", 1);
}

describe("⑤ 실제 SQLite — 실제 마이그레이션 스키마(0027·0050·0051·0052·0055·0056·0065·0069)", { skip }, () => {
  it("★세 SQL이 실제 엔진에서 돌고, 라우트 응답이 손 계산 집계와 같다 · 식별값 누출 0", async () => {
    const db = freshDb();
    seedSqlite(db);
    const r = await get({ DB: d1Over(db), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assertSeedAggregation(r.body);
    assertNoLeak(r.body);
  });

  it("★PR #572 검증 [7]: 런의 resolved = 가장 최근 완료 수리의 값(앞 수리가 해결됐어도 뒤 수리에서 되돌아가면 not_resolved) · 실패·진행 중만이면 따로", async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO workspace_projects (id, user_key, title, idea, created_at, updated_at) VALUES ('wsp_p', 'uk_secret_owner', '(주)트루픽셀', '', ?, ?)`).run(SINCE, SINCE);
    const V = db.prepare(`INSERT INTO workspace_visual_checks (id, project_id, user_key, target_url, intent, decision, works, status, executor, report_json, evidence_keys_json, created_at, updated_at, region, finding_codes_json)
                          VALUES (?, 'wsp_p', 'uk_secret_owner', 'https://secret-bakery.example.app', '몰래 확인할 의도 — 예약 버튼', 'Needs Fix', 0, 'done', 'container', '{}', '[]', ?, ?, 'KR', '[]')`);
    const at = (h) => `2026-09-28T${String(h).padStart(2, "0")}:00:00.000Z`;
    for (const [id, h] of [["wvc_a", 1], ["wvc_b", 2], ["wvc_c", 3], ["wvc_d", 4]]) V.run(id, at(h), at(h));
    const R = db.prepare(`INSERT INTO workspace_repair_jobs (id, project_id, user_key, visual_check_id, repo_full_name, status, env_cause, created_at, updated_at, mode, region, verify_check_id, resolved)
                          VALUES (?, 'wsp_p', 'uk_secret_owner', ?, 'acme/secret-repo', ?, 0, ?, ?, 'auto_fix', 'KR', ?, ?)`);
    // a: 앞 수리 해결(1) → 뒤 수리에서 되돌아감(0). MAX면 resolved로 부풀려진다.
    R.run("wrj_a1", "wvc_a", "done", at(5), at(5), "wvc_va1", 1);
    R.run("wrj_a2", "wvc_a", "done", at(6), at(6), "wvc_va2", 0);
    // b: 실패만 — 고친 것이 없어 검증될 수 없다.
    R.run("wrj_b1", "wvc_b", "failed", at(7), at(7), null, null);
    // c: 아직 고치는 중.
    R.run("wrj_c1", "wvc_c", "queued", at(8), at(8), null, null);
    // d: 완료(판정 전) 뒤 실패 — 최근 '완료' 수리는 아직 판정 전.
    R.run("wrj_d1", "wvc_d", "done", at(9), at(9), null, null);
    R.run("wrj_d2", "wvc_d", "failed", at(10), at(10), null, null);

    const r = await get({ DB: d1Over(db), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.checks.marginals.resolved, { not_resolved: 1, repair_failed: 1, repair_in_progress: 1, unverified: 1 });
    assert.deepEqual(r.body.checks.fill.resolved, { filled: 1, total: 2, rate: 0.5 }, "분모 = 완료된 수리가 있는 런(a·d)");
    assert.deepEqual(Object.fromEntries(r.body.repairs.cells.map((c) => [c.resolved, c.count])), {
      resolved: 1, not_resolved: 1, unverified: 1, repair_failed: 2, repair_in_progress: 1,
    });
    assert.deepEqual(r.body.repairs.fill.verifyLinked, { filled: 2, total: 3, rate: 0.6667 });
    assert.deepEqual(r.body.repairs.fill.resolved, { filled: 2, total: 3, rate: 0.6667 });
    assertNoLeak(r.body);
  });

  it("0069 미적용 스키마(옛 D1)에서는 503 stats_unavailable — 조용한 빈 집계가 아니다", async () => {
    const db = new DatabaseSync(":memory:");
    const mig = (f) => readFileSync(join(here, "..", "migrations", f), "utf8");
    for (const f of ["0027_workspace_stage5.sql", "0050_workspace_visual_checks.sql", "0051_workspace_repair_jobs.sql", "0052_repair_job_mode.sql", "0055_project_builtwith_entrypath.sql", "0056_project_topic_acquisition.sql"]) db.exec(mig(f));
    const r = await get({ DB: d1Over(db), INTERNAL_CALLBACK_TOKEN: TOKEN });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "stats_unavailable");
  });
});
