/**
 * simsa-review-consensus-eval — RC-6 실측 게이트 (2026-07-18).
 *
 * 정답이 결정 가능한 check-draft 케이스로 panel(A, 전원 기본)과 council(B, 유료)을
 * 프로덕션에서 실측 비교한다. 핵심 지표는 정답 일치율과 **유해 오탐**(정답이
 * failed가 아닌데 failed로 선고한 수) — RC-2/RC-3의 존재 이유가 유해 오탐 감소다.
 *
 * Usage: ICT=<token> node run.mjs [baseUrl]
 *   council 모드는 probe userKey에 일시 grant 후 실행, 끝나면 revoke.
 */
const BASE = process.argv[2] ?? "https://conclave-ai.seunghunbae.workers.dev";
const ICT = process.env.ICT ?? "";
const UKEY = "probe_rc6_eval";

const SPEC_BASE = {
  productName: "출장 경비 정리 앱",
  oneLine: "영수증을 올리면 자동 분류하고 월별 리포트를 만듭니다",
  targetUsers: ["출장이 잦은 직장인"],
  problem: "영수증 정리에 시간이 많이 걸립니다",
  included: ["영수증 사진 업로드", "자동 분류", "월별 리포트"],
  excluded: ["법인카드 실시간 연동", "구독료 결제"],
  userFlow: ["업로드", "분류 확인", "리포트"],
  decisions: ["리포트는 월 1회 이메일로"],
  openQuestions: ["영수증 보관 기간"],
};

/** 케이스: {item, truth, note}. truth는 판단 기준(check.ts 프롬프트)으로 결정 가능한 정답. */
const CASES = [
  {
    id: "excluded-conflict",
    item: { id: "c1", title: "구독료 결제를 받을 수 있어야 함", criteria: ["카드 결제", "영수증 발급"] },
    truth: ["failed"],
    note: "제외 범위 정면 충돌 — failed가 정답",
  },
  {
    id: "clear-included",
    item: { id: "c2", title: "영수증 사진을 업로드할 수 있어야 함", criteria: ["JPG/PNG 지원", "10MB 이하 제한", "업로드 실패 시 안내"] },
    truth: ["passed"],
    note: "포함 범위 + 구체 기준 3개 — passed가 정답",
  },
  {
    id: "no-criteria",
    item: { id: "c3", title: "리포트가 보기 좋아야 함", criteria: [] },
    truth: ["inconclusive"],
    note: "기준 없음·추상적 — inconclusive가 정답",
  },
  {
    id: "open-question-linked",
    item: { id: "c4", title: "영수증 보관 기간이 지나면 자동 삭제되어야 함", criteria: ["기간 경과 시 삭제"] },
    truth: ["needs_decision"],
    note: "미결정(보관 기간)과 직결 — needs_decision이 정답",
  },
  {
    id: "false-positive-bait",
    item: { id: "c5", title: "월별 리포트를 이메일로 받아볼 수 있어야 함", criteria: ["매월 1일 발송", "수신 거부 링크"] },
    truth: ["passed"],
    note: "결정 사항과 일치하는 정상 항목 — failed로 선고하면 유해 오탐",
  },
  {
    id: "excluded-partial-words",
    item: { id: "c6", title: "영수증에서 카드 이름을 자동으로 읽어야 함", criteria: ["카드사명 인식", "인식 실패 시 직접 입력"] },
    truth: ["passed", "inconclusive"],
    note: "'법인카드 실시간 연동'과 단어만 겹침(실제 무관) — failed면 유해 오탐",
  },
];

async function runCase(kase, reviewMode) {
  const r = await fetch(`${BASE}/workspace/check-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productSpec: SPEC_BASE,
      items: [{ ...kase.item, status: "not_started" }],
      locale: "ko",
      userKey: UKEY,
      reviewMode,
    }),
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const j = await r.json();
  const res = (j.results ?? [])[0];
  return { status: res?.status, verification: res?.verification, council: j.council };
}

const admin = (body) =>
  fetch(`${BASE}/admin/plan-grants`, {
    method: "POST",
    headers: { authorization: `Bearer ${ICT}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function score(rows) {
  const correct = rows.filter((r) => r.ok).length;
  const harmful = rows.filter((r) => r.harmfulFP).length;
  return { correct, total: rows.length, harmful };
}

const out = { panel: [], council: [] };

for (const mode of ["panel", "council"]) {
  if (mode === "council") await admin({ userKey: UKEY, action: "grant", note: "rc6 eval" });
  for (const kase of CASES) {
    const res = await runCase(kase, mode);
    const ok = res.status ? kase.truth.includes(res.status) : false;
    const harmfulFP = res.status === "failed" && !kase.truth.includes("failed");
    out[mode].push({ id: kase.id, ...res, truth: kase.truth.join("|"), ok, harmfulFP });
    console.log(`[${mode}] ${kase.id}: got=${res.status ?? res.error} (${res.verification ?? "-"}) truth=${kase.truth.join("|")} ${ok ? "OK" : "MISS"}${harmfulFP ? " ⚠HARMFUL-FP" : ""}`);
  }
  if (mode === "council") await admin({ userKey: UKEY, action: "revoke" });
}

const p = score(out.panel);
const c = score(out.council);
console.log(`\npanel:   ${p.correct}/${p.total} correct, harmful FP ${p.harmful}`);
console.log(`council: ${c.correct}/${c.total} correct, harmful FP ${c.harmful}`);
console.log(JSON.stringify(out, null, 2));
