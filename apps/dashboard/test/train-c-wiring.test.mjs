/**
 * Train C — 화면 배선 정적 검사 (hydration-guard.test.mjs 방식: 소스를 grep 한다).
 *
 * 컴포넌트 렌더링은 node --test 범위 밖이라, "그 호출이 그 자리에 있는가"를 소스에서
 * 고정한다. 각 검사는 고치기 전 코드에서 실패한다.
 *
 *  C0-a  IntentConfirmCard.confirm()이 로컬 저장 뒤 mirrorLocalProjectToDb를 부른다
 *        (재정렬 §1 끊김 #1 — "맞나요?" 확정이 D1·검수 기준에 닿지 않았다)
 *  C0-b  리포트 상세의 재검수가 buildRecheckBody를 거친다 (끊김 #2 — 의도 유실)
 *  C2b-a 복사 버튼이 계약 4 이벤트(recordFixPromptCopied)를 보낸다 (끊김 #12 — 활용 방식 미계측)
 *  C2b-b 리포트 하단에 user_verdict 제출(submitUserVerdict)이 배선돼 있다 (W1-8)
 *  C2b-c 프롬프트 기본 형식은 pickDefaultPromptTarget(built_with, builderPrompt 유무)로 고른다
 *  C2a   고치기 진입이 canRepair 단독이 아니라 repairEntryMode(저장소 유무)로 갈린다
 *        (끊김 #4·#5 — 주소만 앱에 GitHub CTA, D-17 amend)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src");

const card = readFileSync(path.join(SRC, "components/IntentConfirmCard.tsx"), "utf8");
const page = readFileSync(
  path.join(SRC, "app/projects/[id]/visual-checks/[runId]/page.tsx"),
  "utf8",
);
const api = readFileSync(path.join(SRC, "lib/workspace-visual-checks-api.ts"), "utf8");
const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");

/** Body of `function confirm() { … }` in IntentConfirmCard (up to the next top-level `  }`). */
function confirmBody(src) {
  const start = src.indexOf("  function confirm()");
  assert.ok(start >= 0, "IntentConfirmCard has a confirm() function");
  const end = src.indexOf("\n  }\n", start);
  return src.slice(start, end);
}

test("C0-a: IntentConfirmCard.confirm()이 로컬 저장 뒤 mirrorLocalProjectToDb(projectId)를 부른다 (실패는 조용히)", () => {
  assert.match(card, /import \{ mirrorLocalProjectToDb \} from "@\/lib\/project-mirror"/);
  const body = confirmBody(card);
  const save = body.indexOf("saveExtendedProjectData(");
  const mirror = body.indexOf("mirrorLocalProjectToDb(projectId)");
  assert.ok(save >= 0, "confirm() saves extended data");
  assert.ok(mirror >= 0, "confirm() mirrors to D1");
  assert.ok(mirror > save, "mirror runs AFTER the local save — local is the source of truth");
  // 실패는 조용히: 로컬이 정본이므로 미러 실패가 확정을 막지 않는다.
  assert.match(body, /void mirrorLocalProjectToDb\(projectId\)\.catch\(\(\) => undefined\)/);
});

test("C0-b: 재검수가 buildRecheckBody(check, userKey, locale, { confirmedIntent })를 거친다 — {userKey, locale}만 보내지 않는다", () => {
  assert.match(page, /import \{ buildRecheckBody \} from "@\/lib\/visual-check-recheck\.mjs"/);
  // PR #552 검증 결함 #2: 원 런 intent가 서버 기본 문장이면 로컬에 확정된 oneLine이 대신
  // 가야 한다 — 그러려면 재검수 훅이 프로젝트의 확정 의도를 buildRecheckBody에 넘겨야 한다.
  assert.match(
    page,
    /buildRecheckBody\(check, userKey, locale, \{\s*confirmedIntent: loadExtendedProjectData\(projectId\)\?\.productSpec\?\.oneLine \?\? null,?\s*\}\)/,
  );
  assert.doesNotMatch(page, /buildRecheckBody\(check, userKey, locale\)\)/);
  assert.doesNotMatch(page, /runVisualCheck\(projectId, \{ userKey, locale \}\)/);
});

