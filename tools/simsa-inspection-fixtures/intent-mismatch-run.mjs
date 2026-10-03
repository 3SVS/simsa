/**
 * intent-mismatch-run.mjs — 문 (c) 의도 불일치 픽스처 10변형을 프로덕션 익명 검수로 돌려
 * **먼저 커밋된 정답지**와 대조한다 (C-A7, 2026-10-01).
 *
 * 정답지: docs/pilot-2026-10/intent-mismatch-answer-key.md
 *         intent-mismatch-answer-key.json (같은 폴더 — 이 러너가 읽는 기계 판)
 * 방식은 eval-run.mjs 그대로(익명 userKey → 프로젝트 → 웹사이트 소스 → 검수 → 폴링 → 삭제), 하나만 다르다:
 * 검수 API에는 acceptancePlan을 직접 넣는 입구가 없다 — 서버가 **저장된 지시서**에서 만든다. 그래서
 * 변형마다 역추론 지시서(`source: "inferred"`, provenance.userConfirmedAcIds = 정답지의 모든 AC)를 PUT으로 저장한 뒤
 * intent와 함께 검수를 돌린다. (그 PUT은 D-2 amend가 배포된 central-plane에서만 통과한다.)
 *
 * 실행 전 필요한 승인: `deploy simsa-inspection-fixtures approved.` + 이 변경이 든 central-plane 배포.
 *
 * Usage: node intent-mismatch-run.mjs            (전체)
 *        node intent-mismatch-run.mjs IM01 IM05  (부분)
 * 결과: intent-mismatch-results-<date>[-ids].json (정답지 커밋 **뒤에** 커밋한다).
 *
 * 순수 함수(devSpecForVariant·classifyAc·compareToAnswerKey·tallyRows)는 import해서 테스트한다 —
 * 이 파일을 import해도 네트워크는 일어나지 않는다(main은 직접 실행할 때만).
 *
 * 정정 A1(2026-10-01, 러너 실행 전 — 정답지 json `amendments[0]`에 먼저 커밋):
 *  - void 변형(IM07 = 저장을 안 하는 문 (b) 고장)은 문 (c) 집계에서 빠지고 문 (b) 대조군으로 따로 센다.
 *  - core_flow는 works===false가 아니라 **지속성 확인 실패**(리포트 step_failed + notPersisted 문구)일 때만
 *    detected, mismatch AC가 no_problem이면 missed. 그 밖의 works=false는 no_call.
 *  - control은 정보 있는 것(informative !== false)만 TN·FP로 센다. 동작 전 화면에서 이미 보이는 control은
 *    `uninformative`로 따로 센다(여전히 돌리고 기록한다 — 원래 예측과 대조하려고).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANSWER_KEY_URL = new URL("./intent-mismatch-answer-key.json", import.meta.url);

export function loadAnswerKey() {
  return JSON.parse(readFileSync(fileURLToPath(ANSWER_KEY_URL), "utf8"));
}

// ─── 순수: 정답지 변형 → 역추론 지시서 ─────────────────────────────────────────

/**
 * 정답지의 모든 AC(mismatch · 정보 있는/없는 control)를 must로 담은 역추론 지시서
 * (D-2 amend: 확인된 것만 must — 전부 확인됨). 정보 없는 control도 돌려서 원래 예측과 대조한다.
 */
export function devSpecForVariant(variant, { now = () => new Date() } = {}) {
  const fr = (i) => `FR-${String(i + 1).padStart(3, "0")}`;
  const acIds = variant.acceptance.map((a) => a.id);
  return {
    meta: {
      version: 1,
      source: "inferred",
      locale: "ko",
      generatedAt: now().toISOString(),
      provenance: { entryPath: "code", userConfirmedAcIds: [...acIds].sort() },
    },
    brief: {
      productName: variant.title,
      oneLine: variant.intent,
      targetUsers: [],
      problem: variant.differentNow,
      included: variant.acceptance.map((a) => a.featureTitle),
      excluded: [],
      userFlow: [],
      decisions: [],
      openQuestions: [],
    },
    features: variant.acceptance.map((a, i) => ({
      id: fr(i),
      title: a.featureTitle,
      description: `${a.given} — ${a.when}`,
      priority: "must",
    })),
    acceptance: variant.acceptance.map((a, i) => ({
      id: a.id,
      featureId: fr(i),
      given: a.given,
      when: a.when,
      then: a.then,
      verifiedBy: "browser",
    })),
    screens: [
      {
        id: "SCR-001",
        route: variant.path,
        purpose: variant.title,
        components: [],
        states: {},
        entryFrom: [],
        exitTo: [],
        featureIds: variant.acceptance.map((_, i) => fr(i)),
      },
    ],
    dataModel: [],
    apis: [],
    nonFunctional: [],
    workBreakdown: [{ id: "WBS-001", title: variant.title, order: 1, dependsOn: [], acceptanceIds: acIds }],
    testPlan: variant.acceptance.map((a) => ({ kind: "browser", acceptanceId: a.id, steps: a.steps })),
    assumptions: [],
    openQuestions: [],
  };
}

