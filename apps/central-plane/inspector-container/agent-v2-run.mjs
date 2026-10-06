/**
 * agent-v2-run.mjs — 검사 엔진 v2(engine "agent_v2") 실행기. 설계 정본: docs/simsa-inspector-v2-design-2026-10-07.md.
 *
 * 고리: 정찰(R) → 가설(H) → 계획(P) → 실행(E) → 확인(V) → 판정(J) → 고치기(F) → 재검사(L).
 * 모든 도구 결과는 증거물(EvidenceStore, id ev-N)이 되고, 판정은 기계 검증기(validateV2Verdict)를 통과한 것만 리포트에 오른다.
 *
 * 브라우저는 driver(agent-driver.mjs), 모델은 llm(Responses 프록시 클라이언트)으로 주입한다 — 테스트는 가짜 둘로 이 파일을 끝까지 돈다.
 */
async function importPure(name) {
  try {
    return await import(`./dist/${name}`);
  } catch {
    return import(`../dist/${name}`);
  }
}

const LOGIN_HANDOVER_WAIT_MS = 10 * 60 * 1000;
const SOURCE_READ_MAX_FILES = 12;
const SOURCE_READ_MAX_BYTES = 6_000_000;

/**
 * @param {object} o
 * @param {string} o.targetUrl
 * @param {string} o.intent
 * @param {"ko"|"en"} [o.locale]
 * @param {number} [o.budgetMs]
 * @param {Array} [o.acs]
 * @param {string} [o.acSource]
 * @param {"none"|"credentials"|"handover"} [o.loginMode]
 * @param {object} [o.credentials]
 * @param {object} [o.signup]
 * @param {object} o.driver
 * @param {Function} [o.llm]  Responses 클라이언트 ({instructions,input,tools,maxOutputTokens}) → {output, usage, model}
 */