test("C2b-a: 고침 지시 복사가 계약 4 이벤트를 보낸다 (recordFixPromptCopied, 실패 무시) — 클립보드 성공 뒤에만", () => {
  assert.match(page, /void recordFixPromptCopied\(id, runId, userKey, promptTarget\)/);
  const copy = page.indexOf("async function handleCopyPrompt()");
  assert.ok(copy >= 0);
  const body = page.slice(copy, page.indexOf("\n  }\n", copy));
  assert.ok(body.indexOf("navigator.clipboard.writeText(") < body.indexOf("recordFixPromptCopied("), "event after the copy succeeded");
});

test("C2b-b: 리포트 하단에 user_verdict 제출이 배선돼 있다 (submitUserVerdict → 서버값으로 복원)", () => {
  assert.match(page, /submitUserVerdict\(projectId, runId, userKey, next\)/);
  assert.match(page, /<UserVerdictSection/);
  // 재열람 시 서버가 준 값으로 복원한다 — 옛 서버(필드 없음)는 null로 정규화.
  assert.match(page, /normalizeUserVerdict\(check\.userVerdict\)/);
});

test("C2b-b′ (PR #552 검증 P2): 저장 성공 응답의 verdict도 정규화한다 — 예상 밖 값이면 방금 고른 값을 유지", () => {
  // 옛 코드: setVerdict(res.verdict) — `as UserVerdictResponse` 캐스트만 믿어, 서버가 예상 밖 값을 주면
  // '저장했어요' 문구와 함께 어떤 칩도 선택되지 않은 상태가 됐다.
  assert.ok(!/setVerdict\(res\.verdict\)/.test(page), "no raw trust of res.verdict");
  assert.ok(/setVerdict\(normalizeUserVerdict\(res\.verdict\) \?\? next\)/.test(page), "normalize at the boundary, fall back to the chosen value");
});

test("C2b-b″ (PR #552 검증 P2): 저장 실패는 원인별 카피 — 옛 서버(라우트 없음)에 '잠시 뒤 다시' 카피를 쓰지 않는다", () => {
  assert.ok(/userVerdictErrorKey\(res\.error\)/.test(page), "error key derived from the server answer");
  assert.ok(/s\.saveUnavailable/.test(page) && /s\.saveError/.test(page), "both copies are wired");
});

test("C2b-d (PR #552 검증 P2): fixPrompt.* 사전 키는 모두 화면에서 쓰인다 — 죽은 키를 존재 고정으로 감추지 않는다", () => {
  for (const k of Object.keys(DICTIONARIES.ko.visualChecks.fixPrompt)) {
    assert.ok(page.includes(`fixPrompt.${k}`), `t.visualChecks.fixPrompt.${k} is never referenced by the page`);
  }
});

test("계약 2·4 요청 모양 (PR #552 검증 P2, 정보성 가드): submitUserVerdict / recordFixPromptCopied", () => {
  const sv = api.slice(api.indexOf("export async function submitUserVerdict"), api.indexOf("export type FixPromptCopyTarget"));
  assert.ok(sv.length > 0, "submitUserVerdict exists");
  assert.match(sv, /\/visual-checks\/\$\{encodeURIComponent\(runId\)\}\/verdict`/);
  assert.match(sv, /method: "POST"/);
  assert.match(sv, /body: JSON\.stringify\(\{ userKey, verdict \}\)/);
  const ev = api.slice(api.indexOf("export async function recordFixPromptCopied"));
  assert.ok(ev.length > 0, "recordFixPromptCopied exists");
  assert.match(ev, /\/visual-checks\/\$\{encodeURIComponent\(runId\)\}\/events`/);
  assert.match(ev, /body: JSON\.stringify\(\{ userKey, type: "fix_prompt_copied", target \}\)/);
  assert.match(ev, /keepalive: true/);
});

