/**
 * train-c-a7-provenance.test.mjs — Train C · C-A7 ① D-2 amend 집행(재정렬 2026-09-27, `design lock approved`).
 *
 * 고정하는 계약:
 *   ① DevSpecMeta.provenance{ builtWith, entryPath, detectedStack, userConfirmedAcIds[] } — 전부 optional(추가만).
 *      provenance 없는 옛 저장 JSON은 그대로 파싱된다. provenance 안의 모르는 키는 거부(strict).
 *   ② 무결성: source === "inferred"면 must AC(= priority must 기능에 딸린 AC)는 userConfirmedAcIds 안의 것만.
 *      검사기는 **보고**(inferred_must_unconfirmed)하고, 강등은 생산자(applyInferredConfirmation·생성기)가 한다.
 *      확인 목록이 없는 AC를 가리키면 confirmed_unknown_acceptance.
 *   ③ 역추론 생성: 확인된 항목 → 고정 FR id(FR-001…)·must, 모델이 must라 한 나머지는 should로 강등,
 *      meta.provenance.userConfirmedAcIds = 확인된 기능의 AC. 확인 id 없음(옛 클라이언트) = 빈 배열·must 0.
 *   ④ 출처는 기존 감지기 그대로(빌더 호스트·entry_path·스택) — infer-intent 응답과 dev-spec 생성 둘 다.
 *   ⑤ 라우트: entry_path "code" 프로젝트의 지시서는 서버가 inferred로 정한다. confirmedItemIds 모양이 틀리면 400.
 *
 * 네트워크 0: fetch 교체 + 가짜 D1. 한글 리얼 데이터(Rule 6): "(주)트루픽셀 예약 앱".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFakeD1, projectRow, websiteSource } from "./_train-c-fake-d1.mjs";

const { DevSpecSchema, DevSpecMetaSchema, validateDevSpec, checkDevSpecIntegrity, applyInferredConfirmation } =
  await import("../dist/workspace/dev-spec.js");
const { generateDevSpec, planInferredConfirmation, buildPassPrompt } = await import("../dist/workspace/generate-dev-spec.js");
const { provenanceFrom, mergeStackHints } = await import("../dist/workspace/provenance.js");
const { acceptancePlanFromDevSpec } = await import("../dist/acceptance-plan.js");
const { renderDevSpecFiles } = await import("../dist/workspace/render-dev-spec.js");
const { createApp } = await import("../dist/router.js");
const { __resetAnthropicBreaker } = await import("../dist/workspace/anthropic-fetch.js");

const USER = "uk_트루픽셀_대표";
const PROJECT = "wsp_truepixel_booking";
const APP_URL = "https://truepixel-yeyak.lovable.app/";

// ─── 픽스처: 미용실 예약 앱(역추론) ────────────────────────────────────────────

const brief = {
  productName: "(주)트루픽셀 예약 앱",
  oneLine: "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 웹앱",
  targetUsers: ["동네 미용실 손님"],
  problem: "전화 예약이 번거롭고 빈 시간을 알기 어렵다",
  included: ["날짜·시간 선택 예약", "예약 확인"],
  excluded: ["결제"],
  userFlow: ["날짜 고름 → 시간 고름 → 예약하기 → 확인 화면"],
  decisions: [],
  openQuestions: [],
};

/** 카드에서 "맞나요?"에 나온 항목. req_001·req_003만 유저가 체크를 남겼다(kept). */
const items = [
  { id: "req_001", title: "원하는 날짜를 골라 예약할 수 있다", status: "not_started", criteria: ["달력에서 날짜를 고르면 예약 확인에 그 날짜가 보인다"] },
  { id: "req_002", title: "후기를 남길 수 있다", status: "not_started", criteria: ["후기 목록에 새 글이 보인다"] },
  { id: "req_003", title: "예약 내역을 확인할 수 있다", status: "not_started", criteria: ["내 예약 화면에 방금 잡은 예약이 보인다"] },
];

