/**
 * agent-run.mjs — 검수 "agent" 엔진: 수용 기준(AC) 실행기 (2026-10-05).
 *
 * 한 런의 순서(세 문 공통):
 *   1) 첫 화면 열기 + #594 신호(없는 앱 404·첫 화면 파일 없음)
 *   2) 로그인(동의된 경우만) — 일회용 계정 가입(signup-run.mjs 재사용) · 시험 계정(login) · 직접 로그인 넘겨주기(라이브)
 *   3) 기준 — 받은 AC(지시서·확인된 추론·기획서·원 런) 또는 첫 화면을 보고 추정(미확인 표시)
 *   4) 화면·버튼 점검(같은 출처 화면 ≤25 · 안전한 버튼 ≤60, classifyActionSafety)
 *   5) AC 하나씩: 관찰 → LLM이 행동 하나 → 검증·안전 판정 → 실행 … → 판정(증거 접지 확인)
 *   6) 판정 사다리 · 리포트(AC 표 + 화면·버튼 점검) · 고침 지시(실제 실패만) — 비밀은 전부 가린 뒤 돌려준다
 *
 * 브라우저는 driver, 판단은 llm으로 주입한다 — 테스트는 가짜 둘로 이 파일을 끝까지 돈다(네트워크·브라우저 없음).
 */
import { classifyActionSafety } from "./safety.mjs";

/** 순수 모듈 — 이미지 안(./dist)과 저장소(../dist, central-plane tsc 출력) 둘 다에서 찾는다. */
async function importPure(name) {
  try {
    return await import(`./dist/${name}`);
  } catch {
    return import(`../dist/${name}`);
  }
}

export const AGENT_RUNNER_REV = "agent-ac-1";
const SWEEP_TIME_SHARE = 0.3;
const SWEEP_MAX_MS = 4 * 60 * 1000;
const LOGIN_HANDOVER_WAIT_MS = 10 * 60 * 1000;

/**
 * @param {object} o
 * @param {string} o.targetUrl
 * @param {string} o.intent
 * @param {"ko"|"en"} [o.locale]
 * @param {number} [o.budgetMs]  로그인 대기 뒤부터 세는 실행 예산
 * @param {Array} [o.acs]
 * @param {string} [o.acSource]
 * @param {"none"|"credentials"|"handover"} [o.loginMode]
 * @param {{username:string,password:string,loginUrl?:string}} [o.credentials]
 * @param {object} [o.signup]   signup-run.mjs 옵션(동의된 경우만)
 * @param {(req:{system:string,user:string,maxTokens?:number}) => Promise<string>} o.llm
 * @param {object} o.driver      agent-driver.mjs 인터페이스
 * @param {{ setState:(s:string)=>void, waitDone:(ms:number)=>Promise<boolean>, typedSecrets:()=>string[] }} [o.live]
 */