test("C2b-c: 프롬프트 기본 형식은 '상태'가 아니라 '파생'이다 — 폴링으로 리포트가 도착해도 반영된다 (PR #552 검증 결함 #1)", () => {
  // 옛 코드: useState<FixPromptTarget>("cli") + load() 안에서만 setPromptTarget. 재검수 주 경로
  // (res.dispatched → 새 런으로 router.push)는 queued/running으로 들어오므로 report=null →
  // "cli"로 고정되고, 5초 뒤 폴링이 builderPrompt 있는 done 리포트를 setCheck해도 그대로였다
  // (Lovable 유저에게 CLI 지시가 기본 — 계약 3 위반). 기본값을 매 렌더 파생으로 바꾼다.
  assert.ok(!/useState<FixPromptTarget>\("cli"\)/.test(page), "no promptTarget state seeded to cli");
  assert.ok(!/setPromptTarget\(/.test(page), "no setter — the default is never 'set once'");
  assert.ok(
    /const \[explicitPromptTarget, setExplicitPromptTarget\] = useState<FixPromptTarget \| null>\(null\)/.test(page),
    "only the user's explicit toggle is state (nullable)",
  );
  assert.ok(
    /const promptTarget: FixPromptTarget =\s*explicitPromptTarget \?\?\s*pickDefaultPromptTarget\(/.test(page),
    "default derived every render from check / built_with / repo fact",
  );
  // 런이 바뀌면(재검수 → 새 runId) 명시 선택도 리셋 — 다음 런은 다시 기본으로.
  assert.ok(/useEffect\(\(\) => \{ setExplicitPromptTarget\(null\); \}, \[runId\]\)/.test(page), "explicit choice resets per run");
  assert.match(page, /fixPromptFor\(check, promptTarget\)/);
  assert.ok(/setExplicitPromptTarget\(otherPromptTarget\)/.test(page), "the toggle sets the explicit choice");
});

test("C2b-c′: 기본 형식 선택에 진입 모드를 반영한다 — 저장소 미연결(addressOnly)은 빌더 형식이 기본 (PR #552 검증 결함 #3)", () => {
  // C2a 카드가 "그 도구의 채팅창에 붙여넣으세요"라 말하는 화면(hasRepo false/null)에서 바로 아래
  // 지시가 CLI 형식이면 모순 + 기본 흐름 금칙어(Cursor). 저장소 사실(undefined·null·false 모두
  // '연결됨 아님')을 pickDefaultPromptTarget에 넘긴다.
  assert.ok(
    /pickDefaultPromptTarget\([\s\S]{0,240}?\{ addressOnly: hasRepo !== true \}/.test(page),
    "addressOnly follows the repo fact",
  );
});

test("C2a: 고치기 진입이 repairEntryMode(check, hasRepo, …)로 갈린다 — canRepair(check) && 단독 렌더가 아니다", () => {
  assert.ok(
    /repairEntryMode\(check, hasRepo, \{ hasRepairJob: repairProbe === true \}\)/.test(page),
    "entry mode takes the repo fact AND the existing-job probe",
  );
  // PR #552 검증 P2: 저장소 사실이 false/null이어도 이미 있는 수리 잡(PR 링크)은 보여야 한다 —
  // 페이지가 잡 존재를 한 번 확인해(getRepair) 진입 모드에 넣는다. RepairSection 안의 마운트 GET과 별개.
  const probe = page.indexOf("const [repairProbe, setRepairProbe]");
  assert.ok(probe >= 0, "the page holds a repair-job probe");
  assert.ok(/getRepair\(id, runId, userKey\)/.test(page), "the page probes the existing repair job by run");
  assert.doesNotMatch(page, /\{canRepair\(check\) && \(/);
  assert.match(page, /<BuilderPasteSection/);
  // 저장소 사실은 transient-null 재시도 헬퍼로 읽는다(3svs-os error-patterns/transient-null-hard-false).
  assert.match(page, /fetchProjectRepoSettled\(fetchProjectRepo, id, userKey/);
  assert.match(page, /repoConnectedFact\(/);
});
