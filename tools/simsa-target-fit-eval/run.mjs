/**
 * simsa-target-fit-eval — "타겟(비개발자·바이브코더·초보 AI유저)에게 실제로
 * 유용한 결과물인가"의 객관 실측 (2026-07-17, Bae 지시).
 *
 * 측정 축:
 *   A. 분야 다양성 — 서로 다른 10개 분야 아이디어에 맞춤 질문/스펙이 나오는가
 *      (정량: 아이디어 간 item-title Jaccard 유사도 = 템플릿 반복도)
 *   B. 스택 편향 — vercel/supabase/cloudflare/resend/sentry 등이 아이디어와
 *      무관하게 항상 등장하는가 (정량: 토큰 히스토그램, 초안 vs 빌더팩 분리)
 *   C. 도구 이식성 — 빌더팩이 Claude Code/Codex 외 도구(Replit/Lovable/v0 등
 *      웹빌더)에서 쓸 수 있는 형태인가 (정량: CLI 전제 토큰 빈도 + 파일 구성)
 *   D. 가드 검증 — solo 케이스 권한질문 0 / 네이티브 케이스 경고 발화 /
 *      개발자 용어 누수(#351 이후)
 *
 * Usage: node run.mjs 0 4   (ideas index range, inclusive) — rate-limit 배려
 *        node run.mjs       (all)
 * Output: dump-<range>.json (원자료 전체) + stdout 요약
 */

const BASE = process.env.SIMSA_BASE ?? "https://conclave-ai.seunghunbae.workers.dev";

const IDEAS = [
  { id: "biz-side-dish", domain: "로컬 상거래", idea: "동네 반찬가게에서 단골손님들이 주간 반찬 메뉴를 보고 미리 예약 주문하는 웹앱. 가게는 하나뿐이고 사장님 혼자 운영해요." },
  { id: "edu-dictation", domain: "교육/가족", idea: "초등학생 아이에게 받아쓰기 연습을 시키는 웹앱. 부모가 단어 목록을 넣으면 아이가 듣고 받아쓰고 자동 채점돼요." },
  { id: "church-group", domain: "커뮤니티/종교", idea: "교회 소모임 리더가 모임 출석과 심방(가정 방문) 기록을 관리하는 웹앱" },
  { id: "pilates-pass", domain: "피트니스/소상공인", idea: "필라테스 강사가 회원별 수강권 남은 횟수를 관리하고 회원이 직접 조회할 수 있는 웹앱" },
  { id: "webtoon-folio", domain: "크리에이티브", idea: "웹툰 지망생이 작품 포트폴리오를 올리고 독자들에게 회차별 피드백을 받는 웹사이트" },
  { id: "farm-box", domain: "농업 직거래", idea: "농장에서 매주 제철 채소 꾸러미를 소비자가 신청하고 농장이 배송 일정을 알려주는 웹앱" },
  { id: "solo-dog", domain: "개인(solo)", idea: "나 혼자 쓰는 반려견 산책·사료·병원 기록 웹앱. 로그인 필요 없어요." },
  { id: "rental-repair", domain: "부동산 관리", idea: "원룸 건물 세입자들이 수리 요청을 사진과 함께 올리면 집주인이 처리 상태를 갱신하는 웹앱" },
  { id: "senior-center", domain: "시니어 복지", idea: "복지관 프로그램(노래교실, 요가 등)을 어르신들이 큰 글씨 화면에서 신청하는 웹앱. 컴퓨터가 익숙하지 않은 70대가 씁니다." },
  { id: "native-game", domain: "네이티브(대조군)", idea: "아이폰에서 하는 3D 러닝 게임 앱" },
];

const STACK_TOKENS = ["vercel", "supabase", "cloudflare", "resend", "sentry", "firebase", "aws", "netlify", "next.js", "nextjs", "react", "tailwind", "stripe", "railway", "render"];
const CLI_TOKENS = [".env.local", "git ", "git push", "npm ", "pnpm ", "터미널", "로컬 서버", "localhost", "mcp", "cli", "붙여넣으세요"];
const JARGON_RE = /firebase|supabase|\baws\b|chart\.js|\bapi\b|\bsdk\b|oauth|\bjwt\b|데이터베이스|\bdb\b|엔드포인트|webhook/i;
const PERMISSION_RE = /권한|역할|멀티|여러 사용자|누구에게|접근을 허용|다른 사용자/;

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: { _raw: text.slice(0, 300) } }; }
}

const countTokens = (text, tokens) => {
  const t = text.toLowerCase();
  const out = {};
  for (const tok of tokens) {
    const n = t.split(tok.toLowerCase()).length - 1;
    if (n > 0) out[tok] = n;
  }
  return out;
};