function specWith(meta, featuresOverride) {
  const features = featuresOverride ?? [
    { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "must" },
    { id: "FR-002", title: "후기 작성", description: "방문 후기를 남긴다", priority: "must" },
  ];
  return {
    meta: { version: 1, source: "inferred", locale: "ko", generatedAt: "2026-09-30T01:00:00.000Z", ...meta },
    brief,
    features,
    acceptance: [
      { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "10월 3일을 고르고 예약하기를 누르면", then: "예약 확인에 10월 3일이 보인다", verifiedBy: "browser" },
      { id: "AC-002", featureId: "FR-002", given: "방문 완료", when: "후기를 쓰고 등록을 누르면", then: "후기 목록에 새 글이 보인다", verifiedBy: "browser" },
    ],
    screens: [{ id: "SCR-001", route: "/", purpose: "예약과 후기", components: ["달력", "후기 목록"], states: {}, entryFrom: ["첫 진입"], exitTo: [], featureIds: ["FR-001", "FR-002"] }],
    dataModel: [],
    apis: [],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: "예약·후기", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002"] }],
    testPlan: [
      { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "10월 3일 고르기", "'예약하기' 누르기"] },
      { kind: "browser", acceptanceId: "AC-002", steps: ["/ 열기", "후기 쓰기", "'등록' 누르기"] },
    ],
    assumptions: [],
    openQuestions: [],
  };
}

// ─── ① 스키마 하위호환 ────────────────────────────────────────────────────────

describe("① provenance 스키마 — 추가만(하위호환)", () => {
  it("provenance 없는 옛 저장 JSON(generated·inferred 둘 다)이 그대로 파싱된다", () => {
    const oldGenerated = specWith({ source: "generated" });
    assert.equal(DevSpecSchema.safeParse(oldGenerated).success, true);
    // 옛 inferred(확인 목록 없음)도 **스키마**는 통과한다 — must 규칙은 무결성의 일이다.
    const oldInferred = specWith({}, [
      { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "should" },
      { id: "FR-002", title: "후기 작성", description: "방문 후기를 남긴다", priority: "could" },
    ]);
    const v = validateDevSpec(JSON.parse(JSON.stringify(oldInferred)));
    assert.equal(v.ok, true, JSON.stringify(v));
  });

  it("provenance 4필드가 파싱되고, 필드마다 optional이다", () => {
    const meta = {
      version: 1, source: "inferred", locale: "ko", generatedAt: "2026-09-30T01:00:00.000Z",
      provenance: {
        builtWith: "lovable",
        entryPath: "code",
        detectedStack: { hosting: "lovable", data: "supabase", tools: ["React", "Tailwind CSS"] },
        userConfirmedAcIds: ["AC-001"],
      },
    };
    const r = DevSpecMetaSchema.safeParse(meta);
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    assert.deepEqual(r.data.provenance.userConfirmedAcIds, ["AC-001"]);
    for (const only of [{ builtWith: "bolt" }, { entryPath: "code" }, { detectedStack: {} }, { userConfirmedAcIds: [] }, {}]) {
      assert.equal(DevSpecMetaSchema.safeParse({ ...meta, provenance: only }).success, true, JSON.stringify(only));
    }
  });

  it("provenance 안의 모르는 키·틀린 AC id·틀린 갈래는 거부(strict 경계)", () => {
    const base = { version: 1, source: "inferred", locale: "ko", generatedAt: "2026-09-30T01:00:00.000Z" };
    // 양성 대조(PR #577 리뷰 P2-4): **같은 base**에 유효한 provenance는 통과해야 한다. 이게 없으면
    // provenance 키 자체를 거부하는 옛 스키마(.strict())에서도 아래 거부 검사가 공허하게 통과한다.
    const good = DevSpecMetaSchema.safeParse({
      ...base,
      provenance: { builtWith: "lovable", entryPath: "code", detectedStack: { hosting: "lovable", tools: ["React"] }, userConfirmedAcIds: ["AC-001"] },
    });
    assert.equal(good.success, true, JSON.stringify(good.error?.issues));
    for (const bad of [
      { userConfirmedItemIds: ["req_001"] },
      { userConfirmedAcIds: ["req_001"] },
      { entryPath: "기존앱" },
      { builtWith: "Lovable 앱" },
      { detectedStack: { hosting: "vercel", score: 3 } },
    ]) {
      assert.equal(DevSpecMetaSchema.safeParse({ ...base, provenance: bad }).success, false, JSON.stringify(bad));
    }
  });
});

