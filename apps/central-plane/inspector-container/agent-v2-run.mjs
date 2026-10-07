/**
 * agent-v2-run.mjs — 검사 엔진 v2(engine "agent_v2") 실행기. 설계 정본: docs/simsa-inspector-v2-design-2026-10-07.md.
 *
 * 고리: 정찰(R) → 가설(H) → 계획(P) → 실행(E) → 확인(V) → 판정(J) → 고치기(F) → 재검사(L).
 * 모든 도구 결과는 증거물(EvidenceStore, id ev-N)이 되고, 판정은 기계 검증기(validateV2Verdict)를 통과한 것만 리포트에 오른다.
 *
 * 브라우저는 driver(agent-driver.mjs), 모델은 llm(Responses 프록시 클라이언트)으로 주입한다 — 테스트는 가짜 둘로 이 파일을 끝까지 돈다.
 */
import { classifyActionSafety } from "./safety.mjs";

/** 도구 호출 상한(런 하나) · 실행 시간 기본 · 대화 크기 상한(넘으면 오래된 도구 결과를 증거물 요약으로 압축). */
const DEFAULT_MAX_TOOL_CALLS = 220;
const DEFAULT_BUDGET_MS = 18 * 60 * 1000;
const CONTEXT_MAX_CHARS = 500_000;
const TOOL_OUTPUT_MAX = 12_000;
/** 한 기준의 판정이 기계 검증기에 이만큼 거절되면 확인 못 함으로 기록한다(증거를 더 모으면 다시 판정 가능). */
const MAX_REFUSALS_PER_AC = 3;