// ─── 순수: 대조 ──────────────────────────────────────────────────────────────

/** 정답지 §판정 규칙: AC 하나의 결과 → detected / missed / no_call. */
export function classifyAc(item) {
  if (!item || typeof item !== "object") return "no_call";
  if (item.status === "no_problem") return "missed";
  if (item.status === "broken") return "detected";
  if (item.status === "not_confirmed" && typeof item.note === "string" && item.note.startsWith("then_not_observed")) {
    return "detected";
  }
  return "no_call";
}

/**
 * 검수 컨테이너 STEP_NOTES.notPersisted(KO/EN)의 앞부분 — 핵심 흐름의 지속성 확인이 실패했다는 표지.
 * 리포트에는 그 단계가 finding `step_failed`(evidence = 이 문구)로 오른다. 테스트가 컨테이너 소스와 대조한다.
 */
export const PERSISTENCE_FAILED_NOTES = ["새로고침하니 입력한 내용이 사라짐", "The entered content disappeared after a reload"];

/** 리포트에 지속성 확인 실패가 있는가. 없다는 것은 "통과"가 아니다(확인이 안 돌았을 수도 있다). */
export function persistenceFailed(report) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return findings.some(
    (f) => f?.code === "step_failed" && typeof f.evidence === "string" && PERSISTENCE_FAILED_NOTES.some((p) => f.evidence.startsWith(p)),
  );
}

/** 정정 A1: 정보 있는 control = 동작 전 화면에서 then이 보이지 않는 control(표시 없으면 정보 있음). */
export const isInformativeControl = (a) => a?.role === "control" && a.informative !== false;

const acOutcome = (cls) => (cls === "missed" ? "TN" : cls === "detected" ? "FP" : "no_call");

/**
 * 정답지 변형 + 검수 상세(GET …/visual-checks/:runId 의 check) → 한 줄 대조.
 * 러너가 끝까지 못 간 경우(check 없음·done 아님)는 전부 no_call — 측정 실패는 결과가 아니다.
 */