// ─── ② 무결성 ────────────────────────────────────────────────────────────────

describe("② inferred 무결성 — must AC는 확인된 것만", () => {
  it("확인 목록 없는 inferred의 must AC → inferred_must_unconfirmed (저장 거부)", () => {
    const spec = specWith({});
    const v = checkDevSpecIntegrity(DevSpecSchema.parse(spec));
    const rules = v.filter((x) => x.rule === "inferred_must_unconfirmed").map((x) => x.where).sort();
    assert.deepEqual(rules, ["AC-001", "AC-002"]);
    assert.equal(validateDevSpec(spec).ok, false);
  });

  it("일부만 확인 → 확인 안 된 must AC만 위반", () => {
    const spec = specWith({ provenance: { entryPath: "code", userConfirmedAcIds: ["AC-001"] } });
    const v = checkDevSpecIntegrity(DevSpecSchema.parse(spec));
    assert.deepEqual(v.map((x) => `${x.rule}@${x.where}`), ["inferred_must_unconfirmed@AC-002"]);
  });

  it("확인된 must + 확인 안 된 기능은 should → 통과, 시나리오 priority도 그대로", () => {
    const spec = specWith({ provenance: { entryPath: "code", userConfirmedAcIds: ["AC-001"] } }, [
      { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "must" },
      { id: "FR-002", title: "후기 작성", description: "방문 후기를 남긴다", priority: "should" },
    ]);
    assert.equal(validateDevSpec(spec).ok, true);
    const plan = acceptancePlanFromDevSpec(spec);
    assert.deepEqual(plan.map((s) => `${s.acceptanceId}:${s.priority}`), ["AC-001:must", "AC-002:should"]);
  });

  it("generated·manual은 확인 목록 없이도 must 허용(종전 동작 유지)", () => {
    for (const source of ["generated", "manual"]) {
      const v = checkDevSpecIntegrity(DevSpecSchema.parse(specWith({ source })));
      assert.deepEqual(v, [], source);
    }
  });

  it("확인 목록이 없는 AC를 가리키면 confirmed_unknown_acceptance", () => {
    const spec = specWith({ provenance: { userConfirmedAcIds: ["AC-001", "AC-002", "AC-777"] } });
    const v = checkDevSpecIntegrity(DevSpecSchema.parse(spec));
    assert.deepEqual(v.map((x) => `${x.rule}@${x.where}`), ["confirmed_unknown_acceptance@AC-777"]);
  });

  it("applyInferredConfirmation: 확인 기능 → must(승격), 나머지 must → should(강등), 확인 AC 목록 반환", () => {
    const s = specWith({}, [
      { id: "FR-001", title: "날짜 선택 예약", description: "d", priority: "should" },
      { id: "FR-002", title: "후기 작성", description: "d", priority: "must" },
    ]);
    const r = applyInferredConfirmation(s, new Set(["FR-001"]));
    assert.deepEqual(r.features.map((f) => `${f.id}:${f.priority}`), ["FR-001:must", "FR-002:should"]);
    assert.deepEqual(r.userConfirmedAcIds, ["AC-001"]);
    assert.deepEqual(r.demoted, ["FR-002"]);
    // 원본은 건드리지 않는다(순수).
    assert.equal(s.features[1].priority, "must");
  });
});

// ─── ③ 역추론 생성 ────────────────────────────────────────────────────────────