export async function runAgentInspection(o) {
  const pure = await importPure("agent-inspection.js");
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
  plog(`agent-runner-rev=${AGENT_RUNNER_REV} acs=${o.acs?.length ?? 0} login=${o.loginMode ?? "none"}`);

  const driver = o.driver;
  const evidenceFiles = [];
  const shot = async (name) => {
    const f = await driver.screenshot(name).catch(() => null);
    if (f) evidenceFiles.push(f);
    return f?.name;
  };
  const llmCalls = { n: 0, failed: 0, budgetExhausted: false };
  const callLlm = async (system, user, maxTokens = 700) => {
    if (llmCalls.budgetExhausted) throw new Error("budget_exhausted");
    llmCalls.n += 1;
    try {
      return await o.llm({ system, user: red(user), maxTokens });
    } catch (err) {
      llmCalls.failed += 1;
      if (/budget_exhausted|402/.test(String(err?.message ?? err))) llmCalls.budgetExhausted = true;
      throw err;
    }
  };

  const signals = {};
  let loginDepth = "L1";
  let loginMethod = "none";
  let loginFailed = false;
  let handoverState = null;
  let results = [];
  let sweep = null;
  let acs = Array.isArray(o.acs) ? pure.orderAcs(o.acs) : [];
  let acSource = o.acSource ?? (acs.length ? "confirmed_inferred" : "inferred_at_run");
  let partial = false;
  let deadline = Infinity;
  let firstHtml = "";
  let usedTestData = null;
  let singleFileFix = null;
  /** C11: 진행 상황을 바깥(server.mjs)에 보인다 — 강제 시간 초과 때 여기까지로 부분 리포트를 만든다. */
  const progress = o.progress ?? {};
  const syncProgress = () => {
    Object.assign(progress, {
      targetUrl: o.targetUrl, intent: o.intent, locale, acs, acSource, results: [...results], sweep, signals,
      loginDepth, loginMethod, secrets: secrets(),
    });
  };

  try {
    await driver.start(o.targetUrl);
    // 1) 첫 화면 + #594 신호
    const first = await driver.goto(o.targetUrl);
    signals.loadStatus = first.status;
    const firstBody = await driver.bodyText();
    firstHtml = (await driver.html?.().catch(() => "")) ?? "";
    const statusNotFound = !!first.status && first.status >= 400 && first.status < 500 && !nd.isLoginWallStatus(first.status);
    signals.pageNotFound = statusNotFound || nd.looksLikeHostNotFoundPage(firstBody);
    signals.missingIndexFile = statusNotFound && nd.looksLikeMissingIndexFile(o.targetUrl, first.status, firstBody);
    await shot("agent-00-initial.png");
    plog(`first status=${first.status} notFound=${signals.pageNotFound}`);

    if (!signals.pageNotFound) {
      // 2) 로그인 — 동의된 갈래만
      if (o.loginMode === "credentials" && o.credentials) {
        const r = await driver.login(o.credentials);
        if (r.ok) {
          loginDepth = "L3";
          loginMethod = "credentials";
        } else loginFailed = true;
        plog(`login:credentials ${r.ok ? "ok" : r.reason}`);
        await driver.goto(o.targetUrl);
      } else if (o.loginMode === "handover" && o.live) {
        o.live.setState("awaiting_login");
        plog("login:handover waiting");
        const done = await o.live.waitDone(o.handoverWaitMs ?? LOGIN_HANDOVER_WAIT_MS);
        o.live.setState("running");
        if (done) {
          handoverState = await driver.captureState().catch(() => null);
          loginDepth = "L3";
          loginMethod = "handover";
        }
        plog(`login:handover ${done ? "done" : "timeout"}`);
        await driver.goto(o.targetUrl);
      } else if (o.signup?.enabled) {
        const r = await driver.signup({ ...o.signup, locale, plog });
        if (r?.ok) {
          loginDepth = "L3";
          loginMethod = "signup";
        }
        plog(`login:signup ${r?.ok ? "ok" : r?.blocker}`);
        await driver.goto(o.targetUrl);
      }
    }

    // 실행 예산은 로그인(사람 대기) 뒤부터.
    deadline = o.budgetMs && o.budgetMs > 0 ? Date.now() + o.budgetMs : Infinity;
    const timeLeft = () => deadline - Date.now();

    if (!signals.pageNotFound) {
      // 3) 기준 — 없으면 첫 화면을 보고 추정(미확인)
      if (acs.length === 0) {
        try {
          const obs = await driver.observe();
          const text = await callLlm("You write acceptance criteria. Reply with JSON only.", pure.acInferencePrompt(o.intent, redObs(obs), locale), 1500);
          acs = pure.orderAcs(pure.parseInferredAcs(text));
          acSource = "inferred_at_run";
          plog(`acs:inferred n=${acs.length}`);
        } catch (err) {
          plog(`acs:infer failed ${String(err?.message ?? err).slice(0, 60)}`);
        }
      }

      // 3b) Simsa 기본 기준 — 핵심 일을 실제로 끝까지(모든 앱 공통). 의도가 사용자 확인 기준에서 왔을 때만 confirmed.
      acs = pure.orderAcs(pure.withCoreOutcomeAc(acs, o.intent, acSource !== "inferred_at_run", locale), pure.AGENT_MAX_ACS + 1);
      syncProgress();

      // 4) 화면·버튼 점검
      const sweepBudget = Math.min(SWEEP_MAX_MS, Number.isFinite(timeLeft()) ? timeLeft() * SWEEP_TIME_SHARE : SWEEP_MAX_MS);
      sweep = await runSweep({ driver, pure, startUrl: o.targetUrl, until: Date.now() + sweepBudget, shot, plog });
      plog(`sweep screens=${sweep.screens.length} buttons=${sweep.buttons.length}`);
      syncProgress();

      // 5) AC 실행
      const data = pure.koreanTestData(Date.now() % 100000);
      usedTestData = data;
      for (const ac of acs) {
        if (timeLeft() < 20_000 || llmCalls.budgetExhausted) {
          partial = true;
          results.push({ id: ac.id, status: "not_verified", reason: pure.reasonText("budget", locale), reasonCode: "budget", evidence: [], steps: 0 });
          continue;
        }
        const acArgs = { ac, o, pure, driver, callLlm, locale, data, hasCredentials: loginMethod === "credentials" || loginMethod === "handover", loginFailed, handoverState, deadline, shot, plog };
        let r = await runOneAc(acArgs);
        // (1) 시각 경계: 날짜·시간에 걸린 must가 통과하면 기기 시계를 한국 시간 새벽 00:30으로 옮겨 한 번 더.
        if (r.status === "pass" && ac.priority === "must" && pure.isTimeRelated(ac) && timeLeft() > 90_000 && !llmCalls.budgetExhausted) {
          const iso = pure.kstEarlyMorningIso(Date.now());
          const v = await runOneAc({ ...acArgs, clockIso: iso });
          r = pure.mergeClockVariant(r, v, iso, locale);
          plog(`ac ${ac.id} clock-variant → ${v.status}`);
        }
        results.push(r);
        syncProgress();
        plog(`ac ${ac.id} → ${r.status}${r.reasonCode ? `(${r.reasonCode})` : ""} steps=${r.steps}`);
      }

      // #594 H4: 화면 언어와 다른 결과 언어(한국어 앱에 중국어·일본어)
      const lastText = await driver.bodyText().catch(() => "");
      signals.outputLanguageMismatch = nd.detectOutputLanguageMismatch(firstBody, lastText) ?? null;

      // B5: 단일 파일 앱이면 고친 파일을 만들고, 그 파일로 실패했던 기준을 다시 돌려 검증한다.
      if (o.singleFileFix !== false && driver.fetchSource && driver.serveOverride && timeLeft() > 120_000 && !llmCalls.budgetExhausted) {
        singleFileFix = await trySingleFileFix({ acs, results, data: usedTestData }).catch((err) => ({ attempted: true, error: String(err?.message ?? err).slice(0, 120) }));
        plog(`single-file-fix ${singleFileFix ? JSON.stringify({ v: singleFileFix.validated, s: singleFileFix.stillFailing, e: singleFileFix.error }) : "skipped"}`);
      }
    }
  } catch (err) {
    partial = true;
    plog(`agent:error ${String(err?.message ?? err).slice(0, 120)}`);
  } finally {
    await driver.close().catch(() => {});
  }

  const report = pure.buildAgentReport(
    { targetUrl: o.targetUrl, intent: o.intent, acs, acSource, results, sweep, signals, loginDepth, loginMethod, partial, firstHtml: firstHtml.slice(0, 200_000) },
    locale,
  );
  report.agent.llmCalls = llmCalls.n;
  // C8: 이번 확인이 앱에 남겼을 수 있는 기록의 표지 — 사용자가 찾아 지울 수 있게 리포트에 적는다.
  if (usedTestData) {
    report.agent.testData = { names: [usedTestData.name, usedTestData.altName], phone: usedTestData.phone, memo: usedTestData.memo };
    report.notes.push(locale === "en" ? `This check may have created test records in your app (names ${usedTestData.name}/${usedTestData.altName}, phone ${usedTestData.phone}). You can delete them.` : `이번 확인이 앱에 시험 기록을 남겼을 수 있어요(이름 ${usedTestData.name}/${usedTestData.altName}, 번호 ${usedTestData.phone}). 지우셔도 돼요.`);
  }
  if (singleFileFix) {
    report.agent.singleFileFix = singleFileFix;
    if (singleFileFix.validated?.length) {
      report.notes.push(
        locale === "en"
          ? `We made a corrected index.html and re-ran the failed criteria against it: ${singleFileFix.validated.join(", ")} now pass. Download it from this report.`
          : `고친 index.html을 만들어 실패했던 기준을 그 파일로 다시 해 봤어요: ${singleFileFix.validated.join(", ")} 통과. 이 리포트에서 받으실 수 있어요.`,
      );
    }
  }
  report.agent.durationMs = Date.now() - t0;
  if (loginFailed) report.notes.push(pure.reasonText("login_failed", locale));
  const agentPrompt = pure.buildAgentAcFixPrompt(report, locale);
  // 마지막 방어선: 내보내는 모든 글자에서 비밀을 가린다(로그인 아이디가 화면에 "○○님"으로 떠 인용된 경우 포함).
  const s = secrets();
  return {
    decision: pure.decideAgentVerdict({ acs, results, sweep, signals }).decision,
    works: report.works,
    report: pure.redactDeep(report, s),
    agentPrompt: pure.redactSecrets(agentPrompt, s),
    evidenceFiles,
  };

  function redObs(obs) {
    return { ...obs, aria: red(obs.aria), text: red(obs.text), title: red(obs.title), url: red(obs.url) };
  }

  /** B5 — 단일 파일 앱의 고친 파일 + 실패 기준 재검증(검증 통과분만 "고쳐짐"). */
  async function trySingleFileFix({ acs, results, data }) {
    const sf = await import("./single-file-fix.mjs");
    const failed = acs
      .map((a) => ({ a, r: results.find((x) => x.id === a.id) }))
      .filter(({ a, r }) => r?.status === "fail" && (a.priority === "must" || a.confirmed))
      .map(({ a, r }) => ({ id: a.id, title: a.title, then: a.then, actions: r.actions, reason: r.reason, evidence: r.evidence }));
    if (failed.length === 0) return null;
    const source = await driver.fetchSource(o.targetUrl);
    if (!sf.isSingleFileApp(source, o.targetUrl)) return null;
    const text = await callLlm("You fix single-file web apps. Reply with JSON only.", sf.singleFileFixPrompt(source, failed, locale), 4000);
    const parsed = pure.extractJsonObject(text) ?? {};
    const applied = sf.applyExactEdits(source, parsed.edits);
    const cannotFix = Array.isArray(parsed.cannotFix) ? parsed.cannotFix.filter((x) => typeof x === "string").slice(0, 10) : [];
    if (!applied.ok) return { attempted: true, error: applied.error, cannotFix };
    await driver.serveOverride(o.targetUrl, applied.html);
    const validated = [];
    const stillFailing = [];
    try {
      for (const f of failed) {
        if (Date.now() > deadline - 30_000) break;
        const ac = acs.find((a) => a.id === f.id);
        const r = await runOneAc({ ac, o, pure, driver, callLlm, locale, data, hasCredentials: false, loginFailed, handoverState: null, deadline, shot, plog });
        (r.status === "pass" ? validated : stillFailing).push(f.id);
      }
    } finally {
      await driver.serveOverride(o.targetUrl, null).catch(() => {});
    }
    return {
      attempted: true,
      validated,
      stillFailing,
      cannotFix,
      diff: sf.editsDiff(parsed.edits).slice(0, 40_000),
      ...(validated.length > 0 && applied.html.length <= sf.CORRECTED_FILE_REPORT_MAX ? { correctedHtml: applied.html } : {}),
    };
  }

  async function runOneAc({ ac, o, pure, driver, callLlm, locale, data, hasCredentials, loginFailed, handoverState, deadline, shot, plog, clockIso = null }) {
    const history = [];
    const actions = [];
    let corpus = "";
    let steps = 0;
    let invalidStreak = 0;
    let lastGate = null;
    // 상태 변화(입력·선택 뒤의 클릭)와 그 뒤의 확인(새로고침·새 방문자·다른 화면·다른 역할 로그인)을 행동 기록으로 잰다.
    let filled = false;
    let stateChange = false;
    let verified = false;
    const maxSteps = ac.id === pure.CORE_OUTCOME_AC_ID ? 24 : pure.AGENT_MAX_STEPS_PER_AC;
    const markers = [data.name, data.altName, data.phone];
    // 앱이 링크로 보여 준 주소만 "아는 주소". 그 밖의 goto는 짐작 — 거기서 본 "없음"은 고장 근거가 아니다.
    const known = new Set([normUrl(o.targetUrl)]);
    let onGuessedAddress = false;
    await driver.goto(o.targetUrl);
    if (clockIso) {
      await driver.setClock(clockIso).catch(() => {});
      history.push(`(device clock set to ${clockIso} = 00:30 Korea time; re-check this criterion at this hour — dates shown as "today" must be the Korea date)`);
    }
    await driver.markStorage?.().catch(() => {});
    const system = pure.agentSystemPrompt(locale);
    while (steps < maxSteps && Date.now() < deadline - 10_000) {
      const obsRaw = await driver.observe();
      const obs = redObs(obsRaw);
      lastGate = pure.detectLoginGate(obsRaw);
      for (const l of await driver.links().catch(() => [])) {
        const abs = pure.resolveSameOrigin(String(l.href ?? ""), o.targetUrl);
        if (abs) known.add(normUrl(abs));
      }
      corpus += `\n${obs.url}\n${obs.aria}\n${obs.text}\n${obs.networkErrors.join("\n")}\n${obs.consoleErrors.join("\n")}`;
      let text;
      try {
        text = await callLlm(
          system,
          pure.agentTurnPrompt({
            ac, intent: o.intent, observation: obs, history, testData: data, hasCredentials, loginGate: lastGate,
            stepsLeft: maxSteps - steps, nowIso: new Date().toISOString(),
          }),
        );
      } catch (err) {
        const code = /budget/.test(String(err?.message ?? err)) ? "budget" : "agent_error";
        return finish({ status: "not_verified", reason: pure.reasonText(code, locale), reasonCode: code, evidence: [] });
      }
      const parsed = pure.parseAgentAction(text, o.targetUrl);
      steps += 1;
      if (!parsed.ok) {
        invalidStreak += 1;
        history.push(`(rejected: ${parsed.error})`);
        if (invalidStreak >= 3) return finish({ status: "not_verified", reason: pure.reasonText("agent_error", locale), reasonCode: "agent_error", evidence: [] });
        continue;
      }
      invalidStreak = 0;
      const a = parsed.action;
      if (a.type === "judge") {
        const f = pure.finalizeJudge(a, { corpus, loginGate: lastGate, hasCredentials, locale, onGuessedAddress });
        if (loginFailed && f.reasonCode === "login_required") f.reason = pure.reasonText("login_failed", locale);
        // A3: 근거가 붙은 pass/fail은 다른 눈으로 한 번 더. 동의하지 않거나 답이 깨지면 결과로 치지 않는다.
        if (f.status === "pass" || f.status === "fail") {
          let review = null;
          try {
            review = pure.parseJudgeReview(
              await callLlm(
                "You review browser test verdicts. Reply with JSON only.",
                pure.judgeReviewPrompt({ ac, verdict: f.status, reason: f.reason, evidence: f.evidence, actions, observationTail: corpus, history }),
                300,
              ),
            );
          } catch {
            review = null;
          }
          if (!review || !review.agree) {
            history.push(`(review disagreed: ${review?.why ?? "no answer"})`);
            return finish({ status: "not_verified", reason: pure.reasonText("judge_disagreed", locale), reasonCode: "judge_disagreed", evidence: [] });
          }
        }
        return finish(f);
      }
      const desc = red(pure.describeAction(a, locale));
      let res;
      if (a.type === "click" || a.type === "select") {
        const label = a.target.name ?? a.target.text ?? a.target.label ?? a.target.placeholder ?? "";
        const safety = classifyActionSafety(label);
        if (!safety.safe && safety.category !== "empty/unknown") {
          const allowed = safety.category === "delete" && a.type === "click" && a.ownRecord === true && (await driver.ownsRecordNear(a.target, markers));
          if (!allowed) {
            history.push(`${desc} → BLOCKED (unsafe: ${safety.category}; only records you created may be cancelled — set ownRecord:true)`);
            continue;
          }
        }
      }
      if (a.type === "login") {
        if (handoverState) {
          res = await driver.newSession(o.targetUrl, handoverState).then(() => ({ ok: true, note: "session restored" }));
        } else if (o.credentials && !loginFailed) {
          const r = await driver.login(o.credentials);
          res = { ok: r.ok, note: r.ok ? "signed in" : r.reason };
        } else {
          return finish({ status: "not_verified", reason: pure.reasonText("login_required", locale), reasonCode: "login_required", evidence: [] });
        }
      } else if (a.type === "new_session") {
        await driver.newSession(o.targetUrl);
        res = { ok: true, note: "fresh browser opened" };
      } else if (a.type === "set_clock") {
        res = await driver.setClock(a.iso);
      } else if (a.type === "probe_storage") {
        // A2 탐침: 결과 문장은 관찰 기록(corpus)에 그대로 들어가 판정 근거로 인용할 수 있다.
        const p = driver.storageProbe ? await driver.storageProbe().catch(() => null) : null;
        res = p ? { ok: true, note: pure.describeStorageProbe(p) } : { ok: false, note: "storage probe unavailable" };
        if (p && stateChange) verified = true;
      } else {
        res = await driver.act(a);
      }
      if (res?.ok) {
        if (a.type === "fill" || a.type === "select") filled = true;
        else if (a.type === "click" && filled && !stateChange) stateChange = true;
        // (2) 새로고침만으로는 "남는다"를 증명하지 않는다 — 만든 기록을 다른 곳(새 방문자·다른 화면·다른 역할)에서 다시 찾아야.
        else if (stateChange && (a.type === "new_session" || a.type === "goto" || a.type === "login")) verified = true;
      }
      if (a.type === "goto") {
        // 짐작한 주소 + 그 화면이 "없음"일 때만 — 링크는 없어도 실제로 있는 화면(/admin 등)은 정상 근거로 쓴다.
        const status = /HTTP (\d{3})/.exec(res.note ?? "")?.[1];
        const screen = pure.classifyScreen({ status: status ? Number(status) : null, bodyText: await driver.bodyText(), newCrashes: 0 });
        onGuessedAddress = !known.has(normUrl(a.path)) && !screen.ok && (screen.problem === "http_error" || screen.problem === "error_text" || screen.problem === "blank");
        if (onGuessedAddress) res = { ...res, note: `${res.note ?? ""} (this address is not linked from the app — a 'not found' here is not a defect)` };
      } else if (a.type === "click" || a.type === "back" || a.type === "new_session" || a.type === "login") {
        onGuessedAddress = false;
      }
      actions.push(desc);
      history.push(`${desc} → ${res.ok ? "ok" : "failed"}: ${red(res.note ?? "")}`);
      corpus += `\n${red(res.note ?? "")}`;
    }
    return finish({ status: "not_verified", reason: pure.reasonText("not_reached", locale), reasonCode: "not_reached", evidence: [] });

    async function finish(f) {
      const screenshot = await shot(`agent-${ac.id.replace(/[^A-Za-z0-9_-]/g, "_")}.png`);
      return {
        id: ac.id,
        status: f.status,
        ...(f.scope ? { scope: f.scope } : {}),
        reason: red(f.reason),
        ...(f.reasonCode ? { reasonCode: f.reasonCode } : {}),
        evidence: (f.evidence ?? []).map(red),
        steps,
        actions,
        exercised: { stateChange, verified },
        ...(screenshot ? { screenshot } : {}),
      };
    }
  }
}