const norm = (s) => s.replace(/\s+/g, "").toLowerCase();
function jaccard(aTitles, bTitles) {
  const a = new Set(aTitles.map(norm));
  const b = new Set(bTitles.map(norm));
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

const [startArg, endArg] = process.argv.slice(2).map(Number);
const start = Number.isInteger(startArg) ? startArg : 0;
const end = Number.isInteger(endArg) ? endArg : IDEAS.length - 1;
const slice = IDEAS.slice(start, end + 1);

console.log(`target-fit eval — base=${BASE} ideas[${start}..${end}] (${slice.length})\n`);

const rows = [];
for (const c of slice) {
  process.stdout.write(`▶ ${c.id} (${c.domain}) … `);
  const draftRes = await api("/workspace/idea-to-spec-draft", { idea: c.idea, locale: "ko" });
  const d = draftRes.json;
  if (!d?.ok) {
    console.log(`draft 실패 (${draftRes.status}) ${JSON.stringify(d).slice(0, 120)}`);
    rows.push({ ...c, error: `draft_${draftRes.status}` });
    continue;
  }
  const pack = await api("/workspace/export-builder-pack", {
    target: "both",
    locale: "ko",
    format: "json",
    project: {
      title: d.productSpec?.productName ?? c.id,
      idea: c.idea,
      productSpec: d.productSpec ?? {},
      items: d.items ?? [],
    },
  });
  const files = pack.json?.bundle?.files ?? pack.json?.files ?? [];
  const packText = files.map((f) => `${f.name ?? f.path ?? ""}\n${f.content ?? ""}`).join("\n");
  const draftText = JSON.stringify({ understood: d.understood, questions: d.questions, productSpec: d.productSpec, items: d.items });

  const row = {
    ...c,
    source: d.source,
    warnings: d.warnings ?? [],
    questionCount: (d.questions ?? []).length,
    questions: (d.questions ?? []).map((q) => q.question),
    itemTitles: (d.items ?? []).map((i) => i.title),
    openQuestions: d.productSpec?.openQuestions ?? [],
    excluded: d.productSpec?.excluded ?? [],
    stackInDraft: countTokens(draftText, STACK_TOKENS),
    stackInPack: countTokens(packText, STACK_TOKENS),
    cliTokensInPack: countTokens(packText, CLI_TOKENS),
    packFiles: files.map((f) => f.name ?? f.path),
    jargonInQuestions: (d.questions ?? []).map((q) => q.question).filter((q) => JARGON_RE.test(q)),
    jargonInOpenQuestions: (d.productSpec?.openQuestions ?? []).filter((q) => JARGON_RE.test(q)),
    permissionQuestions: (d.questions ?? []).map((q) => q.question).filter((q) => PERMISSION_RE.test(q)),
    draft: d,
    packFilesFull: files,
  };
  rows.push(row);
  console.log(`source=${d.source} q=${row.questionCount} items=${row.itemTitles.length} 파일=${row.packFiles.length} 스택(초안)=${JSON.stringify(row.stackInDraft)}`);
}

// ── 요약 ──────────────────────────────────────────────────────────────────────
const okRows = rows.filter((r) => !r.error);
console.log(`\n════ 요약 (${okRows.length}/${rows.length} 성공) ════`);

console.log(`\n[A] 템플릿 반복도 (item-title Jaccard, 낮을수록 맞춤):`);
let maxJ = 0, sumJ = 0, nPairs = 0;
for (let i = 0; i < okRows.length; i++) for (let j = i + 1; j < okRows.length; j++) {
  const v = jaccard(okRows[i].itemTitles, okRows[j].itemTitles);
  sumJ += v; nPairs++;
  if (v > maxJ) maxJ = v;
  if (v > 0.3) console.log(`  ⚠ ${okRows[i].id} × ${okRows[j].id}: ${v.toFixed(2)}`);
}
console.log(`  평균=${nPairs ? (sumJ / nPairs).toFixed(3) : "-"} 최대=${maxJ.toFixed(3)}`);

console.log(`\n[B] 스택 편향 — 등장 아이디어 수 / ${okRows.length}:`);
for (const tok of STACK_TOKENS) {
  const inDraft = okRows.filter((r) => r.stackInDraft[tok]).length;
  const inPack = okRows.filter((r) => r.stackInPack[tok]).length;
  if (inDraft || inPack) console.log(`  ${tok.padEnd(11)} 초안 ${inDraft}  빌더팩 ${inPack}`);
}

console.log(`\n[C] 도구 이식성 — 빌더팩 CLI 전제 토큰 (등장 아이디어 수):`);
for (const tok of CLI_TOKENS) {
  const n = okRows.filter((r) => r.cliTokensInPack[tok]).length;
  if (n) console.log(`  ${JSON.stringify(tok).padEnd(14)} ${n}/${okRows.length}`);
}
if (okRows[0]) console.log(`  파일 구성 예: ${JSON.stringify(okRows[0].packFiles)}`);

console.log(`\n[D] 가드:`);
for (const r of okRows) {
  if (r.jargonInQuestions.length || r.jargonInOpenQuestions.length)
    console.log(`  ⚠ ${r.id}: 개발자 용어 — Q:${JSON.stringify(r.jargonInQuestions)} OQ:${JSON.stringify(r.jargonInOpenQuestions)}`);
}
const solo = okRows.find((r) => r.id === "solo-dog");
if (solo) console.log(`  solo-dog 권한류 질문: ${solo.permissionQuestions.length}개 ${JSON.stringify(solo.permissionQuestions)}`);
const native = okRows.find((r) => r.id === "native-game");
if (native) console.log(`  native-game 경고: ${native.warnings.length ? native.warnings[0].slice(0, 80) : "❌ 없음"}`);
const llmRate = okRows.filter((r) => r.source === "llm").length;
console.log(`  source=llm: ${llmRate}/${okRows.length}`);

const { writeFileSync } = await import("node:fs");
const outPath = new URL(`./dump-${start}-${end}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(rows, null, 2));
console.log(`\nsaved: ${outPath.pathname}`);