const usage = { model: "mock", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1 };
function passOf(prompt) {
  if (/작업 분해|work breakdown/i.test(prompt)) return "plan";
  if (/화면·데이터·API|screens · data/i.test(prompt)) return "surfaces";
  return "requirements";
}
/** 모델은 확인과 상관없이 **전부 must**라고 답한다 — 강등이 생성기의 일인지 본다. */
const P1_ALL_MUST = {
  features: [
    { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "must" },
    { id: "FR-002", title: "예약 내역 확인", description: "내 예약을 본다", priority: "must" },
    { id: "FR-101", title: "후기 작성", description: "방문 후기를 남긴다", priority: "must" },
  ],
  acceptance: [
    { id: "AC-001", featureId: "FR-001", given: "예약 화면", when: "10월 3일을 고르고 예약하기를 누르면", then: "예약 확인에 10월 3일이 보인다", verifiedBy: "browser" },
    { id: "AC-002", featureId: "FR-002", given: "예약 1건", when: "내 예약을 열면", then: "방금 잡은 예약이 보인다", verifiedBy: "browser" },
    { id: "AC-003", featureId: "FR-101", given: "방문 완료", when: "후기를 등록하면", then: "후기 목록에 새 글이 보인다", verifiedBy: "browser" },
  ],
};
/** P2: 확인된 must 둘만 표면에 둔다 — 강등된 FR-101은 표면이 없어도 된다(should). */
const P2 = {
  screens: [{ id: "SCR-001", route: "/", purpose: "예약", components: ["달력"], states: {}, entryFrom: [], exitTo: [], featureIds: ["FR-001", "FR-002"] }],
  dataModel: [], apis: [], nonFunctional: [],
};
const P3 = {
  workBreakdown: [{ id: "WBS-001", title: "예약", order: 1, dependsOn: [], acceptanceIds: ["AC-001", "AC-002", "AC-003"] }],
  testPlan: [
    { kind: "browser", acceptanceId: "AC-001", steps: ["/ 열기", "'예약하기' 누르기"] },
    { kind: "browser", acceptanceId: "AC-002", steps: ["/ 열기", "'내 예약' 누르기"] },
    { kind: "browser", acceptanceId: "AC-003", steps: ["/ 열기", "'등록' 누르기"] },
  ],
  assumptions: [], openQuestions: [],
};
function mockCaller(responses, log = []) {
  return async (prompt) => {
    const pass = passOf(prompt);
    log.push({ pass, prompt });
    const r = responses[pass];
    const body = typeof r === "function" ? r(log.filter((l) => l.pass === pass).length, prompt) : r;
    return { text: typeof body === "string" ? body : JSON.stringify(body), usage };
  };
}