const MOBILE_CHECK_MAX = 8;

function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch {
    return String(u);
  }
}

/** 화면·버튼 점검 — 같은 출처 화면을 너비 우선으로 열고, 화면마다 안전한 버튼을 한 번씩 눌러 본다. */
export async function runSweep({ driver, pure, startUrl, until, shot, plog = () => {} }) {
  const isSafeText = (t) => classifyActionSafety(t).safe;
  const screens = [];
  const buttons = [];
  const truncated = { screens: false, buttons: false, time: false };
  const clicked = new Set();
  const seen = new Set();
  const queue = [];
  const enqueue = (links) => {
    const { targets, truncated: t } = pure.discoverSweepTargets(startUrl, links, pure.SWEEP_MAX_SCREENS, isSafeText);
    if (t) truncated.screens = true;
    for (const u of targets) {
      if (seen.has(u)) continue;
      if (seen.size >= pure.SWEEP_MAX_SCREENS) {
        truncated.screens = true;
        break;
      }
      seen.add(u);
      queue.push(u);
    }
  };
  enqueue([{ href: startUrl }]);
  let clicks = 0;
  while (queue.length > 0) {
    if (Date.now() > until) {
      truncated.time = true;
      break;
    }
    const url = queue.shift();
    const crashBefore = driver.crashCount();
    const r = await driver.goto(url);
    const body = await driver.bodyText();
    const cls = pure.classifyScreen({ status: r.status, bodyText: body, newCrashes: driver.crashCount() - crashBefore });
    const entry = { url, status: r.status, ...cls };
    if (!cls.ok) {
      const name = await shot(`sweep-${screens.length + 1}.png`);
      if (name) entry.screenshot = name;
    }
    // C10: 열리는 화면은 휴대폰 폭에서 가로 넘침도 잰다(처음 MOBILE_CHECK_MAX개).
    if (cls.ok && driver.mobileCheck && screens.filter((s) => s.mobileOverflowPx !== undefined).length < MOBILE_CHECK_MAX) {
      const m = await driver.mobileCheck(url).catch(() => null);
      if (m && m.overflowPx !== null) entry.mobileOverflowPx = m.overflowPx;
    }
    screens.push(entry);
    enqueue(await driver.links());
    if (!cls.ok || clicks >= pure.SWEEP_MAX_BUTTONS) {
      if (clicks >= pure.SWEEP_MAX_BUTTONS) truncated.buttons = true;
      continue;
    }
    const sel = pure.selectSweepButtons(await driver.buttons(), { alreadyClicked: clicked, remaining: pure.SWEEP_MAX_BUTTONS - clicks, isSafeText });
    for (const label of sel.skippedUnsafe) {
      if (clicked.has(label)) continue;
      clicked.add(label);
      buttons.push({ screen: url, label, outcome: "skipped_unsafe" });
    }
    for (const label of sel.click) {
      if (Date.now() > until) {
        truncated.time = true;
        break;
      }
      clicked.add(label);
      clicks += 1;
      const p = await driver.probeButton(label, url);
      buttons.push({ screen: url, label, outcome: p.outcome, ...(p.detail ? { detail: String(p.detail).slice(0, 200) } : {}) });
    }
  }
  plog(`sweep:done screens=${screens.length} clicks=${clicks}`);
  return { screens, buttons, truncated };
}

