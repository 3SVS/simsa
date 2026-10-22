/**
 * agent-v2-run.mjs — 검사 엔진 v2 S4c: 실행 고리 (2026-10-21).
 *
 * 설계: docs/simsa-inspector-v2-design-2026-10-07.md §2.2 — 정찰(R) → 가설·계획(H·P) → 실행(E) → (확인 V·판정 J는 S5에서 강화).
 *   1) 정찰: 같은 출처 GET 수집(recon-collect) → 첫 화면 즉시 고장 판정(앱 없음이면 LLM 0으로 끝)
 *   2) 정적 사실 → 증거물(source) → 가설·계획(결정론) → 계획 증거물(context)
 *   3) 기준마다 새 브라우저에서 **가장 강한 모델**(V-5 — tier "strong"만)이 도구로 조작, 행동마다 증거물(화면·전후 차이·저장소·
 *      서버 쓰기·콘솔)을 남기고, 판정은 증거물 id를 인용한다(S4b 형식)
 *   4) 판정마다 기계 검증기(S1) — 기각되면 빠진 것을 알려 두 번까지 더 시키고, 그래도면 not_verified(사유 포함)
 *   5) 시간 가설(클라이언트 UTC 날짜)이 덮는 기준은 실행기가 시계를 KST 00:30으로 옮겨 한 번 더(에이전트의 시계 이동은 받지 않는다)
 *   S5(2026-10-22) 확인(V): 판정 후보(pass·fail·mismatch)마다 실행기가 같은 행동 순서를 새 브라우저에서 LLM 없이 다시 하고,
 *      인용이 **같은 단계**에서 다시 나와야 확정(confirmed). 판정(J): must의 의도 불일치는 Needs Fix + intentMismatch.
 *      pass 인용이 전부 기준 시작 화면의 글자(소개 문구)면 강등.
 * V-8: `engine:"agent_v2"` 장비 키 전용 — v1(agent-run.mjs)은 그대로 대체 경로.
 * 드라이버는 v1과 같은 것(agent-driver.mjs)을 쓴다.
 */
import { classifyActionSafety } from "./safety.mjs";
import { collectRecon } from "./recon-collect.mjs";

async function importPure(name) {
  try {
    return await import(`./dist/${name}`);
  } catch {
    return import(`../dist/${name}`);
  }
}

export const AGENT_V2_RUNNER_REV = "agent-v2-1";
const DEFAULT_MAX_STEPS = 20;
const MAX_VERIFIER_NUDGES = 2;
const MAX_INVALID_STREAK = 3;

function kstParts(ms) {
  const d = new Date(ms + 9 * 3600_000);
  return { hour: d.getUTCHours(), label: `${d.toISOString().slice(0, 16).replace("T", " ")} (Asia/Seoul, UTC+9)` };
}

/** KST 그날 00:30의 ISO(시계 변형 실험용). */
function kstEarlyMorningIso(ms) {
  const d = new Date(ms + 9 * 3600_000);
  const day = d.toISOString().slice(0, 10);
  return new Date(`${day}T00:30:00+09:00`).toISOString();
}