describe("③ 역추론 생성 — 확인된 것만 must", () => {
  it("planInferredConfirmation: kept id → 고정 FR-001…, 나머지는 확인 안 됨(순서 보존)", () => {
    const plan = planInferredConfirmation(items, ["req_003", "req_001", "req_없음"]);
    assert.deepEqual(plan.confirmed.map((c) => `${c.featureId}=${c.item.id}`), ["FR-001=req_001", "FR-002=req_003"]);
    assert.deepEqual(plan.unconfirmed.map((i) => i.id), ["req_002"]);
  });

  it("모델이 전부 must라 해도 확인된 기능만 must, meta.provenance에 출처+확인 AC", async () => {
    const log = [];
    const r = await generateDevSpec(
      {
        brief, items, idea: "(주)트루픽셀 예약 앱", locale: "ko", source: "inferred",
        confirmedItemIds: ["req_001", "req_003"],
        provenance: { builtWith: "lovable", entryPath: "code", detectedStack: { hosting: "lovable", tools: ["React"] } },
      },
      mockCaller({ requirements: P1_ALL_MUST, surfaces: P2, plan: P3 }, log),
      { now: () => new Date("2026-09-30T01:00:00Z") },
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    const d = r.devSpec;
    assert.equal(d.meta.source, "inferred");
    assert.deepEqual(d.features.map((f) => `${f.id}:${f.priority}`), ["FR-001:must", "FR-002:must", "FR-101:should"]);
    assert.deepEqual(d.meta.provenance, {
      builtWith: "lovable", entryPath: "code", detectedStack: { hosting: "lovable", tools: ["React"] },
      userConfirmedAcIds: ["AC-001", "AC-002"],
    });
    assert.equal(validateDevSpec(d).ok, true);
    // 프롬프트는 확인된 것과 아닌 것을 **나눠서** 보여준다(섞으면 전부 must가 된다).
    const p1 = log.find((l) => l.pass === "requirements").prompt;
    assert.match(p1, /FR-001 = 원하는 날짜를 골라 예약할 수 있다/);
    assert.match(p1, /FR-002 = 예약 내역을 확인할 수 있다/);
    assert.match(p1, /사용자가 확인하지 않은 항목:\n1\. 후기를 남길 수 있다/);
    assert.match(p1, /역추론 규칙/);
  });

  it("옛 클라이언트(확인 id 없음) → must 0, userConfirmedAcIds 빈 배열 — 그래도 저장 가능", async () => {
    const r = await generateDevSpec(
      { brief, items, locale: "ko", source: "inferred" },
      mockCaller({ requirements: P1_ALL_MUST, surfaces: P2, plan: P3 }),
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.devSpec.features.every((f) => f.priority !== "must"));
    assert.deepEqual(r.devSpec.meta.provenance, { userConfirmedAcIds: [] });
  });

  it("확인된 항목의 고정 FR id가 빠지면 P1을 한 번 더 만든다(유저가 '반드시'라 한 것이 조용히 사라지지 않게)", async () => {
    const missing = { ...P1_ALL_MUST, features: P1_ALL_MUST.features.filter((f) => f.id !== "FR-002"), acceptance: P1_ALL_MUST.acceptance.filter((a) => a.featureId !== "FR-002") };
    const log = [];
    const r = await generateDevSpec(
      { brief, items, locale: "ko", source: "inferred", confirmedItemIds: ["req_001", "req_003"] },
      mockCaller({ requirements: (n) => (n === 1 ? missing : P1_ALL_MUST), surfaces: P2, plan: P3 }, log),
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    const p1s = log.filter((l) => l.pass === "requirements");
    assert.equal(p1s.length, 2);
    assert.match(p1s[1].prompt, /FR-002 \(user-confirmed item\) is missing/);
  });

  it("generated는 종전 그대로(provenance 없음, 모델의 must 유지)", async () => {
    const r = await generateDevSpec(
      { brief, items, locale: "ko", source: "generated", confirmedItemIds: ["req_001"] },
      mockCaller({ requirements: P1_ALL_MUST, surfaces: { ...P2, screens: [{ ...P2.screens[0], featureIds: ["FR-001", "FR-002", "FR-101"] }] }, plan: P3 }),
    );
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.devSpec.meta.provenance, undefined);
    assert.ok(r.devSpec.features.every((f) => f.priority === "must"));
    assert.doesNotMatch(buildPassPrompt("requirements", "ko", { brief, items }), /역추론 규칙/);
  });
});

// ─── ④ 출처 = 기존 감지기 ─────────────────────────────────────────────────────

describe("④ provenanceFrom — 새 감지기 없이 감지 결과를 모양만 맞춘다", () => {
  it("빌더 호스트(lovable) → builtWith, 스택은 그대로, 갈래는 entry_path", () => {
    assert.deepEqual(
      provenanceFrom({ stack: { hosting: "lovable", tools: [] }, entryPath: "code", declaredBuiltWith: { tools: ["cursor"] } }),
      { builtWith: "lovable", entryPath: "code", detectedStack: { hosting: "lovable" } },
    );
  });
  it("빌더 호스트가 아니면 유저가 적은 도구(primary, 또는 하나뿐일 때만)", () => {
    assert.equal(provenanceFrom({ stack: { hosting: "vercel", tools: ["Next.js"] }, entryPath: "code", declaredBuiltWith: { tools: ["v0", "cursor"], primary: "v0" } }).builtWith, "v0");
    assert.equal(provenanceFrom({ stack: null, entryPath: "code", declaredBuiltWith: { tools: ["bolt"] } }).builtWith, "bolt");
    assert.equal(provenanceFrom({ stack: null, entryPath: "code", declaredBuiltWith: { tools: ["v0", "cursor"] } }).builtWith, undefined);
    assert.equal(provenanceFrom({ stack: null, entryPath: "code", declaredBuiltWith: { tools: ["other"], other: "사내 도구" } }).builtWith, undefined);
  });
  it("모르면 키를 비운다(지어내지 않음) — 증거 없음·이상한 갈래", () => {
    assert.deepEqual(provenanceFrom({ stack: null, entryPath: "기존앱", declaredBuiltWith: null }), {});
    assert.deepEqual(provenanceFrom({ stack: { tools: [] }, entryPath: null, declaredBuiltWith: "null" }), {});
  });
  it("mergeStackHints: 호스팅은 주소, 데이터·도구는 저장소", () => {
    assert.deepEqual(
      mergeStackHints({ hosting: "bolt", tools: [] }, { hosting: "vercel", data: "supabase", tools: ["React"] }),
      { hosting: "bolt", data: "supabase", tools: ["React"] },
    );
    assert.equal(mergeStackHints(null, null), null);
  });
});

// ─── ⑤ 라우트 ────────────────────────────────────────────────────────────────

/** Anthropic 모양 응답. makeDevSpecLlmCaller가 prefill "{"를 되붙이므로 첫 "{"는 뺀다. */
function anthropicReply(obj) {
  const text = JSON.stringify(obj).slice(1);
  return new Response(JSON.stringify({ model: "claude-opus-5", content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 7 } }), { status: 200, headers: { "content-type": "application/json" } });
}

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = original; });
}