/**
 * C11: 강제 시간 초과·크래시 때 지금까지 잰 것으로 부분 리포트를 만든다(빈손 실패 대신). 돌지 못한 기준은 "시간 한도"로
 * 확인 못 함 — 판정 사다리는 같다(must 실패가 이미 있으면 Needs Fix, 아니면 확인 못 함). 비밀은 똑같이 가린다.
 */
export async function partialAgentResult(progress) {
  if (!progress || !Array.isArray(progress.acs) || progress.acs.length === 0) return null;
  const pure = await importPure("agent-inspection.js");
  const input = {
    targetUrl: progress.targetUrl, intent: progress.intent, acs: progress.acs, acSource: progress.acSource,
    results: progress.results ?? [], sweep: progress.sweep ?? null, signals: progress.signals ?? {},
    loginDepth: progress.loginDepth ?? "L1", loginMethod: progress.loginMethod ?? "none", partial: true,
  };
  const report = pure.buildAgentReport(input, progress.locale);
  const s = progress.secrets ?? [];
  return {
    decision: pure.decideAgentVerdict(input).decision,
    works: report.works,
    report: pure.redactDeep(report, s),
    agentPrompt: pure.redactSecrets(pure.buildAgentAcFixPrompt(report, progress.locale), s),
    evidenceFiles: [],
  };
}