export function compareToAnswerKey(variant, check) {
  const status = check?.status ?? null;
  const report = check?.report && typeof check.report === "object" ? check.report : {};
  const items = Array.isArray(report?.acceptance?.items) ? report.acceptance.items : [];
  const byId = new Map(items.map((i) => [i.acceptanceId, i]));
  const mm = variant.acceptance.find((a) => a.role === "mismatch");
  const controls = variant.acceptance.filter((a) => a.role === "control");
  const ct = controls.find(isInformativeControl) ?? null;
  const mmItem = mm ? byId.get(mm.id) ?? null : null;
  const ctItem = ct ? byId.get(ct.id) ?? null : null;
  const works = check?.works ?? report?.works ?? null;
  const done = status === "done";
  const persistence = done ? (persistenceFailed(report) ? "failed" : "not_failed") : null;
  const group = variant.void ? (variant.void.reclassifiedAs ?? "void") : "door_c";

  let mismatchClass;
  if (!done) mismatchClass = "no_call";
  else if (variant.blindSpot === "safety_rail") mismatchClass = "no_call";
  else if (variant.detectBy === "core_flow") {
    // 정정 A1: works===false는 원인이 무엇이든(control 실패·예산·네트워크) 참양성의 증거가 아니다.
    // 의도 기준(mismatch AC)이 "문제 없음"이라 했으면 놓친 것이고, 잡았다고 하려면 지속성 확인이 실패해야 한다.
    const acClass = classifyAc(mmItem);
    mismatchClass = acClass === "missed" ? "missed" : persistence === "failed" ? "detected" : "no_call";
  } else mismatchClass = classifyAc(mmItem);

  const controlClass = ct ? (done ? classifyAc(ctItem) : "no_call") : null;
  const findingCodes = Array.isArray(report?.findings)
    ? report.findings.map((f) => f?.code).filter((c) => typeof c === "string")
    : [];
  const uninformativeControls = controls
    .filter((a) => !isInformativeControl(a))
    .map((a) => {
      const it = byId.get(a.id) ?? null;
      const cls = done ? classifyAc(it) : "no_call";
      return { acceptanceId: a.id, status: it?.status ?? null, note: it?.note ?? null, class: cls, outcome: acOutcome(cls), predicted: variant.predicted?.control ?? null };
    });
  const base = {
    id: variant.id,
    path: variant.path,
    group,
    runStatus: status,
    works,
    decision: check?.decision ?? null,
    persistence,
    mismatch: { acceptanceId: mm?.id ?? null, status: mmItem?.status ?? null, note: mmItem?.note ?? null, class: mismatchClass },
    control: { acceptanceId: ct?.id ?? null, status: ctItem?.status ?? null, note: ctItem?.note ?? null, class: controlClass },
    uninformativeControls,
    findingCodes,
  };

  if (group !== "door_c") {
    // 무효 변형: 문 (c) 판정은 내지 않는다. 문 (b) 대조군이면 지속성 실패만 센다.
    const doorB = group === "door_b_control" ? { outcome: !done ? "no_call" : persistence === "failed" ? "caught" : "not_caught" } : null;
    return {
      ...base,
      outcome: "void",
      controlOutcome: "void",
      predicted: variant.predicted?.outcome ?? null,
      predictedControl: variant.predicted?.control ?? null,
      predictionHit: null,
      controlPredictionHit: null,
      doorB,
    };
  }

  const outcome = mismatchClass === "detected" ? "TP" : mismatchClass === "missed" ? "FN" : "no_call";
  const controlOutcome = ct ? acOutcome(controlClass) : "no_informative_control";
  // 정보 있는 control의 예측: 원래 control(AC-002)은 변형의 예측 칸, 정정으로 더한 것은 expectedStatus.
  const predictedControl = !ct
    ? "no_informative_control"
    : ct.amendment
      ? (ct.expectedStatus === "no_problem" ? "TN" : "FP")
      : (variant.predicted?.control ?? null);
  return {
    ...base,
    outcome,
    controlOutcome,
    predicted: variant.predicted?.outcome ?? null,
    predictedControl,
    predictionHit: outcome === variant.predicted?.outcome,
    controlPredictionHit: controlOutcome === predictedControl,
    doorB: null,
  };
}

/**
 * 문 (c) 참양성·거짓음성·판정 없음 + 정보 있는 control의 참음성·거짓양성, 예측 적중 수.
 * 정보 없는 control과 무효 변형(문 (b) 대조군)은 따로 센다. 개수이지 점수가 아니다.
 */
export function tallyRows(rows) {
  const t = {
    total: 0,
    TP: 0,
    FN: 0,
    FP: 0,
    TN: 0,
    no_call: { mismatch: 0, control: 0 },
    noInformativeControl: 0,
    predictionHits: { variant: 0, control: 0 },
    uninformative: { total: 0, TN: 0, FP: 0, no_call: 0, predictionHits: 0 },
    doorB: { total: 0, caught: 0, not_caught: 0, no_call: 0 },
  };
  for (const r of rows) {
    if (r.group && r.group !== "door_c") {
      if (r.doorB) {
        t.doorB.total += 1;
        t.doorB[r.doorB.outcome] += 1;
      }
      continue;
    }
    t.total += 1;
    if (r.outcome === "TP") t.TP += 1;
    else if (r.outcome === "FN") t.FN += 1;
    else t.no_call.mismatch += 1;
    if (r.controlOutcome === "TN") t.TN += 1;
    else if (r.controlOutcome === "FP") t.FP += 1;
    else if (r.controlOutcome === "no_informative_control") t.noInformativeControl += 1;
    else t.no_call.control += 1;
    if (r.predictionHit) t.predictionHits.variant += 1;
    if (r.controlPredictionHit) t.predictionHits.control += 1;
    for (const u of r.uninformativeControls ?? []) {
      t.uninformative.total += 1;
      t.uninformative[u.outcome] += 1;
      if (u.outcome === u.predicted) t.uninformative.predictionHits += 1;
    }
  }
  return t;
}

// ─── 실행(직접 실행할 때만) ──────────────────────────────────────────────────

const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";
const FIXTURES = process.env.FIXTURES_BASE ?? "https://simsa-inspection-fixtures.seunghunbae.workers.dev";
const POLL_MS = 10_000;
const MAX_WAIT_MS = 6 * 60_000;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