async function post(env, path, body) {
  const pending = [];
  const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {}, props: {} };
  const res = await createApp().fetch(new Request(`https://cp.example${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
  await Promise.all(pending);
  return { status: res.status, json: await res.json() };
}

/** 사이트(빌더 호스트) + LLM 세 패스. 사이트 HTML은 비어 있어도 된다 — 호스팅은 주소·헤더에서 읽는다. */
function fetchStub(calls) {
  return async (url, init) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://truepixel-yeyak.lovable.app")) {
      return new Response("<html><head><title>트루픽셀 예약</title></head><body><h1>미용실 예약</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    if (u.includes("anthropic") || u.includes("/v1/messages")) {
      const prompt = JSON.parse(init.body).messages[0].content;
      const pass = passOf(prompt);
      return anthropicReply(pass === "requirements" ? P1_ALL_MUST : pass === "surfaces" ? P2 : P3);
    }
    return new Response("not found", { status: 404 });
  };
}

function envFor(entryPath) {
  const projects = new Map([
    [PROJECT, projectRow(PROJECT, USER, {
      title: "(주)트루픽셀 예약 앱",
      idea: "손님이 원하는 날짜와 시간을 골라 미용실 예약을 잡는 웹앱",
      product_spec_json: JSON.stringify(brief),
      items_json: JSON.stringify(items),
      entry_path: entryPath,
    })],
  ]);
  return {
    ENVIRONMENT: "test",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    DB: makeFakeD1({ projects, sources: [websiteSource(PROJECT, USER, { reference: APP_URL })] }),
  };
}

function savedDevSpec(env) {
  const w = env.DB.writes.find((x) => x.sql.includes("UPDATE workspace_projects SET dev_spec_json"));
  assert.ok(w, "dev_spec_json 저장 쓰기가 있어야 한다");
  return JSON.parse(w.bound[0]);
}

describe("⑤ POST /dev-spec/generate — 기존 앱 문은 서버가 inferred로", () => {
  it("entry_path code + kept id → inferred·provenance(lovable·code·스택)·확인 AC, 저장본도 동일", async () => {
    __resetAnthropicBreaker();
    const env = envFor("code");
    const calls = [];
    const r = await withFetch(fetchStub(calls), () =>
      post(env, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko", confirmedItemIds: ["req_001", "req_003"] }));
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
    const d = r.json.devSpec;
    assert.equal(d.meta.source, "inferred");
    assert.equal(d.meta.provenance.builtWith, "lovable");
    assert.equal(d.meta.provenance.entryPath, "code");
    assert.equal(d.meta.provenance.detectedStack.hosting, "lovable");
    assert.deepEqual(d.meta.provenance.userConfirmedAcIds, ["AC-001", "AC-002"]);
    assert.deepEqual(r.json.summary.mustFeatureTitles, ["날짜 선택 예약", "예약 내역 확인"]);
    assert.deepEqual(savedDevSpec(env).meta.provenance, d.meta.provenance);
    assert.ok(calls.some((u) => u.startsWith(APP_URL)), "출처는 기존 증거 수집기로 주소를 읽어 얻는다");
  });

  it("옛 클라이언트(confirmedItemIds 없음) → userConfirmedAcIds 빈 배열, must 0", async () => {
    __resetAnthropicBreaker();
    const env = envFor("code");
    const r = await withFetch(fetchStub([]), () => post(env, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko" }));
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
    assert.deepEqual(r.json.devSpec.meta.provenance.userConfirmedAcIds, []);
    assert.deepEqual(r.json.summary.mustFeatureTitles, []);
  });

  it("아이디어 갈래는 종전대로 generated(provenance 없음·주소를 읽지 않음)", async () => {
    __resetAnthropicBreaker();
    const env = envFor("idea");
    const calls = [];
    const p2 = { ...P2, screens: [{ ...P2.screens[0], featureIds: ["FR-001", "FR-002", "FR-101"] }] };
    const stub = async (url, init) => {
      calls.push(String(url));
      const prompt = JSON.parse(init.body).messages[0].content;
      const pass = passOf(prompt);
      return anthropicReply(pass === "requirements" ? P1_ALL_MUST : pass === "surfaces" ? p2 : P3);
    };
    const r = await withFetch(stub, () => post(env, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, locale: "ko", confirmedItemIds: ["req_001"] }));
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
    assert.equal(r.json.devSpec.meta.source, "generated");
    assert.equal(r.json.devSpec.meta.provenance, undefined);
    assert.ok(!calls.some((u) => u.startsWith(APP_URL)));
  });

  it("confirmedItemIds 모양이 틀리면 400 invalid_confirmed_items(조용히 버리지 않는다)", async () => {
    const env = envFor("code");
    for (const bad of ["req_001", [1, 2], [""], Array.from({ length: 61 }, (_, i) => `req_${i}`)]) {
      const r = await post(env, `/workspace/projects/${PROJECT}/dev-spec/generate`, { userKey: USER, confirmedItemIds: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.json.error, "invalid_confirmed_items");
    }
  });
});

// ─── ⑥ README 출처 줄 (PR #577 리뷰 P2-3) ─────────────────────────────────────

/** 역추론 지시서의 README에서 출처 표기(생성 줄 다음 ~ 문서 구성 앞)만 잘라낸다. */
function provenanceBlock(readme) {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => l.startsWith("_") && l.endsWith("_"));
  const end = lines.findIndex((l) => l.startsWith("## "));
  assert.ok(start > 0 && end > start, readme);
  return lines.slice(start, end);
}

describe("⑥ README 출처 줄 — 무엇을 근거로 한 지시서인지 KO/EN으로 밝힌다", () => {
  const inferredWithProvenance = () =>
    specWith(
      {
        provenance: {
          builtWith: "lovable",
          entryPath: "code",
          detectedStack: { hosting: "lovable", data: "supabase", tools: ["React", "Tailwind CSS"] },
          userConfirmedAcIds: ["AC-001"],
        },
      },
      [
        { id: "FR-001", title: "날짜 선택 예약", description: "달력에서 날짜를 골라 예약한다", priority: "must" },
        { id: "FR-002", title: "후기 작성", description: "방문 후기를 남긴다", priority: "should" },
      ],
    );

  it("KO 스냅샷 — 확인한 수용 기준·만든 도구·시작한 곳(사람이 읽는 말)·감지한 구성", () => {
    const v = validateDevSpec(inferredWithProvenance());
    assert.equal(v.ok, true, JSON.stringify(v));
    const readme = renderDevSpecFiles(v.spec, "ko").find((f) => f.path.endsWith("README.md")).content;
    assert.deepEqual(provenanceBlock(readme), [
      "_기존 앱에서 역추론 — 사용자가 확인한 항목만 확정 · 2026-09-30T01:00:00.000Z_",
      "",
      "- 사용자가 확인한 수용 기준: AC-001",
      "- 만든 도구: lovable",
      "- 시작한 곳: 이미 만든 앱",
      "- 감지한 구성: lovable · supabase · React · Tailwind CSS",
      "",
    ]);
    // enum 원값("code")을 그대로 내보내지 않는다.
    assert.doesNotMatch(readme, /: code$/m);
  });

  it("EN 스냅샷 — 같은 줄 수·같은 순서(D-11), 한글 0", () => {
    const v = validateDevSpec(inferredWithProvenance());
    const readme = renderDevSpecFiles(v.spec, "en").find((f) => f.path.endsWith("README.md")).content;
    const block = provenanceBlock(readme);
    assert.deepEqual(block, [
      "_inferred from an existing app — only user-confirmed items are final · 2026-09-30T01:00:00.000Z_",
      "",
      "- Acceptance criteria the user confirmed: AC-001",
      "- Built with: lovable",
      "- Started from: An app already built",
      "- Detected setup: lovable · supabase · React · Tailwind CSS",
      "",
    ]);
    for (const l of block) assert.doesNotMatch(l, /[가-힣]/, l);
  });

  it("세 갈래 모두 사람이 읽는 말로(KO/EN) — 아이디어·기획서", () => {
    for (const [entryPath, ko, en] of [
      ["idea", "아이디어", "An idea"],
      ["spec", "기획서", "A plan or spec"],
    ]) {
      const v = validateDevSpec(specWith({ source: "generated", provenance: { entryPath } }));
      assert.equal(v.ok, true, JSON.stringify(v));
      const koReadme = renderDevSpecFiles(v.spec, "ko").find((f) => f.path.endsWith("README.md")).content;
      const enReadme = renderDevSpecFiles(v.spec, "en").find((f) => f.path.endsWith("README.md")).content;
      assert.match(koReadme, new RegExp(`^- 시작한 곳: ${ko}$`, "m"));
      assert.match(enReadme, new RegExp(`^- Started from: ${en}$`, "m"));
    }
  });

  it("확인한 수용 기준이 0개인 역추론 → '(없음)'으로 정직하게", () => {
    const v = validateDevSpec(
      specWith({ provenance: { userConfirmedAcIds: [] } }, [
        { id: "FR-001", title: "날짜 선택 예약", description: "d", priority: "should" },
        { id: "FR-002", title: "후기 작성", description: "d", priority: "could" },
      ]),
    );
    assert.equal(v.ok, true, JSON.stringify(v));
    const readme = renderDevSpecFiles(v.spec, "ko").find((f) => f.path.endsWith("README.md")).content;
    assert.deepEqual(provenanceBlock(readme).slice(2, -1), ["- 사용자가 확인한 수용 기준: (없음)"]);
  });

  it("provenance 없는 지시서(옛 저장·generated) → 출처 줄 0줄(가드 — 옛 코드에서도 통과, 회귀 증거 아님)", () => {
    for (const source of ["generated", "manual"]) {
      const v = validateDevSpec(specWith({ source }));
      assert.equal(v.ok, true, JSON.stringify(v));
      for (const loc of ["ko", "en"]) {
        const readme = renderDevSpecFiles(v.spec, loc).find((f) => f.path.endsWith("README.md")).content;
        const block = provenanceBlock(readme);
        assert.equal(block.length, 2, `${source}/${loc}: ${JSON.stringify(block)}`);
        assert.equal(block[1], "");
      }
    }
  });
});

describe("④′ POST /infer-intent — 역추론 결과에 provenance", () => {
  it("주소가 빌더 호스트면 builtWith·entryPath·detectedStack이 응답에 실린다(설명이 없어 초안이 비어도)", async () => {
    const env = envFor("code");
    const stub = async (url) => (String(url).startsWith(APP_URL)
      ? new Response("<html><body></body></html>", { status: 200, headers: { "content-type": "text/html" } })
      : new Response("nope", { status: 404 }));
    const r = await withFetch(stub, () => post(env, `/workspace/projects/${PROJECT}/infer-intent`, { userKey: USER, locale: "ko" }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.inferred, null);
    assert.equal(r.json.reason, "no_evidence");
    assert.deepEqual(r.json.provenance, { builtWith: "lovable", entryPath: "code", detectedStack: { hosting: "lovable" } });
  });
});