export async function runAgentV2Inspection(o) {
  const pure = await importPure("agent-inspection.js");
  const ev = await importPure("evidence-chain.js");
  const rc = await importPure("recon.js");
  const pl = await importPure("v2-plan.js");
  const ag = await importPure("v2-agent.js");
  const jd = await importPure("v2-judge.js");
  const locale = o.locale === "en" ? "en" : "ko";
  const t0 = Date.now();
  const nowMs = () => (Number.isFinite(o.nowMs) ? o.nowMs : Date.now());
  const deadline = t0 + (o.budgetMs ?? 13 * 60_000);
  const secrets = () => [o.credentials?.username, o.credentials?.password].filter(Boolean);
  const red = (s) => pure.redactSecrets(String(s ?? ""), secrets());
  const plog = (msg) => {
    try {
      o.onPhase?.(red(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`));
    } catch {
      /* 진단이 런을 깨면 안 된다 */
    }
  };
  const llmCalls = { n: 0, failed: 0 };
  // V-5: 계획·조작·판정 전부 가장 강한 모델 — 등급은 늘 strong(어느 모델인지는 서버 프록시가 정한다).
  const callLlm = async (system, user, maxTokens = 900) => {
    llmCalls.n += 1;
    try {
      return await o.llm({ system, user: red(user), maxTokens, tier: "strong" });
    } catch (err) {
      llmCalls.failed += 1;
      throw err;
    }
  };

  const store = ev.createEvidenceStore({ redact: red });
  const acs = (Array.isArray(o.acs) ? pure.orderAcs(o.acs, o.maxAcs ?? 11) : []).filter((a) => a && a.id);
  const data = pure.koreanTestData(Number.isFinite(o.testDataSeed) ? o.testDataSeed : Date.now() % 100000);
  const base = { engine: "agent_v2", runnerRev: AGENT_V2_RUNNER_REV, targetUrl: o.targetUrl };

  // 1) 정찰 + 첫 화면 즉시 판정
  plog("v2:recon");
  const recon = await collectRecon(o.targetUrl, { fetchImpl: o.fetchImpl });
  const entryId = store.add("request", `GET ${o.targetUrl} → ${recon.entry.status ?? "no response"}`, recon.entry.bodyText.slice(0, 2000), {
    method: "GET",
    ...(recon.entry.status !== null ? { status: recon.entry.status } : {}),
    url: o.targetUrl,
  });
  const entry = rc.reconEntry({ targetUrl: o.targetUrl, status: recon.entry.status, bodyText: recon.entry.bodyText });
  if (entry.broken) {
    plog(`v2:entry broken ${entry.broken.cause}`);
    // 드라이버는 만들 때 이미 브라우저를 띄웠다 — 여기서 닫지 않으면 호출자 프로세스가 끝나지 않는다(S4d 실측).
    await o.driver.close?.().catch(() => {});
    return { ...base, decision: "Needs Fix", entry: { ...entry, artifactId: entryId }, facts: [], plan: null, verdicts: [], artifacts: store.toJSON(), llmCalls };
  }

  // 2) 정적 사실 → 가설·계획
  const facts = rc.extractStaticFacts(recon.files);
  const recorded = rc.recordStaticFacts(store, facts);
  const plan = pl.buildPlan({ acs, facts: recorded, nowKstHour: kstParts(nowMs()).hour });
  const planArtifactId = pl.recordPlan(store, plan);
  plog(`v2:plan facts=${facts.map((f) => f.rule).join(",") || "-"} hypotheses=${plan.hypotheses.map((h) => `${h.id}:${h.cls}`).join(",") || "-"}`);

  // 3) 실행
  await o.driver.start(o.targetUrl);
  const system = ag.v2SystemPrompt(locale, { readOnly: o.readOnly === true });
  const verdicts = [];
  for (const ac of acs) {
    if (Date.now() > deadline - 20_000) {
      verdicts.push({ acId: ac.id, verdict: "not_verified", claim: "시간 안에 이 기준까지 가지 못했어요", artifactIds: [], quotes: [], reasons: ["budget"] });
      continue;
    }
    const hyps = plan.hypotheses.filter((h) => h.coversAcIds.includes(ac.id) && h.runnableNow);
    let v = await runAc(ac, hyps, null);
    // 5) 클라이언트 UTC 날짜 가설이 덮는 기준: 통과였으면 실행기가 시계를 KST 00:30으로 옮겨 한 번 더 — 그때 실패(검증 통과)면 실패.
    if (v.verdict === "pass" && hyps.some((h) => h.experiment.kind === "clock_early_morning_kst") && Date.now() < deadline - 60_000) {
      const iso = kstEarlyMorningIso(nowMs());
      const night = await runAc(ac, hyps, iso);
      plog(`v2:ac ${ac.id} clock ${iso} → ${night.verdict}`);
      if (night.verdict === "fail") v = { ...night, claim: `${night.claim} (한국 시간 새벽 0시 30분에)` };
    }
    // S5d: "마감 − 단위"를 마지막 시작 칸으로 둔 앱을 실패로 읽은 판정은 확인 못 함으로(뒤집지 않는다).
    if (jd.closingSlotMisread(ac, v)) v = { ...v, verdict: "not_verified", originalVerdict: v.verdict, reasons: [...v.reasons, "closing_slot_interpretation"] };
    verdicts.push(v);
    plog(`v2:ac ${ac.id} → ${v.verdict}${v.reasons.length ? `(${v.reasons.join("+")})` : ""}`);
  }
  await o.driver.close?.().catch(() => {});

  const mustIds = new Set(acs.filter((a) => a.priority === "must").map((a) => a.id));
  const mustVerdicts = verdicts.filter((v) => mustIds.has(v.acId));
  // J: 검증·재실행을 통과한 must의 fail 또는 의도 불일치(V-7, "생각과 달라요")는 고쳐야 함. 불일치는 따로 표시한다.
  const intentMismatch = mustVerdicts.filter((v) => v.verdict === "mismatch").map((v) => v.acId);
  const decision = mustVerdicts.some((v) => v.verdict === "fail") || intentMismatch.length > 0
    ? "Needs Fix"
    : mustVerdicts.length > 0 && mustVerdicts.every((v) => v.verdict === "pass")
      ? "Ready"
      : "Not Verified";
  // S5c 첫 지점 규칙: 같은 가설·같은 결함 분류의 실패는 결함 하나로(통계·데이터의 단위는 기준이 아니라 결함).
  const defectGroups = jd.groupFailures(verdicts, plan.hypotheses, (Array.isArray(o.acs) ? o.acs : []).map((a) => a?.id).filter(Boolean));
  return { ...base, decision, intentMismatch, defectGroups, entry: { ...entry, artifactId: entryId }, facts, planArtifactId, plan, verdicts, artifacts: store.toJSON(), llmCalls };

  /** 기준 하나 — 새 브라우저에서 시작, 증거물을 쌓으며 조작, 검증기와 실행기 재실행(확인 V)을 통과한 판정만 돌려준다. */
  async function runAc(ac, hyps, clockIso) {
    const origin = new URL(o.targetUrl).origin;
    const history = [];
    let steps = 0;
    let invalid = 0;
    let nudges = 0;
    const maxSteps = o.maxStepsPerAc ?? DEFAULT_MAX_STEPS;
    if (clockIso) store.add("context", `실행기 시계 변형 KST 00:30 (${ac.id})`, clockIso, {});
    const ctx = await openRun("same", clockIso);
    if (clockIso) history.push(`(the test runner set the device clock to ${clockIso} = 00:30 Korea time; check this criterion at this hour — 'today' must be the Korea date)`);
    /** 실행에 성공한 행동 순서 — 확인(V) 때 실행기가 새 브라우저에서 그대로 다시 한다. 삭제 확인을 받은 클릭이 있으면 재실행하지 않는다. */
    const trace = [];
    /** bounds[k] = k+1번째 행동을 시작할 때의 증거물 수 — 증거물이 몇 번째 행동 뒤에 생겼는지(단계)를 가른다. */
    const bounds = [];
    const runStart = store.list().length;
    let replayable = true;
    let baselineId = null;
    while (steps < maxSteps && Date.now() < deadline - 10_000) {
      const obs = await observeInto(ctx);
      baselineId ??= obs.artifactId;
      const user = ag.v2TurnPrompt({
        ac, intent: o.intent ?? "", hypotheses: hyps, observation: obs.obs, evidence: ag.artifactDigest(store), history, testData: data,
        stepsLeft: maxSteps - steps, nowLabel: kstParts(clockIso ? Date.parse(clockIso) : nowMs()).label,
      });
      let text;
      try {
        text = await callLlm(system, user);
      } catch (err) {
        return downgradedNv(ac, `모델 호출 실패: ${String(err?.message ?? err).slice(0, 80)}`, "llm_error");
      }
      steps += 1;
      const t = ag.parseV2Turn(text, { acId: ac.id, origin });
      if (!t.ok) {
        invalid += 1;
        history.push(`(rejected: ${t.error}${rejectHint(t.error)})`);
        if (invalid >= MAX_INVALID_STREAK) return downgradedNv(ac, "모델 응답을 읽지 못했어요", "agent_error");
        continue;
      }
      invalid = 0;
      if (t.kind === "judge") {
        const opts = baselineId ? { baselineIds: [baselineId] } : {};
        const r = ev.verifyVerdict(t.verdict, store, opts);
        if (t.verdict.verdict === "not_verified") return r;
        const onlyRepro = r.reasons.every((x) => x === "fail_not_reproduced" || x === "mismatch_not_reproduced");
        if (onlyRepro) return confirm(t.verdict, r);
        if (nudges < MAX_VERIFIER_NUDGES && steps < maxSteps - 2) {
          nudges += 1;
          history.push(`(verifier rejected your ${t.verdict.verdict}: ${r.reasons.join(", ")} — ${nudgeFor(r.reasons)})`);
          continue;
        }
        return r;
      }
      // 행동
      const a = t.action;
      const desc = red(pure.describeAction(a, locale));
      if (a.type === "click" || a.type === "select") {
        const label = a.target?.name ?? a.target?.text ?? a.target?.label ?? a.target?.placeholder ?? "";
        const safety = classifyActionSafety(label);
        if (!safety.safe && safety.category !== "empty/unknown") {
          const allowed = safety.category === "delete" && a.type === "click" && a.ownRecord === true && (await o.driver.ownsRecordNear?.(a.target, [data.phone]).catch(() => false));
          if (!allowed) {
            history.push(`${desc} → BLOCKED (unsafe: ${safety.category})`);
            continue;
          }
          a.acceptDialog = true;
          replayable = false;
        }
      }
      if (o.readOnly === true && (a.type === "fill" || a.type === "select")) {
        history.push(`${desc} → BLOCKED (read-only run)`);
        continue;
      }
      const at = store.list().length;
      const res = await doAction(ctx, a, desc, ac);
      if (res?.ok) {
        trace.push(a);
        bounds.push(at);
      }
      history.push(`${desc} → ${res?.ok ? "ok" : "failed"}: ${red(res?.note ?? "")}`);
    }
    return downgradedNv(ac, "정해진 단계 안에 판정까지 가지 못했어요", "not_reached");

    /**
     * 확인(V, 설계 §2.2-5): 판정 후보의 행동 순서를 실행기가 새 브라우저에서 그대로 다시 하고(LLM 없음), 그 화면·차이·저장소를
     * session "confirm" 증거물로 남긴다. 그 재실행 증거물을 재현 증거(reproArtifactIds)로 붙여 다시 검증한다 — pass는 같은 인용이
     * 재실행에서도 나와야 한다. 재실행할 수 없으면(삭제 확인 클릭·시간 부족) fail·mismatch는 원래 검증 결과(재현 없음 → 강등), pass는 그대로.
     */
    async function confirm(verdict, first) {
      if (!replayable || trace.length === 0 || Date.now() > deadline - 30_000) {
        plog(`v2:ac ${ac.id} confirm skipped (${!replayable ? "unsafe_click" : trace.length === 0 ? "no_actions" : "budget"})`);
        return { ...first, confirmed: false };
      }
      const replayStart = store.list().length;
      const c = await openRun("confirm", clockIso);
      const replayBounds = [];
      await observeInto(c);
      for (const a of trace) {
        replayBounds.push(store.list().length);
        await doAction(c, a, red(pure.describeAction(a, locale)), ac);
        await observeInto(c);
      }
      // 인용마다: 원래 그 글자가 나온 단계(몇 번째 행동 뒤)와 **같은 단계**의 재실행 증거물에 같은 글자가 있어야 한다
      // (중간 화면에 우연히 있던 글자로 재현을 인정하지 않는다 — 예: 저장 전 빈 목록 문구).
      const all = store.list();
      const stepOf = (pos, bs) => bs.filter((b) => b <= pos).length;
      // 재실행마다 바뀌는 숫자(걸린 시간·크기·시각)는 같은 관찰로 본다(실측 F12) — 정확한 값은 원래 증거물에서 검증기가 이미 대조했다.
      const masked = (t) => norm(t).replace(/\d+/g, "#");
      const has = (x, q) => norm(`${x.summary}\n${x.raw}`).includes(norm(q)) || masked(`${x.summary}\n${x.raw}`).includes(masked(q));
      const cited = new Set([...verdict.artifactIds, ...(verdict.reproArtifactIds ?? [])]);
      const matched = new Set();
      let again = true;
      let checked = 0;
      for (const q of verdict.quotes) {
        const wanted = new Set();
        let preRunOnly = true;
        all.forEach((x, pos) => {
          if (pos >= replayStart || !cited.has(x.id) || !has(x, q)) return;
          if (pos >= runStart) {
            preRunOnly = false;
            wanted.add(stepOf(pos, bounds));
          }
        });
        // 정찰·계획처럼 실행 전에 생긴 증거물의 글자는 행동과 무관하게 같다 — 재실행 대조 대상이 아니다(실측 F10).
        if (preRunOnly && all.some((x, pos) => pos < runStart && cited.has(x.id) && has(x, q))) continue;
        checked += 1;
        const hit = all.findIndex((x, pos) => pos >= replayStart && has(x, q) && (wanted.size === 0 || wanted.has(stepOf(pos, replayBounds))));
        if (hit < 0) again = false;
        else matched.add(all[hit].id);
      }
      if (checked === 0) again = false;
      plog(`v2:ac ${ac.id} confirm ${verdict.verdict} → ${again ? "reproduced" : "not reproduced"} (${trace.length} actions, ${checked} quotes checked)`);
      if (again) return { ...verdict, ...(verdict.verdict === "pass" ? {} : { reproArtifactIds: [...matched] }), reasons: [], confirmed: true };
      const reason = verdict.verdict === "pass" ? "pass_not_reproduced" : verdict.verdict === "fail" ? "fail_not_reproduced" : "mismatch_not_reproduced";
      return { ...verdict, verdict: "not_verified", originalVerdict: verdict.verdict, reasons: [reason], confirmed: false };
    }
  }

  /** 새 브라우저 하나 — session 표지("same" = 에이전트 실행, "confirm" = 실행기 재실행), 저장소 기준점, 콘솔·쓰기 누적 위치. */
  async function openRun(label, clockIso) {
    if (o.driver.newSession) await o.driver.newSession(o.targetUrl).catch(() => o.driver.goto?.(o.targetUrl));
    if (clockIso) await o.driver.setClock?.(clockIso).catch(() => {});
    await o.driver.markStorage?.().catch(() => {});
    return { label, session: label, filled: false, seenConsole: 0, seenWrites: 0 };
  }

  async function observeInto(ctx) {
    const obs = await o.driver.observe();
    const artifactId = store.add("screen", `${ctx.session} ${pathOf(obs.url)}: ${obs.text.replace(/\s+/g, " ").slice(0, 120)}`, obs.text, { session: ctx.session, url: obs.url });
    for (const c of obs.consoleErrors.slice(ctx.seenConsole)) store.add("console", c.slice(0, 120), c, {});
    ctx.seenConsole = obs.consoleErrors.length;
    return { obs, artifactId };
  }

  /**
   * 저장 탐침 결과를 증거물로: 새 서버 쓰기는 request(드라이버가 응답 코드를 주면 status — V-2의 "쓰기 2xx"), 저장소 변화는
   * storage(changed). 이 실행 안에서 이미 기록한 쓰기는 다시 세지 않는다.
   */
  async function recordStorage(ctx, label, explicit, ids = []) {
    const p = o.driver.storageProbe ? await o.driver.storageProbe().catch(() => null) : null;
    if (!p) return { ok: false, note: "storage probe unavailable" };
    const results = o.driver.writeResults ? await o.driver.writeResults().catch(() => []) : [];
    const fresh = p.serverWrites.slice(ctx.seenWrites);
    ctx.seenWrites = p.serverWrites.length;
    for (const line of fresh) {
      const [method, url] = String(line).split(" ");
      const status = results.find((w) => w.line === line)?.status;
      ids.push(store.add("request", `${line}${status ? ` → ${status}` : ""}`, String(line), { method, url, ...(Number.isFinite(status) ? { status } : {}) }));
    }
    const changed = Boolean(p.localChanged || p.sessionChanged);
    if (changed || explicit) ids.push(store.add("storage", `${label}: 브라우저 저장소 ${changed ? "바뀜" : "그대로"} · 서버 쓰기 ${p.serverWrites.length}건`, `local=${p.localChanged} session=${p.sessionChanged} writes=${p.serverWrites.length}`, { changed, area: p.localChanged ? "local" : "session" }));
    return { ok: true, note: `server writes since start=${p.serverWrites.length}${fresh.length ? ` (new: ${fresh.join(", ")})` : ""} · browser storage ${changed ? "changed" : "unchanged"}` };
  }

  /** 행동 하나를 실행하고 전후 차이·저장 위치를 증거물로 남긴다(에이전트 실행과 실행기 재실행이 같은 방식으로 기록 — 인용이 그대로 대조된다). */
  async function doAction(ctx, a, desc, ac, ids = []) {
    const sigBefore = await o.driver.signature?.().catch(() => null);
    let res;
    if (a.type === "new_session") {
      await o.driver.newSession(o.targetUrl);
      if (ctx.label === "same") ctx.session = "fresh";
      res = { ok: true, note: "fresh browser opened (a different visitor)" };
    } else if (a.type === "probe_storage") {
      res = await recordStorage(ctx, `probe (${ac.id})`, true, ids);
    } else {
      res = await o.driver.act(a).catch((err) => ({ ok: false, note: String(err?.message ?? err).slice(0, 120) }));
    }
    if (a.type === "fill" || a.type === "select") ctx.filled = true;
    if (sigBefore !== null && sigBefore !== undefined && (a.type === "click" || a.type === "press" || a.type === "select")) {
      const sigAfter = await o.driver.signature?.().catch(() => null);
      const changed = sigAfter !== sigBefore;
      ids.push(store.add("diff", `${desc} — 화면 ${changed ? "바뀜" : "그대로"}`, `${desc}\n${res?.note ?? ""}`, { changed }));
      // 입력 뒤의 클릭은 저장 위치를 자동으로 잰다(서버 쓰기·저장소 변화 증거물).
      if (a.type === "click" && ctx.filled) await recordStorage(ctx, `after ${desc}`, false, ids);
    }
    return res;
  }

  function downgradedNv(ac, claim, reason) {
    return { acId: ac.id, verdict: "not_verified", claim, artifactIds: [], quotes: [], reasons: [reason] };
  }
}

const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url ?? "");
  }
}

function nudgeFor(reasons) {
  const tips = [];
  if (reasons.includes("pass_without_state_change")) tips.push("show a state change: a successful server write, a storage change, a before/after screen change, or the record seen in a new_session");
  if (reasons.includes("fail_not_reproduced")) tips.push("repeat the failing step independently (e.g. in a new_session) and cite those artifacts as reproArtifactIds");
  if (reasons.includes("quote_not_in_artifacts")) tips.push("copy quotes exactly from the cited artifacts' text");
  if (reasons.includes("no_artifacts") || reasons.includes("unknown_artifact")) tips.push("cite existing artifact ids from 'Evidence so far'");
  return tips.join("; ") || "fix the judgement";
}

/** 거절된 답에 고칠 방법을 붙인다 — 이유 코드만 주면 모델이 같은 실수를 반복한다(실측 F2·F4 2026-10-22: 역할만 있는 대상 3연속). */
function rejectHint(error) {
  if (/_needs_target_and_value$|_needs_target$/.test(error)) return " — role alone is not enough: add the field's visible label, placeholder, name or text exactly as shown on screen";
  if (error === "no_json_object") return " — reply with exactly one JSON object";
  if (error === "set_clock_runner_only") return " — the runner checks other times itself; do not change the clock";
  if (error.startsWith("judge_")) return " — follow the judge format: verdict, claim, artifactIds, quotes";
  return "";
}
