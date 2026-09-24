#!/usr/bin/env node
/**
 * dev-spec-probe.mjs — T0 개발 지시서(A2) + AC 검수(A5) 프로덕션 실측 장비.
 *
 * 왜 따로 있나: 2026-09-24 A6 실측을 curl 인라인 한국어로 했다가 intent가 모지바케로 저장됐고
 * (gotcha-windows-gitbash-curl-utf8), 결과 표를 손으로 옮겨 적었다. 이 스크립트는
 *   ① 한글·공백·특수문자 포함 리얼 기획 3건(Rule 6)으로 프로젝트를 만들고
 *   ② ko → en 순서로 dev-spec을 생성해 상태·지연·repaired·섹션 수·제외 항목 누출·EN 본문 한글 비율을 재고
 *   ③ (--target 주면) 웹사이트 출처를 붙여 시각 검수를 돌려 report.acceptance·ac-* 스크린샷·AC 이중 표기를 세고
 *   ④ 기본으로 프로브 프로젝트를 지운다(--keep 으로 보존).
 * 출력: 세 칸(라이브확인/미측정) 표 + dev-spec-probe-result.json.
 *
 * 사용:
 *   node dev-spec-probe.mjs                      # 3건 ko+en 생성만
 *   node dev-spec-probe.mjs --only 2             # 2번 기획만
 *   node dev-spec-probe.mjs --target https://simsa.dev --only 1   # 1번 기획 + AC 검수
 *   node dev-spec-probe.mjs --skip-en            # ko만
 *   node dev-spec-probe.mjs --keep               # 프로젝트 남김(대시보드에서 눈으로 볼 때)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev";
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ONLY = opt("only") ? opt("only").split(",").map((s) => Number(s.trim())) : null;
const TARGET = opt("target") ?? null;
const KEEP = flag("keep");
const SKIP_EN = flag("skip-en");
const STAMP = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(0, 12);
const USER_KEY = opt("key") ?? `probe-devspec-${STAMP}`;
const AC_INTENT_MAX = 1000;

// ── 리얼 기획 3건 — 한글·공백·괄호·가운뎃점·숫자 단위 포함 ──────────────────────────
const FIXTURES = [
  {
    n: 1,
    title: "동네 빵집 픽업 예약",
    idea: "우리 동네 빵집(성수동 '밀과 소금')에서 아침에 빵을 미리 골라두고 퇴근길에 픽업하고 싶어요. 매번 헛걸음하는 게 싫어요.",
    productSpec: {
      productName: "동네 빵집 픽업 예약",
      oneLine: "빵을 미리 고르고 픽업 시간을 예약하는 웹앱",
      targetUsers: ["단골 손님", "빵집 사장님"],
      problem: "인기 빵이 오후 3시면 다 팔려서 헛걸음이 잦다",
      included: ["오늘의 빵 목록 보기", "픽업 시간 예약", "예약 확인 화면", "사장님이 예약 목록 보기"],
      excluded: ["온라인 결제", "배달", "회원가입 없이도 됨(전화번호만)"],
      userFlow: ["빵 목록 → 담기 → 픽업 시간 선택 → 전화번호 입력 → 예약 완료"],
      decisions: ["결제는 매장에서 현금·카드로"],
      openQuestions: ["예약 취소는 몇 시까지?"],
    },
    items: [
      { id: "req_001", title: "오늘의 빵 목록을 볼 수 있다", status: "not_started", criteria: ["품절 표시가 보인다"] },
      { id: "req_002", title: "픽업 시간을 골라 예약할 수 있다", status: "not_started", criteria: ["예약 완료 화면에 시간·빵이 보인다"] },
      { id: "req_003", title: "사장님이 오늘 예약을 한눈에 본다", status: "not_started", criteria: ["시간순 정렬"] },
    ],
  },
  {
    n: 2,
    title: "회의 녹음 요약 (팀용)",
    idea: "주간 회의 녹음(30~60분, 한국어·영어 섞임)을 올리면 결정사항·할 일·담당자를 뽑아서 팀 채팅에 공유하고 싶어요.",
    productSpec: {
      productName: "회의 녹음 요약",
      oneLine: "회의 녹음을 올리면 결정·할 일·담당자를 뽑아 주는 웹앱",
      targetUsers: ["소규모 팀 리더", "팀원"],
      problem: "회의록을 아무도 안 쓰고, 쓴 것도 안 읽는다",
      included: ["녹음 파일 업로드(m4a·mp3)", "요약 보기(결정·할 일·담당자)", "요약 수정", "공유 링크"],
      excluded: ["실시간 녹음", "화자 분리 정확도 보장", "슬랙·팀즈 자동 연동"],
      userFlow: ["파일 올리기 → 처리 중 → 요약 확인·수정 → 링크 복사"],
      decisions: ["담당자는 이름 텍스트로만(계정 매칭 안 함)"],
      openQuestions: ["60분 넘는 파일은?", "요약이 틀렸을 때 신고 방법"],
    },
    items: [
      { id: "req_001", title: "녹음 파일을 올릴 수 있다", status: "not_started", criteria: ["m4a·mp3 허용", "50MB 초과 시 안내"] },
      { id: "req_002", title: "요약에 결정·할 일·담당자가 구분되어 보인다", status: "not_started", criteria: ["세 묶음이 각각 보인다"] },
      { id: "req_003", title: "요약을 고쳐서 링크로 공유한다", status: "not_started", criteria: ["링크로 열면 고친 내용이 보인다"] },
    ],
  },
  {
    n: 3,
    title: "아파트 반찬 공동구매 (101동·102동)",
    idea: "같은 아파트 두 개 동 주민끼리 매주 반찬 공동구매를 모아요. 지금은 카톡 방에서 손으로 세는데 누락이 많아요. 마감 시간 지나면 주문 못 하게 하고 싶어요.",
    productSpec: {
      productName: "아파트 반찬 공동구매",
      oneLine: "주간 반찬 공동구매 주문을 모으고 마감하는 웹앱",
      targetUsers: ["총무(주문 모으는 사람)", "주민"],
      problem: "카톡 방 손집계로 누락·중복이 잦고 마감이 안 지켜진다",
      included: ["이번 주 반찬 목록·가격", "주문하기(동·호수·수량)", "마감 시간 표시와 마감 후 잠금", "총무용 집계표"],
      excluded: ["결제", "배송 추적", "타 아파트 확장"],
      userFlow: ["목록 보기 → 수량 고르기 → 동·호수 입력 → 주문 확인 → (총무) 집계표"],
      decisions: ["마감은 목요일 22:00 고정"],
      openQuestions: ["주문 수정은 마감 전까지 허용?"],
    },
    items: [
      { id: "req_001", title: "반찬 목록과 가격을 볼 수 있다", status: "not_started", criteria: ["단위(팩/500g) 표시"] },
      { id: "req_002", title: "동·호수와 수량으로 주문한다", status: "not_started", criteria: ["같은 호수 중복 주문 시 합쳐진다"] },
      { id: "req_003", title: "마감 후에는 주문 버튼이 잠긴다", status: "not_started", criteria: ["마감 시각이 화면에 보인다"] },
      { id: "req_004", title: "총무가 집계표를 본다", status: "not_started", criteria: ["반찬별 합계·호수별 목록"] },
    ],
  },
];

// ── HTTP ─────────────────────────────────────────────────────────────────────
async function api(method, path, body, timeoutMs = 20000) {
  const t0 = Date.now();
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: resp.status, json, text, ms: Date.now() - t0 };
}

// ── 측정 도우미 ───────────────────────────────────────────────────────────────
const HANGUL = /[가-힣]/g;
const countHangul = (s) => (String(s).match(HANGUL) ?? []).length;

/** brief(사용자 원문)를 뺀 본문에서 한글 글자 수 — EN 생성이 영어인지의 척도. */
function bodyHangul(spec) {
  const { brief: _brief, meta: _meta, ...rest } = spec ?? {};
  return countHangul(JSON.stringify(rest));
}