async function runVariant(variant) {
  const userKey = `uk_im_${variant.id.toLowerCase()}_${Date.now().toString(36)}`;
  const targetUrl = `${FIXTURES}${variant.path}`;
  const created = await api("POST", "/workspace/projects", {
    userKey, title: `의도 불일치 ${variant.id} ${variant.title}`, idea: variant.intent, understood: null,
    productSpec: { productName: variant.title, oneLine: variant.intent }, items: [], entryPath: "code",
  });
  const projectId = created.json?.project?.id ?? created.json?.id;
  if (!projectId) return { setup: `project_create_failed(${created.status})`, check: null };
  try {
    const src = await api("POST", `/workspace/projects/${projectId}/sources`, { userKey, type: "website", reference: targetUrl, label: variant.id });
    if (src.status >= 300) return { setup: `source_failed(${src.status})`, check: null };

    const put = await api("PUT", `/workspace/projects/${projectId}/dev-spec`, { userKey, devSpec: devSpecForVariant(variant) });
    if (put.status !== 200) {
      // D-2 amend 이전 서버는 meta.provenance를 모르는 키로 거부한다(422) — 배포가 먼저다.
      return { setup: `dev_spec_rejected(${put.status} ${JSON.stringify(put.json).slice(0, 200)})`, check: null };
    }

    let runId;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const run = await api("POST", `/workspace/projects/${projectId}/visual-checks/run`, { userKey, locale: "ko", targetUrl, intent: variant.intent });
      runId = run.json?.check?.id;
      if (runId && run.json?.dispatched === true) break;
      const note = String(run.json?.note ?? run.json?.error ?? "");
      if (!/instances exceeded|Maximum number of running container/i.test(note) || attempt === 4) {
        return { setup: `dispatch_failed(${run.status} ${note})`, check: null };
      }
      await new Promise((r) => setTimeout(r, 45_000 * attempt));
    }

    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const got = await api("GET", `/workspace/projects/${projectId}/visual-checks/${runId}?userKey=${encodeURIComponent(userKey)}`);
      const st = got.json?.check?.status;
      process.stdout.write(`    …${st} (${Math.round((Date.now() - started) / 1000)}s)\r`);
      if (st === "done" || st === "failed") return { setup: "ok", check: got.json.check, runId };
    }
    return { setup: "timeout", check: null, runId };
  } finally {
    await api("DELETE", `/workspace/projects/${projectId}?userKey=${encodeURIComponent(userKey)}`).catch(() => {});
  }
}

async function main() {
  const key = loadAnswerKey();
  const only = process.argv.slice(2);
  const variants = only.length ? key.variants.filter((v) => only.includes(v.id)) : key.variants;
  console.log(`intent-mismatch eval — base=${BASE}\nfixtures=${FIXTURES}\nanswer key recorded ${key.recordedAt}\nvariants=${variants.map((v) => v.id).join(", ")}\n`);

  const rows = [];
  for (const v of variants) {
    console.log(`▶ ${v.id} ${v.path} (${v.void ? `무효 → ${v.void.reclassifiedAs}` : `predicted ${v.predicted.outcome}`})`);
    const r = await runVariant(v);
    const row = { ...compareToAnswerKey(v, r.check), setup: r.setup, runId: r.runId ?? null };
    rows.push(row);
    if (row.group !== "door_c") {
      console.log(`    ${row.setup} works=${row.works} persistence=${row.persistence} → 문 (b) 대조군 ${row.doorB?.outcome ?? "-"}`);
      continue;
    }
    const unInf = row.uninformativeControls.map((u) => `${u.acceptanceId}=${u.outcome}`).join(",");
    console.log(`    ${row.setup} works=${row.works} mismatch=${row.mismatch.status}(${row.mismatch.class}) control ${row.control.acceptanceId ?? "-"}=${row.control.status} → ${row.outcome}/${row.controlOutcome}${unInf ? ` · 정보 없는 control ${unInf}` : ""}${row.predictionHit ? "" : "  ≠ 예측"}`);
  }
  const tally = tallyRows(rows);
  console.log(`\n집계: ${JSON.stringify(tally)}`);

  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = only.length ? `-${only.join("-")}` : "";
  const out = new URL(`./intent-mismatch-results-${stamp}${suffix}.json`, import.meta.url);
  const amendments = (key.amendments ?? []).map((a) => ({ id: a.id, recordedAt: a.recordedAt, predictedTally: a.predictedTally }));
  writeFileSync(fileURLToPath(out), JSON.stringify({ base: BASE, fixtures: FIXTURES, date: stamp, answerKeyRecordedAt: key.recordedAt, predictedTally: key.predictedTally, amendments, tally, rows }, null, 2));
  console.log(`saved: ${fileURLToPath(out)}`);
  process.exit(rows.every((r) => r.setup === "ok") ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