export async function runAgentV2(o) {
  const pure = await importPure("agent-inspection.js");
  const v2 = await importPure("agent-v2.js");
  const nd = await importPure("nondev-report.js");
  const locale = o.locale === "en" ? "en" : "ko";
  const t0 = Date.now();
  const secrets = () => [o.credentials?.username, o.credentials?.password, ...(o.live?.typedSecrets?.() ?? [])].filter(Boolean);
  const red = (s) => pure.redactSecrets(String(s ?? ""), secrets());
  const plog = (msg) => {
    try {
      o.onPhase?.(red(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`));
    } catch {
      /* 진단이 런을 깨면 안 된다 */
    }
  };
  plog(`agent-v2 rev=${v2.AGENT_V2_RUNNER_REV} acs=${o.acs?.length ?? 0} login=${o.loginMode ?? "none"}`);

  const driver = o.driver;
  const store = new v2.EvidenceStore();
  const evidenceFiles = [];
  const shot = async (name) => {
    const f = await driver.screenshot(name).catch(() => null);
    if (f) evidenceFiles.push(f);
    return f?.name;
  };
  const state = {
    signals: {},
    landing: null,
    loginDepth: "L1",
    loginMethod: "none",
    acs: Array.isArray(o.acs) ? pure.orderAcs(o.acs, o.caps?.maxAcs ?? 11) : [],
    acSource: o.acSource ?? (o.acs?.length ? "confirmed_inferred" : "inferred_at_run"),
    records: [],
    staticFacts: [],
    readSources: new Map(),
    knownUrls: new Set(),
    firstHtml: "",
    firstBody: "",
    plan: null,
    toolCalls: 0,
    model: null,
    partial: false,
  };

  try {
    await driver.start(o.targetUrl);
    // ── R1 첫 화면: 열리지 않음·404·index 없음 → 곧바로 고장(LLM 0회) ──
    const first = await driver.goto(o.targetUrl);
    const firstBody = await driver.bodyText().catch(() => "");
    state.firstBody = firstBody;
    state.firstHtml = (await driver.html?.().catch(() => "")) ?? "";
    state.signals.loadStatus = first.status;
    const hostNotFound = nd.looksLikeHostNotFoundPage(firstBody);
    const missingIndexFile = nd.looksLikeMissingIndexFile(o.targetUrl, first.status, firstBody);
    const landing = v2.v2LandingBroken({ status: first.status, bodyText: firstBody, hostNotFound, missingIndexFile });
    const landingArt = store.add("request", "open", {
      summary: `${o.targetUrl} → HTTP ${first.status ?? "응답 없음"}${landing.broken ? ` (${landing.cause})` : ""}`,
      raw: `GET ${o.targetUrl}\nHTTP ${first.status ?? "no response"}\nfinal url: ${first.url}\n\n${red(firstBody).slice(0, 4000)}`,
    });
    state.landing = { broken: landing.broken, ...(landing.cause ? { cause: landing.cause } : {}), status: first.status, artifactId: landingArt.id };
    if (missingIndexFile) state.signals.missingIndexFile = true;
    await shot("v2-00-initial.png");
    plog(`landing status=${first.status} broken=${landing.broken}${landing.cause ? `(${landing.cause})` : ""}`);
    if (landing.broken) return finish();

    // ── 로그인(동의된 갈래만) — v1과 같은 세 갈래 ──
    await login();

    // ── R2 소스·번들 정적 사실(가설 재료, 판정 근거 아님 — V-4) ──
    await readSourcesAndFacts();
    plog(`recon facts=${state.staticFacts.length} sources=${state.readSources.size}`);

    // S3 이후: 가설·계획 → 실행 고리 → 확인 → 판정.
    if (typeof o.afterRecon === "function") await o.afterRecon({ v2, pure, store, state, red, plog, shot });
  } catch (err) {
    state.partial = true;
    plog(`agent-v2:error ${String(err?.message ?? err).slice(0, 160)}`);
  } finally {
    await driver.close().catch(() => {});
  }
  return finish();

  async function login() {
    if (o.loginMode === "credentials" && o.credentials) {
      const r = await driver.login(o.credentials);
      if (r.ok) {
        state.loginDepth = "L3";
        state.loginMethod = "credentials";
      }
      plog(`login:credentials ${r.ok ? "ok" : r.reason}`);
      await driver.goto(o.targetUrl);
    } else if (o.loginMode === "handover" && o.live) {
      o.live.setState("awaiting_login");
      const done = await o.live.waitDone(o.handoverWaitMs ?? LOGIN_HANDOVER_WAIT_MS);
      o.live.setState("running");
      if (done) {
        state.loginDepth = "L3";
        state.loginMethod = "handover";
      }
      plog(`login:handover ${done ? "done" : "timeout"}`);
      await driver.goto(o.targetUrl);
    } else if (o.signup?.enabled) {
      const r = await driver.signup({ ...o.signup, locale, plog });
      if (r?.ok) {
        state.loginDepth = "L3";
        state.loginMethod = "signup";
      }
      plog(`login:signup ${r?.ok ? "ok" : r?.blocker}`);
      await driver.goto(o.targetUrl);
    }
  }

  async function readSourcesAndFacts() {
    const origin = new URL(o.targetUrl).origin;
    state.knownUrls.add(v2.normalizeKnownUrl(o.targetUrl));
    const list = (await driver.listSources?.().catch(() => [])) ?? [];
    // 문서(HTML) 먼저, 그다음 스크립트 — 큰 번들도 앞에서 6MB까지.
    const ordered = [...list].sort((a, b) => Number(/\.js(\?|$)/.test(a)) - Number(/\.js(\?|$)/.test(b)));
    let bytes = 0;
    for (const url of ordered.slice(0, SOURCE_READ_MAX_FILES)) {
      if (bytes > SOURCE_READ_MAX_BYTES) break;
      const r = await driver.readSourceText?.(url).catch(() => null);
      if (!r?.ok || !r.text) continue;
      state.readSources.set(r.url, r.text);
      bytes += r.text.length;
    }
    state.staticFacts = v2.extractStaticFacts([...state.readSources].map(([url, text]) => ({ url, text })));
    for (const f of state.staticFacts) if (f.kind === "route") {
      try {
        state.knownUrls.add(v2.normalizeKnownUrl(new URL(f.value, origin).toString()));
      } catch {
        /* skip */
      }
    }
    store.add("source", "static_facts", {
      summary: locale === "en" ? `Read ${state.readSources.size} source file(s); ${state.staticFacts.length} notable fact(s)` : `소스 ${state.readSources.size}개를 읽고 눈여겨볼 사실 ${state.staticFacts.length}개`,
      raw: `${[...state.readSources.keys()].join("\n")}\n\n${v2.describeStaticFacts(state.staticFacts)}`,
    });
  }

  function finish() {
    const report = v2.buildV2Report(
      {
        targetUrl: o.targetUrl,
        intent: o.intent,
        acs: state.acs,
        acSource: state.acSource,
        records: state.records,
        store,
        signals: state.signals,
        sweep: null,
        loginDepth: state.loginDepth,
        loginMethod: state.loginMethod,
        landing: state.landing ?? undefined,
        partial: state.partial,
        firstHtml: state.firstHtml.slice(0, 200_000),
        model: state.model,
        staticFacts: state.staticFacts,
        plan: state.plan,
        toolCalls: state.toolCalls,
      },
      locale,
    );
    report.agent.durationMs = Date.now() - t0;
    const s = secrets();
    return {
      decision: report.verdict && report.agent.basis === "app_missing" ? "Needs Fix" : decisionOf(report),
      works: report.works,
      report: pure.redactDeep(report, s),
      agentPrompt: pure.redactSecrets(pure.buildAgentAcFixPrompt(report, locale), s),
      evidenceFiles,
    };
  }

  function decisionOf(report) {
    if (report.agent.basis === "intent_mismatch") return "Needs Fix";
    return pure.decideAgentVerdict({
      acs: state.acs,
      results: report.acTable.map((r) => ({ id: r.id, status: r.status, reason: r.reason, evidence: r.evidence, steps: 0, ...(r.exercised ? { exercised: r.exercised } : {}) })),
      sweep: null,
      signals: state.landing?.broken ? { ...state.signals, pageNotFound: true } : state.signals,
    }).decision;
  }
}