/** excluded 항목의 핵심 어구가 brief 밖 섹션에 등장하는지 — 휴리스틱(부정형 "회원가입 없이도 됨"은 오탐). 눈으로 확인용 힌트. */
function excludedLeaks(spec, excluded) {
  const { brief: _brief, meta: _meta, ...rest } = spec ?? {};
  const hay = JSON.stringify(rest);
  const keys = excluded.map((e) => e.replace(/\(.*?\)/g, "").split(/[·,\s]/)[0]).filter((k) => k.length >= 2);
  return keys.filter((k) => hay.includes(k));
}

function sectionCounts(spec) {
  if (!spec) return null;
  const c = (k) => (Array.isArray(spec[k]) ? spec[k].length : 0);
  return { FR: c("features"), AC: c("acceptance"), SCR: c("screens"), ENT: c("dataModel"), API: c("apis"), NFR: c("nonFunctional"), WBS: c("workBreakdown"), TP: c("testPlan") };
}

const nullDefaults = (spec) => (JSON.stringify(spec ?? {}).match(/"default":null/g) ?? []).length;
const humanAc = (spec) => (spec?.acceptance ?? []).filter((a) => a.verifiedBy === "human").length;

// ── 단계 ─────────────────────────────────────────────────────────────────────
async function createProject(f) {
  const r = await api("POST", "/workspace/projects", {
    userKey: USER_KEY,
    title: f.title,
    idea: f.idea,
    productSpec: f.productSpec,
    items: f.items,
    entryPath: "idea",
    acquisition: { source: "probe" },
  });
  if (r.status !== 200 || !r.json?.ok) throw new Error(`create ${f.n} → ${r.status} ${r.text.slice(0, 200)}`);
  // 저장된 idea가 모지바케 없이 돌아오는지(Rule 6) — 장비 자체 검증.
  const back = await api("GET", `/workspace/projects/${r.json.id}?userKey=${encodeURIComponent(USER_KEY)}`);
  const storedIdea = back.json?.project?.idea ?? back.json?.idea ?? null;
  const roundTrip = storedIdea === f.idea;
  return { id: r.json.id, roundTrip, storedIdeaHead: storedIdea ? String(storedIdea).slice(0, 30) : null };
}