function v2LoginNote(method, locale) {
  const ko = { none: "로그인 계정 없음 — 로그인 뒤는 확인 못 함으로", signup: "일회용 계정으로 로그인됨", credentials: "주신 시험 계정으로 로그인됨", handover: "사용자가 직접 로그인해 넘겨줌" };
  const en = { none: "no account — anything behind login is not_verified (login_required)", signup: "logged in with a disposable account", credentials: "logged in with the given test account", handover: "the owner logged in and handed over" };
  return (locale === "en" ? en : ko)[method] ?? en.none;
}

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
  // 강제 시간 초과 때 바깥(server.mjs)이 여기까지의 증거로 부분 리포트를 만든다(빈손 실패 대신).
  if (o.progress && typeof o.progress === "object") {
    o.progress.partialResult = () => {
      state.partial = true;
      return finish();
    };
  }

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

    // 가설·계획 → 실행 고리 → 확인 → 판정(테스트는 afterRecon으로 정찰 결과만 볼 수 있다).
    if (typeof o.afterRecon === "function") await o.afterRecon({ v2, pure, store, state, red, plog, shot });
    else if (typeof o.llm === "function") await executeLoop();
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
    state.sourceArtifactId = store.add("source", "static_facts", {
      summary: locale === "en" ? `Read ${state.readSources.size} source file(s); ${state.staticFacts.length} notable fact(s)` : `소스 ${state.readSources.size}개를 읽고 눈여겨볼 사실 ${state.staticFacts.length}개`,
      raw: `${[...state.readSources.keys()].join("\n")}\n\n${v2.describeStaticFacts(state.staticFacts)}`,
    }).id;
  }

  // ── E 실행 고리: 최상급 모델이 도구로 조작하고, 증거물이 쌓이고, 판정은 기계 검증기를 통과한 것만 ──
  async function executeLoop() {
    const caps = {
      maxToolCalls: Math.max(20, Math.min(400, Number(o.caps?.maxToolCalls) || DEFAULT_MAX_TOOL_CALLS)),
      maxAcs: o.caps?.maxAcs ?? 11,
    };
    const deadline = Date.now() + (o.budgetMs && o.budgetMs > 0 ? o.budgetMs : DEFAULT_BUDGET_MS);
    state.acs = pure.orderAcs(pure.withCoreOutcomeAc(state.acs, o.intent, state.acSource !== "inferred_at_run", locale), Math.min(pure.AGENT_MAX_ACS + 1, caps.maxAcs));
    const acById = new Map(state.acs.map((a) => [a.id, a]));
    const criteriaText = state.acs.map((a) => `${a.title} ${a.given} ${a.when} ${a.then}`).join("\n");
    const data = pure.koreanTestData(Date.now() % 100000);
    state.testData = data;
    const hypotheses = v2.seedHypotheses(state.staticFacts);
    if (o.priorPlan) {
      state.plan = o.priorPlan;
      store.add("plan", "prior_plan", { summary: "이전 검사의 계획(재검사)", raw: v2.planText(o.priorPlan) });
    }
    const instructions = v2.v2Instructions(locale, { readOnly: o.readOnly === true, testData: { name: data.name, phone: data.phone } });
    let input = [
      {
        role: "user",
        content: v2.v2Kickoff({
          targetUrl: o.targetUrl,
          intent: o.intent,
          acs: state.acs,
          landing: { status: state.signals.loadStatus ?? null },
          loginNote: v2LoginNote(state.loginMethod, locale),
          facts: state.staticFacts,
          hypotheses,
          sourceArtifactId: state.sourceArtifactId,
          priorPlan: o.priorPlan ?? null,
        }),
      },
    ];
    const refusals = new Map();
    let finishNudged = false;
    let noCallTurns = 0;
    let llmErrors = 0;
    let finished = false;
    let baseline = await storageSig();
    let netStart = lastNetIndex();

    while (!finished) {
      if (Date.now() > deadline - 15_000 || state.toolCalls >= caps.maxToolCalls) {
        state.partial = true;
        plog(`loop stop: ${state.toolCalls >= caps.maxToolCalls ? "tool cap" : "time"}`);
        break;
      }
      input = v2.compactInput(input, CONTEXT_MAX_CHARS);
      let res;
      try {
        res = await o.llm({ instructions, input, tools: v2.V2_TOOLS, maxOutputTokens: 8000 });
      } catch (err) {
        const msg = String(err?.message ?? err);
        plog(`llm error ${msg.slice(0, 100)}`);
        if (/budget_exhausted|402/.test(msg)) {
          state.partial = true;
          state.budgetExhausted = true;
          break;
        }
        llmErrors += 1;
        if (llmErrors >= 3) {
          state.partial = true;
          break;
        }
        continue;
      }
      state.llmTurns = (state.llmTurns ?? 0) + 1;
      if (res?.model && !state.model) state.model = res.model;
      input.push(...v2.replayableOutput(res?.output));
      const calls = v2.functionCallsOf(res?.output);
      if (calls.length === 0) {
        noCallTurns += 1;
        if (noCallTurns >= 2) break;
        input.push({ role: "user", content: "Continue with the tools. Every criterion and INTENT needs record_verdict; call finish when done." });
        continue;
      }
      noCallTurns = 0;
      const images = [];
      for (const call of calls) {
        let out;
        try {
          out = call.argsError ? { text: `Arguments were not valid JSON (${call.argsError}). Try again.` } : await execTool(call.name, call.args);
        } catch (err) {
          out = { text: `Tool error: ${String(err?.message ?? err).split("\n")[0].slice(0, 200)}` };
        }
        input.push({ type: "function_call_output", call_id: call.callId, output: red(out.text).slice(0, TOOL_OUTPUT_MAX) });
        if (out.image) images.push(out.image);
        if (out.finished) finished = true;
      }
      for (const img of images.slice(-1)) {
        input.push({ role: "user", content: [{ type: "input_text", text: `Screenshot for ${img.id}` }, { type: "input_image", image_url: `data:image/jpeg;base64,${img.b64}` }] });
      }
    }
    plog(`loop done tools=${state.toolCalls} turns=${state.llmTurns ?? 0} verdicts=${state.records.length}`);

    function lastNetIndex() {
      const l = driver.netLog?.({ last: 1 }) ?? [];
      return l.length ? l[l.length - 1].i : 0;
    }

    async function storageSig() {
      const d = await driver.storageDump?.().catch(() => null);
      return d ? JSON.stringify({ l: d.local, s: d.session, i: d.indexedDB }) : "";
    }

    function header(a) {
      return `${a.id} (${a.kind}, browser ${a.context}${a.afterSubmit ? ", after submitting" : ""}${a.stateChange ? ", state changed" : ""})`;
    }

    function addKnownFrom(text) {
      for (const u of v2.extractKnownUrls(text, o.targetUrl)) state.knownUrls.add(u);
    }

    function cleanTarget(t) {
      const x = t && typeof t === "object" ? t : {};
      const out = {};
      for (const k of ["role", "name", "label", "placeholder", "text"]) if (typeof x[k] === "string" && x[k].trim()) out[k] = x[k].trim().slice(0, 200);
      return out;
    }

    async function screenAfter(maxChars = 2500) {
      const text = red(await driver.bodyText().catch(() => ""));
      return `url: ${driver.url?.() ?? ""}\n${text.slice(0, maxChars)}`;
    }

    async function execTool(name, args) {
      state.toolCalls += 1;
      switch (name) {
        case "observe": {
          const obs = await driver.observe();
          const links = (await driver.links?.().catch(() => [])) ?? [];
          const linkLines = [];
          for (const l of links.slice(0, 80)) {
            try {
              const u = new URL(l.href, obs.url);
              if (u.origin === new URL(o.targetUrl).origin) {
                state.knownUrls.add(v2.normalizeKnownUrl(u.toString()));
                linkLines.push(`${l.text || "(no text)"} → ${u.pathname}${u.hash}`);
              }
            } catch {
              /* skip */
            }
          }
          state.knownUrls.add(v2.normalizeKnownUrl(obs.url));
          const raw = red(`url: ${obs.url}\ntitle: ${obs.title}\n--- accessibility ---\n${String(obs.aria ?? "").slice(0, 7000)}\n--- text ---\n${String(obs.text ?? "").slice(0, 3000)}\n--- links ---\n${linkLines.join("\n")}`);
          const a = store.add("screen", "observe", { summary: `${obs.url} 화면: ${String(obs.text ?? "").replace(/\s+/g, " ").slice(0, 160)}`, raw });
          let image = null;
          if (args.screenshot === true) {
            const b64 = await driver.screenshotJpeg?.().catch(() => null);
            if (b64) image = { id: a.id, b64 };
          }
          return { text: `${header(a)}\n${raw}`, ...(image ? { image } : {}) };
        }
        case "click":
        case "fill":
        case "select":
        case "press": {
          const target = cleanTarget(args.target);
          if (name === "click") {
            const label = target.name ?? target.text ?? target.label ?? "";
            const safety = classifyActionSafety(label);
            if (!safety.safe && safety.category !== "empty/unknown") return { text: `Refused: "${label}" looks like a ${safety.category} action; the inspector never does that. If a criterion needs it, it is not_verified (unsafe_action).` };
          }
          if (o.readOnly && (name === "click" || name === "press") && store.pendingInput) {
            return { text: "Refused: READ-ONLY run — submitting entered data would create records. Judge criteria that need it as not_verified (write_not_allowed)." };
          }
          const before = await driver.signature?.().catch(() => "") ?? "";
          const action = name === "press" ? { type: "press", key: String(args.key ?? "Enter").slice(0, 30) } : { type: name, target, ...(name !== "click" ? { value: String(args.value ?? "").slice(0, 500) } : {}) };
          const res = await driver.act(action);
          const { submitted } = res.ok ? store.noteAction(name) : { submitted: false };
          const after = await driver.signature?.().catch(() => "") ?? "";
          const changed = Boolean(before) && before !== after;
          state.knownUrls.add(v2.normalizeKnownUrl(driver.url?.() ?? o.targetUrl));
          const scr = await screenAfter();
          const a = store.add("diff", name, {
            summary: `${name} ${target.name ?? target.label ?? target.placeholder ?? target.text ?? action.key ?? ""} → ${res.ok ? (changed ? "화면 바뀜" : "화면 그대로") : "실패"}${submitted ? " (제출)" : ""}`,
            raw: `${name} ${JSON.stringify(target)} ${res.ok ? "ok" : "failed"}: ${red(res.note ?? "")}\nscreen changed: ${changed}\n${scr}`,
            stateChange: res.ok && changed,
          });
          return { text: `${header(a)}\n${res.ok ? "ok" : "FAILED"}: ${red(res.note ?? "")}\nscreen changed: ${changed}${submitted ? "\n(this was a submit)" : ""}${!changed && res.ok ? "\nNO VISIBLE CHANGE — look for a required choice, a validation message or a disabled button; don't repeat." : ""}\n${scr}` };
        }
        case "navigate": {
          const ok = v2.navigateAllowed(String(args.url ?? ""), o.targetUrl, state.knownUrls, criteriaText);
          if (!ok.ok) return { text: ok.why === "other_origin" ? "Refused: other sites are out of scope." : "Refused: you have not seen this address (links, requests, routes in the source). Find how a user gets there; guessed addresses are not evidence." };
          const r = await driver.goto(ok.url);
          store.noteAction("navigate");
          const scr = await screenAfter();
          const a = store.add("screen", "navigate", { summary: `${ok.url} 열기 → HTTP ${r.status ?? "?"}`, raw: `open ${ok.url} → HTTP ${r.status ?? "?"}\n${scr}` });
          return { text: `${header(a)}\nHTTP ${r.status ?? "?"}\n${scr}` };
        }
        case "back":
        case "reload":
        case "wait": {
          const res = await driver.act(name === "wait" ? { type: "wait", ms: Math.max(100, Math.min(8000, Number(args.ms) || 1000)) } : { type: name });
          store.noteAction(name);
          const scr = await screenAfter();
          const a = store.add("screen", name, { summary: `${name} → ${String(driver.url?.() ?? "")}`, raw: `${name}: ${res.note ?? ""}\n${scr}` });
          return { text: `${header(a)}\n${scr}` };
        }
        case "network_log": {
          const entries = driver.netLog?.({ filter: typeof args.filter === "string" ? args.filter : null, last: Number(args.last) || 40 }) ?? [];
          const lines = entries.map((e) => `#${e.i}${e.i > netStart ? "" : " (earlier browser)"} ${e.method} ${e.url} → ${e.status ?? "failed"} [${e.type}]${e.reqBody ? `\n  sent: ${e.reqBody.slice(0, 400)}` : ""}${e.resBody ? `\n  got: ${e.resBody.slice(0, 600)}` : ""}`);
          const writeOk = entries.some((e) => e.i > netStart && e.method !== "GET" && e.method !== "OPTIONS" && typeof e.status === "number" && e.status >= 200 && e.status < 300);
          const raw = red(lines.join("\n") || "(no requests recorded)");
          addKnownFrom(raw);
          const a = store.add("request", "network_log", { summary: `요청 ${entries.length}건${writeOk ? " (저장 요청 성공 포함)" : ""}`, raw, stateChange: writeOk && store.submittedEver });
          return { text: `${header(a)}\n${raw}` };
        }
        case "storage_dump": {
          const d = (await driver.storageDump?.().catch(() => null)) ?? { local: [], session: [], indexedDB: [], cookies: [] };
          const sig = JSON.stringify({ l: d.local, s: d.session, i: d.indexedDB });
          const changed = sig !== baseline;
          const fmt = (arr) => arr.map((x) => `  ${x.key} (${x.size} chars): ${x.preview}`).join("\n");
          const raw = red(`localStorage:\n${fmt(d.local) || "  (empty)"}\nsessionStorage:\n${fmt(d.session) || "  (empty)"}\nIndexedDB: ${d.indexedDB.join(", ") || "(none)"}\ncookies: ${d.cookies.map((c) => `${c.name}@${c.domain}`).join(", ") || "(none)"}\nchanged since this browser opened: ${changed}`);
          const a = store.add("storage", "storage_dump", { summary: `저장소: ${[...d.local, ...d.session].map((x) => x.key).slice(0, 6).join(", ") || "비어 있음"}${changed ? " (바뀜)" : ""}`, raw, stateChange: changed && store.submittedEver });
          return { text: `${header(a)}\n${raw}` };
        }
        case "list_sources": {
          const list = (await driver.listSources?.().catch(() => [])) ?? [];
          const raw = list.join("\n");
          const a = store.add("source", "list_sources", { summary: `소스 ${list.length}개`, raw });
          return { text: `${header(a)}\n${raw}` };
        }
        case "read_source": {
          const url = String(args.url ?? "");
          let text = null;
          let key = url;
          try {
            key = new URL(url, o.targetUrl).toString().split("#")[0];
          } catch {
            /* keep */
          }
          if (state.readSources.has(key)) text = state.readSources.get(key);
          else {
            const r = await driver.readSourceText?.(url).catch(() => null);
            if (!r?.ok) return { text: `Could not read ${url} (${r?.error ?? r?.status ?? "failed"}). Only same-origin files.` };
            state.readSources.set(r.url, r.text);
            key = r.url;
            text = r.text;
          }
          const off = Math.max(0, Number(args.offset) || 0);
          const len = Math.max(200, Math.min(12000, Number(args.length) || 8000));
          const slice = text.slice(off, off + len);
          addKnownFrom(slice);
          const a = store.add("source", "read_source", { summary: `${key.split("/").pop()} [${off}…${off + slice.length} / ${text.length}]`, raw: slice });
          return { text: `${header(a)}\n${key} chars ${off}-${off + slice.length} of ${text.length}\n${slice}` };
        }
        case "grep_source": {
          let re;
          try {
            re = new RegExp(String(args.pattern ?? "").slice(0, 200), "gi");
          } catch (err) {
            return { text: `Invalid regex: ${String(err?.message ?? err).slice(0, 100)}` };
          }
          const list = (await driver.listSources?.().catch(() => [])) ?? [];
          for (const u of list.slice(0, 24)) {
            if (state.readSources.has(u)) continue;
            const r = await driver.readSourceText?.(u).catch(() => null);
            if (r?.ok) state.readSources.set(r.url, r.text);
          }
          const hits = [];
          for (const [u, t] of state.readSources) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(t)) !== null && hits.length < 25) {
              if (m[0].length === 0) {
                re.lastIndex += 1;
                continue;
              }
              hits.push(`[${u.split("/").pop()} @${m.index}] ${t.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160)}`);
            }
            if (hits.length >= 25) break;
          }
          const raw = hits.join("\n---\n") || "(no matches)";
          addKnownFrom(raw);
          const a = store.add("source", "grep_source", { summary: `소스 검색 /${String(args.pattern).slice(0, 40)}/ → ${hits.length}곳`, raw });
          return { text: `${header(a)}\n${raw}` };
        }
        case "console_errors": {
          const list = driver.consoleErrorList?.() ?? [];
          const raw = red(list.join("\n") || "(no console errors)");
          const a = store.add("console", "console_errors", { summary: `콘솔 오류 ${list.length}건`, raw });
          return { text: `${header(a)}\n${raw}` };
        }
        case "new_context": {
          const ok = v2.navigateAllowed(String(args.url ?? o.targetUrl), o.targetUrl, state.knownUrls, criteriaText);
          if (!ok.ok) return { text: "Refused: open a new browser only at an address you have seen in this app." };
          store.newContext();
          const tz = typeof args.timezone === "string" && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(args.timezone) ? args.timezone : null;
          const r = await driver.newContextAt(ok.url, { timezoneId: tz });
          baseline = await storageSig();
          netStart = lastNetIndex();
          const scr = await screenAfter(3500);
          const a = store.add("context", "new_context", { summary: `새 브라우저${tz ? `(${tz})` : ""}: ${ok.url} → ${scr.split("\n")[1]?.slice(0, 120) ?? ""}`, raw: `new browser at ${ok.url} → HTTP ${r.status ?? "?"}\n${scr}`, stateChange: store.submittedEver });
          return { text: `${header(a)}\nHTTP ${r.status ?? "?"}\n${scr}` };
        }
        case "set_clock": {
          const iso = String(args.iso ?? "");
          if (!Number.isFinite(Date.parse(iso))) return { text: "Invalid ISO time." };
          await driver.setClock(iso);
          store.noteAction("clock");
          const scr = await screenAfter();
          const a = store.add("screen", "set_clock", { summary: `시계를 ${iso}로`, raw: `clock set to ${iso}\n${scr}` });
          return { text: `${header(a)}\n${scr}` };
        }
        case "set_viewport": {
          const v = await driver.setViewport(Number(args.width) || 390, Number(args.height) || 844);
          store.noteAction("viewport");
          const scr = await screenAfter(1500);
          const a = store.add("screen", "set_viewport", { summary: `화면 ${v.width}×${v.height}, 가로 넘침 ${v.overflowPx}px`, raw: `viewport ${v.width}x${v.height}; horizontal overflow ${v.overflowPx}px\n${scr}` });
          return { text: `${header(a)}\noverflow ${v.overflowPx}px\n${scr}` };
        }
        case "record_plan": {
          const { plan, missingMust } = v2.normalizePlan(args, state.acs);
          if (missingMust.length > 0 && !refusals.has("__plan")) {
            refusals.set("__plan", 1);
            return { text: `Plan refused: no steps for must criteria ${missingMust.join(", ")}. Add them.` };
          }
          state.plan = plan;
          const a = store.add("plan", "record_plan", { summary: `계획: 가설 ${plan.hypotheses.length} · 기준 ${plan.items.length}`, raw: v2.planText(plan) });
          return { text: `${a.id} plan saved (${plan.items.length} criteria, ${plan.hypotheses.length} hypotheses). Execute it.` };
        }
        case "record_verdict":
          return recordVerdict(args);
        case "finish": {
          const missing = [...state.acs.map((a) => a.id), v2.INTENT_AC_ID].filter((id) => !state.records.some((r) => r.acId === id));
          if (missing.length > 0 && !finishNudged && Date.now() < deadline - 60_000 && state.toolCalls < caps.maxToolCalls - 5) {
            finishNudged = true;
            return { text: `Still missing verdicts for: ${missing.join(", ")}. Judge them (not_verified with a reason if you truly cannot), then finish.` };
          }
          return { text: "Finished.", finished: true };
        }
        default:
          return { text: `Unknown tool ${name}.` };
      }
    }

    async function recordVerdict(args) {
      const j = {
        acId: String(args.acId ?? ""),
        verdict: v2.V2_VERDICTS.includes(args.verdict) ? args.verdict : "not_verified",
        claim: String(args.claim ?? "").slice(0, 800),
        artifactIds: Array.isArray(args.artifactIds) ? args.artifactIds.map(String).slice(0, 12) : [],
        quotes: Array.isArray(args.quotes) ? args.quotes.map(String).slice(0, 8) : [],
        reasonCode: typeof args.reasonCode === "string" ? args.reasonCode : null,
        cause: args.cause && typeof args.cause === "object" ? args.cause : null,
      };
      if (!state.plan && j.verdict !== "not_verified" && !refusals.has("__noplan")) {
        refusals.set("__noplan", 1);
        return { text: "Refused: record_plan first (hypotheses + QA plan), then execute it, then judge." };
      }
      const check = v2.validateV2Verdict(j, acById.get(j.acId), store);
      const prior = state.records.find((r) => r.acId === j.acId);
      if (!check.accept) {
        if (check.problem === "unknown_ac" || check.problem === "verdict_on_intent" || check.problem === "mismatch_on_criterion") return { text: check.feedback };
        const n = (refusals.get(j.acId) ?? 0) + 1;
        refusals.set(j.acId, n);
        state.refusals = (state.refusals ?? 0) + 1;
        if (n >= MAX_REFUSALS_PER_AC) {
          // 끝까지 통과하지 못한 판정은 확인 못 함(정직한 이유) — 이미 받아들인 판정이 있으면 그대로 둔다.
          if (!prior || prior.verdict === "not_verified") {
            upsert({ acId: j.acId, verdict: "not_verified", claim: "", artifactIds: [], quotes: [], reasonCode: v2.downgradeReason(check.problem), exercised: { stateChange: false, verified: false }, refusals: n });
          }
          return { text: `${check.feedback}\nRecorded as not verified for now (${v2.downgradeReason(check.problem)}). If you gather the required evidence you may judge it again.` };
        }
        return { text: check.feedback };
      }
      let cause;
      let causeNote = "";
      if (j.cause && (check.verdict === "fail" || check.verdict === "mismatch")) {
        if (v2.causeIsGrounded(j.cause, state.readSources)) cause = { file: String(j.cause.file).slice(0, 300), where: String(j.cause.where).slice(0, 200), snippet: String(j.cause.snippet).slice(0, 600), explanation: String(j.cause.explanation).slice(0, 500) };
        else causeNote = "\nNote: the cause snippet is not in any source you read — cause dropped. Read the code and copy the snippet exactly if you want it included.";
      }
      upsert({
        acId: j.acId,
        verdict: check.verdict,
        claim: j.claim,
        artifactIds: check.cited.map((a) => a.id),
        quotes: j.quotes,
        ...(check.reasonCode ? { reasonCode: check.reasonCode } : {}),
        exercised: check.exercised,
        ...(cause ? { cause } : {}),
        refusals: refusals.get(j.acId) ?? 0,
      });
      if (check.verdict !== "not_verified") await shot(`v2-${j.acId.replace(/[^A-Za-z0-9_-]/g, "_")}.png`);
      return { text: `Verdict accepted: ${j.acId} = ${check.verdict}.${causeNote}` };
    }

    function upsert(rec) {
      const i = state.records.findIndex((r) => r.acId === rec.acId);
      if (i >= 0) state.records[i] = rec;
      else state.records.push(rec);
    }
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
    report.agent.llmCalls = state.llmTurns ?? 0;
    if (state.testData && store.submittedEver) {
      const d = state.testData;
      report.agent.testData = { names: [d.name, d.altName], phone: d.phone, memo: d.memo };
      report.notes.push(locale === "en" ? `This check may have created test records in your app (name ${d.name}, phone ${d.phone}). You can delete them.` : `이번 확인이 앱에 시험 기록을 남겼을 수 있어요(이름 ${d.name}, 번호 ${d.phone}). 지우셔도 돼요.`);
    }
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