async function generate(id, locale, excluded) {
  const r = await api("POST", `/workspace/projects/${id}/dev-spec/generate`, { userKey: USER_KEY, locale }, 6 * 60 * 1000);
  const out = { locale, status: r.status, ms: r.ms, ok: r.status === 200 && r.json?.ok === true };
  if (out.ok) {
    const spec = r.json.devSpec;
    out.repaired = r.json.repaired === true;
    out.counts = sectionCounts(spec);
    out.nullDefaults = nullDefaults(spec);
    out.humanAc = humanAc(spec);
    out.excludedLeaks = excludedLeaks(spec, excluded);
    out.bodyHangul = bodyHangul(spec);
    out.metaLocale = spec?.meta?.locale ?? null;
  } else {
    out.error = r.json?.error ?? r.text.slice(0, 120);
    out.stage = r.json?.stage ?? null;
    out.issues = Array.isArray(r.json?.issues) ? r.json.issues.slice(0, 5) : null;
  }
  return out;
}

async function getSaved(id) {
  const r = await api("GET", `/workspace/projects/${id}/dev-spec?userKey=${encodeURIComponent(USER_KEY)}`);
  return { status: r.status, hasSpec: r.status === 200 && !!r.json?.devSpec, updatedAt: r.json?.updatedAt ?? null, savedLocale: r.json?.devSpec?.meta?.locale ?? null };
}

async function runAcceptance(id, f, target) {
  const src = await api("POST", `/workspace/projects/${id}/sources`, { userKey: USER_KEY, type: "website", reference: target, label: "probe" });
  if (src.status !== 200 && src.status !== 201) return { skipped: `source ${src.status} ${src.text.slice(0, 100)}` };
  const intent = `${f.productSpec.oneLine}. ${f.items.map((i) => i.title).join(" / ")}`.slice(0, AC_INTENT_MAX);
  const run = await api("POST", `/workspace/projects/${id}/visual-checks/run`, { userKey: USER_KEY, targetUrl: target, intent, locale: "ko" }, 30000);
  if (run.status !== 200 && run.status !== 202) return { skipped: `run ${run.status} ${run.text.slice(0, 120)}` };
  const runId = run.json?.runId ?? run.json?.check?.id ?? run.json?.run?.id ?? run.json?.id;
  if (!runId) return { skipped: `run id missing: ${run.text.slice(0, 120)}` };
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 8000));
    const g = await api("GET", `/workspace/projects/${id}/visual-checks/${runId}?userKey=${encodeURIComponent(USER_KEY)}`);
    last = g.json;
    const status = g.json?.check?.status ?? g.json?.run?.status ?? g.json?.status;
    process.stdout.write(`  · run ${runId} ${status} ${Math.round((Date.now() - t0) / 1000)}s\r`);
    if (status === "done" || status === "failed" || status === "error") break;
  }
  process.stdout.write("\n");
  const report = last?.check?.report ?? last?.run?.report ?? last?.report ?? null;
  const acc = Array.isArray(report?.acceptance) ? report.acceptance : null;
  const raw = JSON.stringify(last ?? {});
  const acShots = (raw.match(/screenshots\/ac-[^"]+\.png/g) ?? []).length;
  const stepsRaw = JSON.stringify(report?.steps ?? []);
  const acIdsInSteps = (stepsRaw.match(/\bAC-\d{3,}\b/g) ?? []).length; // A5.1 이후 0이어야 한다
  return {
    runId,
    status: last?.check?.status ?? last?.run?.status ?? last?.status ?? null,
    seconds: Math.round((Date.now() - t0) / 1000),
    acceptanceCount: acc ? acc.length : null,
    acceptanceStatuses: acc ? Object.fromEntries(acc.map((a) => [a.acceptanceId ?? a.id, a.status])) : null,
    acShots,
    acIdsInSteps,
    notesHead: typeof report?.notes === "string" ? report.notes.split("\n")[0].slice(0, 80) : null,
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
const results = [];
const fixtures = ONLY ? FIXTURES.filter((f) => ONLY.includes(f.n)) : FIXTURES;
console.log(`dev-spec-probe · base=${BASE} · userKey=${USER_KEY} · fixtures=${fixtures.map((f) => f.n).join(",")} · target=${TARGET ?? "-"} · keep=${KEEP}`);
const health = await api("GET", "/health").catch((e) => ({ status: 0, text: String(e) }));
console.log(`health ${health.status}`);

for (const f of fixtures) {
  const row = { n: f.n, title: f.title };
  try {
    const p = await createProject(f);
    row.projectId = p.id;
    row.ideaRoundTrip = p.roundTrip;
    console.log(`\n[${f.n}] ${f.title} → ${p.id} (idea round-trip ${p.roundTrip ? "OK" : "MISMATCH: " + p.storedIdeaHead})`);
    row.ko = await generate(p.id, "ko", f.productSpec.excluded);
    console.log(`  ko ${row.ko.status} ${Math.round(row.ko.ms / 1000)}s ${row.ko.ok ? `repaired=${row.ko.repaired} ${JSON.stringify(row.ko.counts)} null=${row.ko.nullDefaults} humanAC=${row.ko.humanAc} leaks=${JSON.stringify(row.ko.excludedLeaks)}` : `${row.ko.error}/${row.ko.stage} ${JSON.stringify(row.ko.issues)}`}`);
    if (!SKIP_EN) {
      row.en = await generate(p.id, "en", f.productSpec.excluded);
      console.log(`  en ${row.en.status} ${Math.round(row.en.ms / 1000)}s ${row.en.ok ? `repaired=${row.en.repaired} bodyHangul=${row.en.bodyHangul} null=${row.en.nullDefaults} leaks=${JSON.stringify(row.en.excludedLeaks)}` : `${row.en.error}/${row.en.stage} ${JSON.stringify(row.en.issues)}`}`);
    }
    row.saved = await getSaved(p.id);
    console.log(`  saved ${row.saved.status} hasSpec=${row.saved.hasSpec} locale=${row.saved.savedLocale}`);
    if (TARGET) {
      row.acceptance = await runAcceptance(p.id, f, TARGET);
      console.log(`  acceptance ${JSON.stringify(row.acceptance)}`);
    }
  } catch (err) {
    row.error = String(err?.message ?? err);
    console.log(`  ERROR ${row.error}`);
  } finally {
    if (row.projectId && !KEEP) {
      const d = await api("DELETE", `/workspace/projects/${row.projectId}?userKey=${encodeURIComponent(USER_KEY)}`).catch((e) => ({ status: 0, text: String(e) }));
      row.deleted = d.status === 200;
    }
  }
  results.push(row);
}

// ── 세 칸 표 ─────────────────────────────────────────────────────────────────
const lines = ["", "| 기획 | ko | en | 저장 | AC 검수 | 칸 |", "|---|---|---|---|---|---|"];
for (const r of results) {
  const g = (x) => (!x ? "미측정" : x.ok ? `200·${Math.round(x.ms / 1000)}s·rep=${x.repaired ? 1 : 0}·null=${x.nullDefaults}·leak?=${x.excludedLeaks.length}${x.locale === "en" ? `·한글=${x.bodyHangul}` : ""}` : `${x.status} ${x.error}/${x.stage ?? "-"}`);
  const a = r.acceptance ? (r.acceptance.skipped ? `skip(${r.acceptance.skipped})` : `${r.acceptance.status}·AC${r.acceptance.acceptanceCount}·shots=${r.acceptance.acShots}·dupInSteps=${r.acceptance.acIdsInSteps}`) : "미측정";
  lines.push(`| ${r.n} ${r.title} | ${g(r.ko)} | ${g(r.en)} | ${r.saved ? (r.saved.hasSpec ? "있음" : r.saved.status) : "미측정"} | ${a} | ${r.error ? "오류: " + r.error : "라이브확인"} |`);
}
console.log(lines.join("\n"));

const outPath = join(dirname(fileURLToPath(import.meta.url)), "dev-spec-probe-result.json");
writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), base: BASE, userKey: USER_KEY, target: TARGET, results }, null, 2));
console.log(`\n→ ${outPath}`);
const bad = results.some((r) => r.error || (r.ko && !r.ko.ok) || (r.en && !r.en.ok) || r.ideaRoundTrip === false);
process.exit(bad ? 1 : 0);
